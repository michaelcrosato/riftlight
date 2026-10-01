import type { ActorLike } from '../../core/types';
import type { MonsterBrain } from './brain';
import type { BrainWorld } from './types';

/**
 * A pack: a leader and followers that share aggro and spread around their target. When one
 * member notices the hero, everyone within `alertRadius` of it joins in; followers take
 * flanking slots (angles around the target relative to the leader's approach) so a pack
 * surrounds instead of queueing. When the leader dies the toughest follower takes over, and
 * members hear about deaths (frenzied elites react).
 */
export class Pack {
  readonly members: MonsterBrain[];
  leader: MonsterBrain;

  constructor(
    members: readonly MonsterBrain[],
    /** Spread of the flanking slots around the target (radians, total). */
    readonly spread = Math.PI * 1.1,
    /** Distance over which an alert spreads between members (m). */
    readonly alertRadius = 14,
  ) {
    if (!members.length) throw new Error('Pack: no members');
    this.members = [...members];
    this.leader = this.pickLeader();
    for (const m of this.members) m.pack = this;
    this.assignSlots();
  }

  /** Spread an alert from `from` to every member in range (chained: alerted members pass it on). */
  alert(target: ActorLike, from: MonsterBrain): void {
    const queue = [from];
    const seen = new Set(queue);
    while (queue.length) {
      const src = queue.shift()!;
      for (const m of this.members) {
        if (seen.has(m) || m.state === 'dead') continue;
        if (m.body.actor.position.distanceTo(src.body.actor.position) > this.alertRadius) continue;
        seen.add(m);
        queue.push(m);
        if (m.state !== 'combat') {
          m.target = target;
          m.state = 'combat';
        }
      }
    }
  }

  onDeath(dead: MonsterBrain, world: BrainWorld): void {
    const i = this.members.indexOf(dead);
    if (i >= 0) this.members.splice(i, 1);
    for (const m of this.members) m.onAllyDeath(dead, world);
    if (!this.members.length) return;
    if (dead === this.leader) this.leader = this.pickLeader();
    this.assignSlots();
  }

  /** Followers fan out on both sides of the leader's line to the target. */
  assignSlots(): void {
    const followers = this.members.filter((m) => m !== this.leader);
    this.leader.slot = 0;
    followers.forEach((m, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const rank = Math.floor(i / 2) + 1;
      const step = this.spread / Math.max(2, followers.length + 1);
      m.slot = side * rank * step;
    });
  }

  private pickLeader(): MonsterBrain {
    return this.members.reduce((a, b) => (b.scale * b.maxLife > a.scale * a.maxLife ? b : a));
  }
}
