import * as THREE from 'three';
import { Rig, box, cable, cyl, prismX, prismY, sphere, torus, tube, type Finish, type V2 } from './modelkit';
import { makeSurface } from './textures';

export type RobotKind = 'scuttler' | 'trooper' | 'drone' | 'heavy' | 'boss';

const hullMaps = makeSurface({ seed: 63, color: [255, 255, 255], panels: 2, stagger: true, roughness: 0.46, wear: 1.5, bump: 4 }, 512);
const mechMaps = makeSurface({ seed: 71, color: [255, 255, 255], panels: 0, roughness: 0.4, wear: 1.2, bump: 2.5 }, 256);

/** Shared by every robot: joints, struts, pistons. */
const mechMat = new THREE.MeshStandardMaterial({
  map: mechMaps.map, roughnessMap: mechMaps.roughnessMap, normalMap: mechMaps.normalMap, metalness: 0.85, roughness: 0.9, vertexColors: true,
});
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const rotorMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.38, depthWrite: false });

/** Armor material template; each robot gets its own copy so it can flash when hit. */
export const hullTemplate = new THREE.MeshStandardMaterial({
  map: hullMaps.map, roughnessMap: hullMaps.roughnessMap, normalMap: hullMaps.normalMap, metalness: 0.7, roughness: 1, vertexColors: true,
  normalScale: new THREE.Vector2(1.2, 1.2),
});
export const eyeTemplate = new THREE.MeshBasicMaterial();

/** Faint cool highlight on edges that face away from the camera, so robots keep a readable outline in dark arenas. */
export function rimLight(s: { fragmentShader: string }) {
  s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.3, 0.42, 0.6) * pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);');
}
hullTemplate.onBeforeCompile = rimLight;
mechMat.onBeforeCompile = rimLight;

const PALETTE: Record<RobotKind, { armor: number; paint: number; trim: number }> = {
  trooper: { armor: 0x6d7884, paint: 0x9a431f, trim: 0x2b3036 },
  scuttler: { armor: 0x6e6455, paint: 0x8a3c1c, trim: 0x2c2823 },
  drone: { armor: 0x5a626c, paint: 0xa8831d, trim: 0x25282d },
  heavy: { armor: 0x5f636b, paint: 0x842f1c, trim: 0xa8831d },
  boss: { armor: 0x4a4d55, paint: 0x8f1f18, trim: 0xa8831d },
};

function rig(kind: RobotKind, tex: number): Rig {
  const p = PALETTE[kind];
  const fin: Record<string, Finish> = {
    armor: { mat: 'hull', color: p.armor }, paint: { mat: 'hull', color: p.paint }, trim: { mat: 'hull', color: p.trim },
    frame: { mat: 'mech', color: 0x24272b }, steel: { mat: 'mech', color: 0x9aa1aa }, dark: { mat: 'mech', color: 0x0d0e10 },
    eye: { mat: 'eye', color: 0xffffff }, glow: { mat: 'glow', color: 0xffffff }, rotor: { mat: 'rotor', color: 0xffffff },
  };
  return new Rig({ hull: hullTemplate, mech: mechMat, eye: eyeTemplate, glow: glowMat, rotor: rotorMat }, fin, tex, ['eye', 'glow', 'rotor']);
}

/** Amber accent used on vents and indicator lights (vertex colors carry the HDR value). */
function amber(r: Rig, node: string, geo: THREE.BufferGeometry, p: [number, number, number]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  r.add(node, 'glow', g, { p });
}

