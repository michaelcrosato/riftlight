import { Euler, type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import type { JointLimit, RigSpec } from './types';

/**
 * Procedural layers on top of the clips: small, physically motivated offsets that clips
 * can't know about because they depend on how the character is moving right now. Apply
 * them every render frame after the mixer (and RotationBlend), before foot placement, which
 * then puts the feet back on the ground.
 *
 * - **lean**: the whole body tips about the feet. `roll` (degrees, + = to its right) leans
 *   into turns; `pitch` (+ = forward) leans into acceleration and back when braking.
 * - **look**: the head (and a little of the torso) turns toward where the character is
 *   going, or toward something worth looking at. `yaw` in degrees, + = to its left.
 * - **impact**: 0..1, a landing squash: hips drop, body squashes and tips forward.
 * - **cap**: an optional springy joint (a hat): it lags behind the head's motion and settles.
 *
 * Every joint stays inside `rig.limits`.
 */
export interface PoseLayerInput {
  lean: { roll: number; pitch: number };
  look: number;
  impact: number;
}

export interface PoseLayerTuning {
  /** Share of a look that the torso takes (the head takes the rest). */
  torsoLook: number;
  /** Landing impact at 1: pelvis drop (m), squash, torso pitch (deg). */
  impactDrop: number;
  impactSquash: number;
  impactTorso: number;
  /** Springy cap: stiffness (1/s²), damping (1/s), degrees per m/s² of head acceleration, max angle (deg). */
  capStiffness: number;
  capDamping: number;
  capGain: number;
  capMax: number;
}

export const POSE_LAYER_DEFAULTS: PoseLayerTuning = {
  torsoLook: 0.3,
  impactDrop: 0.12,
  impactSquash: 0.1,
  impactTorso: 14,
  capStiffness: 220,
  capDamping: 14,
  capGain: 0.3,
  capMax: 20,
};

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export class PoseLayers {
  readonly tuning: PoseLayerTuning;
  private readonly pelvis: Object3D;
  private readonly torso: Object3D | null;
  private readonly head: Object3D | null;
  private readonly cap: Object3D | null;
  private readonly rest = new Map<Object3D, Quaternion>();
  private readonly limits: RigSpec['limits'];
  // springy cap: angle (deg) and velocity about X (pitch) and Z (roll), and the head's last world state
  private readonly capAngle = [0, 0];
  private readonly capVel = [0, 0];
  private readonly lastHead = new Vector3();
  private readonly lastHeadVel = new Vector3();
  private capStarted = false;

  constructor(model: Object3D, rig: RigSpec, tuning: Partial<PoseLayerTuning> = {}) {
    this.tuning = { ...POSE_LAYER_DEFAULTS, ...tuning };
    const get = (n: string | undefined) => (n ? model.getObjectByName(n) ?? null : null);
    this.pelvis = get(rig.root)!;
    this.torso = get(rig.spine?.torso);
    this.head = get(rig.spine?.head);
    this.cap = get(rig.spine?.cap);
    this.limits = rig.limits;
    for (const o of [this.torso, this.head, this.cap]) if (o) this.rest.set(o, o.quaternion.clone());
  }

  /** Rest rotations (the clips' reference), if the model was posed when this was built. */
  setRest(rest: ReadonlyMap<string, Quaternion>): void {
    for (const o of this.rest.keys()) {
      const q = rest.get(o.name);
      if (q) this.rest.get(o)!.copy(q);
    }
  }

  reset(): void {
    this.capAngle[0] = this.capAngle[1] = this.capVel[0] = this.capVel[1] = 0;
    this.capStarted = false;
  }

  apply(dt: number, input: PoseLayerInput): void {
    const T = this.tuning;
    const p = this.pelvis;
    // landing squash: hips down, squashed, body forward
    const k = Math.max(0, Math.min(1, input.impact));
    if (k > 0) {
      p.position.y -= T.impactDrop * k;
      const s = T.impactSquash * k;
      p.scale.x *= 1 + s * 0.5;
      p.scale.y *= 1 - s;
      p.scale.z *= 1 + s * 0.5;
      if (this.torso) this.addEuler(this.torso, T.impactTorso * k, 0, 0);
    }
    // lean about the feet (the model's origin): rotate the pelvis' position and rotation
    const { roll, pitch } = input.lean;
    if (roll !== 0 || pitch !== 0) {
      LEAN.setFromEuler(E.set(pitch * RAD, 0, roll * RAD, 'XYZ'));
      p.position.applyQuaternion(LEAN);
      p.quaternion.premultiply(LEAN);
    }
    // look: the torso takes a share, the head the rest (both within their limits)
    if (input.look !== 0) {
      if (this.torso) this.addEuler(this.torso, 0, input.look * T.torsoLook, 0);
      if (this.head) this.addEuler(this.head, 0, input.look * (this.torso ? 1 - T.torsoLook : 1), 0);
    }
    this.spring(dt);
  }

  /** Springy cap: driven by the head's acceleration, in the head's frame. */
  private spring(dt: number): void {
    const cap = this.cap;
    const head = this.head;
    if (!cap || !head || dt <= 0) return;
    const T = this.tuning;
    head.updateWorldMatrix(true, false);
    const pos = V0.setFromMatrixPosition(head.matrixWorld);
    if (!this.capStarted) {
      this.capStarted = true;
      this.lastHead.copy(pos);
      this.lastHeadVel.set(0, 0, 0);
    }
    const vel = V1.subVectors(pos, this.lastHead).divideScalar(dt);
    const acc = V2.subVectors(vel, this.lastHeadVel).divideScalar(dt);
    this.lastHead.copy(pos);
    this.lastHeadVel.copy(vel);
    // a jump in position (teleport, first frames): don't kick the spring
    if (acc.lengthSq() > 4e4) acc.set(0, 0, 0);
    // acceleration in the head's frame: forward (z) pitches the cap back, sideways (x) rolls it
    HQ.setFromRotationMatrix(head.matrixWorld).invert();
    acc.applyQuaternion(HQ);
    // the cap's rest is where the spring pulls; the head's acceleration pushes it the other way
    const drive = [-acc.z * T.capGain, acc.x * T.capGain];
    for (let i = 0; i < 2; i++) {
      const a = this.capAngle[i]!;
      const v = this.capVel[i]! + (T.capStiffness * (drive[i]! - a) - T.capDamping * this.capVel[i]!) * dt;
      this.capVel[i] = v;
      this.capAngle[i] = Math.max(-T.capMax, Math.min(T.capMax, a + v * dt));
    }
    const rest = this.rest.get(cap)!;
    cap.quaternion.copy(rest).multiply(Q.setFromEuler(E.set(this.capAngle[0]! * RAD, 0, this.capAngle[1]! * RAD, 'XYZ')));
  }

  /** Add degrees to a joint's Euler XYZ (relative to rest), clamped to its limits. */
  private addEuler(o: Object3D, x: number, y: number, z: number): void {
    const rest = this.rest.get(o)!;
    Q.copy(rest).invert().multiply(o.quaternion);
    E.setFromQuaternion(Q, 'XYZ');
    const lim: JointLimit | undefined = this.limits[o.name];
    E.x = limit((E.x * DEG + x), lim?.x, E.x * DEG) * RAD;
    E.y = limit((E.y * DEG + y), lim?.y, E.y * DEG) * RAD;
    E.z = limit((E.z * DEG + z), lim?.z, E.z * DEG) * RAD;
    o.quaternion.copy(rest).multiply(Q.setFromEuler(E));
  }
}

/** Clamp `v` to `range`, but never move a joint further out than it already was (`was`). */
function limit(v: number, range: [number, number] | undefined, was: number): number {
  if (!range) return v;
  const lo = Math.min(range[0], was);
  const hi = Math.max(range[1], was);
  return Math.min(hi, Math.max(lo, v));
}

const LEAN = new Quaternion();
const Q = new Quaternion();
const HQ = new Quaternion();
const E = new Euler();
const V0 = new Vector3();
const V1 = new Vector3();
const V2 = new Vector3();
