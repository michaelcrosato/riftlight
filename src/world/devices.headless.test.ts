// Engine World on every device, headless: the pad reaches every panel (Options the menu, Create the
// rooms, R3 or the touchpad the guide, Circle back), prompts name the control in use (keys, the
// pad's buttons in the player's style, a phone's buttons), swipes and taps send the card, a toast
// and panels away, and the rooms' own actions play on a pad and a phone: the Time Lab's rewind,
// the Gallery's shelves, the car's analog triggers, the Sandbox's carry, Bullet Hell's rumble and
// a phone's auto-fire. One engine for the file (the World shell is one per process).
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Engine } from '../engine';
import { hudTexts, pointAtArt } from '../riftlight/headless';
import type { Menu } from '../riftlight/ui/menu';
import { keyText, WORLD_CONTROLS } from './controls';
import type { worldApi } from './index';
import { shell } from './shell';
import { headlessWorld, roomApi, roomGame, teleport, WORLD_T } from './testWorld';

let engine: Engine;
let w: typeof worldApi;
const room = () => roomApi(w);

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium'));
}, WORLD_T);
afterAll(() => engine?.dispose());

/** A DualSense in the standard layout: `pressed` buttons down, the triggers (6, 7) at their values. */
const pad = (pressed: number[] = [], triggers: [number, number] = [0, 0]) => ({
  connected: true,
  mapping: 'standard',
  index: 0,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 18 }, (_, i) => {
    const value = i === 6 ? triggers[0] : i === 7 ? triggers[1] : pressed.includes(i) ? 1 : 0;
    return { pressed: pressed.includes(i) || value > 0.5, value };
  }),
});
/** The hero's clips over the frames stepped since the last call (`step` records them). */
let clips: string[] = [];
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    engine.step(1);
    const anim = roomGame(engine).visitor?.hero?.anim;
    if (anim) clips.push(anim);
  }
};
/** Press pad buttons and let go (two frames each). */
const tap = (...buttons: number[]) => {
  engine.input.setGamepads([pad(buttons)]);
  step(2);
  engine.input.setGamepads([pad()]);
  step(2);
};
/** A key (or a touch button's code, a swipe) pressed for a frame and let go. */
const press = (code: string) => {
  engine.input.setKey(code, true);
  engine.step(1);
  engine.input.setKey(code, false);
  engine.step(1);
};
const texts = () => hudTexts(engine).map((t) => t.text);
const menuLabels = () => (shell.layer.top!.panel as Menu).items().map((x) => ('label' in x ? x.label : ''));
const keyboard = () => {
  engine.input.setGamepads(null);
  engine.input.noteDevice('keyboard');
  engine.settings.set({ padGlyphs: undefined });
};

it('names every control for the device in use: the key, the pad button in the player\'s style, the phone\'s button', () => {
  engine.step(5);
  const name = (a: string) => keyText(engine, `{key:${a}}`);
  try {
    expect(['rooms', 'guide', 'menu', 'rewind', 'handbrake'].map(name)).toEqual(['G', 'H', 'Esc', 'R', 'Space']);
    engine.input.noteDevice('pad');
    expect(['rooms', 'guide', 'menu', 'rewind', 'handbrake'].map(name)).toEqual(['Create', 'R3', 'Options', 'L2', 'Cross']);
    w.knob('engine-buttons', 1); // the Tweak panel's Controller: Xbox
    expect(engine.settings.values.padGlyphs).toBe('xbox');
    expect(['rooms', 'menu', 'handbrake'].map(name)).toEqual(['View', 'Menu', 'A']);
    engine.input.noteDevice('touch');
    expect(['rooms', 'guide', 'menu', 'rewind', 'handbrake'].map(name)).toEqual(['GO', '?', '≡', '<<', 'BRAKE']);
    // a label in capitals keeps its tags working
    expect(keyText(engine, 'WALK INTO A DOOR · {KEY:ROOMS} FOR ANY ROOM')).toBe('WALK INTO A DOOR · GO FOR ANY ROOM');
    expect(Object.keys(WORLD_CONTROLS)).toEqual(expect.arrayContaining(['jump', 'attack', 'menu', 'rooms', 'guide', 'rewind', 'next_item', 'handbrake', 'exit']));
  } finally {
    keyboard();
  }
});

