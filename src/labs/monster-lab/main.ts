import '../../style.css';
import '../../lab/lab.css';
import './monster-lab.css';
import {
  BufferAttribute,
  BufferGeometry,
  GridHelper,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
  Raycaster,
  Vector2,
  Vector3,
} from 'three/webgpu';
import { Engine, optionsFromUrl, renderSheet, toonMaterial, type CameraConfig, type Game, type GameContext } from '../../engine';
import type { SheetImage } from '../../engine/animation';
import { describeMod } from '../../riftlight/core/mods';
import { Rng } from '../../riftlight/core/rng';
import type { Rank } from '../../riftlight/core/scaling';
import {
  ARCHETYPES,
  buildMonster,
  crossover,
  generateGenome,
  genomeBudget,
  MonsterRuntime,
  mutate,
  partFits,
  PARTS,
  PLANS,
  renderPortrait,
  sanitize,
  THEME_COLOURS,
  validateGenome,
  type BuiltMonster,
  type Genome,
  type GenomeOptions,
  type Slot,
} from '../../riftlight/monsters';

/**
 * Monster Lab (/monster-lab.html): the Spore editor for Riftlight monsters. Pick a plan,
 * archetype, rank and theme; change the seed; drag gene sliders; swap parts per slot;
 * mutate, cross two genomes, or evolve a grid of 9 children and click one to keep it.
 * Play every clip, see the skeleton, spin the turntable, read stats, mods and budget,
 * export the genome JSON.
 *
 * URL: ?seed=7&plan=quadruped&archetype=charger&rank=rare&depth=5&tags=fire&clip=Bite
 * Agents: window.__MONSTER_LAB__ (see `MonsterLabApi`).
 */
interface Shown {
  genome: Genome;
  built: BuiltMonster;
  runtime: MonsterRuntime;
}

const RANKS: Rank[] = ['normal', 'magic', 'rare', 'boss'];

class MonsterLab implements Game {
  readonly name = 'Monster Lab';
  ctx!: GameContext;
  holder = new Group();
  current!: Shown;
  children: Shown[] = [];
  parentB: Genome | null = null;
  mode: 'single' | 'grid' = 'single';
  /** Grid spacing of the evolve view (m). */
  spacing = 2;
  seed: string | number = 1;
  options: GenomeOptions = {};
  clip = 'Idle';
  playing = true;
  turntable = false;
  skeleton!: LineSegments;
  skeletonOn = true;
  private bones: [string, string][] = [];
  private listeners: (() => void)[] = [];
  private evolveRng = new Rng('evolve');
  private generation = 0;

