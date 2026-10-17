# Models and textures as data

Objects in a game are **plain data** that agents write, check and look at, then adjust: a
`ModelDef` of keyed primitives. There is no modelling tool, and a model is text, never a binary
file. The engine compiles a def into toon meshes at runtime; `npm run model` measures and draws it
without a browser; the Asset Lab (`/asset-lab.html`) shows it in the real renderer. Meshes from
kits come in through the importer (docs/assets/importing.md); what a game will vary is traced in
primitives (docs/assets/tracing.md).
Agents outside this repo get [docs/GUIDE-ASSETS.md](GUIDE-ASSETS.md) in the engine kit, as
`ASSETS.md`: the same format and rules for someone with only the kit (`check.mjs --sheets` draws
their sheets). A change to the format or the rules changes both.

The library is where ModelDefs pay (measured: [Gate A](#gate-a)): start from it
(`npm run model -- find`, `zoo`), and search it rather than read its source.

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
| `src/world/rooms/workshop.ts`, `shelves.ts` | The Asset Workshop (`/?game=world&room=workshop`): the same shelves in a picker, placed on a floor as many times as you like; `shelves.ts` is what the two rooms share |
| `src/engine/catalog.ts` | `Catalog` (`MODEL_LIBRARY`, `TEXTURE_LIBRARY` and pack catalogs are ones): `get`, `find`, ranked `search`; `searchDefs` across catalogs |
| `src/engine/texture/` | Textures as data (docs/assets/textures.md): `TextureDef`, the patterns, `bakeTexture`, `validateTexture`, `textureMap`, `spriteSheet`, `hudSprite`, `TEXTURE_LIBRARY` (`library/`) |
| `scripts/tex.ts` | `npm run tex` (its header is the manual) |
| `src/engine/model/import/`, `fidelity.ts`, `packs/` | Mesh import (docs/assets/importing.md): glTF/GLB reading, palette mapping, primitives, packs; fidelity scores; `LICENCES` and `PACK_SOURCES` |
| `src/engine/model/trace.ts`, `scripts/trace/` | Tracing (docs/assets/tracing.md): the reference, `TRACE_THRESHOLDS`, the sheets; the sources `--against` takes and `export-glb`, V-HACD hints |
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
  A model's variants (ids that differ only in a part that is one letter or a number, last or
  not: `rock-large-a` … `-f`, `tree-pine-tall-a-detailed` … `-d-detailed`) share one entry,
  under the best of them. 20 entries print in full, then up to 40 more by id on
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
- **Place it:** the **Asset Workshop**, `/?game=world&room=workshop` (the Workshop wing): the same
  shelves in a picker, and a floor to put as many as you like on at the game's camera and zoom.
  The wheel over the list (or Q and E) scrolls, comma and period change shelf, a click picks a row;
  Enter puts the pick where its preview hovers, a click on the floor puts it there, a right click
  or Backspace takes one away, Tab shows what it is made of. Agents: `__WORLD__.room.spawn(id,
  [x, z])`, `select(id)`, `def()`, `spawned()`, `undo()`, `clear()`, `find('chair')`.
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
primitives first (docs/assets/tracing.md); the library's own models take `params`.

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
- `tex: 'bricks'` dresses a part in a texture (docs/assets/textures.md) in place of its slot's
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
or licence or with a licence that isn't allowed (docs/assets/importing.md *Provenance and licences*); a `tex` that names no texture or
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
  Gate A's first run was lost on this ([Gate A](#gate-a)).
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

## The library

- **Where content lives:** engine built-ins in `src/engine/model/library/<family>.ts` and
  `src/engine/texture/library/<family>.ts`; what one game owns stays in that game (Riftlight's
  props: `src/riftlight/levels/themes/`); kits from outside are pack files (docs/assets/importing.md).
- **Every entry:** `check` clean; its family's zoo opened and looked at; the game-scale preview
  reads (a silhouette, colours that separate its parts); `about` and `tags` filled in; params
  where variation is cheap (sizes, counts, seeds).
- **One way to place a model:** the town `Kit` places one (`kit.model(id, at)`), a level prop names
  one (`PropDef.model`); kits gain placement, never primitives of their own. Helpers only return
  parts, and `boxFrame` is the bar for the very few domain helpers allowed.

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

## Gate A

The token benchmark (2026-10-12, [#54](https://github.com/michaelcrosato/riftlight/issues/54)):
fresh agents built four briefs (a hand cart, a stone archway, a campfire ring, a weapon rack) three
times each as code on the town `Kit` (arm a) and as a ModelDef (arm b), and fresh judges compared
the median runs blind, from the same judge image (`npx tsx scripts/gate-a.ts judge <file.ts>`).
It failed all three runs (R, b's tokens ÷ a's, had to be ≤ 0.8 with 3 of 4 briefs won or tied, or
≤ 1.0 with 3 won). The first (R = 0.98) lost on colour and light: one-colour masses and glow over
the model, which gave *Checks* its one-block and glow warnings and *Style rules* its colour rule.
The second (R = 1.02) lost on an upright flame that read brown: the fire rule. The third, with the full library, lost
on tokens alone: ModelDefs won 3 of 4 briefs outright but cost 1.75×, because the frozen prompt
had the agent read the whole library's source. Hence: search the library, don't read it. The
owner kept the system ([#54](https://github.com/michaelcrosato/riftlight/issues/54#issuecomment-6130940525)).
The prompts and every run's numbers are in PRs #55, #56, #58 and #74.

The judged models are test inputs in `src/engine/model/fixtures/gate-a/` (`<brief>-<arm>.ts`,
`-<arm>2.ts`, `-<arm>3.ts` for runs 1–3), outside the typecheck: never change their parts. Each
redraws its judge image byte for byte, and `trace --against gate-a:<file>` traces it.

## Topics

| File | Answers |
| --- | --- |
| docs/assets/textures.md | `TextureDef` layers and patterns, the texture loop, checks, textures in a game and on models; texel density (Gate B) and screening a surface |
| docs/assets/importing.md | glTF/GLB import, packs (`PACK_SOURCES`, `loadPack`), provenance and licences, what is imported; pixel-art PNG sheets |
| docs/assets/tracing.md | redrawing a source in primitives: the reference, the score, provenance |
