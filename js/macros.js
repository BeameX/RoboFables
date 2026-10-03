/**
 * Kid-built blocks (My blocks) — localStorage only.
 * Define on the canvas with Create block, then save into the toolbox.
 * LED and wheel motion stay gated at run time (never opened here).
 */

export const MACROS_KEY = 'robolab.customMacros';
const MAX_MACROS = 24;
const MAX_NAME = 32;

/** @typedef {{ type: string, fields?: Record<string, string|number>, do?: MacroStep[] }} MacroStep */
/** @typedef {{ id: string, name: string, band: string, steps: MacroStep[], updatedAt: number }} CustomMacro */

export function readMacros() {
  try {
    const raw = localStorage.getItem(MACROS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((m) => m && m.id && m.name && Array.isArray(m.steps)) : [];
  } catch (_) {
    return [];
  }
}

function writeMacros(list) {
  try {
    localStorage.setItem(MACROS_KEY, JSON.stringify(list.slice(0, MAX_MACROS)));
  } catch (_) { /* ignore quota */ }
}

export function sanitizeMacroName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  return s;
}

function newId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Macro id stored on a call block (extraState or legacy field). */
export function getCallMacroId(block) {
  if (!block) return '';
  if (block.macroId_) return block.macroId_;
  try {
    return block.getFieldValue('MACRO') || '';
  } catch (_) {
    return '';
  }
}

/** Serialize a statement chain (and nested DO) into MacroStep[]. */
export function serializeChain(startBlock) {
  const steps = [];
  let cur = startBlock;
  while (cur) {
    if (!cur.outputConnection) {
      // Definition shells are not runnable steps
      if (cur.type === 'kl_opret_makro') {
        cur = cur.getNextBlock();
        continue;
      }
      const step = { type: cur.type, fields: {} };
      for (const input of cur.inputList || []) {
        for (const field of input.fieldRow || []) {
          if (field.name) step.fields[field.name] = field.getValue();
        }
        if (input.name === 'DO' && input.connection) {
          const inner = input.connection.targetBlock();
          if (inner) step.do = serializeChain(inner);
        }
      }
      if (cur.type === 'kl_kald_makro') {
        const id = getCallMacroId(cur);
        if (id) step.fields.MACRO = id;
      }
      steps.push(step);
    }
    cur = cur.getNextBlock();
  }
  return steps;
}

/**
 * Save the body nested inside a Create block.
 * @returns {{ ok: boolean, message: string, macro?: CustomMacro }}
 */
export function saveMacroFromDefine(defineBlock, band) {
  if (!defineBlock || defineBlock.type !== 'kl_opret_makro') {
    return { ok: false, message: 'Drag a Create block onto the canvas first' };
  }
  const clean = sanitizeMacroName(defineBlock.getFieldValue('NAME'));
  if (!clean) return { ok: false, message: 'Type a name on the Create block' };
  const inner = defineBlock.getInputTargetBlock('DO');
  if (!inner) return { ok: false, message: 'Put blocks inside Create block' };
  const steps = serializeChain(inner);
  if (!steps.length) return { ok: false, message: 'Empty block — put blocks inside' };

  const list = readMacros();
  const existing = list.find((m) => m.name.toLowerCase() === clean.toLowerCase());
  const macro = {
    id: existing ? existing.id : newId(),
    name: clean,
    band: band === 'go' ? 'go' : 'explore',
    steps,
    updatedAt: Date.now(),
  };
  const next = existing
    ? list.map((m) => (m.id === existing.id ? macro : m))
    : [macro, ...list];
  writeMacros(next);
  return {
    ok: true,
    message: existing ? `Block “${clean}” updated` : `Block “${clean}” saved in My blocks`,
    macro,
  };
}

/**
 * Legacy: save primary statement chain as a named macro (toolbar fallback).
 * @returns {{ ok: boolean, message: string, macro?: CustomMacro }}
 */
export function saveMacroFromChain(name, startBlock, band) {
  const clean = sanitizeMacroName(name);
  if (!clean) return { ok: false, message: 'Type a name for the block' };
  if (!startBlock) return { ok: false, message: 'No blocks to save — build a chain first' };
  const steps = serializeChain(startBlock);
  if (!steps.length) return { ok: false, message: 'Empty chain — drag some blocks first' };

  const list = readMacros();
  const existing = list.find((m) => m.name.toLowerCase() === clean.toLowerCase());
  const macro = {
    id: existing ? existing.id : newId(),
    name: clean,
    band: band === 'go' ? 'go' : 'explore',
    steps,
    updatedAt: Date.now(),
  };
  const next = existing
    ? list.map((m) => (m.id === existing.id ? macro : m))
    : [macro, ...list];
  writeMacros(next);
  return { ok: true, message: existing ? `Block “${clean}” updated` : `Block “${clean}” saved`, macro };
}

/** Rename a saved macro by id. */
export function renameMacro(id, newName) {
  const clean = sanitizeMacroName(newName);
  if (!clean) return { ok: false, message: 'That name does not work' };
  if (!id) return { ok: false, message: 'Unknown block' };
  const list = readMacros();
  const target = list.find((m) => m.id === id);
  if (!target) return { ok: false, message: 'That block does not exist' };
  const clash = list.find((m) => m.id !== id && m.name.toLowerCase() === clean.toLowerCase());
  if (clash) return { ok: false, message: 'That name is already used' };
  const next = list.map((m) =>
    m.id === id ? { ...m, name: clean, updatedAt: Date.now() } : m,
  );
  writeMacros(next);
  return { ok: true, message: `Renamed to “${clean}”`, macro: next.find((m) => m.id === id) };
}

export function deleteMacro(id) {
  const list = readMacros().filter((m) => m.id !== id);
  writeMacros(list);
  return list;
}

/** Merge macros from an imported project (upsert by id; name clash keeps incoming id). */
export function mergeImportedMacros(incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return readMacros();
  const list = readMacros();
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const raw of incoming) {
    if (!raw || !raw.id || !raw.name || !Array.isArray(raw.steps)) continue;
    byId.set(raw.id, {
      id: String(raw.id),
      name: sanitizeMacroName(raw.name) || String(raw.name).slice(0, MAX_NAME),
      band: raw.band === 'go' ? 'go' : 'explore',
      steps: raw.steps,
      updatedAt: raw.updatedAt || Date.now(),
    });
  }
  const next = [...byId.values()].slice(0, MAX_MACROS);
  writeMacros(next);
  return next;
}

export function findMacroById(id) {
  return readMacros().find((m) => m.id === id) || null;
}

export function findMacroByName(name) {
  const n = String(name || '').toLowerCase();
  return readMacros().find((m) => m.name.toLowerCase() === n) || null;
}

/** Dropdown options for legacy UI: [[label, value], ...] */
export function macroDropdownOptions() {
  const list = readMacros();
  if (!list.length) return [['(no blocks yet)', '']];
  return list.map((m) => [m.name, m.id]);
}

/**
 * Flyout contents for the My blocks toolbox category.
 * @param {'explore'|'go'} band
 * @param {(newName: string, block: Blockly.Block) => string|null} [onRename]
 */
export function buildEgneFlyout(band) {
  /** @type {object[]} */
  const contents = [{ kind: 'block', type: 'kl_opret_makro' }];
  if (band === 'go') {
    contents.push({ kind: 'block', type: 'kl_egen_firkant' });
  }
  for (const m of readMacros()) {
    contents.push({
      kind: 'block',
      type: 'kl_kald_makro',
      fields: { NAME: m.name },
      extraState: { macroId: m.id },
    });
  }
  return contents;
}
