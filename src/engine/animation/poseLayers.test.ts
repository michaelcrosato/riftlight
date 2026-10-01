import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Euler, type Object3D } from 'three/webgpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { HERO_RIG } from '../../game/hero/rig';
import { PoseLayers } from './poseLayers';

const DT = 1 / 60;
const DEG = 180 / Math.PI;
const STILL = { lean: { roll: 0, pitch: 0 }, look: 0, impact: 0 };

let template: Object3D;
beforeAll(async () => {
  const buf = readFileSync(new URL('../../../public/assets/hero.glb', import.meta.url));
  template = (await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene;
});

describe('springy cap', () => {
  it('the hero wears its hat on a Cap joint under the head', () => {
    const cap = template.getObjectByName(HERO_RIG.spine!.cap!);
    expect(cap?.parent?.name).toBe(HERO_RIG.spine!.head);
    expect(cap?.getObjectByName('Hat')).toBeTruthy();
    expect(cap?.getObjectByName('Brim')).toBeTruthy();
    // not animated by clips
    expect(HERO_RIG.joints).not.toContain('Cap');
  });

  it('lags behind when the head speeds up, then settles', () => {
    const model = template.clone(true);
    const layers = new PoseLayers(model, HERO_RIG);
    const cap = model.getObjectByName('Cap')!;
    const pitch = () => new Euler().setFromQuaternion(cap.quaternion, 'XYZ').x * DEG;
    let v = 0;
    for (let i = 0; i < 30; i++) layers.apply(DT, STILL);
    expect(Math.abs(pitch())).toBeLessThan(1e-6);
    // speeding forward at 12 m/s² for a quarter second: the cap tips back
    let most = 0;
    for (let i = 0; i < 15; i++) {
      v += 12 * DT;
      model.position.z += v * DT;
      layers.apply(DT, STILL);
      most = Math.min(most, pitch());
    }
    expect(most).toBeLessThan(-1.5);
    expect(most).toBeGreaterThanOrEqual(-layers.tuning.capMax);
    // then steady: it springs back to rest
    for (let i = 0; i < 90; i++) {
      model.position.z += v * DT;
      layers.apply(DT, STILL);
    }
    expect(Math.abs(pitch())).toBeLessThan(0.05);
  });
});
