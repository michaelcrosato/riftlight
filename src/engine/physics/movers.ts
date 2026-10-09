/**
 * Kinematic movers: lifts, shuttles, turntables, swinging blades, crushers. A mover's pose is
 * a pure function of physics time (so it is the same however fast frames come, and a replay
 * or a film sees the same thing); before every fixed step the physics world sets each mover's
 * next kinematic pose, so anything standing on it (the character, crates) can read where it
 * is going this step and ride along (`PlatformerCharacter` does).
 *
 *   const lift = physics.addMover(body, { path: [[0, 0, 0], [0, 4, 0]], speed: 1.5, hold: 1 });
 *   physics.addMover(disc, { spin: [0, 0.8, 0] });                       // rad/s about Y
 *   physics.addMover(blade, { swing: { axis: [0, 0, 1], angle: 60, period: 2.2 } });
 *
 *   physics.addMover(seat, { curve: orbit([0, 3, 0], 2.5, 12) });          // a Ferris wheel seat
 *
 * `pathPoint`, `moverRotation`, `orbit` and `pendulum` are pure (unit-tested).
 */
import { type Ease, ease } from '../tween';

export type Vec3 = readonly [number, number, number];

export interface MoverOptions {
  /** Waypoints (world positions of the body's origin), visited in order. */
  path?: readonly Vec3[];
  /** Metres per second along the path (default 2). */
  speed?: number;
  /** Seconds to wait at each waypoint. */
  hold?: number;
  /** `pingpong` (default): there and back; `loop`: the last point leads back to the first. */
  mode?: 'pingpong' | 'loop';
  /** Easing of each leg (default `inOutSine`). */
  ease?: Ease;
  /** Spin: angular velocity (rad/s) about each axis. */
  spin?: Vec3;
  /** A pendulum swing: about `axis` (unit), ± `angle` degrees, one full swing every `period` s. */
  swing?: { axis: Vec3; angle: number; period: number };
  /** Seconds added to the clock (offsets two movers on the same path). */
  phase?: number;
  /** Rotation the swing and spin start from (a quaternion x, y, z, w). */
  baseRotation?: readonly [number, number, number, number];
  /**
   * Position as any function of time instead of a path (an orbit, a pendulum's arc), into
   * `out`. Keep it pure: the same `t`, the same point.
   */
  curve?: (t: number, out: [number, number, number]) => void;
}

/** A level platform going round a circle: a Ferris wheel's seat (`curve`). */
export function orbit(center: Vec3, radius: number, period: number, o: { axis?: 'x' | 'z'; start?: number } = {}): (t: number, out: [number, number, number]) => void {
  return (t, out) => {
    const a = (o.start ?? 0) + (t * 2 * Math.PI) / period;
    out[0] = center[0] + (o.axis === 'x' ? 0 : Math.cos(a) * radius);
    out[1] = center[1] + Math.sin(a) * radius;
    out[2] = center[2] + (o.axis === 'x' ? Math.cos(a) * radius : 0);
  };
}

/** A level platform hanging `length` below `pivot`, swinging ± `angle` degrees (`curve`). */
export function pendulum(pivot: Vec3, length: number, angle: number, period: number, o: { axis?: 'x' | 'z' } = {}): (t: number, out: [number, number, number]) => void {
  return (t, out) => {
    const a = ((angle * Math.PI) / 180) * Math.sin((t * 2 * Math.PI) / period);
    out[0] = pivot[0] + (o.axis === 'x' ? 0 : Math.sin(a) * length);
    out[1] = pivot[1] - Math.cos(a) * length;
    out[2] = pivot[2] + (o.axis === 'x' ? Math.sin(a) * length : 0);
  };
}

/** Where a path is at time `t` (seconds), into `out`. */
export function pathPoint(o: MoverOptions, t: number, out: [number, number, number]): [number, number, number] {
  const pts = o.path ?? [];
  if (pts.length === 0) return out;
  if (pts.length === 1) {
    out[0] = pts[0]![0];
    out[1] = pts[0]![1];
    out[2] = pts[0]![2];
    return out;
  }
  const loop = o.mode === 'loop';
  const legs: [Vec3, Vec3][] = [];
  for (let i = 0; i + 1 < pts.length; i++) legs.push([pts[i]!, pts[i + 1]!]);
  if (loop) legs.push([pts[pts.length - 1]!, pts[0]!]);
  else for (let i = pts.length - 1; i > 0; i--) legs.push([pts[i]!, pts[i - 1]!]);
  const speed = Math.max(1e-3, o.speed ?? 2);
  const hold = Math.max(0, o.hold ?? 0);
  const times = legs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / speed + hold);
  const total = times.reduce((s, x) => s + x, 0);
  let u = (((t + (o.phase ?? 0)) % total) + total) % total;
  for (let i = 0; i < legs.length; i++) {
    const [a, b] = legs[i]!;
    const d = times[i]!;
    if (u > d && i < legs.length - 1) {
      u -= d;
      continue;
    }
    const move = d - hold;
    // wait at the start of the leg, then travel
    const k = u <= hold ? 0 : ease(o.ease ?? 'inOutSine', move > 0 ? (u - hold) / move : 1);
    out[0] = a[0] + (b[0] - a[0]) * k;
    out[1] = a[1] + (b[1] - a[1]) * k;
    out[2] = a[2] + (b[2] - a[2]) * k;
    return out;
  }
  return out;
}

