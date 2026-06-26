const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'API funcionando' });
});

// Tickets
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

app.post('/tickets', async (req, res) => {
    try {
        const { titulo, descripcion, prioridad, email_usuario } = req.body;
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        const db = client.db('helpdesk');
        const result = await db.collection('tickets').insertOne({
            titulo,
            descripcion,
            prioridad: prioridad || 'normal',
            email_usuario,
            estado: 'abierto',
            fecha_creacion: new Date()
        });
        res.status(201).json({ success: true, id: result.insertedId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = app;