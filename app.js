import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import config from './config/config.js';
import qrcode from 'qrcode'; // Adicionar importação do qrcode
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

// Mover a definição de screenData para após a conexão com o banco
let screenData;

// Adicionar cache em memória para dados frequentes
const screenCache = {
    data: null,
    lastUpdate: 0,
    ttl: 5000 // 5 segundos
};

// Função para verificar e atualizar cache
async function getScreenData() {
    const now = Date.now();
    if (screenCache.data && (now - screenCache.lastUpdate) < screenCache.ttl) {
        return screenCache.data;
    }

    const screen = await Screen.findOne({ id: screenData.screenId })
        .select('content registered masterUrl lastUpdate')
        .lean();
    
    screenCache.data = screen;
    screenCache.lastUpdate = now;
    return screen;
}

// Inicializar dados da tela
// Only initialize if not already exists in database
async function initializeScreenData() {
    try {
        // Verificar se já existem dados da tela no banco de dados
        const existingScreen = await Screen.findOne({});
        if (existingScreen) {
            screenData = existingScreen;
            console.log('Dados da tela carregados do banco de dados:', screenData);
        } else {
            // Gerar novos dados da tela
            screenData = {
                pin: generateRandomString(4),
                screenId: generateRandomString(8),
                registered: false,
                content: null,
                lastUpdate: Date.now(),
                masterUrl: null
            };

            // Salvar os novos dados no banco de dados
            await Screen.create(screenData);
            console.log('Novos dados da tela gerados e salvos no banco de dados:', screenData);
        }
    } catch (error) {
        console.error('Erro ao inicializar dados da tela:', error);
        throw error;
    }
}

// Inicialização do app
async function startServer() {
    try {
        // Conectar ao banco de dados
        await connectDB();
        console.log('Banco de dados conectado');
        
        // Inicializar dados da tela
        await initializeScreenData();
        console.log('Dados da tela inicializados');

        // Configurar rotas
        app.get('/screen-data', (req, res) => {
            res.json({
                pin: screenData.pin,
                screenId: screenData.screenId,
                registered: screenData.registered,
                masterUrl: MASTER_URL // Add masterUrl to response
            });
        });

        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        // Adicionar rota para gerar QR Code
        app.get('/generate-qr', (req, res) => {
            const { screenId, pin } = req.query;
            if (!screenId || !pin) {
                return res.status(400).send('Missing screenId or pin');
            }

            const qrCodeUrl = `${SLAVE_URL}/register?screenId=${screenId}&pin=${pin}`;
            qrcode.toDataURL(qrCodeUrl, (err, url) => {
                if (err) {
                    console.error('Error generating QR Code:', err);
                    return res.status(500).send('Error generating QR Code');
                }
                res.send(url);
            });
        });

        // Atualizar o endpoint SSE para incluir um evento inicial
        app.get('/events', (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.flushHeaders();

            // Enviar estado inicial
            const initialState = `data: ${JSON.stringify({
                type: 'connected',
                registered: screenData.registered,
                screenId: screenData.screenId,
                masterUrl: screenData.masterUrl
            })}\n\n`;
            
            res.write(initialState);

            // Keep connection alive
            const keepAlive = setInterval(() => {
                res.write(':keepalive\n\n');
            }, 20000);

            req.on('close', () => {
                clearInterval(keepAlive);
            });
        });

        // Atualizar rota de registro
        app.post('/register', async (req, res) => {
            try {
                const { pin, screenId, masterUrl } = req.body;
                
                console.log('Registration request received:', { pin, screenId, masterUrl });

                if (!pin || !screenId || !masterUrl) {
                    return res.status(400).json({
                        success: false,
                        message: 'Missing required fields'
                    });
                }

                // Validate credentials
                if (pin !== screenData.pin || screenId !== screenData.screenId) {
                    console.log('Invalid credentials:', {
                        expectedPin: screenData.pin,
                        receivedPin: pin,
                        expectedId: screenData.screenId,
                        receivedId: screenId
                    });
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid PIN or Screen ID'
                    });
                }

                // Atualizar dados da tela no banco de dados
                screenData.registered = true;
                screenData.masterUrl = masterUrl;
                await Screen.findOneAndUpdate(
                    { id: screenId },
                    { registered: true, masterUrl: masterUrl, lastUpdate: new Date() },
                    { new: true }
                );

                console.log('Registration successful:', screenData);
                return res.json({
                    success: true,
                    message: `Screen ${screenId} registered successfully!`
                });
            } catch (error) {
                console.error('Registration error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Internal server error'
                });
            }
        });

        // Update unregister endpoint
        app.post('/unregister', async (req, res) => {
            const { screenId } = req.body;
            
            try {
                if (screenId === screenData.screenId) {
                    // Clear data from database
                    await Screen.findOneAndDelete({ id: screenId });
                    
                    // Clear local data
                    screenData.registered = false;
                    screenData.masterUrl = null;
                    screenData.content = null;
                    
                    // Generate new credentials after unregistration
                    screenData.pin = generateRandomString(4);
                    screenData.screenId = generateRandomString(8);
                    
                    console.log(`Screen ${screenId} unregistered successfully`);
                    res.json({ 
                        success: true, 
                        message: `Screen ${screenId} unregistered successfully`
                    });
                } else {
                    res.status(400).json({ 
                        success: false, 
                        message: 'Invalid screen ID' 
                    });
                }
            } catch (error) {
                console.error('Error during unregister:', error);
                res.status(500).json({ 
                    success: false, 
                    message: 'Internal server error' 
                });
            }
        });

        // Atualizar a rota POST de conteúdo
        app.post('/content', async (req, res) => {
            try {
                const { content, screenId } = req.body;

                // Only update if the content is for this screen
                if (screenId && screenId !== screenData.screenId) {
                    console.log('Ignoring content for different screen:', screenId);
                    return res.json({ success: true }); // Return success but don't update
                }

                if (content) {
                    // Update memory
                    screenData.content = content;
                    screenData.lastUpdate = Date.now();

                    // Update database
                    const screen = await Screen.findOneAndUpdate(
                        { id: screenData.screenId },
                        { 
                            content: content,
                            lastUpdate: Date.now()
                        },
                        { new: true, upsert: true }
                    );

                    console.log('Content updated for screen:', screenData.screenId);
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

        // Update connection status check
        app.get('/connection-status', async (req, res) => {
            try {
                if (!screenData.registered) {
                    return res.json({
                        registered: false,
                        screenId: screenData.screenId,
                        masterUrl: null,
                        lastUpdate: screenData.lastUpdate
                    });
                }

                const screen = await Screen.findOne({ id: screenData.screenId });
                const isRegistered = screen && screen.registered;
                
                // If not found in database but marked as registered locally, clear registration
                if (!screen && screenData.registered) {
                    screenData.registered = false;
                    screenData.masterUrl = null;
                }

                res.json({
                    registered: isRegistered,
                    screenId: screenData.screenId,
                    masterUrl: screen?.masterUrl || screenData.masterUrl,
                    lastUpdate: screen?.lastUpdate || screenData.lastUpdate
                });
            } catch (error) {
                console.error('Error checking connection status:', error);
                res.json({
                    registered: screenData.registered,
                    screenId: screenData.screenId,
                    masterUrl: screenData.masterUrl,
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
