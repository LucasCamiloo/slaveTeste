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
            if (!this.data) {
                await this.initialize();
            }

            // Ensure content is always stored as array
            const contentToStore = Array.isArray(content) ? content : [content];

            // Update in MongoDB
            await ScreenData.findOneAndUpdate(
                { screenId: this.data.screenId },
                { 
                    content: contentToStore,
                    lastUpdate: new Date()
                }
            );

            // Update local cache
            this.data.content = contentToStore;
            this.data.lastUpdate = new Date();

            console.log('Content updated:', {
                type: typeof contentToStore,
                isArray: Array.isArray(contentToStore),
                length: contentToStore.length
            });
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
                // Try to find existing screen data or create new one
                let screenData = await ScreenData.findOne();
                
                if (!screenData) {
                    screenData = await ScreenData.create({
                        screenId: generateRandomString(8),
                        pin: generateRandomString(4).toUpperCase(),
                        registered: false,
                        content: null,
                        lastUpdate: new Date()
                    });
                    console.log('✨ Generated new screen data:', screenData);
                }

                // Return only necessary data
                const responseData = {
                    screenId: screenData.screenId,
                    pin: screenData.pin,
                    registered: screenData.registered,
                    lastUpdate: screenData.lastUpdate
                };

                console.log('📤 Sending screen data:', responseData);
                res.json(responseData);
            } catch (error) {
                console.error('❌ Error handling screen data request:', error);
                res.status(500).json({
                    success: false,
                    message: error.message
                });
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
        app.post('/register', async (req, res) => {
            try {
                const { pin, screenId, masterUrl } = req.body;
                console.log('📝 Receiving registration:', { pin, screenId, masterUrl });

                if (!pin || !screenId || !masterUrl) {
                    return res.status(400).json({
                        success: false,
                        message: 'Missing required fields'
                    });
                }

                // Find or update screen data
                let screenData = await ScreenData.findOne({ screenId });
                
                if (!screenData) {
                    return res.status(404).json({
                        success: false,
                        message: 'Screen not found'
                    });
                }

                if (screenData.pin !== pin) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid PIN'
                    });
                }

                // Update registration status
                screenData.registered = true;
                screenData.masterUrl = masterUrl;
                screenData.lastUpdate = new Date();
                await screenData.save();

                console.log('✅ Screen registered successfully:', {
                    screenId,
                    masterUrl,
                    registered: true
                });

                res.json({
                    success: true,
                    message: 'Registration successful',
                    screenId,
                    registered: true
                });

            } catch (error) {
                console.error('❌ Registration error:', error);
                res.status(500).json({
                    success: false,
                    message: error.message
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
                const data = await ScreenManager.getData();
                console.log('Raw data from ScreenManager:', data);
                
                // Ensure we have a valid response structure with content
                let contentToSend = data.content;

                // If we have content, ensure it's an array
                if (contentToSend) {
                    contentToSend = Array.isArray(contentToSend) ? contentToSend : [contentToSend];
                    console.log('Formatted content:', {
                        type: typeof contentToSend,
                        isArray: Array.isArray(contentToSend),
                        length: contentToSend.length,
                        sample: contentToSend[0]?.substring(0, 100)
                    });
                }

                const response = {
                    success: true,
                    content: contentToSend || null,
                    lastUpdate: data.lastUpdate || new Date()
                };

                console.log('Sending response:', response);
                res.json(response);
            } catch (error) {
                console.error('Content fetch error:', error);
                res.status(500).json({ 
                    success: false, 
                    message: error.message,
                    content: null 
                });
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

        // Update screen-data endpoint to generate new credentials on first request
        app.get('/screen-data', async (req, res) => {
            try {
                let screenData = await ScreenData.findOne();
                
                // Always generate new credentials if none exist
                if (!screenData) {
                    screenData = await ScreenData.create({
                        screenId: generateRandomString(8),
                        pin: generateRandomString(4).toUpperCase(),
                        registered: false,
                        content: null,
                        lastUpdate: new Date()
                    });
                    console.log('✨ Generated new screen data:', screenData);
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

app.post('/content', async (req, res) => {
    try {
        const { content, screenId, replaceExisting } = req.body;
        const data = await ScreenManager.getData();

        console.log('Received content update:', {
            forScreen: screenId,
            thisScreen: data.screenId,
            replaceExisting: !!replaceExisting,
            contentLength: content ? (Array.isArray(content) ? content.length : 1) : 0
        });

        // Only update if content is for this screen or no screenId specified
        if (!screenId || screenId === data.screenId) {
            // Always replace content instead of appending
            const contentArray = Array.isArray(content) ? content : [content];
            await ScreenManager.updateContent(contentArray);
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

// Update screen data endpoint to generate new credentials per device
app.get('/screen-data', async (req, res) => {
    try {
        const deviceId = req.headers['x-device-id'];
        
        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID is required'
            });
        }

        // Try to find existing screen data for this device
        let screenData = await ScreenData.findOne({ deviceId });

        // If no existing data, generate new credentials
        if (!screenData) {
            screenData = await ScreenData.create({
                deviceId,
                screenId: generateRandomString(8),
                pin: generateRandomString(4).toUpperCase(),
                registered: false,
                content: null,
                lastUpdate: new Date()
            });
            console.log('✨ Generated new screen credentials for device:', deviceId);
        }

        res.json(screenData);
    } catch (error) {
        console.error('Error fetching screen data:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Update content endpoint to handle device-specific content
app.post('/content', async (req, res) => {
    try {
        const { content, screenId } = req.body;
        const deviceId = req.headers['x-device-id'];
        const screenData = await ScreenData.findOne({ 
            deviceId,
            screenId
        });

        if (!screenData) {
            return res.status(404).json({
                success: false,
                message: 'Screen not found for this device'
            });
        }

        // Update content for this specific screen
        await ScreenData.findOneAndUpdate(
            { deviceId, screenId },
            { 
                content: Array.isArray(content) ? content : [content],
                lastUpdate: new Date()
            }
        );

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Update the screen data endpoint to handle both device ID and direct requests
app.get('/screen-data', async (req, res) => {
    try {
        // Get device ID from headers or query params
        const deviceId = req.headers['x-device-id'] || req.query.deviceId;
        
        // First try to get existing screen data
        let screenData;
        
        if (deviceId) {
            screenData = await ScreenData.findOne({ deviceId });
        } else {
            // If no device ID, try to get any existing screen data
            screenData = await ScreenData.findOne();
        }

        // If no screen data exists, create new one
        if (!screenData) {
            screenData = await ScreenData.create({
                deviceId: deviceId || generateRandomString(12),
                screenId: generateRandomString(8),
                pin: generateRandomString(4).toUpperCase(),
                registered: false,
                content: null,
                lastUpdate: new Date()
            });
            console.log('✨ Created new screen data:', screenData);
        }

        // Remove MongoDB-specific fields before sending
        const responseData = {
            screenId: screenData.screenId,
            pin: screenData.pin,
            registered: screenData.registered,
            content: screenData.content,
            lastUpdate: screenData.lastUpdate
        };

        console.log('📱 Sending screen data:', responseData);
        res.json(responseData);
    } catch (error) {
        console.error('Error fetching screen data:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Update registration endpoint
app.post('/register', async (req, res) => {
    try {
        const { pin, screenId, masterUrl } = req.body;
        console.log('📝 Receiving registration:', { pin, screenId, masterUrl });

        if (!pin || !screenId || !masterUrl) {
            console.error('❌ Invalid data:', { pin, screenId, masterUrl });
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Find screen data by screenId
        const screenData = await ScreenData.findOne({ screenId });
        
        if (!screenData) {
            console.error('❌ Screen not found:', screenId);
            return res.status(404).json({
                success: false,
                message: 'Screen not found'
            });
        }

        if (screenData.pin !== pin) {
            console.error('❌ Invalid PIN');
            return res.status(400).json({
                success: false,
                message: 'Invalid PIN'
            });
        }

        // Update registration status
        screenData.registered = true;
        screenData.masterUrl = masterUrl;
        screenData.lastUpdate = new Date();
        await screenData.save();

        console.log('✅ Screen registered successfully:', screenData);

        res.json({
            success: true,
            message: 'Registration successful',
            screenId: screenId,
            registered: true,
            masterUrl: masterUrl
        });

    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error'
        });
    }
});

// Update the screen-data endpoint to handle requests without device ID
app.get('/screen-data', async (req, res) => {
    try {
        // Get device ID from headers, query params, or generate a new one
        const deviceId = req.headers['x-device-id'] || 
                        req.query.deviceId || 
                        `temp_${Date.now()}_${Math.random().toString(36).substring(2)}`;
        
        console.log('📱 Receiving screen data request for device:', deviceId);

        // Try to find existing screen data for this device
        let screenData = await ScreenData.findOne({ deviceId });

        // If no existing data, generate new credentials
        if (!screenData) {
            screenData = await ScreenData.create({
                deviceId,
                screenId: generateRandomString(8),
                pin: generateRandomString(4).toUpperCase(),
                registered: false,
                content: null,
                lastUpdate: new Date()
            });
            console.log('✨ Generated new screen data:', {
                deviceId,
                screenId: screenData.screenId,
                pin: screenData.pin
            });
        }

        // Prepare response data (excluding internal fields)
        const responseData = {
            screenId: screenData.screenId,
            pin: screenData.pin,
            registered: screenData.registered,
            lastUpdate: screenData.lastUpdate
        };

        console.log('📤 Sending screen data:', responseData);
        res.json(responseData);
    } catch (error) {
        console.error('❌ Error handling screen data request:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});
