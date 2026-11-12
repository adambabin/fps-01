export const ACTIONS = [
  'forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch',
  'fire', 'ads', 'reload', 'grenade',
  'weapon1', 'weapon2', 'weapon3', 'weapon4', 'nextWeapon', 'pause',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right',
  jump: 'Jump', sprint: 'Sprint', crouch: 'Crouch',
  fire: 'Fire', ads: 'Aim down sights', reload: 'Reload', grenade: 'Throw grenade',
  weapon1: 'Weapon 1', weapon2: 'Weapon 2', weapon3: 'Weapon 3', weapon4: 'Weapon 4',
  nextWeapon: 'Next weapon', pause: 'Pause',
};

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  fov: number;
  quality: Quality;
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
    fire: ['Mouse0', 'KeyF'], ads: ['Mouse2', 'KeyQ'], reload: ['KeyR'], grenade: ['KeyG'],
    weapon1: ['Digit1'], weapon2: ['Digit2'], weapon3: ['Digit3'], weapon4: ['Digit4'],
    nextWeapon: ['KeyE'], pause: ['KeyP'],
  };
}

export function defaults(): Settings {
  return {
    sensitivity: 1.0, adsSensitivity: 0.7, invertY: false, fov: 75, quality: 'medium',
    volume: 0.7, adsToggle: false, scrollSwitch: true, rawInput: true, showFps: false,
    damageNumbers: true, binds: defaultBinds(),
  };
}

/** Preset that makes the game comfortable without a mouse. */
export function applyTrackpadPreset(s: Settings) {
  s.sensitivity = 1.8;
  s.adsSensitivity = 0.8;
  s.adsToggle = true;
  s.scrollSwitch = false;
  s.rawInput = false;
  s.binds.fire = ['Mouse0', 'KeyF'];
  s.binds.ads = ['Mouse2', 'KeyQ'];
}

const KEY = 'rustwake.settings.v1';

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
