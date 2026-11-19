/**
 * Prompts for every device. A game's controls are data (`ControlTable`: each action's key, pad
 * button and touch button); `engine.controls` holds the running game's (`Game.controls`) and
 * follows `input.device` and the player's `settings.padGlyphs`, so every `{key:action}` in a line,
 * `hud.glyph` and `hud.prompt` name and draw the control in use: a key cap or a mouse button on
 * the keyboard and mouse; PlayStation's Cross, Circle, Square and Triangle (the default) or Xbox's
 * A, B, X and Y on a pad; the touch button on a phone.
 *
 *   class MyGame { controls = { jump: { key: 'Space', pad: 'PadA', touch: 'A' }, ... } }
 *   t('help.jump')                       // "{key:jump} to jump" → "Space to jump", "Cross to jump", "A to jump"
 *   ctx.hud.prompt(8, 250, 'jump', 'JUMP') // the glyph, then the label
 *
 * Names are lines (`CONTROL_LINES`, English): a game that has a line of the same id in its own
 * list shows its translation (`names`, a `Lang`). Glyphs are small sprites in the `hud.sprite`
 * row format (face buttons, mouse buttons, the sticks, the d-pad), or caps with a name (keys,
 * shoulder buttons, Options): a surface of a game's own draws them with its own font.
 */
import type { HudColor } from './hud/Hud';
import type { Input, InputDevice } from './input';
import type { PadGlyphs, PlayerSettings } from './settings';

/** One action's controls: its key (an `event.code`, a mouse button, `Wheel`, or a name for several: `WASD`), pad button (`Pad*`, `PadStick`, `DPad`) and touch button (its label, or a gesture: `TouchTap`). */
export interface Control {
  readonly key: string;
  readonly pad?: string;
  readonly touch?: string;
}

/** A game's actions and their controls (`Game.controls`). */
export type ControlTable = Readonly<Record<string, Control>>;

/** Where names come from: a game's language (`Lang`). An id it has is its translation; any other is English. */
export interface LineSource {
  has(id: string): boolean;
  t(id: string): string;
}

/** The names the engine shows for controls, by line id (English). A game translates one by having a line of the same id. */
export const CONTROL_LINES = {
  'key.space': 'Space',
  'key.space.short': 'Spc',
  'key.esc': 'Esc',
  'key.enter': 'Enter',
  'key.tab': 'Tab',
  'key.backspace': 'Backspace',
  'key.shift': 'Shift',
  'key.ctrl': 'Ctrl',
  'key.alt': 'Alt',
  'key.up': 'Up',
  'key.down': 'Down',
  'key.left': 'Left',
  'key.right': 'Right',
  'key.arrows': 'Arrows',
  'key.wasd': 'WASD',
  'key.mouse_left': 'LMB',
  'key.mouse_right': 'RMB',
  'key.mouse_middle': 'MMB',
  'key.mouse_wheel': 'Wheel',
  'pad.ps.cross': 'Cross',
  'pad.ps.circle': 'Circle',
  'pad.ps.square': 'Square',
  'pad.ps.triangle': 'Triangle',
  'pad.ps.l1': 'L1',
  'pad.ps.r1': 'R1',
  'pad.ps.l2': 'L2',
  'pad.ps.r2': 'R2',
  'pad.ps.l3': 'L3',
  'pad.ps.r3': 'R3',
  'pad.ps.create': 'Create',
  'pad.ps.options': 'Options',
  'pad.ps.touchpad': 'Touchpad',
  'pad.touchpad_left': 'Touchpad left',
  'pad.touchpad_right': 'Touchpad right',
  'pad.touchpad_up': 'Touchpad up',
  'pad.touchpad_down': 'Touchpad down',
  'pad.touchpad_tap': 'Touchpad tap',
  'pad.lb': 'LB',
  'pad.rb': 'RB',
  'pad.lt': 'LT',
  'pad.rt': 'RT',
  'pad.xbox.ls': 'LS',
  'pad.xbox.rs': 'RS',
  'pad.xbox.view': 'View',
  'pad.xbox.menu': 'Menu',
  'pad.stick': 'Stick',
  'pad.stick.left': 'Left stick',
  'pad.stick.right': 'Right stick',
  'pad.dpad': 'D-pad',
  'key.touch.tap': 'Tap',
  'key.touch.drag': 'Drag',
  'key.touch.stick': 'Stick',
  'key.touch.swipe': 'Swipe',
} as const satisfies Readonly<Record<string, string>>;

