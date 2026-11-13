import * as THREE from 'three';
import { Rig, box, cable, cyl, prismX, torus, tube, type Finish, type V3 } from './modelkit';
import { makeSurface } from './textures';

const metalMaps = makeSurface({ seed: 91, color: [255, 255, 255], panels: 0, roughness: 0.4, wear: 1.3, bump: 2 }, 256);
const polyMaps = makeSurface({ seed: 95, color: [255, 255, 255], panels: 0, roughness: 0.72, wear: 0.5, bump: 5 }, 256);

const metalMat = new THREE.MeshStandardMaterial({ map: metalMaps.map, roughnessMap: metalMaps.roughnessMap, normalMap: metalMaps.normalMap, metalness: 0.85, roughness: 1, vertexColors: true });
const polyMat = new THREE.MeshStandardMaterial({ map: polyMaps.map, roughnessMap: polyMaps.roughnessMap, normalMap: polyMaps.normalMap, metalness: 0.05, roughness: 1, vertexColors: true });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.16, depthWrite: false });
const redMat = new THREE.MeshBasicMaterial(); redMat.color.setRGB(7, 0.5, 0.3);
const greenMat = new THREE.MeshBasicMaterial(); greenMat.color.setRGB(0.5, 4, 0.9);
/** Railgun energy glow; brightness is animated with the weapon's charge. */
export const railGlow = new THREE.MeshBasicMaterial(); railGlow.color.setRGB(0.4, 2.4, 4);

const FIN: Record<string, Finish> = {
  black: { mat: 'metal', color: 0x2b2f35 }, steel: { mat: 'metal', color: 0x8c939b }, dark: { mat: 'metal', color: 0x0c0d0f },
  brass: { mat: 'metal', color: 0xb08a3a }, plate: { mat: 'metal', color: 0x4a5058 },
  poly: { mat: 'poly', color: 0x1b1d20 }, rubber: { mat: 'poly', color: 0x0d0e0f }, shell: { mat: 'poly', color: 0x9a2219 },
  glove: { mat: 'poly', color: 0x1a1b1d }, sleeve: { mat: 'poly', color: 0x2f3a34 }, pad: { mat: 'poly', color: 0x3a3f45 },
  glass: { mat: 'glass', color: 0xffffff }, red: { mat: 'red', color: 0xffffff }, green: { mat: 'green', color: 0xffffff }, cyan: { mat: 'cyan', color: 0xffffff },
};

function rig(): Rig {
  return new Rig({ metal: metalMat, poly: polyMat, glass: glassMat, red: redMat, green: greenMat, cyan: railGlow }, FIN, 0.16);
}

/** Row of Picatinny-style teeth along Z. */
function rail(r: Rig, node: string, y: number, z0: number, z1: number, w = 0.022) {
  r.add(node, 'black', box(w, 0.007, Math.abs(z1 - z0)), { p: [0, y, (z0 + z1) / 2] });
  for (let z = Math.min(z0, z1) + 0.008; z < Math.max(z0, z1) - 0.004; z += 0.016) r.add(node, 'black', box(w + 0.003, 0.006, 0.008), { p: [0, y + 0.0055, z] });
}

/** Forearm with cuff and armor pad, from wrist back to an off-screen elbow. */
function forearm(r: Rig, node: string, wrist: V3, elbow: V3) {
  const lerp = (t: number): V3 => [wrist[0] + (elbow[0] - wrist[0]) * t, wrist[1] + (elbow[1] - wrist[1]) * t, wrist[2] + (elbow[2] - wrist[2]) * t];
  r.add(node, 'glove', tube(wrist, lerp(0.16), 0.03, 0.036, 12))
    .add(node, 'rubber', tube(lerp(0.14), lerp(0.2), 0.039, 0.04, 12))
    .add(node, 'sleeve', tube(lerp(0.18), elbow, 0.039, 0.055, 12))
    .add(node, 'pad', tube(lerp(0.3), lerp(0.72), 0.045, 0.054, 6));
}

