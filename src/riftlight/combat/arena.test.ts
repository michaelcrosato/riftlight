// The combat arena headless (was e2e `riftlight-combat`'s state checks): the arena boots (hero,
// sword, dummies, skill bar), the basic combo lands on its hit frame with hit-stop, knockback, a
// flash and a damage number, a dodge roll moves the hero with i-frames and cancels an attack, a
// fireball pays mana, flies and hits, the left mouse button attacks, its prompts name the buttons
// it plays with, a kill emits kill and death and the corpse pops and is removed; R is a skill key,
// so the engine's resolution hotkey sits on F2 when the hotkeys are on; the HUD fits every window
// shape. The picture stays in e2e. Tests run in order on one engine; the hotkey test boots its own
// after the first is disposed.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Control, ControlTable, Engine } from '../../engine';
import { HERO_KEYS } from '../actors/controls';
import { heroCodes } from '../game/controls';
import { headlessGame, hudOverlap, hudTexts } from '../headless';
import { Arena, arenaHudLayout } from './arena';

const T = 30_000;

interface Logged {
  type: string;
  frame: number;
  skill?: string;
  total: number;
  target?: string;
}

describe('the combat arena', () => {
  let e: Engine;
  let g: Arena;
  const log: Logged[] = [];

  beforeAll(async () => {
    g = new Arena();
    e = await headlessGame(g);
    e.step(2);
    g.actors.events.onAny((type, payload) => {
      const p = payload as { hit?: { skill?: string }; skill?: string; result?: { total?: number }; target?: { name?: string }; actor?: { name?: string } } | undefined;
      log.push({ type: String(type), frame: e.frame, skill: p?.hit?.skill ?? p?.skill, total: p?.result?.total ?? 0, target: p?.target?.name ?? p?.actor?.name });
    });
  }, T);
  afterAll(() => e?.dispose());

  /** Press a key for two frames, as a tap. */
  const tap = (code: string) => {
    e.input.setKey(code, true);
    e.step(2);
    e.input.setKey(code, false);
  };

  it('boots with the hero, a sword in hand, five dummies and the skill bar; no resolution hotkey on R', () => {
    expect(e.state().game).toBe('Riftlight Arena');
    expect(g.hero.actor.alive).toBe(true);
    expect(g.heroModel.getObjectByName('Sword'), 'a sword in hand').toBeTruthy();
    expect(g.dummies.filter((d) => d.alive).length, 'five training dummies').toBe(5);
    expect([g.hero.basic.id, ...g.hero.slots.map((x) => x?.id ?? null)].join(',')).toBe('slash,cleave,fireball,frost-nova,leap-slam,whirlwind');
    // R is a skill key: the arena never turns the engine hotkeys on (none here, as with ?debug=0)
    expect(e.debugKeys.resolution).toEqual([]);
  });

  /**
   * The skill bar's labels this frame (each slot's glyph: a key cap, a pad's button, the mouse) as
   * boxes: what `hud.glyph` drew on the row over the skills' names, and any text there outside them.
   */
  const labelBoxes = () => {
    const glyphs: { x: number; y: number; w: number; h: number }[] = [];
    const own = e.hud.glyph.bind(e.hud);
    const spy = vi.spyOn(e.hud, 'glyph').mockImplementation((x, y, action, scale) => {
      const w = own(x, y, action, scale);
      glyphs.push({ x, y: y - 1, w, h: 9 });
      return w;
    });
    let texts: { x: number; y: number; w: number; h: number }[];
    try {
      // the row over the names, the bar's six slots 34 pixels apart (the mana bar's number is left of it)
      texts = hudTexts(e).filter((t) => t.y + t.h > e.hud.height - 26 && t.y < e.hud.height - 15 && Math.abs(t.x + t.w / 2 - e.hud.width / 2) < 3 * 34);
    } finally {
      spy.mockRestore();
    }
    const within = (t: { x: number; y: number; w: number; h: number }, g: { x: number; y: number; w: number; h: number }) => t.x >= g.x && t.x < g.x + g.w;
    return [...glyphs, ...texts.filter((t) => !glyphs.some((g) => within(t, g)))];
  };
  const overprinted = (boxes: { x: number; y: number; w: number; h: number }[]) =>
    boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).map((b) => `${JSON.stringify(a)} × ${JSON.stringify(b)}`));

  it('plays on the game’s one key map: its bar is labelled for the device in use, and a pad’s Square casts the first skill', () => {
    const texts = () => hudTexts(e).map((t) => t.text);
    e.input.noteDevice('keyboard');
    expect(texts(), 'keys').toEqual(expect.arrayContaining(['1', '2', '3', '4', 'F']));
    expect(labelBoxes().length, 'a label per slot').toBe(6);
    expect(overprinted(labelBoxes()), 'no label over the next').toEqual([]);
    const pad = (pressed: number[] = []) => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i) })) });
    e.input.setGamepads([pad()]);
    e.step(30);
    const mana = g.hero.actor.mana;
    e.input.setGamepads([pad([2])]); // Square: slot 0, Cleave (the game's skill 1)
    e.step(2);
    e.input.setGamepads([pad()]);
    e.step(1);
    expect(e.input.device).toBe('pad');
    expect(texts(), 'the pad’s buttons').toEqual(expect.arrayContaining(['L1', 'R1', 'R2']));
    expect(labelBoxes().length, 'a label per slot').toBe(6);
    expect(overprinted(labelBoxes()), 'no label over the next (CROSSSQUARTRIANGLE once)').toEqual([]);
    expect(g.hero.actor.mana, 'Cleave was cast').toBeLessThan(mana);
    e.step(60);
    e.input.setGamepads(null);
    e.input.noteDevice('keyboard');
  });

  it(
    'the first slash lands on its hit frame with damage, hit-stop, a flash, a number and knockback; holding J chains the combo',
    () => {
      const dummy = g.dummies.find((d) => d.name === 'training dummy')!;
      dummy.brain = null; // stands still for the measurement
      g.hero.teleport([0, 0, 0.6]);
      g.hero.facing = Math.PI;
      e.step(10);
      const life0 = dummy.life;
      const z0 = dummy.position.z;
      const press = e.frame;
      tap('KeyJ');
      let hitFrame = -1;
      let stop = { hero: 0, dummy: 0 };
      let flash = false;
      let dealt = 0;
      for (let i = 0; i < 40 && hitFrame < 0; i++) {
        e.step(1);
        const hit = log.find((l) => l.type === 'hit' && l.frame > press && l.target === 'training dummy' && l.total > 0);
        if (hit) {
          hitFrame = hit.frame;
          // what the hit took off the dummy (the still dummy regenerates, so its life later says little)
          dealt = life0 - dummy.life;
          stop = { hero: g.hero.actor.hitStop, dummy: dummy.hitStop };
          flash = dummy.fx.flashing;
        }
      }
      const numbers = g.combat.numbers.floaters.length;
      e.step(40);
      // Slash1 hits at frame 5 of 12 (0.42 s at 100% speed) → ~10.5 game frames after the press
      const after = hitFrame - press;
      expect(after, `hit ${after} frames after the press`).toBeGreaterThanOrEqual(8);
      expect(after).toBeLessThanOrEqual(13);
      expect(dealt, 'the dummy takes damage').toBeGreaterThan(0);
      expect(stop.hero, 'hit-stop freezes the hero').toBeGreaterThan(0);
      expect(stop.dummy, 'hit-stop freezes the target').toBeGreaterThan(0);
      expect(flash, 'the target flashes on hit').toBe(true);
      expect(numbers, 'a damage number pops').toBeGreaterThan(0);
      expect(dummy.position.z - z0, 'knockback pushes the dummy away').toBeLessThan(-0.05);
      // the whole chain: J held keeps the combo going
      e.input.setKey('KeyJ', true);
      e.step(70);
      e.input.setKey('KeyJ', false);
      expect(g.hero.stats.attacks, 'holding attack chains the combo').toBeGreaterThanOrEqual(4);
      e.step(40);
    },
    T,
  );

  it(
    'Space rolls with i-frames over open floor, and a dodge cancels an attack after its hit frame',
    () => {
      // open floor: the default iso camera turns D into a diagonal, clear of the pillars from here
      g.hero.teleport([0, 0, 10]);
      g.hero.facing = Math.PI / 2;
      e.step(10);
      const p0 = g.hero.feet;
      e.input.setKey('KeyD', true);
      tap('Space');
      e.step(2);
      expect({ state: g.hero.state, anim: g.hero.anim }).toEqual({ state: 'dodge', anim: 'Roll' });
      expect(g.hero.actor.iframes, 'i-frames during the roll').toBeGreaterThan(0);
      e.step(24);
      e.input.setKey('KeyD', false);
      expect(g.hero.feet.distanceTo(p0), 'the roll covers ground').toBeGreaterThan(3);
      e.step(20);
      // attack, then dodge right after the hit frame: the swing is cancelled
      g.hero.teleport([0, 0, 10]);
      g.hero.facing = Math.PI / 2;
      e.step(10);
      tap('KeyJ');
      e.step(10);
      const cancels = g.hero.stats.cancels;
      tap('Space');
      e.step(2);
      expect(g.hero.state).toBe('dodge');
      expect(g.hero.stats.cancels - cancels, 'the dodge cancelled the swing').toBeGreaterThanOrEqual(1);
      e.step(40);
    },
    T,
  );

  it(
    'a fireball (E) costs mana, flies as a projectile and hits a dummy',
    () => {
      g.hero.teleport([0, 0, 4]);
      g.hero.facing = Math.PI;
      e.step(30);
      const mana0 = g.hero.actor.mana;
      const press = e.frame;
      tap('KeyE');
      expect(mana0 - g.hero.actor.mana, 'fireball costs mana').toBeGreaterThan(0);
      let flying = 0;
      for (let i = 0; i < 30; i++) {
        e.step(1);
        flying = Math.max(flying, g.combat.active('projectile').length);
      }
      e.step(60);
      expect(flying, 'the fireball flies (a projectile effect)').toBeGreaterThan(0);
      expect(log.filter((l) => l.type === 'hit' && l.frame > press && l.skill === 'fireball' && l.total > 0).length, 'and hits a dummy').toBeGreaterThan(0);
    },
    T,
  );

  it(
    'the left mouse button attacks',
    () => {
      const before = g.hero.stats.attacks;
      e.input.setButtons(1);
      e.step(2);
      e.input.setButtons(0);
      e.step(30);
      expect(g.hero.stats.attacks - before).toBe(1);
    },
    T,
  );

  it(
    'its prompts name the buttons it plays with (the game\'s one key map: pad Cross attacks, Circle dodges, Square is the first skill), and the button named does it',
    () => {
      const actions = ['attack', 'dodge', 'skill1', 'skill2', 'interact'];
      e.input.noteDevice('pad');
      e.step(1);
      expect(actions.map((a) => e.controls.label(a)), 'on a pad').toEqual(['Cross', 'Circle', 'Square', 'Triangle', 'R2']);
      e.input.noteDevice('keyboard');
      e.step(1);
      expect(actions.map((a) => e.controls.label(a)), 'on the keyboard').toEqual(['LMB', 'Space', '1', '2', 'F']);
      // every key and pad button the table names for the bar is one the hero reads for that action (heroCodes of its token)
      const reads: Record<string, readonly string[]> = { attack: heroCodes(HERO_KEYS.attack), dodge: heroCodes(HERO_KEYS.dodge), ...Object.fromEntries(HERO_KEYS.slots.slice(0, 4).map((k, i) => [`skill${i + 1}`, heroCodes(k)])), interact: heroCodes(HERO_KEYS.slots[4]) };
      for (const [action, codes] of Object.entries(reads)) {
        const c: Control = (g.controls as ControlTable)[action]!;
        expect(codes, action).toEqual(expect.arrayContaining([c.key, ...(c.pad ? [c.pad] : [])]));
      }
      // the pad button the dodge prompt names rolls, the attack's swings
      g.hero.teleport([0, 0, 10]);
      g.hero.facing = Math.PI / 2;
      e.step(10);
      tap(g.controls.dodge.pad);
      e.step(2);
      expect(g.hero.state, `${g.controls.dodge.pad} dodges`).toBe('dodge');
      e.step(40);
      const before = g.hero.stats.attacks;
      tap(g.controls.attack.pad);
      e.step(30);
      expect(g.hero.stats.attacks - before, `${g.controls.attack.pad} attacks`).toBe(1);
    },
    T,
  );

  it(
    'a kill emits kill and death; the corpse pops with particles and is removed after its flicker',
    () => {
      const victim = g.dummies.find((d) => d.alive && d.name === 'dummy')!;
      victim.life = 1;
      victim.brain = null;
      g.hero.teleport([victim.position.x, 0, victim.position.z + 1.4]);
      g.hero.facing = Math.PI;
      e.step(6);
      const from = e.frame;
      e.input.setKey('KeyJ', true);
      e.step(24);
      e.input.setKey('KeyJ', false);
      expect(log.filter((l) => l.type === 'kill' && l.frame >= from).length, 'kill events').toBeGreaterThanOrEqual(1);
      expect(log.filter((l) => l.type === 'death' && l.frame >= from).length, 'death events').toBeGreaterThanOrEqual(1);
      expect(victim.body.position.y > 0.05 || !victim.body.visible, 'the corpse pops').toBe(true);
      expect(e.particles.alive, 'with particles').toBeGreaterThan(0);
      e.step(120);
      expect(g.actors.actors.includes(victim), 'the corpse is removed').toBe(false);
      expect(e.errors).toEqual([]);
    },
    T,
  );
});

