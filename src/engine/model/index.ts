/**
 * Models as data (docs/ASSETS.md): `ModelDef` (keyed primitives, groups, mirrors,
 * pivots, `use` of other models, params and seeds), `buildModel` (merged toon meshes per
 * material), `expandModel` (the plain-JSON form), checks, helpers and the built-in library.
 * Imports (glTF/GLB → `mesh` parts, palette mapping, fidelity) are in ./import, for tools; packs
 * of imported models load with `loadPack` (../assets). No Rapier here: node tools load it;
 * `addModelColliders` lives in ./physics.
 */
export * from './types';
export { model, around, rowOf, gridOf, scatterOf, boxFrame } from './helpers';
export { ModelCatalog } from './catalog';
export { MODEL_FAMILIES, MODEL_LIBRARY } from './library';
export { buildModel, expandModel, ModelError, layoutModel, collidersOf, bindingHex, modelDef, type ModelBuild, type ModelReport, type ModelLightRequest, type ColliderData, type Layout, type MeshLayout, type UvLayout } from './build';
export { type Binding, type ExpandedModel, type ModelOptions } from './expand';
export { compileParts, boundsOf, type Bounds, type Compiled, type CompiledPart, type CompiledPivot } from './compile';
export { validateModel, checkModel, triangleBudget, MAX_MATERIALS, MIN_THICKNESS, TEXEL_RANGE, type ModelCheck, type ModelMetrics, type CheckOptions } from './validate';
export { DEFAULT_TEXEL, MOVING_TEXEL, partUVs } from './uv';
export { primTriangles, primKind, ring, svgOutlines, parseMesh, defaultSeg, PRIM_KINDS, type PrimKind } from './prims';
export { scoreFidelity, modelTriangles, renderFidelity, FIDELITY_YAWS, CLOSE_PX, type ColouredTris, type FidelityScore, type FidelityView, type FidelitySheetOptions } from './fidelity';
export { ALLOWED_LICENCES, APPROVAL, LICENCES, OWN_LICENCE, PACK_ID, isLicenceFile, licenceFileProblem, licenceProblem, packSourceProblems, type LicenceTerms } from './packs/licences';
export { PACK_SOURCES, type PackSource } from './packs/sources';
export { parsePack, parsePackIndex, packCatalog, packIndexEntry, packProblems, packTextures, type ModelPack, type PackIndex, type PackIndexEntry } from './packs/pack';
