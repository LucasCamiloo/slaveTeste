const MASTER_URL = 'https://master-teste.vercel.app';
const SLAVE_URL = 'https://slave-teste.vercel.app';

let devices = [];
let eventSource = null;

async function loadDevices() {
    try {
        const response = await fetch(`${MASTER_URL}/screens`);
        const data = await response.json();
        devices = data.screens;
        updateDeviceList();
        // Only update chart if we're on the main page
        const chartElement = document.getElementById('statusChart');
        if (chartElement) {
            updateChart();
        }
    } catch (error) {
        console.error('Error loading devices:', error);
    }
}

// Remove WebSocket initialization and add SSE
function initSSE() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource(`${MASTER_URL}/events`);

    eventSource.onopen = () => {
        console.log('SSE connection established');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('SSE message received:', data);

            if (data.type === 'screen_update') {
                if (data.action === 'name_update') {
                    // Atualizar apenas o nome localmente
                    const device = devices.find(d => d.id === data.screenId);
                    if (device) {
                        device.name = data.name;
                        updateDeviceList();
                    }
                } else {
                    // Manter comportamento atual
                    loadDevices();
                }
            }
        } catch (error) {
            console.error('Error processing SSE message:', error);
        }
    };

    eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        eventSource.close();
        setTimeout(initSSE, 5000); // Reconectar após 5 segundos
    };
}

