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

// Update the caching function to be more resilient
async function cacheScreenData() {
    try {
        if (appState.screenData && Date.now() - appState.lastFetch < appState.cacheTTL) {
            console.log('📦 Using cached data:', appState.screenData);
            return appState.screenData;
        }

        // Try to get data from localStorage first
        const storedData = localStorage.getItem('screenData');
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            if (parsedData.screenId && parsedData.pin) {
                console.log('📦 Using stored data:', parsedData);
                appState.screenData = parsedData;
                appState.lastFetch = Date.now();
                return parsedData;
            }
        }

        const response = await fetch('/screen-data');
        const data = await response.json();
        
        if (!data || !data.screenId) {
            throw new Error('Invalid screen data received');
        }

        // Store in localStorage for persistence
        localStorage.setItem('screenData', JSON.stringify(data));
        appState.screenData = data;
        appState.lastFetch = Date.now();
        console.log('🔄 Cache updated:', appState.screenData);
        return data;
    } catch (error) {
        console.error('❌ Cache update failed:', error);
        // Try to use stored data as fallback
        const storedData = localStorage.getItem('screenData');
        if (storedData) {
            return JSON.parse(storedData);
        }
        throw error;
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
// Update initialize to ensure consistent screen ID
async function initialize() {
    console.log('=== Inicializando Frontend ===');
    try {
        const screenData = await getScreenData();
        console.log('📱 Estado inicial:', screenData);

        // Ensure we have valid screen data
        if (!screenData || !screenData.screenId) {
            throw new Error('Dados da tela inválidos');
        }

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

// Update checkConnectionStatus to handle ID verification better
async function checkConnectionStatus() {
    try {
        const screenData = await getScreenData();
        if (!screenData || !screenData.screenId) {
            throw new Error('No valid screen data available');
        }

        const response = await fetch(`${MASTER_URL}/screens`);
        const { screens } = await response.json();
        
        // Find this screen in master's list
        const registeredScreen = screens.find(screen => screen.id === screenData.screenId);

        if (!registeredScreen) {
            console.log('ℹ️ Screen not found in master, showing registration');
            showRegistrationSection(screenData);
            return;
        }

        if (registeredScreen.registered) {
            console.log('✅ Screen verified in master:', registeredScreen);
            showPresentationSection();
            updateConnectionStatus({
                registered: true,
                masterUrl: MASTER_URL
            });
        } else {
            console.log('ℹ️ Screen found but not registered');
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

// Add presentation management functions
function startPresentation() {
    console.log('🎬 Iniciando apresentação');
    if (currentContent) {
        showSlide();
    } else {
        console.log('ℹ️ Nenhum conteúdo para apresentar');
        showWaitingScreen();
    }
}

function showWaitingScreen() {
    const slideContent = document.getElementById('slideContent');
    if (slideContent) {
        slideContent.innerHTML = `
            <div style="color: white; text-align: center; padding: 20px;">
                <h2>Aguardando conteúdo...</h2>
                <p>A tela está conectada e pronta para exibir conteúdo.</p>
            </div>
        `;
    }
}

function showSlide() {
    if (!currentContent || currentContent.length === 0) {
        showWaitingScreen();
        return;
    }

    const slideContent = document.getElementById('slideContent');
    if (!slideContent) return;

    // Clear any existing content
    slideContent.innerHTML = '';

    // Show current slide
    const content = currentContent[currentIndex];
    slideContent.innerHTML = content;

    // Handle any special content (like lists or videos)
    handleSpecialContent(slideContent);

    // Schedule next slide
    if (currentContent.length > 1) {
        setTimeout(() => {
            currentIndex = (currentIndex + 1) % currentContent.length;
            showSlide();
        }, 10000); // 10 seconds per slide
    }
}

function handleSpecialContent(container) {
    // Handle list content if present
    if (container.querySelector('.product-list-item')) {
        handleListContent(container);
    }

    // Handle video content if present
    const video = container.querySelector('video');
    if (video) {
        handleVideoContent(video);
    }
}

function handleVideoContent(video) {
    video.play().catch(error => {
        console.error('Error playing video:', error);
    });

    video.onended = () => {
        currentIndex = (currentIndex + 1) % currentContent.length;
        showSlide();
    };
}

// Update error handling
function showConnectionError() {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.textContent = 'Erro de conexão - Tentando reconectar...';
        statusElement.classList.add('disconnected');
        statusElement.classList.remove('connected', 'hidden');
    }

    // Show registration section after error
    getScreenData().then(data => {
        if (data) {
            showRegistrationSection(data);
        }
    }).catch(error => {
        console.error('Erro ao recuperar dados após erro de conexão:', error);
    });

    // Try to reconnect after a delay
    setTimeout(() => {
        console.log('🔄 Tentando reconectar...');
        initialize();
    }, 5000);
}

// ...rest of existing code...
