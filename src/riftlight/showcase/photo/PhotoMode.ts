/**
 * Photo mode: the "show off the renderer" button, in any stage (town, a level, the arcade, the
 * Hall of Beasts). O opens it (or pause → Photo mode); the world freezes where it is.
 *
 *   fly    the `free` camera from the current view: WASD, Q/E down/up, drag to look,
 *          Shift fast, wheel = field of view. Tab: edit the settings.
 *   edit   ↑↓ pick a row, ←→ change it (or click the arrows): every filter look and every
 *          single filter (palettes, consoles, displays), pixel / raw, 480 / 320, time of day
 *          (town), sun and ambient strength, a fill light that rides with the camera.
 *   P      save a PNG of exactly what the pipeline presents (`renderer.capture()`).
 *   (pad: Y switches fly / edit, X saves, Start goes back)
 *   H      hide the panel · Esc back to the game: camera, filters, mode, resolution and lights
 *          come back as they were.
 */
import { Vector3 } from 'three/webgpu';
import { type CameraConfig, FILTER_IDS, FILTER_PRESETS, FirstPersonRig, FreeRig, type LightHandle, OrthoRig, PALETTE, type RenderMode, type Resolution } from '../../../engine';
import { inside, type Rect, type UiCanvas, type UiEvent } from '../../ui/kit';
import type { Showcase } from '../Showcase';

/** One look per step: off, every preset stack, then every filter on its own. */
export const PHOTO_LOOKS: readonly { name: string; filters: readonly string[] }[] = [
  ...Object.entries(FILTER_PRESETS).map(([name, filters]) => ({ name: name.replace(/_/g, ' '), filters })),
  ...FILTER_IDS.map((id) => ({ name: id, filters: [id] })),
];

const FILL_LIGHTS: readonly { name: string; color: number | null }[] = [
  { name: 'off', color: null },
  { name: 'warm', color: PALETTE.sand },
  { name: 'cold', color: PALETTE.sky },
  { name: 'rift', color: PALETTE.plum },
  { name: 'ember', color: PALETTE.orange },
];

type RowId = 'look' | 'mode' | 'res' | 'time' | 'sun' | 'ambient' | 'light' | 'capture' | 'exit';

interface Saved {
  camera: CameraConfig;
  zoom: number;
  fp: { yaw: number; pitch: number } | null;
  filters: readonly string[];
  mode: RenderMode;
  resolution: Resolution;
  sun: number;
  ambient: number;
  dayTime: number;
  dayLength: number;
}

export class PhotoMode {
  active = false;
  /** fly: the camera moves; edit: the panel has the keys. */
  sub: 'fly' | 'edit' = 'fly';
  look = 0;
  sunScale = 1;
  ambientScale = 1;
  fill = 0;
  hidden = false;
  /** Photos taken this session (file names count up). */
  shots = 0;
  /** The last capture, for agents. */
  last: { width: number; height: number; bytes: number; filters: readonly string[]; mode: RenderMode; name: string } | null = null;
  private saved: Saved | null = null;
  private row = 0;
  private light: LightHandle | null = null;
  private readonly rects = new Map<string, Rect>();
  private readonly target = new Vector3();
  private readonly dir = new Vector3();
  private flash = 0;
  private toast = '';
  private toastAge = 99;
  private base = { sun: 3.2, ambient: 1.1 };
  private capturing = false;

  constructor(private readonly host: Showcase) {}

  private get engine() {
    return this.host.ctx.engine;
  }

  /** Rows that apply here (time of day only in town). */
  rows(): RowId[] {
    const town = this.host.game.screen === 'town' && !this.host.mode;
    return ['look', 'mode', 'res', ...(town ? (['time'] as const) : []), 'sun', 'ambient', 'light', 'capture', 'exit'];
  }

