import * as THREE from 'three';
import type { AudioSys } from './audio';
import type { Effects } from './effects';
import type { CollisionWorld } from './physics';
import type { Player } from './player';

export type ProjKind = 'bolt' | 'rocket' | 'grenade';

interface Proj {
  kind: ProjKind; mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3;
  dmg: number; life: number; active: boolean; trail: number;
}

export interface ProjCtx {
  world: CollisionWorld; player: Player; effects: Effects; audio: AudioSys;
  hurtPlayer(amount: number, from: THREE.Vector3): void;
  /** Explosion: damages robots (dmgEnemy) and the player (dmgPlayer) with falloff. */
  explode(pos: THREE.Vector3, radius: number, dmgEnemy: number, dmgPlayer: number): void;
  /** Returns true if a robot is within `r` of the point. */
  enemyNear(pos: THREE.Vector3, r: number): boolean;
}

const tmp = new THREE.Vector3(), dir = new THREE.Vector3();

/** Robot bolts and rockets, and the player's grenades. */
export class Projectiles {
  private list: Proj[] = [];

  constructor(private scene: THREE.Scene) {
    const boltGeo = new THREE.SphereGeometry(0.09, 8, 6);
    boltGeo.scale(1, 1, 3.2);
    const boltMat = new THREE.MeshBasicMaterial(); boltMat.color.setRGB(5, 1.6, 0.3);
    const rocketGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.6, 8); rocketGeo.rotateX(Math.PI / 2);
    const rocketMat = new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.8, roughness: 0.4, emissive: 0xff5a1a, emissiveIntensity: 1.2 });
    const grenGeo = new THREE.SphereGeometry(0.075, 10, 8);
    const grenMat = new THREE.MeshStandardMaterial({ color: 0x2c3a2c, metalness: 0.6, roughness: 0.5, emissive: 0x33ff66, emissiveIntensity: 0.9 });
    const make = (kind: ProjKind, n: number, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      for (let i = 0; i < n; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        scene.add(mesh);
        this.list.push({ kind, mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dmg: 0, life: 0, active: false, trail: 0 });
      }
    };
    make('bolt', 60, boltGeo, boltMat);
    make('rocket', 10, rocketGeo, rocketMat);
    make('grenade', 8, grenGeo, grenMat);
  }

  spawn(kind: ProjKind, pos: THREE.Vector3, vel: THREE.Vector3, dmg: number) {
    const p = this.list.find((q) => q.kind === kind && !q.active);
    if (!p) return;
    p.active = true; p.pos.copy(pos); p.vel.copy(vel); p.dmg = dmg; p.trail = 0;
    p.life = kind === 'grenade' ? 1.7 : 5;
    p.mesh.position.copy(pos);
    p.mesh.lookAt(tmp.copy(pos).add(vel));
    p.mesh.visible = true;
  }

  clear() { for (const p of this.list) { p.active = false; p.mesh.visible = false; } }

  update(dt: number, c: ProjCtx) {
    const pl = c.player;
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.kind === 'grenade') p.vel.y -= 18 * dt;
      const speed = p.vel.length(), step = speed * dt;
      let done = false;
      if (speed > 1e-4) {
        dir.copy(p.vel).multiplyScalar(1 / speed);
        const hit = c.world.raycast(p.pos, dir, step + 0.05);
        if (hit) {
          if (p.kind === 'grenade') {
            p.pos.copy(hit.point).addScaledVector(hit.normal, 0.08);
            const vn = p.vel.dot(hit.normal);
            p.vel.addScaledVector(hit.normal, -1.45 * vn).multiplyScalar(0.62);
            if (Math.abs(vn) > 2) c.audio.grenadeBounce(p.pos);
          } else {
            p.pos.copy(hit.point).addScaledVector(hit.normal, 0.05);
            if (p.kind === 'rocket') c.explode(p.pos, 4.5, 0, p.dmg);
            else c.effects.sparks(p.pos, hit.normal, 5, 4, 1.2, 0.3);
            done = true;
          }
        } else {
          // Segment vs player body.
          if (p.kind !== 'grenade') {
            const my = pl.pos.y + pl.height * 0.5;
            tmp.set(pl.pos.x, my, pl.pos.z).sub(p.pos);
            const t = Math.max(0, Math.min(step, tmp.dot(dir)));
            const qx = p.pos.x + dir.x * t - pl.pos.x, qy = p.pos.y + dir.y * t - my, qz = p.pos.z + dir.z * t - pl.pos.z;
            if (qx * qx + qz * qz < 0.2 && Math.abs(qy) < pl.height * 0.5 + 0.15) {
              p.pos.addScaledVector(dir, t);
              if (p.kind === 'rocket') c.explode(p.pos, 4.5, 0, p.dmg);
              else { c.hurtPlayer(p.dmg, tmp.copy(p.pos).addScaledVector(dir, -3)); c.effects.sparks(p.pos, dir.negate(), 4, 4, 1.2, 0.3); }
              done = true;
            }
          } else if (c.enemyNear(p.pos, 0.9)) {
            p.life = 0;
          }
          if (!done) p.pos.addScaledVector(dir, step);
        }
      }
      if (!done && p.life <= 0) {
        if (p.kind === 'grenade') c.explode(p.pos, 6.5, p.dmg, 35);
        done = true;
      }
      if (done) { p.active = false; p.mesh.visible = false; continue; }
      p.mesh.position.copy(p.pos);
      if (p.kind !== 'grenade') p.mesh.lookAt(tmp.copy(p.pos).add(p.vel));
      p.trail -= dt;
      if (p.trail <= 0) {
        if (p.kind === 'rocket') { p.trail = 0.02; c.effects.trail(p.pos, 3, 1.2, 0.3, 0.3); if (Math.random() < 0.5) c.effects.puff(p.pos, 1, 0.4, 0.25); }
        else if (p.kind === 'bolt') { p.trail = 0.03; c.effects.trail(p.pos, 2.5, 0.8, 0.15, 0.14); }
        else { p.trail = 0.05; c.effects.trail(p.pos, 0.3, 2, 0.6, 0.1); }
      }
    }
  }
}

