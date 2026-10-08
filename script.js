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

const RECONNECT_ATTEMPTS = 5;
const PRESSURE_ALARM_CM_H2O = 3.0;  // how far from target counts as off
const PRESSURE_ALARM_MS = 5000;     // how long it must stay off before alarming

// Vibration patterns (ms on/off); vibration only works on Android, other phones ignore it
const TAP = 10;
const ALARM_DISCONNECT = [500, 200, 500, 200, 500];
const ALARM_LINK_LOST = [300, 150, 300, 150, 300];
const ALARM_PRESSURE = [200, 100, 200, 100, 200, 100, 200];

let connectedDevice = null;
let pressureCharacteristic = null;
let writeCharacteristic = null;
let live = false;            // fully connected and receiving
let userDisconnect = false;  // disconnect was asked for, so don't reconnect
let reconnecting = false;
let wakeLock = null;

// Alarm state
let linkWasOk = false;
let offTargetSince = null;
let pressureAlarmOn = false;

// Latest values reported by the ESP32 (null until first telemetry); mode starts in Standby
let device = { ipap: null, epap: null, mode: 0 };

const $ = (id) => document.getElementById(id);

$('bluetoothConnect').addEventListener('click', onConnectButton);
render();
startupConnect();

// Connect when disconnected, disconnect when connected, cancel while reconnecting
function onConnectButton() {
  buzz(TAP);
  if (reconnecting) {
    cancelReconnect();
  } else if (connectedDevice && connectedDevice.gatt.connected) {
    userDisconnect = true;
    connectedDevice.gatt.disconnect(); // fires 'gattserverdisconnected' -> onDisconnected()
  } else {
    connectBluetooth();
  }
}

// Button text/state: 'idle' | 'busy' | 'connected' | 'reconnecting'
function setButton(state) {
  const btn = $('bluetoothConnect');
  btn.disabled = state === 'busy';
  $('btLabel').innerText =
    state === 'connected' ? 'Disconnect' :
    state === 'reconnecting' ? 'Cancel' :
    state === 'busy' ? 'Connecting…' : 'Connect Bluetooth';
}

function buzz(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  } else {
    iosHaptic();
  }
}

// iPhones have no vibrate API, but since iOS 18 toggling a native "switch" checkbox
// gives a haptic tick. Only works during a tap, so alarms stay silent on iPhone.
function iosHaptic() {
  try {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.style.display = 'none';
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    label.remove();
  } catch (error) {
    // no haptics available
  }
}

// Keep the screen from dimming/locking while connected
async function keepScreenOn(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (error) {
    console.warn('Wake lock:', error);
  }
}
// The browser drops the wake lock when the app is hidden; take it again on return
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (live || reconnecting)) keepScreenOn(true);
});

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
    buzz(TAP);
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
  buzz(TAP);
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
    // Phase is only known from 18-byte packets
    Trend.add(pressure, setpoint, v.byteLength >= 18 ? (v.getUint8(17) & 0x01) !== 0 : null);

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
      checkAlarms(pressure, setpoint, (flags & 0x02) !== 0);
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

// Vibrate once when the valve link drops, or when the pressure has been
// far from target for a while (not in Standby)
function checkAlarms(pressure, setpoint, linkOk) {
  if (linkWasOk && !linkOk) buzz(ALARM_LINK_LOST);
  linkWasOk = linkOk;

  const offTarget = MODE_NAMES[device.mode] !== 'STANDBY' &&
    Math.abs(pressure - setpoint) > PRESSURE_ALARM_CM_H2O;
  if (!offTarget) {
    offTargetSince = null;
    pressureAlarmOn = false;
  } else if (offTargetSince === null) {
    offTargetSince = Date.now();
  } else if (!pressureAlarmOn && Date.now() - offTargetSince > PRESSURE_ALARM_MS) {
    pressureAlarmOn = true;
    buzz(ALARM_PRESSURE);
  }
}

