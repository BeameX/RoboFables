import { GATES, assertGate } from './gates.js';
import {
  defineRoboBlocks,
  buildToolboxJson,
  installPythonGenerators,
  registerEgneToolbox,
  setEgneRefreshHook,
  SPIN_BLOCK_TYPES,
  LED_BLOCK_TYPES,
} from './blocks.js';
import * as bridge from './link.js';
import { bindStoryboard, primaryStack } from './storyboard.js';
import { bindProjectsUI } from './projects.js';
import {
  readMacros,
  saveMacroFromDefine,
  saveMacroFromChain,
  deleteMacro,
  findMacroById,
  getCallMacroId,
} from './macros.js';

const BAND_LABELS = {
  explore: 'Explore',
  go: 'Go',
};

const LEVEL_STORAGE_KEY = 'robolab.level';

/** Normalize legacy mini/crew/kode (and unknown) to explore/go for the Device picker. */
function normalizeDevice(band) {
  if (band === 'go' || band === 'crew') return 'go';
  return 'explore'; // explore, mini, kode, or anything else
}

function normalizeLevel(level) {
  return level === 'full' ? 'full' : 'simple';
}

function readStoredLevel() {
  try {
    const v = localStorage.getItem(LEVEL_STORAGE_KEY);
    if (v === 'full' || v === 'simple') return v;
  } catch (_) { /* ignore */ }
  return 'simple'; // first open = small set
}

function writeStoredLevel(level) {
  try {
    localStorage.setItem(LEVEL_STORAGE_KEY, normalizeLevel(level));
  } catch (_) { /* ignore */ }
}

let workspace = null;
let currentBand = 'explore';
let currentLevel = readStoredLevel();
let pose = { x: 0, y: 0 };
let runToken = 0;
/** Kid-facing USB link state (not LED/Spin gates). */
let conn = { bridge: false, port: '', linked: false, robotSerial: '', modules: [] };

/** Captain sticker serials when discover omits SID (radio id → name). */
const KNOWN_SERIAL_BY_ID = Object.freeze({
  0xa2: 'J0B',
});
function hexModuleId(mid) {
  return '0x' + (Number(mid) & 0xff).toString(16).toUpperCase();
}

/** Kid-facing robot name: prefer discover serial, else known map, else hex. */
function serialForModule(mid, discoverSerial) {
  const s = String(discoverSerial || '').trim();
  if (s && !/^[\?\s.]*$/.test(s)) return s;
  const mapped = KNOWN_SERIAL_BY_ID[Number(mid) & 0xff];
  if (mapped) return mapped;
  if (mid == null || mid === '') return '';
  return hexModuleId(mid);
}

function findModuleHit(modules, mid) {
  const id = Number(mid) & 0xff;
  return (modules || []).find((m) => (Number(m.module_id) & 0xff) === id) || null;
}

/** Populate Robot picker with sticker names; option values stay module_id for USB TX. */
function populateModulePicker(modules, selectedId) {
  const sel = document.getElementById('moduleSelect');
  if (!sel) return;
  const prev = selectedId != null ? Number(selectedId) & 0xff : null;
  const list = Array.isArray(modules) ? modules.slice() : [];
  // Ensure default / selected id is present even if discover was empty
  const ids = new Set(list.map((m) => Number(m.module_id) & 0xff));
  if (prev != null && !ids.has(prev)) {
    list.push({ module_id: prev, serial: serialForModule(prev, ''), type_name: 'Joint' });
  }
  if (!list.length) {
    list.push({ module_id: 0xa2, serial: 'J0B', type_name: 'Joint' });
  }
  sel.innerHTML = '';
  for (const m of list) {
    const mid = Number(m.module_id) & 0xff;
    const name = serialForModule(mid, m.serial);
    const opt = document.createElement('option');
    opt.value = hexModuleId(mid);
    opt.dataset.serial = name;
    const kind = m.type_name ? String(m.type_name) : '';
    opt.textContent = kind && kind !== 'Joint' ? `${name} (${kind})` : name;
    sel.appendChild(opt);
  }
  const want = prev != null ? hexModuleId(prev) : hexModuleId(0xa2);
  if ([...sel.options].some((o) => o.value === want)) sel.value = want;
  else if (sel.options.length) sel.selectedIndex = 0;
  const chosen = sel.options[sel.selectedIndex];
  conn.robotSerial = chosen ? (chosen.dataset.serial || chosen.textContent) : '';
}

function applyModulesFromDiscover(d) {
  const mods = (d && Array.isArray(d.modules)) ? d.modules : [];
  conn.modules = mods;
  let mid = d && d.module_id != null ? Number(d.module_id) : null;
  if (mid == null && mods.length) mid = Number(mods[0].module_id);
  const hit = mid != null ? findModuleHit(mods, mid) : null;
  const fromApi = (d && d.serial) || (hit && hit.serial) || '';
  conn.robotSerial = serialForModule(mid != null ? mid : 0xa2, fromApi);
  populateModulePicker(mods, mid != null ? mid : 0xa2);
}

