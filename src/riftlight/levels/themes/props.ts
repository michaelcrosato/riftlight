import { Color, Group, type Mesh, type Object3D } from 'three/webgpu';
import { buildModel, MODEL_LIBRARY, type ModelDef, type ModelLight } from '../../../engine/model';
import type { FlickerPreset } from '../../../engine/render/lights';
import { Registry, type Entry } from '../../core/registry';
import type { Rng } from '../../core/rng';
import { THEMES, type LevelTheme } from './themes';

export { glowMaterial } from '../../../engine/render/toon';

/**
 * Props: the engine library's models (src/engine/model/library, docs/ASSETS.md) dressed in the
 * theme. A prop names its model and `bind`s the theme to it: its slots take the theme's tints,
 * its light the theme's torch. `buildProp` builds it; the level merges its meshes by material
 * and requests its light from the pool. Add a prop by adding a `PropDef`; themes list prop ids.
 */
export interface PropContext {
  readonly theme: LevelTheme;
  readonly rng: Rng;
  /** Wear this one of the prop's models (0: its own, 1…: its variants) instead of picking (tests, inspectors). */
  readonly variant?: number;
}

export interface PropGlow {
  /** Offset from the prop's base. */
  readonly offset: readonly [number, number, number];
  readonly color: number;
  readonly intensity: number;
  readonly radius: number;
  readonly flicker: FlickerPreset;
}

export interface PropBuild {
  /** Static meshes in prop-local space (the base at the origin, 1 cell ≈ 1 m). */
  readonly parts: Object3D[];
  readonly glow?: PropGlow;
}

/** How a theme dresses a prop's model. */
export interface PropBinding {
  /** Slot → colour (the theme's tints); unbound slots keep the model's PALETTE colours. */
  readonly palette?: Readonly<Record<string, number>>;
  /** The model's light, re-coloured and re-sized (the theme's torch). */
  readonly light?: Partial<ModelLight> & { readonly color?: number };
  readonly params?: Readonly<Record<string, number>>;
  /** Where the model's origin sits in the prop's cell (a wall torch backs onto the cell's −z edge). */
  readonly at?: readonly [number, number, number];
  /** Draw the model this much smaller (or larger), when its params can't fit it in its cell (the pine). */
  readonly scale?: number;
}

/**
 * Another model a prop may wear in some themes: an imported pack's (docs/ASSETS.md, *Importing*;
 * `loadRiftlightPacks` puts them in the library), picked per prop from the prop's own seed. Only
 * the look changes: the plan (which cells hold which prop, what blocks) is the prop's, so a level's
 * cells, collisions, routes and the bypass guarantee stay the same with or without it.
 */
export interface PropVariant {
  /** A `MODEL_LIBRARY` id (a pack's, written out in full: the single-file build embeds what the code names). */
  readonly model: string;
  /** Odds against the prop's own model, which weighs 1. */
  readonly weight: number;
  /** The themes it dresses (designed ids; their rift shifts too); the others keep the prop's own model. */
  readonly themes: readonly string[];
  /** The theme's colours for it, its size (a blocking prop keeps to its cell: props.test.ts). */
  bind?(theme: LevelTheme): PropBinding;
}

export interface PropDef extends Entry {
  /** Occupies its cell (actors can't walk through; the layout marks it solid). */
  readonly blocks: boolean;
  /** Prefers cells next to walls (banners, crates). */
  readonly nearWall?: boolean;
  /** The model it builds (a `MODEL_LIBRARY` id). */
  readonly model: string;
  /**
   * Its flame faces the iso camera (docs/ASSETS.md), so turning the prop would turn it dark:
   * 'fixed' keeps the model unturned (round props), a param name (the wall torch's `turn`)
   * takes the prop's turn in degrees and the model turns its flame back.
   */
  readonly flame?: 'fixed' | string;
  /** The theme's colours and light for the model. */
  bind?(theme: LevelTheme): PropBinding;
  /** Pack models it may wear instead in some themes (no `flame` props: their fire faces the camera). */
  readonly variants?: readonly PropVariant[];
}

