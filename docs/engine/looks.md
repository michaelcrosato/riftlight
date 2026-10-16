# Filters and looks (`src/engine/render/filters.ts`, `look.ts`)

## Filters

Post filters are TSL functions applied in display space after the output color transform,
in any order, in Pixel mode only. Pixel-space effects (dither, palettes, LCD grid, grain)
work per **art pixel**, so they stay authentic at any integer scale.

Every `FilterDef` declares its `space`. `art` filters produce one value per art pixel and run
in the art-resolution stage; `display` filters need sub-art-pixel detail and run per device
pixel after the upscale. A stack runs its leading `art` filters at art resolution and
everything from its first `display` filter on at device resolution, so the order is kept
exactly (`splitFilters`). Put `art` filters first in your own stacks. A filter that needs its
input as a texture calls `fx.texture(node)`, which gives an art-sized target in the art stage.

| Space | Filters |
| --- | --- |
| `art` | `cel`, `8bit`, `16bit`, `ps1`, every palette (`sweetie16` … `onebit`), `dither`, `posterize`, every colour grade, `vignette`, `grain` |
| `display` | `scanlines`, `lcd`, `crt`, `chromatic`, `vhs`, `ntsc`, `bloom`, `halftone`, `sketch` |

Set them with
`EngineOptions.filters`, `engine.setFilters(ids)`, `?filters=a,b` or `?look=<preset>`; the
debug UI has a checkbox for each, and `[` / `]` cycle the looks.

| Group | Filters |
| --- | --- |
| Shading | `cel` (flat light bands, a saturation lift and ink lines where the depth jumps; bands, ink, line width, saturation) |
| Console eras | `8bit` (NES: half resolution, NES palette, light dither), `16bit` (Mega Drive/SNES: 9-bit colour, 512 colours, ordered dither), `ps1` (15-bit colour with the PlayStation's 4×4 dither table **and vertex wobble**: toon materials snap clip-space vertices to the art-pixel grid while it's on) |
| Palette / hardware | `sweetie16`, `pico8`, `nes`, `c64`, `zx`, `ega`, `cga`, `gameboy`, `gbpocket`, `virtualboy`, `onebit`, `dither`, `posterize` |
| Color | `adjust` (brightness, contrast, saturation, warmth), `grayscale`, `sepia`, `invert`, `bleach`, `sunset`, `moonlight`, `thermal`, `nightvision` |
| Display | `scanlines`, `lcd`, `crt` (curved, masked, vignetted), `vignette` |
| Signal | `chromatic`, `grain`, `vhs`, `ntsc` |
| Stylize | `bloom`, `halftone`, `sketch` |

Stacks (`FILTER_PRESETS`): `eight_bit`, `sixteen_bit` (+ scanlines), `playstation`, `arcade`, `handheld`, `famicom`, `home_computer`, `vhs_rental`,
`spectrum`, `mac_classic`, `pico`, `dream`, `spooky`. Add a filter by appending a
`FilterDef` to `FILTERS` in `src/engine/render/filters.ts`; the e2e suite picks it up
automatically.

**Parameters.** A `FilterDef` lists its tunable numbers (`params`: key, label, range, step,
default, unit) and named sets of them (`presets`: `classic`, `heavy`, `pop art`…); every filter
also has `amount` (strength: the result mixed over its input). `apply(c, fx, p)` reads them with
`p('key')`. The renderer hands out one uniform per layer, filter and parameter, so a slider
never rebuilds or recompiles a graph. `filterParams`, `defaultParams`, `filterPresets` and
`clampParam` are the helpers a UI needs.

## Looks: filters per layer (`src/engine/render/look.ts`)

A frame has two layers: **actors** (characters and objects) and the **environment**
(everything else). Tag a root with `setLookLayer(object, 'actors')`; its children follow
(`lookLayerOf` walks up to the nearest tag), and untagged objects are environment. A `Look`
gives each layer its own source and stack, then runs a third stack over the composed frame:

```
actors      → pixel art (art resolution × size, outlines) or clean + actor filters  ─┐
                                                                                      ├─ nearer wins (depth) ─▶ scene filters ─▶ screen
environment → pixel art or clean (full resolution, no outlines) + world filters      ─┘
```

```ts
engine.setLook(engine.lookPresets.pixel_heroes);   // clean world, pixel-art characters
engine.setLook({
  scene: [{ id: 'vignette' }],
  actors: { pixel: { size: 1, outline: 0.45, crease: 0.08 }, filters: [{ id: 'nes', params: { dither: 0.2 } }] },
  environment: { pixel: null, filters: [{ id: 'cel', params: { bands: 4 } }] },
});
engine.setFilters(['crt']);                         // = the whole-scene stack; layers keep theirs
```

- **One pass when the layers look the same** (equal pixel settings, no per-layer filters): the
  default look draws exactly the old graph. A look that differs per layer renders two scene
  passes; each draws only its layer's objects (a render-object filter on the pass, so lights,
  fog and shadow maps, cast by every object, are the same in both), and per pixel the nearer
  of the two depth buffers wins. Transparent materials (glows, telegraphs, loot beams, contact
  shadows) draw in both passes, each blending them over its own layer, so they show in front
  of or behind whichever layer wins a pixel. When both layers are pixel art they compose in
  the art stage; otherwise both are upscaled first.
- **Whole scene only.** Filters that move pixels (`crt`, `chromatic`, `vhs`, `ntsc`:
  `FilterDef.sceneOnly`) would no longer line up with the other layer once composed, so
  `normalizeLook` drops them from layer stacks; they run on the whole scene.
- **Pixel art per layer.** `pixel: { size, outline, crease }` or `null` (clean: the scene at the
  device resolution, like Raw mode but with filters). `size` is art pixels per rendered pixel
  (1 native, 2+ chunkier).
- **What rebuilds.** `planLook(look).key` (pixel on/off per layer and the filter ids in order)
  picks the graph; parameter values and pixel sizes are uniforms. Graphs are cached (8).
- **Presets.** `LOOK_PRESETS` starts with the default (`none`: pixel art, no filters; menus call
  it "default") and `no_filters` (nothing at all: full resolution, no pixel art, no outlines,
  no filters), then every `FILTER_PRESETS` stack as a whole-scene look, then looks that mix
  layers and stacks: `pixel_heroes`, `pixel_world`, `chunky_world`, `cel_cartoon`,
  `cel_heroes`, `retro_heroes`, `spotlight`, `sketchbook`, `dream_world`, `handheld_heroes`,
  `noir`, `sin_city` (a grey posterized world, comic-cel characters), `comic_book`, `pop_art`,
  `storybook`, `neon_nights`, `heat_vision` (thermal characters on a grey world), `night_ops`,
  `ps1_horror`, `found_footage`, `old_photo`, `virtual_boy` and `pico_world`. `[` / `]` and
  `?look=<name>` cycle and pick them; `lookPresetOf(look)` names a look (or null),
  `lookPresetName` resolves old names (`LOOK_ALIASES`: `hd_clean` is `no_filters`).
- **Side effects per layer.** The PS1 vertex wobble is on while a pass whose stack has `ps1`
  draws.
- `normalizeLook(anything)` makes a valid look (unknown filters and duplicates dropped, every
  parameter present and clamped), so stored and URL looks are safe. `?filters=` wins over
  `?look=`. `renderer.split` says
  whether two passes are running; `state().look` names the preset in use (or `custom`).

Riftlight's **Look studio** (pause or settings → Look studio, or **L**; docs/game/ui.md *The look studio*) is a UI
over this: per layer, every filter with its presets and sliders.
