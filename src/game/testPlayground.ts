/**
 * The Move Playground headless, for the moveset's tests (src/game/playground.*.test.ts): a small
 * script over `engine.input` and `engine.step`, as a player's keys would drive it. Node only (it
 * reads the hero's model from `public/`). Time is game time: `wait(500)` is 30 frames.
 */
import type { Engine } from '../engine';
import type { PlatformerCharacter } from '../engine/character/PlatformerCharacter';
import { Engine as EngineClass, type CameraConfig } from '../engine';
import { nodeAssets } from '../engine/node';
import { Playground } from './playground';

/** The keys a script may hold; `place` lets go of them all. */
const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyF', 'KeyJ', 'ShiftLeft'];

export interface Seen {
  ok: boolean;
  seen: string[];
}

/** The Playground, by default on the third-person camera (yaw 0: W = -Z, S = +Z, D = +X, A = -X); `camera: null` for its own. */
export async function bootPlayground(o: { camera?: CameraConfig | null } = {}): Promise<{ engine: Engine; game: Playground; T: MoveScript }> {
  const game = new Playground();
  const camera = o.camera === undefined ? { preset: 'third' as const } : (o.camera ?? undefined);
  const engine = await EngineClass.headless(game, { seed: 1, camera, assets: nodeAssets() });
  return { engine, game, T: new MoveScript(engine, game) };
}

export class MoveScript {
  constructor(
    readonly engine: Engine,
    readonly game: Playground,
  ) {}

  get hero(): PlatformerCharacter {
    return this.game.hero;
  }

  frames(n: number): void {
    this.engine.step(Math.max(0, Math.round(n)));
  }

  /** Game time in milliseconds. */
  wait(ms: number): void {
    this.frames((ms * 60) / 1000);
  }

  set(keys: string[], down: boolean): void {
    for (const k of keys) this.engine.input.setKey(k, down);
  }

  releaseAll(): void {
    this.set(KEYS, false);
  }

  tap(key: string): void {
    this.engine.input.setKey(key, true);
    this.frames(2);
    this.engine.input.setKey(key, false);
    this.frames(1);
  }

  /** Teleport the feet to `pos` facing `yaw` (0 = +Z, π/2 = +X), keys let go, 8 frames to settle. */
  place(pos: [number, number, number], yaw = 0): void {
    this.set(KEYS, false);
    this.hero.teleport(pos);
    this.hero.facing = yaw;
    this.hero.hvel.set(0, 0, 0);
    this.frames(8);
  }

  /** Step until `pred(hero)` holds, at most `ms` of game time; the states seen on the way. */
  until(pred: (h: PlatformerCharacter) => boolean, ms = 3000): Seen {
    const seen = new Set<string>();
    for (let f = 0; f < (ms * 60) / 1000; f++) {
      seen.add(this.hero.state);
      if (pred(this.hero)) return { ok: true, seen: [...seen] };
      this.frames(1);
    }
    return { ok: false, seen: [...seen] };
  }

  snap() {
    const h = this.hero;
    return { state: h.state, anim: h.anim, feet: h.feet.toArray().map((v) => +v.toFixed(2)), stance: h.stance, jumpKind: h.jumpKind, stats: { ...h.stats } };
  }
}