/** Right hand wrapped around a pistol-style grip whose centre is at (0, y, z). */
function gripHand(r: Rig, node: string, y: number, z: number, elbow: V3 = [0.13, -0.34, 0.42]) {
  r.add(node, 'glove', box(0.044, 0.085, 0.042, 0.014), { p: [0.008, y, z + 0.022], r: [-0.26, 0, 0] })
    .add(node, 'glove', box(0.02, 0.022, 0.06, 0.008), { p: [-0.022, y + 0.038, z - 0.004], r: [0.1, 0, 0] })
    .add(node, 'glove', box(0.016, 0.016, 0.05, 0.006), { p: [0.021, y + 0.044, z - 0.03] });
  for (let i = 0; i < 3; i++) r.add(node, 'glove', box(0.05, 0.021, 0.03, 0.009), { p: [0, y + 0.012 - i * 0.024, z - 0.02 + i * 0.007], r: [-0.26, 0, 0] });
  for (let i = 0; i < 4; i++) r.add(node, 'pad', box(0.012, 0.016, 0.02, 0.005), { p: [0.03, y + 0.03 - i * 0.02, z + 0.012 + i * 0.006] });
  forearm(r, node, [0.012, y - 0.03, z + 0.05], elbow);
}

/** Left hand cupping a fore-end from below at (0, y, z). */
function supportHand(r: Rig, node: string, y: number, z: number, halfW: number, elbow: V3 = [-0.3, -0.36, 0.12]) {
  r.add(node, 'glove', box(halfW * 2 + 0.012, 0.03, 0.09, 0.012), { p: [0, y - 0.012, z] })
    .add(node, 'glove', box(0.018, 0.05, 0.026, 0.008), { p: [-halfW - 0.006, y + 0.016, z - 0.03], r: [0.3, 0, 0] });
  for (let i = 0; i < 4; i++) r.add(node, 'glove', box(0.018, 0.052, 0.019, 0.007), { p: [halfW + 0.005, y + 0.018, z - 0.034 + i * 0.022] });
  for (let i = 0; i < 4; i++) r.add(node, 'pad', box(0.008, 0.012, 0.016, 0.003), { p: [halfW + 0.014, y + 0.03, z - 0.034 + i * 0.022] });
  forearm(r, node, [-0.012, y - 0.03, z + 0.035], elbow);
}

export interface GunModel {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  /** Height of the sight line above the model origin. */
  sightY: number;
  slide?: THREE.Object3D;
  mag?: THREE.Object3D;
  pump?: THREE.Object3D;
  /** Support hand and forearm, moved during reloads. */
  off?: THREE.Object3D;
  /** Charging handle pulled on an empty reload. */
  bolt?: THREE.Object3D;
  /** Item shown in the support hand while reloading (a shotgun shell). */
  held?: THREE.Object3D;
  reload: ReloadSpec;
}

/**
 * How a gun reloads. Offsets are in model space, relative to the support hand's rest pose.
 * `mag`: drop the magazine and seat a fresh one; `shells`: load rounds one at a time;
 * `cylinder`: swing the cylinder out, load it and snap it shut.
 */
export interface ReloadSpec {
  style: 'mag' | 'shells' | 'cylinder';
  /** Where the support hand goes to grab the magazine, reach the loading port or the cylinder. */
  reach: V3;
  /** Where the support hand goes to rack the slide or charging handle on an empty reload. */
  rack?: V3;
  /** Gun pitch and roll at the height of the reload. */
  tilt: [number, number];
  /** How far the gun is brought up and in towards the centre, in view space. */
  lift?: V3;
}

