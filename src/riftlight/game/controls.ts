/**
 * Input for Riftlight: one action map for keyboard, mouse, touch and gamepad.
 *
 *   move      WASD / arrows / left stick / touch joystick
 *   aim       mouse cursor on the ground; with a pad, the nearest enemy ahead
 *   attack    LMB / J / pad A / touch A          dodge   Space / pad B / touch B
 *   skills    RMB or 1 Q · 2 E · 3 R · 4 T / pad X Y LB RB / touch 1-4 (game/touch.ts)
 *   interact  F / pad RT / touch TALK…            pause   Esc / pad Start / touch ≡
 *   panels    I inventory · G skills · P passive tree · C character · K codex (pad Back = inventory)
 *   looks     L look studio · H hides its panel (the arrows still tweak) · O photo mode
 *   items     click / Enter / pad A · X / pad X = right-click · V / pad Y = Ctrl-click
 *
 * Gamepad buttons are remapped to virtual `Pad*` codes (input.gamepadButtons) so menus can
 * tell "A = confirm" from "Space = dodge". Menus get `UiEvent`s with key repeat.
 */
import { Raycaster, Vector2, Vector3 } from 'three/webgpu';
import type { Engine, Input } from '../../engine';
import type { UiEvent } from '../ui/kit';

export const PAD_BUTTONS: Record<number, string> = {
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
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
};

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
  hide: ['KeyH'],
  confirm: ['Enter', 'NumpadEnter', 'Space', 'KeyF', 'KeyJ', 'PadA'],
  back: ['Escape', 'Backspace', 'PadB'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  tabNext: ['PadRB', 'Tab'],
  tabPrev: ['PadLB'],
  /** Item windows: X / pad X = right-click (equip, socket, use), V / pad Y = Ctrl-click (move, sell, buy). */
  secondary: ['KeyX', 'PadX'],
  quick: ['KeyV', 'PadY'],
} as const;

/** The pointer's buttons as the engine's keys (`MOUSE_BUTTONS`, `TOUCH_KEY`): left (or a finger on the world) attacks, right is skill 1. */
export const MOUSE = { left: ['MouseLeft', 'Touch'], right: ['MouseRight'] } as const;

/** Labels for prompts: [key, pad button]. */
export const GLYPHS = {
  attack: ['LMB', 'A'],
  dodge: ['SPACE', 'B'],
  skill0: ['1', 'X'],
  skill1: ['2', 'Y'],
  skill2: ['3', 'LB'],
  skill3: ['4', 'RB'],
  interact: ['F', 'RT'],
  pause: ['ESC', 'START'],
  tree: ['P', 'START'],
  inventory: ['I', 'BACK'],
  confirm: ['ENTER', 'A'],
  back: ['ESC', 'B'],
} as const;

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
  /** Seconds since the mouse last moved or clicked (big = keyboard / pad player). */
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
    this.idle += dt;
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

/** Builds menu events from keys and the pad, with key repeat for held directions. */
export class MenuInput {
  private held = new Map<string, number>();

  /** Directions held and for how long (key repeat), as data (save-states). */
  save(): (readonly [string, number])[] {
    return [...this.held];
  }

  load(held: readonly (readonly [string, number])[]): void {
    this.held = new Map(held);
  }

  events(input: Input, dt: number): UiEvent[] {
    const out: UiEvent[] = [];
    const pressed = (codes: readonly string[]) => input.wasPressed(...codes);
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const codes = KEYS[dir];
      if (pressed(codes)) {
        out.push({ kind: 'nav', dir });
        this.held.set(dir, -0.35);
      } else if (input.anyDown(codes) || this.stick(input, dir)) {
        const t = (this.held.get(dir) ?? -0.35) + dt;
        if (t >= 0.07) {
          out.push({ kind: 'nav', dir });
          this.held.set(dir, 0);
        } else this.held.set(dir, t);
      } else this.held.delete(dir);
    }
    if (pressed(KEYS.confirm)) out.push({ kind: 'confirm' });
    if (pressed(KEYS.back)) out.push({ kind: 'back' });
    if (pressed(KEYS.tabNext)) out.push({ kind: 'tab', dir: 1 });
    if (pressed(KEYS.tabPrev)) out.push({ kind: 'tab', dir: -1 });
    for (const code of new Set([...KEYS.secondary, ...KEYS.quick, ...KEYS.hide])) if (pressed([code])) out.push({ kind: 'key', code });
    if (input.wheel) out.push({ kind: 'wheel', dy: input.wheel });
    return out;
  }

  /** The left stick as a held direction (menus with a pad). */
  private stick(input: Input, dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const a = input.padAxis;
    return dir === 'up' ? a.y > 0.6 : dir === 'down' ? a.y < -0.6 : dir === 'left' ? a.x < -0.6 : a.x > 0.6;
  }
}

/** Ground-plane camera basis (right, forward), allocation-free. */
export function cameraBasis(engine: Engine, right: Vector3, forward: Vector3): void {
  const m = engine.camera.camera.matrixWorld;
  right.setFromMatrixColumn(m, 0).setY(0).normalize();
  forward.setFromMatrixColumn(m, 2).negate().setY(0);
  if (forward.lengthSq() < 1e-6) forward.setFromMatrixColumn(m, 1).setY(0);
  forward.normalize();
}
