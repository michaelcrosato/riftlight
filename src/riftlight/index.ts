/**
 * Riftlight, the showcase ARPG (docs/GAME.md). The game shell is `Riftlight` (a `Game`);
 * gameplay systems plug in through the ports in `game/ports.ts`, with stubs in
 * `game/stubs/` so the whole flow runs before they exist:
 *
 *   Engine.start(new Riftlight(), RIFTLIGHT_OPTIONS);                    // all stubs
 *   Engine.start(new Riftlight({ hero: realHero, levels: realLevels }));  // real systems
 */
import type { EngineOptions, TouchButton } from '../engine';

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

/** Riftlight's on-screen buttons for phones (attack, dodge, two skills, talk, menu). */
export const RIFTLIGHT_TOUCH_BUTTONS: readonly TouchButton[] = [
  { label: 'A', code: 'KeyJ', hint: 'attack' },
  { label: 'B', code: 'Space', hint: 'dodge' },
  { label: '1', code: 'Digit1', hint: 'skill' },
  { label: '2', code: 'Digit2', hint: 'skill' },
  { label: 'F', code: 'KeyF', hint: 'talk' },
  { label: '≡', code: 'Escape', hint: 'menu' },
];

/** Engine options the game is designed for: the iso preset at an ARPG angle and zoom. */
export const RIFTLIGHT_OPTIONS: Partial<EngineOptions> = {
  camera: { preset: 'iso', pitch: 42, yaw: 45, viewHeight: 15, stiffness: 7, minZoom: 0.5, maxZoom: 2.4 },
  touchButtons: RIFTLIGHT_TOUCH_BUTTONS,
};
