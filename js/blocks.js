import { GATES } from './gates.js';
import {
  sanitizeMacroName,
  renameMacro,
  buildEgneFlyout,
} from './macros.js';

/**
 * Shared categories (English). Motion contents differ by Device (Explore vs Go).
 * minBand kept for legacy; Explore and Go both get the shared categories via bandAllows.
 */
export const CATEGORIES = [
  { id: 'bevaegelse', label: 'Motion', minBand: 'mini' },
  { id: 'sans', label: 'Sensing', minBand: 'mini' },
  { id: 'lys', label: 'Lights & sound', minBand: 'crew' },
  { id: 'gentag', label: 'Loops', minBand: 'mini' },
  { id: 'hvis', label: 'If', minBand: 'crew' },
  { id: 'egne', label: 'My blocks', minBand: 'kode' },
];

/** Toolbox custom-category key for saved blocks and Create block. */
export const EGNE_TOOLBOX_KEY = 'EGNE_KLODSER';

const BAND_RANK = { mini: 0, crew: 1, kode: 2, explore: 2, go: 2 };

export function bandAllows(band, minBand) {
  // Explore/Go: full shared toolbox rank (same as kode). Legacy mini/crew/kode still ranked.
  const rank = BAND_RANK[band] ?? 2;
  const need = BAND_RANK[minBand] ?? 0;
  return rank >= need;
}

const SPIN_TOOLTIP = 'Wheels are turned off for now — ask a teacher.';

/** Optional hook set by app.js so rename can refresh the flyout. */
let egneRefreshHook = null;

export function setEgneRefreshHook(fn) {
  egneRefreshHook = typeof fn === 'function' ? fn : null;
}

