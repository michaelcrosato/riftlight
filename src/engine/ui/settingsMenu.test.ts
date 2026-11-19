// The engine's settings screen as data (SettingsMenu: what SettingsPanel draws), headless on a real
// engine: the pad and the keys drive it through the engine's input (MenuInput, FocusList), every row
// changes the engine, the 52in1 gates decide the Microphone and Motion rows (and Motion aim's rows
// drive input.motion), and its words and legend follow the game's language and the device in use.
import { Vector3 } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine, type Game } from '../Engine';
import type { GamepadLike } from '../input';
import type { HubSettingsSource } from '../hub/settings';
import { SettingsMenu } from './settingsMenu';

class Still implements Game {
  readonly name = 'Still';
  setup(): void {}
  cameraTarget() {
    return new Vector3();
  }
}

/** A standard pad holding `pressed` (button indices) and its sticks at `axes`. */
const pad = (pressed: number[] = [], axes = [0, 0, 0, 0]): GamepadLike => ({ connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i) })) });

let engine: Engine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

async function open(o: { hub?: HubSettingsSource; voice?: boolean; motion?: boolean } = {}) {
  engine = await Engine.headless(new Still(), { hubSettings: o.hub ?? null, settings: { motion: o.motion } });
  const e = engine;
  const menu = new SettingsMenu(e, { voice: o.voice, motion: o.motion });
  let t = 0;
  /** One frame with the pad as given (then let go), as the engine runs the panel while paused. */
  const frame = (pressed: number[] = [], axes?: number[], dt = 1 / 60) => {
    e.input.beginFrame(t, dt, [pad(pressed, axes)]);
    t += dt;
    const r = menu.update(e.input, dt);
    e.input.endFrame();
    return r;
  };
  /** A button pressed and let go. */
  const press = (button: number) => {
    const r = frame([button]);
    frame();
    return r;
  };
  const value = (id: string) => menu.rows().find((r) => r.id === id)!;
  return { e, menu, frame, press, value };
}

