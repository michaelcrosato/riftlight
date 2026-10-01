import type { Input } from './input';

/** Corner of the screen a placed touch button is measured from (inside the safe area). */
export type TouchCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface TouchButton {
  label: string;
  /** Key code this button presses (e.g. 'Space'). */
  code: string;
  /** Short hint shown under the label. */
  hint?: string;
  /**
   * Place the button yourself instead of in the default grid: its centre, in CSS pixels from
   * `corner` (default bottom-right; `x` grows inward from the side, `y` inward from the top or
   * bottom edge), and its diameter (`size`, default 58). An action game's cluster (a big
   * attack button with skills on an arc around it) is a list of these.
   */
  at?: { x: number; y: number; size?: number; corner?: TouchCorner };
}

/**
 * What a button shows right now (`TouchControls.set`): a game drives its buttons from its own
 * state each frame (skill icons, cooldowns, costs, a contextual action). Only what changed
 * touches the DOM.
 */
export interface TouchButtonState {
  label?: string;
  hint?: string;
  /** A picture instead of the label (a canvas or image; drawn pixelated); null removes it. */
  icon?: HTMLCanvasElement | HTMLImageElement | null;
  /** Cooldown shutter, 0..1 of the button covered (0 = ready). */
  cooldown?: number;
  /** Text over the shutter (seconds left). */
  timer?: string;
  /** A small corner badge (a cost, a count). */
  badge?: string;
  /** Dimmed (can't be used now); it still presses its key. */
  disabled?: boolean;
  /** Not shown (its place is kept), and its key is released. */
  hidden?: boolean;
}

/** Default buttons for PlatformerCharacter (see character/controls.ts KEYMAP). */
export const DEFAULT_TOUCH_BUTTONS: readonly TouchButton[] = [
  { label: 'A', code: 'Space', hint: 'jump' },
  { label: 'B', code: 'KeyJ', hint: 'attack' },
  { label: 'C', code: 'KeyC', hint: 'crouch' },
  { label: 'G', code: 'KeyF', hint: 'grab' },
  { label: 'Z', code: 'KeyZ', hint: 'prone' },
  { label: 'X', code: 'KeyX', hint: 'lie' },
];

interface ButtonView {
  readonly def: TouchButton;
  readonly el: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly hint: HTMLElement;
  readonly shutter: HTMLElement;
  readonly timer: HTMLElement;
  readonly badge: HTMLElement;
  icon: HTMLCanvasElement | HTMLImageElement | null;
  /** Last applied state (DOM writes only on change). */
  readonly shown: Required<Omit<TouchButtonState, 'icon'>>;
  down: boolean;
}

