// Camera rigs in a real game, headless: the Move Playground under every preset (zoom, the
// character moving in the camera's own basis, the side-scroller's lane, mouse look, the free
// camera flying and fixed), and live preset swaps that leave the player where they were. One engine
// for the file; presets are swapped with `engine.setCamera`, as the debug panel's select does.
// The browser keeps what needs a page (e2e `cameras`, `camera-swap`): the frames each preset
// renders, the debug panel, the URL (`?camera=`, `?cam=`, a reload) and the one renderer.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from './Engine';
import type { CameraConfig, CameraPreset } from './camera';
import type { Playground } from '../game/playground';
import { bootPlayground } from '../game/testPlayground';

const T = 15_000;

let engine: Engine;
let game: Playground;

beforeAll(async () => {
  ({ engine, game } = await bootPlayground());
}, 30_000);

afterAll(() => {
  expect(engine.errors, 'no hook errors').toEqual([]);
  engine.dispose();
});

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
const rig = () => engine.state().cameraRig as { preset: string; zoom: number; zoomable: boolean; yaw: number; fixed?: boolean; config?: CameraConfig };
const target = () => engine.state().target;
const camera = () => engine.state().camera;

/** Hold a key for `ms` of game time. */
function hold(code: string, ms: number): void {
  engine.input.setKey(code, true);
  engine.step(Math.round((ms * 60) / 1000));
  engine.input.setKey(code, false);
}

/** Step one frame at a time until `done()` holds, at most `frames` frames: whether it held. */
function within(frames: number, done: () => boolean): boolean {
  for (let f = 0; f < frames; f++) {
    if (done()) return true;
    engine.step(1);
  }
  return done();
}

/** The hero on open ground, keys let go, as a fresh page would have them. */
function fresh(): void {
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Enter']) engine.input.setKey(k, false);
  game.hero.teleport([0, 0, 4]);
  game.hero.hvel.set(0, 0, 0);
  engine.step(8);
}

describe('camera presets in the Playground', () => {
  for (const preset of ['iso', 'topdown', 'side', 'third', 'first', 'free'] as const) {
    it(`${preset}: zoom, and the character (or the camera) moves in its basis`, () => {
      fresh();
      engine.setCamera({ preset });
      engine.step(2);
      expect(rig().preset).toBe(preset);

      // Zoom: wheel up = zoom in, for every preset except first person.
      engine.input.addPointer(0, 0, -4);
      within(3, () => rig().zoom > 1.4);
      if (preset === 'first') expect(rig(), 'first person does not zoom').toMatchObject({ zoom: 1, zoomable: false });
      else expect(rig().zoom, 'wheel zooms in').toBeGreaterThan(1.4);
      if (preset !== 'first') engine.camera.setZoom(1);

      if (preset === 'free') {
        const c0 = camera();
        const t0 = target();
        hold('KeyW', 500);
        engine.step(5);
        expect(dist(c0, camera()), 'free camera flies with WASD').toBeGreaterThan(0.5);
        expect(dist(t0, target()), 'character stays put while the camera flies').toBeLessThan(0.05);
        engine.input.setKey('Enter', true);
        engine.step(1);
        engine.input.setKey('Enter', false);
        within(3, () => rig().fixed === true);
        expect(rig().fixed, 'Enter fixes the camera').toBe(true);
        const config = rig().config!;
        const fixedCam = camera();
        hold('KeyD', 600);
        engine.step(5);
        expect(dist(fixedCam, camera()), 'fixed camera no longer moves').toBeLessThan(1e-6);
        expect(dist(t0, target()), 'character moves once the camera is fixed').toBeGreaterThan(0.8);
        // the printed config, given back as a 'fixed' preset (what ?cam= does on a reload)
        engine.setCamera(config);
        engine.step(2);
        expect(rig().preset).toBe('fixed');
        expect(dist(camera(), config.position!), 'the fixed config restores the view').toBeLessThan(0.02);
        return;
      }

      const t0 = target();
      hold('KeyD', 700);
      within(10, () => dist(t0, target()) > 0.8);
      expect(dist(t0, target()), 'D moves the character').toBeGreaterThan(0.8);
      if (preset === 'side') {
        const z0 = target()[2]!;
        hold('KeyW', 500);
        engine.step(10);
        expect(Math.abs(target()[2]! - z0), 'side-scroller keeps the depth lane').toBeLessThan(0.05);
      }
      if (preset === 'third' || preset === 'first') {
        const yaw0 = rig().yaw;
        engine.input.addPointer(160, 0);
        within(3, () => Math.abs(rig().yaw - yaw0) > 0.3);
        expect(Math.abs(rig().yaw - yaw0), 'mouse turns the camera').toBeGreaterThan(0.3);
      }
      if (preset === 'first') expect(game.heroModel.visible, 'player model hidden in first person').toBe(false);
    }, T);
  }
});

describe('camera hot-swap keeps the player', () => {
  it('every preset swapped to live: the player stays, coins kept, the model shown but in first person', () => {
    fresh();
    engine.setCamera({ preset: 'iso' });
    // Move somewhere and pick up a coin so there is state to lose.
    game.hero.teleport([-4, 0, 5]);
    engine.step(10);
    engine.input.setKey('KeyD', true);
    engine.step(24); // 400 ms
    engine.input.setKey('KeyD', false);
    engine.step(180); // stop and settle on the ground (the capsule eases up ~1 cm for ~2 s)
    const feet = game.hero.feet.toArray();
    const coins = game.collected;
    expect(coins, `setup: player at ${feet.map((v) => v.toFixed(2))}, a coin picked up`).toBeGreaterThanOrEqual(1);
    for (const preset of ['topdown', 'side', 'third', 'first', 'free', 'fixed', 'iso'] as CameraPreset[]) {
      engine.setCamera({ preset });
      engine.step(8);
      const moved = dist(feet, game.hero.feet.toArray());
      expect(engine.camera.preset, `→ ${preset}`).toBe(preset);
      expect(moved, `→ ${preset}: player stayed`).toBeLessThan(0.05);
      expect(game.collected, `→ ${preset}: coins kept`).toBe(coins);
      expect(game.heroModel.visible, `→ ${preset}: player model ${preset === 'first' ? 'hidden' : 'shown'}`).toBe(preset !== 'first');
    }
  }, T);
});
