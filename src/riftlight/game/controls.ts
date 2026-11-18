/**
 * Input for Riftlight: one action map for keyboard, mouse, touch and gamepad.
 *
 *   move      WASD / arrows / left stick / touch joystick
 *   aim       mouse cursor on the ground; with a pad, the right stick with aim assist, else the nearest
 *             enemy ahead (the AI Hub's own Motion aim adds to the stick only while the controller turns;
 *             the engine's motion input, `settings: { motion: true }`, exists: Riftlight doesn't opt in yet)
 *   attack    LMB / J / pad Cross (A) / touch A          dodge   Space / pad Circle (B) / touch B
 *   skills    RMB or 1 Q · 2 E · 3 R · 4 T / pad Square Triangle L1 R1 (X Y LB RB) / touch 1-4
 *   interact  F / pad R2 (RT) / touch TALK…                pause   Esc / pad Options (Menu) / touch ≡
 *   panels    I inventory · G skills · P passive tree · C character · K codex (pad Create = inventory;
 *             the rest in the pause menu: Options opens it from any screen, and Options or Circle resume);
 *             open, Q / E or L1 / R1 page through them (`PAGES`), Tab or L2 / R2 their own tabs
 *   map       Tab / M / pad R3 or the touchpad's press / a click or tap on the corner map: the level's
 *             map over the play (Esc, or a tap on it, closes it too)
 *   looks     L look studio · H / pad Triangle hides its panel (the arrows still tweak) · O photo mode
 *             (H / pad L1 hides its panel)
 *   items     click / Enter / pad Cross · X / pad Square = right-click · V / pad Triangle = Ctrl-click
 *
 * Gamepad buttons press the engine's `Pad*` codes (`GAMEPAD_BUTTONS`), so menus can tell
 * "Cross = confirm" from "Space = dodge". Menus get `UiEvent`s with key repeat from the engine's
 * `MenuInput` (with `MENU_BINDINGS`). Prompts name and draw `CONTROLS` through the engine
 * (`engine.controls`: the device used last, PlayStation or Xbox buttons as the player chose).
 */
import { Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { type ControlTable, controlName, type Engine, type InputDevice, keyCap as engineKeyCap, type MenuKeys, type PadGlyphs, padName as enginePadName } from '../../engine';
import { lang } from '../lang';
import type { UiEvent } from '../ui/kit';

export const KEYS = {
  attack: ['KeyJ', 'PadA'],
  dodge: ['Space', 'PadB'],
  skill: [
    ['Digit1', 'KeyQ', 'PadX'],
    ['Digit2', 'KeyE', 'PadY'],
    ['Digit3', 'KeyR', 'PadLB'],
    ['Digit4', 'KeyT', 'PadRB'],
  ],
  interact: ['KeyF', 'PadRT'],
  pause: ['Escape', 'PadStart'],
  /** Options alone: it pauses from any screen of play and resumes from the pause menu (Esc is back first). */
  options: ['PadStart'],
  inventory: ['KeyI', 'PadBack'],
  skills: ['KeyG'],
  tree: ['KeyP'],
  character: ['KeyC'],
  codex: ['KeyK'],
  /** Photo mode (the showcase): free camera, filters, PNG capture. */
  photo: ['KeyO'],
  /** The look studio: pixel art, cel shading, palettes... per layer, with presets and sliders. */
  look: ['KeyL'],
  /** The look studio open: hide its panel (the arrows still tweak) or show it again. */
  hide: ['KeyH', 'PadY'],
  /** The level's map over the play (the world runs on): Tab or M; R3 or the DualSense's touchpad press. */
  map: ['Tab', 'KeyM', 'PadR3', 'PadTouchpad'],
  /** The map open: Esc closes it before it pauses (on a pad Circle dodges, so the map stays). */
  mapBack: ['Escape'],
  confirm: ['Enter', 'NumpadEnter', 'Space', 'KeyF', 'KeyJ', 'PadA'],
  back: ['Escape', 'Backspace', 'PadB'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  /** A window's own tabs (the stash's, the vendor's, the character sheet's pages): Tab / Shift+Tab, L2 / R2. */
  tabNext: ['Tab', 'PadRT'],
  tabPrev: ['PadLT'],
  /**
   * The character screens' ring (`PAGES`: inventory, skills, tree, character, codex), as on a
   * console: L1 / R1, Q / E. In the stash, the vendor and the bench they are their tabs.
   */
  pagePrev: ['PadLB', 'KeyQ'],
  pageNext: ['PadRB', 'KeyE'],
  /** Item windows: X / pad X = right-click (equip, socket, use), V / pad Y = Ctrl-click (move, sell, buy). */
  secondary: ['KeyX', 'PadX'],
  quick: ['KeyV', 'PadY'],
} as const;

/**
 * The menus' bindings for the engine's `MenuInput` (Riftlight's own: F and J confirm too; Q / E
 * and L1 / R1 page the character screens, so they arrive as `key` events the shell reads).
 */
export const MENU_BINDINGS: Partial<MenuKeys> = {
  confirm: KEYS.confirm,
  back: KEYS.back,
  up: KEYS.up,
  down: KEYS.down,
  left: KEYS.left,
  right: KEYS.right,
  tabNext: KEYS.tabNext,
  tabPrev: KEYS.tabPrev,
  keys: [...KEYS.secondary, ...KEYS.quick, ...KEYS.hide, ...KEYS.pagePrev, ...KEYS.pageNext],
};

/** The pointer's buttons as the engine's keys (`MOUSE_BUTTONS`, `TOUCH_KEY`): left (or a finger on the world) attacks, right is skill 1. */
export const MOUSE = { left: ['MouseLeft', 'Touch'], right: ['MouseRight'] } as const;

/**
 * The hero controller's action tokens (actors/controls.ts `HERO_KEYS`) as the game's keys, mouse
 * buttons and pad buttons: attack LMB / J / Cross, dodge Space / Circle, slot 0 RMB / 1 / Q /
 * Square, 1 2 / E / Triangle, 2 3 / R / L1, 3 4 / T / R1, the Arena's fifth F / R2.
 */
export function heroCodes(tokens: readonly string[]): readonly string[] {
  let codes = heroCodeCache.get(tokens);
  if (!codes) heroCodeCache.set(tokens, (codes = tokens.flatMap((tok) => HERO_CODES[tok] ?? [tok])));
  return codes;
}
/** Each token list's codes, by the list (`HERO_KEYS` arrays: the same each step). */
const heroCodeCache = new Map<readonly string[], readonly string[]>();
const HERO_CODES: Readonly<Record<string, readonly string[]>> = {
  attack: [MOUSE.left[0], ...KEYS.attack],
  dodge: KEYS.dodge,
  'slot:0': [MOUSE.right[0], ...KEYS.skill[0]],
  'slot:1': KEYS.skill[1],
  'slot:2': KEYS.skill[2],
  'slot:3': KEYS.skill[3],
  'slot:4': KEYS.interact,
};

/** The character screens as one ring a pad pages through with L1 / R1 (Q / E on the keyboard): their panels' ids, in order. */
export const PAGES = ['inventory', 'skills', 'tree', 'character', 'codex'] as const;
export type Page = (typeof PAGES)[number];

/** Each page's name in the ring's strip (the pause menu's buttons for them). */
export const PAGE_LINES: Readonly<Record<Page, string>> = { inventory: 'menu.pause.inventory', skills: 'menu.pause.skills', tree: 'menu.pause.tree', character: 'menu.pause.character', codex: 'menu.pause.codex' };

/**
 * The actions a line can name as a control tag, `{key:dodge}` (docs/game/lang.md), and the key
 * (an `event.code`, a mouse button or the wheel, or a name for several: `WASD`, `QE`), pad button
 * (the engine's `GAMEPAD_BUTTONS` codes, `PadLStick`, `PadRStick`) and touch button (its label, or a
 * name for a gesture: `TouchStick`, `TouchDrag`) that do each: `Riftlight.controls`, so the engine
 * names them in every line (a name is a line: `key.<code>`, `pad.ps.cross`). Actions without a pad
 * or touch button of their own are in the pause menu (Options / ≡ opens it); the showcase's own
 * (the arcade, the Hall of Beasts, photo mode) show the key where a device has nothing for them.
 */
export const CONTROLS = {
  attack: { key: 'MouseLeft', pad: 'PadA', touch: 'A' },
  dodge: { key: 'Space', pad: 'PadB', touch: 'B' },
  skill1: { key: 'Digit1', pad: 'PadX', touch: '1' },
  skill2: { key: 'Digit2', pad: 'PadY', touch: '2' },
  skill3: { key: 'Digit3', pad: 'PadLB', touch: '3' },
  skill4: { key: 'Digit4', pad: 'PadRB', touch: '4' },
  interact: { key: 'KeyF', pad: 'PadRT', touch: 'TouchInteract' },
  pause: { key: 'Escape', pad: 'PadStart', touch: '≡' },
  inventory: { key: 'KeyI', pad: 'PadBack', touch: '≡' },
  skills: { key: 'KeyG', pad: 'PadStart', touch: '≡' },
  tree: { key: 'KeyP', pad: 'PadStart', touch: '≡' },
  character: { key: 'KeyC', pad: 'PadStart', touch: '≡' },
  codex: { key: 'KeyK', pad: 'PadStart', touch: '≡' },
  photo: { key: 'KeyO', pad: 'PadStart', touch: '≡' },
  look: { key: 'KeyL', pad: 'PadStart', touch: '≡' },
  hide: { key: 'KeyH', pad: 'PadY', touch: '≡' },
  zoom: { key: 'Wheel', pad: 'PadStart', touch: '≡' },
  map: { key: 'Tab', pad: 'PadR3', touch: 'TouchTap' },
  // the showcase (showcase/: ArcadeStage, BestiaryMode, PhotoMode)
  move: { key: 'WASD', pad: 'PadLStick', touch: 'TouchStick' },
  jump: { key: 'Space', pad: 'PadA', touch: 'B' },
  pound: { key: 'KeyC', pad: 'PadB', touch: 'TouchStickDown' },
  confirm: { key: 'Enter', pad: 'PadA', touch: 'TouchTap' },
  // the legend under menus and panels (ui/legend.ts), the character screens' ring, their tabs
  back: { key: 'Escape', pad: 'PadB', touch: '≡' },
  page_prev: { key: 'KeyQ', pad: 'PadLB' },
  page_next: { key: 'KeyE', pad: 'PadRB' },
  tab_prev: { key: 'ArrowLeft', pad: 'PadLT' },
  tab_next: { key: 'ArrowRight', pad: 'PadRT' },
  details: { key: 'Tab', pad: 'PadY' },
  turn: { key: 'MouseOrQE', pad: 'PadRStick', touch: 'TouchDrag' },
  drag: { key: 'MouseDrag', pad: 'PadRStick', touch: 'TouchDrag' },
  orbit: { key: 'DragOrQE', pad: 'PadRStick', touch: 'TouchDrag' },
  rise: { key: 'QE' },
  switch_view: { key: 'Tab', pad: 'PadY' },
  next_wing: { key: 'KeyN' },
  photo_save: { key: 'KeyP', pad: 'PadX' },
  /** Photo mode's panel hidden or shown: H, or L1 (Triangle switches fly / edit there). */
  photo_hide: { key: 'KeyH', pad: 'PadLB' },
} as const satisfies ControlTable;
export type ControlAction = keyof typeof CONTROLS;

/** The device prompts name controls for (the engine's `controls.device`: the input used last; a touch is the keys' without touch controls). */
export type ControlDevice = InputDevice;

/** A key's name on a key cap, in the game's language: the short form when there is one (`Space` → Spc). */
export function keyCap(code: string): string {
  return engineKeyCap(code, lang());
}

/** A pad button's name in the game's language and the player's style (`PadA` → Cross or A). */
export function padName(code: string, style: PadGlyphs = 'playstation'): string {
  return enginePadName(code, style, lang());
}

/** The control that does `action` on `device`, as a prompt names it (`{key:action}` in a line); the key where the device has none for it. */
export function controlLabel(action: string, device: ControlDevice, style: PadGlyphs = 'playstation'): string {
  const c = (CONTROLS as ControlTable)[action];
  return c ? controlName(c, device, style, lang()) : action;
}

/** A point in normalised device coordinates over the canvas → art pixels (`renderer.resolution`). */
export function ndcToArt(engine: Engine, x: number, y: number): { x: number; y: number } {
  const res = engine.renderer.resolution;
  return { x: Math.min(res.width - 1, Math.max(0, Math.floor(((x + 1) / 2) * res.width))), y: Math.min(res.height - 1, Math.max(0, Math.floor(((1 - y) / 2) * res.height))) };
}

/** The pointer's buttons as `UiEvent` buttons: engine key → [`PointerEvent.button`, bit in `Pointer.buttons`]; a finger is a left button. */
const BUTTONS: Readonly<Record<string, readonly [number, number]>> = { MouseLeft: [0, 1], MouseRight: [2, 2], Touch: [0, 4] };

/**
 * The mouse / touch pointer in art pixels and on the ground, read from `ctx.input` (where it
 * is over the canvas, its buttons as `MouseLeft` / `MouseRight` keys), so a recording of the
 * game replays it: aim, clicks and menus alike.
 */
/** `Pointer.save`. */
export interface PointerState {
  readonly art: readonly [number, number];
  readonly buttons: number;
  readonly idle: number;
  readonly touch: boolean;
}

export class Pointer {
  /** Art-pixel position (updated each frame; -1 until the pointer was over the canvas). */
  readonly art = { x: -1, y: -1 };
  /** Buttons held: 1 left, 2 right, 4 a finger. */
  buttons = 0;
  /** Seconds since the mouse last moved, clicked or let go, not counting while a button is held (big = keyboard / pad player). */
  idle = 1e9;
  touch = false;
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();

  constructor(private readonly engine: Engine) {}

  /** Client → art pixels (DOM layout: where a touch control sits on the HUD). */
  toArt(x: number, y: number): { x: number; y: number } {
    const canvas = this.engine.gpu?.renderer.domElement;
    if (!canvas) return { x: -1, y: -1 }; // headless: no page layout
    const r = canvas.getBoundingClientRect();
    const res = this.engine.renderer.resolution;
    if (r.width <= 0 || r.height <= 0) return { x: -1, y: -1 };
    return { x: Math.floor(((x - r.left) / r.width) * res.width), y: Math.floor(((y - r.top) / r.height) * res.height) };
  }

  /**
   * Start of a frame: what the pointer did since the last frame as UI events, in order (each
   * button pressed or let go where it was: `input.buttonEvents`, so a drag shorter than a frame
   * still runs from where it started), then where it is now (while it is over the canvas: a
   * tap's finger has gone by the frame after, and the tap stays where it was).
   */
  frame(dt: number): UiEvent[] {
    // a button held is the mouse in use, moved or not (holding the attack on a boss with a still mouse keeps its aim)
    if (this.buttons === 0) this.idle += dt;
    const input = this.engine.input;
    this.touch = input.pointer.touch;
    const out: UiEvent[] = [];
    const moveTo = (x: number, y: number) => {
      const at = ndcToArt(this.engine, x, y);
      if (at.x === this.art.x && at.y === this.art.y) return;
      this.art.x = at.x;
      this.art.y = at.y;
      out.push({ kind: 'pointer', type: 'move', x: at.x, y: at.y, touch: input.pointer.touch });
      this.idle = 0;
    };
    for (const e of input.buttonEvents) {
      const b = BUTTONS[e.code];
      if (!b) continue;
      moveTo(e.x, e.y);
      out.push({ kind: 'pointer', type: e.down ? 'down' : 'up', x: this.art.x, y: this.art.y, button: b[0], touch: e.code === 'Touch' });
      this.buttons = e.down ? this.buttons | b[1] : this.buttons & ~b[1];
      this.idle = 0;
    }
    if (input.pointer.over) moveTo(input.pointer.x, input.pointer.y);
    return out;
  }

  /** The ground point (y = `groundY`) under the pointer, into `out`. False when unknown. */
  ground(out: Vector3, groundY = 0): boolean {
    if (this.art.x < 0) return false;
    const res = this.engine.renderer.resolution;
    this.ndc.set(((this.art.x + 0.5) / res.width) * 2 - 1, -(((this.art.y + 0.5) / res.height) * 2 - 1));
    this.ray.setFromCamera(this.ndc, this.engine.camera.camera);
    const { origin, direction } = this.ray.ray;
    if (Math.abs(direction.y) < 1e-5) return false;
    const t = (groundY - origin.y) / direction.y;
    if (t < 0) return false;
    out.copy(origin).addScaledVector(direction, t);
    return true;
  }

  get known(): boolean {
    return this.art.x >= 0;
  }

  /** Where it was and what it held, as data (save-states). */
  save(): PointerState {
    return { art: [this.art.x, this.art.y], buttons: this.buttons, idle: this.idle, touch: this.touch };
  }

  load(s: PointerState): void {
    [this.art.x, this.art.y] = s.art;
    this.buttons = s.buttons;
    this.idle = s.idle;
    this.touch = s.touch;
  }

  /** Nothing to let go of: the pointer is the engine's. */
  dispose(): void {}
}

/** Ground-plane camera basis (right, forward), allocation-free. */
export function cameraBasis(engine: Engine, right: Vector3, forward: Vector3): void {
  const m = engine.camera.camera.matrixWorld;
  right.setFromMatrixColumn(m, 0).setY(0).normalize();
  forward.setFromMatrixColumn(m, 2).negate().setY(0);
  if (forward.lengthSq() < 1e-6) forward.setFromMatrixColumn(m, 1).setY(0);
  forward.normalize();
}
