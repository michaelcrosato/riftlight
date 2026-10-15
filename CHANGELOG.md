# Changelog

What changed in Pixel Engine for a game built on it, newest first. The version is
`package.json`'s; a game reads it as `ENGINE_VERSION`, `Engine.version` or
`engine.state().version`. The engine kit (`npm run bundle`, docs/GUIDE.md) ships this file.

When a change alters the public API (`src/bundle.ts` exports) or something a game can see,
bump the version (minor while it is 0.x) and add its section here; `npm test` fails when
`package.json`'s version has no section.

## 0.34.0

- **Mouse buttons are keys** (`MOUSE_BUTTONS`): `isDown('MouseLeft')`, `consumePress('MouseRight')`,
  held and pressed like any key and recorded with them, so a click shorter than a frame is not
  lost and a chord (right while left is held) counts both. A finger on the canvas is the key
  `Touch` (`TOUCH_KEY`), not a click; `pointer.touch` says the pointer is one. `mouseButtons` is
  now read-only, the same keys as bits. Tests: `input.setButtons(bits)`, and
  `setPointer(x, y, down)` holds `MouseLeft` too.
- **Commands:** `ctx.input.send(data)` hands the game data from outside the canvas (a save read
  from storage, a text field, a file); it arrives in `ctx.input.commands` at the next frame the
  game runs (for that frame: read it in `update`) and the recording keeps it, so a replay
  delivers it at the same frame. It goes through JSON first, and what the game gets is its own
  copy; what is sent live during a replay is ignored.
- **`Game.fingerprint(ctx)`**: the game's own state, which `engine.fingerprint()` now includes.

## 0.33.0

- **Variants:** `variantName` also finds a variant's letter or number before the rest of its
  name: `tree-pine-tall-a-detailed` … `-d-detailed` share `tree-pine-tall-detailed`, so
  `groupVariants`, `find` and LIBRARY.md give them one entry (apart from the plain
  `tree-pine-tall-a` … `-d`). It drops an id's last such part; a pack's name (`kit-a/`) is never
  one.

## 0.32.0

- **Search** breaks a tie inside a pack for the def whose name (the id after the pack) starts
  with a query word: `search('rock')` gives `kenney-nature/rock-large-a` before
  `kenney-nature/cliff-block-rock`. Scores, the library's order and the packs' places among
  each other are unchanged.
- **Variants:** `variantName(id)` is the name a model's variants share (`rock-large-a` … `-f` →
  `rock-large`: a last part that is one letter or a number), and `groupVariants(defs)` groups a
  list by it, each group where its first (in a ranked list, its best) def was:
  `groupVariants(kit.search('rock'))` gives a rock once, its five variants under it. A sheet's
  lettered tiles (`forest-a` … `-i`) are pieces of a set, not variants: don't group textures.
- **LIBRARY.md** gives a model's variants one row (every id, the range of their sizes) and leaves
  out of a pack's rows the pack's name and tags, which its section header says and
  `library.json` keeps, so a grep reads less.

## 0.31.0

The kit carries its first imported packs (`packs/`, listed in `packs/index.json`, LIBRARY.md and
library.json; credited in CREDITS.md): six CC0 packs by Kenney, approved by the owner, imported
into the engine's format and palette.

- Models: `kenney-castle` (76: walls, towers, gates, bridges, siege engines, flags),
  `kenney-furniture` (140: furniture, kitchen, bathroom, lamps, rugs, walls and doorways),
  `kenney-nature` (329: trees, rocks, cliffs, paths, rivers, crops, flowers, fences, tents) and
  `kenney-mini-dungeon` (30: walls, floors, props, characters), scaled to the engine's metres
  (a doorway 2 m, an oak 3.7 m). Load one with
  `const kit = await loadPack('packs/kenney-nature.json')`, then
  `buildModel('kenney-nature/tree-oak', { catalog: kit })`.
- Textures: `kenney-tiny-dungeon` and `kenney-tiny-town` (132 16 × 16 tiles each, every one
  named: `knight`, `potion-red`, `wall-stone`, `grass`...; the floors, walls, grass and paths that
  tile are marked). `await loadPack('packs/kenney-tiny-town.json', { textures: TEXTURE_LIBRARY })`,
  then `hudSprite('kenney-tiny-town/well')` or `textureMap('kenney-tiny-town/grass')`.

## 0.30.0

What a game gets (exported from the engine and the kit):

- **Search:** `catalog.search(text, { tags, limit })` on `MODEL_LIBRARY`, `TEXTURE_LIBRARY`, a
  loaded pack's catalog or a game's own: every def ranked by how well it matches, best first (a
  word naming part of the id counts most, then a tag, then `about`; plurals and parts of words
  count; when nothing matches every word, the defs matching most of them come back).
  `searchDefs(defs, text, o)` searches any list (several catalogs at once), `searchHits` adds
  each one's score and whether it matched every word, `searchWords` splits names the same way.
  `find` is unchanged.
- **Families:** `MODEL_FAMILIES` and `TEXTURE_FAMILIES`, each library family's ids in order
  (architecture, containers ... weapons; surfaces, sprites).
