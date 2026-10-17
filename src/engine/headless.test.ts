// Engine.headless (docs/engine/headless.md): the engine and a game in Node, with no page, GPU or
// browser globals. Nothing here stubs `window`, `document`, `location` or `ProgressEvent`: the
// engine must not need them (a grep in this file's last test keeps it so).
import { readFileSync } from 'node:fs';
import { Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Playground } from '../game/playground';
import { Engine, type Game, type GameContext } from './Engine';
import { nodeAssets } from './node';
import { drawSheet } from './render/sprites';
import type { Recording } from './replay';

const T = 30_000;

/** A small game with save-states: one dynamic box and a counter fed by `ctx.random`. */
class Dice implements Game {
  readonly name = 'Dice';
  body = 0;
  rolls: number[] = [];
  setup(ctx: GameContext): void {
    ctx.physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [10, 0.5, 10] });
    this.body = ctx.physics.addDynamicBox({ position: [0, 4, 0], halfExtents: [0.5, 0.5, 0.5] }).handle;
    ctx.scene.add(new Mesh());
  }
  fixedUpdate(ctx: GameContext): void {
    if (ctx.random.next() < 0.05) ctx.physics.world.getRigidBody(this.body)!.applyImpulse({ x: ctx.random.range(-1, 1), y: 2, z: 0 }, true);
  }
  update(ctx: GameContext): void {
    this.rolls.push(Math.floor(ctx.random.next() * 6) + 1);
    if (this.rolls.length > 16) this.rolls.shift();
  }
  cameraTarget(ctx: GameContext) {
    const p = ctx.physics.world.getRigidBody(this.body)!.translation();
    return ctx.camera.focus.clone().set(p.x, p.y, p.z);
  }
  fingerprint(): string {
    return this.rolls.join('');
  }
  snapshot(): unknown {
    return { body: this.body, rolls: [...this.rolls] };
  }
  restore(_ctx: GameContext, state: unknown): void {
    const s = state as { body: number; rolls: number[] };
    this.body = s.body;
    this.rolls = [...s.rolls];
  }
}

describe('Engine.headless', () => {
  it(
    'boots the Playground, moves and jumps the hero by input, and replays the recording',
    async () => {
      const engine = await Engine.headless(new Playground(), { seed: 7, assets: nodeAssets() });
      const s0 = engine.state();
      expect(s0).toMatchObject({ ready: true, backend: 'headless', game: 'Move Playground' });
      expect(engine.gpu).toBeNull();
      expect(engine.manual).toBe(true);
      await expect(engine.renderer.capture()).rejects.toThrow(/headless: no pictures/);

      const script: [number, string, boolean][] = [
        [0, 'KeyD', true],
        [50, 'Space', true],
        [52, 'Space', false],
        [90, 'KeyD', false],
        [95, 'KeyW', true],
        [160, 'KeyW', false],
      ];
      const start = s0.target;
      let top = start[1]!;
      for (let f = 0; f < 200; f++) {
        for (const [at, code, down] of script) if (at === f) engine.input.setKey(code, down);
        engine.step(1);
        top = Math.max(top, engine.state().target[1]!);
      }
      const end = engine.state().target;
      expect(Math.hypot(end[0]! - start[0]!, end[2]! - start[2]!), 'the hero walked').toBeGreaterThan(2);
      expect(top - start[1]!, 'the hero jumped').toBeGreaterThan(0.5);
      expect(engine.errors).toEqual([]);

      const live = engine.fingerprint();
      const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
      expect(rec.view).toEqual({ width: 960, height: 540, dpr: 1 });
      await engine.replay(rec, () => engine.loadGame(new Playground()));
      expect(engine.fingerprint(), 'the replay ends where the run did').toBe(live);

      // one frame's keys edited: the hero ends somewhere else
      const edited = structuredClone(rec) as { frames: Recording['frames'][number][] } & Recording;
      edited.frames[60] = { ...edited.frames[60]!, held: [] };
      await engine.replay(edited, () => engine.loadGame(new Playground()));
      expect(engine.fingerprint()).not.toBe(live);
      engine.dispose();
    },
    T,
  );

  it(
    'keeps a game’s fingerprint across a snapshot through JSON',
    async () => {
      const engine = await Engine.headless(new Dice(), { seed: 3 });
      engine.step(90);
      const saved = JSON.stringify(await engine.snapshot());
      engine.step(120);
      const a = engine.fingerprint();
      await engine.restore(JSON.parse(saved));
      engine.step(120);
      expect(engine.fingerprint()).toBe(a);
      expect(engine.state().backend).toBe('headless');
      engine.dispose();
    },
    T,
  );

  it('a recording replays on its own viewport', async () => {
    const engine = await Engine.headless(new Dice(), { viewport: { width: 1280, height: 720, dpr: 1 }, aspect: 'fill' });
    expect(engine.renderer.resolution).toEqual({ width: 427, height: 240 });
    engine.step(10);
    const rec = engine.recording()!;
    expect(rec.view).toEqual({ width: 1280, height: 720, dpr: 1 });
    const other = await Engine.headless(new Dice(), { aspect: 'fill' });
    expect(other.renderer.resolution).toEqual({ width: 480, height: 270 });
    await other.replay(rec, () => other.loadGame(new Dice()));
    expect(other.renderer.resolution).toEqual({ width: 427, height: 240 });
    expect(other.fingerprint()).toBe(engine.fingerprint());
    engine.dispose();
    other.dispose();
  });

  it('an asset load without a reader names the one to pass', async () => {
    const game = new Dice();
    const engine = await Engine.headless(game);
    await expect(engine.context.loadModel('assets/not-loaded-yet.glb')).rejects.toThrow(/nodeAssets\(\)/);
    engine.dispose();
  });

  it('every page-only path is guarded: camera swaps, hook errors, the HUD, drawn sheets', async () => {
    class Fragile extends Dice {
      fail = false;
      override update(ctx: GameContext): void {
        if (this.fail) throw new Error('boom');
        super.update(ctx);
      }
    }
    const engine = await Engine.headless(new Fragile(), { viewport: { width: 1280, height: 720, dpr: 1 }, aspect: 'fill' });
    engine.setCamera({ preset: 'side' }); // reads pointer lock and syncs the URL in a page
    expect(engine.state().cameraRig.preset).toBe('side');
    engine.setCamera({ preset: 'iso' });
    engine.step(5);
    expect([engine.hud.width, engine.hud.height], 'the HUD lays out on the view, not 480×270').toEqual([427, 240]);
    // a hook throwing in a replay is reported (no error box without a page) and the replay goes on
    const rec = engine.recording()!;
    await engine.replay(rec, () => engine.loadGame(Object.assign(new Fragile(), { fail: true })));
    expect(engine.errors).toEqual(['Error: boom']);
    const sheet = drawSheet({ frame: [16, 8], frames: 5, cols: 4 }, () => {
      throw new Error('nothing is drawn headless');
    });
    const image = sheet.texture.image as { width: number; height: number };
    expect([sheet.cols, sheet.rows, sheet.frames, image.width, image.height]).toEqual([4, 2, 5, 64, 16]);
    engine.dispose();
  });

  it('the headless tests stub no browser global', () => {
    const stub = /stubGlobal|\b(window|document|location|ProgressEvent)\s*(\?\?)?=([^=]|$)/m;
    for (const file of ['./headless.test.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/const stub = .*\n/, '');
      expect(src.split('\n').filter((l) => stub.test(l)), file).toEqual([]);
    }
  });
});
