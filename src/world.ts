import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld } from './physics';
import { makeHazardTexture, makeMacroTexture, makeRadialTexture, makeSignTexture, makeStainTexture, makeSurface, type SurfaceMaps } from './textures';

export const ARENA = 30;
export const CEIL = 9;

export type ArenaId = 'reactor' | 'foundry' | 'vault' | 'yard' | 'frost' | 'city' | 'beach';
/** Order used when the arena changes after each boss. */
export const ARENA_ORDER: ArenaId[] = ['reactor', 'foundry', 'vault', 'yard', 'frost', 'city', 'beach'];
/** Half the side of a big free-roam map, against ARENA (30) for the others. */
export const BIG = 90;
const BIG_ARENAS: ArenaId[] = ['city', 'beach'];
export const ARENAS: Record<ArenaId, { name: string; blurb: string }> = {
  reactor: { name: 'Reactor Hall', blurb: 'Open floor around the core, with a raised gallery in each corner. Long sightlines.' },
  foundry: { name: 'Foundry', blurb: 'Furnaces and conveyor lines around a molten crucible, with a bridge across the top.' },
  vault: { name: 'Server Vault', blurb: 'Tight aisles between server racks, and catwalks along their tops.' },
  yard: { name: 'Rain Yard', blurb: 'Outdoors at night in the rain. Three levels: container lanes, catwalks, and bridges across the stacks.' },
  frost: { name: 'Frost Outpost', blurb: 'Outdoors in falling snow. Hut roofs joined by bridges, and a lookout up the radio mast.' },
  city: { name: 'City', blurb: 'Big map, free to roam: a plaza, a market street, a construction site, a car park and tenement alleys.' },
  beach: { name: 'Beach Invasion', blurb: 'Big map, free to roam: surf and landing craft, a pier, lighthouse point, bunkers, a gun battery and a village.' },
};

/** Colour grade applied after bloom. Tints are multipliers for dark and bright areas. */
export interface Grade { shadows: [number, number, number]; highlights: [number, number, number]; saturation: number; contrast: number; vignette: number; }
const NEUTRAL: Grade = { shadows: [1, 1, 1], highlights: [1, 1, 1], saturation: 1, contrast: 1, vignette: 0 };

interface Theme {
  floor: number; wall: number; trim: number; dark: number;
  stripA: [number, number, number]; stripB: [number, number, number]; core: [number, number, number]; panel: [number, number, number];
  fog: number; fogDensity: number; hemiSky: number; hemiGround: number; hemi: number; sun: number; sunI: number;
  corners: [number, number]; cornerI: number; coreLight: number; coreI: number; coreY: number;
  /** Outdoor arenas have no roof, a lower perimeter wall, a sky colour and weather. */
  outdoor?: boolean; sky?: number; weather?: 'rain' | 'snow'; floorRough?: number; env?: number;
  /** Tint of the soft ground material (snow by default; sand on the beach). */
  ground?: number;
  /** Reflections come from a room built out of this theme's own lamp colours instead of the neutral studio. */
  ownEnv?: boolean; grade?: Grade;
  /** Tint of the drifting dust motes indoors. */
  dust?: number;
  /** Outdoor sky dome: colour overhead and at the horizon. */
  skyTop?: number; skyHorizon?: number;
  /** Height of an outdoor arena's perimeter wall (default 5); raise it where upper levels would see over. */
  wallH?: number;
}

const THEMES: Record<ArenaId, Theme> = {
  reactor: {
    floor: 0xffffff, wall: 0xffffff, trim: 0xb4bac2, dark: 0x4a4e57,
    stripA: [0.3, 2.2, 3.2], stripB: [3.4, 1.2, 0.25], core: [0.3, 2.2, 3.2], panel: [2.6, 2.7, 3.0],
    fog: 0x070b12, fogDensity: 0.021, hemiSky: 0x8aa4c8, hemiGround: 0x2a2420, hemi: 0.42, sun: 0xcfe0ff, sunI: 0.95,
    corners: [0xff9a4a, 0x4fa8ff], cornerI: 230, coreLight: 0x48c8ff, coreI: 150, coreY: 3.2,
    ownEnv: true, env: 0.75,
    grade: { shadows: [0.86, 0.98, 1.12], highlights: [1.06, 1.0, 0.93], saturation: 1.08, contrast: 1.06, vignette: 0.24 },
  },
  foundry: {
    floor: 0xd9c8b8, wall: 0xc9b29c, trim: 0xa89684, dark: 0x4a3f38,
    stripA: [3.6, 1.1, 0.2], stripB: [3.2, 2.0, 0.5], core: [4.2, 1.3, 0.15], panel: [3.0, 2.3, 1.6],
    fog: 0x140b06, fogDensity: 0.023, hemiSky: 0xc9a988, hemiGround: 0x3a2618, hemi: 0.4, sun: 0xffd9b0, sunI: 0.85,
    corners: [0xff8a3c, 0xffb46a], cornerI: 230, coreLight: 0xff6a1a, coreI: 220, coreY: 4.2,
    ownEnv: true, env: 0.7, dust: 0xffb070,
    grade: { shadows: [0.92, 0.97, 1.08], highlights: [1.1, 1.0, 0.86], saturation: 1.1, contrast: 1.07, vignette: 0.26 },
  },
  vault: {
    floor: 0xc4d2e0, wall: 0xb4c4d6, trim: 0xa9b6c4, dark: 0x343b46,
    stripA: [0.5, 2.6, 3.4], stripB: [0.4, 3.0, 1.2], core: [1.6, 2.6, 3.6], panel: [2.2, 2.9, 3.4],
    fog: 0x060a12, fogDensity: 0.024, hemiSky: 0x9cc0ea, hemiGround: 0x1c2630, hemi: 0.42, sun: 0xcfe4ff, sunI: 0.85,
    corners: [0x6fb6ff, 0x8fe0ff], cornerI: 200, coreLight: 0x9fdcff, coreI: 140, coreY: 3.4,
    ownEnv: true, env: 0.75,
    grade: { shadows: [0.84, 0.96, 1.14], highlights: [0.98, 1.0, 1.05], saturation: 1.05, contrast: 1.07, vignette: 0.26 },
  },
  yard: {
    floor: 0x6f757d, wall: 0x9aa0a8, trim: 0xb4bac2, dark: 0x3a3e46,
    stripA: [3.4, 2.6, 1.2], stripB: [0.5, 2.2, 3.2], core: [3.2, 2.9, 2.2], panel: [2.6, 2.7, 3.0],
    fog: 0x0b1017, fogDensity: 0.024, hemiSky: 0x7f95b8, hemiGround: 0x20242a, hemi: 0.7, sun: 0xa9bfe8, sunI: 1.05,
    corners: [0xfff0d0, 0xdfe9ff], cornerI: 230, coreLight: 0xfff2d8, coreI: 130, coreY: 7,
    outdoor: true, sky: 0x0b1017, weather: 'rain', floorRough: 0.5, env: 0.85, wallH: 9,
    ownEnv: true, skyTop: 0x04060a, skyHorizon: 0x303b4b,
    grade: { shadows: [0.86, 0.97, 1.1], highlights: [1.05, 1.0, 0.94], saturation: 0.95, contrast: 1.08, vignette: 0.28 },
  },
  beach: {
    // Overcast dawn over the sea. Sand is kept mid-toned so it stays under the bloom threshold.
    floor: 0x8a8d92, wall: 0x9c9b93, trim: 0xa3956c, dark: 0x3a3d40,
    stripA: [1.6, 1.2, 0.6], stripB: [0.6, 1.6, 2.2], core: [3.2, 2.6, 1.4], panel: [1.6, 1.5, 1.3],
    fog: 0x9aa4ab, fogDensity: 0.0095, hemiSky: 0xc4d0da, hemiGround: 0x8f8266, hemi: 1.3, sun: 0xfff0dc, sunI: 1.35,
    corners: [0xfff2e0, 0xe6f0ff], cornerI: 30, coreLight: 0xfff2d8, coreI: 20, coreY: 6,
    outdoor: true, sky: 0x9aa4ab, floorRough: 0.9, env: 0.45, skyTop: 0x5d6c7c, skyHorizon: 0xcfc8b6, ground: 0xb7a274,
    grade: { shadows: [0.92, 0.98, 1.06], highlights: [1.04, 1.0, 0.95], saturation: 0.9, contrast: 1.06, vignette: 0.22 },
  },
  city: {
    // Dusk: a low warm sun, cool sky light and lit windows.
    floor: 0x8a8d92, wall: 0xb9b2a6, trim: 0x9d978e, dark: 0x3d4048,
    stripA: [1.5, 1.0, 0.45], stripB: [0.5, 1.5, 2.2], core: [3.0, 1.3, 0.45], panel: [1.5, 1.4, 1.15],
    fog: 0x5b5670, fogDensity: 0.0075, hemiSky: 0x93a3dc, hemiGround: 0x4a3c34, hemi: 1.15, sun: 0xffb478, sunI: 2.1,
    corners: [0xffd9a0, 0xffe8c8], cornerI: 120, coreLight: 0xffc890, coreI: 90, coreY: 6,
    outdoor: true, sky: 0x5b5670, floorRough: 0.9, env: 0.6, skyTop: 0x1a2140, skyHorizon: 0xe08a55,
    grade: { shadows: [0.9, 0.94, 1.1], highlights: [1.08, 1.0, 0.9], saturation: 1.05, contrast: 1.06, vignette: 0.24 },
  },
  frost: {
    floor: 0xf4f7fb, wall: 0xc9d2dc, trim: 0xd9e0e8, dark: 0x4b535e,
    stripA: [3.4, 2.2, 0.8], stripB: [3.4, 2.2, 0.8], core: [4, 0.5, 0.3], panel: [2.6, 2.7, 3.0],
    // Kept dim on purpose: lit snow must stay below the bloom threshold (1.0) or it glows and washes out the view.
    fog: 0x8e9bab, fogDensity: 0.016, hemiSky: 0xb8c6d6, hemiGround: 0x5a6573, hemi: 0.75, sun: 0xfff1de, sunI: 1.25,
    corners: [0xfff2e0, 0xe6f0ff], cornerI: 45, coreLight: 0xff5a40, coreI: 40, coreY: 8,
    outdoor: true, sky: 0x8e9bab, weather: 'snow', env: 0.3, wallH: 9, skyTop: 0x737f8e, skyHorizon: 0xa3aebb,
    grade: { shadows: [0.92, 0.98, 1.08], highlights: [1.0, 1.0, 1.0], saturation: 0.92, contrast: 1.06, vignette: 0.18 },
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

/** Box with rounded edges (so they catch a highlight) and the same real-size UVs as `scaledBox`. */
function bevelBox(sx: number, sy: number, sz: number, texSize: number, r: number): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(sx, sy, sz, 1, r);
  const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute, per = pos.count / 6;
  for (let i = 0; i < pos.count; i++) {
    const f = Math.floor(i / per), x = pos.getX(i) + sx / 2, y = pos.getY(i) + sy / 2, z = pos.getZ(i) + sz / 2;
    if (f < 2) uv.setXY(i, z / texSize, y / texSize); else if (f < 4) uv.setXY(i, x / texSize, z / texSize); else uv.setXY(i, x / texSize, y / texSize);
  }
  return g;
}

/**
 * Patches a standard material so large surfaces stop looking tiled: world-space noise varies colour and
 * roughness over several metres, and vertical faces darken toward the floor like settled grime.
 */
/** Colour of the light pools under the ceiling lamps; black in arenas without them. Shared by every weathered material. */
const poolColor = { value: new THREE.Color(0, 0, 0) };

function weather(mat: THREE.MeshStandardMaterial, tex: THREE.Texture): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (s) => {
    s.uniforms.macroMap = { value: tex };
    s.uniforms.poolColor = poolColor;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroP;\nvarying vec3 vMacroN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvMacroN = mat3(modelMatrix) * objectNormal;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D macroMap;\nuniform vec3 poolColor;\nvarying vec3 vMacroP;\nvarying vec3 vMacroN;\nfloat macroV;\nvec3 macroPool;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 an = abs(vMacroN);
          vec2 muv = an.y > 0.6 ? vMacroP.xz : (an.x > an.z ? vMacroP.zy : vMacroP.xy);
          macroV = texture2D(macroMap, muv * 0.043).r * 0.65 + texture2D(macroMap, muv * 0.19 + 0.37).g * 0.35;
          diffuseColor.rgb *= mix(0.55, 1.12, smoothstep(0.3, 0.7, macroV));
          if (an.y <= 0.6) diffuseColor.rgb *= 0.58 + 0.42 * smoothstep(0.0, 1.5, vMacroP.y);
          // Pools of light under the ceiling lamps (a 12 m grid), on anything facing up below them.
          vec2 pq = mod(vMacroP.xz + 24.0, 12.0) - 6.0;
          float pool = max(0.0, 1.0 - length(pq) / 4.5);
          macroPool = vMacroN.y > 0.6 && vMacroP.y < 4.0 ? diffuseColor.rgb * poolColor * pool * pool : vec3(0.0);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += macroPool;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * mix(1.35, 0.7, smoothstep(0.3, 0.7, macroV)), 0.04, 1.0);');
  };
  return mat;
}

