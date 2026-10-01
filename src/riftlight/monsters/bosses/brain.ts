import { MonsterBrain, type BrainOptions } from '../brains/brain';
import { MONSTER_SKILLS } from '../brains/skills';
import type { BrainWorld } from '../brains/types';
import { attackSkill, BOSS_ATTACKS } from './attacks';
import type { BossDef, BossPhase } from './types';

/**
 * Runs a boss script on top of the normal brain: tracks the phase from life thresholds
 * (announcing each with a roar and its `onEnter` attacks), fires a signature attack from the
 * phase's rotation every `cadence` seconds (telegraph + clip + a 'hazard' event carrying the
 * pattern for the world to stage), and enrages after `enrage.after` seconds of combat.
 * Between signatures it fights like its archetype.
 */
export class BossBrain extends MonsterBrain {
  phase = 0;
  enraged = false;
  combatTime = 0;
  /** Signature attacks fired so far (inspectors, tests). */
  readonly log: { time: number; attack: string; phase: number }[] = [];
  private nextSignature = 2.5;
  private last = '';

  constructor(
    readonly boss: BossDef,
    o: Omit<BrainOptions, 'archetype'> & { archetype?: string },
  ) {
    super({ ...o, archetype: o.archetype ?? boss.genome.archetype, elite: o.elite ?? boss.genome.elite });
  }

  get currentPhase(): BossPhase {
    return this.boss.phases[this.phase]!;
  }

  override update(dt: number, world: BrainWorld): void {
    if (this.state === 'combat' && this.body.actor.alive) {
      this.combatTime += dt;
      const life = this.lifeFraction();
      let p = this.phase;
      while (p + 1 < this.boss.phases.length && life <= this.boss.phases[p + 1]!.from) p++;
      if (p !== this.phase) this.enterPhase(p, world);
      if (!this.enraged && this.combatTime >= this.boss.enrage.after) {
        this.enraged = true;
        this.body.setCondition?.('enraged', true);
        this.body.emit?.({ type: 'roar', at: this.body.actor.position.clone() });
      }
      this.nextSignature -= dt * (this.enraged ? 1.5 : 1);
      if (this.nextSignature <= 0 && !this.body.busy() && this.target) {
        const list = this.currentPhase.attacks.filter((a) => a !== this.last || this.currentPhase.attacks.length === 1);
        const id = world.rng.pick(list);
        if (this.fire(id, world)) this.nextSignature = this.currentPhase.cadence;
        else this.nextSignature = 0.5;
      }
    }
    super.update(dt, world);
  }

  private enterPhase(p: number, world: BrainWorld): void {
    this.phase = p;
    this.body.emit?.({ type: 'phase', phase: p });
    this.body.emit?.({ type: 'roar', at: this.body.actor.position.clone() });
    for (const id of this.currentPhase.onEnter ?? []) this.fire(id, world, true);
    this.nextSignature = Math.min(this.nextSignature, 2);
  }

  /** Telegraph, play and stage one boss attack. */
  fire(id: string, _world: BrainWorld, free = false): boolean {
    const a = BOSS_ATTACKS.get(id);
    const t = this.target;
    const skill = attackSkill(a);
    if (t) this.body.face(t.position);
    const cast = MONSTER_SKILLS.has(skill) ? MONSTER_SKILLS.get(skill).castTime : 1;
    if (a.telegraph && this.body.telegraph) {
      const from = this.body.actor.position.clone();
      const to = a.telegraph.at === 'target' && t ? t.position.clone() : t ? t.position.clone() : from;
      this.body.telegraph({ ...a.telegraph, size: a.telegraph.size * Math.sqrt(this.scale) * 0.6 }, from, a.telegraph.shape === 'circle' && a.telegraph.at === 'self' ? from : to, cast);
    }
    const started = this.body.useSkill(skill, t);
    if (!started && !free) return false;
    this.body.setGlow?.(1);
    this.body.emit?.({ type: 'hazard', id: a.pattern, at: (t ?? this.body.actor).position.clone(), data: { attack: a.id, delay: cast, ...a.params } });
    this.last = id;
    this.log.push({ time: this.combatTime, attack: id, phase: this.phase });
    return true;
  }
}
