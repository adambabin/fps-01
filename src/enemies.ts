import * as THREE from 'three';
import type { AudioSys } from './audio';
import type { Effects } from './effects';
import type { Projectiles } from './entities';
import type { FlowField } from './nav';
import { raySphere, type CollisionWorld } from './physics';
import type { Player } from './player';
import { createRobot } from './robotModels';
import { ARENA, CEIL } from './world';

export type EnemyType = 'scuttler' | 'trooper' | 'drone' | 'heavy';

interface Def { hp: number; speed: number; radius: number; height: number; score: number; cost: number; name: string; }
export const ENEMY_DEFS: Record<EnemyType, Def> = {
  scuttler: { hp: 45, speed: 6.4, radius: 0.55, height: 0.8, score: 50, cost: 1, name: 'Scuttler' },
  trooper: { hp: 95, speed: 3.3, radius: 0.45, height: 1.9, score: 100, cost: 2, name: 'Trooper' },
  drone: { hp: 38, speed: 5.5, radius: 0.5, height: 0.6, score: 75, cost: 2, name: 'Drone' },
  heavy: { hp: 700, speed: 1.9, radius: 1.0, height: 3.1, score: 400, cost: 7, name: 'Juggernaut' },
};

interface HitSphere { x: number; y: number; z: number; r: number; crit: boolean; }
const SPHERES: Record<EnemyType, HitSphere[]> = {
  scuttler: [{ x: 0, y: 0.5, z: 0, r: 0.58, crit: false }, { x: 0, y: 0.52, z: 0.48, r: 0.26, crit: true }],
  trooper: [{ x: 0, y: 0.5, z: 0, r: 0.36, crit: false }, { x: 0, y: 1.25, z: 0, r: 0.46, crit: false }, { x: 0, y: 1.78, z: 0.02, r: 0.21, crit: true }],
  drone: [{ x: 0, y: 0, z: 0, r: 0.5, crit: false }],
  heavy: [
    { x: 0.42, y: 0.75, z: 0, r: 0.55, crit: false }, { x: -0.42, y: 0.75, z: 0, r: 0.55, crit: false },
    { x: 0, y: 2.3, z: 0, r: 1.0, crit: false }, { x: 0, y: 3.02, z: 0.05, r: 0.3, crit: true },
  ],
};

export interface EnemyCtx {
  world: CollisionWorld; nav: FlowField; effects: Effects; audio: AudioSys; player: Player; projectiles: Projectiles;
  hurtPlayer(amount: number, from: THREE.Vector3): void;
  onKill(e: Enemy, crit: boolean): void;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

export class Enemy {
  group: THREE.Group;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  alive = true;
  def: Def;
  flash = 0;
  private hull: THREE.MeshStandardMaterial;
  private eye: THREE.MeshBasicMaterial;
  private body: THREE.Object3D;
  private chest: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private legs: THREE.Object3D[] = [];
  private shins: THREE.Object3D[] = [];
  private spin: THREE.Object3D[] = [];
  private smokeT = 0;
  private walk = Math.random() * 6;
  private los = false;
  private losT = Math.random() * 0.25;
  private attackCd = 1 + Math.random() * 1.5;
  private windup = 0;
  private burst = 0;
  private burstT = 0;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  private strafeT = 1 + Math.random() * 2;
  private orbit = Math.random() * 6.28;
  private side = 1;
  private age = 0;

  constructor(public type: EnemyType, pos: THREE.Vector3, hpMult: number, public dmgMult: number) {
    this.def = ENEMY_DEFS[type];
    this.hp = this.maxHp = this.def.hp * hpMult;
    this.pos.copy(pos);
    const model = createRobot(type);
    this.group = model.root;
    this.hull = model.hull;
    this.eye = model.eye;
    this.eye.color.setRGB(4, 0.7, 0.2);
    this.body = model.node('body');
    if (type === 'trooper' || type === 'heavy') {
      this.legs = [model.node('legR'), model.node('legL')];
      this.shins = [model.node('shinR'), model.node('shinL')];
      this.head = model.node('head');
      this.chest = type === 'trooper' ? model.node('chest') : null;
    } else if (type === 'scuttler') {
      for (const s of ['R', 'L']) for (let i = 0; i < 3; i++) this.legs.push(model.node(`leg${s}${i}`));
    } else {
      for (const n of ['rotorRF', 'rotorRB', 'rotorLF', 'rotorLB']) this.spin.push(model.node(n));
    }
    this.group.position.copy(pos);
  }