/** Quaternion (x, y, z, w) of a spin or swing at time `t`, composed onto `baseRotation`. */
export function moverRotation(o: MoverOptions, t: number, out: [number, number, number, number]): [number, number, number, number] {
  const base = o.baseRotation ?? [0, 0, 0, 1];
  let ax = 0;
  let ay = 1;
  let az = 0;
  let angle = 0;
  const time = t + (o.phase ?? 0);
  if (o.spin) {
    const [sx, sy, sz] = o.spin;
    const w = Math.hypot(sx, sy, sz);
    if (w > 0) {
      ax = sx / w;
      ay = sy / w;
      az = sz / w;
      angle = w * time;
    }
  } else if (o.swing) {
    const [x, y, z] = o.swing.axis;
    const l = Math.hypot(x, y, z) || 1;
    ax = x / l;
    ay = y / l;
    az = z / l;
    angle = ((o.swing.angle * Math.PI) / 180) * Math.sin((time * 2 * Math.PI) / o.swing.period);
  }
  const s = Math.sin(angle / 2);
  const q = [ax * s, ay * s, az * s, Math.cos(angle / 2)] as const;
  // q × base
  const [bx, by, bz, bw] = base;
  out[0] = q[3] * bx + q[0] * bw + q[1] * bz - q[2] * by;
  out[1] = q[3] * by - q[0] * bz + q[1] * bw + q[2] * bx;
  out[2] = q[3] * bz + q[0] * by - q[1] * bx + q[2] * bw;
  out[3] = q[3] * bw - q[0] * bx - q[1] * by - q[2] * bz;
  return out;
}

/** The parts of a Rapier body a mover drives. */
export interface KinematicBody {
  setNextKinematicTranslation(t: { x: number; y: number; z: number }): void;
  setNextKinematicRotation(r: { x: number; y: number; z: number; w: number }): void;
  /** Set right away (Rapier bodies have them): a mover starts where its clock says. */
  setTranslation?(t: { x: number; y: number; z: number }, wake: boolean): void;
  setRotation?(r: { x: number; y: number; z: number; w: number }, wake: boolean): void;
}

export interface Mover {
  readonly body: KinematicBody;
  readonly options: MoverOptions;
  /** Its own clock: seconds since it was added (what its pose is a function of). */
  readonly time: number;
  /** Stop moving it (it stays where it is). */
  remove(): void;
  /** Change the options (a lift that starts moving: set a path). Its clock keeps running. */
  set(options: MoverOptions): void;
}

/** The movers of a physics world: `step(time)` before each fixed step. */
interface Entry {
  body: KinematicBody;
  options: MoverOptions;
  handle: Mover;
  /** World time it was added: its own clock starts there. */
  start: number;
  time: number;
}

export class Movers {
  private list: Entry[] = [];
  private readonly p: [number, number, number] = [0, 0, 0];
  private readonly q: [number, number, number, number] = [0, 0, 0, 1];
  private readonly vec = { x: 0, y: 0, z: 0 };
  private readonly rot = { x: 0, y: 0, z: 0, w: 1 };

  get count(): number {
    return this.list.length;
  }

  /** Drive `body` from now on: its clock starts at 0 at world time `start`. */
  add(body: KinematicBody, options: MoverOptions, start = 0): Mover {
    const entry: Entry = { body, options, handle: null as unknown as Mover, start, time: 0 };
    entry.handle = {
      body,
      get options() {
        return entry.options;
      },
      get time() {
        return entry.time;
      },
      remove: () => {
        this.list = this.list.filter((e) => e !== entry);
      },
      set: (o) => {
        entry.options = o;
      },
    };
    this.list.push(entry);
    return entry.handle;
  }

  /** Set every mover's next pose for world time `t`. */
  step(t: number): void {
    for (const e of this.list) {
      e.time = t - e.start;
      this.pose(e.body, e.options, e.time, true);
    }
  }

  /** Put `body` where `o` says it is at its own time `t` (`next`: as the next kinematic pose). */
  pose(body: KinematicBody, o: MoverOptions, t: number, next: boolean): void {
    if (o.curve) {
      o.curve(t + (o.phase ?? 0), this.p);
      this.vec.x = this.p[0];
      this.vec.y = this.p[1];
      this.vec.z = this.p[2];
      this.place(body, next);
    } else if (o.path?.length) {
      pathPoint(o, t, this.p);
      this.vec.x = this.p[0];
      this.vec.y = this.p[1];
      this.vec.z = this.p[2];
      this.place(body, next);
    }
    if (o.spin || o.swing) {
      moverRotation(o, t, this.q);
      this.rot.x = this.q[0];
      this.rot.y = this.q[1];
      this.rot.z = this.q[2];
      this.rot.w = this.q[3];
      this.turn(body, next);
    }
  }

  private place(body: KinematicBody, next: boolean): void {
    if (next) body.setNextKinematicTranslation(this.vec);
    else body.setTranslation?.(this.vec, true);
  }

  private turn(body: KinematicBody, next: boolean): void {
    if (next) body.setNextKinematicRotation(this.rot);
    else body.setRotation?.(this.rot, true);
  }

  /** Stop driving `body` (it left the world). */
  removeBody(body: KinematicBody): void {
    this.list = this.list.filter((e) => e.body !== body);
  }

  clear(): void {
    this.list = [];
  }
}