function pistol(): GunModel {
  const r = rig();
  r.node('slide', 'root').node('mag', 'root').node('off', 'root');
  r.add('slide', 'black', prismX([[0.075, 0.04], [-0.118, 0.04], [-0.128, 0.03], [-0.128, 0.006], [0.075, 0.006]], 0.03, 0.004))
    .add('slide', 'steel', box(0.017, 0.004, 0.042), { p: [0.005, 0.0395, -0.03] })
    .add('slide', 'dark', box(0.004, 0.012, 0.04), { p: [0.0145, 0.03, -0.03] })
    .add('slide', 'black', box(0.004, 0.009, 0.01), { p: [0, 0.0445, -0.112] })
    .add('slide', 'green', box(0.002, 0.002, 0.001), { p: [0, 0.0465, -0.1065] });
  for (let i = 0; i < 6; i++) r.add('slide', 'dark', box(0.031, 0.022, 0.0035), { p: [0, 0.024, 0.028 + i * 0.008] });
  for (const s of [1, -1]) {
    r.add('slide', 'black', box(0.007, 0.01, 0.008), { p: [0.008 * s, 0.045, 0.066] })
      .add('slide', 'green', box(0.002, 0.002, 0.001), { p: [0.008 * s, 0.0465, 0.0705] });
  }
  r.add('root', 'steel', cyl(0.0075, 0.014, 'z'), { p: [0, 0.023, -0.126] })
    .add('root', 'dark', cyl(0.0048, 0.015, 'z'), { p: [0, 0.023, -0.127] })
    .add('root', 'poly', box(0.028, 0.02, 0.2, 0.004), { p: [0, -0.004, -0.022] })
    .add('root', 'poly', prismX([[0.02, -0.012], [0.075, -0.012], [0.105, -0.125], [0.05, -0.132]], 0.03, 0.006))
    .add('root', 'poly', box(0.02, 0.012, 0.03, 0.004), { p: [0, -0.002, 0.088] })
    .add('root', 'poly', box(0.008, 0.005, 0.06), { p: [0, -0.05, -0.002] })
    .add('root', 'poly', box(0.008, 0.042, 0.005), { p: [0, -0.032, -0.034], r: [-0.3, 0, 0] })
    .add('root', 'steel', box(0.006, 0.022, 0.006), { p: [0, -0.03, 0.006], r: [0.25, 0, 0] });
  for (let i = 0; i < 3; i++) r.add('root', 'poly', box(0.03, 0.004, 0.008), { p: [0, -0.0155, -0.07 - i * 0.015] });
  r.add('mag', 'poly', box(0.03, 0.01, 0.05, 0.003), { p: [0, -0.135, 0.078], r: [-0.25, 0, 0] })
    .add('mag', 'steel', box(0.02, 0.1, 0.034), { p: [0, -0.08, 0.064], r: [-0.25, 0, 0] });
  gripHand(r, 'root', -0.075, 0.06, [0.12, -0.3, 0.44]);
  // Support hand wraps the firing hand from the left.
  r.add('off', 'glove', box(0.03, 0.08, 0.06, 0.012), { p: [-0.03, -0.085, 0.062], r: [-0.26, 0, 0.12] });
  for (let i = 0; i < 4; i++) r.add('off', 'glove', box(0.02, 0.019, 0.05, 0.008), { p: [-0.012, -0.058 - i * 0.021, 0.036 + i * 0.006], r: [-0.26, 0.2, 0] });
  r.add('off', 'glove', box(0.018, 0.018, 0.06, 0.007), { p: [-0.026, -0.024, 0.03] });
  forearm(r, 'off', [-0.04, -0.11, 0.09], [-0.26, -0.36, 0.3]);
  const node = (n: string) => r.root.getObjectByName(n)!;
  return {
    group: r.bake(), muzzle: new THREE.Vector3(0, 0.023, -0.15), sightY: 0.0465, slide: node('slide'), mag: node('mag'), off: node('off'),
    reload: { style: 'mag', reach: [0.01, -0.06, 0.01], rack: [0.03, 0.085, -0.02], tilt: [0.05, -0.45], lift: [-0.04, 0.03, 0] },
  };
}

