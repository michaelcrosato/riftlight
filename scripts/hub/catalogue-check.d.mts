// Types for the parts of catalogue-check.mjs (52in1's checker, AI Hub Catalogue v1) that tests read.
/** Whether a control opens with keys the Couch draws as keycaps ("WASD or arrows to move" does). */
export function opensWithKeys(control: string): boolean;
export function readMultiplayer(text: string): { modes: { where: string; play: string | null; seats: [number, number]; key: string }[]; problems: string[] };
export function readMoments(texts: readonly string[]): { moments: { id: string; verb: string; seconds: number; goal: string }[]; problems: string[] };
/** One problem the checker found: an error fails the page, a warning is advice. */
export interface PageProblem {
  level: 'error' | 'warning';
  text: string;
}
/** A page's HTML as 52in1's catalogue reads it (`folder`: a folder game's files, by path; null, the default: a game in one file). */
export function checkPage(html: string, options?: { folder?: { files: Set<string> } | null; parse?: boolean; where?: string }): { fields: Record<string, string | string[] | null>; problems: PageProblem[]; checks: number };
/** The catalogue's words: `hub:tags`, the online modes (a session's), the local ones (the game's own menu), `hub:dualsense`'s extras. */
export const TAGS: readonly string[];
export const MODES: readonly string[];
export const LOCAL: readonly string[];
export const DUALSENSE: readonly string[];
