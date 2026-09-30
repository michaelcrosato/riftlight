import '../style.css';
import './lab.css';
import {
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  GridHelper,
  LineBasicNodeMaterial,
  LineSegments,
  LoopRepeat,
  Mesh,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
  PlaneGeometry,
  Vector3,
} from 'three/webgpu';
import {
  analyzeClip,
  compileClip,
  Engine,
  optionsFromUrl,
  renderSheet,
  toonMaterial,
  type CameraConfig,
  type ClipDef,
  type ClipReport,
  type Game,
  type GameContext,
  type RigSpec,
} from '../engine';
import { restPoseOf, sampleClip, type RestPose, type SheetImage } from '../engine/animation';
import { HERO_MODEL } from '../game/hero';
import { HERO_CLIPS } from '../game/hero/animations';
import { HERO_RIG } from '../game/hero/rig';

/**
 * Animation Lab (/lab.html): preview any clip in the real renderer, scrub it frame by
 * frame, see its skeleton and metrics, render its contact sheet. Edits to
 * src/game/hero/animations.ts hot-reload while you watch.
 *
 * URL: ?clip=Run&view=side|front|three|top|orbit&frame=6&speed=0.25&paused=1
 * Agents: window.__ANIM_LAB__ (see `LabApi` below).
 */

type View = 'side' | 'front' | 'three' | 'top' | 'orbit';
const VIEWS: Record<View, CameraConfig> = {
  side: { preset: 'fixed', position: [-5, 0.95, 0], target: [0, 0.8, 0], projection: 'ortho', viewHeight: 2.6 },
  front: { preset: 'fixed', position: [0, 0.95, 5], target: [0, 0.8, 0], projection: 'ortho', viewHeight: 2.6 },
  three: { preset: 'fixed', position: [-3.2, 2.2, 3.6], target: [0, 0.7, 0], projection: 'perspective', fov: 30 },
  top: { preset: 'fixed', position: [0, 6, 0.01], target: [0, 0, 0], projection: 'ortho', viewHeight: 3 },
  orbit: { preset: 'third', distance: 4.2, zoom: 1 },
};

class AnimationLab implements Game {
  readonly name = 'Animation Lab';
  defs: readonly ClipDef[] = HERO_CLIPS;
  readonly rig: RigSpec = HERO_RIG;
  model!: Object3D;
  /** A second, off-screen copy for metrics and sheets (so it never fights the preview). */
  probe!: Object3D;
  rest!: RestPose;
  clips = new Map<string, AnimationClip>();
  reports = new Map<string, ClipReport>();
  mixer!: AnimationMixer;
  action: AnimationAction | null = null;
  clipName = 'Idle';
  frame = 0;
  /** Frames played since the clip was picked (keeps growing across loops, for the treadmill). */
  played = 0;
  playing = true;
  speed = 1;
  treadmill = true;
  skeleton!: LineSegments;
  grid!: GridHelper;
  private bones: [string, string][] = [];
  private onChange: (() => void) | null = null;

