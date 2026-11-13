/**
 * The boss roster. One boss arrives every fifth wave, in this order, then the list repeats
 * with more health. To rename a boss, change `name` here; it is shown above the boss, on
 * the health bar, in the arrival warning and in the kill feed.
 */
export interface BossDef {
  name: string;
  /** Hull tint multiplied over the armor colors. */
  tint: number;
  /** One-line description of what sets this boss apart (shown in the arrival warning). */
  trait: string;
}

export const BOSSES: BossDef[] = [
  { name: 'Warden', tint: 0xffffff, trait: 'Barrage, rockets and a ground pulse' },
  { name: 'Overseer', tint: 0x9fc4ff, trait: 'Longer barrages' },
  { name: 'Tyrant', tint: 0xffc070, trait: 'Double ground pulse' },
  { name: 'Colossus', tint: 0xb8ff9a, trait: 'Heavier salvos, calls in Troopers' },
  { name: 'Apex', tint: 0xff8a8a, trait: 'Everything at once' },
];
