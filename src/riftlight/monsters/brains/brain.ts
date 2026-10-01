import { Vector3 } from 'three/webgpu';
import type { ActorLike, HitResult } from '../../core/types';
import type { BrainParams } from '../types';
import { ARCHETYPES } from './archetypes';
import { ELITE_MODS, eliteBehaviour, type EliteBehaviour, type EliteContext, type EliteHost } from './elite';
import { MONSTER_SKILLS, type MonsterSkillDef } from './skills';
import type { ActionId, BrainLike, BrainWorld, Decision, MonsterBody } from './types';
import type { Pack } from './pack';

/**
 * A small utility AI over shared actions. Every `think` seconds it scores the actions —
 * approach, strafe, retreat, attack (one score per ready skill), flee, leash, wander, idle
 * — from the archetype's numbers and the situation, and runs the best one until the next
 * think (or until its attack animation ends). Archetypes are just different numbers:
 * a caster has a far range band and strafes, a skirmisher retreats after biting, a totem
 * is rooted. Packs add flanking slots and shared alerts; elite behaviours hook in.
 */
export interface BrainOptions {
  body: MonsterBody;
  archetype: string;
  /** Resolved skill ids (BuiltMonster.skills). */
  skills: readonly string[];
  elite?: readonly string[];
  /** Where it spawned; leashing returns here. */
  home?: Vector3;
  /** Monster scale: ranges and telegraphs grow with it. */
  scale?: number;
  /** Max life, for life fractions (defaults to the life at creation). */
  maxLife?: number;
  /** Override archetype brain numbers. */
  params?: Partial<BrainParams>;
}

export type BrainState = 'idle' | 'combat' | 'leash' | 'dead';

interface EliteSlot {
  readonly id: string;
  readonly behaviour: EliteBehaviour;
  readonly param: string;
  readonly state: Record<string, number>;
}

const _v = new Vector3();

export class MonsterBrain implements BrainLike, EliteHost {
  readonly body: MonsterBody;
  readonly archetype: string;
  readonly params: BrainParams;
  readonly skills: readonly MonsterSkillDef[];
  readonly home: Vector3;
  readonly scale: number;
  readonly maxLife: number;
  state: BrainState = 'idle';
  target: ActorLike | null = null;
  pack: Pack | null = null;
  /** Flanking angle (rad) around the target assigned by the pack. */
  slot = 0;
  action: ActionId = 'idle';
  skill: string | null = null;
  moving = false;
  /** Last decision's scores (inspectors and tests). */
  lastScores: Decision[] = [];
  private thinkIn = 0;
  private retreatUntil = -1;
  private strafeDir = 1;
  private wanderTo: Vector3 | null = null;
  private readonly elites: EliteSlot[] = [];
  private started = false;
  private time = 0;

  constructor(o: BrainOptions) {
    this.body = o.body;
    this.archetype = o.archetype;
    const arch = ARCHETYPES.has(o.archetype) ? ARCHETYPES.get(o.archetype) : ARCHETYPES.get('skirmisher');
    this.params = { ...arch.brain, ...o.params };
    this.skills = o.skills.filter((s) => MONSTER_SKILLS.has(s)).map((s) => MONSTER_SKILLS.get(s));
    this.home = (o.home ?? o.body.actor.position).clone();
    this.scale = o.scale ?? 1;
    this.maxLife = o.maxLife ?? Math.max(1, o.body.actor.life);
    for (const id of o.elite ?? []) {
      const b = eliteBehaviour(ELITE_MODS.has(id) ? ELITE_MODS.get(id).behaviour : undefined);
      if (b) this.elites.push({ id, behaviour: b[0], param: b[1], state: {} });
    }
  }

  lifeFraction(): number {
    return Math.max(0, Math.min(1, this.body.actor.life / this.maxLife));
  }

  /** Become aggressive towards `target` and tell the pack. */
  alert(target: ActorLike): void {
    if (this.state === 'dead') return;
    const was = this.state;
    this.target = target;
    this.state = 'combat';
    this.thinkIn = 0;
    if (was !== 'combat') this.pack?.alert(target, this);
  }