function rifle(): GunModel {
  const r = rig();
  r.node('mag', 'root').node('off', 'root').node('bolt', 'root');
  r.add('root', 'black', box(0.044, 0.052, 0.3, 0.006), { p: [0, 0.022, -0.01] })
    .add('root', 'black', prismX([[0.14, 0], [-0.14, 0], [-0.14, -0.03], [-0.09, -0.052], [-0.015, -0.052], [0, -0.03], [0.11, -0.03], [0.14, -0.012]], 0.04, 0.004))
    .add('root', 'steel', box(0.004, 0.018, 0.06), { p: [0.0225, 0.024, -0.03] })
    .add('root', 'dark', box(0.004, 0.012, 0.05), { p: [0.0232, 0.024, -0.03] })
    .add('bolt', 'black', cyl(0.007, 0.03, 'z'), { p: [0.026, 0.03, 0.09] })
    .add('root', 'black', box(0.05, 0.008, 0.02, 0.003), { p: [0, 0.044, 0.146] })
    .add('root', 'steel', cyl(0.005, 0.046, 'x'), { p: [0, 0.006, 0.04] })
    .add('root', 'steel', cyl(0.005, 0.046, 'x'), { p: [0, 0.006, -0.12] })
    .add('root', 'poly', box(0.05, 0.056, 0.27, 0.014), { p: [0, 0.02, -0.295] })
    .add('root', 'steel', cyl(0.0095, 0.16, 'z'), { p: [0, 0.02, -0.5] })
    .add('root', 'black', cyl(0.015, 0.03, 'z'), { p: [0, 0.02, -0.445] })
    .add('root', 'black', cyl(0.0155, 0.06, 'z', 8), { p: [0, 0.02, -0.6] })
    .add('root', 'dark', cyl(0.0075, 0.062, 'z'), { p: [0, 0.02, -0.601] })
    .add('root', 'poly', prismX([[0.07, -0.028], [0.108, -0.028], [0.15, -0.14], [0.108, -0.148]], 0.032, 0.007))
    .add('root', 'black', box(0.006, 0.004, 0.066), { p: [0, -0.064, 0.035] })
    .add('root', 'steel', box(0.006, 0.024, 0.008), { p: [0, -0.044, 0.046], r: [0.2, 0, 0] })
    .add('root', 'black', cyl(0.015, 0.2, 'z'), { p: [0, 0.022, 0.24] })
    .add('root', 'poly', prismX([[0.2, 0.045], [0.37, 0.048], [0.375, -0.075], [0.34, -0.085], [0.27, -0.02], [0.2, -0.012]], 0.042, 0.007))
    .add('root', 'rubber', box(0.044, 0.13, 0.012, 0.004), { p: [0, -0.016, 0.38] })
    .add('root', 'black', prismX([[-0.385, 0.056], [-0.405, 0.056], [-0.405, 0.072], [-0.395, 0.078], [-0.385, 0.072]], 0.012, 0.002))
    .add('root', 'black', cyl(0.013, 0.07, 'z'), { p: [-0.04, 0.02, -0.36] })
    .add('root', 'steel', cyl(0.011, 0.004, 'z'), { p: [-0.04, 0.02, -0.396] });
  for (let i = 0; i < 3; i++) r.add('root', 'dark', box(0.052, 0.012, 0.05, 0.004), { p: [0, 0.02, -0.21 - i * 0.07] });
  for (const z of [-0.585, -0.612]) r.add('root', 'dark', box(0.034, 0.007, 0.012), { p: [0, 0.02, z] });
  rail(r, 'root', 0.0515, -0.43, 0.13);
  // Reflex sight
  r.add('root', 'black', box(0.03, 0.012, 0.064, 0.003), { p: [0, 0.066, -0.04] })
    .add('root', 'black', box(0.046, 0.004, 0.05, 0.0015), { p: [0, 0.074, -0.04] })
    .add('root', 'black', box(0.046, 0.004, 0.05, 0.0015), { p: [0, 0.113, -0.04] })
    .add('root', 'black', cyl(0.008, 0.014, 'x'), { p: [0.03, 0.068, -0.04] })
    .add('root', 'glass', box(0.038, 0.036, 0.001), { p: [0, 0.0935, -0.052] })
    .add('root', 'red', box(0.0024, 0.0024, 0.0006), { p: [0, 0.0935, -0.051] });
  for (const s of [1, -1]) r.add('root', 'black', box(0.004, 0.04, 0.05, 0.0015), { p: [0.021 * s, 0.0935, -0.04] });
  r.add('mag', 'poly', prismX([[-0.022, -0.045], [-0.082, -0.045], [-0.105, -0.2], [-0.048, -0.21]], 0.028, 0.004));
  for (let i = 0; i < 3; i++) r.add('mag', 'rubber', box(0.03, 0.004, 0.052), { p: [0, -0.095 - i * 0.035, -0.062 - i * 0.006], r: [0.14, 0, 0] });
  gripHand(r, 'root', -0.085, 0.105);
  supportHand(r, 'off', -0.012, -0.27, 0.025);
  const node = (n: string) => r.root.getObjectByName(n)!;
  return {
    group: r.bake(), muzzle: new THREE.Vector3(0, 0.02, -0.64), sightY: 0.0935, mag: node('mag'), off: node('off'), bolt: node('bolt'),
    reload: { style: 'mag', reach: [0, -0.1, 0.2], rack: [0.035, 0.05, 0.35], tilt: [0.12, -0.5] },
  };
}

