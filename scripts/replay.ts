// Replay a recording in Node, with no browser (docs/engine/headless.md *Replaying a recording*):
// the game it was made in (src/games.ts, by its name and `args`) boots headless on the viewport it
// was recorded on, plays every frame, and the result is printed.
//
//   npm run replay -- <recording.json> [--frames n] [--expect <fingerprint>] [--json]
//
//   <recording.json>  what `engine.recording()` returned (a page: `JSON.stringify(
//                     __PIXEL_ENGINE__.recording())`; e2e riftlight-replay writes
//                     .scratch/e2e/riftlight-replay.json)
//   --frames n        stop after n frames
//   --expect f        the fingerprint the run must end on (`engine.fingerprint()` where it was recorded)
//   --json            one JSON object: { game, frames, fingerprint, state, game state, errors }
//
// Prints the fingerprint, `engine.state()`, the game's own state (Riftlight: `rl.state()`) and the
// errors the game's hooks threw. Exit 1 on a hook error, when --expect doesn't match, or when the
// recording's game isn't one this repository runs.
import { readFileSync } from 'node:fs';
import { helpExit } from './manual.mjs';
import { registerEngineHooks } from './trace/hooks';

helpExit(import.meta.url);
registerEngineHooks(); // before any engine import: Rapier and `?url` load as Vite loads them

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && !['--frames', '--expect'].includes(args[i - 1] ?? ''));
if (!file) {
  console.error('npm run replay -- <recording.json> [--frames n] [--expect <fingerprint>] [--json]  (--help: the manual)');
  process.exit(2);
}
const frames = flag('--frames') === undefined ? undefined : Number(flag('--frames'));
const expect = flag('--expect');
const json = args.includes('--json');

const { recordingProblem, Engine } = await import('../src/engine');
const { nodeAssets } = await import('../src/engine/node');
const { gameForRecording } = await import('../src/games');
const { headlessRiftlight, PUBLIC_DIR } = await import('../src/riftlight/headless');

const rec = JSON.parse(readFileSync(file, 'utf8')) as import('../src/engine').Recording;
const problem = recordingProblem(rec);
if (problem) {
  console.error(`replay: ${file} is not a recording: ${problem}`);
  process.exit(2);
}
const found = gameForRecording(rec);
if (!found) {
  console.error(`replay: no game named "${rec.game}" in src/games.ts`);
  process.exit(1);
}

// Riftlight boots the one way tests and tools boot it; any other game from its table entry
const riftlight = found.entry.id === 'riftlight' ? await headlessRiftlight({ seed: rec.seed, viewport: rec.view }) : null;
const engine = riftlight?.engine ?? (await Engine.headless(found.make(), { ...found.entry.options, seed: rec.seed, viewport: rec.view, assets: nodeAssets(PUBLIC_DIR) }));
await engine.replay(rec, () => engine.loadGame(found.make()), { frames });

const fingerprint = engine.fingerprint();
const state = engine.state();
const gameState = riftlight ? riftlight.rl.state() : null;
const out = { game: rec.game, frames: Math.min(frames ?? Infinity, rec.frames.length), fingerprint, expected: expect ?? null, state, gameState, errors: [...engine.errors] };
if (json) console.log(JSON.stringify(out));
else {
  console.log(`${rec.game}: ${out.frames} frame(s) replayed, fingerprint ${fingerprint}${expect ? (expect === fingerprint ? ' (as expected)' : ` (expected ${expect})`) : ''}`);
  console.log(`engine: ${JSON.stringify({ time: state.time, frame: state.frame, target: state.target, resolution: state.resolution, status: state.status })}`);
  if (gameState) console.log(`game: ${JSON.stringify(gameState)}`);
  for (const e of engine.errors) console.log(`error: ${e}`);
}
engine.dispose();
process.exit(engine.errors.length || (expect !== undefined && expect !== fingerprint) ? 1 : 0);
