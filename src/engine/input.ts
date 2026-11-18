/**
 * Standard-mapping gamepad buttons → the codes they press: `Pad*` codes, one scheme for every
 * game, so a game binds a pad button beside its keys (`KEYMAP.jump: ['Space', 'PadA']`) and a menu
 * can tell Cross (confirm) from Space. Indices follow the W3C "standard" layout, PlayStation names
 * in brackets: 0 A (Cross) · 1 B (Circle) · 2 X (Square) · 3 Y (Triangle) · 4 LB (L1) · 5 RB (R1)
 * · 6 LT (L2) · 7 RT (R2) · 8 View (Create) · 9 Menu (Options) · 10 L3 · 11 R3 · 12–15 the
 * d-pad, which presses the arrow keys · 17 the DualSense touchpad's press (Chrome, Edge). 16, the
 * PS / Xbox / Home button, is never read (`HOME_BUTTON`): it is the system's or the host's, and
 * View and Menu press as they are let go, unless held together (`HOST_CHORD`, the host's).
 * Change `input.gamepadButtons` to remap.
 */
export const GAMEPAD_BUTTONS: Readonly<Record<number, string>> = {
  0: 'PadA',
  1: 'PadB',
  2: 'PadX',
  3: 'PadY',
  4: 'PadLB',
  5: 'PadRB',
  6: 'PadLT',
  7: 'PadRT',
  8: 'PadBack',
  9: 'PadStart',
  10: 'PadL3',
  11: 'PadR3',
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
  17: 'PadTouchpad',
};

/** The standard mapping's home button (PS, Xbox, Home): never read, even when `gamepadButtons` maps it. */
export const HOME_BUTTON = 16;

/** The kind of input used last (`input.device`): the keyboard and mouse, a gamepad, or a touch screen. */
export type InputDevice = 'keyboard' | 'pad' | 'touch';
export const INPUT_DEVICES: readonly InputDevice[] = ['keyboard', 'pad', 'touch'];

/**
 * A quick one-finger swipe on the canvas presses one of these, once (never held): menus,
 * dialogues and notifications read them to dismiss (`MenuInput` turns them into `swipe` events).
 */
export const SWIPE_KEYS = { left: 'SwipeLeft', right: 'SwipeRight', up: 'SwipeUp', down: 'SwipeDown' } as const;
export type SwipeDirection = keyof typeof SWIPE_KEYS;

/** A swipe lasts at most `ms` milliseconds and travels at least `share` of the canvas's short side. */
export const SWIPE = { ms: 350, share: 0.08 } as const;

/**
 * The swipe a one-finger touch made (`dx`, `dy`: the CSS pixels it travelled, screen y down;
 * `ms`: how long it was down; `short`: the canvas's short side), or null for a tap, a slow drag
 * or one too short.
 */
export function swipeDirection(dx: number, dy: number, ms: number, short: number): SwipeDirection | null {
  if (!(ms >= 0 && ms <= SWIPE.ms) || !(short > 0)) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < short * SWIPE.share) return null;
  return ax >= ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

/** A rumble (`input.rumble`): the heavy low motor (`strong`) and the light high one (`weak`), 0..1, for `ms` milliseconds. */
export interface Rumble {
  strong?: number;
  weak?: number;
  ms?: number;
}

/** The radial stick deadzone the engine reads sticks with: about what console games keep (0.12 to 0.18). */
export const GAMEPAD_DEADZONE = 0.15;
/** How far an analog trigger must go before it counts as the pad being used (`device`). */
const TRIGGER_USE = 0.3;
/**
 * How far a stick must lean (after its deadzone) to count as used (`device`), and to move the
 * player while a movement key is held off the pad (`moveAxis`): a stick resting or jittering
 * just past its deadzone does neither.
 */
const STICK_USE = 0.25;
/** How far a stick must move in a poll, past `STICK_USE`, to count as used again (a stick held still is not a new use). */
const STICK_MOVE = 0.05;
/** How far a trigger first seen part-way must move before it reads (some pads report half until first pulled). */
const TRIGGER_WAKE = 0.05;
/** How far the mouse travels (CSS pixels) before it counts as used (`device`): a bumped desk does not. */
const MOUSE_USE = 6;

/**
 * A DualSense's touchpad gestures (`input.touchpad`): a quick swipe presses a direction, a tap
 * (a touch, not the pad's click, which is `PadTouchpad`) presses `tap`. Once each, recorded.
 */
export const TOUCHPAD_KEYS = { left: 'PadTouchpadLeft', right: 'PadTouchpadRight', up: 'PadTouchpadUp', down: 'PadTouchpadDown', tap: 'PadTouchpadTap' } as const;
export type TouchpadGesture = keyof typeof TOUCHPAD_KEYS;

/**
 * Touchpad gestures, in the pad's height (it is about twice as wide as it is tall): a swipe lasts
 * at most `swipeS` seconds and travels `swipe` of it; a tap at most `tapS` seconds and `tap` of it.
 */
export const TOUCHPAD = { swipeS: 0.5, swipe: 0.4, tapS: 0.3, tap: 0.08 } as const;

/**
 * The gesture a one-finger touch on the DualSense's touchpad made (`dx`, `dy`: how far it went
 * in the pad's 0..1 coordinates, y down; `seconds`: how long it was down), or null.
 */
export function touchpadGesture(dx: number, dy: number, seconds: number): TouchpadGesture | null {
  const px = Math.abs(dx * 2); // the pad's width is about twice its height
  const py = Math.abs(dy);
  const far = Math.max(px, py);
  if (seconds <= TOUCHPAD.swipeS && far >= TOUCHPAD.swipe) return px >= py ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  if (seconds <= TOUCHPAD.tapS && far < TOUCHPAD.tap) return 'tap';
  return null;
}

/**
 * Motion aim (`input.motion`): turns slower than `still` degrees a second are a hand holding still;
 * past it the camera turns `pixels` pointer pixels per degree the controller turns (at sensitivity
 * 1), and the aim stick leans as 52in1's own Motion aim leans it (`floor` at once, all the way at
 * `full` degrees a second past still).
 */
export const MOTION_AIM = { still: 4, pixels: 8, floor: 0.2, full: 150 } as const;

/** Where a DualSense's motion and touchpad come from (the engine's: 52in1's `AIHubSettings.dualsense`). */
export interface DualSenseInput {
  /** The player lets games read the controller's motion. */
  readonly motion: boolean;
  /** The player lets games read the touchpad. */
  readonly touchpad: boolean;
  /**
   * How fast the controller turns, degrees a second (`x` tips its front up, `y` turns it left, `z`
   * rolls it left). While a game reads it, 52in1's own Motion aim leaves the stick alone; a game
   * that stops reading it (its own motion aim turned off) has 52in1's back on the stick half a
   * second later, if the player has it on.
   */
  gyro(): { readonly x: number; readonly y: number; readonly z: number } | null;
  /** The fingers on the touchpad (at most two; `x`, `y` 0..1 from its top left). */
  touches(): readonly { readonly id: number; readonly x: number; readonly y: number }[] | null;
}

/** The parts of the Gamepad API that Input reads (tests can pass plain objects). */
export interface GamepadLike {
  readonly connected?: boolean;
  readonly mapping?: string;
  /** Its slot in `navigator.getGamepads()` (the position in the list when left out). */
  readonly index?: number;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value?: number }[];
  /** Rumble (`input.rumble`): Chrome, Edge and Safari have it; Firefox and some pads don't. */
  readonly vibrationActuator?: { playEffect?(type: string, params: Record<string, number>): Promise<unknown> | unknown } | null;
}

/**
 * Radial deadzone with rescaling: inside `deadzone` reads 0, the rim reads 1, and the
 * direction is kept (no square-gate snapping to the axes).
 */
export function applyDeadzone(x: number, y: number, deadzone = GAMEPAD_DEADZONE): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len <= deadzone || len === 0) return { x: 0, y: 0 };
  const k = Math.min(1, (len - deadzone) / (1 - deadzone)) / len;
  return { x: x * k, y: y * k };
}

/** How long a queued press stays consumable, in seconds of game time. */
export const PRESS_WINDOW = 0.15;

/**
 * What the game could read from input in one frame (a recorded frame, see src/engine/replay.ts).
 * Optional fields are left out when empty or zero; `held` and `pointer` also when unchanged
 * from the frame before.
 */
