import { CAMERA_PRESETS, type CameraPreset, type CameraRig, FreeRig } from './camera';
import type { Engine } from './Engine';
import { RESOLUTIONS } from './framing';
import { FILTERS } from './render/filters';
import { LOOK_PRESETS, lookPresetOf } from './render/look';

/**
 * DOM overlay (not rendered through the pixel pipeline, so it stays legible).
 * Shows backend, render mode, resolution/scale, camera preset + zoom, FPS, GPU errors,
 * game status; lets you pick filters and swap the camera preset (player stays put).
 *
 * Cheap per frame: the engine only calls `update` while the panel is visible, and it
 * only touches the DOM for values that changed (text is compared against a JS-side
 * cache, the filter checkboxes and selects re-sync only when the stack or preset changes).
 */
export class DebugUI {
  readonly root: HTMLDivElement;
  private readonly fields: Record<string, HTMLElement> = {};
  private readonly text = new Map<string, string>();
  private readonly camSelect: HTMLSelectElement;
  private readonly lookSelect: HTMLSelectElement;
  private readonly boxes: HTMLInputElement[];
  private syncedLook = -1;
  private syncedRig: CameraRig | null = null;
  private syncedFixed: boolean | null = null;
  private syncedZoom = 0;
  visible = true;

  constructor(private readonly engine: Engine) {
    this.root = document.createElement('div');
    this.root.className = 'debug-ui';
    const presets = CAMERA_PRESETS.map((p) => `<option value="${p}">${p}</option>`).join('');
    const looks = Object.keys(LOOK_PRESETS).map((n) => `<option value="${n}">${n}</option>`).join('');
    const filters = FILTERS.map((f) => `<label title="${f.group}"><input type="checkbox" value="${f.id}">${f.label}</label>`).join('');
    this.root.innerHTML = `
      <div class="row"><span>Backend</span><b data-f="backend"></b></div>
      <div class="row"><span>Mode</span><b data-f="mode"></b></div>
      <div class="row"><span>Internal</span><b data-f="res"></b></div>
      <div class="row"><span>Scale</span><b data-f="scale"></b></div>
      <div class="row"><span>Camera</span><b data-f="camera"></b></div>
      <div class="row"><span>FPS</span><b data-f="fps"></b></div>
      <div class="row"><span>GPU errors</span><b data-f="errors"></b></div>
      <div class="row game" data-f="game"></div>
      <div class="buttons">
        <button data-a="mode" title="P">Pixel / Raw 3D</button>
        <button data-a="res" title="R">480 / 320</button>
        <button data-a="mute" title="M">Sound</button>
      </div>
      <div class="row"><span>Camera preset</span><select data-a="camera" title="Swaps the camera; the player stays where they are">${presets}</select></div>
      <div class="row"><span>Look</span><select data-a="look" title="[ and ] cycle">${looks}<option value="">custom</option></select></div>
      <details><summary>Filters</summary><div class="filters">${filters}</div></details>
      <div class="fixed" data-f="fixed"></div>
      <div class="keys" data-f="keys"></div>`;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-f]')) this.fields[el.dataset.f!] = el;
    this.root.querySelector('[data-a="mode"]')!.addEventListener('click', () => engine.toggleMode());
    this.root.querySelector('[data-a="res"]')!.addEventListener('click', () => engine.toggleResolution());
    this.root.querySelector('[data-a="mute"]')!.addEventListener('click', () => {
      engine.audio.unlock(); // the click is a user gesture
      engine.audio.toggleMute();
    });

    const cam = (this.camSelect = this.root.querySelector<HTMLSelectElement>('[data-a="camera"]')!);
    cam.value = engine.camera.preset;
    cam.addEventListener('change', () => {
      engine.setCamera({ preset: cam.value as CameraPreset });
    });

