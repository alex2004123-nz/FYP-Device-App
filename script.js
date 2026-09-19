console.log("JavaScript is successfully connected!");

const button = document.getElementById('bluetoothConnect');

button.addEventListener('click', connectBluetooth);

async function connectBluetooth() {
    try {
    console.log('Requesting Bluetooth Device...');
    
    // 1. Scan and filter devices
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['battery_service'] }] // Can filter by standard string name or 16/128-bit UUIDs
    });

    console.log(`Connected to: ${device.name}`);

    // 2. Connect to the GATT Server
    const server = await device.gatt.connect();

    // 3. Get the Battery Service
    const service = await server.getPrimaryService('battery_service');

    // 4. Get the Battery Level Characteristic
    const characteristic = await service.getCharacteristic('battery_level');

    // 5. Read the Value
    const value = await characteristic.readValue();
    
    // Data arrives as a DataView, extract the unsigned 8-bit integer
    const batteryLevel = value.getUint8(0);
    console.log(`Battery Level is ${batteryLevel}%`);

  } catch (error) {
    console.error('Bluetooth Error:', error);
  }
}
