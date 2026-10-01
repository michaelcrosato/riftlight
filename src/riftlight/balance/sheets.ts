/**
 * StatSheets for the sim: the hero (base + level + tree + gear), its minions and monsters
 * (base + genome mods + depth scaling). A `RecordingSheet` remembers every stat the sim read,
 * so the report can list stats a build has that nothing reads ("dead stats").
 */
import { flat, more, StatSheet, type Mod } from '../core/mods';
import { SCALING } from '../core/scaling';
import { equipmentMods, type Equipment } from '../loot/itemMods';
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
 * Stat names other systems write → the names combat reads. Every entry is a contract gap
 * between systems: the sim applies it (unless --raw) and the report lists which ones a
 * build needed, so the integration can rename the stat at its source.
 */
export const STAT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'crit.multi': ['crit.multiplier'],
  block: ['block.chance'],
  'block.spells': ['spell.block'],
  'energy.shield': ['es'],
  'crit.chance.base': ['weapon.crit'],
  'life.leech': ['leech.life'],
  'mana.leech': ['leech.mana'],
  'mana.cost': ['cost'],
  'projectile.count': ['projectiles'],
  'res.elemental': ['res.fire', 'res.cold', 'res.lightning'],
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
  if (h.tree?.length) sheet.set('tree', fix(h.tree));
  if (h.equipment) for (const [source, mods] of Object.entries(equipmentMods(h.equipment))) sheet.set(source, fix(mods));
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
  owner?: StatSheet;
  ownerMods?: readonly Mod[];
  assumptions: Assumptions;
  reads?: Set<string>;
  aliasesUsed?: Set<string>;
}): RecordingSheet {
  const sheet = new RecordingSheet({}, o.reads);
  sheet.set('base', Object.entries(o.base).map(([k, v]) => flat(k, v)));
  sheet.set('summoner', stripMinion(o.skillMods));
  sheet.set('level', [flat('life', 8 * (o.gemLevel - 1))]);
  if (o.assumptions.aliases && o.ownerMods) {
    const extra: Mod[] = [];
    for (const m of o.ownerMods) {
      const to = MINION_STATS[m.stat];
      if (to) {
        o.aliasesUsed?.add(`${m.stat} (owner) → minion ${to.join(', ')}`);
        for (const stat of to) extra.push({ ...m, stat });
      } else if (m.tags?.includes('minion')) extra.push(...stripMinion([m]));
    }
    sheet.set('owner', extra);
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

/** Depth scaling as mods (the monster's `depth` source). */
export function depthMods(depth: number): Mod[] {
  return [more('life', SCALING.monsterLife(depth) - 1), more('damage', SCALING.monsterDamage(depth) - 1)];
}

export function monsterSheet(m: MonsterInput, a: Assumptions, extra: readonly Mod[] = []): StatSheet {
  const sheet = new StatSheet();
  sheet.set('base', Object.entries(a.monsterBase).map(([k, v]) => flat(k, v)));
  sheet.set('genome', m.mods);
  sheet.set('depth', depthMods(m.depth));
  if (extra.length) sheet.set('phase', extra);
  return sheet;
}
