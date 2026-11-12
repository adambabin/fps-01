import type { Action, Settings } from './settings';

export class Input {
  down = new Set<string>();
  pressed = new Set<string>();
  dx = 0;
  dy = 0;
  wheel = 0;
  /** When set, the next key or mouse press is routed here (used for rebinding). */
  capture: ((code: string) => void) | null = null;
  /** Mouse-look is only accumulated while this returns true. */
  lookActive: () => boolean = () => true;

  constructor(private settings: Settings) {
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const c = this.capture; this.capture = null; c(e.code);
        return;
      }
      if (this.lookActive() && !e.metaKey) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('mousedown', (e) => {
      const code = 'Mouse' + e.button;
      if (this.capture) {
        e.preventDefault(); e.stopPropagation();
        const c = this.capture; this.capture = null; c(code);
        return;
      }
      if (!this.lookActive()) return;
      this.down.add(code);
      this.pressed.add(code);
    }, true);
    window.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    window.addEventListener('mousemove', (e) => {
      if (!this.lookActive()) return;
      // Guard against the occasional huge spurious delta some browsers emit.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (this.lookActive()) { this.wheel += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.reset());
  }

  reset() { this.down.clear(); this.pressed.clear(); this.dx = this.dy = this.wheel = 0; }

  isDown(a: Action): boolean {
    for (const c of this.settings.binds[a]) if (this.down.has(c)) return true;
    return false;
  }
  wasPressed(a: Action): boolean {
    for (const c of this.settings.binds[a]) if (this.pressed.has(c)) return true;
    return false;
  }
  endFrame() { this.pressed.clear(); this.dx = 0; this.dy = 0; }
}
