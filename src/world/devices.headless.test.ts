// Engine World on every device, headless: the pad reaches every panel (Options the menu, Create the
// rooms, R3 or the touchpad the guide, Circle back), prompts name the control in use (keys, the
// pad's buttons in the player's style, a phone's buttons), swipes and taps send the card, a toast
// and panels away, and the rooms' own actions play on a pad and a phone: the Time Lab's rewind,
// the Gallery's shelves, the car's analog triggers, the Sandbox's carry, Bullet Hell's rumble and
// a phone's auto-fire; a phone's PRONE in the Moveset Playground, the room card on a pad (the
// menu), a DualSense's triggers let go in the menu. One engine for the file (the World shell is
// one per process), with a fake 52in1 hub's DualSense so what the controller is sent shows.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { type Engine, type HubSettingsSource, KEYMAP } from '../engine';
import { hudTexts, pointAtArt } from '../riftlight/headless';
import type { Menu } from '../riftlight/ui/menu';
import { keyText, touchStates, WORLD_CONTROLS, WORLD_TOUCH_BUTTONS } from './controls';
import type { worldApi } from './index';
import { shell } from './shell';
import { headlessWorld, roomApi, roomGame, teleport, WORLD_T } from './testWorld';

let engine: Engine;
let w: typeof worldApi;
const room = () => roomApi(w);

/** A 52in1 hub with a DualSense whose light bar and triggers the player lets games use (what it was sent: `engine.dualsense.sent`). */
const HUB: HubSettingsSource = { dualsense: { connected: true, lightbar: true, triggers: true, light: () => {}, trigger: () => {} } };

