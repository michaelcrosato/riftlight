/** Engine hotkeys (tooling / review), configurable through `EngineOptions.debugKeys`. */
export type DebugAction = 'mode' | 'resolution' | 'debug' | 'nextLook' | 'prevLook' | 'mute';

export type DebugKeyMap = Record<DebugAction, readonly string[]>;

/** The defaults: P Pixel/Raw · R resolution · ` debug panel · ] / [ looks · M mute. */
export const DEFAULT_DEBUG_KEYS: DebugKeyMap = {
  mode: ['KeyP'],
  resolution: ['KeyR'],
  debug: ['Backquote'],
  nextLook: ['BracketRight'],
  prevLook: ['BracketLeft'],
  mute: ['KeyM'],
};

/**
 * `EngineOptions.debugKeys`: `false` disables every hotkey; an object overrides single
 * actions (a key code, a list of codes, or `null` / `[]` to disable that one action).
 *
 *   debugKeys: { resolution: 'F2', mute: null }   // R freed for the game, no mute key
 */
export type DebugKeysOption = Partial<Record<DebugAction, string | readonly string[] | null>> | false;

export function resolveDebugKeys(option?: DebugKeysOption): DebugKeyMap {
  if (option === false) return { mode: [], resolution: [], debug: [], nextLook: [], prevLook: [], mute: [] };
  const out = { ...DEFAULT_DEBUG_KEYS };
  for (const [action, keys] of Object.entries(option ?? {}) as [DebugAction, string | readonly string[] | null][]) {
    if (!(action in out)) continue;
    out[action] = keys === null ? [] : typeof keys === 'string' ? [keys] : [...keys];
  }
  return out;
}
