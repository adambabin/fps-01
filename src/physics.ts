import { Vector3 } from 'three';

export interface Box { min: Vector3; max: Vector3; }
export interface RayHit { dist: number; point: Vector3; normal: Vector3; }

const EPS = 1e-4;

/** Static world made of axis-aligned boxes. Cheap and predictable. */
export class CollisionWorld {
  boxes: Box[] = [];

  add(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): Box {
    const b = {
      min: new Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      max: new Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    };
    this.boxes.push(b);
    return b;
  }

  raycast(o: Vector3, d: Vector3, maxDist: number): RayHit | null {
    let best = maxDist, bestAxis = -1, bestSign = 0;
    const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
    for (const b of this.boxes) {
      const mn = [b.min.x, b.min.y, b.min.z], mx = [b.max.x, b.max.y, b.max.z];
      let tmin = 0, tmax = best, axis = -1, sign = 0, miss = false;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(da[a]) < 1e-9) {
          if (oa[a] < mn[a] || oa[a] > mx[a]) { miss = true; break; }
        } else {
          let t1 = (mn[a] - oa[a]) / da[a], t2 = (mx[a] - oa[a]) / da[a], s = -1;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { miss = true; break; }
        }
      }
      if (miss || axis < 0) continue;
      best = tmin; bestAxis = axis; bestSign = sign;
    }
    if (bestAxis < 0) return null;
    const normal = new Vector3();
    normal.setComponent(bestAxis, bestSign);
    return { dist: best, point: new Vector3().copy(d).multiplyScalar(best).add(o), normal };
  }

  /** True when nothing solid lies between the two points. */
  clear(a: Vector3, b: Vector3): boolean {
    const d = tmpDir.subVectors(b, a);
    const len = d.length();
    if (len < 1e-5) return true;
    d.multiplyScalar(1 / len);
    return this.raycast(a, d, len) === null;
  }

  overlaps(c: Vector3, h: Vector3): boolean {
    for (const b of this.boxes) {
      if (c.x - h.x < b.max.x && c.x + h.x > b.min.x &&
          c.y - h.y < b.max.y && c.y + h.y > b.min.y &&
          c.z - h.z < b.max.z && c.z + h.z > b.min.z) return true;
    }
    return false;
  }

  /** Moves a box (centre c, half extents h) along one axis, resolving penetration. */
  moveAxis(c: Vector3, h: Vector3, axis: 0 | 1 | 2, amt: number): boolean {
    if (amt === 0) return false;
    c.setComponent(axis, c.getComponent(axis) + amt);
    let hit = false;
    for (const b of this.boxes) {
      if (c.x - h.x < b.max.x && c.x + h.x > b.min.x &&
          c.y - h.y < b.max.y && c.y + h.y > b.min.y &&
          c.z - h.z < b.max.z && c.z + h.z > b.min.z) {
        if (amt > 0) c.setComponent(axis, b.min.getComponent(axis) - h.getComponent(axis) - EPS);
        else c.setComponent(axis, b.max.getComponent(axis) + h.getComponent(axis) + EPS);
        hit = true;
      }
    }
    return hit;
  }

  /** Pushes a vertical cylinder out of boxes on the XZ plane. */
  pushOutXZ(p: Vector3, r: number, y0: number, y1: number) {
    for (const b of this.boxes) {
      if (y1 < b.min.y || y0 > b.max.y) continue;
      const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        p.x += dx * k; p.z += dz * k;
      } else {
        // Centre is inside the box: exit through the nearest face.
        const l = p.x - b.min.x, rr = b.max.x - p.x, n = p.z - b.min.z, f = b.max.z - p.z;
        const m = Math.min(l, rr, n, f);
        if (m === l) p.x = b.min.x - r; else if (m === rr) p.x = b.max.x + r;
        else if (m === n) p.z = b.min.z - r; else p.z = b.max.z + r;
      }
    }
  }

  /** Pushes a sphere out of boxes in 3D. */
  pushOutSphere(p: Vector3, r: number) {
    for (const b of this.boxes) {
      const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
      const cy = Math.max(b.min.y, Math.min(p.y, b.max.y));
      const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), k = (r - d) / d;
      p.x += dx * k; p.y += dy * k; p.z += dz * k;
    }
  }
}

const tmpDir = new Vector3();

/** Ray vs sphere; returns entry distance or -1. */
export function raySphere(o: Vector3, d: Vector3, cx: number, cy: number, cz: number, r: number): number {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return Math.max(0, -b - Math.sqrt(disc));
}
