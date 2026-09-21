console.log("JavaScript is successfully connected!");

const button = document.getElementById('bluetoothConnect');
const increaseButton = document.getElementById('increase');
const decreaseButton = document.getElementById('decrease');

const SERVICE_UUID =  "12345678-1234-1234-1234-123456789abc";
const PRESSURE_CHAR_UUID = "87654321-4321-4321-4321-cba987654321";
const WRITE_CHARACTERISTIC_UUID = "87654321-4321-4321-4321-cba987655676"; 

let connectedDevice = null;
let gattServer = null;
let bluetoothService = null;
let pressureCharacteristic = null;
let writeCharacteristic = null;;
let motorControlCharacteristic = null;

button.addEventListener('click', connectBluetooth);
increaseButton.addEventListener('click', sendCommand('increase'));
decreaseButton.addEventListener('click', sendCommand('decrease'));

function handlePressureData(event) {
  try {
    const value = event.target.value;

    if (value.byteLength >= 8) {
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      for (let i = 0; i < 8; i++) {
          view.setUint8(i, value.getUint8(i));
      }
      // Extract the 64-bit float (double) starting at index 0
      const currentPressure = view.getFloat32(0, true); 
      const setPressure = view.getFloat32(4, true);

      // Update HTML text
      document.getElementById('pressureDisplay').innerText = currentPressure.toFixed(2) + " cm H2O";
      document.getElementById('setPressureDisplay').innerText = setPressure.toFixed(2) + " cm H2O";
    } else {
      document.getElementById('pressureDisplay').innerText = "Invalid size";
    }
  } catch(error) {
    document.getElementById('pressureDisplay').innerText = `Error: ${error.message}`;
  }
}

async function sendCommand(action) {
  console.log("click")
    if (!writeCharacteristic) return;
    
    try {
        // send 1 for increase, 0 for decrease
        const value = (action === 'increase') ? 1 : 0;
       
        const data = new Uint8Array([value]);
        
        await writeCharacteristic.writeValue(data);
        console.log(`Sent command: ${action} (${value})`);
    } catch (error) {
        console.error("Failed to send command:", error);
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
