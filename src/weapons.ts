import * as THREE from 'three';
import type { AudioSys, ShotKind } from './audio';
import type { Effects } from './effects';
import type { Enemy, EnemyManager } from './enemies';
import type { Input } from './input';
import type { CollisionWorld } from './physics';
import type { Player } from './player';
import type { Settings } from './settings';
import { buildGun, railGlow, type GunModel } from './gunModels';
import { makeFlashTexture } from './textures';

export interface WeaponDef {
  name: string; slot: string; sound: ShotKind; auto: boolean;
  damage: number; pellets: number; rpm: number; mag: number; reserve: number; reload: number;
  hip: number; ads: number; bloom: number; kickP: number; kickY: number;
  zoom: number; adsTime: number; falloff: [number, number, number];
  crit: number; pierce: boolean;
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
    crit: 1.4, pierce: false, hipPos: [0.135, -0.135, -0.38], adsZ: -0.3, tracer: [2.5, 1.8, 1],
  },
  {
    name: 'RX Lancer', slot: 'Railgun', sound: 'rail', auto: false, damage: 190, pellets: 1, rpm: 46, mag: 4, reserve: 20, reload: 2.6,
    hip: 0.03, ads: 0, bloom: 0, kickP: 0.09, kickY: 0.01, zoom: 2.6, adsTime: 0.28, falloff: [200, 300, 1],
    crit: 2.2, pierce: true, hipPos: [0.14, -0.165, -0.4], adsZ: -0.3, tracer: [0.6, 3, 5],
  },
];

export interface WeaponState { ammo: number; reserve: number; unlocked: boolean; }

export interface Mods { damage: number; fireRate: number; mag: number; reload: number; crit: number; reserve: number; }

export interface FireCtx {
  world: CollisionWorld; enemies: EnemyManager; effects: Effects; audio: AudioSys;
  camera: THREE.PerspectiveCamera;
  hitEnemy(e: Enemy, dmg: number, crit: boolean, point: THREE.Vector3, dir: THREE.Vector3): void;
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
  mods: Mods = { damage: 1, fireRate: 1, mag: 1, reload: 1, crit: 1, reserve: 1 };
  /** True on frames where the trigger is held or buffered. */
  wantsFire = false;
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
    this.mods = { damage: 1, fireRate: 1, mag: 1, reload: 1, crit: 1, reserve: 1 };
    this.current = 1; this.pending = -1; this.switchT = 0;
    this.reloadT = 0; this.cooldown = 0; this.heat = 0; this.ads = 0; this.adsHeld = false;
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
    if (this.switchT <= 0) this.switchT = 0.36;
    this.reloadT = 0;
  }

  private cycle(dir: number) {
    let i = this.pending >= 0 ? this.pending : this.current;
    for (let k = 0; k < WEAPONS.length; k++) {
      i = (i + dir + WEAPONS.length) % WEAPONS.length;
      if (this.states[i].unlocked) { this.select(i); return; }
    }
  }

  private startReload(audio: AudioSys) {
    const s = this.state;
    if (this.reloadT > 0 || this.switchT > 0 || s.ammo >= this.magSize() || s.reserve <= 0) return;
    this.reloadDur = this.reloadT = this.def.reload * this.mods.reload;
    audio.reload(this.reloadDur);
  }

  update(dt: number, input: Input, settings: Settings, player: Player, c: FireCtx) {
    const def = this.def, st = this.state;

    // Selection
    if (input.wasPressed('weapon1')) this.select(0);
    if (input.wasPressed('weapon2')) this.select(1);
    if (input.wasPressed('weapon3')) this.select(2);
    if (input.wasPressed('weapon4')) this.select(3);
    if (input.wasPressed('nextWeapon')) this.cycle(1);
    this.wheelCd -= dt;
    if (settings.scrollSwitch && input.wheel !== 0) {
      this.wheelAcc += input.wheel;
      if (Math.abs(this.wheelAcc) >= 60 && this.wheelCd <= 0) { this.cycle(this.wheelAcc > 0 ? 1 : -1); this.wheelAcc = 0; this.wheelCd = 0.22; }
    }
    input.wheel = 0;

    if (this.switchT > 0) {
      const before = this.switchT;
      this.switchT -= dt;
      if (before > 0.18 && this.switchT <= 0.18 && this.pending >= 0) {
        this.guns[this.current].group.visible = false;
        this.current = this.pending; this.pending = -1;
        this.guns[this.current].group.visible = true;
        this.heat = 0; this.cooldown = 0.05;
        c.audio.swap();
      }
    }
    const busy = this.switchT > 0;

    // Aim
    if (settings.adsToggle) { if (input.wasPressed('ads')) this.adsHeld = !this.adsHeld; }
    else this.adsHeld = input.isDown('ads');
    if (player.sprinting && settings.adsToggle) this.adsHeld = false;
    const wantAds = this.adsHeld && !this.reloading && !busy;
    const rate = dt / this.def.adsTime;
    this.ads = Math.max(0, Math.min(1, this.ads + (wantAds ? rate : -rate)));

    // Reload
    if (input.wasPressed('reload')) this.startReload(c.audio);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.magSize() - st.ammo, take = Math.min(need, st.reserve);
        st.ammo += take;
        if (isFinite(st.reserve)) st.reserve -= take;
      }
    }

    // Fire
    this.cooldown -= dt;
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

    for (let p = 0; p < def.pellets; p++) {
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

    // Reload: dip and roll.
    if (this.reloadT > 0) {
      const p = 1 - this.reloadT / this.reloadDur;
      const env = Math.min(1, p / 0.18, (1 - p) / 0.18);
      const sm = env * env * (3 - 2 * env);
      y -= sm * 0.12; rx += sm * 0.5; rz += sm * 0.45; x -= sm * 0.03;
      y += Math.sin(p * Math.PI * 4) * 0.008 * sm;
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
    if (gun.slide) gun.slide.position.z = st.ammo === 0 && !this.reloading ? 0.032 : Math.min(0.034, this.kick * 0.032);
    if (gun.pump) {
      this.pumpT = Math.max(0, this.pumpT - dt);
      const t = 1 - this.pumpT / 0.4;
      gun.pump.position.z = this.pumpT > 0 && t > 0 ? Math.sin(t * Math.PI) * 0.075 : 0;
    }
    if (gun.mag) {
      let d = 0;
      if (this.reloadT > 0) {
        const p = 1 - this.reloadT / this.reloadDur;
        d = p < 0.2 ? 0 : p < 0.34 ? (p - 0.2) / 0.14 : p < 0.6 ? 1 : p < 0.78 ? 1 - (p - 0.6) / 0.18 : 0;
      }
      gun.mag.position.y = -d * 0.3;
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
