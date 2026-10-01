/**
 * Input for Riftlight: one action map for keyboard, mouse, touch and gamepad.
 *
 *   move      WASD / arrows / left stick / touch joystick
 *   aim       mouse cursor on the ground; with a pad, the nearest enemy ahead
 *   attack    LMB / J / pad A / touch A          dodge   Space / pad B / touch B
 *   skills    RMB or 1 Q · 2 E · 3 R · 4 T / pad X Y LB RB / touch 1 2
 *   interact  F / pad RT / touch F               pause   Esc / pad Start / touch ≡
 *   panels    I inventory · G skills · P passive tree · C character · K codex (pad Back = inventory)
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

/** The mouse / touch pointer in art pixels and on the ground. */
export class Pointer {
  /** Client position. */
  private cx = -1;
  private cy = -1;
  /** Art-pixel position (updated each frame). */
  readonly art = { x: -1, y: -1 };
  /** Buttons held: 1 left, 2 right. */
  buttons = 0;
  /** Pointer events since the last frame, in client coordinates. */
  private queue: { type: 'move' | 'down' | 'up'; x: number; y: number; button: number }[] = [];
  /** Seconds since the mouse last moved or clicked (big = keyboard / pad player). */
  idle = 1e9;
  touch = false;
  private readonly abort = new AbortController();
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();

  constructor(private readonly engine: Engine) {
    const signal = this.abort.signal;
    const on = (type: 'pointermove' | 'pointerdown' | 'pointerup', kind: 'move' | 'down' | 'up') =>
      window.addEventListener(
        type,
        (e) => {
          this.cx = e.clientX;
          this.cy = e.clientY;
          this.touch = e.pointerType === 'touch';
          // The touch joystick and buttons are DOM controls on top: they are not the pointer.
          if (kind !== 'move' && (e.target as HTMLElement | null)?.closest?.('.touch-ui')) return;
          if (kind === 'down') this.buttons |= e.button === 2 ? 2 : 1;
          if (kind === 'up') this.buttons &= e.button === 2 ? ~2 : ~1;
          this.queue.push({ type: kind, x: e.clientX, y: e.clientY, button: e.button });
          this.idle = 0;
        },
        { signal },
      );
    on('pointermove', 'move');
    on('pointerdown', 'down');
    on('pointerup', 'up');
    window.addEventListener('blur', () => (this.buttons = 0), { signal });
  }

  /** Client → art pixels. */
  toArt(x: number, y: number): { x: number; y: number } {
    const canvas = this.engine.renderer.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    const res = this.engine.renderer.resolution;
    if (r.width <= 0 || r.height <= 0) return { x: -1, y: -1 };
    return { x: Math.floor(((x - r.left) / r.width) * res.width), y: Math.floor(((y - r.top) / r.height) * res.height) };
  }

  /** Start of a frame: art position and the queued events as UI pointer events. */
  frame(dt: number): UiEvent[] {
    this.idle += dt;
    const p = this.toArt(this.cx, this.cy);
    this.art.x = p.x;
    this.art.y = p.y;
    const out: UiEvent[] = this.queue.map((e) => ({ kind: 'pointer' as const, type: e.type, ...this.toArt(e.x, e.y) }));
    this.queue = [];
    return out;
  }

  /** The ground point (y = `groundY`) under the pointer, into `out`. False when unknown. */
  ground(out: Vector3, groundY = 0): boolean {
    if (this.art.x < 0) return false;
    const res = this.engine.renderer.resolution;
    this.ndc.set((this.art.x + 0.5) / res.width * 2 - 1, -((this.art.y + 0.5) / res.height * 2 - 1));
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

  dispose(): void {
    this.abort.abort();
  }
}

/** Builds menu events from keys and the pad, with key repeat for held directions. */
export class MenuInput {
  private held = new Map<string, number>();

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
    for (const code of [...KEYS.secondary, ...KEYS.quick]) if (pressed([code])) out.push({ kind: 'key', code });
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
