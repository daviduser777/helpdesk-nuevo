const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) return cachedDb;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    cachedDb = client.db('helpdesk');
    return cachedDb;
}

// ============================================
// AGENTE DE IA CON GEMINI
// ============================================
async function triageWithGemini(ticketData) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.log('⚠️ GEMINI_API_KEY no configurada');
        return null;
    }

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `
Eres un asistente de Help Desk. Clasifica el siguiente ticket:

Título: ${ticketData.titulo}
Descripción: ${ticketData.descripcion}
Email: ${ticketData.email_usuario}

Reglas:
- Si menciona "servidor caído", "producción" → prioridad: crítica
- Si dice "urgente" → prioridad: alta
- Si es sobre "contraseña" → categoría: acceso
- Si es sobre "red", "internet" → categoría: red
- Si es sobre "impresora" → categoría: hardware
- Si es sobre "software", "aplicación" → categoría: software

Preguntas frecuentes (responde automáticamente):
- "cómo reiniciar la vpn" → Instrucciones para reiniciar VPN
- "olvidé mi contraseña" → Enlace para recuperar contraseña
- "la impresora no funciona" → Guía de solución de problemas

Responde ÚNICAMENTE en formato JSON:
{
    "prioridad": "crítica|alta|media|baja",
    "categoria": "hardware|software|red|acceso|infraestructura",
    "respuesta_automatica": "texto o null",
    "escalar": true|false,
    "equipo": "level1|level2|devops|infraestructura"
}
`;

    try {
        const response = await axios.post(GEMINI_URL, {
            contents: [{ parts: [{ text: prompt }] }]
        });

        const result = response.data.candidates[0].content.parts[0].text;
        const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('❌ Error en Gemini:', error.message);
        return null;
    }
}

// ============================================
// TRELLO
// ============================================
async function createTrelloCard(ticketData, ticketId) {
    const trelloKey = process.env.TRELLO_API_KEY;
    const trelloToken = process.env.TRELLO_TOKEN;
    const trelloListId = process.env.TRELLO_LIST_ID;

    if (!trelloKey || !trelloToken || !trelloListId) return null;

    try {
        const response = await axios.post('https://api.trello.com/1/cards', null, {
            params: {
                key: trelloKey,
                token: trelloToken,
                idList: trelloListId,
                name: `[URGENTE] ${ticketData.titulo}`,
                desc: `ID: ${ticketId}\nUsuario: ${ticketData.email_usuario}\n${ticketData.descripcion}`,
                pos: 'top'
            }
        });
        return response.data.url;
    } catch (error) {
        return null;
    }
}

// ============================================
// MANEJADOR PRINCIPAL
// ============================================
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const db = await connectToDatabase();
        const url = req.url;

        // GET /health
        if (req.method === 'GET' && url === '/health') {
            return res.status(200).json({ status: 'OK', service: 'HelpDesk API', timestamp: new Date().toISOString() });
        }

        // GET /tickets
        if (req.method === 'GET' && url === '/tickets') {
            const tickets = await db.collection('tickets').find({}).toArray();
            return res.status(200).json({ success: true, count: tickets.length, data: tickets });
        }

        // GET /tickets/:id
        if (req.method === 'GET' && url.startsWith('/tickets/')) {
            const id = url.split('/')[2];
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
            const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(id) });
            if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
            return res.status(200).json({ success: true, data: ticket });
        }

        // POST /tickets
        if (req.method === 'POST' && url === '/tickets') {
            const { titulo, descripcion, prioridad, email_usuario } = req.body;

            if (!titulo || !descripcion || !email_usuario) {
                return res.status(400).json({ success: false, error: 'Faltan campos' });
            }

            const newTicket = {
                titulo,
                descripcion,
                prioridad: prioridad || 'normal',
                email_usuario,
                estado: 'abierto',
                fecha_creacion: new Date(),
                fecha_actualizacion: new Date()
            };

            const result = await db.collection('tickets').insertOne(newTicket);
            const ticketCreado = { ...newTicket, _id: result.insertedId };

            let geminiResult = null;
            let trelloCardUrl = null;

            // AGENTE GEMINI
            if (prioridad === 'urgente' || prioridad === 'alta') {
                geminiResult = await triageWithGemini(newTicket);
                if (geminiResult) {
                    const updateData = {
                        categoria: geminiResult.categoria || 'no_clasificado',
                        prioridad_ia: geminiResult.prioridad || prioridad,
                        escalar: geminiResult.escalar || false,
                        equipo_asignado: geminiResult.equipo || 'level1'
                    };
                    if (geminiResult.respuesta_automatica) {
                        updateData.respuesta_automatica = geminiResult.respuesta_automatica;
                        updateData.estado = 'cerrado';
                    }
                    await db.collection('tickets').updateOne({ _id: result.insertedId }, { $set: updateData });
                    if (geminiResult.escalar) {
                        trelloCardUrl = await createTrelloCard(newTicket, result.insertedId);
                    }
                } else if (prioridad === 'urgente') {
                    trelloCardUrl = await createTrelloCard(newTicket, result.insertedId);
                }
            }

            return res.status(201).json({
                success: true,
                message: 'Ticket creado exitosamente',
                data: ticketCreado,
                gemini_clasificacion: geminiResult,
                trello_card_url: trelloCardUrl
            });
        }

        // PUT /tickets/:id
        if (req.method === 'PUT' && url.startsWith('/tickets/')) {
            const id = url.split('/')[2];
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
            const { estado, prioridad } = req.body;
            const updateData = { fecha_actualizacion: new Date() };
            if (estado) updateData.estado = estado;
            if (prioridad) updateData.prioridad = prioridad;
            const result = await db.collection('tickets').updateOne({ _id: new ObjectId(id) }, { $set: updateData });
            if (result.matchedCount === 0) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
            return res.status(200).json({ success: true, message: 'Ticket actualizado' });
        }

        // DELETE /tickets/:id
        if (req.method === 'DELETE' && url.startsWith('/tickets/')) {
            const id = url.split('/')[2];
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
            const result = await db.collection('tickets').deleteOne({ _id: new ObjectId(id) });
            if (result.deletedCount === 0) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
            return res.status(200).json({ success: true, message: 'Ticket eliminado' });
        }

        return res.status(404).json({ error: 'Endpoint no encontrado' });
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Error interno', details: error.message });
    }
};