export interface InputFrame {
  /** Real seconds this frame lasted (game time follows from it). */
  dt: number;
  /** Keys held, keyboard and gamepad buttons together, sorted. */
  held?: string[];
  /** Keys pressed since the frame before (a tap can be pressed and not held). */
  pressed?: string[];
  /** The touch joystick and the gamepad's left stick (after its deadzone). */
  analog?: [number, number];
  pad?: [number, number];
  /** Pointer movement (CSS pixels) and wheel ticks this frame. */
  delta?: [number, number];
  wheel?: number;
  /** Pointer position (normalised device coordinates), over the canvas (1/0), buttons (`mouseButtons`: what `held` says). */
  pointer?: [number, number, number, number];
  /** The analog triggers (`triggers`: left, right; 0..1), while either is pressed. */
  trig?: [number, number];
  /** The gamepad's right stick (`lookAxis`, after its deadzone; y = up), while it is tilted. */
  look?: [number, number];
  /** The controller's turn by motion aim this frame (`motionTurn`, degrees), while it turns. */
  turn?: [number, number];
  /**
   * Each pad on its own (`padPlayers`, couch co-op: `player(slot)`), when any of them changed:
   * one `PadFrame` per connected pad. Left out, every pad is as the frame before.
   */
  pads?: PadFrame[];
  /** Presses on each pad on its own this frame (`padPlayers`): [slot, ...codes]. */
  padPressed?: [number, ...string[]][];
  /** Pads that joined this frame (`joinWith`, `joinedNow`): their slots. */
  join?: number[];
  /** Whether a gamepad is connected (`gamepadConnected`), when that changes. */
  gamepad?: boolean;
  /** The input used last (`device`), when that changes; a recording without it was made on the keyboard. */
  device?: InputDevice;
  /** Whether the pointer is a touch (`pointer.touch`), when that changes. */
  touch?: boolean;
  /** Pointer buttons pressed (1) and let go (0) this frame, in order, each where the pointer was (`buttonEvents`). */
  clicks?: [string, 0 | 1, number, number][];
  /** Data from outside the canvas delivered this frame (`send()`): a DOM widget's value, a save read from storage. */
  commands?: unknown[];
  /**
   * Ran in the same task as the frame before (frames of one `step(n)` call): no promise
   * callbacks ran between them. A replay waits for them before every other frame.
   */
  sync?: true;
}

/** What input a later frame still reads, as data (`engine.snapshot()`): keys held, presses not yet used and how old they are, the pointer. */
export interface InputState {
  readonly held: readonly string[];
  /** Queued presses: [key, seconds of game time since it was pressed]. */
  readonly queued: readonly (readonly [string, number])[];
  readonly pointer: readonly [number, number, number, number];
  readonly gamepad: boolean;
  /** The input used last (left out by snapshots made before it was kept: the keyboard). */
  readonly device?: InputDevice;
  /** Data sent (`send`) and not yet delivered: the next frame that runs delivers it. */
  readonly outbox: readonly unknown[];
  /** Each pad on its own (`padPlayers`): [slot, held, queued presses [code, age]] (left out: none). */
  readonly pads?: readonly (readonly [number, readonly string[], readonly (readonly [string, number])[]])[];
  /** The pads that play as players of their own (`joined`; left out: none). */
  readonly joined?: readonly number[];
}

/** What the frame before held, for `snapshot()` to leave out what did not change. */
export interface SnapshotMemory {
  held: string;
  pointer: string;
  gamepad?: boolean;
  device?: InputDevice;
  touch?: boolean;
  /** Each pad on its own as last recorded (`InputFrame.pads`). */
  pads?: string;
}

/**
 * A pad on its own in a recording (`InputFrame.pads`): its slot, the codes it holds (sorted), its
 * left stick (x, y forward), its right stick (x, y up), both after the deadzone, and its triggers.
 */
export type PadFrame = [slot: number, held: string[], lx: number, ly: number, rx: number, ry: number, lt: number, rt: number];

/** The pads read on their own (`player(slot)`): the Gamepad API's first four slots. */
export const MAX_PADS = 4;

/** The parts of `Input` a player's actions are read from: the merged input (player 1's) or one pad's own (`PadPlayer`). */
export interface KeyReader {
  isDown(...codes: string[]): boolean;
  anyDown(codes: readonly string[]): boolean;
  wasPressed(...codes: string[]): boolean;
  consumePress(...codes: string[]): boolean;
  consumeAny(codes: readonly string[]): boolean;
  moveAxis(): { x: number; y: number };
  readonly padAxis: { readonly x: number; readonly y: number };
  readonly lookAxis: { readonly x: number; readonly y: number };
  readonly triggers: { readonly left: number; readonly right: number };
}

/**
 * One pad on its own (`input.player(slot)`, couch co-op), read the way the merged input is: its
 * buttons' `Pad*` codes (the d-pad's arrows too) held, pressed this frame and queued for fixed-step
 * code (`consumePress`, the same press window), its sticks after the deadzone and its triggers. Only
 * while `input.padPlayers` is on; recorded per pad, so a replay reads the same.
 */
export class PadPlayer implements KeyReader {
  /** A pad is in this slot. */
  connected = false;
  /** Left stick after the deadzone, -1..1 (y = forward). */
  readonly padAxis = { x: 0, y: 0 };
  /** Right stick after the deadzone, -1..1 (y = up). */
  readonly lookAxis = { x: 0, y: 0 };
  /** The analog triggers, 0..1. */
  readonly triggers = { left: 0, right: 0 };
  /** @internal Codes held now. */
  readonly held = new Set<string>();
  /** @internal Codes pressed this frame. */
  readonly pressed = new Set<string>();
  /** @internal Queued presses → the game time they happened at. */
  readonly queued = new Map<string, number>();
  /** @internal Codes that read as up until they are let go (the press that joined). */
  readonly latched = new Set<string>();

  constructor(
    /** Its `navigator.getGamepads()` slot. */
    readonly slot: number,
    private readonly input: Pick<Input, 'now' | 'pressWindow'>,
  ) {}

  isDown(...codes: string[]): boolean {
    return this.anyDown(codes);
  }

