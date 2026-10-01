import { Registry } from '../../core/registry';
import type { DamageType, SkillDef } from '../../core/types';

/**
 * Monster skills as core `SkillDef`s (combat runs them like any skill) plus what a brain
 * needs: range, role and a telegraph. `anim` names a generated monster clip; its hit frame
 * (clip.userData.hit) is when combat applies the effects.
 */
export interface TelegraphSpec {
  readonly shape: 'circle' | 'cone' | 'line';
  /** Circle radius / cone length / line length (m, scaled by the monster's size). */
  readonly size: number;
  /** Cone angle (deg) or line width (m). */
  readonly width?: number;
  /** Where it's drawn: at the caster, or at the target's position. */
  readonly at: 'self' | 'target';
}

export type SkillRole = 'melee' | 'ranged' | 'charge' | 'leap' | 'summon' | 'explode' | 'support' | 'area';

export interface MonsterSkillDef extends SkillDef {
  readonly role: SkillRole;
  /** Use when the target is within [minRange, range] (m). */
  readonly range: number;
  readonly minRange?: number;
  readonly telegraph?: TelegraphSpec;
  /** Looping clip to hold during the delivery (charge run). */
  readonly loopAnim?: string;
  /** The monster dies when it fires (bombers). */
  readonly selfDestruct?: boolean;
}

const dmg = (type: DamageType, lo: number, hi: number) => ({ kind: 'damage' as const, base: { [type]: [lo, hi] as [number, number] } });

const S = (s: Omit<MonsterSkillDef, 'cost' | 'description'> & { description?: string }): MonsterSkillDef => ({ cost: 0, description: s.description ?? s.name, ...s });

