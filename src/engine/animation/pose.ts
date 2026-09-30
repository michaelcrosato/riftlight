import { applyEase } from './ease';
import { applyFeet } from './ik';
import { resolveJoint, type ResolvedJoint } from './joint';
import type { ClipDef, Ease, Euler, JointPose, Key, Pose, RigSpec, Vec3 } from './types';

export { applyEase } from './ease';
export { REST_JOINT, resolveJoint, type ResolvedJoint } from './joint';

/** Mirror a pose left ↔ right (rig.mirror pairs; Y/Z rotations and X offsets flip). */
export function mirror(pose: Pose, rig: Pick<RigSpec, 'mirror'>): Pose {
  const out: Record<string, JointPose> = {};
  for (const [name, v] of Object.entries(pose)) {
    const j = resolveJoint(v);
    const target = rig.mirror[name] ?? name;
    out[target] = { r: [j.r[0], -j.r[1], -j.r[2]], p: [-j.p[0], j.p[1], j.p[2]], s: j.s };
  }
  return out;
}

/** A whole clip mirrored left ↔ right (e.g. ShimmyLeft from ShimmyRight). */
export function mirrorClip(clip: ClipDef, name: string, rig: Pick<RigSpec, 'mirror'>): ClipDef {
  return {
    ...clip,
    name,
    keys: clip.keys.map(([f, pose, ease]) => (ease ? [f, mirror(pose, rig), ease] : [f, mirror(pose, rig)]) as Key),
    layers: clip.layers?.map((l) => ({
      ...l,
      joint: rig.mirror[l.joint] ?? l.joint,
      amplitude: l.channel === 'ry' || l.channel === 'rz' || l.channel === 'px' ? -l.amplitude : l.amplitude,
    })),
  };
}

/** Linear blend of two poses (0 = a, 1 = b). */
export function blend(a: Pose, b: Pose, t: number): Pose {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, JointPose> = {};
  for (const n of names) {
    const ja = resolveJoint(a[n]);
    const jb = resolveJoint(b[n]);
    out[n] = { r: lerp3(ja.r, jb.r, t), p: lerp3(ja.p, jb.p, t), s: lerp3(ja.s, jb.s, t) };
  }
  return out;
}

/** Add rotation offsets (degrees) on top of a pose — handy for variations. */
export function offset(pose: Pose, deltas: Pose): Pose {
  const out: Record<string, JointPose> = {};
  const names = new Set([...Object.keys(pose), ...Object.keys(deltas)]);
  for (const n of names) {
    const a = resolveJoint(pose[n]);
    const d = resolveJoint(deltas[n]);
    out[n] = {
      r: [a.r[0] + d.r[0], a.r[1] + d.r[1], a.r[2] + d.r[2]],
      p: [a.p[0] + d.p[0], a.p[1] + d.p[1], a.p[2] + d.p[2]],
      s: [a.s[0] * d.s[0], a.s[1] * d.s[1], a.s[2] * d.s[2]],
    };
  }
  return out;
}

export interface GaitPoses {
  /** Leading RIGHT foot touches down (heel strike). */
  contact: Pose;
  /** Weight drops onto the right foot. */
  down: Pose;
  /** Left leg passes the right. */
  passing: Pose;
  /** Push off, body at its highest. */
  up: Pose;
}

/**
 * Classic 8-key locomotion cycle (Richard Williams): contact → down → passing → up on the
 * right foot, then the mirrored four on the left, looping back to contact.
 */
export function gaitKeys(frames: number, poses: GaitPoses, rig: Pick<RigSpec, 'mirror'>, ease: Ease = 'linear'): Key[] {
  const q = frames / 8;
  const seq = [poses.contact, poses.down, poses.passing, poses.up];
  const keys: Key[] = [];
  seq.forEach((p, i) => keys.push([i * q, p, ease]));
  seq.forEach((p, i) => keys.push([(i + 4) * q, mirror(p, rig), ease]));
  keys.push([frames, poses.contact, ease]);
  return keys;
}

/**
 * Evaluate a clip's pose at `frame` (keys + layers + feet track), fully resolved for every
 * joint of `rig` (or the listed joints — then the feet track needs a rig and is skipped).
 */
