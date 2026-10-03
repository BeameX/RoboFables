/**
 * Web Serial transport for the same dongle protocol as src/robofables_link/hub.py.
 *
 * Bytes below are copied from that module (ping, discover, joint set-position).
 * LED and wheel/spin are not implemented and are refused if a payload is not
 * one of those three. The browser port picker replaces COM-port listing.
 */
const DONGLE_VID = 0x03eb;
const DONGLE_PID = 0xfabe;
const BAUD = 500000;
const PING = 0xff;
const ACK = 0x41; // ord("A")
const HASH = 0x23; // ord("#")
const RADIO_HDR = 0xfe;
const DISCOVER_CMD_EF = 0xef;
const PACKET_DELAYED_PING = 0xee;
const PACKET_SYNC = 0xfc;
const MODULE_JOINT = 3;
const DEFAULT_JOINT_ID = 0xa2;
const JOINT_POS_X_ADR = [62, 63];
const JOINT_POS_Y_ADR = [84, 85];
const JOINT_DEG_SCALE = 3.41333333;
const BROADCAST = 0xff;
const DISCOVER_DELAY_MS = 25;

const MODULE_TYPE_NAMES = {
  255: 'Any',
  0: 'Development',
  1: 'Dongle',
  2: 'Head',
  3: 'Joint',
  4: 'Spin',
  5: 'Face',
  6: 'Branch4Way',
  7: 'Foot1Way',
};

export const UNSUPPORTED_MESSAGE =
  'Firefox and Safari cannot use the USB dongle. Open this page in Chrome or Edge.';

export function supported() {
  return typeof navigator !== 'undefined' && !!navigator.serial;
}

export function unsupportedMessage() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const firefox = /Firefox\//.test(ua);
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  if (firefox || safari) return UNSUPPORTED_MESSAGE;
  return 'This page cannot see the USB dongle here. Open it in Chrome or Edge on https or localhost.';
}

/** Python 3 round() (half even), then the joint raw formula in hub.deg_to_joint_raw. */
function pyRound(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const fl = Math.floor(ax);
  const frac = ax - fl;
  let r;
  if (Math.abs(frac - 0.5) < 1e-9) r = fl % 2 === 0 ? fl : fl + 1;
  else r = Math.round(ax);
  return sign * r;
}

function cropJointDeg(deg) {
  const n = Number(deg);
  if (n < -90) return -90;
  if (n > 90) return 90;
  return n;
}

function degToJointRaw(deg) {
  return pyRound(JOINT_DEG_SCALE * cropJointDeg(deg) + 512);
}

export function encodeJointPos(degX, degY) {
  const rawX = degToJointRaw(degX);
  const rawY = degToJointRaw(degY);
  const [ax0, ax1] = JOINT_POS_X_ADR;
  const [ay0, ay1] = JOINT_POS_Y_ADR;
  return [
    ax0, rawX & 0xff,
    ax1, (rawX >> 8) & 0xff,
    ay0, rawY & 0xff,
    ay1, (rawY >> 8) & 0xff,
  ];
}

export function buildJointSetPosFrame(moduleId, degX, degY) {
  const payload = [MODULE_JOINT, moduleId & 0xff, PACKET_SYNC, ...encodeJointPos(degX, degY)];
  assertAllowedPayload(payload);
  return new Uint8Array([RADIO_HDR, payload.length, ...payload]);
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if ((a[i] & 0xff) !== (b[i] & 0xff)) return false;
  return true;
}

/** Refuse anything that is not hub ping, the two discover payloads, or joint sync. */
function assertAllowedPayload(payload) {
  const discoverA = [BROADCAST, BROADCAST, PACKET_DELAYED_PING, DISCOVER_DELAY_MS];
  const discoverB = [BROADCAST, BROADCAST, DISCOVER_CMD_EF];
  if (bytesEqual(payload, discoverA) || bytesEqual(payload, discoverB)) return;
  if (
    payload.length === 11 &&
    payload[0] === MODULE_JOINT &&
    payload[2] === PACKET_SYNC &&
    payload[3] === JOINT_POS_X_ADR[0] &&
    payload[5] === JOINT_POS_X_ADR[1] &&
    payload[7] === JOINT_POS_Y_ADR[0] &&
    payload[9] === JOINT_POS_Y_ADR[1]
  ) {
    return;
  }
  throw new Error('refusing radio payload (LED and wheels stay off)');
}