/** Lighten (k > 0) or darken (k < 0) a colour. */
export function tint(hex: number, k: number): number {
  const c = new Color(hex);
  return k >= 0 ? c.lerp(new Color(0xffffff), k).getHex() : c.lerp(new Color(0x000000), -k).getHex();
}

/** A theme's stone in two shades (light courses and dark), lit enough to read on its floor. */
const stone = (t: LevelTheme, k = 0.32) => ({ stone: tint(t.palette.wall, k), stone2: tint(t.palette.wall, k - 0.2) });
/** Kenney Mini Dungeon's stone (`c1` dark, `c4`/`c5` light) in a theme's stone. */
const dungeonStone = (t: LevelTheme, k = 0.32) => ({ c1: tint(t.palette.wall, k - 0.2), c4: tint(t.palette.wall, k), c5: tint(t.palette.wall, k + 0.08) });
/** Kenney Nature's stone (`stone`) and earth (`dirt`) under the theme's grass (`grass`). */
const natureStone = (t: LevelTheme, k = 0.28) => ({ stone: tint(t.palette.wall, k), dirt: tint(t.palette.wall, k - 0.06), grass: tint(t.palette.accent, -0.35) });
/** Kenney Nature's trees and bushes: leaves in the theme's accent, bark in its wall. */
const natureLeaves = (t: LevelTheme) => ({ grass: tint(t.palette.accent, -0.35), leafsDark: tint(t.palette.accent, -0.55), dirt: tint(t.palette.wall, 0.16) });
/** Themes that dress with the packs, by look. */
const DUNGEON = ['ember-forge', 'gloom-crypt', 'bloodmoon-cathedral', 'collapse-ruins'];
const WILD = ['gale-cliffs', 'thornweave-jungle', 'mire-swamp', 'stormspire-peaks', 'frostglass-caverns'];
/** A fire's light: the theme's torch, `bright` times as bright and reaching `reach` times as far. */
const fire = (t: LevelTheme, bright = 1, flicker?: FlickerPreset, reach = 1): Pick<PropBinding, 'light'> => ({
  light: { color: t.palette.light, intensity: t.torch.intensity * bright, radius: t.torch.radius * reach, flicker: flicker ?? t.torch.flicker },
});

// ------------------------------------------------------------------ the props

/**
 * A blocking prop fills one cell and actors collide with that cell only, so below head height
 * (1.8 m) nothing of it reaches more than 0.75 m from the cell's centre (props.test.ts checks
 * every theme's): a canopy may spread above that. `weight` keeps each theme's lighting as it
 * gains kinds: lanterns and glowcaps come up more often, candles (small lights) less.
 */