- **Packs hold textures:** a pack file (`packs/<id>.json`) can carry `textures` beside its models
  (`npm run tex -- import-pack` slices a pack's pixel-art sheets into it) and a `title`.
  `loadPack(url, { into, textures })` adds them to a `TextureCatalog` of yours (`TEXTURE_LIBRARY`,
  so `textureMap(id)`, `spriteSheet(id)` and `hudSprite(id)` find them); `packTextures(pack)`
  makes a catalog of them.
- **The pack index:** `loadPackIndex(url = 'packs/index.json')` lists the packs a site carries
  (id, title, file, how many models and textures, licence, author; types `PackIndex`,
  `PackIndexEntry`).
- An imported model's `about` is now its file name in words with where it came from ("Tree pine
  default a (imported from Kenney Nature Kit 2.1: tree_pineDefault_a.glb)"), and its tags add the
  library's tags its name implies (nature, tree, plant).

The kit:

- `LIBRARY.md` lists the library by family (with each asset's tags), then every pack the kit
  carries, with how to load it.
- `library.json`: every model and texture as data (id, kind, family, pack, about, tags, size,
  params, palette slots, licence, author), and the packs with their files: filter it to find what
  a game needs.
- `packs/`: the imported packs (`packs/index.json` lists them), and CREDITS.md credits each one's
  author and licence with every id it holds.

In the repository: the Asset Gallery room of Engine World (`/?game=world&room=gallery`, and
*Asset Gallery* on Riftlight's title) shows every library model and texture and every pack, one at
a time; `npm run model -- find` and `tex -- find` search the library and the packs, ranked.

## 0.29.0

What a game gets (exported from the engine and the kit):

- `modelSheet(idOrDef, { catalog, textures, params, palette, seed, labels, rig })` and
  `textureSheet(idOrDef, { catalog, palette })`: the sheets `npm run model -- sheet` and
  `npm run tex -- sheet` draw (a model's turntable, front / side / top on a 0.1 m grid,
  game-scale previews, palette and check; a texture's texels, tiling, frames and check) as RGBA
  pixels, with the problems and warnings they show. Software-drawn (no GPU, no DOM), so they run
  in a browser. A model that can't be built gets a sheet of its problems alone. Types
  `ModelSheet`, `ModelSheetOptions`, `TextureSheet`, `TextureSheetOptions`.
- An unknown id in a catalog, or a `use` of one, now also says where the kit lists them
  (LIBRARY.md).

The kit:

- `ASSETS.md` (docs/GUIDE-ASSETS.md): models and textures for agents outside this repo. The loop
  with only the kit (library → write → `check.mjs --sheets` → look → fix), the format, the checks,
  the style rules, placing models in a game, and an example: Market Corner
  (`examples/market.html`, and `examples/market-models.js`, the game's own models): library
  models re-coloured and with params, a model's light, a cobbled floor from `textureMap`, and a
  stall of the game's own that `use`s the library's, in a `ModelCatalog`. GUIDE.md points to it.
- `LIBRARY.md`: every built-in model (id, size, params, palette slots, about) and texture,
  generated from the libraries when the kit is built.
- `CREDITS.md`: where everything the kit carries came from, generated when the kit is built from
  each built-in model's and texture's `source` (all the engine's own work today; the data
  `npm run model -- credits` reads), the palettes made by others (Sweetie 16 by GrafxKid, the
  PICO-8 palette), and three.js's (MIT) and Rapier's (Apache-2.0) licence files, whose texts it
  carries. Ship it with a game.
- `check.mjs --sheets models.js,crate,cobbles`: draws a sheet of every ModelDef and TextureDef a
  module exports (by name, in an array or object, in a catalog, or added to the library) and of
  library ids, in Chromium, with no page played; a PNG each and `report.json` in `check/sheets/`;
  exit 1 on any problem (warnings pass) or a module that doesn't finish loading in 30 s, 2 when it
  can't run. Ids alone work from anywhere: it draws with the kit it lives in.
- API.md groups the model and texture exports under *Models and textures*.

For tools: `npm run model -- sheet` and `npm run tex -- sheet` draw through `modelSheet` and
`textureSheet`.

## 0.28.0

- **80 icons and sprites** in `TEXTURE_LIBRARY` (`npm run tex -- zoo sprite`), 60 more, for
  `spriteSheet`, `hudSprite` and `SpriteBatch`. Items (20): `axe-icon`, `mace-icon`,
  `staff-icon`, `wand-icon`, `dagger-icon`, `spear-icon`, `round-shield-icon`, `gloves-icon`,
  `belt-icon`, `cloak-icon`, `quiver-icon`, `arrows-icon`, `bomb-icon`, `torch-icon`, `map-icon`,
  `book-icon`, `coin-pouch-icon`, `meat-icon`, `herb-icon`, `rune-stone-icon`. Skills (15):
  `fireball-icon`, `frost-nova-icon`, `lightning-bolt-icon`, `poison-cloud-icon`, `heal-icon`,
  `shield-bubble-icon`, `dash-icon`, `whirlwind-icon`, `leap-icon`, `arrow-volley-icon`,
  `summon-icon`, `curse-icon`, `aura-icon`, `trap-icon`, `totem-icon`. UI glyphs (12):
  `arrow-up`, `arrow-down`, `arrow-left`, `arrow-right`, `check`, `cross`, `plus`, `minus`,
  `lock`, `gear`, `magnifier`, `quest-marker`. Critters (6, animated): `bat`, `rat`, `spider`,
  `slime`, `butterfly`, `firefly`. Effects (7, animated): `fire-burst`, `ice-shards`,
  `lightning-spark`, `poison-bubbles`, `heal-sparkles`, `blood-splat`, `dust-puff`. Each was
  looked at at 1× and 2× on night, ink, green and slate panels and redrawn where it didn't read
  (a rat whose frames barely moved, a leap that read as a "2", a quiver that read as a carrot).
  The 20 earlier ones are unchanged.

## 0.27.0

- **63 tiling surfaces** in `TEXTURE_LIBRARY` (docs/ASSETS.md *Textures*; `npm run tex -- zoo
  surface`), 43 more, drawn for 8 texels a metre (Gate B). Wood: `parquet`, `rough-boards`,
  `log-ends`, `wicker`, `deck`. Stone: `marble`, `sandstone`, `basalt`, `slate-tiles`, `ashlar`,
  `dry-stone`, `pebbles`, `gravel`, `geode`. Floors: `ruined-mosaic`, `diagonal-tiles`,
  `checker-marble`, `hex-tiles`, `mosaic`, `terracotta`, `grate`, `rune-floor`. Roofs:
  `slate-roof`, `clay-tiles`, `wood-shakes`. Ground: `mud`, `cracked-earth`, `cinders`,
  `lava-crust`, `swamp`, `shallow-water`, `wet-sand`, `leaf-litter`, `meadow`, `snow-drifts`,
  `frozen-mud`. Materials: `leather`, `burlap`, `chainmail`, `fur`, `scales`. Magic: `starfield`,
  `rift-energy`. Every one is seamless and checks clean; each was looked at tiled 3×3 and on an
  8 m and a 16 m floor at game density, and redrawn where it banded or read as something else
  (shakes that read as brick, a mosaic that printed a chevron) or re-seeded where its repeat showed
  most (the noise grounds still show their 4 m tile on a wide floor, as `dirt` does). The 20 earlier
  surfaces are unchanged.

## 0.26.0

- **The library grows to 151 models** (docs/ASSETS.md; `npm run model -- zoo all`), 90 more in
  its ten families, each written by a subagent from one brief, reviewed in its sheets and zoo and
  fixed. Architecture: `stone-wall`, `wall-corner`, `doorway`, `wide-window`, `ruined-wall`,
  `balcony`, `bridge`, `chimney`, `battlement`, `trapdoor`, `stone-steps`, `timber-wall`.
  Furniture: `wardrobe`, `desk`, `dresser`, `throne`, `armchair`, `rug`, `fireplace`,
  `wall-shelf`, `round-table`, `washstand`, `cradle`, `folding-screen`. Dungeon: `altar`,
  `sarcophagus`, `tombstone`, `skull-pile`, `wall-chains`, `portcullis`, `lever`,
  `pressure-plate`, `obelisk`, `rune-stone`, `pillory`, `pit-grate`. Containers: `clay-pot`,
  `amphora`, `urn`, `basket`, `bucket`, `keg`, `strongbox`, `crate-stack`. Props (tools, loot,
  signs): `shovel`, `hammer`, `wheelbarrow`, `rope-coil`, `ladder`, `waymarker`, `notice-board`,
  `loot-pouch`. Town: `fountain`, `haystack`, `hitching-post`, `produce-crate`, `park-bench`,
  `clothesline`, `planter`, `water-trough`. Lighting: `campfire`, `standing-torch`, `chandelier`,
  `wall-lantern`, `path-lantern`. Nature: `snowy-pine`, `birch`, `dead-tree`, `willow`, `cactus`,
  `reeds`, `ferns`, `tall-grass`, `boulders`, `lily-pads`, `fallen-tree`. Dressing:
  `stalagmites`, `cobweb`, `puddle`, `mine-rail`. Weapons: `spear`, `warhammer`, `greataxe`,
  `halberd`, `flail`, `scythe`, `crossbow` (along +Y with a `grip` anchor, as before),
  `round-shield`, `kite-shield` (a `grip` anchor on the back) and `quiver` (a `mount` anchor).
- Every model checks clean at each param's min and max and 3 seeds. The 61 models already in the
  library build as before.

## 0.25.0

What a game gets (exported from the engine and the kit):

- `importSheet(img, { as, grid, source, ... })` (src/engine/texture/import.ts; docs/ASSETS.md
  *Importing*): a decoded pixel-art sheet (`decodePng`) sliced on a grid into TextureDefs of
  `pixels` layers, one per cell (fully transparent cells skipped), or one of frames for an
  animation strip (`frames`; blank cells at its ends dropped, a blank frame inside kept). Exact:
  every pixel keeps its place, and alpha under `alpha` (default 128) is transparent. Colours map
  to PALETTE through `mapColours` once for the whole sheet (up to 16 slots), so a colour reads the
  same in every cell; each distinct source colour keeps a legend character of its own, and
  `merges` lists every entry two or more of the imported cells' colours bake as. `cells` and
  `names` pick and name cells by reading-order index; `tile` marks surfaces; `palette` re-binds
  slots in every def. `as` takes an import id (`tiles`, `kit/tiles`). Over 90 distinct colours
  is refused. What it refuses throws `ImportError`, now exported too.
- `TextureDef.source`: provenance, as models record it. `validateTexture` reports a `source`
  without a url or licence, or one the models' licence rule refuses (anyone else's work only
  from an approved pack; our own work with a source inside the repository), as a problem.

For tools (scripts/tex.ts, src/engine/texture/sheet.ts; not in the kit):

- `npm run tex -- import <sheet.png> --grid 16x16 --licence <spdx> --source <url>` (`--as`,
  `--pack`, `--tile`, `--frames`, `--cells`, `--names`, `--alpha`, `--palette`): a draft `.ts`
  and an import sheet (`renderImportSheet`: source and mapped side by side, every colour → slot
  → entry, the merges), both in `<out>/import/`. It refuses what the check would, an unapproved
  pack and an id that isn't an import id up front.
- `tex -- sheet <file.ts> <id>` draws one def of a draft; `model -- credits` lists imported
  textures too.
- The photo/PBR and SVG importers (plan §7.5) are not built: no game needs them yet.

## 0.24.0

What a game gets (exported from the engine and the kit):

- `loadPack(url, { into? })`: a pack of imported models, one JSON file
  (`public/packs/<pack>.json`), fetched at runtime the way `loadModel` fetches a GLB and never
  bundled; it resolves to a `ModelCatalog` (`into` also adds the defs to one of yours).
  `parsePack` and the `ModelPack` type check a pack file's shape.
- `LICENCES`: the licences an imported model may carry, as data. Our own work
  (`LicenseRef-own`, its url a path in this repository or its GitHub URL) is allowed anywhere.
  Anyone else's work, CC0 included and a single file too, only from a pack (`source.pack`) whose
  `PACK_SOURCES` entry links the repository owner's approving comment on the licence escalation
  (#49), for that licence (CC0, or CC-BY pack by pack). `validateModel` reports a `source`
  without a url or licence, or one these terms refuse, as a problem.
- `decodePng(bytes, inflate)` and `PngError`: PNGs headless (grey, RGB, palette, grey + alpha,
  RGBA; 1–16 bits; the five filters; tRNS); `inflate` is injected so browser code never pulls in
  Node.
- `buildModel` and the checks: slots named like an object's own keys (`constructor`,
  `toString`) work in `mesh` parts, `use` and palette maps.

For tools (src/engine/model/import/, src/engine/model/fidelity.ts; not in the kit):

- **Mesh import** (`importGltf`, `importPack`; docs/ASSETS.md *Importing*): a glTF or GLB
  file → a ModelDef of `mesh` parts, read headless with three's `GLTFLoader`. One part per
  source node and material, named after the node, welded to the millimetre, normalized (metres,
  +Y up, the front turned to +Z with `front`, `scale`, the base on y = 0, the footprint
  centred). A piece that is exactly a box or an n-gon prism becomes `box` or `cyl` with
  `seg: n` (re-emitted, it must give back the same vertices within 1.5 mm, triangle count, area
  and volume). Faces take their colour from the material, vertex colours and a PNG atlas sampled
  at the UV centroid, embedded or beside the file (never a URL or a path outside its folder). An
  unlit material (KHR_materials_unlit) glows.
- **Palette mapping** (`mapColours`): a model's face colours cluster in OKLab (hue weighted up,
  lightness down) into 2–6 slots, assigned to PALETTE entries biggest first by
  `ΔL² + (0.7·ΔC)² + (2.5·ΔH)²` with penalties for a grey–colour swap and a reused entry,
  improved one move at a time, with lightness order kept within a hue family. A pack shares one
  map of up to 16 slots (the palette's size), not 2–6, so a colour reads the same in every model.
  Slots take meaningful material names (`wood`, `metalDark`), else `c1`, `c2`… (the plan's
  per-pack slot table for atlas packs isn't built yet); `source.colours` keeps each slot's
  source colour.
- **Fidelity** (`scoreFidelity`, `modelTriangles`, `renderFidelity`): any coloured triangles
  against a translation, drawn by the sheets' rasterizer at 4 yaws at game scale and close up:
  silhouette IoU, mean OKLab distance where both cover a pixel, bounds delta. Imports record it in
  `source.fidelity`. `flatTriangles` now winds mirrored parts' faces outward, as `layoutModel`
  does.
- `npm run model -- import <file> --as <id> --licence <spdx> --source <url>` (a draft `.ts` and a
  fidelity sheet), `import-pack <pack>` (approved packs only: sha256-checked, cached in
  `.scratch/import-cache/`, refused unless a licence file in the download names the licence),
  `credits`. `check` also checks every pack file (its licence as a pack, and each model's), and
  `check`, `sheet`, `diff` and `zoo` take a pack file as a target.

## 0.23.0

- **The library grows to 61 models in ten families and 40 textures** (docs/ASSETS.md; `npm run
  model -- zoo all`, `npm run tex -- zoo surface`). Architecture: `door`, `window`, `column`,
  `stairs`, `fence`, `roof`, `gate`. Furniture: `table`, `chair`, `bench`, `stool`, `bed`,
  `bookshelf`, `cabinet`. Dungeon: `chest`, `bones`, `cage`, `coffin`, `banner`, `spikes`. Dressing:
  `crystal`, `rubble`, `glowcaps`, `standard`. Nature adds `pine`, `oak`, `bush`, `stump`, `log`,
  `mushrooms`, `flowers`; props (tools, loot, signs): `signpost`, `sack`, `anvil`, `pickaxe`,
  `gold-pile`, `cart`; lighting adds `wall-torch`, `brazier`, `candles`, `hanging-lantern`. Weapons
  for a fist (one-hand `sword`, `axe`, `mace`, `sceptre`, `dagger`, `wand`; two-hand `staff`, and
  `bow` with `tip.*` anchors for a string a game draws) stand along +Y with a `grip` anchor; `grip`
  is the slot to tint. Textures: 14 more tiling surfaces (20 in all) and 18 more icons and sprites.
- **Redrawn:** `cobbles` (32×32, rounder stones; slots `joint`, `shadow`, `stone`, `light`: a palette
  override on the old `stone2` no longer applies) and `grass` (32×32, so its repeat is less
  visible; slots `dark` (now teal), `mid`, `light`).
- `collider: 'parts'`: a box round each part (glow aside), so a model with an opening keeps it
  walkable; a part with `collide: false` gets no box (an arch's mortar ring). `arch` uses it; `door`
  and `gate` keep one box, since their leaves are closed pivots and static colliders don't follow a
  pivot.
- `flame` reads as fire: lit tongues that turn one face to the game camera and lean back into the
  light, a small glowing heart, `tongues` 1–4 (1 is a candle's); its outer colour is `orange` (was
  `red`), and leaning back puts its bounds a little behind its origin. Never turn it about Y: a model
  a game turns takes a `turn` param and turns its flame back (`wall-torch`).
- `arch` takes `piers` (m), standing on two coursed stone piers, and keeps its opening open (on
  piers a hero walks through; on its feet at the default span the opening is under 1 m tall).

## 0.22.0

- `DEFAULT_TEXEL` is 8 texels per metre (was 16), what Gate B measured as the densest surface
  that doesn't shimmer as the camera zooms; `MOVING_TEXEL` = 20 is the densest a moving model
  passed at. The measurements are in docs/ASSETS.md, *Texel density*.
- Asset Lab: `window.__ASSET_LAB__.gateB` builds the Gate B scene and steps camera sequences
  over it, frame by frame (`npm run gate-b`); clearing it puts the lab's camera back.
- Library `brick-wall`: at 8 texels per metre its bricks are 1 × 0.5 m, so its default height is
  1.5 m (three whole courses; it was 1.2, which cut the top course).

## 0.21.0

- **Textured models:** a part's `tex` names a TextureDef. `buildModel` gives it UVs at the
  model's `texel` density (`DEFAULT_TEXEL` = 16 texels per metre until Gate B; 2–64): flat
  kinds box-projected on the part's own axes from the model's origin, so texels line up across
  parts; round kinds wrapped round their axis in whole repeats, caps from above. The part draws
  with `toonMaterial(0xffffff, { map: textureMap(tex) })`. `ModelOptions.textures` (a
  `TextureCatalog`, default `TEXTURE_LIBRARY`) is where `tex` ids resolve, for builds and
  checks (it replaces `CheckOptions.textures`, a callback).
- Checks: an unknown or broken texture, `glow` with `tex`, and `texel` out of range are problems;
  a texture that doesn't tile warns; a textured part counts as its mean colour (`meanColour`)
  for lightness and never joins a one-colour block.
- `mergeStaticMeshes` keeps `uv` under a textured material and `color` under a vertex-coloured
  one (it kept only position and normal, so merged textured meshes lost their texels).
- `inspect` and the model sheets draw texture maps whose pixels are in memory (baked
  TextureDefs; nearest, per pixel): model sheets show texels in every view and list the
  textures, and `tex -- sheet` adds a cube and a cylinder at game scale.
- Library: `brick-wall` (bricks under a stone coping). The sandbox (`?game=sandbox`) shows it
  built and merged.

## 0.20.0

- **Textures as data** (src/engine/texture/, docs/ASSETS.md *Textures*): a `TextureDef` (written
  with `textureDef`) is a palette of slots and layers drawn in order on a grid of texels: `pixels`
  rows with a legend (the `hud.sprite` format), seeded `pattern`s (`noise`, `bricks`, `tiles`,
  `planks`, `cobbles`, `stripes`, `checker`, `scatter`, `cracks`, `gradient`) on a ramp of slots,
  optionally dithered, periodic when the texture `tile`s, an SVG `path` (fill, stroke) and an
  `outline`.
  - `bakeTexture` → palette indices and RGBA, headless.
  - Tiling patterns wrap without a seam by construction (layouts fit a whole number of cells).
  - `validateTexture`: `bakeTexture`'s problems (a malformed def or layer, unknown slot or colour,
    a pixel its legend doesn't name, ragged rows, bad pattern params, frames that don't divide the
    width), which the converters refuse too, plus `about` and `tags`; warnings (a seam where a
    tiling texture's pixels, path or gradient wrap, salt-and-pepper texels, not a power of two,
    unused slots and legend keys).
  - `textureMap` (a cached, shared, nearest-filtered `DataTexture` for `toonMaterial(0xffffff,
    { map })`, repeat-wrapped when tiling), `spriteSheet` (for `SpriteBatch`, no DOM) and
    `hudSprite` (rows and colours for `hud.sprite`).
  - `TEXTURE_LIBRARY` / `TextureCatalog`: planks, bricks, cobbles, floor-tiles, dirt, grass,
    gem-icon and coin-spin (4 frames).
- `npm run tex` (scripts/tex.ts): `check` (in check.sh), `sheet`, `find`, `zoo`.
- `Catalog` (src/engine/catalog.ts) is the one id catalog; `ModelCatalog` and `TextureCatalog`
  extend it. `isPaletteName` is exported from the palette module.

## 0.19.0

- `validateModel` / `checkModel` count the game's own pixels (Riftlight's camera, from the front
  and the far side) for two more warnings: large parts of one colour that join into one block
  (4 or more parts at least 0.2 m by their own extents, 40% of the model or more), and glow over
  15% of the model once it is 30 art pixels or more (glow draws flat). Gate A's first run lost on
  both (docs/plans/gate-a.md).
- The material warning moves from over 6 to over 8: Gate A's ModelDef campfires had to drop
  colours to stay at 6, while the Kit models the judges preferred used up to 8.
- A def without `about` or `tags` is a problem, not a crash in `npm run model -- sheet`.
- New built-in models: `flame` (fat lit tongues round a small glowing heart, with a flickering
  light; param `h`), `rock` (param `size`), `stone-ring` (stones in two greys; params `r`, `n`,
  `size`) and `arch` (voussoirs in two shades over dark mortar; params `span`, `ring`, `depth`,
  `blocks`). The statue's sleeves take the darker stone.
- `GAME_VIEW`, `gamePxPerMetre` and `rasterParts` (a part-id raster through the game's camera,
  capped at 512 px a side) live in `src/engine/model/view.ts` (the sheet still exports the first
  two); `viewBasis` is exported from `src/engine/inspect/render.ts`.
- The format's header (src/engine/model/types.ts) says what reads at 480×270: colour separates
  touching parts, glow stays small, rods vanish.

## 0.18.0

- `validateModel` / `checkModel` warn about what won't read at 480×270: a part hidden inside
  another (convex) part, coplanar faces of different colours (z-fighting; bottoms on the floor
  excepted), and touching large masses whose colours differ by less than 0.08 in OKLab lightness;
  many alike are one line.
- `Compiled.named`: every named part or group and the parts it covers.
- The built-in models were fixed where their sheets showed it: the barrel's hoops match its ten
  sides, the lamp post's lantern is a glowing box under a hood (the lamp post drops from 248
  triangles to 108), the statue's sword stands clear of the robe, the well's roof rests on its
  posts, the market stall's crates clear its legs, and the greatsword's sub-pixel edge stripe is
  gone.

## 0.17.0

- **Models as data** (src/engine/model/, docs/plans/asset-system.md): a `ModelDef` is keyed
  primitives (`box`, `cyl` with `top`, `cone`, `ball` with `half`, `lump`, `wedge`, `torus`,
  `lathe`, `slab` from points or an SVG path, `tube`, imported `mesh`), each filling its box
  `[w, h, d]` centred on `at` (degrees, +Y up, +Z front); `group` (with `scale`, `pivot` and a
  default `c` for its parts),
  `mirror`, `use` of another model by id (params, seed, slot mapping), `on` to sit on a named
  part; palette slots bound to PALETTE names; params and a seeded `parts` function; anchors, a
  light and a collider kind. `buildModel(idOrDef, { params, seed, palette, light })` merges it
  into one faceted toon mesh per material (pivots stay movable Groups) and returns its bounds,
  anchors, collider data, light request and counts; unseeded builds are cached and share their
  geometry. `expandModel` gives the plain-JSON form; `validateModel` / `checkModel` list problems
  and warnings (floating parts, thin rods, triangle budget, materials) that name the part and the
  fix. Helpers `model`, `around`, `rowOf`, `gridOf`, `scatterOf`, `boxFrame`; `MODEL_LIBRARY`
  (`ModelCatalog`: barrel, crate, lamp-post, statue, well, market-stall, greatsword);
  `addModelColliders(physics, build, at, yaw)`.
- `glowMaterial(color)`: the unlit counterpart of `toonMaterial`, shared and cached per colour,
  snapping with the toon materials under the `ps1` filter.

## 0.16.0

- **Recording and replay** (src/engine/replay.ts): `engine.recording()` is the running level's
  input from its start as JSON (`Recording`: seed, game, start time, one `InputFrame` per frame);
  `engine.replay(rec, start, { frames })` plays one back frame for frame in manual time, with
  promise callbacks between the same frames as when it was recorded, live input ignored
  (`input.playing`) and game errors reported as in live play; `engine.fingerprint()` hashes game
  time, physics and `ctx.random`'s state; `recordingProblem()`, `MAX_FRAMES`;
  `EngineOptions.record` (frames kept per level, 0 for none). `Input.snapshot()`,
  `playBefore()`, `playAfter()` and `release()` (let go of everything held, keep queued presses)
  are what they use.
- Each level gets a fresh physics world, so it plays the same whatever ran before;
  `physics.steps` starts at 0 per level; `physics.fingerprint()` (every body and collider,
  exact); `physics.isAlive(x)` for bodies, colliders and joints (false for one of an unloaded
  level instead of an error).
- `step()` finishes a frame whose game hook threw before throwing it to you.
- A press made before a level's first frame queues at the level's start time.
- `Rng.state` reads and sets a generator's state.
- A gamepad button press is queued at the time of the frame before, as a key press is, so a
  buffered press expires on the same frame either way.

## 0.15.0

- **Seeded randomness**: `Rng` (src/engine/random.ts: `next`, `range`, `int`, `chance`, `pick`,
  `weighted`, `shuffle`, `gaussian`, `fork`) and `hashString`; `ctx.random` / `engine.random`,
  reseeded before each level from `EngineOptions.seed` (`?seed=`, a whole number, default 1)
  and the game's name; `engine.seed`, `state().seed`. Particle bursts draw from a fork of it
  (`particles.reseed(rng)`), so they repeat run to run; a `ParticlePool` spawned without a
  random source draws from its own seeded stream instead of `Math.random`.
- The lint refuses `Math.random`, `crypto.getRandomValues` / `randomUUID`, and `Date.now`,
  `performance.now` and `new Date()` without a `// real time: <why>` comment.

## 0.14.0

- `Timeline.skip()` runs every cue up to the end even when one of them seeks back (a seek is
  ignored while skipping) and ends with the playhead at the end; a cue that pauses stops the
  cues after it in that frame.
- `BehaviorTree` refuses a node that appears twice in it or is already in another tree, and a
  refused tree leaves its nodes free.
- `AudioManager.loop()` no longer warns about a sound whose file is still loading or decoding;
  `Voice.stop()` fades out before it lets go of the chain.

## 0.13.0

- **Behaviour trees**: `BehaviorTree`, `BtNode` and the builders on `bt` (ai/behavior.ts): reactive
  `selector` and `sequence` that halt the branch they leave (an action's `onHalt`), `steps` (a
  sequence with memory), `parallel`, `condition`, `action`, `wait`, `inverter`, `succeeder`,
  `repeat`, `cooldown`; `trace()` and `activePath()` for drawing the tree.
- **Cutscenes**: `Timeline` (cinematic/timeline.ts): camera keys on Catmull-Rom curves with cuts,
  cues fired once (cosmetic ones left out by `skip()`), subtitles, letterbox amount, `seek`,
  `speed`.
- **Sound in space**: `spatialize` and `attenuation` (audio/spatial.ts) give gain and pan for a
  listener; `AudioManager.loop()` returns a `Voice` (volume, pan, muffle through a low-pass,
  pitch, gliding) that waits for audio to unlock; `stopLoops()`, and a level unload stops them.

## 0.12.0

- **GPU compute**: `GpuSwarm` (render/gpuSwarm.ts): particles in storage buffers moved by a TSL
  compute shader (a spring pull, swirl, noise flow, drag, floor), drawn by one instanced sprite reading
  the same buffer; `attractor`, `pull`, `swirl`, `turbulence`, `drag` uniforms, `reset`, `read`;
  re-placed on a new renderer (a recovered GPU device). `dispose()` (or disposing its material)
  frees the compute shaders; `seed` varies the layout and the flow; two swarms never share a
  compiled program.
- **Render to texture**: `RenderView` (render/renderView.ts) and `PixelRenderer.onBeforeRender`
  (listeners cleared when a level unloads, `clearBeforeRender`; one that throws is reported once
  through `onError`, on screen in the engine, and skipped); `SCREEN_LAYER` (the main camera always sees it, views never);
  `PixelRenderer.activeCamera`. Half-float targets.
- **Mirrors**: `Mirror` and `mirrorCamera` (render/mirror.ts): a reflected camera with an oblique
  near plane, for orthographic and perspective cameras on both backends.
- **TSL materials**: `hologramMaterial`, `forceFieldMaterial`, `lavaMaterial`, `marbleMaterial`,
  `woodMaterial`, `crystalMaterial`, `bayer4` (render/shaders.ts).

## 0.11.0

- **Procedural generation** (`src/engine/procgen/`):
  - `createNoise(seed)`: seeded 2D/3D simplex noise, `fbm2` (octaves, lacunarity, gain) and
    `ridged2`.
  - `Terrain`: a heightfield from a height function, drawn flat-shaded and coloured by height
    bands and slope (`TERRAIN_BANDS`), `heightAt` on Rapier's triangulation, `normalAt`,
    `attach(physics)` for a heightfield collider, and `erode` (droplet hydraulic erosion: seeded,
    unit-independent, never digging below where a drop now is, a `margin` of edge points kept).
  - `Wfc` and `patternTiles`: tiled wave function collapse with weights, a border socket,
    fixed cells, restarts on contradiction, `step()` to watch it and `entropy(cell)`.
  - `expand`, `turtle` and `PLANTS`: L-systems with stochastic rules and a 3D turtle (branches
    with radius and depth, leaves, tropism, jitter).

## 0.10.0

- **Picking**: `input.pointer` (where the pointer is over the canvas, in normalised device
  coordinates, and whether it is over it; the screen's centre under pointer lock),
  `input.setPointer` for tests, and `camera.rayAt(x, y, origin, dir)`: the ray through a pixel.
- **Rewind**: `Rewind` (physics/rewind.ts) records tracked bodies (pose, velocities, sleep)
  and `extra` state every physics step in a ring buffer and plays it backwards while
  `rewinding`.
- `physics.onStep` listeners now run before bound meshes read their bodies, so a body a
  listener moves after the step is drawn where it put it; `onStep(f, { first: true })` runs
  ahead of the other listeners.
- `physics.remove`, `Ragdoll`, `Floaters` and joint chains check a body, collider or joint with
  `isValid()`, not by handle: a removed one's slot can hold a newer one, which a handle lookup
  took for the old one. A removed collider is no longer a conveyor belt (a newer collider in its
  slot was).
- `Ragdoll`: a part touching something may sit up to 12° past its cone instead of being turned
  back every step, so a ragdoll whose head is pressed into a stair or the floor comes to rest.

## 0.9.0

- **Vehicles**: `Vehicle` (physics/vehicle.ts) on Rapier's ray-cast vehicle controller:
  suspension, rear-wheel drive with a `topSpeed` (full force against the motion: a brake),
  speed-narrowed steering, mass-scaled brakes and rolling resistance, a handbrake drift (rear
  grip cut, `driftYaw` assist), `speed` along the heading, `slip` / `slipAngle`, `yaw`,
  `wheelPose` (world or chassis space), `reset`, `setSuspension`, `dispose`; the chassis never
  sleeps. `physics.clear()` frees vehicle controllers and `counts()` reports them.
- **Bullets**: `BulletPool` (ai/bullets.ts): thousands of projectiles in typed arrays (`fire`,
  `step` with a wall test, `hits`, `near` by team, `graze` once per bullet, `kill`, `killAll`,
  `clear`) and `emitter` for seeded patterns (`aimed`, `fan`, `ring`, `spiral`, `wave`,
  `burst`), safe against a zero interval and long hitches.

## 0.8.0

- **Navigation**: `NavGrid` (ai/navgrid.ts): walkable cells from an ASCII map (`fromRows`:
  '#' walls and ' ' pits closed by default) or set by hand; `path` (A*, 8 directions, no corner
  cutting, smoothed; a target in a wall goes to the nearest reachable cell), `lineOfSight` (a
  DDA, optional body width), `castWall` (the same cell walk), flow fields (`flowTo`,
  `flowDirection`, `flowDistance`), `setOpen` (doors).
- **Flocking**: `Boids` (ai/boids.ts): separation, alignment and cohesion over a spatial hash,
  `seek`, `flee`, sphere `obstacles`, `bounds` (pushed back in from `margin` inside them), `flat`
  herds and schools, seeded; `order()` and `spacing()` to measure it.

## 0.7.0

- **Ragdolls**: `Ragdoll` (physics/ragdoll.ts) turns a jointed model into capsules on hinge
  joints with limits or ball joints held in cones, parts that hit the world but not each other;
  `enable({ velocity, spin })`, `push(at, velocity)`, `sync()` (interpolated between physics
  steps), `rootPose()` (lying face up or down, the heading to get up with), `release()` (back to
  animation with a blend), `disable()`. `HERO_RAGDOLL`: the hero's eleven parts (also in the
  engine kit).

## 0.6.0

- **Procedural motion** (animation/procedural.ts, exported from the engine): `SpringChain`
  (points hanging off a moving root with momentum, gravity, a pull toward their rest direction
  and fixed lengths: scarves, tails, antennae), `Squash` (a damped spring drawn as a
  volume-preserving `[xz, y]` scale), `LegStepper` (planted feet that step in arcs when they
  fall behind, only while their partners are down; `reset`, `planted()`), `gaitPartners(n)`
  (a tripod for six legs, a trot for four) and `twoBoneIK` (a 3D knee or elbow bent toward a
  pole).
- **Pixel sprites**: `SpriteBatch` (camera-facing quads, one instanced draw per sheet, each
  with its own position, size, frame and mirror; alpha cut-out, nearest sampling) and
  `drawSheet` (paint a sheet in code on a canvas).

## 0.5.0

- **Water**: `WaterSurface` (render/water.ts): up to four travelling waves moved in the vertex
  shader, the same `waterHeight` the CPU sums, plus a `RippleField` (the 2D wave equation on a
  grid, `splash(x, z, radius, strength)`) uploaded as a float texture; toon-lit from the waves'
  slopes, foam on crests, hard sun glints, and see-through by an ordered dither (`opacity`).
  `heightAt`, `covers`, `setWaves`.
- **Buoyancy**: `Floaters` (physics/buoyancy.ts) float Rapier bodies on any height function:
  eight octants each (any way up), the volume of the collider's shape, water density 1 in world
  mass units, drag, `onSplash`.
- **Weather and sky**: `Precipitation` (rain or snow: thousands of drops in one instanced draw,
  placed by the vertex shader, `intensity`, `wind`, `splashes(dt)`); `skyAt(hour)` and
  `applySky(engine, sky)` (a day of sun direction, colours, ambient and background, `night`);
  `groundFog()` (a `scene.fogNode` with live uniforms).
- **Grass and wind**: `GrassField` (instanced blades bent in the vertex shader: lean, flutter,
  rolling gusts, up to four pushers that part them), `WindUniforms` and `swayObject` /
  `swayMaterial` (trees and plants lean with the wind).
- **Trails and decals**: `Trail` (a camera-facing ribbon through recent points) and `Decals`
  (footprint, scorch, splat, crack and ring shapes cut out in the shader, one instanced draw per
  shape, dithered fade-out, a fixed pool).
- Exports: `WaterWave` (the water `Wave` type: `Wave` is the audio one), `MAX_WAVES`,
  `MAX_PUSHERS`, `DECAL_SHAPES`.

## 0.4.0

- **Moving platforms**: `physics.addMover(body, options)` drives a kinematic body along a path
  (eased legs, holds, pingpong or loop), spinning, swinging, or on any `curve(t)` (`orbit`,
  `pendulum`: level seats on a circle or an arc), as a pure function of its own clock
  (`mover.time`, from 0 when added; the body starts there). Removing the body stops it.
  `PlatformerCharacter` rides whatever is under its feet (`groundCollider`): kinematic
  platforms (turns included), dynamic ones (and presses them with its `weight`, 0 by default)
  and conveyors.
- **Conveyors**: `physics.conveyor(collider, velocity)` drags what touches it; `beltMaterial`
  scrolls stripes on game time.
- **Force fields**: `physics.fields.add({ box | sphere, at, force, radial, falloff, drag })`
  push dynamic bodies and the character (momentum in the air, a drift standing; an updraft's
  rise isn't cut short by letting go of jump); `character: false` / `bodies: false` hold for
  their drag too. `physics.explode(at, { radius, impulse })`.
  `character.launch(vy, { hvel })`: a jump no button can cut short.
- **Joints** (`physics/joints.ts`): `chain` (a wrecking ball), `ropeBridge` (walkable, `cut`),
  `hingeDoor`, `springPad`, `seesaw`, each with `remove()`. Spring motors are force-based and
  scaled by mass or inertia (they give under weight).
- **Destruction**: `Breakables` (`add`, `break`, `near`, `byCollider`, `restore`, `crumble`
  tiles that drop and grow back; pieces dissolve after `linger` and leave the world) on
  `fractureBox` (seeded, jittered cuts that tile the box).
- **Soft bodies** (`physics/verlet.ts`): `clothGrid` (any plane: `down`), `ropeLine`,
  `softBlob` with pins, wind, spheres, boxes and a floor; `SoftMesh` and `RopeMesh` draw them.
  Cloth wind is a pressure along each triangle's normal (speed squared) plus skin drag, the
  same however finely the cloth is cut (`drag` per (m/s)² for cloth, per m/s for ropes).
- **Many bodies**: `InstancedBodies` (one draw call per shape, interpolated, `spawn` reuses the
  oldest, `ccd`). `physics.onStep(f)`, `physics.time`, `physics.stepMs`, `physics.castUp`.
- **Character**: `shove` and `weight` (both 0 by default: walking into loose dynamic bodies
  pushes them up to that much mass; standing on one presses it), `crushed` / `stats.crushes`
  (a kinematic body coming down on the head), an updraft stronger than gravity lifts it off
  the ground, and it only grabs ledges of fixed bodies (never a loose body or a moving
  platform: hanging doesn't ride).
- `physics.clear()` (every `loadGame`) also restores gravity and the solver's iterations and
  drops movers, fields, belts and step listeners; `counts()` reports joints, movers, fields
  and belts.

## 0.3.0

- **Game feel**: `engine.timeScale` (slow motion, fast forward, 0 to freeze) scales game time
  for physics, animation, particles, tweens and the camera (at 0, presses are dropped like a
  pause); `engine.hitstop(seconds)` freezes the game for real seconds while rendering, shake and
  transitions go on. Both work with `engine.step()`; `loadGame` resets the speed.
- **Screen shake in the engine**: `engine.shake.add(trauma)` (`CameraShake`, trauma squared,
  deterministic), added to the camera after the rig, by whole art pixels on ortho presets.
- **Screen effects** (`engine.screen`, `render/screenFx.ts`): nine transitions (`TRANSITIONS`:
  fade, iris, diamonds, dissolve, dither, blinds, wipe, curtain, mosaic) with `cover`, `reveal`
  and `transition` (they resolve `true` when they ran to the end), a `flash`, and up to four
  `shockwave` rings. Uniforms at the end of every output graph: no shader compiles, every look,
  Pixel and Raw mode, almost free while nothing runs; real time and across `loadGame`.
  Colours are display colours (palette names or hex). `coversPixel` mirrors the patterns.
- **Tweens**: `ctx.tweens.to / value / call` with 22 eases (`EASES`, including stepped ones),
  yoyo, repeat, delays and takeover; on game time, cleared on unload (`done` resolves `false`).
- `engine.setSunDirection(dir)` and `engine.sunDir`: point the sun and its shadows (reset on
  unload).
- `input.preventKeys`: keys whose browser default is blocked (a game's F1 / Tab panels).
- `loadGame` also clears a TSL `scene.fogNode`, and a light with an unknown flicker preset is a
  steady light instead of a NaN that blacked out every lit pixel.
- The 5×7 font has `{ } ; & | \ ~ ^ $` and the backtick.
- `state()` reports `timeScale`, `hitstop` and `screen`.

## 0.2.0

- **The engine kit**: `npm run bundle` builds `pixel-engine.js`, one self-contained ES module
  (engine, three.js as `THREE` and `TSL`, Rapier with its wasm, the hero kit, the built-in
  models and the CSS), with `GUIDE.md` (how to build a game on it), a generated `API.md`,
  TypeScript declarations, a starter game, the guide's recipes as pages, and `check.mjs` (plays
  a page in a browser and fails on any error). `npm run build` also writes it to `dist/engine/`
  and `dist/engine.zip`.
- **Errors are reported, not just logged**: an exception in a game hook is caught, kept in
  `engine.errors` (and `state().errors`), shown in a box on screen, and the loop keeps running.
  A `setup()` that throws shows "Failed to start: ...".
- `Engine.start` sets `window.__PIXEL_ENGINE__` itself, so every page has the tooling handle
  (only this repo's `main.ts` used to set it); `dispose()` clears it.
- `withUrlOptions(options)`: a game's options with the URL's review flags on top (`?zoom=`
  keeps the game's camera preset, `?filters=` replaces its look).
- `ENGINE_VERSION`, `Engine.version`, `state().version`.
- Looks: filters per layer (characters & objects vs environment) with parameters and presets,
  38 named looks (`LOOK_PRESETS`) including `no_filters`, the `cel` and `adjust` filters.

## 0.1.0

The engine before versions: the WebGPU-first pixel pipeline with the WebGL 2 fallback, camera
presets, Rapier physics and triggers, `PlatformerCharacter` with the hero's moveset and clips,
audio, particles, the pixel HUD, the dynamic light pool, post filters and the agent tooling.