  /** World-space ray test. Returns distance and whether it was a weak-point hit. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): { dist: number; crit: boolean } | null {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    let best = max, crit = false, found = false;
    for (const sp of SPHERES[this.type]) {
      const t = raySphere(o, d, this.pos.x + sp.x * c + sp.z * s, this.pos.y + sp.y, this.pos.z - sp.x * s + sp.z * c, sp.r);
      if (t >= 0 && t < best) { best = t; crit = sp.crit; found = true; }
    }
    return found ? { dist: best, crit } : null;
  }

  /** Aim point for explosions and effects. */
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + (this.type === 'drone' ? 0 : this.def.height * 0.55), this.pos.z);
  }

  private fire(c: EnemyCtx, lx: number, ly: number, lz: number, speed: number, dmg: number, kind: 'bolt' | 'rocket', spread: number, lead: number) {
    const s = Math.sin(this.yaw), co = Math.cos(this.yaw), p = c.player;
    v1.set(this.pos.x + lx * co + lz * s, this.pos.y + ly, this.pos.z - lx * s + lz * co);
    v2.set(p.pos.x, p.pos.y + p.height * 0.62, p.pos.z);
    const t = v1.distanceTo(v2) / speed;
    v2.x += p.vel.x * t * lead; v2.z += p.vel.z * t * lead;
    v2.sub(v1).normalize();
    v2.x += (Math.random() - 0.5) * spread; v2.y += (Math.random() - 0.5) * spread; v2.z += (Math.random() - 0.5) * spread;
    v2.normalize().multiplyScalar(speed);
    c.projectiles.spawn(kind, v1, v2, dmg * this.dmgMult);
    c.effects.flash(v1, 0xff7a30, kind === 'rocket' ? 40 : 14, 0.08, 8);
    c.audio.enemyShot(v1, kind === 'rocket');
  }

  update(dt: number, c: EnemyCtx) {
    this.age += dt;
    const p = c.player, def = this.def, fly = this.type === 'drone';
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const dy = p.pos.y - this.pos.y;

    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.22;
      v1.set(this.pos.x, this.pos.y + (fly ? 0 : def.height * 0.85), this.pos.z);
      v2.set(p.pos.x, p.pos.y + p.eye, p.pos.z);
      this.los = c.world.clear(v1, v2);
    }
    this.attackCd -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 1.2 + Math.random() * 2.4; this.strafe = -this.strafe; }

    // Desired velocity
    let wx = 0, wz = 0, wy = 0, speed = def.speed;
    const tx = dx / dist, tz = dz / dist;
    const follow = () => { if (c.nav.dir(this.pos.x, this.pos.z, v3)) { wx = v3.x; wz = v3.z; } else { wx = tx; wz = tz; } };
    let facePlayer = this.los;

    if (this.type === 'scuttler') {
      if (this.windup > 0) {
        this.windup -= dt; speed = 0; facePlayer = true;
        if (this.windup <= 0) {
          this.attackCd = 0.85;
          c.audio.melee(this.pos);
          if (dist < 2.6 && Math.abs(dy) < 2.6) c.hurtPlayer(12 * this.dmgMult, this.pos);
        }
      } else if (dist < 1.9 && Math.abs(dy) < 2.4 && this.attackCd <= 0) this.windup = 0.32;
      else if (dist < 1.4) speed = 0;
      else if (this.los && dist < 9) { wx = tx; wz = tz; }
      else follow();
    } else if (this.type === 'trooper') {
      if (this.burst > 0) {
        speed *= 0.25; wx = -tz * this.strafe; wz = tx * this.strafe;
        this.burstT -= dt;
        if (this.burstT <= 0) { this.burstT = 0.16; this.burst--; this.fire(c, 0.38, 1.34, 0.82, 28, 8, 'bolt', 0.035, 0.5); if (!this.burst) this.attackCd = 1.7 + Math.random() * 1.3; }
      } else if (this.windup > 0) {
        this.windup -= dt; speed *= 0.2; wx = -tz * this.strafe; wz = tx * this.strafe;
        if (this.windup <= 0) { this.burst = 3; this.burstT = 0; }
      } else if (this.los && dist < 34 && this.attackCd <= 0 && this.age > 0.8) this.windup = 0.4;
      else if (this.los && dist < 7) { wx = -tx * 0.8 - tz * this.strafe * 0.6; wz = -tz * 0.8 + tx * this.strafe * 0.6; }
      else if (this.los && dist < 19) { wx = -tz * this.strafe; wz = tx * this.strafe; speed *= 0.7; }
      else follow();
    } else if (this.type === 'heavy') {
      if (this.windup > 0) {
        this.windup -= dt; speed = 0; facePlayer = true;
        if (this.windup <= 0) {
          this.attackCd = 1.6;
          c.audio.explosion(this.pos, false);
          v1.set(this.pos.x + tx * 1.6, 0.15, this.pos.z + tz * 1.6);
          c.effects.sparks(v1, v2.set(0, 1, 0), 20); c.effects.puff(v1, 6, 1.2, 0.2);
          if (dist < 3.9 && Math.abs(dy) < 3) c.hurtPlayer(30 * this.dmgMult, this.pos);
        }
      } else if (dist < 3.3 && this.attackCd <= 0.6) this.windup = 0.6;
      else {
        if (dist > 5) follow(); else speed = 0;
        if (this.los && dist < 46 && this.attackCd <= 0 && this.age > 1) {
          this.side = -this.side;
          this.fire(c, 1.02 * this.side, 2.72, 0.6, 15, 34, 'rocket', 0.02, 0.35);
          this.attackCd = 2.6 + Math.random();
        }
      }
    } else {
      // Drone: circle the player at range and altitude.
      this.orbit += dt * 0.55 * this.strafe;
      const r = 8.5, ty = Math.min(CEIL - 1.5, p.pos.y + 3.4 + Math.sin(this.age * 1.3) * 0.7);
      v1.set(p.pos.x + Math.cos(this.orbit) * r, ty, p.pos.z + Math.sin(this.orbit) * r).sub(this.pos);
      const l = v1.length() || 1;
      const k = Math.min(1, l / 3);
      wx = (v1.x / l) * k; wy = (v1.y / l) * k; wz = (v1.z / l) * k;
      facePlayer = true;
      if (this.los && this.attackCd <= 0 && dist < 30 && this.age > 1) {
        this.fire(c, 0, -0.17, 0.3, 30, 6, 'bolt', 0.03, 0.6);
        this.attackCd = 0.9 + Math.random() * 0.6;
      }
    }

    // Integrate
    const acc = Math.min(1, dt * (fly ? 2.5 : 7));
    this.vel.x += (wx * speed - this.vel.x) * acc;
    this.vel.z += (wz * speed - this.vel.z) * acc;
    if (fly) this.vel.y += (wy * speed - this.vel.y) * acc;
    this.pos.addScaledVector(this.vel, dt);
    if (fly) {
      this.pos.y = Math.max(1.4, Math.min(CEIL - 1, this.pos.y));
      c.world.pushOutSphere(this.pos, def.radius + 0.1);
    } else {
      this.pos.y = 0;
      c.world.pushOutXZ(this.pos, def.radius, 0.25, Math.min(def.height, 1.6));
      // Keep ground robots from standing inside the player.
      if (dist < def.radius + 0.4 && Math.abs(dy) < def.height) { this.pos.x -= tx * (def.radius + 0.4 - dist); this.pos.z -= tz * (def.radius + 0.4 - dist); }
    }
    const lim = ARENA - def.radius;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x)); this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));

    // Facing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    let want = this.yaw;
    if (facePlayer) want = Math.atan2(dx, dz); else if (hs > 0.3) want = Math.atan2(this.vel.x, this.vel.z);
    let dyaw = want - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.yaw += dyaw * Math.min(1, dt * (this.type === 'heavy' ? 2.5 : 8));

    // Animate
    const heavy = this.type === 'heavy';
    this.walk += hs * dt * (heavy ? 1.6 : this.type === 'scuttler' ? 3.2 : 2.6);
    const g = this.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    const aim = this.los ? -Math.atan2(p.pos.y + p.height * 0.6 - (this.pos.y + (fly ? 0 : def.height * 0.75)), dist) : 0;
    if (this.type === 'trooper' || heavy) {
      const amp = Math.min(1, hs / 1.5) * (heavy ? 0.42 : 0.62), sw = Math.sin(this.walk), cw = Math.cos(this.walk);
      this.legs[0].rotation.x = -sw * amp; this.legs[1].rotation.x = sw * amp;
      this.shins[0].rotation.x = Math.max(0, cw) * amp * 1.3 + 0.05;
      this.shins[1].rotation.x = Math.max(0, -cw) * amp * 1.3 + 0.05;
      const slam = heavy && this.windup > 0 ? Math.sin((1 - this.windup / 0.6) * Math.PI) : 0;
      this.body.position.y = Math.abs(cw) * amp * 0.07 - slam * 0.22;
      this.body.rotation.z = sw * amp * (heavy ? 0.07 : 0.04);
      this.body.rotation.x = slam * 0.3;
      const k = Math.min(1, dt * 8);
      if (this.chest) this.chest.rotation.x += (Math.max(-0.5, Math.min(0.5, aim * 0.6)) - this.chest.rotation.x) * k;
      this.head!.rotation.x += (Math.max(-0.4, Math.min(0.4, aim * 0.4)) - this.head!.rotation.x) * k;
    } else if (this.type === 'scuttler') {
      const m = Math.min(1, hs / 2);
      for (let i = 0; i < 6; i++) {
        const s = i < 3 ? 1 : -1, j = i % 3;
        const ph = this.walk + ((j + (i < 3 ? 0 : 1)) % 2 ? Math.PI : 0);
        this.legs[i].rotation.y = ((j === 0 ? -0.5 : j === 2 ? 0.5 : 0) + Math.sin(ph) * 0.34 * m) * s;
        this.legs[i].rotation.z = Math.max(0, Math.cos(ph)) * 0.24 * m * s;
      }
      const w = this.windup > 0 ? 1 - this.windup / 0.32 : 0;
      this.body.position.y = Math.sin(this.walk * 2) * 0.018 * m - w * 0.1;
      this.body.rotation.x = -w * 0.38;
    } else {
      for (const r of this.spin) r.rotation.y += dt * 38;
      this.body.rotation.x = Math.max(-0.4, Math.min(0.4, hs * 0.05)) + aim * 0.5;
      this.body.rotation.z = Math.sin(this.age * 2.3) * 0.06 - Math.max(-0.3, Math.min(0.3, (this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw)) * 0.05));
      g.position.y += Math.sin(this.age * 3.1) * 0.05;
    }

    // Badly damaged robots smoke and spark.
    if (this.hp < this.maxHp * 0.35) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.1 + Math.random() * 0.16;
        c.effects.puff(this.center(v1), 1, heavy ? 0.9 : 0.45, 0.1);
        if (Math.random() < 0.3) c.effects.sparks(v1, v2.set(0, 1, 0), 3);
      }
    }

    // Eye telegraphs an incoming attack; body flashes when hit.
    const tele = this.windup > 0 ? 2.2 + Math.sin(this.age * 40) * 0.8 : 1;
    this.eye.color.setRGB(4 * tele, 0.7 * tele, 0.2 * tele);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      this.hull.emissive.setRGB(this.flash * 0.9, this.flash * 0.6, this.flash * 0.35);
    }
  }

  dispose() { this.hull.dispose(); this.eye.dispose(); }
}

