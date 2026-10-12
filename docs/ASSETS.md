# Models and textures as data

Objects in a game are **plain data** that agents write, check and look at, then adjust: a
`ModelDef` of keyed primitives. There is no modelling tool, and a model is text, never a binary
file. The engine compiles a def into toon meshes at runtime; `npm run model` measures and draws it
without a browser; the Asset Lab (`/asset-lab.html`) shows it in the real renderer. The plan behind
it, with its measurements and what is still to come (imports, traces), is
[docs/plans/asset-system.md](plans/asset-system.md).

How it measures so far ([Gate A](plans/gate-a.md), twice): an agent writing a ModelDef spends about
what one writing code on the town `Kit` spends (R = 0.98, then 1.02), less when it composes library
models (the campfire, 0.84), and the judges still preferred the Kit's models. They lost on colour
(fixed by the checks below) and on a flame that read brown. The library is where ModelDefs pay; the
plan builds it next.

```
library/*.ts ──► ModelDef (parts, palette slots, params) ──► buildModel() ──► merged toon meshes
     ▲                                                          │
     │   npm run model -- check / sheet / diff / zoo           ├─► a game (scene, colliders, light)
     └── agent edits numbers ◄── problems, warnings, sheets ◄───┘   Asset Lab (/asset-lab.html)
```

