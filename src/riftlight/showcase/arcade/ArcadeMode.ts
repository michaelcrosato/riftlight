/**
 * The arcade cabinet in Emberfall: Rift Runner (`ArcadeStage`) built 1 km west of the town,
 * played with the `side` camera under a 16-bit + CRT look, and thrown away when the hero
 * walks off. A finished run pays a little gold and keeps the best time in the save
 * (`save.showcase.arcade`, autosaved).
 */
import { Color, Vector3 } from 'three/webgpu';
import type { CameraConfig } from '../../../engine';
import type { UiCanvas } from '../../ui/kit';
import { recordArcadeRun, showcaseOf } from '../save';
import type { Showcase, ShowcaseMode } from '../Showcase';
import { moveInput } from '../visitor';
import { arcadeAutopilot } from './autoplay';
import { ARCADE_AGAIN, ARCADE_KEYS, ArcadeStage, arcadeZoom, readArcadeInput } from './ArcadeStage';
import { ARCADE_SONG } from './stage';

/** Where the stage is built: far from the town and from any level (levels build around 0, 0). */
export const ARCADE_ORIGIN = new Vector3(-1000, 0, 0);

export class ArcadeMode implements ShowcaseMode {
  readonly id = 'arcade' as const;
  readonly filters = ['16bit', 'crt'] as const;
  stage: ArcadeStage | null = null;
  wantsLeave = false;
  private readonly input = moveInput();
  private readonly sky = new Color(0x41a6f6);

  constructor(private readonly host: Showcase) {}

  camera(): CameraConfig {
    return { preset: 'side', viewHeight: 12 };
  }

  async enter(): Promise<void> {
    const game = this.host.game;
    const ctx = this.host.ctx;
    const record = showcaseOf(game.save).arcade;
    record.plays++;
    this.wantsLeave = false;
    const stage = new ArcadeStage(ctx, {
      origin: ARCADE_ORIGIN,
      best: record.best,
      onFinish: (run) => {
        const r = recordArcadeRun(record, run);
        game.addGold(r.reward);
        game.autosave('arcade');
        return { best: record.best, newBest: r.newBest, reward: r.reward };
      },
    });
    this.stage = stage;
    await stage.build();
    ctx.scene.add(stage.root);
    ctx.scene.background = this.sky;
    stage.start();
    ctx.audio.playMusic(ARCADE_SONG, 'showcase:arcade');
  }

  leave(): void {
    this.stage?.dispose();
    this.stage = null;
    this.wantsLeave = false;
  }

  fixedUpdate(dt: number): void {
    const input = this.host.ctx.input;
    // the Circle that closed the pause (photo mode) is not a crouch while it is held
    this.stage?.fixedUpdate(dt, this.host.presses.mask(input, readArcadeInput(input, this.input), ARCADE_KEYS));
  }

  update(dt: number): void {
    const stage = this.stage;
    if (!stage) return;
    const input = this.host.ctx.input;
    stage.update(dt);
    // Options, Esc or ≡: the showcase's pause (Resume, Restart, Photo mode, Leave), the run's clock stopped
    if (input.wasPressed('Escape', 'PadStart')) return this.host.openPause();
    if (stage.phase === 'done' && stage.phaseTime > 0.8 && input.wasPressed(...ARCADE_AGAIN)) this.restart();
    input.wheel = 0; // the side view keeps its framing
    this.host.ctx.camera.setZoom(arcadeZoom(this.host.ctx.hud.width / this.host.ctx.hud.height));
  }

  draw(ui: UiCanvas): void {
    this.stage?.drawHud(ui.hud);
  }

  cameraTarget(): Vector3 {
    return this.stage?.cameraTarget() ?? ARCADE_ORIGIN;
  }

  restart(): void {
    if (!this.stage) return;
    showcaseOf(this.host.game.save).arcade.plays++;
    this.stage.autopilot = null;
    this.stage.start();
  }

  /** Let the scripted run play from the start (agents, the e2e suite). */
  autoplay(): void {
    if (!this.stage) return;
    this.restart();
    this.stage.autopilot = arcadeAutopilot();
  }
}
