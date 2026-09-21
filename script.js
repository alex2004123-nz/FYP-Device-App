console.log("JavaScript is successfully connected!");

const button = document.getElementById('bluetoothConnect');
const SERVICE_UUID =  "12345678-1234-1234-1234-123456789abc";
const PRESSURE_CHAR_UUID = "87654321-4321-4321-4321-cba987654321";

let connectedDevice = null;
let gattServer = null;
let bluetoothService = null;
let pressureCharacteristic = null;
let motorControlCharacteristic = null;

button.addEventListener('click', connectBluetooth);

function handlePressureData(event) {
    const value = event.target.value;
    if (valueView.byteLength >= 8) {
      const pressure = value.getFloat64(0, true); 
      // 3. Update your HTML text (formatting it to 2 decimal places so it looks clean)
      document.getElementById('pressure_display').innerText = pressure.toFixed(2) + " PSI";
    }
}

async function connectBluetooth() {
    try {
    console.log('Requesting Bluetooth Device...');
    document.getElementById('connect_status').innerText = "Connecting"
    
      // 1. Scan and filter devices
    connectedDevice = await navigator.bluetooth.requestDevice({
        // This forces the browser to show EVERY local BLE device it finds
        acceptAllDevices: true, 
        
        // CRITICAL: You MUST list the service UUIDs you plan to talk to later, 
        // otherwise the browser blocks you from communicating with them after connection.
        optionalServices: [SERVICE_UUID] 
    });

    document.getElementById('connect_status').innerText = "Device found"

    // 2. Connect to the GATT Server
    gattServer = await connectedDevice.gatt.connect();
    document.getElementById('connect_status').innerText = "GATT connected"
    bluetoothService = await gattServer.getPrimaryService(SERVICE_UUID);
    document.getElementById('connect_status').innerText = "Service found"
    pressureCharacteristic = await bluetoothService.getCharacteristic(PRESSURE_CHAR_UUID);
    document.getElementById('connect_status').innerText = "Chararacteristic found"
    
    
    await pressureCharacteristic.startNotifications();
    pressureCharacteristic.addEventListener('characteristicvaluechanged', handlePressureData);
    document.getElementById('connect_status').innerText = `Connected to: ${connectedDevice.name}, receiving data`;

  } catch (error) {
    console.error('Bluetooth Error:', error);
    document.getElementById('connect_status').innerText = `Error: ${error.message}`;
  }
}
