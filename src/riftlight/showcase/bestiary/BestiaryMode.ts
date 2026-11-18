/**
 * The Hall of Beasts: every species the hero has killed (`save.showcase.bestiary`), rebuilt
 * from its genome on a pedestal under its own light, in a dark gallery built 1 km east of
 * town. It is the Spore generator's window inside the game:
 *
 *   walk     the `first` preset: WASD, mouse (click to lock) or Q/E to look; the hero is a
 *            `PlatformerCharacter` (Space still jumps). Tab: fly with the `free` camera. N, R1 /
 *            L1 or, on a phone, the < > at the screen's sides turn the wing (more than ten species).
 *   inspect  F at a pedestal: an orbit camera (the `fixed` preset, moved by hand: drag or
 *            Q/E to circle, wheel to zoom), the card (name, rank, plan, archetype, parts,
 *            kills, depths), a button per clip, the turntable.
 *   breed    F at the Rift Altar: pick two parents, BREED (the generator's `crossover` +
 *            `mutate`) and the child grows on the vat; MUTATE it again.
 *
 * Leaving: walk back out of the door, or Esc.
 */
import { Color, type Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { type CameraConfig, FirstPersonRig, FreeRig, KEYMAP, type LightHandle, PALETTE, type PaletteColor, readMoveInput, wrapText } from '../../../engine';
import { setLookLayer } from '../../../engine/render/lookLayer';
import { Rng } from '../../core/rng';
import type { Genome } from '../../core/types';
import { lang, lineKey, t } from '../../lang';
import { archetypeName, bossNameShown, partName, planName } from '../../lang/monsters';
import { buildMonster, type BuiltMonster, crossover, MonsterRuntime, mutate, validateGenome } from '../../monsters';
import type { UiCanvas, UiEvent, Rect } from '../../ui/kit';
import { clip, inside, miniCovers, miniWidth, wrap } from '../../ui/kit';
import { monsterName } from '../../wire/monsters';
import { clearAbove, controlBoxes, drawHints, hints, hintsAt } from '../hints';
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
/** How much of a narrow screen's height the card under the exhibit may take (a phone held upright): the exhibit keeps the rest. */
const CARD_SHARE = 0.5;
/** The rows the Hall's name and counts take along the top: a narrow screen's subject sits between them and the card. */
const CARD_TOP = 22;
/** How much farther the orbit camera starts on a narrow screen, so the subject fits over the card. */
const NARROW_DIST = 1.8;
/** The farthest the orbit camera starts from an exhibit: inside the hall, short of the far wall (`HALL`: pedestals 3.8 m out, walls at 6). */
const ORBIT_MAX = 9;

/** The card sits right of the exhibit on a screen `w` art pixels wide, else under it (a phone held upright). */
function cardBeside(w: number): boolean {
  return w >= 2 * CARD_W;
}

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
  /** Where the card was drawn last (a sideways swipe that starts on it closes it). */
  private cardRect: Rect | null = null;
  /** A phone's < > for the wings, where they were drawn last (null: not shown). */
  private wingRects: { prev: Rect; next: Rect } | null = null;
  /** Where the latest touch or click went down (a swipe begins there), in art pixels. */
  private downAt: { x: number; y: number } | null = null;
  /** A finger down on a card button (pressed when it lifts there, unless it swiped). */
  private tapOn: { id: string; dir: 1 | -1 } | null = null;
  private cursor = 0;
  /** The card is too tall for the screen as a button per clip: the clips are one choice row (`cardButtons`); set as it is drawn. */
  private compact = false;
  /** The clip the compact card's choice row is on. */
  private clipAt = 0;
  private readonly target = new Vector3();
  private readonly tmp = new Vector3();
  private time = 0;
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

  /** Next / previous wing (more than ten species; with one wing nothing changes). */
  turnWing(dir: 1 | -1): void {
    if (this.wings <= 1) return;
    this.page = (this.page + dir + this.wings) % this.wings;
    this.fillWing();
    this.host.ctx.audio.play('rl.open');
  }

  /**
   * Play a clip on an exhibit (one-shots go back to Idle after a beat). On the inspected one, the
   * compact card's clip row names it, however it was played (its button by id, an agent).
   */
  play(ex: Exhibit, clip: string): boolean {
    if (!ex.built.clipNames.includes(clip)) return false;
    ex.runtime.play(clip, { fade: 0.12, restart: true });
    ex.clip = clip;
    ex.back = 0;
    if (ex === this.focus) this.clipAt = ex.built.clipNames.indexOf(clip);
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
    this.clipAt = Math.max(0, this.focus?.built.clipNames.indexOf(this.focus.clip) ?? 0); // the clip it is playing
    this.cardRect = this.tapOn = null;
    if (view === 'inspect' && focus) {
      const tall = focus.built.height * focus.fit; // as it stands on its pedestal (scaled to fit it)
      this.orbit.target.copy(focus.at).setY(focus.at.y + Math.min(1.2, tall * 0.45));
      this.orbit.yaw = focus.yaw;
      this.orbit.pitch = 0.22;
      // farther on a narrow screen (a phone held upright): the subject fits over the card; never
      // past the hall's far wall (the camera faces the exhibit from across the aisle)
      this.orbit.dist = Math.min(ORBIT_MAX, Math.max(3.2, tall * 2.4) * (cardBeside(this.host.ctx.hud.width) ? 1 : NARROW_DIST));
    } else if (view === 'breed' && this.hall) {
      this.orbit.target.copy(this.hall.altar.child).setY(1.1);
      this.orbit.yaw = 0;
      this.orbit.pitch = 0.32;
      this.orbit.dist = 8 * (cardBeside(this.host.ctx.hud.width) ? 1 : NARROW_DIST);
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
    // R1 / L1 are the hall's (the wing, the card's zoom), not the hero's lie down and prone
    ctx.input.clearQueued('PadLB', 'PadRB');
    // nor does the Circle that closed the card (photo mode, the pause) crouch it while held
    const input = walking ? this.host.presses.mask(ctx.input, readMoveInput(ctx, v.hero, this.input), KEYMAP) : this.still();
    // F / Triangle and R2 are the hall's (inspect, walk / fly): nothing here is grabbed
    input.grab = false;
    v.fixedUpdate(dt, input);
  }

  private still() {
    const i = this.input;
    i.move.set(0, 0, 0);
    i.jump = i.jumpHeld = i.crouch = i.crouchPressed = i.attack = false;
    i.walk = i.prone = i.lie = i.wave = i.sit = false;
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
    // Esc or Options: recorded input only, so a replay does what the run did, never the page's
    // pointer lock, which no recording holds (a press that reaches the game pauses, the mouse
    // locked or not, and the pause lets go of the mouse)
    const esc = input.wasPressed('Escape', 'PadStart');
    // a frame that began with the card up: its presses are the card's (Cross on Back never jumps, Circle never crouches)
    const carded = this.view === 'inspect' || this.view === 'breed';
    for (const e of events) if (e.kind === 'pointer' && e.type === 'down') this.downAt = { x: e.x, y: e.y };

    if (this.view === 'inspect' || this.view === 'breed') {
      // orbit: drag, Q/E or the right stick to circle; the wheel, a pinch or R1 / L1 held to zoom
      const o = this.orbit;
      o.yaw -= input.mouseDelta.x * 0.008 + ((input.isDown('KeyE') ? 1 : 0) - (input.isDown('KeyQ') ? 1 : 0)) * 1.6 * dt;
      o.pitch = Math.min(1.1, Math.max(-0.05, o.pitch + input.mouseDelta.y * 0.005));
      const held = (input.isDown('PadLB') ? 1 : 0) - (input.isDown('PadRB') ? 1 : 0);
      if (input.wheel || held) o.dist = Math.min(14, Math.max(2, o.dist * Math.pow(1.1, input.wheel) * Math.pow(2.2, held * dt)));
      const rig = ctx.engine.camera;
      if (rig instanceof FreeRig) {
        const cam = rig.camera;
        const pos = this.orbitPosition(cam.position);
        if (cardBeside(ctx.hud.width)) {
          // look a little to the right of the subject: it sits left of centre, clear of the card
          const right = this.tmp.set(o.target.z - pos.z, 0, pos.x - o.target.x).normalize();
          cam.lookAt(right.multiplyScalar(-o.dist * 0.2).add(o.target));
        } else {
          // a narrow screen: look under the subject, so it sits in the middle of what the card leaves above it
          cam.lookAt(o.target);
          const h = ctx.hud.height;
          const free = this.cardRect?.y ?? h * (1 - CARD_SHARE);
          const ny = 1 - (CARD_TOP + free) / h; // that middle in device coordinates
          const fov = cam instanceof PerspectiveCamera ? cam.fov : 40;
          const up = this.tmp.set(0, 1, 0).applyQuaternion(cam.quaternion);
          cam.lookAt(up.multiplyScalar(-ny * o.dist * Math.tan((fov * Math.PI) / 360)).add(o.target));
        }
      }
      this.cardInput(events);
      if (esc && (this.view === 'inspect' || this.view === 'breed')) this.setView('walk');
    } else {
      if (input.wasPressed('Tab', 'PadY')) this.setView(this.view === 'walk' ? 'fly' : 'walk');
      // F, R2, a phone's LOOK, or a left click (the exhibit the crosshair is on; recorded input
      // only, so a replay inspects what the run did: never the page's pointer lock)
      if (this.view === 'walk' && input.wasPressed('KeyF', 'PadRT', 'MouseLeft')) {
        const near = this.nearest();
        if (near === 'altar') this.setView('breed');
        else if (near) this.setView('inspect', near);
      }
      // the next wing: N or R1 (L1 the one before), on a phone a tap on the < > at the sides; never
      // a swipe, which is a quick look here (a drag looks)
      let turn = (input.wasPressed('KeyN', 'PadRB') ? 1 : 0) - (input.wasPressed('PadLB') ? 1 : 0);
      const w = this.wingRects;
      for (const e of events) {
        if (!w || e.kind !== 'pointer' || e.type !== 'down') continue;
        if (inside(w.next, e.x, e.y)) turn = 1;
        else if (inside(w.prev, e.x, e.y)) turn = -1;
      }
      if (turn) this.turnWing(turn > 0 ? 1 : -1);
      // Options, Esc or ≡: the showcase's pause (Resume, Photo mode, Leave)
      if (esc) this.host.openPause();
      // out through the door
      if (v.hero && v.position.z - hall.origin.z > HALL.exitZ) this.wantsLeave = true;
    }
    if (carded) this.host.presses.take(input);
    input.wheel = 0;
  }

  /** A phone's interact button: LOOK at the exhibit near (or the altar), hidden when there is none. */
  touchOffer(): { verb: string; name: string } | null {
    const near = this.view === 'walk' ? this.nearest() : null;
    if (!near) return null;
    return { verb: t('touch.verb.look'), name: near === 'altar' ? t('showcase.bestiary.altar') : entryName(near.entry!) };
  }

  /** The card (inspect, breed) is a phone's whole screen: its buttons, not the stick and A / B, are tapped then. */
  touchControls(): boolean {
    return this.view === 'walk' || this.view === 'fly';
  }

  /** The exhibit (or the altar) the hero stands at and looks toward, if any. */
  nearest(): Exhibit | 'altar' | null {
    const v = this.visitor;
    const hall = this.hall;
    if (!v?.hero || !hall) return null;
    const p = v.position;
    const fwd = v.hero.forwardInto(this.tmp);
    // on a phone (the device in use, recorded) the nearest exhibit is enough: no need to face it squarely
    const facing = this.host.ctx.input.device === 'touch' ? -1 : 0.2;
    let best: Exhibit | null = null;
    let bd = 3.6;
    for (const ex of this.exhibits) {
      const dx = ex.at.x - p.x;
      const dz = ex.at.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < bd && (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-3) > facing) {
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

  /**
   * The card's buttons as drawn: every clip a button, or, on a card too tall for the screen (a
   * phone held either way: `compact`), the clips as one choice row (< RUN >, each step plays it).
   */
  private cardButtons(): Button[] {
    const all = this.allCardButtons();
    const ex = this.focus;
    if (!this.compact || this.view !== 'inspect' || !ex) return all;
    const clips = ex.built.clipNames;
    const pick = (dir: 1 | -1) => {
      this.clipAt = (this.clipAt + dir + clips.length) % clips.length;
      this.play(ex, clips[this.clipAt]!);
    };
    const row: Button = { id: 'clips', label: clipName(clips[this.clipAt] ?? 'Idle'), act: () => pick(1), step: pick, accent: 'teal' };
    return [row, ...all.filter((b) => !b.id.startsWith('clip:'))];
  }

  private allCardButtons(): Button[] {
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
    const input = this.host.ctx.input;
    // a finger that swiped this frame made no tap (its lift is no press)
    const swiped = input.wasPressed('SwipeLeft', 'SwipeRight', 'SwipeUp', 'SwipeDown');
    const under = (x: number, y: number) => {
      for (const [id, r] of this.rects) if (inside(r, x, y)) return { id, dir: (x < r.x + 14 ? -1 : 1) as 1 | -1 };
      return null;
    };
    for (const e of events) {
      // Circle, Backspace, or a sideways swipe that starts on the card (one elsewhere is a quick
      // orbit, a drag): back to the hall (Esc and Options too, below)
      const fromCard = !!this.downAt && !!this.cardRect && inside(this.cardRect, this.downAt.x, this.downAt.y);
      if (e.kind === 'back' || (e.kind === 'swipe' && (e.dir === 'left' || e.dir === 'right') && fromCard)) {
        this.tapOn = null;
        this.host.game.sound('close');
        return this.setView('walk');
      }
      if (e.kind === 'nav' && (e.dir === 'up' || e.dir === 'down')) {
        this.cursor = (this.cursor + (e.dir === 'down' ? 1 : -1) + n) % n;
        this.host.game.sound('move');
      } else if (e.kind === 'nav') this.buttons[this.cursor]?.step?.(e.dir === 'left' ? -1 : 1);
      else if (e.kind === 'confirm') this.activate(this.buttons[this.cursor]?.id ?? '');
      else if (e.kind === 'pointer' && e.type === 'down') {
        // a click presses at once; a finger when it lifts on the same button (a swipe from it presses nothing)
        const b = under(e.x, e.y);
        if (e.touch) this.tapOn = b;
        else if (b) this.activate(b.id, b.dir);
      } else if (e.kind === 'pointer' && e.type === 'up' && e.touch) {
        const b = this.tapOn;
        this.tapOn = null;
        if (b && !swiped && under(e.x, e.y)?.id === b.id) this.activate(b.id, b.dir);
      } else if (e.kind === 'pointer' && e.type === 'move') {
        for (const [id, r] of this.rects) if (inside(r, e.x, e.y)) this.cursor = Math.max(0, this.buttons.findIndex((b) => b.id === id));
      }
    }
  }

  /** Press a card button by id (agents use this too). */
  activate(id: string, dir: 1 | -1 = 1): boolean {
    const b = this.cardButtons().find((x) => x.id === id) ?? this.allCardButtons().find((x) => x.id === id);
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
    const boxes = controlBoxes(this.host.game);
    const name = t('showcase.bestiary.name');
    const counts = { species: t('showcase.bestiary.species', { count: list.length }), kills: t('showcase.bestiary.kills', { count: kills }) };
    const summary = this.wings > 1 ? t('showcase.bestiary.summary_wing', { ...counts, wing: this.page + 1, wings: this.wings }) : t('showcase.bestiary.summary', counts);
    // the name and the counts centred along the top; beside a phone's ≡ (top left) where they would
    // run under it (a phone held upright, a long language), else under it
    const corner = boxes.filter((b) => b.y < ui.h / 4 && b.x < ui.w / 2).reduce((c, b) => ({ right: Math.max(c.right, b.x + b.w + 2), bottom: Math.max(c.bottom, b.y + b.h + 2) }), { right: 0, bottom: 0 });
    const wide = Math.max(ui.measure(name), miniCovers(summary) ? miniWidth(summary) : ui.measure(summary));
    const headX = ui.w / 2 - wide / 2 >= corner.right ? ui.w / 2 : wide <= ui.w - 2 - corner.right ? Math.floor((corner.right + ui.w - 2) / 2) : null;
    const headY = headX === null ? corner.bottom : 4;
    ui.text(headX ?? ui.w / 2, headY, name, { align: 'center', color: 'sand', shadow: 'ink' });
    ui.mini(headX ?? ui.w / 2, headY + 9, summary, 'mist', 'center');
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
        // both wrapped to the screen (a phone held upright, a long language), in the middle of it, the
        // hint under the title's last row; lifted over a phone's controls under their columns (sideways)
        const title = wrap(t('showcase.bestiary.empty'), ui.w - 16);
        const hint = wrap(t('showcase.bestiary.empty_hint'), ui.w - 16);
        const blockW = Math.max(...[...title, ...hint].map((l) => ui.measure(l)));
        const blockH = (title.length + hint.length) * 9 + 3;
        const y0 = Math.max(headY + 20, clearAbove(boxes, ui.w / 2, blockW + 4, Math.round(ui.h / 2) - 8 + hint.length * 9, blockH));
        title.forEach((l, i) => ui.text(ui.w / 2, y0 + i * 9, l, { align: 'center', color: 'mist', shadow: 'ink' }));
        hint.forEach((l, i) => ui.text(ui.w / 2, y0 + title.length * 9 + 3 + i * 9, l, { align: 'center', color: 'slate', shadow: 'ink' }));
      }
      // a phone has no button to fly with: its hints leave it out
      const touch = ctx.engine.controls.device === 'touch';
      const help = hints(['move', 'look', ...(touch ? [] : [this.view === 'walk' ? ('fly' as const) : ('walk' as const)]), ...(this.wings > 1 ? (['next_wing'] as const) : []), 'photo', 'leave']);
      // the hints along the bottom: between a phone's stick and its buttons where they leave room, else over them
      const top = drawHints(ui, hintsAt(ui, help, boxes, ui.h - 9), 'mist');
      const near = this.view === 'walk' ? this.nearest() : null;
      if (near) {
        const label = near === 'altar' ? t('showcase.bestiary.prompt.altar') : t('showcase.bestiary.prompt.inspect', { name: entryName(near.entry!) });
        // the name under the verb where the line is wider than the screen (a phone held upright)
        const gw = ui.glyphWidth('interact') + 3;
        const rows = wrap(label, ui.w - 16 - gw);
        const w = gw + Math.max(...rows.map((r) => ui.measure(r)));
        const h = 13 + (rows.length - 1) * 9;
        // over the hints, clear of the controls under its columns; without a phone's controls where
        // it has always sat (its box ending 27 rows up), the hints wrapped higher pushing it up
        const y = clearAbove(boxes, ui.w / 2, w + 8, boxes.length ? top - 5 : Math.min(top - 5, ui.h - 27), h);
        ui.rect(ui.w / 2 - w / 2 - 4, y, w + 8, h, 'ink');
        if (rows.length === 1) ui.prompt(ui.w / 2, y + 3, 'interact', label, 'white', 'center');
        else {
          const x = Math.round(ui.w / 2 - w / 2);
          ui.prompt(x, y + 3, 'interact', rows[0]!, 'white');
          rows.slice(1).forEach((r, i) => ui.text(x + gw, y + 12 + i * 9, r, { color: 'white' }));
        }
      }
      this.wingRects = touch && this.wings > 1 ? this.drawWingButtons(ui) : null;
      if (this.view === 'walk') {
        // a crosshair dot
        ui.rect(ui.w / 2 - 1, ui.h / 2 - 1, 3, 3, 'ink');
        ui.rect(ui.w / 2, ui.h / 2, 1, 1, 'white');
      }
      return;
    }
    this.drawCard(ui);
  }

  /**
   * A phone's < > for the wings, half way up each side of the screen (clear of the stick, the
   * buttons and the crosshair). Returns where a tap turns them: wider than drawn, a fingertip.
   */
  private drawWingButtons(ui: UiCanvas): { prev: Rect; next: Rect } {
    const w = 14;
    const h = 24;
    const y = Math.round(ui.h / 2 - h / 2);
    const prev = { x: 3, y, w, h };
    const next = { x: ui.w - 3 - w, y, w, h };
    ui.button(prev, '<');
    ui.button(next, '>');
    return { prev: { x: 0, y: y - 10, w: w + 14, h: h + 20 }, next: { x: ui.w - w - 14, y: y - 10, w: w + 14, h: h + 20 } };
  }

  private drawCard(ui: UiCanvas): void {
    const measure = (s: string) => ui.measure(s);
    /** A button's text: a choice row's between arrows, its choice cut (the last resort) so the arrows stay. */
    const shown = (b: Button, w: number) => (b.step ? `< ${clip(b.label, w - measure('<  >'), measure)} >` : b.label);
    const all = this.allCardButtons();
    const cardW = Math.min(CARD_MAX, ui.w - 12, Math.max(CARD_W, ...all.map((b) => measure(shown(b, Infinity)) + 16)));
    // beside the exhibit (right of it), or under it on a narrow screen (a phone held upright)
    const beside = cardBeside(ui.w);
    const room = beside ? ui.h - 28 : Math.floor(ui.h * CARD_SHARE);
    /** The card's lines; `part`: the row of parts each came from (a row too long wraps), dropped whole on a short screen. */
    const lines: { text: string; color: PaletteColor; mini?: boolean; part?: number }[] = [];
    // a line too long for the card wraps (a longer language, a long name)
    const add = (text: string, color: PaletteColor, mini = false, part?: number) => {
      for (const l of mini ? wrapText(text, cardW - 10, miniWidth) : wrap(text, cardW - 10)) lines.push({ text: l, color, mini, part });
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
      for (let i = 0; i < parts.length; i += 2) add(parts.slice(i, i + 2).join(' · '), 'slate', true, i);
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
    const help = wrapText(hints(['orbit', 'zoom', 'card_back']), cardW - 6, miniWidth);
    const helpH = help.every(miniCovers) ? 7 : 9;
    const height = (n: number) => 8 + lines.reduce((s, l) => s + rowH(l), 0) + 4 + n * 13 + 7 + help.length * helpH;
    // too tall for the screen: the clips as one choice row, then fewer rows of parts
    const was = this.buttons[this.cursor]?.id;
    this.compact = height(all.length) > room;
    const buttons = this.cardButtons();
    this.buttons = buttons;
    if (buttons[this.cursor]?.id !== was) {
      // the clips folded into their row or out of it (the phone turned): the cursor stays on its
      // button, a clip's on the row and the row's on the clip it names, else in the list
      const clips = this.focus?.built.clipNames ?? [];
      const id = was?.startsWith('clip:') ? 'clips' : was === 'clips' ? `clip:${clips[this.clipAt]}` : was;
      const at = buttons.findIndex((b) => b.id === id);
      this.cursor = at >= 0 ? at : Math.max(0, Math.min(this.cursor, buttons.length - 1));
    }
    while (height(buttons.length) > room && lines.at(-1)?.part !== undefined) {
      const part = lines.at(-1)!.part;
      while (lines.at(-1)?.part === part) lines.pop();
    }
    const h = height(buttons.length);
    const x = beside ? ui.w - cardW - 6 : Math.floor((ui.w - cardW) / 2);
    let y = beside ? 24 : ui.h - h; // the panel's top is 4 over y
    ui.panel(x, y - 4, cardW, h, 'ink', 'slate');
    this.cardRect = { x, y: y - 4, w: cardW, h };
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

  /** For agents: the walking hero's move state (`crouch`, `idle`…), or null out of the hall. */
  heroState(): string | null {
    return this.visitor?.hero?.state ?? null;
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
