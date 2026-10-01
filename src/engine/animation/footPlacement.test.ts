import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Euler, type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { HERO_CLIPS } from '../../game/hero/animations';
import { HERO_RIG } from '../../game/hero/rig';
import { FootPlacement, type GroundHit } from './footPlacement';
import { sampleClip } from './pose';

const DT = 1 / 60;
const RAD = Math.PI / 180;

let template: Object3D;
beforeAll(async () => {
  const buf = readFileSync(new URL('../../../public/assets/hero.glb', import.meta.url));
  template = (await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene;
});

/** A fresh hero in the pose of `clip` at `frame` (what the mixer would have written). */
function hero(): { model: Object3D; rest: Map<string, Quaternion>; pose: (clip: string, frame: number) => void } {
  const model = template.clone(true);
  const rest = new Map<string, Quaternion>();
  const restPos = new Map<string, Vector3>();
  for (const j of HERO_RIG.joints) {
    const o = model.getObjectByName(j)!;
    rest.set(j, o.quaternion.clone());
    restPos.set(j, o.position.clone());
  }
  const pose = (name: string, frame: number) => {
    const def = HERO_CLIPS.find((c) => c.name === name)!;
    const p = sampleClip(def, frame, HERO_RIG);
    for (const j of HERO_RIG.joints) {
      const o = model.getObjectByName(j)!;
      const r = p[j]!;
      o.quaternion.copy(rest.get(j)!).multiply(new Quaternion().setFromEuler(new Euler(r.r[0] * RAD, r.r[1] * RAD, r.r[2] * RAD, 'XYZ')));
      o.position.copy(restPos.get(j)!).add(new Vector3(...r.p));
      o.scale.set(...r.s);
    }
  };
  return { model, rest, pose };
}

/** Ground: a height function of (x, z), flat normals except where `normal` says. */
function ground(height: (x: number, z: number) => number, normal?: (x: number, z: number) => [number, number, number]) {
  return (x: number, y: number, z: number, maxDown: number, out: GroundHit) => {
    const h = height(x, z);
    if (y - h < 0 || y - h > maxDown) return false;
    const n = normal?.(x, z) ?? [0, 1, 0];
    out.y = h;
    [out.nx, out.ny, out.nz] = n;
    out.id = 1;
    return true;
  };
}

function soles(model: Object3D): { y: number; x: number; z: number }[] {
  model.updateMatrixWorld(true);
  return ['ShoeR', 'ShoeL'].map((n) => {
    const shoe = model.getObjectByName(n)! as Object3D & { geometry: { getAttribute(a: string): { count: number } } };
    const pos = shoe.geometry.getAttribute('position') as unknown as { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number };
    let y = Infinity;
    let x = 0;
    let z = 0;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(shoe.matrixWorld);
      y = Math.min(y, v.y);
      x += v.x / pos.count;
      z += v.z / pos.count;
    }
    return { y, x, z };
  });
}

describe('FootPlacement', () => {
  it('does nothing on flat ground at the feet (fades in without moving a joint)', () => {
    const { model, rest, pose } = hero();
    const fp = new FootPlacement(model, HERO_RIG, ground(() => 0));
    fp.setRest(rest);
    pose('Idle', 0);
    const before = soles(model);
    const q = model.getObjectByName('ShinR')!.quaternion.clone();
    for (let i = 0; i < 10; i++) {
      pose('Idle', 0);
      fp.apply(DT, { ik: true, lock: true });
    }
    const after = soles(model);
    for (const k of [0, 1]) expect(Math.abs(after[k]!.y - before[k]!.y)).toBeLessThan(0.002);
    expect(model.getObjectByName('ShinR')!.quaternion.angleTo(q)).toBeLessThan(0.01);
  });

  it('stands on a step: one foot up on it, the other down, the pelvis lowered', () => {
    const { model, rest, pose } = hero();
    // the character's feet (the capsule) rest on the step edge at y = 0.28; ahead (z > 0.06)
    // is the step, behind is the floor 0.28 lower
    model.position.set(0, 0.28, 0);
    const fp = new FootPlacement(model, HERO_RIG, ground((_x, z) => (z > 0.06 ? 0.28 : 0)));
    fp.setRest(rest);
    for (let i = 0; i < 40; i++) {
      pose('Walk', 0); // right foot ahead (heel strike), left behind
      fp.apply(DT, { ik: true, lock: false });
    }
    const [r, l] = soles(model);
    expect(Math.abs(r!.y - 0.28)).toBeLessThan(0.02); // right foot on the step
    expect(Math.abs(l!.y - 0)).toBeLessThan(0.03); // left foot down on the floor
    expect(fp.state().drop).toBeLessThan(-0.15);
  });

  it('never leaves a foot inside the ground, and pitches a planted foot to a slope', () => {
    const { model, rest, pose } = hero();
    const slope = 20 * RAD;
    const h = (_x: number, z: number) => Math.tan(slope) * z;
    const n: [number, number, number] = [0, Math.cos(slope), -Math.sin(slope)];
    const fp = new FootPlacement(model, HERO_RIG, ground(h, () => n));
    fp.setRest(rest);
    for (let i = 0; i < 60; i++) {
      pose('Idle', 0);
      fp.apply(DT, { ik: true, lock: false });
    }
    const st = fp.state();
    for (const f of st.feet) expect(f.pitch).toBeLessThan(-15); // toes up the slope
    model.updateMatrixWorld(true);
    for (const name of ['ShoeR', 'ShoeL']) {
      const shoe = model.getObjectByName(name)! as Object3D & { geometry: { getAttribute(a: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
      const pos = shoe.geometry.getAttribute('position');
      const v = new Vector3();
      let deepest = Infinity;
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(shoe.matrixWorld);
        deepest = Math.min(deepest, v.y - h(v.x, v.z));
      }
      expect(deepest).toBeGreaterThan(-0.025);
      expect(deepest).toBeLessThan(0.04);
    }
  });

  it('keeps a planted foot where it landed while the body moves on, then re-plants with a step', () => {
    const { model, rest, pose } = hero();
    const fp = new FootPlacement(model, HERO_RIG, ground(() => 0));
    fp.setRest(rest);
    // crouched (knees bent, so the legs can reach): a straight standing leg re-plants as soon
    // as it would have to stretch
    for (let i = 0; i < 10; i++) {
      pose('Crouch', 0);
      fp.apply(DT, { ik: true, lock: true }); // faded in, feet locked
    }
    const start = soles(model);
    // the body slides forward at 0.6 m/s with the feet still posed as before: a sliding blend
    let held = 0;
    let stepped = false;
    let worst = 0;
    for (let i = 1; i <= 30; i++) {
      model.position.z = 0.01 * i;
      pose('Crouch', 0);
      fp.apply(DT, { ik: true, lock: true });
      const now = soles(model);
      if (fp.state().feet.some((f) => f.stepping)) stepped = true;
      if (!stepped) {
        held = i;
        for (const k of [0, 1]) worst = Math.max(worst, Math.hypot(now[k]!.x - start[k]!.x, now[k]!.z - start[k]!.z));
      }
    }
    expect(held).toBeGreaterThan(8); // stayed put for a while (≥ 8 cm of drift)
    expect(worst).toBeLessThan(0.012); // ... within a centimetre
    expect(stepped).toBe(true); // then stepped to catch up
  });
});
