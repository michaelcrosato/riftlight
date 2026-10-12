import '../style.css';
import './lab.css';
import { Group, Mesh, PlaneGeometry, Vector3 } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Engine, lookPresetOf, toonMaterial, withUrlOptions, type Game, type GameContext, type LightHandle } from '../engine';
import { buildModel, MODEL_LIBRARY, type ModelBuild, type ModelOptions } from '../engine/model';
import { GAME_VIEW } from '../engine/model/view';
import { GateB } from './gateB';

/**
 * Asset Lab (/asset-lab.html): models from the library in the real renderer (toon shading,
 * outlines, looks, lights) through Riftlight's own camera, at the level and town zooms. The
 * `npm run model` sheets are software-drawn; this is how a model really looks in the game.
 *
 * URL: ?model=well&zoom=town&look=handheld, or ?lineup=all (or ?lineup=barrel,crate&cols=2).
 * Agents: window.__ASSET_LAB__ (see `AssetLabApi` below).
 */
const ZOOMS = { level: GAME_VIEW.zooms.level, town: GAME_VIEW.zooms.town, close: 3 } as const;
type ZoomName = keyof typeof ZOOMS;

class AssetLab implements Game {
  readonly name = 'Asset Lab';
  readonly root = new Group();
  shown: ModelBuild[] = [];
  private lights: LightHandle[] = [];
  /** Where the camera looks. */
  readonly centre = new Vector3(0, 0.5, 0);
  /** The checker floor (Gate B hides it). */
  readonly floor: Mesh[] = [];
  ctx!: GameContext;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    // a quiet 1 m checker in two dark greys that no PALETTE colour is close to, so every model
    // reads against it and each view shows a scale (the origin's tile is the darker one)
    for (const [dark, color] of [[true, 0x3b383d], [false, 0x45424a]] as const) {
      const tiles = [];
      for (let x = -30; x < 30; x++) for (let z = -30; z < 30; z++) if (((x + z) & 1) === 0 === dark) tiles.push(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(x, 0, z));
      const floor = new Mesh(mergeGeometries(tiles, false), toonMaterial(color));
      floor.receiveShadow = true;
      ctx.scene.add(floor);
      this.floor.push(floor);
    }
    ctx.scene.add(this.root);
    const p = new URLSearchParams(location.search);
    const lineup = p.get('lineup');
    if (lineup) this.lineup(lineup === 'all' ? MODEL_LIBRARY.all().map((d) => d.id) : lineup.split(','), { cols: Number(p.get('cols')) || undefined });
    else this.show(p.get('model') ?? 'barrel'); // a model that reads at a glance
  }

  /** Hide (release) or bring back the shown models' lights. */
  lightsOn(on: boolean): void {
    for (const l of this.lights) l.release();
    this.lights = [];
    if (on) for (const b of this.shown) if (b.light) this.lights.push(this.ctx.lights.request({ position: [b.object.position.x + b.light.at[0], b.light.at[1], b.object.position.z + b.light.at[2]], color: b.light.color, intensity: b.light.intensity, radius: b.light.radius, flicker: b.light.flicker ?? 'none' }));
  }

  /** Empty the lab: release the lights, and dispose the geometry seeded builds made for us. */
  clear(): void {
    for (const l of this.lights) l.release();
    this.lights = [];
    for (const b of this.shown) {
      b.object.traverse((o) => {
        if (o instanceof Mesh && !o.geometry.userData.shared) o.geometry.dispose();
      });
    }
    this.root.clear();
    this.shown = [];
  }

  /** Place a build at (x, z) on the floor, with its light. */
  private place(b: ModelBuild, x: number, z: number): void {
    b.object.position.set(x, 0, z);
    this.root.add(b.object);
    if (b.light) this.lights.push(this.ctx.lights.request({ position: [x + b.light.at[0], b.light.at[1], z + b.light.at[2]], color: b.light.color, intensity: b.light.intensity, radius: b.light.radius, flicker: b.light.flicker ?? 'none' }));
    this.shown.push(b);
  }

  show(id: string, o: ModelOptions = {}): ModelBuild {
    const b = buildModel(id, o); // build first: a bad id leaves what was shown
    this.clear();
    this.place(b, 0, 0);
    this.centre.set((b.bounds.min[0] + b.bounds.max[0]) / 2, (b.bounds.min[1] + b.bounds.max[1]) / 2, (b.bounds.min[2] + b.bounds.max[2]) / 2);
    return b;
  }

  /** Several models in rows at one scale, the camera zoomed out to hold them all. */
  lineup(ids: readonly string[], o: { cols?: number } = {}): void {
    if (!ids.length) throw new Error('lineup needs at least one model id');
    const builds = ids.map((id) => buildModel(id));
    this.clear();
    const cell = Math.max(1, ...builds.map((b) => Math.max(b.bounds.size[0], b.bounds.size[2]))) + 0.6;
    const cols = Math.max(1, o.cols ?? Math.ceil(Math.sqrt(builds.length)));
    const rows = Math.ceil(builds.length / cols);
    builds.forEach((b, i) => {
      const x = ((i % cols) - (cols - 1) / 2) * cell;
      const z = (Math.floor(i / cols) - (rows - 1) / 2) * cell;
      this.place(b, x - (b.bounds.min[0] + b.bounds.max[0]) / 2, z - (b.bounds.min[2] + b.bounds.max[2]) / 2);
    });
    this.centre.set(0, 0.5, 0);
  }

  cameraTarget(): Vector3 {
    return this.centre;
  }

  status(): string {
    return this.shown.map((b) => b.id).join(' ');
  }
}

