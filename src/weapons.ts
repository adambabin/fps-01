import * as THREE from 'three';
import type { AudioSys, ShotKind } from './audio';
import type { Effects } from './effects';
import type { Enemy, EnemyManager } from './enemies';
import type { Input } from './input';
import type { CollisionWorld } from './physics';
import type { Player } from './player';
import type { Settings } from './settings';
import { buildGun, railGlow, type GunModel, type ReloadSpec } from './gunModels';
import { makeFlashTexture } from './textures';

export interface WeaponDef {
  name: string; slot: string; sound: ShotKind; auto: boolean;
  damage: number; pellets: number; rpm: number; mag: number; reserve: number; reload: number;
  hip: number; ads: number; bloom: number; kickP: number; kickY: number;
  zoom: number; adsTime: number; falloff: [number, number, number];
  crit: number; pierce: boolean;
  /** Fires an explosive shell instead of an instant hit; the value is the shell speed. */
  launch?: number;
  /** Wave from which the unlock is offered, and the pitch on its upgrade card. */
  unlockWave?: number; pitch?: string;
  hipPos: [number, number, number]; adsZ: number;
  tracer: [number, number, number];
}

export const WEAPONS: WeaponDef[] = [
  {
    name: 'P-9 Sidearm', slot: 'Sidearm', sound: 'pistol', auto: false, damage: 27, pellets: 1, rpm: 380, mag: 12, reserve: Infinity, reload: 1.25,
    hip: 0.014, ads: 0.002, bloom: 0.012, kickP: 0.024, kickY: 0.007, zoom: 1.2, adsTime: 0.14, falloff: [18, 40, 0.6],
    crit: 2, pierce: false, hipPos: [0.12, -0.115, -0.44], adsZ: -0.5, tracer: [3, 2.2, 1.2],
  },
  {
    name: 'AR-7 Vector', slot: 'Rifle', sound: 'rifle', auto: true, damage: 21, pellets: 1, rpm: 680, mag: 30, reserve: 180, reload: 1.9,
    hip: 0.022, ads: 0.0035, bloom: 0.006, kickP: 0.0085, kickY: 0.0045, zoom: 1.35, adsTime: 0.2, falloff: [28, 60, 0.65],
    crit: 1.8, pierce: false, hipPos: [0.135, -0.155, -0.4], adsZ: -0.33, tracer: [3, 2.2, 1.2],
  },
  {
    name: 'SG-12 Breacher', slot: 'Shotgun', sound: 'shotgun', auto: false, damage: 14, pellets: 10, rpm: 84, mag: 6, reserve: 36, reload: 2.3,
    hip: 0.062, ads: 0.045, bloom: 0, kickP: 0.07, kickY: 0.015, zoom: 1.15, adsTime: 0.22, falloff: [8, 24, 0.25],
    crit: 1.4, pierce: false, unlockWave: 1, pitch: 'Unlock the pump shotgun. Ten pellets a shell; devastating up close.', hipPos: [0.135, -0.135, -0.38], adsZ: -0.3, tracer: [2.5, 1.8, 1],
  },
  {
    name: 'RX Lancer', slot: 'Railgun', sound: 'rail', auto: false, damage: 190, pellets: 1, rpm: 46, mag: 4, reserve: 20, reload: 2.6,
    hip: 0.03, ads: 0, bloom: 0, kickP: 0.09, kickY: 0.01, zoom: 2.6, adsTime: 0.28, falloff: [200, 300, 1],
    crit: 2.2, pierce: true, unlockWave: 4, pitch: 'Unlock the railgun. Huge damage that punches through every robot in line.', hipPos: [0.14, -0.165, -0.4], adsZ: -0.3, tracer: [0.6, 3, 5],
  },
  {
    name: 'VX-9 Hornet', slot: 'SMG', sound: 'smg', auto: true, damage: 14, pellets: 1, rpm: 960, mag: 40, reserve: 240, reload: 1.55,
    hip: 0.015, ads: 0.006, bloom: 0.0035, kickP: 0.0055, kickY: 0.005, zoom: 1.2, adsTime: 0.13, falloff: [12, 30, 0.5],
    crit: 1.6, pierce: false, unlockWave: 2, pitch: 'Unlock the submachine gun. Very fast and accurate from the hip, weak at range.',
    hipPos: [0.13, -0.14, -0.38], adsZ: -0.3, tracer: [3, 2.4, 1.4],
  },
  {
    name: 'GL-6 Thumper', slot: 'Launcher', sound: 'launcher', auto: false, damage: 170, pellets: 1, rpm: 72, mag: 6, reserve: 18, reload: 2.9,
    hip: 0.01, ads: 0.003, bloom: 0, kickP: 0.06, kickY: 0.012, zoom: 1.25, adsTime: 0.24, falloff: [200, 300, 1],
    crit: 1, pierce: false, launch: 40, unlockWave: 3, pitch: 'Unlock the grenade launcher. Arcing shells that burst on impact and clear groups.',
    hipPos: [0.15, -0.16, -0.45], adsZ: -0.3, tracer: [3, 1.8, 0.5],
  },
];

