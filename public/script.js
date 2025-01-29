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

// Update cache management
const appState = {
    screenData: null,
    lastFetch: 0,
    cacheTTL: 30000, // 30 seconds
    initialized: false
};

// Função para gerar ID de dispositivo único
function generateDeviceId() {
    const storedId = localStorage.getItem('deviceId');
    if (storedId) return storedId;
    
    const newId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('deviceId', newId);
    return newId;
}

// Funções de apresentação
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

    // Limpar conteúdo existente
    slideContent.innerHTML = '';

    // Mostrar slide atual
    const content = currentContent[currentIndex];
    slideContent.innerHTML = content;

    // Lidar com conteúdo especial (como listas ou vídeos)
    handleSpecialContent(slideContent);

    // Agendar próximo slide
    if (currentContent.length > 1) {
        setTimeout(() => {
            currentIndex = (currentIndex + 1) % currentContent.length;
            showSlide();
        }, 10000); // 10 segundos por slide
    }
}

function handleSpecialContent(container) {
    // Lidar com conteúdo de lista, se presente
    if (container.querySelector('.product-list-item')) {
        handleListContent(container);
    }

    // Lidar com conteúdo de vídeo, se presente
    const video = container.querySelector('video');
    if (video) {
        handleVideoContent(video);
    }
}

function handleVideoContent(video) {
    video.play().catch(error => {
        console.error('Erro ao reproduzir vídeo:', error);
    });

    video.onended = () => {
        currentIndex = (currentIndex + 1) % currentContent.length;
        showSlide();
    };
}

// Enhanced caching function
async function cacheScreenData() {
    try {
        // If we have initialized data, just return it
        if (appState.initialized && appState.screenData) {
            return appState.screenData;
        }

        // Try to get data from localStorage first
        const storedData = localStorage.getItem('screenData');
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            if (parsedData.screenId && parsedData.pin) {
                console.log('📦 Using stored data:', parsedData);
                appState.screenData = parsedData;
                appState.initialized = true;
                return parsedData;
            }
        }

        // If no stored data, fetch from server
        const response = await fetch('/screen-data');
        const data = await response.json();
        
        if (!data || !data.screenId) {
            throw new Error('Invalid screen data received');
        }

        // Store the data
        localStorage.setItem('screenData', JSON.stringify(data));
        appState.screenData = data;
        appState.initialized = true;
        console.log('🔄 Cache initialized:', appState.screenData);
        return data;
    } catch (error) {
        console.error('❌ Cache update failed:', error);
        throw error;
    }
}

// Função para obter dados da tela usando o cache
async function getScreenData() {
    if (appState.initialized && appState.screenData) {
        return appState.screenData;
    }
    return await cacheScreenData();
}

// Função para mostrar a seção de registro
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

// Função para mostrar a seção de apresentação
function showPresentationSection() {
    const registrationSection = document.getElementById('registrationSection');
    const presentationSection = document.getElementById('presentationSection');

    registrationSection.classList.add('hidden');
    presentationSection.classList.add('visible');
}

// Função para atualizar o status da conexão na interface
function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        if (status.registered) {
            statusElement.textContent = 'Conectado';
            statusElement.classList.remove('disconnected');
            statusElement.classList.add('connected');
        } else {
            statusElement.textContent = 'Desconectado';
            statusElement.classList.remove('connected');
            statusElement.classList.add('disconnected');
        }
    }
}

// Função para mostrar erro de conexão
function showConnectionError() {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.textContent = 'Erro de conexão - Tentando reconectar...';
        statusElement.classList.add('disconnected');
        statusElement.classList.remove('connected', 'hidden');
    }

    // Mostrar seção de registro após erro
    getScreenData().then(data => {
        if (data) {
            showRegistrationSection(data);
        }
    }).catch(error => {
        console.error('Erro ao recuperar dados após erro de conexão:', error);
    });

    // Tentar reconectar após um atraso
    setTimeout(() => {
        console.log('🔄 Tentando reconectar...');
        initialize();
    }, 5000);
}

