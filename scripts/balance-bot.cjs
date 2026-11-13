// Balance calibration bot. Plays full runs on each difficulty with human-like aim (lag,
// jitter, reaction delay) and reports the wave reached.
// Usage: npm run build && npm run preview -- --port 4173   (in another shell)
//        node scripts/balance-bot.cjs [runs=4] [skill=1]
// Needs a Playwright install with Chromium; it is not a project dependency.
const { chromium } = require('playwright');
(async () => {
  const runs = Number(process.argv[2] || 4), skill = Number(process.argv[3] || 1);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const logs = [];
  p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message + e.stack));
  await p.goto('http://localhost:4173/?test=1');
  await p.waitForTimeout(1500);
  await p.click('#btn-play');
  for (const diff of ['easy', 'normal', 'hard']) {
    const res = await p.evaluate(({ diff, runs, skill }) => {
      const g = window.game, V = g.player.pos.constructor, out = [];
      g.test = true; g.settings.difficulty = diff; g.settings.quality = 'low';
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      for (let run = 0; run < runs; run++) {
        g.state = 'menu'; g.startRun();
        let target = null, lockT = 0, jx = 0, jy = 0, jT = 0, strafe = 1, sT = 0, gT = 5, i = 0, dmgTaken = 0, lastHp = 100;
        const eye = new V(), c = new V();
        for (; i < 60 * 60 * 14 && g.state !== 'dead'; i++) {
          if (g.state === 'upgrade') { g.pickUpgrade((Math.random() * 3) | 0); continue; }
          if (g.state !== 'playing') break;
          const dt = 1 / 60, pl = g.player, w = g.weapons, inp = g.input;
          inp.down.clear();
          eye.set(pl.pos.x, pl.pos.y + pl.eye, pl.pos.z);
          // Target selection: nearest visible robot, re-evaluated a few times a second.
          if (i % 15 === 0 || !target || !target.alive) {
            let best = null, bd = 1e9;
            for (const e of g.enemies.list) {
              const d = e.pos.distanceTo(pl.pos) * (g.world.collision.clear(eye, e.center(c)) ? 1 : 3);
              if (d < bd) { bd = d; best = e; }
            }
            if (best !== target) { target = best; lockT = 0.28 / skill; }
          }
          sT -= dt; if (sT <= 0) { sT = 0.5 + Math.random() * 1.2; strafe = -strafe; }
          inp.down.add(strafe > 0 ? 'KeyD' : 'KeyA');
          let near = 1e9;
          for (const e of g.enemies.list) if (e.type !== 'drone') near = Math.min(near, e.pos.distanceTo(pl.pos));
          if (near < 7) inp.down.add('KeyS'); else if (target && target.pos.distanceTo(pl.pos) > 24) inp.down.add('KeyW');
          if (target) {
            lockT -= dt;
            jT -= dt; if (jT <= 0) { jT = 0.25; jx = (Math.random() - 0.5) * 0.05 / skill; jy = (Math.random() - 0.5) * 0.04 / skill; }
            target.center(c);
            const ex = c.x - eye.x, ey = c.y - eye.y, ez = c.z - eye.z, dist = Math.hypot(ex, ez);
            const ty = Math.atan2(-ex, -ez) + jx, tp = Math.atan2(ey, dist) + jy;
            if (lockT <= 0) {
              const k = Math.min(1, dt * 9 * skill), max = 5 * dt * skill;
              pl.yaw += Math.max(-max, Math.min(max, wrap(ty - pl.yaw) * k));
              pl.pitch += Math.max(-max, Math.min(max, (tp - pl.pitch - pl.recoilPitch * 0.6) * k));
            }
            const err = Math.hypot(wrap(ty - jx - pl.yaw), tp - jy - pl.pitch - pl.recoilPitch);
            const st = w.states;
            let want = st[1].ammo + st[1].reserve > 0 ? 1 : 0;
            if (st[2].unlocked && dist < 8 && st[2].ammo + st[2].reserve > 0) want = 2;
            else if (st[3].unlocked && (target.type === 'heavy' || dist > 25) && st[3].ammo + st[3].reserve > 0) want = 3;
            if (want !== w.current && i % 30 === 0) inp.pressed.add('Digit' + (want + 1));
            const clear = g.world.collision.clear(eye, c);
            if (clear && err < Math.max(0.03, 0.6 / Math.max(3, dist))) { inp.down.add('Mouse0'); if (i % 9 === 0) inp.pressed.add('Mouse0'); }
            gT -= dt;
            if (gT <= 0 && w.grenades > 0 && dist > 7 && dist < 18 && g.enemies.list.filter((e) => e.pos.distanceTo(target.pos) < 5).length >= 3) { inp.pressed.add('KeyG'); gT = 6; }
          } else if (w.state.ammo < w.magSize()) inp.pressed.add('KeyR');
          g.simulate(dt); inp.endFrame();
          if (pl.health < lastHp) dmgTaken += lastHp - pl.health; lastHp = pl.health;
        }
        out.push({ wave: g.wave, t: Math.round(i / 60), kills: g.kills, dmg: Math.round(dmgTaken), alive: g.state !== 'dead' });
      }
      return out;
    }, { diff, runs, skill });
    const ws = res.map((r) => r.wave);
    console.log(diff.padEnd(7), 'waves', ws.join(','), ' avg', (ws.reduce((a, b) => a + b, 0) / ws.length).toFixed(1), ' time', res.map((r) => r.t).join(','), ' dmg/min', res.map((r) => (r.dmg / r.t * 60).toFixed(0)).join(','));
  }
  console.log(logs.slice(0, 5).join('\n'));
  await b.close();
})();
