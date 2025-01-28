const MASTER_URL = 'https://master-teste.vercel.app';
const SLAVE_URL = 'https://slave-teste.vercel.app';

let currentContent = null;
let currentIndex = 0;
let statusTimeout;
let eventSource = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

// Remove cache variables since we're using server-side state management
async function getScreenData() {
    try {
        const response = await fetch('/screen-data');
        const data = await response.json();
        console.log('📱 Dados recebidos:', data);
        return data;
    } catch (error) {
        console.error('❌ Erro ao buscar dados:', error);
        throw error;
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
    console.log('=== Inicializando Frontend ===');
    try {
        const screenData = await getScreenData();
        console.log('📱 Estado inicial:', screenData);

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

// Simplificar verificação de status
async function checkConnectionStatus() {
    console.log('=== Verificando Status ===');
    try {
        const response = await fetch('/connection-status');
        const data = await response.json();
        console.log('📡 Status:', data);
        updateConnectionStatus(data);
    } catch (error) {
        console.error('❌ Erro ao verificar status:', error);
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

// Melhorar manipulação de SSE
function initSSE() {
    if (eventSource) {
        console.log('🔄 Fechando SSE existente');
        eventSource.close();
    }

    console.log('🔄 Iniciando nova conexão SSE');
    eventSource = new EventSource('/events');

    eventSource.onopen = () => {
        console.log('✅ SSE conectado');
        reconnectAttempts = 0;
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📨 Mensagem SSE:', data);
            
            if (data.type === 'connected') {
                handleConnectionStatus(data);
            } else if (data.type === 'screen_update') {
                handleRegistrationUpdate(data);
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
}

// ...rest of existing code...
