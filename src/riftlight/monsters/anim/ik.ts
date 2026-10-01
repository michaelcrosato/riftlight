import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { REST_JOINT, twoBoneX, type ResolvedJoint } from '../../../engine/animation';
import type { LegDef, Skeleton } from '../types';

/**
 * Kinematics for generated rigs: forward kinematics from a resolved pose (same maths as
 * `compileClip`: position = rest + p, rotation = rest yaw · Euler XYZ, scale = s) and an
 * N-leg foot IK built on the engine's planar `twoBoneX`.
 *
 * A leg is Hip (yaw + roll) → Thigh → Shin → Foot (pitch). The hip may hang from any joint:
 * the solver reads that joint's animated world transform, so legs on a swaying centipede
 * segment or a breathing chest still plant exactly. Splayed legs (spiders) yaw their plane
 * towards the foot; upright legs roll their plane sideways instead. Either way the foot is
 * levelled to the world floor.
 */
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export type PoseMap = Record<string, ResolvedJoint>;

/** What the leg solver needs: joint world matrices (model space) and rest rotations. */
export interface LegSolverHost {
  world(name: string): Matrix4;
  restRotation(name: string): Quaternion;
  invalidate(): void;
}

export class Kinematics implements LegSolverHost {
  readonly names: string[];
  private readonly index = new Map<string, number>();
  private readonly parent: number[];
  private readonly restPos: Vector3[];
  private readonly restQuat: Quaternion[];
  private readonly mats: Matrix4[];
  private readonly valid: Uint8Array;
  private pose: PoseMap = {};

  constructor(readonly skeleton: Skeleton) {
    this.names = skeleton.joints.map((j) => j.name);
    this.names.forEach((n, i) => this.index.set(n, i));
    this.parent = skeleton.joints.map((j) => (j.parent ? this.index.get(j.parent)! : -1));
    this.restPos = skeleton.joints.map((j) => new Vector3(...j.pos));
    this.restQuat = skeleton.joints.map((j) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (j.yaw ?? 0) * RAD));
    this.mats = skeleton.joints.map(() => new Matrix4());
    this.valid = new Uint8Array(this.names.length);
  }

  /** Use `pose` for the following `world()` calls. */
  begin(pose: PoseMap): this {
    this.pose = pose;
    this.valid.fill(0);
    return this;
  }

  /** Forget cached matrices (after editing the pose). */
  invalidate(): void {
    this.valid.fill(0);
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** World matrix of a joint for the current pose (model space, monster at the origin). */
  world(name: string): Matrix4 {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`no joint ${name}`);
    return this.worldAt(i);
  }

  private worldAt(i: number): Matrix4 {
    if (this.valid[i]) return this.mats[i]!;
    const j = this.pose[this.names[i]!] ?? REST_JOINT;
    _e.set(j.r[0] * RAD, j.r[1] * RAD, j.r[2] * RAD, 'XYZ');
    _q.setFromEuler(_e).premultiply(this.restQuat[i]!);
    _v.copy(this.restPos[i]!).add(_p.set(j.p[0], j.p[1], j.p[2]));
    const m = this.mats[i]!.compose(_v, _q, _s.set(j.s[0], j.s[1], j.s[2]));
    const p = this.parent[i]!;
    if (p >= 0) m.premultiply(this.worldAt(p));
    this.valid[i] = 1;
    return m;
  }

  /** Rest quaternion (yaw) of a joint. */
  restRotation(name: string): Quaternion {
    return this.restQuat[this.index.get(name)!]!;
  }

  /**
   * Lowest world y of joint-space shapes under the current pose: a Box3 (its 8 corners) or a
   * hull (xyz points, see `hullPoints`), transformed by each joint's world matrix. Hulls
   * follow rounded, tilted limbs closely, where a box's corners would dip far below them.
   */
  lowest(bounds: ReadonlyMap<string, Box3 | Float32Array>): number {
    let min = Infinity;
    for (const [name, shape] of bounds) {
      const e = this.world(name).elements;
      if (shape instanceof Float32Array) {
        for (let i = 0; i < shape.length; i += 3) {
          const wy = e[1]! * shape[i]! + e[5]! * shape[i + 1]! + e[9]! * shape[i + 2]! + e[13]!;
          if (wy < min) min = wy;
        }
        continue;
      }
      for (let c = 0; c < 8; c++) {
        const x = c & 1 ? shape.max.x : shape.min.x;
        const y = c & 2 ? shape.max.y : shape.min.y;
        const z = c & 4 ? shape.max.z : shape.min.z;
        const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
        if (wy < min) min = wy;
      }
    }
    return min;
  }
}

/** Unit directions spread over the sphere (Fibonacci), for hulls. */
const HULL_DIRS: readonly [number, number, number][] = Array.from({ length: 64 }, (_, i) => {
  const y = 1 - ((i + 0.5) / 64) * 2;
  const r = Math.sqrt(1 - y * y);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});

/**
 * The points of `xyz` (a flat position array) that are extreme along 64 directions: a small
 * hull whose lowest point under any rotation is within a few percent of the shape's.
 */
