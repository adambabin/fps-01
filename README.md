# Clanker Survival

A browser-based single-player wave-survival FPS. Fight escalating waves of robots in an
industrial facility, pick an upgrade after every wave, and see how far you get.

Built with Three.js, TypeScript and Vite. Every texture, model and sound is generated in
code, so there are no asset files to download or license.

## Run it

```bash
npm install
npm run dev
```

Then open the printed URL. `npm run build` type-checks and writes a static site to `dist/`.

## Controls

| Action | Mouse + keyboard | Trackpad-friendly alternative |
| --- | --- | --- |
| Move | W A S D | Arrow keys |
| Look | Mouse | Trackpad swipe |
| Fire | Left click | F |
| Aim down sights | Right click (hold) | Q |
| Reload | R | |
| Grenade | G | |
| Sprint / Crouch / Jump | Shift / C / Space | |
| Weapons | 1–4, scroll wheel, E for next | |
| Pause | Esc or P | |

Settings → **Apply trackpad preset** raises sensitivity, makes aiming a toggle and disables
scroll-to-switch. Every binding can be changed in Settings.

## What is in the foundation

- Movement: sprint, crouch, jump with coyote time, head bob, landing dip, FOV kick.
- Four weapons (sidearm, assault rifle, shotgun, piercing railgun) with recoil, spread bloom,
  damage falloff, reloads, aim-down-sights and weak-point multipliers, plus grenades.
- Four robots: melee Scuttler, ranged Trooper, flying Drone and rocket-firing Juggernaut,
  steered by a shared flow field so they path around cover.
- Wave director, score, pickups (health, armor, ammo, grenades) and 12 stackable upgrades.
- HUD with radar, hit markers, damage numbers and damage direction indicators.
- Low / Medium / High graphics presets (shadows, MSAA, HDR bloom).

## Code map

| File | Purpose |
| --- | --- |
| `src/game.ts` | Game state, wave director, render pipeline, combat callbacks |
| `src/player.ts` | First-person movement and camera |
| `src/weapons.ts` | Weapon stats, firing, viewmodels |
| `src/enemies.ts` | Robot AI, animation and hit detection |
| `src/modelkit.ts`, `src/robotModels.ts`, `src/gunModels.ts` | Procedural model toolkit, robot and weapon models |
| `src/entities.ts` | Projectiles and pickups |
| `src/world.ts` | Arena geometry, lighting, collision boxes |
| `src/physics.ts`, `src/nav.ts` | AABB collision and flow-field pathfinding |
| `src/effects.ts`, `src/textures.ts`, `src/audio.ts` | Particles, procedural textures, synthesized sound |
| `src/ui.ts`, `src/settings.ts`, `src/input.ts` | HUD, menus, settings and key bindings |

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.
Enable it once under **Settings → Pages → Source: GitHub Actions**.

Append `?test` to the URL to run without pointer lock (used for automated testing).
