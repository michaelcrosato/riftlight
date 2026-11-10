/**
 * The Hall of Beasts: every species the hero has killed (`save.showcase.bestiary`), rebuilt
 * from its genome on a pedestal under its own light, in a dark gallery built 1 km east of
 * town. It is the Spore generator's window inside the game:
 *
 *   walk     the `first` preset: WASD, mouse (click to lock) or Q/E to look; the hero is a
 *            `PlatformerCharacter` (Space still jumps). Tab: fly with the `free` camera.
 *   inspect  F at a pedestal: an orbit camera (the `fixed` preset, moved by hand: drag or
 *            Q/E to circle, wheel to zoom), the card (name, rank, plan, archetype, parts,
 *            kills, depths), a button per clip, the turntable.
 *   breed    F at the Rift Altar: pick two parents, BREED (the generator's `crossover` +
 *            `mutate`) and the child grows on the vat; MUTATE it again.
 *
 * Leaving: walk back out of the door, or Esc.
 */
import { Color, type Object3D, Vector3 } from 'three/webgpu';
import { type CameraConfig, FirstPersonRig, FreeRig, type LightHandle, PALETTE, type PaletteColor, readMoveInput, wrapText } from '../../../engine';
import { setLookLayer } from '../../../engine/render/lookLayer';
import { Rng } from '../../core/rng';
import type { Genome } from '../../core/types';
import { lang, lineKey, t } from '../../lang';
import { archetypeName, bossNameShown, partName, planName } from '../../lang/monsters';
import { buildMonster, type BuiltMonster, crossover, MonsterRuntime, mutate, validateGenome } from '../../monsters';
import type { UiCanvas, UiEvent, Rect } from '../../ui/kit';
import { clip, inside, miniCovers, miniWidth, wrap } from '../../ui/kit';
import { monsterName } from '../../wire/monsters';
import { hints, miniHints } from '../hints';
import { type BestiaryEntry, exhibitOrder, showcaseOf } from '../save';
import type { Showcase, ShowcaseMode } from '../Showcase';
import { moveInput, Visitor } from '../visitor';
import { Hall, HALL, HALL_SONG, type Pedestal } from './hall';

/** Where the hall is built: far east of the town. */
export const HALL_ORIGIN = new Vector3(1000, 0, 0);
/** Exhibits per wing (one per pedestal). */
export const PER_WING = HALL.perSide * 2;

export type BestiaryView = 'walk' | 'fly' | 'inspect' | 'breed';

/** One monster on show: built from its genome, animated, lit. */
export interface Exhibit {
  readonly entry: BestiaryEntry | null;
  readonly genome: Genome;
  readonly built: BuiltMonster;
  readonly runtime: MonsterRuntime;
  readonly at: Vector3;
  readonly yaw: number;
  /** Display scale (fits the pedestal). */
  readonly fit: number;
  clip: string;
  back: number;
  light: LightHandle | null;
}

interface Button {
  id: string;
  label: string;
  act: () => void;
  /** Choice rows: left / right; `label` is the choice, drawn between arrows. */
  step?: (dir: 1 | -1) => void;
  accent?: PaletteColor;
}

const RANK_COLOR: Record<string, PaletteColor> = { normal: 'white', magic: 'sky', rare: 'sand', boss: 'orange' };
/** The card's width: 150, wider (to 220) for buttons a longer language or a long name needs. */
const CARD_W = 150;
const CARD_MAX = 220;

/**
 * An exhibit's name in the player's language: a monster's from its genome (its words are lines),
 * a boss's from the English name the save keeps (`bossNameShown`).
 */
export function entryName(e: Pick<BestiaryEntry, 'name' | 'rank' | 'genome'>): string {
  return e.rank === 'boss' ? bossNameShown(e.name) : monsterName(e.genome);
}

/** A monster animation's name for its button (`showcase.bestiary.clip.<clip>`); an unknown clip shows its name. */
function clipName(clip: string): string {
  const id = lineKey('showcase.bestiary.clip', clip);
  return lang().has(id) ? t(id) : clip;
}

