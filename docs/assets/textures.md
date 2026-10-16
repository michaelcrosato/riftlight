# Textures (`src/engine/texture/`, `npm run tex`)

The model format, checks and style rules these follow: docs/ASSETS.md. Importing PNG sheets: docs/assets/importing.md *Pixel-art sheets*.

Pixel-art textures are data too: a `TextureDef` lists **layers** drawn in order onto a grid of
texels, in its own palette slots. `bakeTexture` turns it into palette indices and RGBA, headless
and pure; the converters hand it to the renderer, a `SpriteBatch` or the HUD.

```ts
import { textureDef } from '../helpers';

export const bricks = textureDef({
  id: 'bricks',
  about: 'Stone bricks in courses over dark mortar, a lit top edge on each',
  tags: ['stone', 'wall', 'surface'],
  size: [16, 16], // texels; powers of two when it tiles
  tile: true, // seamless: patterns wrap; the check measures drawn layers' seams
  palette: { mortar: 'night', stone: 'slate', stone2: 'mist' },
  layers: [{ pattern: 'bricks', colors: ['mortar', 'stone', 'stone2'], w: 8, h: 4, seed: 2 }],
});
```

**Layers:**

| layer | draws |
| --- | --- |
| `{ pixels: [...rows], legend: { k: 'slot' }, at?, mirror?: 'x' \| 'y' }` | rows of characters as `hud.sprite` takes them; `.` or a space is transparent; `mirror` adds the rows mirrored right (`x`) or below (`y`) |
| `{ pattern, colors: slot \| [slots], seed?, dither?, ...params }` | a seeded generator over a ramp of slots, dark to light; periodic when the def tiles; `dither` blends between steps with a 4×4 ordered dither |
| `{ path: 'M … Z', fill?, stroke? }` | an SVG path (M L H V C Q Z, the model `slab` subset) in texel units, even-odd fill, no anti-aliasing |
| `{ outline: slot }` | a 1-texel outline round every opaque texel, on the transparent side |

**Patterns** (`PATTERNS` in `patterns.ts` lists their parameters with default, min and max):

| pattern | parameters | draws |
| --- | --- | --- |
| `noise` | `scale` 4, `octaves` 3 | value noise over the ramp: dirt, stone, foliage |
| `bricks` | `w` 8, `h` 4, `mortar` 1, `offset` 0.5, `bevel` 1 | courses; joints in the first slot, bricks in the rest, a lit top edge |
| `tiles` | `w` 8, `h` 8, `mortar` 1, `offset` 0, `bevel` 1 | square tiles, joints in the first slot |
| `planks` | `w` 4, `gap` 1, `length` 16, `grain` 0.3 | boards along x, gaps and butt joints in the first slot, a darker grain |
| `cobbles` | `cells` 4, `gap` 1 | Voronoi stones, joints in the first slot |
| `stripes` | `width` 2, `dir` y / x / diag | bands cycling through the slots |
| `checker` | `cell` 1 | the first and last slot |
| `scatter` | `count` 12, `size` 1, `shape` dot / blade / star | an overlay of dots, blades or stars |
| `cracks` | `count` 3, `length` 8 | an overlay of random-walk cracks in the first slot |
| `gradient` | `dir` y / x / radial | light to dark: down, left to right, or from the centre out |

When the texture tiles, every pattern but `gradient` wraps without a seam by construction: noise
on a wrapping lattice, stones, shapes and cracks that wrap, and layouts that fit a whole number
of cells (16 texels of 6-texel bricks are 3 bricks of 5 or 6, never a sliver on the edge; courses
that shift come in pairs). Pixels and paths are yours to make meet. A pattern's `seed` is its own:
adding or removing another layer changes nothing else.

**The loop** is the models' one: `npm run tex -- find wood` (ids, sizes, files), edit the def in
`src/engine/texture/library/<family>.ts` or a draft `.ts` file, `npm run tex -- check` (in
`scripts/check.sh`), then look: `npm run tex -- sheet bricks` writes `.scratch/tex/bricks.png`
(the texture at 1× and enlarged, a 3×3 tiling when it tiles, its frames, palette and check), and
`npm run tex -- zoo all` draws every texture at one scale, tiled 3×3 where it tiles.
`--palette slot=colour` bakes another palette.

