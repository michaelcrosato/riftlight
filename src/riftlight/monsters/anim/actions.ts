import { Vector3 } from 'three/webgpu';
import type { Key, Layer, Pose } from '../../../engine/animation';
import type { LegDef, MonsterClipDef, Skeleton } from '../types';
import { bake, type BakeContext, type FeetFn } from './bake';
import { P, Poser } from './poser';

/**
 * Idle, attacks, hit react, death and spawn as templates over the semantic poser. Every
 * attack has a clear anticipation (moves *against* the strike), a hit frame (`hit`, when
 * combat applies damage) and a follow-through, so monsters are readable and fair: the
 * wind-up window (`windup`) is what telegraphs and glows cover.
 */
const RAD = Math.PI / 180;
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

interface Sizes {
  /** Body length scale for lunges (m). */
  L: number;
  /** Height (m). */
  H: number;
  /** Leg reach (m) or a stand-in. */
  R: number;
}

function sizes(sk: Skeleton): Sizes {
  const reach = sk.legs.length ? Math.min(...sk.legs.map((l) => l.reach)) : sk.height * 0.4;
  return { L: Math.min(0.5, Math.max(0.12, sk.length * 0.35)), H: sk.height, R: reach };
}

/** Feet planted, scaled with the root (grow-in spawns, swelling bombers stay planted). */
export function plantedFeet(sk: Skeleton): FeetFn {
  const root = sk.roles.root;
  return (leg, _f, pose) => {
    const s = pose[root]?.s[1] ?? 1;
    const k = Math.min(1, s);
    return new Vector3(leg.rest[0] * k, 0, leg.rest[2] * k);
  };
}

/**
 * Feet that leave the floor: `w(leg, f)` 0 = planted, 1 = tucked under the hip (following
 * the body through rears, leaps and collapses). Blends smoothly, so there is no pop at the
 * hand-off.
 */
export function tuckFeet(ctx: BakeContext, w: (leg: LegDef, f: number) => number): FeetFn {
  const base = plantedFeet(ctx.skeleton);
  return (leg, f, pose) => {
    const planted = base(leg, f, pose)!;
    const k = smooth(w(leg, f));
    if (k <= 0) return planted;
    const yaw = leg.splay * RAD;
    const tucked = new Vector3(leg.hipPos[0] + Math.sin(yaw) * leg.reach * 0.3, leg.hipPos[1] - leg.reach * 0.55, leg.hipPos[2] + Math.cos(yaw) * leg.reach * 0.22).applyMatrix4(ctx.kin.world(leg.parent));
    tucked.y = Math.max(tucked.y, 0);
    return planted.lerp(tucked, k);
  };
}

/** Ramp 0 → 1 → 0: up over [a, b], held, down over [c, d]. */
const ramp = (f: number, a: number, b: number, c: number, d: number) => (f <= a ? 0 : f < b ? (f - a) / (b - a) : f <= c ? 1 : f < d ? 1 - (f - c) / (d - c) : 0);

// ---------------------------------------------------------------- idle