function buildTrooper(): THREE.Group {
  const r = rig('trooper', 0.7);
  r.node('body', 'root').node('chest', 'body', [0, 1.12, 0]).node('head', 'chest', [0, 0.6, 0.02]);
  r.pair((s) => {
    const L = s > 0 ? 'legR' : 'legL', S = s > 0 ? 'shinR' : 'shinL';
    r.node(L, 'root', [0.16 * s, 0.98, 0]).node(S, L, [0, -0.46, 0.02]);
    r.add(L, 'frame', tube([0, 0, 0], [0, -0.46, 0.02], 0.07, 0.055))
      .add(L, 'armor', prismX([[-0.03, -0.03], [0.1, -0.05], [0.115, -0.33], [0.06, -0.42], [-0.02, -0.4]], 0.16, 0.014))
      .add(L, 'armor', box(0.035, 0.26, 0.13, 0.012), { p: [0.085 * s, -0.22, 0.0] })
      .add(L, 'steel', tube([0.05 * s, -0.04, -0.06], [0.045 * s, -0.42, -0.05], 0.013))
      .add(S, 'steel', cyl(0.062, 0.16, 'x'))
      .add(S, 'armor', box(0.11, 0.11, 0.05, 0.018), { p: [0, 0, 0.065] })
      .add(S, 'frame', tube([0, 0, 0], [0, -0.42, -0.03], 0.052, 0.04))
      .add(S, 'armor', prismX([[0.0, -0.07], [0.085, -0.09], [0.07, -0.35], [0.0, -0.4]], 0.125, 0.012))
      .add(S, 'steel', tube([0, -0.06, -0.055], [0, -0.38, -0.07], 0.012))
      .add(S, 'steel', cyl(0.04, 0.13, 'x'), { p: [0, -0.43, -0.03] })
      .add(S, 'frame', prismX([[-0.1, -0.52], [-0.1, -0.45], [0.02, -0.42], [0.2, -0.47], [0.22, -0.52]], 0.13, 0.012))
      .add(S, 'armor', box(0.135, 0.035, 0.12, 0.01), { p: [0, -0.455, 0.12], r: [0.28, 0, 0] });
    // Shoulder, arm
    r.add('chest', 'frame', sphere(0.085), { p: [0.3 * s, 0.47, 0] })
      .add('chest', 'paint', prismX([[-0.13, -0.02], [0.13, -0.02], [0.15, 0.07], [0.08, 0.14], [-0.08, 0.14], [-0.15, 0.07]], 0.15, 0.018), { p: [0.37 * s, 0.47, 0], r: [0, 0, -0.25 * s] })
      .add('chest', 'armor', box(0.2, 0.3, 0.035, 0.012), { p: [0.115 * s, 0.36, 0.215], r: [-0.12, 0.18 * s, 0] })
      .add('chest', 'steel', cyl(0.03, 0.16), { p: [0.11 * s, 0.6, -0.27] })
      .add('body', 'steel', tube([0.12 * s, 1.06, -0.02], [0.15 * s, 1.28, 0], 0.014));
  });
  // Hips and waist
  r.add('body', 'frame', prismX([[-0.12, 0.9], [0.12, 0.9], [0.15, 1.0], [0.1, 1.08], [-0.1, 1.08], [-0.14, 1.0]], 0.36, 0.014))
    .add('body', 'steel', cyl(0.075, 0.46, 'x'), { p: [0, 0.98, 0] })
    .add('body', 'armor', box(0.17, 0.15, 0.03, 0.01), { p: [0, 0.96, 0.15], r: [-0.2, 0, 0] });
  for (let i = 0; i < 3; i++) r.add('body', i === 1 ? 'steel' : 'frame', cyl(i === 1 ? 0.085 : 0.1, 0.05, 'y', 8), { p: [0, 1.1 + i * 0.05, 0] });
  // Chest
  r.add('chest', 'frame', prismX([[-0.16, 0.1], [0.14, 0.1], [0.2, 0.3], [0.19, 0.46], [0.08, 0.54], [-0.14, 0.54], [-0.2, 0.42], [-0.2, 0.2]], 0.44, 0.018))
    .add('chest', 'armor', box(0.26, 0.12, 0.03, 0.01), { p: [0, 0.17, 0.175], r: [0.28, 0, 0] })
    .add('chest', 'steel', cyl(0.036, 0.03, 'z'), { p: [0, 0.36, 0.228] })
    .add('chest', 'armor', box(0.3, 0.06, 0.27, 0.02), { p: [0, 0.56, 0] })
    .add('chest', 'armor', box(0.34, 0.36, 0.14, 0.022), { p: [0, 0.36, -0.24] })
    .add('chest', 'frame', tube([0.13, 0.54, -0.22], [0.16, 0.95, -0.27], 0.006));
  amber(r, 'chest', cyl(0.022, 0.012, 'z'), [0, 0.36, 0.24]);
  for (let i = 0; i < 4; i++) r.add('chest', 'dark', box(0.26, 0.014, 0.02), { p: [0, 0.25 + i * 0.045, -0.312] });
  // Gun arm (right) and free arm (left)
  r.add('chest', 'frame', tube([0.33, 0.42, 0], [0.38, 0.24, 0.1], 0.055, 0.05))
    .add('chest', 'armor', box(0.13, 0.15, 0.34, 0.022), { p: [0.38, 0.22, 0.28] })
    .add('chest', 'paint', box(0.135, 0.04, 0.2, 0.01), { p: [0.38, 0.29, 0.28] })
    .add('chest', 'frame', cyl(0.052, 0.26, 'z', 8), { p: [0.38, 0.22, 0.56] })
    .add('chest', 'steel', cyl(0.03, 0.12, 'z'), { p: [0.38, 0.22, 0.73] })
    .add('chest', 'dark', cyl(0.02, 0.122, 'z'), { p: [0.38, 0.22, 0.731] })
    .add('chest', 'frame', cable([[0.14, 0.3, -0.2], [0.3, 0.36, -0.1], [0.4, 0.34, 0.1], [0.39, 0.3, 0.22]], 0.018))
    .add('chest', 'frame', tube([-0.33, 0.42, 0], [-0.37, 0.14, 0.03], 0.055, 0.048))
    .add('chest', 'armor', box(0.035, 0.19, 0.1, 0.012), { p: [-0.415, 0.28, 0.015] })
    .add('chest', 'steel', cyl(0.05, 0.1, 'x'), { p: [-0.37, 0.12, 0.03] })
    .add('chest', 'frame', tube([-0.37, 0.12, 0.03], [-0.37, -0.14, 0.12], 0.05, 0.042))
    .add('chest', 'armor', box(0.04, 0.2, 0.1, 0.012), { p: [-0.41, -0.02, 0.085], r: [-0.33, 0, 0] })
    .add('chest', 'frame', box(0.07, 0.1, 0.09, 0.02), { p: [-0.37, -0.2, 0.14] });
  for (let i = 0; i < 3; i++) r.add('chest', 'steel', box(0.018, 0.07, 0.02, 0.006), { p: [-0.395 + i * 0.025, -0.27, 0.165], r: [-0.3, 0, 0] });
  // Head
  r.add('head', 'steel', cyl(0.045, 0.08), { p: [0, -0.02, 0] })
    .add('head', 'armor', prismX([[-0.13, 0.0], [0.1, 0.0], [0.15, 0.05], [0.14, 0.12], [0.07, 0.2], [-0.09, 0.2], [-0.14, 0.12]], 0.22, 0.022))
    .add('head', 'dark', box(0.2, 0.06, 0.03, 0.008), { p: [0, 0.085, 0.132], r: [-0.1, 0, 0] })
    .add('head', 'eye', box(0.17, 0.032, 0.02), { p: [0, 0.086, 0.142], r: [-0.1, 0, 0] })
    .add('head', 'steel', cyl(0.04, 0.26, 'x'), { p: [0, 0.07, -0.01] })
    .add('head', 'paint', box(0.022, 0.07, 0.14, 0.008), { p: [0, 0.215, -0.03] });
  return r.bake();
}