/** Keys and mouse buttons whose names are words (lines); a letter or a digit shows its own character. */
const KEY_IDS: Readonly<Record<string, string>> = {
  Space: 'key.space',
  Escape: 'key.esc',
  Enter: 'key.enter',
  NumpadEnter: 'key.enter',
  Tab: 'key.tab',
  Backspace: 'key.backspace',
  ShiftLeft: 'key.shift',
  ShiftRight: 'key.shift',
  ControlLeft: 'key.ctrl',
  ControlRight: 'key.ctrl',
  AltLeft: 'key.alt',
  AltRight: 'key.alt',
  ArrowUp: 'key.up',
  ArrowDown: 'key.down',
  ArrowLeft: 'key.left',
  ArrowRight: 'key.right',
  Arrows: 'key.arrows',
  WASD: 'key.wasd',
  MouseLeft: 'key.mouse_left',
  MouseRight: 'key.mouse_right',
  MouseMiddle: 'key.mouse_middle',
  Wheel: 'key.mouse_wheel',
};

/** Pad buttons whose names are words, in each style; the Xbox face buttons show their letter. */
const PAD_IDS: Readonly<Record<PadGlyphs, Readonly<Record<string, string>>>> = {
  playstation: {
    PadA: 'pad.ps.cross',
    PadB: 'pad.ps.circle',
    PadX: 'pad.ps.square',
    PadY: 'pad.ps.triangle',
    PadLB: 'pad.ps.l1',
    PadRB: 'pad.ps.r1',
    PadLT: 'pad.ps.l2',
    PadRT: 'pad.ps.r2',
    PadL3: 'pad.ps.l3',
    PadR3: 'pad.ps.r3',
    PadBack: 'pad.ps.create',
    PadStart: 'pad.ps.options',
    PadTouchpad: 'pad.ps.touchpad',
  },
  xbox: {
    PadLB: 'pad.lb',
    PadRB: 'pad.rb',
    PadLT: 'pad.lt',
    PadRT: 'pad.rt',
    PadL3: 'pad.xbox.ls',
    PadR3: 'pad.xbox.rs',
    PadBack: 'pad.xbox.view',
    PadStart: 'pad.xbox.menu',
    PadTouchpad: 'pad.ps.touchpad',
  },
};
/** Both styles: the sticks and the d-pad (its directions are the arrow keys' codes). */
const PAD_SHARED: Readonly<Record<string, string>> = { PadStick: 'pad.stick', PadLStick: 'pad.stick.left', PadRStick: 'pad.stick.right', DPad: 'pad.dpad' };

/** `MouseOrQE` → `mouse_or_q_e`: a game's own code, as the line id that names it. */
function snake(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])(?=[A-Z])/g, '$1_')
    .toLowerCase();
}

/** The name under `id`: the game's line when it has one, else the engine's English, else null. */
function line(id: string, names: LineSource | null | undefined): string | null {
  if (names?.has(id)) return names.t(id);
  return (CONTROL_LINES as Record<string, string>)[id] ?? null;
}

/**
 * A key's or mouse button's name (`KeyF` → F, `Space` → "Space", `MouseLeft` → "LMB"). A game's
 * own code (`MouseOrQE`, `QE`) is named by its line `key.<snake_case>` (`key.mouse_or_q_e`).
 */
export function keyName(code: string, names?: LineSource | null): string {
  const id = KEY_IDS[code] ?? `key.${snake(code)}`;
  return line(id, names) ?? code.replace(/^(Key|Digit|Numpad)/, '');
}

/** A key's name on a small key cap: the short form (`key.space.short`: "Spc") when there is one. */
export function keyCap(code: string, names?: LineSource | null): string {
  const id = KEY_IDS[code];
  return (id && line(`${id}.short`, names)) || keyName(code, names);
}

/** A pad button's name in a style (`PadA` → "Cross" or "A", `PadStart` → "Options" or "Menu"); a d-pad direction (`ArrowUp`) is the d-pad's. */
export function padName(code: string, style: PadGlyphs = 'playstation', names?: LineSource | null): string {
  if (code.startsWith('Arrow')) return line('pad.dpad', names) ?? 'D-pad';
  const id = PAD_IDS[style][code] ?? PAD_SHARED[code] ?? `pad.${snake(code.replace(/^Pad/, ''))}`;
  return line(id, names) ?? code.replace(/^Pad/, '');
}

