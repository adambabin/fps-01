import type { Input } from './input';
import type { Settings } from './settings';

/** Stick travel ignored around centre, and how far a stick must go to count as a menu direction. */
const DEADZONE = 0.16, NAV_PUSH = 0.6;
/** Turn rate at full deflection, in mouse counts per second at mouse sensitivity 1 (~3.4 rad/s). */
const LOOK_RATE = 2800;
/** Menu repeat: delay before a held direction repeats, then the interval between repeats. */
const REPEAT_DELAY = 0.38, REPEAT_RATE = 0.11;
const FOCUSABLE = 'button, input, select';

type Dir = 'up' | 'down' | 'left' | 'right';

export interface PadCallbacks {
  /** B: leave the current sub-screen or the pause menu. */
  back(): void;
  /** Menu/Start pressed on a menu screen. */
  start(): void;
  /** The controller in use was unplugged. */
  lost(): void;
}

/**
 * Controller support through the Gamepad API, polled once per frame.
 *
 * In play, buttons become `PadN` codes in `Input.down`/`pressed`, so they are bound and read like
 * keys; the left stick feeds `Input.padX`/`padY` and the right stick the look deltas. On menu
 * screens the D-pad or left stick moves a highlight between controls, A activates, B goes back.
 */
export class Gamepads {
  /** True from a controller button press until a mouse button is used. */
  active = false;
  private prev: boolean[] = [];
  private index = -1;
  /** Highlighted menu control, and its position among the screen's controls for when the DOM is rebuilt. */
  private focus: HTMLElement | null = null;
  private focusIdx = 0;
  private focusScreen: Element | null = null;
  private navDir: Dir | null = null;
  private navT = 0;
  /** Sprint is a click of the stick, held until the stick is let go. */
  private sprintLatch = false;