function buildScuttler(): THREE.Group {
  const r = rig('scuttler', 0.6);
  r.node('body', 'root');
  const shell: V2[] = [[0, 0.56], [0.3, 0.4], [0.4, 0.05], [0.34, -0.4], [0.14, -0.56], [-0.14, -0.56], [-0.34, -0.4], [-0.4, 0.05], [-0.3, 0.4]];
  r.add('body', 'frame', box(0.5, 0.2, 0.9, 0.05), { p: [0, 0.42, 0] })
    .add('body', 'armor', prismY(shell, 0.12, 0.035), { p: [0, 0.56, 0], r: [0.05, 0, 0] })
    .add('body', 'paint', prismY(shell.map((p) => [p[0] * 0.62, p[1] * 0.62] as V2), 0.07, 0.025), { p: [0, 0.655, -0.07], r: [0.05, 0, 0] })
    .add('body', 'frame', box(0.05, 0.05, 0.6, 0.015), { p: [0, 0.7, -0.1] })
    .add('body', 'armor', prismX([[0.38, 0.34], [0.62, 0.4], [0.67, 0.48], [0.6, 0.57], [0.38, 0.6]], 0.36, 0.022))
    .add('body', 'dark', box(0.29, 0.07, 0.03, 0.008), { p: [0, 0.495, 0.642] })
    .add('body', 'eye', box(0.26, 0.042, 0.02), { p: [0, 0.495, 0.655] })
    .add('body', 'frame', cyl(0.14, 0.26, 'z', 8), { p: [0, 0.46, -0.56] });
  for (const x of [-0.06, 0, 0.06]) amber(r, 'body', box(0.02, 0.1, 0.012), [x, 0.46, -0.694]);
  r.pair((s) => {
    r.add('body', 'eye', sphere(0.02, 8), { p: [0.11 * s, 0.425, 0.64] });
    r.add('body', 'steel', prismY([[0, 0], [0.05, 0.02], [0.035, 0.3], [0, 0.4]], 0.03, 0.006), { p: [0.13 * s, 0.37, 0.58], r: [0, -0.18 * s, 0], s: [s, 1, 1] });
    [0.3, 0, -0.3].forEach((z, i) => {
      const N = `leg${s > 0 ? 'R' : 'L'}${i}`;
      r.node(N, 'root', [0.3 * s, 0.42, z]);
      r.add('body', 'steel', sphere(0.075, 10), { p: [0.3 * s, 0.42, z] })
        .add(N, 'frame', tube([0, 0, 0], [0.3 * s, 0.22, 0], 0.045, 0.035))
        .add(N, 'armor', box(0.27, 0.04, 0.1, 0.014), { p: [0.16 * s, 0.165, 0], r: [0, 0, 0.63 * s] })
        .add(N, 'steel', sphere(0.052, 10), { p: [0.3 * s, 0.22, 0] })
        .add(N, 'frame', tube([0.3 * s, 0.22, 0], [0.46 * s, -0.42, 0], 0.04, 0.008, 8))
        .add(N, 'armor', box(0.05, 0.34, 0.075, 0.012), { p: [0.355 * s, 0.03, 0], r: [0, 0, 0.245 * s] });
    });
  });
  return r.bake();
}

