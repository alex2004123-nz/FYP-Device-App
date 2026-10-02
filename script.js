// ============================================================
// PAP Device app  <--BLE-->  ESP32  <--UART-->  PEEP valve
//
// Phone -> ESP32 (write, UTF-8 text):
//   "IPAP=12.5", "EPAP=5.0", "MODE=STANDBY" | "MODE=CPAP" | "MODE=BIPAP"
//
// ESP32 -> Phone (notify, 18 bytes, little-endian):
//   [0]  float32 measured pressure   [4]  float32 active setpoint
//   [8]  float32 flow (L/min)        [12] int16 IPAP x100
//   [14] int16 EPAP x100             [16] uint8 mode (0/1/2)
//   [17] uint8 flags (bit0 inspiratory, bit1 valve link OK)
// ============================================================

const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const PRESSURE_CHAR_UUID = "87654321-4321-4321-4321-cba987654321";
const WRITE_CHARACTERISTIC_UUID = "87654321-4321-4321-4321-cba987655676";

const STEP_CM_H2O = 0.5;
const MIN_CM_H2O = 4.0;
const MAX_CM_H2O = 18.0;
const MODE_NAMES = ["STANDBY", "CPAP", "BIPAP"];

let connectedDevice = null;
let pressureCharacteristic = null;
let writeCharacteristic = null;

// Latest values reported by the ESP32 (null until first telemetry)
let device = { ipap: null, epap: null, mode: null };

const $ = (id) => document.getElementById(id);

$('bluetoothConnect').addEventListener('click', connectBluetooth);
$('ipapUp').addEventListener('click', () => adjust('IPAP', +STEP_CM_H2O));
$('ipapDown').addEventListener('click', () => adjust('IPAP', -STEP_CM_H2O));
$('epapUp').addEventListener('click', () => adjust('EPAP', +STEP_CM_H2O));
$('epapDown').addEventListener('click', () => adjust('EPAP', -STEP_CM_H2O));
document.querySelectorAll('.mode_btn').forEach((btn) =>
  btn.addEventListener('click', () => sendText(`MODE=${btn.dataset.mode}`))
);

// ------------------------------------------------------------
// Sending
// ------------------------------------------------------------
async function sendText(text) {
  if (!writeCharacteristic) return;
  try {
    await writeCharacteristic.writeValue(new TextEncoder().encode(text));
    console.log(`Sent: ${text}`);
  } catch (error) {
    console.error("Failed to send command:", error);
  }
}

function adjust(which, delta) {
  const current = which === 'IPAP' ? device.ipap : device.epap;
  if (current === null) return; // wait for first telemetry
  const next = Math.min(MAX_CM_H2O, Math.max(MIN_CM_H2O, current + delta));
  // Update the screen straight away; the next telemetry confirms it
  if (which === 'IPAP') device.ipap = next; else device.epap = next;
  render();
  sendText(`${which}=${next.toFixed(1)}`);
}

// ------------------------------------------------------------
// Receiving
// ------------------------------------------------------------
function handlePressureData(event) {
  const v = event.target.value; // DataView
  try {
    if (v.byteLength < 8) {
      $('pressureDisplay').innerText = "Invalid size";
      return;
    }
    const pressure = v.getFloat32(0, true);
    const setpoint = v.getFloat32(4, true);
    $('pressureDisplay').innerText = pressure.toFixed(2) + " cm H2O";
    $('setPressureDisplay').innerText = setpoint.toFixed(2) + " cm H2O";

    if (v.byteLength >= 18) {
      const flow = v.getFloat32(8, true);
      device.ipap = v.getInt16(12, true) / 100;
      device.epap = v.getInt16(14, true) / 100;
      device.mode = v.getUint8(16);
      const flags = v.getUint8(17);

      $('flowDisplay').innerText = flow.toFixed(1) + " L/min";
      $('phaseDisplay').innerText = (flags & 0x01) ? "Inspiratory" : "Expiratory";
      $('linkDisplay').innerText = (flags & 0x02) ? "OK" : "LOST";
      render();
    }
  } catch (error) {
    $('pressureDisplay').innerText = `Error: ${error.message}`;
  }
}

function render() {
  if (device.ipap !== null) $('ipapDisplay').innerText = device.ipap.toFixed(1);
  if (device.epap !== null) $('epapDisplay').innerText = device.epap.toFixed(1);
  document.querySelectorAll('.mode_btn').forEach((btn) =>
    btn.classList.toggle('active', MODE_NAMES[device.mode] === btn.dataset.mode)
  );
}

// ------------------------------------------------------------
// Connection
// ------------------------------------------------------------
async function connectBluetooth() {
  try {
    $('connect_status').innerText = "Connecting";

    connectedDevice = await navigator.bluetooth.requestDevice({
      // Only list the PAP device (matched by its service, or by name as a fallback)
      filters: [{ services: [SERVICE_UUID] }, { namePrefix: "PAP" }],
      optionalServices: [SERVICE_UUID],
    });
    connectedDevice.addEventListener('gattserverdisconnected', onDisconnected);
    $('connect_status').innerText = "Device found";

    const gattServer = await connectedDevice.gatt.connect();
    $('connect_status').innerText = "GATT connected";

    const service = await gattServer.getPrimaryService(SERVICE_UUID);
    $('connect_status').innerText = "Service found";

    pressureCharacteristic = await service.getCharacteristic(PRESSURE_CHAR_UUID);
    writeCharacteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC_UUID);
    $('connect_status').innerText = "Characteristics found";

    await pressureCharacteristic.startNotifications();
    pressureCharacteristic.addEventListener('characteristicvaluechanged', handlePressureData);
    $('connect_status').innerText = `Connected to: ${connectedDevice.name}, receiving data`;
  } catch (error) {
    console.error('Bluetooth Error:', error);
    $('connect_status').innerText = `Error: ${error.message}`;
  }
}

function onDisconnected() {
  writeCharacteristic = null;
  pressureCharacteristic = null;
  device = { ipap: null, epap: null, mode: null };
  $('connect_status').innerText = "Disconnected - tap Connect Bluetooth";
  $('linkDisplay').innerText = "--";
}
