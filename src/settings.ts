import { isTouchDevice } from './touch';
import type { ArenaId } from './world';

export const ACTIONS = [
  'forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch',
  'fire', 'ads', 'reload', 'grenade', 'melee',
  'weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weapon6', 'nextWeapon', 'pause',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right',
  jump: 'Jump', sprint: 'Sprint', crouch: 'Crouch',
  fire: 'Fire', ads: 'Aim down sights', reload: 'Reload', grenade: 'Throw grenade', melee: 'Melee',
  weapon1: 'Weapon 1', weapon2: 'Weapon 2', weapon3: 'Weapon 3', weapon4: 'Weapon 4', weapon5: 'Weapon 5', weapon6: 'Weapon 6',
  nextWeapon: 'Next weapon', pause: 'Pause',
};

export type Quality = 'low' | 'medium' | 'high';
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Difficulty scales the robots, not the player's weapons, so gunplay feels the same on
 * every setting. `slots` caps how many Troopers may be shooting at once; `regenTo` is the
 * fraction of max health the player recovers to after a few seconds out of fire.
 */
export const DIFFICULTY: Record<Difficulty, { label: string; dmg: number; hp: number; budget: number; slots: number; regenTo: number; drops: number; shotSpeed: number }> = {
  easy: { label: 'Easy', dmg: 0.6, hp: 0.85, budget: 0.8, slots: 1, regenTo: 1, drops: 1.4, shotSpeed: 0.88 },
  normal: { label: 'Normal', dmg: 0.85, hp: 1, budget: 1, slots: 2, regenTo: 0.5, drops: 1, shotSpeed: 1 },
  hard: { label: 'Hard', dmg: 1.2, hp: 1.15, budget: 1.25, slots: 3, regenTo: 0, drops: 0.8, shotSpeed: 1.1 },
};

export interface Settings {
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  fov: number;
  quality: Quality;
  difficulty: Difficulty;
  arena: ArenaId;
  /** Move to the next arena after each boss is destroyed. */
  rotate: boolean;
  volume: number;
  adsToggle: boolean;
  scrollSwitch: boolean;
  rawInput: boolean;
  showFps: boolean;
  damageNumbers: boolean;
  binds: Record<Action, string[]>;
}

export function defaultBinds(): Record<Action, string[]> {
  return {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'],
    fire: ['Mouse0', 'KeyF'], ads: ['Mouse2', 'KeyQ'], reload: ['KeyR'], grenade: ['KeyG'], melee: ['KeyV', 'Mouse1'],
    weapon1: ['Digit1'], weapon2: ['Digit2'], weapon3: ['Digit3'], weapon4: ['Digit4'], weapon5: ['Digit5'], weapon6: ['Digit6'],
    nextWeapon: ['KeyE'], pause: ['KeyP'],
  };
}

export function defaults(): Settings {
  // Phones get a lighter renderer.
  const touch = isTouchDevice();
  return {
    sensitivity: 1.0, adsSensitivity: 1.0, invertY: false, fov: 75, quality: touch ? 'low' : 'medium', difficulty: 'normal', arena: 'reactor', rotate: true,
    volume: 0.7, adsToggle: false, scrollSwitch: true, rawInput: true, showFps: false,
    damageNumbers: true, binds: defaultBinds(),
  };
}

/** Preset that makes the game comfortable without a mouse. */
export function applyTrackpadPreset(s: Settings) {
  s.sensitivity = 3.3;
  s.adsSensitivity = 1.0;
  s.adsToggle = true;
  s.scrollSwitch = false;
  s.rawInput = false;
  s.binds.fire = ['Mouse0', 'KeyF'];
  s.binds.ads = ['Mouse2', 'KeyQ'];
}

// Bumped when the meaning of stored values changes (v2: sensitivity scale).
const KEY = 'rustwake.settings.v2';

export function loadSettings(): Settings {
  const s = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const binds = { ...s.binds, ...(p.binds || {}) };
      Object.assign(s, p);
      s.binds = binds;
    }
  } catch { /* storage unavailable */ }
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** One finished run on the local scoreboard. */
export interface ScoreEntry { score: number; wave: number; kills: number; time: number; arena: string; difficulty: string; date: number; }

const SCORES_KEY = 'rustwake.scores.v1', MAX_SCORES = 20;

export function loadScores(): ScoreEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(SCORES_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** Adds a run, keeps the best 20, and returns the run's 1-based rank (0 if it did not place). */
export function saveScore(entry: ScoreEntry): number {
  const list = loadScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, MAX_SCORES);
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list.indexOf(entry) + 1;
}

export function loadHighScore(): number {
  try { return Number(localStorage.getItem('rustwake.best') || 0); } catch { return 0; }
}
export function saveHighScore(v: number) {
  try { localStorage.setItem('rustwake.best', String(v)); } catch { /* ignore */ }
}

export function codeLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code === 'Mouse0') return 'Left Click';
  if (code === 'Mouse1') return 'Middle Click';
  if (code === 'Mouse2') return 'Right Click';
  if (code.startsWith('Mouse')) return 'Mouse ' + code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
  return code.replace('Left', ' L').replace('Right', ' R');
}
