/**
 * Left-to-right storyboard strip for the primary (top) statement stack.
 * English labels from block types and fields; click selects and scrolls to the block.
 */

const LABELERS = {
  kl_arm_angle: (b) => {
    const axis = b.getFieldValue('AXIS');
    const deg = b.getFieldValue('DEG');
    return `Arm ${axis} → ${deg}°`;
  },
  kl_vent: (b) => `Wait ${b.getFieldValue('SEC')} s`,
  kl_stop_sikkert: () => 'Safe stop',
  kl_lys_led: (b) => `LED ${b.getFieldValue('COLOR')}`,
  kl_lyd_tone: (b) => `Tone ${b.getFieldValue('MS')} ms`,
  kl_gentag_n: (b) => `Repeat ×${b.getFieldValue('N')}`,
  kl_gentag_for_evigt: () => 'Forever',
  kl_hvis: () => 'If …',
  kl_opret_makro: (b) => {
    const n = b.getFieldValue('NAME');
    return n ? `Create: ${n}` : 'Create block';
  },
  kl_kald_makro: (b) => {
    const n = b.getFieldValue('NAME');
    return n ? `Block: ${n}` : 'Block';
  },
  kl_egen_firkant: () => 'Drive a square',
  kl_arm_xy: (b) => `Arm X${b.getFieldValue('X')} Y${b.getFieldValue('Y')}`,
  kl_kør: (b) => `Drive ${b.getFieldValue('DIR')}`,
  kl_drej: (b) => `Turn ${b.getFieldValue('SIDE')}`,
  kl_stop_hjul: () => 'Stop wheels',
  kl_hjul: (b) => `Wheels ${b.getFieldValue('DIR')} @${b.getFieldValue('SPEED')}`,
  kl_sans_afstand: () => 'Distance',
  kl_tal: (b) => String(b.getFieldValue('NUM')),
  kl_sammenlign: (b) => {
    const op = { GT: '>', LT: '<', EQ: '=' }[b.getFieldValue('OP')] || '?';
    return `Compare ${op}`;
  },
};

function labelFor(block) {
  const fn = LABELERS[block.type];
  if (fn) return fn(block);
  return block.type.replace(/^kl_/, '').replace(/_/g, ' ');
}

function accentFor(type) {
  if (type.startsWith('kl_arm') || type === 'kl_vent' || type === 'kl_stop_sikkert') return 'move';
  if (type === 'kl_gentag_n' || type === 'kl_gentag_for_evigt') return 'loop';
  if (type === 'kl_hvis' || type === 'kl_sammenlign') return 'logic';
  if (type === 'kl_lys_led' || type === 'kl_lyd_tone') return 'sense';
  if (type === 'kl_opret_makro' || type === 'kl_kald_makro' || type === 'kl_egen_firkant') return 'macro';
  if (type === 'kl_hjul') return 'gated';
  return 'other';
}

/** Primary stack = first top statement block, then the next-chain. */
export function primaryStack(workspace) {
  if (!workspace) return [];
  const tops = workspace.getTopBlocks(true).filter((b) => !b.outputConnection);
  if (!tops.length) return [];
  const chain = [];
  let cur = tops[0];
  while (cur) {
    chain.push(cur);
    cur = cur.getNextBlock();
  }
  return chain;
}

export function renderStoryboardStrip(workspace, stripEl) {
  if (!stripEl) return;
  const chain = primaryStack(workspace);
  stripEl.innerHTML = '';
  if (!chain.length) {
    const empty = document.createElement('div');
    empty.className = 'sb-empty';
    empty.textContent = 'Drag blocks in — the storyboard follows the top chain →';
    stripEl.appendChild(empty);
    return;
  }
  chain.forEach((block, i) => {
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'sb-connector';
      conn.setAttribute('aria-hidden', 'true');
      stripEl.appendChild(conn);
    }
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `sb-card sb-${accentFor(block.type)}`;
    card.dataset.blockId = block.id;
    const step = document.createElement('span');
    step.className = 'sb-step';
    step.textContent = String(i + 1);
    const label = document.createElement('span');
    label.className = 'sb-label';
    label.textContent = labelFor(block);
    card.appendChild(step);
    card.appendChild(label);
    card.title = 'Click to select this block';
    card.addEventListener('click', () => {
      try {
        workspace.highlightBlock(block.id);
        block.select();
        const xy = block.getRelativeToSurfaceXY();
        const metrics = workspace.getMetrics();
        if (metrics && typeof workspace.scroll === 'function') {
          workspace.scroll(
            -(xy.x - metrics.viewWidth / 3),
            -(xy.y - metrics.viewHeight / 3),
          );
        }
      } catch (_) {
        /* ignore */
      }
    });
    stripEl.appendChild(card);
  });
}

export function bindStoryboard(workspace, stripEl) {
  const refresh = () => renderStoryboardStrip(workspace, stripEl);
  refresh();
  workspace.addChangeListener((e) => {
    if (e.type === Blockly.Events.VIEWPORT_CHANGE) return;
    refresh();
  });
  return refresh;
}
