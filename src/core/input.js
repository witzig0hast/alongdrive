// Eingabe: Tastatur, Maus (Pointer Lock), virtuelle Touch-Eingaben
import { settings } from './settings.js';

class Input {
  constructor() {
    this.keys = new Set();
    this.pressedCodes = new Set();
    this.virtualDown = new Set();
    this.virtualPressed = new Set();
    this.mouseButtons = new Set();
    this.mousePressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.moveAxis = { x: 0, y: 0 }; // Touch-Joystick
    this.locked = false;
    this.enabled = true; // false, wenn ein Menü/Chat offen ist
    this.rawHandler = null; // z. B. Tastenbelegung
    this.touchLook = { x: 0, y: 0 };
    this.canvas = null;
  }

  init(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (this.rawHandler && this.rawHandler(e)) return;
      if (!this.enabled) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F3', 'F1'].includes(e.code)) e.preventDefault();
      if (e.ctrlKey && ['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) e.preventDefault();
      if (this.locked && !this.keys.has(e.code)) this.pressedCodes.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.pressedCodes.clear();
      if (!this.locked) {
        this.keys.clear();
        this.mouseButtons.clear();
      }
      this.onLockChange?.(this.locked);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock() {
    if (this.touchMode) {
      this.locked = true;
      this.onLockChange?.(true);
      return;
    }
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  unlock() {
    if (this.touchMode) {
      this.locked = false;
      this.onLockChange?.(false);
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Aktion gedrückt gehalten? */
  down(action) {
    if (!this.locked) return false;
    if (this.virtualDown.has(action)) return true;
    const code = settings.bindings[action];
    return code ? this.keys.has(code) : false;
  }

  /** Aktion in diesem Frame gerade gedrückt? */
  pressed(action) {
    if (!this.locked) return false;
    if (this.virtualPressed.has(action)) return true;
    const code = settings.bindings[action];
    return code ? this.pressedCodes.has(code) : false;
  }

  codePressed(code) {
    return this.locked && this.pressedCodes.has(code);
  }

  mouseDown(b) {
    return this.locked && this.mouseButtons.has(b);
  }

  mouseClicked(b) {
    return this.locked && this.mousePressed.has(b);
  }

  setVirtual(action, isDown) {
    if (isDown) {
      if (!this.virtualDown.has(action)) this.virtualPressed.add(action);
      this.virtualDown.add(action);
    } else this.virtualDown.delete(action);
  }

  consumeLook() {
    const out = { x: this.dx + this.touchLook.x, y: this.dy + this.touchLook.y };
    this.dx = this.dy = 0;
    this.touchLook.x = this.touchLook.y = 0;
    return out;
  }

  /** Bewegungsachsen (-1..1): x rechts, y vorwärts */
  axes() {
    let x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let y = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    x += this.moveAxis.x;
    y += this.moveAxis.y;
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  endFrame() {
    this.pressedCodes.clear();
    this.mousePressed.clear();
    this.virtualPressed.clear();
  }
}

export const input = new Input();
