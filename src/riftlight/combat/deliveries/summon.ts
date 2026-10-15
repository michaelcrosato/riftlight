import { Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import type { DamageSpec } from '../damage';
import { minionMods, minionPosition } from '../minions';
import { areaCenter } from './slam';
import { saveSkill } from '../../skills/saved';
import { EffectBase, type CastContext, type CombatEffect, type EffectState, vec } from './types';

/** How many casts' worth of minions one owner keeps. */
export const SUMMON_BATCHES = 2;

/** A summon as data: its minions still in the world (by id), each with when it expires (Infinity: never). */
interface SummonState extends EffectState {
  readonly minions: readonly { id: number; expires: number }[];
}

class Summon extends EffectBase {
  readonly kind = 'summon';
  readonly minions: { actor: Actor; expires: number }[] = [];

  constructor(c: CastContext, from?: SummonState) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'summon') throw new Error('summon delivery on a non-summon skill');
    const combat = c.combat;
    if (from) {
      for (const m of from.minions) {
        const actor = combat.find(m.id);
        if (!actor) throw new Error(`Summon: minion ${m.id} is not there to restore`);
        this.minions.push({ actor, expires: m.expires });
      }
      return;
    }
    // at most two batches of this skill's minions per owner: the oldest make way
    const mine = combat.actors.actors.filter((a) => a.owner === c.caster && a.alive && a.tags.includes(c.skill.id));
    const excess = mine.length + d.count - d.count * SUMMON_BATCHES;
    for (let i = 0; i < Math.min(excess, mine.length); i++) mine[i]!.die(null);
    const center = areaCenter(c, 1.5);
    const attack: DamageSpec | null = c.skill.damage ? { ...c.skill.damage, tags: [...c.skill.damage.tags, 'minion'] } : null;
    const mods = minionMods(c.skill.mods);
    for (let i = 0; i < d.count; i++) {
      const at = minionPosition(center, i, d.count);
      const actor = combat.summonFactory({ genome: d.genome, owner: c.caster, at, skill: c.skill, mods, attack, index: i, combat });
      if (!actor) continue;
      actor.facing = c.caster.facing;
      combat.adopt(actor, { kind: 'minion', genome: d.genome, owner: c.caster.id, at: vec(at), skill: saveSkill(c.skill), index: i, time: combat.time });
      combat.actors.add(actor);
      this.minions.push({ actor, expires: d.duration > 0 ? combat.time + d.duration : Infinity });
      combat.burst(c.skill.def.look.burst ?? 'bones', new Vector3(at.x, at.y + 0.3, at.z));
    }
  }

  step(): boolean {
    const now = this.c.combat.time;
    for (const m of this.minions) if (m.actor.alive && now >= m.expires) m.actor.die(null);
    return this.minions.some((m) => m.actor.alive);
  }

  save(): SummonState {
    // the ones gone from the world are dead and stay so: nothing reads them again
    const kept = new Set(this.c.combat.known(this.minions.map((m) => m.actor)));
    return { ...this.saved(), minions: this.minions.filter((m) => kept.has(m.actor.id)).map((m) => ({ id: m.actor.id, expires: m.expires })) };
  }
}

/** Raise minions through `combat.summonFactory` (placeholders by default); they expire after `duration`. */
export const summon = (c: CastContext): CombatEffect => new Summon(c);
export const restoreSummon = (c: CastContext, s: EffectState): CombatEffect => new Summon(c, s as SummonState);
