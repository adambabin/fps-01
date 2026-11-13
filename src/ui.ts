import type { Input } from './input';
import { ACTIONS, ACTION_LABELS, DIFFICULTY, applyTrackpadPreset, codeLabel, defaults, loadScores, saveSettings, type Difficulty, type Settings } from './settings';
import type { Objective } from './objectives';
import { WEAPONS, type WeaponSystem } from './weapons';
import { ARENAS, type ArenaId } from './world';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type Screen = 'menu' | 'pause' | 'settings' | 'upgrade' | 'gameover' | 'scores';
export interface Card {
  name: string; desc: string; weapon?: boolean; bonus?: boolean; keystone?: boolean;
  /** Track the card belongs to, its current rank, and the rank at which keystones unlock. */
  track?: string; rank?: number; keystoneRank?: number;
}

/** Cards ignore clicks for this long, so a click already in progress cannot pick one. */
const CARD_ARM_MS = 600;

export interface UICallbacks {
  play(): void; resume(): void; restart(): void; quit(): void;
  settingsChanged(): void; pickUpgrade(i: number): void; click(): void;
  /** Name of the connected controller, or '' when there is none. */
  padName(): string;
}

export interface RadarBlip { x: number; z: number; kind: number; }

export class UI {
  private screens: Record<Screen, HTMLElement>;
  private hud = $('hud');
  private settingsFrom: Screen = 'menu';
  private scoresFrom: Screen = 'menu';
  /** Timestamp of the run that just ended, highlighted on the scoreboard. */
  lastRun = 0;
  private hitT = 0;
  private vig = 0;
  private announceT = 0;
  private radar = $<HTMLCanvasElement>('radar').getContext('2d')!;
  private last: Record<string, string | number> = {};
  current: Screen | null = 'menu';

  constructor(private settings: Settings, private input: Input, private cb: UICallbacks) {
    this.screens = { menu: $('menu'), pause: $('pause'), settings: $('settings'), upgrade: $('upgrade'), gameover: $('gameover'), scores: $('scores') };
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', () => { cb.click(); fn(); });
    for (const [id, from] of [['btn-scores', 'menu'], ['btn-pause-scores', 'pause'], ['btn-over-scores', 'gameover']] as const) on(id, () => this.openScores(from));
    on('btn-scores-back', () => this.show(this.scoresFrom));
    on('btn-play', () => cb.play());
    on('btn-resume', () => cb.resume());
    on('btn-restart', () => cb.restart());
    on('btn-again', () => cb.restart());
    on('btn-quit', () => cb.quit());
    on('btn-over-quit', () => cb.quit());
    on('btn-settings', () => this.openSettings('menu'));
    on('btn-pause-settings', () => this.openSettings('pause'));
    on('btn-settings-back', () => this.show(this.settingsFrom));
    on('btn-trackpad', () => { applyTrackpadPreset(settings); this.commit(); this.buildSettings(); });
    on('btn-defaults', () => { Object.assign(settings, defaults()); this.commit(); this.buildSettings(); this.buildDifficulty(); });
    this.buildSlots();
    this.buildDifficulty();
  }

  /** Difficulty and arena pickers on the title screen. */
  private buildDifficulty() {
    const ar = $('arena');
    ar.innerHTML = '';
    for (const id of Object.keys(ARENAS) as ArenaId[]) {
      const b = document.createElement('button');
      b.textContent = ARENAS[id].name;
      b.classList.toggle('active', this.settings.arena === id);
      b.addEventListener('click', () => { this.settings.arena = id; this.commit(); this.cb.click(); this.buildDifficulty(); });
      ar.append(b);
    }
    $('arena-blurb').textContent = ARENAS[this.settings.arena]?.blurb ?? '';
    const rot = $<HTMLInputElement>('rotate');
    rot.checked = this.settings.rotate;
    rot.onchange = () => { this.settings.rotate = rot.checked; this.commit(); };
    const el = $('difficulty');
    el.innerHTML = '';
    for (const d of Object.keys(DIFFICULTY) as Difficulty[]) {
      const b = document.createElement('button');
      b.textContent = DIFFICULTY[d].label;
      b.classList.toggle('active', this.settings.difficulty === d);
      b.addEventListener('click', () => { this.settings.difficulty = d; this.commit(); this.cb.click(); this.buildDifficulty(); });
      el.append(b);
    }
  }

