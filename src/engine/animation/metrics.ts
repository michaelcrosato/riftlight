import { AnimationMixer, Box3, type AnimationClip, type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { sampleClip } from './pose';
import type { ClipDef, RigSpec } from './types';

/**
 * Objective checks for a clip, computed by actually posing the rig (no renderer). These
 * are the numbers an agent can't eyeball: foot sliding, ground contact, loop seams,
 * velocity spikes, joint limits. Thresholds are deliberately forgiving; `problems` are
 * real defects, `warnings` are worth a look.
 */
export interface ClipReport {
  name: string;
  frames: number;
  loop: boolean;
  speed: number | null;
  /** Lowest sole point over the clip (m) and the frame it happens. Negative = through the floor. */
  minSoleY: number;
  minSoleFrame: number;
  /** Lowest point of any other body part (knees, hands, head...), where and when. */
  minBodyY: number;
  minBodyMesh: string;
  minBodyFrame: number;
  /** Frames (of grounded clips) where neither sole is within 5 cm of the floor. */
  floatingFrames: number;
  /** Mean horizontal slip of the planted foot, m/s (0 = perfectly planted). */
  footSlide: number;
  /** Largest joint-angle jump between the last and first frame of a loop, degrees. */
  loopSeam: number;
  /** Fastest joint rotation, degrees per second, and where. */
  maxAngularSpeed: { joint: string; degPerSec: number; frame: number };
  limitViolations: { joint: string; axis: 'x' | 'y' | 'z'; frame: number; value: number; range: [number, number] }[];
  /** Pelvis height range (m) — how much the body bobs. */
  pelvisY: [number, number];
  problems: string[];
  warnings: string[];
}

export interface SampledFrame {
  frame: number;
  joints: Record<string, Vector3>;
  /**
   * Lowest world y of each sole mesh, its centre, its contact point (the average of its
   * lowest vertices — the heel or toe edge while the foot rolls) and all its vertices.
   */
  soles: Record<string, { minY: number; centre: Vector3; contact: Vector3; verts: Vector3[] }>;
  /** Centres of trace points (meshes or joints). */
  trace: Record<string, Vector3>;
  /** Lowest non-sole mesh this frame. */
  body: { minY: number; mesh: string };
}

/** Pose `model` with `clip` at each frame (30 fps authoring frames) and record world positions. */
export function sampleFrames(model: Object3D, rig: RigSpec, clip: AnimationClip, frames: readonly number[]): SampledFrame[] {
  const mixer = new AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const out: SampledFrame[] = [];
  const box = new Box3();
  const bodyMeshes: Mesh[] = [];
  model.traverse((o) => {
    if ((o as Mesh).isMesh && !rig.soles.includes(o.name)) bodyMeshes.push(o as Mesh);
  });
  for (const f of frames) {
    mixer.setTime(Math.min(f / rig.fps, clip.duration - 1e-6));
    model.updateMatrixWorld(true);
    const joints: Record<string, Vector3> = {};
    for (const j of rig.joints) joints[j] = model.getObjectByName(j)!.getWorldPosition(new Vector3());
    const soles: SampledFrame['soles'] = {};
    for (const s of rig.soles) {
      const mesh = model.getObjectByName(s) as Mesh;
      box.setFromObject(mesh, true);
      const verts = worldVerts(mesh);
      soles[s] = { minY: box.min.y, centre: box.getCenter(new Vector3()), contact: lowestPoint(verts, box.min.y), verts };
    }
    const trace: Record<string, Vector3> = {};
    for (const t of rig.trace) {
      const o = model.getObjectByName(t)!;
      if ((o as Mesh).isMesh) trace[t] = box.setFromObject(o, true).getCenter(new Vector3());
      else trace[t] = o.getWorldPosition(new Vector3());
    }
    const body = { minY: Infinity, mesh: '' };
    for (const m of bodyMeshes) {
      const y = box.setFromObject(m, true).min.y;
      if (y < body.minY) Object.assign(body, { minY: y, mesh: m.name });
    }
    out.push({ frame: f, joints, soles, trace, body });
  }
  action.stop();
  mixer.uncacheRoot(model);
  return out;
}

export function analyzeClip(model: Object3D, rig: RigSpec, def: ClipDef, clip: AnimationClip): ClipReport {
  const frames = Array.from({ length: Math.round(def.frames) + 1 }, (_, i) => i);
  const samples = sampleFrames(model, rig, clip, frames);
  const problems: string[] = [];
  const warnings: string[] = [];

  // Ground contact.
  let minSoleY = Infinity;
  let minSoleFrame = 0;
  let floatingFrames = 0;
  for (const s of samples) {
    const low = Math.min(...Object.values(s.soles).map((v) => v.minY));
    if (low < minSoleY) {
      minSoleY = low;
      minSoleFrame = s.frame;
    }
    if (def.grounded && low > 0.05) floatingFrames++;
  }
  if (minSoleY < -0.03) problems.push(`feet go ${(-minSoleY * 100).toFixed(0)} cm through the floor at f${minSoleFrame}`);
  let minBody = { y: Infinity, mesh: '', frame: 0 };
  for (const s of samples) if (s.body.minY < minBody.y) minBody = { y: s.body.minY, mesh: s.body.mesh, frame: s.frame };
  const bodyMsg = `${minBody.mesh} goes ${(-minBody.y * 100).toFixed(0)} cm through the floor at f${minBody.frame}`;
  if (minBody.y < -0.05) problems.push(bodyMsg);
  else if (minBody.y < -0.02) warnings.push(bodyMsg);
  if (def.grounded && floatingFrames > 0) warnings.push(`${floatingFrames} frame(s) with both feet off the ground (grounded clip)`);

  // Foot sliding: sole vertices touching the floor in consecutive frames should move
  // backwards at the clip's ground speed (i.e. stay put in the world).
  const speed = def.speed ?? 0;
  let slideSum = 0;
  let slideN = 0;
  for (let i = 1; i < samples.length; i++) {
    for (const sole of rig.soles) {
      const a = samples[i - 1]!.soles[sole]!.verts;
      const b = samples[i]!.soles[sole]!.verts;
      let dx = 0;
      let dz = 0;
      let n = 0;
      for (let k = 0; k < a.length; k++) {
        if (a[k]!.y > PLANTED || b[k]!.y > PLANTED) continue;
        dx += b[k]!.x - a[k]!.x;
        dz += b[k]!.z - a[k]!.z;
        n++;
      }
      if (!n) continue;
      slideSum += Math.hypot((dx / n) * rig.fps, (dz / n) * rig.fps + speed);
      slideN++;
    }
  }
  const footSlide = slideN ? slideSum / slideN : 0;
  if (def.grounded && footSlide > 0.6) problems.push(`planted foot slides ${footSlide.toFixed(2)} m/s`);
  else if (def.grounded && footSlide > 0.3) warnings.push(`planted foot slides ${footSlide.toFixed(2)} m/s`);
  // Clips with a feet track put feet on the floor somewhere; dragging them is worth a look.
  else if (!def.grounded && !def.fast && def.feet?.length && footSlide > 0.6) warnings.push(`feet drag along the floor at ${footSlide.toFixed(2)} m/s`);

  // Loop seam and angular speed, from the authored data.
  const poses = frames.map((f) => sampleClip(def, f, rig));
  let loopSeam = 0;
  if (def.loop) {
    const a = sampleClip(def, 0, rig);
    const b = sampleClip(def, def.frames - 1e-3, rig);
    let posSeam = 0;
    for (const j of rig.joints) {
      for (let k = 0; k < 3; k++) {
        loopSeam = Math.max(loopSeam, Math.abs(wrap(a[j]!.r[k]! - b[j]!.r[k]!)));
        posSeam = Math.max(posSeam, Math.abs(a[j]!.p[k]! - b[j]!.p[k]!), Math.abs(a[j]!.s[k]! - b[j]!.s[k]!));
      }
    }
    if (loopSeam > 3) problems.push(`loop seam: joints jump up to ${loopSeam.toFixed(0)}° between last and first frame`);
    if (posSeam > 0.01) problems.push(`loop seam: position/squash jumps by ${posSeam.toFixed(3)} between last and first frame`);
  }
  let maxAngularSpeed = { joint: '', degPerSec: 0, frame: 0 };
  for (let i = 1; i < poses.length; i++) {
    for (const j of rig.joints) {
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(wrap(poses[i]![j]!.r[k]! - poses[i - 1]![j]!.r[k]!)))) * rig.fps;
      if (d > maxAngularSpeed.degPerSec) maxAngularSpeed = { joint: j, degPerSec: d, frame: i };
    }
  }
  if (!def.fast && maxAngularSpeed.degPerSec > 1200) {
    warnings.push(`${maxAngularSpeed.joint} snaps at ${maxAngularSpeed.degPerSec.toFixed(0)}°/s around frame ${maxAngularSpeed.frame}`);
  }

  // Joint limits.
  const limitViolations: ClipReport['limitViolations'] = [];
  for (const [joint, lim] of Object.entries(rig.limits)) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const range = lim[axis];
      if (!range) continue;
      const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      let worst: { frame: number; value: number } | null = null;
      poses.forEach((p, f) => {
        const v = p[joint]?.r[k] ?? 0;
        if (v < range[0] - 0.5 || v > range[1] + 0.5) {
          if (!worst || Math.abs(v) > Math.abs(worst.value)) worst = { frame: f, value: v };
        }
      });
      if (worst) limitViolations.push({ joint, axis, range, ...(worst as { frame: number; value: number }) });
    }
  }
  for (const v of limitViolations) warnings.push(`${v.joint}.${v.axis} = ${v.value.toFixed(0)}° at f${v.frame} (range ${v.range[0]}..${v.range[1]})`);

  const pelvisYs = samples.map((s) => s.joints[rig.root]!.y);
  return {
    name: def.name,
    frames: def.frames,
    loop: !!def.loop,
    speed: def.speed ?? null,
    minSoleY,
    minSoleFrame,
    minBodyY: minBody.y,
    minBodyMesh: minBody.mesh,
    minBodyFrame: minBody.frame,
    floatingFrames,
    footSlide,
    loopSeam,
    maxAngularSpeed,
    limitViolations,
    pelvisY: [Math.min(...pelvisYs), Math.max(...pelvisYs)],
    problems,
    warnings,
  };
}

/** A sole within this height of the floor counts as planted (m). */
const PLANTED = 0.015;

function worldVerts(mesh: Mesh): Vector3[] {
  const pos = mesh.geometry.getAttribute('position');
  return Array.from({ length: pos.count }, (_, i) => new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
}

function lowestPoint(verts: Vector3[], minY: number): Vector3 {
  const low = verts.filter((p) => p.y < minY + 0.005);
  return low.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(Math.max(1, low.length));
}

function wrap(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