// Adicionar função createDeviceElement
function createDeviceElement(device) {
    const deviceDiv = document.createElement('div');
    deviceDiv.className = 'card mb-3';
    deviceDiv.innerHTML = `
        <div class="card-body">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <h5 class="card-title">${device.name || 'Sem nome'}</h5>
                    <span class="badge ${device.operational ? 'bg-success' : 'bg-danger'}">
                        ${device.operational ? 'Operante' : 'Inoperante'}
                    </span>
                </div>
                <div class="actions">
                    <button class="action-btn view-btn" onclick="viewDevice('${device.id}')" title="Visualizar">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="action-btn edit-btn" onclick="editDevice('${device.id}')" title="Editar">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="action-btn ad-btn" onclick="selectAd('${device.id}')" title="Anúncios">
                        <i class="bi bi-image"></i>
                    </button>
                    <button class="action-btn delete-btn" onclick="deleteDevice('${device.id}')" title="Excluir">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    return deviceDiv;
}

// Atualizar o evento DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    loadDevices();
    initSSE();
    // Recarregar a lista a cada 5 segundos
    setInterval(loadDevices, 5000);
});

function updateDeviceList() {
    const container = document.getElementById('deviceListContainer');
    if (!container) return;

    container.innerHTML = devices.map(device => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h5 class="card-title">${device.name || 'Sem nome'}</h5>
                        <span class="badge ${device.operational ? 'bg-success' : 'bg-danger'}">
                            ${device.operational ? 'Operante' : 'Inoperante'}
                        </span>
                    </div>
                    <div class="actions">
                        <button class="action-btn view-btn" onclick="viewDevice('${device.id}')" title="Visualizar">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="action-btn edit-btn" onclick="editDevice('${device.id}')" title="Editar">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="action-btn ad-btn" onclick="selectAd('${device.id}')" title="Anúncios">
                            <i class="bi bi-image"></i>
                        </button>
                        <button class="action-btn delete-btn" onclick="deleteDevice('${device.id}')" title="Excluir">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function updateChart() {
    const chartElement = document.getElementById('statusChart');
    if (!chartElement) {
        return; // Skip chart update if element doesn't exist
    }

    const operanteCount = devices.filter(d => d.registered).length;
    const inoperanteCount = devices.filter(d => !d.registered).length;

    const ctx = chartElement.getContext('2d');
    if (window.statusChart) {
        window.statusChart.destroy();
    }
    
    window.statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Operantes', 'Inoperantes'],
            datasets: [{
                data: [operanteCount, inoperanteCount],
                backgroundColor: ['#28a745', '#dc3545'],
                borderColor: ['#28a745', '#dc3545'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
}

function editDevice(deviceId) {
    try {
        console.log('Editing device:', deviceId);
        const device = devices.find(d => d.id === deviceId);
        if (!device) {
            console.error('Device not found:', deviceId);
            return;
        }
        console.log('Found device:', device);

        const modalElement = document.getElementById('editDeviceModal');
        if (!modalElement) {
            console.error('Modal element not found');
            return;
        }

        // Set modal values
        document.getElementById('editDeviceId').value = deviceId;
        document.getElementById('deviceName').value = device.name || '';
        console.log('Modal values set');

        // Initialize and show modal
        const modal = new bootstrap.Modal(modalElement);
        modal.show();

        // Log modal state
        console.log('Modal shown');
    } catch (error) {
        console.error('Error in editDevice:', error);
    }
}

async function saveDeviceName() {
    try {
        const deviceId = document.getElementById('editDeviceId').value;
        const newName = document.getElementById('deviceName').value.trim();
        
        console.log('Saving device name:', { deviceId, newName });

        if (!deviceId || !newName) {
            Swal.fire('Erro', 'Por favor, insira um nome válido', 'error');
            return;
        }

        const response = await fetch(`${MASTER_URL}/api/screens/${deviceId}/name`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: newName })
        });

        const data = await response.json();
        
        if (response.ok && data.success) {
            // Atualizar o dispositivo na lista local
            const device = devices.find(d => d.id === deviceId);
            if (device) {
                device.name = newName;
            }
            
            // Atualizar a interface
            updateDeviceList();

            // Fechar o modal
            const modalElement = document.getElementById('editDeviceModal');
            const modal = bootstrap.Modal.getInstance(modalElement);
            modal.hide();

            await Swal.fire('Sucesso!', 'Nome do dispositivo atualizado', 'success');
            loadDevices(); // Atualiza a lista para persistir o nome
        } else {
            throw new Error(data.message || 'Erro ao atualizar nome');
        }
    } catch (error) {
        console.error('Error in saveDeviceName:', error);
        Swal.fire('Erro', 'Falha ao salvar nome: ' + error.message, 'error');
    }
}

// ...existing code...

// Update the selectAd function with better error handling
async function selectAd(deviceId) {
    try {
        console.log('Loading available ads...');
        const response = await fetch(`${MASTER_URL}/api/ads/available`);
        if (!response.ok) {
            throw new Error(`Failed to load ads: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.ads || !data.ads.length) {
            throw new Error('No ads available');
        }

        const adSelector = document.createElement('select');
        adSelector.innerHTML = data.ads.map(ad => 
            `<option value="${ad.id}">${ad.title} (${new Date(ad.dateCreated).toLocaleDateString()})</option>`
        ).join('');

        const result = await Swal.fire({
            title: 'Selecione um anúncio',
            html: adSelector,
            showCancelButton: true,
            confirmButtonText: 'Selecionar',
            cancelButtonText: 'Cancelar'
        });

        if (result.isConfirmed) {
            const selectedAdId = adSelector.value;
            console.log('Updating ad:', { deviceId, selectedAdId });

            const updateResponse = await fetch(`${MASTER_URL}/api/screens/${deviceId}/ad`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ adId: selectedAdId })
            });

            if (!updateResponse.ok) {
                const errorData = await updateResponse.json();
                throw new Error(errorData.message || 'Failed to update ad');
            }

            const updateData = await updateResponse.json();
            if (updateData.success) {
                await loadDevices();
                await Swal.fire('Sucesso!', 'Anúncio atualizado com sucesso', 'success');
            } else {
                throw new Error(updateData.message || 'Failed to update ad');
            }
        }
    } catch (error) {
        console.error('Error selecting ad:', error);
        await Swal.fire('Erro', `Falha ao selecionar anúncio: ${error.message}`, 'error');
    }
}

// ...existing code...

// Add device ID generation function
function generateDeviceId() {
    const storedId = localStorage.getItem('deviceId');
    if (storedId) return storedId;
    
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const browserInfo = navigator.userAgent.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
    const newId = `device_${timestamp}_${random}_${browserInfo}`;
    
    localStorage.setItem('deviceId', newId);
    return newId;
}

