/**
 * Animation authoring format — designed to be written and edited by AI agents (and
 * humans) as plain data. See docs/ANIMATION.md for the workflow.
 *
 * - Time is in FRAMES at 30 fps (Mario 64's rate). `frames: 24` = 0.8 s.
 * - Rotations are Euler XYZ in DEGREES, relative to the joint's rest orientation.
 *   Values interpolate per axis, so a full flip is simply `[360, 0, 0]`.
 * - A key's pose is a FULL pose: any joint not listed is at rest (0,0,0). Build poses by
 *   spreading shared poses: `{ ...CROUCH, Head: [10, 0, 0] }`.
 * - Root motion lives in the Pelvis: `p` is an OFFSET from its rest position (metres),
 *   `s` is scale (squash & stretch). Only Pelvis and Head may scale.
 */

export type Euler = [number, number, number];
export type Vec3 = [number, number, number];

export interface JointPose {
  /** Rotation, degrees XYZ. */
  r?: Euler;
  /** Position offset from rest, metres (Pelvis only in practice). */
  p?: Vec3;
  /** Scale: uniform number or per-axis. 1 = rest. */
  s?: number | Vec3;
}

/** Joint name → rotation (degrees) or full joint pose. Missing joints are at rest. */
export type Pose = Readonly<Record<string, Euler | JointPose>>;

export type Ease =
  | 'linear'
  /** accelerate */
  | 'in'
  /** decelerate */
  | 'out'
  /** smooth start and stop (default) */
  | 'inOut'
  /** hold this pose until the next key, then snap */
  | 'hold'
  /** pull back before moving (anticipation) */
  | 'inBack'
  /** overshoot and settle (follow-through) */
  | 'outBack';

/** `[frame, pose, easeToNextKey?]` */
export type Key = readonly [number, Pose, Ease?];

/** Additive sine wave on one channel — breathing, bobbing, idle sway. */
export interface Layer {
  joint: string;
  /** rx/ry/rz in degrees, px/py/pz in metres, s = uniform scale delta. */
  channel: 'rx' | 'ry' | 'rz' | 'px' | 'py' | 'pz' | 's';
  amplitude: number;
  /** Frames per cycle. For looping clips it must divide `frames`. */
  period: number;
  /** 0..1 fraction of a cycle. */
  phase?: number;
}

/** Where the feet should be (foot IK goals; see ik.ts). A missing side is left as keyed. */
export interface FeetGoals {
  R?: FootGoalDef;
  L?: FootGoalDef;
}

/** Same shape as ik.ts `FootGoal` (kept here so types.ts has no imports). */
export interface FootGoalDef {
  z: number;
  x?: number;
  y?: number;
  pitch?: number;
  pivot?: 'heel' | 'ball' | 'ankle';
  follow?: number;
  relax?: number;
}

/** `[frame, goals, easeToNextKey?]` */
export type FeetKey = readonly [number, FeetGoals, Ease?];

export interface ClipDef {
  name: string;
  /** Length in frames at 30 fps. */
  frames: number;
  loop?: boolean;
  keys: readonly Key[];
  layers?: readonly Layer[];
  /**
   * Feet track: foot goals interpolated between its own keys and solved with IK every
   * frame, overriding the keyed leg rotations. Use it whenever feet touch the floor
   * through a transition (kneel → stand, sit → lie) so they roll instead of sinking.
   */
  feet?: readonly FeetKey[];
  /**
   * Ground speed (m/s) the clip is authored for at playback rate 1. Locomotion clips set
   * this; metrics then measure foot sliding against it and the runtime can scale playback.
   */
  speed?: number;
  /**
   * Gait cycles (gaitClip): the share of the cycle each foot is planted. The right heel
   * strikes at phase 0, the left at 0.5, so the right foot is mid-stance at `stance / 2`.
   */
  stance?: number;
  /** Grounded clip: soles should rest on y = 0 (metrics flag floating / penetration). */
  grounded?: boolean;
  /** Intentionally snappy (flips, punches, launches): skip the angular-speed warning. */
  fast?: boolean;
  notes?: string;
}

export interface JointLimit {
  x?: [number, number];
  y?: [number, number];
  z?: [number, number];
}

/** One leg's joints, hip → knee → ankle, bending about X (knee forward). */
export interface LegJoints {
  upper: string;
  lower: string;
  foot: string;
  /** Hip joint position in the root (pelvis) joint's space. */
  hip: Vec3;
}

/** Leg geometry for foot-placement IK (`placeFeet`, `gaitClip`). Lengths in metres. */
export interface LegRig {
  R: LegJoints;
  L: LegJoints;
  /** Root (pelvis) joint height above the ground at rest. */
  rootHeight: number;
  /** Hip → knee. */
  upper: number;
  /** Knee → ankle. */
  lower: number;
  /** Ankle height above the sole when the foot is flat. */
  ankle: number;
  /** Heel contact point, metres behind the ankle. */
  heel: number;
  /** Toe tip contact point, metres ahead of the ankle. */
  ball: number;
  /** Top of the shoe above the ankle (m), for swing clearance when the foot tips over. */
  top?: number;
}

/** Everything the tools need to know about a rig beyond its hierarchy. */
export interface RigSpec {
  /** Joint names in hierarchy order (root first). */
  joints: readonly string[];
  root: string;
  /** Left/right counterparts for mirroring. */
  mirror: Readonly<Record<string, string>>;
  /** Mesh names that touch the ground (soles). */
  soles: readonly string[];
  /** Points to trace in contact sheets (joint or mesh names). */
  trace: readonly string[];
  /** Human-plausible rotation ranges, degrees. */
  limits: Readonly<Record<string, JointLimit>>;
  /** Frame rate of the authoring format. */
  fps: number;
  /** Leg geometry, enabling foot IK and the gait generator. */
  legs?: LegRig;
  /**
   * Joints the runtime procedural layers turn (PoseLayers): the torso and head look where
   * the character is going; `cap` is an optional springy joint (not animated by clips).
   */
  spine?: { torso?: string; head?: string; cap?: string };
}
