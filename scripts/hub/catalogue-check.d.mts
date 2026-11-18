// Types for the parts of catalogue-check.mjs (52in1's checker, AI Hub Catalogue v1) that tests read.
export const TAGS: readonly string[];
export const DUALSENSE: readonly string[];
export const CATALOGUE_TAGS: readonly string[];
export const SESSION_TAGS: readonly string[];
export const LIMITS: { readonly controls: number; readonly sessionGoal: number; readonly sessionHowto: number };
/** Whether a control opens with keys the Couch draws as keycaps ("WASD or arrows to move" does). */
export function opensWithKeys(control: string): boolean;
export function readMultiplayer(text: string): { modes: { where: string; play: string | null; seats: [number, number]; key: string }[]; problems: string[] };
export function readMoments(texts: readonly string[]): { moments: { id: string; verb: string; seconds: number; goal: string }[]; problems: string[] };