  anyDown(codes: readonly string[]): boolean {
    for (const c of codes) if (this.held.has(c)) return true;
    return false;
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  consumePress(...codes: string[]): boolean {
    return this.consumeAny(codes);
  }

  consumeAny(codes: readonly string[]): boolean {
    let hit = false;
    for (const c of codes) {
      const t = this.queued.get(c);
      if (t === undefined) continue;
      this.queued.delete(c);
      if (this.input.now - t <= this.input.pressWindow) hit = true;
    }
    return hit;
  }

  /** -1..1 on each axis (x = right, y = forward): the left stick, else the d-pad. */
  moveAxis(): { x: number; y: number } {
    if (this.padAxis.x || this.padAxis.y) {
      const len = Math.hypot(this.padAxis.x, this.padAxis.y);
      return len > 1 ? { x: this.padAxis.x / len, y: this.padAxis.y / len } : { x: this.padAxis.x, y: this.padAxis.y };
    }
    const x = (this.held.has('ArrowRight') ? 1 : 0) - (this.held.has('ArrowLeft') ? 1 : 0);
    const y = (this.held.has('ArrowUp') ? 1 : 0) - (this.held.has('ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** @internal A press now (queued at the frame before's time, as the merged input's are). */
  press(code: string): void {
    this.pressed.add(code);
    this.queued.set(code, this.input.now);
  }

  /** @internal Gone: nothing held, sticks centred. */
  clear(): void {
    this.connected = false;
    this.held.clear();
    this.latched.clear();
    this.padAxis.x = this.padAxis.y = this.lookAxis.x = this.lookAxis.y = 0;
    this.triggers.left = this.triggers.right = 0;
  }

  /** @internal Gone, and every press it made forgotten too. */
  forget(): void {
    this.clear();
    this.queued.clear();
    this.pressed.clear();
  }

  /** @internal As a recording holds it (`PadFrame`). */
  frame(): PadFrame {
    return [this.slot, [...this.held].sort(), this.padAxis.x, this.padAxis.y, this.lookAxis.x, this.lookAxis.y, this.triggers.left, this.triggers.right];
  }
}

/**
 * Mouse buttons as key codes (`isDown('MouseLeft')`, `consumePress('MouseRight')`), each with
 * its `PointerEvent.buttons` bit, by `PointerEvent.button` (0 left, 1 middle, 2 right).
 */
export const MOUSE_BUTTONS: readonly (readonly [code: string, bit: number])[] = [
  ['MouseLeft', 1],
  ['MouseMiddle', 4],
  ['MouseRight', 2],
];
/** A finger on the canvas, as a key: held while one is down (not a mouse button, so a tap is not a click). */
export const TOUCH_KEY = 'Touch';

/** A pointer button pressed or let go (`Input.buttonEvents`): its key, and where the pointer was (normalised device coordinates). */
export interface ButtonEvent {
  readonly code: string;
  readonly down: boolean;
  readonly x: number;
  readonly y: number;
}

/**
 * Keyboard + pointer + gamepad input.
 * - Keys: held state, per-frame presses (`wasPressed`) and queued presses for fixed-step
 *   code (`consumePress`). Queued presses expire after `pressWindow` s of game time.
 * - Gamepads (standard mapping): the left stick feeds `moveAxis()` (radial deadzone), the
 *   right stick feeds the pointer delta (camera look) and `lookAxis` (aim), buttons press
 *   `Pad*` codes (`gamepadButtons`; Create and Options as they are let go, `HOST_CHORD`), the
 *   analog triggers read 0..1 (`triggers`). Polled once per frame by the engine (`beginFrame`).
 *   `rumble()` shakes the pad in use.
 * - `device`: the input used last (keyboard and mouse, pad, touch), from real use only: a pad
 *   that is merely connected changes nothing. Prompts and touch assists follow it.
 * - Pointer: accumulated movement per frame (while a button is held or the pointer is
 *   locked), wheel delta per frame, optional pointer lock (first-person). Mouse buttons on
 *   the canvas are keys too (`MOUSE_BUTTONS`: `MouseLeft`, `MouseRight`, `MouseMiddle`), and a
 *   finger is `Touch` (`TOUCH_KEY`), held and pressed like any other, so a click shorter than
 *   a frame is not lost.
 * - Commands (`send`): data from outside the canvas, delivered to the game at the next frame
 *   and recorded with it.
 * - `dispose()` removes every listener it added.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  /** Queued presses → the game time they happened at. */
  private readonly queued = new Map<string, number>();
  /** Keys held through gamepad buttons (merged into isDown). */
  private readonly padHeld = new Set<string>();
  /**
   * Pad buttons that were held when `release()` let go of everything: they read as up until they
   * are let go, so the press that opened a menu (or closed it) never presses again behind it.
   */
  private readonly padLatched = new Set<string>();
  /** Keys held when `release()` let go of everything: their auto-repeat holds nothing until they are let go. */
  private readonly keyLatched = new Set<string>();
  /**
   * The sticks (left, right) since `release()`: each reads centred until it goes back inside its
   * deadzone, so a stick still leaning from a run never steps a menu opened over it (nor turns on
   * behind it).
   */
  private readonly stickLatched = [false, false];
  private readonly listeners = new AbortController();
  /** Pointer movement this frame, in CSS pixels (drag or pointer lock). */
  readonly mouseDelta = { x: 0, y: 0 };
  /**
   * Where the pointer last was over the canvas, in normalised device coordinates (−1..1, y up:
   * `camera.rayAt(pointer.x, pointer.y, …)` turns it into a ray), and whether it is over it now.
   * Under pointer lock it is the screen's centre (the crosshair).
   */
  readonly pointer = { x: 0, y: 0, over: false, touch: false };
  /** Wheel ticks this frame (+1 = scroll down / zoom out). */
  wheel = 0;
  /** This frame's button presses and releases, in order (`buttonEvents`). */
  private _buttonEvents: ButtonEvent[] = [];
  /** Commands sent since the last frame began, and this frame's (`send`, `commands`). */
  private outbox: unknown[] = [];
  private _commands: unknown[] = [];
  private lockTarget: HTMLElement | null = null;
  /** When true, clicking the canvas requests pointer lock (first-person / free camera). */
  wantsPointerLock = false;
  /** Touch joystick, -1..1 per axis; overrides keys when active. */
  readonly analog = { x: 0, y: 0 };
  /** Gamepad left stick after the deadzone, -1..1 (y = forward). */
  readonly padAxis = { x: 0, y: 0 };
  /** Gamepad right stick after the deadzone, -1..1 (y = up): aim with it (it also turns the camera, as pointer movement). */
  readonly lookAxis = { x: 0, y: 0 };
  /** The analog triggers, 0..1 (L2 / LT, R2 / RT): a throttle, a brake, a bowstring. Pressed (as the browser says, or past half), they also press `PadLT` / `PadRT`. */
  readonly triggers = { left: 0, right: 0 };
  /**
   * A DualSense's motion and touchpad through 52in1 (the engine sets it from `AIHubSettings`; null
   * outside 52in1 and headless). Read only while a game asks (`motion.on`, `touchpad`), never during
   * a replay: what they do arrives as recorded input (pointer movement, the aim stick, presses).
   */
  dualsense: DualSenseInput | null = null;
  /**
   * Motion aim: while `on` (the engine keeps it at the player's setting for a game with
   * `settings: { motion: true }`), and the pad is the device in use, the DualSense's turns add to the
   * right stick's camera turn (`mouseDelta`: gyro × dt × `sensitivity`), to `motionTurn`, and (while
   * `lean`, the default) to the aim stick (`lookAxis`), as 52in1's own Motion aim would. Added to
   * the stick, never in its place. While on, the gyro is read on every poll (the pad in use or not),
   * so 52in1's own Motion aim leaves the stick alone and this sensitivity applies; while off nothing
   * is read, and 52in1's own Motion aim (if the player has it on) steers the right stick again half a
   * second later. A game that keeps an aim direction and turns it by `motionTurn` (a twin-stick's)
   * sets `lean` false: its stick then aims as the stick alone does.
   */
  readonly motion = { on: false, sensitivity: 1, lean: true };
  /**
   * How far the controller turned this frame by motion aim (`motion`, the pad in use), in degrees
   * past a still hand × `motion.sensitivity`, as `mouseDelta` turns (x right, y down): 0 otherwise.
   * Recorded (`InputFrame.turn`), so a game may turn its aim by it and still replay.
   */
  readonly motionTurn = { x: 0, y: 0 };
  /**
   * Read the DualSense's touchpad (a game that uses it turns this on): a quick swipe presses
   * `PadTouchpadLeft` / `Right` / `Up` / `Down` and a tap `PadTouchpadTap` (`TOUCHPAD_KEYS`), once,
   * recorded. Its click is the button `PadTouchpad`. Give each a button that does the same.
   */
  touchpad = false;
  /** The finger on the touchpad that may be a gesture (`touchpad`). */
  private pad1: { id: number; x0: number; y0: number; x: number; y: number; t: number; spoilt: boolean } | null = null;
  /** Two fingers or the touchpad's click were seen since the pad was last bare: nothing ending before it is bare again is a gesture. */
  private padMulti = false;
  /** True while any gamepad is connected (that alone never changes `device`). */
  gamepadConnected = false;
  /**
   * Couch co-op: read every pad on its own too (`player(slot)`), recorded per pad
   * (`InputFrame.pads`). Off (the default) nothing is read or recorded per pad.
   */
  padPlayers = false;
  /**
   * The pads that play as players of their own (couch co-op), by slot: they never drive the merged
   * input, player 1's (its keys, sticks, triggers, presses, `device`, `rumble`), only `player(slot)`.
   * A game adds a pad that joins (`joinWith` does it at once) and deletes one that leaves.
   */
  readonly joined = new Set<number>();
  /**
   * While set (and `padPlayers` is on), a pad pressing one of these codes joins (`joined`) before
   * its press reaches anything: a pad that has not joined and is not player 1's pad in use (the pad
   * is `device` and it is `padIndex`). The press that joins reads as up until let go, and the slot
   * is in `joinedNow` for that frame (recorded). Null: nobody joins.
   */
  joinWith: readonly string[] | null = null;
  /** Pads that joined this frame (`joinWith`; recorded, replayed). */
  get joinedNow(): readonly number[] {
    return this._joinedNow;
  }
  private _joinedNow: number[] = [];
  private readonly pads: readonly PadPlayer[] = Array.from({ length: MAX_PADS }, (_, i) => new PadPlayer(i, this));
  /**
   * How strongly `rumble()` shakes the pad, 0..1: the player's vibration setting (the engine keeps
   * it at `settings.vibration`). A host that scales rumbles itself (the AI Hub) does so on top.
   */
  vibration = 1;
  /**
   * Extra key codes whose browser default is blocked (arrows and Space always are): a game's
   * own F1 / F2 / Tab panels, so the browser's help page or focus change doesn't fire.
   */
  readonly preventKeys = new Set<string>();
  /** Gamepad button index → key code (defaults: GAMEPAD_BUTTONS). */
  gamepadButtons: Record<number, string> = { ...GAMEPAD_BUTTONS };
  /** Stick deadzone (radial, 0..1). */
  gamepadDeadzone = GAMEPAD_DEADZONE;
  /** Right stick look speed: pointer pixels per second at full tilt. */
  gamepadLookSpeed = 500;
  /** Game time (s) of the current frame; set by the engine through `beginFrame`. */
  now = 0;
  /**
   * True while a replay drives input (`engine.replay()`): keyboard, pointer and wheel events,
   * `setKey` / `setPointer` / `setButtons` / `addPointer` (touch buttons, scripts) and `send`
   * are ignored, and `playBefore` / `playAfter` set everything.
   */
  get playing(): boolean {
    return this._playing;
  }
  set playing(on: boolean) {
    this._playing = on;
    this.playedPad = false;
    this.playedDevice = 'keyboard'; // a recording that never says otherwise was made on the keyboard
    // the level's setup runs before the first played frame: it reads the recording's device, never
    // the live one (`playFrom` sets the device the recorded level began with)
    if (on) this._device = 'keyboard';
    if (on) {
      // the recording says which pads play on their own, and what they hold
      for (const p of this.pads) p.forget();
      this.joined.clear();
    }
    this.rumbleWant = null;
    if (on) this.outbox = []; // what was sent before a replay is not part of it
  }
  private _playing = false;
  private playedPad = false;
  private playedDevice: InputDevice = 'keyboard';
  private _device: InputDevice = 'keyboard';
  private _padIndex = -1;
  /** The pad used last as this frame's poll saw it (what `rumble` shakes). */
  private rumblePad: GamepadLike | null = null;
  /** Each pad's buttons, sticks and resting triggers at the poll before, by its index (what counts as using it). */
  private padSeen = new Map<number, PadSeen>();
  /** The pads `setGamepads` set (tests), polled instead of the browser's. */
  private fakePads: readonly (GamepadLike | null)[] | null = null;
  /** This frame's strongest rumble request. */
  private rumbleWant: Required<Rumble> | null = null;
  /** Mouse travel since another device was used, and where it last was (CSS pixels). */
  private mouseTravel = 0;
  private readonly mouseAt = { x: 0, y: 0, known: false };
  /** Queued presses older than this many seconds of game time are dropped. */
  pressWindow = PRESS_WINDOW;

  /** `target`: where keys are heard (the page's window); null listens to nothing (`Engine.headless`: input comes from `setKey`, `send`, a replay). */
  constructor(private readonly target: Window | null = window) {
    const signal = this.listeners.signal;
    if (!target) return;
    if (touchFirst()) this._device = 'touch'; // a phone or tablet: touch until something else is used
    target.addEventListener(
      'keydown',
      (e) => {
        if (isGameKey(e.code) || this.preventKeys.has(e.code)) e.preventDefault();
        if (this._playing) return;
        if (!typing(e)) this.use('keyboard'); // a phone's soft keyboard in a text field is not a keyboard picked up
        if (e.repeat && this.keyLatched.has(e.code)) return; // held through release(): up until let go
        this.keyLatched.delete(e.code);
        if (!e.repeat) this.press(e.code);
        this.held.add(e.code);
      },
      { signal },
    );
    target.addEventListener(
      'keyup',
      (e) => {
        this.keyLatched.delete(e.code);
        if (!this._playing) this.held.delete(e.code);
      },
      { signal },
    );
    target.addEventListener(
      'blur',
      () => {
        if (this._playing) return;
        // pointer buttons let go as events too: a UI mid-drag hears the release it would have
        for (const [code] of MOUSE_BUTTONS) this.button(code, false);
        this.button(TOUCH_KEY, false);
        this.held.clear();
        this.keyLatched.clear();
      },
      { signal },
    );
  }

  /**
   * Listen for pointer input on the game canvas. Only pointers that went down on the
   * canvas drive the camera (so a touch joystick doesn't orbit it). Two canvas touches
   * pinch to zoom (emitted as wheel ticks); one quick one-finger flick presses a swipe
   * (`SWIPE_KEYS`).
   */
  attachPointer(el: HTMLElement): void {
    const signal = this.listeners.signal;
    this.lockTarget = el;
    const active = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    /** The one finger down that may be a swipe: where and when it went down (a second finger makes it a pinch). */
    let flick: { id: number; x: number; y: number; t: number } | null = null;
    const spread = () => {
      const [a, b] = [...active.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    const place = (e: PointerEvent) => {
      if (this._playing) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      // under pointer lock (first person) the cursor is hidden and frozen: point at the crosshair
      const locked = document.pointerLockElement === el;
      this.pointer.x = locked ? 0 : ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = locked ? 0 : 1 - ((e.clientY - r.top) / r.height) * 2;
      this.pointer.over = true;
      this.pointer.touch = e.pointerType === 'touch';
      if (e.pointerType === 'mouse' && e.type === 'pointermove') this.mouseMoved(e.clientX, e.clientY);
      // a mouse button pressed or let go while another is held comes as a move that names it (a chord)
      if (e.type === 'pointermove' && e.pointerType !== 'touch' && e.button >= 0 && active.has(e.pointerId)) this.button(MOUSE_BUTTONS[e.button]?.[0], (e.buttons & (MOUSE_BUTTONS[e.button]?.[1] ?? 0)) !== 0);
    };
    el.addEventListener('pointermove', place, { signal });
    el.addEventListener('pointerdown', place, { signal });
    el.addEventListener('pointerup', place, { signal }); // where a button is let go
    // locked by the click that asked for it: point at the crosshair from now, not where it clicked
    document.addEventListener(
      'pointerlockchange',
      () => {
        if (document.pointerLockElement !== el || this._playing) return;
        this.pointer.x = this.pointer.y = 0;
        this.pointer.over = true;
      },
      { signal },
    );
    el.addEventListener('pointerleave', () => !this._playing && (this.pointer.over = false), { signal });
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (this._playing) return;
        this.use(e.pointerType === 'mouse' ? 'keyboard' : 'touch');
        if (e.pointerType === 'touch') flick = active.size === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
        active.set(e.pointerId, { x: e.clientX, y: e.clientY });
        capture(el, e.pointerId);
        this.button(e.pointerType === 'touch' ? TOUCH_KEY : MOUSE_BUTTONS[e.button]?.[0], true);
        pinch = spread();
        if (this.wantsPointerLock && e.pointerType === 'mouse' && document.pointerLockElement !== el) void el.requestPointerLock?.();
      },
      { signal },
    );
    const end = (e: PointerEvent) => {
      active.delete(e.pointerId);
      pinch = spread();
      const f = flick;
      if (f && f.id === e.pointerId) {
        flick = null;
        const r = el.getBoundingClientRect();
        const dir = e.type === 'pointerup' && !this._playing ? swipeDirection(e.clientX - f.x, e.clientY - f.y, e.timeStamp - f.t, Math.min(r.width, r.height)) : null;
        if (dir) this.press(SWIPE_KEYS[dir]);
      }
      if (this._playing) return;
      if (e.pointerType === 'touch') {
        if (![...active.keys()].length) this.button(TOUCH_KEY, false);
      } else if (e.type === 'pointercancel' || active.size === 0) for (const [code] of MOUSE_BUTTONS) this.button(code, false);
      else this.button(MOUSE_BUTTONS[e.button]?.[0], false);
    };
    el.addEventListener('pointerup', end, { signal });
    el.addEventListener('pointercancel', end, { signal });
    (this.target ?? window).addEventListener(
      'pointermove',
      (e) => {
        const locked = document.pointerLockElement === el;
        const p = active.get(e.pointerId);
        if (!p && !locked) return;
        // during a replay a drag still tracks where its pointer is (no jump after), but moves nothing
        const live = !this._playing;
        if (p && active.size >= 2) {
          p.x = e.clientX;
          p.y = e.clientY;
          const d = spread();
          if (pinch > 0 && Math.abs(d - pinch) > 24) {
            if (live) this.wheel += d > pinch ? -1 : 1; // spread fingers = zoom in
            pinch = d;
          }
          return;
        }
        if (p) {
          // Positions, not movementX: movementX isn't reliable for touch on all mobile browsers.
          if (live) {
            this.mouseDelta.x += e.clientX - p.x;
            this.mouseDelta.y += e.clientY - p.y;
          }
          p.x = e.clientX;
          p.y = e.clientY;
        } else if (live) {
          this.mouseDelta.x += e.movementX;
          this.mouseDelta.y += e.movementY;
          this.mouseTravelled(Math.hypot(e.movementX, e.movementY)); // mouse look under pointer lock
        }
      },
      { signal },
    );
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this._playing) return;
        this.use('keyboard');
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false, signal },
    );
  }