it('prompts along the bottom follow the device: keys and their words, the pad\'s buttons, none on a phone (its buttons are its prompts)', () => {
  press('KeyI'); // the card away: the prompts show without it
  if (w.state().card) press('KeyI');
  expect(w.state().card).toBe(false);
  const shown = texts();
  expect(shown).toEqual(expect.arrayContaining(['MENU', 'HOW IT WORKS', 'ROOMS', 'Esc', 'H', 'G']));
  try {
    engine.input.noteDevice('pad');
    const padded = texts();
    expect(padded).toEqual(expect.arrayContaining(['MENU', 'HOW IT WORKS', 'ROOMS', 'Options', 'R3', 'Create']));
    expect(padded).not.toContain('Esc');
    engine.input.noteDevice('touch');
    expect(texts()).not.toContain('HOW IT WORKS');
  } finally {
    keyboard();
  }
});

it('a pad reaches every panel: Create the rooms, R3 or the touchpad the guide, Circle closes each; the hero never waves on Create', () => {
  try {
    engine.input.setGamepads([pad()]);
    engine.step(2);
    clips = [];
    tap(8); // Create
    expect(w.state().panel).toBe('rooms');
    expect(engine.timeScale, 'the room list stops the room').toBe(0);
    tap(1); // Circle
    expect(w.state().panel).toBeNull();
    expect(engine.timeScale).toBe(1);
    step(40);
    expect(clips, 'Create is the shell\'s, not the hero\'s wave').not.toContain('Wave');
    tap(11); // R3
    expect(w.state().panel).toBe('guide');
    tap(1);
    expect(w.state().panel).toBeNull();
    tap(17); // the DualSense's touchpad
    expect(w.state().panel).toBe('guide');
    tap(17); // the button that opened it closes it again
    expect(w.state().panel).toBeNull();
  } finally {
    keyboard();
  }
});

it('the menu names the control that opens each panel on the device in use, and has the player\'s settings', () => {
  try {
    w.open('pause');
    expect(menuLabels()).toEqual(expect.arrayContaining(['How it works (H)', 'Tweak and settings (T)', 'Go to a room (G)']));
    w.close();
    engine.input.noteDevice('pad');
    w.open('pause');
    expect(menuLabels()).toEqual(expect.arrayContaining(['How it works (R3)', 'Tweak and settings', 'Go to a room (Create)']));
    w.close();
    engine.input.noteDevice('touch');
    w.open('pause');
    expect(menuLabels()).toEqual(expect.arrayContaining(['How it works (?)', 'Tweak and settings', 'Go to a room (GO)']));
    w.close();
    const ids = w.knobs().map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(['engine-music', 'engine-effects', 'engine-buttons', 'engine-vibration']));
    w.knob('engine-vibration', 0.5);
    expect(engine.settings.values.vibration).toBe(0.5);
    w.knob('engine-vibration', 1);
  } finally {
    w.close();
    keyboard();
  }
});

it('a sideways swipe closes a panel; a swipe, or a tap on it, sends the card and a toast away', () => {
  w.open('pause');
  press('SwipeLeft');
  expect(w.state().panel).toBeNull();
  w.open('guide');
  press('SwipeUp'); // up and down scroll the guide
  expect(w.state().panel).toBe('guide');
  press('SwipeRight');
  expect(w.state().panel).toBeNull();
  shell.showCard(10);
  engine.step(1);
  expect(w.state().card).toBe(true);
  press('SwipeDown');
  expect(w.state().card).toBe(false);
  shell.toast('Driving: {key:handbrake} handbrake', 5);
  engine.step(1);
  expect(w.state().toast).toBe('Driving: Space handbrake');
  press('SwipeLeft');
  expect(w.state().toast).toBeNull();
  // a tap (or a click) on the card
  shell.showCard(10);
  engine.step(2);
  pointAtArt(engine, 30, 20, true);
  engine.step(1);
  pointAtArt(engine, 30, 20, false);
  engine.step(1);
  expect(w.state().card).toBe(false);
});