function resetAlarms() {
  linkWasOk = false;
  offTargetSince = null;
  pressureAlarmOn = false;
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
// fromStartup: opened without a tap, so a "needs a tap" refusal is expected and kept quiet
async function connectBluetooth({ fromStartup = false } = {}) {
  stopWaitingForTap();
  try {
    setButton('busy');
    setStatus("Connecting");

    connectedDevice = await navigator.bluetooth.requestDevice({
      // Only list the PAP device (matched by its service, or by name as a fallback)
      filters: [{ services: [SERVICE_UUID] }, { namePrefix: "PAP" }],
      optionalServices: [SERVICE_UUID],
    });
    // Remove first: picking the same device again can return the same object
    connectedDevice.removeEventListener('gattserverdisconnected', onDisconnected);
    connectedDevice.addEventListener('gattserverdisconnected', onDisconnected);
    setStatus("Device found");

    Trend.clear(); // fresh graph for a new connection (reconnects keep the history)
    await openGatt();
    markConnected();
  } catch (error) {
    setButton(connectedDevice && connectedDevice.gatt.connected ? 'connected' : 'idle');
    if (fromStartup && (error.name === 'SecurityError' || error.name === 'NotFoundError')) {
      // Refused without a tap (Chrome), or the list was closed: just stay ready
      setStatus("Not connected yet...");
      return error;
    }
    console.error('Bluetooth Error:', error);
    setStatus(`Error: ${friendlyError(error)}`);
    return error;
  }
  return null;
}

// GATT connect + characteristics + notifications (used for first connect and reconnects)
async function openGatt() {
  const gattServer = await connectedDevice.gatt.connect();
  setStatus("GATT connected");

  const service = await gattServer.getPrimaryService(SERVICE_UUID);
  setStatus("Service found");

  pressureCharacteristic = await service.getCharacteristic(PRESSURE_CHAR_UUID);
  writeCharacteristic = await service.getCharacteristic(WRITE_CHARACTERISTIC_UUID);
  setStatus("Characteristics found");

  await pressureCharacteristic.startNotifications();
  pressureCharacteristic.removeEventListener('characteristicvaluechanged', handlePressureData);
  pressureCharacteristic.addEventListener('characteristicvaluechanged', handlePressureData);
}

function markConnected() {
  live = true;
  setStatus(`Connected to ${connectedDevice.name || 'device'}`);
  setButton('connected');
  keepScreenOn(true);
  Trend.setLive(true);
}

function onDisconnected() {
  const wasLive = live;
  live = false;
  Trend.setLive(false);
  writeCharacteristic = null;
  pressureCharacteristic = null;
  device = { ipap: null, epap: null, mode: 0 };
  render();
  resetAlarms();
  $('linkDisplay').innerText = "--";

  if (reconnecting) return; // the reconnect loop carries on
  if (wasLive && !userDisconnect) {
    buzz(ALARM_DISCONNECT);
    reconnect();
    return;
  }
  userDisconnect = false;
  setStatus("Disconnected");
  setButton('idle');
  keepScreenOn(false);
}

// Unexpected drop: try the same device again a few times, waiting a bit longer each time.
// Also used by autoConnect() on start-up, with its own wording.
async function reconnect(label = 'Reconnecting', failText = 'Error: reconnect failed') {
  reconnecting = true;
  setButton('reconnecting');
  for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
    setStatus(`${label} (${attempt}/${RECONNECT_ATTEMPTS})`);
    try {
      await openGatt();
      if (!reconnecting) { // cancelled while connecting
        connectedDevice.gatt.disconnect();
        return null;
      }
      reconnecting = false;
      markConnected();
      return true;
    } catch (error) {
      console.warn(`Reconnect ${attempt} failed:`, error);
    }
    if (!reconnecting) return null;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    if (!reconnecting) return null;
  }
  reconnecting = false;
  setStatus(failText);
  setButton('idle');
  keepScreenOn(false);
  return false;
}

// On start-up, connect straight to a PAP device this site was allowed to use before.
// Needs getDevices(), which only some browsers have (Chrome currently behind a flag);
// anywhere else nothing happens and the Connect button works as usual.
// Returns true connected, false not possible / gave up, null cancelled by the user
async function autoConnect() {
  if (!navigator.bluetooth.getDevices) return false;
  let devices = [];
  try {
    devices = await navigator.bluetooth.getDevices();
  } catch (error) {
    console.warn('getDevices:', error);
    return false;
  }
  const known = devices.find((d) => (d.name || '').startsWith('PAP')) || devices[0];
  if (!known) return false;
  connectedDevice = known;
  connectedDevice.removeEventListener('gattserverdisconnected', onDisconnected);
  connectedDevice.addEventListener('gattserverdisconnected', onDisconnected);
  return reconnect(`Looking for ${known.name || 'PAP device'}`, 'Not connected yet...');
}

// On opening the app:
//  1. reconnect to a remembered device if the browser allows it (autoConnect)
//  2. otherwise open the device list straight away; some browsers allow this without a tap
//  3. if the browser insists on a tap (Chrome), the first tap anywhere opens the list
async function startupConnect() {
  if (!navigator.bluetooth) return; // no Bluetooth in this browser: leave the page as it is
  const auto = await autoConnect();
  if (auto !== false || userActed()) return; // connected, cancelled, or the user already tapped Connect
  const error = await connectBluetooth({ fromStartup: true });
  if (error && error.name === 'SecurityError' && !userActed()) waitForTap();
}

// The user has started connecting or is connected, so start-up should stay out of the way
function userActed() {
  return live || reconnecting || $('bluetoothConnect').disabled;
}

// Any tap on the page opens the device list (header switches and the connect button keep their own jobs)
function onAnyTap(event) {
  if (event.target.closest('.topbar, #bluetoothConnect')) return;
  if (userActed()) { stopWaitingForTap(); return; }
  // This tap only opens the list, so it doesn't also press whatever was under it (e.g. a mode button)
  event.preventDefault();
  event.stopPropagation();
  buzz(TAP);
  connectBluetooth();
}
function waitForTap() {
  setStatus("Tap anywhere to connect");
  document.addEventListener('click', onAnyTap, true);
}
function stopWaitingForTap() {
  document.removeEventListener('click', onAnyTap, true);
}

function cancelReconnect() {
  reconnecting = false;
  if (connectedDevice) connectedDevice.gatt.disconnect(); // also stops a connect in progress
  setStatus("Disconnected");
  setButton('idle');
  keepScreenOn(false);
}

// Offline support (see sw.js)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker:', error));
}
