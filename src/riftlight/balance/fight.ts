/**
 * Fights as expected values: the hero's damage against a monster (with mana sustain and its
 * minions), a monster's damage against the hero, and what that means: time to kill, damage
 * taken per second, hits to die, time to die, pack and boss fights. Pure.
 */
import type { Mod, StatSheet } from '../core/mods';
import type { Defender } from '../combat/damage';
import { MINION_BASE, MINION_STRIKE } from '../combat/minions';
import { LEECH_RATE } from '../combat/tuning';
import { MONSTER_SKILLS } from '../monsters/brains/skills';
import { buildSkill, MAX_GEM_LEVEL } from '../skills/build';
import type { ResolvedSkill, SkillGem, SupportLink } from '../skills/types';
import { equipmentMods } from '../loot/itemMods';
import type { Assumptions } from './assumptions';
import type { BuildArchetype } from './builds';
import { skillDps } from './dps';
import { heroSheet, minionSheet, monsterSheet, type HeroSetup, type MonsterInput, type RecordingSheet } from './sheets';

/** Highest gem level a hero of `level` can equip (loot: gems need 1 + 3 per gem level). */
export const gemLevelFor = (level: number): number => Math.max(1, Math.min(MAX_GEM_LEVEL, Math.floor((level - 1) / 3) + 1));

export interface HeroLoadout {
  readonly build: BuildArchetype;
  readonly level: number;
  readonly gemLevel: number;
  readonly sheet: RecordingSheet;
  readonly skill: ResolvedSkill;
  readonly fallback: ResolvedSkill;
  readonly minion?: { readonly sheet: StatSheet; readonly attack: ResolvedSkill; readonly count: number };
  readonly maxLife: number;
  readonly maxMana: number;
  readonly es: number;
  readonly assumptions: Assumptions;
}

export function makeLoadout(build: BuildArchetype, setup: HeroSetup): HeroLoadout {
  const sheet = heroSheet(setup);
  const gemLevel = gemLevelFor(setup.level);
  const links: SupportLink[] = build.supports.map((gem) => ({ gem, level: gemLevel }));
  const skill = buildSkill(build.skill, links, sheet, { level: gemLevel });
  const fallback = buildSkill(setup.assumptions.fallbackSkill, [], sheet, { level: gemLevel });
  let minion: HeroLoadout['minion'];
  const d = skill.delivery;
  if (d.kind === 'summon') {
    const ownerMods = [...(setup.tree ?? []), ...Object.values(equipmentMods(setup.equipment ?? {})).flat()];
    const ms = minionSheet({
      base: MINION_BASE[d.genome] ?? MINION_BASE.minion!,
      skillMods: skill.mods,
      gemLevel,
      ownerMods,
      assumptions: setup.assumptions,
      reads: setup.reads,
      aliasesUsed: setup.aliasesUsed,
    });
    // placeholderMinion: the minion strike, with the summon gem's damage and a fixed 0.8 s swing
    const base = buildSkill(MINION_STRIKE, [], ms);
    const attack: ResolvedSkill = { ...base, damage: skill.damage ? { ...skill.damage, tags: base.damage?.tags ?? skill.damage.tags } : base.damage, castTime: 0.8 };
    minion = { sheet: ms, attack, count: d.count * setup.assumptions.minionBatches };
  }
  return {
    build,
    level: setup.level,
    gemLevel,
    sheet,
    skill,
    fallback,
    minion,
    maxLife: Math.max(1, sheet.get('life')),
    maxMana: Math.max(0, sheet.get('mana')),
    es: Math.max(0, sheet.get('es')),
    assumptions: setup.assumptions,
  };
}

/** A monster's sheet with its life and defences, as the hero's hits see it. */
export interface MonsterTarget {
  readonly input: MonsterInput;
  readonly sheet: StatSheet;
  readonly life: number;
  readonly es: number;
  readonly defender: Defender;
}

export function monsterTarget(m: MonsterInput, a: Assumptions, extra: readonly Mod[] = []): MonsterTarget {
  const sheet = monsterSheet(m, a, extra);
  const life = Math.max(1, sheet.get('life'));
  const es = Math.max(0, sheet.get('es'));
  return { input: m, sheet, life, es, defender: { stats: sheet, life, maxLife: life, es, shock: 0 } };
}

export interface Offense {
  /** Sustained DPS on one target over a fight of the given length, and per enemy in a pack of n. */
  readonly single: number;
  /** DPS of the main skill alone (no mana limit). */
  readonly burst: number;
  /** DPS summed over a pack of `n` (n enemies in reach up to the delivery's reach). */
  pack(n: number): number;
  /** Share of the time the main skill can be afforded. */
  readonly sustain: number;
  readonly manaPerSecond: number;
  /** Life leeched per second (capped). */
  readonly leech: number;
  /** The main skill alone and the free fallback, without the mana limit (single target / over a pack of n). */
  readonly skill: { single: number; pack(n: number): number };
  readonly fallback: { single: number; pack(n: number): number };
  /** Mana regenerated or leeched per second. */
  readonly manaIn: number;
}

