// Keyboard and mouse state for the whole game. One Input instance listens on the
// window; the simulation reads `keys` (held), `pressed` (went down this step) and the
// accumulated mouse movement, and clears the per-step sets at the end of each frame.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.clicked = false; // left button went down this frame
    this.locked = false;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.clicked = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      } else if (this.dragging) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.dragging = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.dragging = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  /** Ask the browser for pointer lock (needs a user gesture; safe to call often). */
  lockPointer(canvas) {
    if (!this.locked && canvas.requestPointerLock) {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch {
        /* headless or denied: drag-look still works */
      }
    }
  }

  /** True while any of the given KeyboardEvent codes is held. */
  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** True if the code went down since the last endFrame(). */
  wasPressed(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Consume the accumulated mouse movement. */
  takeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /** Clear the per-frame edges; call once per rendered frame after the sim steps. */
  endFrame() {
    this.pressed.clear();
    this.clicked = false;
  }
}
