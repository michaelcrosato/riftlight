/**
 * Every asset the engine carries, on shelves, for the rooms that show them (the Asset Gallery,
 * the Asset Workshop): the built-in library family by family (`MODEL_FAMILIES`,
 * `TEXTURE_FAMILIES`), then every pack public/packs/index.json lists (`loadPackIndex`,
 * `loadPack`). Also what both rooms put in the world and on the HUD: a model stood on its base
 * with the point its light shines from, a floor of a tiling texture, a standing sprite's height,
 * the lines that measure an asset and say where it came from, and text the 5×7 font can draw.
 */
import { Group, Mesh, Object3D, PlaneGeometry } from 'three/webgpu';
import {
  buildModel,
  DEFAULT_TEXEL,
  type GameContext,
  type LightHandle,
  loadPack,
  loadPackIndex,
  MODEL_FAMILIES,
  MODEL_LIBRARY,
  type ModelBuild,
  ModelCatalog,
  type ModelDef,
  TEXTURE_FAMILIES,
  TEXTURE_LIBRARY,
  TextureCatalog,
  type TextureDef,
  textureMap,
  toonMaterial,
} from '../../engine';

/** A shelf: one library family or one pack's models (or textures). */
export interface Shelf {
  readonly id: string;
  readonly title: string;
  /** Where its assets came from, for the panel. */
  readonly source: string;
  readonly models?: readonly ModelDef[];
  readonly textures?: readonly TextureDef[];
  /** What a model's `use` parts resolve against. */
  readonly catalog?: ModelCatalog;
}

export type Asset = ModelDef | TextureDef;

/** A shelf's assets: its models, or its textures. */
export const assetsOf = (s: Shelf): readonly Asset[] => s.models ?? s.textures ?? [];
export const count = (s: Shelf) => assetsOf(s).length;

/** Where the library's own assets come from. */
export const LIBRARY_SOURCE = 'ENGINE LIBRARY (OUR OWN WORK, MIT)';

/** The library's shelves: models by family, then surfaces, icons and sprites. */
export function libraryShelves(): Shelf[] {
  const source = LIBRARY_SOURCE;
  const models = Object.entries(MODEL_FAMILIES).map(([family, ids]) => ({ id: `library/${family}`, title: `LIBRARY · ${family}`, source, models: ids.map((id) => MODEL_LIBRARY.get(id)), catalog: MODEL_LIBRARY }));
  const sprites = TEXTURE_FAMILIES.sprites!.map((id) => TEXTURE_LIBRARY.get(id));
  const textures = [
    { id: 'textures/surfaces', title: 'TEXTURES · surfaces', source, textures: TEXTURE_FAMILIES.surfaces!.map((id) => TEXTURE_LIBRARY.get(id)) },
    { id: 'textures/icons', title: 'TEXTURES · icons', source, textures: sprites.filter((d) => d.tags.includes('icon')) },
    { id: 'textures/sprites', title: 'TEXTURES · sprites', source, textures: sprites.filter((d) => !d.tags.includes('icon')) },
  ];
  return [...models, ...textures].filter((s) => count(s) > 0);
}

/**
 * Every pack the index lists: a shelf of its models and one of its textures, in the index's
 * order. The packs load at once; one that fails to load (or no index) is left out with a warning
 * in the console, and the rest still make their shelves.
 */
export async function packShelves(): Promise<Shelf[]> {
  const index = await loadPackIndex().catch((e: unknown) => {
    console.warn(`[assets] no pack index, so no pack shelves: ${String(e)}`);
    return { packs: [] };
  });
  const loaded = await Promise.allSettled(
    index.packs.map(async (e) => {
      const textures = new TextureCatalog();
      return { e, models: await loadPack(`packs/${e.file}`, { textures }), textures };
    }),
  );
  const shelves: Shelf[] = [];
  loaded.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`[assets] pack ${index.packs[i]!.id} did not load and is left out: ${String(r.reason)}`);
      return;
    }
    const { e, models, textures } = r.value;
    const source = `${e.title} · ${e.author ?? 'unknown'} · ${e.licence}`;
    if (models.all().length) shelves.push({ id: e.id, title: `PACK · ${e.title}`, source, models: models.all(), catalog: models });
    if (textures.all().length) shelves.push({ id: `${e.id}/textures`, title: `PACK · ${e.title} · textures`, source, textures: textures.all() });
  });
  return shelves;
}

