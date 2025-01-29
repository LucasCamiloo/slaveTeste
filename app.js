import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import config from './config/config.js';
import fs from 'fs';
// Only import what we need
import { Screen, Product, File } from './models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = config.port;
const baseUrl = config.baseUrl;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MASTER_URL = process.env.MASTER_URL || 'https://master-teste.vercel.app';
const SLAVE_URL = process.env.SLAVE_URL || 'https://slave-teste.vercel.app';

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// Add new schema for screen data
const screenDataSchema = new mongoose.Schema({
    screenId: String,
    pin: String,
    registered: Boolean,
    content: mongoose.Schema.Types.Mixed,
    masterUrl: String,
    lastUpdate: Date
});

const ScreenData = mongoose.model('ScreenData', screenDataSchema);

// Replace file-based ScreenManager with MongoDB-based one
const ScreenManager = {
    data: null,
    initialized: false,

    async initialize() {
        if (this.initialized && this.data) {
            return this.data;
        }

        try {
            // Try to load existing data from MongoDB first
            let screenData = await ScreenData.findOne();

            if (!screenData) {
                // Generate new screen data if none exists
                screenData = await ScreenData.create({
                    screenId: generateRandomString(8),
                    pin: generateRandomString(4).toUpperCase(),
                    registered: false,
                    content: null,
                    lastUpdate: new Date()
                });
                console.log('✨ Created new screen:', screenData);
            }

            this.data = screenData.toObject();
            this.initialized = true;
            return this.data;
        } catch (error) {
            console.error('❌ Error initializing screen data:', error);
            throw error;
        }
    },

    async resetRegistration() {
        try {
            if (!this.data) return;

            await ScreenData.findOneAndUpdate(
                { screenId: this.data.screenId },
                {
                    registered: false,
                    masterUrl: null,
                    content: null,
                    lastUpdate: new Date()
                }
            );

            this.data.registered = false;
            this.data.masterUrl = null;
            this.data.content = null;
            this.data.lastUpdate = new Date();

            console.log('🔄 Registration reset:', this.data);
        } catch (error) {
            console.error('❌ Error resetting registration:', error);
            throw error;
        }
    },

    async updateRegistrationStatus(registered, masterUrl) {
        try {
            if (!this.data) return;

            const updateData = {
                registered,
                masterUrl,
                lastUpdate: new Date()
            };

            // Update in MongoDB
            await ScreenData.findOneAndUpdate(
                { screenId: this.data.screenId },
                updateData,
                { upsert: true }
            );

            // Update local cache
            Object.assign(this.data, updateData);
            console.log('🔄 Status updated:', this.data);
        } catch (error) {
            console.error('❌ Error updating status:', error);
            throw error;
        }
    },

    async updateContent(content) {
        try {
            if (!this.data) return;

            // Update in MongoDB
            await ScreenData.findOneAndUpdate(
                { screenId: this.data.screenId },
                { 
                    content,
                    lastUpdate: new Date()
                }
            );

            // Update local cache
            this.data.content = content;
            this.data.lastUpdate = new Date();
        } catch (error) {
            console.error('❌ Error updating content:', error);
            throw error;
        }
    },

    async getData() {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.data;
    }
};

