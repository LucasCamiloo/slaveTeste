const MASTER_URL = 'https://master-teste.vercel.app';
const SLAVE_URL = 'https://slave-teste.vercel.app';

let currentContent = null;
let currentIndex = 0;
let statusTimeout;
let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

let cachedScreenData = null;

// Add a persistent cache
const appState = {
    screenData: null,
    lastFetch: 0,
    cacheTTL: 30000, // 30 seconds
};

// Update the caching function
async function cacheScreenData() {
    try {
        if (appState.screenData && Date.now() - appState.lastFetch < appState.cacheTTL) {
            console.log('📦 Using cached data:', appState.screenData);
            return appState.screenData;
        }

        const response = await fetch('/screen-data');
        const data = await response.json();
        
        if (!data || !data.screenId) {
            throw new Error('Invalid screen data received');
        }

        appState.screenData = data;
        appState.lastFetch = Date.now();
        console.log('🔄 Cache updated:', appState.screenData);
        return data;
    } catch (error) {
        console.error('❌ Cache update failed:', error);
        return appState.screenData; // Return existing cache on error
    }
}

// Update getScreenData to use the cache
async function getScreenData() {
    return await cacheScreenData();
}

// Adicionar função para gerar ID de dispositivo único
function generateDeviceId() {
    const storedId = localStorage.getItem('deviceId');
    if (storedId) return storedId;
    
    const newId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('deviceId', newId);
    return newId;
}

// Remove any code that tries to register automatically if no pin or screenId is found
// Adicionar logs no initialize do frontend
async function initialize() {
    console.log('=== Inicializando Frontend ===');
    try {
        const screenData = await getScreenData();
        console.log('📱 Estado inicial:', screenData);

        // Store in appState
        appState.screenData = screenData;

        if (screenData.registered) {
            console.log('✅ Tela registrada, iniciando apresentação');
            showPresentationSection();
            startPresentation();
        } else {
            console.log('ℹ️ Tela não registrada, mostrando registro');
            showRegistrationSection(screenData);
        }

        initSSE();
    } catch (error) {
        console.error('❌ Erro na inicialização:', error);
        showConnectionError();
    }
}

// Update checkConnectionStatus to verify registration with master
async function checkConnectionStatus() {
    try {
        // Get local screen data first
        const screenData = await getScreenData();
        if (!screenData) {
            throw new Error('No screen data available');
        }

        // Check if this screen is registered with master
        const response = await fetch(`${MASTER_URL}/screens`);
        const { screens } = await response.json();
        
        // Find if this screen is registered in master's screen list
        const registeredScreen = screens.find(screen => 
            screen.id === screenData.screenId && 
            screen.registered === true
        );

        if (registeredScreen) {
            console.log('✅ Tela encontrada no master:', registeredScreen);
            showPresentationSection();
            updateConnectionStatus({
                registered: true,
                masterUrl: MASTER_URL
            });
        } else {
            console.log('ℹ️ Tela não registrada no master');
            showRegistrationSection(screenData);
        }
    } catch (error) {
        console.error('❌ Error checking status:', error);
        showConnectionError();
    }
}

// Modificar showRegistrationSection para garantir exibição dos dados
function showRegistrationSection(data) {
    console.log('Mostrando seção de registro com dados:', data);
    
    const registrationSection = document.getElementById('registrationSection');
    const presentationSection = document.getElementById('presentationSection');
    const pinSpan = document.getElementById('pin');
    const screenIdSpan = document.getElementById('screenId');

    // Garantir que temos dados válidos
    if (!data || !data.pin || !data.screenId) {
        console.error('Dados inválidos para registro:', data);
        return;
    }

    // Atualizar a interface
    registrationSection.classList.remove('hidden');
    presentationSection.classList.remove('visible');
    
    pinSpan.textContent = data.pin;
    screenIdSpan.textContent = data.screenId;
}

