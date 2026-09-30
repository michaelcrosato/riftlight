import { CAMERA_PRESETS, type CameraPreset, FreeRig } from './camera';
import type { Engine } from './Engine';
import { RESOLUTIONS } from './framing';
import { FILTERS, FILTER_PRESETS } from './render/filters';

/**
 * DOM overlay (not rendered through the pixel pipeline, so it stays legible).
 * Shows backend, render mode, resolution/scale, camera preset + zoom, FPS, GPU errors,
 * game status; lets you pick filters and swap the camera preset (player stays put).
 */
export class DebugUI {
  readonly root: HTMLDivElement;
  private readonly fields: Record<string, HTMLElement> = {};
  private frames = 0;
  private lastFpsTime = performance.now();
  private fps = 0;
  visible = true;

  constructor(private readonly engine: Engine) {
    this.root = document.createElement('div');
    this.root.className = 'debug-ui';
    const presets = CAMERA_PRESETS.map((p) => `<option value="${p}">${p}</option>`).join('');
    const looks = Object.keys(FILTER_PRESETS).map((n) => `<option value="${n}">${n}</option>`).join('');
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
      </div>
      <div class="row"><span>Camera preset</span><select data-a="camera" title="Swaps the camera; the player stays where they are">${presets}</select></div>
      <div class="row"><span>Look</span><select data-a="look" title="[ and ] cycle">${looks}<option value="">custom</option></select></div>
      <details><summary>Filters</summary><div class="filters">${filters}</div></details>
      <div class="fixed" data-f="fixed"></div>
      <div class="keys" data-f="keys"></div>`;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-f]')) this.fields[el.dataset.f!] = el;
    this.root.querySelector('[data-a="mode"]')!.addEventListener('click', () => engine.toggleMode());
    this.root.querySelector('[data-a="res"]')!.addEventListener('click', () => engine.toggleResolution());

    const cam = this.root.querySelector<HTMLSelectElement>('[data-a="camera"]')!;
    cam.value = engine.camera.preset;
    cam.addEventListener('change', () => {
      engine.setCamera({ preset: cam.value as CameraPreset });
    });

    const look = this.root.querySelector<HTMLSelectElement>('[data-a="look"]')!;
    look.addEventListener('change', () => {
      if (look.value) engine.setFilters(FILTER_PRESETS[look.value] ?? []);
    });
    for (const box of this.root.querySelectorAll<HTMLInputElement>('.filters input')) {
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
  }

  update(gameStatus: string): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFpsTime));
      this.frames = 0;
      this.lastFpsTime = now;
    }
    if (!this.visible) return;
    const e = this.engine;
    const r = e.renderer;
    const f = r.framing;
    this.set('backend', r.backend + (r.fallbackReason ? ` (${r.fallbackReason})` : ''));
    this.fields.backend!.dataset.backend = r.backend === 'WebGPU' ? 'webgpu' : 'webgl2';
    this.set('mode', r.mode === 'pixel' ? `Pixel${r.filters.length ? ` + ${r.filters.join(', ')}` : ''}` : 'Raw 3D');
    const res = r.resolution;
    this.set('res', `${res.width}×${res.height}${res === RESOLUTIONS.compare ? ' (compare)' : ''}`);
    this.set('scale', f.integer ? `${f.scale}× integer` : 'downscaled (viewport too small)');
    const c = e.camera;
    this.set('camera', `${c.preset}${c.zoomable ? ` · zoom ${c.zoom.toFixed(2)}×` : ''}`);
    this.set('fps', String(this.fps));
    this.set('errors', String(r.gpuErrors.length));
    this.set('game', gameStatus);

    const camSelect = this.root.querySelector<HTMLSelectElement>('[data-a="camera"]')!;
    if (camSelect.value !== c.preset && document.activeElement !== camSelect) camSelect.value = c.preset;
    const look = this.root.querySelector<HTMLSelectElement>('[data-a="look"]')!;
    const match = Object.keys(FILTER_PRESETS).find((n) => FILTER_PRESETS[n]!.join() === r.filters.join()) ?? '';
    if (look.value !== match && document.activeElement !== look) look.value = match;
    for (const box of this.root.querySelectorAll<HTMLInputElement>('.filters input')) box.checked = r.filters.includes(box.value);

    if (c instanceof FreeRig) {
      this.set('fixed', c.fixed ? `Fixed ✓ config: ${JSON.stringify(c.fixedConfig())}` : 'Free camera: WASD fly · Q/E down/up · drag/click to look · Shift fast · wheel FOV · Enter = fix');
    } else this.set('fixed', '');
    const camKeys =
      c.preset === 'first' ? 'click = mouse look · Q/E turn' : c.preset === 'third' ? 'drag or Q/E orbit · wheel/+/- zoom' : c.zoomable ? 'wheel/+/- zoom' : '';
    this.set(
      'keys',
      `WASD move · Shift walk · Space jump · C crouch · Z prone · X lie down · F grab/pull · J attack · V wave · B sit · ${camKeys} · P mode · R res · [ ] looks · ~ hide`,
    );
  }

  private set(field: string, text: string): void {
    const el = this.fields[field];
    if (el && el.textContent !== text) el.textContent = text;
  }
}