export interface WeaponState { ammo: number; reserve: number; unlocked: boolean; }

export interface Mods { damage: number; fireRate: number; mag: number; reload: number; crit: number; reserve: number; melee: number; handling: number; }

export interface FireCtx {
  world: CollisionWorld; enemies: EnemyManager; effects: Effects; audio: AudioSys;
  camera: THREE.PerspectiveCamera;
  hitEnemy(e: Enemy, dmg: number, crit: boolean, point: THREE.Vector3, dir: THREE.Vector3): void;
  /** Fires a launcher shell. */
  launch(pos: THREE.Vector3, vel: THREE.Vector3, dmg: number): void;
  /** Strikes robots in a short cone ahead. Returns true if anything was hit. */
  melee(dmg: number): boolean;
}

const MELEE_TIME = 0.5, MELEE_DAMAGE = 90;

type V3 = [number, number, number];
const ZERO3: V3 = [0, 0, 0], DEFAULT_LIFT: V3 = [-0.07, 0.1, 0.03];
type StepKind = 'out' | 'in' | 'rack' | 'shell' | 'open' | 'close' | 'grab';
interface ReloadStep { p: number; kind: StepKind; }

/*
 * Reload choreography. Everything is a function of reload progress p (0..1), so it stays in
 * step at any reload speed (upgrades, Killing spree). An empty reload ends with a rack of the
 * slide, charging handle or pump; a partial one skips it.
 */
const MAG = { grab: 0.16, out: 0.22, down: [0.24, 0.36], up: [0.38, 0.54], seat: [0.54, 0.6], toRack: [0.64, 0.74], pull: [0.74, 0.8], back: [0.82, 0.96], backTac: [0.64, 0.84] };
const CYL = { open: 0.14, load: 0.56, close: 0.75 };
/** Shotgun: shells are loaded between these points; an empty one is pumped at `pump`. */
const SHELLS = { start: 0.12, end: 0.88, endEmpty: 0.78, pump: 0.86 };

function shellCycle(empty: boolean, rounds: number) {
  const n = Math.max(1, rounds), end = empty ? SHELLS.endEmpty : SHELLS.end;
  return { n, len: (end - SHELLS.start) / n };
}

/** Sound and ammo steps for a reload, in progress order. */
function reloadSteps(style: ReloadSpec['style'], empty: boolean, rounds: number): ReloadStep[] {
  if (style === 'mag') return [{ p: MAG.grab, kind: 'grab' }, { p: MAG.out, kind: 'out' }, { p: MAG.seat[1], kind: 'in' }, ...(empty ? [{ p: MAG.pull[1], kind: 'rack' as const }] : [])];
  if (style === 'cylinder') return [{ p: CYL.open, kind: 'open' }, { p: CYL.load, kind: 'in' }, { p: CYL.close, kind: 'close' }];
  const { n, len } = shellCycle(empty, rounds), steps: ReloadStep[] = [];
  for (let i = 0; i < n; i++) steps.push({ p: SHELLS.start + (i + 0.9) * len, kind: 'shell' });
  if (empty) steps.push({ p: SHELLS.pump, kind: 'rack' });
  return steps;
}

const ss = (p: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (p - a) / (b - a))); return t * t * (3 - 2 * t); };
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** Moves `v` towards `to` by weight w; chaining these traces a path through keyframes. */
const toward = (v: V3, to: V3, w: number): V3 => [v[0] + (to[0] - v[0]) * w, v[1] + (to[1] - v[1]) * w, v[2] + (to[2] - v[2]) * w];
/** A sharp jolt that decays after progress `at`. */
const jolt = (p: number, at: number, dur: number) => (p < at ? 0 : Math.exp(-(p - at) * dur * 14));

