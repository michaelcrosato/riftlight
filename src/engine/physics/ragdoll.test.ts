import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { AnimationMixer, Euler, LoopOnce, Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { HERO_CLIPS, HERO_RIG } from '../../game/hero';
import { HERO_RAGDOLL } from '../../game/hero/ragdoll';
import { compileClips } from '../animation/compile';
import { sampleClip } from '../animation/pose';
import { Physics } from './Physics';
import { Ragdoll } from './ragdoll';

/** The real hero model (public/assets/hero.glb), a fresh copy each call. */
let template: Object3D | null = null;
async function heroModel(): Promise<Object3D> {
  if (!template) {
    const buf = readFileSync(new URL('../../../public/assets/hero.glb', import.meta.url));
    template = (await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene;
  }
  const m = template.clone(true);
  m.updateMatrixWorld(true);
  return m;
}

const DT = 1 / 60;

/** The hero's joints (scripts/assets/hero.mjs) as bare Object3Ds, standing at `at`. */
function heroJoints(at: [number, number, number] = [0, 0, 0]) {
  const root = new Object3D();
  root.position.set(...at);
  const j = (name: string, p: [number, number, number], parent: Object3D) => {
    const o = new Object3D();
    o.name = name;
    o.position.set(...p);
    parent.add(o);
    return o;
  };
  const pelvis = j('Pelvis', [0, 0.62, 0], root);
  const torso = j('Torso', [0, 0, 0], pelvis);
  j('Head', [0, 0.6, 0], torso);
  for (const [S, x] of [['R', -1], ['L', 1]] as const) {
    const arm = j(`Arm${S}`, [0.36 * x, 0.5, 0], torso);
    const fore = j(`Forearm${S}`, [0, -0.25, 0], arm);
    j(`Hand${S}`, [0, -0.16, 0], fore);
    const leg = j(`Leg${S}`, [0.14 * x, 0, 0], pelvis);
    const shin = j(`Shin${S}`, [0, -0.3, 0], leg);
    j(`Foot${S}`, [0, -0.22, 0], shin);
  }
  root.updateMatrixWorld(true);
  return root;
}

async function floor() {
  const p = await Physics.create();
  p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [20, 0.5, 20] });
  return p;
}

const run = (p: Physics, doll: Ragdoll, steps: number) => {
  for (let i = 0; i < steps; i++) {
    p.update(DT + 1e-9);
    doll.sync();
  }
};

