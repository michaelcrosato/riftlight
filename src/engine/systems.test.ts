// The engine's game systems in the Playground, headless (docs/engine/headless.md): hero events
// play their sounds (`engine.audio.counts`, counted with no AudioContext), particles burst from
// one emitter per preset, coins are trigger volumes. Moved from e2e `systems`; what needs a page
// stays there: the HUD's pixels, audio unlock and mute, particles in the frame, the gamepad,
// pause and the hotkeys (the live loop), GPU memory and the textured materials' pictures.
import { describe, expect, it } from 'vitest';
import { Playground } from '../game/playground';
import { Engine } from './Engine';
import { nodeAssets } from './node';

const T = 30_000;

/** What the e2e suites' page helpers (`window.__T`) do, frame for frame. */
function heroDriver(engine: Engine, game: Playground) {
  const frames = (n: number) => engine.step(Math.max(0, Math.round(n)));
  const d = {
    frames,
    /** Game time in milliseconds. */
    wait: (ms: number) => frames((ms * 60) / 1000),
    set: (keys: string[], down: boolean) => keys.forEach((k) => engine.input.setKey(k, down)),
    releaseAll: () => d.set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyF', 'KeyJ', 'ShiftLeft'], false),
    tap(key: string) {
      engine.input.setKey(key, true);
      frames(2);
      engine.input.setKey(key, false);
      frames(1);
    },
    /** Teleport the feet to [x, y, z] facing yaw (0 = +Z, π/2 = +X). */
    place(pos: [number, number, number], yaw = 0) {
      d.releaseAll();
      game.hero.teleport(pos);
      game.hero.facing = yaw;
      game.hero.hvel.set(0, 0, 0);
      frames(8);
    },
    /** Step until `pred` holds, at most `ms` of game time; the states seen. */
    until(pred: (hero: Playground['hero']) => boolean, ms = 3000) {
      const seen = new Set<string>();
      for (let f = 0; f < (ms * 60) / 1000; f++) {
        seen.add(game.hero.state);
        if (pred(game.hero)) return { ok: true, seen: [...seen] };
        frames(1);
      }
      return { ok: false, seen: [...seen] };
    },
  };
  return d;
}

describe('engine systems in the Playground (headless)', () => {
  it(
    'hero events play their sounds, burst their particles, and coins are trigger volumes',
    async () => {
      const game = new Playground();
      const engine = await Engine.headless(game, { seed: 1, assets: nodeAssets() });
      const d = heroDriver(engine, game);
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
      engine.dispose();
    },
    T,
  );
});
