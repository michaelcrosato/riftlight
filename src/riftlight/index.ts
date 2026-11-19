/**
 * Riftlight, the showcase ARPG (docs/GAME.md). The game shell is `Riftlight` (a `Game`);
 * gameplay systems plug in through the ports in `game/ports.ts`, implemented on the real
 * systems in `wire/`. Pass a port to replace one:
 *
 *   Engine.start(new Riftlight(), RIFTLIGHT_OPTIONS);           // every port real
 *   Engine.start(new Riftlight({ hero: myHero }), RIFTLIGHT_OPTIONS); // one port replaced
 */
import { type EngineOptions, hubSettingsSource } from '../engine';
import { RIFTLIGHT_HUB_TOUCH_BUTTONS, RIFTLIGHT_TOUCH_BUTTONS } from './game/touch';
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
export { HUB_WAKE, RIFTLIGHT_HUB_TOUCH_BUTTONS, RIFTLIGHT_TOUCH_BUTTONS, riftlightTouchButtons, TOUCH_LAYOUT, TOUCH_CODES } from './game/touch';

/**
 * Engine options the game is designed for: the iso preset at an ARPG angle and zoom, the
 * touch action cluster (`game/touch.ts`; in 52in1, its page's `window.AIHubSettings` set by the
 * hub's first script, ≡ below the hub's wake band) with a floating joystick (its base comes under the
 * thumb anywhere in the lower left), a phone's art at about two CSS pixels per art pixel
 * (`touchDensity`: the HUD and the panels lay out in a landscape phone's 195 rows, with targets a
 * thumb tall), no engine tool bar on phones (it shows with `?debug=1`), no ⚙ button: Riftlight's
 * own Settings menu holds the engine's options, motion aim (a DualSense's turns through 52in1
 * turn the pad's aim: its rows are in that menu) and the voice (a shout into 52in1's microphone uses
 * War Cry: `KEYS.shout`; its Voice row is in that menu too, the engine panel's Microphone row).
 */
export const RIFTLIGHT_OPTIONS: Partial<EngineOptions> = {
  aspect: 'fill',
  // the angle the town is laid out for (it closes the ground this view can't see behind tall things)
  camera: { preset: 'iso', pitch: TOWN_LAYOUT.view.pitch, yaw: TOWN_LAYOUT.view.yaw, viewHeight: 15, stiffness: 7, minZoom: 0.5, maxZoom: 2.4 },
  touchButtons: hubSettingsSource() ? RIFTLIGHT_HUB_TOUCH_BUTTONS : RIFTLIGHT_TOUCH_BUTTONS,
  touchDensity: 2,
  touchStick: 'floating',
  touchBar: false,
  settings: { button: false, motion: true, voice: true },
};