  open(): void {
    if (this.active) return;
    const game = this.host.game;
    if (game.screen !== 'town' && game.screen !== 'level') return;
    game.layer.closeAll();
    const e = this.engine;
    const rig = e.camera;
    this.saved = {
      // the mode's camera, or the shell's own preset (iso, or whatever a reviewer picked)
      camera: this.host.mode?.camera() ?? { preset: rig.preset === 'free' || rig.preset === 'fixed' ? 'iso' : rig.preset },
      zoom: rig.zoom,
      fp: rig instanceof FirstPersonRig ? { yaw: rig.yaw, pitch: rig.pitch } : null,
      filters: [...e.filters],
      mode: e.renderer.mode,
      resolution: e.renderer.baseResolution,
      sun: e.sun.intensity,
      ambient: e.ambient.intensity,
      dayTime: game.town.dayTime,
      dayLength: game.town.dayLength,
    };
    this.base = { sun: e.sun.intensity, ambient: e.ambient.intensity };
    this.look = Math.max(0, PHOTO_LOOKS.findIndex((l) => l.filters.join() === e.filters.join()));
    this.sunScale = this.ambientScale = 1;
    this.fill = 0;
    this.hidden = false;
    this.sub = 'fly';
    this.row = 0;
    this.active = true;
    const free = e.setCamera({ preset: 'free', fov: 50 }, { syncUrl: false });
    if (free instanceof FreeRig) free.onFix = null; // Enter is ours, not the rig's "print the fixed config"
    this.host.ctx.audio.play('rl.open');
  }

  close(): void {
    if (!this.active) return;
    const s = this.saved!;
    const e = this.engine;
    const game = this.host.game;
    this.active = false;
    this.light?.release();
    this.light = null;
    e.setFilters(s.filters);
    e.renderer.setMode(s.mode);
    if (e.renderer.baseResolution !== s.resolution) e.renderer.setResolution(s.resolution);
    e.sun.intensity = s.sun;
    e.ambient.intensity = s.ambient;
    game.town.dayTime = s.dayTime;
    game.town.dayLength = s.dayLength;
    if (game.town.active) game.town.update(0, null);
    const rig = e.setCamera(s.camera, { syncUrl: false });
    if (rig instanceof OrthoRig) rig.setZoom(s.zoom);
    if (rig instanceof FirstPersonRig && s.fp) {
      rig.yaw = s.fp.yaw;
      rig.pitch = s.fp.pitch;
    }
    rig.teleport(this.host.mode?.cameraTarget() ?? game.cameraTarget());
    this.saved = null;
    this.host.ctx.audio.play('rl.close');
  }

  // ------------------------------------------------------------------ changes (UI and agents)

  setLook(i: number): string {
    const n = PHOTO_LOOKS.length;
    this.look = ((i % n) + n) % n;
    const l = PHOTO_LOOKS[this.look]!;
    this.engine.setFilters(l.filters);
    return l.name;
  }

  setMode(mode: RenderMode): void {
    this.engine.renderer.setMode(mode);
  }

  toggleResolution(): void {
    this.engine.toggleResolution();
  }

  /** Town time of day, 0..1 (0.25 noon, 0.5 dusk, 0.75 midnight). */
  setTime(t: number): void {
    const town = this.host.game.town;
    town.dayLength = 0;
    town.dayTime = ((t % 1) + 1) % 1;
    if (town.active) {
      town.update(0, null);
      this.base = { sun: this.engine.sun.intensity, ambient: this.engine.ambient.intensity };
    }
    this.applyLights();
  }

  setFill(i: number): void {
    const n = FILL_LIGHTS.length;
    this.fill = ((i % n) + n) % n;
    this.light?.release();
    this.light = null;
    const c = FILL_LIGHTS[this.fill]!.color;
    if (c !== null) this.light = this.host.ctx.lights.request({ follow: this.engine.camera.camera, color: c, intensity: 14, radius: 12, decay: 1, priority: 6, name: 'photo-fill' });
  }

  private applyLights(): void {
    this.engine.sun.intensity = this.base.sun * this.sunScale;
    this.engine.ambient.intensity = this.base.ambient * this.ambientScale;
  }