/**
 * On-screen controls for phones and tablets: a virtual joystick (bottom-left) that feeds
 * `input.analog`, action buttons (bottom-right, in a grid or placed one by one with `at`)
 * that press key codes, and a small top bar (debug panel, Pixel/Raw, resolution, looks).
 * Camera: drag on the game to orbit/look, pinch to zoom (handled by Input.attachPointer).
 * Shown automatically on coarse pointers, or with `?touch=1`.
 *
 * A game drives it at runtime: `set(code, state)` (icon, cooldown, badge, disabled, hidden),
 * `show(false)` while a menu owns the screen, and `rects()` to lay its HUD out around the
 * controls.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly views: ButtonView[] = [];
  private readonly stick: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private shownAll = true;
  private releaseStick: () => void = () => {};

  constructor(
    container: HTMLElement,
    private readonly input: Input,
    buttons: readonly TouchButton[] = DEFAULT_TOUCH_BUTTONS,
    topBar: readonly TouchButton[] = [],
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="stick" data-t="stick"><div class="knob"></div></div>
      <div class="pad"></div>
      <div class="bar">${topBar.map((b, i) => `<button data-top="${i}">${b.label}</button>`).join('')}</div>`;
    container.appendChild(this.root);
    const pad = this.root.querySelector<HTMLDivElement>('.pad')!;
    buttons.forEach((b, i) => {
      const view = this.makeButton(b, i);
      (b.at ? this.root : pad).appendChild(view.el);
      this.views.push(view);
      this.bindButton(view.el, b.code, view);
    });
    if (!pad.childElementCount) pad.remove();
    this.bar = this.root.querySelector<HTMLDivElement>('.bar')!;
    this.bar.querySelectorAll<HTMLButtonElement>('button').forEach((el) => {
      const b = topBar[Number(el.dataset.top)]!;
      this.bindButton(el, b.code);
    });
    if (!topBar.length) this.bar.remove();
    this.stick = this.root.querySelector<HTMLDivElement>('[data-t="stick"]')!;
    this.bindStick(this.stick);
  }

  static wanted(search = location.search): boolean {
    const p = new URLSearchParams(search).get('touch');
    if (p === '1') return true;
    if (p === '0') return false;
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  }

  /** Update every button that presses `code` (see TouchButtonState). */
  set(code: string, state: TouchButtonState): void {
    for (const v of this.views) if (v.def.code === code) this.apply(v, state);
  }

  /**
   * Show or hide the joystick and the action buttons (the top bar stays): hide them while a
   * menu or a full-screen view owns the screen. Hiding releases every held key and the stick.
   */
  show(on: boolean): void {
    if (on === this.shownAll) return;
    this.shownAll = on;
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      for (const v of this.views) this.release(v);
      this.releaseStick();
    }
  }

  get visible(): boolean {
    return this.shownAll;
  }

  /**
   * Client rects (CSS pixels) of the controls on screen now: the joystick and every button,
   * with the key code it presses. A hidden button keeps its place (`hidden` says it isn't
   * drawn), so a HUD laid out around them doesn't move when a contextual button comes and goes.
   * Nothing but the bar while `show(false)`.
   */
  rects(): { stick: DOMRect | null; buttons: { code: string; label: string; hidden: boolean; rect: DOMRect }[]; bar: DOMRect | null } {
    if (!this.shownAll) return { stick: null, buttons: [], bar: this.bar.isConnected ? this.bar.getBoundingClientRect() : null };
    return {
      stick: this.stick.getBoundingClientRect(),
      buttons: this.views.map((v) => ({ code: v.def.code, label: v.def.label, hidden: v.shown.hidden, rect: v.el.getBoundingClientRect() })),
      bar: this.bar.isConnected ? this.bar.getBoundingClientRect() : null,
    };
  }

  private makeButton(b: TouchButton, i: number): ButtonView {
    const el = document.createElement('button');
    el.dataset.i = String(i);
    el.dataset.code = b.code;
    el.innerHTML = `<i class="shutter"></i><b>${b.label}</b><small>${b.hint ?? ''}</small><em class="timer"></em><s class="badge"></s>`;
    if (b.at) {
      const size = b.at.size ?? 58;
      const corner = b.at.corner ?? 'bottom-right';
      const [v, h] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
      el.classList.add('placed');
      el.style.width = el.style.height = `${size}px`;
      el.style.setProperty(v, `calc(max(8px, env(safe-area-inset-${v})) + ${b.at.y - size / 2}px)`);
      el.style.setProperty(h, `calc(max(8px, env(safe-area-inset-${h})) + ${b.at.x - size / 2}px)`);
      el.style.fontSize = `${Math.round(size * 0.31)}px`;
    }
    return {
      def: b,
      el,
      label: el.querySelector('b')!,
      hint: el.querySelector('small')!,
      shutter: el.querySelector('.shutter')!,
      timer: el.querySelector('.timer')!,
      badge: el.querySelector('.badge')!,
      icon: null,
      shown: { label: b.label, hint: b.hint ?? '', cooldown: 0, timer: '', badge: '', disabled: false, hidden: false },
      down: false,
    };
  }

  private apply(v: ButtonView, s: TouchButtonState): void {
    const was = v.shown;
    if (s.label !== undefined && s.label !== was.label) v.label.textContent = was.label = s.label;
    if (s.hint !== undefined && s.hint !== was.hint) v.hint.textContent = was.hint = s.hint;
    if (s.icon !== undefined && s.icon !== v.icon) {
      v.icon?.remove();
      v.icon = s.icon;
      if (s.icon) {
        s.icon.classList.add('icon');
        v.el.insertBefore(s.icon, v.label);
      }
      v.el.classList.toggle('has-icon', !!s.icon);
    }
    if (s.cooldown !== undefined) {
      const c = Math.round(Math.min(1, Math.max(0, s.cooldown)) * 100) / 100;
      if (c !== was.cooldown) {
        was.cooldown = c;
        v.shutter.style.height = `${c * 100}%`;
        v.el.classList.toggle('cooling', c > 0);
      }
    }
    if (s.timer !== undefined && s.timer !== was.timer) v.timer.textContent = was.timer = s.timer;
    if (s.badge !== undefined && s.badge !== was.badge) v.badge.textContent = was.badge = s.badge;
    if (s.disabled !== undefined && s.disabled !== was.disabled) v.el.classList.toggle('disabled', (was.disabled = s.disabled));
    if (s.hidden !== undefined && s.hidden !== was.hidden) {
      v.el.classList.toggle('hidden', (was.hidden = s.hidden));
      if (s.hidden) this.release(v);
    }
  }

  private release(v: ButtonView): void {
    if (!v.down) return;
    v.down = false;
    v.el.classList.remove('on');
    this.input.setKey(v.def.code, false);
  }

  private bindButton(el: HTMLElement, code: string, view?: ButtonView): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      capture(el, e.pointerId);
      el.classList.add('on');
      if (view) view.down = true;
      this.input.setKey(code, true);
    };
    const up = () => {
      el.classList.remove('on');
      if (view) {
        if (!view.down) return;
        view.down = false;
      }
      this.input.setKey(code, false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindStick(base: HTMLDivElement): void {
    const knob = base.firstElementChild as HTMLDivElement;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    const radius = () => base.clientWidth / 2;
    const set = (x: number, y: number) => {
      const r = radius();
      let dx = x - cx;
      let dy = y - cy;
      const len = Math.hypot(dx, dy);
      if (len > r) {
        dx *= r / len;
        dy *= r / len;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.analog.x = dx / r;
      this.input.analog.y = -dy / r; // screen up = forward
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      capture(base, e.pointerId);
      const rect = base.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      set(e.clientX, e.clientY);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) set(e.clientX, e.clientY);
    });
    this.releaseStick = () => {
      if (id === null) return;
      id = null;
      knob.style.transform = '';
      this.input.analog.x = 0;
      this.input.analog.y = 0;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId === id) this.releaseStick();
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }
}

/** Pointer capture is best-effort: it throws if the pointer is already gone. */
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointer no longer active */
  }
}