export const PROPS = new Registry<PropDef>('prop', [
  // the first thirteen, re-authored as models
  {
    id: 'pillar',
    tags: ['stone', 'tall'],
    blocks: true,
    model: 'column',
    bind: (t) => ({ palette: stone(t), params: { height: Math.min(3, t.wallHeight + 0.2) } }),
    variants: [
      { model: 'kenney-mini-dungeon/column', weight: 1, themes: ['ember-forge', 'gloom-crypt', 'bloodmoon-cathedral'], bind: (t) => ({ palette: dungeonStone(t) }) },
      { model: 'kenney-nature/statue-column-damaged', weight: 1, themes: ['collapse-ruins', 'gale-cliffs', 'stormspire-peaks'], bind: (t) => ({ palette: { stone: tint(t.palette.wall, 0.34) } }) },
    ],
  },
  { id: 'brazier', tags: ['fire', 'light'], blocks: true, model: 'brazier', flame: 'fixed', bind: (t) => ({ palette: { iron: tint(t.palette.wall, 0.1), rim: t.trim }, ...fire(t, 1, 'brazier') }) },
  // a wall sconce: its model backs onto the wall, at the cell's −z edge (the plan turns the cell to face away from it)
  { id: 'torch', tags: ['fire', 'light', 'wall'], weight: 0, blocks: false, nearWall: true, model: 'wall-torch', flame: 'turn', bind: (t) => ({ at: [0, 0, -0.5], palette: { iron: tint(t.palette.wall, -0.2) }, ...fire(t, 0.85, t.torch.flicker === 'brazier' ? 'torch' : t.torch.flicker) }) },
  { id: 'lantern', tags: ['light'], weight: 1.5, blocks: false, model: 'lamp-post', bind: (t) => ({ palette: { iron: tint(t.palette.wall, 0.15), flame: tint(t.palette.light, 0.2) }, light: { color: t.palette.light, intensity: t.torch.intensity * 0.7, radius: t.torch.radius * 0.8, flicker: 'candle' } }) },
  { id: 'crystal', tags: ['glow', 'light', 'magic'], blocks: true, model: 'crystal', bind: (t) => ({ palette: { glow: t.palette.accent, facet: tint(t.palette.accent, -0.35), facet2: tint(t.palette.accent, -0.6), base: tint(t.palette.wall, 0.3) }, light: { color: t.palette.accent } }) },
  { id: 'bones', tags: ['small', 'undead'], blocks: false, model: 'bones' },
  { id: 'crate', tags: ['wood'], blocks: true, nearWall: true, model: 'crate' },
  {
    id: 'banner',
    tags: ['cloth'],
    blocks: false,
    nearWall: true,
    model: 'standard',
    bind: (t) => ({ palette: { cloth: t.palette.accent, trim: t.trim, pole: tint(t.palette.wall, 0.1), foot: tint(t.palette.wall, 0.25) } }),
    // a war pennant on its pole, in the theme's colours
    variants: [{ model: 'kenney-castle/flag-pennant', weight: 1, themes: ['ember-forge', 'gale-cliffs', 'stormspire-peaks', 'bloodmoon-cathedral'], bind: (t) => ({ palette: { c6: t.palette.accent, c5: tint(t.palette.accent, -0.45), c11: t.trim, c1: tint(t.palette.wall, 0.3), c2: tint(t.palette.wall, 0.1) } }) }],
  },
  {
    id: 'statue',
    tags: ['stone', 'tall'],
    blocks: true,
    model: 'statue',
    bind: (t) => ({ palette: { stone: tint(t.palette.wall, 0.4), dark: tint(t.palette.wall, 0.18), trim: t.trim } }),
    variants: [{ model: 'kenney-nature/statue-obelisk', weight: 0.6, themes: ['collapse-ruins', 'gloom-crypt', 'thornweave-jungle'], bind: (t) => ({ palette: { stone: tint(t.palette.wall, 0.38) } }) }],
  },
  // the pine's lowest tier spreads at waist height, so it's drawn small enough to keep to its cell (2.6 m tall)
  {
    id: 'tree',
    tags: ['nature', 'tall'],
    blocks: true,
    model: 'pine',
    bind: (t) => ({ palette: { bark: tint(t.palette.wall, 0.12), leaf: tint(t.palette.accent, -0.35), leaf2: tint(t.palette.accent, -0.12) }, params: { h: 3 }, scale: 0.82 }),
    variants: [
      { model: 'kenney-nature/tree-pine-small-c', weight: 1, themes: ['gale-cliffs', 'mire-swamp', 'thornweave-jungle'], bind: (t) => ({ palette: natureLeaves(t), scale: 0.9 }) },
      { model: 'kenney-nature/tree-simple-dark', weight: 1, themes: ['mire-swamp', 'thornweave-jungle'], bind: (t) => ({ palette: natureLeaves(t), scale: 0.8 }) },
    ],
  },
  {
    id: 'rubble',
    tags: ['stone', 'small'],
    blocks: false,
    model: 'rubble',
    bind: (t) => ({ palette: stone(t, 0.3) }),
    variants: [
      { model: 'kenney-mini-dungeon/stones', weight: 0.8, themes: DUNGEON, bind: (t) => ({ palette: { c1: tint(t.palette.wall, 0.28) }, scale: 0.42 }) },
      { model: 'kenney-nature/stone-small-flat-a', weight: 0.8, themes: WILD, bind: (t) => ({ palette: natureStone(t), scale: 0.6 }) },
    ],
  },
  {
    id: 'rock',
    tags: ['stone', 'nature'],
    blocks: true,
    model: 'rock',
    bind: (t) => ({ palette: { stone: tint(t.palette.wall, 0.25) }, params: { size: 0.95 } }),
    variants: [
      { model: 'kenney-nature/stone-tall-c', weight: 1, themes: ['gale-cliffs', 'stormspire-peaks', 'frostglass-caverns'], bind: (t) => ({ palette: natureStone(t), scale: 0.62 }) },
      { model: 'kenney-nature/stone-small-h', weight: 1, themes: ['gale-cliffs', 'stormspire-peaks', 'frostglass-caverns', 'mire-swamp'], bind: (t) => ({ palette: natureStone(t), scale: 0.72 }) },
      { model: 'kenney-nature/rock-tall-c', weight: 1, themes: ['thornweave-jungle', 'mire-swamp'], bind: (t) => ({ palette: natureStone(t), scale: 0.62 }) },
    ],
  },
  { id: 'mushroom', tags: ['nature', 'glow', 'light'], weight: 2.5, blocks: false, model: 'glowcaps', bind: (t) => ({ palette: { cap: t.palette.accent, gill: tint(t.palette.accent, -0.4) }, light: { color: t.palette.accent } }) },
  // and more, from the library
  {
    id: 'barrel',
    tags: ['wood'],
    blocks: true,
    nearWall: true,
    model: 'barrel',
    variants: [{ model: 'kenney-mini-dungeon/barrel', weight: 1.2, themes: ['ember-forge', 'collapse-ruins'], bind: () => ({ scale: 0.7 }) }],
  },
  {
    id: 'chest',
    tags: ['wood', 'loot'],
    blocks: true,
    nearWall: true,
    model: 'chest',
    variants: [{ model: 'kenney-mini-dungeon/chest', weight: 1, themes: ['ember-forge', 'gravewell-observatory'], bind: (t) => ({ palette: { c1: tint(t.palette.wall, 0.2), c2: tint(t.palette.wall, -0.1) }, scale: 0.7 }) }],
  },
  { id: 'cage', tags: ['iron', 'undead', 'tall'], blocks: true, model: 'cage', bind: (t) => ({ palette: { iron: tint(t.palette.wall, 0.3), bar: tint(t.palette.wall, -0.1) } }) },
  {
    id: 'sack',
    tags: ['cloth', 'small'],
    blocks: false,
    nearWall: true,
    model: 'sack',
    variants: [{ model: 'kenney-mini-dungeon/pot', weight: 0.8, themes: ['collapse-ruins'], bind: () => ({ scale: 0.5 }) }],
  },
  { id: 'anvil', tags: ['iron', 'fire'], blocks: true, model: 'anvil' },
  { id: 'gold-pile', tags: ['loot', 'small'], blocks: false, model: 'gold-pile' },
  {
    id: 'bush',
    tags: ['nature', 'small'],
    blocks: false,
    model: 'bush',
    bind: (t) => ({ palette: { leaf: tint(t.palette.accent, -0.4), leaf2: tint(t.palette.accent, -0.15) } }),
    variants: [
      { model: 'kenney-nature/plant-bush-large', weight: 1, themes: ['gale-cliffs', 'thornweave-jungle', 'mire-swamp'], bind: (t) => ({ palette: natureLeaves(t) }) },
      { model: 'kenney-nature/plant-bush-detailed', weight: 0.6, themes: ['thornweave-jungle'], bind: (t) => ({ palette: natureLeaves(t), scale: 0.7 }) },
    ],
  },
  {
    id: 'stump',
    tags: ['nature', 'wood'],
    blocks: true,
    model: 'stump',
    variants: [
      { model: 'kenney-nature/stump-old', weight: 1, themes: ['mire-swamp', 'stormspire-peaks'], bind: (t) => ({ palette: { dirt: tint(t.palette.wall, 0.3) }, scale: 0.85 }) },
      { model: 'kenney-nature/stump-round-detailed', weight: 1, themes: ['mire-swamp', 'stormspire-peaks'], bind: () => ({ scale: 0.85 }) },
    ],
  },
  {
    id: 'log',
    tags: ['nature', 'wood'],
    blocks: true,
    model: 'log',
    bind: () => ({ params: { length: 1 } }),
    variants: [{ model: 'kenney-nature/log', weight: 1, themes: ['mire-swamp', 'thornweave-jungle', 'collapse-ruins'], bind: () => ({ scale: 0.62 }) }],
  },
  {
    id: 'toadstools',
    tags: ['nature', 'small'],
    blocks: false,
    model: 'mushrooms',
    variants: [
      { model: 'kenney-nature/mushroom-red-group', weight: 1, themes: ['thornweave-jungle', 'mire-swamp'] },
      { model: 'kenney-nature/mushroom-tan-group', weight: 1, themes: ['thornweave-jungle', 'mire-swamp'] },
    ],
  },
  {
    id: 'flowers',
    tags: ['nature', 'small'],
    blocks: false,
    model: 'flowers',
    variants: [
      { model: 'kenney-nature/flower-red-a', weight: 0.5, themes: ['thornweave-jungle'] },
      { model: 'kenney-nature/flower-yellow-b', weight: 0.5, themes: ['thornweave-jungle'] },
      { model: 'kenney-nature/flower-purple-b', weight: 0.5, themes: ['thornweave-jungle'] },
    ],
  },
  { id: 'stone-ring', tags: ['stone', 'small'], blocks: false, model: 'stone-ring', bind: (t) => ({ palette: stone(t, 0.3), params: { r: 0.45, size: 0.26 } }) },
  // its arrow boards reach 0.82 m from the post: a size down, they keep to its cell
  {
    id: 'signpost',
    tags: ['wood', 'tall'],
    blocks: true,
    model: 'signpost',
    bind: () => ({ scale: 0.9 }),
    variants: [{ model: 'kenney-nature/sign', weight: 1, themes: ['gale-cliffs'], bind: (t) => ({ palette: { dirt: tint(t.palette.wall, 0.3) } }) }],
  },
  { id: 'bookshelf', tags: ['wood', 'tall'], blocks: true, nearWall: true, model: 'bookshelf' },
  { id: 'table', tags: ['wood'], blocks: true, model: 'table', bind: () => ({ params: { length: 1.1, width: 0.8 } }) },
  { id: 'bench', tags: ['wood'], blocks: false, nearWall: true, model: 'bench', bind: () => ({ params: { length: 0.9 } }) },
  { id: 'candles', tags: ['fire', 'light', 'small'], weight: 0.3, blocks: false, model: 'candles', flame: 'fixed', bind: (t) => fire(t, 0.4, 'candle', 0.85) },
]);