/** Who made a pack's asset, its licence and how faithfully it imported (its pack is on the shelf line); '' for the library's own. */
export function sourceOf(def: Asset): string {
  const src = def.source;
  if (!src) return '';
  const fid = src.fidelity?.iou !== undefined ? ` · FIDELITY ${src.fidelity.iou.toFixed(2)}` : '';
  return `${src.author ?? 'unknown author'} · ${src.licence}${fid} · ${src.file?.split('/').pop() ?? ''}`;
}

/** A model built and stood on its own origin: its footprint centred there, its base on y = 0. */
export interface StoodModel {
  readonly root: Group;
  readonly build: ModelBuild;
  /** A point inside the model its light shines from (null without a light): it moves and turns with the model. */
  readonly lamp: Object3D | null;
  dispose(): void;
}

export function standModel(def: ModelDef, catalog?: ModelCatalog): StoodModel {
  const b = buildModel(def, { catalog });
  const root = new Group();
  b.object.position.set(-(b.bounds.min[0] + b.bounds.max[0]) / 2, -b.bounds.min[1], -(b.bounds.min[2] + b.bounds.max[2]) / 2);
  root.add(b.object);
  let lamp: Object3D | null = null;
  if (b.light) {
    lamp = new Object3D();
    lamp.position.set(...b.light.at);
    b.object.add(lamp);
  }
  return {
    root,
    build: b,
    lamp,
    dispose: () =>
      b.object.traverse((o) => {
        if (o instanceof Mesh && !o.geometry.userData.shared) o.geometry.dispose(); // cached geometry stays for its other builds
      }),
  };
}

/** The model's light from the pool, following its lamp, so a torch's glow stays on its flame (null without one). */
export function requestLight(ctx: GameContext, m: StoodModel): LightHandle | null {
  const l = m.build.light;
  return l && m.lamp ? ctx.lights.request({ follow: m.lamp, color: l.color, intensity: l.intensity, radius: l.radius, flicker: l.flicker ?? 'none' }) : null;
}

/**
 * A square floor of a tiling texture, `side` metres across, flat at y = 0 round its centre: at
 * the game's density (`DEFAULT_TEXEL`), or denser so it shows two tiles a side at least.
 */
export function tilePatch(def: TextureDef, side: number): { mesh: Mesh; dispose(): void } {
  const [tw, th] = def.size;
  const density = Math.max(DEFAULT_TEXEL, (2 * Math.max(tw, th)) / side);
  const geo = new PlaneGeometry(side, side).rotateX(-Math.PI / 2);
  const uv = geo.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * side * density) / tw, (uv.getY(k) * side * density) / th);
  const material = toonMaterial(0xffffff, { map: textureMap(def) });
  const mesh = new Mesh(geo, material);
  mesh.receiveShadow = true;
  return {
    mesh,
    dispose: () => {
      geo.dispose();
      if (!material.userData.shared) material.dispose(); // a cached material stays for its other users
    },
  };
}

/** How tall a standing sprite is drawn: its texels at the game's density, kept between 1.2 and 3 m. */
export const spriteHeight = (def: TextureDef) => Math.min(3, Math.max(1.2, def.size[1] / DEFAULT_TEXEL));

export const fmt = (v: number) => `${+v.toFixed(2)}`;

/** A built model measured: its size in metres, triangles and draw calls. */
export function modelLine(b: ModelBuild): string {
  const [w, h, d] = b.bounds.size;
  return `${fmt(w)} X ${fmt(h)} X ${fmt(d)} M · ${b.report.tris} TRIS · ${b.report.draws} DRAWS`;
}

/** A texture measured: its texels (and frames); a tile also says how big it is in the game. */
export function textureLine(def: TextureDef): string {
  const [tw, th] = def.size;
  const frames = def.frames ?? 1;
  const texels = `${tw / frames} X ${th} TEXELS${frames > 1 ? ` · ${frames} FRAMES` : ''}`;
  return def.tile ? `${texels} · ${fmt(tw / DEFAULT_TEXEL)} M A TILE IN THE GAME` : texels;
}

/** Text the 5×7 font can draw. */
export const clean = (s: string) => s.toUpperCase().replace(/×/g, 'X').replace(/[–—]/g, '-').replace(/'/g, '’').replace(/[^A-Z0-9 .,:\-+=/()[\]%_!?<>#"*@°·{};&|~^’]/g, '');

/** Words to lines of at most `width` characters, at most `max` of them (the last cut with "..."). */
export function wrap(text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${w}` : w.slice(0, width);
  }
  if (line) out.push(line);
  if (out.length > max) out.splice(max - 1, out.length, `${out[max - 1]!.slice(0, width - 3)}...`);
  return out;
}