/** Kid-facing copy — no hex / API / bridge jargon in the bottom toast. */
const KID = Object.freeze({
  bridgeDown: 'Cannot find the computer bridge. Ask an adult to start RoboFables.',
  portsFail: 'Cannot see the USB plug. Ask an adult to start RoboFables.',
  noPort: 'Choose the USB plug (the dongle) first, then press Connect.',
  selectPortFail: 'Could not choose that USB plug. Try Ports again.',
  pingFail: 'The dongle is not answering. Check the USB cable and press Connect again.',
  discoverFail:
    'The robot is not answering. Is it on? Do the dongle and the robot use the same colour?',
  notLinked: 'Not connected yet — press Connect first.',
  runFail:
    'The robot did not hear you. Check that it is on, and that the colours match.',
  connectOk: 'Nice — the robot is connected!',
  gatedLed: 'Lights are turned off for now — ask a teacher.',
  gatedSpin: 'Wheels are turned off for now — ask a teacher.',
});

function hideToast() {
  const el = document.getElementById('toast');
  if (!el) return;
  el.classList.remove('show', 'warn', 'sticky');
  el.hidden = true;
  const btn = document.getElementById('toastDismiss');
  if (btn) btn.hidden = true;
  clearTimeout(toast._t);
  toast._sticky = false;
}

/**
 * Bottom toast. Critical connection errors: sticky=true (stays until dismiss
 * or a successful Connect). Ordinary tips auto-hide; warnings stay longer.
 */
function toast(msg, warn = false, { sticky = false } = {}) {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');
  const btn = document.getElementById('toastDismiss');
  if (!el) return;
  if (msgEl) msgEl.textContent = msg;
  else el.textContent = msg;
  el.hidden = false;
  el.classList.toggle('warn', !!warn);
  el.classList.toggle('sticky', !!sticky);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._sticky = !!sticky;
  if (btn) {
    btn.hidden = !sticky;
  }
  if (sticky) return;
  const ms = warn ? 9000 : 3800;
  toast._t = setTimeout(() => hideToast(), ms);
}

/** Strip nerdy hex / frame jargon if a raw hub string slips through. */
function kidifyHubMessage(raw, fallback) {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  if (/0x[0-9a-f]+/i.test(s) || /\b[0-9a-f]{2}(\s[0-9a-f]{2}){3,}/i.test(s)) {
    return fallback;
  }
  if (/\b(tx_hex|rx_hex|HTTP|api\/|SerialException|NACK|DELAYED_PING)\b/i.test(s)) {
    return fallback;
  }
  if (/#\s*0[38]/i.test(s) || /\bSID=|radioID=/i.test(s)) {
    return fallback;
  }
  // Keep short plain-language tips that already avoid jargon
  if (s.length > 160) return fallback;
  return s;
}

function linkReadyLabel() {
  if (bridge.transportMode() === 'webserial') return 'web serial';
  if (bridge.transportMode() === 'bridge') return 'bridge ready';
  return 'Chrome or Edge';
}

function clearConnected(kidMsg) {
  conn.linked = false;
  updateConnChip();
  const offline = bridge.transportMode() === 'none' ? 'Chrome or Edge' : 'bridge offline';
  setUsbChip(conn.bridge ? (conn.port ? `USB ${conn.port}` : linkReadyLabel()) : offline, !!conn.bridge);
  if (kidMsg) toast(kidMsg, true, { sticky: true });
}

function markConnected() {
  conn.linked = true;
  updateConnChip();
  setUsbChip(conn.port ? `USB ${conn.port}` : 'USB OK', true);
  if (toast._sticky) hideToast();
}

/** Re-check radio discover; clears chip on failure. Returns true if still linked. */
async function recheckLink({ quiet = false } = {}) {
  if (!conn.bridge || !conn.port) {
    clearConnected(quiet ? null : KID.noPort);
    return false;
  }
  try {
    const d = await bridge.discover();
    if (d && d.ok && Array.isArray(d.modules) && d.modules.length) {
      conn.linked = true;
      applyModulesFromDiscover(d);
      updateConnChip();
      if (toast._sticky) hideToast();
      return true;
    }
    clearConnected(quiet ? null : KID.discoverFail);
    return false;
  } catch (_) {
    clearConnected(quiet ? null : KID.discoverFail);
    return false;
  }
}

let linkPollTimer = null;
function startLinkPoll() {
  if (linkPollTimer) return;
  linkPollTimer = setInterval(() => {
    if (!conn.linked) return;
    recheckLink({ quiet: false });
  }, 12000);
}

function setUsbChip(text, ok) {
  const el = document.getElementById('usbChip');
  el.textContent = text;
  el.style.borderColor = ok ? '#5dde8a' : '#3a4d66';
  el.style.color = ok ? '#5dde8a' : '';
}