export function defineRoboBlocks() {
  Blockly.defineBlocksWithJsonArray([
    // ── Explore (Joint / arm) ──────────────────────────────────────────
    {
      type: 'kl_arm_angle',
      message0: 'arm %1 to %2 °',
      args0: [
        { type: 'field_dropdown', name: 'AXIS', options: [['X', 'X'], ['Y', 'Y']] },
        { type: 'field_number', name: 'DEG', value: 0, min: -90, max: 90 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 200,
      tooltip: 'Joint angle (−90…90). Explore X or Y.',
    },
    {
      type: 'kl_arm_xy',
      message0: 'arm X %1 °  Y %2 °',
      args0: [
        { type: 'field_number', name: 'X', value: 0, min: -90, max: 90 },
        { type: 'field_number', name: 'Y', value: 0, min: -90, max: 90 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 200,
      tooltip: 'Set both joints at once (Explore).',
    },
    {
      type: 'kl_vent',
      message0: 'wait %1 seconds',
      args0: [{ type: 'field_number', name: 'SEC', value: 0.5, min: 0, max: 30 }],
      previousStatement: null,
      nextStatement: null,
      colour: 200,
    },
    {
      type: 'kl_stop_sikkert',
      message0: 'safe stop (arm centre)',
      previousStatement: null,
      nextStatement: null,
      colour: 200,
      tooltip: 'Arm X and Y → 0° (Explore).',
    },
    // ── Go (drive / wheels — transmit gated) ───────────────────────────
    {
      type: 'kl_kør',
      message0: 'drive %1 @ %2 %',
      args0: [
        {
          type: 'field_dropdown', name: 'DIR',
          options: [['forward', 'FWD'], ['back', 'BACK']],
        },
        { type: 'field_number', name: 'SPEED', value: 30, min: 0, max: 100 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 0,
      tooltip: SPIN_TOOLTIP,
    },
    {
      type: 'kl_drej',
      message0: 'turn %1 %2 °',
      args0: [
        {
          type: 'field_dropdown', name: 'SIDE',
          options: [['left', 'LEFT'], ['right', 'RIGHT']],
        },
        { type: 'field_number', name: 'DEG', value: 90, min: 1, max: 360 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 0,
      tooltip: SPIN_TOOLTIP,
    },
    {
      type: 'kl_stop_hjul',
      message0: 'stop wheels',
      previousStatement: null,
      nextStatement: null,
      colour: 0,
      tooltip: SPIN_TOOLTIP,
    },
    {
      type: 'kl_hjul',
      message0: 'wheels %1 @ %2',
      args0: [
        {
          type: 'field_dropdown', name: 'DIR',
          options: [['forward', 'FWD'], ['back', 'BACK'], ['turn', 'TURN']],
        },
        { type: 'field_number', name: 'SPEED', value: 20, min: 0, max: 100 },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 0,
      tooltip: SPIN_TOOLTIP,
    },
    // ── Shared ─────────────────────────────────────────────────────────
    {
      type: 'kl_sans_afstand',
      message0: 'distance (cm)',
      output: 'Number',
      colour: 160,
      tooltip: 'Not connected to a sensor yet.',
    },
    {
      type: 'kl_lys_led',
      message0: 'LED colour %1',
      args0: [{
        type: 'field_dropdown', name: 'COLOR',
        options: [['red', 'red'], ['green', 'green'], ['blue', 'blue']],
      }],
      previousStatement: null,
      nextStatement: null,
      colour: 40,
      tooltip: 'Lights are turned off for now — ask a teacher.',
    },
    {
      type: 'kl_lyd_tone',
      message0: 'play tone %1 ms',
      args0: [{ type: 'field_number', name: 'MS', value: 200, min: 50, max: 2000 }],
      previousStatement: null,
      nextStatement: null,
      colour: 40,
    },
    {
      type: 'kl_gentag_n',
      message0: 'repeat %1 times %2 %3',
      args0: [
        { type: 'field_number', name: 'N', value: 3, min: 1, max: 50 },
        { type: 'input_dummy' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 120,
    },
    {
      type: 'kl_gentag_for_evigt',
      message0: 'forever %1 %2',
      args0: [
        { type: 'input_dummy' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 120,
      tooltip: 'Runs the blocks inside again and again until you press Stop.',
    },
    {
      type: 'kl_hvis',
      message0: 'if %1 then %2',
      args0: [
        { type: 'input_value', name: 'COND', check: 'Boolean' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 210,
    },
    {
      type: 'kl_tal',
      message0: '%1',
      args0: [{ type: 'field_number', name: 'NUM', value: 0 }],
      output: 'Number',
      colour: 230,
    },
    {
      type: 'kl_sammenlign',
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'Number' },
        { type: 'field_dropdown', name: 'OP', options: [['>', 'GT'], ['<', 'LT'], ['=', 'EQ']] },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      output: 'Boolean',
      colour: 210,
    },
    {
      type: 'kl_egen_firkant',
      message0: 'my block: drive a square',
      previousStatement: null,
      nextStatement: null,
      colour: 290,
      tooltip: SPIN_TOOLTIP,
    },
    // Define on the canvas: nest stacks inside, then Save → My blocks
    {
      type: 'kl_opret_makro',
      message0: 'create block %1 %2 %3',
      args0: [
        { type: 'field_input', name: 'NAME', text: 'my block' },
        { type: 'input_dummy' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 290,
      tooltip: 'Put blocks inside. Press Save as block — it shows up under My blocks.',
    },
  ]);

  // Call or rename a saved block.
  Blockly.Blocks['kl_kald_makro'] = {
    init: function () {
      const self = this;
      this.macroId_ = '';
      this.appendDummyInput()
        .appendField(
          new Blockly.FieldTextInput('my block', (newName) => self.handleRename_(newName)),
          'NAME',
        );
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour(290);
      this.setTooltip('Run your saved block. Change the name to rename it in My blocks.');
    },
    handleRename_: function (newName) {
      const clean = sanitizeMacroName(newName);
      if (!clean) return this.getFieldValue('NAME') || 'my block';
      if (!this.macroId_) return clean;
      const r = renameMacro(this.macroId_, clean);
      if (!r.ok) return this.getFieldValue('NAME') || 'my block';
      // Keep other call blocks with the same id in sync
      if (this.workspace && this.workspace.getBlocksByType) {
        for (const b of this.workspace.getBlocksByType('kl_kald_makro', false)) {
          if (b !== this && b.macroId_ === this.macroId_) {
            try { b.setFieldValue(clean, 'NAME'); } catch (_) { /* ignore */ }
          }
        }
      }
      if (egneRefreshHook) {
        try { egneRefreshHook(); } catch (_) { /* ignore */ }
      }
      return clean;
    },
    saveExtraState: function () {
      return this.macroId_ ? { macroId: this.macroId_ } : null;
    },
    loadExtraState: function (state) {
      this.macroId_ = (state && state.macroId) || '';
    },
  };
}

/** Blocks that require the wheel gate (Go drive transmit). */
export const SPIN_BLOCK_TYPES = new Set([
  'kl_hjul', 'kl_kør', 'kl_drej', 'kl_stop_hjul', 'kl_egen_firkant',
]);

/** Blocks that require LED gate. */
export const LED_BLOCK_TYPES = new Set(['kl_lys_led']);

/**
 * Toolbox contents depend on Device (Explore = arm, Go = drive/wheels).
 * Wheel transmit stays off: Go drive blocks are shown but generators and run stay gated.
 * My blocks uses a custom flyout (Create block plus saved blocks).
 */
export function buildToolboxJson(band) {
  const isGo = band === 'go';
  const contents = [];
  const pushCat = (id, blocks) => {
    const cat = CATEGORIES.find((c) => c.id === id);
    if (!cat || !bandAllows(band, cat.minBand)) return;
    if (!blocks.length) return;
    contents.push({
      kind: 'category',
      name: cat.label,
      contents: blocks.map((type) => ({ kind: 'block', type })),
    });
  };

  if (isGo) {
    // Go: drive / turn / stop — shown, but wheel transmit stays gated
    pushCat('bevaegelse', ['kl_kør', 'kl_drej', 'kl_stop_hjul', 'kl_hjul', 'kl_vent']);
    pushCat('sans', ['kl_sans_afstand']);
    pushCat('lys', ['kl_lyd_tone', 'kl_lys_led']);
    pushCat('gentag', ['kl_gentag_n', 'kl_gentag_for_evigt']);
    pushCat('hvis', ['kl_hvis', 'kl_sammenlign']);
  } else {
    // Explore: arm focused — lights stay gated and that category stays hidden
    pushCat('bevaegelse', ['kl_arm_angle', 'kl_arm_xy', 'kl_vent', 'kl_stop_sikkert']);
    pushCat('gentag', ['kl_gentag_n', 'kl_gentag_for_evigt']);
    pushCat('hvis', ['kl_hvis', 'kl_sammenlign']);
  }

  const egne = CATEGORIES.find((c) => c.id === 'egne');
  if (egne && bandAllows(band, egne.minBand)) {
    contents.push({
      kind: 'category',
      name: egne.label,
      custom: EGNE_TOOLBOX_KEY,
    });
  }

  return { kind: 'categoryToolbox', contents };
}

/** Register the Blockly toolbox callback for My blocks. */
export function registerEgneToolbox(workspace, getBand) {
  if (!workspace || !workspace.registerToolboxCategoryCallback) return;
  workspace.registerToolboxCategoryCallback(EGNE_TOOLBOX_KEY, () => {
    const band = typeof getBand === 'function' ? getBand() : 'explore';
    return buildEgneFlyout(band === 'go' ? 'go' : 'explore');
  });
}

export function installPythonGenerators() {
  const P = Blockly.Python;
  if (!P) return;

  P['kl_arm_angle'] = function (block) {
    const axis = block.getFieldValue('AXIS');
    const deg = Number(block.getFieldValue('DEG'));
    return `arm_set("${axis}", ${deg})\n`;
  };
  P['kl_arm_xy'] = function (block) {
    const x = Number(block.getFieldValue('X'));
    const y = Number(block.getFieldValue('Y'));
    return `arm_set("X", ${x})\narm_set("Y", ${y})\n`;
  };
  P['kl_vent'] = function (block) {
    return `time.sleep(${Number(block.getFieldValue('SEC'))})\n`;
  };
  P['kl_stop_sikkert'] = function () {
    return `arm_set("X", 0)\narm_set("Y", 0)  # safe stop\n`;
  };
  P['kl_sans_afstand'] = function () {
    return ['0  # distance not connected yet', P.ORDER_ATOMIC];
  };
  P['kl_lys_led'] = function (block) {
    const c = block.getFieldValue('COLOR');
    if (!GATES.LED) return `# [GATED] LED ${c} — lights are off\n`;
    return `led_set("${c}")\n`;
  };
  P['kl_lyd_tone'] = function (block) {
    return `play_tone(${Number(block.getFieldValue('MS'))})  # sound not sent\n`;
  };
  P['kl_gentag_n'] = function (block) {
    const n = Number(block.getFieldValue('N'));
    const branch = P.statementToCode(block, 'DO') || P.PASS;
    return `for _ in range(${n}):\n${branch}`;
  };
  P['kl_gentag_for_evigt'] = function (block) {
    const branch = P.statementToCode(block, 'DO') || P.PASS;
    return `while True:\n${branch}`;
  };
  P['kl_hvis'] = function (block) {
    const cond = P.valueToCode(block, 'COND', P.ORDER_NONE) || 'False';
    const branch = P.statementToCode(block, 'DO') || P.PASS;
    return `if ${cond}:\n${branch}`;
  };
  P['kl_tal'] = function (block) {
    return [String(block.getFieldValue('NUM')), P.ORDER_ATOMIC];
  };
  P['kl_sammenlign'] = function (block) {
    const ops = { GT: '>', LT: '<', EQ: '==' };
    const a = P.valueToCode(block, 'A', P.ORDER_RELATIONAL) || '0';
    const b = P.valueToCode(block, 'B', P.ORDER_RELATIONAL) || '0';
    return [`${a} ${ops[block.getFieldValue('OP')] || '=='} ${b}`, P.ORDER_RELATIONAL];
  };
  P['kl_hjul'] = function (block) {
    const dir = block.getFieldValue('DIR');
    const speed = block.getFieldValue('SPEED');
    if (!GATES.SPIN) return `# [GATED] wheels ${dir} @ ${speed} — wheels are off\n`;
    return `wheels("${dir}", ${speed})\n`;
  };
  P['kl_kør'] = function (block) {
    const dir = block.getFieldValue('DIR');
    const speed = block.getFieldValue('SPEED');
    if (!GATES.SPIN) return `# [GATED] drive ${dir} @ ${speed} — wheels are off\n`;
    return `drive("${dir}", ${speed})\n`;
  };
  P['kl_drej'] = function (block) {
    const side = block.getFieldValue('SIDE');
    const deg = block.getFieldValue('DEG');
    if (!GATES.SPIN) return `# [GATED] turn ${side} ${deg}° — wheels are off\n`;
    return `turn("${side}", ${deg})\n`;
  };
  P['kl_stop_hjul'] = function () {
    if (!GATES.SPIN) return `# [GATED] stop wheels — wheels are off\n`;
    return `wheels_stop()\n`;
  };
  P['kl_egen_firkant'] = function () {
    if (!GATES.SPIN) return `# [GATED] drive a square — wheels are off\n`;
    return (
      'for _ in range(4):\n' +
      '    drive("FWD", 30)\n' +
      '    time.sleep(1.5)\n' +
      '    turn("RIGHT", 90)\n'
    );
  };
  P['kl_opret_makro'] = function (block) {
    const name = block.getFieldValue('NAME') || '';
    return `# define block ${JSON.stringify(name)} (runs from My blocks)\n`;
  };
  P['kl_kald_makro'] = function (block) {
    const id = block.macroId_ || '';
    const name = block.getFieldValue('NAME') || '';
    return `run_macro(${JSON.stringify(id || name)})  # my block\n`;
  };
}
