import type { Vec3 } from '../../../engine/animation';
import type { ArmDef, GaitDef, HeadAnchors, JointDef, LegDef, Locomotion, PaletteSlot, Roles, ShapeDef, Skeleton, SocketDef, Slot } from '../types';

/**
 * The skeleton grammar's toolbox: plans describe a body with these calls (joints, body
 * shapes, sockets, legs, arms, chains) and get a `Skeleton` back. Coordinates: the monster
 * faces +Z, its right side is −X, feet at y = 0; metres at genome scale 1.
 */
export type Side = 'R' | 'L';
/** Character side → x sign (its right is −X). */
export const SX: Record<Side, -1 | 1> = { R: -1, L: 1 };

export interface LegOptions {
  pair: number;
  side: Side;
  parent: string;
  /** Hip position in the parent's space. */
  hip: Vec3;
  /** Leg plane yaw (deg, + = towards the character's left). Mirrored for R automatically when `mirrorSplay`. */
  splay?: number;
  upper: number;
  lower: number;
  ankle: number;
  bend: 1 | -1;
  /** Limb thickness (m). */
  thick: number;
  /** Sole width and length (m). */
  sole: readonly [number, number];
  /** Forward offset of the standing foot from under the hip (m), or horizontal reach for splayed legs. */
  footZ?: number;
  reach?: number;
  colors?: readonly [PaletteSlot, PaletteSlot, PaletteSlot];
}

export class SkeletonBuilder {
  readonly joints: JointDef[] = [];
  readonly shapes: ShapeDef[] = [];
  readonly sockets: SocketDef[] = [];
  readonly legs: LegDef[] = [];
  readonly arms: ArmDef[] = [];
  readonly stance: Record<string, Vec3> = {};
  private readonly worldPos = new Map<string, Vec3>();
  private readonly worldYaw = new Map<string, number>();

  constructor(readonly plan: string) {}

  joint(name: string, parent: string | null, pos: Vec3, yaw = 0): string {
    if (this.worldPos.has(name)) throw new Error(`${this.plan}: duplicate joint ${name}`);
    this.joints.push(yaw ? { name, parent, pos, yaw } : { name, parent, pos });
    const pw = parent ? this.world(parent) : ([0, 0, 0] as Vec3);
    const py = parent ? (this.worldYaw.get(parent) ?? 0) : 0;
    const r = (py * Math.PI) / 180;
    this.worldPos.set(name, [pw[0] + pos[0] * Math.cos(r) + pos[2] * Math.sin(r), pw[1] + pos[1], pw[2] - pos[0] * Math.sin(r) + pos[2] * Math.cos(r)]);
    this.worldYaw.set(name, py + yaw);
    return name;
  }

  /** Rest world position of a joint. */
  world(name: string): Vec3 {
    const w = this.worldPos.get(name);
    if (!w) throw new Error(`${this.plan}: no joint ${name}`);
    return w;
  }

  shape(joint: string, kind: ShapeDef['kind'], size: Vec3, at: Vec3, color: PaletteSlot, opts: { rot?: Vec3; taper?: number; name?: string } = {}): void {
    const name = opts.name ?? `${joint}_${kind}${this.shapes.filter((s) => s.joint === joint).length}`;
    this.shapes.push({ joint, name, kind, size, at, color, ...(opts.rot ? { rot: opts.rot } : {}), ...(opts.taper !== undefined ? { taper: opts.taper } : {}) });
  }

  socket(id: string, slot: Slot, joint: string, at: Vec3, size: number, opts: { rot?: Vec3; mirror?: boolean; data?: SocketDef['data'] } = {}): void {
    this.sockets.push({ id, slot, joint, at, size, ...opts });
  }

  /** A mirrored socket pair: authored for the left (+x), the right copy is mirrored. */
  socketPair(id: string, slot: Slot, joint: (s: Side) => string, at: Vec3, size: number, opts: { rot?: Vec3; data?: SocketDef['data'] } = {}): void {
    this.socket(`${id}L`, slot, joint('L'), at, size, opts);
    const rot = opts.rot ? ([opts.rot[0], -opts.rot[1], -opts.rot[2]] as Vec3) : undefined;
    this.socket(`${id}R`, slot, joint('R'), [-at[0], at[1], at[2]], size, { ...opts, rot, mirror: true });
  }

