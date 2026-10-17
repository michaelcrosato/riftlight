/**
 * Asset Workshop: every model and texture the engine carries, in a picker on the HUD, and a floor
 * to put them on. Scroll a shelf (the wheel over the list, Q and E, a finger dragged along it),
 * change shelf (comma and period, the panel's < and > buttons), click a row. Enter places the
 * pick where its preview hovers (in front of the hero, or where the mouse last was over the
 * floor), a click on the floor places it there, a right click takes away what it hits and
 * Backspace the last. Tab shows what the pick is made of. The pads at the back explain the
 * system; agents drive it through `__WORLD__.room`.
 */
import { Box3, Mesh, type Object3D, OrthographicCamera, Raycaster, RingGeometry, Vector3 } from 'three/webgpu';
import { hudSprite, type LightHandle, type ModelBuild, type ModelDef, type ModelPart, MODEL_FAMILIES, type PaletteColor, Rng, searchDefs, SpriteBatch, spriteSheet, TEXTURE_FAMILIES, type TextureDef, type TextureLayer } from '../../engine';
import { GAME_VIEW } from '../../engine/model/view';
import { inside, type Rect, UiCanvas } from '../../riftlight/ui/kit';
import { pageParam } from '../page';
import type { Knob, RoomDef, Vec3 } from '../types';
import { type Asset, assetsOf, clean, count, LIBRARY_SOURCE, libraryShelves, modelLine, packShelves, requestLight, type Shelf, sourceOf, spriteHeight, standModel, type StoodModel, textureLine, tilePatch, wrap } from './shelves';

type Kind = 'model' | 'surface' | 'sprite';

/** Something built from a def: a thing on the floor, or the preview of the pick. */
interface Thing {
  readonly id: string;
  readonly kind: Kind;
  readonly root: Object3D;
  /** Its extent in metres (x, y, z). */
  readonly size: Vec3;
  readonly model?: StoodModel;
  readonly batch?: SpriteBatch;
  readonly frames: number;
  dispose(): void;
}

/** A thing placed on the floor (where it stands and how it is turned: its root's position and rotation). */
interface Placed {
  readonly thing: Thing;
  readonly shelf: string;
  readonly light: LightHandle | null;
}

/** Half the room, x and z (a 26 × 22 m room); things go down inside the walls. */
const HALF = [13, 11] as const;
/** The most things the floor holds at once. */
const MAX_PLACED = 80;
/** A surface goes down as a square this many metres a side: 2 × 2 tiles of 16 texels at the game's density. */
const PATCH = 4;
/**
 * Floor patches lie 2 mm up, a millimetre higher for each patch they cover, so the newest lies on
 * top; models stand 1 cm above the highest patch under them, so a flat one (a ground tile) never
 * fights the floor or a patch for depth.
 */
const PATCH_LIFT = 0.002;
const LIFT = 0.01;
const TURN = Math.PI / 4;
const FULL_TURN = Math.PI * 2;
/** A turn in radians as 0 to 2π (a negative one counts back from a full turn). */
const turned = (a: number) => ((a % FULL_TURN) + FULL_TURN) % FULL_TURN;
const ROW = 9;
/** What FIND IT searches for, one after another. */
const EXAMPLES = ['chair', 'torch', 'oak tree', 'potion', 'stone floor', 'knight', 'barrel'];

/** Where the picker's parts go on the HUD, in art pixels (`pickerLayout`). */
export interface PickerLayout {
  readonly wide: boolean;
  readonly panel: Rect;
  readonly prev: Rect;
  readonly next: Rect;
  /** The DEF switch. */
  readonly def: Rect;
  readonly list: Rect;
  readonly rows: number;
  /** The pick's lines. */
  readonly info: Rect;
  /** Characters a line holds in the 5×7 font, and in the 3×5 one. */
  readonly chars: number;
  readonly minis: number;
  readonly hints: readonly string[];
}

/**
 * The picker on a HUD of `w` × `h` art pixels: down the right side under the room's title, or
 * along the bottom of a narrow (portrait) screen. `top` and `bottom`: where a phone's touch bar ends and
 * its controls start (the panel stays between them, with fewer rows and lines); `touch`: the hints say tap.
 */
export function pickerLayout(w: number, h: number, o: { readonly top?: number; readonly bottom?: number; readonly touch?: boolean } = {}): PickerLayout {
  const wide = w >= 300;
  const pw = wide ? Math.min(180, Math.floor(w * 0.37)) : w - 4;
  const top = Math.max(24, o.top ?? 0);
  const bottom = Math.min(h, o.bottom ?? h) - 2;
  // the keys, as many as the panel's width has room for (3×5 font: 4 px a character)
  const hints = o.touch || !wide ? [`${o.touch ? 'TAP' : 'CLICK'} A ROW, THEN THE FLOOR`] : pw >= 162 ? ['WHEEL Q/E PICK · ,/. SHELF · TAB DEF', 'ENTER/CLICK PLACE · Y TURN · BKSP UNDO'] : ['WHEEL PICK · ,/. SHELF', 'CLICK THE FLOOR: PLACE'];
  const height = (lines: number, hinted: number, rows: number) => 28 + rows * ROW + 5 + lines * ROW + 3 + hinted * 7 + 3;
  // as many rows (up to 12; 4 on a narrow screen) and lines of the pick (7; 3) as fit: fewer lines, then no hints, before fewer than 3 rows
  let lines = wide ? 7 : 3;
  let hinted = hints.length;
  const fit = () => Math.floor((bottom - top - height(lines, hinted, 0)) / ROW);
  while (fit() < 3 && lines > 2) lines--;
  if (fit() < 3) hinted = 0;
  const rows = Math.max(3, Math.min(wide ? 12 : 4, fit()));
  const ph = height(lines, hinted, rows);
  const x = wide ? w - pw - 2 : 2;
  const y = wide ? top : bottom - ph;
  const list = { x: x + 4, y: y + 28, w: pw - 8, h: rows * ROW };
  return {
    wide,
    panel: { x, y, w: pw, h: ph },
    prev: { x: x + 4, y: y + 4, w: 11, h: 11 },
    next: { x: x + pw - 15, y: y + 4, w: 11, h: 11 },
    def: { x: x + pw - 27, y: y + 17, w: 23, h: 9 },
    list,
    rows,
    info: { x: x + 5, y: list.y + list.h + 5, w: pw - 10, h: lines * ROW },
    chars: Math.floor((pw - 9) / 6),
    minis: Math.floor((pw - 9) / 4),
    hints: hints.slice(0, hinted),
  };
}