/** Enemies the main skill reaches in a pack fight. */
export function reachOf(h: HeroLoadout, skill: ResolvedSkill = h.skill): number {
  const d = skill.delivery;
  const r = h.assumptions.reach;
  if (d.kind === 'strike') return skill.tags.includes('area') ? (r['strike+area'] ?? 3) : (r.strike ?? 1);
  return r[d.kind] ?? 1;
}

/** The hero's damage against `t` in a fight lasting about `fightTime` seconds. */
export function heroOffense(h: HeroLoadout, t: MonsterTarget, fightTime = 10): Offense {
  if (h.minion) {
    const per = skillDps(h.minion.sheet, h.minion.attack, t.defender, 1).dps.total;
    const total = per * h.minion.count;
    // recast each batch when it expires (permanent minions: once)
    const d = h.skill.delivery;
    const mps = d.kind === 'summon' && d.duration > 0 ? (h.skill.cost * h.assumptions.minionBatches) / d.duration : 0;
    // each minion fights one enemy: a pack spreads them, the total stays the same
    const raw = { single: total, pack: () => total };
    return { single: total, burst: total, pack: () => total, sustain: 1, manaPerSecond: mps, leech: 0, skill: raw, fallback: raw, manaIn: Math.max(0, h.sheet.get('mana.regen')) };
  }
  const main = skillDps(h.sheet, h.skill, t.defender, 1);
  const fb = skillDps(h.sheet, h.fallback, t.defender, 1);
  const regen = Math.max(0, h.sheet.get('mana.regen'));
  const leechMana = Math.min(h.maxMana * LEECH_RATE, main.dps.hit * Math.max(0, h.sheet.get('leech.mana')));
  const mps = main.manaPerSecond;
  const supply = regen + leechMana + h.maxMana / Math.max(1, fightTime);
  const sustain = mps > 0 ? Math.min(1, supply / mps) : 1;
  const single = sustain * main.dps.total + (1 - sustain) * fb.dps.total;
  const reach = reachOf(h);
  const skillPack = (n: number) => (n <= 1 ? main.dps.total : skillDps(h.sheet, h.skill, t.defender, Math.min(n, reach)).dps.pack);
  const fbPack = (n: number) => (n <= 1 ? fb.dps.total : skillDps(h.sheet, h.fallback, t.defender, Math.min(n, reachOf(h, h.fallback))).dps.pack);
  const pack = (n: number) => sustain * skillPack(n) + (1 - sustain) * fbPack(n);
  const leech = Math.min(h.maxLife * LEECH_RATE, single * Math.max(0, h.sheet.get('leech.life')));
  return { single, burst: main.dps.total, pack, sustain, manaPerSecond: mps, leech, skill: { single: main.dps.total, pack: skillPack }, fallback: { single: fb.dps.total, pack: fbPack }, manaIn: regen + leechMana };
}

export interface MonsterAttack {
  readonly skill: string;
  /** Average damage of one landed hit on the hero (after armour, resistances, ...). */
  readonly hit: number;
  /** DPS while attacking with only this skill (cooldown-limited). */
  readonly dps: number;
  readonly busy: number;
}

export interface Defense {
  /** Damage per second this monster deals to the hero while engaged (uptime applied). */
  readonly dtps: number;
  /** Its biggest landed hit. */
  readonly biggestHit: number;
  readonly attacks: readonly MonsterAttack[];
}

/** What monster `t` does to hero `h`. */
export function monsterOffense(t: MonsterTarget, h: HeroLoadout): Defense {
  const hero: Defender = { stats: h.sheet, life: h.maxLife, maxLife: h.maxLife, es: h.es, shock: 0 };
  const attacks: MonsterAttack[] = [];
  for (const id of t.input.skills) {
    if (!MONSTER_SKILLS.has(id)) continue;
    const def = MONSTER_SKILLS.get(id);
    if (def.role === 'summon' || def.role === 'support') continue;
    const s = buildSkill(def as unknown as SkillGem, [], t.sheet);
    if (!s.damage) continue;
    const r = skillDps(t.sheet, s, hero, 1);
    const hit = Object.values(r.hit?.mitigated ?? {}).reduce((a, b) => a + (b ?? 0), 0);
    const period = Math.max(s.castTime, s.cooldown);
    attacks.push({ skill: id, hit, dps: def.selfDestruct ? 0 : r.dps.total, busy: def.selfDestruct ? 0 : s.castTime / Math.max(0.05, period) });
  }
  const busy = attacks.reduce((s, a) => s + a.busy, 0);
  const share = busy > 1 ? 1 / busy : 1;
  const dtps = attacks.reduce((s, a) => s + a.dps, 0) * share * h.assumptions.monsterUptime;
  return { dtps, biggestHit: Math.max(0, ...attacks.map((a) => a.hit)), attacks };
}

