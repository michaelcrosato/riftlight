import { Vector3 } from 'three/webgpu';
import type { ClipDef, Key, Pose } from '../../../engine/animation';
import type { GaitDef, MonsterClipDef } from '../types';
import { bake, type BakeContext, type FeetFn } from './bake';
import { P, Poser } from './poser';

/**
 * Locomotion cycles for every plan, all with planted contacts by construction:
 *
 * - legs/hop: `gaitClip` generalised to N legs. Each leg has a phase offset (trot, pace,
 *   lateral walk, tripod, wave gaits are just phase tables); in stance a foot slides back
 *   at exactly the clip speed, in swing it arcs forward. Hoppers swing both feet together
 *   and the body arcs between contacts.
 * - slither: a lateral wave travelling down the chain at the ground speed.
 * - float: bob, lean into the motion, trailing tentacles, flapping wings.
 * - blob: squash → hop → splat; the base is planted while on the ground (the root slides
 *   back under it at the clip speed) and leaps forward in the air.
 */
const TAU = Math.PI * 2;
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const wrap = (v: number) => ((v % 1) + 1) % 1;

export interface MoveOptions {
  name: string;
  run: boolean;
  /** Charge: head down, faster cadence. */
  charge?: boolean;
}

export function locomotionClip(ctx: BakeContext, gait: GaitDef, o: MoveOptions): MonsterClipDef {
  switch (ctx.skeleton.locomotion) {
    case 'slither':
      return slither(ctx, o);
    case 'float':
      return float(ctx, o);
    case 'blob':
      return blobHop(ctx, gait, o);
    default:
      return legged(ctx, gait, o);
  }
}

function legged(ctx: BakeContext, gait0: GaitDef, o: MoveOptions): MonsterClipDef {
  const sk = ctx.skeleton;
  const ps = new Poser(sk);
  const gait = gait0;
  const beta = gait.stance;
  const reach = Math.min(...sk.legs.map((l) => l.reach));
  const S = gait.stride * reach * (o.charge ? 1.1 : 1);
  // Cadence from leg length (Froude-like: bigger legs, longer strides, same feel): the
  // target ground speed sets the cycle length; the gait's `frames` is only a fallback.
  const target = (o.run ? 4 : 1.3) * Math.sqrt(reach) * (gait.pace ?? 1) * (o.charge ? 1.25 : 1);
  const F = Math.max(10, Math.min(44, Math.round((30 * S) / (beta * target)) || gait.frames));
  const T = F / 30;
  const speed = S / (beta * T);
  const lift = gait.lift * reach;
  const hop = gait.hop ?? 0;
  const bobs = gait.bobs ?? 2;
  const phase0 = gait.phase[sk.legs[0]!.id] ?? 0;
  const keys: Key[] = [];
  for (let f = 0; f < F; f++) {
    const u = f / F;
    const wave = Math.cos(TAU * bobs * u);
    let y = -gait.bob * (0.5 + 0.5 * wave) - reach * (o.run ? 0.05 : 0.025);
    let flight = 0;
    if (hop) {
      const v = wrap(u - phase0);
      if (v >= beta) {
        flight = Math.sin((Math.PI * (v - beta)) / (1 - beta));
        y += hop * flight;
      } else y -= hop * 0.3 * Math.sin((Math.PI * v) / beta);
    }
    const lean = (gait.lean ?? 0) + (o.charge ? 10 : 0);
    const armSwing = o.run ? 46 : 26;
    // arms swing forward fully but only a little back (long brute arms would scrape the floor)
    const swing = (side: 'R' | 'L') => {
      const v = armSwing * Math.cos(TAU * (u - (gait.phase[`0${side}`] ?? 0)));
      return v > 0 ? v * 0.45 : v;
    };
    const body: Pose = P(
      ps.root([0, y, 0], ps.has.spine ? [0, 0, 0] : [lean * 0.5, 0, 0]),
      ps.spine(lean, 0, 0),
      ps.neck((o.charge ? 26 : 0) + 3 * Math.cos(TAU * bobs * u + 0.6), 0),
      ps.head((o.charge ? 8 : 0) - 2 * Math.cos(TAU * bobs * u + 0.6)),
      ps.arm('R', swing('R'), 4, o.run ? 60 : 18),
      ps.arm('L', swing('L'), 4, o.run ? 60 : 18),
      ps.tail(o.run ? 8 : 0, 10 * Math.sin(TAU * u), 6 * Math.sin(TAU * u - 1)),
      // hoppers flick their wings on every hop (a flick, not a full unfold)
      ps.wings(hop ? 30 * flight : 0, hop ? 0.38 * flight : 0, hop ? -16 * flight : 0),
      ps.segments((i) => 5 * Math.sin(TAU * (u - i * 0.13))),
      ps.jaw(o.charge ? 0.25 : 0),
    );
    keys.push([f, body, 'linear']);
  }
  keys.push([F, keys[0]![1], 'linear']);
  const template: ClipDef = { name: o.name, frames: F, loop: true, keys, speed: round(speed), grounded: beta >= 0.5 && !hop, fast: o.run || sk.legs.length > 4 };
  const feet: FeetFn = (leg, f) => {
    const v = wrap(f / F - (gait.phase[leg.id] ?? 0));
    if (v < beta) return new Vector3(leg.rest[0], 0, leg.rest[2] + S / 2 - (S * v) / beta);
    const s = (v - beta) / (1 - beta);
    const arc = Math.sin(Math.PI * s);
    return new Vector3(leg.rest[0], lift * arc + hop * arc * 0.9, leg.rest[2] - S / 2 + S * smooth(s));
  };
  return bake(ctx, template, { kind: 'move', feet, step: 1 });
}