/** The models a def places by id (`use`), at its default params. */
export function usesOf(def: ModelDef): string[] {
  const out = new Set<string>();
  const walk = (parts: readonly ModelPart[]) => {
    for (const p of parts) {
      if ('use' in p) out.add(p.use);
      else if ('group' in p) walk(p.group);
      else if ('mirror' in p) walk(p.mirror);
    }
  };
  const defaults = Object.fromEntries(Object.entries(def.params ?? {}).map(([k, [d]]) => [k, d]));
  walk(typeof def.parts === 'function' ? def.parts(defaults, new Rng(`uses:${def.id}`)) : def.parts);
  return [...out];
}

const layerName = (l: TextureLayer) => ('pattern' in l ? `PATTERN ${l.pattern}` : 'pixels' in l ? 'PIXELS' : 'path' in l ? 'PATH' : 'OUTLINE');
const slotsOf = (palette: Readonly<Record<string, string>>) => Object.entries(palette).map(([k, v]) => `${k}=${v}`).join(' ');

/** What a def is made of, line by line (the DEF view; `__WORLD__.room.def()`). A model's `build` counts its primitives. */
export function defLines(def: Asset, build?: ModelBuild): string[] {
  if ('layers' in def) {
    const frames = def.frames ?? 1;
    return [
      `TEXTUREDEF: ${def.size[0]} X ${def.size[1]} TEXELS${def.tile ? ' · TILES' : ''}${frames > 1 ? ` · ${frames} FRAMES` : ''}`,
      `LAYERS ${def.layers.map(layerName).join(', ')}`,
      `SLOTS ${slotsOf(def.palette)}`,
    ];
  }
  const parts = typeof def.parts === 'function' ? 'PARTS FROM ITS PARAMS' : `${def.parts.length} PARTS`;
  const params = Object.entries(def.params ?? {}).map(([k, [d, lo, hi]]) => `${k} ${d} (${lo}-${hi})`);
  const uses = usesOf(def);
  return [
    `MODELDEF: ${parts}${build ? `, ${build.report.parts} PRIMITIVES` : ''}`,
    `SLOTS ${slotsOf(def.palette)}`,
    `PARAMS ${params.join(', ') || 'NONE'}`,
    `USES ${uses.join(', ') || 'NONE'}`,
    ...(def.light ? [`LIGHT ${def.light.c} · ${def.light.radius} M${def.light.flicker ? ` · ${def.light.flicker}` : ''}`] : []),
  ];
}

/** A line of parts joined by " · " to lines of at most `width` characters, broken between parts where it can. */
export function wrapParts(text: string, width: number, max: number): string[] {
  const out: string[] = [];
  for (const part of text.split(' · ')) {
    const last = out.at(-1);
    if (last !== undefined && last.length + 3 + part.length <= width) out[out.length - 1] = `${last} · ${part}`;
    else out.push(...wrap(part, width, max));
  }
  return out.length > max ? wrap(out.join(' · '), width, max) : out;
}

/**
 * A shelf's title in at most `chars` characters: whole, then without "PACK · " or "LIBRARY · ",
 * without version numbers, without a pack's maker (its first word), then cut.
 */
export function shortTitle(title: string, chars: number): string {
  const tries = [title, title.replace(/^(PACK|LIBRARY) · /, '')];
  tries.push(tries[1]!.replace(/ \d+(\.\d+)+/g, ''));
  if (title.startsWith('PACK · ')) tries.push(tries[2]!.replace(/^\S+ /, ''));
  return clean(tries.find((t) => t.length <= chars) ?? tries.at(-1)!).slice(0, chars);
}

/** One line of the panel: the 5×7 font, or the 3×5 one (`mini`). */
interface Line {
  readonly text: string;
  readonly color: PaletteColor;
  readonly mini?: boolean;
}

