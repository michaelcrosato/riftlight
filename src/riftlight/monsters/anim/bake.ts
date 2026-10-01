import { type Box3, Vector3 } from 'three/webgpu';
import { REST_JOINT, sampleClip, type ClipDef, type JointPose, type Key } from '../../../engine/animation';
import type { LegDef, MonsterClipDef, Skeleton } from '../types';
import { Kinematics, solveLeg, type PoseMap } from './ik';

/**
 * Bake a body-only template into a monster clip: sample the template (keys, eases,
 * layers — engine `sampleClip`) on top of the plan's stance, plant or place every foot
 * with the N-leg IK, then keep everything above the floor (the root lifts if any mesh
 * would dip below it). The result is a plain `ClipDef` with a key per step, ready for
 * `compileClip` and checkable with `analyzeClip`, like the hero's `gaitClip` output.
 */
export interface FeetFn {
  /** Sole target (model space) for a leg at frame f, or null to leave the keyed angles. */
  (leg: LegDef, f: number, pose: PoseMap): Vector3 | null;
}

export interface BakeOptions {
  kind: MonsterClipDef['kind'];
  feet?: FeetFn;
  hit?: number;
  windup?: readonly [number, number];
  /** Key spacing in frames (default 1; IK is solved per key). */
  step?: number;
  /** Clearance kept between body meshes and the floor (m). */
  clearance?: number;
}

export interface BakeContext {
  readonly skeleton: Skeleton;
  readonly kin: Kinematics;
  /** Joint-space boxes of non-sole meshes and of soles (floor clamp). */
  readonly bounds: ReadonlyMap<string, Box3>;
  readonly soles: ReadonlyMap<string, Box3>;
}

export function bake(ctx: BakeContext, template: ClipDef, options: BakeOptions): MonsterClipDef {
  const step = options.step ?? 1;
  const keys: Key[] = [];
  const clearance = options.clearance ?? 0.008;
  const last = template.loop ? template.frames - 1e-9 : template.frames + 1e-9;
  for (let f = 0; f < last; f += step) keys.push([round(f), toPose(poseAt(ctx, template, f, options.feet, clearance)), 'linear']);
  if (template.loop) keys.push([template.frames, keys[0]![1], 'linear']);
  else if (keys[keys.length - 1]![0] !== template.frames) keys.push([template.frames, toPose(poseAt(ctx, template, template.frames, options.feet, clearance)), 'linear']);
  return {
    name: template.name,
    frames: template.frames,
    loop: template.loop,
    keys,
    speed: template.speed,
    grounded: template.grounded,
    fast: template.fast,
    notes: template.notes,
    kind: options.kind,
    ...(options.hit !== undefined ? { hit: options.hit } : {}),
    ...(options.windup ? { windup: options.windup } : {}),
  };
}

/** The fully solved pose of a template at frame f. */
export function poseAt(ctx: BakeContext, template: ClipDef, f: number, feet: FeetFn | undefined, clearance = 0.008): PoseMap {
  const { skeleton, kin } = ctx;
  const pose = sampleClip(template, f, kin.names) as PoseMap;
  for (const [joint, r] of Object.entries(skeleton.stance)) {
    const j = pose[joint] ?? REST_JOINT;
    pose[joint] = { r: [j.r[0] + r[0], j.r[1] + r[1], j.r[2] + r[2]], p: j.p, s: j.s };
  }
  solveFeet(ctx, pose, f, feet);
  // Floor clamp: lift the root until no mesh is below the floor (soles may touch it).
  for (let pass = 0; pass < 6; pass++) {
    kin.begin(pose);
    const body = kin.lowest(ctx.bounds);
    const soles = ctx.soles.size ? kin.lowest(ctx.soles) : Infinity;
    const scale = Math.min(1, pose[skeleton.roles.root]?.s[1] ?? 1);
    const lift = Math.max(clearance * scale - body, -0.002 * scale - soles, 0);
    if (lift < 1e-4) break;
    const root = pose[skeleton.roles.root] ?? REST_JOINT;
    pose[skeleton.roles.root] = { r: root.r, p: [root.p[0], root.p[1] + lift + 1e-4, root.p[2]], s: root.s };
    solveFeet(ctx, pose, f, feet);
  }
  return pose;
}

function solveFeet(ctx: BakeContext, pose: PoseMap, f: number, feet: FeetFn | undefined): void {
  if (!feet || !ctx.skeleton.legs.length) return;
  ctx.kin.begin(pose);
  for (const leg of ctx.skeleton.legs) {
    const t = feet(leg, f, pose);
    if (t) solveLeg(ctx.kin, leg, t, pose);
  }
}

/** The solved pose as a key pose (fresh objects per frame, so no copy is needed). */
function toPose(pose: PoseMap): Record<string, JointPose> {
  return pose;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Feet planted where the plan stands them (scaled with the root for grow-in spawns). */
export function planted(scale: (f: number) => number = () => 1): FeetFn {
  return (leg, f) => {
    const s = scale(f);
    return new Vector3(leg.rest[0] * s, 0, leg.rest[2] * s);
  };
}