function shotgun(): GunModel {
  const r = rig();
  r.node('pump', 'root').node('off', 'pump').node('held', 'off');
  r.add('root', 'black', prismX([[0.13, 0.04], [-0.12, 0.04], [-0.12, -0.03], [0.06, -0.035], [0.13, -0.02]], 0.046, 0.006))
    .add('root', 'steel', box(0.004, 0.022, 0.07), { p: [0.0235, 0.012, -0.03] })
    .add('root', 'dark', box(0.004, 0.015, 0.06), { p: [0.0242, 0.012, -0.03] })
    .add('root', 'plate', cyl(0.014, 0.5, 'z'), { p: [0, 0.022, -0.37] })
    .add('root', 'dark', cyl(0.0105, 0.502, 'z'), { p: [0, 0.022, -0.371] })
    .add('root', 'black', cyl(0.013, 0.4, 'z'), { p: [0, -0.012, -0.32] })
    .add('root', 'steel', cyl(0.0145, 0.02, 'z'), { p: [0, -0.012, -0.528] })
    .add('root', 'black', box(0.04, 0.062, 0.015, 0.005), { p: [0, 0.005, -0.5] })
    .add('root', 'black', box(0.036, 0.012, 0.3, 0.004), { p: [0, 0.041, -0.3] })
    .add('root', 'poly', prismX([[0.13, 0.03], [0.2, 0.02], [0.4, 0.01], [0.405, -0.1], [0.37, -0.105], [0.24, -0.045], [0.19, -0.04], [0.215, -0.12], [0.17, -0.125], [0.13, -0.03]], 0.04, 0.007))
    .add('root', 'rubber', box(0.042, 0.115, 0.012, 0.004), { p: [0, -0.046, 0.408] })
    .add('root', 'black', box(0.006, 0.004, 0.07), { p: [0, -0.062, 0.1] })
    .add('root', 'steel', box(0.006, 0.022, 0.007), { p: [0, -0.046, 0.11], r: [0.2, 0, 0] })
    .add('root', 'black', box(0.004, 0.04, 0.11, 0.002), { p: [-0.0255, 0.008, 0.0] })
    .add('root', 'black', box(0.012, 0.01, 0.02, 0.002), { p: [0, 0.045, 0.08] })
    .add('root', 'black', torus(0.008, 0.002, 'z', 14), { p: [0, 0.058, 0.08] })
    .add('root', 'black', box(0.004, 0.014, 0.004), { p: [0, 0.051, -0.6] })
    .add('root', 'red', box(0.0035, 0.0035, 0.002), { p: [0, 0.058, -0.598] });
  for (let i = 0; i < 7; i++) r.add('root', 'dark', box(0.038, 0.006, 0.018, 0.002), { p: [0, 0.0445, -0.18 - i * 0.04] });
  for (let i = 0; i < 4; i++) {
    r.add('root', 'shell', cyl(0.0085, 0.04), { p: [-0.035, 0.01, -0.038 + i * 0.025] })
      .add('root', 'brass', cyl(0.0088, 0.011), { p: [-0.035, -0.0145, -0.038 + i * 0.025] });
  }
  r.add('pump', 'poly', box(0.05, 0.046, 0.16, 0.014), { p: [0, -0.014, -0.3] });
  for (let i = 0; i < 6; i++) r.add('pump', 'rubber', box(0.053, 0.036, 0.007, 0.002), { p: [0, -0.014, -0.245 - i * 0.022] });
  for (const s of [1, -1]) r.add('pump', 'steel', box(0.003, 0.006, 0.2), { p: [0.019 * s, -0.002, -0.19] });
  gripHand(r, 'root', -0.085, 0.19, [0.13, -0.34, 0.5]);
  supportHand(r, 'off', -0.04, -0.3, 0.025);
  // A shell held in the fingertips while loading.
  r.add('held', 'shell', cyl(0.0085, 0.05, 'z'), { p: [0, -0.012, -0.33] })
    .add('held', 'brass', cyl(0.0088, 0.012, 'z'), { p: [0, -0.012, -0.302] });
  const node = (n: string) => r.root.getObjectByName(n)!;
  return {
    group: r.bake(), muzzle: new THREE.Vector3(0, 0.022, -0.64), sightY: 0.058, pump: node('pump'), off: node('off'), held: node('held'),
    reload: { style: 'shells', reach: [0, -0.02, 0.23], tilt: [0.1, -0.7] },
  };
}

