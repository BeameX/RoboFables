/**
 * Hard gates — lights and wheels stay off.
 * USB transmit is open for dongle ping, discover, module ping, and joint position.
 */
export const GATES = Object.freeze({
  LED: false,
  SPIN: false,
  USB_TX: true,
});

export function assertGate(name) {
  if (!GATES[name]) {
    return {
      ok: false,
      message: `${name} is turned off for now — ask a teacher.`,
    };
  }
  return { ok: true };
}

export function gatedStubComment(name) {
  return `# [GATED] ${name} — no USB (turned off)`;
}
