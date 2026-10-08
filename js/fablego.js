/**
 * Fable Go (drive kit) — RoboFables' own blocks, Python preview text and on-screen simulator.
 *
 * Nothing here is sent to a real robot yet: we have no Fable Go to test with, and the wheel
 * gate (GATES.SPIN) stays off. Run shows a friendly "not on the real robot yet" message;
 * Preview runs everything in the simulator below, with sliders standing in for the sensors.
 */

/** Sensor positions seen from the front of the robot (left = 1, centre = 2, right = 3). */
const SENSOR_OPTS = [['left', '1'], ['centre', '2'], ['right', '3']];
const COLOUR_OPTS = [
  ['red', 'red'], ['green', 'green'], ['blue', 'blue'], ['yellow', 'yellow'],
  ['magenta', 'magenta'], ['cyan', 'cyan'], ['white', 'white'], ['black', 'black'],
];
/** Rough 0–100 RGB for each colour, used by the simulator. */
const COLOUR_RGB = {
  red: [90, 10, 10], green: [10, 80, 15], blue: [10, 20, 90], yellow: [90, 85, 10],
  magenta: [85, 10, 80], cyan: [10, 80, 85], white: [95, 95, 95], black: [4, 4, 4],
  none: [30, 30, 30],
};
const LED_HEX = {
  red: '#ff3b3b', green: '#3ddc5a', blue: '#3b7bff', yellow: '#ffe03b', magenta: '#ff3bd8',
  cyan: '#3bf0ff', white: '#ffffff', off: '#333a44',
};
/** Fill for the three front sensor spots on the simulator drawing. */
const SPOT_HEX = { ...LED_HEX, black: '#0b0d10', none: '#4a525e' };
const IR_OPTS = [
  ['A', '65'], ['B', '66'], ['C', '67'], ['D', '68'], ['X', '88'], ['Y', '89'], ['Z', '90'],
  ['space', '32'], ['1', '49'], ['2', '50'], ['3', '51'],
];

const C_MOVE = 15;
const C_SENSE = 170;
const C_LIGHT = 45;

/**
 * Hardware facts for a later real-robot driver (Spin module register numbers). Not used yet.
 * TODO(fable-go): wire through the bridge / Web Serial once someone can test on a real Fable Go.
 */
export const FABLE_GO_REGISTERS = Object.freeze({
  ledRGB: [62, 63, 64],
  battery_mV: [65, 66],
  speedA: [75, 76], speedB: [87, 88], // value = round(% × 60 / 100) + 32768
  posA: [81, 82], posB: [93, 94],     // value = degrees + 32768
  headlight: 97,
  sensors: [
    { ambient: 99, r: 100, g: 101, b: 102, prox: 103 },
    { ambient: 105, r: 106, g: 107, b: 108, prox: 109 },
    { ambient: 111, r: 112, g: 113, b: 114, prox: 115 },
  ],
  irSend: 116, irReceived: 117,
});