function setDrawer(open) {
  document.getElementById('drawer').classList.toggle('open', open);
  document.getElementById('backdrop').classList.toggle('open', open);
  if (open) refreshCode();
}

function refreshCode() {
  const pre = document.getElementById('codeOut');
  if (!workspace || !Blockly.Python) {
    pre.textContent = '# Python view is not ready yet';
    return;
  }
  try {
    const code = Blockly.Python.workspaceToCode(workspace);
    pre.textContent =
      'import time\n\n' +
      '# Via RoboFables (joint move and ping)\n' +
      'def arm_set(axis, deg):\n    pass  # the Run button sends this\n\n' +
      'def play_tone(ms):\n    pass\n\n' +
      (code || 'pass  # empty program\n');
  } catch (e) {
    pre.textContent = `# error: ${e.message}`;
  }
}


const TOOLBOX_VISIBLE_KEY = 'robolab.toolboxVisible';

function readToolboxVisible() {
  try {
    const v = localStorage.getItem(TOOLBOX_VISIBLE_KEY);
    if (v === null || v === undefined || v === '') return true;
    return v !== '0' && v !== 'false';
  } catch (_) {
    return true;
  }
}

function writeToolboxVisible(visible) {
  try {
    localStorage.setItem(TOOLBOX_VISIBLE_KEY, visible ? '1' : '0');
  } catch (_) { /* ignore */ }
}

function resizeBlockly() {
  if (!workspace) return;
  requestAnimationFrame(() => {
    try {
      Blockly.svgResize(workspace);
    } catch (_) { /* ignore */ }
  });
}

function setToolboxVisible(visible) {
  const show = !!visible;
  writeToolboxVisible(show);
  if (workspace) {
    const tb = workspace.getToolbox && workspace.getToolbox();
    if (tb && typeof tb.setVisible === 'function') tb.setVisible(show);
  }
  const btn = document.getElementById('btnToolboxToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.title = show ? 'Hide toolbox' : 'Show toolbox';
  }
  const hint = document.getElementById('toolboxHint');
  if (hint) hint.textContent = show ? 'Drag from the toolbox' : 'Toolbox hidden';
  resizeBlockly();
}

const PREVIEW_VISIBLE_KEY = 'robolab.previewVisible';
const MISSION_VISIBLE_KEY = 'robolab.missionVisible';

function readFlag(key, defaultTrue = true) {
  try {
    const v = localStorage.getItem(key);
    if (v === null || v === undefined || v === '') return defaultTrue;
    return v !== '0' && v !== 'false';
  } catch (_) {
    return defaultTrue;
  }
}

function writeFlag(key, visible) {
  try {
    localStorage.setItem(key, visible ? '1' : '0');
  } catch (_) { /* ignore */ }
}

function readPreviewVisible() {
  return readFlag(PREVIEW_VISIBLE_KEY, true);
}

function readMissionVisible() {
  return readFlag(MISSION_VISIBLE_KEY, true);
}

function setPreviewVisible(visible) {
  const show = !!visible;
  writeFlag(PREVIEW_VISIBLE_KEY, show);
  const panels = document.getElementById('mainPanels');
  const main = document.getElementById('mainSection');
  if (panels) panels.classList.toggle('preview-hidden', !show);
  const btn = document.getElementById('btnPreviewToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.title = show ? 'Hide preview' : 'Show preview';
  }
  const missionShow = readMissionVisible();
  if (main) main.classList.toggle('panels-collapsed', !show && !missionShow);
  resizeBlockly();
}

function setMissionVisible(visible) {
  const show = !!visible;
  writeFlag(MISSION_VISIBLE_KEY, show);
  const panels = document.getElementById('mainPanels');
  const main = document.getElementById('mainSection');
  if (panels) panels.classList.toggle('mission-hidden', !show);
  const btn = document.getElementById('btnMissionToggle');
  if (btn) {
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.title = show ? 'Hide mission' : 'Show mission';
  }
  const previewShow = readPreviewVisible();
  if (main) main.classList.toggle('panels-collapsed', !previewShow && !show);
  resizeBlockly();
}

/** Kid-friendly connection status — driven by bridge/USB ping, not LED/Spin gates. */
function updateConnChip() {
  const el = document.getElementById('connChip');
  if (!el) return;
  const device = BAND_LABELS[currentBand] || 'Explore';
  if (!conn.bridge || !conn.linked) {
    el.textContent = 'Not connected';
    el.title = bridge.transportMode() === 'none'
      ? 'Firefox and Safari cannot use the USB dongle. Open this page in Chrome or Edge.'
      : conn.bridge
      ? (conn.port ? 'Press Connect — the robot should be on and the colours should match' : 'Choose a USB plug and press Connect')
      : 'Ask an adult to start RoboFables, choose a USB plug, and press Connect';
    el.style.borderColor = '';
    el.style.color = '';
    return;
  }
  const robot = conn.robotSerial || '';
  const robotBit = robot ? ` · ${robot}` : '';
  const portBit = conn.port ? ` · ${conn.port}` : '';
  el.textContent = `Connected to ${device}${robotBit}`;
  el.title = `Connected · ${device}` + robotBit + portBit;
  el.style.borderColor = '#5dde8a';
  el.style.color = '#5dde8a';
}

