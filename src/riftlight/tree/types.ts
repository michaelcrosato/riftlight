/**
 * The passive tree's own data shapes. The contract with other systems is `PassiveNode`
 * (core/types.ts) plus the `Mod`s it carries; everything here is how the tree is *built*.
 *
 *   ClusterTemplate (hand-made theme)  ─┐
 *   ShapeDef (hand-made little graph)  ─┼─▶ generate.ts ─▶ TreeNode[] (PassiveNode + extras)
 *   NotableDef / KeystoneDef / Mastery ─┤
 *   RegionDef (theme weights, pool)    ─┘
 */
import type { Entry } from '../core/registry';
import type { Mod, ModKind } from '../core/mods';
import type { PassiveNode } from '../core/types';
import type { PaletteColor } from '../../engine/palette';

/** A small-node mod the generator may roll, valued by the budget (see data/stats.ts). */
export interface ModRoll {
  readonly stat: string;
  readonly kind: Exclude<ModKind, 'override' | 'flag'>;
  readonly weight: number;
  readonly tags?: readonly string[];
  readonly when?: string;
  /** Rolls a negative value ("reduced mana cost"): the budget still pays for |value|. */
  readonly negative?: boolean;
}

/** A hand-written notable: a named, flavoured bundle of mods (3–5 small nodes' worth). */
export interface NotableDef extends Entry {
  readonly name: string;
  readonly mods: readonly Mod[];
  readonly flavour: string;
  /** Hand-written tooltip lines, used instead of describing the mods. */
  readonly lines?: readonly string[];
}

/** A keystone: a build-defining trade-off, as mods plus flags combat reads. */
export interface KeystoneDef extends Entry {
  readonly name: string;
  readonly mods: readonly Mod[];
  /** Tooltip lines: keystone rules are read as sentences, not as stat sums. */
  readonly lines: readonly string[];
  readonly flavour: string;
  /** The region it sits at the edge of. */
  readonly region: string;
}

export interface MasteryOption {
  readonly id: string;
  readonly mods: readonly Mod[];
}

/** A mastery: allocate it, then pick one of its options. */
export interface MasteryDef extends Entry {
  readonly name: string;
  readonly options: readonly MasteryOption[];
}

/** One node of a hand-made cluster shape, in local units (+y points away from the tree's centre). */
export interface ShapeSlot {
  readonly key: string;
  readonly kind: 'small' | 'notable' | 'mastery';
  readonly x: number;
  readonly y: number;
}

export interface ShapeDef extends Entry {
  readonly slots: readonly ShapeSlot[];
  readonly links: readonly (readonly [string, string])[];
}

/** A hand-made building block: a theme, the shapes it can take, its small-node pool and its notables. */
export interface ClusterTemplate extends Entry {
  readonly name: string;
  /** Theme tags; regions weigh them to pick clusters (RegionDef.themes). */
  readonly tags: readonly string[];
  readonly shapes: readonly string[];
  readonly pool: readonly ModRoll[];
  readonly notables: readonly NotableDef[];
}

export interface RegionDef extends Entry {
  readonly name: string;
  /** Centre of the region's sector, degrees (0 = east, 90 = south: screen space). */
  readonly angle: number;
  readonly color: PaletteColor;
  /** Darker shade for unallocated links and backgrounds. */
  readonly dim: PaletteColor;
  /** Theme tag → weight. A cluster's score in this region is the sum over its tags. */
  readonly themes: Readonly<Record<string, number>>;
  /** Small-node pool for travel nodes, the start ring and highways. */
  readonly pool: readonly ModRoll[];
  readonly flavour: string;
}

/**
 * A hand-placed node or change, applied after generation: it wins over the generator.
 * An existing id is patched (position, name, mods...); a new id is added.
 */
export interface NodeOverride {
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly name?: string;
  readonly kind?: PassiveNode['kind'];
  readonly region?: string;
  readonly mods?: readonly Mod[];
  readonly flavour?: string;
  readonly lines?: readonly string[];
  /** Links to add (both ways). */
  readonly link?: readonly string[];
  /** Links to remove (both ways). */
  readonly unlink?: readonly string[];
}

/** A generated node: the contract's PassiveNode plus what the tree view and tools need. */
export interface TreeNode extends PassiveNode {
  /** The cluster instance this node belongs to ('might3.1'), or 'ring' / 'path' / 'keystone'. */
  readonly cluster: string;
  /** The template id for cluster nodes. */
  readonly template?: string;
  /** Hand-written tooltip lines (keystones, some notables). */
  readonly lines?: readonly string[];
  /** Mastery choices. */
  readonly options?: readonly MasteryOption[];
  /** Budget points the generator spent on a small node (validation compares). */
  readonly budget?: number;
}
