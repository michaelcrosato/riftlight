import { describe, expect, it } from 'vitest';
import { AnimationClip, AnimationMixer, Euler, LoopOnce, Object3D, Quaternion, QuaternionKeyframeTrack } from 'three/webgpu';
import { RotationBlend } from './rotationBlend';

// One joint, two clips, a cross-fade driven the way PlatformerCharacter drives it
// (setEffectiveWeight per frame), with and without RotationBlend on top of the mixer.

const DT = 1 / 60;

/** Clip rotating joint J about X through `degrees(t)`, sampled at 60 Hz. */
function clip(name: string, duration: number, degrees: (t: number) => number): AnimationClip {
  const n = Math.round(duration * 60) + 1;
  const times: number[] = [];
  const values: number[] = [];
  const q = new Quaternion();
  const prev = new Quaternion();
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * duration;
    q.setFromEuler(new Euler((degrees(t) * Math.PI) / 180, 0, 0));
    if (i && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); // continuous, like compileClip
    prev.copy(q);
    times.push(t);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new AnimationClip(name, duration, [new QuaternionKeyframeTrack('J.quaternion', times, values)]);
}

/** Play `a` for `lead` s, then cross-fade to `b` over `fade` s; largest per-frame turn (°) from the fade on. */
function crossFade(a: AnimationClip, b: AnimationClip, lead: number, fade: number, fix: boolean, aOnce = false): { maxStep: number; end: number } {
  const model = new Object3D();
  const joint = new Object3D();
  joint.name = 'J';
  model.add(joint);
  const mixer = new AnimationMixer(model);
  const A = mixer.clipAction(a);
  const B = mixer.clipAction(b);
  if (aOnce) {
    A.setLoop(LoopOnce, 1);
    A.clampWhenFinished = true;
  }
  const blend = fix ? new RotationBlend(model, [A, B]) : null;
  A.play();
  let maxStep = 0;
  const last = new Quaternion();
  const frames = Math.round((lead + fade + 0.3) / DT);
  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    if (t >= lead && !B.isScheduled()) B.play();
    const u = Math.min(1, Math.max(0, (t - lead) / fade));
    A.setEffectiveWeight(1 - u);
    B.setEffectiveWeight(u);
    mixer.update(f ? DT : 0);
    blend?.apply();
    if (t > lead) maxStep = Math.max(maxStep, (last.angleTo(joint.quaternion) * 180) / Math.PI);
    last.copy(joint.quaternion);
  }
  return { maxStep, end: (new Euler().setFromQuaternion(joint.quaternion).x * 180) / Math.PI };
}

describe('RotationBlend', () => {
  // Fall holds an arm overhead (−150°); Run swings it between 0° and 60° behind the body
  // (at most 7.9° a frame), so mid-fade the two poses drift across 180° apart (at 30°).
  const fall = clip('Fall', 1, () => -150);
  const run = clip('Run', 0.4, (t) => 30 + 30 * Math.sin((t / 0.4) * Math.PI * 2));

  it("three's shortest-arc blend flips the joint mid-fade (the bug)", () => {
    expect(crossFade(fall, run, 0.2, 0.4, false).maxStep).toBeGreaterThan(90);
  });

  it('a cross-fade never jumps, however far apart the poses', () => {
    for (const lead of [0.2, 0.25, 0.3, 0.35]) {
      for (const fade of [0.12, 0.25, 0.4]) {
        // smooth: at most the ≤ 230° between the poses spread over the fade, plus Run's own swing
        const smooth = (1.2 * 230) / (fade * 60) + 8;
        const { maxStep, end } = crossFade(fall, run, lead, fade, true);
        expect(maxStep).toBeLessThan(smooth);
        expect(end).toBeGreaterThan(-5); // and it ends on Run
        expect(crossFade(run, fall, lead, fade, true).maxStep).toBeLessThan(smooth);
      }
    }
  });

  it('a somersault that ended at 360° blends into the next clip without spinning', () => {
    const flip = clip('Flip', 0.5, (t) => (t / 0.5) * 360);
    const stand = clip('Stand', 1, () => 4);
    const { maxStep, end } = crossFade(flip, stand, 0.6, 0.25, true, true);
    expect(maxStep).toBeLessThan(2);
    expect(end).toBeCloseTo(4, 0);
  });

  it('a single clip is left exactly as three poses it', () => {
    const model = new Object3D();
    const joint = new Object3D();
    joint.name = 'J';
    model.add(joint);
    const mixer = new AnimationMixer(model);
    const A = mixer.clipAction(run);
    const blend = new RotationBlend(model, [A, mixer.clipAction(fall)]);
    A.play();
    for (let f = 0; f < 30; f++) {
      mixer.update(DT);
      const q = joint.quaternion.clone();
      blend.apply();
      expect(joint.quaternion.equals(q)).toBe(true);
    }
  });
});
