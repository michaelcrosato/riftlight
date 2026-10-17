// The games table (src/games.ts): every entry makes the game it names, a recording finds its game
// again (by name, rooms by title, with `Recording.args`), and the labs run headless. One engine at
// a time: each is disposed before the next boots.
import { describe, expect, it } from 'vitest';
import { Engine, type Recording } from './engine';
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