/**
 * A binding's palette cut to the slots `model` has: the pack helpers (`dungeonStone`, `natureLeaves`)
 * bind a pack's shared slot names, and a model has only some of them.
 */
export function fitSlots(model: string, b: PropBinding): PropBinding {
  if (!b.palette) return b;
  const slots = MODEL_LIBRARY.get(model).palette;
  return { ...b, palette: Object.fromEntries(Object.entries(b.palette).filter(([k]) => k in slots)) };
}

/** The models a prop wears in a theme: its own, then its variants for that theme (a rift's shift counts as its theme). */
export function propModels(def: PropDef, theme: LevelTheme): { model: string; weight: number; bind?: (theme: LevelTheme) => PropBinding }[] {
  const base = theme.id.split('~')[0]!;
  return [{ model: def.model, weight: 1, ...(def.bind ? { bind: def.bind } : {}) }, ...(def.variants ?? []).filter((v) => v.themes.includes(base))];
}

/** Build a prop at a world position (base on the floor), facing `rot` radians. */
export function buildProp(id: string, ctx: PropContext, x: number, z: number, rot = 0): PropBuild & { root: Group } {
  const def = PROPS.get(id);
  const seed = ctx.rng.int(1, 1_000_000);
  // its model, then (from its own stream, after its seed: a prop that keeps its model looks as it did) a variant
  const models = propModels(def, ctx.theme);
  const pick = ctx.variant !== undefined ? models[ctx.variant]! : models.length > 1 ? ctx.rng.weighted(models, (m) => m.weight) : models[0]!;
  // a pack that didn't load (`loadRiftlightPacks`): the prop wears its own
  const wear = MODEL_LIBRARY.has(pick.model) ? pick : models[0]!;
  const asked = wear.bind?.(ctx.theme) ?? {};
  const bind = wear === models[0] ? asked : fitSlots(wear.model, asked);
  const turn = Math.round((((((rot * 180) / Math.PI) % 360) + 540) % 360) - 180); // degrees, −180..180
  const yaw = def.flame === 'fixed' ? 0 : rot;
  const params = def.flame && def.flame !== 'fixed' ? { ...bind.params, [def.flame]: turn } : bind.params;
  const b = buildModel(bind.palette ? modelFor(ctx.theme, wear.model) : wear.model, { seed, ...(bind.palette ? { palette: bind.palette } : {}), ...(bind.light ? { light: bind.light } : {}), ...(params ? { params } : {}) });
  const [ax, ay, az] = bind.at ?? [0, 0, 0];
  const k = bind.scale ?? 1;
  b.object.position.set(ax, ay, az);
  b.object.scale.setScalar(k);
  const root = new Group();
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  root.add(b.object);
  root.updateMatrixWorld(true);
  const l = b.light;
  const glow = l ? { offset: [l.at[0] * k + ax, l.at[1] * k + ay, l.at[2] * k + az] as [number, number, number], color: l.color, intensity: l.intensity, radius: l.radius, flicker: l.flicker ?? 'none' } : undefined;
  return { parts: [b.object], ...(glow ? { glow } : {}), root };
}