function frameRadio(payload) {
  assertAllowedPayload(payload);
  return new Uint8Array([RADIO_HDR, payload.length, ...payload]);
}

function toHex(u8) {
  if (!u8 || !u8.length) return '(empty)';
  const arr = u8 instanceof Uint8Array ? u8 : Uint8Array.from(u8);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function parseModuleFrames(buf) {
  const hits = [];
  const b = buf instanceof Uint8Array ? buf : Uint8Array.from(buf || []);
  let i = 0;
  while (i < b.length) {
    if (b[i] === HASH && i + 5 <= b.length && b[i + 1] === 3) {
      hits.push({ type_id: b[i + 2], module_id: b[i + 3], status: b[i + 4], serial: '' });
      i += 5;
      continue;
    }
    if (b[i] === HASH && i + 10 <= b.length && b[i + 1] === 8) {
      let serial = '';
      for (let k = i + 6; k < i + 10; k++) {
        const c = b[k];
        serial += c >= 32 && c < 127 ? String.fromCharCode(c) : '?';
      }
      hits.push({ type_id: b[i + 2], module_id: b[i + 3], status: b[i + 4], serial });
      i += 10;
      continue;
    }
    i += 1;
  }
  const best = new Map();
  for (const h of hits) {
    const key = `${h.type_id}:${h.module_id}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, h);
      continue;
    }
    const hAck = h.status === ACK;
    const pAck = prev.status === ACK;
    let keep = hAck && !pAck ? h : prev;
    if (h.serial && !keep.serial) {
      keep = { type_id: keep.type_id, module_id: keep.module_id, status: keep.status, serial: h.serial };
    } else if (prev.serial && hAck && !pAck) {
      keep = { type_id: h.type_id, module_id: h.module_id, status: h.status, serial: prev.serial };
    }
    best.set(key, keep);
  }
  return [...best.values()].map(decorateHit);
}

function decorateHit(h) {
  const known = { [ACK]: 'ACK', 0x4e: 'NACK', 0x53: 'STOP_ACK' };
  return {
    type_id: h.type_id,
    module_id: h.module_id,
    status: h.status,
    serial: (h.serial || '').trim(),
    type_name: MODULE_TYPE_NAMES[h.type_id] || `type${h.type_id}`,
    acked: h.status === ACK,
    status_name: known[h.status] || `0x${h.status.toString(16).toUpperCase()}`,
  };
}

function preferJointTarget(modules) {
  for (const m of modules) {
    if (m.type_id === MODULE_JOINT) return m.module_id & 0xff;
  }
  return DEFAULT_JOINT_ID;
}

function discoverMessage(modules) {
  const lines = modules
    .map((m) => `${m.type_name} id=0x${m.module_id.toString(16).toUpperCase()} (${m.status_name})` + (m.serial ? ` serial=${JSON.stringify(m.serial)}` : ''))
    .join(', ');
  if (modules.every((m) => m.acked)) return `Radio OK — module seen: ${lines}.`;
  return `Radio: module replied: ${lines}. The reply was not a clear OK. Match the colour, turn the module on, and check the type.`;
}

class ByteQueue {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  push(u8) {
    if (!u8 || !u8.length) return;
    this.chunks.push(u8);
    this.length += u8.length;
  }
  clear() {
    this.chunks = [];
    this.length = 0;
  }
  take(n) {
    if (n == null || n > this.length) n = this.length;
    if (n <= 0) return new Uint8Array(0);
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n && this.chunks.length) {
      const c = this.chunks[0];
      const need = n - filled;
      if (c.length <= need) {
        out.set(c, filled);
        filled += c.length;
        this.chunks.shift();
      } else {
        out.set(c.subarray(0, need), filled);
        this.chunks[0] = c.subarray(need);
        filled += need;
      }
    }
    this.length -= filled;
    return out;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let moduleId = DEFAULT_JOINT_ID;
let selected = null;
let selectedKey = '';
let selectedLabel = '';
let lastPicked = null;
const portKeys = new WeakMap();
let keySeq = 1;
let io = null;
let opChain = Promise.resolve();

function portKey(port) {
  if (!portKeys.has(port)) portKeys.set(port, `webserial:${keySeq++}`);
  return portKeys.get(port);
}

function describePort(port) {
  const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
  const vid = info.usbVendorId == null ? null : info.usbVendorId;
  const pid = info.usbProductId == null ? null : info.usbProductId;
  const likely = vid === DONGLE_VID && pid === DONGLE_PID;
  const hex = (n) => (n == null ? '????' : n.toString(16).toUpperCase().padStart(4, '0'));
  const id = vid == null && pid == null ? 'USB serial' : `${hex(vid)}:${hex(pid)}`;
  const description = likely ? `USB dongle ${id}` : id;
  return {
    device: portKey(port),
    description,
    likely_hub: likely,
    vid,
    pid,
  };
}

function exclusive(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.then(() => {}, () => {});
  return run;
}

async function closeIo() {
  const cur = io;
  io = null;
  if (!cur) return;
  try { await cur.reader.cancel(); } catch (_) { /* already closed */ }
  try { cur.reader.releaseLock(); } catch (_) { /* released */ }
  try { cur.writer.releaseLock(); } catch (_) { /* released */ }
  try { await cur.port.close(); } catch (_) { /* already closed */ }
}

async function ensureOpen() {
  if (!selected) throw new Error('select port first');
  if (io && io.port === selected && !io.readError && selected.readable && selected.writable) return;
  await closeIo();
  await selected.open({
    baudRate: BAUD,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
  });
  // pyserial raises DTR and RTS on open. Match that; ignore if the driver refuses.
  try {
    await selected.setSignals({ dataTerminalReady: true, requestToSend: true });
  } catch (_) { /* optional line state */ }
  const queue = new ByteQueue();
  const reader = selected.readable.getReader();
  const writer = selected.writable.getWriter();
  const session = { port: selected, reader, writer, queue, readError: null };
  io = session;
  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && io === session) session.queue.push(value);
      }
    } catch (e) {
      session.readError = e;
    }
  })();
}

async function readFor(ms, pred) {
  const end = Date.now() + ms;
  const parts = [];
  while (Date.now() < end) {
    if (io && io.readError) break;
    const got = io.queue.take();
    if (got.length) {
      parts.push(got);
      if (pred) {
        const merged = concatBytes(parts);
        if (pred(merged)) return merged;
      }
      continue;
    }
    const slice = Math.min(15, end - Date.now());
    if (slice <= 0) break;
    await sleep(slice);
  }
  return concatBytes(parts);
}

async function writeRaw(u8) {
  await ensureOpen();
  io.queue.clear();
  await io.writer.write(u8);
}

function parseModuleId(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    const n = /^0x/i.test(t) ? parseInt(t, 16) : parseInt(t, 10);
    if (!Number.isFinite(n)) return null;
    return n & 0xff;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n & 0xff;
}

export async function health() {
  return {
    ok: true,
    service: 'RoboFables web serial',
    via: 'navigator.serial',
    gates: { LED: false, SPIN: false, USB_TX_JOINT: true },
    port: selected ? selectedLabel : null,
    module_id: moduleId,
    module_type: MODULE_JOINT,
  };
}

export async function listPorts() {
  if (!supported()) return { ok: false, error: unsupportedMessage(), ports: [] };
  const ports = await navigator.serial.getPorts();
  let rows = ports.map((p) => ({ ...describePort(p), _port: p }));
  rows.sort((a, b) => Number(b.likely_hub) - Number(a.likely_hub));
  if (lastPicked) {
    const idx = rows.findIndex((r) => r._port === lastPicked);
    if (idx > 0) {
      const [hit] = rows.splice(idx, 1);
      rows.unshift(hit);
    }
  }
  return {
    ok: true,
    ports: rows.map(({ _port, ...rest }) => rest),
  };
}

/** User gesture: browser port picker (Allow). */
export async function pickPort() {
  if (!supported()) {
    const err = new Error(unsupportedMessage());
    err.name = 'NotSupportedError';
    throw err;
  }
  const port = await navigator.serial.requestPort();
  lastPicked = port;
  const meta = describePort(port);
  selected = port;
  selectedKey = meta.device;
  selectedLabel = meta.description;
  return meta;
}

export async function selectPort(device) {
  if (!supported()) return { ok: false, error: unsupportedMessage() };
  const want = String(device || '').trim();
  if (!want) return { ok: false, error: 'port required' };
  const ports = await navigator.serial.getPorts();
  const port = ports.find((p) => portKey(p) === want);
  if (!port) return { ok: false, error: 'port required' };
  selected = port;
  selectedKey = want;
  const meta = describePort(port);
  selectedLabel = meta.description;
  try {
    await exclusive(() => ensureOpen());
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  return { ok: true, port: selectedLabel, device: selectedKey };
}

export async function selectModule(module_id) {
  const mid = parseModuleId(module_id);
  if (mid == null) return { ok: false, error: 'bad module_id' };
  moduleId = mid;
  return { ok: true, module_id: moduleId };
}

export async function pingHub() {
  return exclusive(async () => {
    if (!selected) return { ok: false, tx_hex: '', rx_hex: '(error)', message: 'select port first', error: 'select port first' };
    const tx = new Uint8Array([PING]);
    const txHex = toHex(tx);
    try {
      await writeRaw(tx);
      const buf = await readFor(400, (b) => b.includes(ACK));
      const rxHex = toHex(buf);
      if (buf.includes(ACK)) {
        return {
          ok: true,
          tx_hex: txHex,
          rx_hex: rxHex,
          message: 'USB link to the dongle is OK. This does not prove the robot can hear it.',
        };
      }
      if (!buf.length) {
        return { ok: false, tx_hex: txHex, rx_hex: rxHex, message: 'Timeout — no bytes. Check the USB cable.' };
      }
      return {
        ok: false,
        tx_hex: txHex,
        rx_hex: rxHex,
        message: `Response without ACK (first byte 0x${buf[0].toString(16).toUpperCase()}).`,
      };
    } catch (e) {
      return { ok: false, tx_hex: txHex, rx_hex: '(error)', message: `Serial error: ${e.message || e}`, error: String(e.message || e) };
    }
  });
}

export async function discover() {
  return exclusive(async () => {
    if (!selected) {
      return { ok: false, modules: [], module_id: moduleId, serial: '', message: 'select port first', error: 'select port first', tx_hex: '', rx_hex: '' };
    }
    const attempts = [
      [BROADCAST, BROADCAST, PACKET_DELAYED_PING, DISCOVER_DELAY_MS],
      [BROADCAST, BROADCAST, DISCOVER_CMD_EF],
    ];
    const allTx = [];
    const rxParts = [];
    try {
      const per = 1200 / attempts.length;
      for (const payload of attempts) {
        const frame = frameRadio(payload);
        allTx.push(toHex(frame));
        await writeRaw(frame);
        // hub.py _write_radio reads one status byte and discards it.
        const first = await readFor(50, (b) => b.length >= 1);
        if (first.length > 1) rxParts.push(first.subarray(1));
        const more = await readFor(per);
        if (more.length) rxParts.push(more);
      }
      const allRx = concatBytes(rxParts);
      const txHex = allTx.join(' | ');
      const rxHex = toHex(allRx);
      const modules = parseModuleFrames(allRx);
      if (modules.length) {
        const jid = preferJointTarget(modules);
        moduleId = jid;
        let serial = '';
        for (const m of modules) {
          if ((m.module_id & 0xff) === jid && m.serial) {
            serial = m.serial;
            break;
          }
        }
        return {
          ok: true,
          modules,
          module_id: moduleId,
          serial,
          message: discoverMessage(modules),
          tx_hex: txHex,
          rx_hex: rxHex,
        };
      }
      return {
        ok: false,
        modules: [],
        module_id: moduleId,
        serial: '',
        message: 'Radio: no module answered. Match dongle and module colour, turn it on, stay in range.',
        tx_hex: txHex,
        rx_hex: rxHex,
      };
    } catch (e) {
      return {
        ok: false,
        modules: [],
        module_id: moduleId,
        serial: '',
        message: `Serial error: ${e.message || e}`,
        error: String(e.message || e),
        tx_hex: allTx.join(' | '),
        rx_hex: '(error)',
      };
    }
  });
}

function jointStatusName(status) {
  if (status == null) return '(none)';
  const known = {
    [ACK]: 'ACK',
    0x4e: 'NACK',
    0x53: 'STOP_ACK',
    0: 'BOOT',
    1: 'READY',
    2: 'LOAD_ERROR',
    5: 'RUNNING',
    6: 'LOCKED',
  };
  return known[status] || `0x${status.toString(16).toUpperCase()}`;
}

export async function jointSetPos(x, y, module_id) {
  return exclusive(async () => {
    const mid = parseModuleId(module_id == null ? moduleId : module_id);
    const id = mid == null ? moduleId : mid;
    let degX = Number(x);
    let degY = Number(y);
    if (!Number.isFinite(degX) || !Number.isFinite(degY)) {
      return { ok: false, error: 'x/y must be numbers' };
    }
    if (!selected) {
      return { ok: false, error: 'select port first', message: 'select port first', module_id: id, x: degX, y: degY };
    }
    let frame;
    try {
      frame = buildJointSetPosFrame(id, degX, degY);
    } catch (e) {
      return { ok: false, error: String(e.message || e), message: String(e.message || e) };
    }
    const txHex = toHex(frame);
    try {
      await writeRaw(frame);
      const allRx = await readFor(800);
      const rxHex = toHex(allRx);
      const hubAckHex = allRx.length ? toHex(allRx.subarray(0, 1)) : '(empty)';
      const hits = parseModuleFrames(allRx);
      let jointHits = hits.filter((h) => h.module_id === id && (h.type_id === MODULE_JOINT || h.type_id === BROADCAST));
      if (!jointHits.length) jointHits = hits.filter((h) => h.module_id === id);
      if (jointHits.length) {
        let h = jointHits[0];
        const typed = jointHits.filter((item) => item.type_id === MODULE_JOINT);
        if (typed.length) h = typed[0];
        const sn = jointStatusName(h.status);
        return {
          ok: true,
          module_id: id,
          x: degX,
          y: degY,
          status_name: sn,
          message: `Joint moved — id=0x${id.toString(16).toUpperCase()} deg=(${degX},${degY}) status=${sn}.`,
          tx_hex: txHex,
          rx_hex: rxHex,
          hub_ack_hex: hubAckHex,
        };
      }
      for (let i = 0; i < allRx.length - 4; i++) {
        if (allRx[i] === HASH && allRx[i + 1] === 3 && allRx[i + 2] === MODULE_JOINT && allRx[i + 3] === id) {
          const st = allRx[i + 4];
          const sn = jointStatusName(st);
          return {
            ok: true,
            module_id: id,
            x: degX,
            y: degY,
            status_name: sn,
            message: `Joint moved — id=0x${id.toString(16).toUpperCase()} deg=(${degX},${degY}) status=${sn}.`,
            tx_hex: txHex,
            rx_hex: rxHex,
            hub_ack_hex: hubAckHex,
          };
        }
      }
      return {
        ok: false,
        module_id: id,
        x: degX,
        y: degY,
        status_name: '(none)',
        message: `Joint did not answer — id=0x${id.toString(16).toUpperCase()}.`,
        tx_hex: txHex,
        rx_hex: rxHex,
        hub_ack_hex: hubAckHex,
      };
    } catch (e) {
      return {
        ok: false,
        module_id: id,
        x: degX,
        y: degY,
        message: `Serial error: ${e.message || e}`,
        error: String(e.message || e),
        tx_hex: txHex,
        rx_hex: '(error)',
      };
    }
  });
}