describe('the arena at every window shape, on every device', () => {
  // fill gives the art the window's shape: 960×720 is 320 art columns, 768×1024 a tablet in
  // portrait, 390×844 a phone (130 columns); the skill bar goes beside the bars or under them
  it.each([
    [1280, 720],
    [960, 720],
    [768, 1024],
    [390, 844],
  ])(
    '%i×%i: the bars, the skill bar and the status fit the screen and none overlaps another; the bar shows the pad\'s buttons on a pad',
    async (width, height) => {
      const e = await headlessGame(new Arena(), { viewport: { width, height, dpr: 1 } });
      try {
        e.step(3);
        for (const device of ['keyboard', 'pad'] as const) {
          e.input.noteDevice(device);
          const lines = hudTexts(e);
          const names = lines.map((l) => l.text);
          expect(names, 'the skill bar\'s names').toEqual(expect.arrayContaining(['CLEAV', 'FIREB', 'WHIRL']));
          if (device === 'keyboard') expect(names, 'its keys (the mouse button is drawn)').toEqual(expect.arrayContaining(['1', '2', '3', '4', 'F']));
          else expect(names, 'its pad buttons, by their caps').toEqual(expect.arrayContaining(['L1', 'R1', 'R2']));
          for (const l of lines) expect(l.x >= 0 && l.x + l.w <= e.hud.width, `"${l.text}" (${l.x}..${l.x + l.w}) inside ${e.hud.width} columns`).toBe(true);
          for (const [i, a] of lines.entries()) for (const b of lines.slice(i + 1)) expect(hudOverlap(a, b), `"${a.text}" / "${b.text}" (${device})`).toBe(false);
        }
        expect(e.errors).toEqual([]);
      } finally {
        e.dispose();
      }
    },
    T,
  );

  it('keeps every slot clear of the bars and of the next slot at any width', () => {
    for (let width = 120; width <= 700; width += 7) {
      const lay = arenaHudLayout(width, 6);
      lay.slots.forEach((s, i) => {
        expect(s.x - 15 >= 0 && s.x + 15 <= width, `slot ${i} at ${width}`).toBe(true);
        const next = lay.slots[i + 1];
        if (next && next.y === s.y) expect(next.x - s.x, `slots ${i}, ${i + 1} at ${width}`).toBeGreaterThanOrEqual(30);
        // on the bars' rows only right of them
        if (s.y < lay.barsY + 20 && s.y + 17 > lay.barsY) expect(s.x - 15, `slot ${i} right of the bars at ${width}`).toBeGreaterThanOrEqual(104);
      });
    }
  });
});

describe('the arena with the engine hotkeys on (?debug=1)', () => {
  it(
    'moves the resolution hotkey off R, a skill key, to F2 (mode stays on P)',
    async () => {
      const e = await headlessGame(new Arena(), { debugKeys: true });
      try {
        expect(e.debugKeys.resolution).toEqual(['F2']);
        expect(e.debugKeys.mode).toEqual(['KeyP']);
      } finally {
        e.dispose();
      }
    },
    T,
  );
});