  async setup(ctx: GameContext): Promise<void> {
    const floor = new Mesh(new PlaneGeometry(40, 40).rotateX(-Math.PI / 2), toonMaterial(ctx.palette.slate));
    floor.receiveShadow = true;
    ctx.scene.add(floor);
    this.grid = new GridHelper(40, 80, 0x94b0c2, 0x566c86);
    this.grid.position.y = 0.002;
    ctx.scene.add(this.grid);

    const [hero, probe] = await Promise.all([ctx.loadModel(HERO_MODEL), ctx.loadModel(HERO_MODEL, { castShadow: false })]);
    this.model = hero.scene;
    this.probe = probe.scene;
    ctx.scene.add(this.model);
    this.rest = restPoseOf(this.model, this.rig);
    this.mixer = new AnimationMixer(this.model);

    for (const j of this.rig.joints) {
      let o = this.model.getObjectByName(j)!.parent;
      while (o && !this.rig.joints.includes(o.name)) o = o.parent;
      if (o) this.bones.push([o.name, j]);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.bones.length * 6), 3));
    const colors = new Float32Array(this.bones.length * 6);
    this.bones.forEach(([, child], i) => {
      const c = /R$/.test(child) ? [0.94, 0.49, 0.34] : /L$/.test(child) ? [0.45, 0.94, 0.97] : [1, 0.8, 0.46];
      colors.set([...c, ...c], i * 6);
    });
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    this.skeleton = new LineSegments(geo, new LineBasicNodeMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.skeleton.renderOrder = 10;
    this.skeleton.frustumCulled = false;
    ctx.scene.add(this.skeleton);

    this.compileAll(this.defs);
    const p = new URLSearchParams(location.search);
    this.select(p.get('clip') ?? 'Idle');
    if (p.get('frame')) this.seek(Number(p.get('frame')));
    if (p.get('paused') === '1') this.playing = false;
    if (Number(p.get('speed')) > 0) this.speed = Number(p.get('speed'));
  }

  compileAll(defs: readonly ClipDef[]): void {
    this.defs = defs;
    this.clips.clear();
    this.reports.clear();
    for (const d of defs) this.clips.set(d.name, compileClip(d, this.rig, this.rest));
    if (this.action) this.select(this.clips.has(this.clipName) ? this.clipName : 'Idle', true);
  }

  get def(): ClipDef {
    return this.defs.find((d) => d.name === this.clipName)!;
  }

  select(name: string, keepFrame = false): void {
    const clip = this.clips.get(name) ?? this.clips.get('Idle')!;
    this.clipName = clip.name;
    this.action?.stop();
    this.mixer.uncacheRoot(this.model);
    this.action = this.mixer.clipAction(clip);
    this.action.setLoop(LoopRepeat, Infinity).play();
    if (!keepFrame) this.frame = 0;
    this.seek(Math.min(this.frame, this.def.frames));
    this.played = this.frame;
    this.onChange?.();
  }

  seek(frame: number): void {
    const def = this.def;
    this.frame = def.loop ? ((frame % def.frames) + def.frames) % def.frames : Math.min(Math.max(frame, 0), def.frames);
    this.mixer.setTime(Math.min(this.frame, def.frames - 1e-4) / this.rig.fps);
  }

  report(name = this.clipName): ClipReport {
    let r = this.reports.get(name);
    if (!r) {
      const def = this.defs.find((d) => d.name === name)!;
      r = analyzeClip(this.probe, this.rig, def, this.clips.get(name)!);
      this.reports.set(name, r);
    }
    return r;
  }

  sheet(name = this.clipName, options: Parameters<typeof renderSheet>[4] = {}): SheetImage {
    const def = this.defs.find((d) => d.name === name)!;
    return renderSheet(this.probe, this.rig, def, this.clips.get(name)!, { report: this.report(name), ...options });
  }

  update(_ctx: GameContext, dt: number): void {
    if (!this.action) return;
    if (this.playing) {
      const step = dt * this.rig.fps * this.speed;
      const next = this.frame + step;
      if (!this.def.loop && next >= this.def.frames) {
        this.seek(0);
        this.played = 0;
      } else {
        this.seek(next);
        this.played += step;
      }
    }
    // Treadmill: the floor grid scrolls at the clip's ground speed (continuously across
    // loops), so planted feet stick to the grid lines.
    const travel = this.treadmill ? ((this.def.speed ?? 0) * this.played) / this.rig.fps : 0;
    this.grid.position.z = -(((travel % 0.5) + 0.5) % 0.5);
    this.model.updateMatrixWorld(true);
    const pos = this.skeleton.geometry.getAttribute('position') as BufferAttribute;
    const a = new Vector3();
    const b = new Vector3();
    this.bones.forEach(([p, c], i) => {
      this.model.getObjectByName(p)!.getWorldPosition(a);
      this.model.getObjectByName(c)!.getWorldPosition(b);
      pos.setXYZ(i * 2, a.x, a.y, a.z);
      pos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    });
    pos.needsUpdate = true;
    this.onChange?.();
  }

  cameraTarget(): Vector3 {
    return new Vector3(0, 0.8, 0);
  }

  status(): string {
    return `${this.clipName} f${this.frame.toFixed(1)}`;
  }

  listen(fn: () => void): void {
    this.onChange = fn;
  }
}

// ---------------------------------------------------------------- UI