export function idleClip(ctx: BakeContext): MonsterClipDef {
  const sk = ctx.skeleton;
  const ps = new Poser(sk);
  const loco = sk.locomotion;
  const F = 60;
  const keys: Key[] = [];
  const TAU = Math.PI * 2;
  if (loco === 'float' || loco === 'slither' || loco === 'blob') {
    for (let f = 0; f < F; f++) {
      const u = f / F;
      const s = Math.sin(TAU * u);
      const pose =
        loco === 'float'
          ? P(ps.root([0, 0.05 * s, 0], [3 * Math.sin(TAU * u * 2), 8 * Math.sin(TAU * u), 0]), ps.tentacles(6, (c, i) => 10 * Math.sin(TAU * (u * 2 - i * 0.22 - c * 0.17))), ps.wings(22 * Math.sin(TAU * u * 3), 0.75, 14 * Math.sin(TAU * u * 3 - 0.8)), ps.tail(6, 14 * s, 8 * Math.sin(TAU * u - 1)), ps.jaw(0.08 + 0.08 * s))
          : loco === 'slither'
            ? P(ps.root([0.02 * s, 0, 0], [0, 6 * s, 0]), ps.segments((i) => 6 * Math.sin(TAU * (u - i * 0.12))), ps.neck(4 * Math.sin(TAU * u * 2), -8 * s), ps.head(-3 * Math.sin(TAU * u * 2), 12 * Math.sin(TAU * u + 1)), ps.jaw(f > 40 && f < 50 ? 0.25 : 0))
            : P(ps.mass(0.06 * s, [0, -0.06 * s * massHalf(sk), 0]), ps.root([0, 0, 0], [0, 6 * Math.sin(TAU * u), 2 * Math.sin(TAU * u * 2)]), ps.jaw(0.1 + 0.1 * s));
      keys.push([f, pose, 'linear']);
    }
    keys.push([F, keys[0]![1], 'linear']);
    return bake(ctx, { name: 'Idle', frames: F, loop: true, keys, grounded: loco === 'blob' }, { kind: 'idle' });
  }
  const look = (yaw: number, pitch = 0): Pose => P(ps.neck(pitch * 0.5, yaw * 0.4), ps.head(pitch, yaw * 0.6));
  keys.push([0, look(0)], [18, look(16, -4)], [36, look(-12, 3)], [60, look(0)]);
  const layers: Layer[] = [{ joint: sk.roles.root, channel: 'py', amplitude: 0.008, period: 60 }];
  const sp = sk.roles.chest ?? sk.roles.spine[0];
  if (sp) layers.push({ joint: sp, channel: 'rx', amplitude: 1.6, period: 60, phase: 0.1 });
  sk.roles.tail.forEach((j, i) => layers.push({ joint: j, channel: 'ry', amplitude: 7, period: 60, phase: i * 0.08 }));
  if (sk.roles.jaw) layers.push({ joint: sk.roles.jaw, channel: 'rx', amplitude: 2.5, period: 30 });
  if (sk.roles.wings) {
    layers.push({ joint: sk.roles.wings.L[0]!, channel: 'rz', amplitude: 3, period: 30 });
    layers.push({ joint: sk.roles.wings.R[0]!, channel: 'rz', amplitude: -3, period: 30 });
  }
  for (const a of sk.arms) layers.push({ joint: a.arm, channel: 'rx', amplitude: 2.5, period: 60, phase: a.side === 'R' ? 0 : 0.5 });
  sk.roles.segments.forEach((j, i) => layers.push({ joint: j, channel: 'ry', amplitude: 2.5, period: 60, phase: i * 0.1 }));
  return bake(ctx, { name: 'Idle', frames: F, loop: true, keys, layers, grounded: true }, { kind: 'idle', feet: plantedFeet(sk), step: 1.5 });
}

function massHalf(sk: Skeleton): number {
  const m = sk.joints.find((j) => j.name === sk.roles.mass);
  return m ? m.pos[1] : 0.3;
}

// ---------------------------------------------------------------- attacks

type Builder = (ctx: BakeContext, opts: { weapon: boolean }) => MonsterClipDef;

const legged = (sk: Skeleton) => sk.legs.length > 0;

