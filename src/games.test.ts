// The games table (src/games.ts): every entry makes the game it names, a recording finds its game
// again (by name, rooms by title, with `Recording.args`), and the labs run headless. One engine at
// a time: each is disposed before the next boots.
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { Engine, type GameContext, optionsOpensSettings, type Recording } from './engine';
import { nodeAssets } from './engine/node';
import { GAMES, gameForRecording } from './games';
import { PUBLIC_DIR } from './riftlight/headless';
import { LevelLab } from './riftlight/levels/levelLab';
import { ROOMS } from './world';

const T = 30_000;
const assets = nodeAssets(PUBLIC_DIR);

/** Play `frames` frames headless with D held then W, and return the recording and where it ended. */
async function record(make: () => import('./engine').Game, options: object, frames = 90): Promise<{ rec: Recording; print: string }> {
  const engine = await Engine.headless(make(), { ...options, seed: 11, assets });
  engine.input.setKey('KeyD', true);
  engine.step(frames / 2);
  engine.input.setKey('KeyD', false);
  engine.input.setKey('KeyW', true);
  engine.step(frames / 2);
  const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
  const print = engine.fingerprint();
  expect(engine.errors).toEqual([]);
  engine.dispose();
  return { rec, print };
}

/** Replay `rec` in a fresh engine built from the games table, the way `npm run replay` does. */
async function replay(rec: Recording): Promise<string> {
  const found = gameForRecording(rec)!;
  const engine = await Engine.headless(found.make(), { ...found.entry.options, seed: rec.seed, viewport: rec.view, assets });
  await engine.replay(rec, () => engine.loadGame(found.make()));
  const print = engine.fingerprint();
  expect(engine.errors).toEqual([]);
  engine.dispose();
  return print;
}

describe('the games table', () => {
  it('each entry makes the game it names; recordings find theirs by name, rooms by title', () => {
    for (const g of GAMES) if (g.id !== 'world') expect(g.make(g.argsFromUrl?.('')).name, g.id).toBe(g.name);
    expect(new Set(ROOMS.map((r) => r.title)).size).toBe(ROOMS.length);
    for (const r of ROOMS) expect(gameForRecording({ game: `Engine World: ${r.title}` })?.make().name).toBe(`Engine World: ${r.title}`);
    expect(gameForRecording({ game: 'Riftlight Level Lab', args: { depth: 3 } })?.make().args).toEqual({ depth: 3 });
    expect(gameForRecording({ game: 'No Such Game' })).toBeNull();
    expect(LevelLab.optionsFromUrl('?depth=3&seed=7&god=1&zoom=1.5&camera=side')).toEqual({ depth: 3, seed: 7, god: true, zoom: 1.5, ownCamera: false });
  });

  it(
    'a Level Lab recording (depth 3) replays to its fingerprint through Recording.args',
    async () => {
      const { rec, print } = await record(() => new LevelLab({ depth: 3, seed: 2 }), {});
      expect(rec.args).toEqual({ depth: 3, seed: 2 });
      expect(await replay(rec)).toBe(print);
      // without its args the lab is depth 1: another level, another end
      expect(await replay({ ...rec, args: undefined })).not.toBe(print);
    },
    T,
  );

  it(
    'the Loot Lab, the Arena and Rift Runner run headless and put their handles on globalThis',
    async () => {
      const g = globalThis as Record<string, unknown>;
      for (const id of ['lootlab', 'arena', 'arcade'] as const) {
        const entry = GAMES.find((e) => e.id === id)!;
        const engine = await Engine.headless(entry.make(entry.argsFromUrl?.('?skills=cleave&dummies=2')), { ...entry.options, assets });
        engine.step(60);
        expect(engine.errors, id).toEqual([]);
        if (id === 'lootlab') expect(g.__LOOTLAB__).toBe(engine.game);
        if (id === 'arcade') expect((g.__ARCADE__ as { game: unknown }).game).toBe(engine.game);
        engine.dispose();
      }
      expect(g.__LOOTLAB__).toBeUndefined();
      expect(g.__ARCADE__).toBeUndefined();
    },
    T,
  );
});

describe('Options (Esc) opens the engine’s settings by default only where the game does not claim it', () => {
  it('the rule: true always, false never, auto (the default) unless a control of the game’s own binds PadStart or Escape, its code read them, or on a round page', () => {
    const none = {};
    const legend = { settings: { key: 'Escape', pad: 'PadStart' } }; // the engine's panel, named so a legend shows the button
    const pause = { move: { key: 'WASD' }, pause: { key: 'Escape', pad: 'PadStart' } };
    const padOnly = { next: { key: 'KeyN', pad: 'PadStart' } };
    const keyOnly = { back: { key: 'Escape', pad: 'PadB' } };
    expect([none, legend, pause, padOnly, keyOnly].map((c) => optionsOpensSettings(undefined, c)), 'the default is auto').toEqual([true, true, false, false, false]);
    expect([none, legend].map((c) => optionsOpensSettings('auto', c, { claimed: true })), 'its code read Options or Esc').toEqual([false, false]);
    expect([none, legend].map((c) => optionsOpensSettings('auto', c, { roundPage: true })), 'a round never pauses').toEqual([false, false]);
    expect([optionsOpensSettings(true, pause, { roundPage: true, claimed: true }), optionsOpensSettings(false, none)], 'what a game says wins').toEqual([true, false]);
  });

  it('every game in the table keeps what it had: its own pause menu where it has one, the engine’s settings where it asked', () => {
    const opens = Object.fromEntries(GAMES.map((g) => [g.id, optionsOpensSettings(g.options.settings?.padButton, g.make().controls ?? {})]));
    expect(opens).toEqual({ riftlight: false, playground: true, sandbox: true, lootlab: false, levellab: false, arena: false, arcade: false, world: false });
  });

  it('a game’s own reads of Options or Esc claim them (in update and fixedUpdate), the engine’s do not; a new game starts with none claimed', async () => {
    const reads = (where: 'update' | 'fixedUpdate' | 'none') => ({
      name: `reads ${where}`,
      setup() {},
      update(ctx: GameContext) {
        if (where === 'update') ctx.input.wasPressed('Escape');
      },
      fixedUpdate(ctx: GameContext) {
        if (where === 'fixedUpdate') ctx.input.consumePress('PadStart');
      },
      cameraTarget: () => new Vector3(),
    });
    const engine = await Engine.headless(reads('none'), { assets });
    try {
      engine.input.wasPressed('Escape', 'PadStart'); // outside the game's hooks: the engine's, or a test's
      engine.step(3);
      expect([engine.input.claimed('Escape'), engine.input.claimed('PadStart')], 'nothing read: nothing claimed').toEqual([false, false]);
      await engine.loadGame(reads('update'));
      engine.step(2);
      expect(engine.input.claimed('Escape'), 'read in update').toBe(true);
      await engine.loadGame(reads('fixedUpdate'));
      expect(engine.input.claimed('Escape'), 'a new game: none claimed').toBe(false);
      engine.step(2);
      expect(engine.input.claimed('PadStart'), 'read in fixedUpdate').toBe(true);
    } finally {
      engine.dispose();
    }
  });
});