describe('Ragdoll', () => {
  it('falls, comes to rest on the floor, and stays in one piece', async () => {
    const p = await floor();
    const root = heroJoints([0, 1, 0]);
    const doll = new Ragdoll(p, root, HERO_RAGDOLL);
    doll.enable({ velocity: [0, 0, 2] });
    expect(doll.bodies.length).toBe(11);
    run(p, doll, 360);
    expect(doll.speed()).toBeLessThan(0.3);
    const pelvis = root.getObjectByName('Pelvis')!.getWorldPosition(new Vector3());
    expect(pelvis.y).toBeGreaterThan(0.05);
    expect(pelvis.y).toBeLessThan(0.45); // lying down
    // every joint is still where its parent part holds it: bones drawn from the bodies agree
    for (const part of HERO_RAGDOLL) {
      if (!part.parent) continue;
      const bone = root.getObjectByName(part.bone)!;
      const body = doll.bodies[HERO_RAGDOLL.indexOf(part)]!.translation();
      expect(bone.getWorldPosition(new Vector3()).distanceTo(new Vector3(body.x, body.y, body.z)), part.bone).toBeLessThan(0.04);
    }
  });

  it('bends knees and elbows only the way they bend, within their limits', async () => {
    const p = await floor();
    const root = heroJoints([0, 1.5, 0]);
    const doll = new Ragdoll(p, root, HERO_RAGDOLL);
    doll.enable({ velocity: [3, 0, -2], spin: [4, 1, 2] });
    run(p, doll, 300);
    for (const name of ['ShinR', 'ShinL', 'ForearmR', 'ForearmL']) {
      const q = root.getObjectByName(name)!.quaternion;
      const e = new Euler().setFromQuaternion(q, 'XYZ');
      expect(Math.abs(e.y) + Math.abs(e.z), `${name} twists`).toBeLessThan(0.15);
      const deg = (e.x * 180) / Math.PI;
      if (name.startsWith('Shin')) expect(deg).toBeGreaterThan(-8);
      else expect(deg).toBeLessThan(8);
    }
  });

  it('holds ball joints inside their cones', async () => {
    const p = await floor();
    const root = heroJoints([0, 2, 0]);
    const doll = new Ragdoll(p, root, HERO_RAGDOLL);
    doll.enable({ spin: [0, 0, 9] });
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      p.update(DT + 1e-9);
      doll.sync();
      const leg = root.getObjectByName('LegR')!.quaternion;
      const down = new Vector3(0, -1, 0).applyQuaternion(leg);
      worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, -down.y))) * 180) / Math.PI);
    }
    expect(worst).toBeLessThan(80 + 3); // at most a hair past the 80° cone
  });

  it('a push knocks it over; release hands the pose back to the model root', async () => {
    const p = await floor();
    const root = heroJoints([0, 0, 0]);
    const doll = new Ragdoll(p, root, HERO_RAGDOLL);
    const before = p.counts();
    doll.enable();
    doll.push([0, 1.3, 0], [0, 0, -4]);
    run(p, doll, 300);
    const lying = doll.rootPose();
    const pelvisWorld = root.getObjectByName('Pelvis')!.getWorldPosition(new Vector3());
    const blend = doll.release({ ground: 0 });
    expect(doll.active).toBe(false);
    expect(p.counts().bodies).toBe(before.bodies);
    // the root moved under the pelvis, turned to get up, and nothing moved in the world
    expect(root.position.x).toBeCloseTo(lying.at.x, 5);
    expect(root.rotation.y).toBeCloseTo(lying.heading, 5);
    root.updateMatrixWorld(true);
    expect(root.getObjectByName('Pelvis')!.getWorldPosition(new Vector3()).distanceTo(pelvisWorld)).toBeLessThan(1e-4);
    // blending all the way to an animated pose lands exactly on it
    const pelvis = root.getObjectByName('Pelvis')!;
    pelvis.quaternion.copy(new Quaternion());
    pelvis.position.set(0, 0.62, 0);
    blend.apply(1);
    expect(pelvis.position.y).toBeCloseTo(0.62, 6);
    expect(pelvis.quaternion.w).toBeCloseTo(1, 6);
  });

  it('comes to rest from any standing pose, dropped with no push at all', async () => {
    const clips = compileClips(HERO_CLIPS, HERO_RIG, await heroModel());
    for (const phase of [0, 0.5, 1, 1.5]) {
      const p = await floor();
      const model = await heroModel();
      const mixer = new AnimationMixer(model);
      mixer.clipAction(clips.find((c) => c.name === 'Idle')!).play();
      mixer.update(phase);
      const doll = new Ragdoll(p, model, HERO_RAGDOLL);
      doll.enable();
      let restedAt = -1;
      const head = model.getObjectByName('Head')!;
      const last = new Vector3();
      let drift = 0;
      for (let i = 0; i < 300; i++) {
        p.update(DT + 1e-9);
        doll.sync();
        if (restedAt < 0 && i > 30 && doll.speed() < 0.3) restedAt = i;
        const at = head.getWorldPosition(new Vector3());
        if (i >= 270) drift = Math.max(drift, at.distanceTo(last));
        last.copy(at);
      }
      expect(restedAt, `Idle at ${phase} s`).toBeGreaterThan(0);
      expect(restedAt, `Idle at ${phase} s`).toBeLessThan(240); // still within 4 s
      expect(drift, `Idle at ${phase} s: the head keeps moving`).toBeLessThan(0.002);
    }
  });

  it('release blends into a clip and lands exactly on it, however the mixer writes', async () => {
    const clips = compileClips(HERO_CLIPS, HERO_RIG, await heroModel());
    const clip = (n: string) => clips.find((c) => c.name === n)!;
    for (const [push, name] of [[[0, 0, -4], 'GetUp'], [[0, 0, 4], 'GetUpFront']] as const) {
      const p = await floor();
      const model = await heroModel();
      const mixer = new AnimationMixer(model);
      const idle = mixer.clipAction(clip('Idle'));
      idle.play();
      mixer.update(0.5);
      const doll = new Ragdoll(p, model, HERO_RAGDOLL);
      doll.enable();
      doll.push([0, 1.3, 0], push);
      run(p, doll, 300);
      const def = HERO_CLIPS.find((c) => c.name === name)!;
      const p0 = sampleClip(def, 0, HERO_RIG).Pelvis!.p;
      const blend = doll.release({ ground: 0, offset: [p0[0], 0, p0[2]] });
      const action = mixer.clipAction(clip(name));
      action.setLoop(LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.play();
      idle.stop();
      // a second model playing only the clip, where the blended one must end up
      const ref = await heroModel();
      ref.position.copy(model.position);
      ref.rotation.copy(model.rotation);
      const refMixer = new AnimationMixer(ref);
      const refAction = refMixer.clipAction(clip(name));
      refAction.setLoop(LoopOnce, Infinity);
      refAction.clampWhenFinished = true;
      refAction.play();
      let worst = 0;
      for (let f = 1; f <= 60; f++) {
        mixer.update(DT);
        blend.apply((f * DT) / 0.35);
        refMixer.update(DT);
        if (f * DT > 0.36)
          for (const j of HERO_RIG.joints) {
            const a = model.getObjectByName(j)!.quaternion;
            const b = ref.getObjectByName(j)!.quaternion;
            worst = Math.max(worst, (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI);
          }
      }
      expect(worst, name).toBeLessThan(0.5); // degrees
      expect(model.getObjectByName('Pelvis')!.position.distanceTo(ref.getObjectByName('Pelvis')!.position), name).toBeLessThan(1e-4);
    }
  });

  it('is off once the world is cleared under it', async () => {
    const p = await floor();
    const doll = new Ragdoll(p, heroJoints([0, 1, 0]), HERO_RAGDOLL);
    doll.enable();
    p.clear();
    expect(doll.active).toBe(false);
    doll.enable(); // works again
    expect(doll.bodies.length).toBe(11);
  });

  it('refuses a part list in the wrong order before making anything', async () => {
    const p = await floor();
    const before = p.counts().bodies;
    expect(() => new Ragdoll(p, heroJoints(), [HERO_RAGDOLL[1]!, HERO_RAGDOLL[0]!])).toThrow(/not listed before/);
    expect(p.counts().bodies).toBe(before);
  });
});
