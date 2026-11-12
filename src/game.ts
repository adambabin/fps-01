import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AudioSys } from './audio';
import { Effects } from './effects';
import { ENEMY_DEFS, EnemyManager, type Enemy, type EnemyCtx, type EnemyType } from './enemies';
import { PICKUP_AMMO, PICKUP_ARMOR, PICKUP_GRENADE, PICKUP_HEALTH, Pickups, Projectiles, type ProjCtx } from './entities';
import { Input } from './input';
import { FlowField } from './nav';
import { Player } from './player';
import { loadHighScore, loadSettings, saveHighScore, type Settings } from './settings';
import { UI, type Card, type RadarBlip } from './ui';
import { WEAPONS, WeaponSystem, type FireCtx } from './weapons';
import { World } from './world';

type State = 'menu' | 'playing' | 'paused' | 'upgrade' | 'dead';

/** Draws the first-person weapon over the world with its own depth range and FOV. */
class ViewmodelPass extends Pass {
  constructor(private scene: THREE.Scene, private camera: THREE.Camera) { super(); this.needsSwap = false; }
  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    if (!this.scene.visible) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}

interface Upgrade { name: string; desc: string; weapon?: boolean; ok?(g: Game): boolean; apply(g: Game): void; }

const UPGRADES: Upgrade[] = [
  { name: 'Hollow-point rounds', desc: '+20% damage with every weapon.', apply: (g) => (g.weapons.mods.damage *= 1.2) },
  { name: 'Tuned actuator', desc: '+15% rate of fire.', apply: (g) => (g.weapons.mods.fireRate *= 1.15) },
  { name: 'Extended magazines', desc: '+30% magazine capacity.', apply: (g) => (g.weapons.mods.mag *= 1.3) },
  { name: 'Speed loader', desc: 'Reload 22% faster.', apply: (g) => (g.weapons.mods.reload *= 0.78) },
  { name: 'Weak-point analyzer', desc: '+40% damage to sensor heads and weak points.', apply: (g) => (g.weapons.mods.crit *= 1.4) },
  { name: 'Reinforced frame', desc: '+25 maximum health and a full heal.', apply: (g) => { g.player.maxHealth += 25; g.player.health = g.player.maxHealth; } },
  { name: 'Ablative plating', desc: 'Fills armor now and raises the cap by 25.', apply: (g) => { g.player.maxArmor += 25; g.player.armor = g.player.maxArmor; } },
  { name: 'Servo boots', desc: '+10% movement speed.', apply: (g) => (g.player.speedMult *= 1.1) },
  { name: 'Deep pockets', desc: '+50% reserve ammo and a full resupply.', apply: (g) => { g.weapons.mods.reserve *= 1.5; g.weapons.addAmmo(1); } },
  { name: 'Bandolier', desc: 'Carry one more grenade and refill them.', apply: (g) => { g.weapons.maxGrenades++; g.weapons.grenades = g.weapons.maxGrenades; } },
  { name: 'Salvage protocol', desc: 'Each robot destroyed restores 3 health.', ok: (g) => g.lifesteal < 9, apply: (g) => (g.lifesteal += 3) },
  { name: 'Nanite weave', desc: 'Regenerate 3 health per second after 5 seconds without damage.', ok: (g) => g.player.regen < 9, apply: (g) => (g.player.regen += 3) },
];

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