// Função de inicialização
async function initialize() {
    console.log('=== Initializing Frontend ===');
    try {
        // First, try to get screen data
        const screenData = await getScreenData();
        console.log('📱 Initial state:', screenData);

        if (!screenData?.screenId) {
            throw new Error('Invalid screen data');
        }

        // Check connection status
        const statusResponse = await fetch('/connection-status');
        const statusData = await statusResponse.json();

        if (statusData.registered) {
            console.log('✅ Screen registered, starting presentation');
            showPresentationSection();
            await loadContent();
            startPresentation();
        } else {
            console.log('ℹ️ Screen not registered, showing registration');
            showRegistrationSection(screenData);
        }

        // Initialize SSE connection
        initSSE();
    } catch (error) {
        console.error('❌ Initialization error:', error);
        showConnectionError();
    }
}

// Função para verificar o status da conexão com o master
async function checkConnectionStatus() {
    try {
        const screenData = await getScreenData();
        if (!screenData?.screenId) {
            throw new Error('No valid screen data available');
        }

        const response = await fetch(`${MASTER_URL}/screens`);
        const { screens } = await response.json();
        
        console.log('Comparing screen IDs:', {
            local: screenData.screenId,
            screens: screens.map(s => s.id)
        });

        const registeredScreen = screens.find(screen => screen.id === screenData.screenId);
        
        if (!registeredScreen) {
            console.log('❌ Screen not found in master, resetting state');
            // Reset local storage and state
            localStorage.removeItem('screenData');
            appState.screenData = null;
            appState.initialized = false;
            
            // Fetch new screen data
            const newData = await getScreenData();
            showRegistrationSection(newData);
            return;
        }

        // Update UI based on registration status
        if (registeredScreen.registered) {
            console.log('✅ Tela verificada no master:', registeredScreen);
            showPresentationSection();
            updateConnectionStatus({
                registered: true,
                masterUrl: MASTER_URL
            });
        } else {
            console.log('ℹ️ Tela encontrada, mas não registrada');
            showRegistrationSection(screenData);
        }
    } catch (error) {
        console.error('❌ Status check failed:', error);
        showConnectionError();
    }
}

// Função para processar atualizações de registro
async function handleRegistrationUpdate(data) {
    console.log('🔄 Processando atualização de registro:', data);

    try {
        // Recarregar dados da tela para informações atualizadas
        await cacheScreenData();

        if (data.screenId && data.screenId !== cachedScreenData.screenId) {
            console.log('Ignorando atualização para outra tela');
            return;
        }

        if (data.registered) {
            console.log('✅ Tela registrada no master, atualizando interface');
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

// Função para inicializar SSE
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
                
                // Processar apenas mensagens para esta tela
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

// Função para registrar a tela no master
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
            // Forçar atualização do cache
            await cacheScreenData();
            showPresentationSection();
            startPresentation();
        }
    } catch (error) {
        console.error('❌ Erro no registro:', error);
        showConnectionError();
    }
}

// Função para processar listas de conteúdo
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
                imageUrl = '/files/default-product.png';
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
        
        // Atualizar nome e preço, se necessário
        if (featuredName && currentItem.dataset.name) {
            featuredName.textContent = currentItem.dataset.name;
        }
        if (featuredPrice && currentItem.dataset.price) {
            featuredPrice.textContent = `R$ ${currentItem.dataset.price}`;
        }

        currentListIndex = (currentListIndex + 1) % listItems.length;
    }

    rotateListItem();
    window.listInterval = setInterval(rotateListItem, 10000); // 10 segundos
}

// Chamar initialize quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    console.log('Document ready, initializing...');
    initialize().catch(error => {
        console.error('Failed to initialize:', error);
        showConnectionError();
    });
});
