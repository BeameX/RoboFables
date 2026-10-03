/**
 * One page, two transports.
 * Python bridge (zip edition and bridge_server.py) wins when /api/health answers.
 * Otherwise Chrome/Edge Web Serial. Firefox and Safari get a short message.
 */
import * as http from './bridge.js';
import * as web from './webserial.js';

let mode = 'none';

export function transportMode() {
  return mode;
}

export function unsupportedMessage() {
  return web.unsupportedMessage();
}

export async function detect() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  let health = null;
  try {
    const res = await fetch('/api/health', {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    if (res.ok && data && data.ok && data.service === 'RoboFables bridge') health = data;
  } catch (_) {
    health = null;
  } finally {
    clearTimeout(timer);
  }
  if (health) {
    mode = 'bridge';
    return { mode, health };
  }
  if (web.supported()) {
    mode = 'webserial';
    return { mode, health: await web.health() };
  }
  mode = 'none';
  return { mode, health: { ok: false }, message: web.unsupportedMessage() };
}

function webOn() {
  return mode === 'webserial';
}

export async function health() {
  if (webOn()) return web.health();
  if (mode === 'bridge') return http.health();
  return { ok: false, error: web.unsupportedMessage() };
}

export async function listPorts({ pick = false } = {}) {
  if (webOn()) {
    if (pick) {
      try {
        await web.pickPort();
      } catch (e) {
        if (!e || e.name !== 'NotFoundError') {
          return { ok: false, error: (e && e.message) || web.unsupportedMessage(), ports: [] };
        }
      }
    }
    return web.listPorts();
  }
  if (mode === 'bridge') return http.listPorts();
  return { ok: false, error: web.unsupportedMessage(), ports: [] };
}

export async function selectPort(port) {
  if (webOn()) return web.selectPort(port);
  if (mode === 'bridge') return http.selectPort(port);
  return { ok: false, error: web.unsupportedMessage() };
}

export async function selectModule(module_id) {
  if (webOn()) return web.selectModule(module_id);
  if (mode === 'bridge') return http.selectModule(module_id);
  return { ok: false, error: web.unsupportedMessage() };
}

export async function pingHub() {
  if (webOn()) return web.pingHub();
  if (mode === 'bridge') return http.pingHub();
  return { ok: false, error: web.unsupportedMessage() };
}

export async function discover() {
  if (webOn()) return web.discover();
  if (mode === 'bridge') return http.discover();
  return { ok: false, modules: [], error: web.unsupportedMessage() };
}

export async function jointSetPos(x, y, module_id) {
  if (webOn()) return web.jointSetPos(x, y, module_id);
  if (mode === 'bridge') return http.jointSetPos(x, y, module_id);
  return { ok: false, error: web.unsupportedMessage() };
}
