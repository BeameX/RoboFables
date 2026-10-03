/**
 * Local project save/load — Blockly XML + device mode + name + custom blocks in localStorage.
 * Key: robolab.projects
 * Download and upload use JSON that embeds the full workspace program (xml).
 */

import { readMacros, mergeImportedMacros, getCallMacroId } from './macros.js';

const STORAGE_KEY = 'robolab.projects';

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, projects: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.projects)) return { version: 1, projects: [] };
    return data;
  } catch (_) {
    return { version: 1, projects: [] };
  }
}

function writeStore(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function listProjects() {
  return readStore().projects.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Macros referenced by call-blocks currently on the workspace (for project packaging). */
export function macrosReferencedByWorkspace(workspace) {
  if (!workspace || typeof workspace.getAllBlocks !== 'function') return [];
  const ids = new Set();
  for (const b of workspace.getAllBlocks(false)) {
    if (b.type === 'kl_kald_makro') {
      const id = getCallMacroId(b);
      if (id) ids.add(id);
    }
  }
  if (!ids.size) return [];
  return readMacros().filter((m) => ids.has(m.id));
}

export function saveProject({ name, band, xml, macros }) {
  const n = String(name || '').trim() || 'Untitled';
  const store = readStore();
  const now = Date.now();
  const existing = store.projects.findIndex(
    (p) => p.name.toLowerCase() === n.toLowerCase(),
  );
  const entry = {
    name: n,
    band: band || 'explore',
    xml: typeof xml === 'string' ? xml : '',
    updatedAt: now,
  };
  if (Array.isArray(macros)) {
    if (macros.length) entry.macros = macros;
  } else if (existing >= 0 && Array.isArray(store.projects[existing].macros)) {
    // Keep previously stored macros if caller did not pass macros
    entry.macros = store.projects[existing].macros;
  }
  if (existing >= 0) store.projects[existing] = entry;
  else store.projects.push(entry);
  writeStore(store);
  return entry;
}

export function loadProject(name) {
  const n = String(name || '').trim();
  return readStore().projects.find((p) => p.name === n) || null;
}

export function deleteProject(name) {
  const store = readStore();
  const before = store.projects.length;
  store.projects = store.projects.filter((p) => p.name !== name);
  writeStore(store);
  return before !== store.projects.length;
}

/**
 * Serialize a project for Download projekt.
 * Always includes xml (Blockly workspace program). Omitting xml is a hard error.
 */
export function exportProjectJson(entry) {
  const xml = entry && typeof entry.xml === 'string' ? entry.xml : '';
  if (!xml) {
    throw new Error('This project has no program — save or build some blocks first');
  }
  const payload = {
    format: 'robolab-project',
    version: 2,
    name: entry.name,
    band: entry.band,
    xml,
    updatedAt: entry.updatedAt || Date.now(),
  };
  if (Array.isArray(entry.macros) && entry.macros.length) {
    payload.macros = entry.macros;
  }
  return JSON.stringify(payload, null, 2);
}

/** Map legacy mini/crew/kode → explore/go; pass through explore/go. */
function normalizeBand(band) {
  if (band === 'go' || band === 'crew') return 'go';
  return 'explore';
}

export function parseProjectJson(text) {
  const data = JSON.parse(text);
  // Prefer xml; accept legacy/alternate "program" alias
  const xml =
    data && typeof data.xml === 'string'
      ? data.xml
      : data && typeof data.program === 'string'
        ? data.program
        : null;
  if (xml === null) {
    throw new Error('That file is not a project (missing the program)');
  }
  if (!xml.trim()) {
    throw new Error('That project file is empty');
  }
  const out = {
    name: String(data.name || 'Imported').trim() || 'Imported',
    band: normalizeBand(data.band),
    xml,
    updatedAt: data.updatedAt || Date.now(),
  };
  if (Array.isArray(data.macros) && data.macros.length) {
    out.macros = data.macros;
  }
  return out;
}

export function workspaceToXml(workspace) {
  if (!workspace || !globalThis.Blockly || !Blockly.Xml) {
    throw new Error('The block workspace is not ready yet');
  }
  const dom = Blockly.Xml.workspaceToDom(workspace);
  const xml = Blockly.Xml.domToText(dom);
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error('Could not save the program (empty)');
  }
  return xml;
}

export function xmlToWorkspace(workspace, xmlText) {
  if (!workspace || !globalThis.Blockly) {
    throw new Error('The block workspace is not ready yet');
  }
  if (typeof xmlText !== 'string' || !xmlText.trim()) {
    throw new Error('Empty program — nothing to open');
  }
  workspace.clear();
  const dom = Blockly.utils.xml.textToDom(xmlText);
  Blockly.Xml.domToWorkspace(dom, workspace);
}

/** Wire Save / Open / Delete / Download project / Upload project. */
export function bindProjectsUI({
  workspace,
  getBand,
  setBand,
  toast,
  els,
  onMacrosChanged,
}) {
  const {
    nameInput,
    selectEl,
    btnSave,
    btnLoad,
    btnDelete,
    btnDownload,
    btnUpload,
    fileInput,
  } = els;

  function refreshSelect() {
    const cur = selectEl.value;
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(choose a project)';
    selectEl.appendChild(placeholder);
    for (const p of listProjects()) {
      const opt = document.createElement('option');
      opt.value = p.name;
      const d = p.updatedAt ? new Date(p.updatedAt) : null;
      const stamp = d
        ? d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      opt.textContent = stamp ? `${p.name} · ${stamp}` : p.name;
      selectEl.appendChild(opt);
    }
    if (cur && [...selectEl.options].some((o) => o.value === cur)) {
      selectEl.value = cur;
    }
  }

  function currentXml() {
    return workspaceToXml(workspace);
  }

  function currentMacros() {
    // Prefer macros referenced by the live program; fall back to none
    return macrosReferencedByWorkspace(workspace);
  }

  function applyProgram(p) {
    xmlToWorkspace(workspace, p.xml);
    setBand(p.band);
    nameInput.value = p.name;
    if (Array.isArray(p.macros) && p.macros.length) {
      mergeImportedMacros(p.macros);
      if (typeof onMacrosChanged === 'function') onMacrosChanged();
    }
  }

  btnSave.addEventListener('click', () => {
    try {
      const entry = saveProject({
        name: nameInput.value,
        band: getBand(),
        xml: currentXml(),
        macros: currentMacros(),
      });
      nameInput.value = entry.name;
      refreshSelect();
      selectEl.value = entry.name;
      toast(`Saved: ${entry.name}`);
    } catch (e) {
      toast(`Could not save: ${e.message || e}`, true);
    }
  });

  btnLoad.addEventListener('click', () => {
    const name = selectEl.value || nameInput.value.trim();
    if (!name) {
      toast('Choose or name a project', true);
      return;
    }
    const p = loadProject(name);
    if (!p) {
      toast('Project not found', true);
      return;
    }
    try {
      applyProgram(p);
      toast(`Opened: ${p.name}`);
    } catch (e) {
      toast(`Could not open: ${e.message || e}`, true);
    }
  });

  btnDelete.addEventListener('click', () => {
    const name = selectEl.value || nameInput.value.trim();
    if (!name) {
      toast('Choose a project to delete', true);
      return;
    }
    if (!deleteProject(name)) {
      toast('Nothing was deleted', true);
      return;
    }
    if (nameInput.value.trim() === name) nameInput.value = '';
    refreshSelect();
    toast(`Deleted: ${name}`);
  });

  btnDownload.addEventListener('click', () => {
    const name = (nameInput.value.trim() || selectEl.value || 'project').trim();
    try {
      // Always snapshot the live workspace so the JSON never ships without a program
      const xml = currentXml();
      const entry = {
        name,
        band: getBand(),
        xml,
        macros: currentMacros(),
        updatedAt: Date.now(),
      };
      const blob = new Blob([exportProjectJson(entry)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name.replace(/[^\w\- ]+/gi, '_') || 'project'}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Download started');
    } catch (e) {
      toast(`Download failed: ${e.message || e}`, true);
    }
  });

  btnUpload.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const p = parseProjectJson(text);
      saveProject(p);
      applyProgram(p);
      refreshSelect();
      selectEl.value = p.name;
      toast(`Uploaded: ${p.name}`);
    } catch (e) {
      toast(`Upload failed: ${e.message || e}`, true);
    }
  });

  refreshSelect();
  return { refreshSelect };
}