function ui(engine: Engine, lab: AnimationLab): void {
  const panel = document.createElement('div');
  panel.className = 'lab-panel';
  panel.innerHTML = `
    <h1>Animation Lab</h1>
    <label>Clip <select data-a="clip"></select></label>
    <div class="row">
      <button data-a="play">⏸</button>
      <button data-a="prev" title="previous frame (,)">◀</button>
      <button data-a="next" title="next frame (.)">▶</button>
      <select data-a="speed">
        <option value="0.1">0.1×</option><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option>
      </select>
    </div>
    <input type="range" data-a="scrub" min="0" step="0.5" />
    <div class="readout" data-a="frame"></div>
    <div class="row views">
      <button data-v="side">Side</button><button data-v="front">Front</button><button data-v="three">3/4</button><button data-v="top">Top</button><button data-v="orbit">Orbit</button>
    </div>
    <div class="row">
      <label><input type="checkbox" data-a="skeleton" checked /> skeleton</label>
      <label><input type="checkbox" data-a="treadmill" checked /> treadmill</label>
      <button data-a="mode">Raw 3D</button>
    </div>
    <p class="notes" data-a="notes"></p>
    <pre class="metrics" data-a="metrics"></pre>
    <button data-a="sheet">Contact sheet</button>
    <p class="hint">Edit src/game/hero/animations.ts — it hot-reloads. <code>npm run anim -- check</code></p>`;
  document.body.appendChild(panel);
  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
  const clipSel = $<HTMLSelectElement>('[data-a="clip"]');
  const scrub = $<HTMLInputElement>('[data-a="scrub"]');
  const play = $<HTMLButtonElement>('[data-a="play"]');

  const fillClips = () => {
    clipSel.innerHTML = lab.defs.map((d) => `<option>${d.name}</option>`).join('');
    clipSel.value = lab.clipName;
  };
  fillClips();
  let shownClip = '';
  lab.listen(() => {
    const def = lab.def;
    scrub.max = String(def.frames);
    scrub.value = String(lab.frame);
    $('[data-a="frame"]').textContent = `frame ${lab.frame.toFixed(1)} / ${def.frames}  ·  ${(def.frames / lab.rig.fps).toFixed(2)} s  ·  ${def.loop ? 'loop' : 'once'}${def.speed ? `  ·  ${def.speed} m/s` : ''}`;
    play.textContent = lab.playing ? '⏸' : '▶︎';
    if (shownClip !== lab.clipName) {
      shownClip = lab.clipName;
      clipSel.value = lab.clipName;
      $('[data-a="notes"]').textContent = def.notes ?? '';
      const r = lab.report();
      const lines = [
        `sole min   ${(r.minSoleY * 100).toFixed(1)} cm (f${r.minSoleFrame})`,
        `foot slide ${r.footSlide.toFixed(2)} m/s`,
        `loop seam  ${def.loop ? `${r.loopSeam.toFixed(1)}°` : '—'}`,
        `pelvis y   ${r.pelvisY[0].toFixed(2)}..${r.pelvisY[1].toFixed(2)} m`,
        `fastest    ${r.maxAngularSpeed.joint} ${r.maxAngularSpeed.degPerSec.toFixed(0)}°/s`,
        ...r.problems.map((p) => `✗ ${p}`),
        ...r.warnings.map((w) => `· ${w}`),
      ];
      $('[data-a="metrics"]').textContent = lines.join('\n');
      $('[data-a="metrics"]').dataset.bad = String(r.problems.length > 0);
    }
  });

  clipSel.addEventListener('change', () => lab.select(clipSel.value));
  play.addEventListener('click', () => (lab.playing = !lab.playing));
  const step = (d: number) => {
    lab.playing = false;
    lab.seek(Math.round((lab.frame + d) * 2) / 2);
    lab.played = lab.frame;
  };
  // Buttons must not keep keyboard focus, or Space would press them as well.
  panel.addEventListener('click', (e) => (e.target instanceof HTMLButtonElement ? e.target.blur() : undefined));
  $('[data-a="prev"]').addEventListener('click', () => step(-1));
  $('[data-a="next"]').addEventListener('click', () => step(1));
  $<HTMLSelectElement>('[data-a="speed"]').addEventListener('change', (e) => (lab.speed = Number((e.target as HTMLSelectElement).value)));
  scrub.addEventListener('input', () => {
    lab.playing = false;
    lab.seek(Number(scrub.value));
    lab.played = lab.frame;
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v as View)));
  $<HTMLInputElement>('[data-a="skeleton"]').addEventListener('change', (e) => (lab.skeleton.visible = (e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('[data-a="treadmill"]').addEventListener('change', (e) => (lab.treadmill = (e.target as HTMLInputElement).checked));
  const mode = $<HTMLButtonElement>('[data-a="mode"]');
  mode.addEventListener('click', () => (mode.textContent = engine.toggleMode() === 'pixel' ? 'Raw 3D' : 'Pixel'));
  $('[data-a="sheet"]').addEventListener('click', () => showSheet(lab.sheet()));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
    if (e.key === ',') step(-1);
    if (e.key === '.') step(1);
    if (e.key === ' ') {
      e.preventDefault();
      lab.playing = !lab.playing;
    }
  });

  function setView(v: View) {
    engine.setCamera(VIEWS[v]);
    panel.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    const url = new URL(location.href);
    url.searchParams.set('view', v);
    url.searchParams.delete('camera');
    history.replaceState(null, '', url);
  }
  const view = new URLSearchParams(location.search).get('view') as View | null;
  setView(view && view in VIEWS ? view : 'three');

  import.meta.hot?.accept('../game/hero/animations', (mod) => {
    const clips = (mod as { HERO_CLIPS?: readonly ClipDef[] } | undefined)?.HERO_CLIPS;
    if (!clips) return;
    lab.compileAll(clips);
    shownClip = '';
    fillClips();
  });
}

