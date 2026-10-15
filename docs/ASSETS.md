# Models and textures as data

Objects in a game are **plain data** that agents write, check and look at, then adjust: a
`ModelDef` of keyed primitives. There is no modelling tool, and a model is text, never a binary
file. The engine compiles a def into toon meshes at runtime; `npm run model` measures and draws it
without a browser; the Asset Lab (`/asset-lab.html`) shows it in the real renderer. The plan behind
it, with its measurements and what is still to come, is
[docs/plans/asset-system.md](plans/asset-system.md). Meshes from kits come in through the importer
([Importing](#importing)); what a game will vary is traced in primitives ([Tracing](#tracing)).
Agents outside this repo get [docs/GUIDE-ASSETS.md](GUIDE-ASSETS.md) in the engine kit, as
`ASSETS.md`: the same format and rules for someone with only the kit (`check.mjs --sheets` draws
their sheets). A change to the format or the rules changes both.

How it measures ([Gate A](plans/gate-a.md), three runs): with the seed library an agent writing a
ModelDef spent about what one writing code on the town `Kit` spends (R = 0.98, then 1.02), less when
it composed library models (the campfire, 0.84), and the judges preferred the Kit's models: they
lost on colour (fixed by the checks below) and a flame that read brown (rebuilt: *Fire faces the
camera*). With the full library the judges preferred the ModelDefs in 3 of 4 briefs (the
campfire and the weapon rack composed `flame` and the library's weapons), but they cost 1.75 times
as much: the gate's frozen prompt has the agent read the library's whole source (233 KB) rather
than search it. The library is where ModelDefs pay: start from it (`npm run model -- find`, `zoo`).

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
| `src/engine/model/library/<family>.ts` | The built-in library (`MODEL_LIBRARY`): architecture, containers, dressing, dungeon, furniture, lighting, nature, props (tools, loot, signs), town, weapons |
| `src/engine/model/build.ts` | `buildModel`, `expandModel`, collider data, the light request |
| `src/engine/model/validate.ts`, `readability.ts` | `validateModel`, `checkModel`: problems and warnings |
| `src/engine/model/sheet.ts`, `diff.ts`, `view.ts` | The sheets (`modelSheet`, exported: the kit's `check.mjs --sheets` draws with it) and the diff the CLI draws and prints; the game's camera and its part raster |
| `scripts/model.ts` | `npm run model` (its header is the manual) |
| `src/lab/assetLab.ts`, `asset-lab.html` | The Asset Lab, `window.__ASSET_LAB__` |
| `src/world/rooms/gallery.ts` | The Asset Gallery (`/?game=world&room=gallery`): every library model and texture and every pack, one at a time ([Finding assets](#finding-assets)) |
| `src/engine/catalog.ts` | `Catalog` (`MODEL_LIBRARY`, `TEXTURE_LIBRARY` and pack catalogs are ones): `get`, `find`, ranked `search`; `searchDefs` across catalogs |
| `src/engine/texture/` | Textures as data ([below](#textures)): `TextureDef`, the patterns, `bakeTexture`, `validateTexture`, `textureMap`, `spriteSheet`, `hudSprite`, `TEXTURE_LIBRARY` (`library/`) |
| `scripts/tex.ts` | `npm run tex` (its header is the manual) |
| `src/engine/model/import/`, `fidelity.ts`, `packs/` | Mesh import ([below](#importing)): glTF/GLB reading, palette mapping, primitives, packs; fidelity scores; `LICENCES` and `PACK_SOURCES` |
| `src/engine/model/trace.ts`, `scripts/trace/` | Tracing ([below](#tracing)): the reference, `TRACE_THRESHOLDS`, the sheets; the sources `--against` takes and `export-glb`, V-HACD hints |
| `src/engine/png.ts` | `decodePng`: PNGs headless (texture atlases) |

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

## Finding assets

Search before you write: the asset you need may already be in the library or a pack.

- **Search:** `npm run model -- find wooden chair` and `npm run tex -- find stone floor` rank
  every model (texture) in the library and in every pack (`public/packs/`) best first: a word that
  names part of the id counts most, then a tag, then the `about` line; plurals and parts of words
  count, and when nothing has every word the closest come back, said so. Each line gives the id,
  size, tags and where it lives (a library file, or `pack <id>`). Inside a pack, a tie goes to the
  name that starts with the word, so `find rock` gives Kenney's rocks before its cliffs of rock.
  A model's variants (ids that differ only in a last letter or number: `rock-large-a` … `-f`)
  share one entry, under the best of them. 20 entries print in full, then up to 40 more by id on
  one line and how many are left, so a search prints 5–7 KB (under 2,000 tokens) and says what
  it left out: `--limit 60` for more in full, `--json` for every entry (a model's with its
  `variants`). A sheet's lettered tiles (`forest-a` … `-i`, `door-wood-b`) are pieces of a set,
  not variants: each is its own entry.
- **In code** (the kit too): `MODEL_LIBRARY.search('wooden chair')`, `TEXTURE_LIBRARY.search(...)`,
  a loaded pack's catalog the same way, or `searchDefs([...MODEL_LIBRARY.all(), ...kit.all()], text)`
  across several. `MODEL_FAMILIES` and `TEXTURE_FAMILIES` list the library family by family.
- **Browse:** `npm run model -- zoo <family|tag|pack>` draws a family, a tag or a whole pack at
  one scale; `npm run tex -- zoo <tag|pack>` the same for textures.
- **Look in the game:** the **Asset Gallery**, `/?game=world&room=gallery` (Riftlight's title menu
  → Engine World → Looks & Filters, or G there): every library model and texture and every pack,
  one at a time on a turntable. Q and E step through a shelf (Shift: ten at a time), comma and
  period change shelf, the wheel zooms; T has the shelf, the item, the zoom (fit, or Riftlight's
  own level and town zooms) and the turntable. `&asset=<id>` opens it on one asset. Agents:
  `__WORLD__.room.find('chair')`, `show(id)`, `next()`, `shelf(id)`, `current()`.
- **The kit** (agents outside this repo): `LIBRARY.md` lists every asset by family and pack (a
  model's variants share a row; a pack's rows leave out its name and tags), `library.json` holds
  the same as data (id, kind, family, pack, tags, size, slots, licence), and `packs/` carries the
  pack files with their index.

**Variants.** Keep a pack's own (`rock-large-a` … `-f`): they cost bytes in its file, not tokens
in a search, and a level maker flips through them faster than anyone rebuilds one. Don't copy a
model to vary it: write a def that places it (`use`) and changes what placing can, its size
(`scale`; a `group` with a `scale` per axis stretches it) and its colours (`palette`, its slots
onto yours). That is a few lines per variant, nothing copied, and a draft file sees every pack
(`npm run model -- sheet my/bridges.ts`); a game loads the pack `into` its catalog first (below).
A change inside an imported mesh (taller rails on the same deck) needs the model traced into
primitives first ([Tracing](#tracing)); the library's own models take `params`.

Tags are a small vocabulary shared by the library and the imports: families (`furniture`,
`nature`, `dungeon`, `architecture`, `weapon`, `lighting`, `container`...), materials (`wood`,
`stone`, `iron`, `cloth`) and kinds (`tree`, `wall`, `seat`, `potion`, `character`). An import
takes them from its file name (`NAME_TAGS`, src/engine/model/import/describe.ts) and its pack.

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
  flicker? }`; `collider: 'box' | 'cyl' | 'hull' | 'parts' | 'none'` (`parts`: a box round each
  part, so an arch or a doorway stays open; a part with `collide: false` gets none, like an arch's
  mortar ring); `floats: true` for things that hang.

## Checks

**Problems** (`check` exits 1 on all of them; `buildModel` throws a `ModelError` on the ones it
can't build: slots, colours, params, `use`, `on`, malformed meshes or paths): no `about` or `tags`; an undeclared slot or a colour
that isn't a PALETTE name; an unknown texture; a malformed mesh or path; NaN; a size that isn't
positive; `seg` outside 3–64; an empty model; more than 1 cm below the floor unless `floats`; over
the declared `size` by more than 10%; `on` naming no part (or one of its own); a `use` cycle or an
unknown id; params outside their range; an import without `source`, or a `source` without a url
or licence or with a licence that isn't allowed ([Importing](#importing)); a `tex` that names no texture or
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

- **Scale:** the hero is 1.6 m (1.75 m with the cap); a door is 2.2 m, a table 0.75 m, a chair seat 0.45 m.
- **Silhouette first.** The iso camera sees the top and two sides: big masses must read; put detail
  on the top and the front.
- **Thickness:** rods and posts at least 0.06 m; 0.12 m or more for parts that carry the silhouette.
- **Colour separates parts:** touching components take different colours or shades (planks and
  their frame, stones and their mortar, a wheel and the bed it carries): as many colours as the
  parts need to read apart, up to 8, one an accent; touching big masses separate in lightness.
  Gate A's first run was lost on this (docs/plans/gate-a.md).
- **Glow is flat:** keep it for small hot spots (embers, a flame's heart); build fire from lit
  parts (`use: 'flame'`).
- **Fire faces the camera:** `flame`'s tongues turn one lit face to the game camera (+X +Z) and
  lean back into the light, so never turn it about Y. A model a game turns takes a `turn` param
  and turns its flame back (`wall-torch`). Below `h` 0.5 (or ~0.5 scale) a flame of 2–4 tongues
  reads as a dark smudge at game scale: use `tongues: 1`, the candle's flame, for small fires.
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

**Screen a surface before a level lays it.** `npm run build && npm run gate-b -- --backend webgpu
--quick --floors <id>,<draft.ts>` lays each texture as the scene's floor (in place of the pinned
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

Riftlight's levels take the passing surfaces as floors and bricks and stone as walls (docs/GAME.md,
*Themes and props*). Their cobbles floors bind both rims to the stone's tone (a binding, so the
library's cobbles keep their rims): stones on joints in two colours, 27% of texel pairs differing,
screened at 4.50% worst step (mean 2.83%) as the fit predicts. Gravewell's metal plates, the
busiest of the theme floors (30%), bind the lit edge to the plate's tone (20%). The share is cheap to
check where a screening isn't: `src/riftlight/levels/levels.test.ts` bakes every theme's floor in
its tones and in rift shifts of them and holds it under 33%, a margin under the line. Walls are
held to a looser 45%: a wall is a small part of the frame, so the sweep's score is the floor's,
and Gate B judged its wall by the filmstrips, where bricks (42%) read clean at 8. The bound keeps a
busier wall from creeping in unscreened.

## Importing

Kits made in a modelling tool come in as data too: the importer turns a glTF or GLB file into a
ModelDef whose parts are `mesh` (millimetre vertices as text, faces per slot), coloured from the
palette. An import is faithful, not editable: trace what a game will vary (params, seeds, themes)
in primitives instead ([Tracing](#tracing)). Pixel-art PNG sheets come in as TextureDefs
([Pixel-art sheets](#pixel-art-sheets)).

**The loop:**

1. **Import:** `npm run model -- import chair.glb --as chair --licence LicenseRef-own --source models/chair.glb`
   for our own file; someone else's adds `--pack <id>`, an approved `PACK_SOURCES` entry, and its
   own licence and url (`--author`, `--scale 0.01` for centimetres, `--front -z` when the front
   faces away). It
   writes a draft, `.scratch/model/import/chair.ts`, and a fidelity sheet,
   `.scratch/model/fidelity/chair.png`.
2. **Check:** `npm run model -- check .scratch/model/import/chair.ts`.
3. **Look:** open the fidelity sheet, then `npm run model -- sheet .scratch/model/import/chair.ts`.
4. **Fix a colour in one line:** the draft's `palette` binds each slot to a PALETTE entry, and
   `source.colours` keeps the colour each slot came from. `palette: { wood: 'sand' }` is the fix.
5. Move the def where it belongs: the library, a game's own catalog, or a pack.

**What it does:**

- **Reads** with three's `GLTFLoader`, headless. Faces take their colour from the material's base
  colour, vertex colours and a PNG atlas sampled at the face's UV centroid, embedded or beside the
  file (a `uri` that is a URL, an absolute path or outside the file's folder is refused).
  Compressed meshes (Draco, meshopt) and other image formats are refused, saying so.
- **Normalizes:** metres (`--scale`), +Y up, the front turned to +Z (`--front`), the base on
  y = 0, the footprint centred.
- **Parts:** one per source node and material, named after the node. Vertices are welded to the
  millimetre. A piece that is exactly a box or an n-gon prism becomes `box` or `cyl` with
  `seg: n`: re-emitted, it must give back the same vertices within 1.5 mm, triangle count, area
  and volume. Everything else stays a mesh. An unlit material glows.
- **Colours** (plan §7.3): the faces' colours cluster in OKLab into 2–6 slots, hue weighted up and
  lightness down, so a baked gradient becomes one slot. Slots go to PALETTE entries, biggest first:
  nearest by lightness, chroma and hue, a penalty when a grey and a colour swap or two slots share
  an entry, lightness order kept within a hue family. Pale wood stays `sand`, pink stays `red` or
  `orange`. Slots take the material's name when it means something (`wood`, `metalDark`), else
  `c1`, `c2`… (an atlas pack's materials are all `colormap`). A pack's slots can be re-bound
  once, by an agent looking at its swatches: `palette` in its `PACK_SOURCES` entry (below).
- **Scores** (plan §7.6): the def and its source drawn by the sheets' rasterizer at 4 yaws, at game
  scale and close up. `source.fidelity` keeps the worst game-scale and close silhouette IoU, the
  mean OKLab distance where both cover a pixel, and the bounds delta. An import under 0.98 IoU is
  an importer bug. The sheet shows source, def and their difference per view, and the source and
  palette colours side by side.

**Packs:** a kit becomes one JSON file, `public/packs/<pack>.json`, ids `<pack>/<file>`, holding
its models and, from its pixel-art sheets, its textures. `public/packs/index.json` lists every
pack (id, title, file, counts, licence, author): the Asset Gallery and `loadPackIndex()` find
packs through it, and `model -- check` fails when it doesn't match the pack files (the importers
write it; `npm run model -- pack-index` rewrites it after a pack file is changed by hand). A pack's models
share one colour map (a colour reads the same in every one) of up to 16 slots, the palette's size,
rather than a model's 2–6: a whole kit has more colours than one model. A game loads it at runtime
and never bundles it:

```ts
import { buildModel, loadPack, MODEL_LIBRARY, TEXTURE_LIBRARY } from './engine';

const kit = await loadPack('packs/kenney-furniture.json', { into: MODEL_LIBRARY }); // `into`: so `use` finds them
const chair = buildModel('kenney-furniture/chair', { catalog: kit });
await loadPack('packs/kenney-tiny-dungeon.json', { textures: TEXTURE_LIBRARY }); // its tiles, for hudSprite and textureMap
```

A pack's entry in `src/engine/model/packs/sources.ts` holds what the importer needs, as data:
where to download it and its sha256, its licence, author and approval, its `title`, the `tags`
every asset gets (beside those its file name adds), `palette`, the slots re-bound after looking
at the swatches (`{ grass: 'green' }`: Kenney's mint leaves would otherwise come out `cyan`), and
for a 2D pack its `sheets`: the PNG in the download, the grid, a name per cell, which cells
tile and the sheet's own `palette` (a sheet has a colour map of its own). `npm run model -- import-pack <pack>` downloads it, checks its sha256 and its licence files
(one must name the pack's licence; "public domain" alone isn't CC0; none may name share-alike,
non-commercial or no-derivatives terms), caches the download in `.scratch/import-cache/` (never
committed), imports every model with its name in words as `about` and its tags, and writes the
pack file, the index, a summary (`.scratch/model/packs/<pack>.json`), a zoo and the colour slots
(source colour, entry, how many colours each took) to re-bind from. `npm run tex -- import-pack
<pack>` does the same for its sheets ([Pixel-art sheets](#pixel-art-sheets)), into the same pack
file. Re-importing replaces the pack's models (or textures), so the entry is the whole recipe.
`import --pack <pack>` adds one model to a pack file: a pack of our own, or one approved in
`PACK_SOURCES` (a single file from it). `npm run model -- check` checks every pack file with the
library (the pack's own licence, and each model's) and the index; `tex -- check` checks the packs'
textures with the library's.

**Provenance and licences:** every import carries `source`: `url`, `licence`, `author`, `pack`,
`file`, `sha256`, `tool`, `colours` and `fidelity`. `LICENCES` (src/engine/model/packs/licences.ts)
is the list, as data. Our own work (`LicenseRef-own`) is allowed anywhere, its `url` a path in this
repository or a `https://github.com/michaelcrosato/riftlight/` URL (anything else is "own work with
an outside source"; a path must start in `src`, `scripts`, `public` or `docs`). Anyone else's work,
CC0 included and a single file too, needs `source.pack` naming a `PACK_SOURCES` entry with an
approval link for that licence. `check` reports a missing url or licence, or one these terms refuse,
as a problem, and `import` refuses it up front. `npm run model -- credits` writes the attribution
list (`.scratch/model/credits.md`) from every model's `source`.

Third-party content waits on the licence escalation,
[#49](https://github.com/michaelcrosato/riftlight/issues/49). Approval is the repository owner's own
comment there, linked from the pack's entry (`approved`; a test checks the link's form, the
sha256 and the licence of every entry). Agents here act through the owner's GitHub account, so the
code can't prove a comment is human: an agent never writes or links an approval itself. A pack
the owner hasn't approved isn't in `PACK_SOURCES`, so `import-pack` refuses it; the importer's tests
use our own models exported to GLB at test time (no binaries are committed).

**Imported so far:** the six CC0 Kenney packs the owner approved on 2026-10-14
([#49](https://github.com/michaelcrosato/riftlight/issues/49#issuecomment-6180012221)), in
`public/packs/`: `kenney-castle` (76 models), `kenney-furniture` (140), `kenney-nature` (329) and
`kenney-mini-dungeon` (30), and the tiles of `kenney-tiny-dungeon` and `kenney-tiny-town` (132
each, every cell named). Each sits in the engine's palette through its entry's `palette`
(Nature's mint leaves as `green` and `teal`, Tiny Town's tan paths as `sand`...) and at its
scale through `scale`: Kenney's kits are in tile units of about half a metre, so Furniture and
Mini Dungeon come in at 2 (a doorway 2 m, a character 1.5 m) and Castle and Nature at 3 (a gate
2.7 m, an oak 3.7 m, as the library's). 10 thin pieces (studs, pillows, flowers, grass) score
under 0.98 silhouette IoU at game scale, where they are a few pixels; all are 0.977 or more close
up. See them in the Asset Gallery; credit them from `npm run model -- credits` (CC0: credit
optional).

### Pixel-art sheets

A PNG of pixel art comes in as TextureDefs: `tex -- import` slices it on a grid into `pixels`
layers, one def per cell, or one def of frames for an animation strip. Every pixel keeps its place.

**The loop:**

1. **Import:** `npm run tex -- import art/dungeon.png --grid 16x16 --as dungeon --licence
   LicenseRef-own --source art/dungeon.png` (someone else's sheet: its licence and
   `--pack <approved pack>`; `--tile` for surfaces, `--frames` for a strip, `--cells 0-3,8` and
   `--names floor,wall,,door` to pick and name cells by index, `--alpha 128`). It writes a draft,
   `.scratch/tex/import/dungeon.ts` (ids `dungeon-<index>` or `dungeon-<name>`), and a sheet,
   `.scratch/tex/import/dungeon.png`: source and mapped side by side on the grid, every source
   colour with its character, slot and entry, and the merges.
2. **Check and look:** `npm run tex -- check .scratch/tex/import/dungeon.ts`, then one def:
   `npm run tex -- sheet .scratch/tex/import/dungeon.ts dungeon-3`.
3. **Fix in one line:** each distinct source colour has a legend character (a free letter of its
   entry's name: `i` for ink); `legend` maps it to a slot and `palette` binds the slot to a
   PALETTE entry. A slot reads wrong: re-bind it, `palette: { c3: 'sand' }` (`--palette c3=sand`
   re-imports every def with it; rows never change). Two colours merged that shouldn't be: point
   one's character at a slot of its own, `legend: { ..., a: 'c9' }`, and bind it, `c9: 'orange'`.
4. Move the defs where they belong: the library, or a game's own `TextureCatalog`.

**A pack's sheets:** `npm run tex -- import-pack <pack>` slices every sheet its `PACK_SOURCES` entry
lists (`sheets`: the PNG's path in the download, the grid, a name per cell by reading-order index,
the cells that tile) in one pass, with the sheet's `palette` re-bindings, names each texture `<pack>/<name>`
with its name in words and tags, and writes them into the pack file beside its models, with an
import sheet per sheet (`.scratch/tex/import/`) and a zoo. Name the cells: `knight`, `potion-red`
and `wall-stone` are what an agent searches for; `tile-0042` is not.

**What it does:**

- **Cells** are read row by row from the top: index = row × columns + column. The sheet must be
  whole cells (crop margins and spacing first). Alpha under `--alpha` (128) is transparent, the
  rest opaque at its own colour. A cell with no opaque pixel is skipped; with `--frames`, blank
  cells at either end of the strip are dropped and a blank frame inside it stays.
- **Colours** go through the mesh importer's mapper once for the whole sheet (up to 16 slots), so a
  colour reads the same in every cell, and in a cell picked alone. Over 90 distinct colours is
  refused: that isn't pixel art.
- **Merges:** wherever two or more distinct source colours of the imported cells bake as one
  PALETTE entry (clustered into one slot, or two slots on one entry), `import` prints them and
  the sheet lists them in yellow. Every other source colour has an entry of its own.
- **Provenance:** each def's `source` is a model's (url, licence, pack, file, author, sha256, tool,
  each slot's source colour), under the models' rule: our own work with a source inside this
  repository is allowed; anyone else's, CC0 included and a single file too, only from a pack
  (`--pack`) whose `PACK_SOURCES` entry is approved. `tex -- check` refuses a source the rule
  refuses, `import` refuses it up front, and
  `model -- credits` lists textures too. `--as` takes an import id (`tiles`, `kit/tiles`), and
  every file goes in `.scratch/tex/import/`.
- In code: `importSheet(decodePng(bytes, inflate), { as, grid, source })` returns the defs, the
  imported cells' colours, the merges and every cell (`picked`, and the def it went into).

**Not built until a game needs them** (plan §7.5): photo and PBR materials downsampled to a slot
ramp, and SVG icons as `path` layers.

## Tracing

An import is faithful and frozen; a trace is the same object redrawn in primitives with the
library, so it takes params, seeds and themes like any def (plan §7.4). The agent decompiles;
`npm run model -- trace` measures the source for it and judges what it wrote.

**The loop:**

1. **Pick a source** (`--against`): a `.glb`/`.gltf` file, `pack:<pack>/<model>` (an import), or
   our own code-built content: `gate-a:<file>` (docs/plans/gate-a/), `town:<building>` (smithy,
   market, tent, stash, obelisk, plaza, house, lantern, each in its own frame),
   `monster:<seed|boss id>` (the body at its game scale), `asset:<name>` (public/assets/).
   Code-built sources become meshes when they are traced. `npm run model -- export-glb <source>`
   writes one as a GLB for other tools: in a `trace-src/` folder under `.scratch/` only
   (`.scratch/trace-src/<name>.glb` unless `--out` names another; never commit it). The file
   carries its provenance, trusted only there (not in `.scratch/import-cache/`, where downloads
   land), so tracing it records the code that built it and the file's sha256. The hash pins that
   one file: the same export differs byte for byte between Node versions. A GLB elsewhere in the
   repository traces as our own work only if git tracks it.
2. **Reference:** `npm run model -- trace hand-cart --against gate-a:hand-cart-a --reference`
   prints what to author from and writes `.scratch/model/trace/hand-cart-reference.png`: front /
   side / top on a 0.1 m grid with the pieces labelled, the source at 4 yaws and at game scale, its
   colours. The source is normalized as imports are (base on y = 0, footprint centred, front +Z;
   `--scale`, `--front`): author in that frame.
3. **Author** the def with the library (`find`, `use`, `around`, `mirror`) in a draft `.ts` file.
4. **Score:** `npm run model -- trace my/hand-cart.ts --against gate-a:hand-cart-a` prints the
   numbers, writes `.scratch/model/trace/hand-cart-trace.png` and exits 1 under the thresholds or on
   problems.
5. **Fix** what the sheet shows and score again, until it passes and `check` is clean. Paste the
   `source` line it prints into the def.

**What the reference says:**

| line | means |
| --- | --- |
| bounds | the source's size, min and max (m) |
| colours, `palette:` | its face colours clustered by the importer's mapper onto PALETTE entries, at most 8 slots (more warns; the closest join), with each one's share of the area; `palette:` is ready to paste, and every piece's `c` is one of its slots |
| nodes, materials | an axis-aligned box per source node and per material (`at`, `size`, to the cm); merged meshes (a kit's) are one node per material and print once |
| pieces | every connected piece (triangles sharing a vertex, welded to the mm), biggest first, `p1`, `p2`… as the sheet labels them: its colours (all of them: a top or a tip in another colour), its box, turned (`rot`) when that is clearly tighter (half the volume, or 5% less on a piece that fills 60% of it: a round or pointed piece keeps its axis-aligned box), its `fill` (its volume ÷ that box: 1 a box, ~0.8 a cylinder, ~0.5 a ball, ~0.3 a cone), and, when it is one, the primitive to paste. `exact`: a box, prism, frustum (`cyl` with `top`) or cone that re-emits its vertices within 1.5 mm; `close`: within 3% of its size (an odd ring keeps its bounds centred, so its axis sits a little off a modelling tool's). Pieces alike print under one line |
| hull hints | boxes fitted to a convex decomposition (Rapier's V-HACD): where the masses are when the pieces aren't primitives. Hints only |

**What the score says** (the importer's `scoreFidelity`, plan §7.6): the source and the def drawn
by one rasterizer at 4 yaws, at game scale (Riftlight's camera at the level zoom) and close up.

| number | means | passes |
| --- | --- | --- |
| game IoU | the worst game-scale view's silhouette overlap: pixels both cover ÷ pixels either covers | ≥ 0.85 |
| close IoU | the same close up, where thin parts and details count | ≥ 0.85 |
| colour dE | the mean OKLab distance between their flat colours where both cover a pixel | ≤ the palette floor + 0.04 |
| bounds delta | the def's size minus the source's (m) | reported |
| centre offset | the def's bounds centre minus the source's (m): over 2 cm, the trace is drawn in another frame, which scores like a wrong shape | reported |

The thresholds are `TRACE_THRESHOLDS` in `src/engine/model/trace.ts`. A source off the palette (a
monster's own colours) can't reach 0 on colour: its palette floor is the source itself in its
nearest PALETTE entries scored against the source (`paletteFloor`; 0 for a source in palette
colours), both commands print it, and the colour limit sits on it (monster seed 7 floors at 0.082,
so it passes at 0.122; the boss Vorgath at 0.074). The floor takes each colour's nearest entry,
not the reference's `palette:`, whose mapper keeps hues apart at a cost. The sheet shows each view
as the trace with the source's outline over it (magenta) beside their difference (source only
magenta, trace only cyan, both grey to red by colour), then front / side / top with the source's
outline.

**Tuned on ten traces** (Phase 6; each by a fresh agent from the reference, its tokens the Agent
tool's count for the whole run):

| trace | source | game IoU | close IoU | colour (floor) | scorings | def tokens | agent tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| archway | gate-a:archway-a | 1.000 | 1.000 | 0.009 | 2 | ~680 | 94k |
| campfire-ring | gate-a:campfire-a | 0.931 | 0.881 | 0.023 | 4 | ~950 | 118k |
| weapon-rack | gate-a:weapon-rack-a | 0.982 | 0.979 | 0.005 | 2 | ~920 | 96k |
| smithy | town:smithy | 0.999 | 0.999 | 0.032 | 3 | ~1,100 | 117k |
| market | town:market | 0.999 | 1.000 | 0.003 | 3 | ~970 | 100k |
| tent | town:tent | 0.998 | 0.997 | 0.002 | 3 | ~650 | 92k |
| obelisk | town:obelisk | 0.989 | 0.989 | 0.029 | 3 | ~890 | 120k |
| coin | asset:coin | 1.000 | 0.999 | 0.001 | 2 | ~330 | 82k |
| vorgath | monster:vorgath | 0.956 | 0.957 | 0.097 (0.074) | 4 | ~1,510 | 187k |
| monster-7 | monster:7 | 0.891 | 0.918 | 0.113 (0.082) | 7 | ~550 | 127k |

A median of ~110k agent tokens a trace (82k–187k), ~900 tokens a def. What it showed:

- **Shape:** every source built of primitives passed at the first scoring, at 0.93–1.0: the
  reference prints its pieces ready to paste, so pasting them is the trace. The organic monsters
  passed too (0.89–0.96). Game IoU is noisy on a small model (seed 7 is ~8 px across at game
  scale, so a pixel moves it 2–4%), so it stays at 0.85; close up every trace cleared 0.88, so the
  close limit rises from 0.75 to 0.85. A trace drawn in the wrong frame scores ~0.6 either way.
- **Colour:** the starting 0.08, absolute, was 2.5× what any on-palette trace needed (worst 0.032)
  and out of reach in practice for the monsters (floors 0.074 and 0.082). It is now 0.04 over the
  floor: the worst excess seen is the smithy's 0.032, whose colours moved to clear readability
  warnings; the monsters sit 0.023 and 0.031 over theirs.
- **The real work was `check`:** most scorings after the first cleared readability warnings the
  source itself would raise (a slate chimney through a red roof, a slate block over 40%, a crystal
  floating over its obelisk, seats and logs a few cm off the floor, coplanar faces). A clean trace
  drifts from its source there, and its header says where.
- **What the reference gets wrong:** a tilted cone's box isn't centred on the cone (run it from
  base centre to tip); a thin tilted rod prints as a thick bar; pieces buried inside others print
  like any other (look before pasting); 8 slots fold close entries (night into ink); the mapper's
  `palette:` line can pick a further entry than the nearest for an off-palette source (pick by
  eye); `lump` costs far more triangles than its name suggests.

**Provenance:** a traced def records `source` as an import does ([Importing](#importing)): for our
own source `LicenseRef-own`, `url` the code or GLB in this repository, `tool` (`'trace'`, plus the
`--front` and `--scale` the source was normalized with, so the score reproduces) and the `fidelity`
scores. A trace of someone else's model keeps their licence, author and pack: tracing doesn't make
it ours, and it waits on #49 as the import does. `trace` prints the line and says when the def's
own is missing or stale.

Worked traces are in `docs/plans/trace/`: the ten above and the two that proved the tool (the
generated tree, parametric in `tiers`, and Gate A's Kit hand cart). A unit test scores every one
again against what it records and checks it clean (src/engine/model/trace.test.ts), so a change to
the library, the scorer or a source that moves one shows.