/** Handle for agents and tests: window.__ASSET_LAB__. */
export interface AssetLabApi {
  /** Every model id in the library. */
  list(): string[];
  /** One model at the origin; its report (tris, draws, materials) and bounds. */
  show(id: string, options?: Pick<ModelOptions, 'params' | 'seed' | 'palette' | 'light'>): { tris: number; draws: number; materials: number; size: readonly number[] };
  /** Several models in rows (all of them with no ids), the camera zoomed out to hold them. */
  lineup(ids?: readonly string[], options?: { cols?: number }): void;
  /** The game's zooms: 'level' (default), 'town', 'close' for detail, or a number. */
  zoom(zoom: ZoomName | number): void;
  /** Nothing shown (a baseline for captures). */
  clear(): void;
  /** A LOOK_PRESETS name. */
  setLook(name: string): void;
  /** What is shown, the zoom, the look (a preset's name, or null when custom), triangles and live light requests. */
  state(): { shown: string[]; zoom: number; look: string | null; tris: number; lights: number };
  /** The rendered frame as a PNG data URL. */
  capture(): Promise<string>;
  /** Gate B's scene and measurements (src/lab/gateB.ts, `scripts/gate-b.ts`). */
  readonly gateB: GateB;
}

function toDataUrl(width: number, height: number, pixels: Uint8Array | Uint8ClampedArray): string {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return c.toDataURL('image/png');
}

function ui(engine: Engine, lab: AssetLab, api: AssetLabApi): void {
  const panel = document.createElement('div');
  panel.className = 'lab-panel';
  panel.innerHTML = `
    <h1>Asset Lab</h1>
    <label>Model <select data-a="model"></select></label>
    <div class="row"><button data-a="lineup">Lineup: all</button></div>
    <div class="row views"><button data-z="level">Level</button><button data-z="town">Town</button><button data-z="close">Close</button></div>
    <label>Look <select data-a="look"></select></label>
    <pre class="metrics" data-a="info"></pre>
    <p class="hint">Models: src/engine/model/library/*.ts. <code>npm run model -- sheet &lt;id&gt;</code></p>`;
  document.body.appendChild(panel);
  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const modelSel = $<HTMLSelectElement>('[data-a="model"]');
  modelSel.innerHTML = api.list().map((id) => `<option>${id}</option>`).join('');
  const lookSel = $<HTMLSelectElement>('[data-a="look"]');
  lookSel.innerHTML = Object.keys(engine.lookPresets).map((n) => `<option>${n}</option>`).join('');
  const info = () => {
    const s = api.state();
    $('[data-a="info"]').textContent = `${s.shown.join(', ')}\n${s.tris} tris  ${s.lights} lights  zoom ${s.zoom.toFixed(2)}`;
  };
  panel.addEventListener('click', (e) => (e.target instanceof HTMLButtonElement ? e.target.blur() : undefined));
  modelSel.addEventListener('change', () => {
    api.show(modelSel.value);
    info();
  });
  $('[data-a="lineup"]').addEventListener('click', () => {
    api.lineup();
    info();
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) =>
    b.addEventListener('click', () => {
      api.zoom(b.dataset.z as ZoomName);
      info();
    }),
  );
  lookSel.addEventListener('change', () => api.setLook(lookSel.value));
  modelSel.value = lab.shown[0]?.id ?? '';
  info();
}