/** Depths an entry was killed at: one, or first to last (`showcase.bestiary.<line>` / `<line>_range`). */
function depthLine(line: 'plaque' | 'kills_depth', e: Pick<BestiaryEntry, 'kills' | 'first' | 'last'>): string {
  const values = { kills: e.kills, first: e.first, last: e.last };
  return e.last !== e.first ? t(`showcase.bestiary.${line}_range`, values) : t(`showcase.bestiary.${line}`, values);
}

export class BestiaryMode implements ShowcaseMode {
  readonly id = 'bestiary' as const;
  readonly filters = null;
  wantsLeave = false;
  hall: Hall | null = null;
  view: BestiaryView = 'walk';
  page = 0;
  exhibits: Exhibit[] = [];
  /** The exhibit being inspected. */
  focus: Exhibit | null = null;
  turntable = true;
  /** The altar: chosen parents (bestiary indices) and the child on the vat. */
  readonly altar = { a: 0, b: 1, child: null as Exhibit | null, parents: [null, null] as (Exhibit | null)[], generation: 0 };
  private visitor: Visitor | null = null;
  private lights: LightHandle[] = [];
  private readonly input = moveInput();
  private readonly orbit = { target: new Vector3(), yaw: 0, pitch: 0.25, dist: 4.5 };
  private buttons: Button[] = [];
  private rects = new Map<string, Rect>();
  private cursor = 0;
  private readonly target = new Vector3();
  private readonly tmp = new Vector3();
  private time = 0;
  private wasLocked = false;
  private readonly dark = new Color(PALETTE.ink);

  constructor(private readonly host: Showcase) {}

  get entries(): BestiaryEntry[] {
    return exhibitOrder(showcaseOf(this.host.game.save).bestiary);
  }

  get wings(): number {
    return Math.max(1, Math.ceil(this.entries.length / PER_WING));
  }

  camera(): CameraConfig {
    if (this.view === 'fly') return { preset: 'free', fov: 60 };
    if (this.view === 'inspect' || this.view === 'breed') return this.orbitConfig();
    return { preset: 'first', fov: 70 };
  }

  // ------------------------------------------------------------------ enter / leave

  async enter(): Promise<void> {
    const ctx = this.host.ctx;
    this.wantsLeave = false;
    this.view = 'walk';
    this.focus = null;
    this.page = Math.min(this.page, this.wings - 1);
    const hall = new Hall(HALL_ORIGIN);
    hall.build(ctx.physics);
    this.hall = hall;
    ctx.scene.add(hall.root);
    this.visitor ??= await Visitor.load(ctx);
    const v = this.visitor;
    hall.root.add(v.model, v.shadow);
    v.spawn(ctx.physics, hall.at(...HALL.spawn).toArray() as [number, number, number], { facing: Math.PI });
    this.fillWing();
    this.buildAltar();
    // the hall is dark: no sun, a cold low ambient, the pool's lights do the rest
    const e = ctx.engine;
    e.sun.intensity = 0.12;
    e.ambient.color.setHex(PALETTE.navy);
    e.ambient.intensity = 0.95;
    ctx.scene.background = this.dark;
    this.lights.push(...hall.lamps.map((p) => ctx.lights.request({ position: p, color: PALETTE.orange, intensity: 6, radius: 6, flicker: 'torch', name: 'hall-lamp' })));
    this.lights.push(ctx.lights.request({ position: hall.altar.light, color: PALETTE.cyan, intensity: 10, radius: 8, flicker: 'pulse', name: 'altar' }));
    ctx.audio.playMusic(HALL_SONG, 'showcase:bestiary');
  }

  leave(): void {
    const ctx = this.host.ctx;
    this.clearExhibits();
    this.clearAltar();
    for (const l of this.lights) l.release();
    this.lights = [];
    this.visitor?.despawn();
    this.visitor?.model.removeFromParent();
    this.visitor?.shadow.removeFromParent();
    this.hall?.dispose(ctx.physics);
    this.hall = null;
    this.focus = null;
    this.wantsLeave = false;
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.(); // headless: no page
  }