export const MONSTER_SKILLS = new Registry<MonsterSkillDef>('monster skills', [
  S({ id: 'bite', name: 'Bite', tags: ['attack', 'melee'], role: 'melee', range: 1.0, cooldown: 1.1, castTime: 0.6, anim: 'Bite', delivery: { kind: 'strike', range: 1.0, arc: 70 }, effects: [dmg('physical', 4, 7), { kind: 'ailment', ailment: 'bleed', chance: 0.1 }] }),
  S({ id: 'claw', name: 'Claw Swipe', tags: ['attack', 'melee'], role: 'melee', range: 1.15, cooldown: 1.2, castTime: 0.65, anim: 'Claw', delivery: { kind: 'strike', range: 1.15, arc: 120 }, effects: [dmg('physical', 4, 8)] }),
  S({ id: 'swing', name: 'Weapon Swing', tags: ['attack', 'melee'], role: 'melee', range: 1.4, cooldown: 1.4, castTime: 0.75, anim: 'Claw', delivery: { kind: 'strike', range: 1.4, arc: 110 }, effects: [dmg('physical', 6, 10), { kind: 'knockback', force: 2 }] }),
  S({ id: 'slam', name: 'Ground Slam', tags: ['attack', 'melee', 'area'], role: 'area', range: 1.8, cooldown: 5, castTime: 1.1, anim: 'Slam', delivery: { kind: 'slam', radius: 2.2, delay: 0 }, effects: [dmg('physical', 9, 14), { kind: 'knockback', force: 5 }, { kind: 'particles', preset: 'impact', count: 20 }], telegraph: { shape: 'circle', size: 2.2, at: 'self' } }),
  S({ id: 'charge', name: 'Charge', tags: ['attack', 'melee', 'movement', 'charge'], role: 'charge', range: 8, minRange: 3, cooldown: 6, castTime: 0.8, anim: 'ChargeWindup', loopAnim: 'Charge', delivery: { kind: 'dash', distance: 8, hitWidth: 1 }, effects: [dmg('physical', 8, 13), { kind: 'knockback', force: 7 }], telegraph: { shape: 'line', size: 8, width: 1.2, at: 'self' } }),
  S({ id: 'leap', name: 'Pounce', tags: ['attack', 'melee', 'area', 'movement'], role: 'leap', range: 6.5, minRange: 2.5, cooldown: 5, castTime: 0.9, anim: 'Leap', delivery: { kind: 'slam', radius: 1.5, delay: 0 }, effects: [dmg('physical', 7, 11), { kind: 'knockback', force: 3 }], telegraph: { shape: 'circle', size: 1.5, at: 'target' } }),
  S({ id: 'tailwhip', name: 'Tail Whip', tags: ['attack', 'melee', 'area'], role: 'melee', range: 1.6, cooldown: 4, castTime: 0.8, anim: 'TailWhip', delivery: { kind: 'strike', range: 1.6, arc: 240 }, effects: [dmg('physical', 6, 9), { kind: 'knockback', force: 4 }, { kind: 'ailment', ailment: 'poison', chance: 0.2 }] }),
  S({ id: 'spit', name: 'Acid Spit', tags: ['attack', 'projectile', 'chaos'], role: 'ranged', range: 8, minRange: 2, cooldown: 2.2, castTime: 0.7, anim: 'Spit', delivery: { kind: 'projectile', speed: 9, count: 1, spread: 0, pierce: 0, chain: 0, range: 10 }, effects: [dmg('chaos', 4, 7), { kind: 'ailment', ailment: 'poison', chance: 0.3 }] }),
  S({ id: 'firebolt', name: 'Firebolt', tags: ['spell', 'projectile', 'fire'], role: 'ranged', range: 9, minRange: 3, cooldown: 2, castTime: 0.8, anim: 'Cast', delivery: { kind: 'projectile', speed: 10, count: 1, spread: 0, pierce: 0, chain: 0, range: 11 }, effects: [dmg('fire', 5, 9), { kind: 'ailment', ailment: 'ignite', chance: 0.2 }, { kind: 'light', color: 0xef7d57, intensity: 2, radius: 3, duration: 0.6 }] }),
  S({ id: 'frostbolt', name: 'Frost Shard', tags: ['spell', 'projectile', 'cold'], role: 'ranged', range: 9, minRange: 3, cooldown: 2, castTime: 0.8, anim: 'Cast', delivery: { kind: 'projectile', speed: 9, count: 3, spread: 18, pierce: 0, chain: 0, range: 10 }, effects: [dmg('cold', 3, 6), { kind: 'ailment', ailment: 'chill', chance: 0.4 }] }),
  S({ id: 'sparkbolt', name: 'Spark', tags: ['spell', 'projectile', 'lightning'], role: 'ranged', range: 9, minRange: 3, cooldown: 1.8, castTime: 0.7, anim: 'Cast', delivery: { kind: 'projectile', speed: 12, count: 1, spread: 0, pierce: 0, chain: 2, range: 11 }, effects: [dmg('lightning', 2, 11), { kind: 'ailment', ailment: 'shock', chance: 0.2 }] }),
  S({ id: 'voidbolt', name: 'Void Orb', tags: ['spell', 'projectile', 'chaos'], role: 'ranged', range: 9, minRange: 3, cooldown: 2.4, castTime: 0.9, anim: 'Cast', delivery: { kind: 'projectile', speed: 6, count: 1, spread: 0, pierce: 1, chain: 0, range: 11 }, effects: [dmg('chaos', 6, 10)] }),
  S({ id: 'nova', name: 'Nova', tags: ['spell', 'area'], role: 'area', range: 3, cooldown: 6, castTime: 1.0, anim: 'Cast', delivery: { kind: 'nova', radius: 3.2 }, effects: [dmg('fire', 6, 10), { kind: 'particles', preset: 'sparkle', count: 30 }], telegraph: { shape: 'circle', size: 3.2, at: 'self' } }),
  S({ id: 'snipe', name: 'Snipe', tags: ['attack', 'projectile'], role: 'ranged', range: 14, minRange: 5, cooldown: 3.5, castTime: 1.3, anim: 'Spit', delivery: { kind: 'projectile', speed: 20, count: 1, spread: 0, pierce: 1, chain: 0, range: 16 }, effects: [dmg('physical', 10, 15)], telegraph: { shape: 'line', size: 14, width: 0.4, at: 'self' } }),
  S({ id: 'summon', name: 'Call Minions', tags: ['spell', 'minion'], role: 'summon', range: 14, cooldown: 9, castTime: 1.4, anim: 'Summon', delivery: { kind: 'summon', genome: 'minion', count: 3, duration: 20 }, effects: [{ kind: 'particles', preset: 'smoke', count: 16 }] }),
  S({ id: 'explode', name: 'Detonate', tags: ['attack', 'area', 'fire'], role: 'explode', range: 1.6, cooldown: 99, castTime: 1.0, anim: 'Explode', selfDestruct: true, delivery: { kind: 'nova', radius: 2.6 }, effects: [dmg('fire', 12, 18), { kind: 'knockback', force: 6 }, { kind: 'particles', preset: 'impact', count: 40 }], telegraph: { shape: 'circle', size: 2.6, at: 'self' } }),
  S({ id: 'ward', name: 'Warding Pulse', tags: ['spell', 'aura'], role: 'support', range: 12, cooldown: 8, castTime: 0.9, anim: 'Cast', delivery: { kind: 'aura', radius: 6 }, effects: [{ kind: 'buff', mods: [{ stat: 'damage', kind: 'inc', value: 0.25 }, { stat: 'armour', kind: 'flat', value: 30 }], duration: 6, target: 'allies' }] }),
]);

/** Element bolt for a theme. */
export function boltFor(tags: readonly string[]): string {
  if (tags.some((t) => t === 'fire' || t === 'blood')) return 'firebolt';
  if (tags.some((t) => t === 'ice' || t === 'water' || t === 'crystal')) return 'frostbolt';
  if (tags.some((t) => t === 'storm' || t === 'construct')) return 'sparkbolt';
  return 'voidbolt';
}
