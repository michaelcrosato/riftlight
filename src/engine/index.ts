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
export { FILTERS, FILTER_IDS, FILTER_PRESETS, PALETTES, applyFilters, getFilter, splitFilters, type FilterContext, type FilterDef, type FilterSpace } from './render/filters';
export { loadModel, type Model } from './assets';
export { GAMEPAD_BUTTONS, Input, PRESS_WINDOW, applyDeadzone, type GamepadLike } from './input';
export { DEFAULT_DEBUG_KEYS, resolveDebugKeys, type DebugAction, type DebugKeyMap, type DebugKeysOption } from './debugKeys';
export { clearScene, countObjects, disposeObject } from './lifecycle';
export {
  AudioManager,
  PLAYGROUND_SONG,
  SFX,
  noteFrequency,
  parseSong,
  renderSound,
  type AudioSettings,
  type Instrument,
  type PlayOptions,
  type SfxName,
  type Song,
  type SoundDef,
  type VolumeChannel,
  type Wave,
} from './audio';
export { PARTICLES, ParticlePool, Particles, type BurstOptions, type ParticlePreset, type ParticlePresetName } from './particles';
export { Hud, hudPlace, type HudAnchor, type HudColor, type HudOptions } from './hud/Hud';
export { DEFAULT_TOUCH_BUTTONS, TouchControls, type TouchButton } from './TouchControls';
export { PALETTE, type PaletteColor } from './palette';
export { ADAPTIVE_ASPECT, RESOLUTIONS, computeFraming, type AspectMode, type Framing, type Resolution } from './framing';
export { QUALITY, QUALITY_LEVELS, FrameLimiter, type QualityLevel, type QualityOption, type QualitySettings } from './quality';
export { assetProgress, preloadModels } from './assets';
export { LoadingScreen } from './LoadingScreen';
export { mergeStaticMeshes, type MergeOptions } from './render/merge';
export { Physics, RAPIER, FIXED_DT, Trigger, type BoxOptions, type TriggerOptions, type TriggerShape } from './physics/Physics';
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
export { pixelTexture, toonMaterial, toonify, toonGradient, TOON_BANDS, type ToonMaterialOptions } from './render/toon';
export {
  analyzeClip,
  compileClip,
  compileClips,
  gaitClip,
  mirror,
  placeFeet,
  renderCurves,
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
