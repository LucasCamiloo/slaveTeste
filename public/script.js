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

// Replace initialize function with cached version
async function initialize() {
    try {
        // Try to get screen data first
        if (!cachedScreenData) {
            const screenDataResponse = await fetch('/screen-data');
            cachedScreenData = await screenDataResponse.json();
            
            if (!cachedScreenData.pin || !cachedScreenData.screenId) {
                console.error('Dados da tela inválidos:', cachedScreenData);
                showConnectionError();
                return;
            }
            
            console.log('Dados iniciais da tela:', cachedScreenData);
        }

        const statusResponse = await fetch('/connection-status');
        const statusData = await statusResponse.json();

        if (statusData.registered) {
            showPresentationSection();
            startPresentation();
        } else {
            showRegistrationSection(cachedScreenData);
        }

        initSSE();
        setInterval(checkConnectionStatus, 5000);
    } catch (error) {
        console.error('Erro de inicialização:', error);
        showConnectionError();
    }
}

// Update checkConnectionStatus to use cached data
async function checkConnectionStatus() {
    try {
        const response = await fetch('/connection-status');
        const data = await response.json();
        updateConnectionStatus(data);

        // Only refresh registration screen if not registered AND not showing content
        if (!data.registered && !currentContent) {
            document.getElementById('slideContent').innerHTML = '';
            document.getElementById('registrationSection').classList.remove('hidden');
            document.getElementById('presentationSection').classList.remove('visible');

            // Use cached screen data if available
            if (!cachedScreenData) {
                const screenDataResponse = await fetch('/screen-data');
                cachedScreenData = await screenDataResponse.json();
            }

            document.getElementById('qrcode').src = `${SLAVE_URL}/generate-qr`;
            document.getElementById('pin').textContent = cachedScreenData.pin;
            document.getElementById('screenId').textContent = cachedScreenData.screenId;
        }
    } catch (error) {
        console.error('Error checking status:', error);
        showConnectionError();
    }
}

// Update showRegistrationSection to use cached data
function showRegistrationSection(data) {
    console.log('Mostrando seção de registro com dados:', data);
    
    const registrationSection = document.getElementById('registrationSection');
    const presentationSection = document.getElementById('presentationSection');
    const qrcodeImg = document.getElementById('qrcode');
    const pinSpan = document.getElementById('pin');
    const screenIdSpan = document.getElementById('screenId');

    if (!data || !data.pin || !data.screenId) {
        console.error('Dados inválidos recebidos:', data);
        return;
    }

    // Cache the screen data
    cachedScreenData = data;

    registrationSection.classList.remove('hidden');
    presentationSection.classList.remove('visible');

    // Update QR Code with retry
    const loadQRCode = (retryCount = 0) => {
        const timestamp = Date.now();
        qrcodeImg.src = `${SLAVE_URL}/generate-qr?t=${timestamp}`;
        qrcodeImg.onerror = () => {
            if (retryCount < 3) {
                console.log(`Tentativa ${retryCount + 1} de carregar QR Code`);
                setTimeout(() => loadQRCode(retryCount + 1), 1000);
            }
        };
    };

    loadQRCode();
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
