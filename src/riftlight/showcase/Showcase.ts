/**
 * The showcase host: Riftlight's other genres and tools, inside the same game.
 *
 *   arcade    a cabinet in Emberfall → the `side` preset, a platformer stage, a CRT look
 *   bestiary  the Hall of Beasts → the `first` preset (or `free` / an orbit), every monster
 *             the hero killed rebuilt from its genome, and a breeding altar
 *   photo     any time (O, or pause → Photo mode) → the `free` camera, every filter, pixel /
 *             raw, time of day and lights, PNG capture
 *
 * How it plugs in (the pattern to copy for a new mode): the shell calls `fixedUpdate`,
 * `update`, `cameraTarget`, `eyePosition` and `onCameraChange` here first, and while a mode
 * is `active` the mode owns the frame (the town and the level stand still behind it). A
 * mode is entered behind an iris: the camera swoops toward the thing you used, the iris
 * closes, the mode builds its stage (`enter`), the camera preset and filters swap, the iris
 * opens. Leaving reverses it and puts back the filters, render mode and camera. No
 * `engine.loadGame`: the town, the hero and the save stay where they are.
 */
import { Vector3 } from 'three/webgpu';
import type { CameraConfig, CameraPreset, GameContext, Look, RenderMode } from '../../engine';
import { lookFromFilters, OrthoRig } from '../../engine';
import { SONGS } from '../game/audio';
import { CAMERA, type Riftlight } from '../game/Riftlight';
import type { UiCanvas, UiEvent } from '../ui/kit';
import { ArcadeMode } from './arcade/ArcadeMode';
import { BestiaryMode } from './bestiary/BestiaryMode';
import { PhotoMode } from './photo/PhotoMode';
import { recordKill, showcaseOf } from './save';
import { buildShowcaseProps, type ShowcaseProps } from './townProps';
import type { Genome } from '../core/types';
import type { Rank } from '../core/scaling';

/** A showcase stage (arcade, bestiary): built on enter, thrown away on leave. */
export interface ShowcaseMode {
  readonly id: 'arcade' | 'bestiary';
  /** Build and show the stage (behind a closed iris). */
  enter(): Promise<void>;
  /** Remove everything `enter` added. */
  leave(): void;
  /** The camera preset this mode plays with (also restored after photo mode). */
  camera(): CameraConfig;
  /** Filters while inside (null: keep the player's look). */
  readonly filters: readonly string[] | null;
  fixedUpdate(dt: number): void;
  /** Per frame: simulation, input (`events` are the shell's menu events), HUD into `ui`. */
  update(dt: number, events: readonly UiEvent[]): void;
  draw(ui: UiCanvas): void;
  cameraTarget(): Vector3;
  eye?(): Vector3;
  onCameraChange?(): void;
  /** The mode wants out (Esc, the exit door): the host runs the transition. */
  readonly wantsLeave: boolean;
}

interface Iris {
  /** 'close' toward black, 'open' back to the picture. */
  dir: 'close' | 'open';
  t: number;
  dur: number;
  /** Iris centre on screen, art pixels (null = middle). */
  at: { x: number; y: number } | null;
  /** Camera swoop while it runs (town → a cabinet, a mode → back to the hero). */
  swoop: { from: Vector3; to: Vector3; zoom0: number; zoom1: number } | null;
  then: (() => void) | null;
}

/** What a mode changes and leaving puts back. */
interface Saved {
  /** The player's look (per-layer pixel art and filters). */
  look: Look;
  mode: RenderMode;
  preset: CameraPreset;
}

const SWOOP = 0.8;
const OPEN = 0.55;

export class Showcase {
  readonly arcade: ArcadeMode;
  readonly bestiary: BestiaryMode;
  readonly photo: PhotoMode;
  mode: ShowcaseMode | null = null;
  iris: Iris | null = null;
  /** A mode is being built (async) behind the closed iris. */
  loading = false;
  props: ShowcaseProps | null = null;
  private saved: Saved | null = null;
  private readonly target = new Vector3();
  private readonly unsubs: (() => void)[] = [];
  private time = 0;