  /**
   * The input used last: `keyboard` (keys, and the mouse: a click, the wheel, a move of a few
   * pixels), `pad` (a button pressed, a stick pushed past a quarter of its travel, a trigger
   * pulled past 0.3) or `touch` (a finger on the canvas or on the touch controls). It starts as
   * `touch` on a touch-screen device (a coarse pointer) and `keyboard` elsewhere; a pad that is
   * merely connected, a stick resting or jittering near its deadzone and a trigger resting where
   * it was first seen change nothing. Recorded when it changes (replays and save-states keep it;
   * a recording keeps the one its level began with for the level's setup), so a game may branch
   * on it (prompts, touch assists, mouse aim) and still replay.
   */
  get device(): InputDevice {
    return this._device;
  }

  /** The `navigator.getGamepads()` slot of the pad used last, or -1 (not recorded: `rumble` shakes it). */
  get padIndex(): number {
    return this._padIndex;
  }

  /**
   * The pad in `slot` (its `navigator.getGamepads()` slot, 0 to `MAX_PADS` - 1) on its own, couch
   * co-op's player input: read while `padPlayers` is on, recorded and replayed, kept by
   * snapshots. The merged input stays player 1's: a game reads the pads of players 2 to 4 here,
   * and lists them in `joined` so they no longer drive player 1.
   */
  player(slot: number): PadPlayer {
    const p = this.pads[slot];
    if (!p) throw new RangeError(`Input.player: no pad slot ${slot} (0 to ${MAX_PADS - 1})`);
    return p;
  }

  /** The player used `device` (a page's own controls; tests): `device` becomes it. Ignored during a replay. */
  noteDevice(device: InputDevice): void {
    if (!this._playing && INPUT_DEVICES.includes(device)) this.use(device);
  }

  /** A touch control was used (the engine's `TouchControls` call it on every press and stick touch). */
  noteTouch(): void {
    this.noteDevice('touch');
  }

  /**
   * Shake the pad in use: `strong` (the heavy, low motor) and `weak` (the light buzz), 0..1, for
   * `ms` milliseconds (default 100). Short, distinct pulses (a hit, a landing, an explosion) say
   * more than a long rumble. The strongest request of a frame plays when the frame ends, scaled by
   * `vibration` (the player's setting). Nothing happens unless the pad is the device in use, nor
   * headless, during a replay, at vibration 0 or on a pad that can't rumble. Output only: never
   * recorded.
   */
  rumble(r: Rumble): void {
    if (this._playing || !this.target) return;
    const strong = unit(r.strong);
    const weak = unit(r.weak);
    const ms = Math.min(5000, Math.max(0, Number.isFinite(r.ms) ? r.ms! : 100));
    if (!(strong > 0 || weak > 0) || !(ms > 0)) return;
    const w = this.rumbleWant;
    if (!w) this.rumbleWant = { strong, weak, ms };
    else {
      w.strong = Math.max(w.strong, strong);
      w.weak = Math.max(w.weak, weak);
      w.ms = Math.max(w.ms, ms);
    }
  }

