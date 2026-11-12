import * as THREE from 'three';

/** Small deterministic RNG so textures are identical every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Tileable multi-octave value noise in [0,1]. */
function makeNoise(size: number, seed: number, baseCells = 8, octaves = 5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const r = rng(seed + o * 977);
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty), ya = (y0 % cells) * cells, yb = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx), xa = x0 % cells, xb = (x0 + 1) % cells;
        const a = g[ya + xa] + (g[ya + xb] - g[ya + xa]) * sx;
        const b = g[yb + xa] + (g[yb + xb] - g[yb + xa]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp; amp *= 0.5; cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export interface SurfaceOpts {
  seed: number;
  color: [number, number, number];
  /** Panels per texture side; 0 for no panel seams. */
  panels: number;
  /** Stagger alternate rows like plating. */
  stagger?: boolean;
  rivets?: boolean;
  ribs?: number;
  roughness: number;
  wear: number;
  bump: number;
  frame?: boolean;
}

export interface SurfaceMaps { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; }

function dataTex(data: Uint8Array<ArrayBuffer>, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Builds albedo, normal and roughness maps for a worn metal surface. */
export function makeSurface(o: SurfaceOpts, size = 512): SurfaceMaps {
  const n1 = makeNoise(size, o.seed, 4, 6);
  const n2 = makeNoise(size, o.seed + 31, 32, 3);
  const grime = makeNoise(size, o.seed + 77, 3, 4);
  const h = new Float32Array(size * size);
  const seam = new Float32Array(size * size);
  const r = rng(o.seed + 5);

  const cell = o.panels > 0 ? size / o.panels : 0;
  for (let y = 0; y < size; y++) {
    const row = cell ? Math.floor(y / cell) : 0;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let height = 0.5 + (n1[i] - 0.5) * 0.25 + (n2[i] - 0.5) * 0.12;
      if (cell) {
        const xo = o.stagger && row % 2 ? x + cell / 2 : x;
        const dx = Math.min(xo % cell, cell - (xo % cell)), dy = Math.min(y % cell, cell - (y % cell));
        const d = Math.min(dx, dy);
        if (d < 2.5) { height -= 0.55 * (1 - d / 2.5); seam[i] = 1 - d / 2.5; }
        else if (d < 6) height += 0.08 * (1 - (d - 2.5) / 3.5);
        if (o.frame && d < cell * 0.09 && d >= 2.5) height += 0.22;
        if (o.rivets) {
          const m = cell * 0.1;
          const rx = Math.min(Math.abs(dx - m), Math.abs(dx - cell / 2)), ry = Math.abs(dy - m);
          const rx2 = Math.abs(dx - m), ry2 = Math.min(Math.abs(dy - m), Math.abs(dy - cell / 2));
          const rd = Math.min(Math.hypot(rx, ry), Math.hypot(rx2, ry2));
          if (rd < 3.2) height += 0.35 * Math.cos((rd / 3.2) * Math.PI * 0.5);
        }
      }
      if (o.ribs) height += 0.18 * Math.max(0, Math.sin((x / size) * Math.PI * 2 * o.ribs)) ** 6;
      h[i] = height;
    }
  }
  // Scratches: thin bright lines, mostly along one axis.
  const scratch = new Float32Array(size * size);
  for (let s = 0; s < 90 * o.wear; s++) {
    let x = r() * size, y = r() * size;
    const ang = (r() - 0.5) * 0.9 + (r() < 0.5 ? 0 : Math.PI / 2), len = 20 + r() * 110, v = 0.3 + r() * 0.7;
    for (let t = 0; t < len; t++) {
      const xi = ((x | 0) + size) % size, yi = ((y | 0) + size) % size;
      scratch[yi * size + xi] = Math.max(scratch[yi * size + xi], v * (1 - t / len));
      x += Math.cos(ang); y += Math.sin(ang);
    }
  }

  const albedo = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, j = i * 4;
    const g = Math.max(0, (grime[i] - 0.45) * 2.2) * o.wear;
    let shade = 0.78 + (n1[i] - 0.5) * 0.5 + (n2[i] - 0.5) * 0.18;
    shade *= 1 - g * 0.45;
    shade *= 1 - seam[i] * 0.7;
    shade += scratch[i] * 0.35;
    // Rust-brown tint in the grimiest patches.
    const rust = Math.max(0, grime[i] - 0.62) * 2.2 * o.wear;
    albedo[j] = Math.min(255, o.color[0] * shade * (1 + rust * 0.5));
    albedo[j + 1] = Math.min(255, o.color[1] * shade * (1 - rust * 0.12));
    albedo[j + 2] = Math.min(255, o.color[2] * shade * (1 - rust * 0.4));
    albedo[j + 3] = 255;

    const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
    const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
    const nx = (xl - xr) * o.bump, ny = (yu - yd) * o.bump, inv = 1 / Math.hypot(nx, ny, 1);
    normal[j] = (nx * inv * 0.5 + 0.5) * 255;
    normal[j + 1] = (ny * inv * 0.5 + 0.5) * 255;
    normal[j + 2] = (inv * 0.5 + 0.5) * 255;
    normal[j + 3] = 255;

    const rv = Math.max(0.05, Math.min(1, o.roughness + (n2[i] - 0.5) * 0.3 + g * 0.45 + seam[i] * 0.3 - scratch[i] * 0.3));
    rough[j] = rough[j + 1] = rough[j + 2] = rv * 255; rough[j + 3] = 255;
  }
  return { map: dataTex(albedo, size, true), normalMap: dataTex(normal, size, false), roughnessMap: dataTex(rough, size, false) };
}

/** Yellow/black hazard stripes with wear, for floor markings. */
export function makeHazardTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16181a'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#c79a1c';
  for (let i = -256; i < 512; i += 64) {
    g.beginPath(); g.moveTo(i, 256); g.lineTo(i + 32, 256); g.lineTo(i + 288, 0); g.lineTo(i + 256, 0); g.fill();
  }
  const r = rng(9);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(10,10,12,${r() * 0.5})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 7, 1 + r() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Soft radial sprite, used for muzzle flash and scorch marks. */
export function makeRadialTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Spiky star for the muzzle flash. */
export function makeFlashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  const r = rng(3);
  for (let i = 0; i < 9; i++) {
    g.rotate((Math.PI * 2) / 9 + r() * 0.3);
    const len = 30 + r() * 32;
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, 'rgba(255,240,200,0.9)'); grad.addColorStop(1, 'rgba(255,140,30,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(len, 0); g.lineTo(0, 7); g.fill();
  }
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,190,90,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
