import type { Input } from './input';
import { ACTIONS, ACTION_LABELS, applyTrackpadPreset, codeLabel, defaults, saveSettings, type Settings } from './settings';
import { WEAPONS, type WeaponSystem } from './weapons';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type Screen = 'menu' | 'pause' | 'settings' | 'upgrade' | 'gameover';
export interface Card { name: string; desc: string; weapon?: boolean; }

export interface UICallbacks {
  play(): void; resume(): void; restart(): void; quit(): void;
  settingsChanged(): void; pickUpgrade(i: number): void; click(): void;
}

export interface RadarBlip { x: number; z: number; kind: number; }

export class UI {
  private screens: Record<Screen, HTMLElement>;
  private hud = $('hud');
  private settingsFrom: Screen = 'menu';
  private hitT = 0;
  private vig = 0;
  private announceT = 0;
  private radar = $<HTMLCanvasElement>('radar').getContext('2d')!;
  private last: Record<string, string | number> = {};
  current: Screen | null = 'menu';

  constructor(private settings: Settings, private input: Input, private cb: UICallbacks) {
    this.screens = { menu: $('menu'), pause: $('pause'), settings: $('settings'), upgrade: $('upgrade'), gameover: $('gameover') };
    const on = (id: string, fn: () => void) => $(id).addEventListener('click', () => { cb.click(); fn(); });
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
    on('btn-defaults', () => { Object.assign(settings, defaults()); this.commit(); this.buildSettings(); });
    this.buildSlots();
  }

  show(s: Screen | null) {
    this.current = s;
    for (const k in this.screens) this.screens[k as Screen].classList.toggle('hidden', k !== s);
  }
  showHud(v: boolean) { this.hud.classList.toggle('hidden', !v); }

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
    const slider = (label: string, key: 'sensitivity' | 'adsSensitivity' | 'fov' | 'volume', min: number, max: number, step: number, fmt: (v: number) => string) => {
      const r = row(label), i = document.createElement('input'), v = document.createElement('span');
      i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(s[key]);
      v.className = 'val'; v.textContent = fmt(s[key]);
      i.addEventListener('input', () => { s[key] = Number(i.value); v.textContent = fmt(s[key]); this.commit(); });
      r.append(i, v);
    };
    const check = (label: string, key: 'invertY' | 'adsToggle' | 'scrollSwitch' | 'rawInput' | 'showFps' | 'damageNumbers') => {
      const r = row(label), i = document.createElement('input');
      i.type = 'checkbox'; i.checked = s[key];
      i.addEventListener('change', () => { s[key] = i.checked; this.commit(); });
      r.append(i);
    };

    head('AIM');
    slider('Look sensitivity', 'sensitivity', 0.2, 4, 0.05, (v) => v.toFixed(2));
    slider('Aim-down-sights sensitivity', 'adsSensitivity', 0.2, 1.5, 0.05, (v) => v.toFixed(2));
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

    head('CONTROLS — click a binding, then press a key or mouse button');
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
      r.append(wrap);
    }
  }

  // ---------- upgrade and end screens ----------
  showUpgrades(wave: number, cards: Card[]) {
    $('upgrade-kicker').textContent = `WAVE ${wave} CLEARED`;
    const el = $('cards');
    el.innerHTML = '';
    cards.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'card' + (c.weapon ? ' weapon' : '');
      b.innerHTML = `<span class="num">${i + 1}</span><span class="name"></span><span class="desc"></span>`;
      (b.children[1] as HTMLElement).textContent = c.name;
      (b.children[2] as HTMLElement).textContent = c.desc;
      b.addEventListener('click', () => this.cb.pickUpgrade(i));
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

  announce(main: string, sub = '', time = 2.4) {
    $('announce-main').textContent = main; $('announce-sub').textContent = sub;
    $('announce').style.opacity = '1';
    this.announceT = time;
  }

  update(dt: number, d: {
    health: number; maxHealth: number; armor: number; maxArmor: number; wave: number; remaining: number; score: number;
    weapons: WeaponSystem; spreadPx: number; ads: number; sprinting: boolean; fps: number; intermission: number;
  }) {
    const w = d.weapons, st = w.state;
    this.set('hp-num', Math.ceil(d.health));
    this.set('armor-num', Math.ceil(d.armor));
    $('hp-fill').style.width = (d.health / d.maxHealth) * 100 + '%';
    $('armor-fill').style.width = (d.armor / d.maxArmor) * 100 + '%';
    this.set('wave', 'WAVE ' + d.wave);
    this.set('remaining', d.intermission > 0 ? `NEXT WAVE IN ${Math.ceil(d.intermission)}` : d.remaining > 0 ? `${d.remaining} HOSTILE${d.remaining === 1 ? '' : 'S'}` : '');
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
