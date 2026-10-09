// Public engine API. Games import from here, not from internal modules.
export { Engine, optionsFromUrl, withUrlOptions, type EngineOptions, type Game, type GameContext } from './Engine';
export { ENGINE_VERSION } from './version';
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
export {
  AMOUNT,
  FILTERS,
  FILTER_IDS,
  FILTER_PRESETS,
  PALETTES,
  applyFilter,
  applyFilters,
  clampParam,
  defaultParams,
  filterParams,
  filterPresets,
  getFilter,
  splitFilters,
  type FilterContext,
  type FilterDef,
  type FilterGroup,
  type FilterParam,
  type FilterSpace,
} from './render/filters';
export {
  DEFAULT_PIXEL,
  LOOK_ALIASES,
  LOOK_PRESETS,
  LOOK_TARGETS,
  LOOK_TARGET_LABELS,
  PIXEL_PARAMS,
  PIXEL_PRESETS,
  cloneLook,
  defaultLook,
  filterOrder,
  filterPresetOf,
  lookFilters,
  lookFromFilters,
  lookLayerOf,
  lookPresetLabel,
  lookPresetName,
  lookPresetOf,
  looksEqual,
  normalizeLook,
  paramsOf,
  planLook,
  scenePixel,
  setLookLayer,
  type LayerLook,
  type Look,
  type LookFilter,
  type LookLayer,
  type LookPlan,
  type LookTarget,
  type PixelLook,
} from './render/look';
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
export { DEFAULT_TOUCH_BUTTONS, TouchControls, type TouchButton, type TouchButtonState, type TouchCorner } from './TouchControls';
export { PALETTE, type PaletteColor } from './palette';
export { ADAPTIVE_ASPECT, RESOLUTIONS, computeFraming, type AspectMode, type Framing, type Resolution } from './framing';
export { QUALITY, QUALITY_LEVELS, FrameLimiter, type QualityLevel, type QualityOption, type QualitySettings } from './quality';
export { assetProgress, preloadModels } from './assets';
export { LoadingScreen } from './LoadingScreen';
export { mergeStaticMeshes, type MergeOptions } from './render/merge';
export { Physics, RAPIER, FIXED_DT, Trigger, type BoxOptions, type TriggerOptions, type TriggerShape } from './physics/Physics';
export { CharacterController, type CharacterOptions, type CharacterAnim } from './physics/CharacterController';
export { Movers, moverRotation, orbit, pathPoint, pendulum, type KinematicBody, type Mover, type MoverOptions } from './physics/movers';
export { ForceFields, explode, fieldAcceleration, type ExplosionOptions, type Field, type FieldOptions } from './physics/forces';
export { fractureBox, seeded, type Chunk, type FractureOptions } from './physics/fracture';
export { VerletBody, clothGrid, ropeLine, softBlob, type ClothOptions, type VerletOptions } from './physics/verlet';
export { chain, hingeDoor, ropeBridge, seesaw, springPad, type BridgeOptions, type Built, type ChainOptions, type DoorOptions, type SeesawOptions, type SpringPadOptions } from './physics/joints';
export { InstancedBodies, type InstancedBodiesOptions, type InstancedShape } from './physics/InstancedBodies';
export { Breakables, type Breakable, type BreakableOptions, type Crumble, type CrumbleOptions } from './physics/breakable';
export { RopeMesh, SoftMesh } from './render/softMesh';
export { beltMaterial, type BeltMaterial } from './render/belt';
export { RippleField, WAVES_CALM, WAVES_CHOPPY, waterHeight, type RippleOptions, type Wave as WaterWave } from './physics/water';
export { Floaters, type FloaterOptions } from './physics/buoyancy';
export { Ragdoll, type RagdollOptions, type RagdollPart } from './physics/ragdoll';
export { NavGrid, type NavGridOptions } from './ai/navgrid';
export { Boids, type BoidOptions } from './ai/boids';
export { MAX_WAVES, WaterSurface, type WaterOptions } from './render/water';
export { Precipitation, type PrecipitationKind, type PrecipitationOptions } from './render/precipitation';
export { applySky, groundFog, skyAt, type SkyState } from './render/sky';
export { GrassField, MAX_PUSHERS, type GrassOptions } from './render/grass';
export { WindUniforms, swayMaterial, swayObject, type SwayOptions } from './render/sway';
export { Trail, type TrailOptions } from './render/trail';
export { DECAL_SHAPES, Decals, type DecalOptions, type DecalShape } from './render/decals';
export { drawSheet, SpriteBatch, type SpriteOptions, type SpriteSheet } from './render/sprites';
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
export {
  ScreenFx,
  TRANSITIONS,
  TRANSITION_CELLS,
  coversPixel,
  type FlashOptions,
  type ScreenFxState,
  type ShockwaveOptions,
  type TransitionKind,
  type TransitionOptions,
} from './render/screenFx';
export { CameraShake } from './shake';
export { EASES, EASE_NAMES, Tweens, ease, type Ease, type EaseName, type Tween, type TweenOptions } from './tween';
export {
  FLICKER_PRESETS,
  LIGHT_POOL_SIZES,
  LightAssigner,
  LightPool,
  flicker,
  type AssignItem,
  type FlickerPreset,
  type LightHandle,
  type LightPoolOptions,
  type LightPoolStats,
  type LightRequestOptions,
} from './render/lights';
export { pixelTexture, toonMaterial, toonify, toonGradient, TOON_BANDS, type ToonMaterialOptions } from './render/toon';
export {
  analyzeClip,
  compileClip,
  compileClips,
  gaitClip,
  gaitPartners,
  LegStepper,
  mirror,
  placeFeet,
  renderCurves,
  renderSheet,
  sampleClip,
  SpringChain,
  Squash,
  twoBoneIK,
  validateClip,
  type ClipDef,
  type ClipReport,
  type Foot,
  type FootGoal,
  type GaitSpec,
  type Key,
  type LegDef,
  type LegStepperOptions,
  type Pose,
  type RigSpec,
  type SheetImage,
  type SpringChainOptions,
} from './animation';
