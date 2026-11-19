import type { Glyph } from './controls';
import type { HudColor } from './hud/Hud';
import type { Engine } from './Engine';
import { MOUSE_USE, swipeDirection } from './input';
import { PALETTE, type PaletteColor } from './palette';
import type { TouchCorner } from './TouchControls';
import { SETTINGS_CONTROLS, type SettingsFeatures, SettingsMenu, type SettingsRow } from './ui/settingsMenu';

/** On a mouse, the ⚙ fades this long after the pointer last moved (so it never sits over the game's HUD). */
const IDLE_MS = 2500;
/** Each panel's element ids are its own (`aria-activedescendant` names a row by id). */
let panels = 0;

/**
 * The settings panel, made for a TV at ten feet and a pad first (DOM, like the debug panel: it
 * stays legible at any art resolution), and the ⚙ button that opens it. Its rows are
 * `SettingsMenu`'s (src/engine/ui/settingsMenu.ts): one setting per large row, its value stepped
 * ◀ value ▶, pages switched with L1 / R1 (Q / E), a legend of the device's buttons. The pad and the
 * keys reach it through the engine's input (`update`, each frame while it is open); the pointer
 * here: hover moves the focus, a click or a tap acts, a swipe down or sideways closes it on touch.
 * The keyboard focus stays on its rows (a listbox whose `aria-activedescendant` is the focused row,
 * so a screen reader names it), never on a button a click left it on: Enter acts once. Turning a
 * page never moves it: it keeps the height of its tallest page. The engine pauses the game while
 * it is open.
 */
export class SettingsPanel {
  readonly root: HTMLDivElement;
  readonly button: HTMLButtonElement | null = null;
  /** The screen's rows and rules, as data. */
  readonly menu: SettingsMenu;
  private idleTimer = 0;
  private readonly listeners = new AbortController();
  private readonly panel: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly list: HTMLElement;
  private readonly legendEl: HTMLElement;
  /** Says a changed value aloud (a screen reader's polite live region). */
  private readonly status: HTMLElement;
  private readonly uid = `settings-${++panels}`;
  /** What the DOM shows now (only what changed is written). */
  private shownPage = '';
  private shownLegend = '';
  private rowEls: HTMLElement[] = [];
  /** The focused row and its value the frame before: a new value is said aloud. */
  private spoken = { id: '', value: '' };
  /** A one-finger touch on the panel that may be a swipe; a swipe is not a tap on what it ended on. */
  private flick: { id: number; x: number; y: number; t: number } | null = null;
  private swiped = false;
  /** Where the mouse last was over a row (hover moves the focus only when it moves). */
  private hoverAt = '';
  /** The mouse over the panel while another device is in use: where it last was, and how far it went since (`MOUSE_USE`, as over the canvas). */
  private mouse: { x: number; y: number; travel: number } | null = null;

