/**
 * The difficulty sliders (pause → Tuning). Each slider is a multiplier in [0.25, 4] on one
 * side, applied as the `difficulty` Mod source of every actor on that side, so it goes
 * through the same StatSheet path as every other bonus (docs/GAME.md, Difficulty).
 *
 *   playerDamage  → `damage` more          enemyDamage → `damage` more
 *   playerLife    → `life` + `es` more     enemyLife   → `life` + `es` more
 *   playerSpeed   → move/attack/cast speed enemySpeed  → move/attack/cast speed
 */
import { more, type Mod } from '../core/mods';
import type { DifficultyTuning } from '../core/types';

export const DIFFICULTY_MIN = 0.25;
export const DIFFICULTY_MAX = 4;

export const DIFFICULTY_KEYS = ['playerDamage', 'playerLife', 'playerSpeed', 'enemyDamage', 'enemyLife', 'enemySpeed'] as const satisfies readonly (keyof DifficultyTuning)[];
export type DifficultyKey = (typeof DIFFICULTY_KEYS)[number];

export const DIFFICULTY_LABELS: Record<DifficultyKey, string> = {
  playerDamage: 'Hero damage',
  playerLife: 'Hero life',
  playerSpeed: 'Hero speed',
  enemyDamage: 'Enemy damage',
  enemyLife: 'Enemy life',
  enemySpeed: 'Enemy speed',
};

/** Short labels for the HUD corner. */
export const DIFFICULTY_SHORT: Record<DifficultyKey, string> = {
  playerDamage: 'H.DMG',
  playerLife: 'H.LIFE',
  playerSpeed: 'H.SPD',
  enemyDamage: 'E.DMG',
  enemyLife: 'E.LIFE',
  enemySpeed: 'E.SPD',
};

export const NORMAL: Readonly<DifficultyTuning> = { playerDamage: 1, playerLife: 1, playerSpeed: 1, enemyDamage: 1, enemyLife: 1, enemySpeed: 1 };

export const DIFFICULTY_PRESETS: Readonly<Record<'story' | 'normal' | 'hard' | 'nightmare', Readonly<DifficultyTuning>>> = {
  story: { playerDamage: 1.5, playerLife: 2, playerSpeed: 1, enemyDamage: 0.5, enemyLife: 0.6, enemySpeed: 0.9 },
  normal: NORMAL,
  hard: { playerDamage: 1, playerLife: 1, playerSpeed: 1, enemyDamage: 1.5, enemyLife: 1.6, enemySpeed: 1.1 },
  nightmare: { playerDamage: 1, playerLife: 0.8, playerSpeed: 1, enemyDamage: 2.5, enemyLife: 2.5, enemySpeed: 1.25 },
};
export type DifficultyPreset = keyof typeof DIFFICULTY_PRESETS;

export function clampMultiplier(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(DIFFICULTY_MAX, Math.max(DIFFICULTY_MIN, Math.round(v * 100) / 100));
}

/** A valid tuning from anything (old saves, imports, the agent API). */
export function sanitizeTuning(raw: unknown): DifficultyTuning {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<DifficultyKey, unknown>>;
  const out = { ...NORMAL };
  for (const k of DIFFICULTY_KEYS) if (typeof src[k] === 'number') out[k] = clampMultiplier(src[k]);
  return out;
}

/** The `difficulty` source for one side. Empty at 1.0 so the sheet stays clean. */
export function difficultyMods(t: DifficultyTuning, side: 'hero' | 'enemy'): Mod[] {
  const [dmg, life, speed] = side === 'hero' ? [t.playerDamage, t.playerLife, t.playerSpeed] : [t.enemyDamage, t.enemyLife, t.enemySpeed];
  const out: Mod[] = [];
  if (dmg !== 1) out.push(more('damage', dmg - 1));
  if (life !== 1) out.push(more('life', life - 1), more('es', life - 1));
  if (speed !== 1) out.push(more('move.speed', speed - 1), more('attack.speed', speed - 1), more('cast.speed', speed - 1));
  return out;
}

/** Sliders that are not 1.0 (shown in the HUD corner). */
export function changedSliders(t: DifficultyTuning): DifficultyKey[] {
  return DIFFICULTY_KEYS.filter((k) => Math.abs(t[k] - 1) > 1e-6);
}

/** The preset this tuning equals, or null (custom). */
export function presetOf(t: DifficultyTuning): DifficultyPreset | null {
  for (const [name, p] of Object.entries(DIFFICULTY_PRESETS) as [DifficultyPreset, DifficultyTuning][]) {
    if (DIFFICULTY_KEYS.every((k) => Math.abs(p[k] - t[k]) < 1e-6)) return name;
  }
  return null;
}

/**
 * Slider position (0..1) ↔ multiplier, on a log scale so 1.0 sits in the middle and 0.5×
 * is as far from it as 2×.
 */
export function sliderToMultiplier(u: number): number {
  const lo = Math.log2(DIFFICULTY_MIN);
  const hi = Math.log2(DIFFICULTY_MAX);
  return clampMultiplier(Math.pow(2, lo + (hi - lo) * Math.min(1, Math.max(0, u))));
}

export function multiplierToSlider(v: number): number {
  const lo = Math.log2(DIFFICULTY_MIN);
  const hi = Math.log2(DIFFICULTY_MAX);
  return (Math.log2(clampMultiplier(v)) - lo) / (hi - lo);
}

/** One keyboard / d-pad notch: 0.05 below 1×, 0.1 up to 2×, 0.25 above. */
export function nudge(v: number, dir: 1 | -1): number {
  const step = (x: number) => (x < 1 ? 0.05 : x < 2 ? 0.1 : 0.25);
  const s = dir > 0 ? step(v + 1e-9) : step(v - 1e-9);
  return clampMultiplier(Math.round((v + dir * s) / s) * s);
}