export class Game {
  settings: Settings = loadSettings();
  input = new Input(this.settings);
  audio = new AudioSys();
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.08, 200);
  world: World;
  nav: FlowField;
  effects: Effects;
  player: Player;
  weapons: WeaponSystem;
  enemies: EnemyManager;
  projectiles: Projectiles;
  pickups: Pickups;
  ui: UI;
  state: State = 'menu';
  wave = 0;
  score = 0;
  kills = 0;
  lifesteal = 0;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private queue: EnemyType[] = [];
  private spawnT = 0;
  private intermission = 0;
  private clearT = 0;
  private offers: Upgrade[] = [];
  private navT = 0;
  private time = 0;
  private runTime = 0;
  private lastT = 0;
  private fps = 60;
  private deadT = 0;
  private pendingNumbers = new Map<Enemy, { dmg: number; crit: boolean; point: THREE.Vector3 }>();
  private enemyCtx: EnemyCtx;
  private projCtx: ProjCtx;
  private fireCtx: FireCtx;
  /** Automated-test mode: runs without pointer lock. */
  private test = new URLSearchParams(location.search).has('test');

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.enabled = true;

    this.world = new World(this.scene, this.renderer);
    this.nav = new FlowField(this.world.collision);
    this.effects = new Effects(this.scene);
    this.player = new Player(this.world.collision, this.audio);
    this.weapons = new WeaponSystem(this.scene, this.scene.environment);
    this.enemies = new EnemyManager(this.scene);
    this.projectiles = new Projectiles(this.scene);
    this.pickups = new Pickups(this.scene);
    // Faint light carried by the player so nearby surfaces never go fully black.
    this.camera.add(new THREE.PointLight(0xcfe0ff, 5, 13, 1.5));
    this.scene.add(this.camera);

    this.ui = new UI(this.settings, this.input, {
      play: () => this.startRun(),
      resume: () => this.resume(),
      restart: () => this.startRun(),
      quit: () => this.toMenu(),
      settingsChanged: () => this.applySettings(),
      pickUpgrade: (i) => this.pickUpgrade(i),
      click: () => { this.audio.unlock(); this.audio.ui(); },
    });
    this.ui.setBest(loadHighScore());

    const shared = { world: this.world.collision, effects: this.effects, audio: this.audio, player: this.player };
    this.enemyCtx = {
      ...shared, nav: this.nav, projectiles: this.projectiles,
      hurtPlayer: (a, from) => this.hurtPlayer(a, from),
      onKill: (e, crit) => this.onKill(e, crit),
    };
    this.projCtx = {
      ...shared,
      hurtPlayer: (a, from) => this.hurtPlayer(a, from),
      explode: (p, r, de, dp) => this.explode(p, r, de, dp),
      enemyNear: (p, r) => this.enemies.list.some((e) => e.center(tmpC).distanceTo(p) < r + e.def.radius),
    };
    this.fireCtx = {
      world: this.world.collision, enemies: this.enemies, effects: this.effects, audio: this.audio, camera: this.camera,
      hitEnemy: (e, dmg, crit, point, dir) => this.hitEnemy(e, dmg, crit, point, dir),
    };

    this.input.lookActive = () => this.state === 'playing' && this.locked();
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked() && this.state === 'playing') this.pause();
    });
    document.addEventListener('pointerlockerror', () => { if (this.state === 'playing' && !this.locked()) this.pause(); });
    canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.locked()) this.requestLock(); });
    window.addEventListener('keydown', (e) => {
      if (this.state === 'upgrade' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) this.pickUpgrade(Number(e.code.slice(5)) - 1);
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });

    this.applySettings();
    this.weapons.scene.visible = false;
    (window as any).game = this;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- setup ----------
  private locked(): boolean { return this.test || document.pointerLockElement === this.canvas; }

  private requestLock() {
    if (this.test) return;
    const fail = () => { if (this.state === 'playing' && !this.locked()) this.pause(); };
    try {
      const p = (this.canvas as any).requestPointerLock(this.settings.rawInput ? { unadjustedMovement: true } : undefined);
      if (p && p.catch) p.catch(() => {
        // Raw input is not supported everywhere; retry with the default mode.
        const q = (this.canvas as any).requestPointerLock();
        if (q && q.catch) q.catch(fail);
      });
    } catch { fail(); }
  }

  private buildComposer() {
    const q = this.settings.quality;
    const ratio = q === 'low' ? Math.min(1, window.devicePixelRatio) * 0.75 : q === 'medium' ? Math.min(1.25, window.devicePixelRatio) : Math.min(2, window.devicePixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.composer?.dispose();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ViewmodelPass(this.weapons.scene, this.weapons.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), q === 'high' ? 0.5 : 0.42, 0.55, 1.0);
    this.bloom.enabled = q !== 'low';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const sun = this.world.sun;
    sun.castShadow = q !== 'low';
    const ms = q === 'high' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== ms) {
      sun.shadow.mapSize.set(ms, ms);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }

  private applySettings() {
    this.audio.setVolume(this.settings.volume);
    this.buildComposer();
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.weapons.camera.aspect = w / h;
    this.weapons.camera.updateProjectionMatrix();
  }

  // ---------- flow ----------
  startRun() {
    this.audio.unlock();
    this.audio.startAmbient();
    this.enemies.clear(); this.projectiles.clear(); this.pickups.clear(); this.effects.clear();
    this.player.reset(); this.weapons.reset();
    this.wave = 0; this.score = 0; this.kills = 0; this.lifesteal = 0; this.runTime = 0;
    this.queue = []; this.clearT = 0; this.intermission = 2.5;
    this.state = 'playing';
    this.weapons.scene.visible = true;
    this.ui.show(null); this.ui.showHud(true);
    this.ui.announce('STAND BY', 'HOSTILES INBOUND', 2.2);
    this.input.reset();
    this.requestLock();
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.show('pause');
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.show(null);
    this.requestLock();
  }

  private toMenu() {
    this.state = 'menu';
    this.enemies.clear(); this.projectiles.clear(); this.pickups.clear(); this.effects.clear();
    this.weapons.scene.visible = false;
    this.ui.showHud(false); this.ui.show('menu');
    this.ui.setBest(loadHighScore());
  }

  private nextWave() {
    this.wave++;
    const w = this.wave;
    let budget = 4 + w * 3 + Math.floor(w * w * 0.12);
    const q: EnemyType[] = [];
    let heavies = Math.floor(w / 4);
    if (w % 5 === 0) heavies++;
    while (budget > 0) {
      const opts: [EnemyType, number][] = [['scuttler', 4], ['trooper', w >= 2 ? 3.5 : 1.5]];
      if (w >= 2) opts.push(['drone', 2.2]);
      if (w >= 4 && heavies > 0 && budget >= 5) opts.push(['heavy', 1.2]);
      let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), pick = opts[0][0];
      for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o[0]; break; } }
      if (pick === 'heavy') heavies--;
      q.push(pick);
      budget -= ENEMY_DEFS[pick].cost;
    }
    this.queue = q;
    this.spawnT = 1;
    this.ui.announce('WAVE ' + w, `${q.length} HOSTILES`);
    this.audio.waveStart();
  }

  private spawnNext() {
    const type = this.queue.shift()!;
    const hp = 1 + 0.07 * (this.wave - 1), dmg = 1 + 0.04 * (this.wave - 1);
    if (type === 'drone') {
      const v = this.world.vents[(Math.random() * this.world.vents.length) | 0];
      this.enemies.spawn(type, tmpA.copy(v).add(tmpB.set(Math.random() - 0.5, 0, Math.random() - 0.5)), hp, dmg);
      this.effects.sparks(v, tmpB.set(0, -1, 0), 6, 0.6, 2, 3);
    } else {
      // Prefer gates the player is not standing in.
      const gates = this.world.gates.filter((g) => g.pos.distanceTo(this.player.pos) > 12);
      const g = (gates.length ? gates : this.world.gates)[(Math.random() * (gates.length || 4)) | 0];
      tmpA.copy(g.pos).addScaledVector(tmpB.set(-g.dir.z, 0, g.dir.x), (Math.random() - 0.5) * 3.6);
      const e = this.enemies.spawn(type, tmpA, hp, dmg);
      e.yaw = Math.atan2(g.dir.x, g.dir.z);
      e.vel.copy(g.dir).multiplyScalar(e.def.speed);
    }
  }

  private waveCleared() {
    const bonus = 100 * this.wave;
    this.score += bonus;
    this.audio.waveClear();
    this.ui.announce('WAVE CLEARED', `+${bonus} BONUS`, 1.6);
    this.clearT = 1.6;
  }

  private offerUpgrades() {
    const offers: Upgrade[] = [];
    // Weapon unlocks are offered first until taken.
    for (const i of [2, 3]) {
      if (!this.weapons.states[i].unlocked && this.wave >= (i === 2 ? 1 : 3) && offers.length < 1) {
        const w = WEAPONS[i];
        offers.push({
          name: w.name, weapon: true,
          desc: i === 2 ? 'Unlock the pump shotgun. Ten pellets a shell; devastating up close.' : 'Unlock the railgun. Huge damage that punches through every robot in line.',
          apply: (g) => g.weapons.unlock(i),
        });
      }
    }
    const pool = UPGRADES.filter((u) => !u.ok || u.ok(this));
    while (offers.length < 3 && pool.length) offers.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
    this.offers = offers;
    this.state = 'upgrade';
    this.input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showUpgrades(this.wave, offers as Card[]);
  }

  private pickUpgrade(i: number) {
    if (this.state !== 'upgrade' || !this.offers[i]) return;
    this.offers[i].apply(this);
    this.audio.upgrade();
    this.ui.feed(`<b>${this.offers[i].name}</b> installed`);
    this.offers = [];
    this.player.health = Math.min(this.player.maxHealth, this.player.health + 20);
    this.intermission = 3.5;
    this.state = 'playing';
    this.ui.show(null);
    this.requestLock();
  }

  private gameOver() {
    this.state = 'dead';
    this.deadT = 0;
    this.weapons.scene.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const best = loadHighScore();
    if (this.score > best) saveHighScore(this.score);
    const m = Math.floor(this.runTime / 60), s = Math.floor(this.runTime % 60);
    setTimeout(() => {
      if (this.state !== 'dead') return;
      this.ui.showHud(false);
      this.ui.showGameOver([
        ['Wave reached', String(this.wave)], ['Score', this.score.toLocaleString() + (this.score > best ? '  ★ new best' : '')],
        ['Robots destroyed', String(this.kills)], ['Time survived', `${m}:${String(s).padStart(2, '0')}`],
      ]);
    }, 1400);
  }

  // ---------- combat callbacks ----------
  private hurtPlayer(amount: number, from: THREE.Vector3) {
    if (this.state !== 'playing' || this.player.dead) return;
    this.player.damage(amount);
    this.audio.hurt();
    this.ui.damageFlash(amount);
    const dx = from.x - this.player.pos.x, dz = from.z - this.player.pos.z;
    this.ui.damageDir(-(Math.atan2(dx, dz) - (this.player.yaw + Math.PI)));
    if (this.player.dead) this.gameOver();
  }

  private hitEnemy(e: Enemy, dmg: number, crit: boolean, point: THREE.Vector3, dir: THREE.Vector3) {
    const killed = this.enemies.damage(e, dmg, crit, this.enemyCtx, dir);
    this.ui.hitmarker(crit, killed);
    if (killed) this.audio.kill(); else this.audio.hit(crit);
    const n = this.pendingNumbers.get(e);
    if (n) { n.dmg += dmg; n.crit ||= crit; } else this.pendingNumbers.set(e, { dmg, crit, point: point.clone() });
  }

  private onKill(e: Enemy, crit: boolean) {
    this.kills++;
    const pts = Math.round(e.def.score * (crit ? 1.25 : 1));
    this.score += pts;
    this.ui.feed(`${e.def.name} destroyed <b>+${pts}</b>${crit ? ' · WEAK POINT' : ''}`);
    if (this.lifesteal) this.player.health = Math.min(this.player.maxHealth, this.player.health + this.lifesteal);
    const p = e.center(tmpC).clone();
    p.y = 0.5;
    const drops = e.type === 'heavy' ? 3 : 1;
    for (let i = 0; i < drops; i++) {
      const r = Math.random(), hurt = this.player.health < this.player.maxHealth * 0.5;
      const hp = hurt ? 0.2 : 0.09;
      let kind = -1;
      if (r < hp) kind = PICKUP_HEALTH;
      else if (r < hp + 0.17) kind = PICKUP_AMMO;
      else if (r < hp + 0.23) kind = PICKUP_ARMOR;
      else if (r < hp + 0.27) kind = PICKUP_GRENADE;
      else if (e.type === 'heavy') kind = i === 0 ? PICKUP_HEALTH : PICKUP_AMMO;
      if (kind >= 0) this.pickups.spawn(kind, tmpA.set(p.x + (Math.random() - 0.5) * drops, 0.5, p.z + (Math.random() - 0.5) * drops));
    }
  }

  private collect(kind: number): boolean {
    const p = this.player, w = this.weapons;
    let ok = false, label = '';
    if (kind === PICKUP_HEALTH && p.health < p.maxHealth) { p.health = Math.min(p.maxHealth, p.health + 25); ok = true; label = '+25 Health'; }
    else if (kind === PICKUP_ARMOR && p.armor < p.maxArmor) { p.armor = Math.min(p.maxArmor, p.armor + 30); ok = true; label = '+30 Armor'; }
    else if (kind === PICKUP_AMMO) { ok = w.addAmmo(0.3); label = 'Ammo'; }
    else if (kind === PICKUP_GRENADE && w.grenades < w.maxGrenades) { w.grenades++; ok = true; label = '+1 Grenade'; }
    if (ok) { this.audio.pickup(kind); this.ui.feed(label); }
    return ok;
  }

  private explode(pos: THREE.Vector3, radius: number, dmgEnemy: number, dmgPlayer: number) {
    this.effects.explosion(pos, radius / 5);
    this.audio.explosion(pos, true);
    if (dmgEnemy > 0) {
      for (const e of [...this.enemies.list]) {
        const c = e.center(tmpA), d = Math.max(0, c.distanceTo(pos) - e.def.radius);
        if (d < radius) this.hitEnemy(e, dmgEnemy * (1 - d / radius) ** 0.8, false, c.clone(), tmpB.subVectors(c, pos).normalize());
      }
    }
    const pc = tmpA.set(this.player.pos.x, this.player.pos.y + this.player.height / 2, this.player.pos.z);
    const d = pc.distanceTo(pos);
    if (d < radius && dmgPlayer > 0) this.hurtPlayer(dmgPlayer * (1 - d / radius), pos);
    if (d < radius * 2.5) this.player.shake = Math.min(1, this.player.shake + 0.6 * (1 - d / (radius * 2.5)));
  }

  // ---------- frame ----------
  private frame(t: number) {
    requestAnimationFrame((n) => this.frame(n));
    const raw = Math.min(0.1, (t - this.lastT) / 1000 || 0.016);
    this.lastT = t;
    this.fps += (1 / Math.max(raw, 0.001) - this.fps) * 0.05;
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    this.world.update(this.time);

    if (this.state === 'playing' && this.locked()) this.simulate(dt);
    else if (this.state === 'playing') this.ui.announce('CLICK TO CONTINUE', 'MOUSE NOT CAPTURED', 0.3);
    else if (this.state === 'menu') {
      const a = this.time * 0.07;
      this.camera.position.set(Math.cos(a) * 21, 4.6, Math.sin(a) * 21);
      this.camera.lookAt(0, 2.6, 0);
      this.setFov(60);
      this.effects.update(dt);
    } else if (this.state === 'dead') {
      // Let the fight play on briefly in slow motion as the camera drops.
      this.deadT += dt;
      const sdt = dt * 0.35;
      this.enemies.update(sdt, this.enemyCtx);
      this.projectiles.update(sdt, this.projCtx);
      this.effects.update(sdt);
      this.camera.position.y = Math.max(0.35, this.camera.position.y - dt * 1.6);
      this.camera.rotation.z = Math.min(0.5, this.deadT * 0.5);
    }

    this.composer.render();
    this.input.endFrame();
  }

  private setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.effects.setViewport(this.renderer.domElement.height, this.camera.fov);
  }

  private simulate(dt: number) {
    const p = this.player, w = this.weapons, input = this.input;
    this.runTime += dt;
    if (input.wasPressed('pause')) { this.pause(); return; }

    p.update(dt, input, this.settings, w.ads, w.wantsFire);
    const e = w.ads * w.ads * (3 - 2 * w.ads);
    const base = this.settings.fov + (p.sprinting ? 4 : 0);
    // Zoom is applied to the tangent so it feels the same at any base FOV.
    const fov = (2 * Math.atan(Math.tan((base * Math.PI) / 360) / (1 + (w.def.zoom - 1) * e)) * 180) / Math.PI;
    this.setFov(this.camera.fov + (fov - this.camera.fov) * Math.min(1, dt * 18));
    p.applyCamera(this.camera, w.ads);
    this.camera.updateMatrixWorld();

    w.update(dt, input, this.settings, p, this.fireCtx);

    if (input.wasPressed('grenade') && w.useGrenade()) {
      this.camera.getWorldDirection(tmpA);
      tmpB.copy(this.camera.position).addScaledVector(tmpA, 0.5); tmpB.y -= 0.15;
      tmpA.multiplyScalar(17); tmpA.y += 4; tmpA.addScaledVector(p.vel, 0.5);
      this.projectiles.spawn('grenade', tmpB, tmpA, 240 * w.mods.damage);
      this.audio.swap();
    }

    // Pathfinding refresh
    this.navT -= dt;
    if (this.navT <= 0) { this.navT = 0.2; this.nav.compute(p.pos.x, p.pos.z); }

    this.enemies.update(dt, this.enemyCtx);
    this.projectiles.update(dt, this.projCtx);
    this.pickups.update(dt, p, (k) => this.collect(k));
    this.effects.update(dt);
    if (this.state !== 'playing') return;

    // Wave director
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.nextWave();
    } else if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) { this.offerUpgrades(); return; }
    } else if (this.queue.length) {
      this.spawnT -= dt;
      const cap = Math.min(22, 9 + this.wave);
      if (this.spawnT <= 0 && this.enemies.list.length < cap) { this.spawnNext(); this.spawnT = Math.max(0.3, 1.1 - this.wave * 0.06); }
    } else if (this.enemies.list.length === 0 && this.wave > 0) this.waveCleared();

    // HUD
    const right = tmpA.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.audio.setListener(this.camera.position, right);
    const h = window.innerHeight;
    for (const [, n] of this.pendingNumbers) {
      tmpB.copy(n.point).project(this.camera);
      if (tmpB.z < 1) this.ui.number((tmpB.x * 0.5 + 0.5) * window.innerWidth, (-tmpB.y * 0.5 + 0.5) * h, n.dmg, n.crit);
    }
    this.pendingNumbers.clear();
    const spreadPx = (Math.tan(w.spread) / Math.tan((this.camera.fov * Math.PI) / 360)) * (h / 2);
    this.ui.update(dt, {
      health: p.health, maxHealth: p.maxHealth, armor: p.armor, maxArmor: p.maxArmor, wave: Math.max(1, this.wave),
      remaining: this.enemies.list.length + this.queue.length, score: this.score, weapons: w, spreadPx, ads: w.ads,
      sprinting: p.sprinting, fps: this.fps, intermission: this.intermission,
    });
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), blips: RadarBlip[] = [];
    for (const en of this.enemies.list) {
      const dx = en.pos.x - p.pos.x, dz = en.pos.z - p.pos.z;
      blips.push({ x: dx * cy - dz * sy, z: -dx * sy - dz * cy, kind: en.type === 'heavy' ? 3 : en.type === 'drone' ? 2 : 1 });
    }
    this.ui.drawRadar(blips);
  }
}