  constructor(
    private readonly engine: Engine,
    container: HTMLElement,
    corner: TouchCorner | false,
    features: SettingsFeatures = {},
  ) {
    this.menu = new SettingsMenu(engine, features);
    const s = engine.settings;
    const signal = this.listeners.signal;
    this.root = document.createElement('div');
    this.root.className = 'settings-ui';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true">
        <div class="tabs" role="tablist"></div>
        <div class="rows" role="listbox" tabindex="-1"></div>
        <div class="legend"></div>
        <div class="sr-status" role="status" aria-live="polite"></div>
      </div>`;
    this.panel = this.root.querySelector('.panel')!;
    this.tabs = this.root.querySelector('.tabs')!;
    this.list = this.root.querySelector('.rows')!;
    this.legendEl = this.root.querySelector('.legend')!;
    this.status = this.root.querySelector('.sr-status')!;

    // The keyboard focus stays on the rows: a button the mouse pressed never takes it (Enter on a
    // focused button would press it as well as change the row), and Enter or Space never presses one.
    this.root.addEventListener(
      'mousedown',
      (e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault();
      },
      { signal },
    );
    this.root.addEventListener(
      'keydown',
      (e) => {
        if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && (e.target as HTMLElement).closest('button')) e.preventDefault();
      },
      { signal },
    );

    // the pointer: the device it is (prompts follow), hover, clicks and taps, swipes
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        engine.input.noteDevice(e.pointerType === 'touch' ? 'touch' : 'keyboard');
        this.swiped = false;
        this.flick = e.pointerType === 'touch' && e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
        if (e.target === this.root && e.pointerType !== 'touch') s.close(); // a click on the dimmed game around it
      },
      { signal },
    );
    const lift = (e: PointerEvent) => {
      const f = this.flick;
      if (!f || f.id !== e.pointerId) return;
      this.flick = null;
      if (e.type !== 'pointerup') return;
      const r = this.root.getBoundingClientRect();
      const dir = swipeDirection(e.clientX - f.x, e.clientY - f.y, e.timeStamp - f.t, Math.min(r.width, r.height));
      if (!dir) {
        if (e.target === this.root) s.close(); // a tap on the dimmed game around it
        return;
      }
      this.swiped = true; // what it ended on is not tapped
      // a swipe sideways closes; down too, unless the rows scrolled (then it scrolls them back)
      if (dir === 'left' || dir === 'right' || (dir === 'down' && this.list.scrollTop <= 0)) s.close();
    };
    this.root.addEventListener('pointerup', lift, { signal });
    this.root.addEventListener('pointercancel', lift, { signal });
    this.root.addEventListener(
      'click',
      (e) => {
        if (this.swiped) return;
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-step], [data-row], [data-page], [data-act]');
        if (!el) return;
        const m = this.menu;
        if (el.dataset.act === 'close') {
          s.close();
          return;
        }
        if (el.dataset.page) m.showPage(el.dataset.page as never);
        else if (el.dataset.act === 'reset') m.requestReset();
        else if (el.dataset.act === 'change') m.activate(m.list.index);
        else {
          const row = Number(el.closest<HTMLElement>('[data-row]')?.dataset.i ?? -1);
          if (row < 0) return;
          m.list.index = row;
          if (el.dataset.step) m.step(row, Number(el.dataset.step) as 1 | -1);
          else m.activate(row);
        }
        this.refresh();
        this.focusRows(); // whatever the click landed on, the keys stay the panel's
      },
      { signal },
    );
    // the mouse travelling over the panel is the mouse in use, as over the canvas (a few pixels: a
    // bumped desk is not): the pointer the pad hid shows again, and the legend names the keys
    this.root.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        const was = this.mouse;
        const keys = engine.controls.device === 'keyboard';
        this.mouse = { x: e.clientX, y: e.clientY, travel: keys || !was ? 0 : was.travel + Math.hypot(e.clientX - was.x, e.clientY - was.y) };
        if (keys || this.mouse.travel < MOUSE_USE) return;
        engine.input.noteDevice('keyboard');
        this.followPointer(false);
      },
      { signal },
    );
    // a new window size gives the pages new heights
    window.addEventListener('resize', () => !this.root.hidden && this.holdHeight(), { signal });
    this.list.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        const at = `${e.clientX},${e.clientY}`;
        if (at === this.hoverAt) return; // a row scrolled under a resting mouse keeps the focus where the pad put it
        this.hoverAt = at;
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
        const i = Number(row?.dataset.i ?? -1);
        if (i < 0 || i === this.menu.list.index) return;
        engine.input.noteDevice('keyboard');
        this.menu.list.index = i;
        this.refresh(false);
      },
      { signal },
    );
    container.appendChild(this.root);

    if (corner) {
      const b = document.createElement('button');
      b.className = 'settings-button';
      b.dataset.corner = corner;
      b.textContent = '⚙';
      b.title = this.menu.t('settings.title');
      b.setAttribute('aria-label', b.title);
      b.tabIndex = -1; // never keeps focus: a game's Space or Enter must not press it
      b.addEventListener('pointerdown', (e) => engine.input.noteDevice(e.pointerType === 'touch' ? 'touch' : 'keyboard'), { signal });
      b.addEventListener('click', () => {
        b.blur();
        s.toggle();
      });
      container.appendChild(b);
      this.button = b;
      // with a mouse it shows while the pointer moves and fades after; a touch screen keeps it
      const hover = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (hover) {
        const wake = () => {
          if (document.pointerLockElement) return; // a first-person mouse look, not a reach for the ⚙
          b.classList.remove('idle');
          clearTimeout(this.idleTimer);
          this.idleTimer = window.setTimeout(() => !b.matches(':hover') && b.classList.add('idle'), IDLE_MS);
        };
        b.classList.add('idle');
        container.addEventListener('pointermove', wake, { passive: true, signal });
        b.addEventListener('pointerleave', wake, { signal });
      }
    }
  }

  /** Show the panel on its first page, the engine's current values in it. */
  show(): void {
    if (document.pointerLockElement) document.exitPointerLock?.(); // a first-person game: the mouse is the panel's now
    this.menu.reset();
    this.shownPage = '';
    this.spoken = { id: '', value: '' };
    this.status.textContent = '';
    this.root.hidden = false;
    this.refresh();
    this.holdHeight();
    this.focusRows();
  }

  hide(): void {
    this.root.hidden = true;
    this.flick = null;
    this.followPointer(false);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.root.contains(focused)) focused.blur();
  }

  /** A frame while it is open (the engine's): the keys and the pad move, change and close. */
  update(dt: number): void {
    const r = this.menu.update(this.engine.input, dt);
    if (r.close) {
      this.engine.settings.close();
      return;
    }
    this.refresh(r.changed);
  }

  /**
   * Put the engine's current values into the panel (`scroll`: bring the focused row into view),
   * and into the debug panel (the loop fills it only while the game runs). Only what changed is
   * written: a row under the pointer stays the element it was, so a click on it lands.
   */
  refresh(scroll = true): void {
    const m = this.menu;
    const rows = m.rows();
    const pageKey = `${m.page}:${rows.map((r) => r.id).join(',')}`;
    if (pageKey !== this.shownPage) {
      this.shownPage = pageKey;
      this.buildPage(rows);
      this.shownLegend = '';
    }
    rows.forEach((r, i) => this.fillRow(this.rowEls[i]!, r, i === m.list.index));
    const focused = rows[m.list.index];
    attr(this.list, 'aria-activedescendant', this.rowEls[m.list.index]?.id ?? '');
    // a value changed on the focused row: say it (moving the focus says the row by itself)
    if (focused) {
      if (focused.id === this.spoken.id && focused.value !== this.spoken.value) this.status.textContent = `${focused.label}: ${focused.value}`;
      this.spoken = { id: focused.id, value: focused.value };
    }
    this.drawLegend();
    // a list that scrolls takes vertical drags (pan-y); one that fits leaves them to swipes
    const pan = this.list.scrollHeight > this.list.clientHeight + 1 ? 'pan-y' : 'none';
    if (this.list.style.touchAction !== pan) this.list.style.touchAction = pan;
    if (scroll) this.rowEls[m.list.index]?.scrollIntoView?.({ block: 'nearest' });
    const e = this.engine;
    if (e.debug?.visible) e.debug.update(e.game.status?.(e.context) ?? '');
  }

  /**
   * @internal The engine's, each frame (`Engine.followCursor`): the OS pointer over the open panel
   * hidden while the pad drives it (`hide`: the pad in use, and `hidesPointer`: never in a
   * replay), as over the canvas; shown again once the mouse travels over it. Presentation only.
   */
  followPointer(hide: boolean): void {
    const none = hide && !this.root.hidden;
    if (this.root.classList.contains('no-pointer') === none) return;
    this.root.classList.toggle('no-pointer', none); // style.css: cursor none over it, its rows, tabs and buttons too
    if (none) this.mouse = null; // the mouse's travel counts afresh from here
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.listeners.abort();
    this.root.remove();
    this.button?.remove();
  }

  /** Give the keyboard focus to the rows (the listbox), while the panel shows. */
  private focusRows(): void {
    if (!this.root.hidden) this.list.focus({ preventScroll: true });
  }

  /**
   * Keep the panel as tall as its tallest page (each drawn once to measure it), so turning a page
   * never moves it; again when the window's size changes. Never taller than the screen.
   */
  private holdHeight(): void {
    const m = this.menu;
    const page = m.page;
    const index = m.list.index;
    this.panel.style.minHeight = '';
    let tallest = 0;
    for (const p of m.pages) {
      m.showPage(p);
      this.refresh(false);
      tallest = Math.max(tallest, this.panel.getBoundingClientRect().height);
    }
    m.showPage(page);
    m.list.index = index;
    this.refresh();
    if (tallest > 0) this.panel.style.minHeight = `min(${Math.ceil(tallest)}px, 100%)`;
  }

  /** The page's tabs and its rows, made anew (a page turned, or a row came or went). */
  private buildPage(rows: readonly SettingsRow[]): void {
    const m = this.menu;
    this.panel.setAttribute('aria-label', m.t('settings.title'));
    this.list.setAttribute('aria-label', m.t(`settings.page.${m.page}`));
    this.tabs.replaceChildren(
      this.pageGlyph('pagePrev'),
      ...m.pages.map((p) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.tabIndex = -1;
        tab.className = 'tab';
        tab.dataset.page = p;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(p === m.page));
        tab.textContent = m.t(`settings.page.${p}`);
        return tab;
      }),
      this.pageGlyph('pageNext'),
    );
    this.rowEls = rows.map((r, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.id = `${this.uid}-${r.id}`;
      row.dataset.row = r.id;
      row.dataset.i = String(i);
      row.setAttribute('role', 'option');
      // the arrows are for the pointer: the keys and a screen reader step the row itself
      row.innerHTML = `<span class="label"></span><span class="stepper"><button type="button" tabindex="-1" class="arrow" data-step="-1" aria-hidden="true">◀</button><span class="value"></span><button type="button" tabindex="-1" class="arrow" data-step="1" aria-hidden="true">▶</button></span><span class="note"></span>`;
      return row;
    });
    this.list.replaceChildren(...this.rowEls);
  }

  private fillRow(el: HTMLElement, r: SettingsRow, focused: boolean): void {
    const set = (sel: string, text: string) => {
      const part = el.querySelector<HTMLElement>(sel)!;
      if (part.textContent !== text) part.textContent = text;
    };
    set('.label', r.label);
    set('.value', r.value);
    set('.note', r.note);
    attr(el, 'aria-label', r.note ? `${r.label}: ${r.value}. ${r.note}` : `${r.label}: ${r.value}`);
    el.classList.toggle('focus', focused);
    el.classList.toggle('off', !r.enabled);
    attr(el, 'aria-selected', String(focused));
    attr(el, 'aria-disabled', String(!r.enabled));
    const [left, right] = el.querySelectorAll<HTMLButtonElement>('.arrow');
    left!.classList.toggle('end', !r.left);
    right!.classList.toggle('end', !r.right);
  }

  /** The legend (and the page glyphs), drawn again when the device in use, the button style or its words change. */
  private drawLegend(): void {
    const c = this.engine.controls;
    const legend = this.menu.legend();
    const key = `${c.device}:${c.style}:${this.menu.page}:${legend.map((l) => l.label).join('|')}`;
    if (key === this.shownLegend) return;
    this.shownLegend = key;
    this.root.dataset.device = c.device;
    for (const slot of this.tabs.querySelectorAll<HTMLElement>('[data-glyph]')) {
      const g = this.menu.glyph(SETTINGS_CONTROLS[slot.dataset.glyph as 'pagePrev' | 'pageNext']);
      slot.replaceChildren(...(g ? [glyphElement(g)] : []));
    }
    this.legendEl.replaceChildren(
      ...legend.map((item) => {
        // a hint (on touch, Tap · Change: a tap on a row changes it) is words, not a button
        const b = document.createElement(item.act ? 'button' : 'span');
        if (b instanceof HTMLButtonElement) {
          b.type = 'button';
          b.tabIndex = -1;
          b.dataset.act = item.action;
        } else b.className = 'hint';
        const g = this.menu.glyph(item.control);
        if (g) b.append(glyphElement(g));
        const label = document.createElement('span');
        label.textContent = item.label;
        b.append(label);
        return b;
      }),
    );
  }

  private pageGlyph(which: 'pagePrev' | 'pageNext'): HTMLElement {
    const slot = document.createElement('span');
    slot.className = 'page-glyph';
    slot.dataset.glyph = which;
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }
}

/** Set an attribute only when it changes (the panel refreshes every frame it is open). */
function attr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * A glyph as a DOM element: a sprite as a tiny canvas, drawn pixelated at a whole multiple of its
 * size (`--glyph-scale`); a cap as a key cap or a round pad cap.
 */
function glyphElement(g: Glyph): HTMLElement {
  if (g.kind === 'cap') {
    const cap = document.createElement('kbd');
    cap.className = g.round ? 'cap round' : 'cap';
    cap.textContent = g.text;
    return cap;
  }
  const canvas = document.createElement('canvas');
  const h = g.rows.length;
  const w = Math.max(...g.rows.map((r) => r.length));
  canvas.width = w;
  canvas.height = h;
  canvas.className = 'glyph';
  canvas.style.width = `calc(${w}px * var(--glyph-scale, 3))`;
  canvas.style.height = `calc(${h}px * var(--glyph-scale, 3))`;
  const c = canvas.getContext('2d');
  if (c) {
    // The ink outline (`o`) is the panel's own colour: drawn as the face (`f`; mist without one), a
    // button keeps its round silhouette instead of a light square's.
    const colors: Readonly<Record<string, HudColor>> = { ...g.colors, o: g.colors.f ?? 'mist' };
    g.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = colors[row[x]!];
        if (color === undefined) continue;
        const hex = typeof color === 'number' ? color : PALETTE[color as PaletteColor];
        c.fillStyle = `#${hex.toString(16).padStart(6, '0')}`;
        c.fillRect(x, y, 1, 1);
      }
    });
  }
  return canvas;
}