export const PICKUP_HEALTH = 0, PICKUP_ARMOR = 1, PICKUP_AMMO = 2, PICKUP_GRENADE = 3;
interface Pickup { kind: number; group: THREE.Group; life: number; active: boolean; baseY: number; }

export class Pickups {
  private list: Pickup[] = [];
  private t = 0;

  constructor(scene: THREE.Scene) {
    const body = new THREE.MeshStandardMaterial({ color: 0x22262b, metalness: 0.8, roughness: 0.4 });
    const cols: [number, number, number][] = [[0.3, 3, 0.6], [0.3, 1.4, 3.5], [3.2, 2.2, 0.3], [3, 0.6, 0.3]];
    const bg = new THREE.BoxGeometry(0.34, 0.34, 0.34), band = new THREE.BoxGeometry(0.36, 0.07, 0.36), cross = new THREE.BoxGeometry(0.07, 0.36, 0.2);
    for (let kind = 0; kind < 4; kind++) {
      const glow = new THREE.MeshBasicMaterial(); glow.color.setRGB(...cols[kind]);
      for (let i = 0; i < 8; i++) {
        const g = new THREE.Group();
        const b = new THREE.Mesh(bg, body); b.castShadow = true;
        g.add(b, new THREE.Mesh(band, glow));
        if (kind === PICKUP_HEALTH) g.add(new THREE.Mesh(cross, glow));
        g.visible = false;
        scene.add(g);
        this.list.push({ kind, group: g, life: 0, active: false, baseY: 0.5 });
      }
    }
  }

  spawn(kind: number, pos: THREE.Vector3) {
    const p = this.list.find((q) => q.kind === kind && !q.active);
    if (!p) return;
    p.active = true; p.life = 25;
    p.baseY = Math.max(0.5, Math.min(pos.y, 1.2));
    p.group.position.set(pos.x, p.baseY, pos.z);
    p.group.visible = true;
  }

  clear() { for (const p of this.list) { p.active = false; p.group.visible = false; } }

  /** `collect` returns false when the player has no use for the pickup. */
  update(dt: number, player: Player, collect: (kind: number) => boolean) {
    this.t += dt;
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      const g = p.group;
      g.rotation.y += dt * 1.8;
      g.position.y = p.baseY + Math.sin(this.t * 3 + g.position.x) * 0.08;
      g.visible = p.life > 4 || Math.floor(p.life * 6) % 2 === 0;
      const dx = player.pos.x - g.position.x, dz = player.pos.z - g.position.z, d = Math.hypot(dx, dz);
      if (d < 3.2 && d > 0.01) { g.position.x += (dx / d) * dt * 7; g.position.z += (dz / d) * dt * 7; }
      if (d < 1.1 && Math.abs(player.pos.y + 0.9 - g.position.y) < 1.8 && collect(p.kind)) p.life = 0;
      if (p.life <= 0) { p.active = false; g.visible = false; }
    }
  }
}
