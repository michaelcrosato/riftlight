/**
 * "Rift Runner", the arcade cabinet's side-scroller, as data. Coordinates are stage-local
 * metres: x runs right, y up, the hero's lane is z = 0 and the side camera looks down -z.
 * Ground tops sit at y = 0. Change the numbers, reload, run `npm run test:e2e -- riftlight-showcase`
 * (the scripted run must still finish) and look at `.scratch/e2e/showcase-*.png`.
 *
 *   start ─ pit ─ brick step ─▶ double jump onto the high ledge ─▶ wall-kick chimney ─▶
 *   cracked floor (ground pound through it) ─▶ under the gate ─▶ the flag
 *
 * Every move the course needs is in the engine's moveset: a run-jump clears the pit, a
 * double jump (jump again on landing) reaches the ledge, wall kicks climb the chimney, a
 * ground pound breaks the cracked slabs. Bonus coins reward a triple jump and the chimney.
 */
import type { PaletteColor, Song } from '../../../engine';

/** A solid box: x and y spans in metres; z defaults to the course depth (±1.5). */
export interface ArcadeBlock {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z?: readonly [number, number];
  /** Look: grass on dirt, bricks, stone, the gate. */
  readonly kind: 'ground' | 'brick' | 'stone' | 'gate';
  /** Rapier tags (`noLedge` keeps the hero from hanging on it). */
  readonly tags?: readonly string[];
}

/** Background scenery (no colliders): a box at depth `z`, moved at `parallax` × the camera. */
export interface ArcadeScenery {
  readonly at: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly color: PaletteColor;
  readonly parallax: number;
  readonly shape?: 'box' | 'mountain' | 'hill' | 'cloud' | 'disc';
}

export const ARCADE_STAGE = {
  name: 'RIFT RUNNER',
  /** Hero spawn (feet), facing +x. */
  spawn: [0, 0] as const,
  /** Falling below this respawns at the last checkpoint. */
  killY: -7,
  /** Checkpoint x positions (reached = respawn there): the start and the high ledge. */
  checkpoints: [
    [0, 0],
    [27, 3.2],
  ] as const,
  /** Course depth (z half-extent of blocks). */
  depth: 1.5,
  blocks: [
    { x: [-7, -6], y: [-4, 9], kind: 'stone', tags: ['noLedge'] }, // the left edge
    { x: [-6, 12], y: [-4, 0], kind: 'ground' },
    // pit 12..15
    { x: [15, 38.4], y: [-4, 0], kind: 'ground' },
    { x: [21, 23], y: [0, 1.2], kind: 'brick' }, // the step
    { x: [26, 32], y: [0, 3.2], kind: 'stone' }, // the high ledge (double jump from the step)
    // the chimney: a hanging wall on the left, the tall block on the right (1.8 m apart)
    { x: [36, 36.6], y: [2.4, 9.5], kind: 'stone', tags: ['noLedge'] },
    { x: [38.4, 44], y: [-4, 5.4], kind: 'stone' },
    // cracked slabs at 44..47 are `breakable` below; the gate hangs past them
    { x: [47, 48.5], y: [2.3, 12], kind: 'gate', tags: ['noLedge'] },
    { x: [44, 66], y: [-4, 0], kind: 'ground' },
    { x: [66, 67], y: [-4, 9], kind: 'stone', tags: ['noLedge'] }, // the right edge
    // a little hop before the flag
    { x: [52, 53.5], y: [0, 0.8], kind: 'brick' },
  ] satisfies ArcadeBlock[],
  /** Cracked slabs: a ground pound on one breaks the whole run of them. */
  breakable: [
    { x: [44, 45], y: [4.8, 5.4] },
    { x: [45, 46], y: [4.8, 5.4] },
    { x: [46, 47], y: [4.8, 5.4] },
  ] as const,
  /** Coins (x, y of the coin's base). */
  coins: [
    [3, 0], [4.2, 0], [5.4, 0],
    [12.6, 1.2], [13.5, 1.8], [14.4, 1.2], // over the pit
    [22, 1.2],
    [27.5, 3.2], [29, 3.2], [30.5, 3.2],
    [29, 6.6], // bonus: a triple jump on the ledge
    [37.5, 2.6], [37.5, 4.2], // in the chimney
    [41, 5.4], [42.5, 5.4],
    [45.5, 2.2], // falling through the cracked floor
    [50, 0], [52.75, 1.4], [55.5, 0], [57, 0],
  ] as const,
  /** The goal flag's x (on the ground). */
  flag: 60,
  /** A good time, seconds (the results card compares). */
  par: 14,
  scenery: [
    // far mountains with snow caps (drift slowest), round hills, clouds, the sun
    { at: [-2, -1, -30], size: [14, 9, 6], color: 'blue', parallax: 0.8, shape: 'mountain' },
    { at: [14, -1, -32], size: [18, 12, 6], color: 'navy', parallax: 0.8, shape: 'mountain' },
    { at: [30, -1, -30], size: [13, 8, 6], color: 'blue', parallax: 0.8, shape: 'mountain' },
    { at: [46, -1, -32], size: [17, 11, 6], color: 'navy', parallax: 0.8, shape: 'mountain' },
    { at: [62, -1, -30], size: [14, 9, 6], color: 'blue', parallax: 0.8, shape: 'mountain' },
    { at: [-4, -3, -16], size: [10, 10, 4], color: 'teal', parallax: 0.5, shape: 'hill' },
    { at: [10, -4, -16], size: [14, 14, 4], color: 'green', parallax: 0.5, shape: 'hill' },
    { at: [26, -3, -16], size: [11, 11, 4], color: 'teal', parallax: 0.5, shape: 'hill' },
    { at: [40, -4, -16], size: [15, 15, 4], color: 'green', parallax: 0.5, shape: 'hill' },
    { at: [56, -3, -16], size: [12, 12, 4], color: 'teal', parallax: 0.5, shape: 'hill' },
    { at: [-2, 9.5, -20], size: [3, 0.9, 1], color: 'white', parallax: 0.65, shape: 'cloud' },
    { at: [13, 11, -20], size: [4, 1.1, 1], color: 'white', parallax: 0.65, shape: 'cloud' },
    { at: [29, 10, -20], size: [3.5, 1, 1], color: 'white', parallax: 0.65, shape: 'cloud' },
    { at: [45, 11.5, -20], size: [4.5, 1.2, 1], color: 'white', parallax: 0.65, shape: 'cloud' },
    { at: [62, 10.2, -20], size: [3, 0.9, 1], color: 'white', parallax: 0.65, shape: 'cloud' },
    { at: [20, 10.5, -36], size: [2.6, 2.6, 0.2], color: 'sand', parallax: 0.92, shape: 'disc' }, // the sun
  ] satisfies ArcadeScenery[],
};

