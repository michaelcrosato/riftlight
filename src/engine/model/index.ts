/**
 * Models as data (docs/plans/asset-system.md): `ModelDef` (keyed primitives, groups, mirrors,
 * pivots, `use` of other models, params and seeds), `buildModel` (merged toon meshes per
 * material), `expandModel` (the plain-JSON form), checks, helpers and the built-in library.
 * No Rapier here: node tools load it; `addModelColliders` lives in ./physics.
 */
export * from './types';
export { model, around, rowOf, gridOf, scatterOf, boxFrame } from './helpers';
export { ModelCatalog } from './catalog';
export { MODEL_LIBRARY } from './library';
export { buildModel, expandModel, ModelError, layoutModel, collidersOf, bindingHex, modelDef, type ModelBuild, type ModelReport, type ModelLightRequest, type ColliderData, type Layout, type MeshLayout, type UvLayout } from './build';
export { type Binding, type ExpandedModel, type ModelOptions } from './expand';
export { compileParts, boundsOf, type Bounds, type Compiled, type CompiledPart, type CompiledPivot } from './compile';
export { validateModel, checkModel, triangleBudget, ALLOWED_LICENCES, MAX_MATERIALS, MIN_THICKNESS, TEXEL_RANGE, type ModelCheck, type ModelMetrics, type CheckOptions } from './validate';
export { DEFAULT_TEXEL, partUVs } from './uv';
export { primTriangles, primKind, ring, svgOutlines, parseMesh, defaultSeg, PRIM_KINDS, type PrimKind } from './prims';
