import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CollisionWorld } from './physics';
import { makeHazardTexture, makeRadialTexture, makeSurface, type SurfaceMaps } from './textures';

export const ARENA = 30;
export const CEIL = 9;

export type ArenaId = 'reactor' | 'foundry' | 'vault' | 'yard' | 'frost';
/** Order used when the arena changes after each boss. */
export const ARENA_ORDER: ArenaId[] = ['reactor', 'foundry', 'vault', 'yard', 'frost'];
export const ARENAS: Record<ArenaId, { name: string; blurb: string }> = {
  reactor: { name: 'Reactor Hall', blurb: 'Open floor around the core. Long sightlines, scattered cover.' },
  foundry: { name: 'Foundry', blurb: 'Furnaces and conveyor lines around a molten crucible.' },
  vault: { name: 'Server Vault', blurb: 'Tight aisles between server racks. Close-quarters fighting.' },
  yard: { name: 'Rain Yard', blurb: 'Outdoors at night in the rain. Lanes between stacked containers.' },
  frost: { name: 'Frost Outpost', blurb: 'Outdoors in falling snow. Huts, snow banks and a radio mast.' },
};

interface Theme {
  floor: number; wall: number; trim: number; dark: number;
  stripA: [number, number, number]; stripB: [number, number, number]; core: [number, number, number]; panel: [number, number, number];
  fog: number; fogDensity: number; hemiSky: number; hemiGround: number; hemi: number; sun: number; sunI: number;
  corners: [number, number]; cornerI: number; coreLight: number; coreI: number; coreY: number;
  /** Outdoor arenas have no roof, a lower perimeter wall, a sky colour and weather. */
  outdoor?: boolean; sky?: number; weather?: 'rain' | 'snow'; floorRough?: number; env?: number;
}

