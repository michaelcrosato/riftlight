# Pixel Engine: models and textures

For an agent building a game on the kit; read `GUIDE.md` first. Objects and pixel-art textures
are **plain data** you write, check and look at, then fix: a `ModelDef` of keyed primitives that
the engine turns into toon meshes, a `TextureDef` of layers it bakes into texels. No modelling
tool and no image files. `LIBRARY.md` lists the built-in models and textures,
`check.mjs --sheets` draws what you write, and `examples/market.html` is a scene built this way
(section 6). Every name here comes from `./pixel-engine.js`; `API.md` has the signatures.

Contents: 1 The loop · 2 Models · 3 Textures · 4 Style rules · 5 In a game · 6 The example ·
7 Credits

## 1. The loop

1. **Start from the library.** Search `LIBRARY.md` (id, size, params, palette slots, one line
   each), or `MODEL_LIBRARY.find({ text: 'crate' })` and `MODEL_LIBRARY.get('fence')` in code.
   Place library models as they are, re-coloured or with other params, and `use` them inside
   your own: a stall with crates is a few lines.
2. **Write** your defs in a module of their own (`models.js`) that exports them; the game
   imports it. Keep the engine start out of that module.
3. **Check and look:** `node check.mjs --sheets models.js` draws a sheet of every def the module
   exports (by name, in an array or object, or in a catalog: `check/sheets/<id>.png`; textures
   `<id>.tex.png`) and prints its problems and warnings; it exits 1 on a problem. **Open the
   PNGs.** `--sheets fence,cobbles` draws library ids: look at one before you place it.
4. **Fix** the numbers the messages and the sheet point at, and run it again until there is no
   problem and the game-scale previews read. Warnings name what won't read at 480×270: fix them
   unless you mean it.
5. **Look in the game:** `node check.mjs index.html --cameras`, then the PNGs: the real
   renderer, with lights and looks.

In code, `checkModel(def, { catalog })` and `validateTexture(def)` return
`{ problems, warnings }`, and `modelSheet(def, { catalog })` and `textureSheet(def)` return the
sheet as RGBA pixels (`image`) with them.

