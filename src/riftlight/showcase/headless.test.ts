// The showcase headless: the arcade cabinet and the Hall of Beasts played through the agent API
// and the engine's input (moved from e2e riftlight-showcase, whose pictures, photo mode and URL
// check stay in the browser); then what needs a page (pointer lock, a picture, a file download or
// picker) does nothing, and the game plays on. One engine for the file, tests in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight, settle } from '../headless';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 777 });
}, T);
afterAll(() => h?.engine.dispose());

/** Step `n` frames at a time until `done()`, letting promises run between (the stage builds async, as a page's frames would let it). */
async function stepUntilSettled(done: () => boolean, max: number, what: string): Promise<void> {
  for (let f = 0; f <= max; f += 5) {
    if (done()) return;
    h.engine.step(5);
    await settle();
  }
  throw new Error(`${what} did not hold within ${max} frames`);
}

describe('riftlight showcase: the arcade and the Hall of Beasts', () => {
  let physics0 = '';
  let entries: { name: string; rank: string }[] = [];

  it(
    'Emberfall has the arcade cabinet and the Hall of Beasts',
    () => {
      const { rl, game, engine } = h;
      rl.newRun({ slot: 0, seed: 777 });
      rl.setTimeOfDay(0.3);
      engine.step(20);
      const ids = game.town.interactables.map((i) => i.id);
      expect(ids).toContain('arcade');
      expect(ids).toContain('bestiary');
      physics0 = JSON.stringify(engine.physics.counts());
    },
    T,
  );

  it(
    "walk to the cabinet and use it (F): the camera swoops in behind an iris; inside, the side camera and the 16-bit + CRT look, still Riftlight's game with the town kept",
    async () => {
      const { rl, game, engine } = h;
      expect(rl.talkTo('arcade').ok, 'walk to the cabinet and use it').toBe(true);
      engine.step(20);
      expect(game.showcase.iris, 'an iris').not.toBeNull();
      expect(engine.camera.zoom, 'the camera swoops into the screen').toBeGreaterThan(1.6);
      await stepUntilSettled(() => rl.arcade.state().active && !game.showcase.iris && !!rl.arcade.state().phase, 3600, 'inside the cabinet');
      const a = rl.arcade.state();
      expect(a.camera).toBe('side');
      expect(a.filters.join()).toBe('16bit,crt');
      expect(rl.state().screen, 'no loadGame: the town kept').toBe('town');
      expect(engine.game?.name).toBe('Riftlight');
      engine.step(80);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the scripted run reaches the flag with the platformer moveset (double jump, wall kick, a ground pound through the cracked floor), coins, a best time and a gold reward in the save',
    () => {
      const { rl, game } = h;
      const gold0 = rl.state().hero.gold;
      const stage = game.showcase.arcade.stage!;
      const states = new Set<string>();
      const jumps = new Set<string>();
      const orig = stage.fixedUpdate.bind(stage);
      stage.fixedUpdate = (...args: Parameters<typeof orig>) => {
        orig(...args);
        const hh = stage.hero?.hero;
        if (hh) {
          states.add(hh.state);
          if (hh.state === 'jump') jumps.add(String(hh.jumpKind));
        }
      };
      const a = rl.arcade.autoplay({ maxFrames: 60 * 60 });
      expect(a.phase, `the flag (${a.time}s, ${a.frames} frames)`).toBe('done');
      expect(a.result).not.toBeNull();
      expect([...jumps]).toEqual(expect.arrayContaining(['DoubleJump', 'WallKick']));
      expect(a.broken, 'the cracked floor broke').toBe(true);
      expect(states.has('groundPound'), 'a ground pound').toBe(true);
      expect(a.coins, 'coins collected by trigger volumes').toBeGreaterThan(10);
      expect(a.record.best).toBeGreaterThan(0);
      expect(Math.abs(a.record.best - a.time)).toBeLessThan(0.01);
      expect(a.result!.newBest, 'best time kept').toBe(true);
      expect(a.result!.reward).toBeGreaterThan(0);
      expect(rl.state().hero.gold - gold0, 'a small gold reward').toBe(a.result!.reward);
      const saved = (JSON.parse(rl.exportSave(0)!) as { data: { showcase?: { arcade?: { best?: number } } } }).data.showcase?.arcade?.best ?? 0;
      expect(Math.abs(saved - a.record.best), 'the best time is in the save slot').toBeLessThan(0.01);
    },
    T,
  );

  it(
    'Esc walks back to town: iso camera, no filters, the hero shown, nothing left in the physics world',
    async () => {
      const { rl, game, engine } = h;
      rl.press('Escape');
      await stepUntilSettled(() => !game.showcase.active, 120, 'back in town');
      expect(engine.camera.preset).toBe('iso');
      expect([...engine.filters]).toEqual([]);
      expect(game.hero.object.visible).toBe(true);
      expect(JSON.stringify(engine.physics.counts())).toBe(physics0);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the kills are in the bestiary; the Hall of Beasts in first person, every exhibit rebuilt from its genome, the boss first, lit by the light pool',
    async () => {
      const { rl, engine } = h;
      await rl.enterDepth(1);
      engine.step(5);
      rl.killAll();
      engine.step(5);
      rl.toTown();
      engine.step(5);
      entries = rl.bestiary.entries();
      expect(entries.length).toBeGreaterThanOrEqual(3);
      expect(entries[0]!.rank).toBe('boss');
      const b = await rl.bestiary.open();
      expect(b.active).toBe(true);
      expect(b.camera).toBe('first');
      expect(b.exhibits.length).toBe(Math.min(10, entries.length));
      expect(b.exhibits.map((e) => e.meshes).every((n) => n > 3), 'rebuilt from the genome').toBe(true);
      expect(b.exhibits[0]!.name, 'the boss stands first').toBe(entries[0]!.name);
      engine.step(30);
      const lights = engine.lights.stats();
      expect(lights.lit).toBeGreaterThan(0);
      expect(lights.requests).toBeGreaterThanOrEqual(b.exhibits.length);
    },
    T,
  );

  it(
    'W walks down the aisle; inspect: the orbit camera and the card; a clip plays; the Rift Altar breeds two kills and mutates the child; Tab flies; out of the hall: iso camera, physics as before',
    () => {
      const { rl, engine } = h;
      const z0 = rl.bestiary.state().hero[2]!;
      engine.input.setKey('KeyW', true);
      engine.step(40);
      engine.input.setKey('KeyW', false);
      engine.step(2);
      expect(rl.bestiary.state().hero[2]!, 'down the aisle').toBeLessThan(z0 - 1);
      let b = rl.bestiary.inspect(0);
      expect(b.view).toBe('inspect');
      expect(b.focus).toBe(entries[0]!.name);
      expect(b.camera).toBe('fixed');
      const clip = b.exhibits[0]!.clips.includes('Death') ? 'Death' : b.exhibits[0]!.clips.at(-1)!;
      const played = rl.bestiary.play(clip);
      expect(played.ok).toBe(true);
      expect(played.state.exhibits[0]!.clip).toBe(clip);
      engine.step(12);
      b = rl.bestiary.breed(0, 1);
      expect(b.child?.generation).toBe(1);
      expect(b.child!.parts).toBeGreaterThan(0);
      const seed1 = b.child!.seed;
      b = rl.bestiary.mutate();
      expect(b.child?.generation).toBe(2);
      expect(b.child!.seed).not.toBe(seed1);
      engine.step(40);
      expect(rl.bestiary.view('fly').camera).toBe('free');
      rl.bestiary.close();
      expect(h.game.showcase.active).toBe(false);
      expect(engine.camera.preset).toBe('iso');
      expect(JSON.stringify(engine.physics.counts())).toBe(physics0);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});

it(
  'the Hall of Beasts, photo mode, save export / import and the way to Engine World run without a page',
  async () => {
    const { engine, game, rl } = h;
    rl.newRun({ seed: 5 });
    await rl.bestiary.open();
    engine.step(30); // every frame reads pointer lock in a page
    expect(rl.bestiary.state()).toMatchObject({ active: true });
    await rl.bestiary.close();
    rl.photo.open();
    engine.input.setKey('KeyP', true); // the shutter: no picture headless, and no unhandled rejection
    engine.step(2);
    engine.input.setKey('KeyP', false);
    engine.step(2);
    expect(rl.photo.state()).toMatchObject({ active: true, last: null });
    rl.save(0);
    game.exportSlot(0);
    game.importSlot(0);
    engine.step(2);
    game.engineWorld(); // leaving for Engine World: no page to leave headless
    expect(engine.errors).toEqual([]);
  },
  T,
);
