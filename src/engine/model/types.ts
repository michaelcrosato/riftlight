/**
 * The model format: a 3D object as plain data (docs/plans/asset-system.md §4). Parts are keyed,
 * never positional (`{ box: [w, h, d], at: [x, y, z], c: 'wood' }`), so a swapped vector can't
 * be written unnoticed. Units are metres and degrees; +Y is up, +Z is the front, the floor is
 * y = 0.
 *
 * Every primitive fills its box `[w, h, d]`, centred on `at`. Round kinds are an n-sided ring
 * that starts at +X, stretched per axis to the box (so `cyl` with `seg: n` is exactly a regular
 * n-gon prism, and an odd ring's axis shifts slightly to keep its bounds centred). Profile kinds
 * (`lathe`, `slab`, `tube`, `mesh`) use their own local coordinates, placed at `at`.
 *
 * Reading at 480×270 (Riftlight's camera, which `npm run model -- sheet` draws at game scale):
 * - Colour separates parts. Touching components take different colours or shades: planks and
 *   their frame, stones and the mortar behind them, a wheel and the bed it carries. Use as many
 *   colours as the parts need to read apart (up to 8); one colour over several large parts reads
 *   as a single block.
 * - Glow draws as flat colour with no shading: keep it for small hot spots (embers, a flame's
 *   heart). Build fire from lit parts (the `flame` model).
 * - Parts thinner than 0.06 m vanish; big masses carry the silhouette.
 * `npm run model -- check` warns when any of these slip.
 */
import type { PaletteColor } from '../palette';
import type { FlickerPreset } from '../render/lights';
import type { Rng } from '../random';

export type Vec3 = readonly [number, number, number];
/** A key of the def's palette. Parts never name PALETTE colours directly. */
export type Slot = string;

export interface PartBase {
  /** Centre of the part's box (profile kinds: their origin). Default [0, 0, 0]. */
  readonly at?: Vec3;
  /** Degrees, XYZ, about `at`. */
  readonly rot?: Vec3;
  /** Palette slot; default the def's first slot. */
  readonly c?: Slot;
  /** For `on`, pivots, labels on sheets, diffs and messages. */
  readonly name?: string;
  /** Sit on the named part's top: `at` becomes an offset from the centre of its top. */
  readonly on?: string;
  /** Unlit (flames, eyes, screens, crystals). */
  readonly glow?: boolean;
  /**
   * A TextureDef id (`TEXTURE_LIBRARY`, or the build's `textures`): the part shows the texture in
   * its own colours instead of the slot's, at the model's `texel` density (docs/ASSETS.md).
   */
  readonly tex?: string;
  /** Sides of round kinds; default by size (6 / 8 / 10). */
  readonly seg?: number;
}

/** `cyl` with `top`: the wider end fills the box; `top` is the top width ÷ the bottom width. */
export type Prim = PartBase &
  (
    | { readonly box: Vec3 }
    | { readonly cyl: Vec3; readonly top?: number }
    | { readonly cone: Vec3 }
    | { readonly ball: Vec3; readonly half?: boolean } // half: the upper dome, flat side down
    | { readonly lump: Vec3; readonly seed?: number }
    | { readonly wedge: Vec3 } // a ramp: full height at the back (−Z), down to the front edge
    | { readonly torus: Vec3 }
    | { readonly lathe: readonly (readonly [number, number])[] }
    | { readonly slab: readonly (readonly [number, number])[] | string; readonly depth: number }
    | { readonly tube: readonly Vec3[]; readonly r: number | readonly [number, number] }
    | { readonly mesh: MeshData }
  );

/** An imported mesh: vertices in millimetres ("x y z,x y z,…"), faces per slot ("a b c,…"). */
export interface MeshData {
  readonly v: string;
  readonly f: Readonly<Record<Slot, string>>;
}

/** A group's `c` is the default slot of the parts inside it. */
export type GroupPart = PartBase & {
  readonly group: readonly Part[];
  readonly scale?: number | Vec3;
  /** Keep this group movable at runtime: a named Object3D (merged per material inside). */
  readonly pivot?: boolean;
};

/** The parts plus their mirror image across x = 0 (or z = 0) of the current frame. */
export interface MirrorPart {
  readonly mirror: readonly Part[];
  readonly axis?: 'x' | 'z';
}

/** Another model placed by id. `palette` maps its slots to this def's slots. */
export type UsePart = PartBase & {
  readonly use: string;
  readonly params?: Readonly<Record<string, number>>;
  readonly palette?: Readonly<Record<Slot, Slot>>;
  readonly scale?: number;
  readonly seed?: number;
};

export type Part = Prim | GroupPart | MirrorPart | UsePart;

export interface ModelLight {
  readonly at: Vec3;
  /** A palette slot (a build's override takes `c` or a `color`). */
  readonly c: Slot;
  readonly intensity: number;
  readonly radius: number;
  readonly flicker?: FlickerPreset;
}

export interface Fidelity {
  readonly iou?: number;
  readonly iouClose?: number;
  readonly colour?: number;
  readonly bounds?: Vec3;
}

/** Where an imported or traced model came from (a check fails without it). */
export interface Provenance {
  readonly url: string;
  readonly licence: string;
  readonly pack?: string;
  readonly file?: string;
  readonly author?: string;
  readonly sha256?: string;
  readonly tool?: string;
  /** Source sRGB per slot, for re-mapping later. */
  readonly colours?: Readonly<Record<Slot, string>>;
  readonly fidelity?: Fidelity;
}

export type ParamSpec = readonly [def: number, min: number, max: number];
export type Anchor = Vec3 | { readonly at: Vec3; readonly rot: Vec3 };

export interface ModelDef {
  readonly id: string;
  /** One line, searched by `find`. */
  readonly about: string;
  readonly tags: readonly string[];
  readonly palette: Readonly<Record<Slot, PaletteColor>>;
  /** Declared bounds, checked (10% slack). */
  readonly size?: Vec3;
  readonly params?: Readonly<Record<string, ParamSpec>>;
  readonly parts: readonly Part[] | ((p: Readonly<Record<string, number>>, rng: Rng) => readonly Part[]);
  /** Oriented ones (`{ at, rot }`) for grips and mounts. */
  readonly anchors?: Readonly<Record<string, Anchor>>;
  readonly light?: ModelLight;
  /** Default 'box'. */
  readonly collider?: 'box' | 'cyl' | 'hull' | 'none';
  /** Texels per metre for `tex` parts, 2–64 (default `DEFAULT_TEXEL`, set by Gate B). */
  readonly texel?: number;
  /** Hangs, mounts on walls or hovers: may sit below or above the floor. */
  readonly floats?: boolean;
  readonly source?: Provenance;
}