const THEMES: Record<ArenaId, Theme> = {
  reactor: {
    floor: 0xffffff, wall: 0xffffff, trim: 0xb4bac2, dark: 0x4a4e57,
    stripA: [0.3, 2.2, 3.2], stripB: [3.4, 1.2, 0.25], core: [0.3, 2.2, 3.2], panel: [2.6, 2.7, 3.0],
    fog: 0x0a0e13, fogDensity: 0.014, hemiSky: 0x9db2cc, hemiGround: 0x3a332c, hemi: 1.0, sun: 0xdfe8ff, sunI: 1.5,
    corners: [0xffa55c, 0x6fb6ff], cornerI: 140, coreLight: 0x48c8ff, coreI: 60, coreY: 3.2,
  },
  foundry: {
    floor: 0xd9c8b8, wall: 0xc9b29c, trim: 0xa89684, dark: 0x4a3f38,
    stripA: [3.6, 1.1, 0.2], stripB: [3.2, 2.0, 0.5], core: [4.2, 1.3, 0.15], panel: [3.0, 2.3, 1.6],
    fog: 0x160d08, fogDensity: 0.019, hemiSky: 0xc9a988, hemiGround: 0x3a2618, hemi: 0.85, sun: 0xffd9b0, sunI: 1.25,
    corners: [0xff8a3c, 0xffb46a], cornerI: 150, coreLight: 0xff6a1a, coreI: 150, coreY: 4.2,
  },
  vault: {
    floor: 0xc4d2e0, wall: 0xb4c4d6, trim: 0xa9b6c4, dark: 0x343b46,
    stripA: [0.5, 2.6, 3.4], stripB: [0.4, 3.0, 1.2], core: [1.6, 2.6, 3.6], panel: [2.2, 2.9, 3.4],
    fog: 0x070c14, fogDensity: 0.021, hemiSky: 0x9cc0ea, hemiGround: 0x1c2630, hemi: 0.95, sun: 0xcfe4ff, sunI: 1.15,
    corners: [0x6fb6ff, 0x8fe0ff], cornerI: 120, coreLight: 0x9fdcff, coreI: 80, coreY: 3.4,
  },
  yard: {
    floor: 0x6f757d, wall: 0x9aa0a8, trim: 0xb4bac2, dark: 0x3a3e46,
    stripA: [3.4, 2.6, 1.2], stripB: [0.5, 2.2, 3.2], core: [3.2, 2.9, 2.2], panel: [2.6, 2.7, 3.0],
    fog: 0x0b1017, fogDensity: 0.024, hemiSky: 0x7f95b8, hemiGround: 0x20242a, hemi: 0.75, sun: 0xa9bfe8, sunI: 0.9,
    corners: [0xfff0d0, 0xdfe9ff], cornerI: 230, coreLight: 0xfff2d8, coreI: 130, coreY: 7,
    outdoor: true, sky: 0x0b1017, weather: 'rain', floorRough: 0.5, env: 0.5,
  },
  frost: {
    floor: 0xf4f7fb, wall: 0xc9d2dc, trim: 0xd9e0e8, dark: 0x4b535e,
    stripA: [3.4, 2.2, 0.8], stripB: [3.4, 2.2, 0.8], core: [4, 0.5, 0.3], panel: [2.6, 2.7, 3.0],
    // Kept dim on purpose: lit snow must stay below the bloom threshold (1.0) or it glows and washes out the view.
    fog: 0x8e9bab, fogDensity: 0.016, hemiSky: 0xb8c6d6, hemiGround: 0x5a6573, hemi: 0.75, sun: 0xfff1de, sunI: 1.25,
    corners: [0xfff2e0, 0xe6f0ff], cornerI: 45, coreLight: 0xff5a40, coreI: 40, coreY: 8,
    outdoor: true, sky: 0x8e9bab, weather: 'snow', env: 0.3,
  },
};

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
  sun: THREE.DirectionalLight;
  current: ArenaId | null = null;
  /** Everything that belongs to the loaded arena, so it can be swapped out. */
  private group = new THREE.Group();
  private dust: THREE.Points;
  private hemi: THREE.HemisphereLight;
  // The light count never changes between arenas; lights are only re-coloured and moved.
  private corners: THREE.PointLight[] = [];
  private coreLight: THREE.PointLight;
  private fog: THREE.FogExp2;
  private rain: THREE.LineSegments;
  private snowfall: THREE.Points;
  private fall: Float32Array;
  /** Current weather, for ambient audio. */
  weather: 'none' | 'rain' | 'snow' = 'none';
  private theme: Theme = THEMES.reactor;
  private m: {
    floor: THREE.MeshStandardMaterial; wall: THREE.MeshStandardMaterial; pillar: THREE.MeshStandardMaterial;
    crate: THREE.MeshStandardMaterial; crate2: THREE.MeshStandardMaterial; contA: THREE.MeshStandardMaterial; contB: THREE.MeshStandardMaterial;
    trim: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; hazard: THREE.MeshStandardMaterial; snow: THREE.MeshStandardMaterial; snowFloor: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial;
    stripA: THREE.MeshBasicMaterial; stripB: THREE.MeshBasicMaterial; red: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial; panel: THREE.MeshBasicMaterial;
  };

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;
    scene.background = new THREE.Color(0x06080b);
    this.fog = new THREE.FogExp2(0x0a0e13, 0.014);
    scene.fog = this.fog;
    pmrem.dispose();
    scene.add(this.group);

    const floorMaps = makeSurface({ seed: 11, color: [92, 96, 102], panels: 4, rivets: true, roughness: 0.5, wear: 1, bump: 5 });
    const wallMaps = makeSurface({ seed: 23, color: [104, 108, 112], panels: 2, stagger: true, ribs: 8, roughness: 0.62, wear: 0.9, bump: 5 });
    const crateMaps = makeSurface({ seed: 37, color: [128, 122, 108], panels: 1, frame: true, rivets: true, roughness: 0.58, wear: 1.2, bump: 6 });
    const plainMaps = makeSurface({ seed: 51, color: [70, 73, 78], panels: 0, roughness: 0.48, wear: 1.1, bump: 3 }, 256);
    const snowMaps = makeSurface({ seed: 71, color: [200, 207, 216], panels: 0, roughness: 0.95, wear: 0.3, bump: 3.5 }, 256);
    const asphaltMaps = makeSurface({ seed: 83, color: [62, 65, 70], panels: 0, roughness: 0.5, wear: 0.9, bump: 3 }, 256);
    const hazard = makeHazardTexture();
    hazard.repeat.set(3, 0.5);
    this.m = {
      floor: std(floorMaps, 0.6), wall: std(wallMaps, 0.4), pillar: std(wallMaps, 0.45, 0xa4aab2),
      crate: std(crateMaps, 0.3), crate2: std(crateMaps, 0.3, 0x6f8494),
      contA: std(wallMaps, 0.35, 0x9a4f39), contB: std(wallMaps, 0.35, 0x41647e),
      trim: std(plainMaps, 0.45, 0xb4bac2), dark: std(plainMaps, 0.4, 0x4a4e57), snow: std(snowMaps, 0.0), snowFloor: std(snowMaps, 0.0), asphalt: std(asphaltMaps, 0.35),
      hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }),
      stripA: glow(1, 1, 1), stripB: glow(1, 1, 1), red: glow(3.6, 0.25, 0.15), core: glow(1, 1, 1), panel: glow(1, 1, 1),
    };

    this.hemi = new THREE.HemisphereLight(0x9db2cc, 0x3a332c, 1.0);
    const sun = new THREE.DirectionalLight(0xdfe8ff, 1.5);
    sun.position.set(14, 34, 9);
    sun.castShadow = true;
    const c = sun.shadow.camera;
    c.left = -36; c.right = 36; c.top = 36; c.bottom = -36; c.near = 2; c.far = 60;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    scene.add(this.hemi, sun, sun.target);
    this.sun = sun;
    for (const [x, z] of [[19, 19], [-19, 19], [19, -19], [-19, -19]]) {
      const l = new THREE.PointLight(0xffffff, 140, 36, 1.6);
      l.position.set(x, 6.5, z);
      scene.add(l);
      this.corners.push(l);
    }
    this.coreLight = new THREE.PointLight(0x48c8ff, 60, 26, 1.8);
    scene.add(this.coreLight);

    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * ARENA * 2;
      pos[i * 3 + 1] = Math.random() * CEIL;
      pos[i * 3 + 2] = (Math.random() - 0.5) * ARENA * 2;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9fb4c8, size: 0.05, map: makeRadialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), transparent: true, opacity: 0.4, depthWrite: false }));
    scene.add(this.dust);

    // Weather: both systems always exist and follow the camera; only one is ever visible.
    const RAIN = 1100, SNOW = 1400;
    this.fall = new Float32Array(Math.max(RAIN, SNOW));
    const rp = new Float32Array(RAIN * 6);
    for (let i = 0; i < RAIN; i++) {
      const x = (Math.random() - 0.5) * 34, y = Math.random() * 16, z = (Math.random() - 0.5) * 34;
      rp.set([x, y, z, x + 0.03, y - 0.55, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaac4e6, transparent: true, opacity: 0.32, depthWrite: false }));
    const sp = new Float32Array(SNOW * 3);
    for (let i = 0; i < SNOW; i++) { sp[i * 3] = (Math.random() - 0.5) * 36; sp[i * 3 + 1] = Math.random() * 14; sp[i * 3 + 2] = (Math.random() - 0.5) * 36; this.fall[i] = 0.7 + Math.random() * 0.9; }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowfall = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, map: makeRadialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), transparent: true, opacity: 0.85, depthWrite: false }));
    for (const w of [this.rain, this.snowfall]) { w.frustumCulled = false; w.visible = false; scene.add(w); }
  }

  /** Swaps in an arena: geometry, collision boxes, spawn points and lighting mood. */
  load(id: ArenaId) {
    if (this.current === id) return;
    this.current = id;
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
    this.collision.boxes.length = 0;
    this.gates = []; this.vents = [];

    const t = this.theme = THEMES[id], m = this.m;
    m.floor.color.setHex(t.floor); m.wall.color.setHex(t.wall); m.trim.color.setHex(t.trim); m.dark.color.setHex(t.dark);
    m.stripA.color.setRGB(...t.stripA); m.stripB.color.setRGB(...t.stripB); m.panel.color.setRGB(...t.panel);
    m.asphalt.roughness = t.floorRough ?? 1;
    (this.scene.background as THREE.Color).setHex(t.sky ?? 0x06080b);
    this.scene.environmentIntensity = t.env ?? 0.42;
    this.weather = t.weather ?? 'none';
    this.rain.visible = t.weather === 'rain'; this.snowfall.visible = t.weather === 'snow';
    this.dust.visible = !t.outdoor;
    this.corners.forEach((l) => l.position.setY(t.outdoor ? 8.5 : 6.5));
    this.fog.color.setHex(t.fog); this.fog.density = t.fogDensity;
    this.hemi.color.setHex(t.hemiSky); this.hemi.groundColor.setHex(t.hemiGround); this.hemi.intensity = t.hemi;
    this.sun.color.setHex(t.sun); this.sun.intensity = t.sunI;
    this.corners.forEach((l, i) => { l.color.setHex(t.corners[i === 0 || i === 3 ? 0 : 1]); l.intensity = t.cornerI; });
    this.coreLight.color.setHex(t.coreLight); this.coreLight.position.set(0, t.coreY, 0);

    this.shell();
    if (id === 'reactor') this.buildReactor(); else if (id === 'foundry') this.buildFoundry(); else if (id === 'vault') this.buildVault();
    else if (id === 'yard') this.buildYard(); else this.buildFrost();
  }

  private box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material, o: BoxOpts = {}) {
    const mesh = new THREE.Mesh(scaledBox(sx, sy, sz, o.tex ?? 3), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = o.cast ?? true;
    mesh.receiveShadow = o.receive ?? true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    if (o.collide ?? true) this.collision.add(cx, cy, cz, sx, sy, sz);
    return mesh;
  }

  /** Non-colliding decorative mesh. */
  private deco(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast; mesh.receiveShadow = cast;
    this.group.add(mesh);
    return mesh;
  }

  /** Glowing strip with no collision or shadows. */
  private lamp(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material) {
    return this.box(cx, cy, cz, sx, sy, sz, mat, { collide: false, cast: false, receive: false });
  }

  /** Low cover wall with a dark cap. */
  private barrier(x: number, z: number, sx: number, sz: number) {
    this.box(x, 0.6, z, sx, 1.2, sz, this.m.trim, { tex: 2 });
    this.box(x, 1.23, z, sx + 0.1, 0.08, sz + 0.1, this.m.dark, { collide: false });
  }

  /** Floor, walls, ceiling, wall fixtures and the four spawn gates shared by every arena. */
  private shell() {
    const A = ARENA, m = this.m, out = !!this.theme.outdoor, H = out ? 5 : CEIL;
    const floor = this.theme.weather === 'snow' ? m.snowFloor : this.theme.weather === 'rain' ? m.asphalt : m.floor;
    this.box(0, -0.5, 0, A * 2, 1, A * 2, floor, { cast: false, tex: 4 });
    // Outdoors the "ceiling" is only an invisible lid so thrown grenades and the boss stay in bounds.
    if (out) this.collision.add(0, 14.5, 0, A * 2 + 2, 1, A * 2 + 2);
    else this.box(0, CEIL + 0.5, 0, A * 2 + 2, 1, A * 2 + 2, m.dark, { cast: false, receive: false });
    this.box(0, H / 2, -A - 0.5, A * 2 + 2, H, 1, m.wall, { cast: false, tex: 6 });
    this.box(0, H / 2, A + 0.5, A * 2 + 2, H, 1, m.wall, { cast: false, tex: 6 });
    this.box(-A - 0.5, H / 2, 0, 1, H, A * 2, m.wall, { cast: false, tex: 6 });
    this.box(A + 0.5, H / 2, 0, 1, H, A * 2, m.wall, { cast: false, tex: 6 });
    if (out) {
      // Keep the collision wall full height so nothing leaves over the top, and cap it with a rail.
      for (const [x, z, sx, sz] of [[0, -A - 0.5, A * 2 + 2, 1], [0, A + 0.5, A * 2 + 2, 1], [-A - 0.5, 0, 1, A * 2], [A + 0.5, 0, 1, A * 2]]) {
        this.collision.add(x, 9.5, z, sx, 9, sz);
        this.box(x, H + 0.12, z, sx + 0.3, 0.24, sz + 0.3, m.dark, { collide: false, cast: false });
      }
      // Floodlight towers in the corners, under the corner lights.
      for (const qx of [1, -1]) for (const qz of [1, -1]) {
        this.box(26.5 * qx, 4.5, 26.5 * qz, 0.4, 9, 0.4, m.dark, { tex: 1 });
        this.lamp(26.2 * qx, 8.9, 26.2 * qz, 1.5, 0.5, 1.5, m.panel);
      }
    } else {
      for (let i = -2; i <= 2; i++) {
        this.box(i * 12, CEIL - 0.45, 0, 0.6, 0.9, A * 2, m.dark, { collide: false, cast: false });
        this.box(0, CEIL - 0.75, i * 12, A * 2, 0.3, 0.4, m.dark, { collide: false, cast: false });
      }
      for (let x = -18; x <= 18; x += 12) for (let z = -18; z <= 18; z += 12) {
        this.lamp(x, CEIL - 0.06, z, 3.2, 0.1, 1.1, m.panel);
        this.lamp(x, CEIL - 0.12, z, 3.6, 0.22, 1.5, m.dark);
      }
    }

    const pipeGeo = new THREE.CylinderGeometry(0.16, 0.16, A * 2, 10);
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) {
      const along = ax === 0;
      const p = (A - 0.12) * sgn;
      const place = (y: number, t: number, h: number, mat: THREE.Material) =>
        along ? this.box(0, y, p, A * 2, h, t, mat, { collide: false, cast: false }) : this.box(p, y, 0, t, h, A * 2, mat, { collide: false, cast: false });
      place(0.25, 0.3, 0.5, m.trim);
      place(4.6, 0.26, 0.5, m.trim);
      for (const [y, off] of (out ? [] : [[6.3, 0.35], [6.8, 0.3], [7.5, 0.4]]) as [number, number][]) {
        const q = (A - off) * sgn;
        const pipe = this.deco(pipeGeo, y === 6.8 ? m.contA : m.trim, along ? 0 : q, y, along ? q : 0, false);
        pipe.rotation.z = Math.PI / 2;
        if (!along) pipe.rotation.y = Math.PI / 2;
      }
      for (let k = -4; k <= 4; k++) {
        if (k === 0) continue;
        const c = k * 6.2, mat = Math.abs(k) % 2 ? m.stripA : m.stripB;
        if (along) this.lamp(c, 4.6, (A - 0.28) * sgn, 2.4, 0.09, 0.06, mat);
        else this.lamp((A - 0.28) * sgn, 4.6, c, 0.06, 0.09, 2.4, mat);
      }
      // Spawn gate
      const gx = along ? 0 : (A - 0.2) * sgn, gz = along ? (A - 0.2) * sgn : 0;
      const w = (a: number, b: number): [number, number] => (along ? [a, b] : [b, a]);
      const [fx, fz] = w(5.6, 0.5);
      this.box(gx, 3.9, gz, fx, 0.5, fz, m.trim, { collide: false, cast: false });
      for (const side of [-1, 1]) {
        const [ox, oz] = w(2.8 * side, 0);
        this.box(gx + ox, 1.95, gz + oz, 0.5, 3.9, 0.5, m.trim, { collide: false, cast: false });
      }
      const [dx, dz] = w(5.1, 0.2);
      this.box(gx, 1.85, gz, dx, 3.7, dz, m.dark, { collide: false, cast: false });
      const [lx, lz] = w(4.6, 0.12);
      const inward = along ? [0, -0.3 * sgn] : [-0.3 * sgn, 0];
      this.lamp(gx + inward[0], 3.55, gz + inward[1], lx, 0.1, lz, m.red);
      const gate = {
        pos: new THREE.Vector3(along ? 0 : (A - 2) * sgn, 0, along ? (A - 2) * sgn : 0),
        dir: new THREE.Vector3(along ? 0 : -sgn, 0, along ? -sgn : 0),
      };
      this.gates.push(gate);
      const haz = this.deco(new THREE.PlaneGeometry(6, 1), m.hazard, 0, 0, 0, false);
      haz.rotation.x = -Math.PI / 2;
      if (gate.dir.x !== 0) haz.rotation.z = Math.PI / 2;
      haz.position.copy(gate.pos).addScaledVector(gate.dir, 2.2).setY(0.012);
      haz.receiveShadow = true;
    }
  }

  private pillar(px: number, pz: number, strip: THREE.Material) {
    const H = CEIL, m = this.m;
    this.box(px, H / 2, pz, 2.4, H, 2.4, m.pillar, { tex: 2.4 });
    this.box(px, 0.3, pz, 2.9, 0.6, 2.9, m.trim, { collide: false });
    this.box(px, H - 0.5, pz, 2.9, 1, 2.9, m.trim, { collide: false, cast: false });
    this.collision.add(px, 0.3, pz, 2.9, 0.6, 2.9);
    for (const [ox, oz] of [[1.22, 0], [-1.22, 0], [0, 1.22], [0, -1.22]])
      this.lamp(px + ox, 3.6, pz + oz, ox ? 0.05 : 0.14, 4.2, oz ? 0.05 : 0.14, strip);
  }

  private buildReactor() {
    const H = CEIL, m = this.m;
    this.box(0, 0.5, 0, 3.4, 1, 3.4, m.trim);
    this.box(0, 1.1, 0, 2.6, 0.2, 2.6, m.dark);
    this.collision.add(0, H / 2, 0, 1.5, H, 1.5);
    this.deco(new THREE.CylinderGeometry(0.42, 0.42, H - 1.2, 20), m.core, 0, (H + 1.2) / 2, 0, false);
    const cage = new THREE.CylinderGeometry(0.06, 0.06, H - 1.2, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.deco(cage, m.dark, Math.cos(a) * 0.7, (H + 1.2) / 2, Math.sin(a) * 0.7);
    }
    for (const y of [2.6, 4.6, 6.6]) this.deco(new THREE.CylinderGeometry(0.85, 0.85, 0.22, 20), m.trim, 0, y, 0);

    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      this.pillar(13 * qx, 13 * qz, m.stripB);
      this.box(24 * qx, 1.3, 14 * qz, 2.6, 2.6, 6.2, qx * qz > 0 ? m.contA : m.contB, { tex: 2.6 });
      this.box(14 * qx, 1.3, 24.5 * qz, 6.2, 2.6, 2.6, qx * qz > 0 ? m.contB : m.contA, { tex: 2.6 });
      this.box(20.5 * qx, 1, 21 * qz, 2, 2, 2, m.crate, { tex: 2 });
      this.box(22.4 * qx, 0.6, 20.2 * qz, 1.2, 1.2, 1.2, m.crate2, { tex: 1.2 });
      this.box(20.5 * qx, 2.5, 21 * qz, 1, 1, 1, m.crate2, { tex: 1 });
      this.box(6.5 * qx, 0.6, 19 * qz, 1.2, 1.2, 1.2, m.crate, { tex: 1.2 });
      this.box(7.9 * qx, 0.5, 19.3 * qz, 1, 1, 1, m.crate2, { tex: 1 });
      this.box(19 * qx, 0.75, 5.5 * qz, 1.5, 1.5, 1.5, m.crate, { tex: 1.5 });
      this.barrier(7 * qx, 6.5 * qz, 0.5, 4.5);
      this.vents.push(new THREE.Vector3(13.2 * qx, H - 1.6, 13.2 * qz));
    }
    for (const sgn of [1, -1]) { this.barrier(0, 12 * sgn, 5, 0.5); this.barrier(18 * sgn, 0, 0.5, 5); }
  }

  private buildFoundry() {
    const H = CEIL, m = this.m;
    // Central crucible of molten metal
    this.collision.add(0, 1.1, 0, 4.6, 2.2, 4.6);
    this.deco(new THREE.CylinderGeometry(2.7, 2.3, 2.2, 8), m.dark, 0, 1.1, 0).rotation.y = Math.PI / 8;
    this.deco(new THREE.CylinderGeometry(2.9, 2.9, 0.25, 8), m.trim, 0, 2.15, 0).rotation.y = Math.PI / 8;
    this.deco(new THREE.CylinderGeometry(2.35, 2.35, 0.06, 24), m.core, 0, 2.27, 0, false);
    // Gantry crane over the crucible
    this.box(0, 7.1, 0, 30, 0.7, 0.9, m.contA, { collide: false, cast: false });
    this.box(0, 6.3, 0, 1.6, 0.9, 1.6, m.dark, { collide: false, cast: false });
    this.deco(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), m.dark, 0, 4.8, 0, false);
    this.deco(new THREE.TorusGeometry(0.28, 0.07, 6, 12, Math.PI * 1.4), m.trim, 0, 3.55, 0, false);
    // Glowing channels fed from the crucible (visual only)
    for (const s of [1, -1]) {
      this.lamp(s * 9.5, 0.012, 0, 14, 0.02, 0.5, m.core);
      this.box(s * 9.5, 0.06, 0.42, 14, 0.12, 0.2, m.dark, { collide: false, cast: false });
      this.box(s * 9.5, 0.06, -0.42, 14, 0.12, 0.2, m.dark, { collide: false, cast: false });
    }
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      // Furnace with a glowing mouth and a stack to the ceiling
      const fx = 15.5 * qx, fz = 21 * qz;
      this.box(fx, 2, fz, 5, 4, 4, m.wall, { tex: 4 });
      this.box(fx, 4.15, fz, 5.4, 0.3, 4.4, m.dark, { collide: false });
      this.box(fx, 6.6, fz + 0.6 * qz, 1.6, 4.8, 1.6, m.dark, { tex: 1.6 });
      this.lamp(fx, 1.3, fz - 2.03 * qz, 2.2, 1.4, 0.08, m.core);
      this.box(fx, 2.2, fz - 2.06 * qz, 2.8, 0.3, 0.16, m.trim, { collide: false, cast: false });
      for (const o of [-1.25, 1.25]) this.box(fx + o, 1.25, fz - 2.06 * qz, 0.3, 1.9, 0.16, m.trim, { collide: false, cast: false });
      // Conveyor line with a gap in the middle of the hall
      this.box(9 * qx, 0.5, 12 * qz, 10, 1.0, 1.6, m.trim, { tex: 2 });
      this.box(9 * qx, 1.03, 12 * qz, 10, 0.06, 1.2, m.dark, { collide: false });
      this.box(9.5 * qx, 1.3, 12 * qz, 1.6, 0.5, 0.9, m.crate, { tex: 1 });
      // Ingot stacks and crates
      this.box(8 * qx, 0.4, 6 * qz, 2.4, 0.8, 1.4, m.contA, { tex: 1.2 });
      this.box(8 * qx, 1.0, 6 * qz, 1.6, 0.4, 1.0, m.contA, { tex: 1.2 });
      this.box(22.5 * qx, 0.75, 7 * qz, 1.5, 1.5, 1.5, m.crate, { tex: 1.5 });
      this.box(24 * qx, 0.5, 8.4 * qz, 1, 1, 1, m.crate2, { tex: 1 });
      this.box(4.5 * qx, 0.6, 22 * qz, 1.2, 1.2, 1.2, m.crate, { tex: 1.2 });
      this.pillar(23.5 * qx, 13.5 * qz, m.stripA);
      this.vents.push(new THREE.Vector3(11 * qx, H - 1.6, 6 * qz));
    }
    for (const s of [1, -1]) this.barrier(17 * s, 0, 0.5, 6);
  }

  private buildVault() {
    const H = CEIL, m = this.m;
    // Data core
    this.box(0, 0.4, 0, 3, 0.8, 3, m.trim);
    this.collision.add(0, H / 2, 0, 1.6, H, 1.6);
    this.deco(new THREE.CylinderGeometry(0.75, 0.75, H - 0.8, 6), m.dark, 0, (H + 0.8) / 2, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      this.deco(new THREE.BoxGeometry(0.1, H - 1.2, 0.36), m.core, Math.cos(a) * 0.68, (H + 0.8) / 2, Math.sin(a) * 0.68, false).rotation.y = -a;
    }
    // Server racks in rows, leaving a cross of corridors
    for (const x of [-16, -11, -6, 6, 11, 16]) for (const z of [-19, -8, 8, 19]) {
      this.box(x, 1.6, z, 1.2, 3.2, 7, m.dark, { tex: 1.6 });
      this.box(x, 3.26, z, 1.3, 0.12, 7.1, m.trim, { collide: false });
      for (const side of [-1, 1]) {
        for (const [y, mat, len] of [[0.9, m.stripA, 6.2], [1.7, m.stripB, 4.6], [2.5, m.stripA, 6.2]] as const)
          this.lamp(x + 0.61 * side, y, z + (y === 1.7 ? 0.6 * side : 0), 0.03, 0.05, len, mat);
      }
    }
    // Overhead cable trays
    for (const z of [-13.5, 13.5]) this.box(0, 7.6, z, 40, 0.2, 1.2, m.dark, { collide: false, cast: false });
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      // Cooling units in the corners
      this.box(24.5 * qx, 1.2, 25 * qz, 3.4, 2.4, 3, m.wall, { tex: 3 });
      this.lamp(24.5 * qx, 1.3, (25 - 1.53) * qz, 2.4, 0.9, 0.06, m.stripA);
      this.box(23.5 * qx, 0.6, 3.6 * qz, 1.2, 1.2, 1.2, m.crate2, { tex: 1.2 });
      this.barrier(22.5 * qx, 13.5 * qz, 3.5, 0.5);
      this.vents.push(new THREE.Vector3(8.5 * qx, H - 1.6, 13.5 * qz));
    }
    for (const s of [1, -1]) this.barrier(0, 13.5 * s, 4, 0.5);
  }

  /** Stacks of shipping containers forming lanes, a parked hauler in the middle. */
  private buildYard() {
    const m = this.m;
    const container = (x: number, z: number, alongX: boolean, mat: THREE.Material, stack = 1) => {
      for (let i = 0; i < stack; i++) {
        this.box(x, 1.3 + i * 2.6, z, alongX ? 6.2 : 2.6, 2.6, alongX ? 2.6 : 6.2, mat, { tex: 2.6 });
        this.lamp(x + (alongX ? 0 : 1.31), 2.3 + i * 2.6, z + (alongX ? 1.31 : 0), alongX ? 0.5 : 0.03, 0.08, alongX ? 0.03 : 0.5, m.stripA);
      }
    };
    // Hauler: cab and trailer
    this.box(0, 1.5, -1.6, 2.6, 2.4, 6.6, m.contB, { tex: 2.6 });
    this.box(0, 0.25, -1.6, 2.4, 0.5, 7.0, m.dark, { collide: false });
    this.box(0, 1.35, 3.2, 2.5, 2.3, 2.4, m.trim, { tex: 2 });
    this.lamp(0, 1.75, 4.42, 2.0, 0.5, 0.04, m.core);
    for (const s of [1, -1]) this.lamp(0.9 * s, 0.7, 4.42, 0.4, 0.2, 0.04, m.panel);
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      container(11 * qx, 9 * qz, false, qx * qz > 0 ? m.contA : m.contB, 2);
      container(11 * qx, 19.5 * qz, true, qx * qz > 0 ? m.contB : m.contA);
      container(21 * qx, 12 * qz, false, m.contA);
      container(21.5 * qx, 22.5 * qz, true, m.contB, 2);
      this.box(16 * qx, 0.75, 4.5 * qz, 1.5, 1.5, 1.5, m.crate, { tex: 1.5 });
      this.box(17.4 * qx, 0.5, 5.2 * qz, 1, 1, 1, m.crate2, { tex: 1 });
      this.box(5 * qx, 0.6, 22 * qz, 1.2, 1.2, 1.2, m.crate, { tex: 1.2 });
      this.barrier(5.5 * qx, 11.5 * qz, 3.5, 0.6);
      this.vents.push(new THREE.Vector3(15 * qx, 9, 15 * qz));
    }
    for (const s of [1, -1]) { this.barrier(17 * s, 0, 0.6, 5); this.barrier(0, 15 * s, 4.5, 0.6); }
  }

  /** Snowed-in outpost: prefab huts, fuel tanks, snow banks and a radio mast. */
  private buildFrost() {
    const m = this.m;
    // Radio mast with a red beacon
    this.box(0, 0.4, 0, 2.6, 0.8, 2.6, m.dark);
    this.collision.add(0, 6, 0, 1, 12, 1);
    for (const [x, z] of [[0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]]) this.deco(new THREE.BoxGeometry(0.1, 11, 0.1), m.dark, x, 6.3, z);
    for (let y = 2; y <= 11; y += 1.5) this.deco(new THREE.BoxGeometry(1.05, 0.08, 1.05), m.dark, 0, y, 0);
    this.deco(new THREE.SphereGeometry(0.22, 10, 8), m.core, 0, 12, 0, false);
    this.box(0, 0.86, 0, 2.9, 0.14, 2.9, m.snow, { collide: false });
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      // Prefab hut with lit windows and a snow-covered roof
      const hx = 15 * qx, hz = 16 * qz;
      this.box(hx, 1.5, hz, 6, 3, 4.4, qx * qz > 0 ? m.contB : m.contA, { tex: 3 });
      this.box(hx, 3.16, hz, 6.4, 0.32, 4.8, m.snow, { collide: false });
      for (const o of [-1.6, 1.6]) this.lamp(hx + o, 1.9, hz - 2.22 * qz, 1.2, 0.7, 0.05, m.stripA);
      this.box(hx, 1.05, hz - 2.24 * qz, 1.0, 2.1, 0.08, m.dark, { collide: false, cast: false });
      // Fuel tank
      this.collision.add(24 * qx, 1.1, 6 * qz, 2.2, 2.2, 4.4);
      const tank = this.deco(new THREE.CylinderGeometry(1.1, 1.1, 4.4, 16), m.trim, 24 * qx, 1.2, 6 * qz);
      tank.rotation.x = Math.PI / 2;
      this.box(24 * qx, 0.15, 6 * qz, 1.6, 0.3, 3.6, m.dark, { collide: false });
      // Snow banks as low cover, and supply crates
      this.box(7 * qx, 0.5, 8 * qz, 4.5, 1.0, 1.5, m.snow, { tex: 2 });
      this.box(7 * qx, 1.05, 8 * qz, 3.4, 0.3, 1.0, m.snow, { collide: false });
      this.box(22 * qx, 0.55, 22.5 * qz, 5, 1.1, 1.6, m.snow, { tex: 2 });
      this.box(5 * qx, 0.6, 21 * qz, 1.2, 1.2, 1.2, m.crate, { tex: 1.2 });
      this.box(5 * qx, 1.27, 21 * qz, 1.26, 0.14, 1.26, m.snow, { collide: false });
      this.box(18 * qx, 0.75, 4 * qz, 1.5, 1.5, 1.5, m.crate2, { tex: 1.5 });
      this.box(18 * qx, 1.57, 4 * qz, 1.56, 0.14, 1.56, m.snow, { collide: false });
      this.vents.push(new THREE.Vector3(12 * qx, 9, 9 * qz));
    }
    for (const s of [1, -1]) {
      this.box(0, 0.5, 14 * s, 5, 1.0, 1.5, m.snow, { tex: 2 });
      this.box(15.5 * s, 0.5, 0, 1.5, 1.0, 5, m.snow, { tex: 2 });
    }
  }

  update(t: number, dt = 0, cam?: THREE.Vector3) {
    if (cam && this.rain.visible) {
      const p = this.rain.geometry.attributes.position as THREE.BufferAttribute, a = p.array as Float32Array, d = 26 * dt;
      for (let i = 1; i < a.length; i += 6) {
        a[i] -= d; a[i + 3] -= d;
        if (a[i + 3] < 0) { a[i] += 16; a[i + 3] += 16; }
      }
      p.needsUpdate = true;
      // Keep the rain volume centred on the player without visible popping.
      this.rain.position.set(Math.round(cam.x), 0, Math.round(cam.z));
    }
    if (cam && this.snowfall.visible) {
      const p = this.snowfall.geometry.attributes.position as THREE.BufferAttribute, a = p.array as Float32Array;
      for (let i = 0, n = a.length / 3; i < n; i++) {
        a[i * 3 + 1] -= this.fall[i] * 1.6 * dt;
        a[i * 3] += Math.sin(t * 0.9 + i) * 0.35 * dt;
        if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 14;
      }
      p.needsUpdate = true;
      this.snowfall.position.set(Math.round(cam.x), 0, Math.round(cam.z));
    }

    this.dust.rotation.y = t * 0.012;
    this.dust.position.y = Math.sin(t * 0.2) * 0.25;
    const k = 0.75 + Math.sin(t * 2.4) * 0.25;
    this.m.red.color.setRGB(3.6 * k, 0.25 * k, 0.15 * k);
    const c = 0.9 + Math.sin(t * 5.1) * 0.06 + Math.sin(t * 13.7) * 0.04, b = this.theme.core;
    this.m.core.color.setRGB(b[0] * c, b[1] * c, b[2] * c);
    this.coreLight.intensity = this.theme.coreI * c;
  }
}
