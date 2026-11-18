/**
 * `?game=arcade`: the arcade cabinet's side-scroller as a whole `Game`. It is the smallest
 * complete template for a side-scroller on this engine; copy it to start one:
 *
 *   - camera: the `side` preset (ortho, straight side-on, the player locked to its lane),
 *     set by `ARCADE_OPTIONS` (main.ts passes a game's own options to `Engine.start`);
 *   - look: a filter stack (`16bit` colour + `crt` curvature), also in `ARCADE_OPTIONS`;
 *   - the stage: `ArcadeStage` (data in stage.ts: blocks, cracked slabs, coins, the flag),
 *     the hero on the engine's `PlatformerCharacter` with `readArcadeInput`;
 *   - systems: Rapier colliders and triggers, the engine's chiptune player, SFX, particles
 *     and the pixel HUD.
 *
 * Its controls are Riftlight's (`controls`: the engine names them for the device in use, so the
 * hints read "WASD run · Space jump" on a keyboard, "Left stick run · Cross jump" on a pad, "Stick
 * run · B jump" on a phone, whose buttons are `ARCADE_TOUCH_BUTTONS`). Enter, Cross or a tap
 * restarts after the finish; Options, Esc or ≡ pause it (Resume, Restart: `StagePause`, the clock
 * stopped). Agents: `window.__ARCADE__` (`state()`, `autoplay()`).
 */
import { Color, type Vector3 } from 'three/webgpu';
import { type EngineOptions, type Game, type GameContext, MenuInput, type TouchButton } from '../../../engine';
import { MENU_BINDINGS } from '../../game/controls';
import { UiCanvas } from '../../ui/kit';
import { SHOWCASE_CONTROLS } from '../hints';
import { StagePause } from '../pause';
import { moveInput } from '../visitor';
import { arcadeAutopilot } from './autoplay';
import { HeldPresses } from '../held';
import { ARCADE_AGAIN, ARCADE_KEYS, ArcadeStage, arcadeZoom, readArcadeInput } from './ArcadeStage';
import { ARCADE_SONG } from './stage';

/**
 * A side-scroller's buttons on a phone (CSS pixels from a corner): a big B that jumps (as
 * `CONTROLS.jump` names it), A that attacks beside it, ≡ for the pause; the stick runs, and down
 * on it crouches (a ground pound in the air).
 */
export const ARCADE_TOUCH_BUTTONS: readonly TouchButton[] = [
  { label: 'B', code: 'Space', hint: 'jump', at: { x: 62, y: 70, size: 84 } },
  { label: 'A', code: 'KeyJ', hint: 'attack', at: { x: 160, y: 50, size: 58 } },
  { label: '≡', code: 'Escape', at: { x: 26, y: 26, size: 44, corner: 'top-left' } },
];

/** The engine options the arcade is designed for (main.ts: URL options still win). */
export const ARCADE_OPTIONS: Partial<EngineOptions> = {
  camera: { preset: 'side', viewHeight: 12 },
  filters: ['16bit', 'crt'],
  touchButtons: ARCADE_TOUCH_BUTTONS,
};

export class ArcadeGame implements Game {
  readonly name = 'Rift Runner';
  readonly assets = ['assets/hero.glb', 'assets/coin.glb'];
  /** Riftlight's actions and their keys, pad buttons and touch buttons, as the showcase names them: what `{key:jump}` in the hints names. */
  readonly controls = SHOWCASE_CONTROLS;
  stage!: ArcadeStage;
  /** The pause (Options, Esc, ≡), or null. */
  pause: StagePause | null = null;
  private readonly input = moveInput();
  private readonly menu = new MenuInput(MENU_BINDINGS);
  /** The pause's presses (`held.ts`): the Circle that resumed is not a crouch while it is held. */
  private readonly presses = new HeldPresses(Object.values(ARCADE_KEYS).flat());
  private ui: UiCanvas | null = null;
  private best = 0;

  async setup(ctx: GameContext): Promise<void> {
    ctx.scene.background = new Color(ctx.palette.sky);
    this.stage = new ArcadeStage(ctx, {
      canLeave: false, // nothing to leave to: the hints don't promise it
      onFinish: (run) => {
        const newBest = this.best <= 0 || run.time < this.best;
        if (newBest) this.best = run.time;
        return { best: this.best, newBest, reward: 0 };
      },
    });
    await this.stage.build();
    ctx.scene.add(this.stage.root);
    this.stage.start();
    ctx.audio.playMusic(ARCADE_SONG, 'arcade');
  }

  /** The engine runs the course: `window.__ARCADE__` for tools and agents. */
  ready(): void {
    (globalThis as unknown as { __ARCADE__?: unknown }).__ARCADE__ = {
      game: this,
      state: () => ({ phase: this.stage.phase, time: this.stage.time, coins: this.stage.coins, total: this.stage.total, at: this.stage.heroLocal().toArray(), state: this.stage.hero?.hero?.state ?? null }),
      /** Let the scripted run play (Enter restarts first if the course is done). */
      autoplay: (on = true) => {
        if (this.stage.phase === 'done') this.stage.start();
        this.stage.autopilot = on ? arcadeAutopilot() : null;
      },
    };
  }

  dispose(): void {
    this.stage?.dispose();
    delete (globalThis as unknown as { __ARCADE__?: unknown }).__ARCADE__;
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    if (this.pause) return; // the run stands still, its clock too
    this.stage.fixedUpdate(dt, this.presses.mask(ctx.input, readArcadeInput(ctx.input, this.input), ARCADE_KEYS));
  }

  update(ctx: GameContext, dt: number): void {
    const input = ctx.input;
    const events = this.menu.events(input, dt);
    const ui = (this.ui ??= new UiCanvas(ctx.hud));
    ui.device = ctx.engine.controls.device; // the pause's focused row shows the pad's ✕
    ui.padStyle = ctx.engine.controls.style;
    ctx.camera.setZoom(arcadeZoom(ctx.hud.width / ctx.hud.height));
    ctx.hud.clear();
    if (this.pause) {
      this.stage.drawHud(ctx.hud);
      this.pause.draw(ui);
      const pick = this.pause.update(events, input, ctx.hud).pick;
      // what chose a row must not jump once the run goes on, nor crouch while it is held
      this.presses.take(input);
      if (pick) {
        this.pause = null;
        if (pick === 'restart') this.stage.start();
      }
      return;
    }
    this.stage.update(dt);
    if (input.wasPressed('Escape', 'PadStart')) this.pause = new StagePause(['resume', 'restart']);
    else if (this.stage.phase === 'done' && this.stage.phaseTime > 0.8 && input.wasPressed(...ARCADE_AGAIN)) this.stage.start(); // what "again" names
    this.stage.drawHud(ctx.hud);
  }

  cameraTarget(): Vector3 {
    return this.stage.cameraTarget();
  }

  /** The film tool calls this before `place`: no READY/GO wait. */
  skipIntro(): void {
    this.stage.skipIntro();
  }

  // the film tool (npm run film -- arcade-*) drives `hero` and poses `heroModel`
  get hero() {
    return this.stage?.hero?.hero ?? null;
  }

  get heroModel() {
    return this.stage?.hero?.model ?? null;
  }

  status(): string {
    return `${this.stage.phase} ${this.stage.time.toFixed(2)}s · coins ${this.stage.coins}/${this.stage.total}`;
  }
}