// Rotas simplificadas que não dependem do banco
async function startServer() {
    try {
        // Conectar ao banco apenas para leitura de conteúdo
        await connectDB();
        console.log('📦 Database connected (read-only)');
        
        // Inicializar dados da tela em memória
        await ScreenManager.initialize();
        console.log('🚀 Server initialization complete');

        // Screen data endpoint
        app.get('/screen-data', async (req, res) => {
            try {
                const data = await ScreenManager.getData();
                console.log('📱 Enviando dados da tela:', data);
                res.json(data);
            } catch (error) {
                console.error('❌ Erro ao obter dados da tela:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Update the screen-data endpoint
        app.get('/screen-data', (req, res) => {
            const data = loadScreenData();
            res.json(data);
        });

        // Connection status endpoint
        app.get('/connection-status', async (req, res) => {
            try {
                const data = await ScreenManager.getData();
                console.log('📡 Enviando status:', data);
                res.json({
                    registered: data.registered,
                    screenId: data.screenId,
                    masterUrl: data.masterUrl,
                    lastUpdate: data.lastUpdate
                });
            } catch (error) {
                console.error('❌ Erro ao obter status:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Registro - apenas atualiza status em memória
        app.post('/register', async (req, res) => {
            try {
                const { pin, screenId, masterUrl } = req.body;
                console.log('📝 Recebendo registro:', { pin, screenId, masterUrl });

                if (!pin || !screenId || !masterUrl) {
                    console.error('❌ Dados inválidos:', { pin, screenId, masterUrl });
                    return res.status(400).json({
                        success: false,
                        message: 'Missing required fields'
                    });
                }

                const data = await ScreenManager.getData();
                console.log('📝 Dados atuais:', data);
                
                if (pin !== data.pin || screenId !== data.screenId) {
                    console.error('❌ Credenciais inválidas:', { 
                        expected: { pin: data.pin, screenId: data.screenId },
                        received: { pin, screenId }
                    });
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid credentials'
                    });
                }

                // Update registration status
                await ScreenManager.updateRegistrationStatus(true, masterUrl);
                const updatedData = await ScreenManager.getData();
                console.log('✅ Tela registrada:', updatedData);

                // Save to file for persistence
                try {
                    fs.writeFileSync('screenData.json', JSON.stringify({
                        ...updatedData,
                        registered: true,
                        masterUrl
                    }));
                } catch (err) {
                    console.error('❌ Erro ao salvar dados:', err);
                    // Continue even if save fails
                }

                res.json({ 
                    success: true, 
                    message: 'Registration successful',
                    screenId: screenId,
                    registered: true,
                    masterUrl: masterUrl
                });

            } catch (error) {
                console.error('❌ Erro no registro:', error);
                res.status(500).json({ 
                    success: false, 
                    message: error.message || 'Internal server error'
                });
            }
        });

        // Adicionar função para notificar clientes SSE
        function notifyClients(data) {
            const eventData = `data: ${JSON.stringify(data)}\n\n`;
            [...clients].forEach(client => {
                try {
                    client.write(eventData);
                } catch (err) {
                    console.error('Erro ao notificar cliente:', err);
                }
            });
        }

        // Unregister - apenas atualiza status em memória
        app.post('/unregister', async (req, res) => {
            try {
                const { screenId } = req.body;
                const data = await ScreenManager.getData();

                if (screenId !== data.screenId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Invalid screen ID' 
                    });
                }

                await ScreenManager.resetRegistration();
                console.log('📤 Screen unregistered successfully');
                res.json({ success: true });
            } catch (error) {
                console.error('❌ Unregister error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Content endpoints - apenas leitura do banco
        app.get('/content', async (req, res) => {
            try {
                const data = ScreenManager.getData();
                res.json({
                    content: data.content,
                    lastUpdate: data.lastUpdate
                });
            } catch (error) {
                console.error('Content fetch error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // SSE endpoint com reconexão resiliente
        app.get('/events', (req, res) => {
            try {
                const data = ScreenManager.getData();
                
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('Access-Control-Allow-Origin', '*');
                
                // Enviar estado inicial mais detalhado
                const initialState = {
                    type: 'connected',
                    registered: data.registered,
                    screenId: data.screenId,
                    pin: data.pin,
                    masterUrl: data.masterUrl,
                    lastUpdate: data.lastUpdate
                };
                
                res.write(`data: ${JSON.stringify(initialState)}\n\n`);
                
                const keepAlive = setInterval(() => {
                    res.write(':keepalive\n\n');
                }, 20000);

                req.on('close', () => clearInterval(keepAlive));
            } catch (error) {
                console.error('SSE error:', error);
                res.status(500).end();
            }
        });

        // Atualizar a rota POST de conteúdo
        app.post('/content', async (req, res) => {
            try {
                const { content, screenId } = req.body;
                const data = await ScreenManager.getData();

                console.log('Received content update:', {
                    forScreen: screenId,
                    thisScreen: data.screenId,
                    contentLength: content ? content.length : 0
                });

                // Only update if content is for this screen or no screenId specified (broadcast)
                if (!screenId || screenId === data.screenId) {
                    await ScreenManager.updateContent(content);
                    console.log('Content updated successfully');
                    res.json({ success: true });
                } else {
                    console.log('Ignoring content for different screen');
                    res.json({ 
                        success: true, 
                        message: 'Content ignored - wrong screen' 
                    });
                }
            } catch (error) {
                console.error('Error updating content:', error);
                res.status(500).json({ 
                    success: false, 
                    message: error.message 
                });
            }
        });

        app.post('/scheduled-content', (req, res) => {
            const { content, scheduleTime } = req.body;
            if (content && scheduleTime) {
                setTimeout(() => {
                    screenData.content = content;
                    screenData.lastUpdate = Date.now();
                    console.log('Conteúdo agendado atualizado:', content);
                }, new Date(scheduleTime) - new Date());
                res.json({ success: true, message: 'Conteúdo agendado com sucesso!' });
            } else {
                res.status(400).json({ success: false, message: 'Conteúdo ou horário de agendamento ausente' });
            }
        });

        // Atualizar a rota de conteúdo para usar o banco de dados
        app.get('/content', async (req, res) => {
            try {
                const screen = await getScreenData();
                if (screen?.content) {
                    return res.json({ 
                        content: screen.content,
                        lastUpdate: screen.lastUpdate || Date.now()
                    });
                }
                
                res.json({ 
                    content: screenData.content,
                    lastUpdate: screenData.lastUpdate
                });
            } catch (error) {
                console.error('Erro ao buscar conteúdo:', error);
                res.json({ 
                    content: screenData.content,
                    lastUpdate: screenData.lastUpdate
                });
            }
        });

        app.get('/api/products', async (req, res) => {
            try {
                const products = await Product.find({});
                const productsWithFiles = await Promise.all(products.map(async (product) => {
                    if (product.fileId) {
                        const file = await File.findById(product.fileId);
                        return {
                            ...product.toObject(),
                            imageUrl: file ? `/files/${file._id}` : `${MASTER_URL}/default-product.png`
                        };
                    }
                    return product.toObject();
                }));
                res.json({ success: true, products: productsWithFiles });
            } catch (error) {
                console.error('Erro ao buscar produtos:', error);
                res.status(500).json({ success: false, message: error.message });
            }
        });

        app.get('/api/products/:id', async (req, res) => {
            try {
                const product = await Product.findOne({ id: req.params.id });
                if (product) {
                    const file = product.fileId ? await File.findById(product.fileId) : null;
                    res.json({ 
                        success: true, 
                        product: {
                            ...product.toObject(),
                            imageUrl: file ? `/files/${file._id}` : `${MASTER_URL}/default-product.png`
                        }
                    });
                } else {
                    res.status(404).json({ success: false, message: 'Produto não encontrado' });
                }
            } catch (error) {
                res.status(500).json({ success: false, message: error.message });
            }
        });

        // Adicionar rota para servir arquivos do GridFS
        app.get('/files/:fileId', async (req, res) => {
            try {
                const file = await File.findById(req.params.fileId);
                if (!file) {
                    return res.status(404).json({ success: false, message: 'File not found' });
                }

                // Use GridFS para buscar o arquivo
                const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db);
                const downloadStream = bucket.openDownloadStream(file.fileId);

                res.setHeader('Content-Type', file.contentType);
                downloadStream.pipe(res);
            } catch (error) {
                console.error('File retrieval error:', error);
                res.status(500).json({ success: false, message: error.message });
            }
        });

        app.put('/update-name', (req, res) => {
            const { name, screenId, registered, masterUrl } = req.body;
            if (!name) {
                return res.status(400).json({ success: false, message: 'Name is required' });
            }
            
            // Manter o estado de registro ao atualizar o nome
            screenData.screenName = name;
            screenData.registered = registered;
            screenData.masterUrl = masterUrl;
            
            return res.json({ 
                success: true, 
                message: 'Name updated on slave',
                registered: screenData.registered
            });
        });

        // Atualizar rota de status
        app.get('/status', async (req, res) => {
            try {
                const data = await ScreenManager.getData();
                if (!data.registered) {
                    return res.json({ operational: false });
                }

                // Check registration with master
                try {
                    const response = await fetch(`${data.masterUrl}/screens`);
                    const masterData = await response.json();
                    const isRegistered = masterData.screens?.some(
                        screen => screen.id === data.screenId && screen.registered
                    );

                    if (!isRegistered) {
                        console.log('❌ Screen not found in master, resetting registration');
                        await ScreenManager.resetRegistration();
                        return res.json({ operational: false });
                    }

                    return res.json({ operational: true });
                } catch (error) {
                    console.error('❌ Error checking master status:', error);
                    return res.json({ operational: false });
                }
            } catch (error) {
                console.error('❌ Status check error:', error);
                res.json({ operational: false });
            }
        });

        // Add new endpoint for generating credentials
        app.post('/generate-credentials', async (req, res) => {
            try {
                // Generate new screen data
                const screenData = {
                    screenId: generateRandomString(8),
                    pin: generateRandomString(4).toUpperCase(),
                    registered: false,
                    content: null,
                    lastUpdate: new Date()
                };

                // Save to database
                const newScreen = await ScreenData.create(screenData);
                console.log('✨ New screen credentials generated:', screenData);

                res.json({
                    success: true,
                    deviceId: screenData.screenId,
                    ...screenData
                });
            } catch (error) {
                console.error('Error generating credentials:', error);
                res.status(500).json({
                    success: false,
                    message: error.message
                });
            }
        });

        // Update screen-data endpoint to use deviceId
        app.get('/screen-data', async (req, res) => {
            try {
                const deviceId = req.query.deviceId;
                if (!deviceId) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Device ID required' 
                    });
                }

                // Find or create screen data for this device
                let screenData = await ScreenData.findOne({ screenId: deviceId });
                
                if (!screenData) {
                    // Generate new credentials if none exist
                    screenData = await ScreenData.create({
                        screenId: generateRandomString(8),
                        pin: generateRandomString(4).toUpperCase(),
                        registered: false,
                        content: null,
                        lastUpdate: new Date()
                    });
                }

                console.log('📱 Sending screen data:', screenData);
                res.json(screenData);
            } catch (error) {
                console.error('Error fetching screen data:', error);
                res.status(500).json({ 
                    success: false, 
                    message: error.message 
                });
            }
        });

        // Add error handling middleware
        app.use((err, req, res, next) => {
            console.error('Error:', err);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        });

        if (process.env.VERCEL) {
            // When running on Vercel, just export the app
            return app;
        } else {
            // For local development, create and start the server
            const server = express()
                .use(app)
                .listen(port, () => {
                    console.log(`Slave running on ${baseUrl}`);
                });

            server.on('error', (err) => {
                console.error('Server error:', err);
                process.exit(1);
            });
        }
    } catch (error) {
        console.error('Erro ao iniciar servidor:', error);
        process.exit(1);
    }
}

// Export the app for Vercel
export default startServer();