  setup(ctx: GameContext): void {
    this.ctx = ctx;
    const floor = new Mesh(new PlaneGeometry(60, 60).rotateX(-Math.PI / 2), toonMaterial(ctx.palette.night));
    floor.receiveShadow = true;
    ctx.scene.add(floor);
    const grid = new GridHelper(60, 60, 0x566c86, 0x333c57);
    grid.position.y = 0.003;
    ctx.scene.add(grid);
    ctx.scene.add(this.holder);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(600 * 6), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(600 * 6), 3));
    this.skeleton = new LineSegments(geo, new LineBasicNodeMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.skeleton.renderOrder = 10;
    this.skeleton.frustumCulled = false;
    ctx.scene.add(this.skeleton);
    const p = new URLSearchParams(location.search);
    const seed = p.get('seed');
    this.seed = seed === null ? 1 : /^\d+$/.test(seed) ? Number(seed) : seed;
    if (p.get('plan')) this.options.plan = p.get('plan')!;
    if (p.get('archetype')) this.options.archetype = p.get('archetype')!;
    if (p.get('rank')) this.options.rank = p.get('rank') as Rank;
    if (p.get('depth')) this.options.depth = Number(p.get('depth'));
    if (p.get('tags')) this.options.tags = p.get('tags')!.split(',');
    this.generate();
    if (p.get('clip')) this.play(p.get('clip')!);
  }

  // ------------------------------------------------------------- genomes

  generate(o: { seed?: string | number } & GenomeOptions = {}): Genome {
    const { seed, ...rest } = o;
    if (seed !== undefined) this.seed = seed;
    this.options = { ...this.options, ...rest };
    for (const k of Object.keys(this.options) as (keyof GenomeOptions)[]) if (this.options[k] === undefined || this.options[k] === '') delete this.options[k];
    const g = generateGenome(new Rng(this.seed), this.options);
    this.show(g);
    return g;
  }

  show(genome: Genome): void {
    this.clearGrid();
    if (this.current) this.release(this.current);
    this.current = this.make(genome);
    this.holder.add(this.current.built.object);
    this.mode = 'single';
    this.rebuildSkeleton();
    this.play(this.current.built.clipNames.includes(this.clip) ? this.clip : 'Idle');
    this.frame();
    this.changed();
  }

  setGene(name: string, value: number): void {
    const g = this.current.genome;
    this.show({ ...g, genes: { ...g.genes, [name]: Math.min(1, Math.max(0, value)) } });
  }

  setPart(slot: Slot, part: string | null): void {
    const g = this.current.genome;
    const parts = g.parts.filter((p) => p.socket !== slot);
    if (part) parts.push({ socket: slot, part });
    this.show(sanitize({ ...g, parts }));
  }

  mutate(amount = 0.35): Genome {
    const g = mutate(this.current.genome, this.evolveRng.fork(this.generation++), amount);
    this.show(g);
    return g;
  }

  storeParent(): void {
    this.parentB = this.current.genome;
    this.changed();
  }

  crossover(): Genome {
    const b = this.parentB ?? generateGenome(new Rng(`${this.seed}:mate`), this.options);
    const g = crossover(this.current.genome, b, this.evolveRng.fork(this.generation++));
    this.show(g);
    return g;
  }

  /** Nine children of the current genome (mutations, every third crossed with parent B). */
  evolve(amount = 0.4): Genome[] {
    const parent = this.current.genome;
    this.clearGrid();
    this.holder.remove(this.current.built.object);
    const rng = this.evolveRng.fork(this.generation++);
    const genomes = Array.from({ length: 9 }, (_, i) => {
      const r = rng.fork(i);
      const m = mutate(parent, r, amount);
      return this.parentB && i % 3 === 2 ? crossover(m, this.parentB, r.fork('x')) : m;
    });
    this.children = genomes.map((g) => this.make(g));
    const spacing = (this.spacing = Math.max(1.8, ...this.children.map((c) => c.built.radius * 2.6)));
    this.children.forEach((c, i) => {
      c.built.object.position.set(((i % 3) - 1) * spacing, 0, (Math.floor(i / 3) - 1) * spacing);
      c.runtime.play(c.built.clipNames.includes(this.clip) ? this.clip : 'Idle', { fade: 0 });
      this.holder.add(c.built.object);
    });
    this.mode = 'grid';
    this.skeleton.visible = false;
    this.frame();
    this.changed();
    return genomes;
  }

  /** Keep child i (grid mode) as the current monster. */
  select(i: number): Genome {
    const child = this.children[i];
    if (!child) throw new Error(`no child ${i}`);
    const g = child.genome;
    this.show(g);
    return g;
  }

  private make(genome: Genome): Shown {
    const built = buildMonster(genome);
    return { genome, built, runtime: new MonsterRuntime(built) };
  }

  private release(s: Shown): void {
    s.runtime.dispose();
    s.built.object.removeFromParent();
  }

  private clearGrid(): void {
    for (const c of this.children) this.release(c);
    this.children = [];
  }

  // ------------------------------------------------------------- playback

  play(name: string): void {
    const all = [this.current, ...this.children];
    if (!this.current.built.clipNames.includes(name)) return;
    this.clip = name;
    for (const s of all) if (s.built.clipNames.includes(name)) s.runtime.play(name, { fade: 0, restart: true });
    this.playing = true;
    this.changed();
  }

  /** Current frame of the current clip (30 fps). */
  get frameNo(): number {
    const clip = this.current.built.clip(this.clip);
    const a = clip && this.current.runtime.mixer.existingAction(clip);
    return a ? a.time * 30 : 0;
  }

  seek(frame: number): void {
    this.playing = false;
    for (const s of [this.current, ...this.children]) {
      const clip = s.built.clip(this.clip);
      const a = clip && s.runtime.mixer.existingAction(clip);
      if (!a) continue;
      a.paused = false;
      a.time = Math.max(0, Math.min(frame / 30, clip!.duration - 1e-4));
      s.runtime.mixer.update(0);
    }
    this.changed();
  }

  update(_ctx: GameContext, dt: number): void {
    const step = this.playing ? dt : 0;
    for (const s of this.mode === 'grid' ? this.children : [this.current]) {
      const events = s.runtime.update(step, {});
      // one-shot clips loop in the lab after a short beat
      if (events.some((e) => e.type === 'end') && s.built.clipInfo(this.clip)?.kind !== 'idle') setTimeout(() => s.runtime.play(this.clip, { fade: 0, restart: true }), 400);
    }
    if (this.turntable) this.holder.rotation.y += dt * 0.6;
    this.updateSkeleton();
  }

  cameraTarget(): Vector3 {
    return new Vector3(0, 0.6, 0);
  }

  status(): string {
    return `${this.current.genome.plan} ${this.clip} f${this.frameNo.toFixed(1)}`;
  }

  // ------------------------------------------------------------- view

  frame(): void {
    const grid = this.mode === 'grid';
    const h = grid ? Math.max(...this.children.map((c) => c.built.height)) : this.current.built.height;
    const r = this.current.built.radius;
    // grid: fit the 3×3 spacing (30° fov → ~3.7 m tall per 7 m away), single: the monster
    const d = grid ? Math.max(6, this.spacing * 5.2, h * 3) : Math.max(3.2, h * 2.6, r * 3.4);
    const cam: CameraConfig = { preset: 'fixed', projection: 'perspective', fov: 30, position: [d * 0.62, h * 0.55 + d * 0.42, d * 0.78], target: [0, h * 0.42, 0] };
    this.ctx.engine.setCamera(cam);
  }

  private rebuildSkeleton(): void {
    const rig = this.current.built.rig;
    const obj = this.current.built.object;
    this.bones = [];
    for (const j of rig.joints) {
      let o = obj.getObjectByName(j)!.parent;
      while (o && !rig.joints.includes(o.name)) o = o.parent;
      if (o && o !== obj) this.bones.push([o.name, j]);
    }
    const colors = this.skeleton.geometry.getAttribute('color') as BufferAttribute;
    this.bones.forEach(([, child], i) => {
      const c = /R$/.test(child) ? [0.94, 0.49, 0.34] : /L$/.test(child) ? [0.45, 0.94, 0.97] : [1, 0.8, 0.46];
      colors.set([...c, ...c], i * 6);
    });
    colors.needsUpdate = true;
    this.skeleton.geometry.setDrawRange(0, this.bones.length * 2);
    this.skeleton.visible = this.skeletonOn;
  }

  private updateSkeleton(): void {
    if (this.mode !== 'single' || !this.skeleton.visible) return;
    const obj = this.current.built.object;
    obj.updateMatrixWorld(true);
    const pos = this.skeleton.geometry.getAttribute('position') as BufferAttribute;
    const a = new Vector3();
    const b = new Vector3();
    this.bones.forEach(([p, c], i) => {
      obj.getObjectByName(p)!.getWorldPosition(a);
      obj.getObjectByName(c)!.getWorldPosition(b);
      pos.setXYZ(i * 2, a.x, a.y, a.z);
      pos.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    });
    pos.needsUpdate = true;
  }

  setSkeleton(on: boolean): void {
    this.skeletonOn = on;
    this.skeleton.visible = on && this.mode === 'single';
  }

  /** Grid mode: the child under a canvas point (client coordinates), or -1. */
  pick(clientX: number, clientY: number): number {
    const canvas = this.ctx.engine.renderer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.ctx.camera.camera);
    let best = -1;
    let dist = Infinity;
    this.children.forEach((c, i) => {
      const hit = ray.intersectObject(c.built.object, true)[0];
      if (hit && hit.distance < dist) {
        dist = hit.distance;
        best = i;
      }
    });
    return best;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  changed(): void {
    for (const fn of this.listeners) fn();
  }

  sheet(name = this.clip): SheetImage {
    const probe = buildMonster(this.current.genome);
    probe.object.scale.setScalar(1);
    const def = probe.clipDef(name) ?? probe.clipDef('Idle')!;
    return renderSheet(probe.object, probe.rig, def, probe.clip(def.name)!, { views: ['side', 'three'], trails: !!def.loop });
  }

  portrait(): SheetImage {
    const probe = buildMonster(this.current.genome);
    probe.object.scale.setScalar(1);
    return renderPortrait(probe.object, { width: 240, height: 240, skeleton: probe.rig.joints });
  }
}