  // ------------------------------------------------------------------ exhibits

  /** Build the current wing's exhibits on the pedestals (and light them). */
  fillWing(): void {
    this.clearExhibits();
    const hall = this.hall;
    if (!hall) return;
    const list = this.entries.slice(this.page * PER_WING, (this.page + 1) * PER_WING);
    // nearest pedestals first, alternating sides
    list.forEach((entry, i) => {
      const ped = hall.pedestals[i]!;
      const ex = this.makeExhibit(entry.genome, ped.top, ped.yaw, entry.rank === 'boss' ? 2.4 : 1.7, entry);
      ex.light = this.host.ctx.lights.request({ position: ped.light, color: lightColor(entry.genome), intensity: 12, radius: 6.5, decay: 1.4, name: `exhibit:${entry.key}` });
      this.exhibits.push(ex);
    });
  }

  private makeExhibit(genome: Genome, at: Vector3, yaw: number, maxHeight: number, entry: BestiaryEntry | null): Exhibit {
    const built = buildMonster(genome);
    const runtime = new MonsterRuntime(built);
    const fit = Math.min(1, maxHeight / Math.max(0.2, built.height), 2.2 / Math.max(0.2, built.radius * 2));
    built.object.scale.multiplyScalar(fit);
    built.object.position.copy(at);
    built.object.rotation.y = yaw;
    setLookLayer(built.object, 'actors');
    this.hall!.root.add(built.object);
    runtime.play('Idle', { fade: 0 });
    return { entry, genome, built, runtime, at: at.clone(), yaw, fit, clip: 'Idle', back: 0, light: null };
  }

  private release(ex: Exhibit): void {
    ex.runtime.dispose();
    ex.built.object.removeFromParent();
    ex.light?.release();
  }

  private clearExhibits(): void {
    for (const ex of this.exhibits) this.release(ex);
    this.exhibits = [];
  }

  /** Next / previous wing (more than ten species). */
  turnWing(dir: 1 | -1): void {
    this.page = (this.page + dir + this.wings) % this.wings;
    this.fillWing();
    this.host.ctx.audio.play('rl.open');
  }

  /** Play a clip on an exhibit (one-shots go back to Idle after a beat). */
  play(ex: Exhibit, clip: string): boolean {
    if (!ex.built.clipNames.includes(clip)) return false;
    ex.runtime.play(clip, { fade: 0.12, restart: true });
    ex.clip = clip;
    ex.back = 0;
    return true;
  }

  // ------------------------------------------------------------------ the altar

  private buildAltar(): void {
    this.clearAltar();
    const list = this.entries;
    if (!list.length || !this.hall) return;
    const alt = this.altar;
    alt.a = Math.min(alt.a, list.length - 1);
    alt.b = Math.min(alt.b, list.length - 1);
    for (const k of [0, 1] as const) {
      const e = list[k === 0 ? alt.a : alt.b]!;
      const p = this.hall.altar.parents[k];
      alt.parents[k] = this.makeExhibit(e.genome, p, k === 0 ? Math.PI * 0.15 : -Math.PI * 0.15, 1.1, e);
    }
  }

  private clearAltar(): void {
    for (const p of this.altar.parents) if (p) this.release(p);
    this.altar.parents = [null, null];
    if (this.altar.child) this.release(this.altar.child);
    this.altar.child = null;
  }

  /** Cross the two chosen parents (and mutate a little): the child grows on the vat. */
  breed(): Genome | null {
    const list = this.entries;
    if (!list.length || !this.hall) return null;
    const sc = showcaseOf(this.host.game.save);
    const rng = new Rng(this.host.game.save.seed).fork('breed').fork(sc.bred++);
    const a = list[this.altar.a]!.genome;
    const b = list[this.altar.b]!.genome;
    let child = mutate(crossover(a, b, rng), rng.fork('mutate'), 0.25);
    if (validateGenome(child).length) child = a;
    this.altar.generation = 1;
    this.showChild(child);
    return child;
  }

