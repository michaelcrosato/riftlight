import type { Control, ControlTable } from '../../engine/controls';
import type { TouchButton } from '../../engine/TouchControls';
import type { DebugKeyChanges } from '../../engine/debugKeys';

/** The engine's keys for the mouse buttons on the canvas (`MOUSE_BUTTONS` in engine/input.ts). */
export const MOUSE_LEFT = 'MouseLeft';
export const MOUSE_RIGHT = 'MouseRight';

/**
 * The hero's ARPG key map, as data: keys and the engine's pad codes (`GAMEPAD_BUTTONS`) side by
 * side. Slot 0 is the basic attack combo; slots 1..5 are the skill bar. W is movement (WASD), so
 * the bar is RMB/K, Q, E, R, F (1..4 also work); on a pad X (Square) attacks, A (Cross) dodges,
 * B / Y / LB / RB (Circle, Triangle, L1, R1) are skills 1-4 and RT (R2) the fifth. The right stick
 * aims through `input.lookAxis`, along itself with the 18° aim assist (actors/aim.ts `stickAim`).
 */
export const HERO_KEYS = {
  attack: [MOUSE_LEFT, 'KeyJ', 'PadX'],
  dodge: ['Space', 'PadA'],
  slots: [
    [MOUSE_RIGHT, 'KeyK', 'PadB'],
    ['KeyQ', 'Digit1', 'PadY'],
    ['KeyE', 'Digit2', 'PadLB'],
    ['KeyR', 'Digit3', 'PadRB'],
    ['KeyF', 'Digit4', 'PadRT'],
  ],
} as const;

/**
 * One action's control for a prompt: the first of `codes` that isn't a pad button (a key or a
 * mouse button), the first pad button, and the label of the touch button in `touch` that presses
 * one of them (none when no button does).
 */
export function controlOf(codes: readonly string[], touch: readonly TouchButton[] = []): Control {
  const key = codes.find((c) => !c.startsWith('Pad'));
  if (!key) throw new Error(`controlOf: no key in ${codes.join(', ')}`);
  const pad = codes.find((c) => c.startsWith('Pad'));
  const button = touch.find((b) => codes.includes(b.code));
  return { key, ...(pad ? { pad } : {}), ...(button ? { touch: button.label } : {}) };
}

/**
 * `HERO_KEYS` as a control table (`Game.controls`), for a game that plays the hero with it (the
 * Arena): a line's `{key:dodge}` there names what dodges there (Space, pad Cross), not the shell's
 * buttons (game/controls.ts `CONTROLS`). `touch` is the page's touch buttons. The bar's slots are
 * `skill1`..`skill5` (slot 0, RMB / K / Circle, is `skill1`).
 */
export function heroControls(touch: readonly TouchButton[] = []): ControlTable {
  const table: Record<string, Control> = {
    move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' },
    attack: controlOf(HERO_KEYS.attack, touch),
    dodge: controlOf(HERO_KEYS.dodge, touch),
  };
  HERO_KEYS.slots.forEach((codes, i) => (table[`skill${i + 1}`] = controlOf(codes, touch)));
  return table;
}

/** Labels of the skill bar (HUD). */
export const SLOT_LABELS = ['RMB', 'Q', 'E', 'R', 'F'] as const;

/**
 * Suggested on-screen buttons for phones (the shell passes them as
 * `EngineOptions.touchButtons`): attack, dodge, and the skill bar. Aim on touch is
 * automatic (the nearest enemy ahead), so no second stick is needed.
 */
export const HERO_TOUCH_BUTTONS: readonly TouchButton[] = [
  { label: 'A', code: 'KeyJ', hint: 'attack' },
  { label: 'B', code: 'Space', hint: 'dodge' },
  { label: '1', code: 'KeyK', hint: 'skill' },
  { label: '2', code: 'KeyQ', hint: 'skill' },
  { label: '3', code: 'KeyE', hint: 'skill' },
  { label: '4', code: 'KeyR', hint: 'skill' },
];

/** R is a skill key: the engine's resolution hotkey (on with ?debug=1) moves to F2 (`rebindDebugKeys`). */
export const HERO_DEBUG_KEYS: DebugKeyChanges = { resolution: 'F2' };
