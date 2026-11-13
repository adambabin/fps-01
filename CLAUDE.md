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

**Touch devices.** Phones and tablets have no Pointer Lock API, so `isTouchDevice()` (`touch.ts`: coarse pointer, no fine pointer, or `?touch` in the URL) switches the game to touch mode. `locked()` is then always true and `requestLock()` just shows the on-screen controls (`TouchControls`: floating move stick on the left, drag-to-look on the right, action buttons). They feed `Input` through `virtualDown`/`virtualUp` actions, the analog `moveX`/`moveY`, and `dx`/`dy`, so game code reads them like keys and the mouse. Hide them (`touch?.show(false)`) on any new screen that leaves play. `body.touch` CSS rearranges the HUD around the buttons. Desktop behaviour is unchanged when touch mode is off.

**Rendering** is an `EffectComposer` chain rebuilt by `buildComposer()` whenever settings change: world `RenderPass` → `ViewmodelPass` → `UnrealBloomPass` → `OutputPass`, on a half-float MSAA target. The first-person weapon lives in a *separate scene and camera* (`WeaponSystem.scene/camera`) drawn after a depth clear, so it never clips into walls and has its own fixed FOV. Bloom threshold is 1.0, so anything meant to glow uses HDR colors above 1 (`color.setRGB(3, 1.2, 0.3)`), typically on `MeshBasicMaterial`.

**Light count must stay constant.** Three.js recompiles shaders when the number of lights changes, so muzzle flash and explosion lights are permanent `PointLight`s parked at intensity 0 (`Effects.flashes`, `WeaponSystem.muzzleLight`). Never add or remove lights at runtime.

**Collision and hits are custom, not Three.js raycasting.** The world is a list of axis-aligned boxes (`CollisionWorld` in `physics.ts`); `World.box()` adds the render mesh and the collider together. The player is an AABB moved one axis at a time. Bullets ray-test the boxes, then robots via per-type hit spheres (`SPHERES` in `enemies.ts`, with `crit` flags for weak points). If a robot model's proportions change, update `SPHERES`, `ENEMY_DEFS` and the muzzle offsets passed to `Enemy.fire()` to match.

**Arenas.** `World.load(id)` swaps the arena: it disposes the arena group, clears the *same* `CollisionWorld` instance (other systems hold references to it), rebuilds the shared shell plus one layout (`buildReactor`, `buildFoundry`, `buildVault`, `buildYard`, `buildFrost`), and re-tints shared materials and the fixed set of lights from `THEMES`. After a load, call `nav.rebuild()`; `Game.syncArena()` does both. Every arena keeps the four wall gates, the ±30 m footprint and a clear spawn at (0, 0, 9). To add one: extend `ArenaId`, `ARENA_ORDER`, `ARENAS`, `THEMES`, and add a `build*` method. A theme with `outdoor: true` drops the roof (an invisible lid collider keeps grenades and the boss in bounds), lowers the visible wall, sets a sky colour and can turn on `weather` (`rain` or `snow`: particle volumes that follow the camera, updated in `World.update`). With `settings.rotate` on, the boss wave's upgrade pick sets `Game.awaitReady`: the run waits (and `Pickups.hold` stops drops expiring) until the player presses the `ready` action (Enter, or the NEXT ARENA touch button), then `Game.travel()` loads the next arena in `ARENA_ORDER`. `ready` also skips the normal countdown between waves.

**Boss.** The Warden is an `EnemyType` (`'boss'`) handled inside `Enemy.update`, spawned first on every fifth wave. It flies above cover, cycles barrage → rocket salvo → ground pulse (`Shockwaves` in `entities.ts`, dodged by jumping), and summons Scuttlers at 66% and 33% health through `EnemyCtx.summon`.

**Boss roster.** `bosses.ts` lists the bosses in arrival order (one per fifth wave, then repeating): name, hull tint and trait. `Game.spawn` copies the name to `Enemy.label` and sets `Enemy.tier`, which the boss branch of `Enemy.update` reads to vary its attacks. Rename bosses in that table only.

**Scoreboard.** Finished runs are stored in `localStorage` (`rustwake.scores.v1`, best 20) via `saveScore`/`loadScores` in `settings.ts`; there is no server, so scores are per device.

**Objectives.** `objectives.ts` runs one optional side objective per wave from wave 2 (never on boss waves): hold a zone, kill a marked Prime robot on a timer, or score kills by melee, weak point or explosives. `Game.hitSource` records how the damage being applied was dealt (`bullet | melee | blast`) and is read in `onKill`; set it around any new damage path. Completion calls `Game.objectiveDone()` (score, three pickups, and `bonusCard` for a fourth upgrade card).

**Upgrades.** The cards in `UPGRADES` (`game.ts`) belong to three tracks (`firepower | survival | utility`). `offerUpgrades()` offers one random card per track, an extra card from any track when the wave's objective was completed (`bonusCard`), and the next weapon unlock as its own card. Taking a regular card raises `Game.ranks[track]`; at `KEYSTONE_RANK` (3) that track offers all its `KEYSTONES` in place of a regular card until one is chosen, and the rest are gone for the run. Keystone effects are checked with `Game.has(k)` where they apply: `onKill` (overload, spree), `hurtPlayer` (barrier, last stand), `updateKeystones` (timers), `Player` (`airJumps`, `invuln`, `slideStarted`) and `WeaponSystem` (`boost`, `instantReload`). Cards are picked by click only (number keys are for weapons), and ignore clicks for the first 0.6 s. Everything resets in `startRun()`; nothing carries over between runs.

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
