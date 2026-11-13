# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Clanker Survival: a browser-based single-player wave-survival FPS (Three.js + TypeScript + Vite). Everything is procedural — there are no asset files. Textures, models and audio are all generated in code, and that is a deliberate constraint, not a placeholder.

The game was originally called RUSTWAKE. The `localStorage` keys in `settings.ts` (`rustwake.settings.v2`, `rustwake.best`) intentionally keep the old name so existing players don't lose their settings and best wave. Don't rename them without a migration.

Work is tracked in the Notion database "Clanker Survival Game Backlog" (Kanban grouped by Status: Backlog → In progress → Pending testing → Closed). When finishing a ticket, move it to Pending testing rather than Closed; the user closes tickets after testing.

## Commands

```bash
npm install
npm run dev        # Vite dev server
npm run build      # tsc --noEmit, then vite build to dist/
npm run preview    # serve dist/ (used for headless testing)
npx tsc --noEmit   # type-check only
```

There is no lint config and no test suite. Verification is done by driving the built game in headless Chromium (see below).

## Deployment

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` (live at https://adambabin.github.io/fps-01/). `vite.config.ts` sets `base: './'` so the build works under the repo sub-path. The `github-pages` environment only accepts deploys from branches on its allow-list (`main` and `claude/cool-wright-y437mu` at the time of writing).

## Architecture

`src/game.ts` (`Game`) owns everything: the renderer, the state machine (`menu | playing | paused | upgrade | dead`), the wave director, and the per-frame order of updates in `simulate()`. Subsystems never import `Game`; instead `Game` builds three context objects (`EnemyCtx`, `ProjCtx`, `FireCtx`) holding shared services plus callbacks (`hurtPlayer`, `onKill`, `hitEnemy`, `explode`) and passes them in. Add cross-system behaviour by extending a context, not by importing across subsystems.

**Simulation only runs while pointer-locked.** `frame()` calls `simulate(dt)` only when `state === 'playing' && locked()`. Losing pointer lock pauses the game. Screens that need a cursor (upgrade, pause, game over) exit pointer lock and re-request it from a user gesture.

**Rendering** is an `EffectComposer` chain rebuilt by `buildComposer()` whenever settings change: world `RenderPass` → `ViewmodelPass` → `UnrealBloomPass` → `OutputPass`, on a half-float MSAA target. The first-person weapon lives in a *separate scene and camera* (`WeaponSystem.scene/camera`) drawn after a depth clear, so it never clips into walls and has its own fixed FOV. Bloom threshold is 1.0, so anything meant to glow uses HDR colors above 1 (`color.setRGB(3, 1.2, 0.3)`), typically on `MeshBasicMaterial`.

**Light count must stay constant.** Three.js recompiles shaders when the number of lights changes, so muzzle flash and explosion lights are permanent `PointLight`s parked at intensity 0 (`Effects.flashes`, `WeaponSystem.muzzleLight`). Never add or remove lights at runtime.

**Collision and hits are custom, not Three.js raycasting.** The world is a list of axis-aligned boxes (`CollisionWorld` in `physics.ts`); `World.box()` adds the render mesh and the collider together. The player is an AABB moved one axis at a time. Bullets ray-test the boxes, then robots via per-type hit spheres (`SPHERES` in `enemies.ts`, with `crit` flags for weak points). If a robot model's proportions change, update `SPHERES`, `ENEMY_DEFS` and the muzzle offsets passed to `Enemy.fire()` to match.

**Arenas.** `World.load(id)` swaps the arena: it disposes the arena group, clears the *same* `CollisionWorld` instance (other systems hold references to it), rebuilds the shared shell plus one layout (`buildReactor`/`buildFoundry`/`buildVault`), and re-tints shared materials and the fixed set of lights from `THEMES`. After a load, call `nav.rebuild()`; `Game.syncArena()` does both. Every arena keeps the four wall gates, the ±30 m footprint and a clear spawn at (0, 0, 9). To add one: extend `ArenaId`, `ARENAS`, `THEMES`, and add a `build*` method.

**Boss.** The Warden is an `EnemyType` (`'boss'`) handled inside `Enemy.update`, spawned first on every fifth wave. It flies above cover, cycles barrage → rocket salvo → ground pulse (`Shockwaves` in `entities.ts`, dodged by jumping), and summons Scuttlers at 66% and 33% health through `EnemyCtx.summon`.

**Boss roster.** `bosses.ts` lists the bosses in arrival order (one per fifth wave, then repeating): name, hull tint and trait. `Game.spawn` copies the name to `Enemy.label` and sets `Enemy.tier`, which the boss branch of `Enemy.update` reads to vary its attacks. Rename bosses in that table only.

**Scoreboard.** Finished runs are stored in `localStorage` (`rustwake.scores.v1`, best 20) via `saveScore`/`loadScores` in `settings.ts`; there is no server, so scores are per device.

**Objectives.** `objectives.ts` runs one optional side objective per wave from wave 2 (never on boss waves): hold a zone, kill a marked Prime robot on a timer, or score kills by melee, weak point or explosives. `Game.hitSource` records how the damage being applied was dealt (`bullet | melee | blast`) and is read in `onKill`; set it around any new damage path. Completion calls `Game.objectiveDone()` (score, three pickups, and `bonusCard` for a fourth upgrade card).

**Melee and slide.** Melee is a timed swing in `WeaponSystem` that calls `FireCtx.melee` part-way through; `Game.melee()` does the cone test. Sliding lives in `Player.update`: pressing crouch while sprinting replaces ground movement with a decaying slide velocity until it ends or is jumped out of.

**Navigation** is one shared flow field (`nav.ts`): a BFS from the player's cell over a 64×64 grid, recomputed every 0.2 s. Ground robots follow it unless they have line of sight. Blocked cells are derived from collision boxes at construction, so it must be rebuilt whenever the arena changes.

**Models** are built with `modelkit.ts`. A `Rig` collects primitives (`box`, `tube`, `prismX`/`prismY` beveled extrusions, `cable`…) under named pivot nodes; `bake()` merges each node's parts into one mesh per material. Tints are stored as vertex colors via named *finishes*, so many colors share one material, and UVs are planar-projected from model space. Named nodes are what gets animated (`legR`, `shinR`, `chest`, `head`, `slide`, `mag`, `pump`). `robotModels.ts` builds one template per robot type and `createRobot()` clones it, giving each robot only its own `hull` and `eye` materials (for hit flash and attack telegraph). Robots face +Z; guns point −Z with a `sightY` that aim-down-sights aligns to screen centre.

**Pooling.** Particles, tracers, decals, debris, projectiles and pickups are all fixed pools created up front (`effects.ts`, `entities.ts`). Reuse them rather than allocating per shot.

**Balance data** lives in tables: `WEAPONS` (`weapons.ts`), `ENEMY_DEFS` (`enemies.ts`), `UPGRADES` and the wave budget in `nextWave()` (`game.ts`). Upgrades mutate `weapons.mods` or player stats.

**UI** is plain DOM declared in `index.html` and styled in `src/style.css`; `ui.ts` only toggles and fills it. Settings and key bindings (two slots per action, including `MouseN` codes) persist to `localStorage` via `settings.ts`.

## Headless testing

Appending `?test` to the URL bypasses pointer lock and the game instance is exposed as `window.game`. Software rendering in headless Chromium runs at a few FPS and each screenshot takes ~20 s, so do not wait in wall-clock time for game events. Instead step the simulation directly from `page.evaluate`:

```js
const g = window.game;
g.input.down.add('Mouse0');          // hold fire
g.simulate(1 / 60); g.input.endFrame();
```

Set `g.test = false` between scripted steps to stop the real-time loop from also advancing the game. Launch Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` against `npm run preview`. Mouse feel, audio and real frame rates cannot be verified this way.

## Balance

Difficulty multipliers live in `DIFFICULTY` (`settings.ts`) and scale robots only, never the player's weapons. `scripts/balance-bot.cjs` plays whole runs per difficulty in seconds and prints the wave reached; re-run it after changing `ENEMY_DEFS`, robot damage values in `enemies.ts`, the wave budget in `nextWave()`, or `DIFFICULTY`. At skill 1 the bot currently reaches roughly wave 10 on Easy, 5 on Normal and 4 on Hard; it does not use cover or seek pickups, so treat that as a floor for a human.