/** A touch control's name: a button's own label (`A`, `≡`), or a gesture's line (`TouchTap` → `key.touch.tap`, "Tap"). */
export function touchName(code: string, names?: LineSource | null): string {
  if (!code.startsWith('Touch') || code === 'Touch') return code;
  return line(`key.touch.${snake(code.slice(5))}`, names) ?? code.slice(5);
}

/** What does `c` on `device` (`{key:action}`): the pad's or touch's control when it has one, else the key. */
export function controlName(c: Control, device: InputDevice, style: PadGlyphs = 'playstation', names?: LineSource | null): string {
  if (device === 'pad' && c.pad) return padName(c.pad, style, names);
  if (device === 'touch' && c.touch) return touchName(c.touch, names);
  return keyName(c.key, names);
}

/**
 * A control as it is drawn: a sprite (`hud.sprite` rows and colours: face buttons, mouse buttons,
 * the sticks, the d-pad) or a cap with a name (`round`: a pad's or a touch button, dark; else a
 * key cap, light).
 */
export type Glyph =
  | { readonly kind: 'sprite'; readonly rows: readonly string[]; readonly colors: Readonly<Record<string, HudColor>> }
  | { readonly kind: 'cap'; readonly text: string; readonly round: boolean };

/** Glyph sprites are this many art pixels square: as tall as a line of the 5×7 font. */
export const GLYPH_SIZE = 7;

const RING = '.ooooo.';
/** A round button: an ink ring (`o`) around a 5×5 face (`f`: the face, `s` / `l`: its symbol or letter). */
const round = (face: readonly string[]): string[] => [RING, ...face.map((r) => `o${r}o`), RING];
/**
 * PlayStation's face buttons: the symbol in its colour on a light button, readable at ten feet
 * (Cross blue, Circle red, Square pink, the palette's plum, Triangle green, its teal).
 */
const PS_FACES: Readonly<Record<string, { readonly rows: readonly string[]; readonly color: HudColor }>> = {
  PadA: { color: 'blue', rows: round(['sfffs', 'fsfsf', 'ffsff', 'fsfsf', 'sfffs']) },
  PadB: { color: 'red', rows: round(['fsssf', 'sfffs', 'sfffs', 'sfffs', 'fsssf']) },
  PadX: { color: 'plum', rows: round(['fffff', 'fsssf', 'fsfsf', 'fsssf', 'fffff']) },
  PadY: { color: 'teal', rows: round(['fffff', 'ffsff', 'fsfsf', 'sssss', 'fffff']) },
};
/**
 * Xbox's face buttons: a round button in its colour with a bright letter, readable at ten feet (A
 * green, B red, X blue, Y yellow: the palette's orange, a white Y on it; a dark letter on a bright
 * disc read as a 'W' from the couch).
 */
const XBOX_FACES: Readonly<Record<string, { readonly rows: readonly string[]; readonly color: HudColor; readonly letter: HudColor }>> = {
  PadA: { color: 'green', letter: 'white', rows: round(['fflff', 'flflf', 'flllf', 'flflf', 'flflf']) },
  PadB: { color: 'red', letter: 'white', rows: round(['fllff', 'flflf', 'fllff', 'flflf', 'fllff']) },
  PadX: { color: 'blue', letter: 'white', rows: round(['flflf', 'flflf', 'fflff', 'flflf', 'flflf']) },
  PadY: { color: 'orange', letter: 'white', rows: round(['flflf', 'flflf', 'fflff', 'fflff', 'fflff']) },
};
/** The sticks (a cap with a dot, or L / R for the left and right one) and the d-pad (the pressed arm lit). */
const STICKS: Readonly<Record<string, readonly string[]>> = {
  PadStick: round(['fffff', 'fdddf', 'fdsdf', 'fdddf', 'fffff']),
  PadLStick: round(['fsfff', 'fsfff', 'fsfff', 'fsfff', 'fsssf']),
  PadRStick: round(['fssff', 'fsfsf', 'fssff', 'fsfsf', 'fsfsf']),
};
const DPAD: Readonly<Record<string, readonly string[]>> = {
  DPad: ['..ooo..', '..ofo..', 'ooofooo', 'offfffo', 'ooofooo', '..ofo..', '..ooo..'],
  ArrowUp: ['..ooo..', '..oso..', 'ooofooo', 'offfffo', 'ooofooo', '..ofo..', '..ooo..'],
  ArrowDown: ['..ooo..', '..ofo..', 'ooofooo', 'offfffo', 'ooofooo', '..oso..', '..ooo..'],
  ArrowLeft: ['..ooo..', '..ofo..', 'ooofooo', 'osffffo', 'ooofooo', '..ofo..', '..ooo..'],
  ArrowRight: ['..ooo..', '..ofo..', 'ooofooo', 'offffso', 'ooofooo', '..ofo..', '..ooo..'],
};
/**
 * A DualSense's touchpad gestures (`TOUCHPAD_KEYS`): the pad, wider than tall with round corners
 * (`f`, a cap's slate), and the gesture on it (`s`): a swipe's way as an arrow, a tap as a dot.
 */