  /** Mutate the child on the vat once more. */
  mutateChild(amount = 0.35): Genome | null {
    const c = this.altar.child;
    if (!c) return this.breed();
    const sc = showcaseOf(this.host.game.save);
    let g = mutate(c.genome, new Rng(this.host.game.save.seed).fork('mutate').fork(sc.bred++), amount);
    if (validateGenome(g).length) g = c.genome;
    this.altar.generation++;
    this.showChild(g);
    return g;
  }

  private showChild(g: Genome): void {
    const hall = this.hall!;
    if (this.altar.child) this.release(this.altar.child);
    this.altar.child = this.makeExhibit({ ...g, rank: g.rank === 'boss' ? 'rare' : g.rank }, hall.altar.child, 0, 2.0, null);
    this.altar.child.runtime.play('Spawn', { fade: 0, restart: true });
    this.altar.child.clip = 'Spawn';
    const ctx = this.host.ctx;
    ctx.particles.burst('sparkle', hall.altar.child.clone().setY(hall.altar.child.y + 0.8), { count: 26, scale: 2, colors: ['white', 'cyan', 'lime'] });
    ctx.lights.request({ position: hall.altar.child.clone().setY(2), color: PALETTE.lime, intensity: 18, radius: 7, lifetime: 0.5, fadeIn: 0.02, priority: 3 });
    ctx.audio.play('rl.levelUp');
  }

  private cycleParent(k: 0 | 1, dir: 1 | -1): void {
    const n = this.entries.length;
    if (!n) return;
    if (k === 0) this.altar.a = (this.altar.a + dir + n) % n;
    else this.altar.b = (this.altar.b + dir + n) % n;
    const keepChild = this.altar.child;
    this.altar.child = null;
    this.buildAltar();
    this.altar.child = keepChild;
  }

  // ------------------------------------------------------------------ views

  /** Switch view: walk (first person), fly (free), inspect (orbit an exhibit), breed (orbit the altar). */
  setView(view: BestiaryView, focus: Exhibit | null = null): void {
    const e = this.host.ctx.engine;
    const prev = e.camera;
    this.view = view;
    this.focus = view === 'inspect' ? focus : null;
    this.cursor = 0;
    if (view === 'inspect' && focus) {
      this.orbit.target.copy(focus.at).setY(focus.at.y + Math.min(1.2, focus.built.height * 0.45));
      this.orbit.yaw = focus.yaw;
      this.orbit.pitch = 0.22;
      this.orbit.dist = Math.max(3.2, focus.built.height * 2.4);
    } else if (view === 'breed' && this.hall) {
      this.orbit.target.copy(this.hall.altar.child).setY(1.1);
      this.orbit.yaw = 0;
      this.orbit.pitch = 0.32;
      this.orbit.dist = 8;
    }
    const rig = e.setCamera(this.camera(), { syncUrl: false });
    if (view === 'walk' && rig instanceof FirstPersonRig) {
      // look the way the hero faces
      const h = this.visitor?.hero;
      if (h) rig.yaw = h.facing + Math.PI;
      if (prev instanceof FirstPersonRig) rig.pitch = prev.pitch;
    }
    this.onCameraChange();
    this.host.ctx.audio.play(view === 'walk' ? 'rl.close' : 'rl.open');
  }

  private orbitConfig(): CameraConfig {
    const o = this.orbit;
    const p = this.orbitPosition(this.tmp);
    return { preset: 'fixed', projection: 'perspective', fov: 40, position: [p.x, p.y, p.z], target: [o.target.x, o.target.y, o.target.z] };
  }

  private orbitPosition(out: Vector3): Vector3 {
    const o = this.orbit;
    return out.set(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist).add(o.target);
  }

  /** The hero is seen while flying, not from its own eyes nor in front of an exhibit. */
  private heroShown(): boolean {
    return this.view === 'fly';
  }

  onCameraChange(): void {
    const v = this.visitor;
    if (v) v.model.visible = this.heroShown();
  }

  // ------------------------------------------------------------------ per frame

