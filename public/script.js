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

// Update showSlide function to better handle content display
function showSlide() {
    if (!currentContent || !Array.isArray(currentContent) || currentContent.length === 0) {
        showWaitingScreen();
        return;
    }

    const slideContent = document.getElementById('slideContent');
    if (!slideContent) return;

    console.log('Showing slide:', currentIndex, 'Total slides:', currentContent.length);

    // Clear any existing timeout
    if (window.slideTimeout) {
        clearTimeout(window.slideTimeout);
    }

    // Remove previous content with fade
    slideContent.classList.remove('in');
    
    setTimeout(() => {
        try {
            // Get current content from array
            let content = currentContent[currentIndex];
            
            // Fix localhost and relative URLs for background images and other assets
            content = content.replace(
                /background(?:-image)?\s*:\s*url\(['"]?(?:http:\/\/localhost:\d+)?(\/[^'"\)]+)['"]?\)/g,
                (match, path) => `background: url('${MASTER_URL}${path}')`
            );

            console.log('Content after URL fix:', content.substring(0, 200));

            // Update content
            slideContent.innerHTML = content;
            
            // Force reflow
            void slideContent.offsetWidth;
            
            // Add fade in
            slideContent.classList.add('in');

            // Schedule next slide with clear timeout protection
            window.slideTimeout = setTimeout(() => {
                currentIndex = (currentIndex + 1) % currentContent.length;
                showSlide();
            }, 10000);

        } catch (error) {
            console.error('Error displaying slide:', error);
            console.error('Content:', currentContent[currentIndex]);
            showWaitingScreen();
        }
    }, 1000);
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

// Update showPresentationSection function
function showPresentationSection() {
    const registrationSection = document.getElementById('registrationSection');
    const presentationSection = document.getElementById('presentationSection');

    registrationSection.classList.add('hidden');
    presentationSection.classList.remove('hidden');
    presentationSection.classList.add('visible');

    // Force reflow
    void presentationSection.offsetWidth;
    presentationSection.classList.add('in');
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
        const screenData = await getScreenData();
        console.log('📱 Initial state:', screenData);

        if (!screenData?.screenId) {
            throw new Error('Invalid screen data');
        }

        if (screenData.registered) {
            console.log('✅ Screen registered, starting presentation');
            showPresentationSection();
            await loadContent(); // Load initial content
            startPresentation();
        } else {
            console.log('ℹ️ Screen not registered, showing registration');
            showRegistrationSection(screenData);
        }

        initSSE();
    } catch (error) {
        console.error('❌ Initialization error:', error);
        showConnectionError();
    }
}

// Update checkConnectionStatus to also load content when connection is confirmed
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
            localStorage.removeItem('screenData');
            appState.screenData = null;
            appState.initialized = false;
            
            const newData = await getScreenData();
            showRegistrationSection(newData);
            return;
        }

        if (registeredScreen.registered) {
            console.log('✅ Screen verified in master:', registeredScreen);
            showPresentationSection();
            updateConnectionStatus({
                registered: true,
                masterUrl: MASTER_URL
            });

            // Load content immediately after confirming registration
            await loadContent();
        } else {
            console.log('ℹ️ Screen found but not registered');
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
        const screenData = await getScreenData();
        
        if (data.screenId === screenData.screenId && data.registered) {
            console.log('✅ Screen registered, updating interface');
            showPresentationSection();
            await loadContent(); // Load content after registration
            startPresentation();
        }
    } catch (error) {
        console.error('❌ Error processing update:', error);
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

        // Update eventSource message handler
        eventSource.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('📨 SSE message received:', data);

                const screenData = await getScreenData();
                
                if (data.screenId === screenData.screenId) {
                    console.log('✨ Processing message for this screen');
                    if (data.type === 'screen_update') {
                        if (data.content) {
                            console.log('New content received:', {
                                contentLength: data.content.length,
                                sample: Array.isArray(data.content) ? 
                                    data.content[0]?.substring(0, 100) + '...' : 
                                    data.content.substring(0, 100) + '...'
                            });
                            
                            currentContent = Array.isArray(data.content) ? data.content : [data.content];
                            currentIndex = 0;
                            showSlide();
                        }
                    }
                }
            } catch (error) {
                console.error('❌ Error processing SSE message:', error);
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
    // Clear any existing intervals
    if (window.listInterval) {
        clearInterval(window.listInterval);
    }
    if (window.slideTimeout) {
        clearTimeout(window.slideTimeout);
    }

    const listItems = Array.from(container.querySelectorAll('.product-list-item'));
    let currentListIndex = 0;
    let isTransitioning = false;

    console.log('Starting list rotation with', listItems.length, 'items');

    function updateFeaturedProduct(item) {
        console.log('Updating featured product:', currentListIndex + 1, 'of', listItems.length);

        // Remove active class from all items
        listItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const featuredImage = container.querySelector('.featured-image');
        const featuredName = container.querySelector('.featured-name');
        const featuredPrice = container.querySelector('.featured-price');

        if (featuredImage) {
            let imageUrl = item.dataset.imageUrl;
            if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = `${MASTER_URL}${imageUrl}`;
            }
            featuredImage.src = imageUrl;
            featuredImage.onerror = () => {
                console.error('Error loading image:', imageUrl);
                featuredImage.src = `${MASTER_URL}/files/default-product.png`;
            };
        }

        if (featuredName) {
            featuredName.textContent = item.dataset.name || 'Sem nome';
        }
        if (featuredPrice) {
            featuredPrice.textContent = item.dataset.price || 'Preço indisponível';
        }

        // Scroll the item into view
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function rotateListItems() {
        if (isTransitioning) return;
        isTransitioning = true;

        updateFeaturedProduct(listItems[currentListIndex]);

        // Schedule next item or move to next slide
        setTimeout(() => {
            isTransitioning = false;
            currentListIndex++;

            if (currentListIndex >= listItems.length) {
                // Completed one full cycle, move to next slide
                console.log('Completed list cycle, moving to next slide');
                clearInterval(window.listInterval);
                currentIndex = (currentIndex + 1) % currentContent.length;
                showSlide();
                return;
            }
        }, 10000); // 10 seconds per item
    }

    // Start the rotation immediately
    rotateListItems();
    
    // Set up the interval for subsequent rotations
    window.listInterval = setInterval(rotateListItems, 10000);

    // Prevent the normal slide timeout from interrupting
    if (window.slideTimeout) {
        clearTimeout(window.slideTimeout);
    }
}