// Update the registration function to be globally accessible
window.registerScreen = async function() {
    try {
        const slaveUrl = document.getElementById('slaveUrl').value.trim();
        if (!slaveUrl) {
            Swal.fire('Erro', 'URL do slave é obrigatória', 'error');
            return;
        }

        console.log('🔄 Iniciando registro com slave:', slaveUrl);
        const deviceId = generateDeviceId();
        console.log('Using device ID:', deviceId);

        // First get screen data from slave
        const screenResponse = await fetch(`${slaveUrl}/screen-data`, {
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json',
                'X-Device-ID': deviceId
            }
        });

        if (!screenResponse.ok) {
            throw new Error(`Failed to get screen data: ${screenResponse.status}`);
        }

        const screenData = await screenResponse.json();
        console.log('📱 Dados recebidos do slave:', screenData);

        if (!screenData.screenId || !screenData.pin) {
            throw new Error('Invalid screen data received');
        }

        // Register with master
        console.log('📝 Registrando no master...', {
            screenId: screenData.screenId,
            pin: screenData.pin,
            slaveUrl
        });

        const masterResponse = await fetch(`${MASTER_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                screenId: screenData.screenId,
                pin: screenData.pin,
                slaveUrl: slaveUrl
            })
        });

        const masterData = await masterResponse.json();
        
        if (!masterResponse.ok) {
            throw new Error(masterData.message || 'Master registration failed');
        }

        // Only proceed with slave registration if master registration was successful
        if (masterData.success) {
            console.log('✅ Master registration successful, registering with slave...');
            
            const slaveRegResponse = await fetch(`${slaveUrl}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    screenId: screenData.screenId,
                    pin: screenData.pin,
                    masterUrl: MASTER_URL
                })
            });

            if (!slaveRegResponse.ok) {
                throw new Error('Failed to register with slave');
            }

            const slaveResult = await slaveRegResponse.json();
            if (slaveResult.success) {
                await Swal.fire('Sucesso!', 'Tela registrada com sucesso!', 'success');
                await loadDevices();
            } else {
                throw new Error(slaveResult.message || 'Slave registration failed');
            }
        }
    } catch (error) {
        console.error('❌ Erro no registro:', error);
        await Swal.fire('Erro', `Falha no registro: ${error.message}`, 'error');
    }
};

// ...rest of existing code...

window.useAd = async function(adId) {
    const screenId = prompt('Digite o ID da tela onde deseja exibir este anúncio:');
    if (!screenId) return;

    try {
        const response = await fetch(`${MASTER_URL}/api/screens/${screenId}/ad`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ adId })
        });

        if (response.ok) {
            alert('Anúncio aplicado com sucesso!');
        } else {
            throw new Error('Falha ao atualizar anúncio');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao aplicar anúncio: ' + error.message);
    }
};

// ...existing code...

async function deleteDevice(deviceId) {
    try {
        const confirmation = await Swal.fire({
            title: 'Confirmação',
            text: 'Tem certeza que deseja excluir esta tela?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sim, excluir',
            cancelButtonText: 'Cancelar'
        });

        if (!confirmation.isConfirmed) {
            return;
        }

        const response = await fetch(`${MASTER_URL}/api/screen/${deviceId}`, {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Falha ao excluir tela');
        }

        const data = await response.json();
        if (data.success) {
            Swal.fire('Sucesso!', 'Tela excluída com sucesso', 'success');
            loadDevices(); // Recarrega a lista de dispositivos
        } else {
            throw new Error(data.message || 'Erro ao excluir tela');
        }
    } catch (error) {
        console.error('Erro ao excluir tela:', error);
        Swal.fire('Erro', 'Erro ao excluir tela: ' + error.message, 'error');
    }
}

// ...existing code...

async function scheduleAd(adId, screenId, scheduleDate, scheduleTime) {
    try {
        const response = await fetch(`${MASTER_URL}/api/schedule-ad`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adId, screenId, scheduleDate, scheduleTime })
        });

        if (!response.ok) {
            const errorText = await response.text();
            try {
                const errorData = JSON.parse(errorText);
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            } catch (e) {
                throw new Error(errorText);
            }
        }

        const data = await response.json();
        if (data.success) {
            alert('Anúncio agendado com sucesso!');
        } else {
            throw new Error(data.message || 'Falha ao agendar anúncio');
        }
    } catch (error) {
        console.error('Erro ao agendar anúncio:', error);
        alert('Erro ao agendar anúncio: ' + error.message);
    }
}