  constructor(readonly game: Riftlight) {
    this.arcade = new ArcadeMode(this);
    this.bestiary = new BestiaryMode(this);
    this.photo = new PhotoMode(this);
    // the bestiary: every kill the hero makes is counted by species, with the genome to rebuild it
    const counted = new WeakSet<object>(); // one count per death, however many events announce it
    this.unsubs.push(
      game.events.on('kill', ({ target, killer, rank, depth }) => {
        if (target === game.hero?.actor || (killer && killer !== game.hero?.actor) || counted.has(target)) return;
        counted.add(target);
        const body = (target as { body?: { userData?: { genome?: Genome } } }).body;
        const genome = body?.userData?.genome;
        if (!genome) return;
        recordKill(showcaseOf(game.save).bestiary, genome, { name: target.name ?? 'Monster', rank: rank as Rank, depth });
      }),
    );
  }

  get ctx(): GameContext {
    return this.game.ctx;
  }

  /** Something showcase owns the frame (a mode, photo mode, a transition). */
  get active(): boolean {
    return this.mode !== null || this.iris !== null || this.loading || this.photo.active;
  }

  /** Add the arcade booth and the Hall of Beasts to the town. */
  buildTown(): void {
    this.props = buildShowcaseProps(this.ctx);
    this.game.town.extend(this.props.extension);
  }

  /** The hero used a showcase interactable in town. */
  interact(id: string): boolean {
    if (id === 'arcade') return this.open(this.arcade), true;
    if (id === 'bestiary') return this.open(this.bestiary), true;
    return false;
  }

  /**
   * Enter a mode: swoop + iris (or `instant` for agents), build, swap camera and filters.
   * Resolves once the mode runs.
   */
  open(mode: ShowcaseMode, o: { instant?: boolean } = {}): Promise<void> {
    if (this.mode || this.loading || this.iris) return Promise.resolve();
    const game = this.game;
    if (game.screen !== 'town') return Promise.resolve();
    game.layer.closeAll();
    const anchor = mode.id === 'arcade' ? this.props?.arcadeScreen : this.props?.bestiaryDoor;
    return new Promise((resolve) => {
      const swap = () => {
        this.loading = true;
        const was = this.ctx.engine.camera.preset;
        this.saved = { look: this.ctx.engine.look, mode: this.ctx.engine.renderer.mode, preset: was === 'free' || was === 'fixed' ? 'iso' : was };
        void mode
          .enter()
          .then(() => {
            game.town.deactivate();
            game.hero.object.visible = false;
            this.mode = mode;
            this.ctx.engine.setCamera(mode.camera(), { syncUrl: false });
            // a mode with its own filters gets its own look (pixel art everywhere + its stack)
            if (mode.filters) this.ctx.engine.setLook(lookFromFilters(mode.filters));
            this.ctx.engine.renderer.setMode('pixel');
            this.ctx.engine.camera.teleport(mode.cameraTarget());
            game.ctx.audio.play('rl.portal', { pitch: 5 });
          })
          .finally(() => {
            this.loading = false;
            this.iris = o.instant ? null : { dir: 'open', t: 0, dur: OPEN, at: null, swoop: null, then: null };
            resolve();
          });
      };
      if (o.instant) return swap();
      const rig = this.ctx.engine.camera;
      const from = game.cameraTarget().clone();
      this.iris = {
        dir: 'close',
        t: 0,
        dur: SWOOP,
        at: null,
        swoop: anchor && rig instanceof OrthoRig ? { from, to: anchor.clone(), zoom0: rig.zoom, zoom1: Math.min(rig.maxZoom * 1.6, rig.zoom * 3.2) } : null,
        then: swap,
      };
      game.ctx.audio.play('rl.open');
    });
  }

  /** Leave the current mode back to town (iris, or `instant`). */
  close(o: { instant?: boolean } = {}): void {
    const mode = this.mode;
    if (!mode || this.iris || this.loading) return;
    if (this.photo.active) this.photo.close();
    const back = () => {
      mode.leave();
      this.mode = null;
      const game = this.game;
      const e = this.ctx.engine;
      game.town.activate();
      game.hero.object.visible = true;
      const preset = this.saved?.preset ?? 'iso';
      if (this.saved) {
        e.setLook(this.saved.look);
        e.renderer.setMode(this.saved.mode);
      }
      this.saved = null;
      // the camera from before (the game's own iso preset brings its pitch, yaw and view height back)
      const rig = e.setCamera({ preset }, { syncUrl: false });
      const home = this.heroPoint(new Vector3());
      const anchor = mode.id === 'arcade' ? this.props?.arcadeScreen : this.props?.bestiaryDoor;
      const zoom = CAMERA.town * game.settings.zoom;
      if (o.instant || !anchor) {
        rig.setZoom(zoom);
        rig.teleport(home);
        this.iris = null;
      } else {
        rig.setZoom(zoom * 3);
        rig.teleport(anchor);
        this.iris = { dir: 'open', t: 0, dur: SWOOP, at: null, swoop: { from: anchor.clone(), to: home, zoom0: zoom * 3, zoom1: zoom }, then: null };
      }
      game.ctx.audio.playMusic(SONGS.town, 'riftlight:town');
      game.ctx.audio.play('rl.portal', { pitch: -3 });
    };
    if (o.instant) return back();
    this.iris = { dir: 'close', t: 0, dur: 0.35, at: null, swoop: null, then: back };
  }