function railgun(): GunModel {
  const r = rig();
  r.node('mag', 'root').node('off', 'root');
  r.add('root', 'black', prismX([[0.16, 0.05], [-0.14, 0.05], [-0.18, 0.03], [-0.18, -0.04], [-0.1, -0.06], [0.12, -0.06], [0.16, -0.03]], 0.06, 0.008))
    .add('root', 'plate', box(0.064, 0.032, 0.17, 0.005), { p: [0, 0.004, 0] })
    .add('root', 'plate', prismX([[-0.18, 0.042], [-0.7, 0.036], [-0.725, 0.026], [-0.725, 0.02], [-0.18, 0.02]], 0.036, 0.004))
    .add('root', 'plate', prismX([[-0.18, -0.002], [-0.725, -0.002], [-0.725, -0.008], [-0.7, -0.02], [-0.18, -0.03]], 0.036, 0.004))
    .add('root', 'cyan', box(0.031, 0.014, 0.53), { p: [0, 0.009, -0.45] })
    .add('root', 'poly', prismX([[0.085, -0.055], [0.123, -0.055], [0.165, -0.165], [0.123, -0.172]], 0.034, 0.007))
    .add('root', 'black', box(0.006, 0.004, 0.066), { p: [0, -0.088, 0.05] })
    .add('root', 'steel', box(0.006, 0.022, 0.008), { p: [0, -0.072, 0.06], r: [0.2, 0, 0] })
    .add('root', 'poly', prismX([[0.16, 0.04], [0.41, 0.04], [0.41, -0.095], [0.375, -0.095], [0.375, 0.008], [0.16, 0.0]], 0.042, 0.007))
    .add('root', 'steel', tube([0, -0.04, 0.16], [0, -0.085, 0.385], 0.008))
    .add('root', 'rubber', box(0.044, 0.14, 0.012, 0.004), { p: [0, -0.028, 0.415] })
    .add('root', 'rubber', cable([[0.032, -0.05, -0.02], [0.046, -0.03, -0.12], [0.036, 0.0, -0.2], [0.028, 0.008, -0.31]], 0.0048))
    .add('root', 'rubber', cable([[-0.032, -0.04, 0.0], [-0.044, -0.01, -0.1], [-0.034, 0.02, -0.19], [-0.028, 0.012, -0.3]], 0.0048));
  for (let i = 0; i < 5; i++) {
    r.add('root', 'black', box(0.052, 0.078, 0.024, 0.006), { p: [0, 0.008, -0.24 - i * 0.1] })
      .add('root', 'steel', cyl(0.012, 0.062, 'x', 8), { p: [0, 0.008, -0.24 - i * 0.1] });
  }
  for (let i = 0; i < 3; i++) r.add('root', 'steel', box(0.05, 0.052, 0.005), { p: [0, 0.008, -0.675 - i * 0.016] });
  rail(r, 'root', 0.0535, -0.13, 0.14, 0.024);
  // Holographic sight
  r.add('root', 'black', box(0.034, 0.014, 0.07, 0.003), { p: [0, 0.066, -0.02] })
    .add('root', 'black', box(0.052, 0.004, 0.045, 0.0015), { p: [0, 0.121, -0.03] })
    .add('root', 'black', box(0.052, 0.004, 0.045, 0.0015), { p: [0, 0.074, -0.03] })
    .add('root', 'glass', box(0.044, 0.044, 0.001), { p: [0, 0.0975, -0.042] })
    .add('root', 'cyan', torus(0.0055, 0.0006, 'z', 20), { p: [0, 0.0975, -0.041] })
    .add('root', 'cyan', box(0.0016, 0.0016, 0.0006), { p: [0, 0.0975, -0.041] });
  for (const s of [1, -1]) r.add('root', 'black', box(0.004, 0.046, 0.045, 0.0015), { p: [0.024 * s, 0.0975, -0.03] });
  r.add('mag', 'poly', box(0.046, 0.07, 0.11, 0.008), { p: [0, -0.09, -0.07] })
    .add('mag', 'cyan', box(0.048, 0.012, 0.07), { p: [0, -0.09, -0.07] });
  gripHand(r, 'root', -0.112, 0.12);
  supportHand(r, 'off', -0.04, -0.33, 0.019);
  const node = (n: string) => r.root.getObjectByName(n)!;
  return {
    group: r.bake(), muzzle: new THREE.Vector3(0, 0.009, -0.74), sightY: 0.0975, mag: node('mag'), off: node('off'),
    reload: { style: 'mag', reach: [0, -0.06, 0.26], rack: [0.05, 0.06, 0.3], tilt: [0.1, -0.5] },
  };
}

