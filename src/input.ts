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
  /** Actions held by on-screen touch buttons, read alongside the key binds. */
  private virtual = new Set<Action>();
  private virtualPressed = new Set<Action>();
  /** Analog move stick (strafe, forward) in -1..1, added to the movement keys. */
  moveX = 0;
  moveY = 0;

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
      if (!this.lookActive()) return;
      // Firefox often reports lines or pages rather than pixels; convert so one notch is ~100 px everywhere.
      this.wheel += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.reset());
  }

  reset() {
    this.down.clear(); this.pressed.clear(); this.dx = this.dy = this.wheel = 0;
    this.virtual.clear(); this.virtualPressed.clear(); this.moveX = this.moveY = 0;
  }

  virtualDown(a: Action) {
    if (!this.virtual.has(a)) this.virtualPressed.add(a);
    this.virtual.add(a);
  }
  virtualUp(a: Action) { this.virtual.delete(a); }

  isDown(a: Action): boolean {
    if (this.virtual.has(a)) return true;
    for (const c of this.settings.binds[a]) if (this.down.has(c)) return true;
    return false;
  }
  wasPressed(a: Action): boolean {
    if (this.virtualPressed.has(a)) return true;
    for (const c of this.settings.binds[a]) if (this.pressed.has(c)) return true;
    return false;
  }
  endFrame() { this.pressed.clear(); this.virtualPressed.clear(); this.dx = 0; this.dy = 0; }
}