| Path | What |
| --- | --- |
| `src/engine/model/types.ts` | The format: `ModelDef`, parts, palette slots, params, anchors, light, provenance |
| `src/engine/model/helpers.ts` | `model`, `around`, `rowOf`, `gridOf`, `scatterOf`, `boxFrame` (helpers only return parts) |
| `src/engine/model/physics.ts` | `addModelColliders`: a build's collider data as static colliders |
| `src/engine/model/library/<family>.ts` | The built-in library (`MODEL_LIBRARY`): containers, lighting, nature, town, weapons |
| `src/engine/model/build.ts` | `buildModel`, `expandModel`, collider data, the light request |
| `src/engine/model/validate.ts`, `readability.ts` | `validateModel`, `checkModel`: problems and warnings |
| `src/engine/model/sheet.ts`, `diff.ts`, `view.ts` | The sheets and the diff the CLI draws and prints; the game's camera and its part raster |
| `scripts/model.ts` | `npm run model` (its header is the manual) |
| `src/lab/assetLab.ts`, `asset-lab.html` | The Asset Lab, `window.__ASSET_LAB__` |
| `src/engine/texture/` | Textures as data ([below](#textures)): `TextureDef`, the patterns, `bakeTexture`, `validateTexture`, `textureMap`, `spriteSheet`, `hudSprite`, `TEXTURE_LIBRARY` (`library/`) |
| `scripts/tex.ts` | `npm run tex` (its header is the manual) |

## The loop

1. **Find the nearest example and copy it:** `npm run model -- find crate` lists ids, sizes,
   params, token estimates and files; `npm run model -- zoo all` draws the whole library at one
   scale.
2. **Edit** the def in `src/engine/model/library/<family>.ts` (or a draft `.ts` file anywhere).
3. **Check:** `npm run model -- check crate` exits 1 on problems and lists warnings. It builds the
   model at its defaults, at each param's min and max, and at 3 seeds when the parts read the rng.
4. **Look:** `npm run model -- sheet crate --compare` writes `.scratch/model/crate.png`. Open it.
   With `--compare` the previous version is a magenta outline; `npm run model -- diff crate` says
   in words what changed (parts added, removed, moved, resized, turned, recoloured).
5. **Look in the game:** for anything that ships, open `/asset-lab.html?model=crate` (or
   `?lineup=all`) in the real renderer: toon bands, outlines, looks, lights.
6. Repeat until `check` is clean and the game-scale preview reads.

`npm run model -- check` also runs in `scripts/check.sh`, for every model in the library.

### What the sheet shows

| row | answers |
| --- | --- |
| **turntable**, 8 angles at one scale | Is the silhouette right from every side? |
| **front / side / top**, orthographic on a 0.1 m grid, with the size in metres | Are the parts where the numbers say? Do they touch? Is it the right size? |
| **game scale**: Riftlight's camera (iso, yaw 45°, pitch 42°, 18 px/m × zoom) at the level (1.08) and town (1.22) zooms, one art pixel per pixel, ×4 | Does it read in the game? |
| **palette** | Which slots, which colours, which are unused |
| **check** | The problems and warnings, with the part and the fix |

`--labels` writes named parts' and groups' names on the views; `--rig` draws anchors (cyan) and
colliders (green). `--params k=v`, `--seed n` and `--palette slot=colour` draw another build.
The sheets are software-drawn, shaded in three bands with cel outlines, but without point lights,
looks or the engine's own toon and outline passes: the Asset Lab is the truth.

## The format

```ts
import { boxFrame, model } from '../helpers';

export const crate = model({
  id: 'crate',
  about: 'Wooden crate with a frame and diagonal braces', // one line: `find` searches it
  tags: ['container', 'wood'],
  palette: { wood: 'orange', band: 'red' }, // slots → PALETTE names
  parts: [
    { box: [0.68, 0.68, 0.68], at: [0, 0.36, 0], c: 'wood' },
    boxFrame({ size: [0.72, 0.72, 0.72], beam: 0.09, at: [0, 0.36, 0], c: 'band' }),
    { mirror: [{ box: [0.8, 0.08, 0.04], at: [0, 0.36, 0.35], rot: [0, 0, 45], c: 'band' }], axis: 'z' },
    { mirror: [{ box: [0.04, 0.08, 0.8], at: [0.35, 0.36, 0], rot: [45, 0, 0], c: 'band' }] },
  ],
});
```

Metres and degrees; +Y is up, +Z is the front, the floor is y = 0. Parts are **keyed**, never
positional, so a swapped vector can't be written unnoticed.

**Every primitive fills its box `[w, h, d]`, centred on `at`**, turned by `rot` (XYZ, degrees,
about `at`):

| kind | shape |
| --- | --- |
| `box` | a box |
| `cyl`, `top?` | an n-sided prism (`seg`; default 6 / 8 / 10 by size) starting at +X; `top` = top width ÷ bottom width, the wider end filling the box |
| `cone` | a cone, point up |
| `ball`, `half?` | a low-poly sphere; `half` is the upper dome, flat side down |
| `lump`, `seed?` | a rock or blob (a jittered icosahedron) |
| `wedge` | a ramp: full height at the back (−Z), down to the front edge |
| `torus` | a ring in XZ whose outside fills the box; the tube is the box height thick |

Round kinds are stretched per axis to the box: `[w, h, w]` with `seg: 6` comes out about 15%
stretched in z, and a regular n-gon prism is exactly `cyl` with `seg: n`. **Profile kinds** use
their own coordinates, placed at `at`: `lathe` ((radius, height) points turned about Y, written
either way), `slab` (an XY outline or SVG path M L H V C Q Z, extruded `depth` along Z), `tube`
(points and a radius, or a pair that tapers) and `mesh` (imports).

**Composition:**

- `{ group: [...], at, rot, scale?, c? }`: a frame; its `c` is its parts' default slot.
  `pivot: true` (with a `name`) keeps it a movable Group at runtime, merged per material inside.
- `{ mirror: [...], axis?: 'x' | 'z' }`: the parts plus their mirror image; mirrored names get
  `.mirror`.
- `{ use: 'barrel', at, rot, scale?, params?, seed?, palette? }`: another model by id. Its slots map
  onto this model's (`palette: { theirs: 'ours' }`), else onto ours of the same name, else keep
  their own colour as `<id>.<slot>`.
- `on: 'name'` sits a part on the top of the named part; its `at` becomes an offset from there.
- `tex: 'bricks'` dresses a part in a texture ([Textures](#textures)) in place of its slot's
  colour, at the model's `texel` density (texels per metre, 2–64).
  - Flat kinds are box-projected on the part's own axes from the model's origin, so texels line
    up across parts that share a rotation and run along a turned part.
  - Round kinds (`cyl`, `cone`, `ball`, `torus`, `lathe`) wrap round their axis in a whole number
    of repeats; their caps are projected from above.
  - The density is exact on faces square to the part's axes and at a round part's widest radius;
    a sloped face stretches along its slope, and a round part's narrower rings squeeze.
- `params: { h: [default, min, max] }` with `parts: (p, rng) => [...]` make it parametric and seeded
  (`rng` is the engine's `Rng`, its own stream per model and seed).
- `anchors` (`[x, y, z]` or `{ at, rot }`) for grips and mounts; `light: { at, c, intensity, radius,
  flicker? }`; `collider: 'box' | 'cyl' | 'hull' | 'none'`; `floats: true` for things that hang.

## Checks

**Problems** (`check` exits 1 on all of them; `buildModel` throws a `ModelError` on the ones it
can't build: slots, colours, params, `use`, `on`, malformed meshes or paths): no `about` or `tags`; an undeclared slot or a colour
that isn't a PALETTE name; an unknown texture; a malformed mesh or path; NaN; a size that isn't
positive; `seg` outside 3–64; an empty model; more than 1 cm below the floor unless `floats`; over
the declared `size` by more than 10%; `on` naming no part (or one of its own); a `use` cycle or an
unknown id; params outside their range; an import without `source` or with a licence that isn't
allowed (CC0 until the licence escalation, #49, approves more); a `tex` that names no texture or
one with problems, or a part that both glows and takes a texture; a `texel` outside 2–64.

**Warnings** (what won't read at 480×270):

- a part, or a cluster of touching parts, more than 1 cm from the rest (the floor counts as a
  touch);
- a rod: a part whose second-smallest extent is under 0.06 m (plates are fine);
- over the triangle budget: under 0.5 m across 300, under 2 m 1,000, else 3,000;
- more than 8 materials (each texture is one);
- a texture that doesn't tile on a model (it shows once, at the model's origin, its edge texels
  smeared across the rest of the part);
- a part hidden inside another;
- coplanar faces of different colours (z-fighting; bottoms on the floor excepted);
- touching large masses whose colours differ by less than 0.08 in OKLab lightness;
- counted on the game's own pixels (Riftlight's camera, front and far side): 4 or more large parts
  of one colour that join into one block covering 40% of the model or more, and glow over 15% of
  the model once it is 30 art pixels or more (glow draws as flat colour).

Every message names the part (its `name`, or its kind and path, e.g. `box at parts[3].group[1]`)
and the fix. A textured part counts as its texture's mean colour for the lightness check, and
never joins a one-colour block (its texels break it up).

## Style rules

- **Scale:** the hero is 1.75 m with the cap; a door is 2.2 m, a table 0.75 m, a chair seat 0.45 m.
- **Silhouette first.** The iso camera sees the top and two sides: big masses must read; put detail
  on the top and the front.
- **Thickness:** rods and posts at least 0.06 m; 0.12 m or more for parts that carry the silhouette.
- **Colour separates parts:** touching components take different colours or shades (planks and
  their frame, stones and their mortar, a wheel and the bed it carries): as many colours as the
  parts need to read apart, up to 8, one an accent; touching big masses separate in lightness.
  Gate A's first run was lost on this (docs/plans/gate-a.md).
- **Glow is flat:** keep it for small hot spots (embers, a flame's heart); build fire from lit
  parts (`use: 'flame'`).
- **Low poly:** 6–10 sides on round kinds (4 for square ones), faceted normals, no bevels under
  ~2 cm.
- **Grounding:** the base on y = 0, nothing floating unless `floats`; name anchors for anything
  that attaches.
- **Compose before you create:** `use` a library model before writing a new crate.

## In a game

```ts
import { addModelColliders, buildModel } from './engine';

const lamp = buildModel('lamp-post', { palette: { flame: 'cyan' } });
lamp.object.position.set(4, 0, 2);
ctx.scene.add(lamp.object);
addModelColliders(ctx.physics, lamp, [4, 0, 2]);
if (lamp.light) ctx.lights.request({ ...lamp.light, position: [4 + lamp.light.at[0], lamp.light.at[1], 2 + lamp.light.at[2]] });
```

`buildModel(idOrDef, { params, seed, palette, light })` returns `object` (one merged mesh per
material, pivots as named Groups), `bounds`, `anchors`, `colliders` (data), `light` (a request) and
`report` (tris, draws, materials). Palette slots bind to PALETTE names or computed colours (a
theme's tint). Builds that don't read the rng are cached and share their geometry
(`userData.shared`, kept by level unloads). `expandModel` gives the plain-JSON form. A game adds its
own models with `MODEL_LIBRARY.add(def)` or a `ModelCatalog` of its own (`buildModel(id, { catalog })`).

## Textures

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

**On models:** a part's `tex` (see [The format](#the-format)), as `brick-wall` does:

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

### Texel density (Gate B)

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
- **Both backends** (WebGPU and the WebGL 2 fallback, both SwiftShader here) measured the same to
  two decimals.

So `DEFAULT_TEXEL` is **8**: floors, walls and props the camera zooms over. A model that moves
(and is never a large surface) may set `texel` up to `MOVING_TEXEL` = 20, the densest measured,
which passed the crate test; it shimmers while the camera zooms like a 20-texel surface does, so
keep such models small on screen. Draw textures for 8: a 16-texel tile covers 2 m, so a brick of
8 × 4 texels is 1 × 0.5 m.