function smg(): GunModel {
  const r = rig();
  r.node('mag', 'root').node('off', 'root');
  r.add('root', 'black', box(0.04, 0.058, 0.25, 0.007), { p: [0, 0.02, 0] })
    .add('root', 'black', prismX([[0.11, -0.008], [-0.125, -0.008], [-0.125, -0.034], [-0.06, -0.04], [0.02, -0.04], [0.11, -0.03]], 0.036, 0.004))
    .add('root', 'steel', box(0.004, 0.016, 0.05), { p: [0.0205, 0.024, -0.02] })
    .add('root', 'dark', box(0.004, 0.011, 0.042), { p: [0.0212, 0.024, -0.02] })
    .add('root', 'black', cyl(0.021, 0.17, 'z', 8), { p: [0, 0.02, -0.2] })
    .add('root', 'steel', cyl(0.012, 0.035, 'z'), { p: [0, 0.02, -0.3] })
    .add('root', 'dark', cyl(0.007, 0.037, 'z'), { p: [0, 0.02, -0.301] })
    .add('root', 'poly', prismX([[0.06, -0.028], [0.096, -0.028], [0.134, -0.13], [0.096, -0.138]], 0.03, 0.007))
    .add('root', 'black', box(0.006, 0.004, 0.062), { p: [0, -0.062, 0.03] })
    .add('root', 'steel', box(0.006, 0.022, 0.007), { p: [0, -0.046, 0.04], r: [0.2, 0, 0] })
    .add('root', 'poly', box(0.034, 0.03, 0.1, 0.01), { p: [0, -0.012, -0.19] })
    .add('root', 'rubber', box(0.04, 0.095, 0.012, 0.004), { p: [0, 0.0, 0.34] })
    .add('root', 'black', box(0.004, 0.012, 0.006), { p: [0, 0.058, -0.27] });
  for (let i = 0; i < 4; i++) r.add('root', 'dark', box(0.046, 0.009, 0.02, 0.003), { p: [0, 0.02, -0.14 - i * 0.035] });
  for (const s of [1, -1]) r.add('root', 'steel', tube([0.016 * s, 0.03, 0.12], [0.016 * s, 0.03, 0.335], 0.004, 0.004, 6));
  rail(r, 'root', 0.0495, -0.1, 0.11);
  // Compact reflex sight
  r.add('root', 'black', box(0.028, 0.01, 0.045, 0.003), { p: [0, 0.062, -0.01] })
    .add('root', 'black', box(0.04, 0.0035, 0.036, 0.0015), { p: [0, 0.069, -0.01] })
    .add('root', 'black', box(0.04, 0.0035, 0.036, 0.0015), { p: [0, 0.1, -0.01] })
    .add('root', 'glass', box(0.033, 0.028, 0.001), { p: [0, 0.0845, -0.02] })
    .add('root', 'red', box(0.0022, 0.0022, 0.0006), { p: [0, 0.0845, -0.019] });
  for (const s of [1, -1]) r.add('root', 'black', box(0.0035, 0.032, 0.036, 0.0015), { p: [0.0185 * s, 0.0845, -0.01] });
  r.add('mag', 'black', box(0.024, 0.2, 0.036, 0.004), { p: [0, -0.135, -0.03], r: [0.06, 0, 0] })
    .add('mag', 'rubber', box(0.028, 0.012, 0.04, 0.003), { p: [0, -0.238, -0.036], r: [0.06, 0, 0] });
  gripHand(r, 'root', -0.078, 0.092, [0.13, -0.33, 0.4]);
  supportHand(r, 'off', -0.027, -0.19, 0.017);
  const node = (n: string) => r.root.getObjectByName(n)!;
  return {
    group: r.bake(), muzzle: new THREE.Vector3(0, 0.02, -0.33), sightY: 0.0845, mag: node('mag'), off: node('off'),
    reload: { style: 'mag', reach: [0, -0.1, 0.16], rack: [0.035, 0.06, 0.22], tilt: [0.12, -0.5] },
  };
}