export const FG_BLOCK_DEFS = [
  // ── Moving ───────────────────────────────────────────────────────────
  {
    type: 'fg_drive', message0: 'drive %1',
    args0: [{ type: 'field_dropdown', name: 'DIR', options: [['forward', 'forward'], ['backward', 'backward'], ['left', 'left'], ['right', 'right']] }],
    previousStatement: null, nextStatement: null, colour: C_MOVE,
    tooltip: 'Start your Fable Go moving. It keeps going until you stop it.',
  },
  {
    type: 'fg_stop', message0: 'stop driving',
    previousStatement: null, nextStatement: null, colour: C_MOVE,
    tooltip: 'Stop both wheels.',
  },
  {
    type: 'fg_motor_speeds', message0: 'wheel speeds A %1 % B %2 %',
    args0: [
      { type: 'field_number', name: 'A', value: 50, min: -100, max: 100 },
      { type: 'field_number', name: 'B', value: 50, min: -100, max: 100 },
    ],
    previousStatement: null, nextStatement: null, colour: C_MOVE,
    tooltip: 'Set each wheel from −100 to 100 %. A is the left wheel, B the right. Plus is forwards.',
  },
  {
    type: 'fg_drive_distance', message0: 'drive %1 %2 cm at %3 %',
    args0: [
      { type: 'field_dropdown', name: 'DIR', options: [['forward', 'forward'], ['backward', 'backward']] },
      { type: 'field_number', name: 'CM', value: 20, min: 0, max: 500 },
      { type: 'field_number', name: 'SPEED', value: 50, min: 1, max: 100 },
    ],
    previousStatement: null, nextStatement: null, colour: C_MOVE,
    tooltip: 'Drive a set distance, then stop.',
  },
  {
    type: 'fg_turn', message0: 'turn %1 %2 ° at %3 %',
    args0: [
      { type: 'field_dropdown', name: 'DIR', options: [['left', 'left'], ['right', 'right']] },
      { type: 'field_number', name: 'DEG', value: 90, min: 0, max: 3600 },
      { type: 'field_number', name: 'SPEED', value: 40, min: 1, max: 100 },
    ],
    previousStatement: null, nextStatement: null, colour: C_MOVE,
    tooltip: 'Turn on the spot by a number of degrees, then stop.',
  },
  // ── Lights & IR ──────────────────────────────────────────────────────
  {
    type: 'fg_headlights', message0: 'headlights %1',
    args0: [{ type: 'field_dropdown', name: 'MODE', options: [['on', 'on'], ['off', 'off'], ['switch', 'toggle']] }],
    previousStatement: null, nextStatement: null, colour: C_LIGHT,
    tooltip: 'The two white lights on the front.',
  },
  {
    type: 'fg_led', message0: 'status light %1',
    args0: [{ type: 'field_dropdown', name: 'COLOUR', options: [...COLOUR_OPTS.filter(([, v]) => v !== 'black'), ['off', 'off']] }],
    previousStatement: null, nextStatement: null, colour: C_LIGHT,
    tooltip: 'Colour of the light on the module.',
  },
  {
    type: 'fg_ir_send', message0: 'send IR message %1',
    args0: [{ type: 'field_dropdown', name: 'MSG', options: IR_OPTS }],
    previousStatement: null, nextStatement: null, colour: C_LIGHT,
    tooltip: 'Send one letter to another robot with the infrared light (about 1 m).',
  },
  // ── Sensing ──────────────────────────────────────────────────────────
  {
    type: 'fg_proximity', message0: 'distance sensor %1',
    args0: [{ type: 'field_dropdown', name: 'SENSOR', options: SENSOR_OPTS }],
    output: 'Number', colour: C_SENSE,
    tooltip: '0 = nothing there, 100 = very close (works from about 3 to 15 cm). Left/right as you look at the front.',
  },
  {
    type: 'fg_obstacle', message0: 'something closer than %1 %',
    args0: [{ type: 'field_number', name: 'PCT', value: 50, min: 0, max: 100 }],
    output: 'Boolean', colour: C_SENSE,
    tooltip: 'True when all three distance sensors read at least this much.',
  },
  {
    type: 'fg_sees_colour', message0: 'sees %1 with %2 sensor',
    args0: [
      { type: 'field_dropdown', name: 'COLOUR', options: COLOUR_OPTS },
      { type: 'field_dropdown', name: 'SENSOR', options: SENSOR_OPTS },
    ],
    output: 'Boolean', colour: C_SENSE,
    tooltip: 'True when that sensor sees the colour (hold it within about 3 cm).',
  },
  {
    type: 'fg_colour_rgb', message0: '%1 amount from %2 colour sensor',
    args0: [
      { type: 'field_dropdown', name: 'CH', options: [['red', 'r'], ['green', 'g'], ['blue', 'b']] },
      { type: 'field_dropdown', name: 'SENSOR', options: SENSOR_OPTS },
    ],
    output: 'Number', colour: C_SENSE,
    tooltip: 'How much red, green or blue the sensor sees, 0–100.',
  },
  {
    type: 'fg_light', message0: '%1 light at %2 sensor',
    args0: [
      { type: 'field_dropdown', name: 'KIND', options: [['room', 'ambient'], ['reflected', 'directed']] },
      { type: 'field_dropdown', name: 'SENSOR', options: SENSOR_OPTS },
    ],
    output: 'Number', colour: C_SENSE,
    tooltip: 'Room light = light around you. Reflected = light bounced back from something in front. 0–100.',
  },
  {
    type: 'fg_ir_received', message0: 'got IR message %1 ?',
    args0: [{ type: 'field_dropdown', name: 'MSG', options: IR_OPTS }],
    output: 'Boolean', colour: C_SENSE,
    tooltip: 'True when the last infrared message was this letter.',
  },
  {
    type: 'fg_motor_angle', message0: 'wheel %1 angle °',
    args0: [{ type: 'field_dropdown', name: 'MOTOR', options: [['A', 'A'], ['B', 'B']] }],
    output: 'Number', colour: C_SENSE,
    tooltip: 'How far the wheel has turned since the start, in degrees.',
  },
  {
    type: 'fg_motors_moving', message0: '%1 wheels moving?',
    args0: [{ type: 'field_dropdown', name: 'WHICH', options: [['any', 'any'], ['both', 'both'], ['no', 'no'], ['A', 'A'], ['B', 'B']] }],
    output: 'Boolean', colour: C_SENSE,
  },
  {
    type: 'fg_battery', message0: 'battery %',
    output: 'Number', colour: C_SENSE,
  },
];

