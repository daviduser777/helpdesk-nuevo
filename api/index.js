const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'API funcionando' });
});

// GET /tickets - Listar todos
app.get('/tickets', async (req, res) => {
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        const db = client.db('helpdesk');
        const tickets = await db.collection('tickets').find({}).toArray();
        res.json({ success: true, data: tickets });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /tickets/:id - Obtener uno
app.get('/tickets/:id', async (req, res) => {
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        const db = client.db('helpdesk');
        const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(req.params.id) });
        if (!ticket) {
            return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
        res.json({ success: true, data: ticket });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /tickets - Crear ticket
app.post('/tickets', async (req, res) => {
    try {
        const { titulo, descripcion, prioridad, email_usuario } = req.body;
        
        // Validar datos
        if (!titulo || !descripcion || !email_usuario) {
            return res.status(400).json({ 
                success: false, 
                error: 'Faltan campos: titulo, descripcion, email_usuario son obligatorios' 
            });
        }
        
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        const db = client.db('helpdesk');
        
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
        
        res.status(201).json({ 
            success: true, 
            message: 'Ticket creado exitosamente',
            data: { ...newTicket, _id: result.insertedId }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /tickets/:id - Actualizar
app.put('/tickets/:id', async (req, res) => {
    try {
        const { estado, prioridad } = req.body;
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        const db = client.db('helpdesk');
        
        const updateData = { fecha_actualizacion: new Date() };
        if (estado) updateData.estado = estado;
        if (prioridad) updateData.prioridad = prioridad;
        
        const result = await db.collection('tickets').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updateData }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
        
        res.json({ success: true, message: 'Ticket actualizado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /tickets/:id - Eliminar
app.delete('/tickets/:id', async (req, res) => {
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        const db = client.db('helpdesk');
        
        const result = await db.collection('tickets').deleteOne({ _id: new ObjectId(req.params.id) });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        }
        
        res.json({ success: true, message: 'Ticket eliminado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = app;