const container = document.getElementById('app')!;
const lab = new AssetLab();
const query = new URLSearchParams(location.search);
// ?zoom= takes the engine's numbers (withUrlOptions) or one of the game's zoom names
const zoomParam = query.get('zoom');
const startZoom = zoomParam && zoomParam in ZOOMS ? ZOOMS[zoomParam as ZoomName] : ZOOMS.level;
Engine.start(
  lab,
  withUrlOptions({
    container,
    // a stiff follow: a lab frames each model at once instead of easing to it
    camera: { preset: 'iso', pitch: GAME_VIEW.pitch, yaw: GAME_VIEW.yaw, viewHeight: GAME_VIEW.viewHeight, zoom: startZoom, minZoom: 0.2, maxZoom: 4, stiffness: 40 },
    filters: [],
  }),
)
  .then((engine) => {
    const fit = () => {
      // zoom out until the lineup fits (the view is viewHeight / zoom tall)
      const span = Math.max(...lab.shown.map((b) => Math.hypot(b.object.position.x, b.object.position.z) * 2 + Math.max(...b.bounds.size)));
      engine.camera.setZoom(Math.min(ZOOMS.level, GAME_VIEW.viewHeight / (span * 0.9)));
    };
    const api: AssetLabApi = {
      list: () => MODEL_LIBRARY.all().map((d) => d.id),
      show: (id, o = {}) => {
        const b = lab.show(id, o);
        engine.camera.setZoom(ZOOMS.level);
        return { tris: b.report.tris, draws: b.report.draws, materials: b.report.materials, size: b.bounds.size };
      },
      lineup: (ids, o) => {
        lab.lineup(ids ?? api.list(), o);
        fit();
      },
      zoom: (z) => {
        const value = typeof z === 'number' ? z : ZOOMS[z];
        if (!(value > 0)) throw new Error(`no zoom "${z}" (level, town, close, or a number)`);
        engine.camera.setZoom(value);
      },
      clear: () => lab.clear(),
      setLook: (name) => {
        const preset = engine.lookPresets[name];
        if (!preset) throw new Error(`no look "${name}" (${Object.keys(engine.lookPresets).join(', ')})`);
        engine.setLook(preset);
      },
      state: () => ({
        shown: lab.shown.map((b) => b.id),
        zoom: engine.camera.zoom,
        look: lookPresetOf(engine.look),
        tris: lab.shown.reduce((s, b) => s + b.report.tris, 0),
        lights: engine.lights.describe().filter((r) => r.alive).length,
      }),
      capture: async () => {
        const f = await engine.renderer.capture();
        return toDataUrl(f.width, f.height, f.pixels);
      },
      gateB: new GateB(engine, lab.ctx, lab.centre, (hidden) => {
        for (const f of lab.floor) f.visible = !hidden;
        lab.root.visible = !hidden;
        lab.lightsOn(!hidden);
      }),
    };
    if (query.get('lineup')) fit();
    ui(engine, lab, api);
    Object.assign(window, { __ASSET_LAB__: api, __PIXEL_ENGINE__: engine });
  })
  .catch((error: unknown) => {
    console.error(error);
    container.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
  });
