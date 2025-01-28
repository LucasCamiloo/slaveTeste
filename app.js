import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import config from './config/config.js';
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

// Modificar o cache para ter uma duração mais longa
const screenCache = {
    data: null,
    lastUpdate: 0,
    ttl: 3600000 // 1 hora
};

// Função para verificar e atualizar cache
async function getScreenData() {
    try {
        // Primeiro tentar usar dados em memória
        if (screenData?.pin && screenData?.screenId) {
            console.log('Usando dados em memória:', screenData);
            return screenData;
        }

        console.log('Buscando dados no banco...');
        
        // Fazer uma busca mais específica no banco
        const existingScreen = await Screen.findOne({})
            .sort({ _id: -1 })
            .select('pin id registered content lastUpdate masterUrl')
            .lean();

        console.log('Resultado da busca no banco:', existingScreen);

        if (existingScreen?.pin && existingScreen?.id) {
            screenData = {
                pin: existingScreen.pin,
                screenId: existingScreen.id,
                registered: existingScreen.registered || false,
                content: existingScreen.content || null,
                lastUpdate: existingScreen.lastUpdate || Date.now(),
                masterUrl: existingScreen.masterUrl || MASTER_URL
            };
            console.log('Dados recuperados do banco:', screenData);
            return screenData;
        }

        // If none found, generate on the slave
        console.log('Nenhum dado encontrado no banco, gerando PIN e ID na própria slave...');
        const newPin = generateRandomString(4).toUpperCase();
        const newScreenId = generateRandomString(8);

        const newRecord = await Screen.create({
            pin: newPin,
            id: newScreenId,
            registered: false,
            content: null,
            lastUpdate: new Date(),
            masterUrl: MASTER_URL
        });

        screenData = {
            pin: newPin,
            screenId: newScreenId,
            registered: false,
            content: null,
            lastUpdate: newRecord.lastUpdate,
            masterUrl: MASTER_URL
        };
        return screenData;
    } catch (error) {
        console.error('Erro ao buscar dados da tela:', error);
        return screenData || null;
    }
}

// Ensure initializeScreenData is called only once during server startup
let isInitialized = false;

// If no data is found, do nothing; master is responsible for creating screens
async function initializeScreenData() {
    if (isInitialized) {
        console.log('Screen data already initialized.');
        return screenData;
    }
    console.log('Iniciando inicialização dos dados...');
    screenData = await getScreenData(); 
    console.log('Dados obtidos ou gerados:', screenData);
    isInitialized = true;
    return screenData;
}

// Inicialização do app
async function startServer() {
    try {
        // Conectar ao banco de dados
        await connectDB();
        console.log('Banco de dados conectado');
        
        // Inicializar dados da tela apenas uma vez
        const initialData = await initializeScreenData();
        console.log('Dados inicializados:', initialData);

        // Configurar rotas
        app.get('/screen-data', async (req, res) => {
            try {
                // Usar apenas getScreenData para evitar reinicialização
                const data = await getScreenData();
                if (!data) {
                    throw new Error('Dados da tela não encontrados');
                }

                const responseData = {
                    pin: data.pin,
                    screenId: data.screenId,
                    registered: data.registered || false,
                    masterUrl: data.masterUrl || MASTER_URL
                };

                console.log('Enviando dados da tela:', responseData);
                res.json(responseData);
            } catch (error) {
                console.error('Erro ao enviar dados da tela:', error);
                res.status(500).json({
                    success: false,
                    message: 'Erro ao recuperar dados da tela'
                });
            }
        });

        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

        // Modificar a rota de registro para ser mais simples
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

                // Validar apenas com os dados locais
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

                // Atualizar dados locais
                screenData.registered = true;
                screenData.masterUrl = masterUrl;

                // Atualizar banco de dados
                await Screen.findOneAndUpdate(
                    { id: screenId },
                    { 
                        registered: true, 
                        masterUrl: masterUrl,
                        lastUpdate: new Date()
                    },
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

        // Atualizar rota de unregister para manter os mesmos códigos
        app.post('/unregister', async (req, res) => {
            const { screenId } = req.body;
            
            try {
                if (screenId === screenData.screenId) {
                    // Manter os mesmos códigos, apenas atualizar o status
                    screenData.registered = false;
                    screenData.masterUrl = null;
                    screenData.content = null;

                    // Atualizar no banco de dados mantendo os mesmos códigos
                    await Screen.findOneAndUpdate(
                        { id: screenId },
                        {
                            registered: false,
                            masterUrl: null,
                            content: null,
                            lastUpdate: new Date()
                        }
                    );
                    
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

        // Modificar a rota /connection-status para não reinicializar
        app.get('/connection-status', async (req, res) => {
            try {
                const data = await getScreenData();
                if (!data) {
                    throw new Error('Dados da tela não encontrados');
                }

                res.json({
                    registered: data.registered,
                    screenId: data.screenId,
                    masterUrl: data.masterUrl,
                    lastUpdate: data.lastUpdate
                });
            } catch (error) {
                console.error('Erro ao verificar status:', error);
                res.status(500).json({
                    success: false,
                    message: 'Erro ao verificar status'
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