const TOUCHPAD: Readonly<Record<string, readonly string[]>> = {
  PadTouchpadLeft: ['.......', '.fffff.', 'ffsffff', 'fsssssf', 'ffsffff', '.fffff.', '.......'],
  PadTouchpadRight: ['.......', '.fffff.', 'ffffsff', 'fsssssf', 'ffffsff', '.fffff.', '.......'],
  PadTouchpadUp: ['.......', '.ffsff.', 'ffsssff', 'fsfsfsf', 'fffsfff', '.ffsff.', '.......'],
  PadTouchpadDown: ['.......', '.ffsff.', 'fffsfff', 'fsfsfsf', 'ffsssff', '.ffsff.', '.......'],
  PadTouchpadTap: ['.......', '.fffff.', 'fffsfff', 'ffsssff', 'fffsfff', '.fffff.', '.......'],
};
/** The mouse: its body, the button (or the wheel) that does it lit (`s`). */
const MOUSE: Readonly<Record<string, readonly string[]>> = {
  MouseLeft: ['.ooooo.', 'ossowwo', 'ossowwo', 'ooooooo', 'owwwwwo', 'owwwwwo', '.ooooo.'],
  MouseRight: ['.ooooo.', 'owwosso', 'owwosso', 'ooooooo', 'owwwwwo', 'owwwwwo', '.ooooo.'],
  MouseMiddle: ['.ooooo.', 'owwswwo', 'owwswwo', 'ooooooo', 'owwwwwo', 'owwwwwo', '.ooooo.'],
  Wheel: ['.ooooo.', 'owwswwo', 'owwswwo', 'ooosooo', 'owwwwwo', 'owwwwwo', '.ooooo.'],
};

/** The glyph of a key or mouse button: the mouse drawn, else a key cap with its short name. */
export function keyGlyph(code: string, names?: LineSource | null): Glyph {
  const mouse = MOUSE[code];
  if (mouse) return { kind: 'sprite', rows: mouse, colors: { o: 'ink', w: 'white', s: 'sand' } };
  return { kind: 'cap', text: keyCap(code, names), round: false };
}

/** The glyph of a pad button in a style: the face buttons, sticks, d-pad and the touchpad's gestures drawn, the rest a round cap with its name (L1, Options; LB, Menu). */
export function padGlyph(code: string, style: PadGlyphs = 'playstation', names?: LineSource | null): Glyph {
  if (style === 'xbox') {
    const f = XBOX_FACES[code];
    if (f) return { kind: 'sprite', rows: f.rows, colors: { o: 'ink', f: f.color, l: f.letter } };
  } else {
    const f = PS_FACES[code];
    if (f) return { kind: 'sprite', rows: f.rows, colors: { o: 'ink', f: 'white', s: f.color } };
  }
  const stick = STICKS[code];
  if (stick) return { kind: 'sprite', rows: stick, colors: { o: 'ink', f: 'slate', d: 'night', s: 'white' } };
  const dpad = DPAD[code];
  if (dpad) return { kind: 'sprite', rows: dpad, colors: { o: 'ink', f: 'slate', s: 'white' } };
  const touchpad = TOUCHPAD[code];
  if (touchpad) return { kind: 'sprite', rows: touchpad, colors: { f: 'slate', s: 'white' } };
  return { kind: 'cap', text: padName(code, style, names), round: true };
}

