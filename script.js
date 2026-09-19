console.log("JavaScript is successfully connected!");

const button = document.getElementById('bluetoothConnect');
const SERVICE_UUID =  "12345678-1234-1234-1234-123456789abc";

button.addEventListener('click', connectBluetooth);

function handlePressureData(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(value);
    
    // Update your HTML
    document.getElementById('display').innerText = text;
}

async function connectBluetooth() {
    try {
    console.log('Requesting Bluetooth Device...');
    
    // 1. Scan and filter devices
  const device = await navigator.bluetooth.requestDevice({
      // This forces the browser to show EVERY local BLE device it finds
      acceptAllDevices: true, 
      
      // CRITICAL: You MUST list the service UUIDs you plan to talk to later, 
      // otherwise the browser blocks you from communicating with them after connection.
      optionalServices: ['12345678-1234-1234-1234-123456789abc'] // Replace with your ESP32 Service UUID
  });

    console.log(`Connected to: ${device.name}`);

    // 2. Connect to the GATT Server
    const server = await device.gatt.connect();

    const service = await server.getPrimaryService(SERVICE_UUID);

    const pressure_read = await service.getCharacteristic("Pressure");

    // 5. Read the Value
    const value = await pressure_read.readValue();
    await pressure_read.startNotifications();
    
    // Data arrives as a DataView, extract the unsigned 8-bit integer
    const pressure = value.getUint8(0);

    pressure_read.addEventListener('characteristicvaluechanged', handlePressureData);

  } catch (error) {
    console.error('Bluetooth Error:', error);
  }
}
