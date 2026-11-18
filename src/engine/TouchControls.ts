import type { Input, InputDevice } from './input';

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
 * Whether touch controls stand aside for another device (`TouchControls.follow`): a change of the
 * device in use to a pad or the keyboard puts them `away`, a change back to touch brings them
 * back; a device that only stays what it was moves nothing (a page that starts on the keyboard
 * keeps the controls `?touch=1` asked for). Plain data: it follows the recorded `input.device`, so
 * a replay shows and hides them as the player saw.
 */
export class TouchFollow {
  away = false;

  constructor(private seen: InputDevice) {}

  /** The device in use now; true when `away` changed. */
  follow(device: InputDevice): boolean {
    if (device === this.seen) return false;
    this.seen = device;
    const away = device !== 'touch';
    if (away === this.away) return false;
    this.away = away;
    return true;
  }
}

/** How the on-screen joystick sits (`TouchControlsOptions.stick`, `EngineOptions.touchStick`). */
export type TouchStick = 'fixed' | 'floating';

export interface TouchControlsOptions {
  /**
   * `fixed` (default): the joystick waits at the bottom left. `floating`: a thumb anywhere in the
   * lower left (`.stick-zone`: about 45% of the width, the lower 60% in portrait and 75% in
   * landscape; the placed buttons stay on top of it) brings the joystick's base under it. The zone
   * takes every touch landing in it (a camera drag, a swipe, a tap there moves the stick): keep a
   * game's tappable HUD and swipe areas out of `rects().zone`, or have the zone give way to a panel
   * open over it (`giveWay`).
   */
  stick?: TouchStick;
}