  update(dt: number, world: BrainWorld): void {
    this.time = world.time;
    const actor = this.body.actor;
    if (!actor.alive) {
      if (this.state !== 'dead') this.die(world);
      return;
    }
    if (!this.started) {
      this.started = true;
      for (const e of this.elites) e.behaviour.start?.(this.ctx(e, world));
    }
    for (const e of this.elites) e.behaviour.update?.(this.ctx(e, world), dt);
    if (this.state === 'idle') {
      const seen = world.enemies(actor, this.params.aggro * Math.sqrt(this.scale))[0];
      if (seen) this.alert(seen);
    }
    if (this.target && !this.target.alive) {
      this.target = null;
      this.state = 'leash';
    }
    if (this.body.busy()) return; // mid-attack: the animation owns the body
    this.thinkIn -= dt;
    if (this.thinkIn <= 0) {
      this.thinkIn = this.params.think * (0.8 + world.rng.next() * 0.4);
      const best = this.decide(world);
      this.action = best.action;
      this.skill = best.skill ?? null;
      if (best.action === 'attack' && best.skill) this.attack(best.skill);
    }
    this.act(world);
  }

  /** Score every action; the highest wins. */
  decide(world: BrainWorld): Decision {
    const p = this.params;
    const me = this.body.actor.position;
    const out: Decision[] = [];
    const add = (action: ActionId, score: number, skill?: string) => out.push(skill ? { action, score, skill } : { action, score });
    const fromHome = _v.copy(me).sub(this.home).length();
    if (this.state === 'leash' || (!p.rooted && p.leash > 0 && fromHome > p.leash)) {
      this.state = fromHome < 1 ? 'idle' : 'leash';
      if (this.state === 'leash') {
        add('leash', 1);
        return this.pick(out);
      }
      this.target = null;
    }
    const t = this.target;
    if (!t || this.state !== 'combat') {
      add('wander', p.rooted ? 0 : 0.3);
      add('idle', 0.25);
      return this.pick(out);
    }
    const d = me.distanceTo(t.position) - t.radius - this.body.actor.radius;
    const [near, far] = [p.range[0] * this.scale ** 0.5, p.range[1] * this.scale ** 0.5];
    const life = this.lifeFraction();
    for (const s of this.skills) {
      if (this.body.cooldown(s.id) > 0) continue;
      const reach = s.range * Math.sqrt(this.scale);
      const min = (s.minRange ?? 0) * Math.sqrt(this.scale);
      if (d > reach || d < min) continue;
      let score = { melee: 0.9, ranged: 0.8, area: 0.75, charge: 0.86, leap: 0.85, summon: 0.95, explode: 1.1, support: 0.6 }[s.role];
      if (s.role === 'area') score += 0.08 * Math.min(3, world.enemies(this.body.actor, (s.telegraph?.size ?? 3) * this.scale).length);
      if (s.role === 'support') score += 0.1 * Math.min(3, world.allies(this.body.actor, 6).length);
      if (s.role === 'summon') score -= 0.3 * Math.min(2, world.allies(this.body.actor, 8).length / 4);
      add('attack', score, s.id);
    }
    if (!p.rooted) {
      if (p.flee > 0 && life < p.flee) add('flee', 0.95);
      if (this.time < this.retreatUntil) add('retreat', 0.88);
      if (d > far) add('approach', 0.55 + 0.3 * Math.min(1, (d - far) / 5));
      else if (d < near) add('retreat', 0.7);
      else add('strafe', 0.35 + p.strafe * 0.4);
    }
    add('idle', 0.1);
    return this.pick(out);
  }

  private pick(out: Decision[]): Decision {
    out.sort((a, b) => b.score - a.score);
    this.lastScores = out;
    return out[0]!;
  }

