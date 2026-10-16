/**
 * Save-states (docs/DOCTRINE.md, principle 1): a running level as data, taken between two
 * frames (`engine.snapshot()`) and put back at once (`engine.restore(snap)`), so restoring a
 * moment no longer means replaying everything before it. The engine keeps its own part (game
 * time, the clock, `ctx.random`, the physics world, the camera, the shake, input still waiting)
 * and the game its own (`Game.snapshot` / `Game.restore`).
 *
 *   const snap = await engine.snapshot();         // JSON: keep it, attach it to a bug
 *   engine.step(300);                             // ...play on
 *   await engine.restore(snap);                   // back to that moment (the same game, loaded)
 *
 * A restore starts the level's recording again from the snapshot (`Recording.from`), so a
 * recording made after one replays with `replay(rec, start)`: it loads the game, restores the
 * snapshot, then plays the frames. docs/engine/determinism.md *Save-states*.
 */
import type { CameraRigState } from './camera';
import type { ClockState } from './clock';
import type { InputState } from './input';
import type { PhysicsState } from './physics/Physics';
import type { ShakeState } from './shake';

export interface Snapshot {
  readonly format: 1;
  /** The engine version that took it (a different one may not restore the same). */
  readonly engine: string;
  /** The game's name: a snapshot restores into the same game. */
  readonly game: string;
  /** The engine seed and game time when it was taken. */
  readonly seed: number;
  readonly time: number;
  readonly clock: ClockState;
  /** `ctx.random`'s state. */
  readonly random: number;
  readonly physics: PhysicsState;
  readonly camera: CameraRigState;
  readonly shake: ShakeState;
  readonly input: InputState;
  /** The game's own state (`Game.snapshot`), as JSON. */
  readonly state: unknown;
}

/** The numbers JSON can't hold exactly, as strings: a snapshot survives `JSON.stringify` bit for bit. */
const MARKS: readonly (readonly [string, number])[] = [
  ['@-0', -0],
  ['@Infinity', Infinity],
  ['@-Infinity', -Infinity],
  ['@NaN', NaN],
];

/**
 * A deep copy of `v` as plain JSON that `JSON.stringify` keeps exactly: `-0`, `Infinity`,
 * `-Infinity` and `NaN` become the strings `'@-0'`, `'@Infinity'`... (JSON would write 0 and null,
 * and `atan2(-0, x)` is not `atan2(0, x)`), and a string of the game's own that starts with `@`
 * gets one more (`'@x'` → `'@@x'`). `decodeState` turns them back. `engine.snapshot()` and
 * `restore()` do both; a game's `snapshot()` returns its values as they are (never through JSON).
 */
export function encodeState(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v ?? null, (_k, x: unknown) => {
      if (typeof x === 'string') return x.startsWith('@') ? `@${x}` : x;
      if (typeof x !== 'number' || (Number.isFinite(x) && !Object.is(x, -0))) return x;
      return MARKS.find(([, n]) => Object.is(n, x))![0];
    }),
  ) as unknown;
}

/** `encodeState` undone: a deep copy with the marked numbers (and the game's own `@` strings) back. */
export function decodeState(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null), (_k, x: unknown) => {
    if (typeof x !== 'string' || !x.startsWith('@')) return x;
    if (x.startsWith('@@')) return x.slice(1);
    const mark = MARKS.find(([m]) => m === x);
    if (!mark) throw new Error(`decodeState: unknown mark "${x}"`);
    return mark[1];
  }) as unknown;
}

/** Is `v` a snapshot this engine can restore? Returns the problem, or null. */
export function snapshotProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'not an object';
  const s = v as Partial<Snapshot>;
  if (s.format !== 1) return `format ${String(s.format)} (this engine reads 1)`;
  if (typeof s.game !== 'string') return 'no game name';
  if (typeof s.seed !== 'number' || !Number.isInteger(s.seed) || s.seed < 0) return 'seed must be a whole number from 0';
  if (typeof s.time !== 'number' || !Number.isFinite(s.time)) return 'time must be a number';
  if (typeof s.random !== 'number') return 'no random state';
  for (const k of ['clock', 'physics', 'camera', 'shake', 'input'] as const) if (!s[k] || typeof s[k] !== 'object') return `no ${k}`;
  if (typeof s.physics!.world !== 'string') return 'no physics world';
  return null;
}
