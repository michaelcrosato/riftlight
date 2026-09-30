import type { Euler, JointPose, Vec3 } from './types';

/** Normalised joint pose (all channels present). */
export interface ResolvedJoint {
  r: Euler;
  p: Vec3;
  s: Vec3;
}

export const REST_JOINT: ResolvedJoint = { r: [0, 0, 0], p: [0, 0, 0], s: [1, 1, 1] };

export function resolveJoint(v: Euler | JointPose | undefined): ResolvedJoint {
  if (!v) return REST_JOINT;
  if (Array.isArray(v)) return { r: v as Euler, p: [0, 0, 0], s: [1, 1, 1] };
  const jp = v as JointPose;
  const s = jp.s === undefined ? [1, 1, 1] : typeof jp.s === 'number' ? [jp.s, jp.s, jp.s] : jp.s;
  return { r: jp.r ?? [0, 0, 0], p: jp.p ?? [0, 0, 0], s: s as Vec3 };
}