interface ReloadPose {
  gun: V3; gunRot: [number, number];
  hand: V3; mag: V3; magRot: [number, number];
  /** Slide held open (empty pistol) and charging-handle pull, 0..1. */
  slideBack: number; pull: number;
  held: boolean;
}

function reloadPose(spec: ReloadSpec, p: number, empty: boolean, rounds: number, dur: number): ReloadPose {
  const reach = spec.reach, rack = spec.rack ?? reach, lift = spec.lift ?? DEFAULT_LIFT;
  let hand: V3 = [0, 0, 0], mag: V3 = [0, 0, 0], magRot: [number, number] = [0, 0];
  let slideBack = 0, pull = 0, held = false, tiltIn = ss(p, 0, 0.14), tiltOut = 1, bump = 0;

  if (spec.style === 'mag') {
    const down = add(reach, [-0.03, -0.38, 0.06]);
    hand = toward(hand, reach, ss(p, 0.04, MAG.grab));
    hand = toward(hand, down, ss(p, MAG.down[0], MAG.down[1]));
    hand = toward(hand, add(reach, [0, -0.09, 0.005]), ss(p, MAG.up[0], MAG.up[1]));
    hand = toward(hand, reach, ss(p, MAG.seat[0], MAG.seat[1]));
    if (empty) {
      hand = toward(hand, rack, ss(p, MAG.toRack[0], MAG.toRack[1]));
      hand = toward(hand, add(rack, [0, 0, 0.05]), ss(p, MAG.pull[0], MAG.pull[1]));
      hand = toward(hand, ZERO3, ss(p, MAG.back[0], MAG.back[1]));
      pull = p >= MAG.pull[0] && p < MAG.pull[1] ? ss(p, MAG.pull[0], MAG.pull[1]) : 0;
      slideBack = p < MAG.pull[1] ? 1 : 0;
      tiltOut = 1 - ss(p, 0.84, 1);
      bump -= 0.6 * jolt(p, MAG.pull[1], dur);
    } else {
      hand = toward(hand, ZERO3, ss(p, MAG.backTac[0], MAG.backTac[1]));
      tiltOut = 1 - ss(p, 0.7, 0.94);
    }
    if (p < MAG.out) mag = [0, 0, 0];
    else if (p < MAG.up[0]) {
      // The old magazine drops free and tumbles out of view.
      const t = (p - MAG.out) * dur;
      mag = [-0.02 * t, -7 * t * t - 0.05 * t, 0.12 * t]; magRot = [-5 * t, 1.5 * t];
    } else {
      // The fresh one travels up in the hand and seats.
      mag = [hand[0] - reach[0], Math.min(0, hand[1] - reach[1]), hand[2] - reach[2]];
    }
    bump += jolt(p, MAG.seat[1], dur);
  } else if (spec.style === 'shells') {
    const { n, len } = shellCycle(empty, rounds);
    const fetch = add(reach, [0.03, -0.3, 0.06]), ready = add(reach, [0, -0.035, 0.03]);
    hand = toward(hand, reach, ss(p, 0.02, SHELLS.start));
    const i = Math.min(n - 1, Math.max(0, Math.floor((p - SHELLS.start) / len)));
    const q = (p - SHELLS.start - i * len) / len;
    if (p >= SHELLS.start && q <= 1) {
      hand = toward(hand, fetch, ss(q, 0, 0.35));
      hand = toward(hand, ready, ss(q, 0.35, 0.72));
      hand = toward(hand, reach, ss(q, 0.72, 0.9));
      held = q > 0.3 && q < 0.9;
      bump += 0.4 * jolt(q, 0.9, dur * len);
    }
    const end = SHELLS.start + n * len;
    if (empty) {
      hand = toward(hand, ZERO3, ss(p, end, end + 0.06));
      tiltOut = 1 - ss(p, end + 0.02, end + 0.1);
    } else {
      hand = toward(hand, ZERO3, ss(p, end, 0.97));
      tiltOut = 1 - ss(p, 0.84, 1);
    }
  } else {
    // Cylinder: the hand pushes it out, fetches a speed loader, loads, and the gun flicks it shut.
    const swing = ss(p, 0.1, 0.18) * (1 - ss(p, CYL.close - 0.03, CYL.close));
    mag = [-0.075 * swing, -0.012 * swing, 0];
    magRot = [0, 8 * Math.PI * ss(p, CYL.open, CYL.close)];
    hand = toward(hand, reach, ss(p, 0.03, CYL.open));
    hand = toward(hand, add(reach, [-0.02, -0.35, 0.08]), ss(p, 0.2, 0.32));
    hand = toward(hand, add(reach, [0, 0, 0.08]), ss(p, 0.34, 0.5));
    hand = toward(hand, add(reach, [0, 0, 0.035]), ss(p, 0.5, CYL.load));
    hand = toward(hand, add(reach, [-0.04, -0.12, 0.1]), ss(p, 0.6, 0.7));
    hand = toward(hand, ZERO3, ss(p, 0.76, 0.9));
    bump += jolt(p, CYL.load, dur) * 0.5 - jolt(p, CYL.close, dur) * 1.2;
    tiltOut = 1 - ss(p, 0.78, 1);
  }

  const t = tiltIn * tiltOut;
  return {
    gun: [lift[0] * t, lift[1] * t + 0.012 * bump, lift[2] * t], gunRot: [spec.tilt[0] * t + 0.07 * bump, spec.tilt[1] * t],
    hand, mag, magRot, slideBack, pull, held,
  };
}

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), dirv = new THREE.Vector3();
const start = new THREE.Vector3(), end = new THREE.Vector3();

