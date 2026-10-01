/**
 * The passive tree's public API (docs/GAME.md, "Passive tree"). Other systems import from
 * here, not from the files inside.
 */
export { DEFAULT_TREE_SEED, TREE_LAYOUT, generateTree, type TreeGenOptions, type TreeLayout } from './generate';
export {
  PassiveTree,
  TreeState,
  bonusPoints,
  defaultTree,
  nodeLines,
  nodeText,
  pointBudget,
  respecCost,
  searchTree,
  statGroup,
  summarizeMods,
  treeMods,
  type SummaryGroup,
  type TreeChange,
} from './tree';
export { VALIDATE_DEFAULTS, treeStats, validateTree, type TreeProblem, type TreeReport, type TreeStats, type ValidateOptions } from './validate';
export { CLUSTERS, NOTABLES } from './data/clusters';
export { KEYSTONES, KEYSTONE_FLAGS, TREE_CONDITIONS } from './data/keystones';
export { MASTERIES } from './data/masteries';
export { OVERRIDES } from './data/overrides';
export { REGIONS } from './data/regions';
export { SHAPES } from './data/shapes';
export { MOD_COSTS, PERCENT_FLAT, STAT_NAMES, describeTreeMod, modBudget, modsBudget, rollMod } from './data/stats';
export type { ClusterTemplate, KeystoneDef, MasteryDef, MasteryOption, ModRoll, NodeOverride, NotableDef, RegionDef, ShapeDef, ShapeSlot, TreeNode } from './types';