export const WORKSHOP: RoomDef = {
  id: 'workshop',
  title: 'Asset Workshop',
  wing: 'workshop',
  about:
    'Every model and texture the engine carries, in a picker: the library family by family, then every imported pack. Scroll a shelf, pick an asset and put as many as you like on the floor, by key, by pad or by clicking where it goes. The pads at the back explain how assets work.',
  try: [
    'Scroll the list with the mouse wheel (or Q and E); comma and period change shelf',
    'Click the floor to place the pick there; right click takes one away, Backspace the last',
    'Press Tab: what the pick is made of (parts, palette slots, params)',
    'Step on FIND IT: one search across the library and every pack, models and textures together',
  ],
  camera: { preset: 'iso', yaw: GAME_VIEW.yaw, pitch: GAME_VIEW.pitch, viewHeight: GAME_VIEW.viewHeight, zoom: GAME_VIEW.zooms.level, stiffness: 7, minZoom: 0.4, maxZoom: 3 }, // the game's own scale
  spawn: [0, 0, 4.5],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'A floor to build on and a picker holding every model and texture the engine carries, shelf by shelf: the library’s families, its surfaces, icons and sprites, then every imported pack. The panel names the pick, measures it and says where it came from; Tab shows what it is made of. A hovering preview shows where Enter puts it.',
    how: [
      'A model is data, a ModelDef: parts (boxes, cylinders, lathes, extruded paths, imported meshes) in palette slots bound to the engine’s 16 colours, params with ranges, and use to place another model by its id. buildModel turns it into a few merged toon meshes, with its bounds, colliders and light.',
      'A texture is data too, a TextureDef: layers of pixel rows, seeded patterns, paths and an outline, in palette slots. A tiling one becomes a floor or a wall (textureMap: nearest texels, repeated); a sprite stands up facing the camera (spriteSheet in a SpriteBatch); hudSprite draws it on the HUD, as the panel does.',
      'Imported packs are other people’s kits converted once (npm run model -- import-pack, tex -- import-pack) into the same format and palette: one JSON file per pack in public/packs, listed in packs/index.json. loadPack loads one when a game needs it; every asset keeps its source and licence (npm run model -- credits lists them).',
      'Finding is one search everywhere: searchDefs, a catalog’s search, npm run model -- find (models) and npm run tex -- find (textures) score a word in the id over a tag over the about line; model -- find shows a model’s variants (rock-large-a to -f) as one entry. FIND IT runs searchDefs over both kinds at once.',
      'Placing: the pick is built (buildModel(def, { catalog })), stood with the bottom of its bounds on the floor and its footprint centred, and given its light from the light pool, on a point inside it. A click is a ray from the camera through the pointer, met with the floor; a right click takes away the first placed thing the ray hits. A game adds addModelColliders(physics, build, at, yaw) too; here you walk through what you place.',
      'To vary an asset, write a few lines, not a copy: a def that uses it with a scale or a palette (docs/ASSETS.md, Variants).',
    ],
    uses: [
      'Editors’ asset browsers: Unity’s Project window, Godot’s FileSystem dock, Unreal’s Content Browser: find a thing, drag it into the level.',
      'Build modes inside games: The Sims’ Buy and Build catalogues, Minecraft’s creative inventory, Fortnite Creative.',
    ],
    ask: ['find a wooden chair and put three round the table', 'import a CC0 pack and line the path with its trees', 'a red barrel at half size, as a variant of barrel', 'what is the campfire made of', 'a floor of the grass tiles from the Tiny Town pack'],
    cost: 'A placement is one build (most models reuse cached geometry: a few draw calls each), a light-pool request if it has a light, and its draws. The packs load once, about 3 MB of JSON, when the room opens.',
    code: [
      {
        title: 'A def becomes meshes',
        file: 'src/engine/model/build.ts',
        src: `export function buildModel(idOrDef: string | ModelDef, opts: ModelOptions = {}): ModelBuild {`,
      },
      {
        title: 'Stood on the floor, its light on a point inside it',
        file: 'src/world/rooms/shelves.ts',
        src: `const b = buildModel(def, { catalog });
const root = new Group();
b.object.position.set(-(b.bounds.min[0] + b.bounds.max[0]) / 2, -b.bounds.min[1], -(b.bounds.min[2] + b.bounds.max[2]) / 2);
root.add(b.object);
...
return l && m.lamp ? ctx.lights.request({ follow: m.lamp, color: l.color, intensity: l.intensity, radius: l.radius, flicker: l.flicker ?? 'none' }) : null;`,
      },
      {
        title: 'Textures for floors, sprites and the HUD',
        file: 'src/engine/texture/convert.ts',
        src: `export function textureMap(idOrDef: string | TextureDef, opts: TextureOptions = {}): DataTexture {
...
export function spriteSheet(idOrDef: string | TextureDef, opts: TextureOptions = {}): SpriteSheet {`,
      },
      {
        title: 'Packs load once, from their index',
        file: 'src/engine/assets.ts',
        src: `export function loadPack(url: string, opts: { readonly into?: ModelCatalog; readonly textures?: TextureCatalog } = {}): Promise<ModelCatalog> {`,
      },
      {
        title: 'One search for everything',
        file: 'src/engine/catalog.ts',
        src: `const s = has(id) ? 4 : has(tags) ? 3 : has(about) ? 2 : w.length >= 3 && all.some((x) => x.startsWith(w)) ? 1 : w.length >= 3 && all.some((x) => x.includes(w)) ? 0.5 : 0;`,
      },
      {
        title: 'A click on the floor',
        file: 'src/world/rooms/workshop.ts',
        src: `ctx.camera.rayAt(x, y, origin, dir);
if (dir.y > -1e-4) return null;
const t = -origin.y / dir.y;`,
      },
    ],
    words: ['ModelDef', 'TextureDef', 'catalog', 'asset pack', 'variant', 'palette', 'sprite', 'raycast', 'light pool', 'agent API'],
  },
  async build(room) {
    const { kit, ctx } = room;
    const input = ctx.input;
    kit.room(HALF[0] * 2, HALF[1] * 2, { floor: ['slate', 'night'], wall: { color: 'plum', side: 'ink' } });
    kit.light({ position: [0, 6, 2], color: 0xf4f4f4, intensity: 5, radius: 22 });

    const shelves = [...libraryShelves(), ...(await packShelves())];
    const everything = () => shelves.flatMap(assetsOf);
    const ui = new UiCanvas(ctx.hud);
    /** The picker on this screen, kept between a phone's touch bar and its controls where they share its columns. */
    const layout = (): PickerLayout => {
      const { width: w, height: h } = ctx.hud;
      const touch = ctx.engine.touch?.visible ? ctx.engine.touch : null;
      const canvas = ctx.hud.canvas;
      if (!touch || !canvas) return pickerLayout(w, h);
      const span = pickerLayout(w, h, { touch: true }).panel;
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return pickerLayout(w, h, { touch: true });
      const c = touch.rects();
      const across = (b: DOMRect) => ((b.right - r.left) / r.width) * w > span.x && ((b.left - r.left) / r.width) * w < span.x + span.w;
      const artY = (y: number) => ((y - r.top) / r.height) * h;
      let bottom = h;
      for (const b of [c.stick, ...c.buttons.map((x) => x.rect)]) if (b && across(b)) bottom = Math.min(bottom, Math.floor(artY(b.top)));
      const top = c.bar && across(c.bar) ? Math.ceil(artY(c.bar.bottom)) + 2 : 0;
      return pickerLayout(w, h, { top, bottom, touch: true });
    };
    let lay = layout();

    // ---------------------------------------------------------------- the pick
    let shelf = 0;
    let item = 0;
    /** The first row the list shows. */
    let top = 0;
    /** Where each shelf was left, so coming back finds the same pick. */
    const left = shelves.map(() => 0);
    let defView = false;
    let previewOn = true;
    let yaw = 0;
    let preview: Thing | null = null;
    /** The pick's DEF lines and its frames for the HUD, made when it is picked. */
    let made: { def: string[]; hud: ReturnType<typeof hudSprite>[] } = { def: [], hud: [] };
    const placed: Placed[] = [];
    let finds = 0;
    let clock = 0;
    /** Where the preview and Enter put the pick: in front of the hero, or under the mouse once it moves. */
    let aim: 'hero' | 'pointer' = 'hero';
    /** Where the last thing went down: the preview stays hidden there until the aim moves on. */
    let held: [number, number] | null = null;

    const current = () => shelves[shelf]!;
    const picked = () => assetsOf(current())[item]!;

    const thingOf = (s: Shelf, def: Asset): Thing => {
      if (s.models) {
        const model = standModel(def as ModelDef, s.catalog);
        const [w, h, d] = model.build.bounds.size;
        return { id: def.id, kind: 'model', root: model.root, size: [w, h, d], model, frames: 1, dispose: model.dispose };
      }
      const tex = def as TextureDef;
      if (tex.tile) {
        const patch = tilePatch(tex, PATCH);
        return { id: def.id, kind: 'surface', root: patch.mesh, size: [PATCH, 0, PATCH], frames: 1, dispose: patch.dispose };
      }
      const frames = tex.frames ?? 1;
      const h = spriteHeight(tex);
      const batch = new SpriteBatch(spriteSheet(tex), { capacity: 1 });
      batch.spawn([0, 0, 0], { size: h });
      return { id: def.id, kind: 'sprite', root: batch, size: [(h * tex.size[0]) / frames / tex.size[1], h, 0.1], batch, frames, dispose: () => batch.dispose() };
    };
    /** How far a thing reaches from its centre across the floor. */
    const reach = (t: Thing) => Math.hypot(t.size[0], t.size[2]) / 2;

    /** The list's window keeps the pick in view: it moves as little as it must, or puts the pick in the middle (`centre`). */
    const fitWindow = (rows: number, centre = false) => {
      const n = count(current());
      if (centre) top = item - Math.floor(rows / 2);
      else if (item < top) top = item;
      else if (item >= top + rows) top = item - rows + 1;
      top = Math.max(0, Math.min(top, n - rows));
    };
    /** Pick asset `i` of shelf `s`: the list shows it, the preview is rebuilt. */
    const choose = (s: number, i: number, centre = false) => {
      const jumped = s !== shelf;
      shelf = s;
      item = Math.max(0, Math.min(count(current()) - 1, i));
      left[s] = item;
      fitWindow(lay.rows, centre || jumped);
      if (preview) {
        ctx.scene.remove(preview.root);
        preview.dispose();
      }
      const def = picked();
      preview = thingOf(current(), def);
      ctx.scene.add(preview.root);
      held = null;
      made = { def: defLines(def, preview.model?.build), hud: 'layers' in def ? Array.from({ length: def.frames ?? 1 }, (_, f) => hudSprite(def, { frame: f })) : [] };
    };
    const scroll = (by: number) => choose(shelf, item + by);
    const turnShelf = (by: number) => {
      const s = (((shelf + by) % shelves.length) + shelves.length) % shelves.length;
      choose(s, left[s]!);
    };
    /** Pick any asset by id (library or pack, model or texture): false when there's no such asset. */
    const select = (id: string): boolean => {
      for (const [s, sh] of shelves.entries()) {
        const i = assetsOf(sh).findIndex((d) => d.id === id);
        if (i >= 0) {
          choose(s, i, true);
          return true;
        }
      }
      return false;
    };
    /** The next shelf after this one that passes `test`, round the end (this one if no other does). */
    const nextShelf = (test: (s: Shelf) => boolean) => {
      for (let k = 1; k <= shelves.length; k++) {
        const s = (shelf + k) % shelves.length;
        if (test(shelves[s]!)) return choose(s, left[s]!);
      }
    };

    // ---------------------------------------------------------------- the floor
    const origin = new Vector3();
    const dir = new Vector3();
    const inRoom = (x: number, z: number) => Math.abs(x) < HALF[0] - 1.2 && Math.abs(z) < HALF[1] - 1.2;
    /** The floor under device coordinates (x, y), or null off the floor. */
    const floorAt = (x: number, y: number): Vec3 | null => {
      ctx.camera.rayAt(x, y, origin, dir);
      if (dir.y > -1e-4) return null;
      const t = -origin.y / dir.y;
      const at: Vec3 = [origin.x + dir.x * t, 0, origin.z + dir.z * t];
      return inRoom(at[0], at[2]) ? at : null;
    };
    /** In front of the hero, far enough for a thing `r` metres across the floor to clear it. */
    const ahead = (r: number): Vec3 => {
      const v = room.hero;
      const f = v?.hero?.facing ?? Math.PI;
      const p = v?.position ?? new Vector3(0, 0, 4.5);
      const d = 0.9 + r;
      const lim = [HALF[0] - 1.3, HALF[1] - 1.3];
      return [Math.max(-lim[0]!, Math.min(lim[0]!, p.x + Math.sin(f) * d)), 0, Math.max(-lim[1]!, Math.min(lim[1]!, p.z + Math.cos(f) * d))];
    };

    /** Whether floor point (x, z) lies on patch `p` (a square turned with it), or within `margin` of it. */
    const onPatch = (p: Placed, x: number, z: number, margin = 0) => {
      const r = p.thing.root;
      const [dx, dz, c, sin] = [x - r.position.x, z - r.position.z, Math.cos(r.rotation.y), Math.sin(r.rotation.y)];
      // into the patch's own axes: its turn about Y undone
      return Math.abs(dx * c - dz * sin) <= PATCH / 2 + margin && Math.abs(dx * sin + dz * c) <= PATCH / 2 + margin;
    };
    /** The top of the highest patch at floor point (x, z) (or within `margin` of it); 0 on the bare floor. */
    const patchTop = (x: number, z: number, margin = 0) => placed.reduce((y, p) => (p.thing.kind === 'surface' && onPatch(p, x, z, margin) ? Math.max(y, p.thing.root.position.y) : y), 0);

    const place = (s: Shelf, def: Asset, at: Vec3, turn: number): Placed | null => {
      if (placed.length >= MAX_PLACED) {
        room.toast(`The floor holds ${MAX_PLACED} things: UNDO or CLEAR some first.`, 3);
        return null;
      }
      const thing = thingOf(s, def);
      // a patch lies a millimetre over any patch it may cover (one whose square is within its half diagonal); the rest stand on the highest patch under them
      const covered = patchTop(at[0], at[2], thing.kind === 'surface' ? PATCH / Math.SQRT2 : 0);
      const y = thing.kind === 'surface' ? (covered ? covered + 0.001 : PATCH_LIFT) : covered + (thing.kind === 'model' ? LIFT : 0);
      thing.root.position.set(at[0], y, at[2]);
      thing.root.rotation.y = thing.kind === 'sprite' ? 0 : turned(turn); // a sprite always faces the camera
      ctx.scene.add(thing.root);
      const p: Placed = { thing, shelf: s.id, light: thing.model ? requestLight(ctx, thing.model) : null };
      placed.push(p);
      held = [at[0], at[2]];
      return p;
    };
    const placePick = (at: Vec3) => place(current(), picked(), at, yaw);
    const remove = (p: Placed) => {
      ctx.scene.remove(p.thing.root);
      p.light?.release();
      p.thing.dispose();
      placed.splice(placed.indexOf(p), 1);
    };
    const undo = (): string | null => {
      const last = placed.at(-1);
      if (last) remove(last);
      return last?.thing.id ?? null;
    };
    const clear = (): number => {
      const n = placed.length;
      while (placed.length) remove(placed.at(-1)!);
      return n;
    };
    /** The thing whose foot is at floor point (x, z), the nearest first; null if none. */
    const thingAt = (x: number, z: number): Placed | null => {
      let best: Placed | null = null;
      let near = Infinity;
      for (const p of placed) {
        const d = Math.hypot(p.thing.root.position.x - x, p.thing.root.position.z - z);
        if (d < Math.max(0.5, reach(p.thing)) && d < near) [best, near] = [p, d];
      }
      return best;
    };
    const raycaster = new Raycaster();
    const [foot, head, side] = [new Vector3(), new Vector3(), new Vector3()];
    /** How far along the ray (origin, dir) a placed sprite stands, if the ray passes through its picture (a camera-facing rectangle), else null. */
    const spriteAlong = (p: Placed, x: number, y: number): number | null => {
      const cam = ctx.camera.camera;
      const r = p.thing.root.position;
      const [w, h] = p.thing.size;
      foot.copy(r).project(cam);
      head.set(r.x, r.y + h, r.z).project(cam);
      const half = Math.abs(side.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(w / 2).add(r).project(cam).x - foot.x);
      return Math.abs(x - foot.x) <= half && y >= foot.y && y <= head.y ? side.copy(r).sub(origin).dot(dir) : null;
    };
    /** What a click at device coordinates (x, y) points at: the nearest placed thing the ray through it hits, else the one whose foot is under it. */
    const pickAt = (x: number, y: number): Placed | null => {
      ctx.camera.rayAt(x, y, origin, dir);
      raycaster.set(origin, dir);
      const owner = new Map(placed.filter((p) => p.thing.kind !== 'sprite').map((p) => [p.thing.root, p]));
      let best: Placed | null = null;
      let near = Infinity;
      const hit = raycaster.intersectObjects([...owner.keys()], true)[0];
      for (let o: Object3D | null = hit?.object ?? null; o && !best; o = o.parent) if (owner.has(o)) [best, near] = [owner.get(o)!, hit!.distance];
      // a sprite's picture is drawn by its shader, facing the camera: the ray is tested against that rectangle
      for (const p of placed) {
        const d = p.thing.kind === 'sprite' ? spriteAlong(p, x, y) : null;
        if (d !== null && d < near) [best, near] = [p, d];
      }
      if (best) return best;
      const at = floorAt(x, y);
      return at && thingAt(at[0], at[2]);
    };
    const box = new Box3();
    const round = (v: number) => +v.toFixed(4);
    /** What went down, where its root stands now; a model also says where its lowest point is (`base`, world y) and the middle of its footprint (`middle`, x and z). */
    const describe = (p: Placed) => {
      const r = p.thing.root;
      const model = p.thing.model ? box.setFromObject(r) : null;
      return {
        id: p.thing.id,
        kind: p.thing.kind,
        shelf: p.shelf,
        at: r.position.toArray().map(round),
        yaw: round(r.rotation.y),
        size: p.thing.size.map(round),
        light: !!p.light,
        base: model ? round(model.min.y) : null,
        middle: model ? [round((model.min.x + model.max.x) / 2), round((model.min.z + model.max.z) / 2)] : null,
      };
    };

    // ---------------------------------------------------------------- the pointer
    const lastPointer = { x: NaN, y: NaN };
    const lastHero = new Vector3(NaN, 0, 0);
    /** Where the mouse was last over the floor, outside the panel: the aim once it moves there. */
    let pointerFloor: Vec3 | null = null;
    const artOf = (x: number, y: number) => ({ x: ((x + 1) / 2) * ctx.hud.width, y: ((1 - y) / 2) * ctx.hud.height });
    const target = (): Vec3 => (aim === 'pointer' && pointerFloor) || ahead(preview ? reach(preview) : 0.5);
    /** A click (or a tap) on the panel: a row, an arrow, the DEF switch. */
    const panelClick = (ax: number, ay: number) => {
      if (inside(lay.prev, ax, ay)) turnShelf(-1);
      else if (inside(lay.next, ax, ay)) turnShelf(1);
      else if (inside(lay.def, ax, ay)) setDef(!defView);
      else if (inside(lay.list, ax, ay)) {
        const i = top + Math.floor((ay - lay.list.y) / ROW);
        if (i < count(current())) choose(shelf, i);
      }
    };
    const pressAt = (x: number, y: number) => {
      const a = artOf(x, y);
      if (inside(lay.panel, a.x, a.y)) return panelClick(a.x, a.y);
      const at = floorAt(x, y);
      if (at) placePick(at);
    };
    /**
     * A finger. Dragged up or down the list it scrolls it, a row for each row's height; a tap (a
     * short touch that didn't move or pinch: a pinch zooms) acts where it lifts. True on a tap.
     */
    const touch = { down: false, start: 0, x: 0, y: 0, moved: false, list: false, drag: 0, lastY: 0 };
    const finger = (): boolean => {
      const pressed = input.consumePress('Touch');
      const down = input.isDown('Touch');
      if (pressed && !down) return true; // down and up inside one frame
      const p = input.pointer;
      const a = artOf(p.x, p.y);
      if (down && !touch.down) Object.assign(touch, { down: true, start: clock, x: p.x, y: p.y, moved: false, list: inside(lay.list, a.x, a.y), drag: 0, lastY: a.y });
      else if (down) {
        if (Math.hypot(p.x - touch.x, p.y - touch.y) > 0.05 || input.wheel) touch.moved = true;
        if (touch.list) {
          touch.drag += touch.lastY - a.y; // up the screen: further down the list
          touch.lastY = a.y;
          const rows = Math.trunc(touch.drag / ROW);
          if (rows) scroll(rows);
          touch.drag -= rows * ROW;
        }
      }
      if (down || !touch.down) return false;
      touch.down = false;
      return !touch.moved && clock - touch.start < 0.4;
    };

    // ---------------------------------------------------------------- pads: build, then the ideas behind it
    const setDef = (on: boolean) => {
      defView = on;
      kit.lightPad(defPad, on);
    };
    const front = 8;
    kit.pad([-6, 0, front], { label: 'SPAWN', color: 'lime', note: 'The pick goes down in front of you (Enter does the same where the preview hovers).', apply: () => void placePick(ahead(preview ? reach(preview) : 0.5)) });
    kit.pad([-3, 0, front], { label: 'UNDO', color: 'sand', note: 'The last thing placed is gone (Backspace; a right click takes the one under the mouse).', apply: () => void undo() });
    kit.pad([0, 0, front], { label: 'TURN', color: 'sky', note: 'The next thing goes down turned another 45 degrees (Y). A sprite always faces the camera.', apply: () => (yaw = turned(yaw + TURN)) });
    kit.pad([3, 0, front], { label: 'CLEAR', color: 'red', note: 'Everything placed is gone: each one’s meshes and light freed.', apply: () => void clear() });
    const defPad = kit.pad([6, 0, front], { label: 'DEF VIEW', color: 'plum', note: 'The panel shows what the pick is made of: its parts, palette slots, params and the models it uses (Tab).', apply: () => setDef(!defView) });
    const back = -8;
    kit.pad([-6.75, 0, back], { label: 'MODELS ARE DATA', color: 'orange', note: 'A model is a ModelDef, plain data: parts in palette slots, params, and use to place other models. buildModel makes toon meshes of it. Tab shows the pick’s.', apply: () => setDef(true) }, [2.8, 1.6]);
    kit.pad([-2.25, 0, back], { label: 'TEXTURES', color: 'cyan', note: 'A texture is a TextureDef: layers of pixels, patterns and paths in palette slots. Tiles lie as floors (textureMap), sprites stand (spriteSheet). Here: the next shelf.', apply: () => nextShelf((s) => !!s.textures) }, [2.8, 1.6]);
    kit.pad([2.25, 0, back], { label: 'PACKS', color: 'green', note: 'Other people’s kits, converted once into this format and palette: a JSON file each in public/packs, loaded by loadPack, each asset with its licence. Here: the next pack.', apply: () => nextShelf((s) => s.source !== LIBRARY_SOURCE) }, [2.8, 1.6]);
    kit.pad([6.75, 0, back], {
      label: 'FIND IT',
      color: 'sand',
      note: 'One search across the library and every pack, models and textures together (searchDefs): each step tries another word and picks the best hit. npm run model -- find and tex -- find search one kind each.',
      quiet: true, // its own toast says what it found
      apply: () => {
        const q = EXAMPLES[finds++ % EXAMPLES.length]!;
        const hits = searchDefs(everything(), q);
        const best = hits[0];
        if (best) select(best.id);
        // the command line searches one kind at a time: the best hit's
        const [kind, cli] = best && 'layers' in best ? ['Textures', 'tex'] : ['Models', 'model'];
        room.toast(`FIND IT: searchDefs over models and textures for '${q}': ${hits.length} hits, ${best?.id ?? 'none'} first (now picked). ${kind} alone: npm run ${cli} -- find ${q}.`, 6);
      },
    }, [2.8, 1.6]);

    const ring = new Mesh(new RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2), kit.glow('sand', 0.6));
    ctx.scene.add(ring);

    const wanted = pageParam('asset');
    if (!(wanted && select(wanted))) choose(0, 0);

    const knobs: Knob[] = [
      { kind: 'choice', id: 'shelf', label: 'Shelf', options: shelves.map((s) => `${s.title} (${count(s)})`), get: () => shelf, set: (i) => choose(i, left[i] ?? 0), hint: 'Every shelf: the library’s families, its textures, then every imported pack.' },
      { id: 'item', label: 'Item', min: 0, max: 1, step: 0.001, get: () => (count(current()) > 1 ? item / (count(current()) - 1) : 0), set: (v) => choose(shelf, Math.round(v * (count(current()) - 1))), format: () => `${item + 1} / ${count(current())}` },
      { kind: 'choice', id: 'turn', label: 'Turn', options: ['0', '45', '90', '135', '180', '225', '270', '315'].map((d) => `${d} degrees`), get: () => Math.round(yaw / TURN) % 8, set: (i) => (yaw = i * TURN), hint: 'How the next thing goes down (Y): models turn, sprites face the camera.' },
      { kind: 'toggle', id: 'def', label: 'Def view', get: () => defView, set: setDef },
      { kind: 'toggle', id: 'preview', label: 'Preview', get: () => previewOn, set: (v) => (previewOn = v), hint: 'The pick hovering where Enter puts it.' },
    ];

    /** The pick's lines for the panel: what it is, how big, where from (or, in the DEF view, what it is made of). */
    const infoLines = (): Line[] => {
      const def = picked();
      const id: Line = { text: clean(def.id.length > lay.chars && def.source?.pack ? def.id.slice(def.id.indexOf('/') + 1) : def.id).slice(0, lay.chars), color: 'white' };
      const measure = wrapParts(clean(preview?.model ? modelLine(preview.model.build) : textureLine(def as TextureDef)), lay.chars, 2).map((text) => ({ text, color: 'mist' as PaletteColor }));
      if (defView) return [id, ...made.def.flatMap((l) => wrap(clean(l), lay.minis, 2)).map((text) => ({ text, color: 'sky' as PaletteColor, mini: true }))];
      const source = sourceOf(def) || LIBRARY_SOURCE; // a pack's own title is the shelf's
      return [
        id,
        ...measure.slice(0, lay.wide ? 2 : 1),
        ...(lay.wide ? wrap(clean(def.about), lay.chars, 2).map((text) => ({ text, color: 'sand' as PaletteColor })) : []),
        ...wrap(clean(source), lay.minis, lay.wide ? 3 : 1).map((text) => ({ text, color: 'slate' as PaletteColor, mini: true })),
      ];
    };

    /** What the camera follows (`cameraTarget`). */
    const focus = new Vector3();
    const axis = new Vector3();

    return {
      knobs,
      update(dt) {
        clock += dt;
        lay = layout();
        const p = input.pointer;
        const a = artOf(p.x, p.y);
        const overPanel = p.over && inside(lay.panel, a.x, a.y);
        fitWindow(lay.rows); // the screen may have changed shape
        // the aim: the mouse once it moves over the floor (never the floor under the panel), the hero once it walks
        const hero = room.hero?.position;
        const floor = p.over && !p.touch && !overPanel ? floorAt(p.x, p.y) : null;
        if (floor) {
          pointerFloor = floor;
          if (p.x !== lastPointer.x || p.y !== lastPointer.y) aim = 'pointer';
        }
        if (!p.over || (hero && Number.isFinite(lastHero.x) && hero.distanceTo(lastHero) > 0.01)) aim = 'hero';
        lastPointer.x = p.x;
        lastPointer.y = p.y;
        if (hero) lastHero.copy(hero);
        if (room.inputFree) {
          const shift = input.isDown('ShiftLeft', 'ShiftRight');
          if (input.consumePress('KeyE')) scroll(shift ? 10 : 1);
          if (input.consumePress('KeyQ')) scroll(shift ? -10 : -1);
          if (input.consumePress('Period')) turnShelf(1);
          if (input.consumePress('Comma')) turnShelf(-1);
          if (input.consumePress('Tab')) setDef(!defView);
          if (input.consumePress('KeyY')) yaw = turned(yaw + TURN);
          if (input.consumePress('Backspace')) undo();
          if (input.consumePress('Enter', 'NumpadEnter')) placePick(target());
          // the wheel over the list scrolls it, and doesn't zoom the camera
          if (overPanel && input.wheel) {
            scroll(Math.sign(input.wheel));
            input.wheel = 0;
          }
          const tap = finger();
          if (input.consumePress('MouseLeft') || tap) pressAt(p.x, p.y);
          if (input.consumePress('MouseRight')) {
            const hit = overPanel ? null : pickAt(p.x, p.y);
            if (hit) remove(hit);
          }
        } else touch.down = false; // a panel took the finger

        const frame = Math.floor(clock * 8);
        for (const q of placed) if (q.thing.frames > 1) q.thing.batch!.set(0, { frame: frame % q.thing.frames });
        if (!preview) return;
        const at = target();
        if (held && Math.hypot(at[0] - held[0], at[2] - held[1]) > 0.3) held = null;
        const show = previewOn && !held;
        const flat = preview.kind === 'surface';
        preview.root.visible = ring.visible = show;
        preview.root.position.set(at[0], flat ? 0.06 : 0.15 + Math.sin(clock * 4) * 0.05, at[2]);
        preview.root.rotation.y = preview.kind === 'sprite' ? 0 : yaw;
        if (preview.frames > 1) preview.batch!.set(0, { frame: frame % preview.frames });
        const r = Math.max(0.4, flat ? PATCH / 2 : reach(preview));
        ring.position.set(at[0], 0.02, at[2]);
        ring.scale.setScalar(r);
      },
      draw() {
        const hud = ctx.hud;
        const s = current();
        const n = count(s);
        const { panel, list } = lay;
        ui.panel(panel.x, panel.y, panel.w, panel.h, 'ink', 'plum');
        // header: the shelf, the arrows, the DEF switch
        for (const [r, glyph] of [[lay.prev, '<'], [lay.next, '>']] as const) {
          ui.rect(r.x, r.y, r.w, r.h, 'night');
          hud.text(r.x + 3, r.y + 2, glyph, { color: 'sand', shadow: false });
        }
        const title = shortTitle(s.title, Math.floor((lay.next.x - (lay.prev.x + lay.prev.w) - 3) / 6));
        hud.text(panel.x + Math.floor((panel.w - (title.length * 6 - 1)) / 2), panel.y + 6, title, { color: 'white' });
        const counts = [`SHELF ${shelf + 1}/${shelves.length} · ITEM ${item + 1}/${n} · ${placed.length} PLACED`, `${item + 1}/${n} · ${placed.length} PLACED`, `${item + 1}/${n}`];
        const fits = Math.floor((lay.def.x - panel.x - 6) / 4);
        ui.mini(panel.x + 5, panel.y + 19, counts.find((c) => c.length <= fits) ?? counts.at(-1)!, 'mist');
        ui.rect(lay.def.x, lay.def.y, lay.def.w, lay.def.h, defView ? 'plum' : 'night');
        ui.mini(lay.def.x + 6, lay.def.y + 2, 'DEF', defView ? 'white' : 'slate');
        // the list: a window of the shelf, the pick highlighted, the row under the mouse lit
        const hover = input.pointer.over && !input.pointer.touch ? artOf(input.pointer.x, input.pointer.y) : null;
        const pack = s.id.startsWith('library/') || s.id.startsWith('textures/') ? '' : `${s.id.split('/')[0]}/`;
        const assets = assetsOf(s);
        for (let r = 0; r < lay.rows && top + r < n; r++) {
          const i = top + r;
          const y = list.y + r * ROW;
          const lit = hover && inside({ x: list.x, y, w: list.w, h: ROW }, hover.x, hover.y);
          if (i === item) ui.rect(list.x, y, list.w - 4, ROW, 'slate');
          else if (lit) ui.rect(list.x, y, list.w - 4, ROW, 'night');
          const id = assets[i]!.id;
          hud.text(list.x + 2, y + 1, clean(pack && id.startsWith(pack) ? id.slice(pack.length) : id).slice(0, lay.chars - 1), { color: i === item ? 'white' : 'mist', shadow: false });
        }
        if (n > lay.rows) {
          // where the window is in the shelf
          const thumb = Math.max(4, Math.round((list.h * lay.rows) / n));
          ui.rect(list.x + list.w - 2, list.y, 2, list.h, 'night');
          ui.rect(list.x + list.w - 2, list.y + Math.round(((list.h - thumb) * top) / (n - lay.rows)), 2, thumb, 'sand');
        }
        // the pick: what it is, how big, where from
        ui.rect(panel.x + 4, lay.info.y - 3, panel.w - 8, 1, 'plum');
        let y = lay.info.y;
        for (const l of infoLines()) {
          const h = l.mini ? 7 : ROW;
          if (y + h > lay.info.y + lay.info.h) break;
          if (l.mini) ui.mini(lay.info.x, y + 1, l.text, l.color);
          else hud.text(lay.info.x, y, l.text, { color: l.color, shadow: false });
          y += h;
        }
        lay.hints.forEach((t, k) => ui.mini(panel.x + 5, panel.y + panel.h - 4 - (lay.hints.length - k) * 7, t, 'slate'));
        // a texture's own pixels, exact, beside the panel (above it on a narrow screen)
        const spr = made.hud[Math.floor(clock * 8) % Math.max(1, made.hud.length)];
        if (spr) {
          const w = spr.rows[0]?.length ?? 16;
          const scale = Math.max(1, Math.min(3, Math.floor(40 / Math.max(w, spr.rows.length))));
          const bw = w * scale + 6;
          const bh = spr.rows.length * scale + 6;
          const bx = lay.wide ? panel.x - bw - 2 : panel.x + panel.w - bw;
          const by = lay.wide ? lay.info.y - 3 : panel.y - bh - 2;
          ui.rect(bx, by, bw, bh, 'ink');
          hud.sprite(bx + 3, by + 3, spr.rows, spr.colors, { scale });
        }
        if (lay.wide && yaw) hud.text(4, 18, `NEXT ONE TURNED ${Math.round((yaw * 180) / Math.PI)}°`, { anchor: 'bottom-left', color: 'sky' });
      },
      // the hero in the middle of what the panel leaves free (left of it, or above it), so what goes down in front isn't under it
      cameraTarget() {
        const v = room.hero;
        const cam = ctx.camera.camera;
        if (!v || !(cam instanceof OrthographicCamera)) return null;
        const { width: w, height: h } = ctx.hud;
        const free = lay.wide ? { x: lay.panel.x / 2, y: h / 2 } : { x: w / 2, y: (22 + lay.panel.y) / 2 };
        const perPixel = (cam.top - cam.bottom) / h;
        focus.set(v.position.x, v.position.y + 0.9, v.position.z);
        focus.addScaledVector(axis.setFromMatrixColumn(cam.matrixWorld, 0), (w / 2 - free.x) * perPixel);
        return focus.addScaledVector(axis.setFromMatrixColumn(cam.matrixWorld, 1), (free.y - h / 2) * perPixel);
      },
      status: () => `${current().id} ${item + 1}/${count(current())} ${picked().id} · placed ${placed.length}`,
      dispose() {
        for (const p of placed) p.light?.release();
      },
      api: {
        /** Every shelf: id, title, how many assets. */
        shelves: () => shelves.map((s) => ({ id: s.id, title: s.title, count: count(s) })),
        /** The library's families, as the engine lists them (`MODEL_FAMILIES`, `TEXTURE_FAMILIES`): what the library's shelves hold. */
        library: () => ({ models: MODEL_FAMILIES, textures: TEXTURE_FAMILIES }),
        /** Open a shelf by id (where it was left): false if there's none. */
        shelf: (id: string) => {
          const s = shelves.findIndex((x) => x.id === id);
          if (s >= 0) choose(s, left[s]!);
          return s >= 0;
        },
        /** Pick any asset by id (library or pack, model or texture): false if there's none. */
        select,
        /** The pick, and the window of its shelf the list shows. */
        selected: () => ({ id: picked().id, kind: preview?.kind ?? null, shelf: current().id, index: item, count: count(current()), top, rows: lay.rows }),
        /** Move the pick `n` rows down the list (up when negative): its index after. */
        scroll: (n: number) => (scroll(n), item),
        /**
         * Place an asset (the pick, or any by id, which becomes the pick) on the floor at `at`
         * (x, z; y is ignored), or in front of the hero: what went down, or null (no such id, the
         * floor full).
         */
        spawn: (id?: string, at?: readonly number[], turnDegrees?: number) => {
          if (id !== undefined && !select(id)) return null;
          const where: Vec3 = at ? [at[0] ?? 0, 0, at[at.length - 1] ?? 0] : ahead(preview ? reach(preview) : 0.5);
          const p = place(current(), picked(), where, turnDegrees === undefined ? yaw : (turnDegrees * Math.PI) / 180);
          return p && describe(p);
        },
        /** Everything placed, oldest first. */
        spawned: () => placed.map(describe),
        /** Take the last thing away: its id, or null when the floor is empty. */
        undo,
        /** Take everything away: how many went. */
        clear,
        /** Asset ids that match words, best first: `searchDefs` over models and textures together (`npm run model -- find` and `tex -- find` rank one kind each). */
        find: (text: string, limit = 10) => searchDefs(everything(), text, { limit }).map((d) => d.id),
        /** What the pick is made of (the DEF view's lines). */
        def: () => [...made.def],
        defView: (on: boolean) => setDef(on),
        /** Hide (or show again) everything placed, the camera left where it is: a baseline for captures. */
        hide: (on: boolean) => {
          for (const p of placed) p.thing.root.visible = !on;
        },
        /** The preview (and its ring) on or off. */
        preview: (on: boolean) => (previewOn = on),
        /** Where the preview hovers and Enter puts the pick: by the hero, or by the pointer (where the mouse was last over the floor). */
        aim: () => ({ by: aim, at: target().map(round) }),
        /** Turn the next placement to this many degrees. */
        turn: (degrees: number) => (yaw = turned((degrees * Math.PI) / 180)),
        /** The picker on the HUD (art pixels), each visible row with the device coordinates of its middle, for clicks. */
        ui: () => {
          const ndc = (x: number, y: number) => [(x / ctx.hud.width) * 2 - 1, 1 - (y / ctx.hud.height) * 2];
          const ids = assetsOf(current());
          return {
            width: ctx.hud.width,
            height: ctx.hud.height,
            panel: lay.panel,
            rows: Array.from({ length: Math.min(lay.rows, ids.length - top) }, (_, r) => ({ id: ids[top + r]!.id, at: ndc(lay.list.x + lay.list.w / 2, lay.list.y + r * ROW + ROW / 2) })),
            prev: ndc(lay.prev.x + lay.prev.w / 2, lay.prev.y + lay.prev.h / 2),
            next: ndc(lay.next.x + lay.next.w / 2, lay.next.y + lay.next.h / 2),
          };
        },
        /** The floor point under device coordinates (x, y), or null. */
        floorAt,
      },
    };
  },
};