it(
  'the Time Lab rewinds on L2 held and on a phone\'s REWIND, its one touch slot',
  async () => {
    await w.goto('rewind', { instant: true });
    room().nudge();
    engine.step(90);
    try {
      engine.input.setGamepads([pad([], [1, 0])]);
      engine.step(3);
      expect(room().rewinding()).toBe(true);
      engine.input.setGamepads([pad()]);
      engine.step(3);
      expect(room().rewinding()).toBe(false);
      engine.step(30);
      engine.input.setKey('TouchSlot1', true);
      engine.step(3);
      expect(room().rewinding()).toBe(true);
      engine.input.setKey('TouchSlot1', false);
      engine.step(3);
      expect(room().rewinding()).toBe(false);
    } finally {
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'the Gallery steps on R1 / L1 and turns shelves on R2, and the hero does not lie down or go prone for them',
  async () => {
    await w.goto('gallery', { instant: true });
    engine.step(10);
    const at = room().current();
    try {
      engine.input.setGamepads([pad()]);
      engine.step(2);
      clips = [];
      tap(5); // R1
      expect(room().current().index).toBe(at.index + 1);
      tap(4); // L1
      expect(room().current().index).toBe(at.index);
      step(60);
      expect(clips.filter((c) => /Lie|Prone/.test(c)), 'R1 and L1 are the Gallery\'s, not the hero\'s lie down and prone').toEqual([]);
      expect(roomGame(engine).visitor?.hero?.stance).toBe('stand');
      engine.input.setGamepads([pad([], [0, 1])]); // R2
      engine.step(2);
      engine.input.setGamepads([pad()]);
      engine.step(2);
      expect(room().current().shelf).not.toBe(at.shelf);
      // the phone's > steps too
      const next = room().current().index;
      press('TouchSlot2');
      expect(room().current().index).toBe(next + 1);
    } finally {
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'the car: R2 is the gas as far as it is pulled and never gets out; L2 brakes; Circle gets out',
  async () => {
    await w.goto('drift', { instant: true });
    engine.step(10);
    room().keys(); // in the car, driven by the player
    try {
      engine.input.setGamepads([pad()]); // seen at rest first: a trigger first seen part-way reads 0
      engine.step(2);
      engine.input.setGamepads([pad([], [0, 0.4])]);
      engine.step(60);
      const half = room().speed();
      expect(half).toBeGreaterThan(1);
      expect(room().driving(), 'R2 drives, it never gets out').toBe(true);
      w.pad('FLIP BACK');
      engine.step(5);
      engine.input.setGamepads([pad([], [0, 1])]);
      engine.step(60);
      expect(room().speed(), 'a full pull is more gas').toBeGreaterThan(half);
      engine.input.setGamepads([pad([], [1, 0])]); // L2: brake
      for (let i = 0; i < 300 && Math.abs(room().speed()) > 1; i++) engine.step(1);
      expect(Math.abs(room().speed())).toBeLessThan(2);
      engine.input.setGamepads([pad()]);
      engine.step(2);
      tap(1); // Circle
      expect(room().driving()).toBe(false);
    } finally {
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'the Sandbox: R2 held carries the prop in front of the hero, letting go throws it',
  async () => {
    await w.goto('sandbox', { instant: true });
    engine.step(10);
    room().clear();
    room().spawn('ball', [0, 0.5, 4.6]);
    teleport(engine, [0, 0, 6], Math.PI); // facing the ball
    engine.step(20);
    try {
      engine.input.setGamepads([pad([], [0, 1])]);
      engine.step(30);
      expect(room().holding()).toBe('ball');
      const throws = room().throws();
      engine.input.setGamepads([pad()]);
      engine.step(2);
      expect(room().holding()).toBeNull();
      expect(room().throws()).toBe(throws + 1);
    } finally {
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'Bullet Hell: a hit rumbles the pad; on a phone the hero fires back by itself, on the keyboard never',
  async () => {
    await w.goto('bullets', { instant: true });
    const rumble = vi.spyOn(engine.input, 'rumble');
    try {
      w.pad('ALL');
      engine.step(180);
      expect(room().hits()).toBeGreaterThanOrEqual(1);
      expect(rumble.mock.calls.some(([r]) => (r.strong ?? 0) >= 0.9)).toBe(true);
      room().patterns([]);
      engine.step(120);
      const shots = room().shots();
      engine.step(90);
      expect(room().shots(), 'no shots without a punch on the keyboard').toBe(shots);
      engine.input.noteDevice('touch');
      engine.step(90);
      expect(room().shots()).toBeGreaterThan(shots);
    } finally {
      rumble.mockRestore();
      keyboard();
    }
  },
  WORLD_T,
);