  private attack(id: string): void {
    const t = this.target;
    if (!t) return;
    const s = MONSTER_SKILLS.get(id);
    this.body.face(t.position);
    if (s.telegraph && this.body.telegraph) {
      const from = this.body.actor.position.clone();
      const to = s.telegraph.at === 'target' ? t.position.clone() : from;
      this.body.telegraph({ ...s.telegraph, size: s.telegraph.size * Math.sqrt(this.scale) }, from, s.telegraph.shape === 'circle' ? to : t.position.clone(), s.castTime);
    }
    if (this.body.useSkill(id, t)) {
      this.body.setGlow?.(s.castTime > 0.75 ? 1 : 0.5);
      if (this.params.retreat > 0 && (s.role === 'melee' || s.role === 'leap')) this.retreatUntil = this.time + s.castTime + this.params.retreat;
    }
  }

  private act(world: BrainWorld): void {
    const p = this.params;
    const body = this.body;
    const me = body.actor.position;
    const t = this.target;
    this.moving = false;
    if (this.action !== 'attack') body.setGlow?.(0);
    if (p.rooted) {
      body.stop();
      if (t) body.face(t.position);
      return;
    }
    const go = (to: Vector3, speed = 1) => {
      body.moveTo(to, speed * p.speed);
      this.moving = true;
    };
    switch (this.action) {
      case 'approach': {
        if (!t) break;
        go(this.flankPoint(t, Math.max(0.2, p.range[1] * 0.85)));
        break;
      }
      case 'strafe': {
        if (!t) break;
        if (world.rng.chance(0.02)) this.strafeDir *= -1;
        const away = _v.copy(me).sub(t.position);
        const r = Math.max(1, away.length());
        const a = Math.atan2(away.x, away.z) + this.strafeDir * 0.5;
        go(new Vector3(t.position.x + Math.sin(a) * r, me.y, t.position.z + Math.cos(a) * r), 0.6);
        body.face(t.position);
        break;
      }
      case 'retreat':
      case 'flee': {
        if (!t) break;
        const away = _v.copy(me).sub(t.position).setY(0).normalize();
        go(me.clone().addScaledVector(away, 4), this.action === 'flee' ? 1.1 : 0.9);
        break;
      }
      case 'leash':
        go(this.home, 0.8);
        break;
      case 'wander': {
        if (!this.wanderTo || me.distanceTo(this.wanderTo) < 0.4 || world.rng.chance(0.01)) {
          const a = world.rng.range(0, Math.PI * 2);
          const r = world.rng.range(0.5, 3);
          this.wanderTo = new Vector3(this.home.x + Math.sin(a) * r, this.home.y, this.home.z + Math.cos(a) * r);
        }
        go(this.wanderTo, 0.35);
        break;
      }
      case 'attack':
      case 'idle':
        body.stop();
        if (t) body.face(t.position);
        break;
    }
  }

  /** Where to stand around the target: the pack's slot (flanking spread) at `radius`. */
  flankPoint(t: ActorLike, radius: number): Vector3 {
    const me = this.body.actor.position;
    const ref = this.pack && this.pack.leader !== this ? this.pack.leader.body.actor.position : me;
    const base = Math.atan2(ref.x - t.position.x, ref.z - t.position.z);
    const a = base + this.slot;
    return new Vector3(t.position.x + Math.sin(a) * radius, me.y, t.position.z + Math.cos(a) * radius);
  }

  onHitTaken(result: HitResult, from: ActorLike | null, world: BrainWorld): void {
    if (from && this.state !== 'combat') this.alert(from);
    for (const e of this.elites) e.behaviour.onHitTaken?.(this.ctx(e, world), result);
  }

  onHitDealt(result: HitResult, world: BrainWorld): void {
    for (const e of this.elites) e.behaviour.onHitDealt?.(this.ctx(e, world), result);
  }

  onAllyDeath(ally: BrainLike, world?: BrainWorld): void {
    if (!world) return;
    for (const e of this.elites) e.behaviour.onAllyDeath?.(this.ctx(e, world), ally);
  }

  private die(world: BrainWorld): void {
    this.state = 'dead';
    this.body.stop();
    this.body.setGlow?.(0);
    for (const e of this.elites) e.behaviour.onDeath?.(this.ctx(e, world));
    this.pack?.onDeath(this, world);
  }

  private ctx(e: EliteSlot, world: BrainWorld): EliteContext {
    return { host: this, world, state: e.state, param: e.param };
  }
}
