import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type Object3D, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { COMBAT_TIMING, stringEngage } from '../../game/hero/clips/combat';
import { profileStep } from './Actor';
import { DASH_PROFILE, ROLL_PROFILE, normalizedProfile } from '../combat/deliveries/dash';
import { BOW, HeroWeapons, WEAPON_KINDS, weaponClassOf } from './weapons';

async function heroModel(): Promise<Object3D> {
  const buf = readFileSync(new URL('../../../public/assets/hero.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  return gltf.scene;
}

describe('hero weapons', () => {
  it('builds every class in the right fist (the bow in the left) and shows only the equipped one', async () => {
    const model = await heroModel();
    const w = new HeroWeapons(model);
    expect([...w.meshes.keys()].sort()).toEqual([...WEAPON_KINDS].sort());
    expect(model.getObjectByName('Sword')?.visible).toBe(true); // the starter sword
    for (const k of WEAPON_KINDS) {
      w.equip(k, false);
      for (const [other, mesh] of w.meshes) expect(mesh.visible, `${k}: ${other}`).toBe(other === k);
      expect(w.meshes.get(k)!.parent!.name).toBe(k === 'bow' ? 'HandL' : 'HandR');
    }
    w.equip('axe', true);
    expect(w.current.scale.x).toBeGreaterThan(1); // two-handers are drawn a size up
  });

  it('reads the class from the equipped item flags (no flag: the sword)', () => {
    const flags = (...f: string[]) => (flag: string) => f.includes(flag);
    expect(weaponClassOf(flags())).toBe('sword');
    expect(weaponClassOf(flags('weapon.bow', 'weapon.twohand'))).toBe('bow');
    expect(weaponClassOf(flags('weapon.staff'))).toBe('staff');
    expect(weaponClassOf(flags('weapon.sceptre'))).toBe('sceptre');
  });

  it('draws the bow string to the drawing hand only while engaged', async () => {
    const model = await heroModel();
    const w = new HeroWeapons(model);
    w.equip('bow', false);
    model.updateMatrixWorld(true);
    const bow = w.bow;
    // a hand 0.4 m behind the string (toward the archer)
    const hand = bow.group.localToWorld(new Vector3(0, BOW.brace + 0.4, 0));
    bow.setString(hand, 1);
    expect(bow.draw).toBeCloseTo(0.4, 2);
    bow.setString(hand, 0.5);
    expect(bow.draw).toBeCloseTo(0.2, 2);
    bow.setString(hand, 0);
    expect(bow.draw).toBe(0);
    // engaged over the clip's draw frames, let go at its hit
    const t = COMBAT_TIMING.BowDraw!;
    expect(stringEngage('BowDraw', t.draw![0] - 0.5)).toBe(0);
    expect(stringEngage('BowDraw', t.hit - 0.1)).toBe(1);
    expect(stringEngage('BowDraw', t.hit)).toBe(0);
    expect(stringEngage('Slash1', 4)).toBe(0);
  });
});

describe('root motion profiles', () => {
  it('average 1 (the distance is kept) and the steps add up exactly', () => {
    for (const p of [ROLL_PROFILE, DASH_PROFILE, normalizedProfile((u) => 1 + u)]) {
      let mean = 0;
      for (let i = 0; i < 1000; i++) mean += p((i + 0.5) / 1000) / 1000;
      expect(mean).toBeCloseTo(1, 3);
      // a 0.33 s motion in 1/60 s steps (the last one partly past the end)
      const total = 0.33;
      let dist = 0;
      for (let left = total; left > 0; left -= 1 / 60) dist += profileStep(p, total, left, 1 / 60) / 60;
      expect(dist).toBeCloseTo(total, 3);
    }
  });

  it('the roll stops as its feet come down (Roll frame 8.5 of 14) and creeps while the body rises', () => {
    expect(ROLL_PROFILE(0)).toBeGreaterThan(0.4); // off the mark at once
    expect(ROLL_PROFILE(0.3)).toBeGreaterThan(1.2); // full speed through the roll
    expect(ROLL_PROFILE(8.5 / 14)).toBeLessThan(0.15);
    expect(ROLL_PROFILE(0.9)).toBeLessThan(0.15);
  });
});
