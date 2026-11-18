// Riftlight on a controller, headless: the right stick aims with aim assist and the cone auto-aim
// picks the monster ahead; Options pauses from any screen and resumes; the codex is in the pause
// menu; the map opens on Tab, M, R3 and the touchpad's press; the pad rumbles on the moments that
// matter and the DualSense's light bar says how the hero is (through a fake 52in1); the portal plays
// from the controller's speaker. A fake standard pad (`input.setGamepads`) drives it, as a DualSense
// in Chrome would. One engine for the file, tests in order.
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HubSettingsSource } from '../../engine';
import { AIM } from '../actors/aim';
import type { ActorLike, Item } from '../core/types';
import type { RealLoot } from '../wire/loot';
import { type HeadlessRiftlight, headlessRiftlight, hudTexts, pointAtArt } from '../headless';
import { t } from '../lang';
import { cameraBasis } from './controls';
import { LEVEL_GAP, RUMBLE } from './padFeel';

const T = 30_000;
let h: HeadlessRiftlight;
/** What the fake 52in1 was asked to colour its light bar, in order. */
const lights: (string | null)[] = [];

/** A pad in the standard layout: the left stick `l`, the right stick `r` (y down, as the Gamepad API has it), `pressed` buttons down. */
const pad = (pressed: number[] = [], l: [number, number] = [0, 0], r: [number, number] = [0, 0]) => ({ connected: true, mapping: 'standard', index: 0, axes: [...l, ...r], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
/** Pad button `b` pressed for a frame and let go. */
const tap = (b: number) => {
  h.engine.input.setGamepads([pad([b])]);
  h.engine.step(1);
  h.engine.input.setGamepads([pad()]);
  h.engine.step(1);
};
const stack = () => h.rl.state().ui;
const aim = () => (h.game as unknown as { intent: { aim: Vector3 } }).intent.aim;

beforeAll(async () => {
  const hub: HubSettingsSource = { dualsense: { connected: true, lightbar: true, triggers: true, motion: false, touchpad: false, speaker: false, aim: true, light: (c: string | null) => void lights.push(c), trigger: () => {} } as never };
  h = await headlessRiftlight({ seed: 515, options: { hubSettings: hub } });
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('Riftlight on a controller', () => {
  it('the light bar is the hub’s on the title, the rift’s orange in town', () => {
    expect(lights.at(-1) ?? null, 'the title leaves it to the hub').toBeNull();
    h.rl.newRun({ seed: 515 });
    h.engine.step(2);
    expect(lights.at(-1), 'the town: the game’s own colour').toBe('#ef7d57');
  });

  it(
    'Options pauses from any screen and resumes from the pause menu; Circle resumes too; the codex is in the pause menu',
    () => {
      const { rl, engine } = h;
      engine.input.setGamepads([pad()]);
      engine.step(1);
      tap(9); // Options
      expect(stack(), 'Options pauses').toEqual(['pause']);
      expect(rl.ui.widgets().map((w) => w.id), 'the codex is on the pause menu, the developer tools are not').toEqual(expect.arrayContaining(['codex']));
      expect(rl.ui.widgets().map((w) => w.id)).not.toContain('dev');
      tap(9);
      expect(stack(), 'Options on the pause menu resumes').toEqual([]);
      tap(9);
      tap(1); // Circle
      expect(stack(), 'Circle resumes').toEqual([]);
      tap(8); // Create: the inventory
      expect(stack()).toEqual(['inventory']);
      tap(9);
      expect(stack(), 'Options over the inventory: closed, paused').toEqual(['pause']);
      rl.ui.click('inventory');
      expect(stack(), 'pause → Inventory').toEqual(['pause', 'inventory']);
      tap(9);
      expect(stack(), 'Options resumes from what opened over the pause menu too').toEqual([]);
      tap(9);
      rl.ui.click('codex');
      expect(stack(), 'pause → Codex').toEqual(['pause', 'codex']);
      tap(1);
      expect(stack(), 'Circle back to the pause menu').toEqual(['pause']);
      tap(9);
      // the keyboard: Esc is back first, then pause
      rl.press('KeyI');
      expect(rl.press('Escape').ui, 'Esc closes the inventory, no pause menu').toEqual([]);
      expect(rl.press('Escape').ui).toEqual(['pause']);
      expect(rl.press('Escape').ui).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the right stick aims along itself, snapped to a monster close to its line; without it the monster ahead wins over a closer one behind',
    async () => {
      const { rl, game, engine } = h;
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false; // the monsters stand where they are put
      game.dev.god = true;
      for (const m of game.level!.monsters()) m.actor.life = 0; // the level's own pack: out of the way
      engine.step(2);
      const p = game.hero.actor.position.clone();
      const right = new Vector3();
      const forward = new Vector3();
      cameraBasis(engine, right, forward);
      // A: 3 m to the screen's right; B: 6 m up the screen
      const at = (r: number, f: number) => p.clone().addScaledVector(right, r).addScaledVector(forward, f);
      const a = rl.spawn({ seed: 7, x: at(3, 0).x, z: at(3, 0).z })!;
      const b = rl.spawn({ seed: 8, x: at(0, 6).x, z: at(0, 6).z })!;
      engine.step(2);
      const pos = (id: number) => (game.level!.actors() as readonly ActorLike[]).find((x) => x.id === id)!.position;
      /** The right stick held at screen angle `deg` (0 = right, 90 = up the screen) for a few frames. */
      const stick = (deg: number, lean = 0.9) => {
        const r = (deg * Math.PI) / 180;
        engine.input.setGamepads([pad([], [0, 0], [Math.cos(r) * lean, -Math.sin(r) * lean])]);
        engine.step(3);
      };
      stick(10); // 10° above A's line
      expect(engine.input.device).toBe('pad');
      expect(aim().distanceTo(pos(a.id)), 'snapped to A').toBeLessThan(1e-6);
      stick(82); // 8° off B's
      expect(aim().distanceTo(pos(b.id)), 'snapped to B').toBeLessThan(1e-6);
      stick(225); // down and left: nobody near that line
      const along = aim().clone().sub(game.hero.actor.position).setY(0);
      expect(along.length(), 'aims its reach along the stick').toBeCloseTo(AIM.reach, 3);
      expect(along.normalize().dot(right.clone().add(forward).normalize().negate()), 'down and left').toBeGreaterThan(0.99);
      stick(10, 0.2); // a stick barely leaning: not aiming (the cone auto-aim along the facing instead)
      engine.input.setGamepads([pad()]);
      engine.step(2);
      // the left stick toward B (up the screen): B, ahead, wins over A, closer but off to the side
      engine.input.setGamepads([pad([], [0, -0.5])]);
      engine.step(2);
      expect(aim().distanceTo(pos(b.id)), 'the monster ahead').toBeLessThan(1e-6);
      engine.input.setGamepads([pad()]);
      engine.step(2);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it('the map opens over the play on Tab, M, R3 and the touchpad’s press; the world runs on under it', () => {
    const { rl, game, engine } = h;
    expect(game.mapOpen).toBe(false);
    rl.press('Tab');
    expect(game.mapOpen, 'Tab').toBe(true);
    const texts = hudTexts(engine, 2).map((x) => x.text);
    expect(texts, 'its title').toContain(t('hud.map.title'));
    expect(texts, 'and how to close it').toContain(t('hud.map.close'));
    const from = game.hero.actor.position.clone();
    engine.input.setGamepads([pad([], [0.9, 0])]);
    engine.step(30);
    engine.input.setGamepads([pad()]);
    engine.step(1);
    expect(game.hero.actor.position.distanceTo(from), 'the hero walks on under it').toBeGreaterThan(1);
    expect(rl.state().paused).toBe(false);
    expect(game.mapOpen).toBe(true);
    rl.press('KeyM');
    expect(game.mapOpen, 'M closes it').toBe(false);
    tap(11); // R3
    expect(game.mapOpen, 'R3').toBe(true);
    tap(17); // the DualSense's touchpad, pressed
    expect(game.mapOpen, 'the touchpad').toBe(false);
    expect(engine.errors).toEqual([]);
  });

  it('the light bar is the hero’s life in a level: green, amber, red pulsing under a quarter', () => {
    const { game, engine } = h;
    game.dev.god = false;
    const hero = game.hero.actor;
    hero.life = hero.stats.get('life');
    engine.step(1);
    expect(lights.at(-1)).toBe('#38b764');
    hero.life = hero.stats.get('life') * 0.4;
    engine.step(1);
    expect(lights.at(-1), 'amber').toBe('#ffcd75');
    hero.life = hero.stats.get('life') * 0.1;
    engine.step(80);
    expect(new Set(lights.slice(-3)), 'red, pulsing').toEqual(new Set(['#b13e53', '#5d275d']));
    const sent = lights.length;
    hero.life = hero.stats.get('life') * 0.4;
    engine.step(5);
    expect(lights.length - sent, 'sent only when it changes').toBe(1);
    hero.life = hero.stats.get('life');
    engine.step(1);
  });

  it(
    'the pad rumbles on a hit taken (by its size), a crit dealt, a level-up (two pulses), the portal opening and the hero’s death; nothing in menus',
    async () => {
      const { rl, game, engine } = h;
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false;
      const rumble = vi.spyOn(engine.input, 'rumble');
      try {
        const hero = game.hero.actor;
        const foe = game.level!.monsters().find((m) => m.actor.alive)!.actor;
        hero.takeHit({ source: foe, tags: ['test'], damage: { physical: hero.stats.get('life') * 0.05 }, crit: false });
        const small = rumble.mock.calls.at(-1)![0];
        hero.takeHit({ source: foe, tags: ['test'], damage: { physical: hero.stats.get('life') * 0.3 }, crit: false });
        const big = rumble.mock.calls.at(-1)![0];
        expect(big.strong!, 'a bigger hit rumbles harder').toBeGreaterThan(small.strong!);
        expect(big.ms!, 'and longer').toBeGreaterThan(small.ms!);
        hero.life = hero.stats.get('life');
        rumble.mockClear();
        foe.takeHit({ source: hero, tags: ['test'], damage: { physical: 1 }, crit: true });
        expect(rumble.mock.calls.map((c) => c[0]), 'a crit dealt').toContainEqual(RUMBLE.crit);
        // a rare landing in view, then a loud one (a unique): the unique chimes from the speaker too
        rumble.mockClear();
        const play = vi.spyOn(engine.audio, 'play');
        const drop = (uid: string, rarity: 'rare' | 'unique') => {
          (game.ports.loot as RealLoot).spawn([{ kind: 'item', item: { uid, base: 'leather-belt', rarity, level: 5, name: 'Belt', affixes: [] } as unknown as Item }], hero.position.clone(), game.level!, game.services.rng);
          engine.step(60);
        };
        drop('pad-rare', 'rare');
        expect(rumble.mock.calls.map((c) => c[0]), 'a rare lands').toContainEqual(RUMBLE.rare);
        drop('pad-unique', 'unique');
        expect(rumble.mock.calls.map((c) => c[0]), 'a loud one lands').toContainEqual(RUMBLE.loud);
        expect(play.mock.calls.filter((c) => String(c[0]).startsWith('loot-')).map((c) => c[1]), 'the loud one from the speaker').toEqual([{}, { volume: 1, bus: 'speaker' }]);
        play.mockRestore();
        rumble.mockClear();
        rl.give({ levels: 1 });
        expect(rumble.mock.calls.map((c) => c[0]), 'a level-up’s first pulse').toEqual([RUMBLE.levelUp[0]]);
        engine.step(Math.ceil(LEVEL_GAP * 60) + 2);
        expect(rumble.mock.calls.map((c) => c[0]), 'and its second, a beat later').toEqual([RUMBLE.levelUp[0], RUMBLE.levelUp[1]]);
        rumble.mockClear();
        rl.killAll();
        engine.step(30);
        expect(rl.state().exitOpen).toBe(true);
        expect(rumble.mock.calls.map((c) => c[0]), 'the portal opens').toContainEqual(RUMBLE.portal);
        rumble.mockClear();
        hero.takeHit({ source: foe, tags: ['test'], damage: { chaos: 1e9 }, crit: false });
        engine.step(2);
        expect(rl.state().dead).toBe(true);
        expect(rumble.mock.calls.map((c) => c[0]), 'the hero falls').toContainEqual(RUMBLE.death);
        engine.step(4);
        expect(lights.at(-1), 'dead: dim plum').toBe('#5d275d');
        engine.step(120); // the recap
        expect(stack()).toContain('death');
        rumble.mockClear();
        tap(0); // Cross: back to town
        engine.step(2);
        expect(rl.state().screen).toBe('town');
        expect(rumble, 'nothing in menus').not.toHaveBeenCalled();
      } finally {
        rumble.mockRestore();
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it('entering a level plays the portal from the controller’s speaker (with the other sounds without one)', async () => {
    const { rl, engine } = h;
    const play = vi.spyOn(engine.audio, 'play');
    try {
      await rl.enterDepth(1);
      expect(play.mock.calls.find((c) => c[0] === 'rl.portal')?.[1]).toEqual({ bus: 'speaker' });
    } finally {
      play.mockRestore();
    }
  });

  it('holding the mouse button keeps the mouse’s aim with the mouse still (hitting a boss)', () => {
    const { game, engine } = h;
    engine.input.setGamepads(null);
    engine.input.noteDevice('keyboard');
    pointAtArt(engine, Math.round(game.ui.w * 0.8), Math.round(game.ui.h * 0.3));
    engine.step(2);
    engine.input.setButtons(1);
    engine.step(60 * 8); // 8 s held, the mouse still
    expect(game.pointer.idle, 'the mouse is in use while its button is held').toBeLessThan(1);
    engine.input.setButtons(0);
    engine.step(60 * 7);
    expect(game.pointer.idle, 'let go and still: it goes idle').toBeGreaterThan(6);
  });

  it('Shift+Tab is the tab before (the stash’s tabs); Triangle hides the look studio and shows it again', () => {
    const { rl, game, engine } = h;
    rl.toTown();
    engine.step(2);
    expect(rl.talkTo('stash').state.ui).toEqual(['stash']);
    const items = (game.ports.loot as unknown as { ui: { stashTab: number } }).ui;
    expect(items.stashTab).toBe(0);
    rl.press('Tab');
    expect(items.stashTab, 'Tab: the next tab').toBe(1);
    engine.input.setKey('ShiftLeft', true);
    rl.press('Tab');
    engine.input.setKey('ShiftLeft', false);
    expect(items.stashTab, 'Shift+Tab: the one before').toBe(0);
    rl.press('Escape');
    expect(stack()).toEqual([]);
    engine.input.setGamepads([pad()]);
    engine.step(1);
    rl.ui.open('look');
    engine.step(1);
    expect(game.layer.peeking).toBe(false);
    tap(3); // Triangle
    expect(game.layer.peeking, 'hidden').toBe(true);
    tap(3);
    expect(game.layer.peeking, 'shown again').toBe(false);
    game.layer.closeAll();
    engine.input.setGamepads(null);
    expect(engine.errors).toEqual([]);
  });

  it('back on the title the light bar is the hub’s again', () => {
    h.rl.toTitle();
    h.engine.step(2);
    expect(lights.at(-1)).toBeNull();
  });
});
