import type { Input } from './input';

export interface TouchButton {
  label: string;
  /** Key code this button presses (e.g. 'Space'). */
  code: string;
  /** Short hint shown under the label. */
  hint?: string;
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

/**
 * On-screen controls for phones and tablets: a virtual joystick (bottom-left) that feeds
 * `input.analog`, action buttons (bottom-right) that press key codes, and a small top bar
 * (debug panel, Pixel/Raw, resolution, looks). Camera: drag on the game to orbit/look,
 * pinch to zoom (handled by Input.attachPointer). Shown automatically on coarse pointers,
 * or with `?touch=1`.
 */
export class TouchControls {
  readonly root: HTMLDivElement;

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
      <div class="pad">${buttons.map((b, i) => `<button data-i="${i}"><b>${b.label}</b><small>${b.hint ?? ''}</small></button>`).join('')}</div>
      <div class="bar">${topBar.map((b, i) => `<button data-top="${i}">${b.label}</button>`).join('')}</div>`;
    container.appendChild(this.root);

    this.root.querySelectorAll<HTMLButtonElement>('.pad button').forEach((el) => {
      const b = buttons[Number(el.dataset.i)]!;
      this.bindButton(el, b.code);
    });
    this.root.querySelectorAll<HTMLButtonElement>('.bar button').forEach((el) => {
      const b = topBar[Number(el.dataset.top)]!;
      this.bindButton(el, b.code);
    });
    this.bindStick(this.root.querySelector<HTMLDivElement>('[data-t="stick"]')!);
  }

  static wanted(search = location.search): boolean {
    const p = new URLSearchParams(search).get('touch');
    if (p === '1') return true;
    if (p === '0') return false;
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  }

  private bindButton(el: HTMLElement, code: string): void {
    const down = (e: PointerEvent) => {
      e.preventDefault();
      capture(el, e.pointerId);
      el.classList.add('on');
      this.input.setKey(code, true);
    };
    const up = () => {
      el.classList.remove('on');
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
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.input.analog.x = 0;
      this.input.analog.y = 0;
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