// Modify handleRegistrationUpdate to avoid changing PIN/ID
async function handleRegistrationUpdate(data) {
    console.log('🔄 Processando atualização de registro:', data);

    try {
        // Recarregar dados da tela para ter informações atualizadas
        await cacheScreenData();

        if (data.screenId && data.screenId !== cachedScreenData.screenId) {
            console.log('Ignorando atualização para outra tela');
            return;
        }

        if (data.registered) {
            console.log('✅ Tela registrada, atualizando interface');
            showPresentationSection();
            startPresentation();
            updateConnectionStatus({
                registered: true,
                masterUrl: data.masterUrl
            });
            
            if (data.content) {
                currentContent = Array.isArray(data.content) ? data.content : [data.content];
                currentIndex = 0;
                showSlide();
            }
        }
    } catch (error) {
        console.error('❌ Erro ao processar atualização:', error);
    }
}

function handleListContent(container) {
    if (window.listInterval) {
        clearInterval(window.listInterval);
    }

    const listItems = Array.from(container.querySelectorAll('.product-list-item'));
    let currentListIndex = 0;

    function rotateListItem() {
        listItems.forEach(item => item.classList.remove('active'));
        const currentItem = listItems[currentListIndex];
        currentItem.classList.add('active');
        
        let imageUrl = currentItem.dataset.imageUrl;
        if (imageUrl) {
            // Usar apenas URLs do GridFS
            if (!imageUrl.startsWith('/files/')) {
                console.error('URL inválida:', imageUrl);
                console.error('URL inválida:', imageUrl);
                imageUrl = '/files/default-product';
            }
            if (!imageUrl.startsWith('http')) {
                imageUrl = `http://localhost:4000${imageUrl}`;
            }
        }
        
        const featuredImage = container.querySelector('.featured-image');
        const featuredName = container.querySelector('.featured-name');
        const featuredPrice = container.querySelector('.featured-price');

        if (featuredImage) {
            featuredImage.src = imageUrl;
            featuredImage.onerror = () => {
                console.error('Erro ao carregar imagem:', imageUrl);
                featuredImage.src = 'http://localhost:4000/files/default-product.png';
            };
        }
        
        // ...rest of existing code...
    }

    rotateListItem();
}

// Update SSE handling to properly handle registration events
function initSSE() {
    console.log('🔄 Iniciando SSE...');
    if (eventSource) {
        console.log('Fechando conexão SSE existente');
        eventSource.close();
    }

    try {
        eventSource = new EventSource(`${MASTER_URL}/events`);

        eventSource.onopen = () => {
            console.log('✅ SSE conectado ao master');
            reconnectAttempts = 0;
            checkConnectionStatus();
        };

        eventSource.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('📨 Mensagem SSE recebida:', data);

                const screenData = await getScreenData();
                
                // Only process messages for this screen
                if (data.screenId === screenData.screenId) {
                    console.log('✨ Processando mensagem para esta tela');
                    if (data.type === 'screen_update' && data.registered) {
                        console.log('🎉 Tela registrada no master, iniciando apresentação');
                        showPresentationSection();
                        updateConnectionStatus({
                            registered: true,
                            masterUrl: data.masterUrl
                        });

                        if (data.content) {
                            currentContent = Array.isArray(data.content) ? data.content : [data.content];
                            currentIndex = 0;
                            showSlide();
                        }
                    }
                }
            } catch (error) {
                console.error('❌ Erro ao processar mensagem SSE:', error);
            }
        };

        eventSource.onerror = (error) => {
            console.error('❌ Erro SSE:', error);
            eventSource.close();

            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
                console.log(`🔄 Reconectando em ${delay}ms (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                setTimeout(initSSE, delay);
            } else {
                console.error('❌ Máximo de tentativas atingido');
                showConnectionError();
            }
        };
    } catch (error) {
        console.error('❌ Erro ao iniciar SSE:', error);
        showConnectionError();
    }
}

async function registerScreen() {
    try {
        const screenData = await getScreenData();
        const { pin, screenId } = screenData;

        console.log('📝 Tentando registrar tela:', { pin, screenId });

        const response = await fetch(`${MASTER_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pin,
                screenId,
                slaveUrl: SLAVE_URL
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Falha no registro');
        }

        console.log('✅ Registro bem sucedido:', data);

        if (data.success) {
            // Force cache update
            await cacheScreenData();
            showPresentationSection();
            startPresentation();
        }
    } catch (error) {
        console.error('❌ Erro no registro:', error);
        showConnectionError();
    }
}

// ...rest of existing code...