export const FG_BLOCK_TYPES = new Set(FG_BLOCK_DEFS.map((d) => d.type));
export const FG_STATEMENT_TYPES = new Set(FG_BLOCK_DEFS.filter((d) => !d.output).map((d) => d.type));

/** Toolbox lists: [categoryId, blockTypes] */
export const FG_TOOLBOX = {
  simple: [
    ['bevaegelse', ['fg_drive', 'fg_stop', 'kl_vent']],
    ['lys', ['fg_headlights']],
    ['sans', ['fg_proximity', 'fg_obstacle', 'fg_sees_colour']],
    ['gentag', ['kl_gentag_n', 'kl_gentag_for_evigt']],
    ['hvis', ['kl_hvis', 'kl_sammenlign', 'kl_tal']],
  ],
  full: [
    ['bevaegelse', ['fg_drive', 'fg_stop', 'fg_motor_speeds', 'fg_drive_distance', 'fg_turn', 'kl_vent']],
    ['sans', ['fg_proximity', 'fg_obstacle', 'fg_sees_colour', 'fg_colour_rgb', 'fg_light',
      'fg_ir_received', 'fg_motor_angle', 'fg_motors_moving', 'fg_battery']],
    ['lys', ['fg_headlights', 'fg_led', 'fg_ir_send']],
    ['gentag', ['kl_gentag_n', 'kl_gentag_for_evigt']],
    ['hvis', ['kl_hvis', 'kl_sammenlign', 'kl_tal']],
  ],
};

export function defineFableGoBlocks() {
  Blockly.defineBlocksWithJsonArray(FG_BLOCK_DEFS);
}