  fixedUpdate(dt: number): void {
    const v = this.visitor;
    if (!v?.hero) return;
    const ctx = this.host.ctx;
    const walking = this.view === 'walk';
    const input = walking ? readMoveInput(ctx, v.hero, this.input) : this.still();
    v.fixedUpdate(dt, input);
  }

  private still() {
    const i = this.input;
    i.move.set(0, 0, 0);
    i.jump = i.jumpHeld = i.crouch = i.crouchPressed = i.attack = false;
    i.face = null;
    return i;
  }

  update(dt: number, events: readonly UiEvent[]): void {
    const ctx = this.host.ctx;
    const input = ctx.input;
    const v = this.visitor;
    const hall = this.hall;
    if (!v || !hall) return;
    this.time += dt;
    v.update(dt, this.heroShown());
    for (const ex of [...this.exhibits, ...this.altar.parents, this.altar.child]) {
      if (!ex) continue;
      const ended = ex.runtime.update(dt, {}).some((e) => e.type === 'end');
      if (ex.clip !== 'Idle' && (ended || ex.back > 0)) {
        ex.back += dt;
        if (ex.back > 0.7) {
          ex.runtime.play('Idle', { fade: 0.25 });
          ex.clip = 'Idle';
          ex.back = 0;
        }
      }
      if (this.turntable && ex === this.focus) ex.built.object.rotation.y += dt * 0.7;
    }
    if (this.altar.child) this.altar.child.built.object.rotation.y += dt * 0.5;
    const locked = typeof document !== 'undefined' && !!document.pointerLockElement;
    const esc = input.wasPressed('Escape', 'PadStart') && !this.wasLocked;
    this.wasLocked = locked;

    if (this.view === 'inspect' || this.view === 'breed') {
      // orbit: drag or Q/E to circle, wheel to zoom
      const o = this.orbit;
      o.yaw -= input.mouseDelta.x * 0.008 + ((input.isDown('KeyE') ? 1 : 0) - (input.isDown('KeyQ') ? 1 : 0)) * 1.6 * dt;
      o.pitch = Math.min(1.1, Math.max(-0.05, o.pitch + input.mouseDelta.y * 0.005));
      if (input.wheel) o.dist = Math.min(14, Math.max(2, o.dist * Math.pow(1.1, input.wheel)));
      const rig = ctx.engine.camera;
      if (rig instanceof FreeRig) {
        // look a little to the right of the subject: it sits left of centre, clear of the card
        const pos = this.orbitPosition(rig.camera.position);
        const right = this.tmp.set(o.target.z - pos.z, 0, pos.x - o.target.x).normalize();
        rig.camera.lookAt(right.multiplyScalar(-o.dist * 0.2).add(o.target));
      }
      this.cardInput(events);
      if (esc) this.setView('walk');
    } else {
      if (input.wasPressed('Tab', 'PadY')) this.setView(this.view === 'walk' ? 'fly' : 'walk');
      if (this.view === 'walk' && input.wasPressed('KeyF', 'PadRT')) {
        const near = this.nearest();
        if (near === 'altar') this.setView('breed');
        else if (near) this.setView('inspect', near);
      }
      if (input.wasPressed('KeyN')) this.turnWing(1);
      if (esc) this.wantsLeave = true;
      // out through the door
      if (v.hero && v.position.z - hall.origin.z > HALL.exitZ) this.wantsLeave = true;
    }
    input.wheel = 0;
  }

