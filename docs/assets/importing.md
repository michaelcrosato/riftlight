# Importing (`src/engine/model/import/`, `packs/`; `npm run model -- import`, `npm run tex -- import`)

Kits made in a modelling tool come in as data too: the importer turns a glTF or GLB file into a
ModelDef whose parts are `mesh` (millimetre vertices as text, faces per slot), coloured from the
palette. An import is faithful, not editable: trace what a game will vary (params, seeds, themes)
in primitives instead (docs/assets/tracing.md). Pixel-art PNG sheets come in as TextureDefs
(*Pixel-art sheets* below).

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
<pack>` does the same for its sheets (*Pixel-art sheets* below), into the same pack
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
`public/packs/`: the models of `kenney-castle`, `kenney-furniture`, `kenney-nature` and
`kenney-mini-dungeon`, and the tiles of `kenney-tiny-dungeon` and `kenney-tiny-town` (every cell
named). Each sits in the engine's palette through its entry's `palette`
(Nature's mint leaves as `green` and `teal`, Tiny Town's tan paths as `sand`...) and at its
scale through `scale`: Kenney's kits are in tile units of about half a metre, so Furniture and
Mini Dungeon come in at 2 (a doorway 2 m, a character 1.5 m) and Castle and Nature at 3 (a gate
2.7 m, an oak 3.7 m, as the library's). 10 thin pieces (studs, pillows, flowers, grass) score
under 0.98 silhouette IoU at game scale, where they are a few pixels; all are 0.977 or more close
up. See them in the Asset Gallery; credit them from `npm run model -- credits` (CC0: credit
optional). **Where they're used:** Riftlight loads the four model packs at setup
(`src/riftlight/packs.ts`): Emberfall's outskirts are built from them (docs/game/town.md:
castle walls and towers, river tiles and a bridge, trees, crops, fences, a tent, furniture,
barrels), and the level themes' props wear them as variants (docs/game/mechanics.md *Themes and props*:
barrels, chests, columns, stones, rocks, trees, a pennant). The single-file build
embeds only the models the game's code names (`npm run build:single`).

## Pixel-art sheets

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
