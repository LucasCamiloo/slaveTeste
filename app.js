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

// Singleton para gerenciar dados da tela em memória
const ScreenManager = {
    data: null,
    initialized: false,

    async initialize() {
        if (this.initialized) return this.data;

        try {
            console.log('🔄 Gerando dados da tela...');
            this.data = {
                pin: generateRandomString(4).toUpperCase(),
                screenId: generateRandomString(8),
                registered: false,
                content: null,
                lastUpdate: Date.now(),
                masterUrl: null
            };

            this.initialized = true;
            console.log('✅ Dados da tela:', this.data);
            return this.data;
        } catch (error) {
            console.error('❌ Erro ao inicializar dados:', error);
            throw error;
        }
    },

    // Only update local data when confirmed by master
    async updateRegistrationStatus(registered, masterUrl) {
        if (!this.data) return;
        this.data.registered = registered;
        this.data.masterUrl = masterUrl;
        this.data.lastUpdate = Date.now();
        console.log('🔄 Status atualizado:', this.data);
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
        app.post('/register', (req, res) => {
            try {
                const { pin, screenId, masterUrl } = req.body;
                console.log('📝 Recebendo registro:', { pin, screenId, masterUrl });

                const data = ScreenManager.getData();
                console.log('📝 Dados atuais:', data);
                
                if (pin !== data.pin || screenId !== data.screenId) {
                    console.error('❌ Dados inválidos:', { expected: data, received: { pin, screenId } });
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid credentials'
                    });
                }

                // Atualizar status de registro
                ScreenManager.updateRegistrationStatus(true, masterUrl);
                console.log('✅ Tela registrada:', ScreenManager.getData());

                // Notificar clientes SSE sobre a mudança
                const sseData = {
                    type: 'screen_update',
                    screenId: screenId,
                    registered: true,
                    masterUrl: masterUrl,
                    action: 'registration'
                };

                try {
                    notifyClients(sseData);
                    console.log('✅ Clientes SSE notificados');
                } catch (err) {
                    console.error('❌ Erro ao notificar clientes:', err);
                }

                // Enviar resposta de sucesso
                res.json({ 
                    success: true, 
                    message: 'Registration successful',
                    screenId: screenId,
                    registered: true,
                    masterUrl: masterUrl
                });

            } catch (error) {
                console.error('❌ Erro no registro:', error);
                res.status(500).json({ error: 'Internal server error' });
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
        app.post('/unregister', (req, res) => {
            try {
                const { screenId } = req.body;
                const data = ScreenManager.getData();

                if (screenId !== data.screenId) {
                    return res.status(400).json({ success: false, message: 'Invalid screen ID' });
                }

                ScreenManager.updateRegistrationStatus(false, null);
                ScreenManager.updateContent(null);
                res.json({ success: true });
            } catch (error) {
                console.error('Unregister error:', error);
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

                // Garantir que o conteúdo seja apenas para esta tela específica
                if (screenId !== screenData.screenId) {
                    console.log(`Ignorando conteúdo destinado à tela ${screenId} (esta tela é ${screenData.screenId})`);
                    return res.json({ 
                        success: true, 
                        message: 'Content ignored - wrong screen' 
                    });
                }

                if (content) {
                    // Atualizar conteúdo apenas se for para esta tela
                    screenData.content = content;
                    screenData.lastUpdate = Date.now();

                    // Atualizar banco de dados
                    await Screen.findOneAndUpdate(
                        { id: screenData.screenId },
                        { 
                            content: content,
                            lastUpdate: Date.now()
                        },
                        { new: true, upsert: true }
                    );

                    console.log(`Conteúdo atualizado para tela ${screenData.screenId}`);
                }
                
                res.json({ success: true });
            } catch (error) {
                console.error('Error updating content:', error);
                res.status(500).json({ 
                    success: false, 
                    message: 'Error updating content',
                    error: error.message
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
                const screen = await Screen.findOne({ id: screenData.screenId })
                    .select('registered')
                    .lean();
                res.json({
                    operational: screen?.registered || screenData.registered
                });
            } catch (error) {
                console.error('Erro ao verificar status:', error);
                res.json({
                    operational: screenData.registered
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
