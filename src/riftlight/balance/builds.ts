/**
 * Build archetypes the sim plays: a main skill with supports, the weapon and offhand classes
 * a geared version wears, and the build systems it uses (a curse, auras, a totem). Each runs
 * `naked` (no gear, no tree) and `geared` (rolled rares at the depth's item level plus a
 * greedy tree). Add an entry to try another build.
 */
export interface BuildArchetype {
  readonly id: string;
  readonly name: string;
  readonly skill: string;
  readonly supports: readonly string[];
  /** Weapon base `look`s (and hands) a geared version may wear. */
  readonly weapon: { readonly looks: readonly string[]; readonly hands?: 1 | 2 };
  /** Offhand `look` (none for two-handers other than bows). */
  readonly offhand?: string;
  /** A curse gem it keeps on what it fights (expected value: the curse's mods × `curseUptime` on targets that aren't immune). */
  readonly curse?: string;
  /** Aura gems it keeps on: their buffs on the hero and its minions, their reservation off the mana pool. */
  readonly auras?: readonly string[];
  /** A second damage skill, placed: a totem (an extra caster with the hero's stats) or a trap. */
  readonly extra?: { readonly skill: string; readonly supports: readonly string[] };
  /** Chart colour (RGB). */
  readonly color: readonly [number, number, number];
}

export type Variant = 'naked' | 'geared';
export const VARIANTS: readonly Variant[] = ['naked', 'geared'];

// Categorical slots 1–4 of the dataviz reference palette, dark-surface steps.
export const BUILDS: readonly BuildArchetype[] = [
  { id: 'melee', name: 'Melee (cleave)', skill: 'cleave', supports: ['melee-physical', 'multistrike', 'increased-area'], weapon: { looks: ['sword', 'axe', 'mace'], hands: 2 }, curse: 'vulnerability', auras: ['determination'], color: [57, 135, 229] },
  { id: 'caster', name: 'Caster (fireball)', skill: 'fireball', supports: ['fire-penetration', 'faster-casting', 'burning-damage'], weapon: { looks: ['wand'] }, offhand: 'focus', curse: 'elemental-weakness', extra: { skill: 'fireball', supports: ['spell-totem', 'fire-penetration'] }, color: [217, 89, 38] },
  { id: 'bow', name: 'Bow (split arrow)', skill: 'split-arrow', supports: ['faster-attacks', 'pierce', 'added-cold'], weapon: { looks: ['bow'] }, offhand: 'quiver', curse: 'vulnerability', auras: ['haste-aura'], extra: { skill: 'split-arrow', supports: ['ballista-totem', 'faster-attacks'] }, color: [25, 158, 112] },
  { id: 'minion', name: 'Minion (skeletons)', skill: 'summon-skeletons', supports: ['minion-damage', 'minion-speed', 'minion-life'], weapon: { looks: ['sceptre'] }, offhand: 'shield', curse: 'vulnerability', auras: ['haste-aura'], color: [201, 133, 0] },
];

export const buildKey = (b: BuildArchetype | string, v: Variant): string => `${typeof b === 'string' ? b : b.id}/${v}`;
