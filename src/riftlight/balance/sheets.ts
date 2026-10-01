/**
 * StatSheets for the sim: the hero (base + level + tree + gear), its minions and monsters
 * (base + genome mods + depth scaling). A `RecordingSheet` remembers every stat the sim read,
 * so the report can list stats a build has that nothing reads ("dead stats").
 */
import { flat, inc, StatSheet, type Mod } from '../core/mods';
import { STAT_ALIASES as CANONICAL, STAT_EXPANSIONS } from '../core/stats';
import { minionLevelMods, ownerMinionMods } from '../combat/minions';
import { equipmentMods, type Equipment } from '../loot/itemMods';
import { bossBudget, monsterBase, monsterDepthMods, starterWeapon } from '../wire/progression';
import { WIRE_TUNING } from '../wire/tuning';
import { HERO_BASE, type Assumptions } from './assumptions';

/** A StatSheet that records which stats were read. */
export class RecordingSheet extends StatSheet {
  constructor(
    base: Readonly<Record<string, number>> = {},
    readonly reads: Set<string> = new Set(),
  ) {
    super(base);
  }
  override get(stat: string, tags: readonly string[] = []): number {
    this.reads.add(stat);
    return super.get(stat, tags);
  }
  override explain(stat: string, tags: readonly string[] = []) {
    this.reads.add(stat);
    return super.explain(stat, tags);
  }
}

/**
 * Stat names other systems write → the names combat reads: the canonical table every
 * StatSheet applies (core/stats.ts). Every entry is a contract gap between systems; the
 * report lists which ones a build needed, so producers can switch to the canonical name.
 */
export const STAT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(Object.entries(CANONICAL).map(([from, to]) => [from, [to]])),
  ...STAT_EXPANSIONS,
};

/** Owner stats that are meant for minions (applied to the minion's sheet as the stat after →). */
export const MINION_STATS: Readonly<Record<string, readonly string[]>> = {
  'minion.damage': ['damage'],
  'minion.life': ['life'],
  'minion.speed': ['attack.speed', 'move.speed'],
};

/** Apply STAT_ALIASES; `used` collects the aliases that fired. */
export function aliasMods(mods: readonly Mod[], used?: Set<string>): Mod[] {
  const out: Mod[] = [];
  for (const m of mods) {
    const to = STAT_ALIASES[m.stat];
    if (!to) {
      out.push(m);
      continue;
    }
    used?.add(`${m.stat} → ${to.join(', ')}`);
    for (const stat of to) out.push({ ...m, stat });
  }
  return out;
}

export interface HeroSetup {
  readonly level: number;
  readonly equipment?: Equipment;
  /** Tree node mods (already collected). */
  readonly tree?: readonly Mod[];
  readonly assumptions: Assumptions;
  readonly reads?: Set<string>;
  readonly aliasesUsed?: Set<string>;
}

/** Base record of the hero at a character level. */
export function heroBase(level: number, a: Assumptions): Record<string, number> {
  const base: Record<string, number> = { ...HERO_BASE };
  for (const [k, v] of Object.entries(a.heroGrowth)) base[k] = (base[k] ?? 0) + v * Math.max(0, level - 1);
  return base;
}

export function heroSheet(h: HeroSetup): RecordingSheet {
  const sheet = new RecordingSheet({}, h.reads);
  sheet.set('base', Object.entries(heroBase(h.level, h.assumptions)).map(([k, v]) => flat(k, v)));
  const fix = (mods: readonly Mod[]) => (h.assumptions.aliases ? aliasMods(mods, h.aliasesUsed) : [...mods]);
  // the real hero's per-level damage (wire/progression.ts levelMods)
  if (h.level > 1) sheet.set('level', [inc('damage', WIRE_TUNING.hero.perLevel.damage * (h.level - 1))]);
  if (h.tree?.length) sheet.set('tree', fix(h.tree));
  if (h.equipment) for (const [source, mods] of Object.entries(equipmentMods(h.equipment))) sheet.set(source, fix(mods));
  // the real hero carries its starter sword until gear brings a weapon (wire/hero.ts, botTown rig)
  if (!h.equipment?.weapon) sheet.set('starter', starterWeapon());
  return sheet;
}

