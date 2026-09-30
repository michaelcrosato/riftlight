import { resolveJoint, type ResolvedJoint } from './joint';
import { applyEase } from './ease';
import type { Euler, FeetKey, JointPose, LegRig, Pose, RigSpec, Vec3 } from './types';

/**
 * Foot-placement IK: say where a foot should be, get the hip/knee/ankle rotations.
 *
 * Authors write the body (pelvis height, lean, arms...) and then pin the feet:
 *
 *   placeFeet({ Pelvis: { p: [0, -0.2, 0] }, Torso: [20, 0, 0] }, rig, {
 *     R: { z: 0.15 },                             // right foot flat, 15 cm ahead
 *     L: { z: -0.2, pitch: 30, pivot: 'ball' },   // left heel raised on its toes
 *   })
 *
 * Coordinates are the character's ground frame: y up from the floor, z forward. The solve
 * is planar (legs bend about X, knees forward); lateral offsets are ignored. It accounts
 * for the root's position, rotation and squash, so a squashed or leaning body still
 * keeps its feet exactly where they were asked to be.
 */
export interface FootGoal {
  /** Forward position of the ankle (m) when the foot is flat. */
  z: number;
  /**
   * Sideways position (m, + = the character's left). Default: under the hip at rest.
   * Only matters when the root is turned (e.g. a pivot on one foot); the solve itself
   * stays in the leg's plane.
   */
  x?: number;
  /** Height of the sole above the floor (m). 0 = standing on it. */
  y?: number;
  /** Sole pitch in degrees: + = toes down / heel raised, − = toes up. */
  pitch?: number;
  /** Point that stays at (z, y) while pitching: heel (heel strike), toe tip (tiptoe, toe-off) or ankle. */
  pivot?: 'heel' | 'ball' | 'ankle';
  /**
   * 0..1: let the foot hang from the shin instead of holding its world pitch (swinging
   * feet, dangling in the air). 1 = foot at `relax` degrees relative to the shin.
   */
  follow?: number;
  /** Foot angle relative to the shin when following (default 15 = toes slightly down). */
  relax?: number;
}

/** World pitch range a following (dangling) foot is kept within, degrees. */
const FOLLOW_PITCH: [number, number] = [-40, 150];

export type Side = 'R' | 'L';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Ankle position (y, z) for a foot goal. */
export function ankleFor(goal: FootGoal, legs: LegRig): { y: number; z: number } {
  const y0 = goal.y ?? 0;
  const psi = (goal.pitch ?? 0) * RAD;
  const pivot = goal.pivot ?? 'ankle';
  if (pivot === 'ankle' || psi === 0) return { y: y0 + legs.ankle, z: goal.z };
  // pivot point and the pivot → ankle vector (y, z) with the foot flat
  const [qy, qz, vy, vz] =
    pivot === 'heel' ? [y0, goal.z - legs.heel, legs.ankle, legs.heel] : [y0, goal.z + legs.ball, legs.ankle, -legs.ball];
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  return { y: qy + vy * c - vz * s, z: qz + vy * s + vz * c };
}

/**
 * Planar two-bone IK in the Y/Z plane. Returns [upper, lower] X rotations in degrees.
 * The middle joint never folds past `maxBend` degrees (targets closer than that are
 * reached as far as the joint allows).
 */
export function twoBoneX(ty: number, tz: number, upper: number, lower: number, bend: 1 | -1 = 1, maxBend = 150): [number, number] {
  const theta = Math.atan2(-tz, -ty); // 0 = straight down, + = backwards
  const minD = Math.sqrt(upper * upper + lower * lower - 2 * upper * lower * Math.cos(Math.PI - (maxBend * Math.PI) / 180));
  const d = Math.min(Math.max(Math.hypot(ty, tz), minD + 1e-6), upper + lower - 1e-6);
  const alpha = Math.acos(clamp((upper * upper + d * d - lower * lower) / (2 * upper * d)));
  const gamma = Math.acos(clamp((upper * upper + lower * lower - d * d) / (2 * upper * lower)));
  return [(theta - bend * alpha) * DEG, bend * (Math.PI - gamma) * DEG];
}

/** Rotations for one leg so its foot meets `goal`, given the root joint's pose. */
export function legIK(legs: LegRig, side: Side, root: JointPose | Euler | undefined, goal: FootGoal): { upper: number; lower: number; foot: number } {
  const r = resolveJoint(root);
  const leg = legs[side];
  const a = ankleFor(goal, legs);
  // ankle target relative to the root, in the root's local (unrotated, unscaled) space
  const rel: Vec3 = [(goal.x ?? leg.hip[0]) - r.p[0], a.y - (legs.rootHeight + r.p[1]), a.z - r.p[2]];
  const local = invRotateXYZ(rel, r.r);
  const ly = local[1] / r.s[1] - leg.hip[1];
  const lz = local[2] / r.s[2] - leg.hip[2];
  const [upper, lower] = twoBoneX(ly, lz, legs.upper, legs.lower, 1);
  const chain = r.r[0] + upper + lower; // shin's world pitch
  const hold = (goal.pitch ?? 0) - chain; // foot rotation that keeps the requested world pitch
  const follow = goal.follow ?? 0;
  let foot = hold + ((goal.relax ?? 15) - hold) * follow;
  if (follow > 0) foot = Math.min(Math.max(chain + foot, FOLLOW_PITCH[0]), FOLLOW_PITCH[1]) - chain;
  return { upper, lower, foot };
}