| sheet row | answers |
| --- | --- |
| turntable, 8 angles at one scale | Is the silhouette right from every side? |
| front / side / top on a 0.1 m grid, with the size in metres | Are the parts where the numbers say? Do they touch? Is it the right size? |
| game scale: an iso camera (yaw 45°, pitch 42°) at about 19 and 22 pixels a metre, one art pixel per pixel, ×4 | Does it read in a game? (The engine's iso camera at zoom 1 shows about 20.) |
| palette, check | Which slots, which colours, which are unused; the problems and warnings, each naming the part and the fix |

Sheets are drawn in software (three shading bands, outlines) without point lights or looks: the
game is the truth.

## 2. Models

```js
export const crate = model({
  id: 'crate',
  about: 'Wooden crate with a frame and diagonal braces', // one line: find() searches it
  tags: ['container', 'wood'],
  palette: { wood: 'orange', band: 'red' }, // slots → the 16 palette names (GUIDE.md section 4)
  parts: [
    { box: [0.68, 0.68, 0.68], at: [0, 0.36, 0], c: 'wood' },
    boxFrame({ size: [0.72, 0.72, 0.72], beam: 0.09, at: [0, 0.36, 0], c: 'band' }),
    { mirror: [{ box: [0.8, 0.08, 0.04], at: [0, 0.36, 0.35], rot: [0, 0, 45], c: 'band' }], axis: 'z' },
  ],
});
```

Metres and degrees; +Y is up, +Z is the front, the floor is y = 0. Parts are keyed, never
positional. **Every primitive fills its box `[w, h, d]`, centred on `at`**, turned by `rot` (XYZ,
about `at`), and round kinds stretch to it:

- `box`; `cyl` (an n-sided prism, `seg` sides, default 6 to 10 by size; `top`: the top width ÷
  the bottom width); `cone` (point up); `ball` (`half`: the upper dome); `lump` (a rock, `seed`);
  `wedge` (a ramp, full height at the back, −Z); `torus` (a ring in XZ as thick as the box is tall).
- Profile kinds use their own coordinates, placed at `at`: `lathe` ((radius, height) points
  turned about Y), `slab` (an XY outline or SVG path, extruded `depth` along Z), `tube` (points
  and a radius `r`, or a pair that tapers).
- Every part takes `c` (its slot; default the first), `name`, `glow: true` (unlit: a flame's
  heart, eyes), `tex` (a texture id, section 3), `seg` and `collide: false` (no box of its own
  under `collider: 'parts'`: a doorway's mortar ring).

**Composition:**

- `{ group: [...], at, rot, scale, c }`: a frame whose `c` is its parts' default. `pivot: true`
  with a `name` keeps it a movable Group (a door, a lid: `build.object.getObjectByName('lid')`).
- `{ mirror: [...], axis: 'x' }`: the parts and their mirror image (`axis: 'z'` mirrors front to back).
- `{ use: 'barrel', at, rot, scale, params, seed, palette: { theirs: 'ours' } }`: another model
  by id. Its slots map onto yours through `palette`, else onto yours of the same name, else keep
  their own colours.
- `on: 'name'`: sit on the named part's top; `at` becomes an offset from there.
- `params: { h: [default, min, max] }` with `parts: (p, rng) => [...]`: parametric (`p.h`) and
  seeded (`rng.range(a, b)`). Helpers return parts: `around`, `rowOf`, `gridOf`, `scatterOf`,
  `boxFrame`.
- Model keys: `size` (declared bounds, checked), `anchors` (`{ grip: [x, y, z] }`), `light: { at,
  c, intensity, radius, flicker }`, `collider` (`'box'`, `'cyl'`, `'hull'`, `'parts'` (a box per
  part: doorways stay open) or `'none'`), `floats: true` (it hangs), `texel` (texels a metre for
  `tex` parts, default 8).

**Problems** (`check.mjs --sheets` exits 1; `buildModel` throws a `ModelError` on those it can't
build): no `about` or `tags`; an undeclared slot or a colour that isn't a palette name; an unknown
`use`, `on` or texture; a size that isn't positive; `seg` outside 3–64; NaN; an empty model; below
the floor (unless `floats`); over the declared `size`; params out of range; a part that both
glows and takes a `tex`; a `texel` outside 2–64. **Warnings:** a part floating more than 1 cm from the
rest; rods under 0.06 m; over the triangle budget (300 under 0.5 m across, 1,000 under 2 m, else
3,000); over 8 materials; a part hidden inside another; coplanar faces of two colours; touching big
masses too close in lightness; one colour over 40% of the model in four or more parts; glow over
15% of it. `checkModel` builds the defaults, every param at its min and at its max, and three
seeds when the parts read `rng`.

## 3. Textures

```js
export const bricks = textureDef({
  id: 'bricks',
  about: 'Stone bricks in courses over dark mortar',
  tags: ['stone', 'wall', 'surface'],
  size: [16, 16], // texels; powers of two when it tiles
  tile: true, // seamless: patterns wrap
  palette: { mortar: 'night', stone: 'slate', stone2: 'mist' },
  layers: [{ pattern: 'bricks', colors: ['mortar', 'stone', 'stone2'], w: 8, h: 4, seed: 2 }],
});
```

**Layers** draw in order: `{ pixels: [...rows], legend: { k: 'slot' } }` (`.` or a space is clear;
`at`, `mirror: 'x'` or `'y'`), `{ pattern, colors, seed, dither, ...params }` (over a ramp of
slots, dark to light), `{ path: 'M … Z', fill, stroke }` (SVG in texel units) and `{ outline:
slot }`. `frames: n` makes a strip of n frames, left to right.

**Patterns:** `noise bricks tiles planks cobbles stripes checker scatter cracks gradient`.
Parameters: noise `scale`, `octaves`; bricks and tiles `w`, `h`, `mortar`, `offset`, `bevel`;
planks `w`, `gap`, `length`, `grain`; cobbles `cells`, `gap`; stripes `width`, `dir`; checker
`cell`; scatter `count`, `size`, `shape`; cracks `count`, `length`; gradient `dir`. A problem
names the range of a bad one.

**Density:** surfaces at 8 texels a metre (`DEFAULT_TEXEL`); denser ones shimmer as the camera
zooms. A 16-texel tile covers 2 m, so draw a brick of 8 × 4 texels for 1 × 0.5 m. **Warnings:** a
seam across the wrap, salt and pepper (over 15% single texels), a tiling size that isn't a power
of two, unused slots.

## 4. Style rules

- **Scale:** the hero is 1.6 m (1.75 m with the cap); a door 2.2 m, a table 0.75 m, a chair seat 0.45 m.
- **Silhouette first.** The iso camera sees the top and two sides: big masses must read; put
  detail on the top and the front.
- **Thickness:** 0.06 m at least; 0.12 m or more for parts that carry the silhouette.
- **Colour separates parts:** touching parts take different colours or shades (planks and their
  frame, stones and mortar), up to 8, one an accent; touching big masses differ in lightness.
- **Glow is flat:** keep it for small hot spots. For fire `use: 'flame'`, and never turn it about
  Y: its tongues face the camera. Below `h` 0.5 its 2–4 tongues read as a dark smudge: use
  `tongues: 1` for small fires.
- **Low poly:** 6 to 10 sides on round kinds, no bevels under 2 cm.
- **Grounded:** the base on y = 0, nothing floating unless `floats`.
- **Compose before you create:** `use` a library model before you write a new crate.

## 5. In a game

- `buildModel(idOrDef, { params, seed, palette, light, catalog, textures })` returns `object`
  (one merged mesh per material; pivots are named Groups), `bounds`, `anchors`, `colliders`
  (data: `addModelColliders(physics, build, at, yaw)`), `light` (in model space: place it with
  the model, as the example does) and `report`. Builds whose parts don't read `rng` are cached and
  share geometry: place as many as you like.
- **Your own models:** a `ModelCatalog` of the library and yours, passed as `catalog` (or
  `MODEL_LIBRARY.add(def)`); your own textures likewise in a `TextureCatalog`, passed as `textures`.
- **Textures:** `toonMaterial(PALETTE.white, { map: textureMap('bricks') })` on any mesh (the
  map is cached and shared: scale UVs, never the map); `new SpriteBatch(spriteSheet('coin-spin'),
  { capacity: 64 })`; `hudSprite('gem-icon')` gives rows and colours for `ctx.hud.sprite`.

## 6. The example

Market Corner, the kit's `examples/market.html`: library models (one re-coloured, three with
params, the lamp post's light made brighter), a cobbled floor from `textureMap`, and a stall of
the game's own in a module of its own. `node check.mjs examples/market.html` plays it;
`node check.mjs --sheets examples/market-models.js` draws its stall.

```js market-models
// Market Corner's own models: plain data in a module of their own, so `node check.mjs --sheets
// examples/market-models.js` can draw them.
import { model, MODEL_LIBRARY, ModelCatalog } from './pixel-engine.js';

export const fruitStall = model({
  id: 'fruit-stall',
  about: 'The market stall under a green awning, two baskets of fruit on its counter',
  tags: ['town', 'market'],
  palette: { wood: 'orange', cloth: 'green', cloth2: 'white', top: 'sand', basket: 'red', fruit: 'orange', fruit2: 'lime' },
  parts: [
    { use: 'market-stall' }, // its slots take ours of the same name: the awning turns green
    ...[-0.45, 0.4].flatMap((x, i) => [
      { name: `basket${i}`, cyl: [0.56, 0.14, 0.4], at: [x, 1.01, 0.05], top: 1.25, c: 'basket' },
      ...[-0.17, 0, 0.17].map((dx, k) => ({ ball: [0.18, 0.18, 0.18], on: `basket${i}`, at: [dx, 0, 0], c: (i + k) % 2 ? 'fruit2' : 'fruit' })),
    ]),
  ],
});

// Where the game's ids resolve: the library and ours (buildModel's `catalog`).
export const MODELS = new ModelCatalog([...MODEL_LIBRARY.all(), fruitStall]);
```

```js market
// Market Corner: library models and the game's own fruit stall on a cobbled square at dusk.
// Nothing to play: a scene to look at, and to build yours from (ASSETS.md).
import { addModelColliders, buildModel, DEFAULT_TEXEL, Engine, hudSprite, PALETTE, TEXTURE_LIBRARY, textureMap, THREE, toonMaterial, withUrlOptions } from './pixel-engine.js';
import { MODELS } from './market-models.js';

const { Color, Mesh, PlaneGeometry, Vector3 } = THREE;

// [id, position, options]: buildModel's options (params, palette, seed, light) and a turn in degrees
const SCENE = [
  ['fruit-stall', [0, 0, -1.4]], // ours (market-models.js)
  ['market-stall', [-4, 0, 0.6], { turn: 90, palette: { cloth: 'blue' } }], // re-coloured
  ['lamp-post', [1, 0, 1.6], { light: { intensity: 10 } }], // it carries a light: brighter
  ['well', [3.8, 0, -2.2]],
  ['fence', [-0.5, 0, -3.4], { params: { length: 7 } }],
  ['barrel', [-1.8, 0, 1.2]],
  ['crate', [-1.1, 0, 1.7], { turn: 20 }],
  ['sack', [2.4, 0, 1], { params: { h: 0.6 } }],
  ['oak', [-3.2, 0, -3.4], { params: { h: 3 }, seed: 2 }],
];

class MarketCorner {
  name = 'Market Corner';
  placed = [];
  lights = [];
  target = new Vector3(-0.3, 1, -0.9);

  setup(ctx) {
    const { scene, physics, engine } = ctx;
    engine.sun.intensity = 1.4; // dusk, so the lamp shows (the engine resets it for the next game)
    engine.ambient.color.setHex(PALETTE.navy);
    scene.background = new Color(PALETTE.night);

    // The floor: a library surface on a plain mesh. A 32-texel tile at 8 texels a metre covers
    // 4 m, so the UVs count tiles (the map is cached and shared: never scale it).
    const tile = TEXTURE_LIBRARY.get('cobbles').size[0] / DEFAULT_TEXEL;
    const ground = new PlaneGeometry(16, 16).rotateX(-Math.PI / 2);
    ground.attributes.uv.array.forEach((v, i, uv) => (uv[i] = (v * 16) / tile));
    const floor = new Mesh(ground, toonMaterial(PALETTE.white, { map: textureMap('cobbles') }));
    floor.receiveShadow = true;
    scene.add(floor);
    physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [8, 0.5, 8] });

    for (const [id, at, { turn = 0, ...options } = {}] of SCENE) {
      const m = buildModel(id, { ...options, catalog: MODELS });
      m.object.position.set(...at);
      m.object.rotation.y = (turn * Math.PI) / 180;
      m.object.updateMatrixWorld();
      scene.add(m.object);
      addModelColliders(physics, m, at, m.object.rotation.y);
      // a model's light is in its own space: place it with the model
      if (m.light) this.lights.push(ctx.lights.request({ ...m.light, position: m.object.localToWorld(new Vector3(...m.light.at)) }));
      this.placed.push(m);
    }
    this.icon = hudSprite('gold-icon');
  }

  update(ctx) {
    ctx.hud.clear();
    ctx.hud.sprite(6, 6, this.icon.rows, this.icon.colors);
    ctx.hud.text(26, 10, 'MARKET CORNER', { color: 'sand' });
  }

  cameraTarget() {
    return this.target;
  }

  status() {
    return `market: ${this.placed.length} models, ${this.lights.length} light`;
  }
}

await Engine.start(new MarketCorner(), withUrlOptions({ container: document.getElementById('app'), camera: { preset: 'iso', zoom: 1.6 } }));
```

## 7. Credits

`CREDITS.md` says where everything the kit carries came from: the library and the built-in
models are the engine's own work, three.js and Rapier ship under their licences (their texts are
in it). Ship it with your game. A def you import or copy from someone else records it in `source:
{ url, licence, author }`; credit it as its licence asks.