  /** End of a frame: play the frame's strongest rumble on the pad in use. */
  private playRumble(): void {
    const r = this.rumbleWant;
    this.rumbleWant = null;
    if (!r || this._playing || !this.target || this._device !== 'pad') return;
    const k = unit(this.vibration);
    const actuator = this.rumblePad?.vibrationActuator;
    if (!(k > 0) || !actuator || typeof actuator.playEffect !== 'function') return;
    try {
      const done = actuator.playEffect('dual-rumble', { startDelay: 0, duration: r.ms, strongMagnitude: r.strong * k, weakMagnitude: r.weak * k });
      if (done && typeof (done as Promise<unknown>).catch === 'function') (done as Promise<unknown>).catch(() => {}); // unplugged, or another effect cut it short
    } catch {
      /* the pad can't rumble after all */
    }
  }

  /** A live use of `device`: it becomes the input used last (the mouse's travel counts afresh after any other). */
  private use(device: InputDevice): void {
    if (this._playing) return;
    this._device = device;
    if (device !== 'keyboard') this.mouseTravel = 0;
  }

  /** The mouse moved to (x, y) (CSS pixels): a few pixels' travel is a use. */
  private mouseMoved(x: number, y: number): void {
    const at = this.mouseAt;
    if (at.known) this.mouseTravelled(Math.hypot(x - at.x, y - at.y));
    at.x = x;
    at.y = y;
    at.known = true;
  }

  private mouseTravelled(d: number): void {
    if (this._playing || this._device === 'keyboard' || !(d > 0)) return;
    this.mouseTravel += d;
    if (this.mouseTravel >= MOUSE_USE) this.use('keyboard');
  }

  /** Remove every listener this Input added (window and canvas). */
  dispose(): void {
    this.listeners.abort();
    if (this.lockTarget && typeof document !== 'undefined' && document.pointerLockElement === this.lockTarget) document.exitPointerLock?.();
    this.lockTarget = null;
    this.reset();
  }

  /**
   * Let go of everything held (keys, gamepad buttons, sticks, pointer buttons); queued presses stay.
   * A key or pad button still held reads as up until it is let go (it does not press again, and a
   * key's auto-repeat holds nothing), and a stick still leaning reads centred until it goes back
   * inside its deadzone: the key that opened a menu never acts in it or behind it, and a stick held
   * from a run never steps its rows.
   */
  release(): void {
    for (const code of this.held) this.keyLatched.add(code);
    this.held.clear();
    for (const code of this.padHeld) this.padLatched.add(code);
    this.padHeld.clear();
    this.dropTaps(); // Create or Options held through it presses nothing as it is let go
    this.stickLatched[0] = this.stickLatched[1] = true; // a stick at rest lets go at the next poll
    this.analog.x = this.analog.y = 0;
    this.padAxis.x = this.padAxis.y = 0;
    this.lookAxis.x = this.lookAxis.y = 0;
    this.motionTurn.x = this.motionTurn.y = 0;
    this.triggers.left = this.triggers.right = 0;
  }

  /** Forget held keys, presses, sticks and pointer movement (e.g. when a level loads). */
  reset(): void {
    this.held.clear();
    this.queued.clear();
    this.padHeld.clear();
    this.padLatched.clear();
    this.keyLatched.clear();
    this.stickLatched[0] = this.stickLatched[1] = false;
    this.analog.x = this.analog.y = 0;
    this.padAxis.x = this.padAxis.y = 0;
    this.lookAxis.x = this.lookAxis.y = 0;
    this.triggers.left = this.triggers.right = 0;
    this.pad1 = null;
    this.padMulti = false;
    for (const p of this.pads) p.forget();
    this.dropTaps();
    this.rumbleWant = null; // a level's rumble ends with it
    this.endFrame();
  }

  /** Create and Options held alone now press nothing as they are let go (`release`, `reset`). */
  private dropTaps(): void {
    for (const seen of this.padSeen.values()) seen.tap = [false, false];
  }

  /**
   * Engine: begin a frame at game time `now` (seconds). Polls gamepads and drops expired
   * queued presses. `pads` defaults to `navigator.getGamepads()`; tests can pass fakes.
   */
  beginFrame(now: number, dt: number, pads?: readonly (GamepadLike | null)[]): void {
    // gamepad presses queue at the frame before's time, like keys pressed since then (so a
    // recording, which replays every press that way, gives them the same expiry)
    this.pollGamepads(dt, pads);
    this.now = now;
    // no negative zeros (a stick at rest reads -0): JSON writes them as 0, so a recording would
    // replay a different number, and atan2(-0, x) is not atan2(0, x)
    this.analog.x += 0;
    this.analog.y += 0;
    this.padAxis.x += 0;
    this.padAxis.y += 0;
    this.lookAxis.x += 0;
    this.lookAxis.y += 0;
    this.motionTurn.x += 0;
    this.motionTurn.y += 0;
    this.mouseDelta.x += 0;
    this.mouseDelta.y += 0;
    for (const [code, t] of this.queued) if (now - t > this.pressWindow) this.queued.delete(code);
    for (const p of this.pads) {
      for (const a of [p.padAxis, p.lookAxis]) {
        a.x += 0;
        a.y += 0;
      }
      for (const [code, t] of p.queued) if (now - t > this.pressWindow) p.queued.delete(code);
    }
  }

  get pointerLocked(): boolean {
    return this.lockTarget !== null && document.pointerLockElement === this.lockTarget;
  }

  isDown(...codes: string[]): boolean {
    return this.anyDown(codes);
  }

  /** `isDown` for a list of codes, without building a rest-argument array (fixed-step code). */
  anyDown(codes: readonly string[]): boolean {
    for (const c of codes) if (this.held.has(c) || this.padHeld.has(c)) return true;
    return false;
  }

  /** True once per physical key press (valid for the current render frame). */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /**
   * True once per physical key press, kept until consumed or until it is older than
   * `pressWindow` (150 ms of game time). Use from fixed-step code (which may run zero or
   * several times per frame) so no press is dropped, while a stale press (made during a
   * pause, a loading screen or a long hitch) never fires late.
   */
  consumePress(...codes: string[]): boolean {
    return this.consumeAny(codes);
  }

  /** `consumePress` for a list of codes, without building a rest-argument array. */
  consumeAny(codes: readonly string[]): boolean {
    let hit = false;
    for (const c of codes) {
      const t = this.queued.get(c);
      if (t === undefined) continue;
      this.queued.delete(c);
      if (this.now - t <= this.pressWindow) hit = true;
    }
    return hit;
  }

  /** Held keys, queued presses and the pointer as data (`engine.snapshot()`), between frames. */
  state(): InputState {
    return {
      held: [...new Set([...this.held, ...this.padHeld])].sort(),
      queued: [...this.queued].map(([code, t]) => [code, this.now - t] as const),
      pointer: [this.pointer.x, this.pointer.y, this.pointer.over ? 1 : 0, this.pointer.touch ? 1 : 0],
      gamepad: this.gamepadConnected,
      device: this._device,
      outbox: JSON.parse(JSON.stringify(this.outbox)) as unknown[],
      ...this.padState(),
    };
  }

  /** Each pad on its own and the pads that joined, for `state()` (left out while there are none). */
  private padState(): Pick<InputState, 'pads' | 'joined'> {
    const pads = this.pads.filter((p) => p.connected || p.queued.size).map((p) => [p.slot, [...p.held].sort(), [...p.queued].map(([code, t]) => [code, this.now - t] as const)] as const);
    return { ...(pads.length ? { pads } : {}), ...(this.joined.size ? { joined: [...this.joined].sort((a, b) => a - b) } : {}) };
  }

  /** Back to `state()` at game time `now` (a restore): held keys are those the snapshot held, live ones let go. */
  setState(s: InputState, now: number): void {
    this.held.clear();
    this.padHeld.clear();
    for (const c of s.held) this.held.add(c);
    this.queued.clear();
    for (const [code, age] of s.queued) this.queued.set(code, now - age);
    this.now = now;
    [this.pointer.x, this.pointer.y] = s.pointer;
    this.pointer.over = s.pointer[2] === 1;
    this.pointer.touch = s.pointer[3] === 1;
    this.gamepadConnected = s.gamepad;
    this.playedPad = s.gamepad;
    this._device = this.playedDevice = s.device && INPUT_DEVICES.includes(s.device) ? s.device : 'keyboard';
    this.outbox = JSON.parse(JSON.stringify(s.outbox)) as unknown[]; // what was sent since is not this moment's
    for (const p of this.pads) p.forget();
    for (const [slot, held, queued] of s.pads ?? []) {
      const p = this.pads[slot];
      if (!p) continue;
      p.connected = true;
      for (const c of held) p.held.add(c);
      for (const [code, age] of queued) p.queued.set(code, now - age);
    }
    this.joined.clear();
    for (const slot of s.joined ?? []) this.joined.add(slot);
    this.endFrame();
  }

  /** Presses waiting to be consumed (tooling / tests). */
  get queuedPresses(): string[] {
    return [...this.queued.keys()];
  }

