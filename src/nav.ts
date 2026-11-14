import { Vector3 } from 'three';
import type { Box, CollisionWorld } from './physics';

/** Grid dimensions; set from the arena's size in `rebuild` (64 cells for the 60 m arenas). */
let SIZE = 64, HALF = 32, N = SIZE * SIZE;
const FAR = 30000;
/** Walkable surfaces kept per grid cell (floor, deck above it, and so on). */
const K = 4;
/** Height a ground robot steps up or down without it counting as a drop. */
export const ROBOT_STEP = 0.55;
/** A robot needs this band above a surface free of boxes (within PAD of the cell centre) to stand there. */
// (BODY_HI is a little above the 1.6 m that Enemy.update pushes robots out of, so a route never
// squeezes under something the robot's collision would catch on.)
const BODY_LO = 0.5, BODY_HI = 1.65, PAD = 0.55;
/** A cell only counts as walkable if the surface extends this far around its centre, which keeps routes off the very edge of decks and stairs. */
const EDGE = 0.25;
const NONE = 255;
/** Neighbour offsets: -x, +x, -z, +z; `d ^ 1` is the opposite direction. */
const DI = [-1, 1, 0, 0], DJ = [0, 0, -1, 1];

/**
 * Flow field over every level of the arena. Each 1 m cell holds up to K walkable surfaces
 * (tops of collision boxes with standing room above). Surfaces in neighbouring cells are
 * linked when a robot can step between them (stairs, ramps, flat ground) or drop from the
 * higher one to the lower. One breadth-first flood from the player then gives every ground
 * robot a route, including up to catwalks and down off ledges.
 */
export class FlowField {
  private h = new Float32Array(N * K);
  private count = new Uint8Array(N);
  /** For each surface and direction: index of the surface reached in that neighbour, or NONE. */
  private link = new Uint8Array(N * K * 4);
  /** 1 for surfaces that belong to a sizeable connected area, so the flood never starts on an isolated crate top. */
  private main = new Uint8Array(N * K);
  private dist = new Int16Array(N * K);
  private queue = new Int32Array(N * K);

  constructor(world: CollisionWorld) { this.rebuild(world); }

  /** Recomputes surfaces and links; call after the arena's collision boxes change. */
  rebuild(world: CollisionWorld) {
    const size = world.half * 2 + 4;
    if (size !== SIZE || this.h.length !== size * size * K) {
      SIZE = size; HALF = size / 2; N = size * size;
      this.h = new Float32Array(N * K); this.count = new Uint8Array(N); this.link = new Uint8Array(N * K * 4);
      this.main = new Uint8Array(N * K); this.dist = new Int16Array(N * K); this.queue = new Int32Array(N * K);
    }
    const h = this.h, count = this.count, link = this.link;
    const near: Box[][] = Array.from({ length: N }, () => []);
    for (const b of world.boxes) {
      const i0 = Math.max(0, Math.floor(b.min.x - PAD + HALF)), i1 = Math.min(SIZE - 1, Math.floor(b.max.x + PAD + HALF));
      const j0 = Math.max(0, Math.floor(b.min.z - PAD + HALF)), j1 = Math.min(SIZE - 1, Math.floor(b.max.z + PAD + HALF));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = i - HALF + 0.5, cz = j - HALF + 0.5;
        if (cx > b.min.x - PAD && cx < b.max.x + PAD && cz > b.min.z - PAD && cz < b.max.z + PAD) near[j * SIZE + i].push(b);
      }
    }
    /** True when a robot body standing at height y in the cell would intersect a box. */
    const obstructed = (c: number, y: number) => near[c].some((b) => b.min.y < y + BODY_HI && b.max.y > y + BODY_LO);

    count.fill(0);
    const tops: number[] = [];
    for (let c = 0; c < N; c++) {
      const cx = (c % SIZE) - HALF + 0.5, cz = ((c / SIZE) | 0) - HALF + 0.5;
      tops.length = 0;
      for (const b of near[c]) if (cx > b.min.x && cx < b.max.x && cz > b.min.z && cz < b.max.z && b.max.y > -0.05 && b.max.y < world.ceil + 3) tops.push(b.max.y);
      tops.sort((a, b) => a - b);
      for (let i = 0; i < tops.length && count[c] < K; i++) {
        const t = tops[i];
        // A top with another just above it (a stair tread on the floor, a cap on a box) is
        // buried: the upper one is what gets stood on.
        if (i + 1 < tops.length && tops[i + 1] - t < BODY_LO) continue;
        const held = (x: number, z: number) => near[c].some((b) => Math.abs(b.max.y - t) <= ROBOT_STEP && x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z);
        if (!obstructed(c, t) && held(cx - EDGE, cz) && held(cx + EDGE, cz) && held(cx, cz - EDGE) && held(cx, cz + EDGE)) h[c * K + count[c]++] = t;
      }
    }

