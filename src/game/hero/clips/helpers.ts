import { placeFeet, type ClipDef, type Ease, type FeetGoals, type FeetKey, type FootGoal, type Key, type Pose } from '../../../engine/animation';
import { HERO_RIG as RIG } from '../rig';

/**
 * Helpers for writing hero clips: friendly limb and root poses, foot IK keys, somersaults.
 * Conventions (see rig.ts for the full cheat-sheet): frames at 30 fps, degrees, the
 * character faces +Z, R/L are its own sides. `arm()` / `leg()` take friendly values:
 * swing (−90 = forward), out (+ = away from the body), bend (+ = elbow/knee bent).
 *
 * Feet: `track()` keys take foot goals (IK). Where two neighbouring keys both have goals
 * the legs are solved every frame, so feet stay on the floor through the transition.
 * `null` = legs as keyed (airborne, lying down).
 */

export type Side = 'R' | 'L';
export type V3 = [number, number, number];

/** Arm: swing (−90 ahead, −180 overhead, + back), out (+ away from body), elbow bend, wrist curl, twist. */
export function arm(side: Side, swing: number, out = 0, elbow = 0, wrist = 0, twist = 0): Pose {
  const s = side === 'R' ? -1 : 1;
  return { [`Arm${side}`]: [swing, twist * s, out * s], [`Forearm${side}`]: [-elbow, 0, 0], [`Hand${side}`]: [-wrist, 0, 0] };
}
export const arms = (swing: number, out = 0, elbow = 0, wrist = 0): Pose => ({ ...arm('R', swing, out, elbow, wrist), ...arm('L', swing, out, elbow, wrist) });

/** Leg: swing (−X forward), out (+ away from body), knee bend, toes (+ pointed down). */
export function leg(side: Side, swing: number, out = 0, knee = 0, toes = 0): Pose {
  const s = side === 'R' ? -1 : 1;
  return { [`Leg${side}`]: [swing, 0, out * s], [`Shin${side}`]: [knee, 0, 0], [`Foot${side}`]: [toes, 0, 0] };
}

/** Root pose: rotation (deg), offset from standing (m), squash (uniform or xyz). */
export const pelvis = (r: V3 = [0, 0, 0], p: V3 = [0, 0, 0], s: number | V3 = 1): Pose => ({ Pelvis: { r, p, s } });

/** Squash (+) or stretch (−), volume-ish preserving. */
export const squash = (k: number): V3 => [1 + k * 0.5, 1 - k, 1 + k * 0.5];

/** Pin feet on a single pose (IK). */
export const F = (body: Pose, feet: FeetGoals): Pose => placeFeet(body, RIG, feet as Partial<Record<Side, FootGoal>>);

export type TrackKey = readonly [frame: number, body: Pose, feet: FeetGoals | null, ease?: Ease];
/** Keys with foot goals: poses are solved at the keys and the feet track in between. */
export function track(keys: readonly TrackKey[]): Pick<ClipDef, 'keys' | 'feet'> {
  return {
    keys: keys.map(([f, body, feet, ease]): Key => [f, feet ? F(body, feet) : body, ease]),
    feet: keys.map(([f, , feet, ease]): FeetKey => [f, feet ?? {}, ease]),
  };
}

/** Both feet flat at these forward positions. */
export const flat = (r: number, l: number): FeetGoals => ({ R: { z: r }, L: { z: l } });

/**
 * Root for a body spinning `angle` degrees about X (flip) or Z (cartwheel) around its
 * middle (`pivot`, relative to the hips) instead of the hips, lifted by `lift`.
 */
export function spinRoot(axis: 'x' | 'z', angle: number, pivot: V3 = [0, 0.2, 0.25], lift = 0.15): Pose {
  const a = (angle * Math.PI) / 180;
  const [, cy, cz] = pivot;
  if (axis === 'x') {
    const y = cy * Math.cos(a) - cz * Math.sin(a);
    const z = cy * Math.sin(a) + cz * Math.cos(a);
    return pelvis([angle, 0, 0], [0, lift + cy - y, cz - z]);
  }
  return pelvis([0, 0, angle], [cy * Math.sin(a), lift + cy - cy * Math.cos(a), 0]);
}

/** Keys (≤ 30° apart, eased overall) for a somersault from `from` to `to` degrees. */
export function somersault(axis: 'x' | 'z', from: number, to: number, f0: number, f1: number, body: Pose, pivot?: V3, shape: 'linear' | 'inOut' | 'out' = 'linear'): TrackKey[] {
  const n = Math.max(2, Math.ceil(Math.abs(to - from) / 30));
  const ease = (u: number) => (shape === 'inOut' ? u * u * (3 - 2 * u) : shape === 'out' ? 1 - (1 - u) * (1 - u) : u);
  return Array.from({ length: n + 1 }, (_, i): TrackKey => {
    const u = i / n;
    return [f0 + (f1 - f0) * u, { ...body, ...spinRoot(axis, from + (to - from) * ease(u), pivot) }, null, 'linear'];
  });
}
