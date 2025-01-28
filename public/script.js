const MASTER_URL = 'https://master-teste.vercel.app';
const SLAVE_URL = 'https://slave-teste.vercel.app';

let currentContent = null;
let currentIndex = 0;
let statusTimeout;
let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

// Add cache for screen data
let cachedScreenData = null;

// Adicionar um timestamp para controle de cache
let lastScreenDataUpdate = 0;
const CACHE_DURATION = 300000; // 5 minutos

async function getScreenData() {
    const now = Date.now();
    
    // Usar cache se disponível e dentro do período de validade
    if (cachedScreenData && (now - lastScreenDataUpdate) < CACHE_DURATION) {
        return cachedScreenData;
    }

    try {
        const response = await fetch('/screen-data');
        cachedScreenData = await response.json();
        lastScreenDataUpdate = now;
        return cachedScreenData;
    } catch (error) {
        console.error('Erro ao buscar dados da tela:', error);
        return cachedScreenData; // Retornar cache mesmo expirado em caso de erro
    }
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
    console.log('=== Frontend Initialize START ===');
    try {
        const screenData = await getScreenData();
        console.log('📱 Dados recebidos do servidor:', screenData);

        if (!screenData || !screenData.pin || !screenData.screenId) {
            console.error('❌ Dados inválidos:', screenData);
            showConnectionError();
            return;
        }

        cachedScreenData = screenData;
        lastScreenDataUpdate = Date.now();
        console.log('💾 Dados em cache atualizados:', cachedScreenData);

        if (screenData.registered && screenData.masterUrl) {
            console.log('✅ Tela registrada, iniciando apresentação');
            showPresentationSection();
            startPresentation();
        } else {
            console.log('ℹ️ Tela não registrada, mostrando tela de registro');
            showRegistrationSection(screenData);
        }

        console.log('🔄 Iniciando SSE...');
        initSSE();
    } catch (error) {
        console.error('❌ ERRO na inicialização:', error);
        showConnectionError();
    }
}

// Modificar o checkConnectionStatus para não buscar novos dados
// Modificar checkConnectionStatus para ter mais logs
async function checkConnectionStatus() {
    console.log('=== Check Connection Status ===');
    try {
        const response = await fetch('/connection-status');
        const data = await response.json();
        console.log('📡 Status atual:', data);
        
        updateConnectionStatus(data);

        // Apenas atualizar a interface se o status de registro mudar
        if (!data.registered && !currentContent) {
            console.log('ℹ️ Tela não registrada, atualizando interface');
            document.getElementById('slideContent').innerHTML = '';
            document.getElementById('registrationSection').classList.remove('hidden');
            document.getElementById('presentationSection').classList.remove('visible');
        }
    } catch (error) {
        console.error('Error checking status:', error);
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
    if (cachedScreenData && data.targetScreen && data.targetScreen !== cachedScreenData.screenId) {
        console.log('Ignorando atualização destinada a outra tela');
        return;
    }

    if (data.registered) {
        showPresentationSection();
        startPresentation();
        showSuccessMessage('Conexão estabelecida com sucesso!');
    } else if (data.action === 'content_update' && data.content) {
        currentContent = Array.isArray(data.content) ? data.content : [data.content];
        currentIndex = 0;
        showSlide();
    } else if (data.action === 'name_update') {
        showPresentationSection();
        startPresentation();
    } else {
        showRegistrationSection(cachedScreenData || data);
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

// Modify SSE initialization to limit reconnection attempts
async function initSSE() {
    if (eventSource) {
        console.log('Fechando conexão SSE existente');
        eventSource.close();
    }

    console.log('Iniciando nova conexão SSE');
    eventSource = new EventSource('/events');

    eventSource.onopen = function() {
        console.log('SSE: Conexão estabelecida');
        reconnectAttempts = 0;
        checkConnectionStatus();
    };

    eventSource.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('SSE: Mensagem recebida:', data);

            if (data.type === 'connected') {
                handleConnectionStatus(data);
            } else if (data.type === 'screen_update') {
                handleRegistrationUpdate(data);
            }
        } catch (error) {
            console.error('SSE: Erro ao processar mensagem:', error);
        }
    };

    eventSource.onerror = function(error) {
        console.error('SSE: Erro na conexão:', error);
        eventSource.close();
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttempts); // Exponential backoff
            console.log(`SSE: Tentativa de reconexão ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} em ${delay}ms`);
            setTimeout(initSSE, delay);
        } else {
            console.error('SSE: Máximo de tentativas de reconexão atingido');
            showConnectionError();
        }
    };
}

// ...rest of existing code...