  /** Drop queued presses (e.g. when a menu or mode swallows input). */
  clearQueued(...codes: string[]): void {
    if (codes.length === 0) this.queued.clear();
    for (const c of codes) this.queued.delete(c);
  }

  /**
   * -1..1 on each axis (x = right, y = forward): the touch joystick or a gamepad's left
   * stick (whichever is tilted further), else WASD / arrow keys / d-pad. A movement key held
   * wins over the pad's stick unless the pad is the device in use and its stick leans past
   * `STICK_USE` (0.25): a connected pad's stick resting just past its deadzone never takes the
   * keyboard's movement away, nor the d-pad's. All of it is recorded (`device` too), so a replay
   * moves the same.
   */
  moveAxis(): { x: number; y: number } {
    const touch = Math.hypot(this.analog.x, this.analog.y);
    const pad = Math.hypot(this.padAxis.x, this.padAxis.y);
    const x = (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const y = (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const keys = x !== 0 || y !== 0;
    const padWins = pad > 0 && (!keys || (this._device === 'pad' && pad >= STICK_USE));
    const stick = touch > 0.12 && touch >= pad ? this.analog : padWins ? this.padAxis : null;
    if (stick) {
      const len = Math.hypot(stick.x, stick.y);
      return len > 1 ? { x: stick.x / len, y: stick.y / len } : { x: stick.x, y: stick.y };
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** Call at the end of each rendered frame (the frame's rumble plays now). */
  endFrame(): void {
    if (this.rumbleWant) this.playRumble();
    this.pressed.clear();
    this._commands = [];
    this._buttonEvents = [];
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.motionTurn.x = 0;
    this.motionTurn.y = 0;
    this.wheel = 0;
    for (const p of this.pads) p.pressed.clear();
    this._joinedNow = [];
  }

  /** Test hook: simulate a key being held (true) or released (false). */
  setKey(code: string, down: boolean): void {
    if (this._playing) return; // a replay sets every key (touch buttons call this too)
    if (down) {
      if (!this.held.has(code)) this.press(code);
      this.held.add(code);
    } else {
      this.held.delete(code);
    }
  }

  /** Test hook: put the pointer at (x, y) in normalised device coordinates, pressed or not. */
  setPointer(x: number, y: number, down?: boolean): void {
    if (this._playing) return;
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.over = true;
    this.pointer.touch = false;
    if (down !== undefined) this.button('MouseLeft', down);
  }

  /** Test hook: hold mouse buttons (`PointerEvent.buttons` bits: 1 left, 2 right, 4 middle) as the canvas would. */
  setButtons(bits: number): void {
    for (const [code, bit] of MOUSE_BUTTONS) this.button(code, (bits & bit) !== 0);
  }

  /** Buttons held, as `PointerEvent.buttons` bits (1 left, 2 right, 4 middle; a finger is left): the same keys as `isDown('MouseLeft')`. */
  get mouseButtons(): number {
    let bits = this.held.has(TOUCH_KEY) ? 1 : 0;
    for (const [code, bit] of MOUSE_BUTTONS) if (this.held.has(code)) bits |= bit;
    return bits;
  }

  /** A pointer button (a key code) goes down (pressed, unless held already) or up, where the pointer is. */
  private button(code: string | undefined, down: boolean): void {
    if (!code || this._playing || down === this.held.has(code)) return;
    this._buttonEvents.push({ code, down, x: this.pointer.x, y: this.pointer.y });
    if (!down) this.held.delete(code);
    else {
      this.press(code);
      this.held.add(code);
    }
  }

  /**
   * This frame's pointer button presses and releases, in order, each with where the pointer
   * was: a drag shorter than a frame (a script's) still starts where it started and ends where
   * it ended. Recorded with the frame. UI that acts on clicks reads these; play reads `isDown`.
   */
  get buttonEvents(): readonly ButtonEvent[] {
    return this._buttonEvents;
  }

  /**
   * Hand the game data from outside the canvas: a DOM widget's value, a file the player picked,
   * a save read from storage, anything a game would otherwise take straight from the page. It
   * arrives in `commands` at the next frame the game runs, and the recording keeps it there, so
   * a replay delivers the same data at the same frame (and ignores what is sent live). It goes
   * through JSON first: live play reads exactly what a replay will.
   */
  send(command: unknown): void {
    if (this._playing) return;
    const json = JSON.stringify(command ?? null);
    if (json === undefined) throw new TypeError('Input.send: the data must be JSON (no functions or symbols)');
    this.outbox.push(JSON.parse(json));
  }

  /**
   * This frame's commands (`send`), oldest first; empty on most frames. They last one rendered
   * frame: read them in `update` (`fixedUpdate` runs zero or more times a frame).
   */
  get commands(): readonly unknown[] {
    return this._commands;
  }

  /** Engine: a live frame begins to run: what was sent since the last one becomes its `commands`. */
  deliver(): void {
    this._commands = this.outbox;
    this.outbox = [];
  }

  /** Test hook: inject pointer movement / wheel for the next frame. */
  addPointer(dx: number, dy: number, wheel = 0): void {
    if (this._playing) return;
    this.mouseDelta.x += dx;
    this.mouseDelta.y += dy;
    this.wheel += wheel;
  }

  /**
   * This frame's input as data (after `beginFrame`), for a recording. `last` is the frame
   * before: unchanged held keys, pointer and gamepad connection are left out.
   */
  snapshot(dt: number, last?: SnapshotMemory): InputFrame {
    const f: InputFrame = { dt };
    const held = [...new Set([...this.held, ...this.padHeld])].sort();
    const heldKey = held.join(',');
    if (!last || heldKey !== last.held) f.held = held;
    if (this.pressed.size) f.pressed = [...this.pressed].sort();
    if (this.analog.x || this.analog.y) f.analog = [this.analog.x, this.analog.y];
    if (this.padAxis.x || this.padAxis.y) f.pad = [this.padAxis.x, this.padAxis.y];
    if (this.lookAxis.x || this.lookAxis.y) f.look = [this.lookAxis.x, this.lookAxis.y];
    if (this.motionTurn.x || this.motionTurn.y) f.turn = [this.motionTurn.x, this.motionTurn.y];
    if (this.triggers.left || this.triggers.right) f.trig = [this.triggers.left, this.triggers.right];
    if (this.mouseDelta.x || this.mouseDelta.y) f.delta = [this.mouseDelta.x, this.mouseDelta.y];
    if (this.wheel) f.wheel = this.wheel;
    const pointer: [number, number, number, number] = [this.pointer.x, this.pointer.y, this.pointer.over ? 1 : 0, this.mouseButtons];
    const pointerKey = pointer.join(',');
    if (!last || pointerKey !== last.pointer) f.pointer = pointer;
    if (!last || this.gamepadConnected !== last.gamepad) f.gamepad = this.gamepadConnected;
    if (!last || this._device !== last.device) f.device = this._device;
    if (!last || last.touch === undefined || this.pointer.touch !== last.touch) f.touch = this.pointer.touch;
    if (this._commands.length) f.commands = JSON.parse(JSON.stringify(this._commands)) as unknown[]; // the game may change what it got
    if (this._buttonEvents.length) f.clicks = this._buttonEvents.map((e) => [e.code, e.down ? 1 : 0, e.x, e.y]);
    // each pad on its own (couch co-op): when any changed, and its presses
    const pads = this.pads.filter((p) => p.connected).map((p) => p.frame());
    const padsKey = JSON.stringify(pads);
    if (padsKey !== (last?.pads ?? '[]')) f.pads = pads;
    const padPressed = this.pads.filter((p) => p.pressed.size).map((p): [number, ...string[]] => [p.slot, ...[...p.pressed].sort()]);
    if (padPressed.length) f.padPressed = padPressed;
    if (this._joinedNow.length) f.join = [...this._joinedNow];
    if (last) {
      last.pads = padsKey;
      last.held = heldKey;
      last.pointer = pointerKey;
      last.gamepad = this.gamepadConnected;
      last.device = this._device;
      last.touch = this.pointer.touch;
    }
    return f;
  }

  /**
   * Replay, before the engine's `beginFrame`: the frame's held keys and presses (presses queue
   * at the time they would have arrived, the frame before's game time).
   */
  playBefore(f: InputFrame): void {
    if (f.held) {
      this.held.clear();
      for (const c of f.held) this.held.add(c);
    }
    this.padHeld.clear(); // gamepad buttons were recorded as held keys
    for (const c of f.pressed ?? []) this.press(c);
    for (const [slot, ...codes] of f.padPressed ?? []) for (const c of codes) this.pads[slot]?.press(c);
  }

  /** Replay, after `beginFrame` (which polled no gamepads): sticks, triggers, pointer, wheel, gamepad connection, the device used last. */
  playAfter(f: InputFrame): void {
    if (f.gamepad !== undefined) this.playedPad = f.gamepad;
    this.gamepadConnected = this.playedPad;
    if (f.device !== undefined) this.playedDevice = f.device;
    this._device = this.playedDevice;
    [this.analog.x, this.analog.y] = f.analog ?? [0, 0];
    [this.padAxis.x, this.padAxis.y] = f.pad ?? [0, 0];
    [this.lookAxis.x, this.lookAxis.y] = f.look ?? [0, 0];
    [this.motionTurn.x, this.motionTurn.y] = f.turn ?? [0, 0];
    [this.triggers.left, this.triggers.right] = f.trig ?? [0, 0];
    [this.mouseDelta.x, this.mouseDelta.y] = f.delta ?? [0, 0];
    this.wheel = f.wheel ?? 0;
    if (f.pointer) {
      [this.pointer.x, this.pointer.y] = f.pointer;
      this.pointer.over = f.pointer[2] === 1;
    }
    if (f.touch !== undefined) this.pointer.touch = f.touch;
    if (f.pads) {
      for (const p of this.pads) p.clear();
      for (const [slot, held, lx, ly, rx, ry, lt, rt] of f.pads) {
        const p = this.pads[slot];
        if (!p) continue;
        p.connected = true;
        for (const c of held) p.held.add(c);
        [p.padAxis.x, p.padAxis.y, p.lookAxis.x, p.lookAxis.y, p.triggers.left, p.triggers.right] = [lx, ly, rx, ry, lt, rt];
      }
    }
    this._joinedNow = [...(f.join ?? [])];
    for (const slot of this._joinedNow) this.joined.add(slot);
    this._buttonEvents = (f.clicks ?? []).map(([code, down, x, y]) => ({ code, down: down === 1, x, y }));
    this._commands = f.commands ? (JSON.parse(JSON.stringify(f.commands)) as unknown[]) : []; // never the recording's own objects
  }

  /**
   * Replay, before the recorded level loads (`engine.replay`): the input used last when it began
   * (`Recording.device`), what its setup reads as `device` until the first played frame.
   */
  playFrom(device: InputDevice | undefined): void {
    if (!this._playing) return;
    this._device = this.playedDevice = device && INPUT_DEVICES.includes(device) ? device : 'keyboard';
  }

  /**
   * Test hook: poll these pads every frame instead of `navigator.getGamepads()` (a headless
   * engine has none), as the browser would list them; null polls the browser's again.
   */
  setGamepads(pads: readonly (GamepadLike | null)[] | null): void {
    this.fakePads = pads ? [...pads] : null;
  }

  private press(code: string): void {
    this.pressed.add(code);
    this.queued.set(code, this.now);
  }

  private pollGamepads(dt: number, pads?: readonly (GamepadLike | null)[]): void {
    let list: readonly (GamepadLike | null)[] = pads ?? this.fakePads ?? [];
    if (!pads && !this.fakePads) {
      try {
        list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      } catch {
        list = []; // blocked by a permissions policy
      }
    }
    const down = new Set<string>();
    let stick = { x: 0, y: 0 };
    let look = { x: 0, y: 0 };
    /** Each pad's right stick (after its deadzone): it turns once the device in use is known. */
    const rights: { x: number; y: number }[] = [];
    let left = 0;
    let right = 0;
    let connected = false;
    let used: { index: number; pad: GamepadLike } | null = null;
    let rumblePad: GamepadLike | null = null;
    const owns: OwnPoll[] = [];
    const seen = this.padSeen;
    const seenNow = new Map<number, PadSeen>();
    /** Create and Options held alone: held, but they press only as they are let go (`taps`). */
    const chordHeld = new Set<string>();
    const taps: string[] = [];
    for (let n = 0; n < list.length; n++) {
      const pad = list[n];
      if (!pad || pad.connected === false) continue;
      // Only the W3C "standard" layout has known button/axis meanings; other pads ('' mapping)
      // would press random actions. (Fakes without a mapping are treated as standard.)
      if (pad.mapping !== undefined && pad.mapping !== 'standard') continue;
      connected = true;
      const index = Number.isInteger(pad.index) ? pad.index! : n;
      const was = seen.get(index);
      const raw = (i: number): number => {
        const b = pad.buttons[i];
        return !b ? 0 : Math.min(1, Math.max(0, Number.isFinite(b.value) ? b.value! : b.pressed ? 1 : 0));
      };
      // A trigger seen for the first time part-way is resting there (some pads report half until
      // first pulled): it reads 0 and presses nothing until it moves from that value. One pulled
      // all the way (the press that showed the browser the pad) reads at once.
      const partWay = (i: number) => (raw(i) > 0 && raw(i) < 1 ? raw(i) : null);
      const rest: [number | null, number | null] = was ? [was.rest[0], was.rest[1]] : [partWay(6), partWay(7)];
      for (const k of [0, 1] as const) if (rest[k] !== null && Math.abs(raw(6 + k) - rest[k]!) > TRIGGER_WAKE) rest[k] = null;
      const resting = (i: number) => (i === 6 || i === 7) && rest[i - 6] !== null;
      const value = (i: number): number => (resting(i) ? 0 : raw(i));
      const on = (i: number): boolean => {
        const b = pad.buttons[i];
        return !!b && !resting(i) && (b.pressed || (b.value ?? 0) > 0.5);
      };
      // View + Menu (Create + Options, buttons 8 and 9) held together belong to whatever hosts the
      // page (the AI Hub opens its bar on them): once both are down, neither means anything here
      // until both are let go (letting one go first must not press the other). Each presses as it
      // is let go (a tap), and only if the other never went down while it was held: a thumb that
      // reaches Options a poll before Create opens no pause or settings behind the hub's bar.
      const create = on(HOST_CHORD[0]);
      const options = on(HOST_CHORD[1]);
      const chord = (create && options) || (!!was?.chord && (create || options));
      const mine = (i: number) => i !== HOME_BUTTON && !(chord && HOST_CHORD.includes(i));
      const tap: [boolean, boolean] = [false, false];
      /** This pad's own: the codes it holds, Create and Options held alone (they press as let go), and those let go. */
      const padDown = new Set<string>();
      const padChord = new Set<string>();
      const padTaps: string[] = [];
      HOST_CHORD.forEach((i, k) => {
        const code = this.gamepadButtons[i];
        if (chord || !code) return;
        if (on(i)) {
          tap[k] = was?.buttons[i] ? was.tap[k] === true : true; // went down alone now, or still held since
          padChord.add(code);
        } else if (was?.tap[k]) padTaps.push(code);
      });
      pad.buttons.forEach((_, i) => {
        const code = this.gamepadButtons[i];
        if (code && on(i) && mine(i)) padDown.add(code);
      });
      const l = applyDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), this.gamepadDeadzone);
      const r = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, this.gamepadDeadzone);
      // couch co-op: the pad on its own; one that joins does so before its press reaches anything
      const own = this.padPlayers && !this._playing && index < MAX_PADS ? this.pads[index]! : null;
      if (own) {
        const mineInUse = this._device === 'pad' && this._padIndex === index;
        if (this.joinWith && !this.joined.has(index) && !mineInUse && this.joinWith.some((c) => padDown.has(c) && !own.held.has(c))) {
          this.joined.add(index);
          this._joinedNow.push(index);
          for (const c of this.joinWith) if (padDown.has(c)) own.latched.add(c); // the press that joined presses nothing
        }
        owns.push({ own, down: padDown, chord: padChord, taps: padTaps, l, r, lt: value(6), rt: value(7) });
      }
      // Used, not merely connected: a button that went down, a trigger pulled past TRIGGER_USE, a
      // stick that moved past STICK_USE. A pad seen for the first time counts only for a button
      // held (the press that showed the browser the pad); its sticks and triggers are where they
      // rest (drift, a trigger reading half).
      const now: PadSeen = {
        buttons: pad.buttons.map((_, i) => mine(i) && (i === 6 || i === 7 ? value(i) > TRIGGER_USE : on(i))),
        left: [l.x, l.y],
        right: [r.x, r.y],
        rest,
        chord,
        tap,
      };
      seenNow.set(index, now);
      if (this.joined.has(index)) continue; // a player of its own: it never drives the merged input (player 1's)
      for (const c of padDown) down.add(c);
      for (const c of padChord) chordHeld.add(c);
      taps.push(...padTaps);
      if (Math.hypot(l.x, l.y) > Math.hypot(stick.x, stick.y)) stick = l;
      rights.push(r);
      left = Math.max(left, value(6));
      right = Math.max(right, value(7));
      const pressedNow = now.buttons.some((b, i) => b && (was ? !was.buttons[i] : i !== 6 && i !== 7));
      if (pressedNow || (was && (stickUsed(was.left, now.left) || stickUsed(was.right, now.right)))) used = { index, pad };
      if (index === this._padIndex) rumblePad = pad;
    }
    this.padSeen = seenNow;
    this.pollOwn(owns);
    // a button held through release() reads as up until it is let go
    for (const code of this.padLatched) if (!down.has(code)) this.padLatched.delete(code);
    for (const code of this.padLatched) down.delete(code);
    for (const code of down) if (!this.padHeld.has(code) && !this.held.has(code) && !chordHeld.has(code)) this.press(code);
    for (const code of taps) this.press(code);
    // the DualSense's touchpad (52in1, when the game reads it): a swipe or a tap is a press, and a use
    const ds = this._playing ? null : this.dualsense;
    let gesture: TouchpadGesture | null = null;
    if (ds?.touchpad && this.touchpad) gesture = this.touchpadFrame(ds.touches(), dt, down.has('PadTouchpad'));
    else {
      this.pad1 = null;
      this.padMulti = false;
    }
    if (gesture) {
      this.press(TOUCHPAD_KEYS[gesture]);
      this.use('pad');
    }
    this.padHeld.clear();
    for (const code of down) this.padHeld.add(code);
    // a stick held through release() reads centred until it goes back inside its deadzone
    if (this.stickLatched[0] && !stick.x && !stick.y) this.stickLatched[0] = false;
    if (this.stickLatched[0]) stick = { x: 0, y: 0 };
    if (this.stickLatched[1] && rights.every((r) => !r.x && !r.y)) this.stickLatched[1] = false;
    if (this.stickLatched[1]) rights.length = 0;
    this.padAxis.x = stick.x;
    this.padAxis.y = stick.y;
    this.triggers.left = left;
    this.triggers.right = right;
    this.gamepadConnected = connected;
    if (used && !this._playing) {
      this.use('pad');
      this._padIndex = used.index;
      rumblePad = used.pad;
    }
    this.rumblePad = rumblePad;
    // The right stick turns the camera and aims while the pad is the device in use (this poll's
    // use counts: the poll that picks the pad up turns), or once it leans past STICK_USE: a
    // stick resting just past its deadzone never creeps a keyboard and mouse player's camera.
    const padInUse = this._device === 'pad';
    for (const r of rights) {
      if (!padInUse && Math.hypot(r.x, r.y) < STICK_USE) continue;
      if (Math.hypot(r.x, r.y) > Math.hypot(look.x, look.y)) look = { x: r.x, y: -r.y };
      this.mouseDelta.x += r.x * this.gamepadLookSpeed * dt;
      this.mouseDelta.y += r.y * this.gamepadLookSpeed * dt;
    }
    // Motion aim (52in1, while the game has it on): the controller's turns add to the stick's, on
    // the pad in use. Read on every poll while on, the pad in use or not (52in1's own Motion aim
    // leaves the stick alone only while the game reads the gyro), and never while off (52in1's
    // own, if the player has it on, has the stick back half a second later).
    const gyro = ds?.motion && this.motion.on ? ds.gyro() : null;
    this.motionTurn.x = this.motionTurn.y = 0;
    if (gyro && padInUse) {
      const k = Number.isFinite(this.motion.sensitivity) ? Math.max(0, this.motion.sensitivity) : 1;
      const yaw = beyond(-gyro.y, MOTION_AIM.still); // turned right (+): the view goes right
      const pitch = beyond(-gyro.x, MOTION_AIM.still); // tipped up: the view goes up (pointer y down)
      this.motionTurn.x = yaw * dt * k;
      this.motionTurn.y = pitch * dt * k;
      this.mouseDelta.x += yaw * dt * k * MOTION_AIM.pixels;
      this.mouseDelta.y += pitch * dt * k * MOTION_AIM.pixels;
      if (this.motion.lean !== false) {
        const ax = look.x + aimLean(yaw) * k;
        const ay = look.y - aimLean(pitch) * k;
        const len = Math.hypot(ax, ay);
        look = len > 1 ? { x: ax / len, y: ay / len } : { x: ax, y: ay };
      }
    }
    this.lookAxis.x = look.x;
    this.lookAxis.y = look.y;
  }

  /** Each pad on its own after a poll (`padPlayers`; never during a replay, which sets them from the recording). */
  private pollOwn(owns: readonly OwnPoll[]): void {
    if (this._playing) return;
    const live = new Set<number>();
    for (const { own, down, chord, taps, l, r, lt, rt } of owns) {
      live.add(own.slot);
      for (const c of own.latched) if (!down.has(c)) own.latched.delete(c);
      for (const c of own.latched) down.delete(c);
      for (const c of down) if (!own.held.has(c) && !chord.has(c)) own.press(c);
      for (const c of taps) own.press(c);
      own.held.clear();
      for (const c of down) own.held.add(c);
      own.connected = true;
      own.padAxis.x = l.x;
      own.padAxis.y = l.y;
      own.lookAxis.x = r.x;
      own.lookAxis.y = -r.y;
      own.triggers.left = lt;
      own.triggers.right = rt;
    }
    for (const p of this.pads) if (!live.has(p.slot)) p.clear();
  }

  /**
   * One poll of the touchpad's fingers (`touchpad`): a finger that went down and came up again
   * within a swipe's or a tap's time makes a gesture. One finger only: a second finger, or the pad's
   * click (its own button), spoils whatever ends before the pad is bare again, however the fingers
   * lift (together or one at a time), and so does another finger taking the lead while fingers stay.
   * Returns the gesture that ended, or null.
   */
  private touchpadFrame(touches: readonly { readonly id: number; readonly x: number; readonly y: number }[] | null, dt: number, clicked: boolean): TouchpadGesture | null {
    const list = Array.isArray(touches) ? touches : [];
    const f = this.pad1;
    const t = list[0];
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) {
      const multi = this.padMulti;
      this.pad1 = null;
      this.padMulti = false; // bare again: the next touch may be a gesture
      if (!f || f.spoilt || multi) return null;
      return touchpadGesture(f.x - f.x0, f.y - f.y0, f.t);
    }
    if (list.length > 1 || clicked) this.padMulti = true;
    if (!f) {
      this.pad1 = { id: t.id, x0: t.x, y0: t.y, x: t.x, y: t.y, t: 0, spoilt: this.padMulti };
      return null;
    }
    if (f.id !== t.id || this.padMulti) f.spoilt = true; // the first finger lifted while another stays, or two at once
    f.id = t.id;
    f.x = t.x;
    f.y = t.y;
    f.t += dt;
    return null;
  }
}

/** A pad on its own as a poll saw it (`pollOwn`). */
interface OwnPoll {
  readonly own: PadPlayer;
  readonly down: Set<string>;
  readonly chord: ReadonlySet<string>;
  readonly taps: readonly string[];
  readonly l: { readonly x: number; readonly y: number };
  readonly r: { readonly x: number; readonly y: number };
  readonly lt: number;
  readonly rt: number;
}

/** What a poll saw of a pad (after the deadzone), for the next poll to tell use from rest. */
interface PadSeen {
  buttons: boolean[];
  left: [number, number];
  right: [number, number];
  /** Each trigger's value when the pad was first seen part-way, while it rests there (null: it reads). */
  rest: [number | null, number | null];
  /** The host's chord (`HOST_CHORD`) is held on this pad: buttons 8 and 9 mean nothing until both are let go. */
  chord: boolean;
  /** Create, Options (`HOST_CHORD`): held alone since it went down, so letting it go presses it. */
  tap: [boolean, boolean];
}

/**
 * A stick used since the poll before (`was`, `now`: after the deadzone): it leans past `STICK_USE`
 * and got there this poll or moved since. A stick resting or jittering near its deadzone (or a
 * slightly drifting one) never counts.
 */
function stickUsed(was: readonly [number, number], now: readonly [number, number]): boolean {
  const len = Math.hypot(now[0], now[1]);
  if (len < STICK_USE) return false;
  return Math.hypot(was[0], was[1]) < STICK_USE || Math.hypot(now[0] - was[0], now[1] - was[1]) > STICK_MOVE;
}

/** How far `v` goes past ±`still` (0 inside it): a hand holding a controller still turns it a little. */
function beyond(v: number, still: number): number {
  if (!Number.isFinite(v)) return 0;
  const past = Math.abs(v) - still;
  return past > 0 ? Math.sign(v) * past : 0;
}

/** How far motion aim leans the aim stick for a turn `past` degrees a second beyond still (as 52in1's Motion aim does). */
function aimLean(past: number): number {
  if (past === 0) return 0;
  const push = MOTION_AIM.floor + (1 - MOTION_AIM.floor) * Math.min(1, Math.abs(past) / MOTION_AIM.full);
  return Math.sign(past) * push;
}

/** A value clamped to 0..1 (0 when it is not a number). */
function unit(v: number | undefined): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v!)) : 0;
}