/** A fire model's burning parts, by mesh name (`brazier:flame`, `brazier:heart:glow`): its `flame` part's slots. */
const FIRE_MESH = /:(flame|core|heart)(:glow)?$/;

/** The meshes of a prop's fire (flame, core and heart), to put it out and light it again (Embers' braziers). */
export function fireMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh && FIRE_MESH.test(o.name)) out.push(o as Mesh);
  });
  return out;
}

/**
 * The engine caches a model's build per palette. The designed themes are a fixed set, but a
 * rift shifts its theme's palette anew every level, so an endless run would pile builds up for
 * good: a shifted theme builds from its own copies of the model defs, and only the last few
 * shifted themes keep theirs (their cached builds go with them).
 */
const SHIFTED_KEPT = 2;
const shiftedDefs = new Map<string, Map<string, ModelDef>>();

function modelFor(theme: LevelTheme, id: string): string | ModelDef {
  if (THEMES.has(theme.id)) return id;
  let defs = shiftedDefs.get(theme.id);
  if (!defs) {
    shiftedDefs.set(theme.id, (defs = new Map()));
    for (const old of shiftedDefs.keys()) if (shiftedDefs.size > SHIFTED_KEPT) shiftedDefs.delete(old);
  }
  let def = defs.get(id);
  if (!def) defs.set(id, (def = { ...MODEL_LIBRARY.get(id) }));
  return def;
}
