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
 * Enter restarts after the finish. Agents: `window.__ARCADE__` (`state()`, `autoplay()`).
 */
import { Color, type Vector3 } from 'three/webgpu';
import type { EngineOptions, Game, GameContext } from '../../../engine';
import { moveInput } from '../visitor';
import { arcadeAutopilot } from './autoplay';
import { ArcadeStage, readArcadeInput } from './ArcadeStage';
import { ARCADE_SONG } from './stage';

/** The engine options the arcade is designed for (main.ts: URL options still win). */
export const ARCADE_OPTIONS: Partial<EngineOptions> = {
  camera: { preset: 'side', viewHeight: 12 },
  filters: ['16bit', 'crt'],
};

export class ArcadeGame implements Game {
  readonly name = 'Rift Runner';
  readonly assets = ['assets/hero.glb', 'assets/coin.glb'];
  stage!: ArcadeStage;
  private readonly input = moveInput();
  private best = 0;

  async setup(ctx: GameContext): Promise<void> {
    ctx.scene.background = new Color(ctx.palette.sky);
    this.stage = new ArcadeStage(ctx, {
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
    (window as unknown as { __ARCADE__?: unknown }).__ARCADE__ = {
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
    delete (window as unknown as { __ARCADE__?: unknown }).__ARCADE__;
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    this.stage.fixedUpdate(dt, readArcadeInput(ctx.input, this.input));
  }

  update(ctx: GameContext, dt: number): void {
    this.stage.update(dt);
    if (this.stage.phase === 'done' && this.stage.phaseTime > 0.8 && ctx.input.wasPressed('Enter', 'NumpadEnter')) this.stage.start();
    ctx.hud.clear();
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
