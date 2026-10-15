/**
 * Asset Gallery: every model and texture the engine carries, one at a time on a turntable: the
 * built-in library family by family (`MODEL_FAMILIES`, `TEXTURE_FAMILIES`) and every imported
 * pack that public/packs/index.json lists. Q and E step through a shelf (Shift: ten at a time),
 * comma and period change shelf; the panel says what the asset is, how big, and where it came
 * from. `?asset=<id>` opens the gallery on one asset; agents drive it through `__WORLD__.room`.
 */
import { Object3D, Vector3 } from 'three/webgpu';
import { hudSprite, type LightHandle, type PaletteColor, searchDefs, SpriteBatch, spriteSheet, type TextureDef } from '../../engine';
import { GAME_VIEW } from '../../engine/model/view';
import type { Knob, RoomDef } from '../types';
import { assetsOf, clean, count, libraryShelves, modelLine, packShelves, requestLight, type Shelf, sourceOf, spriteHeight, standModel, textureLine, tilePatch, wrap } from './shelves';

/** What is on the turntable. */
interface Exhibit {
  readonly id: string;
  readonly kind: 'model' | 'surface' | 'sprite';
  readonly root: Object3D;
  /** Its extent in metres (x, y, z), for the zoom. */
  readonly size: readonly [number, number, number];
  readonly centre: Vector3;
  readonly line: string;
  readonly sprite?: TextureDef;
  readonly batch?: SpriteBatch;
  /** A texture's frames as HUD rows and colours, baked once (`hudSprite`). */
  readonly hud?: readonly ReturnType<typeof hudSprite>[];
  dispose(): void;
}

const PLINTH = 0.3;
/** Exhibits stand this far above the plinth, so a flat one (a ground tile, a floor) never fights it for depth. */
const LIFT = 0.002;
const ZOOMS = ['fit', 'level', 'town', 'close'] as const;

