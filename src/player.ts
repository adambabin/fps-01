import * as THREE from 'three';
import type { AudioSys } from './audio';
import type { Input } from './input';
import type { CollisionWorld } from './physics';
import type { Settings } from './settings';

const STAND = 1.8, CROUCH = 1.15, RADIUS = 0.35;
const WALK = 5.0, SPRINT = 7.6, CROUCH_SPEED = 2.6, ADS_SPEED = 3.2;
const GRAVITY = 22, JUMP = 7.3;
/** Jumping out of a slide multiplies its speed by this, up to SLIDE_JUMP_MAX m/s. */
const SLIDE_JUMP_BOOST = 1.2, SLIDE_JUMP_MAX = 12.5;

export class Player {
  pos = new THREE.Vector3(0, 0, 9);
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  recoilPitch = 0;
  recoilYaw = 0;
  health = 100;
  maxHealth = 100;
  armor = 0;
  maxArmor = 100;
  speedMult = 1;
  regen = 0;
  /** Fraction of max health recovered automatically out of combat (set by difficulty). */
  regenTo = 0;
  grounded = true;
  crouching = false;
  sprinting = false;
  /** True during a slide: started by crouching while sprinting. */
  sliding = false;
  private slideT = 0;
  private slideCd = 0;
  private slideSpeed = 0;
  private sdx = 0;
  private sdz = 0;
  height = STAND;
  /** Seconds of immunity left (Last stand, Combat slide). */
  invuln = 0;
  /** Extra mid-air jumps allowed (Double jump), and how many remain before landing. */
  airJumps = 0;
  private airLeft = 0;
  /** True on the frame a slide begins. */
  slideStarted = false;
  /** Seconds since the last hit taken. */
  sinceHit = 99;
  shake = 0;
  /** 0..1 horizontal speed relative to walking, for spread and bob. */
  moveAmt = 0;
  bobPhase = 0;
  private crouchT = 0;
  private landDip = 0;
  private coyote = 0;
  private jumpBuf = 0;
  private roll = 0;
  private stepAcc = 0;
  private c = new THREE.Vector3();
  private h = new THREE.Vector3();

  constructor(private world: CollisionWorld, private audio: AudioSys) {}

  reset() {
    this.pos.set(0, 0, 9); this.vel.set(0, 0, 0);
    this.yaw = Math.PI; this.pitch = 0; this.recoilPitch = this.recoilYaw = 0;
    this.maxHealth = 100; this.health = 100; this.armor = 0; this.maxArmor = 100;
    this.speedMult = 1; this.regen = 0; this.sinceHit = 99; this.shake = 0;
    this.crouching = false; this.height = STAND; this.crouchT = 0; this.landDip = 0;
    this.sliding = false; this.slideCd = 0;
    this.invuln = 0; this.airJumps = this.airLeft = 0; this.slideStarted = false;
  }

  get eye(): number { return 1.62 + (1.0 - 1.62) * this.crouchT - this.landDip; }
  get dead(): boolean { return this.health <= 0; }

  /** Applies damage through armor. Returns the health actually lost. */
  damage(amount: number): number {
    if (this.dead) return 0;
    const absorbed = Math.min(this.armor, amount * 0.6);
    this.armor -= absorbed;
    const lost = amount - absorbed;
    this.health = Math.max(0, this.health - lost);
    this.sinceHit = 0;
    this.shake = Math.min(1, this.shake + amount / 40);
    return lost;
  }

  update(dt: number, input: Input, settings: Settings, ads: number, wantsFire: boolean, zoom = 1) {
    // Look
    // While aiming, turn rate drops with the zoom so the same hand motion covers the same
    // distance on screen; the ADS setting scales that matched rate.
    const sens = settings.sensitivity * 0.0012 * (1 + (settings.adsSensitivity / zoom - 1) * ads);
    this.yaw -= input.dx * sens;
    this.pitch -= input.dy * sens * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.54, Math.min(1.54, this.pitch));
    // Recoil settles slowly while the trigger is held, so sustained fire climbs and must
    // be pulled down, then snaps back once you let go.
    const rec = Math.exp(-(wantsFire ? 4.5 : 11) * dt);
    this.recoilPitch *= rec; this.recoilYaw *= rec;