function updateMission(band) {
  const p = document.querySelector('.mission > p');
  if (!p) return;
  if (band === 'go') {
    p.textContent =
      'Go: build a drive with drive / turn / stop wheels (wheels stay off for now). Switch Device for the Explore arm.';
  } else {
    p.textContent =
      'Explore: make the arm wave — wait → arm Y +30° → wait → safe stop. Switch Device to Go for driving.';
  }
}

function applyBand(band) {
  band = normalizeDevice(band);
  currentBand = band;
  if (workspace) workspace.updateToolbox(buildToolboxJson(band, currentLevel));
  document.getElementById('bandChip').textContent = BAND_LABELS[band];
  const sel = document.getElementById('bandSelect');
  if (sel && sel.value !== band) sel.value = band;
  updateMission(band);
  updateConnChip();
  syncLevelUi();
  // Keep hide preference after toolbox rebuild
  if (workspace) setToolboxVisible(readToolboxVisible());
  else resizeBlockly();
}

/** Show/hide Full-only chrome (See the code) and keep the Level picker in sync. */
function syncLevelUi() {
  const sel = document.getElementById('levelSelect');
  if (sel && sel.value !== currentLevel) sel.value = currentLevel;
  const btnCode = document.getElementById('btnCode');
  if (btnCode) {
    const show = currentLevel === 'full';
    btnCode.hidden = !show;
    if (!show) setDrawer(false);
  }
}

