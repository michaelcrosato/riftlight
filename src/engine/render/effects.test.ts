import { describe, expect, it } from 'vitest';
import { DataTexture, OrthographicCamera, Scene, Vector3 } from 'three/webgpu';
import { RippleField, WAVES_CALM, waterHeight } from '../physics/water';
import { Decals } from './decals';
import { GrassField } from './grass';
import { Precipitation } from './precipitation';
import { SpriteBatch } from './sprites';
import { Trail } from './trail';
import { WaterSurface } from './water';

describe('WaterSurface', () => {
  it('reports the height it draws: rest level + waves + ripples, only over itself', () => {
    const ripples = new RippleField({ size: [4, 4], cells: [16, 16], center: [10, 0] });
    const water = new WaterSurface({ size: [4, 4], at: [10, 1, 0], waves: WAVES_CALM, ripples });
    ripples.splash(10, 0, 0.5, 0.2);
    water.update(2);
    expect(water.heightAt(10.3, 0.2)).toBeCloseTo(1 + waterHeight(WAVES_CALM, 10.3, 0.2, 2) + ripples.heightAt(10.3, 0.2), 6);
    expect(water.covers(11.9, 1.9)).toBe(true);
    expect(water.covers(12.1, 0)).toBe(false);
    water.dispose();
  });
});

describe('Precipitation', () => {
  it('clamps its intensity and counts the drops that land', () => {
    const rain = new Precipitation({ kind: 'rain', count: 1000, area: [10, 10, 10], speed: 10 });
    rain.intensity = 2;
    expect(rain.intensity).toBe(1);
    expect(rain.splashes(1)).toBeCloseTo(1000, 0); // every drop falls 10 m in 1 s
    rain.intensity = 0;
    expect(rain.splashes(1)).toBe(0);
    rain.update(0.1, new Vector3(1, 2, 3));
    rain.dispose();
  });
});

describe('GrassField', () => {
  it('grows blades only where the mask allows', () => {
    const grass = new GrassField({ area: [10, 10], at: [0, 0, 0], count: 400, mask: (x) => x > 0 });
    expect(grass.blades).toBe(400);
    expect(grass.count).toBe(400);
    const roots = grass.geometry.getAttribute('aRoot');
    for (let i = 0; i < grass.blades; i++) expect(roots.getX(i)).toBeGreaterThan(0);
    grass.push(0, new Vector3(1, 0, 1), 1);
    grass.update(1);
    grass.dispose();
  });
});

describe('Trail', () => {
  it('keeps recent points and drops old ones', () => {
    const trail = new Trail({ points: 8, life: 0.5, minStep: 0.01 });
    const camera = new OrthographicCamera();
    for (let i = 0; i < 12; i++) trail.push(new Vector3(i * 0.1, 0, 0), i * 0.05);
    expect(trail.length).toBe(8); // capacity
    trail.update(0.55, camera);
    expect(trail.geometry.drawRange.count).toBeGreaterThan(0);
    expect(trail.visible).toBe(true);
    trail.update(2, camera); // everything older than the life
    expect(trail.length).toBe(0);
    expect(trail.geometry.drawRange.count).toBe(0);
    expect(trail.visible).toBe(false); // no empty draws
  });
});

describe('Decals', () => {
  it('lays marks per shape, reuses the oldest when full, and fades them after their life', () => {
    const scene = new Scene();
    const decals = new Decals(scene, { capacity: 3 });
    for (let i = 0; i < 5; i++) decals.add('splat', { x: i, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { life: 1 });
    decals.add('scorch', { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { life: 0 });
    expect(decals.meshes.get('splat')!.count).toBe(3);
    expect(decals.count()).toBe(4);
    decals.update(3); // the splats are past their life and their fade: gone; the scorch stays (life 0)
    expect(decals.count('splat')).toBe(0);
    expect(decals.count('scorch')).toBe(1);
    decals.clear();
    expect(decals.count()).toBe(0);
    decals.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('SpriteBatch', () => {
  it('places, changes and runs out of sprites; frames wrap round the sheet', () => {
    const sheet = { texture: new DataTexture(new Uint8Array(4 * 4 * 2 * 4), 4 * 4, 2 * 4), frame: [4, 4] as const, cols: 4, rows: 2, frames: 6 };
    const batch = new SpriteBatch(sheet, { capacity: 2 });
    expect(batch.count).toBe(0);
    const a = batch.spawn([1, 0, 2], { size: 2, frame: 3 });
    const b = batch.spawn([0, 0, 0]);
    expect([a, b, batch.spawn([5, 5, 5])]).toEqual([0, 1, -1]);
    expect(batch.count).toBe(2);
    batch.set(a, { at: [4, 1, -1], frame: 7, flip: true });
    expect(batch.at(a)).toEqual([4, 1, -1]);
    expect(batch.frameOf(a)).toBe(1); // 7 wraps to 1 on a 6-frame sheet
    batch.put(b, 1, 2, 3, -1, false);
    expect([batch.at(b), batch.frameOf(b)]).toEqual([[1, 2, 3], 5]); // -1 is the last frame
    batch.put(b, 1, 2, 3, 2.7);
    expect(batch.frameOf(b)).toBe(2); // whole frames only
    batch.dispose();
  });
});