export function hullPoints(xyz: ArrayLike<number>): Float32Array {
  const pick = new Set<number>();
  for (const [dx, dy, dz] of HULL_DIRS) {
    let best = -Infinity;
    let at = 0;
    for (let i = 0; i < xyz.length; i += 3) {
      const d = xyz[i]! * dx + xyz[i + 1]! * dy + xyz[i + 2]! * dz;
      if (d > best) [best, at] = [d, i];
    }
    pick.add(at);
  }
  const out = new Float32Array(pick.size * 3);
  let k = 0;
  for (const i of pick) {
    out[k++] = xyz[i]!;
    out[k++] = xyz[i + 1]!;
    out[k++] = xyz[i + 2]!;
  }
  return out;
}

const _e = new Euler();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _p = new Vector3();
const _s = new Vector3();
const _h = new Matrix4();
const _hi = new Matrix4();
const _t = new Vector3();
const _up = new Vector3();
const _pos = new Vector3();
const _scl = new Vector3();
const Y = new Vector3(0, 1, 0);

/** cos(180° − 150°): the knee folds at most 150° (engine twoBoneX default). */
const COS_FOLD = Math.cos(Math.PI / 6);

/** Most a splayed leg's plane may yaw away from its rest direction (deg). */
const MAX_YAW = 65;

/**
 * Solve one leg so its sole's bottom lands on `target` (model space; y = floor height).
 * Writes the hip, thigh, shin and foot rotations into `pose` and invalidates `kin`.
 */
export function solveLeg(kin: LegSolverHost, leg: LegDef, target: Vector3, pose: PoseMap): void {
  const parent = kin.world(leg.parent);
  // Hip frame: parent · T(hipPos) · rest yaw (splay). Its own animated yaw/roll is what we solve.
  _h.compose(_v.set(leg.hipPos[0], leg.hipPos[1], leg.hipPos[2]), kin.restRotation(leg.hip), _s.set(1, 1, 1)).premultiply(parent);
  const sy = Math.hypot(_h.elements[4]!, _h.elements[5]!, _h.elements[6]!);
  _t.copy(target);
  _t.y += leg.ankle * sy;
  _t.applyMatrix4(_hi.copy(_h).invert());
  let yaw = 0;
  let roll = 0;
  let ty: number;
  let tz: number;
  if (leg.splay) {
    yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, Math.atan2(_t.x, _t.z) * DEG));
    const c = Math.cos(yaw * RAD);
    const s = Math.sin(yaw * RAD);
    tz = _t.z * c + _t.x * s;
    // Yaw clamped (or a tilted parent): roll the plane through the target so the foot
    // lands at the target's height instead of dropping the out-of-plane offset.
    const lateral = _t.x * c - _t.z * s;
    if (_t.y < 0 && Math.abs(lateral) > 1e-4) {
      roll = Math.atan2(lateral, -_t.y) * DEG;
      ty = -Math.hypot(lateral, _t.y);
    } else ty = _t.y;
  } else {
    roll = Math.atan2(_t.x, -_t.y) * DEG;
    ty = -Math.hypot(_t.x, _t.y);
    tz = _t.z;
  }
  // Too close for the knee's fold limit: keep the target's height and slide it outwards in
  // the leg plane (extending along the line would push the foot through the floor).
  const minD = Math.sqrt(leg.upperLen ** 2 + leg.lowerLen ** 2 - 2 * leg.upperLen * leg.lowerLen * COS_FOLD) + 1e-4;
  // Planted feet keep their height and slide outwards; a lifted (tucked) target is pushed out
  // radially instead, which is continuous (sliding by the sign of z flips the knee in a frame
  // as a collapsing body's foot passes under the hip).
  const d = Math.hypot(ty, tz);
  if (d < minD && Math.abs(ty) < minD) {
    if (target.y > 0.02) {
      const k = minD / Math.max(d, 1e-6);
      ty *= k;
      tz *= k;
    } else tz = (tz < 0 ? -1 : 1) * Math.sqrt(minD * minD - ty * ty);
  }
  const [a, b] = twoBoneX(ty, tz, leg.upperLen, leg.lowerLen, leg.bend);
  // Level the foot: world up expressed in the leg plane's frame.
  _h.decompose(_pos, _q, _scl);
  _e.set(0, yaw * RAD, roll * RAD, 'XYZ');
  _q.multiply(_q2.setFromEuler(_e));
  _up.copy(Y).applyQuaternion(_q.invert());
  const tau = Math.atan2(_up.z, _up.y) * DEG;
  const foot = tau - a - b;
  set(pose, leg.hip, [0, yaw, roll]);
  set(pose, leg.upper, [a, 0, 0]);
  set(pose, leg.lower, [b, 0, 0]);
  set(pose, leg.foot, [foot, 0, 0]);
  kin.invalidate();
}

function set(pose: PoseMap, name: string, r: [number, number, number]): void {
  const cur = pose[name] ?? REST_JOINT;
  pose[name] = { r, p: cur.p, s: cur.s };
}

/** Where a leg's sole is under the current pose (model space), from the foot joint. */
export function soleOf(kin: LegSolverHost, leg: LegDef, out = new Vector3()): Vector3 {
  const m = kin.world(leg.foot);
  out.set(0, -leg.ankle, 0).applyMatrix4(m);
  return out;
}

