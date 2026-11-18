/**
 * Engine World's controls on every device: one table (`WORLD_CONTROLS`, every room's
 * `Game.controls`) that the engine names and draws for the input used last (`input.device`) in
 * the player's button style, the codes each action reads (`WORLD_KEYS`), the phone's buttons
 * (`WORLD_TOUCH_BUTTONS`) and `{key:action}` in the World's own words (`keyText`).
 *
 *   action        keyboard / mouse      pad (PlayStation · Xbox)     touch
 *   move          WASD / arrows         left stick / d-pad           stick
 *   jump          Space                 Cross · A                    JUMP
 *   attack        J                     Square · X                   HIT
 *   crouch        C / Ctrl              Circle · B                   DUCK
 *   grab          F (hold)              Triangle · Y                 GRAB
 *   menu          Esc                   Options · Menu               ≡
 *   rooms         G                     Create · View                GO
 *   guide         H                     R3 (or the touchpad) · RS    ?
 *   tweak, card   T, I                  in the menu                  in the menu, a tap on the card
 *
 * Circle (B) means back in every panel and a sideways swipe closes one; the rooms' own actions
 * (the Time Lab's rewind, the Gallery's shelves, the car) are here too, so their prompts follow
 * the device like the shell's.
 */
import type { ControlTable, Engine, TouchButton } from '../engine';
import { lang } from '../riftlight/lang';

export const WORLD_CONTROLS = {
  // the hero (the engine's KEYMAP)
  move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' },
  jump: { key: 'Space', pad: 'PadA', touch: 'JUMP' },
  attack: { key: 'KeyJ', pad: 'PadX', touch: 'HIT' },
  crouch: { key: 'KeyC', pad: 'PadB', touch: 'DUCK' },
  grab: { key: 'KeyF', pad: 'PadY', touch: 'GRAB' },
  prone: { key: 'KeyZ', pad: 'PadLB', touch: 'PRONE' },
  // the shell
  menu: { key: 'Escape', pad: 'PadStart', touch: '≡' },
  rooms: { key: 'KeyG', pad: 'PadBack', touch: 'GO' },
  guide: { key: 'KeyH', pad: 'PadR3', touch: '?' },
  tweak: { key: 'KeyT', pad: 'PadStart', touch: '≡' },
  card: { key: 'KeyI', touch: 'TouchTap' },
  back: { key: 'Escape', pad: 'PadB', touch: 'TouchSwipe' },
  change: { key: 'Arrows', pad: 'DPad', touch: 'TouchTap' },
  // the rooms' own
  skip: { key: 'Space', pad: 'PadA', touch: 'TouchTap' },
  rewind: { key: 'KeyR', pad: 'PadLT', touch: '<<' },
  prev_item: { key: 'KeyQ', pad: 'PadLB', touch: '<' },
  next_item: { key: 'KeyE', pad: 'PadRB', touch: '>' },
  prev_shelf: { key: 'Comma', pad: 'PadLT', touch: '<<' },
  next_shelf: { key: 'Period', pad: 'PadRT', touch: '>>' },
  throttle: { key: 'KeyW', pad: 'PadRT', touch: 'TouchStick' },
  brake: { key: 'KeyS', pad: 'PadLT', touch: 'TouchStick' },
  handbrake: { key: 'Space', pad: 'PadA', touch: 'BRAKE' },
  exit: { key: 'KeyC', pad: 'PadB', touch: 'EXIT' },
  orbit: { key: 'DragOrQE', pad: 'PadRStick', touch: 'TouchDrag' },
  turn: { key: 'MouseOrQE', pad: 'PadRStick', touch: 'TouchDrag' },
  tab: { key: 'Tab', pad: 'PadRB' },
  place: { key: 'Enter', pad: 'PadX', touch: 'TouchTap' },
  undo: { key: 'Backspace', pad: 'PadB', touch: 'UNDO' },
  spin: { key: 'KeyY', pad: 'PadY', touch: 'TURN' },
  def_view: { key: 'Tab', pad: 'PadL3', touch: 'DEF' },
  hold: { key: 'KeyE', pad: 'PadRT', touch: 'HOLD' },
} as const satisfies ControlTable;

export type WorldAction = keyof typeof WORLD_CONTROLS;

/**
 * The codes that do each action (the keys beside the pad's): what the shell and the rooms read.
 * A touch button presses a key of its own row.
 */