/**
 * On-screen controls for phones and tablets: a virtual joystick (bottom-left, or floating under
 * the thumb) that feeds `input.analog`, action buttons (bottom-right, in a grid or placed one by
 * one with `at`) that press key codes, and a small top bar (debug panel, Pixel/Raw, resolution,
 * looks). Camera: drag on the game to orbit/look, pinch to zoom (handled by Input.attachPointer).
 * Shown automatically on coarse pointers, or with `?touch=1`.
 *
 * Touch is an add-on: when a player picks up a pad or a keyboard (`input.device` turns `pad` or
 * `keyboard`; the engine calls `follow` each frame) the joystick and buttons step aside and the
 * game looks like the pad or keyboard game; the next touch brings them back. The device is
 * recorded, so a replay shows and hides them as the player saw.
 *
 * A game drives it at runtime: `set(code, state)` (icon, cooldown, badge, disabled, hidden),
 * `show(false)` while a menu owns the screen, and `rects()` to lay its HUD out around the
 * controls.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly views: ButtonView[] = [];
  private readonly stick: HTMLDivElement;
  private readonly zone: HTMLDivElement | null;
  private readonly bar: HTMLDivElement;
  /** The game's wish (`show`). */
  private shownAll = true;
  /** A pad or the keyboard is the device in use (`follow`). */
  private readonly device: TouchFollow;
  private releaseStick: () => void = () => {};
  /** A floating stick's resting place while a thumb holds it elsewhere (`rects().stick`). */
  private stickRest: DOMRect | null = null;
  /** Where the zone gives way now (`giveWay`), as the zone's size and the gaps cut to it: '' for nowhere. */
  private gaps = '';
  readonly stickMode: TouchStick;

  constructor(
    container: HTMLElement,
    private readonly input: Input,
    buttons: readonly TouchButton[] = DEFAULT_TOUCH_BUTTONS,
    topBar: readonly TouchButton[] = [],
    options: TouchControlsOptions = {},
  ) {
    this.stickMode = options.stick === 'floating' ? 'floating' : 'fixed';
    this.device = new TouchFollow(input.device);
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.dataset.stick = this.stickMode;
    this.root.innerHTML = `
      ${this.stickMode === 'floating' ? '<div class="stick-zone" data-t="zone"></div>' : ''}
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
    this.zone = this.root.querySelector<HTMLDivElement>('[data-t="zone"]');
    this.bindStick(this.zone ?? this.stick, this.stick);
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
   * While a pad or the keyboard is in use they stay hidden either way (`follow`).
   */
  show(on: boolean): void {
    if (on === this.shownAll) return;
    this.shownAll = on;
    this.applyShown();
  }

  /**
   * The device in use (the engine calls it each frame with `input.device`, recorded): when it
   * changes to a pad or the keyboard the controls step aside, and the next touch brings them back.
   */
  follow(device: InputDevice): void {
    if (this.device.follow(device)) this.applyShown();
  }

  /** On screen now: the game shows them (`show`) and touch is the device in use (`follow`). */
  get visible(): boolean {
    return this.shownAll && !this.device.away;
  }

  /** Hidden because a pad or the keyboard is in use (`follow`): lay the HUD out for that device, not around the controls. */
  get deviceHidden(): boolean {
    return this.device.away;
  }

  private applyShown(): void {
    const on = this.visible;
    if (on !== this.root.classList.contains('hidden')) return; // already so
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      for (const v of this.views) this.release(v);
      this.releaseStick();
    }
  }

  /**
   * Client rects (CSS pixels) of the controls on screen now: the joystick and every button,
   * with the key code it presses. A hidden button keeps its place (`hidden` says it isn't
   * drawn), so a HUD laid out around them doesn't move when a contextual button comes and goes.
   * `zone`: a floating stick's zone, which takes every touch in it (lay tappable HUD out of it).
   * `stick`: a floating stick's resting place, also while a thumb holds it elsewhere, so a HUD laid
   * out around it doesn't follow the thumb. Nothing but the bar while `show(false)` or while they
   * step aside (`deviceHidden`).
   */
  rects(): { stick: DOMRect | null; zone: DOMRect | null; buttons: { code: string; label: string; hidden: boolean; rect: DOMRect }[]; bar: DOMRect | null } {
    if (!this.visible) return { stick: null, zone: null, buttons: [], bar: this.bar.isConnected ? this.bar.getBoundingClientRect() : null };
    return {
      stick: this.stickRest ?? this.stick.getBoundingClientRect(),
      zone: this.zone?.getBoundingClientRect() ?? null,
      buttons: this.views.map((v) => ({ code: v.def.code, label: v.def.label, hidden: v.shown.hidden, rect: v.el.getBoundingClientRect() })),
      bar: this.bar.isConnected ? this.bar.getBoundingClientRect() : null,
    };
  }

  /**
   * Where a floating stick's zone gives way (client CSS px rects, as `rects()` measures): a touch
   * landing in one of them reaches the game under it instead of the stick, so a panel open over the
   * zone keeps its taps (a photo mode's rows) while the rest of the zone still brings the stick.
   * Each call replaces the last; `[]` gives the whole zone back. `rects().zone` stays the zone's
   * whole extent. Call it each frame the panel shows (the cut follows a rotation). Nothing with a
   * fixed stick.
   */
  giveWay(rects: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[]): void {
    const zone = this.zone;
    if (!zone || (!rects.length && !this.gaps)) return;
    const z = zone.getBoundingClientRect(); // nothing while the controls are hidden: none to cut
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const gaps = rects
      .map((r) => ({ x0: r2(Math.max(0, r.x - z.left)), y0: r2(Math.max(0, r.y - z.top)), x1: r2(Math.min(z.width, r.x + r.w - z.left)), y1: r2(Math.min(z.height, r.y + r.h - z.top)) }))
      .filter((g) => g.x1 > g.x0 && g.y1 > g.y0);
    const key = gaps.length ? `${r2(z.width)}x${r2(z.height)}:${gaps.map((g) => `${g.x0},${g.y0},${g.x1},${g.y1}`).join(';')}` : '';
    if (key === this.gaps) return;
    this.gaps = key;
    // the zone's clip is also where it is hit: the gaps cut out of it pass touches on
    zone.style.clipPath = gaps.length ? `path('${zonePath(r2(z.width), r2(z.height), gaps)}')` : '';
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
      this.input.noteTouch(); // the input used last is touch (prompts follow it)
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

  /**
   * The joystick: a press on `hit` (the base itself, or the floating zone) holds it. A fixed
   * stick's centre is its base's; a floating one's base moves under the thumb (whole on screen)
   * and goes back to rest when let go.
   */
  private bindStick(hit: HTMLDivElement, base: HTMLDivElement): void {
    const knob = base.firstElementChild as HTMLDivElement;
    const floating = hit !== base;
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
    hit.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (floating && id !== null) return; // one thumb holds it
      this.input.noteTouch();
      id = e.pointerId;
      capture(hit, e.pointerId);
      if (floating) {
        this.stickRest = base.getBoundingClientRect(); // where it waits: `rects().stick` while it's held
        const r = base.offsetWidth / 2; // its border included: centred on the thumb
        const box = this.root.getBoundingClientRect();
        cx = Math.min(Math.max(e.clientX, box.left + r), box.right - r);
        cy = Math.min(Math.max(e.clientY, box.top + r), box.bottom - r);
        base.style.left = `${cx - box.left - r}px`;
        base.style.top = `${cy - box.top - r}px`;
        base.style.bottom = 'auto';
        base.classList.add('held');
      } else {
        const rect = base.getBoundingClientRect();
        cx = rect.left + rect.width / 2;
        cy = rect.top + rect.height / 2;
      }
      set(e.clientX, e.clientY);
    });
    hit.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) set(e.clientX, e.clientY);
    });
    this.releaseStick = () => {
      if (id === null) return;
      id = null;
      knob.style.transform = '';
      if (floating) {
        base.style.left = base.style.top = base.style.bottom = ''; // back to rest
        base.classList.remove('held');
        this.stickRest = null;
      }
      this.input.analog.x = 0;
      this.input.analog.y = 0;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId === id) this.releaseStick();
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);
  }
}

/**
 * An SVG path of a `w` × `h` box without `gaps` (rects in its own pixels, inside it): the cells of
 * the grid the gaps' edges make that no gap covers, each its own square (their union, under the
 * default nonzero rule). `TouchControls.giveWay`'s clip; pure (unit-tested).
 */
export function zonePath(w: number, h: number, gaps: readonly { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }[]): string {
  const edges = (a: number[]) => [...new Set(a)].sort((p, q) => p - q);
  const xs = edges([0, w, ...gaps.flatMap((g) => [g.x0, g.x1])]);
  const ys = edges([0, h, ...gaps.flatMap((g) => [g.y0, g.y1])]);
  let d = '';
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      if (gaps.some((g) => cx > g.x0 && cx < g.x1 && cy > g.y0 && cy < g.y1)) continue;
      d += `M${xs[i]} ${ys[j]}H${xs[i + 1]}V${ys[j + 1]}H${xs[i]}Z`;
    }
  }
  return d || 'M0 0Z'; // a zone wholly given way: no touch is the stick's
}

/** Pointer capture is best-effort: it throws if the pointer is already gone. */
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointer no longer active */
  }
}