/** A phone or tablet (a coarse pointer, touch points): its player starts on touch. */
function touchFirst(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && (typeof navigator === 'undefined' || (navigator.maxTouchPoints ?? 1) > 0);
  } catch {
    return false;
  }
}

/**
 * Gamepad buttons that, held together, are the host page's (View and Menu: Create and Options; 52in1
 * opens its bar on them). Each presses its code as it is let go, and only if the other never went
 * down while it was held, so a pause or menu on Options (or Create) never opens behind the host's
 * bar however the two are pressed; held alone, each reads as held (`isDown`) as any button does.
 */
export const HOST_CHORD: readonly [number, number] = [8, 9];

/**
 * A key typed into a text field (an input, a textarea, contenteditable) or by a phone's soft
 * keyboard while it composes (`Unidentified`, keyCode 229): typing, not a keyboard picked up, so the
 * device in use (and the touch controls) stay as they were.
 */
function typing(e: KeyboardEvent): boolean {
  if (e.key === 'Unidentified' || e.isComposing || (e as { keyCode?: number }).keyCode === 229) return true;
  const t = e.target as { tagName?: unknown; isContentEditable?: unknown } | null;
  return !!t && (t.isContentEditable === true || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space';
}

/** Pointer capture is best-effort: it throws if the pointer is already gone. */
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointer no longer active */
  }
}
