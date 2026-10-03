/**
 * Classroom missions for the Explore joint arm.
 * Wording is original. Solutions use block types defined in blocks.js only.
 * Beginner: wait, one-axis arm angle, safe stop, repeat.
 * Experienced: those plus both joints, forever, and if (number check, no sensors).
 */

function chain(blocks) {
  if (!blocks.length) return '';
  let xml = blocks[blocks.length - 1];
  for (let i = blocks.length - 2; i >= 0; i--) {
    const b = blocks[i];
    const idx = b.lastIndexOf('</block>');
    xml = b.slice(0, idx) + `<next>${xml}</next></block>`;
  }
  return xml;
}

function angle(axis, deg) {
  return `<block type="kl_arm_angle"><field name="AXIS">${axis}</field><field name="DEG">${deg}</field></block>`;
}

function wait(sec) {
  return `<block type="kl_vent"><field name="SEC">${sec}</field></block>`;
}

function safeStop() {
  return '<block type="kl_stop_sikkert"></block>';
}

function armXy(x, y) {
  return `<block type="kl_arm_xy"><field name="X">${x}</field><field name="Y">${y}</field></block>`;
}

function repeat(n, innerChain) {
  return `<block type="kl_gentag_n"><field name="N">${n}</field><statement name="DO">${innerChain}</statement></block>`;
}

function forever(innerChain) {
  return `<block type="kl_gentag_for_evigt"><statement name="DO">${innerChain}</statement></block>`;
}

function numberBlock(n) {
  return `<block type="kl_tal"><field name="NUM">${n}</field></block>`;
}

/** if (a op b) then inner — number check only, no sensor. */
function ifCompare(a, op, b, innerChain) {
  return (
    `<block type="kl_hvis">` +
    `<value name="COND"><block type="kl_sammenlign"><field name="OP">${op}</field>` +
    `<value name="A">${numberBlock(a)}</value>` +
    `<value name="B">${numberBlock(b)}</value>` +
    `</block></value>` +
    `<statement name="DO">${innerChain}</statement>` +
    `</block>`
  );
}

function withPos(blockXml, x, y) {
  return blockXml.replace('<block ', `<block x="${x}" y="${y}" `);
}

export const TRACKS = [
  {
    id: 'beginner',
    label: 'Beginner',
    needsFull: false,
    missions: [
      {
        id: 'hello-tip',
        title: 'Hello tip',
        goal: 'Tip the arm forward a little, pause, then come back to the centre.',
        stack: () => chain([angle('Y', 25), wait(0.5), safeStop()]),
      },
      {
        id: 'lean-both-ways',
        title: 'Lean both ways',
        goal: 'Lean to the left, pause, lean to the right, pause, then stop in the middle.',
        stack: () => chain([
          angle('X', -35), wait(0.4),
          angle('X', 35), wait(0.4),
          safeStop(),
        ]),
      },
      {
        id: 'two-nods',
        title: 'Two nods',
        goal: 'Nod up and down two times, then rest in the centre.',
        stack: () => chain([
          repeat(2, chain([
            angle('Y', 22), wait(0.35),
            angle('Y', -12), wait(0.35),
          ])),
          safeStop(),
        ]),
      },
      {
        id: 'slow-sweep',
        title: 'Slow sweep',
        goal: 'Sweep from one side to the other in small steps. Pause on each step, then stop safely.',
        stack: () => chain([
          angle('X', -40), wait(0.3),
          angle('X', -20), wait(0.3),
          angle('X', 0), wait(0.3),
          angle('X', 20), wait(0.3),
          angle('X', 40), wait(0.3),
          safeStop(),
        ]),
      },
      {
        id: 'four-corners',
        title: 'Four corners',
        goal: 'Visit four corner poses, like the corners of a square. Pause at each one, then come home.',
        stack: () => chain([
          angle('X', -30), angle('Y', 30), wait(0.45),
          angle('X', 30), wait(0.45),
          angle('Y', -30), wait(0.45),
          angle('X', -30), wait(0.45),
          safeStop(),
        ]),
      },
    ],
  },
  {
    id: 'experienced',
    label: 'Experienced',
    needsFull: true,
    missions: [
      {
        id: 'both-at-once',
        title: 'Both at once',
        goal: 'Move both joints together to one pose, hold it, then return to the centre.',
        stack: () => chain([armXy(30, -20), wait(0.5), safeStop()]),
      },
      {
        id: 'corner-loop',
        title: 'Corner loop',
        goal: 'Go around four corner poses twice. Set both joints on each corner, then stop in the centre.',
        stack: () => chain([
          repeat(2, chain([
            armXy(-25, 25), wait(0.35),
            armXy(25, 25), wait(0.35),
            armXy(25, -25), wait(0.35),
            armXy(-25, -25), wait(0.35),
          ])),
          safeStop(),
        ]),
      },
      {
        id: 'wave-until-stop',
        title: 'Wave until Stop',
        goal: 'Wave up and down again and again. It keeps going until you press Stop.',
        stack: () => forever(chain([
          angle('Y', 32), wait(0.35),
          angle('Y', -18), wait(0.35),
        ])),
      },
      {
        id: 'nod-if-bigger',
        title: 'Nod if bigger',
        goal: 'Nod once only when four is bigger than one, then come back to the centre. Change the numbers and see what happens when the check is false.',
        stack: () => ifCompare(4, 'GT', 1, chain([
          angle('Y', 28), wait(0.4), safeStop(),
        ])),
      },
      {
        id: 'side-patrol',
        title: 'Side patrol',
        goal: 'Sweep from side to side forever. On each pass, dip forward only when two is bigger than zero. Press Stop when you are done.',
        stack: () => forever(chain([
          armXy(-36, 0), wait(0.35),
          ifCompare(2, 'GT', 0, chain([
            armXy(0, 28), wait(0.25),
            armXy(0, 0), wait(0.2),
          ])),
          armXy(36, 0), wait(0.35),
        ])),
      },
    ],
  },
];

export function findTrack(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}

/** Full Blockly XML for one mission stack, positioned on the canvas. */
export function missionWorkspaceXml(mission, x, y) {
  const block = withPos(mission.stack(), x, y);
  return `<xml xmlns="https://developers.google.com/blockly/xml">${block}</xml>`;
}