function toCanvas(img: SheetImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

function showSheet(img: SheetImage): void {
  const modal = document.createElement('div');
  modal.className = 'lab-sheet';
  modal.title = 'click to close';
  modal.appendChild(toCanvas(img));
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

/** Handle for agents and tests: window.__ANIM_LAB__. */
export interface LabApi {
  clips(): string[];
  select(name: string): void;
  play(): void;
  pause(): void;
  seek(frame: number): void;
  state(): { clip: string; frame: number; frames: number; playing: boolean; speed: number };
  /** Authored joint rotations (deg) and world positions (m) at the current frame. */
  pose(): Record<string, { r: number[]; world: number[] }>;
  metrics(name?: string): ClipReport;
  /** Contact sheet PNG as a data URL. */
  sheet(name?: string): string;
  /** The rendered frame (current mode/filters) as a PNG data URL. */
  capture(): Promise<string>;
}

const container = document.getElementById('app')!;
const lab = new AnimationLab();
Engine.start(lab, { container, ...optionsFromUrl(), filters: [] })
  .then((engine) => {
    ui(engine, lab);
    const api: LabApi = {
      clips: () => lab.defs.map((d) => d.name),
      select: (n) => lab.select(n),
      play: () => void (lab.playing = true),
      pause: () => void (lab.playing = false),
      seek: (f) => {
        lab.playing = false;
        lab.seek(f);
        lab.played = lab.frame;
      },
      state: () => ({ clip: lab.clipName, frame: lab.frame, frames: lab.def.frames, playing: lab.playing, speed: lab.speed }),
      pose: () => {
        const authored = sampleClip(lab.def, lab.frame, lab.rig);
        lab.model.updateMatrixWorld(true);
        return Object.fromEntries(
          lab.rig.joints.map((j) => {
            const w = lab.model.getObjectByName(j)!.getWorldPosition(new Vector3());
            return [j, { r: authored[j]!.r.map((v) => +v.toFixed(1)), world: [w.x, w.y, w.z].map((v) => +v.toFixed(3)) }];
          }),
        );
      },
      metrics: (n) => lab.report(n),
      sheet: (n) => toCanvas(lab.sheet(n)).toDataURL('image/png'),
      capture: async () => {
        const f = await engine.renderer.capture();
        return toCanvas({ width: f.width, height: f.height, data: new Uint8ClampedArray(f.pixels) }).toDataURL('image/png');
      },
    };
    Object.assign(window, { __ANIM_LAB__: api, __PIXEL_ENGINE__: engine });
  })
  .catch((error: unknown) => {
    console.error(error);
    container.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
  });