export interface EnemyHit { enemy: Enemy; dist: number; crit: boolean; }

export class EnemyManager {
  list: Enemy[] = [];

  constructor(private scene: THREE.Scene) {}

  spawn(type: EnemyType, pos: THREE.Vector3, hpMult: number, dmgMult: number): Enemy {
    const e = new Enemy(type, pos, hpMult, dmgMult);
    this.scene.add(e.group);
    this.list.push(e);
    return e;
  }

  /** All robots crossed by the ray, nearest first. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): EnemyHit[] {
    const hits: EnemyHit[] = [];
    for (const e of this.list) {
      const h = e.raycast(o, d, max);
      if (h) hits.push({ enemy: e, dist: h.dist, crit: h.crit });
    }
    return hits.sort((a, b) => a.dist - b.dist);
  }

  /** Returns true when the hit destroyed the robot. */
  damage(e: Enemy, amount: number, crit: boolean, c: EnemyCtx, push?: THREE.Vector3): boolean {
    if (!e.alive) return false;
    e.hp -= amount;
    e.flash = 1;
    if (push && e.type !== 'heavy') e.vel.addScaledVector(push, Math.min(4, amount * 0.05));
    if (e.hp > 0) return false;
    e.alive = false;
    const p = e.center(new THREE.Vector3());
    const big = e.type === 'heavy';
    c.effects.explosion(p, big ? 1.6 : e.type === 'trooper' ? 0.8 : 0.55);
    c.effects.scatter(p, big ? 14 : e.type === 'trooper' ? 7 : 4, big ? 0.34 : 0.16);
    if (big) c.audio.explosion(p, true); else c.audio.robotDeath(p);
    c.onKill(e, crit);
    this.scene.remove(e.group);
    e.dispose();
    this.list.splice(this.list.indexOf(e), 1);
    return true;
  }

  update(dt: number, c: EnemyCtx) {
    for (const e of this.list) e.update(dt, c);
    // Separation so robots do not stack on one another.
    const l = this.list;
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      const a = l[i], b = l[j];
      if ((a.type === 'drone') !== (b.type === 'drone')) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, min = a.def.radius + b.def.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (min - d) * 0.5, wa = a.type === 'heavy' ? 0.2 : b.type === 'heavy' ? 1.8 : 1;
      a.pos.x -= (dx / d) * push * wa; a.pos.z -= (dz / d) * push * wa;
      b.pos.x += (dx / d) * push * (2 - wa); b.pos.z += (dz / d) * push * (2 - wa);
    }
  }

  clear() {
    for (const e of this.list) { this.scene.remove(e.group); e.dispose(); }
    this.list.length = 0;
  }
}