function buildDrone(): THREE.Group {
  const r = rig('drone', 0.45);
  r.node('body', 'root');
  r.add('body', 'armor', sphere(0.26, 16), { s: [1, 0.5, 1.15], p: [0, 0.03, 0] })
    .add('body', 'frame', box(0.3, 0.13, 0.38, 0.05), { p: [0, -0.07, 0] })
    .add('body', 'frame', cyl(0.092, 0.12, 'z'), { p: [0, -0.01, 0.27] })
    .add('body', 'steel', torus(0.076, 0.013), { p: [0, -0.01, 0.33] })
    .add('body', 'dark', sphere(0.062, 12), { p: [0, -0.01, 0.31] })
    .add('body', 'eye', sphere(0.032, 12), { p: [0, -0.01, 0.348] })
    .add('body', 'paint', box(0.022, 0.08, 0.2, 0.006), { p: [0, 0.17, -0.08] })
    .add('body', 'frame', tube([0, 0.2, -0.16], [0, 0.34, -0.2], 0.005))
    .add('body', 'frame', box(0.09, 0.08, 0.2, 0.016), { p: [0, -0.18, 0.06] });
  r.pair((s) => {
    r.add('body', 'paint', box(0.04, 0.1, 0.3, 0.016), { p: [0.2 * s, 0, 0] })
      .add('body', 'steel', cyl(0.015, 0.2, 'z', 8), { p: [0.025 * s, -0.2, 0.24] })
      .add('body', 'steel', cyl(0.046, 0.08, 'z'), { p: [0.09 * s, -0.02, -0.3] });
    amber(r, 'body', cyl(0.03, 0.01, 'z'), [0.09 * s, -0.02, -0.342]);
    for (const z of [1, -1]) {
      const N = `rotor${s > 0 ? 'R' : 'L'}${z > 0 ? 'F' : 'B'}`;
      r.node(N, 'body', [0.4 * s, 0.12, 0.4 * z]);
      r.add('body', 'frame', tube([0.15 * s, 0.02, 0.15 * z], [0.4 * s, 0.06, 0.4 * z], 0.032, 0.022))
        .add('body', 'steel', cyl(0.046, 0.1), { p: [0.4 * s, 0.06, 0.4 * z] })
        .add('body', 'armor', torus(0.21, 0.02, 'y', 22), { p: [0.4 * s, 0.11, 0.4 * z] })
        .add(N, 'rotor', cyl(0.19, 0.006, 'y', 18))
        .add(N, 'frame', box(0.36, 0.008, 0.03), { p: [0, 0.002, 0] })
        .add(N, 'steel', cyl(0.03, 0.03));
    }
  });
  return r.bake();
}

