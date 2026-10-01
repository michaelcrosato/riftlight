import type { MonsterClipDef } from '../types';
import { ACTIONS, deathClip, hitClip, idleClip, spawnClip } from './actions';
import type { BakeContext } from './bake';
import { locomotionClip } from './locomotion';

/**
 * Every clip a monster needs, generated from its skeleton: Idle, Walk, Run, Hit, Death,
 * Spawn, plus the attack clips its skills use (`anims`: Bite, Claw, Slam, ChargeWindup,
 * Charge, Spit, Cast, Summon, Leap, TailWhip, Explode).
 */
export function generateClips(ctx: BakeContext, anims: readonly string[], opts: { weapon: boolean }): MonsterClipDef[] {
  const sk = ctx.skeleton;
  const out: MonsterClipDef[] = [
    idleClip(ctx),
    locomotionClip(ctx, sk.gaits.walk, { name: 'Walk', run: false }),
    locomotionClip(ctx, sk.gaits.run, { name: 'Run', run: true }),
    hitClip(ctx),
    deathClip(ctx),
    spawnClip(ctx),
  ];
  for (const a of new Set(anims)) {
    if (a === 'Charge') out.push(locomotionClip(ctx, sk.gaits.run, { name: 'Charge', run: true, charge: true }));
    else if (ACTIONS[a]) out.push(ACTIONS[a](ctx, opts));
  }
  return out;
}

export const ATTACK_ANIMS = [...Object.keys(ACTIONS), 'Charge'];
export { ACTIONS, deathClip, hitClip, idleClip, spawnClip } from './actions';
export { bake, planted, poseAt, type BakeContext, type FeetFn } from './bake';
export { Kinematics, solveLeg, soleOf, type PoseMap } from './ik';
export { locomotionClip } from './locomotion';
export { P, Poser, squash } from './poser';