  /** The exhibit (or the altar) the hero stands at and looks toward, if any. */
  nearest(): Exhibit | 'altar' | null {
    const v = this.visitor;
    const hall = this.hall;
    if (!v?.hero || !hall) return null;
    const p = v.position;
    const fwd = v.hero.forwardInto(this.tmp);
    let best: Exhibit | null = null;
    let bd = 3.6;
    for (const ex of this.exhibits) {
      const dx = ex.at.x - p.x;
      const dz = ex.at.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < bd && (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-3) > 0.2) {
        bd = d;
        best = ex;
      }
    }
    if (best) return best;
    const a = hall.altar.child;
    if (Math.hypot(a.x - p.x, a.z - p.z) < 4.2 && this.entries.length) return 'altar';
    return null;
  }

  // ------------------------------------------------------------------ the card (inspect / breed)

  private cardButtons(): Button[] {
    if (this.view === 'inspect' && this.focus) {
      const ex = this.focus;
      return [
        ...ex.built.clipNames.map((c) => ({ id: `clip:${c}`, label: clipName(c), act: () => void this.play(ex, c), accent: ex.clip === c ? ('teal' as const) : undefined })),
        { id: 'turntable', label: t(this.turntable ? 'showcase.bestiary.turntable_on' : 'showcase.bestiary.turntable_off'), act: () => (this.turntable = !this.turntable) },
        { id: 'back', label: t('showcase.bestiary.back'), act: () => this.setView('walk'), accent: 'plum' },
      ];
    }
    if (this.view === 'breed') {
      const list = this.entries;
      const name = (i: number) => (list[i] ? entryName(list[i]) : t('showcase.bestiary.none'));
      return [
        { id: 'parentA', label: name(this.altar.a), act: () => this.cycleParent(0, 1), step: (d) => this.cycleParent(0, d) },
        { id: 'parentB', label: name(this.altar.b), act: () => this.cycleParent(1, 1), step: (d) => this.cycleParent(1, d) },
        { id: 'breed', label: t('showcase.bestiary.breed'), act: () => void this.breed(), accent: 'teal' },
        { id: 'mutate', label: t('showcase.bestiary.mutate'), act: () => void this.mutateChild() },
        { id: 'back', label: t('showcase.bestiary.back'), act: () => this.setView('walk'), accent: 'plum' },
      ];
    }
    return [];
  }

  private cardInput(events: readonly UiEvent[]): void {
    this.buttons = this.cardButtons();
    const n = this.buttons.length;
    for (const e of events) {
      if (e.kind === 'nav' && (e.dir === 'up' || e.dir === 'down')) {
        this.cursor = (this.cursor + (e.dir === 'down' ? 1 : -1) + n) % n;
        this.host.game.sound('move');
      } else if (e.kind === 'nav') this.buttons[this.cursor]?.step?.(e.dir === 'left' ? -1 : 1);
      else if (e.kind === 'confirm') this.activate(this.buttons[this.cursor]?.id ?? '');
      else if (e.kind === 'pointer' && e.type === 'down') {
        for (const [id, r] of this.rects) if (inside(r, e.x, e.y)) this.activate(id, e.x < r.x + 14 ? -1 : 1);
      } else if (e.kind === 'pointer' && e.type === 'move') {
        for (const [id, r] of this.rects) if (inside(r, e.x, e.y)) this.cursor = Math.max(0, this.buttons.findIndex((b) => b.id === id));
      }
    }
  }

  /** Press a card button by id (agents use this too). */
  activate(id: string, dir: 1 | -1 = 1): boolean {
    const b = this.cardButtons().find((x) => x.id === id);
    if (!b) return false;
    if (b.step && dir === -1) b.step(-1);
    else b.act();
    this.host.game.sound('click');
    return true;
  }

  // ------------------------------------------------------------------ drawing

  draw(ui: UiCanvas): void {
    const ctx = this.host.ctx;
    const cam = ctx.engine.camera.camera;
    const list = this.entries;
    const kills = list.reduce((s, e) => s + e.kills, 0);
    ui.text(ui.w / 2, 4, t('showcase.bestiary.name'), { align: 'center', color: 'sand', shadow: 'ink' });
    const counts = { species: t('showcase.bestiary.species', { count: list.length }), kills: t('showcase.bestiary.kills', { count: kills }) };
    ui.mini(ui.w / 2, 13, this.wings > 1 ? t('showcase.bestiary.summary_wing', { ...counts, wing: this.page + 1, wings: this.wings }) : t('showcase.bestiary.summary', counts), 'mist', 'center');
    if (this.view === 'walk' || this.view === 'fly') {
      // plaques over the exhibits near the camera
      for (const ex of this.exhibits) {
        const e = ex.entry!;
        const top = this.tmp.copy(ex.at).setY(ex.at.y + ex.built.height * ex.fit + 0.35);
        if (top.distanceTo(cam.position) > 11) continue;
        const s = top.project(cam);
        if (s.z > 1 || Math.abs(s.x) > 1.1 || Math.abs(s.y) > 1.1) continue;
        const x = Math.round(((s.x + 1) / 2) * ui.w);
        const y = Math.round(((1 - s.y) / 2) * ui.h);
        const label = entryName(e);
        const plaque = depthLine('plaque', e);
        const w = Math.max(ui.measure(label), miniWidth(plaque)) + 6;
        ui.rect(x - w / 2, y - 10, w, 19, 'ink');
        ui.text(x, y - 8, label, { align: 'center', color: RANK_COLOR[e.rank] ?? 'white' });
        ui.mini(x, y + 1, plaque, 'mist', 'center');
      }
      if (!list.length) {
        ui.text(ui.w / 2, ui.h / 2 - 20, t('showcase.bestiary.empty'), { align: 'center', color: 'mist', shadow: 'ink' });
        wrap(t('showcase.bestiary.empty_hint'), ui.w - 16).forEach((l, i) => ui.text(ui.w / 2, ui.h / 2 - 8 + i * 9, l, { align: 'center', color: 'slate', shadow: 'ink' }));
      }
      const near = this.view === 'walk' ? this.nearest() : null;
      if (near) {
        const label = near === 'altar' ? t('showcase.bestiary.prompt.altar') : t('showcase.bestiary.prompt.inspect', { name: entryName(near.entry!) });
        const w = ui.glyphWidth('interact') + 3 + ui.measure(label);
        ui.rect(ui.w / 2 - w / 2 - 4, ui.h - 40, w + 8, 13, 'ink');
        ui.prompt(ui.w / 2, ui.h - 37, 'interact', label, 'white', 'center');
      }
      const help = hints(['move', 'look', this.view === 'walk' ? 'fly' : 'walk', ...(this.wings > 1 ? (['next_wing'] as const) : []), 'photo', 'leave']);
      miniHints(ui, ui.w / 2, ui.h - 9, help, 'mist');
      if (this.view === 'walk') {
        // a crosshair dot
        ui.rect(ui.w / 2 - 1, ui.h / 2 - 1, 3, 3, 'ink');
        ui.rect(ui.w / 2, ui.h / 2, 1, 1, 'white');
      }
      return;
    }
    this.drawCard(ui);
  }

  private drawCard(ui: UiCanvas): void {
    const buttons = this.cardButtons();
    this.buttons = buttons;
    const measure = (s: string) => ui.measure(s);
    /** A button's text: a choice row's between arrows, its choice cut (the last resort) so the arrows stay. */
    const shown = (b: Button, w: number) => (b.step ? `< ${clip(b.label, w - measure('<  >'), measure)} >` : b.label);
    const cardW = Math.min(CARD_MAX, ui.w - 12, Math.max(CARD_W, ...buttons.map((b) => measure(shown(b, Infinity)) + 16)));
    const x = ui.w - cardW - 6;
    let y = 24;
    const lines: { text: string; color: PaletteColor; mini?: boolean }[] = [];
    // a line too long for the card wraps (a longer language, a long name)
    const add = (text: string, color: PaletteColor, mini = false) => {
      for (const l of mini ? wrapText(text, cardW - 10, miniWidth) : wrap(text, cardW - 10)) lines.push({ text: l, color, mini });
    };
    if (this.view === 'inspect' && this.focus) {
      const ex = this.focus;
      const e = ex.entry!;
      const g = ex.genome;
      add(entryName(e), RANK_COLOR[e.rank] ?? 'white');
      add(t('showcase.bestiary.rank_plan', { rank: t(lineKey('showcase.bestiary.rank', e.rank)), plan: planName(g.plan) }), 'mist', true);
      add(t('showcase.bestiary.archetype', { name: archetypeName(g.archetype) }), 'mist', true);
      add(depthLine('kills_depth', e), 'sand', true);
      const parts = [...new Set(g.parts.map((p) => partName(p.part)))];
      for (let i = 0; i < parts.length; i += 2) add(parts.slice(i, i + 2).join(' · '), 'slate', true);
    } else if (this.view === 'breed') {
      const c = this.altar.child;
      add(t('showcase.bestiary.altar'), 'cyan');
      add(t('showcase.bestiary.altar_hint'), 'mist', true);
      if (c) {
        const g = c.genome;
        add(monsterName(g), 'lime');
        add(t('showcase.bestiary.generation', { generation: this.altar.generation, plan: planName(g.plan) }), 'mist', true);
        add(t('showcase.bestiary.archetype', { name: archetypeName(g.archetype) }), 'mist', true);
        add(t('showcase.bestiary.parts_seed', { count: g.parts.length, seed: g.seed }), 'slate', true);
      } else add(t('showcase.bestiary.pick_parents'), 'slate', true);
    }
    // a mini row the mini font can't draw (accents, other writing systems) takes a text row's height
    const rowH = (l: { text: string; mini?: boolean }) => (l.mini && miniCovers(l.text) ? 7 : 10);
    const rowsH = lines.reduce((s, l) => s + rowH(l), 0);
    const help = wrapText(hints(['orbit', 'zoom', 'back']), cardW - 6, miniWidth);
    const helpH = help.every(miniCovers) ? 7 : 9;
    const h = 8 + rowsH + 4 + buttons.length * 13 + 7 + help.length * helpH;
    ui.panel(x, y - 4, cardW, h, 'ink', 'slate');
    for (const l of lines) {
      if (l.mini) ui.mini(x + 5, y + 1, l.text, l.color);
      else ui.text(x + 5, y, l.text, { color: l.color });
      y += rowH(l);
    }
    y += 4;
    this.rects.clear();
    buttons.forEach((b, i) => {
      const r = { x: x + 4, y, w: cardW - 8, h: 12 };
      ui.button(r, shown(b, r.w - 6), { focus: i === this.cursor, accent: b.accent });
      this.rects.set(b.id, r);
      y += 13;
    });
    help.forEach((row, i) => ui.mini(x + cardW / 2, y + 3 + i * helpH, row, 'slate', 'center'));
  }

  // ------------------------------------------------------------------ camera

  cameraTarget(): Vector3 {
    if (this.view === 'inspect' || this.view === 'breed') return this.orbit.target;
    const v = this.visitor;
    if (!v) return this.target.copy(HALL_ORIGIN);
    const p = v.position;
    return this.target.set(p.x, p.y + 0.9, p.z);
  }

  eye(): Vector3 {
    const h = this.visitor?.hero;
    return h ? h.eye(this.host.ctx.physics.alpha) : this.cameraTarget();
  }

  /** For agents: the hero's place (hall-local) and which way it looks. */
  heroLocal(): number[] {
    const v = this.visitor;
    if (!v) return [0, 0, 0];
    return v.position.clone().sub(HALL_ORIGIN).toArray().map((n) => +n.toFixed(3));
  }

  /** For agents: stand at a pedestal, facing it. */
  goTo(ped: Pedestal | 'altar'): void {
    const v = this.visitor;
    const hall = this.hall;
    if (!v?.hero || !hall) return;
    const at = ped === 'altar' ? hall.altar.viewpoint : ped.viewpoint;
    const look = ped === 'altar' ? hall.altar.child : ped.top;
    const facing = Math.atan2(look.x - at.x, look.z - at.z);
    v.teleport([at.x, at.y, at.z], facing);
    const rig = this.host.ctx.engine.camera;
    if (rig instanceof FirstPersonRig) {
      rig.yaw = facing + Math.PI;
      rig.pitch = -0.12;
    }
  }

  /** The object of an exhibit (tests count meshes, agents frame shots). */
  objectOf(ex: Exhibit): Object3D {
    return ex.built.object;
  }
}

/** A light tinted toward the monster's own primary colour (kept bright: it is a spotlight). */
function lightColor(g: Genome): number {
  const c = new Color(g.palette.primary).lerp(new Color(0xfff0d0), 0.6);
  return c.getHex();
}
