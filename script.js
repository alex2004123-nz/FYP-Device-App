// ============================================================
// PAP Device app  <--BLE-->  ESP32  <--UART-->  PEEP valve
//
// Phone -> ESP32 (write, UTF-8 text):
//   "IPAP=12.5", "EPAP=5.0", "MODE=STANDBY" | "MODE=CPAP" | "MODE=BIPAP"
//
// ESP32 -> Phone (notify, 22 bytes, little-endian; 18-byte packets still accepted):
//   [0]  float32 PEEP valve pressure [4]  float32 active setpoint
//   [8]  float32 flow (L/min)        [12] int16 IPAP x100
//   [14] int16 EPAP x100             [16] uint8 mode (0/1/2)
//   [17] uint8 flags (bit0 inspiratory, bit1 valve link OK, bit2 blower sensor OK)
//   [18] float32 blower pressure
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

// Latest values reported by the ESP32 (null until first telemetry); mode starts in Standby
let device = { ipap: null, epap: null, mode: 0 };

const $ = (id) => document.getElementById(id);

$('bluetoothConnect').addEventListener('click', onConnectButton);
render();

// Connect when disconnected, disconnect when connected
function onConnectButton() {
  if (connectedDevice && connectedDevice.gatt.connected) {
    connectedDevice.gatt.disconnect(); // fires 'gattserverdisconnected' -> onDisconnected()
  } else {
    connectBluetooth();
  }
}

// Button text/state: 'idle' | 'busy' | 'connected'
function setButton(state) {
  const btn = $('bluetoothConnect');
  btn.disabled = state === 'busy';
  $('btLabel').innerText =
    state === 'connected' ? 'Disconnect' :
    state === 'busy' ? 'Connecting…' : 'Connect Bluetooth';
}

// Short, readable versions of the common Web Bluetooth errors
function friendlyError(error) {
  if (!navigator.bluetooth) return 'this browser has no Bluetooth';
  switch (error && error.name) {
    case 'NotFoundError':    return 'no device chosen';
    case 'NetworkError':     return 'connection lost';
    case 'SecurityError':    return 'Bluetooth blocked (needs https)';
    case 'NotSupportedError':return 'not supported here';
    default:                 return (error && error.message) || 'unknown';
  }
}

// Status text: short so it fits on a phone; the full text is in the tooltip
function setStatus(text) {
  const el = $('connect_status');
  el.innerText = text;
  el.title = text;
}
$('ipapUp').addEventListener('click', () => adjust('IPAP', +STEP_CM_H2O));
$('ipapDown').addEventListener('click', () => adjust('IPAP', -STEP_CM_H2O));
$('epapUp').addEventListener('click', () => adjust('EPAP', +STEP_CM_H2O));
$('epapDown').addEventListener('click', () => adjust('EPAP', -STEP_CM_H2O));
document.querySelectorAll('.mode_btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    // Update the screen straight away; the next telemetry confirms it
    device.mode = MODE_NAMES.indexOf(btn.dataset.mode);
    render();
    sendText(`MODE=${btn.dataset.mode}`);
  })
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
    // Number and unit are separate so the unit can be smaller and the reading fits on phones
    const unit = document.createElement('span');
    unit.className = 'p_unit';
    unit.textContent = 'cm H₂O';
    $('pressureDisplay').replaceChildren(pressure.toFixed(2), unit);
    $('setPressureDisplay').innerText = setpoint.toFixed(2) + " cm H₂O";

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

    if (v.byteLength >= 22 && (v.getUint8(17) & 0x04)) {
      const blower = v.getFloat32(18, true);
      $('blowerDisplay').innerText = blower.toFixed(2) + " cm H₂O";
    } else {
      $('blowerDisplay').innerText = "--";
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

  // CPAP uses a single pressure (sent as EPAP); BiPAP shows IPAP and EPAP separately;
  // Standby shows no pressure controls
  const mode = MODE_NAMES[device.mode];
  const isCpap = mode === 'CPAP';
  const isStandby = mode === 'STANDBY';
  $('ipapCard').style.display = (isCpap || isStandby) ? 'none' : '';
  $('epapCard').style.display = isStandby ? 'none' : '';
  $('epapTitle').innerText = isCpap ? 'CPAP' : 'Expiratory (EPAP)';
}

// ------------------------------------------------------------
// Connection
// ------------------------------------------------------------
async function connectBluetooth() {
  try {
    setButton('busy');
    setStatus("Connecting");

    connectedDevice = await navigator.bluetooth.requestDevice({
      // Only list the PAP device (matched by its service, or by name as a fallback)
      filters: [{ services: [SERVICE_UUID] }, { namePrefix: "PAP" }],
      optionalServices: [SERVICE_UUID],
    });
    connectedDevice.addEventListener('gattserverdisconnected', onDisconnected);
    setStatus("Device found");

    const gattServer = await connectedDevice.gatt.connect();
    setStatus("GATT connected");

    const service = await gattServer.getPrimaryService(SERVICE_UUID);
    setStatus("Service found");

    pressureCharacteristic = await service.getCharacteristic(PRESSURE_CHAR_UUID);
    writeCharacteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC_UUID);
    setStatus("Characteristics found");

    await pressureCharacteristic.startNotifications();
    pressureCharacteristic.addEventListener('characteristicvaluechanged', handlePressureData);
    setStatus(`Connected to ${connectedDevice.name || 'device'}`);
    setButton('connected');
  } catch (error) {
    console.error('Bluetooth Error:', error);
    setStatus(`Error: ${friendlyError(error)}`);
    setButton(connectedDevice && connectedDevice.gatt.connected ? 'connected' : 'idle');
  }
}

function onDisconnected() {
  writeCharacteristic = null;
  pressureCharacteristic = null;
  device = { ipap: null, epap: null, mode: 0 };
  render();
  setStatus("Disconnected");
  setButton('idle');
  $('linkDisplay').innerText = "--";
}