    // Slide: crouch while sprinting. Carries momentum, keeps a low profile, and can be
    // cancelled into a jump.
    this.slideCd -= dt;
    this.slideStarted = false;
    this.invuln = Math.max(0, this.invuln - dt);
    if (input.wasPressed('crouch') && this.sprinting && this.grounded && this.slideCd <= 0) {
      const hs0 = Math.hypot(this.vel.x, this.vel.z) || 1;
      this.sliding = true; this.slideT = 0.85;
      this.sdx = this.vel.x / hs0; this.sdz = this.vel.z / hs0;
      this.slideSpeed = Math.max(hs0, SPRINT * this.speedMult) * 1.38;
      this.slideStarted = true;
      this.audio.slide();
    }

    // Crouch
    const wantCrouch = input.isDown('crouch') || this.sliding;
    if (wantCrouch && !this.crouching) { this.crouching = true; this.height = CROUCH; }
    else if (!wantCrouch && this.crouching) {
      this.h.set(RADIUS, STAND / 2 - 0.02, RADIUS);
      this.c.set(this.pos.x, this.pos.y + STAND / 2 + 0.02, this.pos.z);
      if (!this.world.overlaps(this.c, this.h)) { this.crouching = false; this.height = STAND; }
    }
    this.crouchT += ((this.crouching ? 1 : 0) - this.crouchT) * Math.min(1, dt * 12);

    // Wish direction
    const f = Math.max(-1, Math.min(1, (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0) + input.moveY + input.padY));
    const r = Math.max(-1, Math.min(1, (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0) + input.moveX + input.padX));
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * f + cy * r, wz = -cy * f - sy * r;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    if (this.sliding) {
      this.slideT -= dt;
      this.slideSpeed -= 7.5 * dt;
      // A little steering, then the slide's own velocity replaces normal ground movement.
      this.sdx += wx * 1.6 * dt; this.sdz += wz * 1.6 * dt;
      const sl = Math.hypot(this.sdx, this.sdz) || 1;
      this.sdx /= sl; this.sdz /= sl;
      const moving = Math.hypot(this.vel.x, this.vel.z);
      const released = !input.isDown('crouch') && this.slideT < 0.55;
      if (this.slideT <= 0 || this.slideSpeed < 3.6 || released || !this.grounded || (this.slideT < 0.75 && moving < this.slideSpeed * 0.4)) {
        this.sliding = false; this.slideCd = 0.35;
      } else { this.vel.x = this.sdx * this.slideSpeed; this.vel.z = this.sdz * this.slideSpeed; }
    }

    this.sprinting = input.isDown('sprint') && f > 0 && !this.crouching && ads < 0.2 && !wantsFire && this.grounded;
    let speed = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT : WALK;
    if (ads > 0.5) speed = Math.min(speed, ADS_SPEED);
    speed *= this.speedMult;
    // A stick pushed part-way walks slower; keys always give full speed.
    if (wl > 0) speed *= Math.min(1, Math.hypot(f, r));

    if (this.sliding) {
      // handled above
    } else if (this.grounded) {
      const k = Math.min(1, dt * (wl > 0 ? 11 : 14));
      this.vel.x += (wx * speed - this.vel.x) * k;
      this.vel.z += (wz * speed - this.vel.z) * k;
    } else {
      const before = Math.hypot(this.vel.x, this.vel.z);
      this.vel.x += wx * 16 * dt; this.vel.z += wz * 16 * dt;
      const after = Math.hypot(this.vel.x, this.vel.z), cap = Math.max(before, speed * 0.9);
      if (after > cap) { this.vel.x *= cap / after; this.vel.z *= cap / after; }
    }