/** "See the code" text — RoboFables' own helper names, not any vendor API. */
export function installFableGoGenerators(P) {
  if (!P) return;
  const f = (b, n) => b.getFieldValue(n);
  const q = (s) => JSON.stringify(String(s));
  P['fg_drive'] = (b) => `go.drive(${q(f(b, 'DIR'))})\n`;
  P['fg_stop'] = () => 'go.stop()\n';
  P['fg_motor_speeds'] = (b) => `go.wheel_speeds(${Number(f(b, 'A'))}, ${Number(f(b, 'B'))})\n`;
  P['fg_drive_distance'] = (b) => `go.drive_cm(${q(f(b, 'DIR'))}, ${Number(f(b, 'CM'))}, speed=${Number(f(b, 'SPEED'))})\n`;
  P['fg_turn'] = (b) => `go.turn(${q(f(b, 'DIR'))}, ${Number(f(b, 'DEG'))}, speed=${Number(f(b, 'SPEED'))})\n`;
  P['fg_headlights'] = (b) => `go.headlights(${q(f(b, 'MODE'))})\n`;
  P['fg_led'] = (b) => `go.status_light(${q(f(b, 'COLOUR'))})\n`;
  P['fg_ir_send'] = (b) => `go.ir_send(${Number(f(b, 'MSG'))})\n`;
  const A = P.ORDER_ATOMIC, CALL = P.ORDER_FUNCTION_CALL || A;
  P['fg_proximity'] = (b) => [`go.distance(${f(b, 'SENSOR')})`, CALL];
  P['fg_obstacle'] = (b) => [`go.obstacle_within(${Number(f(b, 'PCT'))})`, CALL];
  P['fg_sees_colour'] = (b) => [`go.sees_colour(${q(f(b, 'COLOUR'))}, ${f(b, 'SENSOR')})`, CALL];
  P['fg_colour_rgb'] = (b) => [`go.colour_rgb(${f(b, 'SENSOR')})[${'rgb'.indexOf(f(b, 'CH'))}]`, CALL];
  P['fg_light'] = (b) => [`go.light(${q(f(b, 'KIND'))}, ${f(b, 'SENSOR')})`, CALL];
  P['fg_ir_received'] = (b) => [`go.ir_received() == ${Number(f(b, 'MSG'))}`, P.ORDER_RELATIONAL || A];
  P['fg_motor_angle'] = (b) => [`go.wheel_angle(${q(f(b, 'MOTOR'))})`, CALL];
  P['fg_motors_moving'] = (b) => [`go.wheels_moving(${q(f(b, 'WHICH'))})`, CALL];
  P['fg_battery'] = () => ['go.battery()', CALL];
}

// ── Simulator ──────────────────────────────────────────────────────────
const CM_PER_S_AT_100 = 33.7; // 60 RPM × π × 10.74 cm wheel
const AXLE_CM = 12.14;
const WHEEL_CIRC_CM = Math.PI * 10.74;
// The arena is ARENA × ARENA cm (1 SVG unit = 1 cm). The SVG is drawn up to 330 px tall (css/app.css .go-arena),
// so 100 cm gives ~3.3 px per cm: the robot shows about 3× larger than the old 200 cm / 220 px view.
const ARENA = 100;
const ROBOT_R = 21; // cm from the robot's centre to its farthest corner (wheels/body), keeps it inside the floor

export const sim = {
  x: ARENA / 2, y: ARENA / 2, heading: -90, // degrees, -90 = up
  speedA: 0, speedB: 0, angleA: 0, angleB: 0,
  headlights: false, led: 'off',
  prox: [0, 0, 0], colour: ['none', 'none', 'none'], ambient: 50, directed: 20,
  ir: 0, battery: 80, irSentUntil: 0,
};

let lastT = 0;
let rafId = 0;

function tick(t) {
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  if (dt && (sim.speedA || sim.speedB)) {
    const vA = (sim.speedA / 100) * CM_PER_S_AT_100;
    const vB = (sim.speedB / 100) * CM_PER_S_AT_100;
    const v = (vA + vB) / 2;
    const w = ((vA - vB) / AXLE_CM) * (180 / Math.PI); // A=left: A faster → turn right (clockwise on screen)
    sim.heading += w * dt;
    const r = (sim.heading * Math.PI) / 180;
    sim.x = Math.max(ROBOT_R, Math.min(ARENA - ROBOT_R, sim.x + Math.cos(r) * v * dt));
    sim.y = Math.max(ROBOT_R, Math.min(ARENA - ROBOT_R, sim.y + Math.sin(r) * v * dt));
    sim.angleA += (vA * dt / WHEEL_CIRC_CM) * 360;
    sim.angleB += (vB * dt / WHEEL_CIRC_CM) * 360;
  }
  renderRobot();
  rafId = requestAnimationFrame(tick);
}