// Update showSlide to better handle special content
function showSlide() {
    if (!currentContent || !Array.isArray(currentContent) || currentContent.length === 0) {
        showWaitingScreen();
        return;
    }

    const slideContent = document.getElementById('slideContent');
    if (!slideContent) return;

    console.log('Showing slide:', currentIndex + 1, 'of', currentContent.length);

    // Clear any existing timeouts
    if (window.slideTimeout) {
        clearTimeout(window.slideTimeout);
    }
    if (window.listInterval) {
        clearInterval(window.listInterval);
    }

    // Remove previous content with fade
    slideContent.classList.remove('in');
    
    setTimeout(() => {
        try {
            let content = currentContent[currentIndex];
            
            // Fix URLs
            content = content.replace(
                /background(?:-image)?\s*:\s*url\(['"]?(?:http:\/\/localhost:\d+)?(\/[^'"\)]+)['"]?\)/g,
                (match, path) => `background: url('${MASTER_URL}${path}')`
            );

            // Update content
            slideContent.innerHTML = content;
            
            // Force reflow
            void slideContent.offsetWidth;
            slideContent.classList.add('in');

            // Check if this is a list layout
            if (content.includes('product-list-item')) {
                handleListContent(slideContent);
            } else {
                // For non-list slides, schedule next slide
                window.slideTimeout = setTimeout(() => {
                    currentIndex = (currentIndex + 1) % currentContent.length;
                    showSlide();
                }, 10000);
            }
        } catch (error) {
            console.error('Error displaying slide:', error);
            showWaitingScreen();
        }
    }, 1000);
}

// Update loadContent function to better handle the response
async function loadContent() {
    try {
        console.log('🔄 Loading content...');
        const response = await fetch('/content');
        const data = await response.json();
        
        console.log('📦 Content response:', data);

        if (!data || !data.content) {
            console.error('❌ No content in response');
            showWaitingScreen();
            return;
        }

        // Handle clearExisting flag if present
        if (data.clearExisting) {
            currentContent = null;
            currentIndex = 0;
        }

        // Always treat content as array
        currentContent = Array.isArray(data.content) ? data.content : [data.content];

        // Reset index and show first slide
        currentIndex = 0;
        if (window.slideTimeout) {
            clearTimeout(window.slideTimeout);
        }
        
        console.log('Content loaded:', {
            items: currentContent.length,
            firstItem: currentContent[0]?.substring(0, 100)
        });
        
        showSlide();
    } catch (error) {
        console.error('❌ Error loading content:', error);
        showWaitingScreen();
    }
}

// Chamar initialize quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    console.log('Document ready, initializing...');
    initialize().catch(error => {
        console.error('Failed to initialize:', error);
        showConnectionError();
    });
});
