import { describe, expect, it } from 'vitest';
import { BoxGeometry, DataTexture, Group, Mesh, MeshBasicMaterial, Scene } from 'three/webgpu';
import { DEFAULT_DEBUG_KEYS, resolveDebugKeys } from './debugKeys';
import { clearScene, countObjects, disposeObject } from './lifecycle';
import { toonMaterial } from './render/toon';

function disposals(target: { addEventListener(type: 'dispose', fn: () => void): void }): { n: number } {
  const c = { n: 0 };
  target.addEventListener('dispose', () => c.n++);
  return c;
}

describe('level lifecycle helpers', () => {
  it('disposes geometry, materials and textures, but never shared ones', () => {
    const geo = new BoxGeometry();
    const sharedGeo = new BoxGeometry();
    sharedGeo.userData.shared = true;
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    const own = new MeshBasicMaterial({ map });
    const toon = toonMaterial(0x38b764);
    const root = new Group().add(new Mesh(geo, own), new Mesh(sharedGeo, toon), new Mesh(geo, own));
    const [g, sg, m, t, tm] = [disposals(geo), disposals(sharedGeo), disposals(own), disposals(map), disposals(toon)];
    disposeObject(root);
    expect([g.n, sg.n, m.n, t.n, tm.n]).toEqual([1, 0, 1, 1, 0]);
  });

  it('clearScene keeps engine-owned objects', () => {
    const scene = new Scene();
    const light = new Group();
    light.userData.engineOwned = true;
    scene.add(light, new Mesh(new BoxGeometry(), new MeshBasicMaterial()), new Group().add(new Group()));
    expect(countObjects(scene)).toBe(5);
    expect(clearScene(scene)).toBe(2);
    expect(scene.children).toEqual([light]);
  });
});

describe('debug keys', () => {
  it('defaults, overrides, disables one or all', () => {
    expect(resolveDebugKeys()).toEqual(DEFAULT_DEBUG_KEYS);
    const k = resolveDebugKeys({ resolution: 'F2', mute: null, debug: ['Backquote', 'F1'] });
    expect(k.resolution).toEqual(['F2']);
    expect(k.mute).toEqual([]);
    expect(k.debug).toEqual(['Backquote', 'F1']);
    expect(k.mode).toEqual(['KeyP']);
    expect(Object.values(resolveDebugKeys(false)).every((v) => v.length === 0)).toBe(true);
  });
});
