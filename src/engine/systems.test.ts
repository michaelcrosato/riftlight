// The engine's game systems in the Playground, headless (docs/engine/headless.md): hero events
// play their sounds (`engine.audio.counts`, counted with no AudioContext), particles burst from
// one emitter per preset, coins are trigger volumes. Moved from e2e `systems`; what needs a page
// stays there: the HUD's pixels, audio unlock and mute, particles in the frame, the gamepad,
// pause and the hotkeys (the live loop), GPU memory and the textured materials' pictures.
import { afterAll, describe, expect, it } from 'vitest';
import { bootPlayground } from '../game/testPlayground';
import type { Engine } from './Engine';

const T = 30_000;
let booted: Engine | null = null;
afterAll(() => booted?.dispose());

describe('engine systems in the Playground (headless)', () => {
  it(
    'hero events play their sounds, burst their particles, and coins are trigger volumes',
    async () => {
      const { engine, game, T: d } = await bootPlayground({ camera: null }); // the Playground's own camera, as the page's
      booted = engine;
      const a = engine.audio.counts;
      const delta = (before: Record<string, number>, name: string) => (a[name] ?? 0) - (before[name] ?? 0);
      expect(engine.audio.context, 'no AudioContext headless, sounds are still counted').toBeNull();
      engine.step(2);

      // jump → land: jump sound, land sound, dust
      let before = { ...a };
      d.place([0, 0, 4]);
      d.tap('Space');
      d.until((hero) => hero.state === 'jump', 500);
      const land = d.until((hero) => hero.stats.landings > 0 && hero.state !== 'jump' && hero.state !== 'fall', 2500);
      const dust = engine.particles.alive;
      expect(land.ok && delta(before, 'jump') >= 1 && delta(before, 'land') >= 1, `jump + land sounds (${delta(before, 'jump')}, ${delta(before, 'land')})`).toBe(true);
      expect(dust, 'landing dust (particles)').toBeGreaterThanOrEqual(3);

      // double jump: jump again right on landing, while running
      d.place([-6, 0, 10], Math.PI / 2);
      d.set(['KeyD'], true);
      d.until((hero) => hero.state === 'run', 2500);
      const kinds: string[] = [];
      for (let i = 0; i < 2; i++) {
        d.tap('Space');
        kinds.push(game.hero.jumpKind);
        d.until((hero) => hero.grounded && hero.state !== 'jump' && hero.state !== 'fall', 2500);
      }
      d.set(['KeyD'], false);
      expect(delta(before, 'doubleJump'), `double jump sound (${kinds.join(',')})`).toBeGreaterThanOrEqual(1);
      expect(kinds.join(','), 'the second jump is a double jump').toContain('DoubleJump');
      d.wait(1500);

      // ground pound: whoosh, one boom, impact particles; one emitter (draw call) per preset
      d.place([0, 0, 4]);
      d.tap('Space');
      d.until((hero) => hero.state === 'jump' && hero.vy < 6, 1500);
      d.tap('KeyC');
      d.until((hero) => hero.state === 'groundPoundLand', 3000);
      expect(delta(before, 'groundPound'), 'ground pound: one boom').toBe(1);
      expect(delta(before, 'whoosh'), 'ground pound: whoosh').toBeGreaterThanOrEqual(1);
      expect(engine.particles.alive, 'ground pound: impact particles').toBeGreaterThanOrEqual(15);
      const sprites = engine.scene.getObjectByName('particles')!.children.length;
      expect(sprites, 'one emitter (draw call) per preset').toBe(engine.particles.emitterCount);
      expect(engine.particles.emitterCount).toBeLessThanOrEqual(5);

      // skid: run, reverse
      engine.step(60);
      before = { ...a };
      d.wait(1000);
      d.place([-4, 0, 6]);
      d.set(['KeyD'], true);
      d.until((hero) => hero.state === 'run', 2500);
      d.wait(300);
      d.set(['KeyA'], true);
      d.set(['KeyD'], false);
      const skid = d.until((hero) => hero.state === 'skid', 800);
      d.wait(60);
      const skidDust = engine.particles.alive;
      d.set(['KeyA'], false);
      expect(skid.ok && delta(before, 'skid') >= 1, `skid sound (${delta(before, 'skid')}, states ${skid.seen})`).toBe(true);
      expect(skidDust, 'skid dust').toBeGreaterThanOrEqual(1);
      d.wait(800);

      // steps + punch
      d.set(['KeyD'], true);
      d.wait(600);
      d.set(['KeyD'], false);
      d.wait(300);
      d.tap('KeyJ');
      d.wait(300);
      expect(delta(before, 'step'), 'footstep sounds').toBeGreaterThanOrEqual(2);
      expect(delta(before, 'punch'), 'punch sound').toBeGreaterThanOrEqual(1);

      // a coin is a trigger volume: collected once, coin sound, sparkle, the trigger removed
      const triggers0 = engine.physics.counts().triggers;
      const coins0 = game.collected;
      const coinSounds0 = a.coin ?? 0;
      d.wait(1000); // let earlier particles die out
      d.place([4, 0, -4]);
      expect(game.collected - coins0, 'coin collected once').toBe(1);
      expect((a.coin ?? 0) - coinSounds0, 'one coin sound').toBe(1);
      expect(triggers0 - engine.physics.counts().triggers, 'the coin’s trigger is removed').toBe(1);
      expect(engine.particles.alive, 'coin sparkle').toBeGreaterThanOrEqual(5);

      // fall off the island: hurt
      d.place([0, 0, 18]);
      d.until(() => game.respawns > 0, 4000);
      expect(game.respawns, 'the hero respawned').toBeGreaterThan(0);
      expect(delta(before, 'hurt'), 'falling off the island plays hurt').toBe(1);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