function applyLevel(level) {
  level = normalizeLevel(level);
  currentLevel = level;
  writeStoredLevel(level);
  if (workspace) workspace.updateToolbox(buildToolboxJson(currentBand, currentLevel));
  syncLevelUi();
  if (workspace) setToolboxVisible(readToolboxVisible());
  else resizeBlockly();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function topBlocks() {
  return workspace.getTopBlocks(true).filter((b) => !b.outputConnection);
}

/** Local SVG pose — no USB. Preview is not Run.
 *  X: strong left/right lean (CSS rotate on #jointX; placement is a parent SVG translate).
 *  Y: in/out — CSS perspective rotateX on #jointY (placement on #jointYPivot).
 *  Never put CSS transform on a node that also has an SVG transform attribute (Chrome breaks the stack).
 */
function animatePose(axis, deg) {
  if (axis === 'X') pose.x = deg;
  else pose.y = deg;

  const stage = document.getElementById('robotSvg');
  if (!stage) return;
  stage.classList.add('running');

  // Map ±90° joint → clearly visible preview tilt
  const tiltX = Math.max(-70, Math.min(70, pose.x * 0.85)); // left ↔ right
  const tiltY = Math.max(-62, Math.min(62, pose.y * 0.7));  // toward ↔ away

  const jx = stage.querySelector('#jointX, .joint-x');
  const jy = stage.querySelector('#jointY, .joint-y');
  const jyPivot = stage.querySelector('#jointYPivot');

  if (jx) {
    // CSS-only rotate; parent <g transform="translate(...)"> owns placement
    jx.removeAttribute('transform');
    jx.style.transformOrigin = '50% 100%';
    jx.style.transformBox = 'fill-box';
    jx.style.transform = `rotate(${tiltX}deg)`;
    const shadowX = (-tiltX * 0.12).toFixed(1);
    jx.style.filter = `drop-shadow(${shadowX}px 4px 3px rgba(0,0,0,0.45))`;
  }

  if (jyPivot) {
    // Static placement under X; do not scale here (opens gaps in the stack)
    jyPivot.setAttribute('transform', 'translate(0 -44)');
  }

  if (jy) {
    // In/out: CSS perspective rotateX about bottom; no SVG transform on this node
    jy.removeAttribute('transform');
    jy.style.transformOrigin = '50% 100%';
    jy.style.transformBox = 'fill-box';
    jy.style.transform = `perspective(280px) rotateX(${(-tiltY).toFixed(1)}deg)`;
  }

  const ax = stage.querySelector('#angleX');
  const ay = stage.querySelector('#angleY');
  if (ax) ax.textContent = `X ${Math.round(pose.x)}°`;
  if (ay) ay.textContent = `Y ${Math.round(pose.y)}°`;
}

/** USB TX then local SVG animation. */
async function applyArm(axis, deg) {
  animatePose(axis, deg);
  const r = await bridge.jointSetPos(pose.x, pose.y);
  if (!r.ok) throw new Error(r.message || r.error || 'joint-set-pos fail');
  toast(`Arm ${axis} → ${deg}°`);
  return r;
}


const MACRO_MAX_DEPTH = 8;

/** Run a saved macro step list (same semantics as execChain; gates still apply). */
async function execSteps(steps, my, previewOnly, depth = 0) {
  if (!steps || !steps.length) return true;
  if (depth > MACRO_MAX_DEPTH) {
    toast('That block is nested too deep', true);
    return false;
  }
  for (const step of steps) {
    if (my !== runToken) return false;
    const t = step.type;
    const f = step.fields || {};
    if (t === 'kl_vent') {
      await sleep(Number(f.SEC) * 1000);
    } else if (t === 'kl_arm_angle') {
      const axis = f.AXIS;
      const deg = Number(f.DEG);
      if (previewOnly) {
        animatePose(axis, deg);
        await sleep(280);
      } else {
        await applyArm(axis, deg);
      }
    } else if (t === 'kl_arm_xy') {
      const x = Number(f.X);
      const y = Number(f.Y);
      if (previewOnly) {
        animatePose('X', x);
        animatePose('Y', y);
        await sleep(280);
      } else {
        pose = { x, y };
        animatePose('X', x);
        animatePose('Y', y);
        const r = await bridge.jointSetPos(x, y);
        if (!r.ok) throw new Error(r.message || r.error || 'joint-set-pos fail');
        toast(`Arm X→${x}° Y→${y}°`);
      }
    } else if (t === 'kl_stop_sikkert') {
      pose = { x: 0, y: 0 };
      if (previewOnly) {
        animatePose('X', 0);
        animatePose('Y', 0);
        await sleep(200);
      } else {
        await applyArm('X', 0);
        await applyArm('Y', 0);
      }
    } else if (t === 'kl_opret_makro') {
      // Definition only — the body runs when the named block is called from My blocks
    } else if (t === 'kl_gentag_n') {
      const n = Number(f.N);
      for (let i = 0; i < n && my === runToken; i++) {
        const ok = await execSteps(step.do || [], my, previewOnly, depth);
        if (!ok) return false;
      }
    } else if (t === 'kl_gentag_for_evigt') {
      while (my === runToken) {
        const body = step.do || [];
        if (!body.length) {
          await sleep(50);
          continue;
        }
        const ok = await execSteps(body, my, previewOnly, depth);
        if (!ok) return false;
      }
      return false; // stopped
    } else if (t === 'kl_kald_makro') {
      const mac = findMacroById(f.MACRO) || null;
      if (!mac) {
        toast('That block is missing — save one under My blocks', true);
        return false;
      }
      const ok = await execSteps(mac.steps, my, previewOnly, depth + 1);
      if (!ok) return false;
    } else if (LED_BLOCK_TYPES.has(t)) {
      const g = assertGate('LED');
      toast(g.ok ? 'Lights in a block' : KID.gatedLed, !g.ok);
      if (!g.ok) return false;
    } else if (SPIN_BLOCK_TYPES.has(t)) {
      const g = assertGate('SPIN');
      toast(g.ok ? 'Wheels in a block' : KID.gatedSpin, !g.ok);
      if (!g.ok) return false;
    } else if (t === 'kl_lyd_tone') {
      await sleep(Number(f.MS) || 200);
    }
    // hvis / tal / sammenlign / sans: no-op in step runner (visual kids path)
  }
  return true;
}

async function execChain(startBlock, my, previewOnly) {
  let cur = startBlock;
  while (cur && my === runToken) {
    const t = cur.type;
    if (t === 'kl_vent') {
      await sleep(Number(cur.getFieldValue('SEC')) * 1000);
    } else if (t === 'kl_arm_angle') {
      const axis = cur.getFieldValue('AXIS');
      const deg = Number(cur.getFieldValue('DEG'));
      if (previewOnly) {
        animatePose(axis, deg);
        await sleep(280);
      } else {
        await applyArm(axis, deg);
      }
    } else if (t === 'kl_arm_xy') {
      const x = Number(cur.getFieldValue('X'));
      const y = Number(cur.getFieldValue('Y'));
      if (previewOnly) {
        animatePose('X', x);
        animatePose('Y', y);
        await sleep(280);
      } else {
        pose = { x, y };
        animatePose('X', x);
        animatePose('Y', y);
        const r = await bridge.jointSetPos(x, y);
        if (!r.ok) throw new Error(r.message || r.error || 'joint-set-pos fail');
        toast(`Arm X→${x}° Y→${y}°`);
      }
    } else if (t === 'kl_stop_sikkert') {
      pose = { x: 0, y: 0 };
      if (previewOnly) {
        animatePose('X', 0);
        animatePose('Y', 0);
        await sleep(200);
      } else {
        await applyArm('X', 0);
        await applyArm('Y', 0);
      }
    } else if (t === 'kl_opret_makro') {
      // Definition only — nest body is for save / call, not run-in-place
    } else if (t === 'kl_kald_makro') {
      const id = getCallMacroId(cur);
      const mac = findMacroById(id);
      if (!mac) {
        toast('That block is missing — save it with Create block first', true);
        return false;
      }
      const ok = await execSteps(mac.steps, my, previewOnly, 1);
      if (!ok) return false;
    } else if (t === 'kl_gentag_n') {
      const n = Number(cur.getFieldValue('N'));
      const inner = cur.getInputTargetBlock('DO');
      for (let i = 0; i < n && my === runToken; i++) {
        await execChain(inner, my, previewOnly);
      }
    } else if (t === 'kl_gentag_for_evigt') {
      const inner = cur.getInputTargetBlock('DO');
      while (my === runToken) {
        if (!inner) {
          await sleep(50);
          continue;
        }
        const ok = await execChain(inner, my, previewOnly);
        if (!ok) return false;
      }
      return false; // Stop
    } else if (LED_BLOCK_TYPES.has(t) || SPIN_BLOCK_TYPES.has(t)) {
      toast('That block is turned off for now — ask a teacher.', true);
      return false;
    } else if (t === 'kl_lyd_tone') {
      await sleep(Number(cur.getFieldValue('MS')));
    }
    cur = cur.getNextBlock();
  }
  return true;
}

async function runProgram({ previewOnly = false } = {}) {
  if (!workspace) return;

  for (const b of workspace.getAllBlocks(false)) {
    if (LED_BLOCK_TYPES.has(b.type)) {
      const g = assertGate('LED');
      if (!g.ok) { toast(b.type && LED_BLOCK_TYPES.has(b.type) ? KID.gatedLed : KID.gatedSpin, true); return; }
    }
    if (SPIN_BLOCK_TYPES.has(b.type)) {
      const g = assertGate('SPIN');
      if (!g.ok) { toast(b.type && LED_BLOCK_TYPES.has(b.type) ? KID.gatedLed : KID.gatedSpin, true); return; }
    }
  }

  if (!previewOnly) {
    if (!GATES.USB_TX) {
      toast('USB is turned off for now — ask a teacher.', true, { sticky: true });
      return;
    }
    const health = await bridge.health().catch(() => null);
    if (!health || !health.ok) {
      conn.bridge = false;
      clearConnected(bridge.transportMode() === 'none' ? bridge.unsupportedMessage() : KID.bridgeDown);
      return;
    }
    conn.bridge = true;
    if (health.port) conn.port = health.port;
    updateConnChip();
    if (!health.port) {
      clearConnected(KID.noPort);
      return;
    }
    // Re-check the link on every Run — clears a stuck Connected chip if the robot is off or the colour is wrong
    const still = await recheckLink({ quiet: false });
    if (!still) return;
  }

  const my = ++runToken;
  toast(previewOnly ? 'Preview (on this screen only)…' : 'Running…');
  try {
    for (const top of topBlocks()) {
      if (my !== runToken) break;
      const ok = await execChain(top, my, previewOnly);
      if (!ok) return;
    }
    if (my === runToken) toast(previewOnly ? 'Preview finished' : 'Done');
  } catch (e) {
    const raw = String(e.message || e);
    if (!previewOnly) {
      clearConnected(kidifyHubMessage(raw, KID.runFail));
      // Failed run → re-check so chip does not stay Forbundet
      await recheckLink({ quiet: true });
      if (!conn.linked && !toast._sticky) {
        toast(KID.runFail, true, { sticky: true });
      }
    } else {
      toast(kidifyHubMessage(raw, 'Something went wrong in the preview'), true);
    }
  } finally {
    document.getElementById('robotSvg').classList.remove('running');
  }
}

function stopProgram() {
  runToken++;
  document.getElementById('robotSvg').classList.remove('running');
  toast('Stop');
}

async function refreshPorts({ pick = false } = {}) {
  const sel = document.getElementById('portSelect');
  sel.innerHTML = '';
  try {
    const data = await bridge.listPorts({ pick });
    if (!data.ok) throw new Error(data.error || 'ports fail');
    const web = bridge.transportMode() === 'webserial';
    for (const p of data.ports) {
      const opt = document.createElement('option');
      opt.value = p.device;
      opt.textContent = web
        ? `${p.likely_hub ? '★ ' : ''}${p.description || 'USB serial'}`
        : `${p.likely_hub ? '★ ' : ''}${p.device} — ${p.description || ''}`;
      sel.appendChild(opt);
    }
    if (!data.ports.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = web ? '(press Ports, then Allow)' : '(no ports)';
      sel.appendChild(opt);
    }
    conn.bridge = true;
    setUsbChip(web ? (data.ports.length ? `${data.ports.length} dongle(s)` : 'web serial') : `${data.ports.length} port(s)`, true);
    updateConnChip();
  } catch (e) {
    const mode = bridge.transportMode();
    if (mode === 'webserial') {
      conn.bridge = true;
      conn.linked = false;
      setUsbChip('web serial', false);
      updateConnChip();
      toast('Could not choose the USB dongle. Press Ports and click Allow.', true, { sticky: true });
      return;
    }
    conn.bridge = false;
    conn.linked = false;
    setUsbChip(mode === 'none' ? 'Chrome or Edge' : 'bridge offline', false);
    updateConnChip();
    toast(mode === 'none' ? bridge.unsupportedMessage() : KID.portsFail, true, { sticky: true });
  }
}

async function connectUsb() {
  const portSel = document.getElementById('portSelect');
  const port = portSel.value;
  if (!port) { toast(KID.noPort, true, { sticky: true }); return; }
  const s = await bridge.selectPort(port);
  if (!s.ok) {
    clearConnected(KID.selectPortFail);
    return;
  }
  const label = (portSel.selectedOptions[0] && portSel.selectedOptions[0].textContent) || port;
  conn.port = String(label).replace(/^★\s*/, '');
  conn.bridge = true;
  let ping;
  try {
    ping = await bridge.pingHub();
  } catch (_) {
    ping = { ok: false };
  }
  if (!ping.ok) {
    clearConnected(KID.pingFail);
    return;
  }
  let d;
  try {
    d = await bridge.discover();
  } catch (_) {
    d = { ok: false, modules: [] };
  }
  const sawModule = !!(d && d.ok && Array.isArray(d.modules) && d.modules.length);
  if (!sawModule) {
    // USB dongle can ping while robot is off / wrong colour channel
    clearConnected(KID.discoverFail);
    return;
  }
  applyModulesFromDiscover(d);
  // Keep internal module_id on bridge for USB TX
  const sel = document.getElementById('moduleSelect');
  if (sel && sel.value) {
    try { await bridge.selectModule(sel.value); } catch (_) { /* ignore */ }
  }
  markConnected();
  toast(KID.connectOk);
}

async function applyModuleId() {
  const sel = document.getElementById('moduleSelect');
  const raw = sel ? sel.value.trim() : '';
  if (!raw) {
    toast('Choose a robot first', true);
    return;
  }
  const r = await bridge.selectModule(raw);
  if (r.ok) {
    const opt = sel.options[sel.selectedIndex];
    conn.robotSerial = opt ? (opt.dataset.serial || opt.textContent) : serialForModule(raw, '');
    updateConnChip();
    toast(`Robot ${conn.robotSerial || ''} selected`.trim());
  } else {
    toast('Could not choose that robot — try again', true);
  }
}

function initBlockly() {
  defineRoboBlocks();
  installPythonGenerators();
  workspace = Blockly.inject('blocklyDiv', {
    toolbox: buildToolboxJson(currentBand, currentLevel),
    trashcan: true,
    media: 'vendor/blockly/media/',
    renderer: 'zelos',
    grid: { spacing: 20, length: 2, colour: '#2c3a4f', snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.95 },
    move: { scrollbars: true, drag: true, wheel: true },
  });
  registerEgneToolbox(workspace, () => currentBand);
  setEgneRefreshHook(() => { refreshEgneToolbox(); refreshMacroSelect(); });
  workspace.addChangeListener(() => {
    if (document.getElementById('drawer').classList.contains('open')) refreshCode();
  });
  bindStoryboard(workspace, document.getElementById('storyStrip'));
  const xmlText = `<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="kl_vent" x="20" y="20">
      <field name="SEC">0.3</field>
      <next><block type="kl_arm_angle">
        <field name="AXIS">Y</field><field name="DEG">30</field>
        <next><block type="kl_vent">
          <field name="SEC">0.3</field>
          <next><block type="kl_stop_sikkert"></block></next>
        </block></next>
      </block></next>
    </block>
  </xml>`;
  Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xmlText), workspace);
  setToolboxVisible(readToolboxVisible());
  const area = document.getElementById('blocklyArea');
  if (typeof ResizeObserver !== 'undefined' && area) {
    new ResizeObserver(() => resizeBlockly()).observe(area);
  }
  window.addEventListener('resize', resizeBlockly);
  resizeBlockly();
}


