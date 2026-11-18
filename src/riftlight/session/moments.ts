/**
 * Riftlight's moments (docs/game/session.md, *Moments*; AI Hub Session Protocol v1, *Moments*):
 * short stretches of the game it already has, each one it opens straight into, with a goal a
 * player clears or fails in seconds. A round of moments deals three of them, a fresh load each; the
 * page names every one in a `hub:moment` tag (`momentTags`, written by `npm run build:single`).
 *
 * A moment is data: a designed level, the hero's level, what it is about (the boss, or packs of
 * the level's plan) and where the hero starts on the way in to it, and what clears it. The set-up
 * is the same on every copy: the level's layout and packs are its design, the run's seed comes from
 * the hub's (`session.rng(moment id)`, recorded with the round), and the hero's spot is found on
 * the layout. Tune a moment with its set-up only (hero level, placement, which packs), never the
 * game's balance: `session/moments.<id>.test.ts` plays each one as a decent player (the playtest
 * bot, or a run for the spot) and idle.
 */
import type { LayoutLike } from '../core/types';
import { bfs } from '../game/nav';
import { t } from '../lang';
import { bossNameShown } from '../lang/monsters';
import { UI } from '../lang/ui';
import { designedBoss } from '../monsters/bosses';

/** What a player does in a moment: the hub shows it as the moment begins (from the protocol's list). */
export type MomentVerb = 'defeat' | 'survive' | 'escape';

/**
 * What clears a moment: `defeat`, its targets fallen; `survive`, the hero still standing when time
 * runs out; `escape`, the hero at its spot (`spot`). A fallen hero fails any of them; time running
 * out fails all but `survive`.
 */
export type MomentClear = 'defeat' | 'survive' | 'escape';

/** What a moment is about: the level's boss, or packs of its plan (by their plan id). */
export type MomentTarget = { readonly boss: true } | { readonly packs: readonly number[] };

export interface MomentSpec {
  /** Its `hub:moment` id: lowercase letters, digits and hyphens, at most 24 characters. */
  readonly id: string;
  readonly verb: MomentVerb;
  /** How long it lasts (3 to 30): the hub calls time then. */
  readonly seconds: number;
  /** The line saying what clears it (at most 60 characters in English: the tag's GOAL); `{boss}` is the level's boss. */
  readonly goal: string;
  /** The designed level it plays in. */
  readonly depth: number;
  /** The hero's level (a fresh hero, no gear). */
  readonly heroLevel: number;
  readonly target: MomentTarget;
  /** Metres from the targets the hero starts, on the way in from the level's start. */
  readonly back: number;
  readonly clear: MomentClear;
  /**
   * Escape: the spot to get to, a floor cell of the level's design (metres, the layout's x and z):
   * on a way out that no other pack watches, in sight of the hero's start (the ring's arrow points
   * along the way, never across a wall).
   */
  readonly spot?: { readonly x: number; readonly z: number };
}

/**
 * The moments, each measured as a decent player plays it and idle over the hub's seeds 1-6 (the
 * numbers below; `moments.<id>.test.ts` play seeds 1-3 of them). Each from a different stretch of the
 * first three levels.
 */
export const MOMENTS: readonly MomentSpec[] = [
  // Embers' boss, at his door: the bot fells him in 8 to 10 s; idle, he still stands at time-up, or the hero falls.
  { id: 'vorgath', verb: 'defeat', seconds: 20, goal: 'moment.vorgath', depth: 1, heroLevel: 2, target: { boss: true }, back: 7, clear: 'defeat' },
  // Gloom's first hall, two packs in the dark: the bot clears it in 4.6 to 8.6 s; idle falls in 5.5 to 10 s.
  { id: 'crypt-hall', verb: 'defeat', seconds: 12, goal: 'moment.crypt_hall', depth: 2, heroLevel: 2, target: { packs: [0, 1] }, back: 6, clear: 'defeat' },
  // Gale's boss: the bot stays up for the 20 s (she can't be felled that fast); idle falls in 6 to 8.5 s.
  { id: 'skraal', verb: 'survive', seconds: 20, goal: 'moment.skraal', depth: 3, heroLevel: 5, target: { boss: true }, back: 6, clear: 'survive' },
  // Gale's first pack, a leader and five, 6 m off at the corridor's mouth; the ring is up the corridor,
  // past the level's start, and no other pack is within 15 m of the way: running for it (after 0.4 s
  // to react) takes 2.2 s, untouched; idle falls in 5.8 to 7.7 s, or is still up at time-up.
  { id: 'gale-escape', verb: 'escape', seconds: 8, goal: 'moment.gale_escape', depth: 3, heroLevel: 2, target: { packs: [0] }, back: 6, clear: 'escape', spot: { x: 76.5, z: 3.5 } },
];

/** The moment called `id`, or null. */
export function momentById(id: string | null | undefined): MomentSpec | null {
  return MOMENTS.find((m) => m.id === id) ?? null;
}

/** A moment's goal in the player's language (the countdown shows it). */
export function momentGoal(m: MomentSpec): string {
  return t(m.goal, { boss: bossNameShown(designedBoss(m.depth)) });
}

/** A moment's `hub:moment` tag: `ID VERB SECONDS GOAL`, the goal in the game's own language (English). */
export function momentTag(m: MomentSpec): string {
  const goal = UI.lines[m.goal];
  if (typeof goal !== 'string') throw new Error(`moment ${m.id}: its goal ${m.goal} is not a line`);
  return `${m.id} ${m.verb} ${m.seconds} ${goal.replace('{boss}', designedBoss(m.depth).name)}`;
}

/** Every moment's `hub:moment` tag, in table order. */
export function momentTags(): string[] {
  return MOMENTS.map(momentTag);
}

/**
 * Where the hero starts: the last cell on the grid route from the level's start to `target` that is
 * at least `back` metres from it (so on the way in, never past it or behind a wall), as a world
 * point (cells are 1 m, the layout's origin at 0). The same on every copy: the layout is the level's design.
 */
export function momentSpot(layout: LayoutLike, target: { x: number; z: number }, back: number): { x: number; z: number } {
  const cell = (p: { x: number; z: number }) => ({ x: Math.floor(p.x), z: Math.floor(p.z) });
  let to = cell(target);
  if (layout.cell(to.x, to.z) !== 1) {
    // a target standing on a wall's edge: the nearest floor cell
    let best: { x: number; z: number } | null = null;
    for (let r = 1; r < 4 && !best; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) if (!best && layout.cell(to.x + dx, to.z + dz) === 1) best = { x: to.x + dx, z: to.z + dz };
    if (best) to = best;
  }
  // back along the route until the target is `back` metres away (or the level's start)
  const route = bfs(layout, layout.start, to);
  let at = route.at(-1) ?? layout.start;
  for (let i = route.length - 1; i >= 0; i--) {
    at = route[i]!;
    if (Math.hypot(at.x + 0.5 - target.x, at.z + 0.5 - target.z) >= back) break;
  }
  return { x: at.x + 0.5, z: at.z + 0.5 };
}