export const ACTIONS: Readonly<Record<string, Builder>> = {
  Bite(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const { L } = sizes(sk);
    const blob = sk.locomotion === 'blob';
    const fl = sk.locomotion === 'float';
    const rear = blob ? P(ps.mass(0.18, [0, -0.18 * massHalf(sk), 0]), ps.root([0, 0, -0.06], [-6, 0, 0])) : P(ps.root([0, -0.02, -0.25 * L], [fl ? -14 : -5, 0, 0]), ps.spine(-10), ps.neck(-20), ps.head(-12));
    const strike = blob ? P(ps.mass(-0.2, [0, 0.2 * massHalf(sk), 0]), ps.root([0, 0, 0.18], [10, 0, 0])) : P(ps.root([0, -0.03, 0.45 * L], [fl ? 18 : 7, 0, 0]), ps.spine(14), ps.neck(24), ps.head(10));
    const keys: Key[] = [
      [0, {}],
      [8, P(rear, ps.jaw(0.4), ps.arms(-30, 20, 50))],
      [12, P(strike, ps.jaw(1), ps.arms(-60, 25, 30)), 'out'],
      [14, P(strike, ps.jaw(0), ps.arms(-60, 25, 30))],
      [18, P(strike, ps.jaw(0.1), ps.arms(-50, 25, 30))],
      [26, {}],
    ];
    return bake(ctx, { name: 'Bite', frames: 26, keys, grounded: legged(sk), fast: true, notes: 'Rear back, lunge, snap at f14, hold, recover.' }, { kind: 'attack', hit: 14, windup: [0, 12], feet: plantedFeet(sk) });
  },

  Claw(ctx, { weapon }) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const { L } = sizes(sk);
    if (!ps.has.arms) return ACTIONS.Bite!(ctx, { weapon });
    const keys: Key[] = weapon
      ? [
          [0, {}],
          [10, P(ps.root([0, 0.01, -0.12 * L], [-4, 0, 0]), ps.spine(-12, -18), ps.arm('R', -165, 18, 45), ps.arm('L', -40, 25, 40), ps.head(-6, 10))],
          [13, P(ps.root([0, -0.04, 0.3 * L], [6, 0, 0]), ps.spine(22, 12), ps.arm('R', -55, 8, 5), ps.arm('L', 10, 25, 30), ps.head(8, -5)), 'out'],
          [18, P(ps.root([0, -0.05, 0.3 * L], [6, 0, 0]), ps.spine(26, 16), ps.arm('R', -30, 12, 10), ps.arm('L', 15, 25, 30), ps.head(10, -5))],
          [30, {}],
        ]
      : [
          [0, {}],
          [9, P(ps.root([0, 0, -0.1 * L]), ps.spine(-6, -28), ps.arm('R', 35, 50, 70), ps.arm('L', -35, 20, 40), ps.head(0, 12)), 'in'],
          [13, P(ps.root([0, -0.02, 0.25 * L]), ps.spine(10, 30), ps.arm('R', -100, -8, 10), ps.arm('L', 20, 20, 40), ps.head(4, -10)), 'out'],
          [17, P(ps.root([0, -0.02, 0.25 * L]), ps.spine(12, 38), ps.arm('R', -72, -36, 30), ps.arm('L', 22, 20, 40), ps.head(4, -14))],
          [28, {}],
        ];
    const frames = weapon ? 30 : 28;
    return bake(ctx, { name: 'Claw', frames, keys, grounded: legged(sk), fast: true, notes: weapon ? 'Overhead chop: raise, hit f13, follow through.' : 'Wind the arm back, swipe across at f13, follow through.' }, { kind: 'attack', hit: 13, windup: [0, 11], feet: plantedFeet(sk) });
  },

  Slam(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const { H, R } = sizes(sk);
    let keys: Key[];
    let feet: FeetFn | undefined = plantedFeet(sk);
    const hit = 19;
    if (ps.has.arms) {
      keys = [
        [0, {}],
        [12, P(ps.root([0, 0.02, -0.03]), ps.spine(-16), ps.arms(-168, 16, 30), ps.head(-12), ps.jaw(0.5))],
        [15, P(ps.root([0, 0.03, -0.03]), ps.spine(-18), ps.arms(-172, 18, 32), ps.head(-14), ps.jaw(0.7)), 'in'],
        [19, P(ps.root([0, -0.1 * R, 0.05]), ps.spine(36), ps.arms(-38, 12, 6), ps.head(12), ps.jaw(0.9)), 'out'],
        [26, P(ps.root([0, -0.09 * R, 0.05]), ps.spine(32), ps.arms(-34, 14, 10), ps.head(10), ps.jaw(0.4))],
        [36, {}],
      ];
    } else if (sk.locomotion === 'blob') {
      const h = massHalf(sk);
      keys = [
        [0, {}],
        [10, P(ps.mass(0.3, [0, -0.3 * h, 0]))],
        [15, P(ps.root([0, H * 0.7, 0]), ps.mass(-0.25, [0, 0.25 * h, 0])), 'in'],
        [19, P(ps.mass(0.45, [0, -0.45 * h, 0]), ps.jaw(1)), 'out'],
        [26, P(ps.mass(0.2, [0, -0.2 * h, 0]))],
        [36, {}],
      ];
      feet = undefined;
    } else if (sk.locomotion === 'float') {
      keys = [
        [0, {}],
        [12, P(ps.root([0, 0.35, -0.05], [-16, 0, 0]), ps.tentacles(-22), ps.wings(40, 0.75), ps.jaw(0.6))],
        [15, P(ps.root([0, 0.4, -0.05], [-18, 0, 0]), ps.tentacles(-26), ps.wings(44, 0.75), ps.jaw(0.8)), 'in'],
        [19, P(ps.root([0, -0.8, 0.1], [14, 0, 0]), ps.tentacles(24), ps.wings(-20, 0.75), ps.jaw(1)), 'out'],
        [26, P(ps.root([0, -0.7, 0.1], [12, 0, 0]), ps.tentacles(18))],
        [36, {}],
      ];
      feet = undefined;
    } else if (sk.locomotion === 'slither') {
      keys = [
        [0, {}],
        [12, P(ps.neck(-40), ps.head(-22), ps.root([0, 0.03, -0.05]), ps.jaw(0.7))],
        [15, P(ps.neck(-44), ps.head(-24), ps.root([0, 0.04, -0.06]), ps.jaw(0.9)), 'in'],
        [19, P(ps.neck(30), ps.head(18), ps.root([0, 0, 0.12]), ps.jaw(1)), 'out'],
        [26, P(ps.neck(26), ps.head(14), ps.root([0, 0, 0.1]))],
        [36, {}],
      ];
      feet = undefined;
    } else {
      keys = [
        [0, {}],
        [12, P(ps.root([0, 0.02, -0.04], [-20, 0, 0]), ps.neck(-22), ps.head(-10), ps.jaw(0.6), ps.wings(40, 0.62), ps.tail(20))],
        [15, P(ps.root([0, 0.03, -0.05], [-23, 0, 0]), ps.neck(-26), ps.head(-12), ps.jaw(0.8), ps.wings(46, 0.62), ps.tail(24)), 'in'],
        [19, P(ps.root([0, -0.06 * R, 0.04], [8, 0, 0]), ps.neck(22), ps.head(10), ps.jaw(1), ps.wings(-10, 0.25), ps.tail(-10)), 'out'],
        [26, P(ps.root([0, -0.05 * R, 0.03], [6, 0, 0]), ps.neck(18), ps.head(8), ps.jaw(0.3))],
        [36, {}],
      ];
      feet = tuckFeet(ctx, (leg, f) => (leg.pair === 0 ? ramp(f, 3, 11, 15, 19) : 0));
    }
    return bake(ctx, { name: 'Slam', frames: 36, keys, grounded: false, fast: true, notes: 'Big telegraphed slam: raise, hang, smash at f19, shake.' }, { kind: 'attack', hit, windup: [0, 17], feet });
  },

  ChargeWindup(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const { L, R } = sizes(sk);
    const crouch = P(ps.root([0, -0.06 * R, -0.12 * L], [8, 0, 0]), ps.spine(18), ps.neck(26), ps.head(10), ps.jaw(0.3), ps.arms(30, 20, 60), ps.tail(14), ps.wings(10, 0.25), ps.mass(0.25, [0, -0.25 * massHalf(sk), 0]));
    const keys: Key[] = [
      [0, {}],
      [8, crouch],
      [16, P(crouch, ps.head(14, 6))],
      [24, P(crouch, ps.root([0, -0.08 * R, -0.16 * L], [10, 0, 0]))],
    ];
    const scrape = sk.legs.find((l) => l.pair === 0 && l.side === 'R');
    const base = plantedFeet(sk);
    const feet: FeetFn = (leg, f, pose) => {
      const p = base(leg, f, pose)!;
      if (leg !== scrape) return p;
      const k = f >= 9 && f <= 21 ? Math.sin(((f - 9) / 6) * Math.PI) : 0;
      return p.add(new Vector3(0, Math.max(0, k) * leg.reach * 0.08, -Math.abs(k) * leg.reach * 0.25));
    };
    return bake(ctx, { name: 'ChargeWindup', frames: 24, keys, grounded: true, notes: 'Head down, paws the ground twice; the dash starts at the end (f24).' }, { kind: 'attack', hit: 24, windup: [0, 24], feet: sk.legs.length ? feet : undefined });
  },

  Spit(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const { L } = sizes(sk);
    const h = massHalf(sk);
    const keys: Key[] = [
      [0, {}],
      [10, P(ps.root([0, 0.01, -0.2 * L], [-8, 0, 0]), ps.spine(-16), ps.neck(-26), ps.head(-16), ps.jaw(0.45), ps.mass(-0.15, [0, 0.15 * h, 0]), ps.arms(-20, 15, 40))],
      [14, P(ps.root([0, -0.01, 0.15 * L], [6, 0, 0]), ps.spine(10), ps.neck(18), ps.head(0), ps.jaw(1), ps.mass(0.2, [0, -0.2 * h, 0]), ps.arms(-40, 15, 30)), 'out'],
      [20, P(ps.root([0, -0.01, 0.12 * L], [5, 0, 0]), ps.spine(8), ps.neck(14), ps.head(2), ps.jaw(0.7), ps.arms(-35, 15, 30))],
      [30, {}],
    ];
    return bake(ctx, { name: 'Spit', frames: 30, keys, grounded: legged(sk), fast: true, notes: 'Rear back, lurch forward, the shot leaves at f15.' }, { kind: 'attack', hit: 15, windup: [0, 13], feet: plantedFeet(sk) });
  },

  Cast(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const h = massHalf(sk);
    const keys: Key[] = ps.has.arms
      ? [
          [0, {}],
          [12, P(ps.spine(-12), ps.arms(-125, 40, 45), ps.head(-10), ps.root([0, 0.01, -0.03]))],
          [16, P(ps.spine(8), ps.arms(-92, 10, 0), ps.head(2), ps.root([0, -0.01, 0.04])), 'out'],
          [22, P(ps.spine(6), ps.arms(-88, 12, 5), ps.head(2), ps.root([0, -0.01, 0.04]))],
          [32, {}],
        ]
      : [
          [0, {}],
          [12, P(ps.root([0, 0.08, -0.05], [-14, 0, 0]), ps.neck(-20), ps.head(-14), ps.jaw(0.6), ps.tentacles(-16), ps.wings(36, 0.75), ps.mass(-0.15, [0, 0.15 * h, 0]))],
          [16, P(ps.root([0, 0.02, 0.06], [10, 0, 0]), ps.neck(12), ps.head(4), ps.jaw(1), ps.tentacles(14), ps.wings(-12, 0.75), ps.mass(0.15, [0, -0.15 * h, 0])), 'out'],
          [22, P(ps.root([0, 0.02, 0.05], [8, 0, 0]), ps.neck(10), ps.head(4), ps.jaw(0.6), ps.tentacles(10))],
          [32, {}],
        ];
    return bake(ctx, { name: 'Cast', frames: 32, keys, grounded: legged(sk), notes: 'Gather (glow) then release at f16.' }, { kind: 'attack', hit: 16, windup: [0, 14], feet: plantedFeet(sk) });
  },

  Summon(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const h = massHalf(sk);
    const raise = P(ps.root([0, 0.03, 0], [-6, 0, 0]), ps.spine(-18), ps.arms(-172, 30, 20), ps.neck(-16), ps.head(-22), ps.jaw(0.7), ps.wings(40, 1), ps.tentacles(-20), ps.mass(-0.2, [0, 0.2 * h, 0]));
    const keys: Key[] = [
      [0, {}],
      [16, raise],
      [21, P(raise, ps.head(-26)), 'in'],
      [24, P(ps.root([0, -0.04, 0.02], [8, 0, 0]), ps.spine(16), ps.arms(-55, 65, 0), ps.neck(10), ps.head(10), ps.jaw(1), ps.wings(-5, 1), ps.tentacles(18), ps.mass(0.25, [0, -0.25 * h, 0])), 'out'],
      [30, P(ps.spine(10), ps.arms(-50, 60, 5), ps.head(6), ps.jaw(0.4))],
      [40, {}],
    ];
    return bake(ctx, { name: 'Summon', frames: 40, keys, grounded: legged(sk), notes: 'Arms up (the call), minions burst out at f24.' }, { kind: 'attack', hit: 24, windup: [0, 22], feet: plantedFeet(sk) });
  },

  Leap(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const { H, R } = sizes(sk);
    const h = massHalf(sk);
    const keys: Key[] = [
      [0, {}],
      [9, P(ps.root([0, -0.22 * R, -0.02], [10, 0, 0]), ps.spine(14), ps.neck(10), ps.head(4), ps.arms(30, 25, 60), ps.wings(-10, 0), ps.mass(0.32, [0, -0.32 * h, 0]))],
      [14, P(ps.root([0, 0.4 * H, 0.05], [-12, 0, 0]), ps.spine(-8), ps.neck(-12), ps.head(-6), ps.arms(-150, 30, 20), ps.wings(44, 1), ps.mass(-0.2, [0, 0.2 * h, 0]), ps.jaw(0.6)), 'out'],
      [20, P(ps.root([0, 0.46 * H, 0.05], [2, 0, 0]), ps.spine(4), ps.neck(6), ps.arms(-120, 30, 30), ps.wings(30, 1), ps.jaw(1))],
      [26, P(ps.root([0, -0.14 * R, 0.06], [10, 0, 0]), ps.spine(18), ps.neck(16), ps.head(8), ps.arms(-40, 30, 30), ps.wings(-10, 0.5), ps.mass(0.35, [0, -0.35 * h, 0]), ps.jaw(0.2)), 'in'],
      [36, {}],
    ];
    const feet = sk.legs.length ? tuckFeet(ctx, (_leg, f) => ramp(f, 10, 15, 21, 26)) : undefined;
    return bake(ctx, { name: 'Leap', frames: 36, keys, fast: true, notes: 'Crouch, spring, land on the mark at f26 (move the body during f10-26).' }, { kind: 'attack', hit: 26, windup: [0, 10], feet });
  },

  TailWhip(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const keys: Key[] = [
      [0, {}],
      [10, P(ps.root([0, -0.02, 0], [0, -35, 0]), ps.tail(10, 40), ps.head(0, 25), ps.neck(0, 12), ps.segments(() => 6)), 'inOut'],
      [16, P(ps.root([0, -0.03, 0], [0, 45, 0]), ps.tail(16, -70), ps.head(0, -10), ps.neck(0, -10), ps.segments(() => -12)), 'out'],
      [20, P(ps.root([0, -0.03, 0], [0, 55, 0]), ps.tail(12, -80), ps.head(0, -16), ps.segments(() => -14))],
      [32, {}],
    ];
    return bake(ctx, { name: 'TailWhip', frames: 32, keys, grounded: legged(sk), fast: true, notes: 'Coil one way, whip the tail round at f16.' }, { kind: 'attack', hit: 16, windup: [0, 12], feet: plantedFeet(sk) });
  },

  Explode(ctx) {
    const sk = ctx.skeleton;
    const ps = new Poser(sk);
    const h = massHalf(sk);
    const keys: Key[] = [
      [0, {}],
      [24, P(ps.root([0, 0, 0], [0, 0, 0], 1.25), ps.mass(-0.12, [0, 0.12 * h, 0]), ps.jaw(1), ps.arms(-60, 60, 20), ps.tentacles(-20), ps.wings(30, 1)), 'in'],
      [28, P(ps.root([0, 0, 0], [0, 0, 0], 1.45), ps.mass(-0.2, [0, 0.2 * h, 0]), ps.jaw(1), ps.arms(-80, 80, 0), ps.tentacles(-30), ps.wings(40, 1)), 'hold'],
      [30, P(ps.root([0, 0, 0], [0, 0, 0], 1.45), ps.mass(-0.2, [0, 0.2 * h, 0]), ps.jaw(1))],
    ];
    const layers: Layer[] = [{ joint: sk.roles.root, channel: 'rz', amplitude: 5, period: 3 }];
    return bake(ctx, { name: 'Explode', frames: 30, keys, layers, fast: true, notes: 'Swells and shakes, bursts at f28 (the monster dies there).' }, { kind: 'attack', hit: 28, windup: [0, 28], feet: plantedFeet(sk) });
  },
};

