/**
 * How the real game grows its hero and scales its monsters, as pure functions over
 * `WIRE_TUNING` (no three.js): the hero port and the monster port use them, and so does the
 * balance sim (`src/riftlight/balance`), so `npm run balance` measures the game as it plays.
 */
import { StatQuery } from '../combat/stats';
import { flat, inc, type Mod, more, StatSheet } from '../core/mods';
import { RANK, SCALING } from '../core/scaling';
import { WIRE_TUNING } from './tuning';

const T = WIRE_TUNING.hero;
const M = WIRE_TUNING.monster;

/** The hero's base record (HeroController's base, overridden by WIRE_TUNING.hero.base). */
export const HERO_BASE_STATS: Readonly<Record<string, number>> = T.base;

/** The `level` Mod source: what a character level adds. */
export function levelMods(level: number): Mod[] {
  const n = Math.max(0, level - 1);
  if (!n) return [];
  const p = T.perLevel;
  return [flat('life', p.life * n), flat('mana', p.mana * n), flat('accuracy', p.accuracy * n), flat('life.regen', p['life.regen'] * n), inc('damage', p.damage * n)];
}

/** The starter sword (the `starter` source) until gear brings a weapon. */
export function starterWeapon(): Mod[] {
  const w = T.starterWeapon;
  return [flat('weapon.physical.min', w.min), flat('weapon.physical.max', w.max), flat('weapon.crit', w.crit)];
}

/** A monster's base record before genome, depth and rank (the `base` source of its Actor). */
export function monsterBase(depth: number, scale = 1, add = false): Record<string, number> {
  return {
    life: M.life * (add ? M.addScale : 1),
    'move.speed': M.speed,
    accuracy: M.accuracy + M.accuracyPerLevel * SCALING.monsterLevel(depth),
    armour: M.armourPerDepth * depth,
    mass: Math.max(0.6, scale * scale),
    'life.regen': 0,
    mana: 0,
    'mana.regen': 0,
  };
}

/** Depth scaling as the monster's `depth` source (SCALING curves × the damage knob). */
export function monsterDepthMods(depth: number): Mod[] {
  return [more('life', SCALING.monsterLife(depth) - 1), more('damage', SCALING.monsterDamage(depth) * M.damage - 1)];
}

/**
 * A boss's life and damage follow the depth curve, not its parts: whatever its genome's mods
 * (rank, plan, parts, archetype) multiply life and damage by, the `boss` source brings it to
 * RANK.boss × the boss budget (WIRE_TUNING), so each boss is a modest step up from the last
 * (SCALING.monsterLife / monsterDamage per depth) instead of a jagged one.
 */
export function bossBudget(genomeMods: readonly Mod[]): Mod[] {
  const sheet = new StatSheet();
  sheet.set('genome', genomeMods);
  const q = new StatQuery(sheet);
  const life = Math.max(0.05, q.scale('life'));
  const damage = Math.max(0.05, q.scale('damage'));
  const out = [more('life', (RANK.boss.life * M.bossLife) / life - 1), more('damage', (RANK.boss.damage * M.bossDamage) / damage - 1)];
  // armour plating and shields from parts and elite mods: kept, but never a wall (Kryssa's
  // Armoured shell made her 4× slower to kill than the boss before her)
  const armour = sheet.get('armour');
  if (armour > M.bossArmour) out.push(more('armour', M.bossArmour / armour - 1));
  const block = sheet.get('block.chance');
  if (block > M.bossBlock) out.push(flat('block.chance', M.bossBlock - block));
  return out;
}