    link.fill(NONE);
    for (let c = 0; c < N; c++) {
      const ci = c % SIZE, cj = (c / SIZE) | 0;
      for (let k = 0; k < count[c]; k++) {
        const y = h[c * K + k];
        for (let d = 0; d < 4; d++) {
          const ni = ci + DI[d], nj = cj + DJ[d];
          if (ni < 0 || ni >= SIZE || nj < 0 || nj >= SIZE) continue;
          const n = nj * SIZE + ni;
          // Prefer a step to a surface at about the same height; otherwise drop to the next one down.
          let best = NONE, bestD = ROBOT_STEP, below = NONE;
          for (let m = 0; m < count[n]; m++) {
            const dy = h[n * K + m] - y;
            if (Math.abs(dy) <= bestD) { bestD = Math.abs(dy); best = m; }
            if (dy < -ROBOT_STEP) below = m;
          }
          if (best !== NONE) {
            // A step needs something to walk on halfway across too, or it is really a gap
            // between two structures that happen to be at similar heights.
            const y2 = h[n * K + best], mx = ci - HALF + 0.5 + DI[d] / 2, mz = cj - HALF + 0.5 + DJ[d] / 2;
            const lo = Math.min(y, y2) - 0.05, hi = Math.max(y, y2) + 0.05;
            // Inclusive, so two decks that meet exactly on the line between the cells count as joined.
            const bridged = (b: Box) => b.max.y >= lo && b.max.y <= hi && mx >= b.min.x - 0.01 && mx <= b.max.x + 0.01 && mz >= b.min.z - 0.01 && mz <= b.max.z + 0.01;
            if (!near[c].some(bridged) && !near[n].some(bridged)) best = NONE;
          }
          if (best === NONE && below !== NONE && !obstructed(n, y)) {
            // A drop must be open air all the way down: no floor slab or tread between the
            // robot's level and the surface it would land on.
            const land = h[n * K + below], nx = ni - HALF + 0.5, nz = nj - HALF + 0.5;
            const blocked = near[n].some((b) => b.max.y > land + 0.05 && b.min.y < y + BODY_LO && nx > b.min.x && nx < b.max.x && nz > b.min.z && nz < b.max.z);
            if (!blocked) best = below;
          }
          link[(c * K + k) * 4 + d] = best;
        }
      }
    }

