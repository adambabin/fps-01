import { Vector3 } from 'three';
import type { CollisionWorld } from './physics';

const SIZE = 64, HALF = 32, FAR = 30000;

/**
 * Grid flow field: one breadth-first flood from the player gives every ground
 * robot a path around cover without per-robot pathfinding.
 */
export class FlowField {
  private dist = new Int16Array(SIZE * SIZE);
  private blocked = new Uint8Array(SIZE * SIZE);
  private queue = new Int32Array(SIZE * SIZE);

  constructor(world: CollisionWorld) { this.rebuild(world); }

  /** Recomputes blocked cells; call after the arena's collision boxes change. */
  rebuild(world: CollisionWorld) {
    this.blocked.fill(0);
    const pad = 0.55;
    for (const b of world.boxes) {
      if (b.min.y > 1.2 || b.max.y < 0.25) continue;
      const i0 = Math.max(0, Math.floor(b.min.x - pad + HALF)), i1 = Math.min(SIZE - 1, Math.floor(b.max.x + pad + HALF));
      const j0 = Math.max(0, Math.floor(b.min.z - pad + HALF)), j1 = Math.min(SIZE - 1, Math.floor(b.max.z + pad + HALF));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = i - HALF + 0.5, cz = j - HALF + 0.5;
        if (cx > b.min.x - pad && cx < b.max.x + pad && cz > b.min.z - pad && cz < b.max.z + pad) this.blocked[j * SIZE + i] = 1;
      }
    }
    this.dist.fill(FAR);
  }

  compute(px: number, pz: number) {
    const d = this.dist, q = this.queue;
    d.fill(FAR);
    let si = Math.max(0, Math.min(SIZE - 1, Math.floor(px + HALF)));
    let sj = Math.max(0, Math.min(SIZE - 1, Math.floor(pz + HALF)));
    if (this.blocked[sj * SIZE + si]) {
      // Player is standing on cover: start from the closest open cell.
      let best = 1e9, bi = si, bj = sj;
      for (let j = Math.max(0, sj - 4); j <= Math.min(SIZE - 1, sj + 4); j++)
        for (let i = Math.max(0, si - 4); i <= Math.min(SIZE - 1, si + 4); i++) {
          if (this.blocked[j * SIZE + i]) continue;
          const dd = (i - si) ** 2 + (j - sj) ** 2;
          if (dd < best) { best = dd; bi = i; bj = j; }
        }
      si = bi; sj = bj;
    }
    let head = 0, tail = 0;
    q[tail++] = sj * SIZE + si;
    d[sj * SIZE + si] = 0;
    while (head < tail) {
      const c = q[head++], ci = c % SIZE, cj = (c / SIZE) | 0, nd = d[c] + 1;
      if (ci > 0) { const n = c - 1; if (!this.blocked[n] && d[n] > nd) { d[n] = nd; q[tail++] = n; } }
      if (ci < SIZE - 1) { const n = c + 1; if (!this.blocked[n] && d[n] > nd) { d[n] = nd; q[tail++] = n; } }
      if (cj > 0) { const n = c - SIZE; if (!this.blocked[n] && d[n] > nd) { d[n] = nd; q[tail++] = n; } }
      if (cj < SIZE - 1) { const n = c + SIZE; if (!this.blocked[n] && d[n] > nd) { d[n] = nd; q[tail++] = n; } }
    }
  }

  /** Writes a unit XZ direction toward the player into `out`. */
  dir(x: number, z: number, out: Vector3): boolean {
    const i = Math.max(1, Math.min(SIZE - 2, Math.floor(x + HALF)));
    const j = Math.max(1, Math.min(SIZE - 2, Math.floor(z + HALF)));
    const d = this.dist, bl = this.blocked;
    let best = d[j * SIZE + i], bi = 0, bj = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const n = (j + dj) * SIZE + (i + di);
      if (bl[n]) continue;
      if (di && dj && (bl[j * SIZE + (i + di)] || bl[(j + dj) * SIZE + i])) continue;
      // Slight bias so diagonals win ties and paths look less grid-like.
      const v = d[n] - (di && dj ? 0.4 : 0);
      if (v < best) { best = v; bi = di; bj = dj; }
    }
    if (!bi && !bj) return false;
    out.set(i + bi - HALF + 0.5 - x, 0, j + bj - HALF + 0.5 - z).normalize();
    return true;
  }
}