beforeAll(async () => {
  // touch: as a phone's page, which shows touch controls, so a touch names them (on a laptop's touch screen without them it names keys)
  ({ engine, w } = await headlessWorld('atrium', 1, { hubSettings: HUB, touch: true }));
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
    // no ⚙ in the World: every one of the player's settings is in Tweak and settings
    expect(ids).toEqual(expect.arrayContaining(['engine-look', 'engine-pixel', 'engine-pixel-size', 'engine-quality', 'engine-fps', 'engine-sound', 'engine-volume', 'engine-debug']));
    const master = engine.audio.volume.master;
    try {
      w.knob('engine-pixel-size', 1);
      w.knob('engine-fps', 1);
      w.knob('engine-volume', 0.5);
      w.knob('engine-debug', true);
      expect(engine.settings.values).toMatchObject({ pixelSize: 'chunky', fps: 30, debugInfo: true });
      expect(engine.maxFps).toBe(30);
      expect(engine.audio.volume.master).toBe(0.5);
      // Quality: auto (the device's) and each level, and back to auto once a level was picked
      const quality = w.knobs().find((k) => k.id === 'engine-quality') as unknown as { options: string[]; value: number };
      expect(quality.options).toEqual(['auto', 'low', 'medium', 'high']);
      expect(quality.value, 'auto until the player picks a level').toBe(0);
      w.knob('engine-quality', 1);
      expect(engine.settings.values.quality).toBe('low');
      expect(engine.quality).toBe('low');
      w.knob('engine-quality', 0);
      expect(engine.settings.values.quality).toBe('auto');
      expect((w.knobs().find((k) => k.id === 'engine-quality') as unknown as { value: number }).value).toBe(0);
      // Reset settings: every one of the player's back to the defaults, the volumes too
      w.knob('engine-quality', 3);
      w.open('tweak');
      const reset = (shell.layer.top!.panel as Menu).items().find((x) => x.id === 'reset-settings') as { onClick: () => void } | undefined;
      expect(reset, 'Tweak has a Reset settings row').toBeDefined();
      reset!.onClick();
      w.close();
      expect(engine.settings.values).toEqual({});
      expect(engine.audio.volume.master, 'the default volume').toBe(master);
      expect(engine.maxFps).not.toBe(30);
    } finally {
      engine.settings.set({ pixelSize: undefined, fps: undefined, debugInfo: undefined });
      engine.audio.setVolume('master', master);
    }
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

it('a pad hides the room card and brings it back from the menu (Options, its Room card row), as the card\'s footer says; the keyboard\'s row names I', () => {
  try {
    engine.input.setGamepads([pad()]);
    engine.input.noteDevice('pad');
    engine.step(2);
    shell.showCard(10);
    engine.step(1);
    expect(w.state().card).toBe(true);
    expect(texts(), 'the card says where a pad hides it').toEqual(expect.arrayContaining(['R3', 'HOW IT WORKS', 'Options', 'HIDE']));
    const row = (label: string) => {
      tap(9); // Options
      expect(w.state().panel).toBe('pause');
      const labels = menuLabels();
      expect(labels).toContain(label);
      for (let i = 0; i < labels.indexOf(label); i++) tap(13); // down the menu
      tap(0); // Cross
    };
    row('Hide the room card');
    expect(w.state().panel).toBeNull();
    expect(w.state().card).toBe(false);
    row('Show the room card');
    expect(w.state().card).toBe(true);
    keyboard();
    w.open('pause');
    expect(menuLabels()).toContain('Hide the room card (I)');
  } finally {
    w.close();
    keyboard();
  }
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
  'the press that closes a panel is the panel\'s: Circle or Backspace closing the guide, the menu or the tweak panel undoes nothing in the Workshop; with nothing open Circle undoes',
  async () => {
    await w.goto('workshop', { instant: true });
    engine.step(10);
    room().clear();
    room().spawn('barrel', [-2, 2]);
    room().spawn('barrel', [-3, 2]);
    engine.step(2);
    const placed = () => (room().spawned() as unknown[]).length;
    try {
      engine.input.setGamepads([pad()]);
      engine.step(2);
      w.open('guide');
      engine.step(1);
      tap(1); // Circle
      expect(w.state().panel).toBeNull();
      expect(placed(), 'Circle closed the guide, and undid nothing').toBe(2);
      tap(9); // Options: the menu
      expect(w.state().panel).toBe('pause');
      tap(1);
      expect(w.state().panel).toBeNull();
      expect(placed(), 'Circle closed the menu, and undid nothing').toBe(2);
      keyboard();
      w.open('tweak');
      engine.step(1);
      press('Backspace'); // the keyboard's back, and the picker's undo
      expect(w.state().panel).toBeNull();
      expect(placed(), 'Backspace closed the tweak panel, and undid nothing').toBe(2);
      engine.input.setGamepads([pad()]);
      engine.step(2);
      tap(1); // nothing open: Circle is the picker's undo
      expect(placed()).toBe(1);
    } finally {
      w.close();
      room().clear();
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
  'the press that closes a panel is the panel\'s: the Gallery does not also step on it',
  async () => {
    await w.goto('gallery', { instant: true });
    engine.step(10);
    const at = room().current().index;
    try {
      engine.input.setGamepads([pad()]);
      engine.step(2);
      w.open('guide');
      engine.step(1);
      tap(1, 5); // Circle and R1 in one frame
      expect(w.state().panel).toBeNull();
      expect(room().current().index, 'R1 went with the Circle that closed the guide').toBe(at);
      keyboard();
      w.open('tweak');
      engine.step(1);
      engine.input.setKey('Escape', true);
      engine.input.setKey('KeyE', true);
      engine.step(1);
      engine.input.setKey('Escape', false);
      engine.input.setKey('KeyE', false);
      engine.step(1);
      expect(w.state().panel).toBeNull();
      expect(room().current().index, 'E went with the Esc that closed the tweak panel').toBe(at);
      press('KeyE'); // with nothing open, E steps
      expect(room().current().index).toBe(at + 1);
    } finally {
      w.close();
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'a phone goes prone: PRONE (Z) shows in the Moveset Playground, whose crawl tunnel names it, and in no room that does not ask for it',
  async () => {
    const prone = WORLD_TOUCH_BUTTONS.find((b) => b.label === WORLD_CONTROLS.prone.touch);
    expect(prone?.code, 'the button {key:prone} names on a phone').toBe('KeyZ');
    expect(KEYMAP.prone).toContain(prone!.code);
    expect(touchStates(roomGame(engine).logic.touch?.() ?? {}).KeyZ?.hidden, 'hidden in the Gallery').toBe(true);
    await w.goto('moves', { instant: true });
    engine.step(10);
    expect(touchStates(roomGame(engine).logic.touch?.() ?? {}).KeyZ).toMatchObject({ hidden: false, label: 'PRONE' });
    try {
      engine.input.noteDevice('touch');
      expect(keyText(engine, 'CRAWL TUNNEL · {key:prone}')).toBe('CRAWL TUNNEL · PRONE');
      press('KeyZ'); // what the button presses
      step(40);
      expect(roomGame(engine).visitor?.hero?.stance).toBe('prone');
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
  'the car\'s adaptive triggers push back while you drive, and let go in the menu (it stops the room) and under a panel',
  async () => {
    await w.goto('drift', { instant: true });
    engine.step(10);
    room().keys(); // in the car
    const sent = () => engine.dualsense.sent;
    try {
      engine.step(5);
      expect(sent().right, 'R2 pushes back').not.toBeNull();
      expect(sent().left, 'L2 pushes back').not.toBeNull();
      w.open('pause');
      engine.step(3);
      expect(engine.timeScale, 'the menu stops the room').toBe(0);
      expect(sent(), 'the menu lets them go').toMatchObject({ left: null, right: null });
      w.close();
      engine.step(5);
      expect(sent().right, 'back in the car').not.toBeNull();
      w.open('guide'); // the room plays on under it, the car is not yours
      engine.step(5);
      expect(sent()).toMatchObject({ left: null, right: null });
      w.close();
      engine.step(5);
      expect(sent().left).not.toBeNull();
      expect(room().getOut(), 'out of the car').toBe(true);
      expect(sent()).toMatchObject({ left: null, right: null });
    } finally {
      w.close();
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

/**
 * A finger on the canvas at art (x, y), going down or lifting, for one frame: what a phone's touch
 * does to the input (`Touch` held or let go, with its button event where it is).
 */
const finger = (x: number, y: number, down: boolean) => {
  const input = engine.input;
  pointAtArt(engine, x, y);
  input.pointer.touch = true;
  const events = vi.spyOn(input, 'buttonEvents', 'get').mockReturnValue([{ code: 'Touch', down, x: input.pointer.x, y: input.pointer.y }]);
  input.setKey('Touch', down);
  try {
    engine.step(1);
  } finally {
    events.mockRestore();
  }
};
/** A click at art (x, y): the mouse's left button down for `frames` frames, then up. */
const click = (x: number, y: number, frames = 1) => {
  pointAtArt(engine, x, y, true);
  engine.step(frames);
  pointAtArt(engine, x, y, false);
  engine.step(1);
};

it(
  'a click or a tap that hides the room card is the shell\'s: the Workshop places nothing behind it (nor when the finger lifts), a right click there takes nothing away',
  async () => {
    await w.goto('workshop', { instant: true });
    engine.step(10);
    room().clear();
    engine.step(2);
    const placed = () => (room().spawned() as unknown[]).length;
    try {
      shell.showCard(10);
      engine.step(2);
      expect(w.state().card).toBe(true);
      click(60, 60);
      expect(w.state().card).toBe(false);
      expect(placed(), 'the click hid the card, and placed nothing behind it').toBe(0);
      // a phone's tap: the finger down a few frames on the card, then lifted there
      shell.showCard(10);
      engine.step(2);
      engine.input.noteDevice('touch');
      finger(60, 60, true);
      expect(w.state().card).toBe(false);
      engine.step(4);
      finger(60, 60, false);
      engine.step(2);
      expect(placed(), 'the tap hid the card, and placed nothing when it lifted').toBe(0);
      keyboard();
      // with no card there, the same click places (the spot is the floor) and a right click takes it away
      click(60, 60);
      expect(placed()).toBe(1);
      shell.showCard(10);
      engine.step(2);
      pointAtArt(engine, 60, 60);
      engine.input.setButtons(2);
      engine.step(1);
      engine.input.setButtons(0);
      engine.step(1);
      expect(w.state().card).toBe(false);
      expect(placed(), 'the right click hid the card, and took nothing away').toBe(1);
      // and a tap on a toast is the toast's too
      shell.toast('Placed!', 5);
      engine.step(2);
      const at = hudTexts(engine).find((t) => t.text === 'PLACED!')!;
      click(at.x + 2, at.y + 2);
      expect(w.state().toast).toBeNull();
      expect(placed(), 'the click hid the toast, and placed nothing').toBe(1);
    } finally {
      room().clear();
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'a tap on the room card during the cutscene hides the card and does not skip the scene, nor does a swipe that sends the card away; a tap elsewhere skips when it lifts',
  async () => {
    await w.goto('cutscene', { instant: true });
    engine.step(10);
    try {
      engine.input.noteDevice('touch');
      room().play();
      engine.step(30);
      expect(room().playing()).toBe(true);
      shell.showCard(10);
      engine.step(2);
      finger(60, 60, true);
      engine.step(3);
      finger(60, 60, false);
      engine.step(3);
      expect(w.state().card).toBe(false);
      expect(room().playing(), 'the tap was the card\'s, not a skip').toBe(true);
      // a swipe sends the card away from anywhere on a phone: from off the card, it skips nothing
      shell.showCard(10);
      engine.step(2);
      const off = { x: engine.hud.width - 60, y: engine.hud.height - 60 };
      finger(off.x, off.y, true);
      engine.step(2);
      engine.input.setKey('SwipeLeft', true); // the engine presses the swipe as the finger lifts
      finger(off.x - 40, off.y, false);
      engine.input.setKey('SwipeLeft', false);
      engine.step(2);
      expect(w.state().card, 'the swipe sent the card away').toBe(false);
      expect(room().playing(), 'the swipe was no skip').toBe(true);
      finger(60, 60, true);
      engine.step(2);
      expect(room().playing(), 'a tap skips when it lifts').toBe(true);
      finger(60, 60, false);
      engine.step(2);
      expect(room().playing(), 'with the card gone, a tap skips').toBe(false);
    } finally {
      if (room().playing()) room().skip();
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'the Sandbox grabs nothing under a toast that a click sends away; the same click with no toast grabs',
  async () => {
    await w.goto('sandbox', { instant: true });
    engine.step(10);
    room().clear();
    teleport(engine, [-2, 0, -1]); // the bottom of the screen on the floor (from the spawn, it is past the wall)
    engine.step(120);
    const { width, height } = engine.renderer.resolution;
    // a crate on the floor under the toast's line (bottom middle)
    shell.toast('Driving', 5);
    engine.step(2);
    const line = hudTexts(engine).find((t) => t.text === 'DRIVING')!;
    const ax = line.x + Math.floor(line.w / 2);
    const ay = line.y + 3;
    const nx = ((ax + 0.5) / width) * 2 - 1;
    const ny = 1 - ((ay + 0.5) / height) * 2;
    const [o, d] = room().ray(nx, ny) as [number[], number[]];
    const s = (0.4 - o[1]!) / d[1]!;
    room().spawn('crate', [o[0]! + d[0]! * s, 0.4, o[2]! + d[2]! * s]);
    engine.step(30);
    expect(room().pick(nx, ny), 'the crate is under the toast').toBe('crate');
    try {
      shell.toast('Driving', 5);
      engine.step(2);
      pointAtArt(engine, ax, ay, true);
      engine.step(10);
      expect(w.state().toast).toBeNull();
      expect(room().holding(), 'the click was the toast\'s').toBeNull();
      pointAtArt(engine, ax, ay, false);
      engine.step(2);
      pointAtArt(engine, ax, ay, true);
      engine.step(10);
      expect(room().holding(), 'with no toast, a click grabs').toBe('crate');
    } finally {
      pointAtArt(engine, ax, ay, false);
      engine.step(2);
      room().clear();
      keyboard();
    }
  },
  WORLD_T,
);

/** The menu's close box (it closes on the press), in art pixels: the menu open, drawn. */
const menuCloseBox = () => {
  w.open('pause');
  engine.step(2);
  const r = shell.layer.top!.rect;
  return { x: r.x + r.w - 6, y: r.y - 8 };
};

it(
  'a click a panel took is its own until it lets go: the Sandbox grabs nothing under the menu\'s close box while the button stays down; the same click with nothing open grabs',
  async () => {
    await w.goto('sandbox', { instant: true });
    engine.step(10);
    room().clear();
    teleport(engine, [-2, 0, -1]);
    engine.step(120);
    const box = menuCloseBox();
    w.close();
    engine.step(2);
    // a crate on the floor under the close box
    const { width, height } = engine.renderer.resolution;
    const nx = ((box.x + 0.5) / width) * 2 - 1;
    const ny = 1 - ((box.y + 0.5) / height) * 2;
    const [o, d] = room().ray(nx, ny) as [number[], number[]];
    const s = (0.4 - o[1]!) / d[1]!;
    room().spawn('crate', [o[0]! + d[0]! * s, 0.4, o[2]! + d[2]! * s]);
    engine.step(30);
    expect(room().pick(nx, ny), 'the crate is under the close box').toBe('crate');
    try {
      menuCloseBox();
      pointAtArt(engine, box.x, box.y, true);
      engine.step(10);
      expect(w.state().panel, 'the press closed the menu').toBeNull();
      expect(room().holding(), 'the click was the menu\'s, held on').toBeNull();
      pointAtArt(engine, box.x, box.y, false);
      engine.step(2);
      pointAtArt(engine, box.x, box.y, true);
      engine.step(10);
      expect(room().holding(), 'with nothing open, a click grabs').toBe('crate');
    } finally {
      pointAtArt(engine, box.x, box.y, false);
      engine.step(2);
      w.close();
      room().clear();
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'a tap a panel took is its own until it lifts: the Workshop places nothing where the finger that chose the menu\'s Resume lifts; the same tap with nothing open places',
  async () => {
    await w.goto('workshop', { instant: true });
    engine.step(10);
    room().clear();
    engine.step(2);
    const placed = () => (room().spawned() as unknown[]).length;
    try {
      if (w.state().card) press('KeyI'); // the room card away: a tap on it is the card's
      expect(w.state().card).toBe(false);
      engine.input.noteDevice('touch');
      w.open('pause');
      engine.step(2);
      // the Resume row, over the floor: a finger chooses it as it lifts where it went down (a
      // swipe across a menu chooses nothing)
      const row = hudTexts(engine).find((t) => t.text === 'Resume')!;
      const box = { x: row.x + 2, y: row.y + 3 };
      finger(box.x, box.y, true);
      expect(w.state().panel, 'the finger down: the menu waits to see a tap').toBe('pause');
      engine.step(4);
      finger(box.x, box.y, false);
      expect(w.state().panel, 'the finger chose Resume as it lifted').toBeNull();
      engine.step(2);
      expect(placed(), 'the tap was the menu\'s').toBe(0);
      finger(box.x, box.y, true);
      engine.step(4);
      finger(box.x, box.y, false);
      engine.step(2);
      expect(placed(), 'with nothing open, the same tap places').toBe(1);
    } finally {
      w.close();
      room().clear();
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'a press a panel took is its own while it is held: the Circle that closes the guide or the menu never crouches the hero, the Cross that chose Resume never pulls the car\'s handbrake',
  async () => {
    await w.goto('atrium', { instant: true });
    engine.step(10);
    const hero = () => roomGame(engine).visitor!.hero!;
    try {
      engine.input.setGamepads([pad()]);
      engine.step(2);
      for (const panel of ['guide', 'pause'] as const) {
        w.open(panel);
        engine.step(2);
        engine.input.setGamepads([pad([1])]); // Circle, held as a real press is (a tenth of a second)
        const states = new Set<string>();
        for (let i = 0; i < 8; i++) {
          engine.step(1);
          states.add(hero().stance);
        }
        engine.input.setGamepads([pad()]);
        engine.step(10);
        expect(w.state().panel).toBeNull();
        expect([...states], `the Circle that closed the ${panel} is not the hero's crouch`).toEqual(['stand']);
      }
      // with nothing open, Circle held crouches
      engine.input.setGamepads([pad([1])]);
      engine.step(8);
      expect(hero().stance).toBe('crouch');
      engine.input.setGamepads([pad()]);
      engine.step(20);
      // the car: Resume chosen with Cross (the handbrake), held on
      await w.goto('drift', { instant: true });
      engine.step(10);
      room().keys();
      engine.input.setGamepads([pad()]);
      engine.step(2);
      w.open('pause');
      engine.step(2);
      engine.input.setGamepads([pad([0])]);
      const pulled: boolean[] = [];
      for (let i = 0; i < 8; i++) {
        engine.step(1);
        pulled.push(room().input().handbrake);
      }
      expect(w.state().panel, 'Cross chose Resume').toBeNull();
      expect(pulled.some(Boolean), 'the Cross that chose Resume is not the handbrake').toBe(false);
      engine.input.setGamepads([pad()]);
      engine.step(2);
      engine.input.setGamepads([pad([0])]);
      engine.step(3);
      expect(room().input().handbrake, 'Cross with nothing open is').toBe(true);
    } finally {
      engine.input.setGamepads([pad()]);
      engine.step(2);
      w.close();
      keyboard();
    }
  },
  WORLD_T,
);

it(
  'on a phone a room names only controls it has: the Gallery\'s shelf before is its floor pad (no <<), the Workshop\'s list is dragged and its panel\'s < > change shelf; the field guide names no Tab',
  async () => {
    const shown = () => Object.values(touchStates(roomGame(engine).logic.touch?.() ?? {})).filter((b) => !b.hidden).map((b) => b.label ?? '');
    try {
      await w.goto('gallery', { instant: true });
      engine.step(5);
      engine.input.noteDevice('touch');
      const steps = ['prev_item', 'next_item', 'next_shelf'].map((a) => keyText(engine, `{key:${a}}`));
      expect(steps).toEqual(['<', '>', '>>']);
      for (const s of steps) expect(shown(), `the Gallery's ${s} button`).toContain(s);
      expect(keyText(engine, '{key:prev_shelf}'), 'no << button: the < SHELF pad').toBe('< SHELF');
      expect(roomGame(engine).kit.pads.map((p) => p.def.label)).toContain('< SHELF');
      await w.goto('workshop', { instant: true });
      engine.step(5);
      const line = roomGame(engine).def.try[0]!;
      expect(keyText(engine, line)).toBe('Scroll the list with DRAG DOWN and DRAG UP; < and > change shelf');
      expect(shown().filter((l) => /[<>]/.test(l)), 'no < > buttons in the Workshop: the panel has them').toEqual([]);
      engine.input.noteDevice('pad');
      expect(keyText(engine, line)).toBe('Scroll the list with L1 and R1; L2 and R2 change shelf');
      engine.input.noteDevice('touch');
      w.open('glossary');
      engine.step(1);
      const words = hudTexts(engine).map((t) => t.text).join(' ');
      expect(words.toLowerCase()).toContain('drag to scroll');
      expect(words).not.toMatch(/\btab\b/i);
      w.close();
      keyboard();
      w.open('glossary');
      engine.step(1);
      expect(hudTexts(engine).map((t) => t.text).join(' '), 'a keyboard has Tab').toMatch(/\btab jumps between sections/i);
    } finally {
      w.close();
      keyboard();
    }
  },
  WORLD_T,
);
