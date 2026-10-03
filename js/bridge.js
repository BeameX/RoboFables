/** Client for the local RoboFables bridge. */
const BASE = '';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok && data.ok !== false) data.ok = false;
  data._status = res.status;
  return data;
}

export async function health() {
  return api('/api/health');
}

export async function listPorts() {
  return api('/api/ports');
}

export async function selectPort(port) {
  return api('/api/select-port', { method: 'POST', body: JSON.stringify({ port }) });
}

export async function selectModule(module_id) {
  return api('/api/select-module', {
    method: 'POST',
    body: JSON.stringify({ module_id }),
  });
}

export async function pingHub() {
  return api('/api/ping-hub', { method: 'POST', body: '{}' });
}

export async function discover() {
  return api('/api/discover', { method: 'POST', body: '{}' });
}

export async function pingModule(module_id) {
  return api('/api/ping-module', {
    method: 'POST',
    body: JSON.stringify(module_id != null ? { module_id } : {}),
  });
}

export async function jointSetPos(x, y, module_id) {
  const body = { x, y };
  if (module_id != null) body.module_id = module_id;
  return api('/api/joint-set-pos', { method: 'POST', body: JSON.stringify(body) });
}
