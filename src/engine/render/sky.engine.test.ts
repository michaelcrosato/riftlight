import { describe, expect, it } from 'vitest';
import { AmbientLight, Color, DirectionalLight, Scene } from 'three/webgpu';
import { applySky, skyAt } from './sky';

describe('applySky', () => {
  it('never edits a background colour it did not make (it may be the engine default)', () => {
    const def = new Color(0x1a1c2c);
    const scene = new Scene();
    scene.background = def;
    const engine = { sun: new DirectionalLight(), ambient: new AmbientLight(), scene, setSunDirection: () => {} };
    applySky(engine, skyAt(12));
    expect(def.getHex()).toBe(0x1a1c2c);
    const mine = scene.background as Color;
    expect(mine).not.toBe(def);
    applySky(engine, skyAt(20));
    expect(scene.background).toBe(mine); // its own colour is reused, not reallocated
  });
});