function refreshMacroSelect() {
  const sel = document.getElementById('macroSelect');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '(your blocks)';
  sel.appendChild(opt0);
  for (const m of readMacros()) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function refreshEgneToolbox() {
  if (!workspace) return;
  workspace.updateToolbox(buildToolboxJson(currentBand, currentLevel));
  setToolboxVisible(readToolboxVisible());
}

function bindMacrosUI() {
  refreshMacroSelect();
  const nameInput = document.getElementById('macroName');
  const btnSave = document.getElementById('btnMacroSave');
  const btnDel = document.getElementById('btnMacroDelete');
  const sel = document.getElementById('macroSelect');
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      if (!workspace) return;
      const defines = workspace.getBlocksByType('kl_opret_makro', false);
      if (defines.length) {
        let last = null;
        for (const b of defines) {
          // Optional toolbar name overrides empty / default on the block
          if (nameInput && nameInput.value.trim()) {
            const typed = nameInput.value.trim();
            const cur = (b.getFieldValue('NAME') || '').trim();
            if (!cur || cur === 'my block') b.setFieldValue(typed, 'NAME');
          }
          const r = saveMacroFromDefine(b, currentBand);
          last = r;
          if (!r.ok) {
            toast(r.message, true);
            return;
          }
        }
        toast(last.message, !last.ok);
        if (last.ok) {
          refreshMacroSelect();
          refreshEgneToolbox();
          if (sel && last.macro) sel.value = last.macro.id;
          if (nameInput && last.macro) nameInput.value = last.macro.name;
        }
        return;
      }
      // Fallback: save the primary chain if there is no Create block on the canvas
      const chain = primaryStack(workspace);
      const start = chain[0] || null;
      const r = saveMacroFromChain(nameInput ? nameInput.value : '', start, currentBand);
      toast(r.message, !r.ok);
      if (r.ok) {
        refreshMacroSelect();
        refreshEgneToolbox();
        if (sel && r.macro) sel.value = r.macro.id;
      }
    });
  }
  if (btnDel) {
    btnDel.addEventListener('click', () => {
      const id = sel ? sel.value : '';
      if (!id) {
        toast('Choose a block to delete', true);
        return;
      }
      deleteMacro(id);
      toast('Block deleted');
      refreshMacroSelect();
      refreshEgneToolbox();
    });
  }
  if (sel) {
    sel.addEventListener('change', () => {
      if (!sel.value || !nameInput) return;
      const m = findMacroById(sel.value);
      if (m) nameInput.value = m.name;
    });
  }
}