  // ------------------------------------------------------------------ the shell's hooks

  fixedUpdate(dt: number): void {
    if (this.photo.active || this.iris || this.loading) return;
    this.mode?.fixedUpdate(dt);
  }

  update(dt: number, events: readonly UiEvent[]): void {
    const ctx = this.ctx;
    this.time += dt;
    const ui = this.game.ui;
    ctx.hud.clear();
    if (this.photo.active) {
      this.photo.update(dt, events);
      this.photo.draw(ui);
      return;
    }
    if (this.iris) {
      const iris = this.iris;
      iris.t += dt;
      const k = Math.min(1, iris.t / iris.dur);
      const s = iris.swoop;
      if (s) {
        const e = ease(k);
        this.target.lerpVectors(s.from, s.to, e);
        const rig = ctx.engine.camera;
        if (rig instanceof OrthoRig) rig.setZoom(s.zoom0 + (s.zoom1 - s.zoom0) * e);
      }
      if (this.mode) {
        this.mode.update(0, []);
        this.mode.draw(ui);
      } else if (this.game.screen === 'town') this.game.town.update(dt, null);
      drawIris(ui, iris.dir === 'close' ? 1 - k : k, iris.at);
      if (k >= 1) {
        this.iris = null;
        iris.then?.();
      }
      return;
    }
    if (this.loading) {
      ui.rect(0, 0, ui.w, ui.h, 'ink');
      ui.text(ui.w / 2, ui.h / 2 - 4, 'LOADING' + '.'.repeat(1 + (Math.floor(this.time * 4) % 3)), { align: 'center', color: 'cyan' });
      return;
    }
    const mode = this.mode;
    if (!mode) return;
    if (ctx.input.wasPressed('KeyO')) {
      this.photo.open();
      return;
    }
    mode.update(dt, events);
    mode.draw(ui);
    if (mode.wantsLeave) this.close();
  }

  cameraTarget(): Vector3 {
    if (this.photo.active) return this.photo.cameraTarget();
    if (this.iris?.swoop) return this.target;
    if (this.mode) return this.mode.cameraTarget();
    return this.heroPoint(this.target);
  }

  /** Where the shell's camera looks at the hero (chest height). */
  heroPoint(out: Vector3): Vector3 {
    const p = this.game.hero.actor.position;
    return out.set(p.x, p.y + 0.9, p.z);
  }

  eyePosition(): Vector3 | null {
    if (this.mode?.eye && !this.photo.active) return this.mode.eye();
    return null;
  }

  onCameraChange(): void {
    this.mode?.onCameraChange?.();
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    if (this.photo.active) this.photo.close();
    if (this.mode) this.mode.leave();
    this.mode = null;
  }
}

const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * An iris wipe in HUD rects: `open` 0 = black, 1 = clear. A circle around `at` (default the
 * middle), drawn as one ink span per row on each side.
 */
export function drawIris(ui: UiCanvas, open: number, at: { x: number; y: number } | null): void {
  if (open >= 1) return;
  const cx = at?.x ?? ui.w / 2;
  const cy = at?.y ?? ui.h / 2;
  const reach = Math.hypot(Math.max(cx, ui.w - cx), Math.max(cy, ui.h - cy));
  const r = Math.max(0, open * open * reach);
  for (let y = 0; y < ui.h; y += 1) {
    const dy = y + 0.5 - cy;
    const half = r > Math.abs(dy) ? Math.sqrt(r * r - dy * dy) : -1;
    if (half < 0) {
      ui.rect(0, y, ui.w, 1, 'ink');
      continue;
    }
    const x0 = Math.max(0, Math.round(cx - half));
    const x1 = Math.min(ui.w, Math.round(cx + half));
    if (x0 > 0) ui.rect(0, y, x0, 1, 'ink');
    if (x1 < ui.w) ui.rect(x1, y, ui.w - x1, 1, 'ink');
  }
}
