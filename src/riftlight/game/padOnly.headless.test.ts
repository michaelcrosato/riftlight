// Riftlight on a pad alone, headless: a whole visit played through `setGamepads` only (no key, no
// click, no helper that moves the hero or presses for it), the way a player at ten feet plays it:
// the title and a save slot (Cross), the town walked with the left stick, Vex's rift menu (R2, the
// interact button, then Cross), a level (cleared by the test: combat is not what this checks), its
// portal (R2) and the loot window there (Return to town), Ilsa's shop (R2, Circle), the inventory (Create), the map in a level (R3), and
// the pause menu's Settings → Controller → Button prompts set to Xbox with the d-pad (Options,
// Cross, Circle), the prompts then Xbox's. Then the keyboard and mouse on the same screens: K opens
// the codex, and a pointer moving onto a menu row focuses it (hover) while a resting pointer leaves
// the d-pad's focus alone.
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight, pointAtArt, settle } from '../headless';
import { cameraBasis } from './controls';
import { HeroWalk } from './walk';

const T = 90_000;
let h: HeadlessRiftlight;

/** A standard-mapping pad in slot 0: `pressed` buttons down, the left stick at `l` (y down is +). */
const pad = (pressed: number[] = [], l: [number, number] = [0, 0]) => ({ connected: true, mapping: 'standard', index: 0, axes: [...l, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
const B = { cross: 0, circle: 1, r2: 7, create: 8, options: 9, r3: 11, up: 12, down: 13, left: 14, right: 15 } as const;
/** Button `b` down for a frame, then up for a frame. */
const tap = (b: number) => {
  h.engine.input.setGamepads([pad([b])]);
  h.engine.step(1);
  h.engine.input.setGamepads([pad()]);
  h.engine.step(1);
};
const stack = () => h.rl.state().ui;
/** The d-pad moves the top menu's focus down to row `id` (it wraps). */
const focusTo = (id: string) => {
  for (let i = 0; i < 40; i++) {
    const ws = h.rl.ui.widgets();
    if (ws.find((w) => w.focus)?.id === id) return;
    if (!ws.some((w) => w.id === id)) throw new Error(`no row "${id}" in ${ws.map((w) => w.id).join(', ')}`);
    tap(B.down);
  }
  throw new Error(`the d-pad never reached "${id}"`);
};
/**
 * The left stick walks the hero to (x, z): the route the bot would take (`HeroWalk`), turned into
 * where the stick leans on screen (the camera's right and up), as a player steers.
 */
const walkTo = (x: number, z: number, radius: number, max = 1500) => {
  const { game, engine } = h;
  const walk = new HeroWalk(game.hero.actor.position);
  const goal = new Vector3(x, 0, z);
  const right = new Vector3();
  const forward = new Vector3();
  const screen = game.screen;
  for (let f = 0; f < max && game.screen === screen; f++) {
    const p = game.hero.actor.position;
    if (Math.hypot(x - p.x, z - p.z) <= radius) break;
    const move = { x: 0, z: 0 };
    if (game.level) walk.level(game.level, p, goal, move);
    else walk.town(game.town, p, goal, move);
    const len = Math.hypot(move.x, move.z) || 1;
    cameraBasis(engine, right, forward);
    const sx = (move.x * right.x + move.z * right.z) / len;
    const sy = (move.x * forward.x + move.z * forward.z) / len;
    engine.input.setGamepads([pad([], [sx, -sy])]);
    engine.step(1);
  }
  engine.input.setGamepads([pad()]);
  engine.step(1);
  const p = game.hero.actor.position;
  return Math.hypot(x - p.x, z - p.z) <= radius + 0.05;
};
/** Frames run (promises settle between them) until `done`, or throws after `max`. */
const until = async (done: () => boolean, what: string, max = 1200) => {
  for (let f = 0; f < max; f++) {
    if (done()) return;
    h.engine.step(1);
    await settle();
  }
  throw new Error(`never: ${what}`);
};

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 828 });
  h.engine.input.setGamepads([pad()]);
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('Riftlight on a pad alone', () => {
  it(
    'title → a save slot → the town walked by stick → Vex (R2) → a level → its portal home (R2) → Ilsa’s shop → the inventory → Settings → Xbox prompts',
    async () => {
      const { rl, game, engine } = h;
      expect(rl.state().screen).toBe('title');
      tap(B.cross); // New Run
      expect(stack(), 'Cross on New Run: the slot picker').toContain('slots');
      tap(B.cross); // slot 1
      await until(() => game.screen === 'town', 'the town');
      expect(engine.input.device).toBe('pad');
      // Vex, walked to by stick; R2 talks (the rift menu); Cross on its first entry: depth 1
      const vex = game.town.interactables.find((x) => x.id === 'vex')!;
      expect(walkTo(vex.position.x, vex.position.z, Math.min(1.2, vex.radius - 0.4)), 'the stick walks to Vex').toBe(true);
      expect(game.interactOffer(), 'Vex in reach').not.toBeNull();
      tap(B.r2);
      expect(stack(), 'R2: the rift menu').toEqual(['rift']);
      tap(B.cross);
      await until(() => game.screen === 'level', 'the level');
      expect(rl.state().depth).toBe(1);
      // the map: R3 opens and closes it
      tap(B.r3);
      expect(game.mapOpen, 'R3: the map').toBe(true);
      tap(B.r3);
      expect(game.mapOpen).toBe(false);
      // the level cleared (the test's hand: combat is not what this checks), its portal walked to by stick, R2 home
      rl.killAll();
      rl.pickupAll();
      engine.step(30);
      expect(rl.state().exitOpen).toBe(true);
      const exit = game.level!.exit;
      expect(walkTo(exit.x, exit.z, 1.5), 'the stick walks to the portal').toBe(true);
      tap(B.r2);
      // what was left on the ground: the loot window, its first row focused; up wraps to its last
      // row, Return to town
      if (stack().includes('loot')) {
        tap(B.up);
        tap(B.cross);
      }
      await until(() => game.screen === 'town', 'home through the portal');
      // Ilsa's shop: R2 opens it, Circle closes it
      const ilsa = game.town.interactables.find((x) => x.id === 'ilsa')!;
      expect(walkTo(ilsa.position.x, ilsa.position.z, Math.min(1.2, ilsa.radius - 0.4)), 'the stick walks to Ilsa').toBe(true);
      tap(B.r2);
      expect(stack(), 'R2: Ilsa’s shop').toEqual(['vendor']);
      tap(B.circle);
      expect(stack(), 'Circle closes it').toEqual([]);
      // the inventory: Create opens and closes it
      tap(B.create);
      expect(stack()).toEqual(['inventory']);
      tap(B.circle);
      expect(stack()).toEqual([]);
      // Options → Settings → Controller → Button prompts: Xbox, by the d-pad and Cross
      expect(engine.controls.style, 'PlayStation’s by default').toBe('playstation');
      tap(B.options);
      expect(stack()).toEqual(['pause']);
      focusTo('settings');
      tap(B.cross);
      expect(stack().at(-1)).toBe('settings');
      focusTo('controller');
      tap(B.cross);
      expect(stack().at(-1)).toBe('controller');
      focusTo('padGlyphs');
      tap(B.right);
      expect([engine.settings.values.padGlyphs, engine.controls.style], 'Xbox’s buttons').toEqual(['xbox', 'xbox']);
      tap(B.circle);
      tap(B.circle);
      expect(stack(), 'Circle back to the pause menu').toEqual(['pause']);
      tap(B.options);
      expect(stack(), 'Options resumes').toEqual([]);
      // and back to PlayStation's for the rest
      engine.settings.set({ padGlyphs: 'playstation' });
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});

describe('the same screens on the keyboard and mouse', () => {
  it(
    'K opens the codex and Esc closes it; a pointer moving onto a menu row focuses it, a resting one leaves the d-pad’s focus alone, a click acts',
    () => {
      const { rl, engine } = h;
      engine.input.setGamepads([]);
      engine.step(1);
      expect(rl.press('KeyK').ui, 'K: the codex').toEqual(['codex']);
      expect(rl.press('Escape').ui).toEqual([]);
      expect(rl.press('Escape').ui).toEqual(['pause']);
      const rows = rl.ui.widgets().filter((w) => w.rect && w.kind === 'button');
      expect(rows.length).toBeGreaterThan(3);
      const focused = () => rl.ui.widgets().find((w) => w.focus)?.id;
      // the pointer moves onto the third row: it is focused
      const third = rows[2]!;
      const r = third.rect!;
      pointAtArt(engine, 2, 2);
      engine.step(1);
      pointAtArt(engine, r.x + r.w / 2, r.y + r.h / 2);
      engine.step(1);
      expect(focused(), 'hover focuses the row under the pointer').toBe(third.id);
      // the arrow keys move the focus on; the pointer resting on the third row does not take it back
      rl.press('ArrowDown');
      engine.step(3);
      expect(focused(), 'a resting pointer leaves the keys’ focus').not.toBe(third.id);
      // a click on the first row acts on it (Resume)
      const first = rows[0]!;
      expect(first.id).toBe('resume');
      pointAtArt(engine, first.rect!.x + 4, first.rect!.y + 4);
      engine.step(1);
      pointAtArt(engine, first.rect!.x + 4, first.rect!.y + 4, true);
      engine.step(1);
      pointAtArt(engine, first.rect!.x + 4, first.rect!.y + 4, false);
      engine.step(2);
      expect(rl.state().ui, 'a click on Resume resumes').toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