/** Ground / block colours by kind: [top, sides]. */
export const ARCADE_COLORS: Record<ArcadeBlock['kind'], readonly [PaletteColor, PaletteColor]> = {
  ground: ['lime', 'orange'],
  brick: ['red', 'red'],
  stone: ['mist', 'slate'],
  gate: ['slate', 'night'],
};

/** A bouncy chiptune for the cabinet (the engine's song format: docs/ENGINE.md, Audio). */
export const ARCADE_SONG: Song = {
  bpm: 150,
  tracks: {
    lead: { wave: 'square', duty: 0.125, attack: 0.002, decay: 0.09, volume: 0.1 },
    bass: { wave: 'triangle', decay: 0.08, volume: 0.28 },
    drums: { wave: 'noise', attack: 0.001, decay: 0.04, volume: 0.06 },
  },
  patterns: {
    a: {
      lead: 'E5 . G5 . C6 . G5 . E5 . G5 . A5 G5 E5 .',
      bass: 'C3 . . C3 G2 . . . A2 . . A2 G2 . . .',
      drums: 'C6 . C8 . C6 . C8 . C6 . C8 . C6 C6 C8 .',
    },
    b: {
      lead: 'F5 . A5 . C6 . A5 . G5 . B5 . D6 - - .',
      bass: 'F2 . . F2 C3 . . . G2 . . G2 D3 . . .',
      drums: 'C6 . C8 . C6 . C8 . C6 . C8 . C6 C6 C8 C8',
    },
    c: {
      lead: 'E6 . D6 . C6 . A5 . G5 . E5 . G5 - - -',
      bass: 'A2 . . A2 E2 . . . F2 . . F2 G2 . G2 .',
      drums: 'C6 . C8 . C6 . C8 . C6 C8 C6 C8 C6 C6 C6 C6',
    },
  },
  order: ['a', 'a', 'b', 'c'],
};
