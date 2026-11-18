/**
 * Riftlight, the showcase ARPG (docs/GAME.md). The game shell is `Riftlight` (a `Game`);
 * gameplay systems plug in through the ports in `game/ports.ts`, implemented on the real
 * systems in `wire/`. Pass a port to replace one:
 *
 *   Engine.start(new Riftlight(), RIFTLIGHT_OPTIONS);           // every port real
 *   Engine.start(new Riftlight({ hero: myHero }), RIFTLIGHT_OPTIONS); // one port replaced
 */
import type { EngineOptions } from '../engine';
import { RIFTLIGHT_TOUCH_BUTTONS } from './game/touch';
import { TOWN_LAYOUT } from './town/layout';

export { Riftlight, CAMERA, type Screen } from './game/Riftlight';
export * from './game/ports';
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
 * touch action cluster (`game/touch.ts`), no engine tool bar on phones (it shows with
 * `?debug=1`), and no ⚙ button: Riftlight's own Settings menu holds the engine's options.
 */
export const RIFTLIGHT_OPTIONS: Partial<EngineOptions> = {
  aspect: 'fill',
  // the angle the town is laid out for (it closes the ground this view can't see behind tall things)
  camera: { preset: 'iso', pitch: TOWN_LAYOUT.view.pitch, yaw: TOWN_LAYOUT.view.yaw, viewHeight: 15, stiffness: 7, minZoom: 0.5, maxZoom: 2.4 },
  touchButtons: RIFTLIGHT_TOUCH_BUTTONS,
  touchBar: false,
  settings: { button: false },
};
