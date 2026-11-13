import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];
export type V2 = [number, number];
export interface Xf { p?: V3; r?: V3; s?: V3; }

/** A finish names which material a part uses and the tint baked into its vertices. */
export interface Finish { mat: string; color: number; }

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

// ---------- primitives (each call returns a fresh geometry) ----------
export function box(w: number, h: number, d: number, r = 0): THREE.BufferGeometry {
  return r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
}

export function cyl(r: number, len: number, axis: 'x' | 'y' | 'z' = 'y', seg = 14, r2 = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r2, r, len, seg);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/** Tapered cylinder running from a to b. */
export function tube(a: V3, b: V3, ra: number, rb = ra, seg = 10): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va), len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

export function sphere(r: number, seg = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
}

export function torus(R: number, r: number, axis: 'x' | 'y' | 'z' = 'z', seg = 20): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(R, r, 8, seg);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  else if (axis === 'y') g.rotateX(Math.PI / 2);
  return g;
}

function extrude(pts: V2[], depth: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const b = Math.min(bevel, depth / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - b * 2, bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelOffset: -b, bevelSegments: 1, steps: 1,
  });
  g.translate(0, 0, -(depth - b * 2) / 2);
  return g;
}

/** Side profile given as [z, y] points, extruded across X. Best for silhouettes seen from the side. */
export function prismX(pts: V2[], width: number, bevel = 0.01): THREE.BufferGeometry {
  // Negate z so that after the turn the profile's first coordinate lands on +Z.
  const g = extrude(pts.map((p) => [-p[0], p[1]] as V2), width, bevel);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Top-down profile given as [x, z] points, extruded along Y. */
export function prismY(pts: V2[], height: number, bevel = 0.01): THREE.BufferGeometry {
  const g = extrude(pts.map((p) => [p[0], -p[1]] as V2), height, bevel);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Smooth hose through the given points. */
export function cable(pts: V3[], r: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, pts.length * 5, r, 6, false);
}

// ---------- rig: named pivots whose parts are merged into a few meshes ----------
interface NodeRec { obj: THREE.Group; parts: Map<string, THREE.BufferGeometry[]>; }

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), vp = new THREE.Vector3(), vs = new THREE.Vector3();
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
const col = new THREE.Color();

/**
 * Collects parts under named pivots, then bakes each pivot's parts into one mesh per
 * material. Tints are stored as vertex colors so many finishes share a material, and
 * UVs are projected from model space so texture density is uniform across parts.
 */
export class Rig {
  root = new THREE.Group();
  private nodes = new Map<string, NodeRec>();

  constructor(private mats: Record<string, THREE.Material>, private finishes: Record<string, Finish>, private texSize: number, private noShadow: string[] = []) {
    this.root.name = 'root';
    this.nodes.set('root', { obj: this.root, parts: new Map() });
  }

  node(name: string, parent: string, p: V3 = [0, 0, 0]): this {
    const obj = new THREE.Group();
    obj.name = name;
    obj.position.set(...p);
    this.nodes.get(parent)!.obj.add(obj);
    this.nodes.set(name, { obj, parts: new Map() });
    return this;
  }

  add(node: string, finish: string, geo: THREE.BufferGeometry, xf: Xf = {}): this {
    const f = this.finishes[finish];
    if (!f) throw new Error('Unknown finish ' + finish);
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (xf.p || xf.r || xf.s) {
      if (xf.r) q.setFromEuler(e.set(xf.r[0], xf.r[1], xf.r[2])); else q.identity();
      m4.compose(vp.set(...(xf.p ?? [0, 0, 0])), q, vs.set(...(xf.s ?? [1, 1, 1])));
      g.applyMatrix4(m4);
      if (m4.determinant() < 0) flipWinding(g);
    }
    // Planar UVs chosen per triangle from its facing, plus the finish tint.
    const pos = g.attributes.position as THREE.BufferAttribute, count = pos.count;
    const uv = new Float32Array(count * 2), cols = new Float32Array(count * 3);
    col.setHex(f.color);
    const k = 1 / this.texSize;
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      n.subVectors(b, a).cross(vs.subVectors(c, a));
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      for (let j = 0; j < 3; j++) {
        const v = j === 0 ? a : j === 1 ? b : c, o = (i + j) * 2;
        if (ax >= ay && ax >= az) { uv[o] = v.z * k; uv[o + 1] = v.y * k; }
        else if (ay >= az) { uv[o] = v.x * k; uv[o + 1] = v.z * k; }
        else { uv[o] = v.x * k; uv[o + 1] = v.y * k; }
        cols[(i + j) * 3] = col.r; cols[(i + j) * 3 + 1] = col.g; cols[(i + j) * 3 + 2] = col.b;
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', pos);
    out.setAttribute('normal', g.attributes.normal);
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const rec = this.nodes.get(node);
    if (!rec) throw new Error('Unknown node ' + node);
    if (!rec.parts.has(f.mat)) rec.parts.set(f.mat, []);
    rec.parts.get(f.mat)!.push(out);
    return this;
  }

  /** Adds the part twice, mirrored across X. `make` receives +1 then -1. */
  pair(make: (s: number) => void): this { make(1); make(-1); return this; }

  bake(): THREE.Group {
    for (const rec of this.nodes.values()) {
      for (const [mat, list] of rec.parts) {
        const mesh = new THREE.Mesh(mergeGeometries(list, false), this.mats[mat]);
        mesh.userData.mat = mat;
        mesh.castShadow = !this.noShadow.includes(mat);
        rec.obj.add(mesh);
        for (const g of list) g.dispose();
      }
      rec.parts.clear();
    }
    return this.root;
  }
}

function flipWinding(g: THREE.BufferGeometry) {
  for (const name of ['position', 'normal']) {
    const at = g.attributes[name] as THREE.BufferAttribute, arr = at.array as Float32Array;
    for (let i = 0; i < at.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const t = arr[(i + 1) * 3 + k]; arr[(i + 1) * 3 + k] = arr[(i + 2) * 3 + k]; arr[(i + 2) * 3 + k] = t;
      }
    }
  }
}

export { X, Y, Z };