function launcher(): GunModel {
  const r = rig();
  r.node('mag', 'root').node('off', 'root');
  r.add('root', 'plate', cyl(0.031, 0.36, 'z', 16), { p: [0, 0.02, -0.33] })
    .add('root', 'dark', cyl(0.025, 0.362, 'z', 16), { p: [0, 0.02, -0.331] })
    .add('root', 'black', cyl(0.035, 0.03, 'z', 16), { p: [0, 0.02, -0.5] })
    .add('root', 'black', box(0.03, 0.02, 0.32, 0.005), { p: [0, 0.072, -0.08] })
    .add('root', 'black', prismX([[0.0, 0.082], [0.11, 0.07], [0.13, -0.03], [0.0, -0.07]], 0.05, 0.007))
    .add('root', 'black', box(0.044, 0.12, 0.022, 0.005), { p: [0, 0.01, -0.158] })
    .add('root', 'poly', prismX([[0.07, -0.03], [0.108, -0.03], [0.148, -0.14], [0.108, -0.148]], 0.032, 0.007))
    .add('root', 'black', box(0.006, 0.004, 0.066), { p: [0, -0.066, 0.04] })
    .add('root', 'steel', box(0.006, 0.024, 0.008), { p: [0, -0.048, 0.05], r: [0.2, 0, 0] })
    .add('root', 'poly', box(0.046, 0.04, 0.15, 0.013), { p: [0, -0.028, -0.3] })
    .add('root', 'black', cyl(0.014, 0.2, 'z'), { p: [0, 0.03, 0.2] })
    .add('root', 'poly', prismX([[0.2, 0.05], [0.37, 0.052], [0.375, -0.07], [0.34, -0.08], [0.27, -0.015], [0.2, -0.008]], 0.042, 0.007))
    .add('root', 'rubber', box(0.044, 0.13, 0.012, 0.004), { p: [0, -0.012, 0.38] })
    // Leaf sight with a glowing crossbar, and a front post
    .add('root', 'black', box(0.034, 0.003, 0.004), { p: [0, 0.122, -0.11] })
    .add('root', 'red', box(0.026, 0.0016, 0.002), { p: [0, 0.102, -0.11] })
    .add('root', 'red', box(0.003, 0.003, 0.002), { p: [0, 0.102, -0.111] })
    .add('root', 'black', box(0.004, 0.036, 0.004), { p: [0, 0.07, -0.49] });
  for (const s of [1, -1]) r.add('root', 'black', box(0.003, 0.042, 0.004), { p: [0.0155 * s, 0.102, -0.11] });
  // Six-round cylinder
  r.add('mag', 'black', cyl(0.06, 0.13, 'z', 12), { p: [0, 0.0, -0.075] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    r.add('mag', 'dark', cyl(0.017, 0.134, 'z', 10), { p: [Math.sin(a) * 0.037, Math.cos(a) * 0.037, -0.075] })
      .add('mag', 'brass', cyl(0.0155, 0.004, 'z', 10), { p: [Math.sin(a) * 0.037, Math.cos(a) * 0.037, -0.008] })
      .add('mag', 'plate', box(0.01, 0.012, 0.1, 0.003), { p: [Math.sin(a + 0.52) * 0.058, Math.cos(a + 0.52) * 0.058, -0.075], r: [0, 0, -a - 0.52] });
  }
  gripHand(r, 'root', -0.088, 0.105);
  supportHand(r, 'off', -0.048, -0.3, 0.023);
  const node = (n: string) => r.root.getObjectByName(n)!;
  return {
    group: r.bake(), muzzle: new THREE.Vector3(0, 0.02, -0.53), sightY: 0.102, mag: node('mag'), off: node('off'),
    reload: { style: 'cylinder', reach: [-0.08, 0.03, 0.2], tilt: [0.12, -0.55] },
  };
}

export function buildGun(i: number): GunModel {
  return i === 0 ? pistol() : i === 1 ? rifle() : i === 2 ? shotgun() : i === 3 ? railgun() : i === 4 ? smg() : launcher();
}
