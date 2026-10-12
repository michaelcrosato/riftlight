# Plan: an agent-first asset system (models, textures, imports)

Written 2026-10-11 by a planning session. It explored the repo, built a throwaway prototype and ran
import experiments on real CC0 kits (numbers in [Appendix A](#appendix-a-measured-evidence)). A
verifier agent then checked the plan against the repo. The executing session keeps the
[Status](#14-status) table current: it says what is built.

## Execute it

**Effort level for the executing session: extra.** Why: see [Effort level](#effort-level).

**Prompt** (paste as is; running it again resumes from the Status table):

> Execute the plan in `docs/plans/asset-system.md` phase by phase until every phase is done or
> you are blocked on a human.
> 1. Read the plan fully, then `AGENTS.md`, `docs/DOCTRINE.md`, and the plan's "Read first" list
>    for the phase you are on.
> 2. Take the first phase in the Status table that is not done; resume an "in progress" one from its
>    notes. Build it to meet every acceptance criterion:
>    - `scripts/check.sh` green (mind the plan's environment note);
>    - the e2e suites the phase names;
>    - the PNGs and captures it calls for, opened and looked at;
>    - a `verifier` subagent review of the finished diff before each push.
> 3. Ship it as one or more focused PRs from a `claude/*` branch cut from the latest `main`. If your
>    session has a designated branch name, reuse it, restarted from `main` after each merge.
>    - Every PR updates the phase's Status row: in progress or done, PR links, numbers, and what
>      remains.
>    - After each push, give Autopilot a minute to open and merge the PR. Do not open it as a draft
>      yourself: a draft switches Autopilot's merge off. If one ends up a draft, mark it ready.
>    - Get `main` green again (AGENTS.md step 6) before the next PR.
> 4. Gates A–C are decision points. Record their numbers and do what the plan says each outcome
>    means; a failed Gate A stops the plan.
> 5. Commit no third-party content until the licence escalation from Phase 0 is approved. Change
>    existing systems only where the plan says to or where it clearly improves the result, never
>    for its own sake.
> 6. Departures from the plan follow `docs/DOCTRINE.md#escalation`; note each in the Status table.
>
> Finish with what shipped (PR links), the results against the plan's success measures, and
> anything blocked.

**Environment note (measured in this cloud environment).**
- The default `node` is v24, but the repo pins 22 (`.nvmrc`, CI). `/opt/node22/bin` holds v22.
- Fixed in Phase 0: under v24, `scripts/check.sh` used to fail at `assets_unchanged`, because the
  GLB colour factors (sRGB to linear through `Math.pow`) differed in the last bit. The generator
  now rounds them, so the GLBs are byte-identical on v22 and v24, and the Stop hook passes with
  the default Node.
- Anything else that hashes floats (Phase 1's monster hashes) rounds the same way. To match CI
  exactly, prefix a run with `PATH=/opt/node22/bin:$PATH` (an exported PATH does not last between
  tool calls).

## Verdict: go, with limits

The goal can be reached, and it is the same move that worked for animation (`docs/ANIMATION.md`):
content as data, compiled by the engine, measured and drawn by tools an agent reads.

- **Authoring: richer models for about the same tokens, and fewer once composition kicks in.**
  - In the keyed format, the seed statue costs ~256 tokens against ~234 for today's 6-box statue.
    It is a robed figure on a plinth holding a sword.
  - A market stall that places a barrel and two crates by reference costs ~219.
  - Gate A measures whether the whole authoring loop (write, check, look, fix) is cheaper, or
    better at no extra cost, before anything else is built on the format.
- **Imports work, but they arrive frozen, not editable.**
  - Real CC0 kits load headless. Their meshes translate exactly into palette-mapped text: ~800
    tokens per model at the median, then placed anywhere by reference for ~15.
  - Automatic conversion to editable primitives was measured (voxel-to-box) and rejected.
  - Instead, an agent *traces* an import in primitives and a tool scores the match. That is the
    "with or without tools" route the request allows, and it gives editable, compact assets where
    they matter.
- **Textures:** the toon pipeline already takes nearest-filtered maps. Riftlight's zoom range puts
  ~10–39 art pixels on a metre, so pixel textures are tiny. Gate B measures whether they shimmer
  across that range. If they do, textures stay on sprites, icons and large flat surfaces.

Stop if Gate A shows no clear gain. The plan would then be adding a second way to do what the kits
already do.

## 1. Why: what the repo has today

- **There is no shared asset format.** Riftlight builds every visual in TypeScript at runtime:
  about 9,200 lines, ~15% of `src/riftlight`. It uses four kits that disagree:
  - the town `Kit.box(size, color, at)`, rotations in degrees;
  - the monster part kit `box(c, color, at, size)`, in socket units;
  - props `part(g, m, x, y, z, sx, sy, sz, ry, rx, rz)`, rotations in radians, Y first;
  - the World's `RoomKit.box(at, size, color)`.

  Colours come from palette names, palette slots or raw hex, depending on the module.
- **Quality is uneven.**
  - Monsters are rich: 115 parts, 9 body plans, a pattern skin.
  - The 13 level props are 2–6 primitives each: `npm run inspect -- prop:statue` shows 6 boxes,
    and a greatsword ground drop is 2 boxes.
  - Themes list 3–5 props each.
  - One item `look` key selects three separate hand-coded drawings: the ground model, the held
    weapon and the 2D icon.
- **There are no textures on any 3D object.** `toonMaterial(color, { map })` supports them, but:
  - `mergeStaticMeshes` keeps only positions and normals;
  - the software rasterizer behind `inspect` and the sheets ignores textures;
  - there is no PNG decoder;
  - `drawSheet` sprites need a DOM canvas.
- **There is plenty to build on:**
  - `npm run inspect`: headless turntables, warnings, history and diff;
  - the software rasterizer (`animation/raster.ts`, driven by `inspect/render.ts`);
  - `GLTFLoader` working in Node (tests parse `hero.glb`);
  - the `hud.sprite` ASCII pixel format, already reused for gem icons;
  - seeded procgen;
  - Riftlight's tag `Registry`;
  - the tool pattern in docs/ENGINE.md, *Tools for agents*.

## 2. Principles for this system

1. **One format per kind, plain data.** A 3D object is a `ModelDef` and a 2D image is a
   `TextureDef`. Both are typed TS object literals that serialize to JSON once params are applied.
   Helpers only return data.
2. **Keyed, not positional.** A part is written `{ box: [w, h, d], at: [x, y, z], c: 'wood' }`,
   never `box(a, b, c)`. The four existing kits use four different argument orders.
   - Keys cost about 30% more tokens than positional calls: 1,448 against 1,109 over the seven
     seed assets.
   - In exchange, swapped vectors, a classic LLM error, become impossible to write unnoticed.
   - Gate A judges the format as a whole.
3. **Every primitive fills its box `[w, h, d]`, centred on `at`.**
   - Round kinds are an n-sided ring that starts at +X and is stretched per axis to the box. Its
     bounding box is centred on `at`, so an odd ring's axis shifts slightly. `[w, h, w]` with
     `seg: 6` comes out ~15% stretched in z.
   - Under this rule a regular n-gon prism maps to `cyl` with `seg: n` exactly, and the importer
     uses the same convention.
   - With `top`, the wider end fills the box, and `top` is the top width divided by the bottom
     width.
   - Profile kinds (`lathe`, `slab`, `tube`, `mesh`) use their own local coordinates, placed at
     `at`.
   - Units are metres and degrees; +Y is up, +Z is the front, and the floor is y = 0.
4. **Palette slots, not colours.** Parts name slots that the def declares (`wood`, `trim`). A build
   binds the slots to `PALETTE` names, or to computed colours for game bindings, so themes, rift
   shifts and imports re-colour a model without touching its parts.
5. **Compose before you create.** `use` places another model by id with params, palette and seed.
6. **Truth at game scale.** Every sheet shows the asset as it reads at 480×270 with Riftlight's
   iso zooms. Checks flag detail that will not survive.
7. **Measure, look, compare** (as `npm run anim` does): `check` exits 1 on problems,
   `sheet --compare` overlays the previous version, `diff` says what changed, and the lab page
   shows the real renderer.
8. **Provenance is data.** Imported and traced assets record source, licence, hash, tool version,
   source colours and fidelity. A check fails without them.

## 3. Build on what exists

| Existing piece | Decision |
| --- | --- |
| Monster genome, plans, parts, skin (`src/riftlight/monsters/`) | **Unchanged.** Only its unit geometry moves (next row). |
| `monsters/geometry.ts` unit shapes, `lathe`, `extrude`, `arcHorn`, `limbGeometry`, `taperCyl` | **Move** them to `src/engine/model/geometry.ts`; monsters import from there. Prove the bodies identical with a full-buffer hash test (Phase 1). |
| Town `Kit`, World `RoomKit`, `PropDef`/`PROPS`, `buildProp` | **Keep their APIs** and add one way to place a model: `kit.model(id, at, o)`, `room.kit.model(...)`, `PropDef.model`. `Kit.build()` disposes its statics' geometry, so `kit.model` hands it clones, never cached geometry. `PropDef.build` becomes optional when `model` is set. Old content is re-authored only where it gets better: the 13 props and the item models. |
| `inspect` (renderer, report, history) | **Reuse the renderer** for the `model` and `tex` sheets. `inspect` gets no new targets, so each job has one view. Its fingerprint ignores colours; add them in Phase 2a, after Phase 1's comparisons are done. |
| `hud.sprite` rows plus a legend | **The pixel layer of `TextureDef`**: same rows, same legend rule. `hud.sprite` stays. |
| `drawSheet` (canvas code) | **Keep.** Add a headless path, `spriteSheet(textureDef)` → `SpriteSheet`, for `SpriteBatch`. |
| `toonMaterial`, the `shaders.ts` materials, `PALETTE` | **Reuse.** Slots map to cached toon materials. An engine `glowMaterial()` serves models. Riftlight's three duplicate glow caches can switch to it when touched. |
| `mergeStaticMeshes` | **Fix in Phase 3:** keep `uv` when the group's material has a `map`, and `color` when it uses `vertexColors`. Existing callers see no change. Update docs/ENGINE.md *Draw calls*. |
| `scripts/generate-assets.mjs` and its 3 GLBs | **Unchanged**, apart from Phase 0's Node fix if that is where it lands. |
| Riftlight `Registry` | Game catalogs keep it. The engine library gets its own small catalog, because the engine must not import the game. |

## 4. The model format (`ModelDef`, `src/engine/model/`)

### 4.1 Shape of the data (sketch; refine while building)

```ts
type Vec3 = readonly [number, number, number];
type Slot = string;                 // a key of the def's palette; parts never name PALETTE colours
interface PartBase {
  at?: Vec3;      // centre of the part's box (profile kinds: their origin)
  rot?: Vec3;     // degrees, XYZ, about `at`
  c?: Slot;       // default: the def's first slot
  name?: string;  // for `on`, pivots, labels on sheets, diffs
  on?: string;    // sit on the named part's top: `at` becomes an offset from there
  glow?: boolean; // unlit (flames, eyes, screens, crystals)
  tex?: string;   // TextureDef id; UVs generated (box / cylinder / planar) at the def's texel density
  seg?: number;   // round kinds; default by size (6 / 8 / 10)
}
type Prim = PartBase & (
  | { box: Vec3 } | { cyl: Vec3; top?: number } | { cone: Vec3 }
  | { ball: Vec3; half?: boolean } | { lump: Vec3; seed?: number /* rock, blob */ }
  | { wedge: Vec3 } | { torus: Vec3 /* a ring in XZ filling the box; tube = box height */ }
  | { lathe: [number, number][] }                            // (radius, height) turned about Y
  | { slab: [number, number][] | string; depth: number }     // XY outline or SVG path, extruded along Z
  | { tube: Vec3[]; r: number | [number, number] }            // swept along points: handles, ropes, horns
  | { mesh: { v: string; f: Record<Slot, string> } });       // imports: "x y z,…" in mm; "a b c,…" per slot
type Part = Prim
  | (PartBase & { group: Part[]; scale?: number | Vec3; pivot?: boolean })
  | { mirror: Part[]; axis?: 'x' | 'z' }                     // the parts plus their mirror image
  | (PartBase & { use: string; params?: Record<string, number>; palette?: Record<Slot, Slot>; scale?: number; seed?: number });
interface ModelDef {
  id: string; about: string; tags: string[];                 // about: one line, searched by `find`
  palette: Record<Slot, PaletteColor>;                       // games bind computed colours at build time (4.2)
  size?: Vec3;                                               // declared bounds, checked
  params?: Record<string, [def: number, min: number, max: number]>;
  parts: Part[] | ((p: Record<string, number>, rng: Rng) => Part[]);
  anchors?: Record<string, Vec3 | { at: Vec3; rot: Vec3 }>;  // oriented ones for grips and mounts
  light?: ModelLight;                                        // { at, c, intensity, radius, flicker? }
  collider?: 'box' | 'cyl' | 'hull' | 'none';
  texel?: number;                                            // texels per metre for `tex` parts (Gate B)
  floats?: boolean;                                          // hangs, mounts on walls, hovers
  source?: Provenance;                                       // url, pack, licence, sha256, tool, colours (source sRGB per slot), fidelity
}
```

**Helpers return parts.** Their names avoid the existing `row`, `grid` and `Kit.frame`:
- `around(n, part | (i) => part, { r?, phase? })`: copies turned about Y. `r` pushes each copy out
  along its own +Z first; the default 0 lets the part's `at` place it.
- `rowOf(n, step, part | (i) => part)`: copy i is offset by i × step.
- `gridOf(nx, nz, step, …)`.
- `scatterOf(n, [w, d], seed, (i, rng) => part)`.
- `boxFrame({ size, beam, at?, c })`: 12 beams, for crates, cages and windows. It sets the bar for
  the very few domain helpers allowed.
- `model(def)` returns the def typed, so tuples and literals don't widen.

The seed library in [Appendix A](#appendix-a-measured-evidence) is the format written out.

### 4.2 Build and runtime

- **`buildModel(idOrDef, opts)`.** Options:
  - `params`, `seed`;
  - `palette: Record<Slot, PaletteColor | number>`: the game binds slots to names or computed
    colours, e.g. Riftlight's `tint(theme.palette.wall, 0.35)`;
  - `light: Partial<ModelLight>`: overrides such as `theme.torch`.

  It returns:
  - `object`: one merged faceted `Mesh` per material, plus named `pivot` groups (each merged per
    material inside) left movable for runtime animation;
  - `bounds`, `anchors`, `colliders` (data), `light` (request data), and `report` (tris, draws,
    warnings).
- **Caching.** Models whose parts don't read the rng are cached per `(id, params, palette)`, and
  their geometry is `userData.shared`, like GLB caches. Seeded builds are not cached: levels give
  every placement its own seed and merge it anyway.
- **`expandModel(...)`** gives the plain-JSON form, with params and `use` resolved. `diff`, saves
  and exports use it.
- **`addModelColliders(physics, build, at, yaw)`** turns collider data into static Rapier colliders.
  `light` feeds `ctx.lights.request`, replacing Riftlight's `PropGlow` offsets.

### 4.3 Checks (`validateModel`, `modelMetrics`; pure, unit-tested)

**Problems** (exit 1):
- an undeclared slot or unknown palette name;
- an unknown `tex`;
- a malformed `mesh`, NaN, or an empty model;
- below the floor by more than 1 cm, unless `floats`;
- outside the declared `size` by more than 10%;
- `on` naming no part, or a `use` cycle;
- params out of range;
- an import without `source` or with a licence that is not allowed.

**Warnings:**
- a part more than 1 cm from every other part;
- a visible part whose second-smallest extent is under 0.06 m (rods vanish at 480×270; plates
  are fine);
- over the triangle budget for its size class;
- more than 8 materials (6 until Gate A's first run showed better-read models needing more);
- added in Phase 2a:
  - a part hidden inside another;
  - coplanar overlapping faces of different colours (z-fighting);
  - touching large masses whose colours differ by less than 0.08 in OKLab lightness, so they
    won't read apart.

Every message names the part and the fix: "`lid` floats 0.12 m above `body`: lower it or use
`on: 'body'`". `check` builds a parametric model at its defaults, then with each param at its min
and its max (one at a time: 2k + 1 builds), each at 3 seeds.

### 4.4 Style rules (docs/ASSETS.md teaches them; checks enforce what they can)

- **Scale:** the hero is 1.75 m with the cap (`npm run inspect -- hero`). A door is 2.2 m, a
  table 0.75 m, a chair seat 0.45 m.
- **Silhouette first.** The iso camera sees the top and two sides: big masses must read, and
  detail goes on the top and the front.
- **Thickness:** rods and posts at least 0.06 m thick; 0.12 m or more for parts that carry the
  silhouette.
- **Colour:** as many colours as the parts need to read apart, at most 8, one of them an
  accent. Touching components take different colours or shades; touching big masses separate in
  lightness. (This said "2–4 slots" until Gate A's first run lost on it: docs/plans/gate-a.md.)
- **Low poly:** 6–10 sides on round kinds (4 for deliberately square ones: pyramids, thin ropes),
  faceted normals, no bevels below ~2 cm.
- **Grounding:** base on y = 0, nothing floating unless `floats`. Name anchors for anything that
  attaches.
- **Triangle budgets** by the largest dimension: under 0.5 m ≤ 300; under 2 m ≤ 1,000; larger
  ≤ 3,000. At most 8 materials.

## 5. The texture format (`TextureDef`, `src/engine/texture/`)

```ts
interface TextureDef {
  id: string; about: string; tags: string[];
  size: [w: number, h: number];          // texels; powers of two for tiling surfaces
  palette: Record<Slot, PaletteColor>;
  tile?: boolean;                        // seamless: generators wrap, the check measures the seam
  frames?: number;                       // sprite sheets, left to right
  layers: Layer[];                       // drawn in order
}
type Layer =
  | { pixels: string[]; legend: Record<string, Slot>; at?: [number, number]; mirror?: 'x' | 'y' } // hud.sprite rows
  | { pattern: PatternId; colors: Slot | Slot[]; seed?: number; dither?: boolean; [param: string]: unknown }
  | { path: string; fill?: Slot; stroke?: Slot }                    // SVG path subset, no anti-aliasing
  | { outline: Slot }                                                 // 1-texel outline round opaque pixels
```

- **Patterns** to start with: `noise`, `bricks`, `planks`, `tiles`, `cobbles` (Voronoi stones),
  `stripes`, `checker`, `scatter` (pebbles, blades, stars), `cracks` and `gradient`.
  - All are seeded, and periodic when `tile`. The engine's simplex noise is not periodic, so
    tiling needs a periodic lattice noise.
  - Each maps 0..1 onto a ramp of slots, with ordered dither between steps on request (the
    pixel-art shading move).
- **Baker:** `bakeTexture(def, { palette })` is pure and headless. It returns palette indices
  (0 = transparent) and RGBA.
- **Converters:**
  - `textureMap(id)`: a cached nearest-filtered `DataTexture`, repeat-wrapped when `tile`;
  - `spriteSheet(id)`, for `SpriteBatch`;
  - rows for `hud.sprite`.
- **On models:** a part with `tex` gets UVs from its kind at `texel` texels per metre, so texels
  line up across parts:
  - box projection for boxes and slabs;
  - cylindrical for round kinds;
  - planar for meshes.
- **Later, only where it helps:** decal shapes and particle sprites from TextureDefs (today they
  are shader-cut shapes and squares). Riftlight's item and gem icon recipes stay unless a
  TextureDef version reads better.
- **Checks:**
  - unknown slots (a problem);
  - ragged rows, legend characters never used, pixels not in the legend;
  - a seam mismatch on `tile`;
  - salt-and-pepper noise (too many isolated texels to read at 1:1);
  - frames that do not divide the width.
- **Gate B: texel density, measured in the real renderer.**
  - **Setup:** an Asset Lab scene driven by `Engine.step` and `capture()`, on both backends under
    xvfb.
  - **Scene:** a lit floor, a wall and two crates in three candidate textures (planks, bricks,
    cobbles), with lights at `flicker: 'none'`. One textured crate slides across the floor at
    2 m/s. An identical untextured scene (flat colours) is the baseline.
  - **Runs** at 8, 12, 16 and 20 texels per metre:
    - a zoom sweep through Riftlight's wheel settings (0.6–1.6 in ×1.08 steps, with the game's
      easing), at the level and town zooms, landscape and portrait (×0.8). That covers the
      ~10–39 px/m range;
    - the moving crate at zoom 1;
    - a pan, as a sanity check: the iso rig snaps to whole art pixels, so a pan must read ~0.
  - **Metric:** *excess flicker*. Per frame, take the share of textured pixels whose colour
    changed since the last frame, minus the same share in the baseline.
    - The sweep gets one score per zoom-step transition (averaged over that step's easing frames).
    - The crate gets one score.
  - **Threshold:** calibrate one first.
    - Measure a deliberately bad texture (a 1-texel checkerboard at 32 texels per metre) and a
      deliberately calm one (two-colour blobs at 8).
    - Set the pass line a quarter of the way from calm to bad, and record all three numbers.
  - **Outcome:**
    - The default `texel` for level surfaces and static props is the highest density whose every
      zoom-step score passes and whose strips look right.
    - Moving models use the highest density whose crate score passes.
    - If no density passes the sweep, levels and static props stay untextured. If none passes the
      crate test, moving models stay untextured.
    - Sprites and icons are unaffected.
    - Record the numbers and the result in docs/ASSETS.md and the Status table.

## 6. Tools

There are two CLIs, built to the pattern in docs/ENGINE.md, *Tools for agents*. Each has:
- a pure core in `src/`;
- a script in `scripts/` whose header is its manual;
- text output plus `--json`;
- PNGs in `.scratch/<tool>/`;
- history for `--compare` and `diff`;
- a smoke test in the e2e `tools` suite.

`npm run assets` stays the GLB generator, which is why the new names are not `asset`. `model` and
`tex` own the views of their kinds, drawn with `src/engine/inspect`'s renderer.

**`npm run model -- …`** (`scripts/model.ts`):
- `check [ids]`: validation and metrics for every library model, game model and pack. It writes
  no PNGs, is wired into `scripts/check.sh` next to `anim -- check`, and runs under 10 s.
- `sheet <id> [--params k=v] [--seed n] [--palette slot=colour] [--compare] [--labels] [--rig]`
  draws:
  - an 8-angle turntable;
  - front, side and top orthographic views with a 0.1 m grid and dimensions;
  - game-scale previews (iso 45°/32° at the level and town zooms, nearest ×4);
  - palette swatches;
  - part labels, and anchors and colliders on request;
  - the warnings;
  - the previous version in magenta (`--compare`).
- `diff <id>`: in words, parts added, removed, moved, resized or recoloured, plus bounds, tris and
  draws.
- `find <words|tags>`: the catalog, with sizes, params, token estimates and paths.
- `zoo <family|tag>`: many models at one scale.
- `tokens <id|file>`: chars ÷ 4, the repo's estimate (as in `src/guide.test.ts`).
- On the import side ([section 7](#7-import-pipeline)): `import`, `import-pack`, `trace`, `credits`.

**`npm run tex -- …`** (`scripts/tex.ts`):
- `check`;
- `sheet <id>`: the texture at 1× and 4×, a 3×3 tiling, on a cube and a cylinder at game scale,
  the frames strip, swatches and warnings;
- `diff`, `find`, `import` ([7.5](#75-2d-imports-tex----import)).

**Rasterizer:** `worldTriangles` (in `inspect/render.ts`) carries UVs and baked textures, and
`Canvas.tri` samples them, nearest, per pixel. The views are orthographic, so affine UVs are exact.

**Asset Lab** (`asset-lab.html`, `window.__ASSET_LAB__`) shows the real renderer: toon, outlines,
looks and lights.
- Calls: `list()`, `show(id, { params, seed, palette })`, `lineup(ids, { cols })` at the game
  camera, `setLook`, `capture()` (PNG data URL).
- Add the page to `vite.config.ts`'s inputs.
- Its e2e suite joins a CI group in `scripts/e2e.mjs` `GROUPS` and keeps that group under the
  15-minute job limit.

**The loop**, written up in docs/ASSETS.md like ANIMATION.md's:
1. `find` the nearest examples and copy one.
2. Edit.
3. `check`.
4. `sheet --compare` and open the PNG.
5. A Lab lineup for anything that ships in a game.
6. Repeat until clean and readable at game scale.

## 7. Import pipeline

### 7.1 Licences and network (Phase 0 escalation, then Gate C)

Committing third-party content is a licence decision. It is irreversible and outside the project,
so it waits for a human (docs/DOCTRINE.md, *Escalation*).

- **Phase 0 opens an `escalation` issue proposing:**
  - **CC0 allowed,** checked pack by pack from the licence file in the download, with provenance
    recorded. Quaternius now labels some packs with its own QAL, which bans redistributing the
    assets even modified; those are not allowed.
  - **CC-BY only per pack,** with explicit approval and generated attribution (game-icons.net,
    Icosa Gallery).
  - **Not allowed:**
    - share-alike, no-derivatives, non-commercial and "no redistribution" terms;
    - sources that need an account, an API key or OAuth (Sketchfab, Poly Pizza, Smithsonian);
    - any fetching a site's terms forbid. Poly Haven and Lospec ban scraping, so use their APIs.
- **Approval means a comment or label from a human account,** such as the repository owner. An
  agent's comment never counts. Each pack in `src/engine/model/packs/sources.ts` links its
  approval:

  ```ts
  { id, url, sha256, licence, author, homepage, approved: '<comment link>' }
  ```
- **Until approval:** build and test the importer on fixtures we generate ourselves, and commit no
  third-party bytes. The fixtures are:
  - GLBs exported by `GLTFExporter` from our own ModelDefs;
  - PNGs from `encodePng`;
  - inline SVG.
- **Raw downloads are never committed.** They live in `.scratch/import-cache/`, checked against
  the pinned sha256.
- **Import runs only when an agent asks.** CI never touches the network.

### 7.2 Mesh import (automatic, faithful): `model -- import <file> --as <id> --licence <spdx> --source <url>`

**Formats**
- glTF/GLB, through three's `GLTFLoader` in Node (as tests already do).
- OBJ and VOX only when a pack needs them. three r186 ships both loaders, and `.vox` is already
  palette-indexed.

**Kits differ in how they colour models:**
- older Kenney kits use named flat materials (Furniture, Nature);
- newer Kenney kits use one shared `colormap.png` (Castle, Mini Dungeon);
- KayKit uses one gradient atlas per pack. Its GitHub repos clone without an account.

**Normalize**
- metres, +Y up, +Z front;
- base on y = 0, centred footprint;
- explicit `--scale` and `--front` when a pack differs.

**Geometry**
- One `mesh` part per source node and material group, named after the node.
- Weld vertices, quantize them to millimetres, and use flat normals.
- Recognise primitives only where the test is exact: an 8-vertex, 12-triangle oriented box becomes
  `box`; a regular n-gon prism becomes `cyl` with `seg: n` (principle 3).

**Colour sources**
- The material base colour.
- Vertex colours.
- A texture atlas, sampled per face at the UV centroid.
  - The image may be embedded (`bufferView`) or external (`uri`, relative to the file).
  - `GLTFLoader` cannot decode images in Node, so the importer reads them itself with an in-house
    PNG decoder.
  - The decoder takes an injected `inflate` (tools pass `node:zlib`), so browser code never pulls
    in Node modules.

**Slots**
- Colours are clustered into slots ([7.3](#73-palette-mapping)).
- Slot names come from material names when they mean something (`wood`, `metal`). For atlas packs,
  an agent fills a per-pack slot table once, from the pack's swatch sheet.
- `source.colours` keeps each slot's source sRGB, for re-mapping later.

**Output**
- One JSON file per pack, `public/packs/<pack>.json`. `loadPack(url)` fetches it the way
  `loadModel` fetches GLBs.
- `scripts/bundle.mjs` builds with `codeSplitting: false`, so packs must stay files and never be
  imported into `pixel-engine.js`.
- The import also writes a fidelity sheet ([7.6](#76-fidelity-scoring)).

**`import-pack <pack>`** fetches the pack (approved packs only), verifies the hash, imports every
model, and writes the pack file, a summary and a zoo.

### 7.3 Palette mapping

A naive nearest-OKLab match turned Kenney's pale wood into `white` in the experiment. The mapper
therefore works on a whole model or pack:

- **Cluster** per-face colours in OKLab, with hue weighted up, into 2–6 clusters. This absorbs
  baked gradients: the Castle atlas has 124 colours, a median of 15 per model.
- **Assign** clusters to palette entries in order of area.
  - The cost is `ΔL² + (0.7·ΔC)² + (2.5·hue chord)²`.
  - Add a penalty when a grey and a colour swap, and another for reusing an entry another cluster
    already took.
  - These are the prototype's starting constants; tune them.
- **Keep** lightness order within a hue family.
- **Unit tests** use a labelled fixture: ~30 source colours, each with its acceptable entries.
  - Warm stays warm, grey stays grey, and distinct colours stay distinct.
  - Pink goes to `red` or `orange`, never `white`. The prototype got this one wrong.
  - The result is deterministic.
- **The sheet shows source and mapped swatches side by side,** so a bad pick is a one-line fix in
  the def's `palette`.

### 7.4 Trace (agent-assisted, editable): `model -- trace <id> --against <pack:model | file>`

The LLM decompiles and the tool judges.

**`--reference` prints what to author from:**
- bounds;
- boxes per node, per material and per connected component;
- fitted boxes of a convex decomposition, as hints only (Rapier 0.20 exposes V-HACD as
  `ColliderDesc.convexDecomposition`);
- cluster colours;
- front, side and top orthographic views with a 0.1 m grid.

**The agent writes a primitive ModelDef with the library.** `trace` then scores it:
- silhouette IoU per view, at game and close scale;
- colour agreement;
- an overlay PNG with the source outline drawn over the trace.

**Thresholds** start at game-scale IoU ≥ 0.85, close ≥ 0.75, and a mean OKLab distance ≤ 0.08
over overlapping pixels. Tune them after the first 10 traces.

**Trace** the assets a game will vary (params, seeds, themes) and the style examples. Mesh imports
cover the rest.

### 7.5 2D imports: `tex -- import`

- **Pixel-art PNG sheets** (`--grid 16x16`): sliced into `pixels` layers whose legends map to
  palette entries. This is exact when the source palette maps cleanly; the sheet reports the
  colours it merged.
- **Optional, only when a game needs it:**
  - **Photo and PBR materials** (`--size 32 --colors 4`, from PNG variants):
    - area-average downsampling in linear light;
    - a slot ramp with optional ordered dither;
    - a seam check.
  - **SVG icons** (`--size 24`; detail collapses below that): `path` layers plus an outline.

### 7.6 Fidelity scoring

Source and translation are drawn by the same rasterizer at 4 yaws, at game scale and close scale.

| Measure | Mesh imports | Traces |
| --- | --- | --- |
| Silhouette IoU, background subtracted | ≥ 0.98 (lower is an importer bug) | ≥ 0.85 game, ≥ 0.75 close |
| Colour agreement: mean OKLab distance on overlapping pixels | reported | ≤ 0.08 |
| Bounds delta | reported | reported |

Scores go into `source.fidelity` and the PNG into `.scratch/model/fidelity/`.

### 7.7 Provenance and credits

`source` holds `{ url, pack, file, licence, author, sha256, tool, colours, fidelity }`.
`model -- credits` writes the attribution list, which the kit ships. `check` fails on a missing or
disallowed licence.

### 7.8 Rejected, with evidence

- **Voxel-to-box decomposition.** On 16 Kenney Furniture models it needed a median of 109 boxes
  (up to 609), turned to voxel mush close up, and took more text than the mesh.
- **General primitive fitting.** Research-grade; no permissively licensed JS library exists.
- **Base64 meshes.** No smaller than millimetre-integer text, and unreadable.
- **Committing source binaries.** Doctrine principle 5: binary only with human approval.

## 8. The library

**Where it lives**
- Engine built-ins in `src/engine/model/library/<family>.ts` and
  `src/engine/texture/library/<family>.ts`.
- Catalogs `MODEL_LIBRARY` and `TEXTURE_LIBRARY` (`get`, `find({ tags, text })`, `all`).
  `BUILTIN_MODELS` stays the list of GLB names.
- Game-owned content stays in the game: Riftlight props live under `src/riftlight/levels/themes/`.
- Packs are JSON files ([7.2](#72-mesh-import-automatic-faithful-model----import-file---as-id---licence-spdx---source-url)).

**Families to start with:**
- containers, furniture, lighting;
- architecture pieces (wall, door, window, arch, column, stairs, fence, roof, gate);
- nature (trees, bushes, rocks, stumps, logs, mushrooms, flowers);
- dungeon and town dressing;
- weapons, tools, loot, signs and markers.

A sci-fi set waits for a game that wants one.

**Textures**
- Surfaces: planks, bricks, stone, cobbles, flagstones, tiles, shingles, thatch, grass, dirt,
  sand, snow, ice, metal plates, rust, moss, cloth, carpet.
- Icons and sprites: items, skills, UI glyphs, critters, effects.

**Quality bar for every entry:**
- `check` is clean;
- the family zoo has been opened and looked at;
- the game-scale preview reads: a silhouette and colours that separate its parts;
- `about` and `tags` are filled in;
- it is parametric where variation is cheap (sizes, counts, seeds).

**Targets**
- **Phase 4:** at least 40 models, 20 surface textures, and 20 icons or sprites.
- **Phase 7:** at least 150 models, 60 textures, and 80 icons or sprites, plus approved packs
  ([Appendix B](#appendix-b-sources)). For example:
  - Kenney Furniture (140 models), Castle (76), Nature (329) and Mini Dungeon;
  - KayKit's dungeon and medieval sets;
  - 0x72's DungeonTileset II and Kenney's pixel packs for 2D.

## 9. Use in Riftlight and Engine World (only where it improves things)

**Props**
- Re-author the 13 as ModelDefs and add at least 15 more, listed in themes.
- `PropDef` gains `model?: string` and `bind?(theme) => { palette, light }`. The game computes
  tints and `theme.torch` values; `buildProp` builds the model.
- Put before and after captures in the PR. `npm run level -- validate 1..60` (build time and
  bypass) and the `riftlight-levels` e2e suite stay green.

**Items**
- One weapon ModelDef per weapon class, shared by the ground drop and the held weapon
  (`actors/weapons.ts`, `loot/world.ts`).
- The def supplies the shape and an oriented `grip` anchor.
- The code keeps the rest:
  - the hand's +Z grip, `GRIP`, `SWORD_TILT` and the two-hander scale;
  - the ground drop laid flat;
  - the bow's animated string (`setString`).
- Icons rendered from the def are a follow-up, done only if they read better than today's
  recipes.

**Levels:** if Gate B passes, theme floor and wall textures. `layout/geometry.ts` emits UVs and
themes name their textures.

**Town:** new dressing goes through `kit.model`. Existing buildings stay unless improved.

**Engine World:** a `models` room, a walk through the library with pads for params, palettes and
textures. Optional; it gives every family e2e coverage in the real renderer.

## 10. Engine kit (agents outside the repo)

- `src/bundle.ts` exports the model and texture APIs and the built-in library. Packs ship as
  separate JSON files.
- `docs/GUIDE-ASSETS.md` is written for outside agents and shipped as `ASSETS.md`; docs/ASSETS.md
  stays the in-repo guide.
  - It covers the format, the loop and the style rules.
  - Its named code blocks hold the kit example: a scene built from library models and textures.
  - `scripts/bundle.mjs` (`guideBlocks`), a test like `src/guide.test.ts` (real exports, examples
    that compile, a token budget) and `scripts/e2e-bundle.mjs` (plays the example) all read it.
  - `GUIDE.md` gets one paragraph pointing to it; it has ~1.1k tokens of budget left.
- `check.mjs --sheets` renders model sheets in Chromium. That means exporting the sheet renderer,
  which is not exported today.
- Anything a game can see bumps the version and adds a CHANGELOG section.

## 11. Phases

Each phase is one or more focused PRs. Any PR that changes something a game can see (engine
exports in `src/engine/index.ts`, which the kit re-exports through `src/bundle.ts`, or engine
behaviour) bumps `package.json`'s minor version and adds its `CHANGELOG.md` section. That is the
AGENTS.md rule, and `npm test` fails when the version has no section.

| # | Phase | Main content | Acceptance (besides `scripts/check.sh` and a verifier review) |
| --- | --- | --- | --- |
| 0 | Escalation and environment | The licence `escalation` issue ([7.1](#71-licences-and-network-phase-0-escalation-then-gate-c)). If check.sh still fails under the default `node`, fix it in its own PR. Prefer making `scripts/generate-assets.mjs` byte-stable across Node versions by rounding vertex data before export (V8's `Math.sin`, `cos` and `pow` differ between versions). Otherwise make the check run the generator with the `.nvmrc` version, keeping its "regenerated it, review and commit" path for intended changes | Issue linked in Status; `scripts/check.sh --fast` passes with the default `node`, or the PR says why it can't; if `hero.glb` changed, `anim -- check` passes and its sheets were looked at |
| 1 | Model core | `src/engine/model/`: types, `model()`, helpers, `buildModel`, `expandModel`, colliders, anchors, pivots, light, and validation with every problem plus the floating, thinness, budget and material warnings. The unit-geometry move. Engine `glowMaterial`. The seed library compiles; its visual fixes wait for 2a's sheets | Fill rules hold, including polygons and `top`; mirror keeps outward normals; `on`, `use`, params and seeds work; builds are deterministic; draws = materials (pivots aside); one test per problem kind; the seed library has zero problems. Monster bodies are identical: a test hashes positions and normals (rounded to 1e-6, because V8's Math functions differ between Node versions), indices, rounded `matrixWorld` and colours for bosses 1–12 and 20 seeded monsters. The hashes are captured before the move, under Node 22, and every hash or fingerprint test rounds the same way. `monster -- check` passes. e2e `riftlight`, `riftlight-monsters`, `riftlight-levels` and `world` on both backends. Version and CHANGELOG |
| 2a | Model tools, **Gate A** | `npm run model` (check, sheet, diff, find, zoo, tokens); the Phase 2a warnings; colours in the inspect fingerprint; the seed library's visual fixes | Sheets opened and looked at; `model -- check` in check.sh, under 10 s; a tools smoke test; Gate A recorded ([12](#12-success-measures-and-gates)) |
| 2b | Docs and Asset Lab | docs/ASSETS.md, an ENGINE.md section, AGENTS.md and README rows; `asset-lab.html` and its e2e suite | Lab e2e on both backends, in a CI group within its time limit |
| 3 | Textures, **Gate B** | `src/engine/texture/` (layers, patterns, baker, `textureMap`, `spriteSheet`); model UVs; the `mergeStaticMeshes` fix; rasterizer sampling; `npm run tex` | A textured model renders on WebGPU and WebGL 2 with no GPU errors (`systems` suite); `riftlight-levels` and `world` (users of `merge.ts`) green on both backends; `tile` defs are seamless; Gate B recorded |
| 4 | First library and Riftlight | At least 40 models, 20 textures and 20 icons; the 13 props re-authored and 15+ new ones in themes; shared weapon defs; level textures if Gate B passed | Zoos and Lab lineups looked at; before and after captures. `npm run level -- validate 1..60`; `anim -- check`; `anim -- sheet Slash1 --weapon <class>` per class; `npm run film -- arena-combo arena-axe arena-bow arena-staff arena-wand`; `weapons.test.ts`. e2e `riftlight`, `riftlight-levels`, `riftlight-combat` and `riftlight-loot` |
| 5a | Mesh import, **Gate C** | glTF/GLB import, atlas sampling, PNG decoder, palette clustering and mapping, provenance, JSON packs and `loadPack`, `import`, `import-pack`, `credits`; self-made fixtures | Round trip (our def → GLB → import) IoU ≥ 0.98 with exact colours; mapper fixture tests; no network in tests; approved packs imported, or skipped as recorded |
| 5b | 2D import | `tex -- import` for pixel-art PNG sheets; the optional importers only for a game that needs them | Reported merges are correct on fixtures; tileset slicing exact |
| 6 | Trace | `trace` with `--reference`, the fidelity sheet, docs for the workflow | 10 traces at the thresholds (then tuned), with tokens per trace recorded |
| 7 | Library scale-out | The Phase 7 targets ([8](#8-the-library)); packs (Gate C); catalog; zoos; optional World room | All `check` clean. One subagent per family (brief → author → check → sheet → fix), then a verifier pass per family. Several PRs, by family |
| 8 | Engine kit and report | [Section 10](#10-engine-kit-agents-outside-the-repo); Gate A run again with the full library (same protocol); results in Status and docs/ASSETS.md; follow-ups listed | The `bundle` e2e suite plays the GUIDE-ASSETS example; version and CHANGELOG |

**Read first, by phase** (after the plan, AGENTS.md and DOCTRINE.md):

| Phase | Read |
| --- | --- |
| 0 | DOCTRINE *Escalation*; `scripts/check.sh`; `scripts/generate-assets.mjs`; `.claude/hooks/verify-on-stop.sh` |
| 1 | [Section 4](#4-the-model-format-modeldef-srcenginemodel); `src/riftlight/monsters/{geometry,build,skin}.ts`; `monsters/parts/kit.ts`; `src/riftlight/town/kit.ts`; `src/engine/render/{toon,merge}.ts`; `src/engine/inspect/report.ts`; ENGINE.md *Making a game*; the top of `CHANGELOG.md` |
| 2a | [Section 6](#6-tools); `src/engine/inspect/{render,report}.ts` (`worldTriangles` is in render.ts); `src/engine/animation/raster.ts`; `scripts/inspect.ts` and `scripts/anim.ts` (CLI and history pattern); `scripts/e2e.mjs` (`runTools`); ANIMATION.md *The loop* |
| 2b | docs/ANIMATION.md (the model for docs/ASSETS.md); `src/lab/`, `lab.html`, `vite.config.ts` (page inputs); `scripts/e2e.mjs` (`GROUPS`) |
| 3 | [Section 5](#5-the-texture-format-texturedef-srcenginetexture); `src/engine/hud/Hud.ts`; `src/riftlight/skills/icons.ts`; `src/engine/render/{sprites,toon,merge}.ts`; `src/engine/procgen/noise.ts`; `src/engine/camera.ts` (snap, zoom); `src/riftlight/game/Riftlight.ts` (zoom and easing); `scripts/film.ts` |
| 4 | `src/riftlight/levels/themes/{props,themes}.ts`; `levels/plan.ts`; `levels/layout/geometry.ts`; `src/riftlight/actors/weapons.ts` and its test; `src/riftlight/loot/world.ts`; `src/riftlight/town/{kit,Town}.ts`; GAME.md *Themes and props* |
| 5a, 5b | [Section 7](#7-import-pipeline); `scripts/inspect.ts` (GLB loading in Node); Appendices A and B |
| 6 | 7.4 and 7.6 |
| 7 | docs/ASSETS.md; the library files; WORLD.md *Add a room* (for the optional room) |
| 8 | [Section 10](#10-engine-kit-agents-outside-the-repo); `src/bundle.ts`; `scripts/bundle.mjs`; `scripts/bundle/check.mjs`; `scripts/e2e-bundle.mjs`; `src/guide.test.ts`; docs/GUIDE.md |

## 12. Success measures and gates

**Gate A: the token benchmark.** It runs at the end of Phase 2a, before 2b's docs and Lab land,
and again in Phase 8.
- **Briefs** (4, none in the seed library):
  1. a two-wheeled hand cart;
  2. a stone archway;
  3. a campfire ring with logs and stones;
  4. a weapon rack holding three weapons.
- **Arm (a):** code on the town `Kit`.
  - Reads: `src/riftlight/town/kit.ts` and a small harness that renders the result and reports
    `inspectObject` warnings.
  - Done when there are no warnings and the subagent judges the game-scale preview readable.
- **Arm (b):** a ModelDef with the seed library.
  - Reads: the `model` types, the seed library and `npm run model -- help`.
  - Done when `model -- check` is clean and the preview reads.
- **Judge images:** both arms' final images come from one function: a turntable plus game-scale
  previews, with no swatches, labels or grids. That way the judge can't tell the arms apart.
- **Runs:** 3 fresh subagent runs per arm and brief, 24 in all. Expect roughly 1.5–3.5M tokens
  for the gate.
- **Metric:** the `subagent_tokens` figure in each run's Agent-tool completion notice (the planning
  session saw it on every subagent).
  - Take the median of the 3 runs for each brief and arm.
  - R = Σ medians(b) ÷ Σ medians(a).
- **Quality:** for each brief, a fresh judge subagent sees the judge images of the median runs of
  (a) and (b), unlabelled and in an order it is not told, and picks one or calls a tie.
- **Pass** if either holds:
  - R ≤ 0.8, and (b) wins or ties in at least 3 of 4 briefs;
  - R ≤ 1.0, and (b) wins outright in at least 3 of 4.
- **Fail:** stop. Record the numbers in Status and open an `escalation` issue recommending whether
  to keep or revert Phases 1–2a. Revert nothing without an answer.

**Gate B: texel density.** See [section 5](#5-the-texture-format-texturedef-srcenginetexture).

**Gate C: licences.** The escalation's approvals decide which packs Phases 5a and 7 may import.

**Other measures:**
- **Library:** the Phase 4 and Phase 7 targets.
- **Import fidelity:** the [7.6](#76-fidelity-scoring) thresholds.
- **Use:**
  - Riftlight has more distinct props (13 today; 3–5 per theme);
  - the kit's example builds a scene from library assets;
  - `model -- check` runs in CI in under 10 s.

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| The rasterizer preview differs from the real renderer (no lights, filters or outline pass) | Lab lineups in the real pipeline are part of acceptance for anything that ships |
| Programmer-art models | Library-first composition, style rules, zoos reviewed by a verifier, captures in PRs for human taste |
| Texture shimmer across zoom | Gate B, measured; the fallback scope is defined |
| Gate A cost and noise | 4 briefs × 3 runs, medians, a stated metric; the cost is stated up front |
| Bundle and repo growth (mesh text: ~2 KB a model, 383 KiB for 140) | Packs are JSON files, loaded on demand and never inlined into the kit; curated packs only |
| Over-building | Phases ordered by value; gates; the optional importers wait for a user |
| A second way to do things | Kits gain `model` placement, not new primitives; new content uses ModelDefs; one view per job |
| Licence mistakes | Phase 0 escalation, approval by a human account, provenance as data, `check` refuses unknown licences, no raw bytes in git |
| The Node mismatch keeps the Stop hook red | Phase 0 fixes it first |

## 14. Status

**Gate A failed twice** (row 2a; docs/plans/gate-a.md). After the first failure a human chose option 2 of [#54](https://github.com/michaelcrosato/riftlight/issues/54) (fix, run again) and told the run to "complete the plan to bring this feature to full completion, do what you need to". The second run failed too (R = 1.017, no outright win for ModelDefs), so the plan continues on that instruction rather than on the gate. Phase 8 measures again with the full library.

| # | Phase | State | PRs | Numbers and notes |
| --- | --- | --- | --- | --- |
| 0 | Escalation and environment | done | escalation [#49](https://github.com/michaelcrosato/riftlight/issues/49) (open: waiting on a human); [#50](https://github.com/michaelcrosato/riftlight/pull/50) | Measured cause: only the GLB JSON differed between Node 22 and 24, in the material `baseColorFactor` values (three's sRGB to linear `Math.pow`, 1 ulp apart); the binary chunks (vertex data) were already identical. Fix: `generate-assets.mjs` rounds linear colours to 1e-6 before export (colours, not the vertex data the row suggested, because that is where the bytes differed). The GLBs are now byte-identical on v22 and v24; every palette hex survives the rounding; `check.sh --fast` passes on the default v24; `anim -- check` passes and the Run sheet was looked at. Gate C waits on #49 |
| 1 | Model core | done | [#52](https://github.com/michaelcrosato/riftlight/pull/52) (engine 0.17.0); departures in [#51](https://github.com/michaelcrosato/riftlight/issues/51) | `src/engine/model/`: the types, `model()`, `around`/`rowOf`/`gridOf`/`scatterOf`/`boxFrame`, `buildModel` (one faceted mesh per material, pivots, `on`, `use` with slot mapping, mirrors, params, seeds; unseeded builds cached with shared geometry), `expandModel` (plain JSON), collider data plus `addModelColliders`, anchors, the light request, `validateModel`/`checkModel` (every problem kind, plus the floating, thinness, budget and material warnings), `ModelCatalog` and `MODEL_LIBRARY`. 76 unit tests. The fill, outward-normal, mirror, open-lathe and seed-sweep tests were each seen to fail with their guard broken. The seed library compiles with 0 problems: barrel 328 tris/3 draws, crate 204/2, lamp-post 248/2, statue 220/3, well 376/5, market-stall 892/5, greatsword 132/4, with exactly the Appendix A part counts. Its warnings wait for 2a's sheets: lamp-post rods (lantern frame 0.03 m ×12, arm 0.05 m, hook 0.02 m), the well's roof halves 0.04 m clear of the posts and a 0.03 m rope, the greatsword's 0.03 m edge slab. Unit geometry moved to `src/engine/model/geometry.ts`; the monster bodies (bosses 1–12, 20 seeded monsters) hash identically before and after (`monsters/bodies.test.ts`, a vitest snapshot captured on the pre-move code under Node 22, the same on 24; a changed unit sphere turns it red). `monster -- check`: 0 problems. e2e `riftlight`, `riftlight-monsters`, `riftlight-levels` and `world` pass on both backends (586 checks); they guard the move, and nothing renders `buildModel` in the real renderer until 2b's Asset Lab. Engine `glowMaterial`; the monsters' unused duplicate went, the props' stays until touched. Departures ([#51](https://github.com/michaelcrosato/riftlight/issues/51)): the floating warning works on clusters with the floor; warnings and metrics come from the check, not every build; CC0 only until #49; `use` slot rules; a seed stream per model |
| 2a | Model tools, Gate A | done: Gate A failed twice | tools: [#53](https://github.com/michaelcrosato/riftlight/pull/53) (engine 0.18.0); Gate A: [#55](https://github.com/michaelcrosato/riftlight/pull/55) | `npm run model` (`scripts/model.ts`): `check` (every model at each param's min and max and 3 seeds; in check.sh, under 0.1 s for the library then, ~0.3 s with 0.19.0's game-scale checks), `sheet` (8-angle turntable; front/side/top on a 0.1 m grid with dimensions; game-scale previews; palette; warnings; `--labels`, `--rig`, `--compare` in magenta), `diff` (in words: added, removed, moved, resized, turned, recoloured, matched by name, else kind and nearest place), `find`, `zoo` (`all`, a family, a tag or a draft file), `tokens`, and draft `.ts` files as targets. The core is `src/engine/model/{sheet,diff,oklab,readability}.ts`. The 2a warnings: a part hidden inside another (same pivot), z-fighting coplanar faces (bottoms on the floor excepted), and touching large masses under 0.08 OKLab lightness apart; many alike make one line. A 2,900-triangle, 241-part model validates in ~0.1 s. Colours are in the inspect fingerprint. A tools smoke test is in the e2e `tools` suite (seen red with the CLI broken). `src/riftlight/game/gameView.test.ts` keeps the previews' camera equal to Riftlight's. Seed library fixes, from its sheets: barrel hoops at 10 sides; a new lamp-post lantern (the lamp post drops from 248 tris to 108); the statue's sword stands clear of the robe on the plinth (the z-fighting check caught a 5 mm guard/grip overlap); the well's roof meets at the ridge on its posts; the stall's crates clear its leg; the greatsword's sub-pixel edge stripe is gone. All 7 models are clean. Departure ([#51](https://github.com/michaelcrosato/riftlight/issues/51) item 7): the previews use Riftlight's real camera (pitch 42°, 18 px/m × zoom: 19.44 at the level zoom, 21.96 in town). **Gate A: failed** (docs/plans/gate-a.md, *Results*). Tokens, Σ of the medians: Kit (a) 434,016, ModelDef (b) 426,785, **R = 0.983** (hand cart 1.12, archway 1.07, campfire 0.75, weapon rack 1.13). Quality: (b) won 1 of 4 (the weapon rack); (a) won the hand cart, archway and campfire. Two more judge sets, outside the protocol, tested it. One swapped the image order (the seeded coin had put (a) first in every brief). The other used neutral file names (the first judges' paths had named the arm). Both gave (a) the same three briefs, and with the order swapped the weapon rack went to (a) too. R above 0.8 needs 3 outright wins, so the gate fails. (b) lost mostly on colour and light: one colour over large areas made of many parts, and a glow flame drawn as a flat fill over the logs. The Kit campfire also added seats and a woodpile beyond the brief. The gate cost 2.56M tokens for the runs and 0.78M for the three judge sets. The judging protocol now copies images to neutral names. The plan stops here: escalation [#54](https://github.com/michaelcrosato/riftlight/issues/54) recommends keeping Phases 1–2a and asks whether to stop, fix and run Gate A again, or revert. Nothing is reverted. The judged models' sources (each redraws its judge image) are in `docs/plans/gate-a/`; the staged Phase 2b patch landed in Phase 2b. **Decision** ([#54](https://github.com/michaelcrosato/riftlight/issues/54), a human in the session): option 2. The judge PNGs first committed in #55 broke principle 5 (binaries only with approval) and are replaced by the models' sources. **Fixes for the second run** ([#57](https://github.com/michaelcrosato/riftlight/pull/57), engine 0.19.0; docs/plans/gate-a.md, *Second run*): two warnings counted on the game's own pixels (4+ large parts of one colour joined into 40%+ of the model; glow over 15% once it is 30+ art pixels), each calibrated so it flags the judged losers and none of the 12 Kit runs; the raster is depth and ids only, capped at 512 px a side; the material warning from over 6 to over 8; the format's header says what reads at 480×270; library `flame`, `rock`, `stone-ring` and `arch` (all 570 param-corner and seed builds clean); the statue's sleeves in the darker stone (an art choice); a def without `about` or `tags` is a problem instead of a sheet crash. Departures: the material limit and the "2–4 slots" style rule (§4.4) move to over 8 and "as many as the parts need" on Gate A's evidence; no lit rim for glow in sheets (it would make the preview lie). **Second run:** R = 1.017 (hand cart 1.12, archway 1.20, campfire 0.84, weapon rack 1.00); judged from neutral names in both orders, the Kit won the hand cart, campfire and weapon rack, and the archway tied. The colour fixes held (no (b) model read as one flat colour); the library flame reads brown upright and `arch` warns when set on piers (both for Phase 4). The plan continues on the human's instruction ([#54](https://github.com/michaelcrosato/riftlight/issues/54)) |
| 2b | Docs and Asset Lab | done | [#59](https://github.com/michaelcrosato/riftlight/pull/59) | docs/ASSETS.md (the loop, the sheet, the format, the checks, style rules updated to 0.19.0, Gate A's numbers so far), an ENGINE.md *Models as data* section, AGENTS.md and README rows. The Asset Lab (`asset-lab.html`, `src/lab/assetLab.ts`, `window.__ASSET_LAB__`: list, show, lineup, zoom, clear, setLook, state, capture; `?model=`, `?lineup=`, `?zoom=` a number or level/town/close, the engine's own `?look=`) on a quiet 1 m checker. Its e2e suite `asset-lab` joins `@cameras` (~70 s locally; the group took 2 min 21 s in CI before it; limit 15 min): every library model changes 1,000+ pixels over the empty floor at the same camera with its light off, a light is requested and released, bad ids, zooms and looks throw and leave the lab as it was, a lineup, a look, capture, and the URL params, on WebGPU and the WebGL 2 fallback. Seeded builds' geometry is disposed when the lab clears |
| 3 | Textures, Gate B | done: Gate B passed at 8 texels/m | 3a: [#60](https://github.com/michaelcrosato/riftlight/pull/60) (engine 0.20.0); 3b: [#61](https://github.com/michaelcrosato/riftlight/pull/61) (engine 0.21.0); Gate B: [#63](https://github.com/michaelcrosato/riftlight/pull/63) (engine 0.22.0) | **3a**: `src/engine/texture/` (the four layer kinds; the ten patterns, seeded, with a 4×4 ordered dither; `bakeTexture`, which holds every problem so the converters refuse what the check refuses; `validateTexture`; `textureMap`, `spriteSheet`, `hudSprite`; `textureDef`; `TEXTURE_LIBRARY` with six surfaces, a gem icon and a 4-frame coin), `npm run tex` (check in check.sh, sheet, find, zoo; a smoke test in the e2e `tools` suite), docs/ASSETS.md *Textures*. One generic `Catalog` under both catalogs. Tiling patterns wrap by construction: layouts fit a whole number of cells (courses that shift come in pairs), so no sliver lands on the wrap; tests assert it directly (run lengths over a 3×3 tiling for bricks, tiles, planks and checker across 4 sizes and many parameters, the stripe cycle across the wrap, stones closed by joints across the edge, wrapped stars and cracks) and each went red against the old generators. The seam metric (wrap line vs the busiest line inside) now judges only drawn layers (pixels, paths, gradients); a first version also measured generated patterns and both missed slivers and flagged seamless cobbles (found by the verifier). Every library texture is clean; the sheets were looked at (cobbles read a little notched and grass repeats visibly at 3×3: Phase 4 polish) **3b**: a part's `tex` gets UVs at the model's `texel` density (`DEFAULT_TEXEL` 16 until Gate B; 2–64): flat kinds box-projected on the part's own axes from the model's origin (texels line up across parts and follow a turned part), round kinds wrapped in whole repeats with caps from above; departure: imported meshes are box-projected per face like the flat kinds, not planar as §5 says, so one rule covers every face; one toon material per texture, on white. `ModelOptions.textures` (a `TextureCatalog`) for builds and checks. Checks: unknown or broken textures, glow with tex and texel out of range are problems; a texture that doesn't tile warns; textured parts count as their mean colour for lightness and never join a one-colour block. `mergeStaticMeshes` keeps `uv` under a map and `color` under vertex colours. The software rasterizer samples in-memory maps per pixel (`Canvas.tri` takes a shader), so model sheets and `inspect` draw texels; `tex -- sheet` adds a cube and a cylinder at game scale. Library `brick-wall`; the sandbox shows it built and merged, and the `systems` suite checks map, UVs and visible bricks on both (WebGPU and WebGL 2, no GPU errors). `riftlight-levels`, `world` and `asset-lab` pass on both backends. Each new unit test was seen red with its guard broken (UV density, alignment, turned parts, whole repeats, the seam, mirrored UV order, raster sampling rows/wrap, merge attributes, mean colour, textured blocks) **Gate B** (docs/ASSETS.md, *Texel density*; `npm run gate-b`, `src/lab/gateB.ts`): the Asset Lab's scene (a cobbles floor, a bricks wall, planks crates, a light at `flicker: 'none'`) stepped through the settings-wheel zoom sweep (from 0.6 in ×1.08 steps to 1.6, the stops reached scrolling in from the clamp, each eased as the game eases it until within 1e-3 of its goal) at the level and town zooms, landscape (480×270) and portrait (124×270, ×0.8), a crate sliding at 2 m/s at zoom 1, and a pan; each frame scored as the share of pixels changed since the last after undoing the camera's whole-pixel snap, minus the flat run's; 20 settle frames (the lab camera and the scene's light fade) aren't scored; quality fixed at medium. Calibration: calm (two-colour blobs at 8, one blob a tile) 0.97% mean step, bad (1-texel checker at 32) 20.96%, so the sweep's pass line is 5.97%; the crate's is 0.049% (calm 0.008%, bad 0.173%). Worst of 52 zoom steps (the landscape level zoom's 0.65→0.70): 8 texels/m 5.42% (pass), 12 7.95%, 16 10.25%, 20 12.36%; the crate passes at all four (0.014–0.042%); the pan reads 0 (the rig snaps); WebGPU and the WebGL 2 fallback measured the same to two decimals, and the filmstrips agree (8 reads as stones at every zoom; 12 goes to fine noise at the most zoomed-out steps; 16 and 20 are noise there). **Decision (reversible, recorded here):** the plan sets the line a quarter of the way from calm to bad without saying how each becomes one number; their mean steps are used. A line per step (12's worst at 0.89 of the way, 16's at 1.21) or one from the worst steps (8.76%) would pass 12; the strips favour the stricter reading. **Outcome:** `DEFAULT_TEXEL` 8 for floors, walls and props; moving models up to `MOVING_TEXEL` 20 (the densest measured; it shimmers while the camera zooms, as a 20-texel surface does). Levels may take textures (Phase 4). Library `brick-wall` defaults to 1.5 m (three whole 0.5 m courses). A first run's calm texture baked to one colour and its smoke check passed with nothing textured (found by the verifier); both are fixed and guarded (`src/lab/gateB.test.ts`; the asset-lab suite compares the textured zoom with the flat one and needs the pan to snap), each seen red with its guard broken. The runs took ~60 min a backend |
| 4 | First library and Riftlight | not started | | |
| 5a | Mesh import, Gate C | not started | | Pack imports also wait on the licence escalation [#49](https://github.com/michaelcrosato/riftlight/issues/49) (Gate C) |
| 5b | 2D import | not started | | |
| 6 | Trace | not started | | |
| 7 | Library scale-out | not started | | Pack imports also wait on [#49](https://github.com/michaelcrosato/riftlight/issues/49) |
| 8 | Engine kit and report | not started | | |

## Effort level

**extra.** The calls that needed deep reasoning were made and checked in the planning session:
the format, what stays, import feasibility, the rejected approaches, and a verifier pass over the
plan. What remains is a long chain of well-specified steps, each checked by a tool. Quality comes
from the measure-and-look loop, the gates and the verifier reviews, not from more thinking per
step.

- **max** would raise the cost of every routine step (moves, docs, tests, library entries) for
  little gain.
- **ultracode** (multi-agent workflows) pays only where work is wide and independent: Phase 7's
  library scale-out, which its row already fans out to subagents. Switch to ultracode for that
  phase alone if you want it faster, at a higher token cost.

## Appendix A: measured evidence

**Prototype (scratch, not committed).** About 120 lines of format and compiler, using positional
helper calls (the final format is keyed, principle 2). It had `box`, `cyl` with taper, `ball`,
`lathe`, `slab`, `torus`, `group`, `mirror`, `around`, `use` and a box frame.
- It compiled to merged toon meshes per colour and rendered through `src/engine/inspect` as a
  turntable plus a game-scale view at 20 px/m.
- Token estimates, chars ÷ 3.6 (a little higher than the tool's ÷ 4):

  | Asset | Positional prototype | Keyed seed below | Parts | Triangles |
  | --- | --- | --- | --- | --- |
  | barrel | ~113 | ~154 | 5 | 400 |
  | crate with frame and braces | ~108 | ~144 | 17 | 204 |
  | lamp post | ~138 | ~226 | 18 | 272 |
  | robed statue with sword | ~195 | ~256 | 9 | 348 |
  | greatsword | ~160 | ~209 | 7 | 304 |
  | well | ~184 | ~240 | 28 | 400 |
  | market stall (reuses a barrel and two crates) | ~211 | ~219 | 52 | 964 |

  The current Riftlight code costs ~234 tokens for the 6-box statue and ~141 for the 2-box crate.
- **To fix:**
  - lathe profiles that touch the axis leave degenerate triangles, so drop them;
  - in the rasterizer, vertical faces facing the camera fall in the dark band (expected);
  - the statue's sword sat half inside the robe, which is the kind of thing `sheet` exists to
    catch.

**Seed library** (Phase 1). These are the prototype's dimensions, converted to the keyed format by
hand. Compile them in Phase 1, then fix whatever the checks and Phase 2a's sheets show.

```ts
const barrel = model({ id: 'barrel', about: 'Wooden barrel with three iron hoops', tags: ['container', 'wood'],
  palette: { wood: 'orange', band: 'slate', lid: 'red' },
  parts: [
    { lathe: [[0, 0], [0.27, 0], [0.32, 0.2], [0.34, 0.4], [0.32, 0.6], [0.27, 0.8], [0, 0.8]], seg: 10, c: 'wood' },
    { torus: [0.65, 0.05, 0.65], at: [0, 0.1, 0], c: 'band' }, { torus: [0.65, 0.05, 0.65], at: [0, 0.7, 0], c: 'band' },
    { torus: [0.73, 0.044, 0.73], at: [0, 0.4, 0], c: 'band' },
    { cyl: [0.48, 0.03, 0.48], at: [0, 0.8, 0], seg: 10, c: 'lid' },
  ] });
const crate = model({ id: 'crate', about: 'Wooden crate with a frame and diagonal braces', tags: ['container', 'wood'],
  palette: { wood: 'orange', band: 'red' },
  parts: [
    { box: [0.68, 0.68, 0.68], at: [0, 0.36, 0], c: 'wood' },
    boxFrame({ size: [0.72, 0.72, 0.72], beam: 0.09, at: [0, 0.36, 0], c: 'band' }),
    { mirror: [{ box: [0.8, 0.08, 0.04], at: [0, 0.36, 0.35], rot: [0, 0, 45], c: 'band' }], axis: 'z' },
    { mirror: [{ box: [0.04, 0.08, 0.8], at: [0.35, 0.36, 0], rot: [45, 0, 0], c: 'band' }] },
  ] });
const lampPost = model({ id: 'lamp-post', about: 'Iron street lamp with a hanging lantern', tags: ['lighting', 'town'],
  palette: { iron: 'night', flame: 'sand' },
  light: { at: [0.42, 1.78, 0], c: 'flame', intensity: 6, radius: 6, flicker: 'candle' },
  parts: [
    { cyl: [0.3, 0.2, 0.3], at: [0, 0.1, 0], top: 0.6, c: 'iron' },
    { cyl: [0.09, 2.0, 0.09], at: [0, 1.1, 0], seg: 6, c: 'iron' },
    { box: [0.5, 0.05, 0.05], at: [0.22, 2.02, 0], c: 'iron' },
    { name: 'lantern', at: [0.42, 1.78, 0], group: [
      { cyl: [0.32, 0.1, 0.32], at: [0, 0.19, 0], top: 0.25, seg: 4, rot: [0, 45, 0], c: 'iron' },
      boxFrame({ size: [0.2, 0.26, 0.2], beam: 0.03, c: 'iron' }),
      { box: [0.14, 0.2, 0.14], c: 'flame', glow: true },
      { cyl: [0.024, 0.1, 0.024], at: [0, 0.29, 0], c: 'iron' },
    ] },
  ] });
const statue = model({ id: 'statue', about: 'Robed stone figure on a plinth, sword point-down', tags: ['stone', 'monument'],
  palette: { stone: 'mist', dark: 'slate', trim: 'sand' },
  parts: [
    { box: [0.9, 0.28, 0.9], at: [0, 0.14, 0], c: 'dark' },
    { box: [0.98, 0.08, 0.98], at: [0, 0.32, 0], c: 'trim' },
    { lathe: [[0, 0], [0.3, 0], [0.27, 0.2], [0.19, 0.72], [0.2, 0.92], [0.28, 1.04], [0.11, 1.12], [0, 1.12]], at: [0, 0.36, 0], c: 'stone' },
    { ball: [0.24, 0.28, 0.25], at: [0, 1.6, 0.01], c: 'stone' },
    { mirror: [{ box: [0.11, 0.4, 0.12], at: [0.2, 1.2, 0.12], rot: [-38, 0, 12], c: 'stone' }] },
    { name: 'sword', at: [0, 0.38, 0.3], group: [
      { slab: [[-0.05, 0.06], [0, 0], [0.05, 0.06], [0.05, 0.6], [-0.05, 0.6]], depth: 0.03, c: 'stone' },
      { box: [0.3, 0.05, 0.06], at: [0, 0.62, 0], c: 'trim' },
      { ball: [0.07, 0.07, 0.07], at: [0, 0.78, 0], c: 'trim' },
    ] },
  ] });
const greatsword = model({ id: 'greatsword', about: 'Two-handed sword, gold guard, purple grip', tags: ['weapon', 'sword'],
  palette: { steel: 'mist', edge: 'white', gold: 'sand', grip: 'plum' },
  parts: [{ at: [0, 0.06, 0], group: [
    { slab: [[-0.06, 0], [0.06, 0], [0.06, 1.0], [0, 1.14], [-0.06, 1.0]], depth: 0.035, at: [0, 0.3, 0], c: 'steel' },
    { slab: [[-0.015, 0.05], [0.015, 0.05], [0.015, 0.9], [-0.015, 0.9]], depth: 0.04, at: [0, 0.3, 0], c: 'edge' },
    { box: [0.34, 0.06, 0.08], at: [0, 0.28, 0], c: 'gold' },
    { mirror: [{ ball: [0.07, 0.07, 0.07], at: [0.18, 0.28, 0], c: 'gold' }] },
    { cyl: [0.06, 0.22, 0.06], at: [0, 0.14, 0], seg: 6, c: 'grip' },
    { ball: [0.08, 0.08, 0.08], at: [0, 0.01, 0], c: 'gold' },
  ] }] });
const well = model({ id: 'well', about: 'Stone well with water, a winch and a gable roof', tags: ['town', 'stone', 'water'],
  palette: { stone: 'mist', dark: 'slate', wood: 'orange', roof: 'red', water: 'blue' },
  parts: [
    ...around(10, { box: [0.36, 0.5, 0.22], at: [0, 0.25, 0.62], c: 'stone' }),
    ...around(10, { box: [0.4, 0.08, 0.26], at: [0, 0.54, 0.62], c: 'dark' }, { phase: 18 }),
    { cyl: [1.1, 0.05, 1.1], at: [0, 0.3, 0], seg: 10, c: 'water' },
    { mirror: [{ box: [0.1, 1.5, 0.1], at: [0.62, 1.05, 0], c: 'wood' }] },
    { cyl: [0.12, 1.4, 0.12], at: [0, 1.55, 0], rot: [0, 0, 90], seg: 6, c: 'wood' },
    { cyl: [0.03, 0.7, 0.03], at: [0, 1.15, 0], seg: 4, c: 'dark' },
    { cyl: [0.2, 0.16, 0.2], at: [0, 0.76, 0], top: 1.2, c: 'wood' },
    { mirror: [{ box: [0.62, 0.05, 1.0], at: [0.27, 2.0, 0], rot: [0, 0, -38], c: 'roof' }] },
  ] });
const marketStall = model({ id: 'market-stall', about: 'Market stall with a striped awning, crates and a barrel', tags: ['town', 'market'],
  palette: { wood: 'orange', cloth: 'red', cloth2: 'white', top: 'sand' },
  parts: [
    { box: [1.8, 0.08, 0.8], at: [0, 0.9, 0], c: 'top' },
    { mirror: [{ mirror: [{ box: [0.08, 0.86, 0.08], at: [0.8, 0.43, 0.32], c: 'wood' }], axis: 'z' }] },
    { mirror: [{ box: [0.07, 1.3, 0.07], at: [0.86, 1.55, -0.36], c: 'wood' }] },
    ...rowOf(6, [0.3, 0, 0], (i) => ({ box: [0.3, 0.05, 1.0], at: [-0.75, 2.05, 0.06], rot: [-22, 0, 0], c: i % 2 ? 'cloth' : 'cloth2' })),
    { use: 'barrel', at: [1.25, 0, 0.1] },
    { use: 'crate', at: [-1.25, 0, 0.15], rot: [0, 20, 0] },
    { use: 'crate', at: [-1.2, 0.72, 0.1], rot: [0, -10, 0], scale: 0.8 },
  ] });
```

**Kenney Furniture Kit** (CC0, 140 GLBs):
- **Materials:** no textures. Named base-colour materials (`wood`, `metal`, `metalDark`, `carpet`,
  `glass`, `plant`…).
- **Triangles:** median 152, p90 372, max 992.
- **Loading:** headless, with `GLTFLoader.parseAsync`, exactly as the tests load `hero.glb`.
- **As millimetre-integer text:** median 2.1 KB (~800 tokens), p90 6 KB, 383 KiB for the whole kit.
- **Voxel-to-box:** median 109 boxes, game-scale silhouette IoU median 0.88 (5 of 16 at ≥ 0.9).
  Rejected.

**Kenney Castle Kit** (CC0, 76 GLBs):
- **Materials:** one `colormap` material, an external 512×512 `colormap.png` (7.5 KB), and UVs.
- **Sampling** each face at its UV centroid: 124 colours in the kit, a median of 15 per model, and
  only 36% of faces fully inside one flat swatch, because the atlas bakes gradients. Hence
  clustering into slots.

**Kenney Nature Kit** (CC0): 329 GLBs.

**Palette mapping, first try:**
- Nearest OKLab mapped pale wood to `white`.
- Hue-weighted with a reuse penalty mapped wood to `sand` and a red carpet to `orange`, but still
  sent a pink cushion to `white`. Hence the labelled fixture tests in 7.3.

**Pixel density:** the default iso view is 13.5 m over 270 px, so 20 px/m. Riftlight's level and
town zooms (1.08 and 1.22), its wheel setting (0.6–1.6) and its portrait factor (0.8) give ~10–39
px/m. At 16 texels per metre that is 0.65–2.4 art pixels per texel, which is why Gate B sweeps the
zoom.

**Environment:** see the note at the top. The GLB generator is deterministic per Node version.

## Appendix B: sources

Checked on 2026-10-11 through web pages, APIs and sample downloads. Check each again before
importing, and record the answer in `packs/sources.ts`.

| Source | Licence | What, format, access | Use |
| --- | --- | --- | --- |
| [Kenney](https://kenney.nl/support) 3D kits | CC0, credit optional (`License.txt` in each zip) | 50 3D packs, GLB/FBX/OBJ. Older kits use named flat materials; newer kits a shared 512² `colormap.png`. Furniture 140, Castle 76, Nature 329. No account; each asset page links a hashed zip URL, so read the page first | Yes: the best fit |
| Kenney 2D | CC0 | 145 2D packs (38 pixel): PNG sheets, some SVG and Tiled files; some packs use the PICO-8 palette | Yes: tiles, icons, sprites |
| [KayKit](https://github.com/KayKit-Game-Assets) | CC0 (don't resell unmodified copies) | 23 packs, glTF/FBX/OBJ, one gradient atlas per pack. The GitHub org's 10 repos clone without an account; itch has the rest | Yes |
| [Quaternius](https://quaternius.com/license.html) | Per pack: CC0, or QAL v1.0 (2026-08-28: no redistribution, even modified) | 83 packs, glTF/FBX/OBJ, flat atlases or PBR trim sheets. Google Drive and itch links; 64 packs mirrored as CC0 zips on OpenGameArt | CC0 packs only |
| [Poly Haven](https://polyhaven.com/license) | CC0 | API with no key (send a unique User-Agent). 867 textures (1k–8k, PNG/JPG); 521 models with a median of 11k triangles. The site's terms ban scraping | Textures only, shrunk |
| [ambientCG](https://docs.ambientcg.com/license/) | CC0 | API v2/v3 with no key; 2,015 materials; `get?file=<id>_1K-PNG.zip` | Textures only, shrunk |
| [OpenGameArt](https://opengameart.org/content/faq) | Per submission: CC0, CC-BY, CC-BY-SA, OGA-BY, GPL | CC0 counts: 8,089 2D, 2,821 3D, 1,124 textures. No API; crawl-delay 10. LPC is CC-BY-SA plus GPL | CC0 items only |
| [0x72 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii) | CC0 | 16×16 pixel tiles and characters | Yes: 2D |
| [game-icons.net](https://game-icons.net/about.html) | CC BY 3.0 | 4,239 single-path SVGs (git clone); detail collapses below 24 px | Only with approval |
| [Icosa Gallery](https://api.icosa.gallery/v1/openapi.json) (the Google Poly/Blocks archive) | Mostly CC-BY | Public API with no key; 21,675 Blocks models with vertex colours (5,992 curated at ≤ 3,000 triangles) | Only with approval |
| [Lospec](https://lospec.com/palettes/api) | Not stated per palette | Per-palette JSON API; the terms ban scraping | Named palettes only |
| `.vox` packs | Per pack: one CC0 pack of 363 models on OpenGameArt; others CC-BY or CC BY-ND | Palette-indexed voxels; three r186 has a loader | Later, CC0 only |
| Sketchfab, Poly Pizza, Smithsonian, Objaverse | Mixed; NoAI tags | Need login, OAuth or API keys, or mix licences | No |

**What the research says about LLM-made 3D:**
- Raw mesh tokens are long, even at 64 steps per axis (LLaMA-Mesh).
- Code over named, typed primitives with explicit frames works, and works better with
  render-and-check feedback: see CADCodeVerify and Makatura et al., and BlenderGym for what fails
  without it.
- No permissively licensed JS library fits primitives to meshes. That is why imports keep their
  meshes and an agent traces them.