**Problems** (`check` exits 1 on all of them; the converters throw a `TextureError` on every one
but a missing `about` or `tags`): a size that isn't two whole numbers from 1 to 1024; no palette,
or over 255 slots; an unknown slot, or a colour that isn't a PALETTE name; no layers, or a layer
that isn't exactly one of the four kinds, or sets a key its kind doesn't take; a pixels layer
without a legend, with a character its legend doesn't name, ragged rows, a bad `at` or `mirror`;
an unknown pattern, an empty `colors`, a parameter outside its range (or a fraction where it
counts texels), a seed that isn't a whole number; a malformed path; frames that don't divide the
width; a bake that re-binds a slot the palette lacks; no `about` or `tags`. **Warnings** are what
won't read at 480×270:

- a seam: a tiling texture with pixels, a path or a gradient whose colour jumps further across the
  wrap than across any line inside it;
- salt and pepper: over 15% of the opaque texels have no 4-neighbour of their colour (they read as
  noise and shimmer as the camera zooms);
- a tiling size that isn't a power of two;
- palette slots and legend keys nobody uses.

**In a game:**

```ts
import { hudSprite, SpriteBatch, spriteSheet, textureMap, toonMaterial } from './engine';

const wall = toonMaterial(0xffffff, { map: textureMap('bricks') }); // nearest, repeat-wrapped, shared
const coins = new SpriteBatch(spriteSheet('coin-spin'), { capacity: 64 }); // 4 frames, left to right
const icon = hudSprite('gem-icon'); // rows and colours for hud.sprite
hud.sprite(8, 8, icon.rows, icon.colors, { scale: 2 });
```

`textureMap` is cached per def and palette and marked `userData.shared`, so level unloads keep it.
On a sprite sheet an outline stays inside each frame; patterns and paths don't know about frames,
so draw frames with pixels.
Every converter takes `{ palette, catalog }`; a game adds textures with `TEXTURE_LIBRARY.add(def)`
or a `TextureCatalog` of its own (`buildModel(id, { textures })` for models).

**On models:** a part's `tex` (docs/ASSETS.md *The format*), as `brick-wall` does:

```ts
parts: (p) => [
  { box: [p.length!, p.height!, 0.3], at: [0, p.height! / 2, 0], tex: 'bricks', name: 'wall' },
  { box: [p.length! + 0.1, 0.12, 0.42], at: [0, p.height! + 0.06, 0], c: 'cap', name: 'coping' },
],
```

The texture brings its own colours (the part's slot isn't drawn); each texture is one material,
on white. The model sheets draw texels in every view, the palette panel lists the textures,
and `npm run tex -- sheet` shows a tiling texture on a cube and a cylinder at game scale.
`mergeStaticMeshes` keeps the UVs.

## Texel density (Gate B)

How dense texels may be before they shimmer was measured in the real renderer (Gate B, the
plan's §5; `npm run build && npm run gate-b`, `src/lab/gateB.ts`). A floor of `cobbles`, a wall
of `bricks` and crates of `planks` were stepped frame by frame through:

- Riftlight's settings-wheel zoom from fully out (0.6, then ×1.08 steps to 1.6: the stops a
  player reaches scrolling in from the clamp), each step eased as the game eases it until it is
  within 1e-3 of its goal, at the level and town zooms, on landscape and portrait screens;
- a crate sliding at 2 m/s;
- a pan.

A frame's score is the share of pixels that changed since the frame before, with the camera's
whole-pixel snap undone (so a snap counts as a shift, not as flicker). A run's *excess flicker*
is that minus the same scene in the textures' mean colours, and a zoom step scores the mean of
its frames. The floor fills most of the frame, so the sweep scores the floor's texture (cobbles)
in effect; the wall and crates are judged in the filmstrips. The pass line sits a quarter of the
way from a calm texture (two-colour blobs at 8 texels per metre) to a bad one (a 1-texel checker
at 32), each scored by its mean step; a density passes when every one of its 52 steps is under
the line.

| texels per metre | worst zoom step (pass ≤ 5.97%) | mean step | sliding crate (pass ≤ 0.049%) |
| --- | --- | --- | --- |
| 8 | **5.42%** pass | 2.99% | 0.014% pass |
| 12 | 7.95% | 4.45% | 0.025% pass |
| 16 | 10.25% | 5.83% | 0.035% pass |
| 20 | 12.36% | 7.13% | 0.042% pass |
| calm (8), bad (32) | 1.67%, 30.01% | 0.97%, 20.96% | 0.008%, 0.173% |

