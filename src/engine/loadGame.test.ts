// engine.loadGame headless (docs/engine/game-api.md): levels swap back to the same world, a level
// door works from update() and from a trigger's onEnter, the latest of two loads wins, input made
// while loading never fires, and dispose() during a load lets it settle. Moved from e2e `systems`;
// the page keeps what needs one: GPU memory back to baseline, the first frame after a slow load
// (the live loop's clock), the hotkeys, the DOM after dispose() and checkClean.
import type { BufferGeometry, Material, Mesh, MeshToonNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Playground } from '../game/playground';
import { Sandbox } from '../game/sandbox';
import { Engine, type Game } from './Engine';
import { countObjects } from './lifecycle';
import { nodeAssets } from './node';

const T = 30_000;

/** The world a level leaves behind: what the e2e probe read, minus the GPU's counts. */
function probe(engine: Engine) {
  return { game: engine.game.name, ...engine.physics.counts(), children: engine.scene.children.length, objects: countObjects(engine.scene) };
}

/** Step until `done()`, letting promise callbacks run between frames, as a page's frames do. */
async function stepUntil(engine: Engine, done: () => boolean, what: string, max = 120): Promise<void> {
  for (let f = 0; f < max; f++) {
    if (done()) return;
    engine.step(1);
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`${what} did not happen within ${max} frames`);
}

describe('engine.loadGame (headless)', () => {
  let engine: Engine;
  const load = async (game: Game) => {
    await engine.loadGame(game);
    engine.step(10);
    return probe(engine);
  };

  it(
    'sandbox ⇄ playground ×3: bodies, colliders, controllers, triggers, tags and scene objects return to baseline',
    async () => {
      engine = await Engine.headless(new Playground(), { seed: 1, assets: nodeAssets() });
      const seen: Record<string, ReturnType<typeof probe>[]> = { 'Move Playground': [], Sandbox: [] };
      for (const make of [Sandbox, Playground, Sandbox, Playground, Sandbox, Playground]) {
        const p = await load(new make());
        seen[p.game]!.push(p);
      }
      for (const [name, [first, ...rest]] of Object.entries(seen)) {
        expect(rest.length, name).toBe(2);
        for (const p of rest) expect(p, `${name}: counts return to baseline`).toEqual(first);
      }
      const base = seen['Move Playground']![0]!;
      expect(base.controllers, 'baseline holds exactly one character controller').toBe(1);
      expect(base.triggers, 'and the coin triggers').toBeGreaterThan(0);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the sandbox keeps its textures through toonify: the floor (nearest, toon) and a textured model built and merged',
    async () => {
      await load(new Sandbox());
      const g = engine.game as Sandbox;
      const top = (g.floor.material as Material[])[2] as MeshToonNodeMaterial;
      expect(!!top.map, 'the floor keeps its texture').toBe(true);
      expect([top.map?.magFilter, top.map?.minFilter], 'nearest-filtered').toEqual([1003, 1003]);
      expect(top.isMeshToonNodeMaterial, 'on a toon material').toBe(true);

      type TexMesh = Mesh<BufferGeometry, MeshToonNodeMaterial>;
      const built: TexMesh[] = [];
      g.wall.traverse((o) => {
        const m = o as TexMesh;
        if (m.isMesh && m.material.map) built.push(m);
      });
      const merged = (g.mergedWall as TexMesh[]).filter((m) => m.material.map);
      const all = [...built, ...merged];
      expect([built.length, merged.length], 'one textured mesh built, one merged').toEqual([1, 1]);
      for (const m of all) expect(m.geometry.getAttribute('uv')?.count, 'UVs on every vertex').toBe(m.geometry.getAttribute('position').count);
      expect([...new Set(all.map((m) => m.material.map!.name))], 'both carry the bricks map').toEqual(['tex:bricks']);
    },
    T,
  );

  it(
    'a level door: loadGame from the running game’s update() and from a trigger’s onEnter',
    async () => {
      let pending: Promise<void> | null = null;
      const sandbox = engine.game as Sandbox;
      const update = sandbox.update.bind(sandbox);
      sandbox.update = (ctx, dt) => {
        update(ctx, dt);
        if (!pending) pending = engine.loadGame(new Playground());
      };
      await stepUntil(engine, () => pending !== null, 'update() calling loadGame');
      await pending;
      expect(engine.game.name, 'loadGame from update()').toBe('Move Playground');

      pending = null;
      const f = (engine.game as Playground).hero.feet;
      engine.physics.trigger({ sphere: 1.5 }, [f.x, f.y + 0.8, f.z], { tag: 'character', once: true, onEnter: () => (pending = engine.loadGame(new Sandbox())) });
      await stepUntil(engine, () => pending !== null, 'the trigger’s onEnter');
      await pending;
      expect(engine.game.name, 'loadGame from a trigger’s onEnter').toBe('Sandbox');
      engine.step(5);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'two loads at once: the latest wins and nothing of the other level is left over',
    async () => {
      const base = await load(new Playground());
      await Promise.allSettled([engine.loadGame(new Sandbox()), engine.loadGame(new Playground())]);
      engine.step(10);
      expect(probe(engine), 'concurrent loadGame(sandbox) + loadGame(playground): only the playground is left').toEqual(base);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'presses made while a level loads do not fire once it runs',
    async () => {
      const game = new Playground();
      const setup = game.setup.bind(game);
      game.setup = async (ctx) => {
        engine.input.setKey('Space', true); // pressed while the level loads
        await setup(ctx);
      };
      await engine.loadGame(game);
      engine.step(18); // the page held it for ~300 ms
      engine.input.setKey('Space', false);
      engine.step(2);
      expect(game.hero.stats.jumps, 'no jump from a press made while loading').toBe(0);
    },
    T,
  );

  it(
    'engine.dispose() during a loadGame: the load settles and the world is freed after its setup',
    async () => {
      const p = engine.loadGame(new Sandbox());
      await new Promise((r) => setTimeout(r, 0));
      engine.dispose();
      const settled = await p.then(
        () => 'resolved',
        (err: unknown) => `rejected: ${(err as Error)?.message}`,
      );
      expect(settled).toBe('resolved');
      await new Promise((r) => setTimeout(r, 50));
      expect(() => engine.physics.counts(), 'physics is freed').toThrow();
      expect(engine.errors).toEqual([]);
      await expect(engine.loadGame(new Playground()), 'a disposed engine loads nothing').rejects.toThrow(/disposed/);
    },
    T,
  );
});