  private change(id: RowId, dir: 1 | -1): void {
    const game = this.host.game;
    switch (id) {
      case 'look':
        this.setLook(this.look + dir);
        break;
      case 'mode':
        this.setMode(this.engine.renderer.mode === 'pixel' ? 'raw' : 'pixel');
        break;
      case 'res':
        this.toggleResolution();
        break;
      case 'time':
        this.setTime(game.town.dayTime + dir * 0.025);
        break;
      case 'sun':
        this.sunScale = Math.min(3, Math.max(0, +(this.sunScale + dir * 0.1).toFixed(2)));
        this.applyLights();
        break;
      case 'ambient':
        this.ambientScale = Math.min(3, Math.max(0, +(this.ambientScale + dir * 0.1).toFixed(2)));
        this.applyLights();
        break;
      case 'light':
        this.setFill(this.fill + dir);
        break;
      case 'capture':
        void this.capture();
        break;
      case 'exit':
        this.close();
        break;
    }
    game.sound(id === 'capture' || id === 'exit' ? 'click' : 'move');
  }

  /**
   * Save what is on screen as a PNG (the pipeline's presented frame, filters and all; the HUD
   * is not in it). Downloads `riftlight-photo-N.png` and returns its size and data URL.
   */
  async capture(o: { download?: boolean } = {}): Promise<{ width: number; height: number; dataUrl: string; name: string }> {
    this.capturing = true;
    const frame = await this.engine.renderer.capture();
    this.capturing = false;
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const g = canvas.getContext('2d')!;
    g.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    const name = `riftlight-photo-${String(++this.shots).padStart(3, '0')}.png`;
    if (o.download !== false) {
      try {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = name;
        a.click();
      } catch {
        /* downloads blocked: the data URL is returned */
      }
    }
    this.last = { width: frame.width, height: frame.height, bytes: Math.floor((dataUrl.length - 22) * 0.75), filters: [...this.engine.filters], mode: this.engine.renderer.mode, name };
    this.flash = 1;
    this.toast = `SAVED ${name.toUpperCase()}`;
    this.toastAge = 0;
    this.host.ctx.audio.play('rl.click', { pitch: 7 });
    return { width: frame.width, height: frame.height, dataUrl, name };
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, events: readonly UiEvent[]): void {
    const input = this.host.ctx.input;
    const rig = this.engine.camera;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.toastAge += dt;
    // drag to look, never a pointer lock (the panel stays clickable)
    input.wantsPointerLock = false;
    if (input.wasPressed('Tab', 'PadY')) {
      this.sub = this.sub === 'fly' ? 'edit' : 'fly';
      this.host.game.sound('move');
    }
    if (rig instanceof FreeRig) {
      rig.fixed = this.sub === 'edit';
      rig.controlsCharacter = false;
    }
    if (input.wasPressed('KeyP', 'PadX')) void this.capture();
    if (input.wasPressed('KeyH')) this.hidden = !this.hidden;
    if (input.wasPressed('Escape', 'PadStart')) return this.close();
    const rows = this.rows();
    this.row = Math.min(this.row, rows.length - 1);
    for (const e of events) {
      if (e.kind === 'pointer' && e.type === 'down' && !this.hidden) {
        for (const [key, r] of this.rects) {
          if (!inside(r, e.x, e.y)) continue;
          const [id, side] = key.split(':') as [RowId, string];
          this.row = rows.indexOf(id);
          this.change(id, side === 'l' ? -1 : 1);
        }
        continue;
      }
      if (this.sub !== 'edit') continue;
      if (e.kind === 'nav') {
        if (e.dir === 'up' || e.dir === 'down') this.row = (this.row + (e.dir === 'down' ? 1 : -1) + rows.length) % rows.length;
        else this.change(rows[this.row]!, e.dir === 'left' ? -1 : 1);
      } else if (e.kind === 'confirm' && !input.wasPressed('KeyF', 'KeyJ')) this.change(rows[this.row]!, 1);
    }
    // keep the scaled lights (a town under photo mode does not update its sky itself)
    if (this.sunScale !== 1 || this.ambientScale !== 1) this.applyLights();
  }

