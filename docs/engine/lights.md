# Dynamic lights (`src/engine/render/lights.ts`)

Torches, spells, projectiles, loot beams and glowing monsters all want a light, but every
light a toon material sees is compiled into its shader: adding or removing lights
recompiles every lit material. `ctx.lights` (`LightPool`) solves both: it keeps a **fixed
number of real `PointLight`s** in the scene (quality `low` 4 · `medium` 8 · `high` 16, unused
ones at intensity 0) and hands them, every frame, to the most important of any number of
**light requests**.

```ts
const torch = ctx.lights.request({
  position: [3, 1.6, 4], color: 0xffa040, intensity: 6, radius: 7, // radius = PointLight.distance
  flicker: 'torch',                       // none | torch | candle | brazier | pulse | strobe | spell
});
torch.position.set(4, 1.6, 4);            // move it, recolour it: uniforms only, no recompiles
torch.update({ color: 0xff4040, intensity: 9 });
torch.release();                          // fades out, frees its light

ctx.lights.request({ follow: projectileMesh, color: 0xffb060, intensity: 6, priority: 3 }); // follows an object
ctx.lights.request({ position: at, color: 0xffffff, intensity: 14, radius: 9, lifetime: 0.4, fadeIn: 0.02 }); // a flash
ctx.lights.stats();      // { size, requests, lit, assignments, waiting, updateMs }
ctx.lights.describe();   // every request with its score, slot and fade level
```

- **Assignment.** Each frame a request scores `intensity × priority × proximity` to the
  camera focus (`1 / (1 + (d / max(4, radius))²)`, zero beyond the visible range + its
  radius). The top `size` requests get a light. A request that already holds one scores
  ×1.35 (**hysteresis**), so two similar torches never trade a light back and forth.
- **No pops.** A light changes hands only after its old owner has **faded out**
  (`fadeOut`, default 0.2 s, twice as fast while a new request waits); the new owner
  **fades in** (`fadeIn`, 0.25 s). Fades are smoothstepped; levels never jump by more than
  `dt / fade` per frame (unit-tested).
- **Priority** puts important lights first: the hero's light 8, a projectile 3, a loot beam 2,
  a torch 1. `lifetime` releases flashes by themselves. `follow` + `offset` track an object.
- **Engine-owned.** The pool is created on first use of `ctx.lights` and stays in the scene
  across `loadGame` (its requests are released on unload), so a new level never changes the
  light count. `engine.setQuality()` resizes it: one recompile of lit materials, on purpose.
  `new LightPool({ size, parent })` + `pool.update(dt, focus, range)` makes a private one.
- **Logic is pure.** `LightAssigner` (the slot/fade/hysteresis logic) has no three.js in it
  and is unit-tested in `lights.test.ts`; `riftlight/levels/levelLab.headless.test.ts` checks a
  constant 8 lights in the scene while 24 requests share them, and the `riftlight-levels` e2e
  suite **zero new node builds** while they move and change colour.
- **Cost.** CPU: one pass over the requests per frame. GPU: every lit fragment loops over all
  `size` lights, so cost grows linearly with the pool, which is why quality caps it.