function ensureLoop() {
  if (!rafId && typeof requestAnimationFrame === 'function') {
    lastT = 0;
    rafId = requestAnimationFrame(tick);
  }
}

export function simStopWheels() {
  sim.speedA = 0;
  sim.speedB = 0;
  renderRobot();
}

export function simReset() {
  Object.assign(sim, { x: ARENA / 2, y: ARENA / 2, heading: -90, speedA: 0, speedB: 0, angleA: 0, angleB: 0, headlights: false, led: 'off' });
  renderRobot();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one Fable Go statement in the simulator.
 * @param {string} type
 * @param {(name:string)=>any} field
 * @param {()=>boolean} alive false once Stop is pressed
 */
export async function simExec(type, field, alive) {
  ensureLoop();
  const num = (n) => Number(field(n)) || 0;
  const DRIVE = { forward: [50, 50], backward: [-50, -50], left: [-50, 50], right: [50, -50] };
  switch (type) {
    case 'fg_drive': [sim.speedA, sim.speedB] = DRIVE[field('DIR')] || [0, 0]; break;
    case 'fg_stop': simStopWheels(); break;
    case 'fg_motor_speeds':
      sim.speedA = Math.max(-100, Math.min(100, num('A')));
      sim.speedB = Math.max(-100, Math.min(100, num('B')));
      break;
    case 'fg_drive_distance': {
      const sp = Math.max(1, Math.min(100, num('SPEED')));
      const s = field('DIR') === 'backward' ? -sp : sp;
      sim.speedA = s; sim.speedB = s;
      await waitWhile(Math.abs(num('CM')) / ((sp / 100) * CM_PER_S_AT_100) * 1000, alive);
      simStopWheels();
      break;
    }
    case 'fg_turn': {
      const sp = Math.max(1, Math.min(100, num('SPEED')));
      const right = field('DIR') === 'right';
      sim.speedA = right ? sp : -sp; sim.speedB = right ? -sp : sp;
      const arc = (Math.abs(num('DEG')) / 360) * Math.PI * AXLE_CM;
      await waitWhile(arc / ((sp / 100) * CM_PER_S_AT_100) * 1000, alive);
      simStopWheels();
      break;
    }
    case 'fg_headlights': {
      const m = field('MODE');
      sim.headlights = m === 'toggle' ? !sim.headlights : m === 'on';
      break;
    }
    case 'fg_led': sim.led = field('COLOUR'); break;
    case 'fg_ir_send': {
      const lab = document.getElementById('goSimIrOut');
      if (lab) lab.textContent = `sent: ${String.fromCharCode(num('MSG'))}`;
      sim.irSentUntil = Date.now() + 500; // the IR mark on the drawing flashes
      break;
    }
    default: break;
  }
  renderRobot();
  await sleep(60);
}

async function waitWhile(ms, alive) {
  const end = Date.now() + Math.min(ms, 60000);
  while (Date.now() < end && alive()) await sleep(30);
}

/** Read a Fable Go sensor block's value from the simulator. */
export function simValue(type, field) {
  const idx = Math.max(0, Math.min(2, (Number(field('SENSOR')) || 1) - 1));
  switch (type) {
    case 'fg_proximity': return sim.prox[idx];
    case 'fg_obstacle': return Number(field('PCT')) <= Math.min(...sim.prox);
    case 'fg_sees_colour': return sim.colour[idx] === field('COLOUR');
    case 'fg_colour_rgb': return (COLOUR_RGB[sim.colour[idx]] || COLOUR_RGB.none)['rgb'.indexOf(field('CH'))];
    case 'fg_light': return field('KIND') === 'directed' ? sim.directed : sim.ambient;
    case 'fg_ir_received': return sim.ir === Number(field('MSG'));
    case 'fg_motor_angle': return Math.round(field('MOTOR') === 'B' ? sim.angleB : sim.angleA);
    case 'fg_motors_moving': {
      const a = sim.speedA !== 0, b = sim.speedB !== 0;
      return { any: a || b, both: a && b, no: !a && !b, A: a, B: b }[field('WHICH')] ?? false;
    }
    case 'fg_battery': return sim.battery;
    default: return 0;
  }
}

// ── Simulator panel (top-down robot + sensor sliders) ─────────────────
function renderRobot() {
  const g = document.getElementById('goSimRobot');
  if (!g) return;
  g.setAttribute('transform', `translate(${sim.x.toFixed(1)} ${sim.y.toFixed(1)}) rotate(${(sim.heading + 90).toFixed(1)})`);
  const hl = document.getElementById('goSimBeams');
  if (hl) hl.style.display = sim.headlights ? '' : 'none';
  const led = document.getElementById('goSimLed');
  if (led) led.setAttribute('fill', LED_HEX[sim.led] || LED_HEX.off);
  for (const id of ['goSimLampL', 'goSimLampR']) {
    const lamp = document.getElementById(id);
    if (lamp) lamp.setAttribute('fill', sim.headlights ? '#fff6a8' : '#5b6470');
  }
  // Front sensors: index 0/1/2 = sensor 1/2/3 = left/centre/right as you look at the front.
  for (let i = 0; i < 3; i++) {
    const halo = document.getElementById(`goSimProx${i}`);
    if (halo) {
      const p = Math.max(0, Math.min(100, sim.prox[i])) / 100;
      halo.setAttribute('r', (2.2 + p * 3.2).toFixed(2));
      halo.setAttribute('opacity', (p * 0.75).toFixed(2));
    }
    const spot = document.getElementById(`goSimSpot${i}`);
    if (spot) spot.setAttribute('fill', SPOT_HEX[sim.colour[i]] || SPOT_HEX.none);
  }
  const ir = document.getElementById('goSimIr');
  if (ir) ir.setAttribute('fill', Date.now() < sim.irSentUntil ? '#ff4d4d' : sim.ir ? '#ff9a3c' : '#4a2a30');
  const batt = document.getElementById('goSimBatt');
  if (batt) {
    const b = Math.max(0, Math.min(100, sim.battery));
    batt.setAttribute('width', ((b / 100) * 6.4).toFixed(2));
    batt.setAttribute('fill', b > 50 ? '#3ddc5a' : b > 20 ? '#ffe03b' : '#ff3b3b');
  }
  const info = document.getElementById('goSimInfo');
  if (info) info.textContent = `A ${sim.speedA}% · B ${sim.speedB}%`;
}

export function mountSimPanel(host) {
  if (!host || document.getElementById('goSim')) return;
  const wrap = document.createElement('div');
  wrap.id = 'goSim';
  wrap.className = 'go-sim';
  wrap.hidden = true;
  const colourSel = (i) => `<select data-colour="${i}" aria-label="Colour under the ${SENSOR_OPTS[i][0]} sensor"><option value="none">nothing</option>${COLOUR_OPTS.map(([l, v]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
  const slider = (key, label, val) => `<label>${label}<input type="range" min="0" max="100" value="${val}" data-key="${key}"><output>${val}</output></label>`;
  wrap.innerHTML = `
    <svg viewBox="0 0 ${ARENA} ${ARENA}" class="go-arena" aria-label="Fable Go preview seen from above">
      <rect x="0" y="0" width="${ARENA}" height="${ARENA}" rx="4" class="go-floor"/>
      <g id="goSimRobot">
        <g id="goSimBeams"><path d="M-8.6,-14 L-17,-40 L-1,-40 Z M8.6,-14 L1,-40 L17,-40 Z" fill="#fff8c0" opacity="0.45"/></g>
        <rect x="-15" y="-9" width="6" height="18" rx="2" class="go-wheel"/>
        <rect x="9" y="-9" width="6" height="18" rx="2" class="go-wheel"/>
        <path d="M-15,-5 h6 M-15,-1 h6 M-15,3 h6 M9,-5 h6 M9,-1 h6 M9,3 h6" class="go-tread"/>
        <rect x="-10" y="-14" width="20" height="26" rx="5" fill="#e9edf2" stroke="#9aa3b0" stroke-width="0.6"/>
        <rect x="-9" y="-14" width="18" height="5" rx="1.5" fill="#29303a"/>
        <circle id="goSimLampL" cx="-8.6" cy="-14.2" r="1.1" fill="#5b6470"/><circle id="goSimLampR" cx="8.6" cy="-14.2" r="1.1" fill="#5b6470"/>
        ${[0, 1, 2].map((i) => { const x = [5.6, 0, -5.6][i]; return `<g><title>Sensor ${i + 1} (${SENSOR_OPTS[i][0]} as you look at the front)</title><circle id="goSimProx${i}" cx="${x}" cy="-12.6" r="2.2" fill="#ff9a3c" opacity="0"/><circle id="goSimSpot${i}" cx="${x}" cy="-12.6" r="1.9" fill="${SPOT_HEX.none}" stroke="#c9d1db" stroke-width="0.35"/><text x="${x}" y="-16.4" font-size="3.4" text-anchor="middle" class="go-sensor-tag">${'LCR'[i]}</text></g>`; }).join('')}
        <g><title>IR sender and receiver</title><rect id="goSimIr" x="-2.4" y="-8.4" width="4.8" height="2.2" rx="0.8" fill="#4a2a30"/><text x="0" y="-4.2" font-size="1.9" text-anchor="middle" fill="#6b7480">IR</text></g>
        <circle id="goSimLed" cx="0" cy="1.5" r="3.2" fill="${LED_HEX.off}" stroke="#9aa3b0" stroke-width="0.4"/>
        <g><title>Battery</title><rect x="-3.6" y="6.4" width="7" height="3" rx="0.6" fill="#29303a" stroke="#6b7480" stroke-width="0.35"/><rect x="3.4" y="7.3" width="0.8" height="1.2" fill="#6b7480"/><rect id="goSimBatt" x="-3.3" y="6.7" width="5" height="2.4" rx="0.4" fill="#3ddc5a"/></g>
        <text x="-13" y="14" font-size="6" fill="#c9d1db">A</text><text x="10" y="14" font-size="6" fill="#c9d1db">B</text>
      </g>
    </svg>
    <p class="go-sim-info"><span id="goSimInfo"></span> <span id="goSimIrOut"></span>
      <button type="button" id="goSimReset">Back to start</button></p>
    <fieldset class="go-sim-sensors"><legend>Pretend sensors (drag to test your program). Left/right = as you look at the robot's front (L C R on the drawing).</legend>
      ${slider('prox0', 'Distance left', 0)}${slider('prox1', 'Distance centre', 0)}${slider('prox2', 'Distance right', 0)}
      <label>Colour left ${colourSel(0)}</label><label>Colour centre ${colourSel(1)}</label><label>Colour right ${colourSel(2)}</label>
      ${slider('ambient', 'Room light', sim.ambient)}${slider('directed', 'Reflected light', sim.directed)}${slider('battery', 'Battery', sim.battery)}
      <label>IR message in <select data-ir><option value="0">none</option>${IR_OPTS.map(([l, v]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    </fieldset>`;
  host.appendChild(wrap);
  wrap.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      inp.nextElementSibling.textContent = String(v);
      const k = inp.dataset.key;
      if (k.startsWith('prox')) sim.prox[Number(k.slice(4))] = v;
      else sim[k] = v;
    });
  });
  wrap.querySelectorAll('select[data-colour]').forEach((s) => {
    s.addEventListener('change', () => { sim.colour[Number(s.dataset.colour)] = s.value; });
  });
  wrap.querySelector('select[data-ir]').addEventListener('change', (e) => { sim.ir = Number(e.target.value); });
  wrap.querySelector('#goSimReset').addEventListener('click', simReset);
  renderRobot();
}

export function showSimPanel(show) {
  const el = document.getElementById('goSim');
  if (el) el.hidden = !show;
  if (show) ensureLoop();
}