// ---------------------------------------------------------------- UI

function ui(engine: Engine, lab: MonsterLab): void {
  const panel = document.createElement('div');
  panel.className = 'lab-panel mlab';
  const opt = (v: string, label = v) => `<option value="${v}">${label}</option>`;
  panel.innerHTML = `
    <h1>Monster Lab</h1>
    <div class="grid2">
      <label>Plan <select data-a="plan">${opt('', 'any')}${PLANS.all().map((p) => opt(p.id, p.name)).join('')}</select></label>
      <label>Archetype <select data-a="archetype">${opt('', 'any')}${ARCHETYPES.all().map((a) => opt(a.id, a.name)).join('')}</select></label>
      <label>Rank <select data-a="rank">${RANKS.map((r) => opt(r)).join('')}</select></label>
      <label>Theme <select data-a="tags">${opt('', 'random')}${Object.keys(THEME_COLOURS).map((t) => opt(t)).join('')}</select></label>
      <label>Seed <input data-a="seed" size="8" /></label>
      <label>Depth <input data-a="depth" type="number" min="1" max="99" value="1" /></label>
    </div>
    <div class="row"><button data-a="gen">Generate</button><button data-a="dice" title="random seed">🎲</button><button data-a="export">Export JSON</button></div>
    <div class="row"><button data-a="mutate">Mutate</button><input data-a="amount" type="range" min="0.05" max="1" step="0.05" value="0.35" title="mutation amount" /></div>
    <div class="row"><button data-a="parent">Store as parent B</button><button data-a="cross">Crossover A×B</button><button data-a="evolve">Evolve 9</button></div>
    <div class="kids" data-a="kids"></div>
    <div class="row"><select data-a="clip"></select><button data-a="play">⏸</button><button data-a="prev">◀</button><button data-a="next">▶</button></div>
    <div class="readout" data-a="frame"></div>
    <div class="row">
      <label><input type="checkbox" data-a="skeleton" checked /> skeleton</label>
      <label><input type="checkbox" data-a="turntable" /> turntable</label>
      <button data-a="mode">Raw 3D</button><button data-a="sheet">Sheet</button>
    </div>
    <h2>Genes</h2><div data-a="genes"></div>
    <h2>Parts</h2><div data-a="parts"></div>
    <h2>Stats</h2><pre class="metrics" data-a="stats"></pre>
    <textarea data-a="json" rows="5" spellcheck="false"></textarea>
    <div class="row"><button data-a="import">Import JSON</button><button data-a="download">Download</button></div>`;
  document.body.appendChild(panel);
  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(`[data-a="${sel}"]`)!;
  panel.addEventListener('click', (e) => (e.target instanceof HTMLButtonElement ? e.target.blur() : undefined));
  const sel = (k: string) => $<HTMLSelectElement>(k);
  const genOpts = () => ({
    plan: sel('plan').value || undefined,
    archetype: sel('archetype').value || undefined,
    rank: sel('rank').value as Rank,
    tags: sel('tags').value ? [sel('tags').value] : undefined,
    depth: Number($<HTMLInputElement>('depth').value) || 1,
  });
  const regen = () => lab.generate({ seed: parseSeed($<HTMLInputElement>('seed').value), ...genOpts() });
  for (const k of ['plan', 'archetype', 'rank', 'tags']) sel(k).addEventListener('change', regen);
  $('depth').addEventListener('change', regen);
  $('seed').addEventListener('change', regen);
  $('gen').addEventListener('click', regen);
  $('dice').addEventListener('click', () => {
    $<HTMLInputElement>('seed').value = String(Math.floor(Math.random() * 1e6));
    regen();
  });
  $('mutate').addEventListener('click', () => lab.mutate(Number($<HTMLInputElement>('amount').value)));
  $('parent').addEventListener('click', () => lab.storeParent());
  $('cross').addEventListener('click', () => lab.crossover());
  $('evolve').addEventListener('click', () => lab.evolve(Number($<HTMLInputElement>('amount').value)));
  $('clip').addEventListener('change', () => lab.play(sel('clip').value));
  $('play').addEventListener('click', () => {
    lab.playing = !lab.playing;
    lab.changed();
  });
  $('prev').addEventListener('click', () => lab.seek(Math.round(lab.frameNo) - 1));
  $('next').addEventListener('click', () => lab.seek(Math.round(lab.frameNo) + 1));
  $('skeleton').addEventListener('change', (e) => lab.setSkeleton((e.target as HTMLInputElement).checked));
  $('turntable').addEventListener('change', (e) => (lab.turntable = (e.target as HTMLInputElement).checked));
  $('mode').addEventListener('click', (e) => ((e.target as HTMLButtonElement).textContent = engine.toggleMode() === 'pixel' ? 'Raw 3D' : 'Pixel'));
  $('sheet').addEventListener('click', () => showImage(lab.sheet()));
  $('export').addEventListener('click', () => ($<HTMLTextAreaElement>('json').value = JSON.stringify(lab.current.genome, null, 1)));
  $('import').addEventListener('click', () => {
    try {
      const g = JSON.parse($<HTMLTextAreaElement>('json').value) as Genome;
      const errors = validateGenome(g);
      if (errors.length) throw new Error(errors.join('; '));
      lab.show(g);
    } catch (err) {
      $('stats').textContent = `import failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
  $('download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(lab.current.genome, null, 2)], { type: 'application/json' }));
    a.download = `monster-${lab.current.genome.plan}-${lab.current.genome.seed}.json`;
    a.click();
  });
  document.getElementById('app')!.addEventListener('pointerdown', (e: PointerEvent) => {
    if (lab.mode !== 'grid') return;
    const i = lab.pick(e.clientX, e.clientY);
    if (i >= 0) lab.select(i);
  });

  let shownGenome: Genome | null = null;
  const refresh = () => {
    const g = lab.current.genome;
    const m = lab.current.built;
    $<HTMLInputElement>('seed').value = String(lab.seed);
    sel('plan').value = lab.options.plan ?? '';
    sel('archetype').value = lab.options.archetype ?? '';
    sel('rank').value = lab.options.rank ?? 'normal';
    sel('tags').value = lab.options.tags?.[0] ?? '';
    const clips = m.clipNames;
    if (sel('clip').dataset.list !== clips.join()) {
      sel('clip').innerHTML = clips.map((c) => opt(c, `${c}${m.clipInfo(c)!.hitFrame !== null ? ` (hit f${m.clipInfo(c)!.hitFrame})` : ''}`)).join('');
      sel('clip').dataset.list = clips.join();
    }
    sel('clip').value = lab.clip;
    $('play').textContent = lab.playing ? '⏸' : '▶︎';
    $('kids').innerHTML = lab.mode === 'grid' ? lab.children.map((c, i) => `<button data-kid="${i}">${i + 1} ${c.genome.plan}</button>`).join('') : '';
    panel.querySelectorAll<HTMLButtonElement>('[data-kid]').forEach((b) => b.addEventListener('click', () => lab.select(Number(b.dataset.kid))));
    if (shownGenome === g) return;
    shownGenome = g;
    // genes
    const plan = PLANS.get(g.plan);
    const names = [...new Set([...Object.keys(plan.genes), 'wingSpan'])];
    $('genes').innerHTML = names.map((n) => `<label class="gene">${n}<input type="range" min="0" max="1" step="0.01" value="${g.genes[n] ?? 0.5}" data-gene="${n}" /><span>${(g.genes[n] ?? 0.5).toFixed(2)}</span></label>`).join('');
    panel.querySelectorAll<HTMLInputElement>('[data-gene]').forEach((input) => input.addEventListener('change', () => lab.setGene(input.dataset.gene!, Number(input.value))));
    // parts
    const slots = Object.keys(plan.slots) as Slot[];
    $('parts').innerHTML = slots
      .map((s) => {
        const cur = g.parts.find((p) => p.socket === s)?.part ?? '';
        const options = PARTS.all().filter((p) => partFits(p, s, g.plan));
        return `<label class="part">${s}<select data-slot="${s}">${opt('', '—')}${options.map((p) => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${p.name} (${p.cost ?? 1})</option>`).join('')}</select></label>`;
      })
      .join('');
    panel.querySelectorAll<HTMLSelectElement>('[data-slot]').forEach((s) => s.addEventListener('change', () => lab.setPart(s.dataset.slot as Slot, s.value || null)));
    // stats
    const budget = genomeBudget(lab.options.depth ?? 1, g.rank);
    $('stats').textContent = [
      `${plan.name} · ${ARCHETYPES.get(g.archetype).name} · ${g.rank}  scale ${g.scale}`,
      `budget ${m.cost} / ${budget.toFixed(1)}  ·  ${m.rig.joints.length} joints  ·  built in ${m.ms.toFixed(1)} ms`,
      `skills: ${m.skills.join(', ')}`,
      `elite: ${g.elite.join(', ') || '—'}`,
      `parent B: ${lab.parentB ? `${lab.parentB.plan} #${lab.parentB.seed}` : '— (crossover uses a fresh mate)'}`,
      ...m.stats.map((s) => `· ${describeMod(s)}`),
    ].join('\n');
    $<HTMLTextAreaElement>('json').value = JSON.stringify(g);
  };
  lab.onChange(refresh);
  refresh();
  setInterval(() => ($('frame').textContent = `${lab.clip} f${lab.frameNo.toFixed(1)}${lab.playing ? '' : ' (paused)'}`), 100);
}

function parseSeed(s: string): string | number {
  return /^\d+$/.test(s.trim()) ? Number(s) : s.trim() || 1;
}

function toCanvas(img: SheetImage): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}

function showImage(img: SheetImage): void {
  const modal = document.createElement('div');
  modal.className = 'lab-sheet';
  modal.title = 'click to close';
  modal.appendChild(toCanvas(img));
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

/** Handle for agents and tests: window.__MONSTER_LAB__. */
export interface MonsterLabApi {
  plans(): string[];
  archetypes(): string[];
  /** Generate from a seed and options (plan, archetype, rank, depth, tags). */
  generate(o?: { seed?: string | number } & GenomeOptions): Genome;
  genome(): Genome;
  show(g: Genome): void;
  setGene(name: string, value: number): void;
  setPart(slot: Slot, part: string | null): void;
  mutate(amount?: number): Genome;
  storeParent(): void;
  crossover(): Genome;
  evolve(amount?: number): Genome[];
  select(i: number): Genome;
  clips(): string[];
  play(name: string): void;
  pause(): void;
  seek(frame: number): void;
  setSkeleton(on: boolean): void;
  setTurntable(on: boolean): void;
  state(): { mode: string; plan: string; archetype: string; rank: string; clip: string; frame: number; playing: boolean; children: number; joints: number; cost: number; skills: readonly string[] };
  /** Stats (mods as text), skills, clip metadata (hit frames). */
  stats(): { mods: string[]; skills: readonly string[]; clips: unknown; cost: number; ms: number };
  exportGenome(): string;
  /** Contact sheet / portrait PNG data URLs (software renders). */
  sheet(clip?: string): string;
  portrait(): string;
  /** The rendered frame as a PNG data URL. */
  capture(): Promise<string>;
}

const container = document.getElementById('app')!;
const lab = new MonsterLab();
Engine.start(lab, { container, ...optionsFromUrl(), filters: [] })
  .then((engine) => {
    ui(engine, lab);
    const api: MonsterLabApi = {
      plans: () => PLANS.all().map((p) => p.id),
      archetypes: () => ARCHETYPES.all().map((a) => a.id),
      generate: (o) => lab.generate(o ?? {}),
      genome: () => lab.current.genome,
      show: (g) => lab.show(g),
      setGene: (n, v) => lab.setGene(n, v),
      setPart: (s, p) => lab.setPart(s, p),
      mutate: (a) => lab.mutate(a),
      storeParent: () => lab.storeParent(),
      crossover: () => lab.crossover(),
      evolve: (a) => lab.evolve(a),
      select: (i) => lab.select(i),
      clips: () => [...lab.current.built.clipNames],
      play: (n) => lab.play(n),
      pause: () => {
        lab.playing = false;
        lab.changed();
      },
      seek: (f) => lab.seek(f),
      setSkeleton: (on) => lab.setSkeleton(on),
      setTurntable: (on) => void (lab.turntable = on),
      state: () => ({
        mode: lab.mode,
        plan: lab.current.genome.plan,
        archetype: lab.current.genome.archetype,
        rank: lab.current.genome.rank,
        clip: lab.clip,
        frame: lab.frameNo,
        playing: lab.playing,
        children: lab.children.length,
        joints: lab.current.built.rig.joints.length,
        cost: lab.current.built.cost,
        skills: lab.current.built.skills,
      }),
      stats: () => ({ mods: lab.current.built.stats.map((m) => describeMod(m)), skills: lab.current.built.skills, clips: lab.current.built.meta, cost: lab.current.built.cost, ms: lab.current.built.ms }),
      exportGenome: () => JSON.stringify(lab.current.genome),
      sheet: (c) => toCanvas(lab.sheet(c)).toDataURL('image/png'),
      portrait: () => toCanvas(lab.portrait()).toDataURL('image/png'),
      capture: async () => {
        const f = await engine.renderer.capture();
        return toCanvas({ width: f.width, height: f.height, data: new Uint8ClampedArray(f.pixels) }).toDataURL('image/png');
      },
    };
    Object.assign(window, { __MONSTER_LAB__: api, __PIXEL_ENGINE__: engine });
  })
  .catch((error: unknown) => {
    console.error(error);
    container.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
  });