function buildHeavy(): THREE.Group {
  const r = rig('heavy', 1.1);
  r.node('body', 'root').node('head', 'body', [0, 2.92, 0.1]);
  r.pair((s) => {
    const L = s > 0 ? 'legR' : 'legL', S = s > 0 ? 'shinR' : 'shinL';
    r.node(L, 'root', [0.46 * s, 1.5, 0]).node(S, L, [0, -0.72, 0.06]);
    r.add(L, 'steel', cyl(0.2, 0.32, 'x', 16))
      .add(L, 'armor', prismX([[-0.2, 0.1], [0.22, 0.1], [0.3, -0.3], [0.26, -0.72], [-0.1, -0.78], [-0.24, -0.4]], 0.4, 0.035))
      .add(L, 'paint', box(0.06, 0.5, 0.4, 0.02), { p: [0.23 * s, -0.3, 0.03] })
      .add(L, 'steel', tube([0, -0.05, -0.22], [0, -0.7, -0.14], 0.035))
      .add(S, 'steel', cyl(0.17, 0.46, 'x', 16))
      .add(S, 'armor', prismX([[0.1, 0.16], [0.26, 0.06], [0.26, -0.14], [0.1, -0.2]], 0.34, 0.03))
      .add(S, 'frame', prismX([[-0.16, 0.0], [0.16, 0.0], [0.14, -0.56], [-0.2, -0.6]], 0.34, 0.03))
      .add(S, 'armor', box(0.3, 0.4, 0.06, 0.02), { p: [0, -0.32, 0.165], r: [0.04, 0, 0] })
      .add(S, 'steel', tube([0, -0.1, -0.2], [0, -0.55, -0.23], 0.03))
      .add(S, 'steel', cyl(0.13, 0.42, 'x', 14), { p: [0, -0.62, -0.04] })
      .add(S, 'frame', prismX([[-0.34, -0.78], [-0.3, -0.62], [0.1, -0.58], [0.46, -0.68], [0.52, -0.78]], 0.5, 0.03));
    for (const x of [-0.17, 0, 0.17]) r.add(S, 'armor', prismX([[0.3, -0.78], [0.34, -0.64], [0.6, -0.72], [0.64, -0.78]], 0.13, 0.015), { p: [x, 0, 0] });
    // Torso plates, shoulder, missile pod, arm
    r.add('body', 'paint', box(0.52, 0.42, 0.07, 0.02), { p: [0.34 * s, 2.52, 0.6], r: [-0.08, 0.12 * s, 0] })
      .add('body', 'steel', cyl(0.22, 0.3, 'x', 16), { p: [0.78 * s, 2.62, 0] })
      .add('body', 'trim', box(0.6, 0.56, 0.86, 0.045), { p: [1.04 * s, 2.74, 0] })
      .add('body', 'frame', box(0.5, 0.46, 0.04, 0.01), { p: [1.04 * s, 2.74, 0.435] })
      .add('body', 'armor', box(0.66, 0.05, 0.9, 0.02), { p: [1.04 * s, 3.045, 0] })
      .add('body', 'steel', cyl(0.09, 0.6, 'y', 12), { p: [0.3 * s, 2.98, -0.62] })
      .add('body', 'dark', cyl(0.07, 0.61, 'y', 12), { p: [0.3 * s, 2.98, -0.62] })
      .add('body', 'frame', tube([1.0 * s, 2.42, 0], [1.06 * s, 1.8, 0.06], 0.17, 0.15, 12))
      .add('body', 'steel', cyl(0.16, 0.36, 'x', 14), { p: [1.06 * s, 1.76, 0.06] })
      .add('body', 'armor', prismX([[-0.2, 1.7], [0.24, 1.74], [0.34, 1.2], [0.2, 1.0], [-0.18, 1.06]], 0.4, 0.035), { p: [1.06 * s, 0, 0] })
      .add('body', 'paint', box(0.42, 0.14, 0.3, 0.02), { p: [1.06 * s, 1.5, 0.1] })
      .add('body', 'frame', cable([[0.6 * s, 2.2, -0.5], [0.85 * s, 2.3, -0.4], [1.0 * s, 2.1, -0.2], [1.04 * s, 1.8, -0.12]], 0.035));
    for (const x of [-0.13, 0, 0.13]) r.add('body', 'steel', prismX([[0.1, 1.04], [0.3, 1.1], [0.26, 0.78], [0.2, 0.74]], 0.08, 0.012), { p: [1.06 * s + x, 0, 0] });
    for (const ox of [-0.14, 0.14]) for (const oy of [-0.14, 0, 0.14]) {
      r.add('body', 'steel', cyl(0.078, 0.06, 'z', 12), { p: [1.04 * s + ox, 2.74 + oy, 0.45] })
        .add('body', 'dark', cyl(0.06, 0.062, 'z', 12), { p: [1.04 * s + ox, 2.74 + oy, 0.451] });
    }
    for (let i = 0; i < 5; i++) r.add('body', 'dark', box(0.05, 0.03, 0.5), { p: [0.645 * s, 2.1 + i * 0.07, -0.05] });
  });
  r.add('body', 'frame', prismX([[-0.3, 1.32], [0.3, 1.32], [0.38, 1.5], [0.3, 1.72], [-0.3, 1.72], [-0.4, 1.5]], 0.7, 0.03))
    .add('body', 'armor', box(0.5, 0.36, 0.06, 0.02), { p: [0, 1.48, 0.37], r: [-0.2, 0, 0] })
    .add('body', 'frame', cyl(0.48, 0.05, 'y', 20), { p: [0, 1.74, 0] })
    .add('body', 'steel', cyl(0.42, 0.14, 'y', 20), { p: [0, 1.8, 0] })
    .add('body', 'armor', prismX([[-0.5, 1.9], [0.42, 1.9], [0.62, 2.2], [0.6, 2.62], [0.36, 2.88], [-0.4, 2.88], [-0.6, 2.6], [-0.62, 2.1]], 1.3, 0.05))
    .add('body', 'armor', box(1.0, 0.26, 0.07, 0.02), { p: [0, 2.03, 0.535], r: [0.55, 0, 0] })
    .add('body', 'steel', torus(0.17, 0.04, 'z', 24), { p: [0, 2.22, 0.63] })
    .add('body', 'dark', cyl(0.14, 0.04, 'z', 20), { p: [0, 2.22, 0.62] })
    .add('body', 'eye', cyl(0.085, 0.04, 'z', 20), { p: [0, 2.22, 0.628] })
    .add('body', 'frame', box(0.9, 0.7, 0.3, 0.04), { p: [0, 2.4, -0.68] });
  for (let i = 0; i < 4; i++) r.add('body', 'dark', box(0.7, 0.03, 0.04), { p: [0, 2.2 + i * 0.1, -0.83] });
  r.add('head', 'steel', cyl(0.2, 0.08, 'y', 16), { p: [0, -0.02, 0] })
    .add('head', 'armor', prismX([[-0.2, 0], [0.16, 0], [0.26, 0.08], [0.22, 0.2], [0.06, 0.3], [-0.16, 0.3], [-0.22, 0.16]], 0.36, 0.03))
    .add('head', 'dark', box(0.31, 0.08, 0.04, 0.01), { p: [0, 0.13, 0.232], r: [-0.32, 0, 0] })
    .add('head', 'eye', box(0.27, 0.045, 0.03), { p: [0, 0.13, 0.243], r: [-0.32, 0, 0] })
    .add('head', 'steel', cyl(0.05, 0.42, 'x'), { p: [0, 0.1, -0.02] })
    .add('head', 'frame', tube([-0.12, 0.28, -0.1], [-0.14, 0.55, -0.14], 0.008));
  return r.bake();
}

