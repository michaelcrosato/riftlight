// Engine World headless: a room entered by a door replays through `Recording.args` (the door is
// where the hero spawns). The World shell is one per process: one room at a time, disposed between.
import { expect, it } from 'vitest';
import { Engine, type Recording } from '../engine';
import { nodeAssets } from '../engine/node';
import { gameForRecording } from '../games';
import { PUBLIC_DIR } from '../riftlight/headless';
import { WORLD_OPTIONS, worldGame } from './index';

const assets = nodeAssets(PUBLIC_DIR);

async function replay(rec: Recording): Promise<{ print: string; at: number[] }> {
  const found = gameForRecording(rec)!;
  const engine = await Engine.headless(found.make(), { ...found.entry.options, seed: rec.seed, viewport: rec.view, assets });
  await engine.replay(rec, () => engine.loadGame(found.make()));
  const out = { print: engine.fingerprint(), at: engine.state().target };
  expect(engine.errors).toEqual([]);
  engine.dispose();
  return out;
}

it('the Atrium entered by a door replays to its fingerprint through Recording.args', async () => {
  const engine = await Engine.headless(worldGame({ room: 'atrium', from: 'moves' }), { ...WORLD_OPTIONS, seed: 5, assets });
  const start = engine.state().target;
  engine.input.setKey('KeyW', true);
  engine.step(60);
  const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
  const print = engine.fingerprint();
  expect(engine.errors).toEqual([]);
  engine.dispose();
  expect(rec).toMatchObject({ game: 'Engine World: The Atrium', args: { room: 'atrium', from: 'moves' } });
  expect((await replay(rec)).print).toBe(print);
  // without the door the hero starts at the Atrium's own spawn: another run
  const elsewhere = await replay({ ...rec, args: { room: 'atrium', from: null } });
  expect(elsewhere.print).not.toBe(print);
  expect(Math.hypot(elsewhere.at[0]! - start[0]!, elsewhere.at[2]! - start[2]!)).toBeGreaterThan(1);
}, 30_000);
