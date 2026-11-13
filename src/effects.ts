import * as THREE from 'three';
import { makeHoleTexture, makeRadialTexture } from './textures';

const VERT = /* glsl */ `
attribute float psize;
attribute vec4 pcolor;
uniform float scale;
varying vec4 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG_ADD = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(vColor.rgb * vColor.a * a, 1.0);
}`;
const FRAG_SMOKE = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

interface EmitOpts {
  life: number; size: number; sizeEnd?: number; gravity?: number; drag?: number;
  r: number; g: number; b: number; a?: number;
  /** 0..1: how far the colour shifts from its start toward deep red as the particle dies, like cooling fire. */
  cool?: number;
}

/** CPU particle pool rendered as one draw call. */
class Particles {
  points: THREE.Points;
  private n: number;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array;
  private vel: Float32Array; private life: Float32Array; private max: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private grav: Float32Array; private drag: Float32Array;
  private base: Float32Array; private cool: Float32Array;
  private cursor = 0;
  private mat: THREE.ShaderMaterial;

  constructor(n: number, additive: boolean) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.base = new Float32Array(n * 4); this.cool = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: additive ? FRAG_ADD : FRAG_SMOKE,
      uniforms: { scale: { value: 500 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }

  setScale(v: number) { this.mat.uniforms.scale.value = v; }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: EmitOpts) {
    const i = this.cursor; this.cursor = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = o.life;
    this.s0[i] = o.size; this.s1[i] = o.sizeEnd ?? o.size;
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0; this.cool[i] = o.cool ?? 0;
    this.base[i * 4] = o.r; this.base[i * 4 + 1] = o.g; this.base[i * 4 + 2] = o.b; this.base[i * 4 + 3] = o.a ?? 1;
  }