/**
 * The minion's sheet: its base record, the summon gem's mods with the 'minion' scope removed
 * and life per gem level, as `placeholderMinion` (combat/minions.ts) builds it; with aliases,
 * also the owner's `minion.*` stats and owner mods scoped to minions.
 */
export function minionSheet(o: {
  base: Readonly<Record<string, number>>;
  skillMods: readonly Mod[];
  gemLevel: number;
  /** The summoner's character level (minions grow with it: combat/minions.ts minionLevelMods). */
  ownerLevel?: number;
  owner?: StatSheet;
  ownerMods?: readonly Mod[];
  assumptions: Assumptions;
  reads?: Set<string>;
  aliasesUsed?: Set<string>;
}): RecordingSheet {
  const sheet = new RecordingSheet({}, o.reads);
  sheet.set('base', Object.entries(o.base).map(([k, v]) => flat(k, v)));
  sheet.set('summoner', stripMinion(o.skillMods));
  sheet.set('level', minionLevelMods(o.gemLevel, o.ownerLevel ?? 1));
  if (o.ownerMods) {
    // what the game does: combat/minions.ts ownerMinionMods (`minion.<stat>` and 'minion'-scoped mods)
    const owner = new StatSheet();
    owner.set('owner', o.ownerMods);
    for (const m of o.ownerMods) {
      const to = MINION_STATS[m.stat];
      if (to) o.aliasesUsed?.add(`${m.stat} (owner) → minion ${to.join(', ')}`);
    }
    sheet.set('owner', ownerMinionMods(owner));
  }
  return sheet;
}

function stripMinion(mods: readonly Mod[]): Mod[] {
  return mods
    .filter((m) => !m.tags || m.tags.includes('minion'))
    .map((m) => {
      const tags = m.tags?.filter((t) => t !== 'minion');
      return { ...m, tags: tags?.length ? tags : undefined };
    });
}

/** A monster as plain data (genome stats and skills from the monsters system). */
export interface MonsterInput {
  readonly id: string;
  readonly rank: 'normal' | 'magic' | 'rare' | 'boss';
  readonly depth: number;
  /** Genome stat mods (plan, parts, archetype, elite, rank multipliers): `buildMonster(g).stats`. */
  readonly mods: readonly Mod[];
  /** Monster skill ids (MONSTER_SKILLS). */
  readonly skills: readonly string[];
  readonly archetype?: string;
  readonly plan?: string;
  readonly name?: string;
  /** Boss phases: extra mods per phase (averaged over equal thirds of the fight). */
  readonly phases?: readonly (readonly Mod[])[];
  /** Boss enrage: after this many seconds, these mods. */
  readonly enrage?: { readonly after: number; readonly mods: readonly Mod[] };
}

/** Depth scaling as mods (the monster's `depth` source, as the real monster port sets it). */
export function depthMods(depth: number): Mod[] {
  return monsterDepthMods(depth);
}

export function monsterSheet(m: MonsterInput, a: Assumptions, extra: readonly Mod[] = []): StatSheet {
  const sheet = new StatSheet();
  // armour and accuracy grow with depth in the real monster port
  const grown = monsterBase(m.depth);
  sheet.set('base', Object.entries({ ...a.monsterBase, armour: grown.armour!, accuracy: grown.accuracy! }).map(([k, v]) => flat(k, v)));
  sheet.set('genome', m.mods);
  sheet.set('depth', depthMods(m.depth));
  // bosses follow the depth curve, whatever their parts (wire/progression.ts bossBudget)
  if (m.rank === 'boss') sheet.set('boss', bossBudget(m.mods));
  if (extra.length) sheet.set('phase', extra);
  return sheet;
}
