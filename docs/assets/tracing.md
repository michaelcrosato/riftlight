# Tracing (`src/engine/model/trace.ts`, `scripts/trace/`; `npm run model -- trace`)

An import is faithful and frozen; a trace is the same object redrawn in primitives with the
library, so it takes params, seeds and themes like any def. The agent decompiles;
`npm run model -- trace` measures the source for it and judges what it wrote.

**The loop:**

1. **Pick a source** (`--against`): a `.glb`/`.gltf` file, `pack:<pack>/<model>` (an import), or
   our own code-built content: `gate-a:<file>` (Gate A's judged models, docs/ASSETS.md *Gate A*), `town:<building>` (smithy,
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

**What the score says** (the importer's `scoreFidelity`, docs/assets/importing.md *Scores*): the source and the def drawn
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

**Provenance:** a traced def records `source` as an import does (docs/assets/importing.md): for our
own source `LicenseRef-own`, `url` the code or GLB in this repository, `tool` (`'trace'`, plus the
`--front` and `--scale` the source was normalized with, so the score reproduces) and the `fidelity`
scores. A trace of someone else's model keeps their licence, author and pack: tracing doesn't make
it ours, and it waits on #49 as the import does. `trace` prints the line and says when the def's
own is missing or stale.

Worked traces are in `src/engine/model/fixtures/trace/`: the ten above and the two that proved the tool (the
generated tree, parametric in `tiers`, and Gate A's Kit hand cart). A unit test scores every one
again against what it records and checks it clean (src/engine/model/trace.test.ts), so a change to
the library, the scorer or a source that moves one shows.
