import type { Input } from './input';
import type { Action } from './settings';

/**
 * True on phones and tablets, where there is no mouse and no Pointer Lock API (iOS Safari
 * has none at all). `?touch` forces it on for testing on a desktop.
 */
export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).has('touch')) return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const fine = window.matchMedia?.('(any-pointer: fine)').matches ?? false;
  return coarse && !fine && navigator.maxTouchPoints > 0;
}

/** Look speed for a finger drag, relative to mouse counts at the same sensitivity. */
const LOOK_GAIN = 2.2;
const STICK_RADIUS = 56;

const BUTTONS: { action: Action; label: string; cls: string }[] = [
  { action: 'fire', label: 'FIRE', cls: 'fire' },
  { action: 'ads', label: 'AIM', cls: 'ads' },
  { action: 'jump', label: 'JUMP', cls: 'jump' },
  { action: 'crouch', label: 'CROUCH', cls: 'crouch' },
  { action: 'reload', label: 'RELOAD', cls: 'reload' },
  { action: 'grenade', label: 'NADE', cls: 'grenade' },
  { action: 'melee', label: 'MELEE', cls: 'melee' },
  { action: 'nextWeapon', label: 'SWAP', cls: 'swap' },
  { action: 'pause', label: '❚❚', cls: 'pause' },
];

/**
 * On-screen controls for touch devices: a floating move stick on the left half, drag to look
 * on the right half, and action buttons. They feed `Input` through its virtual actions and
 * look deltas, so the rest of the game reads them exactly like keys and the mouse.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickX = 0; private stickY = 0;
  /** Fingers currently turning the camera (the look area and the fire button), with last position. */
  private lookers = new Map<number, { x: number; y: number }>();
  /** Which action each finger on a button is holding. */
  private held = new Map<number, Action>();

  constructor(private input: Input) {
    document.body.classList.add('touch');
    const root = this.root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = '<div class="look-area"></div><div class="stick"><div class="knob"></div></div>' +
      BUTTONS.map((b) => `<div class="tbtn ${b.cls}" data-action="${b.action}">${b.label}</div>`).join('');
    document.body.appendChild(root);
    this.stick = root.querySelector('.stick')!;
    this.knob = root.querySelector('.knob')!;

    const opts = { passive: false } as const;
    root.addEventListener('touchstart', (e) => this.start(e), opts);
    root.addEventListener('touchmove', (e) => this.move(e), opts);
    root.addEventListener('touchend', (e) => this.end(e), opts);
    root.addEventListener('touchcancel', (e) => this.end(e), opts);
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.release();
  }

  /** Lets go of everything, e.g. when the game pauses mid-touch. */
  release() {
    this.stickId = null; this.lookers.clear();
    for (const a of this.held.values()) this.input.virtualUp(a);
    this.held.clear();
    this.input.virtualUp('sprint');
    this.input.moveX = this.input.moveY = 0;
    this.stick.classList.remove('active');
    this.knob.style.transform = '';
  }

  private start(e: TouchEvent) {
    e.preventDefault();
    const w = window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      const el = (t.target as HTMLElement).closest?.('.tbtn') as HTMLElement | null;
      if (el) {
        const a = el.dataset.action as Action;
        this.held.set(t.identifier, a);
        this.input.virtualDown(a);
        el.classList.add('on');
        // The fire button doubles as a look surface so you can shoot and aim with one thumb.
        if (a === 'fire') this.lookers.set(t.identifier, { x: t.clientX, y: t.clientY });
      } else if (t.clientX < w * 0.42 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickX = t.clientX; this.stickY = t.clientY;
        this.stick.style.left = t.clientX + 'px';
        this.stick.style.top = t.clientY + 'px';
        this.stick.classList.add('active');
        this.knob.style.transform = '';
      } else {
        this.lookers.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }

  private move(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.stickX, dy = t.clientY - this.stickY;
        const d = Math.hypot(dx, dy);
        if (d > STICK_RADIUS) { dx *= STICK_RADIUS / d; dy *= STICK_RADIUS / d; }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const nx = dx / STICK_RADIUS, ny = -dy / STICK_RADIUS, m = Math.hypot(nx, ny);
        const dead = m < 0.18;
        this.input.moveX = dead ? 0 : nx;
        this.input.moveY = dead ? 0 : ny;
        // Pushing the stick to the rim straight ahead sprints.
        if (m > 0.92 && ny > 0.75) this.input.virtualDown('sprint'); else this.input.virtualUp('sprint');
      }
      const l = this.lookers.get(t.identifier);
      if (l) {
        this.input.dx += (t.clientX - l.x) * LOOK_GAIN;
        this.input.dy += (t.clientY - l.y) * LOOK_GAIN;
        l.x = t.clientX; l.y = t.clientY;
      }
    }
  }

  private end(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.input.moveX = this.input.moveY = 0;
        this.input.virtualUp('sprint');
        this.stick.classList.remove('active');
        this.knob.style.transform = '';
      }
      this.lookers.delete(t.identifier);
      const a = this.held.get(t.identifier);
      if (a) {
        this.held.delete(t.identifier);
        if (![...this.held.values()].includes(a)) {
          this.input.virtualUp(a);
          this.root.querySelector(`.tbtn[data-action="${a}"]`)?.classList.remove('on');
        }
      }
    }
  }
}
