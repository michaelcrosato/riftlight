import { inc, more } from '../../core/mods';
import { Registry } from '../../core/registry';
import type { Rng } from '../../core/rng';
import { buildMonster } from '../build';
import { generateGenome } from '../genome';
import type { BuiltMonster } from '../types';
import { attackSkill, BOSS_ATTACKS, MECHANIC_THEMES, type BossAttackDef } from './attacks';
import { DESIGNED_BOSSES } from './designed';
import { bossName } from './names';
import type { BossDef, BossPhase } from './types';

/**
 * Bosses: a boss genome (rank 'boss': big, extra parts) plus a script of phases (HP
 * thresholds), signature attacks from the boss-module registry, an enrage timer and an
 * arena. Twelve are designed (one per level); `generateBoss` builds one for any rift from
 * its mechanics. `BossBrain` (brain.ts) runs the script.
 */
export const BOSSES = new Registry<BossDef>('bosses', DESIGNED_BOSSES);

/** Every monster skill a boss's attacks play (so its genome builds those clips). */
export function bossSkills(boss: BossDef): string[] {
  const ids = new Set<string>();
  for (const p of boss.phases) for (const a of [...p.attacks, ...(p.onEnter ?? [])]) ids.add(attackSkill(BOSS_ATTACKS.get(a)));
  return [...ids];
}

/** Build a boss's monster with every clip its script needs. */
export function buildBoss(boss: BossDef): BuiltMonster {
  return buildMonster(boss.genome, { extraSkills: bossSkills(boss) });
}

/** The designed boss for level 1..12. */
export function designedBoss(level: number): BossDef {
  const b = DESIGNED_BOSSES.find((x) => x.level === level);
  if (!b) throw new Error(`no designed boss for level ${level}`);
  return b;
}

const BOSS_ARCHETYPES = ['charger', 'tank', 'caster', 'summoner', 'leaper'];

/**
 * A rift boss from its mechanics: themed genome (rank boss), attacks picked from the
 * modules tagged with those mechanics (plus generic ones), three escalating phases, a
 * generated name. Deterministic in `rng`.
 */
export function generateBoss(rng: Rng, depth: number, mechanics: readonly string[]): BossDef {
  const tags = [...new Set(mechanics.flatMap((m) => MECHANIC_THEMES[m] ?? []))];
  const archetype = rng.fork('archetype').pick(BOSS_ARCHETYPES);
  const genome = generateGenome(rng.fork('genome'), { depth, tags: tags.length ? tags : undefined, archetype, rank: 'boss' });
  const r = rng.fork('attacks');
  const themed = BOSS_ATTACKS.query({ any: mechanics.length ? [...mechanics] : ['generic'] });
  const generic = BOSS_ATTACKS.query({ all: ['generic'] });
  const pool = r.shuffle([...themed]);
  const pick = (n: number, from: BossAttackDef[]) => from.slice(0, n).map((a) => a.id);
  const first = pick(2, pool.length >= 2 ? pool : [...pool, ...generic]);
  const second = [...new Set([...first, ...pick(1, r.shuffle(pool.slice(2).concat(generic)))])];
  const third = [...new Set([...second, ...pick(1, r.shuffle(generic))])];
  const adds = BOSS_ATTACKS.query({ filter: (e) => (e as BossAttackDef).pattern === 'summon' && (e as BossAttackDef).tags.some((t) => mechanics.includes(t) || t === 'generic') });
  const cadence = Math.max(3.5, 6.5 - depth * 0.05);
  const phases: BossPhase[] = [
    { from: 1, name: 'Awakened', attacks: first, cadence },
    { from: 0.66, name: 'Wrath', attacks: second, cadence: cadence * 0.85, onEnter: adds.length ? [r.pick(adds).id] : [], mods: [inc('attack.speed', 0.1)] },
    { from: 0.33, name: 'Desperation', attacks: third, cadence: cadence * 0.7, onEnter: [first[0]!], mods: [more('damage', 0.2), inc('move.speed', 0.15)] },
  ];
  return {
    id: `rift-boss-${depth}`,
    name: bossName(rng.fork('name'), tags),
    level: 0,
    mechanics: [...mechanics],
    tags: ['boss', ...mechanics],
    weight: 0,
    genome,
    phases,
    signature: first[0]!,
    enrage: { after: Math.max(90, 180 - depth), mods: [more('damage', 0.5), inc('attack.speed', 0.3)] },
    arena: { radius: 12, hazards: mechanics.map((m) => `${m}`) },
    flavour: `A rift-born tyrant of ${mechanics.join(' and ')}.`,
  };
}

export { BOSS_ATTACKS, MECHANIC_THEMES, attackSkill, type BossAttackDef, type BossPattern } from './attacks';
export { bossName } from './names';
export { BossBrain } from './brain';
export type { BossDef, BossPhase } from './types';
