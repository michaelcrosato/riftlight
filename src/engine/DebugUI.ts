import type { Engine } from './Engine';
import { RESOLUTIONS } from './framing';

/**
 * DOM overlay (not rendered through the pixel pipeline, so it stays legible).
 * Shows the active backend, render mode, resolution/scale, FPS and GPU error count.
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
    this.root.innerHTML = `
      <div class="row"><span>Backend</span><b data-f="backend"></b></div>
      <div class="row"><span>Mode</span><b data-f="mode"></b></div>
      <div class="row"><span>Internal</span><b data-f="res"></b></div>
      <div class="row"><span>Scale</span><b data-f="scale"></b></div>
      <div class="row"><span>FPS</span><b data-f="fps"></b></div>
      <div class="row"><span>GPU errors</span><b data-f="errors"></b></div>
      <div class="row game" data-f="game"></div>
      <div class="buttons">
        <button data-a="mode" title="P">Pixel / Raw 3D</button>
        <button data-a="res" title="R">480 / 320</button>
      </div>
      <div class="keys">WASD/Arrows move · Space jump · P mode · R res · ~ hide</div>`;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-f]')) this.fields[el.dataset.f!] = el;
    this.root.querySelector('[data-a="mode"]')!.addEventListener('click', () => engine.toggleMode());
    this.root.querySelector('[data-a="res"]')!.addEventListener('click', () => engine.toggleResolution());
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
    const r = this.engine.renderer;
    const f = r.framing;
    this.set('backend', r.backend + (r.fallbackReason ? ` (${r.fallbackReason})` : ''));
    this.fields.backend!.dataset.backend = r.backend === 'WebGPU' ? 'webgpu' : 'webgl2';
    this.set('mode', r.mode === 'pixel' ? 'Pixel' : 'Raw 3D');
    const res = r.resolution;
    const tag = res === RESOLUTIONS.compare ? ' (compare)' : '';
    this.set('res', `${res.width}×${res.height}${tag}`);
    this.set('scale', f.integer ? `${f.scale}× integer` : 'downscaled (viewport too small)');
    this.set('fps', String(this.fps));
    this.set('errors', String(r.gpuErrors.length));
    this.set('game', gameStatus);
  }

  private set(field: string, text: string): void {
    const el = this.fields[field];
    if (el && el.textContent !== text) el.textContent = text;
  }
}