describe('the settings screen', () => {
  it('has a page each for the picture, the sound and the controls; a game adds its Microphone and Motion rows', async () => {
    const { menu } = await open();
    const ids = () => menu.rows().map((r) => r.id);
    expect(menu.pages).toEqual(['picture', 'sound', 'controls']);
    expect(ids()).toEqual(['look', 'pixelArt', 'pixelSize', 'quality', 'fps', 'debugInfo']);
    menu.turnPage(1);
    expect(ids()).toEqual(['sound', 'master', 'music', 'sfx']);
    menu.turnPage(1);
    expect(ids()).toEqual(['padGlyphs', 'vibration']);
    menu.turnPage(1);
    expect(menu.page).toBe('picture'); // round
    engine!.dispose();
    const more = (await open({ voice: true, motion: true })).menu;
    more.showPage('sound');
    expect(more.rows().map((r) => r.id)).toEqual(['sound', 'master', 'music', 'sfx', 'voice']);
    more.showPage('controls');
    expect(more.rows().map((r) => r.id)).toEqual(['padGlyphs', 'vibration', 'motion', 'motionSensitivity']);
  });

  it('on a pad: the d-pad moves the focus, left and right change a value, Cross changes it too, L1 / R1 turn the page, Circle closes', async () => {
    const { e, menu, frame, press, value } = await open();
    expect([menu.list.index, value('quality').value]).toEqual([0, 'Auto']);
    press(13); // d-pad down
    press(13);
    press(13);
    expect(menu.rows()[menu.list.index]!.id).toBe('quality');
    press(14); // left: a choice goes round
    expect([value('quality').value, e.quality, e.settings.values.quality]).toEqual(['High', 'high', 'high']);
    press(15); // right
    expect(value('quality').value).toBe('Auto');
    press(0); // Cross: the next value
    expect([value('quality').value, e.settings.values.quality]).toEqual(['Low', 'low']);
    press(12); // up to the pixel size, Cross
    press(0);
    expect([e.settings.values.pixelSize, e.renderer.baseResolution.height]).toEqual(['chunky', 180]);
    press(5); // R1
    expect([menu.page, menu.list.index]).toEqual(['sound', 0]);
    press(4); // L1
    expect(menu.page).toBe('picture');
    expect(press(1).close).toBe(true); // Circle
    expect([frame([9]).close, frame().close]).toEqual([false, true]); // Options: as it is let go (Create + Options is 52in1's bar)
  });

  it('a held d-pad or stick repeats; a number stops at its ends (Cross on its last goes round)', async () => {
    const { e, menu, frame, press, value } = await open();
    menu.showPage('sound');
    press(13); // Volume
    expect([menu.rows()[menu.list.index]!.id, value('master').value]).toEqual(['master', '80%']);
    for (let i = 0; i < 60; i++) frame([], [0.9, 0, 0, 0]); // the left stick held right: a second of repeats
    expect([value('master').value, e.audio.volume.master, value('master').right]).toEqual(['100%', 1, false]);
    press(0); // Cross on 100%: round to 0%
    expect(e.audio.volume.master).toBe(0);
    press(14); // left at 0% stays
    expect(e.audio.volume.master).toBe(0);
    for (let i = 0; i < 40; i++) frame([13]); // the d-pad held down: repeats, and the list goes round
    expect(menu.list.index).toBeGreaterThanOrEqual(0);
    frame();
  });

  it('every row changes the engine: look, pixel art (no look without it), frame rate, debug info, sound, volumes, button prompts, vibration; Triangle resets them all', async () => {
    const { e, menu } = await open();
    const at = (id: string) => menu.rows().findIndex((r) => r.id === id);
    menu.step(at('look'), 1);
    expect(e.settings.values.look).toBe('none');
    menu.step(at('pixelArt'), -1);
    expect([e.renderer.mode, menu.rows()[at('look')]!.enabled, menu.rows()[at('look')]!.note]).toEqual(['raw', false, 'Looks need pixel art.']);
    expect(menu.step(at('look'), 1)).toBe(false); // smooth 3D draws no look: Look is off
    menu.step(at('fps'), 1);
    expect([e.maxFps, e.settings.values.fps]).toEqual([30, 30]);
    menu.step(at('debugInfo'), 1);
    expect(e.settings.values.debugInfo).toBe(true); // (headless there is no debug panel to show)
    menu.showPage('sound');
    menu.activate(0);
    expect(e.audio.muted).toBe(true);
    menu.step(2, -1);
    menu.step(3, -1);
    expect([e.audio.volume.music, e.audio.volume.sfx]).toEqual([0.5, 0.9]);
    menu.showPage('controls');
    const rumble = vi.spyOn(e.input, 'rumble');
    menu.step(0, 1);
    menu.step(1, -1);
    expect([e.settings.values.padGlyphs, e.settings.values.vibration, e.input.vibration]).toEqual(['xbox', 0.9, 0.9]);
    expect(rumble).toHaveBeenCalledTimes(1); // feel the new strength (on a pad)
    menu.resetAll();
    expect([e.settings.values, e.renderer.mode, e.maxFps, e.audio.muted, e.audio.volume.master]).toEqual([{}, 'pixel', 60, false, 0.8]);
  });

  it('a stick still held from a run when the screen opens steps nothing until it goes back to rest', async () => {
    const { e, menu, frame, value } = await open();
    for (let i = 0; i < 10; i++) frame([], [1, 0, 0, 0]); // running right
    e.input.release(); // what opening the panel does
    menu.reset();
    const look = value('look').value;
    for (let i = 0; i < 60; i++) expect(frame([], [0.9, 0, 0, 0]).changed).toBe(false); // a second, the thumb still on it
    expect([menu.list.index, value('look').value, e.settings.values]).toEqual([0, look, {}]);
    frame(); // back to rest: it is the menu's now
    for (let i = 0; i < 28; i++) frame([], [0.9, 0, 0, 0]); // held right past the repeat delay: one step
    expect(e.settings.values.look).toBe('none');
    for (let i = 0; i < 30; i++) frame([], [0, -0.9, 0, 0]); // down, held: the focus moves
    expect(menu.list.index).toBeGreaterThan(0);
  });

  it('Triangle pressed twice resets (the legend says Press again in between); Options closes; the screen opens on its first page and row', async () => {
    const { e, menu, frame, press } = await open();
    const resetWords = () => menu.legend().find((l) => l.action === 'reset')!.label;
    menu.showPage('controls');
    menu.step(0, 1);
    expect(e.settings.values.padGlyphs).toBe('xbox');
    expect([press(3).changed, e.settings.values.padGlyphs, menu.resetPending, resetWords()]).toEqual([true, 'xbox', true, 'Press again to reset']); // Triangle: armed
    expect(press(3).changed).toBe(true); // and again
    expect([e.settings.values, menu.resetPending, resetWords()]).toEqual([{}, false, 'Reset']);
    menu.step(0, 1);
    press(3);
    let gone = false;
    for (let i = 0; i < 130; i++) gone = frame().changed || gone; // over two seconds: it lets go, and the legend says so
    expect([gone, menu.resetPending, resetWords()]).toEqual([true, false, 'Reset']);
    press(3);
    expect(e.settings.values.padGlyphs).toBe('xbox'); // that press armed it again, no more
    press(13); // anything else lets it go
    press(3);
    expect([e.settings.values.padGlyphs, menu.resetPending]).toEqual(['xbox', true]);
    expect(menu.requestReset()).toBe(true); // the legend's Reset, the second press
    expect(e.settings.values).toEqual({});
    menu.list.index = 1;
    menu.reset();
    expect([menu.page, menu.list.index]).toEqual(['picture', 0]);
  });

  it('the Microphone can be switched on only while 52in1 allows games the microphone, and says where it is allowed', async () => {
    const hub = Object.assign(new EventTarget(), { mic: false, micLater: false });
    const { e, menu } = await open({ hub, voice: true });
    menu.showPage('sound');
    const voice = () => menu.rows().find((r) => r.id === 'voice')!;
    expect([voice().value, voice().enabled, voice().note, e.voiceOn]).toEqual(['Off', false, '52in1 allows the microphone in its Settings, under Sound.', false]);
    expect(menu.activate(4)).toBe(false);
    hub.micLater = true;
    hub.dispatchEvent(new Event('change'));
    expect(voice().note).toBe('Open the game again to use the microphone.');
    hub.mic = true;
    hub.micLater = false;
    hub.dispatchEvent(new Event('change'));
    expect([voice().value, voice().enabled, voice().note, e.voiceOn]).toEqual(['On', true, '', true]); // on once allowed
    menu.activate(4);
    expect([voice().value, e.settings.values.voice, e.voiceOn]).toEqual(['Off', false, false]);
    engine!.dispose();
    const alone = await open({ voice: true }); // outside 52in1
    alone.menu.showPage('sound');
    expect(alone.menu.rows().find((r) => r.id === 'voice')!.note).toBe('The microphone needs 52in1.');
  });

  it("motion aim is there only with a DualSense's motion through 52in1, on when 52in1's own Motion aim is, with its sensitivity; the rows drive input.motion", async () => {
    const dualsense = { connected: true, motion: false, aim: true };
    const hub = Object.assign(new EventTarget(), { dualsense });
    const { e, menu } = await open({ hub, motion: true });
    menu.showPage('controls');
    const row = (id: string) => menu.rows().find((r) => r.id === id)!;
    expect([row('motion').enabled, row('motion').note, row('motionSensitivity').enabled, e.motionOn, e.input.motion.on]).toEqual([false, 'Motion aim needs a DualSense in 52in1.', false, false, false]);
    dualsense.motion = true;
    hub.dispatchEvent(new Event('change'));
    expect([row('motion').value, row('motionSensitivity').value, row('motionSensitivity').enabled, e.motionOn, e.input.motion]).toEqual(['On', '100%', true, true, { on: true, sensitivity: 1, lean: true }]);
    menu.step(3, 1);
    expect([row('motionSensitivity').value, e.settings.values.motionSensitivity, e.input.motion.sensitivity]).toEqual(['125%', 1.25, 1.25]);
    menu.activate(2);
    expect([row('motion').value, e.motionOn, e.input.motion.on, row('motionSensitivity').enabled, row('motionSensitivity').note]).toEqual(['Off', false, false, false, '']);
  });

  it("its words are the game's lines where it has them, and the legend shows the device's buttons in the player's style", async () => {
    const { e, menu } = await open();
    const de: Record<string, string> = { 'settings.page.picture': 'Bild', 'settings.close': 'Schließen', 'settings.on': 'An' };
    e.controls.names = { has: (id) => id in de, t: (id) => de[id]! };
    expect([menu.t('settings.page.picture'), menu.t('settings.page.sound'), menu.legend()[1]!.label, menu.rows()[1]!.value]).toEqual(['Bild', 'Sound', 'Schließen', 'An']);
    const glyphs = () => menu.legend().map((l) => menu.glyph(l.control));
    expect(glyphs()).toEqual([
      { kind: 'cap', text: 'Enter', round: false },
      { kind: 'cap', text: 'Esc', round: false },
      { kind: 'cap', text: 'R', round: false },
    ]);
    e.input.noteDevice('pad');
    expect(glyphs().map((g) => (g?.kind === 'sprite' ? g.colors.s : g))).toEqual(['blue', 'red', 'teal']); // ✕ ○ △
    e.settings.set({ padGlyphs: 'xbox' });
    expect(glyphs().map((g) => (g?.kind === 'sprite' ? g.colors.f : g))).toEqual(['green', 'red', 'orange']); // A B Y
    expect(menu.legend().map((l) => l.act)).toEqual([true, true, true]);
    e.input.noteDevice('touch'); // no touch controls headless: a touch is the keyboard's
    expect(glyphs()[0]).toEqual({ kind: 'cap', text: 'Enter', round: false });
    e.controls.touch = true;
    expect(glyphs()).toEqual([{ kind: 'cap', text: 'Tap', round: true }, { kind: 'cap', text: 'Swipe', round: true }, null]);
    expect(menu.legend().map((l) => l.act)).toEqual([false, true, true]); // Tap · Change says how (a tap on a row): no button
  });
});