  constructor(private input: Input, private settings: Settings, private cb: PadCallbacks) {
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.index) return;
      this.index = -1; this.prev = [];
      this.clearHeld();
      if (this.active) { this.release(); this.cb.lost(); }
    });
  }

  /** Name of the connected controller, or '' if none has been seen. */
  get name(): string { return this.pad()?.id.replace(/\s*\(.*\)\s*$/, '') ?? ''; }

  /** Hands control back to the mouse and drops the menu highlight. */
  release() {
    this.active = false;
    this.setFocus(null);
  }

  rumble(strength: number, ms: number) {
    if (!this.active || !this.settings.padVibration) return;
    try { (this.pad() as any)?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 })?.catch?.(() => {}); } catch { /* unsupported */ }
  }

  private pad(): Gamepad | null {
    let pads: (Gamepad | null)[];
    try { pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch { return null; }
    const cur = pads[this.index];
    if (cur && cur.connected) return cur;
    const next = pads.find((p) => p && p.connected && p.mapping === 'standard') ?? pads.find((p) => p && p.connected) ?? null;
    if (next && next.index !== this.index) { this.index = next.index; this.prev = []; }
    return next;
  }

  private clearHeld() {
    for (const c of [...this.input.down]) if (c.startsWith('Pad')) this.input.down.delete(c);
    this.input.padX = this.input.padY = 0;
    if (this.sprintLatch) { this.sprintLatch = false; this.input.virtualUp('sprint'); }
  }

  /** Reads the controller. `playing` selects gameplay input; otherwise the menus are driven. */
  poll(dt: number, playing: boolean) {
    const gp = this.pad();
    if (!gp) return;
    const input = this.input;
    // Triggers are analog: count them as pressed part-way down.
    const now = gp.buttons.map((b) => b.pressed || b.value > 0.35);
    const edges: number[] = [];
    now.forEach((d, i) => { if (d && !this.prev[i]) edges.push(i); });
    const released = this.prev.map((d, i) => d && !now[i]);
    this.prev = now;

    const [lx, ly] = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
    const [rx, ry] = stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
    if (edges.length) this.active = true;

    // Rebinding: the next button goes to the settings screen, not to the game or the menu.
    if (input.capture) {
      if (input.capturePad && edges.length) { const c = input.capture; input.capture = null; input.capturePad = false; c('Pad' + edges[0]); }
      return;
    }

    if (playing) {
      this.setFocus(null);
      for (const i of edges) { input.down.add('Pad' + i); input.pressed.add('Pad' + i); }
      released.forEach((r, i) => { if (r) input.down.delete('Pad' + i); });
      input.padX = lx; input.padY = -ly;
      // Squared response: fine aim near the centre, full speed at the rim.
      const m = Math.hypot(rx, ry), k = (m * LOOK_RATE * this.settings.padSensitivity * dt) / Math.max(0.05, this.settings.sensitivity);
      input.dx += rx * k; input.dy += ry * k * 0.7;
      const sprint = this.settings.pad.sprint;
      if (sprint && edges.includes(Number(sprint.slice(3)))) { this.sprintLatch = true; input.virtualDown('sprint'); }
      else if (this.sprintLatch && -ly < 0.35) { this.sprintLatch = false; input.virtualUp('sprint'); }
      return;
    }

    this.clearHeld();
    if (!this.active) return;
    const screen = document.querySelector('.screen:not(.hidden)');
    if (!screen) { this.setFocus(null); return; }
    const items = (Array.from(screen.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter((e) => !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0);
    if (!items.length) { this.setFocus(null); return; }
    // Keep a highlight on screen: the primary button of a new screen, or the same slot after a rebuild.
    if (!this.focus || !items.includes(this.focus)) {
      const same = screen === this.focusScreen;
      this.focusScreen = screen;
      this.setFocus(same ? items[Math.min(this.focusIdx, items.length - 1)] : items.find((e) => e.classList.contains('primary')) ?? items[0]);
    }
    this.focusIdx = items.indexOf(this.focus!);

    // Right stick scrolls long panels (settings, scoreboard).
    if (Math.abs(ry) > 0.2) (screen.querySelector('.panel') as HTMLElement | null)?.scrollBy(0, ry * 900 * dt);

    const dir: Dir | null = now[12] || ly < -NAV_PUSH ? 'up' : now[13] || ly > NAV_PUSH ? 'down' : now[14] || lx < -NAV_PUSH ? 'left' : now[15] || lx > NAV_PUSH ? 'right' : null;
    if (dir !== this.navDir) { this.navDir = dir; this.navT = REPEAT_DELAY; if (dir) this.navigate(dir, items); }
    else if (dir && (this.navT -= dt) <= 0) { this.navT = REPEAT_RATE; this.navigate(dir, items); }

    if (edges.includes(0)) this.activate();
    else if (edges.includes(1)) this.cb.back();
    else if (edges.includes(9)) this.cb.start();
  }

  private setFocus(el: HTMLElement | null) {
    if (el === this.focus) return;
    this.focus?.classList.remove('pad-focus');
    this.focus = el;
    if (el) { el.classList.add('pad-focus'); el.scrollIntoView({ block: 'nearest' }); }
  }

  private navigate(dir: Dir, items: HTMLElement[]) {
    const cur = this.focus!;
    const horiz = dir === 'left' || dir === 'right', sign = dir === 'left' || dir === 'up' ? -1 : 1;
    // Sliders and drop-downs change value sideways instead of moving the highlight.
    if (horiz && cur instanceof HTMLInputElement && cur.type === 'range') {
      const min = Number(cur.min), max = Number(cur.max), step = Number(cur.step) || 1;
      const jump = Math.max(step, Math.round((max - min) / 30 / step) * step);
      cur.value = String(Math.max(min, Math.min(max, Number(cur.value) + sign * jump)));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (horiz && cur instanceof HTMLSelectElement) { this.cycle(cur, sign); return; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    // Candidates ahead in that direction, with how far ahead and how far off to the side they are
    // (no sideways distance at all when the two controls overlap on that axis).
    const ahead: { el: HTMLElement; along: number; across: number; centre: number }[] = [];
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect(), dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = (horiz ? dx : dy) * sign;
      if (along < 3) continue;
      // Sideways moves stay within the row.
      if (horiz && Math.abs(dy) > Math.max(a.height, b.height) * 0.75) continue;
      const across = horiz ? 0 : Math.max(0, b.left - a.right, a.left - b.right);
      ahead.push({ el, along, across, centre: Math.abs(horiz ? dy : dx) });
    }
    // Step to the nearest row or column, then to whatever in it lines up best.
    const near = Math.min(...ahead.map((c) => c.along));
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const c of ahead) {
      if (c.along > near + 10) continue;
      const score = horiz ? c.along : c.across * 1000 + c.centre;
      if (score < bestScore) { bestScore = score; best = c.el; }
    }
    if (best) this.setFocus(best);
  }

  private cycle(sel: HTMLSelectElement, sign: number) {
    sel.selectedIndex = (sel.selectedIndex + sign + sel.options.length) % sel.options.length;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private activate() {
    const el = this.focus;
    if (!el) return;
    if (el instanceof HTMLSelectElement) this.cycle(el, 1);
    else if (!(el instanceof HTMLInputElement && el.type === 'range')) el.click();
  }
}

/** Applies a round dead zone and rescales so the response starts from zero at its edge. */
function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const k = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * k, y * k];
}
