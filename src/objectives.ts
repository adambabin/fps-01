import * as THREE from 'three';
import type { Enemy } from './enemies';
import type { Player } from './player';

export type ObjectiveKind = 'hold' | 'prime' | 'melee' | 'crit' | 'blast';
export type KillSource = 'bullet' | 'melee' | 'blast';

export interface Objective {
  kind: ObjectiveKind;
  title: string;
  desc: string;
  progress: number;
  goal: number;
  /** 'active' until completed or missed. */
  status: 'active' | 'done' | 'failed';
  /** World position for the waypoint marker and radar, when the objective has one. */
  pos: THREE.Vector3 | null;
}

const ZONE_R = 4;

/**
 * One optional side objective per wave. Completing it pays out a supply drop, score and
 * an extra upgrade choice; missing it costs nothing.
 */
export class Objectives {
  current: Objective | null = null;
  /** The marked robot for a 'prime' objective, once it has spawned. */
  prime: Enemy | null = null;
  private last: ObjectiveKind | null = null;
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  private zoneMat: THREE.MeshBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private marker: THREE.Mesh;
  private t = 0;

  constructor(scene: THREE.Scene) {
    const rg = new THREE.RingGeometry(0.93, 1, 64);
    rg.rotateX(-Math.PI / 2);
    this.zoneMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(rg, this.zoneMat);
    this.ring.scale.set(ZONE_R, 1, ZONE_R);
    this.beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_R, ZONE_R, 7, 40, 1, true), this.beamMat);
    const mm = new THREE.MeshBasicMaterial();
    mm.color.setRGB(4.5, 2.8, 0.4);
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), mm);
    this.marker.scale.y = 1.6;
    for (const m of [this.ring, this.beam, this.marker]) { m.visible = false; scene.add(m); }
  }

  clear() {
    this.current = null; this.prime = null;
    this.ring.visible = this.beam.visible = this.marker.visible = false;
  }

  /** Picks an objective for the wave. `zone` is an open floor position, or null if none was found. */
  start(wave: number, zone: THREE.Vector3 | null, hasExplosives: boolean) {
    this.clear();
    const kinds: ObjectiveKind[] = ['prime', 'crit', 'melee'];
    if (zone) kinds.push('hold', 'hold');
    if (hasExplosives) kinds.push('blast');
    const pool = kinds.filter((k) => k !== this.last);
    const kind = this.last = pool[(Math.random() * pool.length) | 0];
    const o: Objective = { kind, title: '', desc: '', progress: 0, goal: 1, status: 'active', pos: null };
    if (kind === 'hold') {
      o.goal = Math.min(15, 9 + wave * 0.5);
      o.title = 'Secure the uplink'; o.desc = 'Stand in the marked zone';
      o.pos = zone!.clone();
      this.ring.position.set(zone!.x, zone!.y + 0.06, zone!.z);
      this.beam.position.set(zone!.x, zone!.y + 3.5, zone!.z);
      this.ring.visible = this.beam.visible = true;
    } else if (kind === 'prime') {
      o.goal = 30;
      o.title = 'Eliminate the Prime unit'; o.desc = 'A reinforced robot is inbound';
    } else if (kind === 'crit') {
      o.goal = Math.min(8, 3 + Math.floor(wave / 3));
      o.title = 'Precision strikes'; o.desc = 'Destroy robots with weak-point hits';
    } else if (kind === 'melee') {
      o.goal = 2;
      o.title = 'Up close'; o.desc = 'Destroy robots with melee';
    } else {
      o.goal = 3;
      o.title = 'Demolition'; o.desc = 'Destroy robots with explosives';
    }
    this.current = o;
  }

  /** True while a 'prime' objective is still waiting for its robot to spawn. */
  get wantsPrime(): boolean { return !!this.current && this.current.kind === 'prime' && this.current.status === 'active' && !this.prime; }

  setPrime(e: Enemy) {
    this.prime = e;
    this.current!.desc = 'Destroy it before it goes dark';
    this.current!.pos = new THREE.Vector3();
  }

  /** Returns true when this kill completed the objective. */
  onKill(e: Enemy, source: KillSource, crit: boolean): boolean {
    const o = this.current;
    if (!o || o.status !== 'active') return false;
    if (o.kind === 'prime') { if (e !== this.prime) return false; o.progress = o.goal; }
    else if (o.kind === 'crit') { if (!crit || source !== 'bullet') return false; o.progress++; }
    else if (o.kind === 'melee') { if (source !== 'melee') return false; o.progress++; }
    else if (o.kind === 'blast') { if (source !== 'blast') return false; o.progress++; }
    else return false;
    if (o.kind !== 'prime' && o.progress < o.goal) return false;
    return this.finish(true);
  }

  /** Marks the objective missed (for example when the wave ends first). */
  fail(): boolean {
    if (!this.current || this.current.status !== 'active') return false;
    this.finish(false);
    return true;
  }

  private finish(done: boolean): boolean {
    this.current!.status = done ? 'done' : 'failed';
    this.current!.pos = null;
    this.prime = null;
    this.ring.visible = this.beam.visible = this.marker.visible = false;
    return done;
  }

  /** Returns 'done' or 'failed' on the frame the objective resolves, otherwise null. */
  update(dt: number, player: Player): 'done' | 'failed' | null {
    this.t += dt;
    const o = this.current;
    if (!o || o.status !== 'active') return null;
    if (o.kind === 'hold') {
      const inside = Math.hypot(player.pos.x - o.pos!.x, player.pos.z - o.pos!.z) < ZONE_R && Math.abs(player.pos.y - o.pos!.y) < 1.5;
      if (inside) o.progress += dt;
      const k = (inside ? 1.5 : 0.8) + Math.sin(this.t * 4) * 0.2;
      this.zoneMat.color.setRGB(0.4 * k, 3 * k, 1.3 * k);
      this.beamMat.color.setRGB(0.1 * k, 0.7 * k, 0.35 * k);
      if (o.progress >= o.goal) { this.finish(true); return 'done'; }
    } else if (o.kind === 'prime' && this.prime) {
      // The timer only runs once the Prime unit is on the floor.
      o.progress += dt;
      this.prime.center(o.pos!);
      this.marker.visible = true;
      this.marker.position.set(this.prime.pos.x, this.prime.pos.y + this.prime.def.height + 0.7 + Math.sin(this.t * 3) * 0.08, this.prime.pos.z);
      this.marker.rotation.y = this.t * 2.5;
      if (o.progress >= o.goal) { this.finish(false); return 'failed'; }
    }
    return null;
  }
}
