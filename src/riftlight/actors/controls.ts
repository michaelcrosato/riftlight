import type { Control } from '../../engine/controls';
import type { DebugKeyChanges } from '../../engine/debugKeys';
import type { TouchButton } from '../../engine/TouchControls';

/**
 * The hero controller's actions as tokens, not keys: `HeroController` asks its input for
 * `consumeAny(HERO_KEYS.dodge)`, and the input says which keys do it. The game has one key map
 * (game/controls.ts `KEYS`, `heroCodes`): the shell hands the controller its intent
 * (wire/hero.ts `IntentInput`), the Arena the engine's input through that map (`HeroKeysInput`).
 * Slot 0..3 are the skill bar, 4 the Arena's fifth slot. Arrays are compared by identity
 * (save-states name them: `attack`, `dodge`, `slot:i`).
 */
export const HERO_KEYS = {
  attack: ['attack'],
  dodge: ['dodge'],
  slots: [['slot:0'], ['slot:1'], ['slot:2'], ['slot:3'], ['slot:4']],
} as const;

/**
 * One action's control for a prompt: the first of `codes` that isn't a pad button (a key or a
 * mouse button), the first pad button, and the label of the touch button in `touch` that presses
 * one of them (none when no button does). For a lab with keys of its own (the Level Lab).
 */
export function controlOf(codes: readonly string[], touch: readonly TouchButton[] = []): Control {
  const key = codes.find((c) => !c.startsWith('Pad'));
  if (!key) throw new Error(`controlOf: no key in ${codes.join(', ')}`);
  const pad = codes.find((c) => c.startsWith('Pad'));
  const button = touch.find((b) => codes.includes(b.code));
  return { key, ...(pad ? { pad } : {}), ...(button ? { touch: button.label } : {}) };
}

/** R is a skill key: the engine's resolution hotkey (on with ?debug=1) moves to F2 (`rebindDebugKeys`). */
export const HERO_DEBUG_KEYS: DebugKeyChanges = { resolution: 'F2' };