// ---------------------------------------------------------------- reactions

export function hitClip(ctx: BakeContext): MonsterClipDef {
  const sk = ctx.skeleton;
  const ps = new Poser(sk);
  const { L } = sizes(sk);
  const h = massHalf(sk);
  const keys: Key[] = [
    [0, {}],
    [3, P(ps.root([0, 0.0, -0.15 * L], [-7, 0, 3]), ps.spine(-10, 6), ps.neck(-12), ps.head(-14, 8), ps.jaw(0.5), ps.arms(-20, 35, 50), ps.tail(14), ps.tentacles(-14), ps.mass(-0.18, [0, 0.18 * h, 0]), ps.wings(20, 0.25)), 'out'],
    [6, P(ps.root([0, -0.01, -0.1 * L], [-4, 0, 2]), ps.spine(-5, 4), ps.neck(-6), ps.head(-6, 4), ps.jaw(0.3), ps.mass(0.1, [0, -0.1 * h, 0]))],
    [14, {}],
  ];
  return bake(ctx, { name: 'Hit', frames: 14, keys, grounded: legged(sk), fast: true, notes: 'Flinch back and recover.' }, { kind: 'hit', feet: plantedFeet(sk) });
}

export function deathClip(ctx: BakeContext): MonsterClipDef {
  const sk = ctx.skeleton;
  const ps = new Poser(sk);
  const { H } = sizes(sk);
  const h = massHalf(sk);
  if (sk.locomotion === 'blob') {
    const keys: Key[] = [
      [0, {}],
      [7, P(ps.mass(-0.3, [0, 0.3 * h, 0]), ps.root([0, 0, 0], [0, 0, 0], 1.18), ps.jaw(1)), 'in'],
      [11, P(ps.root([0, 0, 0], [0, 0, 0], 0.04)), 'hold'],
      [16, P(ps.root([0, 0, 0], [0, 0, 0], 0.04))],
    ];
    return bake(ctx, { name: 'Death', frames: 16, keys, notes: 'Swell and pop at f11.' }, { kind: 'death', hit: 11 });
  }
  if (sk.locomotion === 'slither') {
    // Serpents writhe and go limp along the floor: lateral coils, head drops, no roll.
    const keys: Key[] = [
      [0, {}],
      [6, P(ps.neck(-30, 20), ps.head(-20, 10), ps.jaw(1), ps.root([0, 0.02, 0], [0, 12, 0]), ps.segments((i) => 14 * Math.sin(i * 1.3))), 'out'],
      [16, P(ps.neck(20, -25), ps.head(10, -15), ps.jaw(0.8), ps.root([0, 0, 0], [0, -8, 8]), ps.segments((i) => -18 * Math.sin(i * 1.1 + 0.5))), 'inOut'],
      [28, P(ps.neck(22, 10), ps.head(14, 20), ps.jaw(0.5), ps.root([0, 0, 0], [0, 4, 14]), ps.segments((i) => 10 * Math.sin(i * 0.9 + 1))), 'out'],
      [34, P(ps.neck(24, 10), ps.head(15, 20), ps.jaw(0.5), ps.root([0, 0, 0], [0, 4, 14]), ps.segments((i) => 10 * Math.sin(i * 0.9 + 1)))],
    ];
    return bake(ctx, { name: 'Death', frames: 34, keys, notes: 'Writhe, head drops, goes limp along the floor.' }, { kind: 'death', clearance: 0.02 });
  }
  const upright = sk.arms.length > 0 || sk.plan === 'avian';
  if (upright) {
    // Upright bodies buckle at the knees and pitch forward onto their face.
    const keys: Key[] = [
      [0, {}],
      [5, P(ps.root([0, 0.02, -0.05], [-12, 0, 3]), ps.spine(-14), ps.neck(-16), ps.head(-20), ps.jaw(0.8), ps.arms(-70, 40, 30), ps.wings(30, 0.75)), 'out'],
      [14, P(ps.root([0, -H * 0.25, 0.04], [18, 0, 6]), ps.spine(18), ps.neck(10), ps.head(10, 8), ps.jaw(0.6), ps.arms(-30, 30, 50), ps.tail(-10), ps.wings(10, 0.4)), 'in'],
      [24, P(ps.root([0, -H, H * 0.3], [84, 0, 10]), ps.spine(10), ps.neck(-20), ps.head(-20, 30), ps.jaw(0.4), ps.arms(-160, 50, 30), ps.tail(-20), ps.wings(-10, 0.9, -10)), 'out'],
      [34, P(ps.root([0, -H, H * 0.32], [86, 0, 10]), ps.spine(8), ps.neck(-22), ps.head(-22, 32), ps.jaw(0.4), ps.arms(-165, 55, 25), ps.tail(-22), ps.wings(-12, 0.9, -12))],
    ];
    const feet = sk.legs.length ? tuckFeet(ctx, (_leg, f) => smooth((f - 10) / 12)) : undefined;
    return bake(ctx, { name: 'Death', frames: 34, keys, notes: 'Reel, knees buckle, pitch forward onto the floor.' }, { kind: 'death', feet, clearance: 0.02 });
  }
  const drop = sk.locomotion === 'float' ? -H : -H * 0.5;
  const keys: Key[] = [
    [0, {}],
    [5, P(ps.root([0, 0.02, -0.04], [-10, 0, 4]), ps.spine(-12), ps.neck(-16), ps.head(-18), ps.jaw(0.8), ps.arms(-60, 40, 30), ps.wings(30, 0.75), ps.tentacles(-16)), 'out'],
    [18, P(ps.root([0, drop * 0.7, 0.05], [14, 0, 32]), ps.spine(22), ps.neck(26), ps.head(22, 10), ps.jaw(0.6), ps.arms(-30, 50, 40), ps.tail(-14), ps.wings(-14, 0, -10), ps.tentacles(10), ps.segments((i) => 8 + i * 2)), 'in'],
    [26, P(ps.root([0, drop, 0.06], [16, 0, 74]), ps.spine(24), ps.neck(34), ps.head(24, 14), ps.jaw(0.5), ps.arms(-20, 70, 20), ps.tail(-20), ps.wings(-24, 0, -10), ps.tentacles(4), ps.segments((i) => 10 + i * 3)), 'out'],
    [34, P(ps.root([0, drop, 0.06], [16, 0, 76]), ps.spine(24), ps.neck(36), ps.head(26, 14), ps.jaw(0.5), ps.arms(-20, 70, 20), ps.tail(-22), ps.wings(-26, 0, -10), ps.tentacles(4), ps.segments((i) => 10 + i * 3))],
  ];
  const feet = sk.legs.length ? tuckFeet(ctx, (_leg, f) => smooth((f - 6) / 14)) : undefined;
  return bake(ctx, { name: 'Death', frames: 34, keys, notes: 'Reel, buckle, fall on its side.' }, { kind: 'death', feet, clearance: 0.02 });
}

export function spawnClip(ctx: BakeContext): MonsterClipDef {
  const sk = ctx.skeleton;
  const ps = new Poser(sk);
  const rootPos = sk.joints[0]!.pos;
  const grown = (s: number, extra: Pose = {}): Pose => P(ps.root([(s - 1) * rootPos[0], (s - 1) * rootPos[1], (s - 1) * rootPos[2]], [0, 0, 0], s), extra);
  const keys: Key[] = [
    [0, grown(0.05, P(ps.neck(20), ps.head(20))), 'out'],
    [12, grown(1.12, P(ps.neck(-18), ps.head(-20), ps.jaw(1), ps.arms(-150, 40, 20), ps.wings(40, 1), ps.tentacles(-20)))],
    [18, grown(0.97, P(ps.neck(-10), ps.head(-12), ps.jaw(0.8), ps.arms(-120, 40, 30)))],
    [26, grown(1)],
  ];
  return bake(ctx, { name: 'Spawn', frames: 26, keys, notes: 'Bursts up out of the ground, roars, settles.' }, { kind: 'spawn', feet: sk.legs.length ? plantedFeet(sk) : undefined });
}

export const ACTION_NAMES = Object.keys(ACTIONS);

