// Portside Heat — keyboard and mouse: held keys for movement, edge-triggered action
// flags for the things that must fire once (interact, reload, pause, confirm), and the
// mouse position the renderer turns into an aim point.

export const ACTION_INTERACT = 1;
export const ACTION_ATTACK = 2;
export const ACTION_RELOAD = 4;
export const ACTION_PAUSE = 8;
export const ACTION_CONFIRM = 16;
export const ACTION_MUTE = 32;

const KEY_ACTIONS = {
  KeyE: ACTION_INTERACT,
  KeyF: ACTION_ATTACK,
  KeyR: ACTION_RELOAD,
  Escape: ACTION_PAUSE,
  KeyP: ACTION_PAUSE,
  Enter: ACTION_CONFIRM,
  Space: ACTION_CONFIRM,
  KeyM: ACTION_MUTE,
};

export function createInput(canvas) {
  const held = new Set();
  let pendingActions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let clicked = false;
  let firstGesture = null;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    held.add(event.code);
    const action = KEY_ACTIONS[event.code];
    if (action) pendingActions |= action;
    if (firstGesture) {
      firstGesture();
      firstGesture = null;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  window.addEventListener('blur', () => {
    held.clear();
    mouseDown = false;
  });
  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
  });
  canvas.addEventListener('mousedown', (event) => {
    mouseDown = true;
    clicked = true;
    pendingActions |= ACTION_CONFIRM;
    if (firstGesture) {
      firstGesture();
      firstGesture = null;
    }
    event.preventDefault();
  });
  window.addEventListener('mouseup', () => {
    mouseDown = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Movement axes from the held keys: x is -1..1 (left..right), y is -1..1 (up..down). */
    axes() {
      let x = 0;
      let y = 0;
      if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1;
      if (held.has('KeyD') || held.has('ArrowRight')) x += 1;
      if (held.has('KeyW') || held.has('ArrowUp')) y -= 1;
      if (held.has('KeyS') || held.has('ArrowDown')) y += 1;
      return { x, y };
    },
    isHeld(code) {
      return held.has(code);
    },
    sprint() {
      return held.has('ShiftLeft') || held.has('ShiftRight');
    },
    handbrake() {
      return held.has('Space');
    },
    /** Edge-triggered actions since the last call; the call consumes them. */
    takeActions() {
      const actions = pendingActions;
      pendingActions = 0;
      return actions;
    },
    mouse() {
      return { x: mouseX, y: mouseY, down: mouseDown };
    },
    /** True once if the mouse was clicked since the last call. */
    takeClick() {
      const was = clicked;
      clicked = false;
      return was;
    },
    /** Register a one-time callback for the first key press or click (audio unlock). */
    onFirstGesture(callback) {
      firstGesture = callback;
    },
  };
}
