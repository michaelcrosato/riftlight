// Public engine API. Games import from here, not from internal modules.
export { Engine, optionsFromUrl, type EngineOptions, type Game, type GameContext } from './Engine';
export {
  CAMERA_PRESETS,
  CameraRig,
  FirstPersonRig,
  FreeRig,
  OrthoRig,
  ThirdPersonRig,
  createCameraRig,
  type CameraConfig,
  type CameraPreset,
} from './camera';
export { FILTERS, FILTER_IDS, FILTER_PRESETS, PALETTES, applyFilters, getFilter, type FilterDef } from './render/filters';
export { loadModel, type Model } from './assets';
export { Input } from './input';
export { DEFAULT_TOUCH_BUTTONS, TouchControls, type TouchButton } from './TouchControls';
export { PALETTE, type PaletteColor } from './palette';
export { RESOLUTIONS, computeFraming, type Framing, type Resolution } from './framing';
export { Physics, RAPIER, FIXED_DT, type BoxOptions } from './physics/Physics';
export { CharacterController, type CharacterOptions, type CharacterAnim } from './physics/CharacterController';
export {
  PlatformerCharacter,
  type JumpKind,
  type MoveInput,
  type MoveState,
  type PlatformerOptions,
} from './character/PlatformerCharacter';
export { KEYMAP, readMoveInput } from './character/controls';
export {
  PixelRenderer,
  DEFAULT_EDGES,
  type BackendName,
  type CapturedFrame,
  type EdgeSettings,
  type RenderMode,
} from './render/PixelRenderer';
export { ContactShadow } from './render/ContactShadow';
export { toonMaterial, toonify, toonGradient, TOON_BANDS } from './render/toon';
export {
  analyzeClip,
  compileClip,
  compileClips,
  gaitClip,
  mirror,
  placeFeet,
  renderSheet,
  sampleClip,
  validateClip,
  type ClipDef,
  type ClipReport,
  type FootGoal,
  type GaitSpec,
  type Key,
  type Pose,
  type RigSpec,
  type SheetImage,
} from './animation';