- **The worst step** is the landscape level zoom's most zoomed-out one (0.65 → 0.70, 11.7–12.6
  art pixels per metre), where a texel at 8 is about 1.5 pixels and at 16 under one.
- **The line is a choice.** The plan sets one line a quarter of the way from calm to bad without
  saying how each becomes one number; their mean steps are used. Two other readings pass 12 as
  well: a line per step (calm and bad at that step: 12's worst is 0.89 of the way to it, 16's
  1.21) and a line from the worst steps (8.76%). 12's filmstrips go to fine noise at the most
  zoomed-out steps, so the stricter reading is kept.
- **The pan** scores 0 everywhere: the rig snaps to whole art pixels.
- **Both backends** (WebGPU and the WebGL 2 fallback the engine had then, both SwiftShader here)
  measured the same to two decimals.

So `DEFAULT_TEXEL` is **8**: floors, walls and props the camera zooms over. A model that moves
(and is never a large surface) may set `texel` up to `MOVING_TEXEL` = 20, the densest measured,
which passed the crate test; it shimmers while the camera zooms like a 20-texel surface does, so
keep such models small on screen. Draw textures for 8: a 16-texel tile covers 2 m, so a brick of
8 × 4 texels is 1 × 0.5 m.

**Screen a surface before a level lays it.** `npm run build && npm run gate-b -- --quick
--floors <id>,<draft.ts>` lays each texture as the scene's floor (in place of the pinned
cobbles, against a flat floor in its own mean colour) and reads it against the same line, all
three ways; `--quick` runs only the landscape level sweep, where the worst step has always been
(`<out>/screen.json` and a filmstrip per floor; `--help` has the rest). A floor fills most of the
frame, so a wall texture screened as a floor is judged strictly. The score counts pixels that
change, so what drives it is how many neighbouring texels differ in colour, not by how much:
over 18 textures the worst step at 8 was 0.166 × that share (the share of texel pairs, across and
down, of different colours) to within 0.2 points, which puts the line at a share of about 36%.
Fewer edges is the fix: fewer colours or larger shapes. Lower contrast does nothing (cobbles with
navy joints instead of ink scored the same 7.57%). The library's level surfaces at 8 (WebGPU;
the line 5.97%; the pinned 0.22 cobbles, the control, 5.42% as recorded):

| texture | edge share | worst step | mean step | |
| --- | --- | --- | --- | --- |
| dirt, ice, flagstones, grass | 16–20% | 2.60–3.37% | 1.67–2.11% | pass |
| floor-tiles, moss, metal-plates, stone | 27–33% | 4.68–5.41% | 2.86–3.38% | pass |
| bricks | 42% | 7.21% | 4.43% | **fail** as a floor (it passed as the record's wall) |
| cobbles | 46% | 7.57% | 4.71% | **fail** |

Both fail only the plan's reading (per step ×0.78 and ×0.83; under the worst-steps line). Bricks
pass without the bevel (`bevel: 0`, two brick tones: 5.35%). Cobbles need both rims gone: without
the lit rim 6.07%, without the shadow rim 6.26%; stone on joint in two colours 4.75%, or rimless
stones in two tones as the 0.22 cobbles were 4.51%.

Riftlight's levels take the passing surfaces as floors and bricks and stone as walls (docs/game/mechanics.md
*Themes and props*). Their cobbles floors bind both rims to the stone's tone (a binding, so the
library's cobbles keep their rims): stones on joints in two colours, 27% of texel pairs differing,
screened at 4.50% worst step (mean 2.83%) as the fit predicts. Gravewell's metal plates, the
busiest of the theme floors (30%), bind the lit edge to the plate's tone (20%). The share is cheap to
check where a screening isn't: `src/riftlight/levels/levels.test.ts` bakes every theme's floor in
its tones and in rift shifts of them and holds it under 33%, a margin under the line. Walls are
held to a looser 45%: a wall is a small part of the frame, so the sweep's score is the floor's,
and Gate B judged its wall by the filmstrips, where bricks (42%) read clean at 8. The bound keeps a
busier wall from creeping in unscreened.