  update(dt: number) {
    const { pos, vel, life, max, col, size, base } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) { size[i] = 0; col[i * 4 + 3] = 0; } continue; }
      life[i] -= dt;
      const k = Math.max(0, life[i] / max[i]), d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - this.grav[i] * dt; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { pos[i * 3 + 1] = 0.02; vel[i * 3 + 1] *= -0.35; vel[i * 3] *= 0.6; vel[i * 3 + 2] *= 0.6; }
      size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k;
      const heat = 1 - this.cool[i] * (1 - k);
      col[i * 4] = base[i * 4] * (0.4 + 0.6 * heat); col[i * 4 + 1] = base[i * 4 + 1] * heat * heat; col[i * 4 + 2] = base[i * 4 + 2] * heat * heat * heat;
      col[i * 4 + 3] = base[i * 4 + 3] * Math.min(1, k * 2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    (g.attributes.pcolor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() { this.life.fill(0); }
}

interface Tracer { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; }
interface Debris { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; size: number; }
interface Flash { light: THREE.PointLight; life: number; max: number; peak: number; }
interface Blast { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; radius: number; }

const rnd = (a: number) => (Math.random() - 0.5) * 2 * a;
const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  private glow = new Particles(1800, true);
  private smoke = new Particles(500, false);
  private tracers: Tracer[] = [];
  private tracerIdx = 0;
  private decals: THREE.Mesh[] = [];
  private holeMat: THREE.Material; private scorchMat: THREE.Material;
  private decalIdx = 0;
  private debris: Debris[] = [];
  private debrisIdx = 0;
  private flashes: Flash[] = [];
  private blasts: Blast[] = [];

  constructor(private scene: THREE.Scene) {
    scene.add(this.smoke.points, this.glow.points);
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 36; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(tg, mat);
      mesh.visible = false; mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, mat, life: 0, max: 1 });
    }
    const decal = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const dm = this.holeMat = decal(makeHoleTexture());
    this.scorchMat = decal(makeRadialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'));
    const dg = new THREE.PlaneGeometry(0.22, 0.22);
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(dg, dm);
      m.visible = false;
      scene.add(m);
      this.decals.push(m);
    }
    const debMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.5 });
    const debGeo = new THREE.BoxGeometry(1, 0.6, 0.8);
    for (let i = 0; i < 56; i++) {
      const mesh = new THREE.Mesh(debGeo, debMat);
      mesh.visible = false; mesh.castShadow = true;
      scene.add(mesh);
      this.debris.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, size: 0.1 });
    }
    // Lights stay in the scene permanently; changing the light count forces shader recompiles.
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 14, 1.6);
      scene.add(light);
      this.flashes.push({ light, life: 0, max: 1, peak: 0 });
    }
    const bg = new THREE.SphereGeometry(1, 20, 14);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(bg, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.blasts.push({ mesh, mat, life: 0, max: 1, radius: 1 });
    }
  }

  setViewport(height: number, fovDeg: number) {
    const s = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.glow.setScale(s); this.smoke.setScale(s);
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, r: number, g: number, bl: number, width = 0.012, life = 0.07) {
    const t = this.tracers[this.tracerIdx]; this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    t.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    t.mesh.lookAt(b);
    t.mesh.scale.set(width, width, len);
    t.mat.color.setRGB(r, g, bl);
    t.mat.opacity = 1;
    t.mesh.visible = true;
    t.life = t.max = life;
  }

  flash(pos: THREE.Vector3, color: number, intensity: number, life: number, range = 14) {
    let f = this.flashes[0];
    for (const c of this.flashes) if (c.life < f.life) f = c;
    f.light.position.copy(pos);
    f.light.color.setHex(color);
    f.light.distance = range;
    f.life = f.max = life; f.peak = intensity;
  }

  sparks(p: THREE.Vector3, n: THREE.Vector3, count: number, r = 3, g = 1.6, b = 0.5) {
    for (let i = 0; i < count; i++) {
      const sp = 2 + Math.random() * 6;
      this.glow.emit(p.x, p.y, p.z, n.x * sp + rnd(3), n.y * sp + rnd(3) + 1, n.z * sp + rnd(3),
        { life: 0.2 + Math.random() * 0.4, size: 0.05, sizeEnd: 0.01, gravity: 14, drag: 1, r, g, b });
    }
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, { life: 0.08, size: 0.5, sizeEnd: 0.1, r: r * 0.6, g: g * 0.6, b: b * 0.6 });
  }

  puff(p: THREE.Vector3, count: number, size = 0.5, shade = 0.22, linger = 1) {
    for (let i = 0; i < count; i++)
      this.smoke.emit(p.x + rnd(0.15 * size), p.y + rnd(0.15 * size), p.z + rnd(0.15 * size), rnd(0.7), 0.4 + Math.random() * 0.8, rnd(0.7),
        { life: (0.7 + Math.random() * 0.8) * linger, size: size * 0.5, sizeEnd: size * 1.8, drag: 1.5, r: shade, g: shade, b: shade * 1.05, a: 0.35 });
  }

  private nextDecal(mat: THREE.Material): THREE.Mesh {
    const d = this.decals[this.decalIdx]; this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.material = mat; d.visible = true;
    return d;
  }

  /** Burn mark left on the floor by an explosion. */
  scorch(x: number, z: number, radius: number) {
    const d = this.nextDecal(this.scorchMat);
    d.position.set(x, 0.02, z);
    d.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28);
    d.scale.setScalar(radius / 0.11);
  }

  trail(p: THREE.Vector3, r: number, g: number, b: number, size = 0.18) {
    this.glow.emit(p.x, p.y, p.z, rnd(0.3), rnd(0.3), rnd(0.3), { life: 0.25, size, sizeEnd: 0.02, r, g, b });
  }

  impact(p: THREE.Vector3, n: THREE.Vector3) {
    this.sparks(p, n, 7);
    this.puff(p, 1, 0.3, 0.3);
    const d = this.nextDecal(this.holeMat);
    d.position.copy(p).addScaledVector(n, 0.012);
    d.quaternion.setFromUnitVectors(Z, n);
    d.rotateZ(Math.random() * 6.28);
    const s = 0.7 + Math.random() * 0.8;
    d.scale.set(s, s, s);
  }

  explosion(p: THREE.Vector3, scale = 1, r = 3.5, g = 1.6, b = 0.4) {
    // Sparks, and a few slower embers that outlive the blast.
    for (let i = 0; i < 46 * scale; i++) {
      const v = new THREE.Vector3(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(3 + Math.random() * 11 * scale);
      this.glow.emit(p.x, p.y, p.z, v.x, v.y + 2, v.z, { life: 0.3 + Math.random() * 0.6, size: 0.09, sizeEnd: 0.01, gravity: 10, drag: 1.2, r, g, b, cool: 0.6 });
    }
    for (let i = 0; i < 12 * scale; i++)
      this.glow.emit(p.x, p.y, p.z, rnd(4 * scale), 2 + Math.random() * 5, rnd(4 * scale), { life: 0.9 + Math.random() * 1.1, size: 0.06, sizeEnd: 0.02, gravity: 5, drag: 0.7, r, g, b, cool: 0.9 });
    // White-hot core, then a fireball that rolls outward and cools to red.
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, { life: 0.1, size: 2.2 * scale, sizeEnd: 0.8, r: r * 0.7, g: r * 0.6, b: r * 0.42 });
    for (let i = 0; i < 14 * scale; i++)
      this.glow.emit(p.x + rnd(0.5 * scale), p.y + rnd(0.5 * scale), p.z + rnd(0.5 * scale), rnd(2.6 * scale), rnd(2) + 1.4, rnd(2.6 * scale),
        { life: 0.3 + Math.random() * 0.35, size: 1.1 * scale, sizeEnd: 2.0 * scale, drag: 2.4, r: r * 0.24, g: g * 0.24, b: b * 0.24, cool: 1 });
    this.puff(p, Math.ceil(9 * scale), 1.3 * scale, 0.12);
    this.puff(p, Math.ceil(5 * scale), 2.1 * scale, 0.07, 2.2);
    if (p.y < 2.2) this.scorch(p.x, p.z, 1.5 * scale);
    this.flash(p, 0xffa040, 320 * scale, 0.35, 12 + 10 * scale);
    const bl = this.blasts.find((x) => x.life <= 0);
    if (bl) {
      bl.mesh.position.copy(p); bl.mesh.visible = true;
      bl.mat.color.setRGB(r * 0.5, g * 0.5, b * 0.5);
      bl.life = bl.max = 0.22; bl.radius = 2.4 * scale;
    }
  }

  scatter(p: THREE.Vector3, count: number, size: number) {
    for (let i = 0; i < count; i++) {
      const d = this.debris[this.debrisIdx]; this.debrisIdx = (this.debrisIdx + 1) % this.debris.length;
      d.size = size * (0.5 + Math.random());
      d.mesh.position.set(p.x + rnd(0.3), p.y + rnd(0.3), p.z + rnd(0.3));
      d.mesh.scale.setScalar(d.size);
      d.mesh.visible = true;
      d.vel.set(rnd(5), 2 + Math.random() * 6, rnd(5));
      d.spin.set(rnd(9), rnd(9), rnd(9));
      d.life = 2.5 + Math.random() * 1.5;
    }
  }

  update(dt: number) {
    this.glow.update(dt); this.smoke.update(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / t.max);
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life > 0) { f.life -= dt; f.light.intensity = f.peak * Math.max(0, f.life / f.max) ** 2; }
      else if (f.light.intensity !== 0) f.light.intensity = 0;
    }
    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = 1 - Math.max(0, b.life / b.max);
      b.mesh.scale.setScalar(b.radius * (0.3 + k * 0.7));
      b.mat.opacity = (1 - k) * 0.9;
      if (b.life <= 0) b.mesh.visible = false;
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vel.y -= 20 * dt;
      const m = d.mesh;
      m.position.addScaledVector(d.vel, dt);
      const floor = d.size * 0.35;
      if (m.position.y < floor) {
        m.position.y = floor;
        d.vel.y *= -0.35; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.multiplyScalar(0.5);
      }
      m.rotation.x += d.spin.x * dt; m.rotation.y += d.spin.y * dt; m.rotation.z += d.spin.z * dt;
      if (d.life < 0.5) m.scale.setScalar(d.size * Math.max(0.001, d.life / 0.5));
      if (d.life <= 0) m.visible = false;
    }
  }

  clear() {
    this.glow.clear(); this.smoke.clear();
    for (const d of this.decals) d.visible = false;
    for (const d of this.debris) { d.life = 0; d.mesh.visible = false; }
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const b of this.blasts) { b.life = 0; b.mesh.visible = false; }
  }
}

export { UP };