/** The glyph of `c` on `device`: the pad's or touch's control when it has one, else the key's. */
export function controlGlyph(c: Control, device: InputDevice, style: PadGlyphs = 'playstation', names?: LineSource | null): Glyph {
  if (device === 'pad' && c.pad) return padGlyph(c.pad, style, names);
  if (device === 'touch' && c.touch) return { kind: 'cap', text: touchName(c.touch, names), round: true };
  return keyGlyph(c.key, names);
}

/** A control for a code alone (`hud.glyph(x, y, 'PadA')`): on the device its code belongs to. */
function codeControl(code: string): { control: Control; device: InputDevice } | null {
  if (code.startsWith('Pad') || code === 'DPad') return { control: { key: code, pad: code }, device: 'pad' };
  if (code.startsWith('Touch')) return { control: { key: code, touch: code }, device: 'touch' };
  if (/^(Key|Digit|Numpad|Mouse|Arrow|Shift|Control|Alt)|^(Space|Escape|Enter|Tab|Backspace|Wheel|WASD|Arrows)$/.test(code)) return { control: { key: code }, device: 'keyboard' };
  return null;
}

/**
 * `engine.controls`: the running game's control table (`Game.controls`, set at each level) on the
 * device in use (`input.device`) and in the player's button style (`settings.padGlyphs`).
 * `{key:action}` in any `Lang`'s line is `label(action)` (`Lang.controlLabel`'s default), so a
 * game with a table shows the right key, button or touch control everywhere without wiring.
 */
export class Controls {
  /** The game's actions and their controls (`Game.controls`; empty: `{key:action}` shows the action's id). */
  table: ControlTable = {};
  /** Where names come from when no language is given: the game's (`Lang`), or null for English. */
  names: LineSource | null = null;
  /**
   * The engine shows touch controls (`TouchControls`; headless: `EngineOptions.touch`). Without
   * them a touch means the keyboard's prompts: a tap on a touch-screen laptop must not name
   * buttons that are not on screen.
   */
  touch = false;

  constructor(
    private readonly input: Pick<Input, 'device'>,
    private readonly settings: { readonly values: Readonly<PlayerSettings> },
  ) {}

  /** The device prompts are for: the input used last (a touch is the keyboard's while no touch controls show). */
  get device(): InputDevice {
    const d = this.input.device;
    return d === 'touch' && !this.touch ? 'keyboard' : d;
  }

  /** The player's button style (`settings.padGlyphs`; PlayStation unless they chose Xbox). */
  get style(): PadGlyphs {
    return this.settings.values.padGlyphs ?? 'playstation';
  }

  /** An action's controls, or a code's own (`PadA`, `KeyF`, `MouseLeft`) on its device. */
  private find(action: string): { control: Control; device: InputDevice } | null {
    const c = Object.hasOwn(this.table, action) ? this.table[action] : undefined;
    if (c) return { control: c, device: this.device };
    return codeControl(action);
  }

  /** What `{key:action}` shows: the control's name on the device in use (the action's id when the table has none). */
  label(action: string, names: LineSource | null = this.names): string {
    const f = this.find(action);
    return f ? controlName(f.control, f.device, this.style, names) : action;
  }

  /** How `action` (or a code) is drawn on the device in use, or null when it is neither. */
  glyph(action: string, names: LineSource | null = this.names): Glyph | null {
    const f = this.find(action);
    return f ? controlGlyph(f.control, f.device, this.style, names) : null;
  }

  /**
   * Whether the device in use has a control of its own for `action`: a pad button on the pad, a
   * touch button or gesture on a touch screen (the keyboard always has its key). Without one,
   * `glyph` falls back to the key; a legend shows the words alone (`hud.legend`).
   */
  onDevice(action: string): boolean {
    const f = this.find(action);
    if (!f) return false;
    return f.device === 'pad' ? !!f.control.pad : f.device === 'touch' ? !!f.control.touch : true;
  }
}

/** The running engine's controls, which `Lang.controlLabel` names `{key:action}` with by default. */
let active: Controls | null = null;

/** @internal The engine, when it is made, and when it is disposed (`was`: only if it is still the active one). */
export function setActiveControls(c: Controls | null, was?: Controls): void {
  if (was === undefined || active === was) active = c;
}

/** @internal `Lang.controlLabel`'s default: the running game's control on the device in use, named in `names`' language. */
export function activeControlLabel(action: string, names: LineSource): string {
  return active ? active.label(action, names) : action;
}
