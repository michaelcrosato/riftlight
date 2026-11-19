// Riftlight's windows hold the hero, headless: with the inventory, the skills, the character
// sheet, the stash, the vendor or the anvil open, the d-pad, the left stick, WASD and the arrows
// move the window's focus and leave the hero where it stands (the world runs on: none of them is
// modal); the stash, the vendor and the anvil close once the hero is out of their reach. One engine
// for the file, tests in order.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import type { CharacterSheet } from '../ui/panels';
import type { RealLoot } from '../wire/loot';

const T = 60_000;
let h: HeadlessRiftlight;

/** A pad in the standard layout: the left stick `l`, `pressed` buttons down. */
const pad = (pressed: number[] = [], l: [number, number] = [0, 0]) => ({ connected: true, mapping: 'standard', index: 0, axes: [...l, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
const stack = () => h.rl.state().ui;
const loot = () => h.game.ports.loot as RealLoot;

/**
 * The ways a player pushes: the d-pad, the left stick, WASD, the arrows; each held right or left
 * for `frames` frames (the stick half a second: a menu steps on a held stick after its repeat delay).
 */
type Way = 'd-pad' | 'stick' | 'WASD' | 'arrows';
const WAYS: readonly Way[] = ['d-pad', 'stick', 'WASD', 'arrows'];
const push = (way: Way, dir: 1 | -1, frames = way === 'stick' ? 30 : 12) => {
  const input = h.engine.input;
  if (way === 'd-pad' || way === 'stick') {
    input.setGamepads([way === 'd-pad' ? pad([dir > 0 ? 15 : 14]) : pad([], [0.9 * dir, 0])]);
    h.engine.step(frames);
    input.setGamepads([pad()]);
  } else {
    const code = way === 'WASD' ? (dir > 0 ? 'KeyD' : 'KeyA') : dir > 0 ? 'ArrowRight' : 'ArrowLeft';
    input.setKey(code, true);
    h.engine.step(frames);
    input.setKey(code, false);
  }
  h.engine.step(3);
};

/** Where the window's focus is: the item windows' cursor, the character sheet's page. */
const focus = (panel: string): string => {
  if (panel === 'character') return String((h.game.layer.find('character') as CharacterSheet).page);
  const ui = loot().itemsUi();
  return `${ui.cursor.x},${ui.cursor.y}`;
};

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 6161 });
  h.rl.newRun({ slot: 1, seed: 6161 });
  h.engine.input.setGamepads([pad()]);
  h.engine.step(3);
}, T);
afterAll(() => h?.engine.dispose());
beforeEach(() => h?.game.layer.closeAll()); // a test that failed leaves no window over the next

describe('a window that takes navigation holds the hero', () => {
  it(
    'with no window open the same pushes walk the hero (what the windows hold back)',
    () => {
      for (const way of WAYS) {
        const at = h.game.hero.actor.position.clone();
        push(way, way === 'stick' || way === 'arrows' ? -1 : 1);
        expect(h.game.hero.actor.position.distanceTo(at), `${way} walks the hero`).toBeGreaterThan(0.3);
      }
    },
    T,
  );

  for (const [panel, open] of [
    ['inventory', () => h.rl.ui.open('inventory')],
    ['skills', () => h.rl.ui.open('skills')],
    ['character', () => h.rl.ui.open('character')],
    ['stash', () => h.rl.talkTo('stash').ok],
    ['vendor', () => h.rl.talkTo('ilsa').ok],
    ['crafting', () => h.rl.talkTo('brann').ok],
  ] as const) {
    it(
      `${panel}: the d-pad, the stick, WASD and the arrows move its focus and leave the hero where it is`,
      () => {
        expect(open(), `${panel} opens`).toBe(true);
        expect(stack()).toEqual([panel]);
        expect(h.game.worldPaused, 'not modal: the world runs on').toBe(false);
        h.engine.step(2);
        for (const way of WAYS) {
          for (const dir of [1, -1] as const) {
            const at = h.game.hero.actor.position.clone();
            const was = focus(panel);
            push(way, dir);
            expect(stack(), `${panel} stays open (${way})`).toEqual([panel]);
            expect(h.game.hero.actor.position.distanceTo(at), `${panel}: ${way} ${dir > 0 ? 'right' : 'left'} leaves the hero where it is`).toBeLessThan(1e-3);
            expect(focus(panel), `${panel}: ${way} ${dir > 0 ? 'right' : 'left'} moves the focus`).not.toBe(was);
          }
        }
        h.rl.press('Escape');
        expect(stack()).toEqual([]);
        expect(h.engine.errors).toEqual([]);
      },
      T,
    );
  }

  it(
    'the stash, the vendor and the anvil close once the hero is out of their reach; one the agent API opened stays',
    () => {
      const { rl, game, engine } = h;
      for (const [id, panel] of [
        ['stash', 'stash'],
        ['ilsa', 'vendor'],
        ['brann', 'crafting'],
      ] as const) {
        expect(rl.talkTo(id).ok, `${id}: open`).toBe(true);
        expect(stack()).toEqual([panel]);
        const it = game.town.interactables.find((x) => x.id === id)!;
        const p = game.hero.actor.position;
        // carried off (an agent's walk, a shove): a step past its reach
        const away = p.clone().sub(it.position).setY(0).normalize().multiplyScalar(it.radius + 1).add(it.position).setY(p.y);
        game.hero.enter(game.town, away, 0);
        engine.step(2);
        expect(stack(), `${panel} closes out of ${id}'s reach`).toEqual([]);
      }
      expect(rl.ui.open('vendor')).toBe(true);
      engine.step(3);
      expect(stack(), 'opened from afar (the agent API): no place to leave').toEqual(['vendor']);
      rl.press('Escape');
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
