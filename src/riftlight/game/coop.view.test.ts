// Couch co-op on a phone held upright (390×844 at DPR 3, a pad each), headless: the group camera
// keeps a guest in view. The view is narrow across, so as a guest walks sideways away from player 1
// the camera zooms out by how far across the screen it is (the heroes projected into the view, not
// metres from the centre), and once it can zoom out no farther the guest is put beside player 1
// before it leaves the screen, short of the leash: never off screen.
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GamepadLike } from '../../engine';
import { type HeadlessRiftlight, headlessRiftlight, settle } from '../headless';
import { COOP } from './coop';
import { cameraBasis } from './controls';

const T = 120_000;
let h: HeadlessRiftlight;

/** A standard pad at `index`: its left stick `l` (x right, y forward), buttons `pressed` down. */
const pad = (index: number, l: [number, number] = [0, 0], pressed: number[] = []): GamepadLike => ({
  connected: true,
  mapping: 'standard',
  index,
  axes: [l[0], -l[1], 0, 0],
  buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 818, viewport: { width: 390, height: 844, dpr: 3 } });
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('couch co-op on a phone held upright', () => {
  it(
    'a guest walking sideways stays on screen all the way: the camera zooms out by the view, then the guest is put beside player 1 before it leaves it',
    async () => {
      const { rl, game, engine } = h;
      rl.newRun({ seed: 818 });
      engine.step(5);
      expect(game.ui.h, 'a phone held upright').toBeGreaterThan(game.ui.w);
      // player 1 on pad 0; pad 1 joins with Cross in town
      engine.input.setGamepads([pad(0, [0, 0], [3]), pad(1)]);
      engine.step(1);
      engine.input.setGamepads([pad(0), pad(1)]);
      engine.step(4);
      engine.input.setGamepads([pad(0), pad(1, [0, 0], [0])]);
      engine.step(4);
      engine.input.setGamepads([pad(0), pad(1)]);
      await settle();
      engine.step(30);
      expect(game.coop.seats).toEqual([2]);
      const guest = game.coop.guests[0]!.hero!;
      const cam = engine.camera.camera;
      /** Where a hero is on screen (NDC: in view within ±1), its feet and its head. */
      const onScreen = (p: Vector3) => {
        const feet = p.clone().project(cam);
        const head = p.clone().setY(p.y + 1.9).project(cam);
        return Math.max(Math.abs(feet.x), Math.abs(feet.y), Math.abs(head.x), Math.abs(head.y));
      };
      const right = new Vector3();
      const forward = new Vector3();
      cameraBasis(engine, right, forward);
      // player 1 where a guest can walk sideways along the screen past the leash with nothing in the way
      let from: Vector3 | null = null;
      let side = 1;
      const home = game.hero.actor.position.clone();
      for (const [r, f] of [[0, 0], [0, 3], [0, -3], [0, 6], [0, -6], [3, 0], [-3, 0], [0, 9], [0, -9]] as const) {
        for (const d of [1, -1]) {
          const at = home.clone().addScaledVector(right, r).addScaledVector(forward, f);
          if (!from && game.town.wall(at, at.clone().addScaledVector(right, d * (COOP.leash + 2))) === null) [from, side] = [at, d];
        }
      }
      expect(from, 'a clear line across the town').not.toBeNull();
      game.hero.snap!(from!, 0);
      guest.snap!(from!.clone().addScaledVector(right, side * COOP.beside), 0);
      engine.step(90); // the camera settles on them
      const zoom0 = (engine.camera as { zoom: number }).zoom;
      // the guest walks sideways along the screen, its stick all the way, until it is put back beside player 1
      engine.input.setGamepads([pad(0), pad(1, [side, 0])]);
      let far = 0;
      let back = -1;
      let worst = 0;
      let leastZoom = zoom0;
      for (let f = 1; f <= 60 * 8 && back < 0; f++) {
        engine.step(1);
        const d = guest.actor.position.distanceTo(game.hero.actor.position);
        if (d < far - 3) back = f;
        else far = Math.max(far, d);
        worst = Math.max(worst, onScreen(guest.actor.position), onScreen(game.hero.actor.position));
        leastZoom = Math.min(leastZoom, (engine.camera as { zoom: number }).zoom);
      }
      engine.input.setGamepads([pad(0), pad(1)]);
      expect(back, 'put back beside player 1').toBeGreaterThan(0);
      expect(guest.actor.position.distanceTo(game.hero.actor.position), 'beside player 1').toBeLessThan(COOP.beside + 0.3);
      expect(far, 'short of the leash: the screen is narrower than it').toBeLessThan(COOP.leash);
      expect(far, 'once the camera had zoomed out').toBeGreaterThan(6);
      expect(leastZoom, 'the camera zoomed out').toBeLessThan(zoom0 * 0.85);
      expect(worst, 'both heroes on screen all the way (NDC, feet and head)').toBeLessThanOrEqual(1);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
