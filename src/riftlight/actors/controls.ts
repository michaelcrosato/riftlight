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
 * aims (it arrives as pointer movement).
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
