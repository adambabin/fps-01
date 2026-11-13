import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CollisionWorld } from './physics';
import { makeHazardTexture, makeRadialTexture, makeSurface, type SurfaceMaps } from './textures';

export const ARENA = 30;
export const CEIL = 9;

interface BoxOpts { collide?: boolean; cast?: boolean; tex?: number; receive?: boolean; }

/** Box geometry whose UVs follow its real size so textures never stretch. */
function scaledBox(sx: number, sy: number, sz: number, texSize: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / texSize, (uv.getY(i) * dims[f][1]) / texSize);
  }
  return g;
}

function std(maps: SurfaceMaps, metalness: number, color = 0xffffff, normalScale = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: maps.map, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
    metalness, roughness: 1, color, normalScale: new THREE.Vector2(normalScale, normalScale),
  });
}

function glow(r: number, g: number, b: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial();
  m.color.setRGB(r, g, b);
  return m;
}

export class World {
  collision = new CollisionWorld();
  /** Ground spawn gates: position and inward direction. */
  gates: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  /** Ceiling vents where drones enter. */
  vents: THREE.Vector3[] = [];
  sun!: THREE.DirectionalLight;
  private dust!: THREE.Points;
  private pulse: THREE.MeshBasicMaterial[] = [];
  private coreLight!: THREE.PointLight;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;
    scene.background = new THREE.Color(0x06080b);
    scene.fog = new THREE.FogExp2(0x0a0e13, 0.014);
    pmrem.dispose();
    this.build();
  }

  private box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material, o: BoxOpts = {}) {
    const mesh = new THREE.Mesh(scaledBox(sx, sy, sz, o.tex ?? 3), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.receive ?? true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    if (o.collide ?? true) this.collision.add(cx, cy, cz, sx, sy, sz);
    return mesh;
  }

  private build() {
    const s = this.scene, A = ARENA, H = CEIL;
    const floorMaps = makeSurface({ seed: 11, color: [92, 96, 102], panels: 4, rivets: true, roughness: 0.5, wear: 1, bump: 5 });
    const wallMaps = makeSurface({ seed: 23, color: [104, 108, 112], panels: 2, stagger: true, ribs: 8, roughness: 0.62, wear: 0.9, bump: 5 });
    const crateMaps = makeSurface({ seed: 37, color: [128, 122, 108], panels: 1, frame: true, rivets: true, roughness: 0.58, wear: 1.2, bump: 6 });
    const plainMaps = makeSurface({ seed: 51, color: [70, 73, 78], panels: 0, roughness: 0.48, wear: 1.1, bump: 3 }, 256);

    const floorMat = std(floorMaps, 0.6);
    const wallMat = std(wallMaps, 0.4);
    const pillarMat = std(wallMaps, 0.45, 0xa4aab2);
    const crateMat = std(crateMaps, 0.3);
    const crateMat2 = std(crateMaps, 0.3, 0x6f8494);
    const containerA = std(wallMaps, 0.35, 0x9a4f39);
    const containerB = std(wallMaps, 0.35, 0x41647e);
    const trimMat = std(plainMaps, 0.45, 0xb4bac2);
    const darkMat = std(plainMaps, 0.4, 0x4a4e57);
    const cyan = glow(0.3, 2.2, 3.2), orange = glow(3.4, 1.2, 0.25), red = glow(3.6, 0.25, 0.15), white = glow(2.6, 2.7, 3.0);
    this.pulse.push(red, cyan);

    // Shell
    this.box(0, -0.5, 0, A * 2, 1, A * 2, floorMat, { cast: false, tex: 4 });
    this.box(0, H + 0.5, 0, A * 2 + 2, 1, A * 2 + 2, darkMat, { cast: false, receive: false });
    this.box(0, H / 2, -A - 0.5, A * 2 + 2, H, 1, wallMat, { cast: false, tex: 6 });
    this.box(0, H / 2, A + 0.5, A * 2 + 2, H, 1, wallMat, { cast: false, tex: 6 });
    this.box(-A - 0.5, H / 2, 0, 1, H, A * 2, wallMat, { cast: false, tex: 6 });
    this.box(A + 0.5, H / 2, 0, 1, H, A * 2, wallMat, { cast: false, tex: 6 });

    // Ceiling girders and light panels
    for (let i = -2; i <= 2; i++) {
      this.box(i * 12, H - 0.45, 0, 0.6, 0.9, A * 2, darkMat, { collide: false, cast: false });
      this.box(0, H - 0.75, i * 12, A * 2, 0.3, 0.4, darkMat, { collide: false, cast: false });
    }
    for (let x = -18; x <= 18; x += 12) for (let z = -18; z <= 18; z += 12) {
      this.box(x, H - 0.06, z, 3.2, 0.1, 1.1, white, { collide: false, cast: false, receive: false });
      this.box(x, H - 0.12, z, 3.6, 0.22, 1.5, darkMat, { collide: false, cast: false, receive: false });
    }

    // Wall skirting, light strips and pipe runs
    const pipeGeo = new THREE.CylinderGeometry(0.16, 0.16, A * 2, 10);
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) {
      const along = ax === 0;
      const p = (A - 0.12) * sgn;
      const place = (y: number, t: number, h: number, mat: THREE.Material, len = A * 2) =>
        along ? this.box(0, y, p, len, h, t, mat, { collide: false, cast: false }) : this.box(p, y, 0, t, h, len, mat, { collide: false, cast: false });
      place(0.25, 0.3, 0.5, trimMat);
      place(4.6, 0.26, 0.5, trimMat);
      for (const [y, off] of [[6.3, 0.35], [6.8, 0.3], [7.5, 0.4]] as const) {
        const pipe = new THREE.Mesh(pipeGeo, y === 6.8 ? containerA : trimMat);
        pipe.rotation.z = Math.PI / 2;
        if (!along) pipe.rotation.y = Math.PI / 2;
        const q = (A - off) * sgn;
        pipe.position.set(along ? 0 : q, y, along ? q : 0);
        pipe.matrixAutoUpdate = false; pipe.updateMatrix();
        s.add(pipe);
      }
      // Light strips broken into segments so they read as fixtures.
      for (let k = -4; k <= 4; k++) {
        if (k === 0) continue;
        const c = k * 6.2, m = Math.abs(k) % 2 ? cyan : orange;
        if (along) this.box(c, 4.6, (A - 0.28) * sgn, 2.4, 0.09, 0.06, m, { collide: false, cast: false, receive: false });
        else this.box((A - 0.28) * sgn, 4.6, c, 0.06, 0.09, 2.4, m, { collide: false, cast: false, receive: false });
      }
      // Spawn gate
      const gx = along ? 0 : (A - 0.2) * sgn, gz = along ? (A - 0.2) * sgn : 0;
      const w = (a: number, b: number): [number, number] => (along ? [a, b] : [b, a]);
      const [fx, fz] = w(5.6, 0.5);
      this.box(gx, 3.9, gz, fx, 0.5, fz, trimMat, { collide: false, cast: false });
      for (const side of [-1, 1]) {
        const [ox, oz] = w(2.8 * side, 0);
        const [px, pz] = w(0.5, 0.5);
        this.box(gx + ox, 1.95, gz + oz, px, 3.9, pz, trimMat, { collide: false, cast: false });
      }
      const [dx, dz] = w(5.1, 0.2);
      this.box(gx, 1.85, gz, dx, 3.7, dz, darkMat, { collide: false, cast: false });
      const [lx, lz] = w(4.6, 0.12);
      const inward = along ? [0, -0.3 * sgn] : [-0.3 * sgn, 0];
      this.box(gx + inward[0], 3.55, gz + inward[1], lx, 0.1, lz, red, { collide: false, cast: false, receive: false });
      this.gates.push({
        pos: new THREE.Vector3(along ? 0 : (A - 2) * sgn, 0, along ? (A - 2) * sgn : 0),
        dir: new THREE.Vector3(along ? 0 : -sgn, 0, along ? -sgn : 0),
      });
    }

    // Hazard markings in front of each gate
    const hazard = makeHazardTexture();
    hazard.repeat.set(3, 0.5);
    const hazMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const g of this.gates) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1), hazMat);
      m.rotation.x = -Math.PI / 2;
      if (g.dir.x !== 0) m.rotation.z = Math.PI / 2;
      m.position.copy(g.pos).addScaledVector(g.dir, 2.2).setY(0.012);
      m.receiveShadow = true;
      s.add(m);
    }

    // Central reactor
    this.box(0, 0.5, 0, 3.4, 1, 3.4, trimMat);
    this.box(0, 1.1, 0, 2.6, 0.2, 2.6, darkMat);
    this.collision.add(0, H / 2, 0, 1.5, H, 1.5);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, H - 1.2, 20), cyan);
    core.position.set(0, (H + 1.2) / 2, 0);
    s.add(core);
    const cage = new THREE.CylinderGeometry(0.06, 0.06, H - 1.2, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, bar = new THREE.Mesh(cage, darkMat);
      bar.position.set(Math.cos(a) * 0.7, (H + 1.2) / 2, Math.sin(a) * 0.7);
      bar.castShadow = true;
      s.add(bar);
    }
    for (const y of [2.6, 4.6, 6.6]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.22, 20), trimMat);
      ring.position.set(0, y, 0); ring.castShadow = true;
      s.add(ring);
    }
    this.coreLight = new THREE.PointLight(0x48c8ff, 60, 26, 1.8);
    this.coreLight.position.set(0, 3.2, 0);
    s.add(this.coreLight);

    // Mirrored layout
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      // Structural pillars with light strips
      const px = 13 * qx, pz = 13 * qz;
      this.box(px, H / 2, pz, 2.4, H, 2.4, pillarMat, { tex: 2.4 });
      this.box(px, 0.3, pz, 2.9, 0.6, 2.9, trimMat, { collide: false });
      this.box(px, H - 0.5, pz, 2.9, 1, 2.9, trimMat, { collide: false, cast: false });
      this.collision.add(px, 0.3, pz, 2.9, 0.6, 2.9);
      for (const [ox, oz] of [[1.22, 0], [-1.22, 0], [0, 1.22], [0, -1.22]])
        this.box(px + ox, 3.6, pz + oz, ox ? 0.05 : 0.14, 4.2, oz ? 0.05 : 0.14, orange, { collide: false, cast: false, receive: false });

      // Shipping containers near the walls
      this.box(24 * qx, 1.3, 14 * qz, 2.6, 2.6, 6.2, qx * qz > 0 ? containerA : containerB, { tex: 2.6 });
      this.box(14 * qx, 1.3, 24.5 * qz, 6.2, 2.6, 2.6, qx * qz > 0 ? containerB : containerA, { tex: 2.6 });

      // Crate clusters
      this.box(20.5 * qx, 1, 21 * qz, 2, 2, 2, crateMat, { tex: 2 });
      this.box(22.4 * qx, 0.6, 20.2 * qz, 1.2, 1.2, 1.2, crateMat2, { tex: 1.2 });
      this.box(20.5 * qx, 2.5, 21 * qz, 1, 1, 1, crateMat2, { tex: 1 });
      this.box(6.5 * qx, 0.6, 19 * qz, 1.2, 1.2, 1.2, crateMat, { tex: 1.2 });
      this.box(7.9 * qx, 0.5, 19.3 * qz, 1, 1, 1, crateMat2, { tex: 1 });
      this.box(19 * qx, 0.75, 5.5 * qz, 1.5, 1.5, 1.5, crateMat, { tex: 1.5 });

      // Low cover walls
      this.box(7 * qx, 0.6, 6.5 * qz, 0.5, 1.2, 4.5, trimMat, { tex: 2 });
      this.box(7 * qx, 1.23, 6.5 * qz, 0.6, 0.08, 4.6, darkMat, { collide: false });
    }
    for (const sgn of [1, -1]) {
      this.box(0, 0.6, 12 * sgn, 5, 1.2, 0.5, trimMat, { tex: 2 });
      this.box(0, 1.23, 12 * sgn, 5.1, 0.08, 0.6, darkMat, { collide: false });
      this.box(18 * sgn, 0.6, 0, 0.5, 1.2, 5, trimMat, { tex: 2 });
      this.box(18 * sgn, 1.23, 0, 0.6, 0.08, 5.1, darkMat, { collide: false });
    }

    for (const [x, z] of [[22, 22], [-22, 22], [22, -22], [-22, -22]]) this.vents.push(new THREE.Vector3(x * 0.6, H - 1.6, z * 0.6));

    // Lighting
    s.add(new THREE.HemisphereLight(0x9db2cc, 0x3a332c, 1.0));
    const sun = new THREE.DirectionalLight(0xdfe8ff, 1.5);
    sun.position.set(14, 34, 9);
    sun.castShadow = true;
    const c = sun.shadow.camera;
    c.left = -36; c.right = 36; c.top = 36; c.bottom = -36; c.near = 2; c.far = 60;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    s.add(sun, sun.target);
    this.sun = sun;
    for (const [x, z, col] of [[19, 19, 0xffa55c], [-19, 19, 0x6fb6ff], [19, -19, 0x6fb6ff], [-19, -19, 0xffa55c]] as const) {
      const l = new THREE.PointLight(col, 140, 36, 1.6);
      l.position.set(x, 6.5, z);
      s.add(l);
    }

    // Floating dust for depth
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * A * 2;
      pos[i * 3 + 1] = Math.random() * H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * A * 2;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9fb4c8, size: 0.05, map: makeRadialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), transparent: true, opacity: 0.4, depthWrite: false }));
    s.add(this.dust);
  }

  update(t: number) {
    this.dust.rotation.y = t * 0.012;
    this.dust.position.y = Math.sin(t * 0.2) * 0.25;
    const k = 0.75 + Math.sin(t * 2.4) * 0.25;
    this.pulse[0].color.setRGB(3.6 * k, 0.25 * k, 0.15 * k);
    const c = 0.9 + Math.sin(t * 5.1) * 0.06 + Math.sin(t * 13.7) * 0.04;
    this.pulse[1].color.setRGB(0.3 * c, 2.2 * c, 3.2 * c);
    this.coreLight.intensity = 60 * c;
  }
}
