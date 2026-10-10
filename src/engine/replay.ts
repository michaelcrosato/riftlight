/**
 * Recordings of play (docs/DOCTRINE.md, principle 1). From a level's start, its seed and the
 * input of every frame decide everything that happens in it, so a recording is just those: the
 * engine keeps one for the level that is running (`engine.recording()`), `engine.replay()` plays
 * one back frame for frame, and `engine.fingerprint()` hashes the state, so two runs that
 * should match can be compared. A recorded bug is a file; replayed, it is a test.
 *
 *   const rec = engine.recording();                          // JSON: seed, game, frames
 *   await engine.replay(rec, () => engine.loadGame(new MyGame()));
 *   engine.fingerprint() === fingerprintAtTheEnd;            // the same game, frame for frame
 *
 * What a replay can't reproduce: anything a game takes from outside its frames (a model that
 * finishes loading mid-play, the wall clock, a camera left turned by the level before).
 */
import type { InputFrame } from './input';

export type { InputFrame } from './input';

export interface Recording {
  readonly format: 1;
  /** The engine version that recorded it (a different one may not replay the same). */
  readonly engine: string;
  /** The game's name when it was recorded. */
  readonly game: string;
  /** The engine seed (`ctx.random` comes from it and the game's name). */
  readonly seed: number;
  /** Game time when the level began (`ctx.time` carries on across levels). */
  readonly time: number;
  /** Every frame the level ran, from its first. */
  readonly frames: readonly InputFrame[];
  /** True when the level ran longer than a recording keeps (the frames are its start). */
  readonly truncated?: boolean;
}

/** Frames a recording keeps: an hour at 60 fps. */
export const MAX_FRAMES = 216_000;

const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const codes = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Is `v` a recording this engine can replay? Returns the problem, or null. */
export function recordingProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'not an object';
  const r = v as Partial<Recording>;
  if (r.format !== 1) return `format ${String(r.format)} (this engine reads 1)`;
  if (typeof r.game !== 'string') return 'no game name';
  if (typeof r.seed !== 'number' || !Number.isInteger(r.seed) || r.seed < 0) return 'seed must be a whole number from 0';
  if (typeof r.time !== 'number' || !Number.isFinite(r.time)) return 'time must be a number';
  if (!Array.isArray(r.frames)) return 'no frames';
  for (let i = 0; i < r.frames.length; i++) {
    const f = r.frames[i] as InputFrame;
    const bad = (why: string) => `frame ${i}: ${why}`;
    if (!f || typeof f !== 'object') return bad('not an object');
    if (typeof f.dt !== 'number' || !(f.dt >= 0) || f.dt > 1) return bad('dt must be 0..1 s');
    if (f.held !== undefined && !codes(f.held)) return bad('held must be key codes');
    if (f.pressed !== undefined && !codes(f.pressed)) return bad('pressed must be key codes');
    for (const k of ['analog', 'pad', 'delta'] as const) if (f[k] !== undefined && !pair(f[k])) return bad(`${k} must be two numbers`);
    if (f.wheel !== undefined && !(typeof f.wheel === 'number' && Number.isFinite(f.wheel))) return bad('wheel must be a number');
    if (f.pointer !== undefined && !(Array.isArray(f.pointer) && f.pointer.length === 4 && f.pointer.every((x) => typeof x === 'number' && Number.isFinite(x)))) return bad('pointer must be four numbers');
  }
  return null;
}