    // Jump with a little buffering and coyote time so it never feels dropped.
    this.coyote = this.grounded ? 0.1 : this.coyote - dt;
    this.jumpBuf = input.wasPressed('jump') ? 0.12 : this.jumpBuf - dt;
    if (this.grounded) this.airLeft = this.airJumps;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      if (this.sliding) {
        // Slide jump: leave the slide with a burst on top of its momentum, capped so
        // chaining slides and jumps cannot keep stacking speed.
        const hs = Math.hypot(this.vel.x, this.vel.z), boosted = Math.min(hs * SLIDE_JUMP_BOOST, SLIDE_JUMP_MAX * this.speedMult);
        if (hs > 0.01 && boosted > hs) { this.vel.x *= boosted / hs; this.vel.z *= boosted / hs; }
        this.sliding = false; this.slideCd = 0.35;
      }
      this.vel.y = JUMP; this.grounded = false; this.coyote = 0; this.jumpBuf = 0;
      this.audio.jump();
    } else if (this.jumpBuf > 0 && !this.grounded && this.airLeft > 0) {
      this.vel.y = JUMP * 0.92; this.airLeft--; this.jumpBuf = 0; this.sliding = false;
      this.audio.jump();
    }
    this.vel.y -= GRAVITY * dt;

    // Collide
    const hh = this.height / 2;
    this.h.set(RADIUS, hh, RADIUS);
    this.c.set(this.pos.x, this.pos.y + hh, this.pos.z);
    if (this.world.moveAxis(this.c, this.h, 0, this.vel.x * dt)) this.vel.x = 0;
    if (this.world.moveAxis(this.c, this.h, 2, this.vel.z * dt)) this.vel.z = 0;
    const fall = this.vel.y;
    const wasGrounded = this.grounded;
    this.grounded = false;
    if (this.world.moveAxis(this.c, this.h, 1, this.vel.y * dt)) {
      if (this.vel.y < 0) {
        this.grounded = true;
        if (!wasGrounded && fall < -4) {
          const hard = Math.min(1, (-fall - 4) / 10);
          this.landDip = 0.08 + hard * 0.22;
          this.audio.land(hard);
        }
      }
      this.vel.y = 0;
    }
    this.pos.set(this.c.x, this.c.y - hh, this.c.z);

    // Bob, steps, misc
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moveAmt = Math.min(1.6, hs / WALK);
    if (this.grounded && hs > 0.5) {
      this.bobPhase += hs * dt * 1.75;
      this.stepAcc += hs * dt;
      if (this.stepAcc > (this.sprinting ? 2.5 : 2.0)) { this.stepAcc = 0; if (!this.crouching) this.audio.step(this.sprinting); }
    }
    this.landDip *= Math.exp(-9 * dt);
    this.shake *= Math.exp(-5 * dt);
    this.roll += ((this.sliding ? 0.07 : -r * 0.012 * (this.grounded ? 1 : 0.3)) - this.roll) * Math.min(1, dt * 8);
    this.sinceHit += dt;
    if (this.sinceHit > 5 && this.health > 0) {
      if (this.regen > 0) this.health = Math.min(this.maxHealth, this.health + this.regen * dt);
      const floor = this.maxHealth * this.regenTo;
      if (this.health < floor) this.health = Math.min(floor, this.health + 7 * dt);
    }
  }

  applyCamera(cam: THREE.PerspectiveCamera, ads: number) {
    const amt = Math.min(1, this.moveAmt) * (this.grounded ? 1 : 0) * (1 - ads * 0.8);
    const bobY = Math.sin(this.bobPhase * 2) * 0.028 * amt;
    const bobX = Math.cos(this.bobPhase) * 0.02 * amt;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    cam.position.set(this.pos.x + cy * bobX, this.pos.y + this.eye + bobY, this.pos.z - sy * bobX);
    const sh = this.shake * 0.035;
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.recoilYaw + (Math.random() - 0.5) * sh;
    cam.rotation.x = Math.max(-1.56, Math.min(1.56, this.pitch + this.recoilPitch + (Math.random() - 0.5) * sh));
    cam.rotation.z = this.roll + (Math.random() - 0.5) * sh;
  }
}