  show(s: Screen | null) {
    this.current = s;
    for (const k in this.screens) this.screens[k as Screen].classList.toggle('hidden', k !== s);
  }
  showHud(v: boolean) { this.hud.classList.toggle('hidden', !v); }

  private openScores(from: Screen) {
    this.scoresFrom = from;
    const body = $('scores-body'), list = loadScores();
    body.innerHTML = '';
    if (!list.length) { body.innerHTML = '<div class="empty">No runs recorded yet. Finish a run to get on the board.</div>'; }
    else {
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>#</th><th>Score</th><th>Wave</th><th>Kills</th><th>Time</th><th>Arena</th><th>Difficulty</th><th>Date</th></tr></thead>';
      const tb = document.createElement('tbody');
      list.forEach((e, i) => {
        const tr = document.createElement('tr');
        if (e.date === this.lastRun) tr.className = 'latest';
        const time = `${Math.floor(e.time / 60)}:${String(e.time % 60).padStart(2, '0')}`;
        const date = new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        for (const v of [i + 1, e.score.toLocaleString(), e.wave, e.kills, time, e.arena, e.difficulty, date]) {
          const td = document.createElement('td'); td.textContent = String(v); tr.append(td);
        }
        tb.append(tr);
      });
      table.append(tb); body.append(table);
    }
    this.show('scores');
  }

  /** Leaves the settings or scoreboard screen the way its Back button does. Returns true if it did. */
  back(): boolean {
    if (this.current === 'settings') { this.cb.click(); this.show(this.settingsFrom); return true; }
    if (this.current === 'scores') { this.cb.click(); this.show(this.scoresFrom); return true; }
    return false;
  }

  private openSettings(from: Screen) { this.settingsFrom = from; this.buildSettings(); this.show('settings'); }
  private commit() { saveSettings(this.settings); this.cb.settingsChanged(); }

