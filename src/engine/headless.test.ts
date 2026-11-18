// Engine.headless (docs/engine/headless.md): the engine and a game in Node, with no page, GPU or
// browser globals. Nothing here stubs `window`, `document`, `location` or `ProgressEvent`: the
// engine must not need them (a grep in this file's last test keeps it so).
import { readFileSync } from 'node:fs';
import { Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Playground } from '../game/playground';
import { setAssetReader } from './assets';
import { Engine, type Game, type GameContext } from './Engine';
import { nodeAssets } from './node';
import { GpuSwarm } from './render/gpuSwarm';
import type { HeadlessView } from './render/headlessView';
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

  it('fills the whole window by default, at every shape the 52in1 hub checks', async () => {
    const engine = await Engine.headless(new Dice());
    expect(engine.state().aspect).toBe('fill');
    for (const [width, height] of [[1600, 900], [2100, 900], [1200, 900], [390, 844], [960, 720]] as const) {
      (engine.renderer as HeadlessView).setViewport({ width, height, dpr: 1 });
      const f = engine.renderer.framing;
      expect([f.offsetX <= 0, f.offsetY <= 0, f.offsetX + f.cssWidth >= width, f.offsetY + f.cssHeight >= height], `${width}×${height}: no bars`).toEqual([true, true, true, true]);
      expect(f.integer && f.canvasWidth === f.artWidth * f.scale, 'square, integer-scaled art pixels').toBe(true);
    }
    engine.dispose();
  });

  it('a recording replays on its own viewport', async () => {
    const engine = await Engine.headless(new Dice(), { viewport: { width: 1280, height: 720, dpr: 1 }, aspect: 'fill' });
    expect(engine.renderer.resolution).toEqual({ width: 427, height: 240 });
    engine.step(10);
    const rec = engine.recording()!;
    expect(rec.view).toEqual({ width: 1280, height: 720, dpr: 1 });
    const end = engine.fingerprint();
    engine.dispose(); // one engine at a time
    const other = await Engine.headless(new Dice(), { aspect: 'fill' });
    expect(other.renderer.resolution).toEqual({ width: 480, height: 270 });
    await other.replay(rec, () => other.loadGame(new Dice()));
    expect(other.renderer.resolution).toEqual({ width: 427, height: 240 });
    expect(other.fingerprint()).toBe(end);
    other.dispose();
  });

  it('the HUD lays out on the view from the first frame, live, stepped and replayed (a menu click lands)', async () => {
    /** A menu with one button near the right edge: clicks count when the pointer is on it. */
    class Menu implements Game {
      readonly name = 'Menu';
      clicks = 0;
      /** The HUD width every frame's update saw. */
      widths: number[] = [];
      setup(): void {}
      update(ctx: GameContext): void {
        const { hud, input } = ctx;
        const res = ctx.engine.renderer.resolution; // where the pointer is, as Riftlight's Pointer maps it
        const x = ((input.pointer.x + 1) / 2) * res.width;
        const y = ((1 - input.pointer.y) / 2) * res.height;
        const [bx, by, bw, bh] = [hud.width - 60, 20, 40, 16];
        this.widths.push(hud.width);
        hud.clear();
        hud.rect(bx, by, bw, bh, 'sand');
        if (input.wasPressed('MouseLeft') && x >= bx && x < bx + bw && y >= by && y < by + bh) this.clicks++;
      }
      cameraTarget(ctx: GameContext) {
        return ctx.camera.focus.clone();
      }
      fingerprint(): string {
        return `${this.clicks}`;
      }
    }
    const view = { width: 1200, height: 900, dpr: 1 }; // 4:3: not the 480×270 a HUD starts at
    const game = new Menu();
    const engine = await Engine.headless(game, { viewport: view, aspect: 'fill' });
    const { width } = engine.renderer.resolution;
    expect(width).not.toBe(480);
    expect([engine.hud.width, engine.hud.height], 'before any frame').toEqual([width, engine.renderer.resolution.height]);
    for (let i = 0; i < 12; i++) {
      engine.input.setPointer(((width - 50 + 0.5) / width) * 2 - 1, 1 - (28.5 / engine.renderer.resolution.height) * 2);
      engine.input.setKey('MouseLeft', i % 4 === 1); // pressed on frames 1, 5 and 9
      engine.step(1);
    }
    expect(game.clicks, 'the button is where the pointer maps').toBe(3);
    expect(new Set(game.widths)).toEqual(new Set([width]));
    const rec = engine.recording()!;
    const end = engine.fingerprint();
    engine.dispose(); // one engine at a time
    const other = await Engine.headless(new Menu(), { aspect: 'fill' }); // 16:9: a 480×270 HUD
    let replayed: Menu | null = null;
    await other.replay(rec, () => other.loadGame((replayed = new Menu())));
    expect(new Set(replayed!.widths), 'every replayed frame lays out on the recorded view').toEqual(new Set([width]));
    expect(replayed!.clicks).toBe(3);
    expect(other.fingerprint(), 'the replay ends where the run did').toBe(end);
    other.dispose();
  });

  it('step() is the tool’s clock: it advances a paused game (the render loop is what pauses)', async () => {
    const engine = await Engine.headless(new Dice(), { seed: 2 });
    engine.paused = true;
    const t0 = engine.time;
    engine.step(10);
    expect(engine.time - t0).toBeCloseTo(10 / 60, 9);
    expect(engine.paused).toBe(true);
    engine.dispose();
  });

  it('an asset load without a reader names the one to pass', async () => {
    setAssetReader(null); // the process has none yet (a reader set earlier stays: the Playground's)
    const engine = await Engine.headless(new Dice());
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
    new GpuSwarm({ count: 8 }).update(engine.renderer, 1 / 60); // no GPU: nothing to dispatch
    engine.dispose();
  });

  it('player settings apply but are not stored, the debug panel never opens, transitions run on steps', async () => {
    const engine = await Engine.headless(new Dice(), { aspect: 'fixed' });
    expect(engine.settings.key, 'no key given: nothing stored').toBeNull();
    expect(engine.audio.persist).toBe(false);
    engine.settings.set({ pixelSize: 'chunky', debugInfo: true });
    expect(engine.renderer.resolution).toEqual({ width: 320, height: 180 });
    expect(engine.input.vibration).toBe(1);
    engine.settings.set({ vibration: 0.4 }); // rumbles follow the player's vibration
    expect(engine.input.vibration).toBe(0.4);
    engine.settings.set({ vibration: undefined });
    expect(engine.input.vibration).toBe(1);
    expect(engine.debugShown).toBe(false);
    engine.showDebug(true);
    expect(engine.debugShown).toBe(false);
    let covered: boolean | null = null;
    void engine.screen.cover('fade', { duration: 0.25 }).then((done) => (covered = done));
    engine.step(10);
    await Promise.resolve();
    expect(covered).toBeNull();
    engine.step(10);
    await new Promise((r) => setTimeout(r, 0));
    expect(covered).toBe(true);
    await engine.replay(engine.recording()!, () => engine.loadGame(new Dice()));
    expect(engine.audio.persist, 'a replay gives back what was there').toBe(false);
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
