import { AnimationClip, Euler, type KeyframeTrack, MathUtils, type Object3D, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three/webgpu';
import { sampleClip } from './pose';
import type { ClipDef, RigSpec } from './types';

/** Samples per authored frame when baking (60 Hz playback detail from 30 fps authoring). */
const OVERSAMPLE = 2;

/** Rest transforms of a model's joints (from the GLB), used as the base for poses. */
export interface RestPose {
  position: Record<string, [number, number, number]>;
  quaternion: Record<string, Quaternion>;
  scale: Record<string, [number, number, number]>;
}

export function restPoseOf(model: Object3D, rig: RigSpec): RestPose {
  const rest: RestPose = { position: {}, quaternion: {}, scale: {} };
  for (const j of rig.joints) {
    const o = model.getObjectByName(j);
    if (!o) throw new Error(`rig joint "${j}" not found in model`);
    rest.position[j] = o.position.toArray() as [number, number, number];
    rest.quaternion[j] = o.quaternion.clone();
    rest.scale[j] = o.scale.toArray() as [number, number, number];
  }
  return rest;
}

/**
 * Bake a ClipDef into a three.js AnimationClip (quaternion + position + scale tracks,
 * sampled at 60 Hz so easing and per-axis Euler interpolation — including 360° flips —
 * survive exactly).
 */
export function compileClip(def: ClipDef, rig: RigSpec, rest: RestPose): AnimationClip {
  const n = Math.max(2, Math.round(def.frames * OVERSAMPLE) + 1);
  const times = new Float32Array(n);
  const rot: Record<string, Float32Array> = {};
  const pos: Record<string, Float32Array> = {};
  const scl: Record<string, Float32Array> = {};
  for (const j of rig.joints) {
    rot[j] = new Float32Array(n * 4);
    pos[j] = new Float32Array(n * 3);
    scl[j] = new Float32Array(n * 3);
  }
  const e = new Euler();
  const q = new Quaternion();
  const prev: Record<string, Quaternion> = {};
  for (let i = 0; i < n; i++) {
    const frame = (i / (n - 1)) * def.frames;
    times[i] = frame / rig.fps;
    const pose = sampleClip(def, frame, rig); // loops wrap: the last sample equals frame 0
    for (const j of rig.joints) {
      const p = pose[j]!;
      e.set(MathUtils.degToRad(p.r[0]), MathUtils.degToRad(p.r[1]), MathUtils.degToRad(p.r[2]), 'XYZ');
      q.setFromEuler(e).premultiply(rest.quaternion[j]!);
      // keep consecutive samples on the same hemisphere so slerp takes the short way
      const last = prev[j];
      if (last && last.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev[j] = (last ?? new Quaternion()).copy(q);
      rot[j]!.set([q.x, q.y, q.z, q.w], i * 4);
      const rp = rest.position[j]!;
      pos[j]!.set([rp[0] + p.p[0], rp[1] + p.p[1], rp[2] + p.p[2]], i * 3);
      const rs = rest.scale[j]!;
      scl[j]!.set([rs[0] * p.s[0], rs[1] * p.s[1], rs[2] * p.s[2]], i * 3);
    }
  }
  // Every clip drives every channel of every joint, so cross-fading never leaves a
  // channel stuck at another clip's value (e.g. squash & stretch).
  const tracks: KeyframeTrack[] = [];
  for (const j of rig.joints) {
    tracks.push(new QuaternionKeyframeTrack(`${j}.quaternion`, times, rot[j]!));
    tracks.push(new VectorKeyframeTrack(`${j}.position`, times, pos[j]!));
    tracks.push(new VectorKeyframeTrack(`${j}.scale`, times, scl[j]!));
  }
  const clip = new AnimationClip(def.name, def.frames / rig.fps, tracks);
  // Authored ground speed, so controllers can scale playback to the real speed.
  if (def.speed) clip.userData.speed = def.speed;
  if (def.stance) clip.userData.stance = def.stance;
  if (def.reach) clip.userData.reach = def.reach;
  return clip;
}

export function compileClips(defs: readonly ClipDef[], rig: RigSpec, model: Object3D): AnimationClip[] {
  const rest = restPoseOf(model, rig);
  return defs.map((d) => compileClip(d, rig, rest));
}
