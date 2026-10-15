import type { Engine } from './Engine';
import { LOOK_PRESETS, lookPresetLabel } from './render/look';
import { FPS_OPTIONS, QUALITY_OPTIONS } from './settings';
import type { TouchCorner } from './TouchControls';

const VOLUMES = [
  ['master', 'Volume'],
  ['music', 'Music'],
  ['sfx', 'Effects'],
] as const;
/** On a mouse, the ⚙ fades this long after the pointer last moved (so it never sits over the game's HUD). */
const IDLE_MS = 2500;

/**
 * The settings panel (DOM, like the debug panel: it stays legible at any art resolution) and the
 * ⚙ button that opens it: the player's picture, sound and engine options (`engine.settings`,
 * settings.ts; the AudioManager's volumes). The engine pauses the game while it is open. Keys
 * pressed in it never reach the game; Escape or Done closes it.
 */
export class SettingsPanel {
  readonly root: HTMLDivElement;
  readonly button: HTMLButtonElement | null = null;
  private idleTimer = 0;
  private readonly controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private readonly outputs = new Map<string, HTMLElement>();
  private readonly listeners = new AbortController();

  constructor(
    private readonly engine: Engine,
    container: HTMLElement,
    corner: TouchCorner | false,
  ) {
    const looks = ['', ...Object.keys(LOOK_PRESETS)];
    const lookLabel = (n: string) => (n === '' ? "the game's" : n === 'none' ? 'plain' : lookPresetLabel(n));
    const option = (value: string | number, label: string) => `<option value="${value}">${label}</option>`;
    this.root = document.createElement('div');
    this.root.className = 'settings-ui';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
        <div class="head"><b>Settings</b><button data-a="close" aria-label="Close">✕</button></div>
        <div class="group">Picture</div>
        <label class="row"><span>Look</span><select data-s="look">${looks.map((n) => option(n, lookLabel(n))).join('')}</select></label>
        <label class="row"><span>Pixel art</span><input type="checkbox" data-s="pixelArt"></label>
        <label class="row"><span>Pixel size</span><select data-s="pixelSize">${option('fine', 'fine')}${option('chunky', 'chunky')}</select></label>
        <label class="row"><span>Quality</span><select data-s="quality">${QUALITY_OPTIONS.map((q) => option(q, q)).join('')}</select></label>
        <label class="row"><span>Frame rate</span><select data-s="fps">${FPS_OPTIONS.map((f) => option(f, f ? `${f} fps` : 'screen')).join('')}</select></label>
        <div class="group">Sound</div>
        <label class="row"><span>Sound</span><input type="checkbox" data-s="sound"></label>
        ${VOLUMES.map(([ch, label]) => `<label class="row"><span>${label}</span><input type="range" min="0" max="100" step="5" data-s="${ch}"><i data-o="${ch}"></i></label>`).join('')}
        <div class="group">Engine</div>
        <label class="row"><span>Debug info</span><input type="checkbox" data-s="debugInfo"></label>
        <div class="foot"><button data-a="reset">Reset</button><button data-a="done">Done</button></div>
      </div>`;
    for (const el of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-s]')) this.controls.set(el.dataset.s!, el);
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-o]')) this.outputs.set(el.dataset.o!, el);
    const s = engine.settings;
    const on = (id: string, fn: (el: HTMLInputElement & HTMLSelectElement) => void) => {
      const el = this.controls.get(id)!;
      el.addEventListener(el instanceof HTMLInputElement && el.type === 'range' ? 'input' : 'change', () => {
        fn(el as HTMLInputElement & HTMLSelectElement);
        this.sync();
      });
    };
    on('look', (el) => s.set({ look: el.value || undefined }));
    on('pixelArt', (el) => s.set({ pixelArt: el.checked }));
    on('pixelSize', (el) => s.set({ pixelSize: el.value as 'fine' | 'chunky' }));
    on('quality', (el) => s.set({ quality: el.value as (typeof QUALITY_OPTIONS)[number] }));
    // the game's own rate, when it is none of the choices, is its own: picking it clears the player's
    on('fps', (el) => s.set({ fps: FPS_OPTIONS.includes(Number(el.value)) ? Number(el.value) : undefined }));
    on('debugInfo', (el) => s.set({ debugInfo: el.checked }));
    on('sound', (el) => {
      engine.audio.unlock(); // a click in the panel is a user gesture
      engine.audio.setMuted(!el.checked);
    });
    for (const [ch] of VOLUMES) {
      on(ch, (el) => {
        engine.audio.unlock();
        engine.audio.setVolume(ch, Number(el.value) / 100);
      });
    }
    const click = (action: string, fn: () => void) => this.root.querySelector(`[data-a="${action}"]`)!.addEventListener('click', fn);
    click('close', () => s.close());
    click('done', () => s.close());
    click('reset', () => {
      s.reset();
      engine.audio.resetVolumes();
      this.sync();
    });
    // a click on the dimmed game around the panel closes it
    this.root.addEventListener('pointerdown', (e) => e.target === this.root && s.close());
    // keys pressed here are the panel's (arrows on a slider, Space on a box), never the game's:
    // the engine's input listens on the window, so they stop on their way up
    for (const type of ['keydown', 'keyup'] as const) {
      this.root.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') s.close();
      });
    }
    container.appendChild(this.root);

    if (corner) {
      const b = document.createElement('button');
      b.className = 'settings-button';
      b.dataset.corner = corner;
      b.textContent = '⚙';
      b.title = 'Settings';
      b.setAttribute('aria-label', 'Settings');
      b.tabIndex = -1; // never keeps focus: a game's Space or Enter must not press it
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
        container.addEventListener('pointermove', wake, { passive: true, signal: this.listeners.signal });
        b.addEventListener('pointerleave', wake, { signal: this.listeners.signal });
      }
    }
  }

  /**
   * Show the panel with the engine's current values. The panel takes the focus, not a control: a
   * game key pressed out of habit (D, Space) must not pick an option; Tab reaches the controls.
   */
  show(): void {
    this.sync();
    this.root.hidden = false;
    this.root.querySelector<HTMLElement>('.panel')!.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.root.contains(focused)) focused.blur();
  }

  /** Put the engine's current values into the controls, and into the debug panel (the loop fills it only while the game runs). */
  sync(): void {
    const e = this.engine;
    const v = e.settings.values;
    const set = (id: string, value: string | boolean) => {
      const el = this.controls.get(id);
      if (!el) return;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = value as boolean;
      else el.value = String(value);
    };
    set('look', v.look ?? '');
    // a look is drawn by the pixel pass: smooth 3D shows none
    const look = this.controls.get('look')!;
    look.disabled = e.renderer.mode !== 'pixel';
    look.title = look.disabled ? 'Looks need pixel art' : '';
    set('pixelArt', e.renderer.mode === 'pixel');
    set('pixelSize', v.pixelSize ?? 'fine'); // the game's own art resolution is fine
    set('quality', v.quality ?? e.qualityOption);
    const fps = this.controls.get('fps') as HTMLSelectElement;
    if (![...fps.options].some((o) => Number(o.value) === e.maxFps)) fps.add(new Option(`${e.maxFps} fps`, String(e.maxFps)), 0);
    set('fps', String(e.maxFps));
    set('debugInfo', e.debugShown);
    set('sound', !e.audio.muted);
    for (const [ch] of VOLUMES) {
      const pct = Math.round(e.audio.volume[ch] * 100);
      set(ch, String(pct));
      const out = this.outputs.get(ch);
      if (out) out.textContent = `${pct}%`;
    }
    if (e.debug?.visible) e.debug.update(e.game.status?.(e.context) ?? '');
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.listeners.abort();
    this.root.remove();
    this.button?.remove();
  }
}