  /** Hip → Thigh → Shin → Foot, with limb shapes and a sole. Returns the leg. */
  leg(o: LegOptions): LegDef {
    const id = `${o.pair}${o.side}`;
    const splay = o.splay ?? 0;
    const hip = this.joint(`Hip${id}`, o.parent, o.hip, splay);
    const upper = this.joint(`Thigh${id}`, hip, [0, 0, 0]);
    const lower = this.joint(`Shin${id}`, upper, [0, -o.upper, 0]);
    const foot = this.joint(`Foot${id}`, lower, [0, -o.lower, 0]);
    const [cu, cl, cs] = o.colors ?? ['primary', 'secondary', 'dark'];
    const t = o.thick;
    this.shape(upper, 'taper', [t * 1.15, o.upper + t * 0.4, t * 1.15], [0, -o.upper / 2, 0], cu, { taper: 1.3 });
    this.shape(lower, 'taper', [t, o.lower + t * 0.3, t], [0, -o.lower / 2, 0], cl, { taper: 1.25 });
    const sole = `Sole${id}`;
    const [sw, sl] = o.sole;
    this.shape(foot, 'box', [sw, o.ankle, sl], [0, -o.ankle / 2, sl * 0.25], cs, { name: sole });
    const hw = this.world(hip);
    let rest: Vec3;
    if (splay) {
      const r = ((this.worldYaw.get(hip) ?? 0) * Math.PI) / 180;
      const reach = o.reach ?? (o.upper + o.lower) * 0.6;
      rest = [hw[0] + Math.sin(r) * reach, 0, hw[2] + Math.cos(r) * reach];
    } else rest = [hw[0], 0, hw[2] + (o.footZ ?? 0)];
    const leg: LegDef = {
      id,
      side: o.side,
      pair: o.pair,
      parent: o.parent,
      hip,
      upper,
      lower,
      foot,
      sole,
      hipPos: o.hip,
      splay,
      upperLen: o.upper,
      lowerLen: o.lower,
      ankle: o.ankle,
      bend: o.bend,
      rest,
      reach: o.upper + o.lower,
    };
    this.legs.push(leg);
    this.socket(`foot${id}`, 'feet', foot, [0, -o.ankle, sl * 0.25], sw, { mirror: o.side === 'R', data: { length: sl } });
    return leg;
  }

  /** Shoulder → Forearm → Hand, hanging down. */
  arm(side: Side, parent: string, at: Vec3, upper: number, lower: number, thick: number, colors: readonly [PaletteSlot, PaletteSlot] = ['primary', 'secondary']): ArmDef {
    const a = this.joint(`Arm${side}`, parent, at);
    const f = this.joint(`Forearm${side}`, a, [0, -upper, 0]);
    const h = this.joint(`Hand${side}`, f, [0, -lower, 0]);
    this.shape(a, 'taper', [thick * 1.2, upper + thick * 0.3, thick * 1.2], [0, -upper / 2, 0], colors[0], { taper: 1.3 });
    this.shape(f, 'taper', [thick, lower + thick * 0.2, thick], [0, -lower / 2, 0], colors[1], { taper: 1.2 });
    const def: ArmDef = { side, arm: a, forearm: f, hand: h, length: upper + lower };
    this.arms.push(def);
    return def;
  }

  /** A chain of `count` joints, each `step` from the previous; returns the names. */
  chain(prefix: string, parent: string, first: Vec3, step: Vec3, count: number): string[] {
    const out: string[] = [];
    let p = parent;
    for (let i = 0; i < count; i++) {
      p = this.joint(`${prefix}${i + 1}`, p, i === 0 ? first : step);
      out.push(p);
    }
    return out;
  }

  /**
   * Head joint sockets from the head part's anchors: head, eyes, horns, helm (crest) and
   * a Jaw joint when the head has one. `hs` = head size (m).
   */
  head(headJoint: string, hs: number, a: HeadAnchors): string | null {
    const u = (v: Vec3): Vec3 => [v[0] * hs, v[1] * hs, v[2] * hs];
    this.socket('head', 'head', headJoint, [0, 0, 0], hs);
    a.eyes.forEach((e, i) => {
      if (Math.abs(e[0]) < 0.02) this.socket(`eye${i}`, 'eyes', headJoint, u(e), hs);
      else this.socketPair(`eye${i}`, 'eyes', () => headJoint, u(e), hs);
    });
    this.socketPair('horn', 'horns', () => headJoint, u(a.horns), hs);
    this.socket('helm', 'helm', headJoint, u(a.crest), hs);
    if (!a.jaw) return null;
    const jaw = this.joint('Jaw', headJoint, u(a.jaw));
    this.socket('jaw', 'jaw', jaw, [0, 0, 0], hs);
    return jaw;
  }

  done(o: {
    roles: Partial<Roles> & { root: string };
    locomotion: Locomotion;
    gaits: { walk: GaitDef; run: GaitDef };
    height: number;
    radius: number;
    length: number;
  }): Skeleton {
    const roles: Roles = {
      spine: [],
      chest: null,
      neck: [],
      head: null,
      jaw: null,
      tail: [],
      wings: null,
      tentacles: [],
      segments: [],
      mass: null,
      ...o.roles,
    };
    return {
      plan: this.plan,
      joints: this.joints,
      shapes: this.shapes,
      sockets: this.sockets,
      legs: this.legs,
      arms: this.arms,
      roles,
      locomotion: o.locomotion,
      gaits: o.gaits,
      stance: this.stance,
      height: o.height,
      radius: o.radius,
      length: o.length,
    };
  }
}

/** Map a 0..1 gene to [lo, hi]. */
export function gene(genes: Readonly<Record<string, number>>, name: string, lo: number, hi: number, fallback = 0.5): number {
  const v = genes[name] ?? fallback;
  return lo + (hi - lo) * Math.min(1, Math.max(0, v));
}

/** Phase table helper: legs by id. */
export function phases(entries: Record<string, number>): Readonly<Record<string, number>> {
  return entries;
}