  draw(ui: UiCanvas): void {
    if (this.flash > 0) {
      // the shutter: a white frame that fades
      const k = Math.ceil(this.flash * 6);
      ui.rect(0, 0, ui.w, k, 'white');
      ui.rect(0, ui.h - k, ui.w, k, 'white');
      ui.rect(0, 0, k, ui.h, 'white');
      ui.rect(ui.w - k, 0, k, ui.h, 'white');
    }
    if (this.toastAge < 2) ui.text(ui.w / 2, ui.h - 22, this.toast, { align: 'center', color: 'sand', shadow: 'ink' });
    if (this.capturing) return;
    if (this.hidden) {
      ui.mini(ui.w - 4, ui.h - 8, 'H SHOW', 'slate', 'right');
      return;
    }
    const rows = this.rows();
    const e = this.engine;
    const game = this.host.game;
    const value = (id: RowId): string => {
      switch (id) {
        case 'look':
          return PHOTO_LOOKS[this.look]!.name;
        case 'mode':
          return e.renderer.mode;
        case 'res':
          return `${e.renderer.resolution.width}x${e.renderer.resolution.height}`;
        case 'time':
          return dayLabel(game.town.dayTime);
        case 'sun':
          return `${Math.round(this.sunScale * 100)}%`;
        case 'ambient':
          return `${Math.round(this.ambientScale * 100)}%`;
        case 'light':
          return FILL_LIGHTS[this.fill]!.name;
        case 'capture':
          return 'P';
        case 'exit':
          return 'ESC';
      }
    };
    const label: Record<RowId, string> = { look: 'LOOK', mode: 'RENDER', res: 'ART RES', time: 'TIME', sun: 'SUN', ambient: 'AMBIENT', light: 'FILL LIGHT', capture: 'SAVE PNG', exit: 'BACK TO GAME' };
    const x = 6;
    const w = 150;
    let y = 22;
    const h = rows.length * 12 + 26;
    ui.panel(x, y - 14, w, h, 'ink', this.sub === 'edit' ? 'sand' : 'slate');
    ui.text(x + 5, y - 11, 'PHOTO MODE', { color: 'sand' });
    ui.mini(x + w - 5, y - 10, this.sub === 'edit' ? 'EDIT' : 'FLY', this.sub === 'edit' ? 'sand' : 'mist', 'right');
    this.rects.clear();
    rows.forEach((id, i) => {
      const focus = this.sub === 'edit' && i === this.row;
      const r: Rect = { x: x + 2, y, w: w - 4, h: 11 };
      if (focus || ui.hover(r)) ui.rect(r.x, r.y, r.w, r.h, 'night');
      if (focus) ui.rect(r.x, r.y, 2, r.h, 'sand');
      ui.text(x + 6, y + 2, label[id], { color: focus ? 'white' : 'mist' });
      const v = value(id).toUpperCase();
      const action = id === 'capture' || id === 'exit';
      if (action) {
        ui.mini(x + w - 8, y + 3, v, 'slate', 'right');
        this.rects.set(`${id}:r`, r);
      } else {
        ui.text(x + w - 14, y + 2, v.length > 14 ? v.slice(0, 13) + '.' : v, { align: 'right', color: focus ? 'sand' : 'white' });
        ui.text(x + w - 9, y + 2, '>', { color: focus ? 'sand' : 'slate' });
        ui.text(x + 72, y + 2, '<', { color: focus ? 'sand' : 'slate' });
        this.rects.set(`${id}:l`, { x: x + 66, y, w: 14, h: 11 });
        this.rects.set(`${id}:r`, { x: x + 80, y, w: w - 82, h: 11 });
      }
      y += 12;
    });
    const help = this.sub === 'fly' ? 'WASD Q E FLY · DRAG LOOK · WHEEL FOV · TAB EDIT · P SAVE · H HIDE · ESC BACK' : 'ARROWS PICK AND CHANGE · ENTER · TAB FLY · P SAVE · ESC BACK';
    ui.mini(ui.w / 2, ui.h - 8, help, 'mist', 'center', 'ink');
  }

  /** The free camera's focus: a point ahead of it (the light pool lights what it looks at). */
  cameraTarget(): Vector3 {
    const cam = this.engine.camera.camera;
    cam.getWorldDirection(this.dir);
    return this.target.copy(cam.position).addScaledVector(this.dir, 6);
  }
}

function dayLabel(t: number): string {
  const minutes = Math.round(((t + 0.25) % 1) * 24 * 60);
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