    // Connected areas over step links (both ways), to find the surfaces worth routing to.
    const comp = new Int32Array(N * K).fill(-1), q = this.queue, sizes: number[] = [];
    for (let c = 0; c < N; c++) for (let k = 0; k < count[c]; k++) {
      const s = c * K + k;
      if (comp[s] >= 0) continue;
      const id = sizes.length;
      let head = 0, tail = 0;
      q[tail++] = s; comp[s] = id;
      while (head < tail) {
        const a = q[head++], ac = (a / K) | 0, ay = h[a];
        for (let d = 0; d < 4; d++) {
          const m = link[a * 4 + d];
          if (m === NONE) continue;
          const t = (ac + DI[d] + DJ[d] * SIZE) * K + m;
          if (comp[t] < 0 && Math.abs(h[t] - ay) <= ROBOT_STEP) { comp[t] = id; q[tail++] = t; }
        }
      }
      sizes.push(tail);
    }
    for (let s = 0; s < N * K; s++) this.main[s] = comp[s] >= 0 && sizes[comp[s]] >= 40 ? 1 : 0;
    this.dist.fill(FAR);
  }

  /** Surface in a cell that something at height y is standing on (or just above), or -1. */
  private surfaceAt(c: number, y: number): number {
    let best = -1;
    for (let k = 0; k < this.count[c]; k++) if (this.h[c * K + k] <= y + ROBOT_STEP) best = k;
    return best;
  }

  compute(px: number, py: number, pz: number) {
    const d = this.dist, q = this.queue, h = this.h, link = this.link;
    d.fill(FAR);
    const si = Math.max(0, Math.min(SIZE - 1, Math.floor(px + HALF)));
    const sj = Math.max(0, Math.min(SIZE - 1, Math.floor(pz + HALF)));
    // Start from the reachable surface closest to the player: usually the one under their feet,
    // otherwise (standing on cover, mid-jump) the nearest one, with height counting double.
    let start = -1, best = 1e9;
    for (let j = Math.max(0, sj - 5); j <= Math.min(SIZE - 1, sj + 5); j++)
      for (let i = Math.max(0, si - 5); i <= Math.min(SIZE - 1, si + 5); i++) {
        const c = j * SIZE + i;
        for (let k = 0; k < this.count[c]; k++) {
          if (!this.main[c * K + k]) continue;
          const dy = (h[c * K + k] - py) * 2, dd = (i - si) ** 2 + (j - sj) ** 2 + dy * dy;
          if (dd < best) { best = dd; start = c * K + k; }
        }
      }
    if (start < 0) return;
    let head = 0, tail = 0;
    q[tail++] = start; d[start] = 0;
    while (head < tail) {
      const s = q[head++], c = (s / K) | 0, k = s - c * K, ci = c % SIZE, cj = (c / SIZE) | 0, nd = d[s] + 1;
      // Flood backwards: every neighbouring surface whose link leads here is one step further out.
      for (let e = 0; e < 4; e++) {
        const ni = ci + DI[e], nj = cj + DJ[e];
        if (ni < 0 || ni >= SIZE || nj < 0 || nj >= SIZE) continue;
        const n = nj * SIZE + ni;
        for (let m = 0; m < this.count[n]; m++) {
          const t = n * K + m;
          if (d[t] > nd && link[t * 4 + (e ^ 1)] === k) { d[t] = nd; q[tail++] = t; }
        }
      }
    }
  }

  /** Writes a unit XZ direction toward the player into `out`, for a robot whose feet are at height y. */
  dir(x: number, y: number, z: number, out: Vector3): boolean {
    const i = Math.max(1, Math.min(SIZE - 2, Math.floor(x + HALF)));
    const j = Math.max(1, Math.min(SIZE - 2, Math.floor(z + HALF)));
    const d = this.dist, h = this.h, link = this.link, c = j * SIZE + i;
    const k = this.surfaceAt(c, y);
    let best = FAR as number, bi = 0, bj = 0;
    if (k < 0) {
      // Inside a blocked cell (pushed there, or just spawned): head for any neighbouring surface at this height.
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const n = c + di + dj * SIZE, m = this.surfaceAt(n, y);
        if (m >= 0 && d[n * K + m] < best) { best = d[n * K + m]; bi = di; bj = dj; }
      }
    } else {
      const s = c * K + k, sy = h[s];
      best = d[s];
      const flat = [-1, -1, -1, -1];
      for (let e = 0; e < 4; e++) {
        const m = link[s * 4 + e];
        if (m === NONE) continue;
        const t = (c + DI[e] + DJ[e] * SIZE) * K + m;
        if (Math.abs(h[t] - sy) <= ROBOT_STEP) flat[e] = t;
        if (d[t] < best) { best = d[t]; bi = DI[e]; bj = DJ[e]; }
      }
      // Diagonals only across level ground, and only when both corners are open. They win ties
      // so paths look less grid-like.
      for (const ex of [0, 1]) for (const ez of [2, 3]) {
        const a = flat[ex], b = flat[ez];
        if (a < 0 || b < 0) continue;
        const m = link[a * 4 + ez];
        if (m === NONE || link[b * 4 + ex] !== m) continue;
        const t = (c + DI[ex] + DJ[ez] * SIZE) * K + m;
        if (Math.abs(h[t] - sy) <= ROBOT_STEP && d[t] - 0.4 < best) { best = d[t] - 0.4; bi = DI[ex]; bj = DJ[ez]; }
      }
    }
    if (!bi && !bj) return false;
    out.set(i + bi - HALF + 0.5 - x, 0, j + bj - HALF + 0.5 - z).normalize();
    return true;
  }
}
