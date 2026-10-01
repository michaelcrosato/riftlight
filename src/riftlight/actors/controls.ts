import type { TouchButton } from '../../engine/TouchControls';
import type { DebugKeysOption } from '../../engine/debugKeys';

/** Virtual key codes the mouse buttons press (MouseAim feeds them into `ctx.input`). */
export const MOUSE_LEFT = 'MouseLeft';
export const MOUSE_RIGHT = 'MouseRight';

/**
 * The hero's ARPG key map, as data. Slot 0 is the basic attack combo; slots 1..5 are the
 * skill bar. W is movement (WASD), so the bar is RMB/K, Q, E, R, F (1..4 also work).
 */
export const HERO_KEYS = {
  attack: [MOUSE_LEFT, 'KeyJ'],
  dodge: ['Space'],
  slots: [
    [MOUSE_RIGHT, 'KeyK'],
    ['KeyQ', 'Digit1'],
    ['KeyE', 'Digit2'],
    ['KeyR', 'Digit3'],
    ['KeyF', 'Digit4'],
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

/**
 * Suggested gamepad mapping (assign to `input.gamepadButtons`): X attacks, A dodges, B / Y /
 * LB / RB are skills 1–4, RT the fifth. The right stick aims (it arrives as pointer movement).
 */
export const HERO_GAMEPAD_BUTTONS: Readonly<Record<number, string>> = {
  0: 'Space',
  1: 'KeyK',
  2: 'KeyJ',
  3: 'KeyQ',
  4: 'KeyE',
  5: 'KeyR',
  7: 'KeyF',
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
};

/** R is a skill key: the engine's resolution toggle moves to F2 (the shell passes this as `debugKeys`). */
export const HERO_DEBUG_KEYS: DebugKeysOption = { resolution: 'F2' };
