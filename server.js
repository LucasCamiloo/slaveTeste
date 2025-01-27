const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const path = require('path');
const fs = require('fs');
const clients = new Map();

// Estado global para registros
let registrationState = {
    registered: false,
    masterUrl: null,
    screenId: null,
    pin: null,
    lastUpdate: null
};

// Configuração básica
app.use(express.json());
app.use(express.static('public'));

// CORS middleware
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Criação do servidor HTTP e WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Função para enviar mensagens a todos os clientes conectados
function broadcastMessage(data) {
    const message = JSON.stringify(data);
    clients.forEach((ws, id) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        } else {
            clients.delete(id);
        }
    });
}

// Configuração do WebSocket
wss.on('connection', (ws) => {
    const clientId = Date.now();
    clients.set(clientId, ws);

    // Enviar estado inicial
    const initialData = {
        type: 'connected',
        ...registrationState,
        timestamp: Date.now()
    };
    ws.send(JSON.stringify(initialData));

    ws.on('close', () => {
        clients.delete(clientId);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(clientId);
    });
});

// Modificar o endpoint de atualização de registro
app.post('/update-registration', (req, res) => {
    const registrationData = req.body;
    console.log('Recebido update de registro:', registrationData);
    
    registrationState = {
        ...registrationState,
        ...registrationData,
        lastUpdate: Date.now()
    };
    
    // Salvar o novo estado
    saveState();
    
    // Notificar todos os clientes
    const updateMessage = {
        type: 'registration',
        ...registrationState
    };
    
    broadcastMessage(updateMessage);
    
    res.json({ success: true, state: registrationState });
});

// Adicione este endpoint para dados da tela
app.get('/screen-data', (req, res) => {
    // Gere um ID único para a tela se não existir
    const screenId = process.env.SCREEN_ID || `screen_${Date.now()}`;
    const pin = process.env.PIN || Math.floor(1000 + Math.random() * 9000).toString();
    
    res.json({
        screenId: screenId,
        pin: pin,
        registered: false // Inicialmente não registrado
    });
});

// Atualizar endpoint de status
app.get('/connection-status', (req, res) => {
    res.json({
        registered: registrationState.registered,
        masterUrl: registrationState.masterUrl,
        screenId: registrationState.screenId,
        lastUpdate: registrationState.lastUpdate
    });
});

// Adicione este endpoint para conteúdo
app.get('/content', (req, res) => {
    res.json({
        content: [] // Inicialmente vazio, será atualizado quando receber conteúdo do master
    });
});

const PORT = process.env.PORT || 3000;

// Garantir que o servidor está escutando
server.listen(PORT, () => {
    console.log(`Slave server running on port ${PORT}`);
});

// Tratamento de erros do servidor
server.on('error', (error) => {
    console.error('Server error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