/**
 * Return `pose` with its legs solved so the feet land on the goals. Existing Y/Z
 * rotations on the leg joints (spread, twist) are kept; X is replaced.
 */
export function placeFeet(pose: Pose, rig: RigSpec, goals: Partial<Record<Side, FootGoal>>): Pose {
  const legs = rig.legs;
  if (!legs) throw new Error('placeFeet: rig has no `legs` spec');
  const out: Record<string, Euler | JointPose> = { ...pose };
  for (const side of ['R', 'L'] as const) {
    const goal = goals[side];
    if (!goal) continue;
    const s = legIK(legs, side, pose[rig.root], goal);
    const j = legs[side];
    out[j.upper] = withX(pose[j.upper], s.upper);
    out[j.lower] = withX(pose[j.lower], s.lower);
    out[j.foot] = withX(pose[j.foot], s.foot);
  }
  return out;
}

/** Solve the feet track at frame `f` into `out` (a resolved pose). */
export function applyFeet(track: readonly FeetKey[], f: number, out: Record<string, ResolvedJoint>, rig: RigSpec): void {
  const legs = rig.legs;
  if (!legs) return;
  let i = 0;
  while (i < track.length - 1 && track[i + 1]![0] <= f) i++;
  const k0 = track[i]!;
  const k1 = track[Math.min(i + 1, track.length - 1)]!;
  const span = k1[0] - k0[0];
  const t = applyEase(k0[2] ?? 'inOut', span > 0 ? Math.min(Math.max((f - k0[0]) / span, 0), 1) : 0);
  const root = out[rig.root];
  for (const side of ['R', 'L'] as const) {
    const a = k0[1][side];
    const b = k1[1][side];
    // Only solve spans with goals at both ends; elsewhere the keyed legs interpolate
    // (keys with goals are pre-solved, so the hand-off is continuous).
    const goal = a && b ? lerpGoal(a, b, t, legs) : f === k1[0] ? b : f === k0[0] ? a : undefined;
    if (!goal) continue;
    const s = legIK(legs, side, root, goal);
    const j = legs[side];
    for (const [name, x] of [[j.upper, s.upper], [j.lower, s.lower], [j.foot, s.foot]] as const) {
      const cur = out[name] ?? { r: [0, 0, 0], p: [0, 0, 0], s: [1, 1, 1] };
      out[name] = { r: [x, cur.r[1], cur.r[2]], p: cur.p, s: cur.s };
    }
  }
}

/** Interpolate two foot goals: same pivot → blend directly (the foot rolls); else blend ankles. */
export function lerpGoal(a: FootGoal, b: FootGoal, t: number, legs: LegRig): FootGoal {
  const mix = (x: number, y: number) => x + (y - x) * t;
  const pitch = mix(a.pitch ?? 0, b.pitch ?? 0);
  const follow = mix(a.follow ?? 0, b.follow ?? 0);
  const relax = mix(a.relax ?? 15, b.relax ?? 15);
  const x = a.x === undefined && b.x === undefined ? undefined : mix(a.x ?? b.x!, b.x ?? a.x!);
  if ((a.pivot ?? 'ankle') === (b.pivot ?? 'ankle')) {
    return { z: mix(a.z, b.z), y: mix(a.y ?? 0, b.y ?? 0), x, pitch, pivot: a.pivot, follow, relax };
  }
  const pa = ankleFor(a, legs);
  const pb = ankleFor(b, legs);
  return { z: mix(pa.z, pb.z), y: mix(pa.y, pb.y) - legs.ankle, x, pitch, pivot: 'ankle', follow, relax };
}

function withX(v: Euler | JointPose | undefined, x: number): JointPose {
  const j = resolveJoint(v);
  return { r: [round(x), j.r[1], j.r[2]], p: j.p, s: j.s };
}

/** v' = (Rx·Ry·Rz)ᵀ v for Euler XYZ degrees (world → local). */
function invRotateXYZ(v: Vec3, e: Euler): Vec3 {
  let [x, y, z] = v;
  // undo X
  let c = Math.cos(e[0] * RAD);
  let s = Math.sin(e[0] * RAD);
  [y, z] = [y * c + z * s, -y * s + z * c];
  // undo Y
  c = Math.cos(e[1] * RAD);
  s = Math.sin(e[1] * RAD);
  [x, z] = [x * c - z * s, x * s + z * c];
  // undo Z
  c = Math.cos(e[2] * RAD);
  s = Math.sin(e[2] * RAD);
  [x, y] = [x * c + y * s, -x * s + y * c];
  return [x, y, z];
}

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
