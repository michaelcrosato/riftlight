// Types for riftlight.mjs (Riftlight's 52in1 head tags), for the tests that read them.

/** One way to play together in `hub:multiplayer`: where, how (a shared world's or one device's), and how many. */
export interface RiftlightWay {
  readonly where: string;
  readonly how?: string;
  readonly players: string;
}
export const MULTIPLAYER: readonly RiftlightWay[];
/** Whether a way to play is online, a session's. */
export function isOnline(way: RiftlightWay): boolean;
export const DEFAULT_MODE: string;
/** A mode's word in the per-mode card tags (`hub:session-goal-WORD`). */
export function modeWord(way: RiftlightWay): string;
export const CATALOGUE: {
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly themeColor: string;
  readonly type: string;
  readonly genre: string;
  readonly controls: string;
  readonly dualsense: string;
  readonly harness: string;
  readonly webgpu: string;
};
export const TAGS: readonly string[];
export const CARD: Readonly<Record<string, { readonly goal: string; readonly howto: string }>>;
export const ROUND_MINUTES: number;
export function multiplayerTag(): string;
/** The page's catalogue tags, session tags and moments (`hub:moment` contents). */
export function riftlightTags(options?: { model?: string; effort?: string; moments?: readonly string[] }): {
  tags: Record<string, string | undefined>;
  session: Record<string, string>;
  moments: readonly string[];
};