export function sampleClip(clip: ClipDef, frame: number, rig: RigSpec | readonly string[]): Record<string, ResolvedJoint> {
  const joints = isRig(rig) ? rig.joints : rig;
  const keys = clip.keys;
  const f = clip.loop ? ((frame % clip.frames) + clip.frames) % clip.frames : Math.min(Math.max(frame, 0), clip.frames);
  const [k0, k1, t] = bracket(keys, f);
  const out: Record<string, ResolvedJoint> = {};
  for (const j of joints) {
    const a = resolveJoint(k0[1][j]);
    const b = resolveJoint(k1[1][j]);
    out[j] = { r: lerp3(a.r, b.r, t), p: lerp3(a.p, b.p, t), s: lerp3(a.s, b.s, t) };
  }
  for (const l of clip.layers ?? []) {
    const j = out[l.joint];
    if (!j) continue;
    const v = l.amplitude * Math.sin(2 * Math.PI * (f / l.period + (l.phase ?? 0)));
    const r = [...j.r] as Euler;
    const p = [...j.p] as Vec3;
    let s = j.s;
    if (l.channel === 'rx') r[0] += v;
    else if (l.channel === 'ry') r[1] += v;
    else if (l.channel === 'rz') r[2] += v;
    else if (l.channel === 'px') p[0] += v;
    else if (l.channel === 'py') p[1] += v;
    else if (l.channel === 'pz') p[2] += v;
    else s = [s[0] + v, s[1] + v, s[2] + v];
    out[l.joint] = { r, p, s };
  }
  if (clip.feet?.length && isRig(rig)) applyFeet(clip.feet, f, out, rig);
  return out;
}

function isRig(r: RigSpec | readonly string[]): r is RigSpec {
  return !Array.isArray(r);
}

/** The keys around frame `f` and the eased 0..1 position between them. */
export function bracket<T extends readonly [number, unknown, Ease?]>(keys: readonly T[], f: number): [T, T, number] {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]![0] <= f) i++;
  const k0 = keys[i]!;
  const k1 = keys[Math.min(i + 1, keys.length - 1)]!;
  const span = k1[0] - k0[0];
  const u = span > 0 ? Math.min(Math.max((f - k0[0]) / span, 0), 1) : 0;
  return [k0, k1, applyEase(k0[2] ?? 'inOut', u)];
}

function lerp3<T extends number[]>(a: T, b: T, t: number): T {
  return a.map((v, i) => v + (b[i]! - v) * t) as T;
}

/** Problems with a clip definition itself (unknown joints, bad key order, loop mismatch). */
export function validateClip(clip: ClipDef, rig: RigSpec): string[] {
  const errors: string[] = [];
  if (!(clip.frames > 0)) errors.push(`${clip.name}: frames must be > 0`);
  if (clip.keys.length === 0) errors.push(`${clip.name}: no keys`);
  let prev = -Infinity;
  for (const [f, pose] of clip.keys) {
    if (f < prev) errors.push(`${clip.name}: key at frame ${f} is out of order`);
    if (f < 0 || f > clip.frames) errors.push(`${clip.name}: key at frame ${f} outside 0..${clip.frames}`);
    prev = f;
    for (const j of Object.keys(pose)) if (!rig.joints.includes(j)) errors.push(`${clip.name}: unknown joint "${j}" at frame ${f}`);
  }
  if (clip.feet?.length) {
    if (!rig.legs) errors.push(`${clip.name}: feet track needs a rig with legs`);
    let pf = -Infinity;
    for (const [f] of clip.feet) {
      if (f < pf) errors.push(`${clip.name}: feet key at frame ${f} is out of order`);
      pf = f;
    }
    if (clip.feet[0]![0] !== 0) errors.push(`${clip.name}: first feet key must be at frame 0`);
  }
  if (clip.keys.length && clip.keys[0]![0] !== 0) errors.push(`${clip.name}: first key must be at frame 0`);
  for (const l of clip.layers ?? []) {
    if (!rig.joints.includes(l.joint)) errors.push(`${clip.name}: layer on unknown joint "${l.joint}"`);
    if (clip.loop && clip.frames % l.period !== 0) errors.push(`${clip.name}: layer period ${l.period} does not divide loop length ${clip.frames}`);
  }
  return errors;
}