export const GALLERY: RoomDef = {
  id: 'gallery',
  title: 'Asset Gallery',
  wing: 'looks',
  about: 'Every model and texture the engine carries, one at a time on a turntable: the built-in library family by family, then every imported pack. Q and E step through a shelf, comma and period change shelf; the panel says what each asset is, how big it is and where it came from.',
  try: ['Step through a shelf with E, and ten at a time with Shift+E', 'Change shelf with the period key: the textures and imported packs come after the models', 'Pick level or town zoom in T to see an asset at the game’s own scale', 'Walk off to reach the pads; the next step brings the camera back to the exhibit'],
  camera: { preset: 'iso', yaw: GAME_VIEW.yaw, pitch: GAME_VIEW.pitch, viewHeight: GAME_VIEW.viewHeight, stiffness: 9, minZoom: 0.3, maxZoom: 24 },
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'One asset at a time on a turntable: a library model, a texture (a surface laid as a floor, a sprite standing up) or a model or tile from an imported pack. The panel names it, measures it and says where it came from.',
    how: [
      'Models and textures are plain data (ModelDef, TextureDef): buildModel turns a def into meshes, textureMap and spriteSheet bake a texture into the engine’s palette.',
      'The library comes in families (MODEL_FAMILIES, TEXTURE_FAMILIES); each family is a shelf here.',
      'Imported packs live in public/packs/<pack>.json, listed in public/packs/index.json: loadPackIndex finds them, loadPack hands back a catalog of the pack’s models and its textures.',
      'The importers (npm run model -- import-pack, npm run tex -- import-pack) map every source colour onto the engine’s 16, so an import sits in the same style as the library.',
      'Search is the same everywhere: catalog.search ranks id words over tags over the about line, and npm run model -- find and tex -- find use it too.',
    ],
    uses: ['A content browser in an editor (Unity’s project window, Godot’s FileSystem dock): see every asset before you place it.', 'Review: step through an import to catch a colour or a shape that came out wrong.'],
    ask: ['show me every chair in the library', 'import a CC0 pack and put it in the gallery', 'which models are tagged dungeon', 'a sheet of the nature pack'],
    cost: 'One exhibit at a time: its build (a few draw calls) and its light. Packs load once, as JSON, when the room opens.',
    code: [
      {
        title: 'Packs are data, found through their index',
        file: 'src/engine/assets.ts',
        src: `export async function loadPackIndex(url = 'packs/index.json'): Promise<PackIndex> {
  const r = await fetch(resolveAsset(url));
...
export function loadPack(url: string, opts: { readonly into?: ModelCatalog; readonly textures?: TextureCatalog } = {}): Promise<ModelCatalog> {`,
      },
      {
        title: 'One search, ranked',
        file: 'src/engine/catalog.ts',
        src: `const s = has(id) ? 4 : has(tags) ? 3 : has(about) ? 2 : w.length >= 3 && all.some((x) => x.startsWith(w)) ? 1 : w.length >= 3 && all.some((x) => x.includes(w)) ? 0.5 : 0;`,
      },
    ],
    words: ['catalog', 'asset pack', 'palette', 'sprite', 'agent API'],
  },
  async build(room) {
    const { kit, ctx } = room;
    kit.room(26, 20, { floor: ['night', 'ink'], wall: { color: 'slate', side: 'night' } });
    kit.cylinder([0, PLINTH / 2, 0], 2.4, PLINTH, 'slate', { segments: 24 });
    kit.light({ position: [2, 5, 3], color: 0xf4f4f4, intensity: 6, radius: 16 });

    const shelves = [...libraryShelves(), ...(await packShelves())];
    let shelf = 0;
    let item = 0;
    let zoom: (typeof ZOOMS)[number] = 'fit';
    let spin = true;
    let exhibit: Exhibit | null = null;
    let lights: LightHandle[] = [];
    let clock = 0;

    const exhibitOf = (s: Shelf, i: number): Exhibit => {
      const top = new Vector3(0, PLINTH + LIFT, 0);
      if (s.models) {
        const def = s.models[i]!;
        const m = standModel(def, s.catalog);
        m.root.position.copy(top);
        // the light follows a point inside the model, so a torch's glow stays on its flame as it turns
        const light = requestLight(ctx, m);
        lights = light ? [light] : [];
        const [w, h, d] = m.build.bounds.size;
        return { id: def.id, kind: 'model', root: m.root, size: [w, h, d], centre: top.clone().setY(top.y + h / 2), line: modelLine(m.build), dispose: m.dispose };
      }
      const def = s.textures![i]!;
      const hud = Array.from({ length: def.frames ?? 1 }, (_, f) => hudSprite(def, { frame: f }));
      if (def.tile) {
        // a floor of it on the plinth (a square inside its circle), two tiles a side at least
        const side = 3.4;
        const floor = tilePatch(def, side);
        floor.mesh.position.copy(top);
        return { id: def.id, kind: 'surface', root: floor.mesh, size: [side, 0.1, side], centre: top.clone(), line: textureLine(def), hud, dispose: floor.dispose };
      }
      const size = spriteHeight(def);
      const batch = new SpriteBatch(spriteSheet(def), { capacity: 1 });
      batch.spawn([0, top.y, 0], { size });
      return {
        id: def.id,
        kind: 'sprite',
        root: batch,
        size: [size, size, 0.1],
        centre: top.clone().setY(top.y + size / 2),
        line: textureLine(def),
        sprite: def,
        batch,
        hud,
        dispose: () => batch.dispose(),
      };
    };

    const fitZoom = (e: Exhibit) => {
      if (zoom === 'level') return GAME_VIEW.zooms.level;
      if (zoom === 'town') return GAME_VIEW.zooms.town;
      if (zoom === 'close') return 3;
      const [w, h, d] = e.size;
      const span = Math.max(h, Math.hypot(w, d) * 0.8, 0.25);
      // a sprite fills a fifth of the view (its exact pixels are in the panel), anything else a third
      return Math.min(24, Math.max(0.3, GAME_VIEW.viewHeight / (span * (e.kind === 'sprite' ? 5 : 3))));
    };

    /** The camera holds the exhibit until the hero walks off; any step brings it back. */
    let focus: 'exhibit' | 'hero' = 'exhibit';
    const anchor = new Vector3();
    const show = (s: number, i: number) => {
      const target = shelves[s];
      if (!target) return;
      const n = count(target);
      const next = exhibitOf(target, ((i % n) + n) % n);
      if (exhibit) {
        ctx.scene.remove(exhibit.root);
        exhibit.dispose();
      }
      shelf = s;
      item = ((i % n) + n) % n;
      exhibit = next;
      ctx.scene.add(next.root);
      focus = 'exhibit';
      if (room.hero) anchor.copy(room.hero.position);
      ctx.camera.setZoom(fitZoom(next));
    };
    const release = () => {
      for (const l of lights) l.release();
      lights = [];
    };
    const go = (s: number, i: number) => {
      release();
      show(((s % shelves.length) + shelves.length) % shelves.length, i);
    };
    const step = (by: number) => go(shelf, item + by);
    const turn = (by: number) => go(shelf + by, 0);
    /** Jump to an asset anywhere by id: false when there's no such asset. */
    const open = (id: string): boolean => {
      for (const [s, sh] of shelves.entries()) {
        const i = assetsOf(sh).findIndex((d) => d.id === id);
        if (i >= 0) {
          go(s, i);
          return true;
        }
      }
      return false;
    };
    const everything = () => shelves.flatMap((s) => [...assetsOf(s)]);

    const wanted = new URLSearchParams(location.search).get('asset');
    if (!(wanted && open(wanted))) go(0, 0);

    kit.pad([-4.5, 0, 4], { label: '< PREV', color: 'sky', note: 'The previous asset on this shelf (Q; Shift+Q: ten back).', apply: () => step(-1) });
    kit.pad([-1.5, 0, 4], { label: 'NEXT >', color: 'sky', note: 'The next asset on this shelf (E; Shift+E: ten on).', apply: () => step(1) });
    kit.pad([1.5, 0, 4], { label: '< SHELF', color: 'sand', note: 'The previous shelf (comma).', apply: () => turn(-1) });
    kit.pad([4.5, 0, 4], { label: 'SHELF >', color: 'sand', note: 'The next shelf (period): library families, then textures, then imported packs.', apply: () => turn(1) });

    const knobs: Knob[] = [
      { kind: 'choice', id: 'shelf', label: 'Shelf', options: shelves.map((s) => `${s.title} (${count(s)})`), get: () => shelf, set: (i) => go(i, 0), hint: 'Every shelf: the library’s families, its textures, then every imported pack.' },
      { id: 'item', label: 'Item', min: 0, max: 1, step: 0.001, get: () => (count(shelves[shelf]!) > 1 ? item / (count(shelves[shelf]!) - 1) : 0), set: (v) => go(shelf, Math.round(v * (count(shelves[shelf]!) - 1))), format: () => `${item + 1} / ${count(shelves[shelf]!)}` },
      { kind: 'choice', id: 'zoom', label: 'Zoom', options: ['fit the exhibit', 'level (the game’s)', 'town (the game’s)', 'close'], get: () => ZOOMS.indexOf(zoom), set: (i) => ((zoom = ZOOMS[i] ?? 'fit'), exhibit && ctx.camera.setZoom(fitZoom(exhibit))), hint: 'Level and town are Riftlight’s own zooms: how big the asset reads in the game.' },
      { kind: 'toggle', id: 'spin', label: 'Turntable', get: () => spin, set: (v) => (spin = v) },
    ];

    return {
      knobs,
      update(dt) {
        clock += dt;
        if (room.inputFree) {
          const shift = ctx.input.isDown('ShiftLeft', 'ShiftRight');
          if (ctx.input.consumePress('KeyE')) step(shift ? 10 : 1);
          if (ctx.input.consumePress('KeyQ')) step(shift ? -10 : -1);
          if (ctx.input.consumePress('Period')) turn(1);
          if (ctx.input.consumePress('Comma')) turn(-1);
        }
        if (!exhibit) return;
        if (focus === 'exhibit' && room.hero && room.hero.position.distanceTo(anchor) > 0.6) {
          focus = 'hero'; // walking: the room and its pads come back into view
          ctx.camera.setZoom(1);
        }
        if (exhibit.kind === 'model' && spin) exhibit.root.rotation.y += dt * 0.6;
        if (exhibit.batch && (exhibit.sprite?.frames ?? 1) > 1) exhibit.batch.set(0, { frame: Math.floor(clock * 8) % exhibit.sprite!.frames! });
      },
      draw() {
        const hud = ctx.hud;
        const s = shelves[shelf];
        if (!s || !exhibit) return;
        const def = assetsOf(s).find((d) => d.id === exhibit!.id)!;
        const width = Math.min(52, Math.floor((hud.width - 16) / 6));
        const pack = !!def.source?.pack;
        const lines: { text: string; color: PaletteColor }[] = [
          { text: clean(`${s.title}  ${item + 1}/${count(s)} · shelf ${shelf + 1}/${shelves.length}`).slice(0, width), color: 'mist' },
          { text: clean(def.id).slice(0, width), color: 'white' },
          ...wrap(clean(def.about), width, 2).map((text) => ({ text, color: 'sand' as PaletteColor })),
          { text: clean(exhibit.line).slice(0, width), color: 'mist' },
          ...(pack ? [{ text: clean(sourceOf(def)).slice(0, width), color: 'slate' as PaletteColor }] : []),
          { text: 'Q/E NEXT · SHIFT X10 · ,/. SHELF', color: 'slate' },
        ];
        const lh = 9;
        const panelW = Math.max(...lines.map((l) => hud.measure(l.text).width)) + 8;
        const top = hud.height - 16 - lines.length * lh;
        hud.rect(2, top - 3, panelW, lines.length * lh + 4, 'ink');
        lines.forEach((l, k) => hud.text(6, top + k * lh, l.text, { color: l.color }));
        // a texture's own pixels, exact, above the panel
        const spr = exhibit.hud?.[Math.floor(clock * 8) % exhibit.hud.length];
        if (spr) {
          const w = spr.rows[0]?.length ?? 16;
          const scale = Math.max(1, Math.min(4, Math.floor(48 / Math.max(w, spr.rows.length))));
          const y = top - 6 - spr.rows.length * scale;
          hud.rect(2, y - 3, w * scale + 6, spr.rows.length * scale + 6, 'ink');
          hud.sprite(5, y, spr.rows, spr.colors, { scale });
        }
      },
      cameraTarget: () => (focus === 'exhibit' ? (exhibit?.centre ?? null) : null),
      status: () => `${shelves[shelf]?.id ?? '-'} ${item + 1}/${count(shelves[shelf]!)} ${exhibit?.id ?? '-'}`,
      dispose() {
        release();
        exhibit?.dispose();
      },
      api: {
        /** Every shelf: id, title, how many assets. */
        shelves: () => shelves.map((s) => ({ id: s.id, title: s.title, count: count(s) })),
        /** What is on the turntable. */
        current: () => ({ id: exhibit?.id ?? null, kind: exhibit?.kind ?? null, shelf: shelves[shelf]?.id ?? null, index: item, count: count(shelves[shelf]!), size: exhibit?.size ?? null, zoom }),
        next: (n = 1) => step(n),
        prev: (n = 1) => step(-n),
        nextShelf: () => turn(1),
        prevShelf: () => turn(-1),
        /** Open a shelf by id, at its first asset. */
        shelf: (id: string) => {
          const s = shelves.findIndex((x) => x.id === id);
          if (s < 0) return false;
          go(s, 0);
          return true;
        },
        /** Show any asset by id (library or pack, model or texture). */
        show: open,
        /** Asset ids that match words, best first: `searchDefs` over models and textures together (`npm run model -- find` and `tex -- find` rank one kind each). */
        find: (text: string, limit = 10) => searchDefs(everything(), text, { limit }).map((d) => d.id),
        spin: (on: boolean) => (spin = on),
        /** The exhibit's light, where the light pool puts it, and how far the turntable has turned (radians); null without one. */
        light: () => (lights[0] && exhibit ? { at: lights[0].position.toArray().map((v) => +v.toFixed(4)), turn: +exhibit.root.rotation.y.toFixed(4) } : null),
        /** Hide (or show again) what is on the turntable, the camera left where it is: a baseline for captures. */
        hide: (on: boolean) => {
          if (exhibit) exhibit.root.visible = !on;
        },
        zoom: (name: (typeof ZOOMS)[number]) => {
          zoom = ZOOMS.includes(name) ? name : 'fit';
          if (exhibit) ctx.camera.setZoom(fitZoom(exhibit));
        },
      },
    };
  },
};
