import { type AnimationAction, type Interpolant, type Object3D, PropertyBinding, Quaternion } from 'three/webgpu';

/**
 * Joint rotations of cross-fading clips, blended without flipping.
 *
 * three's mixer blends quaternions along the shortest arc. When two clips hold a joint more
 * than 180° apart (Fall's arms overhead at −150…−172°, Run's swinging back to +55°), the
 * shortest arc changes side as soon as the difference crosses 180°, and the blended joint
 * jumps to the other side in one frame (a 140–160° pop).
 *
 * Run this after `mixer.update()`. It re-blends the rotation tracks of the playing actions
 * with the same weights, but keeps every action's quaternion sign continuous for as long as
 * the action contributes, so the blend can never switch arcs mid-fade. A joint driven by a
 * single clip (no blend) is left exactly as three posed it. A clip that joins a blend
 * starts on the same side of the rest pose as the joint: blends travel the way the poses
 * were authored (an arm swings down through the front from overhead to behind, not up over
 * the shoulder), and a flip that ended at 360° blends back without spinning.
 */
export class RotationBlend {
  private readonly joints: Joint[] = [];
  private readonly actions: ActionState[] = [];
  private frame = 0;

  /**
   * @param rest each joint's rest (bind) rotation, by name: the reference for "the same side
   *   of the rest pose". Joints without an entry use the identity.
   */
  constructor(model: Object3D, actions: Iterable<AnimationAction>, rest?: ReadonlyMap<string, Quaternion>) {
    const index = new Map<string, number>();
    for (const action of actions) {
      const interps: (Interpolant | null)[] = [];
      for (const track of action.getClip().tracks) {
        const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
        if (propertyName !== 'quaternion' || !nodeName) continue;
        let j = index.get(nodeName);
        if (j === undefined) {
          const node = model.getObjectByName(nodeName);
          if (!node) continue;
          j = this.joints.length;
          index.set(nodeName, j);
          const r = rest?.get(nodeName) ?? new Quaternion();
          this.joints.push({ node, rest: [r.x, r.y, r.z, r.w] });
        }
        // createInterpolant (set by setInterpolation) is missing from three's typings
        interps[j] = (track as typeof track & { createInterpolant(): Interpolant }).createInterpolant();
      }
      this.actions.push({ action, interps, sign: [], prev: [], seen: [], weight: 0 });
    }
    for (const a of this.actions) {
      for (let j = 0; j < this.joints.length; j++) {
        a.interps[j] ??= null;
        a.sign[j] = 1;
        a.prev[j] = [0, 0, 0, 1];
        a.seen[j] = -1;
      }
    }
  }

  /** Re-blend joint rotations from the actions' current times and weights. */
  apply(): void {
    this.frame++;
    for (const a of this.actions) a.weight = a.action.isScheduled() ? a.action.getEffectiveWeight() : 0;
    for (let j = 0; j < this.joints.length; j++) {
      let n = 0;
      for (const a of this.actions) if (a.weight > 0 && a.interps[j]) n++;
      if (n === 0) continue;
      const out = ACC;
      let cum = 0;
      for (const a of this.actions) {
        const interp = a.interps[j];
        if (!(a.weight > 0) || !interp) continue;
        const q = interp.evaluate(a.action.time) as ArrayLike<number>;
        const prev = a.prev[j]!;
        if (n === 1 || a.seen[j] !== this.frame - 1) {
          // alone (its sign doesn't change the pose) or just joining: same side as rest
          a.sign[j] = dot(q, this.joints[j]!.rest) >= 0 ? 1 : -1;
        } else if (dot(q, prev) < 0) {
          a.sign[j] = -a.sign[j]!; // the track itself changed sign: stay continuous
        }
        prev[0] = q[0]!;
        prev[1] = q[1]!;
        prev[2] = q[2]!;
        prev[3] = q[3]!;
        a.seen[j] = this.frame;
        const s = a.sign[j]!;
        TMP[0] = q[0]! * s;
        TMP[1] = q[1]! * s;
        TMP[2] = q[2]! * s;
        TMP[3] = q[3]! * s;
        if (cum === 0) {
          out[0] = TMP[0];
          out[1] = TMP[1];
          out[2] = TMP[2];
          out[3] = TMP[3];
          cum = a.weight;
        } else {
          cum += a.weight;
          slerpUnflipped(out, TMP, a.weight / cum);
        }
      }
      if (n === 1 && cum >= 1) continue; // one clip at full weight: three's pose is exact
      if (cum < 1) {
        // like three: the missing weight goes to the rest pose (the short way)
        const r = this.joints[j]!.rest;
        const s = dot(out, r) >= 0 ? 1 : -1;
        TMP[0] = r[0] * s;
        TMP[1] = r[1] * s;
        TMP[2] = r[2] * s;
        TMP[3] = r[3] * s;
        slerpUnflipped(out, TMP, 1 - cum);
      }
      this.joints[j]!.node.quaternion.set(out[0], out[1], out[2], out[3]);
    }
  }
}

interface Joint {
  node: Object3D;
  rest: [number, number, number, number];
}

interface ActionState {
  action: AnimationAction;
  /** Rotation interpolant per joint (null: the clip doesn't drive that joint). */
  interps: (Interpolant | null)[];
  /** Sign applied to the action's quaternion, per joint. */
  sign: number[];
  /** Last raw quaternion, per joint. */
  prev: [number, number, number, number][];
  /** Frame the action last contributed to each joint. */
  seen: number[];
  weight: number;
}

const ACC: [number, number, number, number] = [0, 0, 0, 1];
const TMP: [number, number, number, number] = [0, 0, 0, 1];

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
}

/** `a ← slerp(a, b, t)` along the arc the signs give, never the other side's shorter one. */
function slerpUnflipped(a: [number, number, number, number], b: ArrayLike<number>, t: number): void {
  const cos = dot(a, b);
  let s = 1 - t;
  let u = t;
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  if (sin > 1e-4) {
    const theta = Math.atan2(sin, cos);
    s = Math.sin(s * theta) / sin;
    u = Math.sin(u * theta) / sin;
  }
  const x = a[0] * s + b[0]! * u;
  const y = a[1] * s + b[1]! * u;
  const z = a[2] * s + b[2]! * u;
  const w = a[3] * s + b[3]! * u;
  const len = Math.hypot(x, y, z, w);
  if (len < 1e-6) return; // exactly opposite: no arc to follow, keep `a`
  a[0] = x / len;
  a[1] = y / len;
  a[2] = z / len;
  a[3] = w / len;
}