export const WORLD_KEYS = {
  menu: ['Escape', 'PadStart'],
  rooms: ['KeyG', 'F2', 'PadBack'],
  guide: ['KeyH', 'F1', 'PadR3', 'PadTouchpad'],
  tweak: ['KeyT'],
  card: ['KeyI'],
  skip: ['Space', 'Enter', 'PadA'],
  rewind: ['KeyR', 'PadLT'],
  prev_item: ['KeyQ', 'PadLB'],
  next_item: ['KeyE', 'PadRB'],
  prev_shelf: ['Comma', 'PadLT'],
  next_shelf: ['Period', 'PadRT'],
  handbrake: ['Space', 'PadA'],
  exit: ['KeyC', 'PadB'],
} as const satisfies Partial<Record<WorldAction, readonly string[]>>;

/** Pad buttons the shell and the rooms take from the hero (`KEYMAP`'s wave on Create, prone and lie on L1 / R1 in the Gallery): their presses never reach it. */
export const SHELL_PAD = ['PadBack', 'PadR3', 'PadTouchpad'] as const;

/** The room's touch slots: codes no key has, so a room reads them beside its keys (`WORLD_KEYS`). */
export const TOUCH_SLOTS = ['TouchSlot1', 'TouchSlot2', 'TouchSlot3'] as const;
export type TouchSlot = (typeof TOUCH_SLOTS)[number];

/**
 * The phone's buttons (`EngineOptions.touchButtons`): the hero's moves in a cluster at the
 * bottom right (JUMP the big one), the menu, the room list and the guide along the top left, and
 * three slots over the joystick that a room fills with its own actions (`RoomLogic.touch`: the
 * Time Lab's REWIND, the Gallery's < >, the car's EXIT), hidden in every other room. Positions are
 * CSS pixels from a corner, so a tap target keeps its size at any art scale.
 */
export const WORLD_TOUCH_BUTTONS: readonly TouchButton[] = [
  { label: 'JUMP', code: 'Space', at: { x: 60, y: 64, size: 76 } },
  { label: 'HIT', code: 'KeyJ', at: { x: 150, y: 52, size: 54 } },
  { label: 'GRAB', code: 'KeyF', at: { x: 52, y: 152, size: 54 } },
  { label: 'DUCK', code: 'KeyC', at: { x: 128, y: 126, size: 48 } },
  { label: '≡', code: 'Escape', at: { x: 26, y: 26, size: 44, corner: 'top-left' } },
  { label: 'GO', code: 'KeyG', hint: 'rooms', at: { x: 76, y: 26, size: 44, corner: 'top-left' } },
  { label: '?', code: 'KeyH', hint: 'how', at: { x: 126, y: 26, size: 44, corner: 'top-left' } },
  ...TOUCH_SLOTS.map((code, i) => ({ label: '', code, at: { x: 40, y: 214 + i * 52, size: 46 } })),
];

export { touchFloor } from '../riftlight/showcase/hints';

/** Codes the World's base buttons press, each with its label and hint (a room relabels or hides them). */
export const BASE_TOUCH: Readonly<Record<string, { readonly label: string; readonly hint: string }>> = Object.fromEntries(
  WORLD_TOUCH_BUTTONS.filter((b) => !b.code.startsWith('TouchSlot')).map((b) => [b.code, { label: b.label, hint: b.hint ?? '' }]),
);

/** The control that does `action` on the device in use, named as `{key:action}` names it (in the game's language when it has the name). */
export function controlText(engine: Engine | null, action: string): string {
  if (!engine) return (WORLD_CONTROLS as ControlTable)[action]?.key ?? action;
  return engine.controls.label(action, lang());
}

/**
 * The World's words with `{key:action}` filled in for the device in use ("Hold {key:rewind} to
 * rewind" → "Hold R to rewind", "Hold L2 to rewind", "Hold REWIND to rewind"). The World stays
 * English (docs/WORLD.md); the names of keys and buttons are the game's lines.
 */
export function keyText(engine: Engine | null, text: string): string {
  // a label in capitals has its tags in capitals too ({KEY:ROOMS})
  return /\{key:/i.test(text) ? text.replace(/\{key:([a-z_]+)\}/gi, (_, a: string) => controlText(engine, a.toLowerCase())) : text;
}
