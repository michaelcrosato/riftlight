/**
 * Riftlight, the showcase ARPG (docs/GAME.md). The game shell is `Riftlight` (a `Game`);
 * gameplay systems plug in through the ports in `game/ports.ts`, with stubs in
 * `game/stubs/` so the whole flow runs before they exist:
 *
 *   Engine.start(new Riftlight(), RIFTLIGHT_OPTIONS);                    // all stubs
 *   Engine.start(new Riftlight({ hero: realHero, levels: realLevels }));  // real systems
 */
import type { EngineOptions } from '../engine';
import { RIFTLIGHT_TOUCH_BUTTONS } from './game/touch';

export { Riftlight, CAMERA, type Screen } from './game/Riftlight';
export * from './game/ports';
export { stubPorts } from './game/stubs';
export { PlaytestBot, type BotReport, type BotView, type BotIntent } from './game/bot';
export { type RiftlightApi, type RiftlightState } from './game/api';
export { SaveStore, SAVE_VERSION, migrate, parseSave, exportSave, newSave } from './game/save';
export { DIFFICULTY_PRESETS, difficultyMods, NORMAL as DIFFICULTY_NORMAL } from './game/difficulty';
export { SONGS, SOUNDS } from './game/audio';
export { Town, TOWN_LAYOUT } from './town/Town';
export { NPCS } from './town/npcs';
export { NPC_CLIPS } from './town/npcClips';
export { RIFTLIGHT_TOUCH_BUTTONS, TOUCH_LAYOUT, TOUCH_CODES } from './game/touch';

/**
 * Engine options the game is designed for: the iso preset at an ARPG angle and zoom, the
 * touch action cluster (`game/touch.ts`), and no engine tool bar on phones (it shows with
 * `?debug=1`).
 */
export const RIFTLIGHT_OPTIONS: Partial<EngineOptions> = {
  aspect: 'fill',
  camera: { preset: 'iso', pitch: 42, yaw: 45, viewHeight: 15, stiffness: 7, minZoom: 0.5, maxZoom: 2.4 },
  touchButtons: RIFTLIGHT_TOUCH_BUTTONS,
  touchBar: false,
};
