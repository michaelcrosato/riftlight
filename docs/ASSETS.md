# Models as data

Objects in a game are **plain data** that agents write, check and look at, then adjust: a
`ModelDef` of keyed primitives. There is no modelling tool, and a model is text, never a binary
file. The engine compiles a def into toon meshes at runtime; `npm run model` measures and draws it
without a browser; the Asset Lab (`/asset-lab.html`) shows it in the real renderer. The plan behind
it, with its measurements and what is still to come (textures, imports, traces), is
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
allowed (CC0 until the licence escalation, #49, approves more).

**Warnings** (what won't read at 480×270):

- a part, or a cluster of touching parts, more than 1 cm from the rest (the floor counts as a
  touch);
- a rod: a part whose second-smallest extent is under 0.06 m (plates are fine);
- over the triangle budget: under 0.5 m across 300, under 2 m 1,000, else 3,000;
- more than 8 materials;
- a part hidden inside another;
- coplanar faces of different colours (z-fighting; bottoms on the floor excepted);
- touching large masses whose colours differ by less than 0.08 in OKLab lightness;
- counted on the game's own pixels (Riftlight's camera, front and far side): 4 or more large parts
  of one colour that join into one block covering 40% of the model or more, and glow over 15% of
  the model once it is 30 art pixels or more (glow draws as flat colour).

Every message names the part (its `name`, or its kind and path, e.g. `box at parts[3].group[1]`)
and the fix.

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