function slither(ctx: BakeContext, o: MoveOptions): MonsterClipDef {
  const sk = ctx.skeleton;
  const ps = new Poser(sk);
  const segs = sk.roles.segments;
  const segLen = Math.abs(sk.joints.find((j) => j.name === segs[0])?.pos[2] ?? 0.3);
  const F = o.run ? 24 : 40;
  const lambda = segLen * 6;
  const speed = lambda / (F / 30) * (o.charge ? 1.2 : 1);
  const A = segLen * 0.55;
  const heading = (z: number, t: number) => (Math.atan((A * TAU) / lambda * Math.cos(TAU * (z / lambda + t))) * 180) / Math.PI;
  const keys: Key[] = [];
  for (let f = 0; f < F; f++) {
    const t = f / F;
    const yaws = [0, ...segs.map((_, i) => -(i + 1) * segLen)].map((z) => heading(z, t));
    const x0 = A * Math.sin(TAU * t);
    keys.push([
      f,
      P(
        ps.root([x0, 0, 0], [0, yaws[0]!, 0]),
        ps.segments((i) => yaws[i + 1]! - yaws[i]!),
        ps.neck(o.charge ? 30 : 0, -yaws[0]! * 0.8),
        ps.head(o.charge ? -10 : 2 * Math.sin(TAU * t * 2), -yaws[0]! * 0.2),
        ps.wings(10 * Math.sin(TAU * t * 2), 0.25),
        ps.jaw(o.charge ? 0.3 : 0),
      ),
      'linear',
    ]);
  }
  keys.push([F, keys[0]![1], 'linear']);
  return bake(ctx, { name: o.name, frames: F, loop: true, keys, speed: round(speed), fast: o.run }, { kind: 'move' });
}

function float(ctx: BakeContext, o: MoveOptions): MonsterClipDef {
  const ps = new Poser(ctx.skeleton);
  const F = o.run ? 40 : 60;
  const speed = (o.run ? 3 : 1.5) * (o.charge ? 1.3 : 1);
  const keys: Key[] = [];
  const flaps = o.run ? 6 : 4;
  for (let f = 0; f < F; f++) {
    const u = f / F;
    keys.push([
      f,
      P(
        ps.root([0, 0.05 * Math.sin(TAU * u * 2), 0], [(o.run ? 18 : 10) + (o.charge ? 12 : 0), 0, 4 * Math.sin(TAU * u)]),
        ps.tentacles(o.run ? 30 : 18, (c, i) => 12 * Math.sin(TAU * (u * 2 - i * 0.2 - c * 0.13))),
        ps.wings(32 * Math.sin(TAU * u * flaps), 0.88, 18 * Math.sin(TAU * u * flaps - 0.8)),
        ps.tail(10, 14 * Math.sin(TAU * u * 2), 8 * Math.sin(TAU * u * 2 - 1)),
        ps.jaw(o.charge ? 0.4 : 0.05 + 0.05 * Math.sin(TAU * u * 2)),
      ),
      'linear',
    ]);
  }
  keys.push([F, keys[0]![1], 'linear']);
  return bake(ctx, { name: o.name, frames: F, loop: true, keys, speed }, { kind: 'move' });
}

function blobHop(ctx: BakeContext, gait: GaitDef, o: MoveOptions): MonsterClipDef {
  const sk = ctx.skeleton;
  const ps = new Poser(sk);
  const F = gait.frames;
  const T = F / 30;
  const beta = 0.45;
  const speed = (o.run ? 1.9 : 1.1) * (o.charge ? 1.2 : 1);
  const D = speed * T * beta; // ground covered while the base is down
  const hop = gait.hop ?? 0.3;
  const mass = sk.roles.mass ? sk.joints.find((j) => j.name === sk.roles.mass)! : null;
  const half = mass ? mass.pos[1] : 0.3;
  const keys: Key[] = [];
  for (let f = 0; f < F; f++) {
    const u = f / F;
    let z: number;
    let y = 0;
    let sq: number;
    if (u < beta) {
      const g = u / beta;
      z = D / 2 - D * g;
      sq = 0.3 * Math.sin(Math.PI * g);
    } else {
      const s = (u - beta) / (1 - beta);
      z = -D / 2 + D * smooth(s);
      y = hop * Math.sin(Math.PI * s);
      sq = -0.16 * Math.sin(Math.PI * s);
    }
    keys.push([f, P(ps.root([0, y, z]), ps.mass(sq, [0, -sq * half, 0]), ps.jaw(u < beta ? 0 : 0.3)), 'linear']);
  }
  keys.push([F, keys[0]![1], 'linear']);
  return bake(ctx, { name: o.name, frames: F, loop: true, keys, speed }, { kind: 'move' });
}

const round = (v: number) => Math.round(v * 1000) / 1000;
