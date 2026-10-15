import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, DataTexture, Group, Mesh, MeshBasicMaterial, MeshBasicNodeMaterial, Scene, Skeleton, SkinnedMesh } from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { DEFAULT_DEBUG_KEYS, hotkeyHelp, rebindDebugKeys, resolveDebugKeys, startingDebugKeys } from './debugKeys';
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

  it('disposes textures used only inside TSL node graphs, and skeletons', () => {
    const tex = new DataTexture(new Uint8Array(4), 1, 1);
    const shared = new DataTexture(new Uint8Array(4), 1, 1);
    shared.userData.shared = true;
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = texture(tex, uv().mul(2)).mul(texture(shared));
    const bone = new Bone();
    const skinned = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
    skinned.add(bone);
    skinned.bind(new Skeleton([bone]));
    let skeletonDisposed = 0;
    const dispose = skinned.skeleton.dispose.bind(skinned.skeleton);
    skinned.skeleton.dispose = () => (skeletonDisposed++, dispose());
    const [t, s] = [disposals(tex), disposals(shared)];
    disposeObject(new Group().add(new Mesh(new BoxGeometry(), mat), skinned));
    expect([t.n, s.n, skeletonDisposed]).toEqual([1, 0, 1]);
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
  const none = (k: Record<string, readonly string[]>) => Object.values(k).every((v) => v.length === 0);

  it('none unless asked for; true is the defaults; an object turns them on with its changes', () => {
    expect(none(resolveDebugKeys())).toBe(true); // a shipped game's: the engine passes true in debug mode
    expect(none(resolveDebugKeys(false))).toBe(true);
    expect(resolveDebugKeys(true)).toEqual(DEFAULT_DEBUG_KEYS);
    const k = resolveDebugKeys({ resolution: 'F2', mute: null, debug: ['Backquote', 'F1'] });
    expect(k.resolution).toEqual(['F2']);
    expect(k.mute).toEqual([]);
    expect(k.debug).toEqual(['Backquote', 'F1']);
    expect(k.mode).toEqual(['KeyP']);
  });

  it('a game rebinds the keys that are on and never turns the off ones on', () => {
    const on = rebindDebugKeys(resolveDebugKeys(true), { mode: 'F8', resolution: 'F7' });
    expect(on.mode).toEqual(['F8']);
    expect(on.resolution).toEqual(['F7']);
    expect(on.mute).toEqual(['KeyM']);
    expect(none(rebindDebugKeys(resolveDebugKeys(), { mode: 'F8', resolution: 'F7' }))).toBe(true);
    // one action off stays off while the others move
    const partly = rebindDebugKeys(resolveDebugKeys({ resolution: null }), { mode: 'F8', resolution: 'F7' });
    expect(partly.resolution).toEqual([]);
    expect(partly.mode).toEqual(['F8']);
  });

  it("a game's option: true / false decide; left out or an object, the keys come with the debug panel", () => {
    expect(startingDebugKeys(undefined, true)).toEqual(DEFAULT_DEBUG_KEYS);
    expect(none(startingDebugKeys(undefined, false))).toBe(true);
    expect(startingDebugKeys(true, false)).toEqual(DEFAULT_DEBUG_KEYS);
    expect(none(startingDebugKeys(false, true))).toBe(true);
    // the old way to free R for a game: it moves the key, and a shipped game still has none
    expect(startingDebugKeys({ resolution: 'F2' }, true).resolution).toEqual(['F2']);
    expect(none(startingDebugKeys({ resolution: 'F2' }, false))).toBe(true);
  });

  it('the debug panel lists only the keys that are on, under their keys', () => {
    expect(hotkeyHelp(resolveDebugKeys(true))).toBe('P mode · R res · [ ] looks · M mute · ~ hide');
    expect(hotkeyHelp(rebindDebugKeys(resolveDebugKeys(true), { mode: 'F8', resolution: 'F7', nextLook: null }))).toBe('F8 mode · F7 res · [ looks · M mute · ~ hide');
    expect(hotkeyHelp(resolveDebugKeys({ debug: ['Backquote', 'F1'], mute: 'Digit0' }))).toContain('0 mute · ~/F1 hide');
    expect(hotkeyHelp(resolveDebugKeys())).toBe('');
  });
});