    const look = (this.lookSelect = this.root.querySelector<HTMLSelectElement>('[data-a="look"]')!);
    look.addEventListener('change', () => {
      if (look.value && LOOK_PRESETS[look.value]) engine.setLook(LOOK_PRESETS[look.value]!);
    });
    this.boxes = [...this.root.querySelectorAll<HTMLInputElement>('.filters input')];
    for (const box of this.boxes) {
      box.addEventListener('change', () => {
        const current = engine.filters.filter((id) => id !== box.value);
        engine.setFilters(box.checked ? [...current, box.value] : current);
      });
    }
    // Controls never keep keyboard focus: game keys (Space, S, F, …) must not toggle a
    // checkbox, press a button or change the camera <select>.
    for (const el of this.root.querySelectorAll<HTMLElement>('button, select, input')) {
      el.addEventListener('change', () => el.blur());
      if (el.tagName !== 'SELECT') el.addEventListener('pointerup', () => setTimeout(() => el.blur(), 0));
      el.addEventListener('keydown', (e) => {
        e.preventDefault();
        el.blur();
      });
    }
    engine.renderer.container.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
    if (this.visible) this.update(this.engine.game.status?.(this.engine.context) ?? '');
  }

  /** Refresh the panel. The engine calls this only while the panel is visible. */
  update(gameStatus: string): void {
    if (!this.visible) return;
    const e = this.engine;
    const r = e.renderer;
    const f = r.framing;
    this.set('backend', r.backend + (r.fallbackReason ? ` (${r.fallbackReason})` : ''));
    const backendAttr = r.backend === 'WebGPU' ? 'webgpu' : 'webgl2';
    if (this.fields.backend!.dataset.backend !== backendAttr) this.fields.backend!.dataset.backend = backendAttr;
    this.set('mode', r.mode === 'pixel' ? `Pixel${r.filters.length ? ` + ${r.filters.join(', ')}` : ''}` : 'Raw 3D');
    const res = r.resolution;
    this.set('res', `${res.width}×${res.height}${r.baseResolution === RESOLUTIONS.compare ? ' (compare)' : ''}${r.aspect !== 'fixed' && res !== r.baseResolution ? ` (${r.aspect})` : ''}`);
    this.set('scale', f.integer ? `${f.scale}× integer` : 'downscaled (viewport too small)');
    const c = e.camera;
    this.set('camera', `${c.preset}${c.zoomable ? ` · zoom ${c.zoom.toFixed(2)}×` : ''}`);
    this.set('fps', `${e.fps}${e.maxFps > 0 ? ` (cap ${e.maxFps})` : ''} · ${e.quality}`);
    this.set('errors', String(r.gpuErrors.length));
    this.set('game', gameStatus);
    const mute = this.root.querySelector<HTMLButtonElement>('[data-a="mute"]')!;
    const sound = e.audio.muted ? 'Sound: off' : 'Sound: on';
    if (mute.textContent !== sound) mute.textContent = sound;

    // Selects and checkboxes: only when the stack / camera changed (never mid-interaction).
    if (this.camSelect.value !== c.preset && document.activeElement !== this.camSelect) this.camSelect.value = c.preset;
    if (r.lookVersion !== this.syncedLook) {
      const match = lookPresetOf(r.look) ?? '';
      if (this.lookSelect.value !== match && document.activeElement !== this.lookSelect) this.lookSelect.value = match;
      for (const box of this.boxes) box.checked = r.filters.includes(box.value);
      this.syncedLook = r.lookVersion;
    }

    const fixed = c instanceof FreeRig ? c.fixed : null;
    if (c !== this.syncedRig || fixed !== this.syncedFixed || c.zoom !== this.syncedZoom) {
      this.syncedRig = c;
      this.syncedFixed = fixed;
      this.syncedZoom = c.zoom;
      if (c instanceof FreeRig) {
        this.set('fixed', c.fixed ? `Fixed ✓ config: ${JSON.stringify(c.fixedConfig())}` : 'Free camera: WASD fly · Q/E down/up · drag/click to look · Shift fast · wheel FOV · Enter = fix');
      } else this.set('fixed', '');
      const camKeys =
        c.preset === 'first' ? 'click = mouse look · Q/E turn' : c.preset === 'third' ? 'drag or Q/E orbit · wheel/+/- zoom' : c.zoomable ? 'wheel/+/- zoom' : '';
      this.set(
        'keys',
        `WASD move · Shift walk · Space jump · C crouch · Z prone · X lie down · F grab/pull · J attack · V wave · B sit · ${camKeys} · P mode · R res · [ ] looks · M mute · ~ hide`,
      );
    }
  }

  private set(field: string, text: string): void {
    if (this.text.get(field) === text) return;
    this.text.set(field, text);
    const el = this.fields[field];
    if (el) el.textContent = text;
  }
}