export interface Duel {
  /** Seconds to kill it alone. */
  readonly ttk: number;
  readonly dps: number;
  readonly sustain: number;
  /** Damage it deals to the hero per second (uptime applied). */
  readonly dtps: number;
  /** Hero life + ES over its biggest hit. */
  readonly hitsToDie: number;
  /** Seconds until the hero dies fighting it (regen and leech counted); Infinity when it can't. */
  readonly timeToDie: number;
}

/** One hero against one monster. */
export function duel(h: HeroLoadout, t: MonsterTarget): Duel {
  let fight = 10;
  let off = heroOffense(h, t, fight);
  for (let i = 0; i < 4; i++) {
    fight = (t.life + t.es) / Math.max(1e-6, off.single);
    off = heroOffense(h, t, fight);
  }
  const ttk = (t.life + t.es) / Math.max(1e-6, off.single);
  const def = monsterOffense(t, h);
  const ehp = h.maxLife + h.es;
  const net = def.dtps - Math.max(0, h.sheet.get('life.regen')) - off.leech;
  return { ttk, dps: off.single, sustain: off.sustain, dtps: def.dtps, hitsToDie: ehp / Math.max(1e-6, def.biggestHit), timeToDie: net > 0 ? ehp / net : Infinity };
}

export interface PackFight {
  readonly time: number;
  /** Damage the hero takes over the fight (before regen). */
  readonly damage: number;
  /** Net life lost over the fight as a share of life + ES (> 1: the hero dies without potions). */
  readonly lifeLost: number;
}

/**
 * A pack: `members` die one target group at a time; the hero's area reaches `reach` of them.
 * Monsters alive keep hitting at `packEngaged` × their DPS.
 */
export function packFight(h: HeroLoadout, members: readonly MonsterTarget[]): PackFight {
  const n = members.length;
  if (!n) return { time: 0, damage: 0, lifeLost: 0 };
  const reach = h.minion ? 1 : reachOf(h);
  let time = 0;
  let damage = 0;
  // pack(n) is the damage spread over min(n, reach) enemies: each member takes its share
  for (const m of members) time += (m.life + m.es) / Math.max(1e-6, heroOffense(h, m, 10).pack(n));
  const alive = reach >= n ? 1 : 0.5 + 0.5 / n;
  for (const m of members) damage += monsterOffense(m, h).dtps * h.assumptions.packEngaged * time * alive;
  const off = heroOffense(h, members[0]!, time);
  const recover = (Math.max(0, h.sheet.get('life.regen')) + off.leech) * time;
  return { time, damage, lifeLost: Math.max(0, damage - recover) / (h.maxLife + h.es) };
}

export interface BossFight extends Duel {
  readonly enraged: boolean;
  /** The hero dies before the boss does (no potions, dodging only through the uptime assumption). */
  readonly dies: boolean;
}

/** The boss: phases averaged over equal thirds, enrage after its timer. */
export function bossFight(h: HeroLoadout, boss: MonsterInput, a: Assumptions): BossFight {
  const t = monsterTarget(boss, a);
  const base = duel(h, t);
  const phases = boss.phases?.length ? boss.phases : [[]];
  let dtps = 0;
  let biggest = 0;
  for (const mods of phases) {
    const pt = monsterTarget(boss, a, mods);
    const d = monsterOffense(pt, h);
    dtps += d.dtps / phases.length;
    biggest = Math.max(biggest, d.biggestHit);
  }
  let enraged = false;
  if (boss.enrage && base.ttk > boss.enrage.after) {
    enraged = true;
    const e = monsterOffense(monsterTarget(boss, a, boss.enrage.mods), h).dtps;
    const share = (base.ttk - boss.enrage.after) / base.ttk;
    dtps = dtps * (1 - share) + e * share;
  }
  const ehp = h.maxLife + h.es;
  const off = heroOffense(h, t, base.ttk);
  const net = dtps - Math.max(0, h.sheet.get('life.regen')) - off.leech;
  const timeToDie = net > 0 ? ehp / net : Infinity;
  return { ...base, dtps, hitsToDie: ehp / Math.max(1e-6, biggest), timeToDie, enraged, dies: timeToDie < base.ttk };
}