// ...existing code...

async function loadScreens() {
    try {
        const response = await fetch(`${MASTER_URL}/screens`);
        const data = await response.json();
        
        if (data.success) {
            const container = document.getElementById('deviceListContainer');
            container.innerHTML = '';
            
            data.screens.forEach(screen => {
                const deviceElement = createDeviceElement(screen);
                container.appendChild(deviceElement);
            });
        }
    } catch (error) {
        console.error('Error loading screens:', error);
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Falha ao carregar as telas'
        });
    }
}

// Adicionar chamada automática
document.addEventListener('DOMContentLoaded', () => {
    loadScreens();
    // Recarregar a lista a cada 5 segundos
    setInterval(loadScreens, 5000);
});

// ...rest of existing code...

async function loadScreenCredentials() {
    try {
        // First, get the screen data from slave
        const slaveUrl = document.getElementById('slaveUrl').value.trim();
        const response = await fetch(`${slaveUrl}/screen-data`);
        const data = await response.json();
        
        // Auto-fill the form with slave's data
        document.getElementById('screenId').value = data.screenId;
        document.getElementById('pin').value = data.pin;
        
        console.log('📱 Dados carregados do slave:', data);
    } catch (error) {
        console.error('❌ Erro ao carregar dados do slave:', error);
        Swal.fire({
            icon: 'error',
            title: 'Erro',
            text: 'Não foi possível carregar os dados da tela'
        });
    }
}

// ...existing code...

// Update the registration function to handle device-specific credentials
window.registerScreen = async function() {
    try {
        const slaveUrl = document.getElementById('slaveUrl').value.trim();
        if (!slaveUrl) {
            Swal.fire('Erro', 'URL do slave é obrigatória', 'error');
            return;
        }

        // Get stored deviceId or generate new one
        const deviceId = localStorage.getItem('deviceId') || generateDeviceId();
        console.log('Using stored/generated device ID:', deviceId);

        // First get screen data from slave
        const screenResponse = await fetch(`${slaveUrl}/screen-data`, {
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json',
                'X-Device-ID': deviceId
            }
        });

        if (!screenResponse.ok) {
            throw new Error(`Failed to get screen data: ${screenResponse.status}`);
        }

        const screenData = await screenResponse.json();
        console.log('📱 Dados recebidos do slave:', screenData);

        // Store credentials in localStorage
        localStorage.setItem('screenCredentials', JSON.stringify({
            screenId: screenData.screenId,
            pin: screenData.pin,
            deviceId: deviceId
        }));

        console.log('📝 Registrando no master...', {
            screenId: screenData.screenId,
            pin: screenData.pin,
            slaveUrl
        });

        const masterResponse = await fetch(`${MASTER_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Device-ID': deviceId
            },
            body: JSON.stringify({
                screenId: screenData.screenId,
                pin: screenData.pin,
                slaveUrl: slaveUrl
            })
        });

        if (!masterResponse.ok) {
            const errorData = await masterResponse.json();
            throw new Error(errorData.message || 'Master registration failed');
        }

        const masterData = await masterResponse.json();
        if (masterData.success) {
            await Swal.fire('Sucesso!', 'Tela registrada com sucesso!', 'success');
            await loadDevices();
        }

    } catch (error) {
        console.error('❌ Erro no registro:', error);
        await Swal.fire('Erro', `Falha no registro: ${error.message}`, 'error');
    }
};

// Add function to generate device ID (if not already present)
function generateDeviceId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const browserInfo = navigator.userAgent.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
    const deviceId = `device_${timestamp}_${random}_${browserInfo}`;
    localStorage.setItem('deviceId', deviceId);
    return deviceId;
}

// ...existing code...
