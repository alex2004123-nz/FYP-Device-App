console.log("JavaScript is successfully connected!");

const button = document.getElementById('bluetoothConnect');
const increaseExpirButton = document.getElementById('increase');
const decreaseExpirButton = document.getElementById('decrease');

const increaseInspirButton = document.getElementById('increaseInspir');
const decreaseInspirButton = document.getElementById('decreaseInspir');

const CPAPButton = document.getElementById('CPAP');
const BiPAPButton = document.getElementById('BiPAP');
const APAPButton = document.getElementById('APAP');

const SERVICE_UUID =  "12345678-1234-1234-1234-123456789abc";
const PRESSURE_CHAR_UUID = "87654321-4321-4321-4321-cba987654321";
const WRITE_CHARACTERISTIC_UUID = "87654321-4321-4321-4321-cba987655676"; 

let papState = 0;

let connectedDevice = null;
let gattServer = null;
let bluetoothService = null;
let pressureCharacteristic = null;
let writeCharacteristic = null;;
let motorControlCharacteristic = null;

button.addEventListener('click', connectBluetooth);
increaseExpirButton.addEventListener('click', () => sendCommand(0, 1));
decreaseExpirButton.addEventListener('click', () => sendCommand(0, 0));
increaseInspirButton.addEventListener('click', () => sendCommand(1, 1));
decreaseInspirButton.addEventListener('click', () => sendCommand(1, 0));
CPAPButton.addEventListener('click', () => changePAPState(0));
BiPAPButton.addEventListener('click', () => changePAPState(1));
APAPButton.addEventListener('click', () => changePAPState(2));

function handlePressureData(event) {
  try {
    const view = event.target.value; 

    if (view.byteLength >= 13) {
      const currentPressure = view.getFloat32(0, true);
      const setExpir        = view.getFloat32(4, true);
      const setInspir       = view.getFloat32(8, true);
      papState = view.getUint8(12)

      document.getElementById('pressureDisplay').innerText =
        currentPressure.toFixed(2) + " cm H2O";
      document.getElementById('setPressureDisplay').innerText =
        setExpir.toFixed(2) + " cm H2O";
      document.getElementById('setInspirDisplay').innerText =
        setInspir.toFixed(2) + " cm H2O";
      updatePapButtons(papState);
    } else {
      document.getElementById('pressureDisplay').innerText =
        `Invalid size (${view.byteLength} bytes, expected 13)`;
    }
  } catch (error) {
    document.getElementById('pressureDisplay').innerText = `Error: ${error.message}`;
  }
}

async function sendCommand(target, action) { 
  console.log("click")
    if (!writeCharacteristic) return;
    
    try {
        await writeChar.writeValue(new Uint8Array([target, action]));
        console.log(`Sent command: ${action} (${value})`);
    } catch (error) {
        console.error("Failed to send command:", error);
    }
}

async function changePAPState(toWhat) {
  if (papState == (toWhat - 1)) {
    sendCommand(2, 1);
  } else if (papState == (toWhat + 1)) {
    sendCommand(2, 0);
  } else if ((papState == 0) && (toWhat == 2)) {
    sendCommand(2, 0);
  } else if ((papState == 2) && (toWhat == 0)) {
    sendCommand(2, 1);
  }
}

async function connectBluetooth() {
    try {
    console.log('Requesting Bluetooth Device...');
    document.getElementById('connect_status').innerText = "Connecting"
    
      // 1. Scan and filter devices
    connectedDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true, 
        optionalServices: [SERVICE_UUID] 
    });

    document.getElementById('connect_status').innerText = "Device found"

    // 2. Connect to the GATT Server
    gattServer = await connectedDevice.gatt.connect();
    document.getElementById('connect_status').innerText = "GATT connected"
    bluetoothService = await gattServer.getPrimaryService(SERVICE_UUID);
    document.getElementById('connect_status').innerText = "Service found"
    pressureCharacteristic = await bluetoothService.getCharacteristic(PRESSURE_CHAR_UUID);
    writeCharacteristic = await bluetoothService.getCharacteristic(WRITE_CHARACTERISTIC_UUID);
    document.getElementById('connect_status').innerText = "Chararacteristic found"
    
    
    await pressureCharacteristic.startNotifications();
    pressureCharacteristic.addEventListener('characteristicvaluechanged', handlePressureData);
    document.getElementById('connect_status').innerText = `Connected to: ${connectedDevice.name}, receiving data`;

  } catch (error) {
    console.error('Bluetooth Error:', error);
    document.getElementById('connect_status').innerText = `Error: ${error.message}`;
  }
}

function updatePapButtons(papState) {
  document.querySelectorAll('.pap-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.pap) === papState);
  });
}