async function boot() {
  document.getElementById('bandSelect').addEventListener('change', (e) => applyBand(e.target.value));
  document.getElementById('levelSelect').addEventListener('change', (e) => applyLevel(e.target.value));
  document.getElementById('btnToolboxToggle').addEventListener('click', () => {
    setToolboxVisible(!readToolboxVisible());
  });
  document.getElementById('btnPreviewToggle').addEventListener('click', () => {
    setPreviewVisible(!readPreviewVisible());
  });
  document.getElementById('btnMissionToggle').addEventListener('click', () => {
    setMissionVisible(!readMissionVisible());
  });
  setPreviewVisible(readPreviewVisible());
  setMissionVisible(readMissionVisible());
  document.getElementById('btnCode').addEventListener('click', () => setDrawer(true));
  document.getElementById('btnCloseDrawer').addEventListener('click', () => setDrawer(false));
  document.getElementById('backdrop').addEventListener('click', () => setDrawer(false));
  document.getElementById('btnPreview').addEventListener('click', () => runProgram({ previewOnly: true }));
  document.getElementById('btnRun').addEventListener('click', () => runProgram({ previewOnly: false }));
  document.getElementById('btnStop').addEventListener('click', stopProgram);
  document.getElementById('btnRefreshPorts').addEventListener('click', () => refreshPorts({ pick: true }));
  document.getElementById('btnConnect').addEventListener('click', connectUsb);
  document.getElementById('btnModule').addEventListener('click', applyModuleId);
  initBlockly();
  populateModulePicker([], 0xa2);
  updateConnChip();
  applyBand(currentBand);
  applyLevel(currentLevel);
  animatePose('X', 0);
  animatePose('Y', 0);
  bindProjectsUI({
    workspace,
    getBand: () => currentBand,
    setBand: (b) => applyBand(b),
    toast,
    onMacrosChanged: () => {
      refreshEgneToolbox();
      refreshMacroSelect();
    },
    els: {
      nameInput: document.getElementById('projectName'),
      selectEl: document.getElementById('projectSelect'),
      btnSave: document.getElementById('btnProjectSave'),
      btnLoad: document.getElementById('btnProjectLoad'),
      btnDelete: document.getElementById('btnProjectDelete'),
      btnDownload: document.getElementById('btnProjectDownload'),
      btnUpload: document.getElementById('btnProjectUpload'),
      fileInput: document.getElementById('projectFile'),
    },
  });
  bindMacrosUI();
  const dismissBtn = document.getElementById('toastDismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', () => hideToast());
  startLinkPoll();
  const detected = await bridge.detect();
  if (detected.mode === 'bridge') {
    const h = detected.health;
    conn.bridge = true;
    conn.via = 'bridge';
    if (h.port) {
      conn.port = h.port;
      // Port selected earlier this session — not linked until Connect and discover
      conn.linked = false;
    }
    setUsbChip('bridge ready', true);
    updateConnChip();
    await refreshPorts({ pick: false });
  } else if (detected.mode === 'webserial') {
    conn.bridge = true;
    conn.via = 'webserial';
    conn.linked = false;
    setUsbChip('web serial', true);
    updateConnChip();
    await refreshPorts({ pick: false });
  } else {
    conn.bridge = false;
    conn.via = 'unsupported';
    conn.linked = false;
    setUsbChip('Chrome or Edge', false);
    updateConnChip();
    toast(detected.message || bridge.unsupportedMessage(), true, { sticky: true });
  }
}

boot();
