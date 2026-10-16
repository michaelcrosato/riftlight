# Procedural generation (`src/engine/procgen/`)

```ts
const noise = createNoise(7);                          // seeded simplex: n2, n3, fbm2 (octaves), ridged2 (crests)
const land = new Terrain({ size: [40, 30], cells: [80, 60] });
land.generate((x, z) => 4 * noise.fbm2(x * 0.05, z * 0.05, { octaves: 5, gain: 0.5 }));
land.erode({ droplets: 4800 });                         // hydraulic erosion, about one drop per grid point
land.attach(physics);                                   // a Rapier heightfield (again after any change)
scene.add(land.mesh); land.heightAt(x, z);              // flat-shaded, coloured by height and slope

const wfc = new Wfc(patternTiles([{ pattern: ['#.#', '#..', '###'] }, ...]), 12, 8, { seed: 3, border: '###' });
wfc.run();                                              // or wfc.step() per frame to watch; wfc.result[x + y * 12]

const { branches, leaves } = turtle(expand(PLANTS.tree.system, 6, seed), PLANTS.tree.turtle);
```

`procgen/noise.ts` is seeded gradient noise (2D/3D simplex) and its fractal sums: `fbm2` adds
octaves (each twice the frequency, `gain` the strength), `ridged2` folds each layer into a crest.
`procgen/terrain.ts` samples a height function on a grid and draws it as flat-shaded triangles
coloured by `bands` (height) and `steep` (slope); its cells are split along the same diagonal as
Rapier's heightfield, so `heightAt`, the mesh and `attach`'s collider agree. `erode` rolls
droplets downhill (default one per grid point; they dig while fast and falling, never below
where they now are, drop soil where they slow, lay down what is left where they dry up), in a
height scale normalised to the steepest step, so the result does not depend on units; `margin`
keeps that many edge points exactly as they are (where the land meets a floor). `procgen/wfc.ts` is the tiled wave function collapse: tiles with four edge
sockets (or `patternTiles` from square patterns, turned four ways), least-entropy observation,
propagation, restarts on contradiction, a `border` socket and `fixed` cells (which may break the
border: a way in). `procgen/lsystem.ts` rewrites strings (stochastic rules by probability,
seeded) and walks them with a 3D turtle (F f + − & ^ \ / | [ ] ! L) into branches and leaves,
with tropism; `PLANTS` holds a bush, a fern, a weed and a tree.