  // ---------- settings panel ----------
  private buildSettings() {
    const body = $('settings-body'), s = this.settings;
    body.innerHTML = '';
    const head = (t: string) => { const d = document.createElement('div'); d.className = 's-head'; d.textContent = t; body.append(d); };
    const row = (label: string) => {
      const r = document.createElement('div'); r.className = 's-row';
      const l = document.createElement('label'); l.textContent = label; r.append(l); body.append(r);
      return r;
    };
    const slider = (label: string, key: 'sensitivity' | 'adsSensitivity' | 'fov' | 'volume' | 'padSensitivity', min: number, max: number, step: number, fmt: (v: number) => string) => {
      const r = row(label), i = document.createElement('input'), v = document.createElement('span');
      i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(s[key]);
      v.className = 'val'; v.textContent = fmt(s[key]);
      i.addEventListener('input', () => { s[key] = Number(i.value); v.textContent = fmt(s[key]); this.commit(); });
      r.append(i, v);
    };
    const check = (label: string, key: 'invertY' | 'adsToggle' | 'scrollSwitch' | 'rawInput' | 'showFps' | 'damageNumbers' | 'padVibration') => {
      const r = row(label), i = document.createElement('input');
      i.type = 'checkbox'; i.checked = s[key];
      // Link the text to the box so clicking anywhere on the label toggles it.
      i.id = 'opt-' + key; (r.firstChild as HTMLLabelElement).htmlFor = i.id; r.classList.add('toggle');
      i.addEventListener('change', () => { s[key] = i.checked; this.commit(); });
      r.append(i);
    };

    head('GAME');
    const dr = row('Difficulty (applies from the next wave)'), dsel = document.createElement('select');
    for (const d of Object.keys(DIFFICULTY) as Difficulty[]) {
      const o = document.createElement('option'); o.value = d; o.textContent = DIFFICULTY[d].label; o.selected = s.difficulty === d; dsel.append(o);
    }
    dsel.addEventListener('change', () => { s.difficulty = dsel.value as Difficulty; this.commit(); this.buildDifficulty(); });
    dr.append(dsel);

    head('AIM');
    slider('Look sensitivity', 'sensitivity', 0.2, 8, 0.05, (v) => v.toFixed(2));
    slider('Aim sensitivity (1.0 = matched to zoom)', 'adsSensitivity', 0.3, 2, 0.05, (v) => v.toFixed(2));
    check('Invert vertical look', 'invertY');
    check('Toggle aim instead of hold', 'adsToggle');
    check('Scroll to switch weapons', 'scrollSwitch');
    check('Raw mouse input (no acceleration)', 'rawInput');

    head('VIDEO & AUDIO');
    slider('Field of view', 'fov', 60, 100, 1, (v) => v.toFixed(0) + '°');
    const qr = row('Graphics quality'), sel = document.createElement('select');
    for (const q of ['low', 'medium', 'high'] as const) {
      const o = document.createElement('option'); o.value = q; o.textContent = q[0].toUpperCase() + q.slice(1); o.selected = s.quality === q; sel.append(o);
    }
    sel.addEventListener('change', () => { s.quality = sel.value as Settings['quality']; this.commit(); });
    qr.append(sel);
    slider('Master volume', 'volume', 0, 1, 0.01, (v) => Math.round(v * 100) + '%');
    check('Show damage numbers', 'damageNumbers');
    check('Show FPS counter', 'showFps');

    head('CONTROLLER');
    const pad = this.cb.padName();
    const note = document.createElement('div');
    note.className = 's-note';
    note.textContent = pad ? `Connected: ${pad}. Left stick moves, right stick looks; D-pad and A/B work in menus.` : 'No controller detected. Plug one in or pair it, then press any button on it.';
    body.append(note);
    slider('Controller look sensitivity', 'padSensitivity', 0.3, 3, 0.05, (v) => v.toFixed(2));
    check('Controller vibration', 'padVibration');

    head('CONTROLS — select a binding, then press a key or mouse button. The third column is the controller button.');
    for (const a of ACTIONS) {
      const r = row(ACTION_LABELS[a]), wrap = document.createElement('div');
      wrap.className = 'bind';
      for (let slot = 0; slot < 2; slot++) {
        const b = document.createElement('button');
        b.textContent = codeLabel(s.binds[a][slot]);
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          b.classList.add('listening'); b.textContent = 'Press…';
          // Defer so this click is not captured as the new binding.
          setTimeout(() => {
            this.input.capture = (code) => {
              if (code === 'Escape') { s.binds[a].splice(slot, 1); }
              else {
                // A key can only drive one action.
                for (const o of ACTIONS) s.binds[o] = s.binds[o].filter((c) => c !== code);
                s.binds[a][slot] = code;
                s.binds[a] = s.binds[a].filter(Boolean);
              }
              this.commit(); this.buildSettings();
            };
          }, 0);
        });
        wrap.append(b);
      }
      // Controller column. The sticks always move and look, so those four rows have no button.
      const pb = document.createElement('button');
      pb.className = 'pad';
      pb.textContent = codeLabel(s.pad[a]);
      if (a === 'forward' || a === 'back' || a === 'left' || a === 'right') { pb.textContent = 'Left Stick'; pb.disabled = true; }
      pb.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pb.classList.add('listening'); pb.textContent = 'Press button…';
        setTimeout(() => {
          this.input.capturePad = true;
          this.input.capture = (code) => {
            this.input.capturePad = false;
            // Escape clears the binding; any other key or mouse press cancels.
            if (code === 'Escape') s.pad[a] = '';
            else if (code.startsWith('Pad')) {
              for (const o of ACTIONS) if (s.pad[o] === code) s.pad[o] = '';
              s.pad[a] = code;
            }
            this.commit(); this.buildSettings();
          };
        }, 0);
      });
      wrap.append(pb);
      r.append(wrap);
    }
  }

  // ---------- upgrade and end screens ----------
  showUpgrades(wave: number, cards: Card[]) {
    $('upgrade-kicker').textContent = `WAVE ${wave} CLEARED`;
    const el = $('cards');
    el.innerHTML = '';
    const armed = performance.now() + CARD_ARM_MS;
    el.classList.add('arming');
    setTimeout(() => el.classList.remove('arming'), CARD_ARM_MS);
    cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'card' + (c.weapon ? ' weapon' : '') + (c.keystone ? ' keystone' : '') + (c.track ? ' t-' + c.track : '');
      b.innerHTML = `<span class="num"></span><span class="name"></span><span class="desc"></span>`;
      const head = b.children[0] as HTMLElement;
      if (c.weapon) head.textContent = 'NEW WEAPON';
      else if (c.keystone) head.textContent = `${c.track!.toUpperCase()} KEYSTONE`;
      else if (c.track) {
        // Pips: ranks already taken in this track, ending in the keystone marker.
        const n = c.keystoneRank ?? 3, r = c.rank ?? 0;
        head.innerHTML = `${c.track.toUpperCase()}${c.bonus ? ' · BONUS' : ''} <span class="pips">${'●'.repeat(r)}${'○'.repeat(Math.max(0, n - r))}◆</span>`;
      }
      (b.children[1] as HTMLElement).textContent = c.name;
      (b.children[2] as HTMLElement).textContent = c.desc;
      b.addEventListener('click', () => { if (performance.now() >= armed) this.cb.pickUpgrade(i); });
      el.append(b);
    });
    this.show('upgrade');
  }

  showGameOver(stats: [string, string][]) {
    const el = $('stats');
    el.innerHTML = '';
    for (const [k, v] of stats) {
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = k; b.textContent = v; el.append(a, b);
    }
    this.show('gameover');
  }

  setBest(v: number) { $('best').textContent = v > 0 ? `BEST SCORE  ${v.toLocaleString()}` : ''; }

  // ---------- HUD ----------
  private buildSlots() {
    const el = $('slots');
    WEAPONS.forEach((w, i) => {
      const d = document.createElement('div');
      d.className = 'slot'; d.textContent = `${i + 1} ${w.slot}`;
      el.append(d);
    });
  }

  private set(id: string, v: string | number) {
    if (this.last[id] === v) return;
    this.last[id] = v;
    $(id).textContent = String(v);
  }

  hitmarker(crit: boolean, kill: boolean) {
    const el = $('hitmarker');
    el.className = kill ? 'kill' : crit ? 'crit' : '';
    this.hitT = kill ? 0.3 : 0.16;
  }

  damageFlash(amount: number) { this.vig = Math.min(1, this.vig + amount / 30); }

  damageDir(angleRad: number) {
    const d = document.createElement('div');
    d.className = 'dmg-dir';
    d.style.transform = `rotate(${angleRad}rad)`;
    d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: 'ease-in' }).onfinish = () => d.remove();
    $('dmg-dirs').append(d);
  }

  number(x: number, y: number, amount: number, crit: boolean) {
    if (!this.settings.damageNumbers) return;
    const el = $('numbers');
    if (el.childElementCount > 24) el.firstElementChild!.remove();
    const d = document.createElement('div');
    d.className = 'num-pop' + (crit ? ' crit' : '');
    d.textContent = String(Math.round(amount));
    d.style.left = x + (Math.random() - 0.5) * 30 + 'px'; d.style.top = y + 'px';
    d.addEventListener('animationend', () => d.remove());
    el.append(d);
  }

  feed(html: string) {
    const el = $('feed');
    if (el.childElementCount > 5) el.firstElementChild!.remove();
    const d = document.createElement('div');
    d.innerHTML = html;
    d.addEventListener('animationend', () => d.remove());
    el.append(d);
  }

  /** Hides the current announcement at once. */
  clearAnnounce() { $('announce').style.opacity = '0'; this.announceT = 0; }

  announce(main: string, sub = '', time = 2.4) {
    $('announce-main').textContent = main; $('announce-sub').textContent = sub;
    $('announce').style.opacity = '1';
    this.announceT = time;
  }

  update(dt: number, d: {
    health: number; maxHealth: number; armor: number; maxArmor: number; wave: number; remaining: number; score: number;
    weapons: WeaponSystem; spreadPx: number; ads: number; sprinting: boolean; fps: number; intermission: number; prompt: string; boss: number; bossName: string; best: number;
    perks: string; lives: number; maxLives: number;
  }) {
    this.set('perks', d.perks);
    this.set('lives', '♥'.repeat(Math.max(0, d.lives)) + '♡'.repeat(Math.max(0, d.maxLives - d.lives)));
    $('lives').classList.toggle('last', d.lives <= 1);
    this.set('score-best', d.best <= 0 ? '' : d.score > d.best ? 'NEW BEST' : 'BEST ' + d.best.toLocaleString());
    $('score-best').classList.toggle('beaten', d.best > 0 && d.score > d.best);
    if (d.boss >= 0) { this.set('boss-name', d.bossName.toUpperCase()); this.set('np-name', d.bossName.toUpperCase()); $('np-fill').style.width = Math.max(0, d.boss) * 100 + '%'; }
    $('boss').classList.toggle('hidden', d.boss < 0);
    if (d.boss >= 0) $('boss-fill').style.width = Math.max(0, d.boss) * 100 + '%';
    const w = d.weapons, st = w.state;
    this.set('hp-num', Math.ceil(d.health));
    this.set('armor-num', Math.ceil(d.armor));
    $('hp-fill').style.width = (d.health / d.maxHealth) * 100 + '%';
    $('armor-fill').style.width = (d.armor / d.maxArmor) * 100 + '%';
    this.set('wave', 'WAVE ' + d.wave);
    this.set('remaining', d.prompt ? d.prompt : d.intermission > 0 ? `NEXT WAVE IN ${Math.ceil(d.intermission)}` : d.remaining > 0 ? `${d.remaining} HOSTILE${d.remaining === 1 ? '' : 'S'}` : '');
    this.set('score', d.score.toLocaleString());
    this.set('weapon-name', w.def.name);
    this.set('ammo', st.ammo);
    this.set('reserve', isFinite(st.reserve) ? '/ ' + st.reserve : '/ ∞');
    $('ammo').classList.toggle('low', st.ammo <= w.magSize() * 0.25);
    $('grenades').innerHTML = `GRENADES <b>${'●'.repeat(w.grenades)}${'○'.repeat(Math.max(0, w.maxGrenades - w.grenades))}</b>`;
    const slots = $('slots').children;
    for (let i = 0; i < slots.length; i++) {
      slots[i].classList.toggle('active', i === w.current);
      slots[i].classList.toggle('locked', !w.states[i].unlocked);
    }
    const rb = $('reload-bar');
    rb.style.opacity = w.reloading ? '1' : '0';
    if (w.reloading) $('reload-fill').style.width = (1 - w.reloadT / w.reloadDur) * 100 + '%';
    this.set('prompt', w.reloading ? 'RELOADING' : st.ammo === 0 && st.reserve <= 0 ? 'OUT OF AMMO — SWITCH WEAPON' : st.ammo <= w.magSize() * 0.25 && st.reserve > 0 ? 'LOW AMMO — RELOAD' : '');

    const ch = $('crosshair');
    ch.style.setProperty('--gap', Math.max(3, d.spreadPx).toFixed(1) + 'px');
    ch.style.opacity = String(d.sprinting ? 0.25 : Math.max(0, 1 - d.ads * 1.6));

    if (this.hitT > 0) { this.hitT -= dt; $('hitmarker').style.opacity = String(Math.min(1, this.hitT * 10)); }
    this.vig = Math.max(0, this.vig - dt * 1.4);
    $('vignette').style.opacity = this.vig.toFixed(2);
    const low = d.health / d.maxHealth;
    $('lowhp').style.opacity = low < 0.35 ? ((0.35 - low) / 0.35 * (0.6 + Math.sin(performance.now() * 0.006) * 0.25)).toFixed(2) : '0';
    if (this.announceT > 0) { this.announceT -= dt; if (this.announceT <= 0) $('announce').style.opacity = '0'; }
    $('fps').textContent = this.settings.showFps ? d.fps.toFixed(0) + ' FPS' : '';
  }

  /** Brief fade from black, used when the arena changes mid-run. */
  fade() {
    const el = $('fade');
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  /** Positions the boss's floating name and health bar, or hides it. */
  nameplate(at: { x: number; y: number } | null) {
    const el = $('nameplate');
    el.classList.toggle('hidden', !at);
    if (at) { el.style.left = at.x + 'px'; el.style.top = at.y + 'px'; }
  }

  /** Fills the objective panel and places the waypoint marker. */
  objective(o: Objective | null, wp: { x: number; y: number; dist: number } | null) {
    const el = $('objective'), w = $('waypoint');
    el.classList.toggle('hidden', !o);
    w.classList.toggle('hidden', !wp);
    if (wp) {
      w.style.left = wp.x + 'px'; w.style.top = wp.y + 'px';
      w.classList.toggle('prime', o!.kind === 'prime');
      this.set('wp-dist', Math.round(wp.dist) + 'm');
    }
    if (!o) return;
    el.classList.toggle('done', o.status === 'done');
    el.classList.toggle('failed', o.status === 'failed');
    this.set('obj-title', o.title);
    const timed = o.kind === 'hold' || o.kind === 'prime';
    const left = Math.max(0, Math.ceil(o.goal - o.progress));
    this.set('obj-desc', o.status === 'done' ? 'Complete' : o.status === 'failed' ? 'Missed' :
      o.kind === 'prime' ? (wp ? `${o.desc} · ${left}s` : o.desc) : timed ? `${o.desc} · ${left}s` : `${o.desc} · ${o.progress}/${o.goal}`);
    const frac = o.status === 'done' ? 1 : o.kind === 'prime' ? 1 - o.progress / o.goal : o.progress / o.goal;
    $('obj-fill').style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }

  /** Blip coordinates are already in player-relative space: +x right, +z forward. */
  drawRadar(blips: RadarBlip[]) {
    const g = this.radar, S = 300, c = S / 2, range = 34, R = c - 6;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(8,13,18,0.6)'; g.strokeStyle = 'rgba(140,180,210,0.45)'; g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(140,180,210,0.16)';
    g.beginPath(); g.arc(c, c, R / 2, 0, Math.PI * 2); g.moveTo(c, c - R); g.lineTo(c, c + R); g.moveTo(c - R, c); g.lineTo(c + R, c); g.stroke();
    for (const b of blips) {
      let x = b.x / range, y = -b.z / range;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      g.fillStyle = b.kind === 3 ? '#ff5a2a' : b.kind === 2 ? '#ffc23a' : b.kind === 9 ? '#6dff8c' : '#ff4a3a';
      const s = b.kind === 3 ? 9 : b.kind === 9 ? 4 : 6;
      g.globalAlpha = l > 1 ? 0.5 : 1;
      g.beginPath(); g.arc(c + x * R, c + y * R, s, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#e8f4ff';
    g.beginPath(); g.moveTo(c, c - 12); g.lineTo(c + 8, c + 9); g.lineTo(c, c + 4); g.lineTo(c - 8, c + 9); g.fill();
  }
}
