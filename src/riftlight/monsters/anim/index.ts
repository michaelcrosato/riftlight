import type { MonsterClipDef } from '../types';
import { ACTIONS, deathClip, hitClip, idleClip, spawnClip } from './actions';
import type { BakeContext } from './bake';
import { locomotionClip } from './locomotion';

/**
 * Every clip a monster needs, generated from its skeleton: Idle, Walk, Run, Hit, Death,
 * Spawn, plus the attack clips its skills use (`anims`: Bite, Claw, Slam, ChargeWindup,
 * Charge, Spit, Cast, Summon, Leap, TailWhip, Explode). Returned as named builders so a
 * caller can bake only what it plays (see build.ts: clips are generated on first use).
 */
export function clipBuilders(ctx: BakeContext, anims: readonly string[], opts: { weapon: boolean }): Map<string, () => MonsterClipDef> {
  const sk = ctx.skeleton;
  const out = new Map<string, () => MonsterClipDef>([
    ['Idle', () => idleClip(ctx)],
    ['Walk', () => locomotionClip(ctx, sk.gaits.walk, { name: 'Walk', run: false })],
    ['Run', () => locomotionClip(ctx, sk.gaits.run, { name: 'Run', run: true })],
    ['Hit', () => hitClip(ctx)],
    ['Death', () => deathClip(ctx)],
    ['Spawn', () => spawnClip(ctx)],
  ]);
  for (const a of anims) {
    if (a === 'Charge') out.set('Charge', () => locomotionClip(ctx, sk.gaits.run, { name: 'Charge', run: true, charge: true }));
    else if (ACTIONS[a]) out.set(a, () => ACTIONS[a]!(ctx, opts));
  }
  return out;
}

/** Every clip, baked now. */
export function generateClips(ctx: BakeContext, anims: readonly string[], opts: { weapon: boolean }): MonsterClipDef[] {
  return [...clipBuilders(ctx, anims, opts).values()].map((make) => make());
}

export const ATTACK_ANIMS = [...Object.keys(ACTIONS), 'Charge'];
export { ACTIONS, deathClip, hitClip, idleClip, plantedFeet, spawnClip, tuckFeet } from './actions';
export { bake, planted, poseAt, type BakeContext, type FeetFn } from './bake';
export { Kinematics, solveLeg, soleOf, type PoseMap } from './ik';
export { locomotionClip } from './locomotion';
export { P, Poser, squash } from './poser';
