import type { Euler, JointPose, Pose, Vec3 } from '../../../engine/animation';
import { WING_FOLD } from '../plans/common';
import type { Skeleton } from '../types';

/**
 * Semantic posing over any generated skeleton. Templates say "lean the spine 20°, open the
 * jaw, raise both arms" and the poser writes whichever joints this body has: a serpent's
 * neck is two joints, a quadruped's tail three, a blob has neither. Values are deltas on top
 * of the plan's stance, in the hero's conventions: +X pitches forward/down (spine, neck,
 * head, jaw open), arm swing −90 = forward, + = back.
 */
export class Poser {
  readonly has: {
    arms: boolean;
    neck: boolean;
    head: boolean;
    jaw: boolean;
    tail: boolean;
    wings: boolean;
    tentacles: boolean;
    segments: boolean;
    spine: boolean;
    mass: boolean;
    legs: boolean;
  };

  constructor(readonly sk: Skeleton) {
    const r = sk.roles;
    this.has = {
      arms: sk.arms.length > 0,
      neck: r.neck.length > 0,
      head: !!r.head,
      jaw: !!r.jaw,
      tail: r.tail.length > 0,
      wings: !!r.wings,
      tentacles: r.tentacles.length > 0,
      segments: r.segments.length > 0,
      spine: r.spine.length > 0 || !!r.chest,
      mass: !!r.mass,
      legs: sk.legs.length > 0,
    };
  }

  /** Root offset (m), rotation (deg) and squash (uniform or xyz). */
  root(p: Vec3 = [0, 0, 0], r: Euler = [0, 0, 0], s: number | Vec3 = 1): Pose {
    return { [this.sk.roles.root]: { p, r, s } };
  }

  /** Bend the torso: spread over spine joints and chest; falls back to the root. */
  spine(pitch: number, yaw = 0, roll = 0): Pose {
    const r = this.sk.roles;
    const joints = [...r.spine, ...(r.chest ? [r.chest] : [])];
    if (!joints.length) return {};
    const k = 1 / joints.length;
    return Object.fromEntries(joints.map((j) => [j, [pitch * k, yaw * k, roll * k] as Euler]));
  }

  neck(pitch: number, yaw = 0): Pose {
    const n = this.sk.roles.neck;
    if (!n.length) return {};
    return Object.fromEntries(n.map((j) => [j, [pitch / n.length, yaw / n.length, 0] as Euler]));
  }

  head(pitch: number, yaw = 0, roll = 0): Pose {
    const h = this.sk.roles.head;
    return h ? { [h]: [pitch, yaw, roll] } : {};
  }

  /** Jaw: 0 = closed, 1 = wide open. */
  jaw(open: number): Pose {
    const j = this.sk.roles.jaw;
    return j ? { [j]: [open * 38, 0, 0] } : {};
  }

  /** Arm in the hero's terms: swing (−90 forward, −180 overhead, + back), out (+ away), elbow bend. */
  arm(side: 'R' | 'L', swing: number, out = 0, elbow = 0, twist = 0): Pose {
    const a = this.sk.arms.find((x) => x.side === side);
    if (!a) return {};
    const s = side === 'R' ? -1 : 1;
    return { [a.arm]: [swing, twist * s, out * s], [a.forearm]: [-elbow, 0, 0] };
  }

  arms(swing: number, out = 0, elbow = 0): Pose {
    return { ...this.arm('R', swing, out, elbow), ...this.arm('L', swing, out, elbow) };
  }

  /** Tail: curl (+ raises the tip), sway (+ to the right), spread along the chain with lag `wave` (deg per joint). */
  tail(curl: number, sway = 0, wave = 0): Pose {
    const t = this.sk.roles.tail;
    return Object.fromEntries(t.map((j, i) => [j, [-curl / t.length, (sway / t.length) * (1 + i * 0.3) + wave * i, 0] as Euler]));
  }

  /**
   * Wings: raise (+ up, degrees), spread (0 = folded along the body as in the stance,
   * 1 = fully open), fold of the outer half (deg, + up).
   */
  wings(raise: number, spread = 0, fold = 0): Pose {
    const w = this.sk.roles.wings;
    if (!w) return {};
    const out: Record<string, Euler> = {};
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const [w1, w2] = w[side];
      if (w1) out[w1] = [0, -WING_FOLD[0] * spread * s, (raise - WING_FOLD[2] * spread) * s];
      if (w2) out[w2] = [-WING_FOLD[4] * spread, -WING_FOLD[1] * spread * s, (fold - WING_FOLD[3] * spread) * s];
    }
    return out;
  }

  /** Tentacles: curl (+ tips back/up), with a per-joint wave phase (deg) for undulation. */
  tentacles(curl: number, wave: (chain: number, joint: number) => number = () => 0): Pose {
    const out: Record<string, Euler> = {};
    this.sk.roles.tentacles.forEach((chain, c) => chain.forEach((j, i) => (out[j] = [curl * (0.5 + i * 0.4) + wave(c, i), 0, 0])));
    return out;
  }

  /** Body segments: yaw (deg) per segment index. */
  segments(yaw: (i: number) => number, pitch: (i: number) => number = () => 0): Pose {
    return Object.fromEntries(this.sk.roles.segments.map((j, i) => [j, [pitch(i), yaw(i), 0] as Euler]));
  }

  /** Squash the main mass (blob/floater body): + = squash (shorter, wider). */
  mass(squash: number, p: Vec3 = [0, 0, 0]): Pose {
    const m = this.sk.roles.mass;
    if (!m) return {};
    const jp: JointPose = { p, s: [1 + squash * 0.5, 1 - squash, 1 + squash * 0.5] };
    return { [m]: jp };
  }
}

/** Merge pose fragments (later ones win per joint). */
export function P(...parts: Pose[]): Pose {
  return Object.assign({}, ...parts) as Pose;
}

/** Squash (+) / stretch (−) scale vector. */
export const squash = (k: number): Vec3 => [1 + k * 0.5, 1 - k, 1 + k * 0.5];
