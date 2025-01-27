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

// Modificar initialize para garantir dados válidos
async function initialize() {
    try {
        // Buscar dados da tela
        const screenDataResponse = await fetch('/screen-data');
        const screenData = await screenDataResponse.json();
        
        console.log('Dados da tela recebidos:', screenData);

        // Validar dados essenciais
        if (!screenData || !screenData.pin || !screenData.screenId) {
            console.error('Dados da tela inválidos ou incompletos:', screenData);
            showConnectionError();
            return;
        }

        // Atualizar cache
        cachedScreenData = screenData;
        lastScreenDataUpdate = Date.now();

        // Verificar status de registro
        const statusResponse = await fetch('/connection-status');
        const statusData = await statusResponse.json();

        if (statusData.registered) {
            showPresentationSection();
            startPresentation();
        } else {
            showRegistrationSection(cachedScreenData);
        }

        initSSE();
        setInterval(checkConnectionStatus, 30000);
    } catch (error) {
        console.error('Erro de inicialização:', error);
        showConnectionError();
    }
}

// Modificar o checkConnectionStatus para não buscar novos dados
async function checkConnectionStatus() {
    try {
        const response = await fetch('/connection-status');
        const data = await response.json();
        updateConnectionStatus(data);

        // Apenas atualizar a interface se não estiver registrado
        if (!data.registered && !currentContent) {
            document.getElementById('slideContent').innerHTML = '';
            document.getElementById('registrationSection').classList.remove('hidden');
            document.getElementById('presentationSection').classList.remove('visible');

            // Usar dados em cache existentes
            if (cachedScreenData) {
                document.getElementById('pin').textContent = cachedScreenData.pin;
                document.getElementById('screenId').textContent = cachedScreenData.screenId;
            }
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

// Update handleRegistrationUpdate to maintain connection
async function handleRegistrationUpdate(data) {
    // Only update if it's for this screen
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

// ...rest of existing code...