/** Faint additive cone of light under a ceiling lamp; brightest where the view grazes through the most air. */
function shaftMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = uv.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV; varying float vH;
      void main() { float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(color * f * (0.15 + 0.85 * vH * vH) * smoothstep(0.0, 0.12, vH), 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
  });
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
  /** The sea on the beach map: opaque and glossy, so it costs no blending. */
  private water = new THREE.MeshStandardMaterial({ color: 0x2c4f5e, roughness: 0.12, metalness: 0.55 });
  /** Half the side of the loaded arena's playable square. */
  half = ARENA;
  /** Set dressing waiting to be merged into one mesh per material at the end of `load`. */
  private batches = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; late: boolean; geos: THREE.BufferGeometry[] }>();
  /** True while the floor, walls and ceiling are being built: they are drawn after everything else so the props in front hide them first. */
  private late = false;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** Neutral studio reflections; the weapon viewmodel always uses these so it reads the same in every arena. */
  readonly studioEnv: THREE.Texture;
  private signs = new Map<string, THREE.Material>();
  private fx: { stain: THREE.MeshBasicMaterial; shaft: THREE.ShaderMaterial; screen: THREE.MeshBasicMaterial; inlay: THREE.MeshBasicMaterial; sky: THREE.MeshBasicMaterial };
  private m: {
    floor: THREE.MeshStandardMaterial; wall: THREE.MeshStandardMaterial; pillar: THREE.MeshStandardMaterial;
    crate: THREE.MeshStandardMaterial; crate2: THREE.MeshStandardMaterial; contA: THREE.MeshStandardMaterial; contB: THREE.MeshStandardMaterial;
    trim: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; hazard: THREE.MeshStandardMaterial; snow: THREE.MeshStandardMaterial; snowFloor: THREE.MeshStandardMaterial; asphalt: THREE.MeshStandardMaterial;
    stripA: THREE.MeshBasicMaterial; stripB: THREE.MeshBasicMaterial; red: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial; panel: THREE.MeshBasicMaterial;
  };

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = this.studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
    const macro = makeMacroTexture();
    const w = (mat: THREE.MeshStandardMaterial) => weather(mat, macro);
    const flat = (map: THREE.Texture | null, opacity: number, additive = false) => new THREE.MeshBasicMaterial({
      map, color: additive ? 0xffffff : 0x000000, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.fx = {
      stain: flat(makeStainTexture(), 0.62),
      shaft: shaftMaterial(), screen: glow(1, 1, 1), inlay: glow(1, 1, 1),
      sky: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
    };
    this.m = {
      floor: w(std(floorMaps, 0.6)), wall: w(std(wallMaps, 0.4)), pillar: w(std(wallMaps, 0.45, 0xa4aab2)),
      crate: w(std(crateMaps, 0.3)), crate2: w(std(crateMaps, 0.3, 0x6f8494)),
      contA: w(std(wallMaps, 0.35, 0x9a4f39)), contB: w(std(wallMaps, 0.35, 0x41647e)),
      trim: w(std(plainMaps, 0.45, 0xb4bac2)), dark: w(std(plainMaps, 0.4, 0x4a4e57)), snow: std(snowMaps, 0.0), snowFloor: std(snowMaps, 0.0), asphalt: std(asphaltMaps, 0.35),
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
    this.half = this.collision.half = BIG_ARENAS.includes(id) ? BIG : ARENA;
    this.sun.position.set(14, 34, 9); this.sun.target.position.set(0, 0, 0); this.sun.target.updateMatrixWorld();

    const t = this.theme = THEMES[id], m = this.m;
    m.floor.color.setHex(t.floor); m.wall.color.setHex(t.wall); m.trim.color.setHex(t.trim); m.dark.color.setHex(t.dark);
    m.stripA.color.setRGB(...t.stripA); m.stripB.color.setRGB(...t.stripB); m.panel.color.setRGB(...t.panel);
    m.asphalt.roughness = t.floorRough ?? 1;
    m.snowFloor.color.setHex(t.ground ?? 0xffffff);
    (this.scene.background as THREE.Color).setHex(t.sky ?? 0x06080b);
    this.scene.environmentIntensity = t.env ?? 0.42;
    this.envTarget?.dispose(); this.envTarget = null;
    this.scene.environment = t.ownEnv ? this.themedEnv(t) : this.studioEnv;
    const f = this.fx, k = (c: [number, number, number], s: number) => [c[0] * s, c[1] * s, c[2] * s] as const;
    f.shaft.uniforms.color.value.setRGB(...k(t.panel, 0.04));
    poolColor.value.setRGB(0, 0, 0);
    f.screen.color.setRGB(...k(t.stripA, 0.2)); f.inlay.color.setRGB(...k(t.stripA, 0.28));
    this.weather = t.weather ?? 'none';
    this.rain.visible = t.weather === 'rain'; this.snowfall.visible = t.weather === 'snow';
    this.dust.visible = !t.outdoor;
    (this.dust.material as THREE.PointsMaterial).color.setHex(t.dust ?? 0x9fb4c8);
    this.corners.forEach((l) => l.position.setY(t.outdoor ? 8.5 : 6.5));
    this.fog.color.setHex(t.fog); this.fog.density = t.fogDensity;
    this.hemi.color.setHex(t.hemiSky); this.hemi.groundColor.setHex(t.hemiGround); this.hemi.intensity = t.hemi;
    this.sun.color.setHex(t.sun); this.sun.intensity = t.sunI;
    this.corners.forEach((l, i) => { l.color.setHex(t.corners[i === 0 || i === 3 ? 0 : 1]); l.intensity = t.cornerI; });
    this.coreLight.color.setHex(t.coreLight); this.coreLight.position.set(0, t.coreY, 0);

    this.late = true; if (id === 'beach') this.shellBeach(); else if (this.big) this.shellBig(); else this.shell(); this.late = false;
    if (id === 'reactor') this.buildReactor(); else if (id === 'foundry') this.buildFoundry(); else if (id === 'vault') this.buildVault();
    else if (id === 'yard') this.buildYard(); else if (id === 'city') this.buildCity(); else if (id === 'beach') this.buildBeach(); else this.buildFrost();
    this.flush();
  }

  /** True for the large free-roam maps. */
  get big(): boolean { return this.half > ARENA; }

  /** Colour grade for the loaded arena. */
  get grade(): Grade { return this.theme.grade ?? NEUTRAL; }

  /** A dark room lit only by this theme's lamps, prefiltered for reflections on metal. */
  private themedEnv(t: Theme): THREE.Texture {
    const s = new THREE.Scene(), g = new THREE.BoxGeometry(1, 1, 1);
    const add = (c: readonly [number, number, number] | number, x: number, y: number, z: number, sx: number, sy: number, sz: number, back = false) => {
      const mat = new THREE.MeshBasicMaterial({ side: back ? THREE.BackSide : THREE.FrontSide });
      if (typeof c === 'number') mat.color.setHex(c); else mat.color.setRGB(c[0], c[1], c[2]);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
      s.add(mesh);
    };
    add(0x0c0e12, 0, 3, 0, 60, 9, 60, true);
    add(0x1d2026, 0, -1.4, 0, 60, 0.1, 60);
    for (let k = -4; k <= 4; k++) for (const sgn of [1, -1]) {
      const c = Math.abs(k) % 2 ? t.stripA : t.stripB;
      add(c, k * 6.2, 3.1, 29.5 * sgn, 2.6, 0.5, 0.2); add(c, 29.5 * sgn, 3.1, k * 6.2, 0.2, 0.5, 2.6);
    }
    // Outdoors there is no lit ceiling to reflect, only the floodlights in the corners.
    if (!t.outdoor) for (let x = -18; x <= 18; x += 12) for (let z = -18; z <= 18; z += 12) add(t.panel, x, 7.4, z, 3.2, 0.1, 1.1);
    else for (const qx of [1, -1]) for (const qz of [1, -1]) add(t.panel, 26 * qx, 7.2, 26 * qz, 1.5, 0.5, 1.5);
    const warm = new THREE.Color(t.corners[0]), cool = new THREE.Color(t.corners[1]);
    for (const [x, z, c] of [[19, 19, warm], [-19, -19, warm], [-19, 19, cool], [19, -19, cool]] as const) add([c.r * 1.4, c.g * 1.4, c.b * 1.4], x, 5, z, 5, 3, 5);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromScene(s, 0.03);
    pmrem.dispose();
    s.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
    g.dispose();
    return this.envTarget.texture;
  }

  /** Queues non-colliding set dressing. Everything queued for one material becomes a single mesh. */
  private d(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; cast?: boolean; receive?: boolean } = {}) {
    if (o.rx) geo.rotateX(o.rx);
    if (o.rz) geo.rotateZ(o.rz);
    if (o.ry) geo.rotateY(o.ry);
    geo.translate(x, y, z);
    const cast = o.cast ?? true, receive = o.receive ?? cast, key = mat.uuid + (cast ? 'c' : 'n') + (receive ? 'r' : 'n') + (this.late ? 'l' : 'e');
    let b = this.batches.get(key);
    if (!b) this.batches.set(key, b = { mat, cast, receive, late: this.late, geos: [] });
    b.geos.push(geo);
  }

  private dbox(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, cast = true, tex = 2) {
    this.d(scaledBox(sx, sy, sz, tex), mat, x, y, z, { cast });
  }

  /** Cylinder between two points. */
  private dpipe(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, cast = true) {
    const dir = b.clone().sub(a), len = dir.length(), geo = new THREE.CylinderGeometry(r, r, len, 10);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    this.d(geo, mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, { cast });
  }

  private flush() {
    for (const b of this.batches.values()) {
      const indexed = b.geos.every((g) => g.index);
      const merged = mergeGeometries(indexed ? b.geos : b.geos.map((g) => (g.index ? g.toNonIndexed() : g)));
      for (const g of b.geos) g.dispose();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      if (b.mat === this.fx.shaft) mesh.renderOrder = 9; else if (b.late && !b.mat.transparent) mesh.renderOrder = 1;
      this.group.add(mesh);
    }
    this.batches.clear();
  }

  /** Painted lettering on a wall. `ry` turns the plane to face into the room. */
  private sign(text: string, x: number, y: number, z: number, w: number, ry: number, color?: string) {
    let mat = this.signs.get(text);
    if (!mat) this.signs.set(text, mat = new THREE.MeshStandardMaterial({
      map: makeSignTexture(text, color), transparent: true, roughness: 0.8, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    }));
    this.d(new THREE.PlaneGeometry(w, w * (96 / 512)), mat, x, y, z, { ry, cast: false });
  }

  /** Light cones under the ceiling lamps; the pools they throw on the floor are drawn by the surface shader. */
  private shafts() {
    poolColor.value.setRGB(this.theme.panel[0] * 0.16, this.theme.panel[1] * 0.16, this.theme.panel[2] * 0.16);
    for (let x = -18; x <= 18; x += 12) for (let z = -18; z <= 18; z += 12) {
      this.d(new THREE.CylinderGeometry(1.3, 3.4, CEIL - 0.2, 24, 1, true), this.fx.shaft, x, (CEIL - 0.2) / 2, z, { cast: false });
    }
  }

  private box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material, o: BoxOpts = {}) {
    // Free-standing props get rounded edges; the shell and thin trim stay as plain boxes.
    const bevel = (o.cast ?? true) && Math.min(sx, sy, sz) >= 0.4 && Math.max(sx, sy, sz) <= 12;
    // Static, so it joins the per-material batch instead of becoming its own draw call.
    this.d(bevel ? bevelBox(sx, sy, sz, o.tex ?? 3, 0.035) : scaledBox(sx, sy, sz, o.tex ?? 3), mat, cx, cy, cz, { cast: o.cast ?? true, receive: o.receive ?? true });
    if (o.collide ?? true) this.collision.add(cx, cy, cz, sx, sy, sz);
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
    this.box(cx, cy, cz, sx, sy, sz, mat, { collide: false, cast: false, receive: false });
  }

  /** Low cover wall with a dark cap. */
  private barrier(x: number, z: number, sx: number, sz: number) {
    this.box(x, 0.6, z, sx, 1.2, sz, this.m.trim, { tex: 2 });
    this.box(x, 1.23, z, sx + 0.1, 0.08, sz + 0.1, this.m.dark, { collide: false });
  }

  /** Floor, walls, ceiling, wall fixtures and the four spawn gates shared by every arena. */
  private shell() {
    const A = ARENA, m = this.m, out = !!this.theme.outdoor, H = out ? this.theme.wallH ?? 5 : CEIL;
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

  /**
   * Stairs or a ramp from height y0 up to y1. (x, z) is the middle of the bottom edge; the
   * flight runs `run` metres along `axis` in direction `sign`. Collision is always a row of
   * boxes: 0.2 m treads for stairs, and finer hidden ones under a ramp's sloped plate, which the
   * player's and robots' step-up turns into a smooth climb. Keep the slope at or below 0.4
   * (rise / run) so neighbouring navigation cells stay within a robot's step, and make it at
   * least 2.5 m wide: robots only route along cells whose centre is clear of the edge. `solid` fills
   * the stairs down to the ground; otherwise there is room to pass underneath.
   */
  private flight(x: number, z: number, axis: 'x' | 'z', sign: number, run: number, width: number, y0: number, y1: number, o: { ramp?: boolean; solid?: boolean } = {}) {
    const m = this.m, rise = y1 - y0, n = Math.round(rise / (o.ramp ? 0.13 : 0.2)), tread = run / n, r = rise / n, ax = axis === 'x';
    for (let i = 0; i < n; i++) {
      const top = y0 + (i + 1) * r, base = o.solid ? 0 : top - 0.3, at = (i + 0.5) * tread * sign;
      const cx = ax ? x + at : x, cz = ax ? z : z + at, sx = ax ? tread : width, sz = ax ? width : tread;
      if (o.ramp) this.collision.add(cx, (top + base) / 2, cz, sx, top - base, sz);
      else this.box(cx, (top + base) / 2, cz, sx, top - base, sz, i % 2 ? m.trim : m.dark, { tex: 2 });
    }
    const a = Math.atan2(rise, run), len = Math.hypot(run, rise), mx = ax ? x + (run / 2) * sign : x, mz = ax ? z : z + (run / 2) * sign;
    const tilt = (mesh: THREE.Mesh) => { if (ax) mesh.rotation.z = a * sign; else mesh.rotation.x = -a * sign; };
    if (o.ramp) {
      const plate = this.deco(scaledBox(ax ? len : width, 0.24, ax ? width : len, 2), m.trim, mx, y0 + rise / 2 + r / 2 - 0.12 / Math.cos(a), mz);
      tilt(plate);
    }
    // Glowing edge strips so the way up reads in the dark.
    for (const s of [-1, 1]) {
      const e = (width / 2 + 0.02) * s;
      const strip = this.deco(new THREE.BoxGeometry(ax ? len : 0.04, 0.06, ax ? 0.04 : len), m.stripA, ax ? mx : mx + e, y0 + rise / 2 + r / 2 - 0.05, ax ? mz + e : mz, false);
      tilt(strip);
    }
  }

  /** Flat walkway whose top is at `top`, with lit edges along its long sides. Open underneath. */
  private deck(cx: number, cz: number, sx: number, sz: number, top: number) {
    const m = this.m;
    this.box(cx, top - 0.1, cz, sx, 0.2, sz, m.dark, { tex: 2 });
    for (const s of [-1, 1]) {
      if (sx >= sz) this.lamp(cx, top - 0.1, cz + (sz / 2 + 0.02) * s, sx, 0.06, 0.04, m.stripB);
      else this.lamp(cx + (sx / 2 + 0.02) * s, top - 0.1, cz, 0.04, 0.06, sz, m.stripB);
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
    const H = CEIL, m = this.m, L2 = 2.6;
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
      // Level 2: a gallery round the outer corner joining the tops of the two containers, with
      // stairs at one end and a ramp at the other (swapped in alternate corners).
      const stairsFirst = qx * qz > 0;
      this.flight(24 * qx, 4.4 * qz, 'z', qz, 6.5, 2.6, 0, L2, stairsFirst ? { solid: true } : { ramp: true });
      this.deck(24 * qx, 21.45 * qz, 2.6, 8.7, L2);
      this.deck(19.9 * qx, 24.5 * qz, 5.6, 2.6, L2);
      this.box(23 * qx, (L2 - 0.2) / 2, 23.5 * qz, 0.3, L2 - 0.2, 0.3, m.dark, { tex: 1 });
      this.flight(4.4 * qx, 24.5 * qz, 'x', qx, 6.5, 2.6, 0, L2, stairsFirst ? { ramp: true } : { solid: true });
    }
    for (const sgn of [1, -1]) { this.barrier(0, 12 * sgn, 5, 0.5); this.barrier(18 * sgn, 0, 0.5, 5); }
    this.dressReactor();
  }

  /** Non-colliding detail for the Reactor Hall. Nothing here changes cover, paths or sightlines at ground level. */
  private dressReactor() {
    const H = CEIL, A = ARENA, m = this.m, f = this.fx, V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const r = this.rng(7);
    this.shafts();

    // Core: housings, glowing collars, a ring inlaid in the floor and coolant lines out to the pillars.
    this.d(new THREE.CylinderGeometry(1.0, 1.25, 0.5, 20), m.trim, 0, 1.45, 0);
    this.d(new THREE.CylinderGeometry(1.3, 1.0, 0.7, 20), m.dark, 0, H - 0.35, 0);
    for (const y of [2.6, 4.6, 6.6]) this.d(new THREE.TorusGeometry(0.9, 0.035, 8, 32), m.core, 0, y + 0.16, 0, { rx: Math.PI / 2, cast: false });
    this.d(new THREE.RingGeometry(3.1, 3.22, 48), f.inlay, 0, 0.012, 0, { rx: -Math.PI / 2, cast: false });
    this.d(new THREE.RingGeometry(3.6, 4.0, 48), m.hazard, 0, 0.01, 0, { rx: -Math.PI / 2, cast: false });
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      this.dpipe(V(0.8 * qx, 7.7, 0.8 * qz), V(11.9 * qx, 7.7, 11.9 * qz), 0.15, m.trim);
      this.dpipe(V(0.9 * qx, 7.35, 0.6 * qz), V(11.9 * qx, 7.35, 11.6 * qz), 0.07, m.contA);
      for (const k of [0.35, 0.7]) this.d(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 12), m.dark, 12 * k * qx, 7.7, 12 * k * qz, { rx: Math.PI / 2, ry: Math.atan2(qx, qz) });
      // Sagging cable from each pillar to the core.
      const pts = [V(11.8 * qx, 8.3, 12.4 * qz), V(7 * qx, 7.0, 8 * qz), V(3 * qx, 6.9, 4 * qz), V(0.7 * qx, 8.2, 1.0 * qz)];
      this.d(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 6), m.dark, 0, 0, 0);
    }

    this.channels();
    this.dressWalls(r, 'REACTOR HALL 01', 'COOLANT LOOP', 'HIGH VOLTAGE');

    this.ducts([-9, 9]);

    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      // Pillar collars and a conduit up one face.
      for (const y of [2.1, 6.0]) this.dbox(13 * qx, y, 13 * qz, 2.62, 0.22, 2.62, m.trim, false);
      this.dbox(13 * qx + 1.24 * qx, 5.4, 13 * qz + 0.75 * qz, 0.1, 5.2, 0.16, m.dark, false);
      this.frame(24 * qx, 14 * qz, 2.6, 6.2); this.frame(14 * qx, 24.5 * qz, 6.2, 2.6);
    }

    this.stains(r, [[20.5, 21], [6.5, 19], [19, 5.5], [13, 13], [24, 14], [14, 24.5], [7, 6.5]], 46);
  }

  private rng(seed: number) {
    return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  }

  /** Cable channels in the floor from the centre toward each gate, with a guide light down the middle. */
  private channels() {
    const m = this.m, f = this.fx;
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) {
      const c = 14.6 * sgn, L = 21.8;
      if (ax === 0) { this.dbox(c, 0, 0, L, 0.02, 0.7, m.dark, false); this.dbox(c, 0.002, 0, L, 0.02, 0.05, f.inlay, false); }
      else { this.dbox(0, 0, c, 0.7, 0.02, L, m.dark, false); this.dbox(0, 0.002, c, 0.05, 0.02, L, f.inlay, false); }
      for (let k = 6; k <= 24; k += 6) {
        if (ax === 0) this.dbox(k * sgn, 0.004, 0, 0.12, 0.02, 0.9, m.trim, false); else this.dbox(0, 0.004, k * sgn, 0.9, 0.02, 0.12, m.trim, false);
      }
    }
  }

  /** Perimeter walls: buttresses, vents, consoles, lettering and leak stains. Flat against the wall, so nothing to collide with. */
  private dressWalls(r: () => number, title: string, bay: string, warning: string) {
    const A = ARENA, m = this.m, f = this.fx, out = !!this.theme.outdoor, top = out ? Math.min(6, this.theme.wallH ?? 5) : 6;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const names = ['NORTH', 'SOUTH', 'WEST', 'EAST'];
    [[0, -1], [0, 1], [1, -1], [1, 1]].forEach(([ax, sgn], wi) => {
      // (c, depth) -> world position for something `depth` metres in from this wall at `c` along it.
      const at = (c: number, depth: number): [number, number] => (ax === 0 ? [c, (A - depth) * sgn] : [(A - depth) * sgn, c]);
      const size = (along: number, deep: number): [number, number] => (ax === 0 ? [along, deep] : [deep, along]);
      const ry = ax === 0 ? (sgn > 0 ? Math.PI : 0) : sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
      for (const c of [-27.6, -21.7, -15.5, -9.3, 9.3, 15.5, 21.7, 27.6]) {
        const [x, z] = at(c, 0.17), [sx, sz] = size(0.55, 0.34);
        this.dbox(x, top / 2, z, sx, top, sz, m.pillar, false, 2.4);
        // Indoors the buttress ends in a bracket under the pipe run.
        if (!out) { const [bx, bz] = at(c, 0.32), [bsx, bsz] = size(0.4, 0.64); this.dbox(bx, 6.02, bz, bsx, 0.14, bsz, m.dark, false); }
        const [kx, kz] = at(c, 0.2), [ksx, ksz] = size(0.75, 0.4);
        this.dbox(kx, 0.45, kz, ksx, 0.9, ksz, m.dark, false);
        if (r() < 0.6) { const [lx, lz] = at(c + (r() - 0.5) * 3, 0.012), h = Math.min(2.5 + r() * 2.5, top - 1); this.d(new THREE.PlaneGeometry(0.5 + r() * 0.5, h), f.stain, lx, 1.2 + h / 2 + r() * 0.4, lz, { ry, cast: false }); }
      }
      for (const c of [-12.4, 12.4]) {
        const [x, z] = at(c, 0.06), [sx, sz] = size(1.7, 0.12);
        this.dbox(x, 2.3, z, sx, 1.1, sz, m.dark, false);
        for (let i = 0; i < 5; i++) { const [vx, vz] = at(c, 0.14), [vsx, vsz] = size(1.5, 0.06); this.dbox(vx, 1.9 + i * 0.2, vz, vsx, 0.07, vsz, m.trim, false); }
        const [tx, tz] = at(c, 0.02);
        this.d(new THREE.PlaneGeometry(1.2, 1.6), f.stain, tx, 1.0, tz, { ry, cast: false });
      }
      for (const c of [-18.6, 18.6]) {
        const [x, z] = at(c, 0.14), [sx, sz] = size(1.9, 0.28);
        this.dbox(x, 1.55, z, sx, 1.3, sz, m.dark, false);
        const [gx, gz] = at(c - 0.3, 0.29), [gsx, gsz] = size(0.95, 0.02);
        this.dbox(gx, 1.75, gz, gsx, 0.55, gsz, f.screen, false);
        for (let i = 0; i < 3; i++) { const [ix, iz] = at(c + 0.55, 0.29), [isx, isz] = size(0.22, 0.02); this.dbox(ix, 1.95 - i * 0.2, iz, isx, 0.06, isz, i === 1 ? m.stripB : f.screen, false); }
        const [px, pz] = at(c + 0.7, 0.1);
        this.dpipe(V(px, 2.2, pz), V(px, 4.35, pz), 0.05, m.trim, false);
      }
      const [sgx, sgz] = at(0, 0.47);
      this.sign('GATE ' + names[wi], sgx, 3.9, sgz, 2.4, ry);
      for (const c of [-24.8, 24.8]) { const [x, z] = at(c, 0.012); this.sign(c < 0 ? title : bay + ' ' + (wi + 1), x, 2.9, z, 3.4, ry); }
      for (const c of [-6.2, 6.2]) { const [x, z] = at(c, 0.012); this.sign(c < 0 ? 'CAUTION' : warning, x, 3.15, z, 1.9, ry, '#c79a1c'); }
    });
  }

  /** Corner posts and top and bottom rails around a container-sized box of height `h` standing on `y0`. */
  private frame(cx: number, cz: number, sx: number, sz: number, y0 = 0, h = 2.6) {
    const m = this.m;
    for (const ex of [-1, 1]) for (const ez of [-1, 1]) this.dbox(cx + ex * (sx / 2 - 0.04), y0 + h / 2, cz + ez * (sz / 2 - 0.04), 0.16, h + 0.06, 0.16, m.dark);
    for (const y of [y0 + 0.07, y0 + h - 0.04]) {
      for (const ex of [-1, 1]) this.dbox(cx + ex * (sx / 2 - 0.03), y, cz, 0.12, 0.14, sz, m.dark);
      for (const ez of [-1, 1]) this.dbox(cx, y, cz + ez * (sz / 2 - 0.03), sx, 0.14, 0.12, m.dark);
    }
  }

  /** Stains on the floor: most gather around `spots` (mirrored into all four quadrants), the rest are scattered. */
  private stains(r: () => number, spots: [number, number][], count: number) {
    for (let i = 0; i < count; i++) {
      const near = i < count * 0.65, sp = spots[i % spots.length];
      const x = near ? sp[0] * (r() < 0.5 ? 1 : -1) + (r() - 0.5) * 5 : (r() - 0.5) * 54;
      const z = near ? sp[1] * (r() < 0.5 ? 1 : -1) + (r() - 0.5) * 5 : (r() - 0.5) * 54;
      const sz = 1.2 + r() * 3.2;
      this.d(new THREE.PlaneGeometry(sz, sz * (0.6 + r() * 0.8)), this.fx.stain, x, 0.006 + i * 0.0001, z, { rx: -Math.PI / 2, ry: r() * 6.28, cast: false });
    }
  }

  /** Sky dome for outdoor arenas: a vertical gradient from the horizon colour up to the colour overhead. */
  private sky(radius = 150) {
    const t = this.theme, g = new THREE.SphereGeometry(radius, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.12);
    const pos = g.attributes.position as THREE.BufferAttribute, col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(t.skyTop ?? t.sky ?? 0), hor = new THREE.Color(t.skyHorizon ?? t.sky ?? 0), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(hor).lerp(top, Math.pow(Math.max(0, pos.getY(i) / radius), 0.45));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(g, this.fx.sky);
    mesh.renderOrder = -1; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
  }

  /** Ceiling ducts on hangers, running along x at each given z. */
  private ducts(zs: number[]) {
    const A = ARENA, m = this.m;
    for (const z of zs) {
      this.dbox(0, 8.25, z, A * 2 - 1, 0.6, 1.0, m.trim, false, 3);
      for (let x = -27; x <= 27; x += 6) { this.dbox(x, 8.25, z, 0.14, 0.68, 1.1, m.dark, false); this.dbox(x, 8.8, z, 0.08, 0.5, 0.08, m.dark, false); }
      for (const x of [-15, 3, 21]) this.dbox(x, 7.9, z, 1.2, 0.12, 0.8, m.dark, false);
    }
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
    // The hook is drawn up clear of anyone crossing the bridge below it.
    this.deco(new THREE.TorusGeometry(0.28, 0.07, 6, 12, Math.PI * 1.4), m.trim, 0, 5.6, 0, false);
    // Level 2: a bridge across the hall over the crucible, stairs down to each side gate, and
    // short wings to stand on over the molten metal.
    const L2 = 3.4;
    this.deck(0, 0, 24.2, 2.6, L2);
    this.deck(0, 0, 2.6, 12, L2);
    for (const s of [1, -1]) {
      this.flight(20.6 * s, 0, 'x', -s, 8.5, 2.6, 0, L2, { solid: true });
      this.box(7 * s, (L2 - 0.2) / 2, 0, 0.4, L2 - 0.2, 0.4, m.dark, { tex: 1 });
    }
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
    this.dressFoundry();
  }

  private buildVault() {
    const H = CEIL, m = this.m, L2 = 4.3;
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
      // Level 2: catwalks above the racks (clear of their cable trays): one across the three
      // rows by the centre aisle with stairs from the side lane, one along the inner row.
      this.flight(27.7 * qx, 8 * qz, 'x', -qx, 11, 2.6, 0, L2);
      this.deck(10.7 * qx, 8 * qz, 12, 2.6, L2);
      this.deck(6 * qx, 15.9 * qz, 2.6, 13.2, L2);
    }
    for (const s of [1, -1]) this.barrier(0, 13.5 * s, 4, 0.5);
    this.dressVault();
  }

  /**
   * Stacks of shipping containers forming lanes, a parked hauler in the middle, and two upper
   * levels: catwalks at single-container height (2.6) reached by stairs or ramps, and bridges
   * across the double stacks (5.2) reached by stairs from the catwalk level.
   */
  private buildYard() {
    const m = this.m, L2 = 2.6, L3 = 5.2;
    const container = (x: number, z: number, alongX: boolean, mat: THREE.Material, stack = 1) => {
      for (let i = 0; i < stack; i++) {
        this.box(x, 1.3 + i * 2.6, z, alongX ? 6.2 : 2.6, 2.6, alongX ? 2.6 : 6.2, mat, { tex: 2.6 });
        this.lamp(x + (alongX ? 0 : 1.31), 2.3 + i * 2.6, z + (alongX ? 1.31 : 0), alongX ? 0.5 : 0.03, 0.08, alongX ? 0.03 : 0.5, m.stripA);
        this.frame(x, z, alongX ? 6.2 : 2.6, alongX ? 2.6 : 6.2, i * 2.6);
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
      // Level 2: up onto the single container by the gate lane (stairs in two corners, ramps in
      // the other two), then a catwalk round to the single container on the side lane.
      this.flight(20.6 * qx, 19.5 * qz, 'x', -qx, 6.5, 2.6, 0, L2, qx * qz > 0 ? { solid: true } : { ramp: true });
      this.deck(13.2 * qx, 15.25 * qz, 2.4, 5.9, L2);
      this.deck(17.05 * qx, 13.35 * qz, 5.3, 2.7, L2);
      this.box(14.2 * qx, (L2 - 0.2) / 2, 12.5 * qz, 0.3, L2 - 0.2, 0.3, m.dark, { tex: 1 });
      // Level 3: stairs from that container up to the top of the double stack.
      this.flight(19.7 * qx, 10.5 * qz, 'x', -qx, 7.4, 3, L2, L3);
    }
    // Level 3 bridges: along each side between the double stacks, and one across the middle.
    for (const s of [1, -1]) {
      this.deck(11 * s, 0, 2.2, 11.8, L3);
      this.box(5 * s, (L3 - 0.2) / 2, 0, 0.4, L3 - 0.2, 0.4, m.dark, { tex: 1 });
    }
    this.deck(0, 0, 19.8, 2.2, L3);
    for (const s of [1, -1]) { this.barrier(17 * s, 0, 0.6, 5); this.barrier(0, 15 * s, 4.5, 0.6); }
    this.dressYard();
  }

  /** Snowed-in outpost: prefab huts, fuel tanks, snow banks and a radio mast. */
  private buildFrost() {
    const m = this.m, L2 = 3.32, L3 = 5.92;
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
      // Level 2: the hut roof (its snow cap and chimney become solid), with a ramp up the back.
      this.collision.add(hx, 3.16, hz, 6.4, 0.32, 4.8);
      this.collision.add(hx + 2 * qx, 3.9, hz + 1.2 * qz, 0.4, 1.2, 0.4);
      this.flight(15 * qx, 26.7 * qz, 'z', -qz, 8.3, 2.6, 0, L2, { ramp: true });
    }
    // Bridges between the hut roofs on each side of the yard.
    for (const s of [1, -1]) {
      this.deck(0, 16 * s, 23.6, 2.6, L2);
      for (const x of [-5, 5]) this.box(x, (L2 - 0.2) / 2, 16 * s, 0.4, L2 - 0.2, 0.4, m.dark, { tex: 1 });
    }
    // Level 3: stairs from the far bridge up to a lookout round the mast. The near side stays
    // open so the spawn point has clear sky.
    this.flight(0, -14.7, 'z', 1, 11.5, 2.6, L2, L3);
    this.deck(0, 0, 6.4, 6.4, L3);
    for (const qx of [1, -1]) for (const qz of [1, -1]) this.box(3 * qx, (L3 - 0.2) / 2, 3 * qz, 0.3, L3 - 0.2, 0.3, m.dark, { tex: 1 });
    for (const s of [1, -1]) {
      this.box(0, 0.5, 14 * s, 5, 1.0, 1.5, m.snow, { tex: 2 });
      this.box(15.5 * s, 0.5, 0, 1.5, 1.0, 5, m.snow, { tex: 2 });
    }
    this.dressFrost();
  }

  /** Non-colliding detail for the Foundry. */
  private dressFoundry() {
    const H = CEIL, m = this.m, f = this.fx, r = this.rng(19), V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.shafts();
    this.dressWalls(r, 'FOUNDRY 02', 'CASTING LINE', 'HOT METAL');
    this.ducts([-15, 15]);
    // Crucible: hazard ring on the floor, crane rails and end trucks, chains hanging from the roof.
    this.d(new THREE.RingGeometry(3.7, 4.1, 48), m.hazard, 0, 0.01, 0, { rx: -Math.PI / 2, cast: false });
    this.d(new THREE.TorusGeometry(2.92, 0.05, 8, 8), m.core, 0, 2.3, 0, { rx: Math.PI / 2, ry: Math.PI / 8, cast: false });
    for (const z of [-0.62, 0.62]) this.dbox(0, 7.52, z, 30, 0.16, 0.14, m.dark, false);
    for (const x of [-15, 15]) { this.dbox(x, 7.1, 0, 0.5, 1.1, 1.8, m.dark, false); this.dbox(x, 8.3, 0, 0.3, 1.4, 0.3, m.dark, false); }
    for (const [x, z, y] of [[-6, 3, 5.6], [6, -3, 6.2], [-4, -5, 6.6], [5, 5, 5.9]]) {
      this.dpipe(V(x, H, z), V(x, y, z), 0.03, m.dark, false);
      this.d(new THREE.TorusGeometry(0.16, 0.04, 6, 12), m.trim, x, y - 0.14, z, { cast: false });
    }
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      const fx = 15.5 * qx, fz = 21 * qz;
      // Furnace: hood over the mouth, gauge panel, feed pipes to the roof, soot on the floor in front.
      this.dbox(fx, 2.62, fz - 2.3 * qz, 3.2, 0.22, 0.7, m.dark);
      this.dbox(fx + 2.05, 3.1, fz - 2.04 * qz, 0.7, 0.6, 0.1, m.dark, false);
      this.dbox(fx + 2.05, 3.15, fz - 2.1 * qz, 0.5, 0.26, 0.02, f.screen, false);
      for (const o of [-2.1, 2.1]) {
        this.dpipe(V(fx + o, 4.3, fz + 1.2 * qz), V(fx + o, H, fz + 1.2 * qz), 0.16, m.trim);
        this.d(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 12), m.dark, fx + o, 6.4, fz + 1.2 * qz);
      }
      this.d(new THREE.PlaneGeometry(4.6, 3.4), f.stain, fx, 0.008, fz - 3.6 * qz, { rx: -Math.PI / 2, cast: false });
      // Conveyor side rails and legs.
      for (const o of [-0.74, 0.74]) this.dbox(9 * qx, 1.12, 12 * qz + o, 10, 0.12, 0.08, m.dark, false);
      for (let k = -4; k <= 4; k += 2) this.dbox(9 * qx + k, 1.07, 12 * qz, 0.1, 0.05, 1.3, m.trim, false);
      // Pillar collars.
      for (const y of [2.1, 6.0]) this.dbox(23.5 * qx, y, 13.5 * qz, 2.62, 0.22, 2.62, m.trim, false);
    }
    this.stains(r, [[15.5, 17.5], [9, 12], [8, 6], [22.5, 7], [23.5, 13.5], [3, 4]], 50);
  }

  /** Non-colliding detail for the Server Vault. */
  private dressVault() {
    const H = CEIL, m = this.m, f = this.fx, r = this.rng(31), V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.shafts();
    this.channels();
    this.dressWalls(r, 'SERVER VAULT 03', 'RACK ROW', 'STATIC HAZARD');
    this.ducts([-4.5, 4.5]);
    // Data core: housings, glowing collars and a ring inlaid in the floor.
    this.d(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 6), m.trim, 0, 1.05, 0);
    this.d(new THREE.CylinderGeometry(1.25, 0.95, 0.7, 6), m.dark, 0, H - 0.35, 0);
    for (const y of [2.6, 4.6, 6.6]) this.d(new THREE.TorusGeometry(0.98, 0.035, 8, 32), m.core, 0, y, 0, { rx: Math.PI / 2, cast: false });
    this.d(new THREE.RingGeometry(2.6, 2.72, 48), f.inlay, 0, 0.012, 0, { rx: -Math.PI / 2, cast: false });
    for (const x of [-16, -11, -6, 6, 11, 16]) {
      // Cable tray over each column of racks, with drops into every rack.
      this.dbox(x, 3.95, 0, 0.5, 0.08, 52, m.dark, false);
      for (const z of [-19, -8, 8, 19]) {
        for (const o of [-2.4, 0, 2.4]) this.dbox(x, 3.62, z + o, 0.07, 0.6, 0.07, m.dark, false);
        for (const e of [-1, 1]) this.dbox(x, 1.62, z + e * 3.53, 1.3, 3.28, 0.08, m.trim);
        // Status lights scattered over both faces.
        for (let i = 0; i < 12; i++) {
          const side = i % 2 ? 1 : -1, c = r();
          this.dbox(x + 0.615 * side, 0.35 + r() * 2.7, z + (r() - 0.5) * 6.4, 0.02, 0.035, 0.05, c < 0.5 ? f.screen : c < 0.85 ? m.stripB : m.red, false);
        }
      }
    }
    for (const z of [-13.5, 13.5]) for (let x = -18; x <= 18; x += 6) this.dbox(x, 8.35, z, 0.08, 1.3, 0.08, m.dark, false);
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      // Cooling units: fan housing on top and coolant lines back to the wall.
      this.d(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 20), m.dark, 24.5 * qx, 2.55, 25 * qz);
      this.d(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 20), m.trim, 24.5 * qx, 2.72, 25 * qz, { cast: false });
      for (const y of [0.6, 1.5]) this.dpipe(V(26.2 * qx, y, 25.6 * qz), V(29.9 * qx, y, 25.6 * qz), 0.09, m.trim);
      this.frame(24.5 * qx, 25 * qz, 3.4, 3, 0, 2.4);
    }
    this.stains(r, [[24.5, 22], [11, 13.5], [6, 0]], 16);
  }

  /** Non-colliding detail for the Rain Yard. */
  private dressYard() {
    const m = this.m, f = this.fx, r = this.rng(43), V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.sky();
    this.dressWalls(r, 'FREIGHT YARD 04', 'BAY', 'KEEP CLEAR');
    // Floodlight beams from the corner towers.
    for (const qx of [1, -1]) for (const qz of [1, -1])
      this.d(new THREE.CylinderGeometry(0.8, 6.5, 8.6, 24, 1, true), f.shaft, 25.4 * qx, 4.4, 25.4 * qz, { cast: false });
    // Hauler: wheels, bumper, exhaust stacks and mirrors.
    for (const sx of [1, -1]) {
      for (const z of [-4.2, -2.9, 0.4, 3.3]) this.d(new THREE.CylinderGeometry(0.52, 0.52, 0.36, 16), m.dark, 1.2 * sx, 0.52, z, { rz: Math.PI / 2 });
      this.dpipe(V(1.12 * sx, 2.5, 1.85), V(1.12 * sx, 3.7, 1.85), 0.09, m.trim);
      this.dbox(1.42 * sx, 1.9, 4.1, 0.08, 0.4, 0.25, m.dark, false);
    }
    this.dbox(0, 0.5, 4.5, 2.7, 0.28, 0.22, m.dark);
    this.dbox(0, 2.62, 3.2, 2.3, 0.1, 2.2, m.dark, false);
    // Worn lane paint down the two side lanes and across the gate lanes.
    for (const s of [1, -1]) {
      for (let k = -24; k <= 24; k += 4) { this.dbox(16 * s, 0.003, k, 0.16, 0.02, 2.2, m.trim, false); this.dbox(k, 0.003, 27 * s, 2.2, 0.02, 0.16, m.trim, false); }
    }
    // Puddles and oil.
    this.stains(r, [[16, 4.5], [5.5, 11.5], [11, 14], [21, 17], [3, 6], [17, 0]], 44);
  }

  /** Non-colliding detail for the Frost Outpost. */
  private dressFrost() {
    const A = ARENA, m = this.m, r = this.rng(57), V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.sky();
    this.dressWalls(r, 'OUTPOST 05', 'SECTOR', 'ICE HAZARD');
    // Mast: guy wires to snow-covered anchors, and a dish.
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      this.dpipe(V(0.4 * qx, 10.5, 0.4 * qz), V(6.5 * qx, 0.2, 6.5 * qz), 0.02, m.dark, false);
      this.dbox(6.5 * qx, 0.15, 6.5 * qz, 0.5, 0.3, 0.5, m.dark);
      this.dbox(6.5 * qx, 0.33, 6.5 * qz, 0.56, 0.08, 0.56, m.snow, false);
    }
    this.d(new THREE.CylinderGeometry(0.55, 0.12, 0.3, 16), m.trim, 0.75, 8.6, 0, { rz: -Math.PI / 2 });
    for (const qx of [1, -1]) for (const qz of [1, -1]) {
      const hx = 15 * qx, hz = 16 * qz;
      // Hut: frame, chimney, door canopy and window surrounds.
      this.frame(hx, hz, 6, 4.4, 0, 3);
      this.dpipe(V(hx + 2 * qx, 3.2, hz + 1.2 * qz), V(hx + 2 * qx, 4.5, hz + 1.2 * qz), 0.14, m.dark);
      this.d(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12), m.snow, hx + 2 * qx, 4.54, hz + 1.2 * qz, { cast: false });
      this.dbox(hx, 2.3, hz - 2.5 * qz, 1.5, 0.1, 0.6, m.dark);
      this.dbox(hx, 2.4, hz - 2.5 * qz, 1.56, 0.1, 0.66, m.snow, false);
      for (const o of [-1.6, 1.6]) {
        this.dbox(hx + o, 1.9, hz - 2.215 * qz, 1.36, 0.86, 0.03, m.dark, false);
        this.dbox(hx + o, 1.5, hz - 2.28 * qz, 1.4, 0.06, 0.14, m.snow, false);
      }
      // Fuel tank: saddles, bands, a valve and a line running to the hut.
      const tx = 24 * qx, tz = 6 * qz;
      for (const o of [-1.4, 1.4]) { this.dbox(tx, 0.5, tz + o, 2.0, 1.0, 0.3, m.dark); this.d(new THREE.TorusGeometry(1.12, 0.04, 6, 24), m.dark, tx, 1.2, tz + o * 0.7); }
      this.d(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10), m.dark, tx, 2.42, tz);
      this.dpipe(V(tx - 1.0 * qx, 0.12, tz + 2.3 * qz), V(18.1 * qx, 0.12, 14 * qz), 0.07, m.trim);
      // Snow settled on the tank and the crates' lee side.
      this.d(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.75, 0.22, 2.1), m.snow, tx, 2.22, tz, { cast: false });
    }
    // Shallow drifts banked against the perimeter wall.
    for (const [ax, sgn] of [[0, -1], [0, 1], [1, -1], [1, 1]] as const) for (let i = 0; i < 7; i++) {
      let c = (r() - 0.5) * 54;
      if (Math.abs(c) < 5.5) c += c < 0 ? -6 : 6;
      const len = 2.5 + r() * 3, h = 0.35 + r() * 0.5, geo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      if (ax === 0) this.d(geo.scale(len, h, 0.7), m.snow, c, 0, (A - 0.1) * sgn, { cast: false });
      else this.d(geo.scale(0.7, h, len), m.snow, (A - 0.1) * sgn, 0, c, { cast: false });
    }
    this.stains(r, [[24, 6], [15, 12.5]], 10);
  }

  // ---------- City (big map) ----------

  /** Ground, an invisible lid and a wall of tall buildings round the edge of a big outdoor map. */
  private shellBig() {
    const H = this.half, m = this.m, edge = H - 14;
    this.box(0, -0.5, 0, H * 2, 1, H * 2, m.asphalt, { cast: false, tex: 4 });
    this.collision.add(0, 14.5, 0, H * 2 + 2, 1, H * 2 + 2);
    const r = this.rng(101), mats = [m.wall, m.contA, m.pillar, m.contB];
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) {
      // Six buildings a side fill the strip between the ring road and the map edge.
      const span = ax === 0 ? H * 2 : edge * 2, n = 6, w = span / n;
      for (let i = 0; i < n; i++) {
        const c = -span / 2 + (i + 0.5) * w, h = 16 + Math.floor(r() * 5) * 4, mat = mats[(i + (ax ? 1 : 0) + (sgn > 0 ? 0 : 2)) % 4], mid = (edge + 7) * sgn;
        if (ax === 0) { this.box(c, h / 2, mid, w, h, 14, mat, { tex: 6 }); this.windows(c - w / 2, c + w / 2, mid - 7, mid + 7, h, r, sgn > 0 ? 'z-' : 'z+'); }
        else { this.box(mid, h / 2, c, 14, h, w, mat, { tex: 6 }); this.windows(mid - 7, mid + 7, c - w / 2, c + w / 2, h, r, sgn > 0 ? 'x-' : 'x+'); }
      }
    }
  }

  /** Rows of windows on the named faces of a building (all four by default). About a third are lit. */
  private windows(x0: number, x1: number, z0: number, z1: number, h: number, r: () => number, faces = 'x-x+z-z+') {
    const m = this.m;
    const row = (along: 'x' | 'z', a0: number, a1: number, at: number, ry: number) => {
      const n = Math.floor((a1 - a0 - 1.2) / 3);
      for (let y = 2.4; y < h - 1.6; y += 3.2) for (let i = 0; i < n; i++) {
        const a = (a0 + a1) / 2 + (i - (n - 1) / 2) * 3, k = r(), mat = k < 0.22 ? m.stripA : k < 0.32 ? m.panel : m.dark;
        this.d(new THREE.PlaneGeometry(1.5, 1.3), mat, along === 'x' ? a : at, y, along === 'x' ? at : a, { ry, cast: false });
      }
    };
    if (faces.includes('z+')) row('x', x0, x1, z1 + 0.03, 0);
    if (faces.includes('z-')) row('x', x0, x1, z0 - 0.03, Math.PI);
    if (faces.includes('x+')) row('z', z0, z1, x1 + 0.03, Math.PI / 2);
    if (faces.includes('x-')) row('z', z0, z1, x0 - 0.03, -Math.PI / 2);
  }

  /**
   * The City: a 180 m square of streets with a different district in each quarter, free to roam.
   * Two 24 m avenues cross at a central plaza; a ring road runs round the outside in front of
   * the boundary buildings. Each 48 m block between them is its own area:
   *   north-east  market street: two shop rows with raised walkways and a bridge between them
   *   south-east  construction site: a concrete core wrapped in two levels of scaffolding
   *   south-west  car park: a parking deck on columns with a ramp and a stair
   *   north-west  tenements: four apartment blocks split by alleys, with a fire-escape walkway
   * Robots come from spawn points all over the map; `Game.pickGate` uses the ones near the player.
   */
  private buildCity() {
    const m = this.m, r = this.rng(211), H = this.half;
    this.sky(300);
    // Corner helpers: a district is written once in positive coordinates and mirrored into its quarter.
    let qx = 1, qz = 1;
    const B = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, mat: THREE.Material, o: BoxOpts = {}) =>
      this.box(((x0 + x1) / 2) * qx, (y0 + y1) / 2, ((z0 + z1) / 2) * qz, x1 - x0, y1 - y0, z1 - z0, mat, o);
    const building = (x0: number, x1: number, z0: number, z1: number, h: number, mat: THREE.Material) => {
      B(x0, x1, z0, z1, 0, h, mat, { tex: 6 });
      this.windows(Math.min(x0 * qx, x1 * qx), Math.max(x0 * qx, x1 * qx), Math.min(z0 * qz, z1 * qz), Math.max(z0 * qz, z1 * qz), h, r);
    };
    const deck = (x0: number, x1: number, z0: number, z1: number, top: number) => this.deck(((x0 + x1) / 2) * qx, ((z0 + z1) / 2) * qz, x1 - x0, z1 - z0, top);
    const flight = (x: number, z: number, axis: 'x' | 'z', sign: number, run: number, width: number, y0: number, y1: number, o: { ramp?: boolean; solid?: boolean } = {}) =>
      this.flight(x * qx, z * qz, axis, sign * (axis === 'x' ? qx : qz), run, width, y0, y1, o);
    const post = (x: number, z: number, top: number) => B(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 0, top - 0.2, m.dark, { tex: 1 });
    const cover = (x: number, z: number, sx: number, sz: number) => this.barrier(x * qx, z * qz, sx, sz);
    const crate = (x: number, z: number, s: number, mat: THREE.Material = m.crate) => B(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 0, s, mat, { tex: s });
    /** A parked car: low body and cabin, good for crouching behind. `y0` puts it on a raised deck. */
    const car = (x: number, z: number, alongX: boolean, mat: THREE.Material, y0 = 0) => {
      const l = 2.2, w = 0.95;
      B(x - (alongX ? l : w), x + (alongX ? l : w), z - (alongX ? w : l), z + (alongX ? w : l), y0 + 0.25, y0 + 1.0, mat, { tex: 2 });
      B(x - (alongX ? 1.1 : 0.85), x + (alongX ? 1.1 : 0.85), z - (alongX ? 0.85 : 1.1), z + (alongX ? 0.85 : 1.1), y0 + 1.0, y0 + 1.6, m.dark, { tex: 1 });
      this.collision.add(x * qx, y0 + 0.125, z * qz, alongX ? 3.6 : 1.7, 0.25, alongX ? 1.7 : 3.6);
    };
    /** A marked pad robots arrive on, somewhere in the open. */
    const pad = (x: number, z: number) => {
      const pos = new THREE.Vector3(x, 0, z), dir = new THREE.Vector3(-x, 0, -z).normalize();
      this.gates.push({ pos, dir });
      this.d(new THREE.RingGeometry(1.5, 1.9, 24), m.hazard, x, 0.02, z, { rx: -Math.PI / 2, cast: false });
      this.lamp(x, 0.03, z, 0.5, 0.04, 0.5, m.red);
    };

    // --- Streets: pavement under each block, spawn doors on the boundary, pads in the open ---
    for (qx of [1, -1]) for (qz of [1, -1]) this.dbox(36 * qx, 0.03, 36 * qz, 48, 0.06, 48, m.trim, false, 4);
    const edge = H - 14;
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]] as const) for (const c of [-36, 0, 36]) {
      // Garage doors in the boundary buildings.
      const x = ax ? (edge - 3) * sgn : c, z = ax ? c : (edge - 3) * sgn;
      this.gates.push({ pos: new THREE.Vector3(x, 0, z), dir: new THREE.Vector3(ax ? -sgn : 0, 0, ax ? 0 : -sgn) });
      const fx = ax ? (edge - 0.06) * sgn : c, fz = ax ? c : (edge - 0.06) * sgn;
      this.dbox(fx, 1.9, fz, ax ? 0.1 : 5.4, 3.8, ax ? 5.4 : 0.1, m.dark, false);
      this.lamp(ax ? (edge - 0.2) * sgn : c, 3.95, ax ? c : (edge - 0.2) * sgn, ax ? 0.1 : 4.8, 0.12, ax ? 4.8 : 0.1, m.red);
    }
    for (const s of [1, -1]) { pad(42 * s, 0); pad(0, 42 * s); pad(68 * s, 68); pad(68 * s, -68); }

    // --- Plaza and avenues ---
    qx = qz = 1;
    this.box(0, 0.5, 0, 5, 1, 5, m.trim);
    this.box(0, 5, 0, 1.8, 8, 1.8, m.pillar, { tex: 2 });
    this.box(0, 9.3, 0, 2.6, 0.6, 2.6, m.trim, { collide: false });
    for (const [ox, oz] of [[0.92, 0], [-0.92, 0], [0, 0.92], [0, -0.92]]) this.lamp(ox, 5, oz, ox ? 0.05 : 0.2, 6, oz ? 0.05 : 0.2, m.core);
    for (const [x, z] of [[8.5, -8.5], [-8.5, -8.5], [8.5, 8.5], [-8.5, 8.5]]) {
      this.box(x, 1.4, z, 3.2, 2.8, 2.6, m.contB, { tex: 2 });
      this.lamp(x, 2.2, z + (z < 0 ? 1.32 : -1.32), 2.4, 0.5, 0.04, m.stripB);
    }
    for (const s of [1, -1]) {
      // Median planters, wrecks and barricades down each avenue and along the ring road.
      for (const c of [26, 52]) { this.barrier(0, c * s, 1.4, 9); this.barrier(c * s, 0, 9, 1.4); }
      for (const c of [-40, 22, 50]) { this.barrier(68 * s, c, 0.6, 6); this.barrier(c, 68 * s, 6, 0.6); }
    }
    car(-6, 20, false, m.contA); car(6.5, 36, false, m.contB); car(-5.5, 58, false, m.trim); car(5, -24, false, m.trim); car(6, -62, false, m.contA);
    car(22, 5.5, true, m.contB); car(46, -6, true, m.contA); car(-24, -5.5, true, m.trim); car(-56, 6, true, m.contB);
    car(64, 30, false, m.trim); car(71, -22, false, m.contA); car(-64, -34, false, m.contB); car(-71, 12, false, m.trim);
    car(30, 65, true, m.contA); car(-18, 71, true, m.contB); car(-44, -65, true, m.trim); car(14, -71, true, m.contA);
    // A bus abandoned across the southern avenue.
    this.box(-5, 1.75, -44, 2.9, 3.0, 11, m.contB, { tex: 3 });
    this.lamp(-3.53, 2.3, -44, 0.04, 0.9, 9.6, m.panel);
    // Street lamps (lit heads only; the light itself comes from the sky and sun).
    for (const [x, z] of [[13, 13], [13, 59], [59, 13], [59, 59], [13, 36], [36, 13]]) for (const sx of [1, -1]) for (const sz of [1, -1]) {
      this.dbox(x * sx, 3.2, z * sz, 0.16, 6.4, 0.16, m.dark);
      this.lamp(x * sx, 6.45, z * sz, 1.1, 0.12, 0.4, m.panel);
    }

    // --- North-east: market street ---
    qx = 1; qz = 1;
    building(14, 58, 14, 24, 8, m.contA); building(14, 58, 48, 58, 8, m.contB);
    for (let x = 18; x <= 54; x += 6) { this.lamp(x, 1.5, 24.04, 3.4, 1.8, 0.04, m.stripA); this.lamp(x, 1.5, 47.96, 3.4, 1.8, 0.04, m.stripA); }
    deck(22.6, 56, 24, 27, 3); flight(15.1, 25.5, 'x', 1, 7.5, 3, 0, 3, { solid: true });
    deck(16, 49.4, 45, 48, 3); flight(56.9, 46.5, 'x', -1, 7.5, 3, 0, 3, { ramp: true });
    deck(34.5, 37.5, 27, 45, 3); post(36, 31, 3); post(36, 41, 3);
    cover(24, 33, 4, 1.2); cover(46, 39, 4, 1.2); cover(30, 41, 1.2, 4); cover(42, 31, 1.2, 4);
    crate(20, 40, 1.5); crate(21.6, 40.4, 1, m.crate2); crate(52, 32, 1.5, m.crate2); crate(50.4, 31.4, 1.2);

    // --- South-east: construction site ---
    qx = 1; qz = -1;
    B(28, 44, 28, 44, 0, 11, m.wall, { tex: 6 });
    deck(25, 47, 25, 28, 2.6); deck(25, 47, 44, 47, 2.6); deck(25, 28, 28, 44, 2.6); deck(44, 47, 28, 44, 2.6);
    flight(18.4, 26.5, 'x', 1, 6.6, 3, 0, 2.6, { ramp: true });
    flight(26.5, 37.4, 'z', 1, 6.6, 3, 2.6, 5.2);
    deck(25, 47, 44, 47, 5.2); deck(44, 47, 28, 44, 5.2);
    for (const [x, z] of [[25.3, 25.3], [46.7, 25.3], [25.3, 46.7], [46.7, 46.7], [36, 25.3], [36, 46.7], [46.7, 36]]) post(x, z, x > 40 || z > 40 ? 5.2 : 2.6);
    B(16.7, 19.3, 36.9, 43.1, 0, 2.6, m.contA, { tex: 2.6 }); B(48.9, 55.1, 16.7, 19.3, 0, 2.6, m.contB, { tex: 2.6 });
    B(49, 55, 50, 54, 0, 1, m.trim, { tex: 2 }); B(50, 54, 50.6, 53.4, 1, 1.8, m.trim, { tex: 2 });
    cover(36, 15, 10, 0.5); cover(15, 30, 0.5, 8); crate(20, 52, 1.5); crate(21.7, 51.5, 1.2, m.crate2); crate(54, 34, 1.5, m.crate2);
    // Tower crane: a solid mast, the jib is only dressing.
    B(53.3, 54.7, 55.3, 56.7, 0, 14, m.contA, { tex: 1.4 });
    this.dbox(54 * qx, 20, 56 * qz, 1.2, 12, 1.2, m.contA, true); this.dbox(40 * qx, 25.5, 56 * qz, 44, 1, 1, m.contA, true);

    // --- South-west: car park ---
    qx = -1; qz = -1;
    const P = 3.6;
    B(16, 56, 16, 44, P - 0.3, P, m.pillar, { tex: 4 });
    for (const x of [18, 30, 42, 54]) for (const z of [18, 30, 42]) B(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 0, P - 0.3, m.pillar, { tex: 1 });
    // Parapet round the deck, open where the ramp and the stair arrive.
    B(16, 43.9, 16, 16.3, P, P + 1, m.trim); B(16, 16.3, 16, 44, P, P + 1, m.trim); B(55.7, 56, 16, 44, P, P + 1, m.trim);
    B(32.1, 56, 43.7, 44, P, P + 1, m.trim); B(16, 20, 43.7, 44, P, P + 1, m.trim);
    flight(20.1, 45.5, 'x', 1, 9, 3, 0, P, { ramp: true }); deck(29.1, 32.1, 44, 47, P);
    flight(55.9, 14.7, 'x', -1, 9, 2.6, 0, P, { solid: true }); deck(43.9, 46.9, 13.4, 16, P);
    car(22, 24, false, m.contA); car(36, 37, true, m.trim); car(48, 22, false, m.contB); car(26, 36, false, m.trim); car(50, 37, true, m.contA);
    car(24, 22, false, m.contB, P); car(40, 34, true, m.contA, P); car(50, 24, false, m.trim, P); car(30, 38, true, m.contB, P);
    cover(36, 52, 8, 0.5); crate(52, 50, 1.5); crate(18, 52, 1.2, m.crate2);

    // --- North-west: tenements ---
    qx = -1; qz = 1;
    building(14, 33, 14, 33, 16, m.contA); building(39, 58, 14, 33, 20, m.wall);
    building(14, 33, 39, 58, 14, m.contB); building(39, 58, 39, 58, 18, m.contA);
    // Fire escape: up from the avenue, along one alley, across the other and down to the ring road.
    flight(14.1, 37.7, 'x', 1, 10, 2.6, 0, 4, { solid: true });
    deck(24.1, 52, 36.4, 39, 4); deck(33, 35.6, 39, 52, 4);
    flight(34.3, 62, 'z', -1, 10, 2.6, 0, 4);
    B(18.9, 21.1, 33, 34.4, 0, 1.4, m.dark, { tex: 1.4 }); B(44.9, 47.1, 33, 34.4, 0, 1.4, m.dark, { tex: 1.4 });
    B(37.2, 38.6, 20.9, 23.1, 0, 1.4, m.dark, { tex: 1.4 }); B(37.2, 38.6, 46.9, 49.1, 0, 1.4, m.dark, { tex: 1.4 });
    crate(54, 35.2, 1.2); crate(36, 16, 1.5, m.crate2);

    // Lane paint down the avenues.
    for (let k = -72; k <= 72; k += 6) if (Math.abs(k) > 14) { this.dbox(6, 0.012, k, 0.18, 0.024, 2.6, m.trim, false); this.dbox(-6, 0.012, k, 0.18, 0.024, 2.6, m.trim, false); this.dbox(k, 0.012, 6, 2.6, 0.024, 0.18, m.trim, false); this.dbox(k, 0.012, -6, 2.6, 0.024, 0.18, m.trim, false); }
  }

  // ---------- Beach invasion (big map) ----------

  /** Sand, the lid, rock cliffs on three sides and open sea on the fourth (+z), walled off invisibly. */
  private shellBeach() {
    const H = this.half, m = this.m, edge = H - 14, r = this.rng(307);
    this.box(0, -0.5, 0, H * 2, 1, H * 2, m.snowFloor, { cast: false, tex: 4 });
    this.collision.add(0, 14.5, 0, H * 2 + 2, 1, H * 2 + 2);
    this.collision.add(0, 7, edge + 0.5, H * 2, 14, 1);
    // The sea: shallows the player can wade into from z = 60, then open water to the horizon.
    this.dbox(0, 0.06, 210, 640, 0.12, 300, this.water, false, 6);
    for (const [ax, sgn] of [[1, 1], [1, -1], [0, -1]] as const) {
      const n = 7, w = (H * 2) / n;
      for (let i = 0; i < n; i++) {
        const c = -H + (i + 0.5) * w, h = 15 + Math.floor(r() * 4) * 3, d = 14 + r() * 3, mid = (H - 7) * sgn;
        if (ax) this.box(mid, h / 2, c, d, h, w + 0.4, m.pillar, { tex: 6 }); else this.box(c, h / 2, mid, w + 0.4, h, d, m.pillar, { tex: 6 });
      }
    }
  }

  /**
   * Beach invasion: a 180 m square running from the surf (+z) inland to a village (-z), free to
   * roam. Robots come ashore from landing craft and drop in on marked pads further inland.
   *   surf and beach   landing craft in the shallows, obstacles on the sand, a sea wall with gaps
   *   pier (east)      a wooden pier out over the water, reached by a ramp
   *   lighthouse point (west)   two rock terraces up to the lighthouse
   *   bunker line      two pillboxes you can enter, with stairs up to their roofs
   *   battery          a gun platform with an observation post on top
   *   village          houses and a church round a street, and a ruin with an upper floor
   */
  private buildBeach() {
    const m = this.m, r = this.rng(311), V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.sky(300);
    const B = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, mat: THREE.Material, o: BoxOpts = {}) =>
      this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, mat, o);
    const crate = (x: number, z: number, s: number, mat: THREE.Material = m.crate, y0 = 0) => B(x - s / 2, x + s / 2, z - s / 2, z + s / 2, y0, y0 + s, mat, { tex: s });
    const pad = (x: number, z: number) => {
      this.gates.push({ pos: V(x, 0, z), dir: V(-x, 0, 9 - z).normalize() });
      this.d(new THREE.RingGeometry(1.5, 1.9, 24), m.hazard, x, 0.02, z, { rx: -Math.PI / 2, cast: false });
      this.lamp(x, 0.03, z, 0.5, 0.04, 0.5, m.red);
    };
    const house = (x0: number, x1: number, z0: number, z1: number, h: number, mat: THREE.Material) => {
      B(x0, x1, z0, z1, 0, h, mat, { tex: 5 });
      this.dbox((x0 + x1) / 2, h + 0.15, (z0 + z1) / 2, x1 - x0 + 0.6, 0.3, z1 - z0 + 0.6, m.dark);
      this.windows(x0, x1, z0, z1, h + 1.2, r);
    };

    // --- Surf: landing craft the robots come ashore from ---
    for (const x of [-48, -16, 16, 48]) {
      B(x - 2.4, x - 2.1, 59, 70, 0, 1.9, m.contB, { tex: 3 }); B(x + 2.1, x + 2.4, 59, 70, 0, 1.9, m.contB, { tex: 3 });
      B(x - 2.4, x + 2.4, 69.7, 70, 0, 2.6, m.contB, { tex: 3 });
      this.dbox(x, 0.2, 57.4, 4.2, 0.12, 3.2, m.dark);
      this.lamp(x, 2.3, 69.66, 2.4, 0.3, 0.04, m.red);
      this.gates.push({ pos: V(x, 0, 61), dir: V(0, 0, -1) });
    }
    // Ships standing off on the horizon (dressing only).
    for (const [x, z, l] of [[-120, 190, 60], [40, 230, 80], [150, 170, 50]]) { this.dbox(x, 4, z, l, 8, 9, m.dark, false); this.dbox(x - l * 0.15, 11, z, l * 0.25, 6, 6, m.dark, false); }

    // --- Beach: obstacles on the sand and a sea wall with gaps ---
    for (let i = 0; i < 22; i++) {
      const x = -68 + ((i * 6.4 + r() * 3) % 136), z = 34 + r() * 20;
      // Keep the pier ramp, lighthouse point and the mid-beach spawn pad clear.
      if (Math.abs(x - 55) < 6 || x < -44 || Math.abs(x) < 4) continue;
      if (i % 3 === 0) crate(x, z, 1.3, m.dark); else this.barrier(x, z, i % 2 ? 2.4 : 0.6, i % 2 ? 0.6 : 2.4);
    }
    for (let k = -3; k <= 3; k++) {
      // Wall sections between 6 m gaps at x = -60, -36, -12, 12, 36, 60.
      const c = k * 24, half = k === -3 || k === 3 ? 6.5 : 9;
      if (Math.abs(c) < 80) B(Math.max(-76, c - half), Math.min(76, c + half), 28, 29.6, 0, 1.6, m.wall, { tex: 3 });
    }

    // --- East: pier ---
    B(52, 58, 50, 76, 1.2, 1.4, m.crate, { tex: 3 });
    for (let z = 52; z <= 74; z += 5.5) for (const x of [52.4, 57.6]) B(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 0, 1.2, m.dark, { tex: 1 });
    this.flight(55, 46.4, 'z', 1, 3.6, 3, 0, 1.4, { ramp: true });
    crate(53.2, 66, 1.2, m.crate, 1.4); crate(56.8, 58, 1.0, m.crate2, 1.4); crate(56.6, 72, 1.3, m.crate2, 1.4);
    house(62, 70, 40, 46, 4.2, m.contA);

    // --- West: lighthouse point ---
    B(-76, -52, 34, 58, 0, 2.6, m.pillar, { tex: 4 });
    B(-76, -62, 40, 52, 2.6, 5.2, m.pillar, { tex: 4 });
    this.flight(-45.4, 46, 'x', -1, 6.6, 3, 0, 2.6, { ramp: true });
    this.flight(-55.4, 46, 'x', -1, 6.6, 3, 2.6, 5.2, { solid: true });
    B(-71, -67, 44, 48, 5.2, 21, m.wall, { tex: 4 });
    this.lamp(-69, 19, 46, 4.2, 1.2, 4.2, m.core);
    this.dbox(-69, 21.4, 46, 4.8, 0.8, 4.8, m.dark);
    crate(-58, 37, 1.3, m.crate, 2.6); crate(-56, 55, 1.2, m.crate2, 2.6);

    // --- Bunker line: two pillboxes with a firing slit to seaward, a door at the back and a roof to stand on ---
    for (const s of [1, -1]) {
      const x0 = 36 * s - 6, x1 = 36 * s + 6;
      B(x0, x0 + 0.6, 10, 20, 0, 2.6, m.wall); B(x1 - 0.6, x1, 10, 20, 0, 2.6, m.wall);
      B(x0, x1, 19.4, 20, 0, 1.1, m.wall); B(x0, x1, 19.4, 20, 1.7, 2.6, m.wall);
      B(x0, 36 * s - 1.5, 10, 10.6, 0, 2.6, m.wall); B(36 * s + 1.5, x1, 10, 10.6, 0, 2.6, m.wall);
      B(36 * s - 1.5, 36 * s + 1.5, 10, 10.6, 2.2, 2.6, m.wall);
      B(x0, x1, 10, 20, 2.6, 3.0, m.wall, { tex: 4 });
      this.flight(36 * s - 4.5 * s, 2.4, 'z', 1, 7.6, 3, 0, 3.0, { solid: true });
      crate(36 * s + 3.5, 16, 1.2); crate(36 * s - 3.4, 13, 1.0, m.crate2);
      // Sandbag walls between and beside the bunkers.
      this.barrier(14 * s, 22, 10, 0.8); this.barrier(58 * s, 22, 10, 0.8); this.barrier(22 * s, 14, 0.8, 8); this.barrier(50 * s, 14, 0.8, 8);
      this.barrier(40 * s, -8, 16, 0.8); this.barrier(64 * s, -24, 0.8, 14);
    }

    // --- Battery: a gun platform with stairs on one side and a ramp on the other, and a post on top ---
    B(-9, 9, -30, -16, 0, 2.6, m.wall, { tex: 4 });
    this.flight(15.6, -20, 'x', -1, 6.6, 3, 0, 2.6, { ramp: true });
    this.flight(-15.6, -20, 'x', 1, 6.6, 3, 0, 2.6, { solid: true });
    B(-9, -4, -30, -25, 2.6, 5.2, m.wall, { tex: 3 });
    this.flight(2.6, -27.5, 'x', -1, 6.6, 3, 2.6, 5.2, { solid: true });
    B(3.5, 6.5, -25, -22, 2.6, 4.0, m.dark, { tex: 1.5 });
    this.dpipe(V(5, 3.9, -22.5), V(5, 5.6, -14.5), 0.32, m.dark);
    this.dbox(5, 4.2, -23.5, 3.6, 0.5, 3.6, m.trim);

    // --- Village: a street of houses, a church, and a ruin with an upper floor ---
    house(-60, -48, -50, -40, 7.5, m.contA); house(-40, -28, -50, -40, 8.5, m.wall);
    house(28, 40, -50, -40, 8, m.wall); house(48, 60, -50, -40, 7, m.contA);
    house(-56, -44, -72, -60, 8, m.wall); house(-34, -20, -72, -61, 7, m.contA);
    house(22, 34, -72, -60, 8.5, m.contA); house(44, 58, -72, -61, 7.5, m.wall);
    B(-7, 7, -74, -60, 0, 10, m.wall, { tex: 5 }); B(-3, 3, -70, -64, 10, 22, m.wall, { tex: 4 });
    this.dbox(0, 22.4, -67, 6.8, 0.8, 6.8, m.dark); this.lamp(0, 7, -59.96, 1.6, 3.2, 0.04, m.stripA);
    // Ruin: outer walls with a doorway to the street, stairs inside up to what is left of the upper floor.
    B(-12, -11.4, -48, -38, 0, 6.2, m.contA); B(11.4, 12, -48, -38, 0, 4.4, m.contA);
    B(-12, 12, -38.6, -38, 0, 5.4, m.contA, { tex: 4 });
    B(-12, 3, -48, -47.4, 0, 6.2, m.contA, { tex: 4 }); B(6, 12, -48, -47.4, 0, 3.6, m.contA); B(3, 6, -48, -47.4, 2.6, 3.4, m.contA);
    B(-11.4, 1.4, -47.4, -38.6, 3.0, 3.2, m.crate, { tex: 3 });
    this.flight(9.4, -40.5, 'x', -1, 8, 3, 0, 3.2);
    crate(-8, -44, 1.2, m.crate, 3.2); crate(8.5, -45, 1.3); crate(-4, -41, 1.0, m.crate2);
    // Yard walls, a well and carts along the street.
    this.barrier(-22, -55, 0.8, 6); this.barrier(18, -56, 6, 0.8); this.barrier(-44, -34, 10, 0.8); this.barrier(44, -34, 10, 0.8);
    B(15.2, 16.8, -45.8, -44.2, 0, 1.1, m.pillar, { tex: 1 });
    crate(-18, -44, 1.4, m.crate2); crate(40, -55, 1.5); crate(41.6, -54.4, 1.0, m.crate2); crate(-40, -56, 1.5); crate(62, -56, 1.2, m.crate2);

    // Pads inland, used when the player is too far from the landing craft.
    for (const s of [1, -1]) { pad(62 * s, 12); pad(22 * s, -6); pad(58 * s, -30); pad(30 * s, -64); pad(68 * s, -68); }
    pad(0, 38); pad(0, -44);
  }

  update(t: number, dt = 0, cam?: THREE.Vector3) {
    if (cam && this.big) {
      // The shadow map covers 72 m, so on a big map it follows the player in 4 m steps.
      const x = Math.round(cam.x / 4) * 4, z = Math.round(cam.z / 4) * 4, tg = this.sun.target.position;
      if (tg.x !== x || tg.z !== z) { tg.set(x, 0, z); this.sun.position.set(x + 14, 34, z + 9); this.sun.target.updateMatrixWorld(); }
    }
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