/** The Warden: a hovering command unit with counter-rotating shield rings. */
function buildBoss(): THREE.Group {
  const r = rig('boss', 1.3);
  r.node('body', 'root').node('ringA', 'root').node('ringB', 'root');
  r.add('body', 'armor', sphere(1.2, 24), { s: [1, 0.82, 1] })
    .add('body', 'trim', cyl(1.3, 0.26, 'y', 24), { p: [0, 0.02, 0] })
    .add('body', 'frame', cyl(1.34, 0.08, 'y', 24), { p: [0, 0.02, 0] })
    .add('body', 'armor', cyl(0.7, 0.3, 'y', 12, 0.5), { p: [0, 0.95, 0] })
    .add('body', 'frame', tube([0.2, 1.05, -0.2], [0.3, 1.9, -0.3], 0.02))
    .add('body', 'frame', tube([-0.25, 1.05, -0.1], [-0.3, 1.6, -0.15], 0.02))
    .add('body', 'dark', cyl(0.56, 0.3, 'z', 20), { p: [0, 0, 1.02] })
    .add('body', 'steel', torus(0.5, 0.07, 'z', 28), { p: [0, 0, 1.17] })
    .add('body', 'eye', sphere(0.3, 16), { p: [0, 0, 1.08] })
    .add('body', 'frame', cyl(0.52, 0.5, 'y', 12), { p: [0, -0.95, 0] })
    .add('body', 'frame', box(0.5, 0.3, 0.7, 0.06), { p: [0, -1.05, 0.45] });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    r.add('body', 'paint', box(0.95, 0.9, 0.14, 0.05), { p: [Math.sin(a) * 1.17, 0.42, Math.cos(a) * 1.17], r: [-0.42, a, 0] });
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    r.add('body', 'steel', cyl(0.24, 0.4, 'y', 12), { p: [Math.sin(a) * 0.75, -0.95, Math.cos(a) * 0.75] });
    amber(r, 'body', cyl(0.18, 0.02, 'y', 12), [Math.sin(a) * 0.75, -1.16, Math.cos(a) * 0.75]);
  }
  r.pair((s) => {
    r.add('body', 'steel', cyl(0.095, 1.0, 'z', 12), { p: [0.35 * s, -1.05, 0.75] })
      .add('body', 'dark', cyl(0.06, 1.01, 'z', 12), { p: [0.35 * s, -1.05, 0.752] })
      .add('body', 'frame', tube([1.1 * s, 0.05, 0], [1.45 * s, 0.1, 0], 0.16, 0.13))
      .add('body', 'trim', box(0.55, 0.62, 0.95, 0.05), { p: [1.68 * s, 0.1, 0] })
      .add('body', 'frame', box(0.46, 0.52, 0.04, 0.01), { p: [1.68 * s, 0.1, 0.48] })
      .add('body', 'armor', box(0.6, 0.06, 1.0, 0.02), { p: [1.68 * s, 0.44, 0] });
    for (const ox of [-0.12, 0.12]) for (const oy of [-0.13, 0.13]) {
      r.add('body', 'steel', cyl(0.085, 0.06, 'z', 12), { p: [1.68 * s + ox, 0.1 + oy, 0.5] })
        .add('body', 'dark', cyl(0.065, 0.062, 'z', 12), { p: [1.68 * s + ox, 0.1 + oy, 0.501] });
    }
  });
  r.add('ringA', 'armor', torus(2.05, 0.085, 'y', 40));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    r.add('ringA', 'paint', box(0.8, 0.55, 0.09, 0.03), { p: [Math.sin(a) * 2.05, 0, Math.cos(a) * 2.05], r: [0, a, 0] });
  }
  r.add('ringB', 'frame', torus(1.72, 0.05, 'y', 36), { r: [0.45, 0, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    r.add('ringB', 'steel', sphere(0.13, 10), { p: [Math.sin(a) * 1.72, -Math.cos(a) * 1.72 * Math.sin(0.45), Math.cos(a) * 1.72 * Math.cos(0.45)] });
  }
  return r.bake();
}

// Amber accents are written as HDR vertex colors after baking.
const AMBER = new THREE.Color().setRGB(3.2, 1.3, 0.25);
function tintGlow(root: THREE.Group) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.mat !== 'glow') return;
    const c = m.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, AMBER.r, AMBER.g, AMBER.b);
  });
}

const templates = new Map<RobotKind, THREE.Group>();

export interface RobotModel {
  root: THREE.Group;
  hull: THREE.MeshStandardMaterial;
  eye: THREE.MeshBasicMaterial;
  node(name: string): THREE.Object3D;
}

/** Clones the shared template; geometry is reused, only two small materials are per-robot. */
export function createRobot(kind: RobotKind): RobotModel {
  let t = templates.get(kind);
  if (!t) {
    t = kind === 'trooper' ? buildTrooper() : kind === 'scuttler' ? buildScuttler() : kind === 'drone' ? buildDrone() : kind === 'boss' ? buildBoss() : buildHeavy();
    tintGlow(t);
    templates.set(kind, t);
  }
  const root = t.clone(true);
  const hull = hullTemplate.clone(), eye = eyeTemplate.clone();
  hull.onBeforeCompile = rimLight;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.mat === 'hull') m.material = hull;
    else if (m.userData.mat === 'eye') m.material = eye;
  });
  return { root, hull, eye, node: (name) => root.getObjectByName(name)! };
}