export class WeaponSystem {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.01, 6);
  states: WeaponState[] = [];
  current = 0;
  /** 0..1 aim-down-sights blend. */
  ads = 0;
  /** Current cone half-angle in radians, for the crosshair. */
  spread = 0.02;
  reloadT = 0;
  reloadDur = 1;
  grenades = 2;
  maxGrenades = 2;
  mods: Mods = { damage: 1, fireRate: 1, mag: 1, reload: 1, crit: 1, reserve: 1, melee: 1, handling: 1 };
  /** Temporary fire-rate and reload multiplier (Killing spree). */
  boost = 1;
  /** True on frames where the trigger is held or buffered. */
  wantsFire = false;
  /** Counts down through a melee swing; the hit lands part-way through. */
  meleeT = 0;
  private meleeDone = true;
  private adsHeld = false;
  private cooldown = 0;
  private heat = 0;
  private fireBuf = 0;
  private switchT = 0;
  private pending = -1;
  private kick = 0;
  private kickRot = 0;
  private swayX = 0;
  private swayY = 0;
  private sprintT = 0;
  private root = new THREE.Group();
  private guns: GunModel[] = [];
  private pumpT = 0;
  private flash: THREE.Mesh;
  private flashT = 0;
  private muzzleLight: THREE.PointLight;
  private wheelAcc = 0;
  private wheelCd = 0;
  /** Current reload: whether it started empty (adds a rack), rounds to load, and timed sound/ammo steps. */
  private reloadEmpty = false;
  private reloadRounds = 0;
  private reloadSteps: ReloadStep[] = [];
  private reloadPrevP = 0;

  constructor(worldScene: THREE.Scene, env: THREE.Texture | null) {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.4;
    this.scene.add(new THREE.HemisphereLight(0xa8bcd8, 0x2a2420, 0.7));
    const key = new THREE.DirectionalLight(0xfff0e0, 1.3);
    key.position.set(-1, 2, 1.5);
    this.scene.add(key, this.root);
    for (let i = 0; i < WEAPONS.length; i++) {
      const gun = buildGun(i);
      gun.group.visible = false;
      this.root.add(gun.group);
      this.guns.push(gun);
    }
    const fm = new THREE.MeshBasicMaterial({ map: makeFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    fm.color.setRGB(3, 2.4, 1.6);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm);
    this.flash.visible = false;
    this.root.add(this.flash);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 16, 1.6);
    worldScene.add(this.muzzleLight);
    this.reset();
  }

  reset() {
    this.states = WEAPONS.map((w, i) => ({ ammo: w.mag, reserve: w.reserve, unlocked: i < 2 }));
    this.mods = { damage: 1, fireRate: 1, mag: 1, reload: 1, crit: 1, reserve: 1, melee: 1, handling: 1 }; this.boost = 1;
    this.current = 1; this.pending = -1; this.switchT = 0;
    this.reloadT = 0; this.cooldown = 0; this.heat = 0; this.ads = 0; this.adsHeld = false; this.meleeT = 0;
    this.grenades = this.maxGrenades = 2;
    this.guns.forEach((g, i) => (g.group.visible = i === this.current));
  }

  get def(): WeaponDef { return WEAPONS[this.current]; }
  get state(): WeaponState { return this.states[this.current]; }
  magSize(i = this.current): number { return Math.round(WEAPONS[i].mag * this.mods.mag); }
  reserveMax(i: number): number { return Math.round(WEAPONS[i].reserve * this.mods.reserve); }
  get reloading(): boolean { return this.reloadT > 0; }

  unlock(i: number) {
    const s = this.states[i];
    s.unlocked = true; s.ammo = this.magSize(i); s.reserve = this.reserveMax(i);
    this.select(i);
  }

  /** Adds reserve ammo to every unlocked weapon. Returns false if all were full. */
  addAmmo(frac: number): boolean {
    let any = false;
    this.states.forEach((s, i) => {
      if (!s.unlocked || !isFinite(s.reserve)) return;
      const max = this.reserveMax(i);
      if (s.reserve < max) { s.reserve = Math.min(max, s.reserve + Math.ceil(max * frac)); any = true; }
    });
    return any;
  }

  select(i: number) {
    if (i === this.current && this.pending < 0) return;
    if (i < 0 || i >= WEAPONS.length || !this.states[i].unlocked) return;
    this.pending = i;
    // Past the halfway point the swap has already happened, so a new choice restarts it.
    if (this.switchT <= 0.18) this.switchT = 0.36;
    this.reloadT = 0;
  }

  private cycle(dir: number) {
    let i = this.pending >= 0 ? this.pending : this.current;
    for (let k = 0; k < WEAPONS.length; k++) {
      i = (i + dir + WEAPONS.length) % WEAPONS.length;
      if (this.states[i].unlocked) { this.select(i); return; }
    }
  }

  private startReload(_audio: AudioSys) {
    const s = this.state;
    if (this.reloadT > 0 || this.switchT > 0 || s.ammo >= this.magSize() || s.reserve <= 0) return;
    this.reloadDur = this.reloadT = this.def.reload * this.mods.reload;
    this.reloadEmpty = s.ammo === 0;
    this.reloadRounds = Math.min(this.magSize() - s.ammo, s.reserve);
    this.reloadSteps = reloadSteps(this.guns[this.current].reload.style, this.reloadEmpty, this.reloadRounds);
    this.reloadPrevP = 0;
  }

  /** Fills the current magazine from reserve at once (Combat slide). */
  instantReload(audio: AudioSys) {
    const s = this.state, take = Math.min(this.magSize() - s.ammo, s.reserve);
    this.reloadT = 0; this.reloadSteps = [];
    if (take <= 0 || this.switchT > 0) return;
    s.ammo += take;
    if (isFinite(s.reserve)) s.reserve -= take;
    audio.reload(0.15);
  }

  update(dt: number, input: Input, settings: Settings, player: Player, c: FireCtx) {
    const def = this.def, st = this.state;

    // Selection
    if (input.wasPressed('weapon1')) this.select(0);
    if (input.wasPressed('weapon2')) this.select(1);
    if (input.wasPressed('weapon3')) this.select(2);
    if (input.wasPressed('weapon4')) this.select(3);
    if (input.wasPressed('weapon5')) this.select(4);
    if (input.wasPressed('weapon6')) this.select(5);
    if (input.wasPressed('nextWeapon')) this.cycle(1);
    this.wheelCd -= dt;
    if (settings.scrollSwitch && input.wheel !== 0) {
      this.wheelAcc += input.wheel;
      if (Math.abs(this.wheelAcc) >= 60 && this.wheelCd <= 0) { this.cycle(this.wheelAcc > 0 ? 1 : -1); this.wheelAcc = 0; this.wheelCd = 0.22; }
    }
    input.wheel = 0;

    if (this.switchT > 0) {
      const before = this.switchT;
      this.switchT -= dt * this.mods.handling;
      if (before > 0.18 && this.switchT <= 0.18 && this.pending >= 0) {
        this.guns[this.current].group.visible = false;
        this.current = this.pending; this.pending = -1;
        this.guns[this.current].group.visible = true;
        this.heat = 0; this.cooldown = 0.05;
        c.audio.swap();
      }
    }
    // Melee: a fast strike with the weapon that interrupts reloading and aiming.
    if (input.wasPressed('melee') && this.meleeT <= 0 && this.switchT <= 0) {
      this.meleeT = MELEE_TIME; this.meleeDone = false; this.reloadT = 0;
      c.audio.swing();
    }
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      if (!this.meleeDone && this.meleeT <= MELEE_TIME - 0.13) {
        this.meleeDone = true;
        if (c.melee(MELEE_DAMAGE * this.mods.melee)) { c.audio.meleeHit(); player.shake = Math.min(1, player.shake + 0.25); }
      }
    }
    const busy = this.switchT > 0 || this.meleeT > 0;

    // Aim
    if (settings.adsToggle) { if (input.wasPressed('ads')) this.adsHeld = !this.adsHeld; }
    else this.adsHeld = input.isDown('ads');
    if (player.sprinting && settings.adsToggle) this.adsHeld = false;
    const wantAds = this.adsHeld && !this.reloading && !busy;
    const rate = (dt / this.def.adsTime) * this.mods.handling;
    this.ads = Math.max(0, Math.min(1, this.ads + (wantAds ? rate : -rate)));

    // Reload
    if (input.wasPressed('reload')) this.startReload(c.audio);
    if (this.reloadT > 0) {
      this.reloadT -= dt * this.boost;
      // Play each step as the animation reaches it; a shotgun gains one shell per step.
      const p = Math.min(1, 1 - this.reloadT / this.reloadDur);
      for (const step of this.reloadSteps) {
        if (step.p <= this.reloadPrevP || step.p > p) continue;
        c.audio.reloadStep(step.kind);
        if (step.kind === 'shell' && st.reserve > 0 && st.ammo < this.magSize()) { st.ammo++; if (isFinite(st.reserve)) st.reserve--; }
        if (step.kind === 'rack' && this.guns[this.current].pump) this.pumpT = 0.52;
      }
      this.reloadPrevP = p;
      if (this.reloadT <= 0) {
        const need = this.magSize() - st.ammo, take = Math.min(need, st.reserve);
        st.ammo += take;
        if (isFinite(st.reserve)) st.reserve -= take;
      }
    }

    // Fire
    this.cooldown -= dt * this.boost;
    if (input.wasPressed('fire')) this.fireBuf = 0.12; else this.fireBuf -= dt;
    const trigger = def.auto ? input.isDown('fire') : this.fireBuf > 0;
    this.wantsFire = trigger || input.isDown('fire');
    this.sprintT += ((player.sprinting ? 1 : 0) - this.sprintT) * Math.min(1, dt * 10);
    if (trigger && !busy && !this.reloading && this.cooldown <= 0 && this.sprintT < 0.5) {
      if (st.ammo > 0) {
        this.fireBuf = 0;
        this.shoot(player, c);
      } else if (input.wasPressed('fire') || def.auto) {
        if (st.reserve > 0) this.startReload(c.audio);
        else if (input.wasPressed('fire')) c.audio.dryFire();
      }
    }
    if (st.ammo === 0 && st.reserve > 0 && !this.reloading && !busy && this.cooldown <= 0) this.startReload(c.audio);

    // Spread
    this.heat = Math.max(0, this.heat - dt * (def.auto ? 0.09 : 0.14));
    const moving = Math.min(1.5, player.moveAmt);
    const base = def.hip + (def.ads - def.hip) * this.ads;
    this.spread = (base + this.heat) * (1 + moving * 0.9 * (1 - this.ads * 0.6)) * (player.grounded ? 1 : 1.8) * (player.crouching ? 0.75 : 1);

    this.animate(dt, input, player);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.muzzleLight.intensity = 0; }
    }
  }

  private shoot(player: Player, c: FireCtx) {
    const def = this.def, st = this.state, cam = c.camera;
    st.ammo--;
    this.cooldown = 60 / (def.rpm * this.mods.fireRate);
    cam.updateMatrixWorld();
    cam.getWorldDirection(fwd);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    // Tracers start near the visible muzzle rather than the eye.
    const side = 0.15 * (1 - this.ads), drop = 0.12 * (1 - this.ads) + 0.03;
    start.copy(cam.position).addScaledVector(fwd, 0.7).addScaledVector(right, side).addScaledVector(up, -drop);

    if (def.launch) {
      const a = Math.random() * Math.PI * 2, r = this.spread * Math.sqrt(Math.random());
      dirv.copy(fwd).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r + 0.035).normalize();
      c.launch(start, dirv.multiplyScalar(def.launch).addScaledVector(player.vel, 0.4), def.damage * this.mods.damage);
    }
    for (let p = 0; p < (def.launch ? 0 : def.pellets); p++) {
      const a = Math.random() * Math.PI * 2, r = this.spread * Math.sqrt(Math.random());
      dirv.copy(fwd).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const wall = c.world.raycast(cam.position, dirv, 200);
      const maxD = wall ? wall.dist : 200;
      const hits = c.enemies.raycast(cam.position, dirv, maxD);
      let stopped = false;
      for (const h of hits) {
        const [f0, f1, fmin] = def.falloff;
        const fall = h.dist <= f0 ? 1 : h.dist >= f1 ? fmin : 1 + ((h.dist - f0) / (f1 - f0)) * (fmin - 1);
        const dmg = def.damage * this.mods.damage * fall * (h.crit ? def.crit * this.mods.crit : 1);
        end.copy(cam.position).addScaledVector(dirv, h.dist);
        c.effects.sparks(end, fwd.clone().negate(), h.crit ? 9 : 5, 3.2, h.crit ? 2.6 : 1.5, h.crit ? 1.6 : 0.4);
        c.hitEnemy(h.enemy, dmg, h.crit, end.clone(), dirv);
        if (!def.pierce) { stopped = true; break; }
      }
      if (!stopped) {
        end.copy(cam.position).addScaledVector(dirv, maxD);
        if (wall) { c.effects.impact(wall.point, wall.normal); if (p === 0) c.audio.impact(wall.point); }
      }
      const [tr, tg, tb] = def.tracer;
      if (def.pierce) {
        c.effects.tracer(start, end, tr, tg, tb, 0.05, 0.45);
        c.effects.tracer(start, end, 3, 4, 5, 0.014, 0.6);
        const len = start.distanceTo(end);
        for (let d = 1; d < len; d += 1.2) c.effects.trail(dirv.clone().multiplyScalar(d).add(start), 0.3, 1.6, 3, 0.16);
      } else if (def.pellets === 1 || p % 2 === 0) c.effects.tracer(start, end, tr, tg, tb, 0.012, 0.06);
    }

    // Recoil and feedback
    const k = 1 - this.ads * 0.3;
    // The first rounds of a burst kick hardest; sustained fire settles into a steady climb.
    const first = def.auto ? 1 + Math.max(0, 1 - this.heat / (def.bloom * 4)) * 0.8 : 1;
    player.recoilPitch += def.kickP * k * first;
    player.recoilYaw += (Math.random() - 0.5) * 2 * def.kickY * k;
    this.heat = Math.min(def.hip * 1.6 + 0.02, this.heat + def.bloom);
    this.kick = Math.min(1.6, this.kick + (def.pellets > 1 || def.pierce ? 1.3 : def.auto ? 0.55 : 0.9));
    this.kickRot += def.kickP * 3;
    const gun = this.guns[this.current];
    if (gun.pump) this.pumpT = 0.52;
    this.flash.position.copy(gun.muzzle).add(gun.group.position).setZ(gun.group.position.z + gun.muzzle.z - 0.03);
    this.flash.rotation.z = Math.random() * 6.28;
    this.flash.scale.setScalar((def.pellets > 1 ? 1.7 : def.pierce ? 1.4 : 1) * (0.8 + Math.random() * 0.5));
    const fc = (this.flash.material as THREE.MeshBasicMaterial).color;
    if (def.pierce) fc.setRGB(1, 2.6, 4); else fc.setRGB(3, 2.4, 1.6);
    this.flash.visible = true;
    this.flashT = 0.045;
    this.muzzleLight.position.copy(cam.position).addScaledVector(fwd, 0.8);
    this.muzzleLight.color.setHex(def.pierce ? 0x60c8ff : 0xffb060);
    this.muzzleLight.intensity = def.pellets > 1 ? 90 : 55;
    c.audio.shot(def.sound);
  }

  private animate(dt: number, input: Input, player: Player) {
    const def = this.def, gun = this.guns[this.current], g = gun.group, a = this.ads;
    const e = a * a * (3 - 2 * a);
    this.kick *= Math.exp(-14 * dt);
    this.kickRot *= Math.exp(-12 * dt);
    this.swayX += (Math.max(-40, Math.min(40, input.dx)) * -0.00035 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (Math.max(-40, Math.min(40, input.dy)) * 0.00035 - this.swayY) * Math.min(1, dt * 9);

    const bobK = Math.min(1, player.moveAmt) * (player.grounded ? 1 : 0) * (1 - e * 0.88);
    const bx_ = Math.cos(player.bobPhase) * 0.008 * bobK, by = Math.abs(Math.sin(player.bobPhase)) * -0.009 * bobK;
    const idle = Math.sin(performance.now() * 0.0016) * 0.0018 * (1 - e * 0.7);

    let x = def.hipPos[0] + (0 - def.hipPos[0]) * e;
    let y = def.hipPos[1] + (-gun.sightY - def.hipPos[1]) * e;
    let z = def.hipPos[2] + (def.adsZ - def.hipPos[2]) * e;
    let rx = 0, ry = 0, rz = 0;

    // Sprint: lower and angle the weapon.
    const s = this.sprintT * (1 - e);
    x -= s * 0.05; y -= s * 0.06; ry += s * 0.55; rx -= s * 0.22;

    // Reload: tilt the gun towards the support hand while it works (see reloadPose).
    const rp = this.reloadT > 0 ? reloadPose(gun.reload, 1 - this.reloadT / this.reloadDur, this.reloadEmpty, this.reloadRounds, this.reloadDur) : null;
    if (rp) { x += rp.gun[0]; y += rp.gun[1]; z += rp.gun[2]; rx += rp.gunRot[0]; rz += rp.gunRot[1]; }
    // Melee: swing the weapon across and forward, then recover.
    if (this.meleeT > 0) {
      const p = 1 - this.meleeT / MELEE_TIME;
      const env = p < 0.26 ? p / 0.26 : 1 - (p - 0.26) / 0.74, m = env * env * (3 - 2 * env);
      x -= m * 0.08; y += m * 0.03; z -= m * 0.15; ry += m * 0.8; rz -= m * 0.5; rx += m * 0.12;
    }
    // Swap: drop below the frame and come back.
    if (this.switchT > 0) {
      const p = Math.abs(this.switchT - 0.18) / 0.18;
      y -= (1 - p) * 0.3; rx -= (1 - p) * 0.6;
    }

    const kz = this.kick * 0.028 * (1 - e * 0.45);
    g.position.set(x + bx_ + this.swayX, y + by + idle + this.swayY - player.vel.y * 0.0015 * (1 - e), z + kz);
    g.rotation.set(rx + this.kickRot * (1 - e * 0.6) + this.swayY * 2, ry + this.swayX * 3, rz + this.swayX * -4 * (1 - e));

    // Moving parts: pistol slide, shotgun pump, magazines, railgun charge glow.
    const st = this.state;
    if (gun.slide) gun.slide.position.z = rp ? Math.max(rp.slideBack, rp.pull) * 0.032 : st.ammo === 0 ? 0.032 : Math.min(0.034, this.kick * 0.032);
    if (gun.bolt) gun.bolt.position.z = rp ? rp.pull * 0.05 : 0;
    if (gun.off) gun.off.position.set(...(rp ? rp.hand : ZERO3));
    if (gun.held) gun.held.visible = !!rp && rp.held;
    if (gun.pump) {
      this.pumpT = Math.max(0, this.pumpT - dt);
      const t = 1 - this.pumpT / 0.4;
      gun.pump.position.z = this.pumpT > 0 && t > 0 ? Math.sin(t * Math.PI) * 0.075 : 0;
    }
    if (gun.mag) {
      gun.mag.position.set(...(rp ? rp.mag : ZERO3));
      gun.mag.rotation.set(rp ? rp.magRot[0] : 0, 0, rp ? rp.magRot[1] : 0);
    }
    if (def.pierce) {
      const ready = st.ammo > 0 && !this.reloading ? Math.max(0.25, 1 - Math.max(0, this.cooldown) / (60 / def.rpm)) : 0.15;
      const k = ready * (0.85 + Math.sin(performance.now() * 0.012) * 0.15);
      railGlow.color.setRGB(0.4 * k, 2.4 * k, 4 * k);
    }
  }

  /** Takes one grenade if available. */
  useGrenade(): boolean {
    if (this.grenades <= 0) return false;
    this.grenades--;
    return true;
  }
}
