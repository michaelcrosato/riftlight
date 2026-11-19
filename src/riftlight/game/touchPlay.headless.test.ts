// Riftlight played by touch on a landscape phone (844×390 at DPR 2, touch controls: the art the
// page draws, 422×195), headless: what a finger's swipes dismiss (a panel from its frame or title
// bar, never a sticky one, never one a scroll or a slider takes; the centre banner; the loot feed;
// an NPC's line; the item windows from a title bar), that a finger acts on a menu as it lets go
// (a swipe across it presses nothing), a finger's taps on a loot label and the interact prompt,
// the item windows' action buttons, and the assists (auto attack, aim assist): touch only, each a
// setting, decided from recorded input so a recording replays to the same fingerprint. One engine
// for the file, tests in order. The touches go through the engine's input as the canvas sends them
// (`Touch` and its position, a swipe's press).
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Engine, SWIPE_KEYS, type SwipeDirection } from '../../engine';
import { TOUCH_AIM } from '../actors/aim';
import type { Item } from '../core/types';
import { type HeadlessRiftlight, headlessRiftlight, makeRiftlight } from '../headless';
import { t } from '../lang';
import { findItem } from '../loot/inventory';
import { type Box, overlaps } from '../ui/layout';
import type { RealLoot } from '../wire/loot';
import { HEADER } from '../ui/items/ItemsUi';
import type { HeroIntent } from './ports';

const T = 60_000;
const VIEW = { width: 844, height: 390, dpr: 2 };
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 909, viewport: VIEW, options: { touch: true } });
  h.engine.input.noteTouch();
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

/** A finger goes down (or up) at art pixel (x, y) on the canvas, as the page's canvas tells the engine. */
function finger(x: number, y: number, down: boolean, engine: Engine = h.engine): void {
  const { width, height } = engine.renderer.resolution;
  engine.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2);
  (engine.input.pointer as { touch: boolean }).touch = true;
  (engine.input as unknown as { button(code: string, down: boolean): void }).button('Touch', down);
}

/** A tap at (x, y): down, a frame, up, a frame. */
function tapAt(x: number, y: number, engine: Engine = h.engine): void {
  finger(x, y, true, engine);
  engine.step(1);
  finger(x, y, false, engine);
  engine.step(1);
}

/** A quick flick from (x, y) `dir`ward: the finger down there, then up with the swipe's press (the canvas makes one). */
function swipe(x: number, y: number, dir: SwipeDirection, engine: Engine = h.engine): void {
  const d = { left: [-40, 0], right: [40, 0], up: [0, -40], down: [0, 40] }[dir];
  finger(x, y, true, engine);
  engine.step(1);
  finger(x + d[0]!, y + d[1]!, false, engine);
  engine.input.setKey(SWIPE_KEYS[dir], true);
  engine.step(1);
  engine.input.setKey(SWIPE_KEYS[dir], false);
  engine.step(1);
}

const stack = () => h.rl.state().ui;
const top = () => h.game.layer.top!;
const mid = (r: Box) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
const inside = (r: Box, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** A finger held down slides to art pixel (x, y) (its button stays as it is). */
function slide(x: number, y: number, engine: Engine = h.engine): void {
  const { width, height } = engine.renderer.resolution;
  engine.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2);
  (engine.input.pointer as { touch: boolean }).touch = true;
}

/** Each fixed step's attack intent while `run` runs (the hero's steps, as it gets them). */
function attacks(run: () => void, engine: Engine = h.engine, game = h.game): boolean[] {
  const out: boolean[] = [];
  const step = game.hero.fixedUpdate.bind(game.hero);
  const spy = vi.spyOn(game.hero, 'fixedUpdate').mockImplementation((dt: number, i: HeroIntent) => (out.push(i.attack), step(dt, i)));
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  void engine;
  return out;
}

describe('a finger swipes away what it starts on', () => {
  it(
    'a panel from its frame: sideways or down closes it as back does (the pause menu resumes); up does not, nor a swipe that starts off it',
    () => {
      const { rl, engine } = h;
      rl.newRun({ slot: 1, seed: 909 });
      engine.input.noteTouch();
      engine.step(2);
      expect(engine.renderer.resolution).toEqual({ width: 422, height: 195 });
      rl.ui.open('pause');
      engine.step(2);
      const r = top().rect;
      swipe(mid(r).x, mid(r).y, 'up');
      expect(stack(), 'up: no').toEqual(['pause']);
      swipe(2, 2, 'left'); // off the panel
      expect(stack(), 'a swipe that starts off it: no').toEqual(['pause']);
      swipe(mid(r).x, mid(r).y, 'left');
      expect(stack(), 'left from it: closed, the game resumed').toEqual([]);
      expect(rl.state().paused).toBe(false);
      rl.ui.open('pause');
      engine.step(2);
      swipe(mid(top().rect).x, mid(top().rect).y, 'down');
      expect(stack(), 'down from it: closed').toEqual([]);
    },
    T,
  );

  it(
    'a finger acts on a menu as it lets go where it went down: a swipe across a button presses nothing',
    () => {
      const { rl, engine } = h;
      rl.ui.open('pause');
      engine.step(2);
      const resume = rl.ui.widgets().find((w) => w.id === 'resume')!.rect!;
      // down on Resume, drag off it, let go: nothing
      finger(resume.x + 4, resume.y + 4, true);
      engine.step(1);
      finger(resume.x + 30, resume.y + 4, false);
      engine.step(2);
      expect(stack(), 'dragged off: nothing pressed').toEqual(['pause']);
      tapAt(resume.x + 4, resume.y + 4);
      expect(stack(), 'a tap presses it').toEqual([]);
    },
    T,
  );

  it(
    'a list that scrolls keeps a swipe up or down for itself, a slider its sideways one; its title bar still closes it; a sticky panel never',
    () => {
      const { rl, engine, game } = h;
      rl.ui.open('settings');
      engine.step(2);
      const r = top().rect;
      swipe(mid(r).x, mid(r).y, 'down');
      expect(stack(), 'down on the list scrolls it').toEqual(['settings']);
      // the screen shake's slider, scrolled into view as the d-pad would (focus the row under it, then up)
      const ids = rl.ui.widgets().map((w) => w.id);
      const menu = top().panel as unknown as { focusId(id: string): boolean; input(e: { kind: 'nav'; dir: 'up' }): boolean; rects: Map<string, Box>; items(): { id: string; get?: () => number }[] };
      expect(menu.focusId(ids[ids.indexOf('shake') + 1]!)).toBe(true);
      menu.input({ kind: 'nav', dir: 'up' });
      engine.step(2);
      expect(rl.ui.widgets().find((w) => w.focus)?.id).toBe('shake');
      const track = menu.rects.get('shake:track');
      expect(track, 'the slider in view').toBeDefined();
      const shake = menu.items().find((w) => w.id === 'shake')!;
      const was = shake.get!();
      swipe(mid(track!).x, mid(track!).y, 'right');
      expect(stack(), 'sideways on a slider moves it').toEqual(['settings']);
      expect(shake.get!(), 'the slider moved, the menu stayed').not.toBe(was);
      swipe(r.x + 10, r.y - 8, 'down');
      expect(stack(), 'down from the title bar closes it').toEqual([]);
      void game;
    },
    T,
  );

  it(
    'with no panel: the centre banner from where it shows, the loot feed from one of its lines',
    async () => {
      const { rl, engine, game } = h;
      await rl.enterDepth(1);
      rl.dev.ai = false;
      engine.input.noteTouch();
      engine.step(30);
      const banner = game.hudRects().zones.find((z) => z.id === 'banner');
      expect(banner, 'the level card shows').toBeDefined();
      const shown = (game as unknown as { banners: { current: unknown } }).banners;
      swipe(mid(banner!).x, mid(banner!).y, 'up');
      expect(shown.current, 'swiped away').toBeNull();
      // a line in the feed (gold picked up), swiped from
      rl.give({ gold: 50 });
      (game as unknown as { feed: { text: string; color: string; t: number }[] }).feed.unshift({ text: 'Ember Bead', color: 'white', t: 0.5 });
      engine.step(2);
      const feed = (game as unknown as { touchable: { feed: Box[] } }).touchable.feed;
      expect(feed.length, 'the feed shows').toBeGreaterThan(0);
      swipe(mid(feed[0]!).x, mid(feed[0]!).y, 'right');
      expect((game as unknown as { feed: unknown[] }).feed, 'cleared').toEqual([]);
      // the death recap can't be swiped away
      rl.dev.god = false;
      (game.hero.actor as unknown as { die(by: null): void }).die(null);
      for (let f = 0; f < 240 && !stack().includes('death'); f++) engine.step(1);
      expect(stack()).toContain('death');
      swipe(mid(top().rect).x, mid(top().rect).y, 'left');
      expect(stack(), 'sticky: it stays').toContain('death');
      rl.ui.click('continue');
      engine.step(5);
      await rl.enterDepth(1);
      rl.dev.ai = false;
      rl.dev.god = true;
      engine.input.noteTouch();
      engine.step(5);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a finger that lands on the banner or a feed line is no swing however long it stays down and slides (auto attack off)',
    async () => {
      const { rl, engine, game } = h;
      await rl.enterDepth(1);
      rl.dev.ai = false;
      engine.input.noteTouch();
      game.settings.touchAutoAttack = false;
      try {
        engine.step(30);
        const banner = game.hudRects().zones.find((z) => z.id === 'banner');
        expect(banner, 'the level card shows').toBeDefined();
        (game as unknown as { feed: { text: string; color: string; t: number }[] }).feed.unshift({ text: 'Ember Bead', color: 'white', t: 0.5 });
        engine.step(2);
        const feed = (game as unknown as { touchable: { feed: Box[] } }).touchable.feed;
        expect(feed.length, 'the feed shows').toBeGreaterThan(0);
        for (const [name, from] of [
          ['the banner', mid(banner!)],
          ['a feed line', mid(feed[0]!)],
        ] as const) {
          const seen = attacks(() => {
            finger(from.x, from.y, true);
            for (let k = 1; k <= 10; k++) {
              slide(from.x + k * 3, from.y);
              engine.step(1);
            }
            finger(from.x + 30, from.y, false);
            engine.step(1);
          });
          expect(seen.length, `${name}: steps ran`).toBeGreaterThan(8);
          expect(seen.filter(Boolean).length, `${name}: no swing while the finger slides`).toBe(0);
        }
        // a finger on the world, held as long, does swing (after its wait): the check above can fail
        const world = attacks(() => {
          finger(200, 120, true);
          engine.step(10);
          finger(200, 120, false);
          engine.step(1);
        });
        expect(world.some(Boolean), 'a finger on the world swings').toBe(true);
      } finally {
        game.settings.touchAutoAttack = true;
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the item windows: down, left or right from a window\'s title bar closes them, as every framed panel; from an item it is a drag, not a dismissal; up does not',
    () => {
      const { rl, engine, game } = h;
      for (const view of ['inventory', 'skills', 'stash', 'crafting'] as const)
        for (const dir of ['down', 'left', 'right'] as const) {
          expect(rl.ui.open(view)).toBe(true);
          engine.step(2);
          const wins = (game.ports.loot as RealLoot).ui!.rects();
          const win = wins.at(-1)!; // the left window when there is one
          swipe(win.x + 30, win.y + 60, dir);
          expect(stack(), `${view}, ${dir} from inside it: open`).toEqual([view]);
          swipe(win.x + 30, win.y + 6, 'up');
          expect(stack(), `${view}, up from its title bar: open`).toEqual([view]);
          swipe(win.x + 30, win.y + 6, dir);
          expect(stack(), `${view}, ${dir} from its title bar: closed`).toEqual([]);
        }
    },
    T,
  );
});

describe("a finger's taps", () => {
  it(
    'on a loot label picks the item up (walking there) and is no swing; on the interact prompt it does what F does',
    () => {
      const { rl, engine, game } = h;
      const loot = game.ports.loot as RealLoot;
      const p = game.hero.actor.position;
      const item = loot.give(game.services.rng, 1)!;
      loot.spawn([{ kind: 'item', item }], new Vector3(p.x + 2.5, 0, p.z), game.level!, game.services.rng);
      engine.step(40);
      const labels = (game as unknown as { touchable: { loot: { id: number; rect: Box }[] } }).touchable.loot;
      expect(labels.length, 'its label shows').toBeGreaterThan(0);
      const intents: boolean[] = [];
      const step = game.hero.fixedUpdate.bind(game.hero);
      const spy = vi.spyOn(game.hero, 'fixedUpdate').mockImplementation((dt: number, i: HeroIntent) => (intents.push(i.attack), step(dt, i)));
      const before = rl.state().loot.items;
      tapAt(mid(labels[0]!.rect).x, mid(labels[0]!.rect).y);
      for (let f = 0; f < 120 && rl.state().loot.items >= before; f++) engine.step(1);
      spy.mockRestore();
      expect(rl.state().loot.items, 'picked up').toBe(before - 1);
      expect(intents.includes(true), 'no swing').toBe(false);
    },
    T,
  );

  it(
    'on a loot label in a frame no fixed step runs in (a 120 Hz screen) is no swing either, held for frames: the item is picked up',
    () => {
      const { rl, engine, game } = h;
      game.settings.touchAutoAttack = false;
      try {
        const loot = game.ports.loot as RealLoot;
        const p = game.hero.actor.position;
        loot.spawn([{ kind: 'item', item: loot.give(game.services.rng, 1)! }], new Vector3(p.x + 2.5, 0, p.z), game.level!, game.services.rng);
        engine.step(40);
        const labels = (game as unknown as { touchable: { loot: { id: number; rect: Box }[] } }).touchable.loot;
        expect(labels.length, 'its label shows').toBeGreaterThan(0);
        const at = mid(labels[0]!.rect);
        const before = rl.state().loot.items;
        const physics = engine.physics as unknown as { accumulator: number };
        if (physics.accumulator > 0) engine.step(1, 1 / 60 - physics.accumulator);
        expect(physics.accumulator, 'a zero accumulator').toBeCloseTo(0, 9);
        const first = attacks(() => {
          finger(at.x, at.y, true);
          engine.step(1, 1 / 120); // the frame it lands in: no fixed step
        });
        expect(first.length, 'no fixed step in the frame the finger landed in').toBe(0);
        const held = attacks(() => {
          engine.step(8, 1 / 120); // held a while
          finger(at.x, at.y, false);
          for (let f = 0; f < 240 && rl.state().loot.items >= before; f++) engine.step(1, 1 / 120);
        });
        expect(held.length).toBeGreaterThan(3);
        expect(held.filter(Boolean).length, 'no swing').toBe(0);
        expect(rl.state().loot.items, 'picked up').toBe(before - 1);
      } finally {
        game.settings.touchAutoAttack = true;
      }
    },
    T,
  );

  it(
    'two fingers on the world a frame or two apart are a pinch: no swing; one finger alone swings once it has stayed down a moment, and so does a held mouse button at once',
    () => {
      const { engine, game } = h;
      const input = engine.input as unknown as { unpress(code: string): void };
      game.settings.touchAutoAttack = false;
      try {
        engine.step(2);
        for (const apart of [1, 2]) {
          const seen = attacks(() => {
            finger(200, 120, true);
            engine.step(apart);
            // the second finger lands: the canvas lets go of the first's press (`Input.attachPointer`), and the pinch zooms
            input.unpress('Touch');
            engine.step(10);
          });
          expect(seen.filter(Boolean).length, `a second finger ${apart} frame(s) later: no swing`).toBe(0);
        }
        // the first finger lands in a frame no fixed step runs in (120 Hz), and the second comes
        // before any step read it: its press is still queued when a step comes, and is no swing
        const physics = engine.physics as unknown as { accumulator: number };
        if (physics.accumulator > 0) engine.step(1, 1 / 60 - physics.accumulator);
        expect(physics.accumulator, 'a zero accumulator').toBeCloseTo(0, 9);
        const unread = attacks(() => {
          finger(200, 120, true);
          engine.step(1, 1 / 120); // no fixed step: nobody read the press yet
          input.unpress('Touch'); // the second finger
          engine.step(10);
        });
        expect(unread.filter(Boolean).length, 'a pinch whose first finger no step saw: no swing').toBe(0);
        // one finger alone: it swings from its third step
        const alone = attacks(() => {
          finger(200, 120, true);
          engine.step(6);
          finger(200, 120, false);
          engine.step(1);
        });
        expect(alone.slice(0, 3), 'it waits two steps after the one it landed in').toEqual([false, false, true]);
        // the mouse's button swings at once
        const mouse = attacks(() => {
          engine.input.setPointer(0.1, -0.1, true);
          engine.step(2);
          engine.input.setPointer(0.1, -0.1, false);
          engine.step(1);
        });
        expect(mouse[0], 'a click swings at once').toBe(true);
        // a finger again (the pointer a finger's: no mouse aim after)
        slide(200, 120);
        engine.input.noteTouch();
        engine.step(2);
      } finally {
        game.settings.touchAutoAttack = true;
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});

describe("a finger's assists", () => {
  /** A monster at (dx, dz) from the hero, idle. */
  const spawnAt = (dx: number, dz: number) => {
    const p = h.game.hero.actor.position;
    return h.rl.spawn({ seed: 1000 + Math.round(dx * 10 + dz), x: p.x + dx, z: p.z + dz })!;
  };
  /** The intents the hero gets over `frames` frames. */
  const intents = (frames: number): { attack: boolean; aim: Vector3 }[] => {
    const out: { attack: boolean; aim: Vector3 }[] = [];
    const step = h.game.hero.fixedUpdate.bind(h.game.hero);
    const spy = vi.spyOn(h.game.hero, 'fixedUpdate').mockImplementation((dt: number, i: HeroIntent) => (out.push({ attack: i.attack, aim: i.aim.clone() }), step(dt, i)));
    h.engine.step(frames);
    spy.mockRestore();
    return out;
  };
  const clear = () => {
    h.rl.killAll();
    h.engine.step(60);
  };

  it(
    'auto attack: a monster in reach is swung at with no button held, on touch only, not while the stick points away, not with the setting off',
    () => {
      const { engine, game } = h;
      clear();
      game.dev.god = true;
      spawnAt(1.6, 0);
      engine.input.noteTouch();
      engine.step(2);
      expect(intents(20).some((i) => i.attack), 'touch: it swings').toBe(true);
      engine.input.noteDevice('keyboard');
      engine.step(2);
      expect(intents(20).some((i) => i.attack), 'the keyboard: it does not').toBe(false);
      engine.input.noteTouch();
      game.settings.touchAutoAttack = false;
      engine.step(2);
      expect(intents(20).some((i) => i.attack), 'the setting off: it does not').toBe(false);
      game.settings.touchAutoAttack = true;
      // the stick leaning away from it: the player gets away (the camera's right is +x on screen... any way: away from the monster)
      const m = h.rl.actors()[0]!;
      const hp = game.hero.actor.position;
      const away = { x: hp.x - m.position[0]!, z: hp.z - m.position[2]! };
      const right = new Vector3();
      const forward = new Vector3();
      game.ctx.engine.camera.camera.matrixWorld.extractBasis(right, new Vector3(), forward);
      right.setY(0).normalize();
      forward.negate().setY(0).normalize();
      const len = Math.hypot(away.x, away.z);
      engine.input.analog.x = (away.x * right.x + away.z * right.z) / len;
      engine.input.analog.y = (away.x * forward.x + away.z * forward.z) / len;
      expect(intents(6).some((i) => i.attack), 'kiting: no swing').toBe(false);
      engine.input.analog.x = engine.input.analog.y = 0;
      engine.step(2);
    },
    T,
  );

  it(
    'aim assist: with the stick on a farther monster, the aim goes to it, not to the nearer one beside; off, auto-aim stands',
    () => {
      const { engine, game } = h;
      clear();
      game.settings.touchAutoAttack = false; // the aim alone
      // a far monster along one way and a nearer one 45° off it (auto-aim's wide cone would take the
      // nearer: the assist's narrow one takes the one the stick points at), where the level has floor
      const alive = (m: { id: number } | null) => !!m && h.rl.actors().some((a) => a.id === m.id);
      let near: { id: number } | null = null;
      let far: { id: number } | null = null;
      for (const [fx, fz, nx, nz] of [
        [4.5, 0, 2, 2],
        [-4.5, 0, -2, -2],
        [0, 4.5, 2, 2],
        [0, -4.5, -2, -2],
      ] as const) {
        clear();
        far = spawnAt(fx, fz);
        near = spawnAt(nx, nz);
        engine.step(2);
        if (alive(far) && alive(near)) break;
      }
      expect(alive(far) && alive(near), 'two monsters stand').toBe(true);
      const pos = (id: number) => new Vector3().fromArray(h.rl.actors().find((a) => a.id === id)!.position);
      // the stick toward the far one
      const hp = game.hero.actor.position;
      const to = pos(far!.id).clone().sub(hp);
      const right = new Vector3();
      const forward = new Vector3();
      game.ctx.engine.camera.camera.matrixWorld.extractBasis(right, new Vector3(), forward);
      right.setY(0).normalize();
      forward.negate().setY(0).normalize();
      const len = Math.hypot(to.x, to.z);
      engine.input.analog.x = (to.x * right.x + to.z * right.z) / len;
      engine.input.analog.y = (to.x * forward.x + to.z * forward.z) / len;
      const aimed = intents(2).at(-1)!.aim;
      const target = pos(far!.id);
      expect(Math.hypot(aimed.x - target.x, aimed.z - target.z), 'at the monster the stick points at').toBeLessThan(0.5);
      expect(TOUCH_AIM.cone).toBeLessThan(45);
      // the assist off: auto-aim's wide cone, the nearer one
      game.settings.touchAimAssist = false;
      const wide = intents(2).at(-1)!.aim;
      const other = pos(near!.id);
      expect(Math.hypot(wide.x - other.x, wide.z - other.z), 'off: auto-aim, the nearer one').toBeLessThan(0.5);
      game.settings.touchAimAssist = true;
      engine.input.analog.x = engine.input.analog.y = 0;
      game.settings.touchAutoAttack = true;
      clear();
    },
    T,
  );
});

describe('the item windows by touch', () => {
  it(
    'a tap picks an item: under its tooltip a row of buttons a thumb can hit (Equip, Move); Equip equips it',
    () => {
      const { rl, engine, game } = h;
      rl.toTown();
      engine.step(5);
      const loot = game.ports.loot as RealLoot;
      // a ring in the bag (equipment that fits an empty slot)
      const item = loot.give(game.services.rng, 1)! as Item;
      expect(loot.add(item)).toBe(true);
      expect(rl.ui.open('inventory')).toBe(true);
      engine.step(2);
      const ui = loot.ui! as unknown as { touchActions(): { id: string; label: string; rect: Box }[]; cellCenter(where: 'inventory', x: number, y: number): { x: number; y: number }; store: { state: { inventory: Parameters<typeof findItem>[0] } } };
      const placed = findItem(ui.store.state.inventory, item.uid);
      expect(placed, 'in the bag').toBeDefined();
      const at = ui.cellCenter('inventory', placed!.x, placed!.y);
      tapAt(at.x, at.y);
      const acts = ui.touchActions();
      expect(acts.map((a) => a.label), 'its buttons').toEqual(expect.arrayContaining([t('item.act.move')]));
      for (const a of acts) expect(a.rect.h * 2, `${a.label}: a thumb tall (44 CSS px)`).toBeGreaterThanOrEqual(44);
      const equip = acts.find((a) => a.label === t('item.act.equip'));
      expect(equip, `equipment in the bag offers Equip (${acts.map((a) => a.label).join(', ')})`).toBeDefined();
      tapAt(mid(equip!.rect).x, mid(equip!.rect).y);
      expect(findItem(ui.store.state.inventory, item.uid), 'out of the bag: worn').toBeUndefined();
      rl.ui.close();
      engine.step(2);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});

describe('the item windows by touch in portrait', () => {
  it(
    'a picked item\'s buttons fit the narrow screen (in rows when one is too narrow), each a thumb tall',
    async () => {
      const p = await headlessRiftlight({ seed: 31, viewport: { width: 390, height: 844, dpr: 3 }, options: { touch: true } });
      try {
        p.rl.newRun({ slot: 1, seed: 31 });
        p.engine.input.noteTouch();
        p.rl.give({ items: 3 });
        expect(p.rl.ui.open('stash')).toBe(true);
        p.engine.step(2);
        const ui = (p.game.ports.loot as RealLoot).ui! as unknown as { touchActions(): { label: string; rect: Box }[]; cellCenter(where: 'inventory', x: number, y: number): { x: number; y: number }; store: { state: { inventory: Parameters<typeof findItem>[0] } } };
        const first = ui.store.state.inventory.items[0]!;
        const at = ui.cellCenter('inventory', first.x, first.y);
        tapAt(at.x, at.y, p.engine);
        const acts = ui.touchActions();
        expect(acts.map((a) => a.label), 'equip, to the stash, move').toEqual(expect.arrayContaining([t('item.act.to_stash'), t('item.act.move')]));
        const { width, height } = p.engine.renderer.resolution;
        for (const a of acts) {
          expect(a.rect.x >= 0 && a.rect.y >= 0 && a.rect.x + a.rect.w <= width && a.rect.y + a.rect.h <= height, `${a.label} on screen ${JSON.stringify(a.rect)} (${width}×${height})`).toBe(true);
          expect(a.rect.h * 3, `${a.label}: a thumb tall`).toBeGreaterThanOrEqual(44);
        }
        // To stash moves it there
        const to = acts.find((a) => a.label === t('item.act.to_stash'))!;
        tapAt(mid(to.rect).x, mid(to.rect).y, p.engine);
        expect(findItem(ui.store.state.inventory, first.item.uid), 'out of the bag').toBeUndefined();
        expect(p.engine.errors).toEqual([]);
      } finally {
        p.engine.dispose();
      }
    },
    T,
  );
});

describe('a picked item\'s buttons and its tooltip', () => {
  it(
    'never cover each other nor a window\'s title bar: with room for neither (a tall tooltip on a phone) the buttons go on top and the tooltip under them, its name in view; with the stash or the vendor open the buttons keep off their title bars and close boxes',
    async () => {
      for (const [viewport, windows] of [
        [{ width: 844, height: 390, dpr: 2 }, 'inventory'],
        [{ width: 844, height: 390, dpr: 2 }, 'stash'],
        [{ width: 844, height: 390, dpr: 2 }, 'vendor'],
        [{ width: 390, height: 844, dpr: 3 }, 'inventory'],
        [{ width: 390, height: 844, dpr: 3 }, 'stash'],
        [{ width: 390, height: 844, dpr: 3 }, 'vendor'],
        [{ width: 1024, height: 768, dpr: 1 }, 'vendor'],
      ] as const) {
        const p = await headlessRiftlight({ seed: 21, viewport, options: { touch: true } });
        try {
          p.rl.newRun({ slot: 1, seed: 21 });
          p.engine.input.noteTouch();
          const loot = p.game.ports.loot as RealLoot;
          // deep, many-lined items: rares and uniques of level 40 (taller tooltips than the screen)
          const items: Item[] = [];
          for (let k = 0; k < 5; k++) {
            const it = loot.give(p.game.services.rng, 40, k % 2 ? 'rare' : 'unique')!;
            if (loot.add(it)) items.push(it);
          }
          expect(items.length).toBeGreaterThan(2);
          expect(p.rl.ui.open(windows)).toBe(true);
          p.engine.step(2);
          const ui = loot.ui! as unknown as {
            pickLayout(): { tip: Box; actions: { label: string; rect: Box }[] } | null;
            cellCenter(where: 'inventory', x: number, y: number): { x: number; y: number };
            rects(): Box[];
            store: { state: { inventory: Parameters<typeof findItem>[0] } };
          };
          const { width, height } = p.engine.renderer.resolution;
          const where = `${windows} at ${width}×${height}`;
          // each window's title bar: its name, its close box (and the Gems button)
          const bars = ui.rects().map((r) => ({ x: r.x, y: r.y, w: r.w, h: HEADER }));
          expect(bars.length, `${where}: the windows`).toBe(windows === 'inventory' ? 1 : 2);
          let tall = 0;
          for (const it of items) {
            const placed = findItem(ui.store.state.inventory, it.uid)!;
            const at = ui.cellCenter('inventory', placed.x, placed.y);
            // a tap on another item picks it, unless the last one's buttons are over it: put that down first
            if (ui.pickLayout()?.actions.some((a) => inside(a.rect, at.x, at.y))) (ui as unknown as { touchPick: string | null }).touchPick = null;
            tapAt(at.x, at.y, p.engine);
            const layout = ui.pickLayout()!;
            expect(layout, `${it.name} (${where}): picked`).not.toBeNull();
            expect(layout.actions.length, `${it.name}: its buttons`).toBeGreaterThan(0);
            const { tip } = layout;
            if (tip.h > height / 2) tall++;
            // its name, the tooltip's first line, on screen
            expect(tip.y >= 0 && tip.y + 12 <= height, `${it.name} (${where}): the tooltip's first line on screen ${JSON.stringify(tip)}`).toBe(true);
            for (const a of layout.actions) {
              expect(a.rect.x >= 0 && a.rect.y >= 0 && a.rect.x + a.rect.w <= width && a.rect.y + a.rect.h <= height, `${it.name} (${where}): ${a.label} on screen ${JSON.stringify(a.rect)}`).toBe(true);
              expect(overlaps(a.rect, tip), `${it.name} (${where}): ${a.label} ${JSON.stringify(a.rect)} over the tooltip ${JSON.stringify(tip)}`).toBe(false);
              for (const b of bars) expect(overlaps(a.rect, b), `${it.name} (${where}): ${a.label} ${JSON.stringify(a.rect)} over a title bar ${JSON.stringify(b)}`).toBe(false);
            }
          }
          if (windows === 'inventory' && width < 1000) expect(tall, 'tooltips taller than half the screen were tried').toBeGreaterThan(0);
          expect(p.engine.errors).toEqual([]);
        } finally {
          p.engine.dispose();
        }
      }
    },
    T,
  );
});

describe('a picked item\'s tooltip taller than the screen', () => {
  it(
    'scrolls with a finger\'s drag on it (its comparison with the gear comes into view), lets go with no tap, a finger resting on it is no long-press, and a swipe from it over a title bar closes nothing',
    async () => {
      let overBar = 0;
      for (const viewport of [
        { width: 360, height: 800, dpr: 3 },
        { width: 740, height: 360, dpr: 2 },
      ]) {
        const p = await headlessRiftlight({ seed: 33, viewport, options: { touch: true } });
        try {
          p.rl.newRun({ slot: 1, seed: 33 });
          p.engine.input.noteTouch();
          const loot = p.game.ports.loot as RealLoot;
          const ui = loot.itemsUi();
          expect(p.rl.ui.open('inventory')).toBe(true);
          p.engine.step(2);
          const where = `${p.engine.renderer.resolution.width}×${p.engine.renderer.resolution.height}`;
          // deep rares and uniques until one's tooltip (with "compared to equipped") is taller than the screen
          let tall: { uid: string; max: number } | null = null;
          for (let k = 0; k < 8 && !tall; k++) {
            const it = loot.give(p.game.services.rng, 40, k % 2 ? 'rare' : 'unique')!;
            if (!it) break;
            (ui as unknown as { touchPick: string | null }).touchPick = null;
            const at = ui.itemCenter(it.uid)!;
            tapAt(at.x, at.y, p.engine);
            const tip = ui.pickedTip();
            if (tip && tip.max > 0 && tip.lines.length) tall = { uid: it.uid, max: tip.max };
          }
          expect(tall, `${where}: a tooltip taller than the screen`).not.toBeNull();
          const all = (ui as unknown as { pickLayout(): { lines: { text: string; sep?: boolean }[]; shown: Box } }).pickLayout();
          const lines = all.lines.filter((l) => !l.sep).map((l) => l.text);
          const before = ui.pickedTip()!;
          expect(before.scroll).toBe(0);
          expect(before.lines[0], `${where}: its name in view`).toBe(lines[0]);
          expect(before.lines, `${where}: its last line cut off`).not.toContain(lines.at(-1));
          expect(lines.join(' '), 'its comparison with the gear (wrapped on a narrow screen)').toContain(t('item.tip.compared'));
          // a finger on the tooltip drags it up past its end: every line after the cut comes into view, the last at the bottom
          const s = all.shown;
          const from = { x: s.x + Math.floor(s.w / 2), y: s.y + s.h - 4 };
          const bag = JSON.stringify(loot.store.state.inventory);
          const gear = JSON.stringify(loot.store.state.equipment);
          finger(from.x, from.y, true, p.engine);
          p.engine.step(1);
          // a finger resting on it reads it: no long-press (the right-click: Equip, Use) on what is under it
          p.engine.step(40);
          expect(ui.pickedTip(), `${where}: a finger resting on it: still picked`).not.toBeNull();
          expect([JSON.stringify(loot.store.state.inventory), JSON.stringify(loot.store.state.equipment)], `${where}: nothing equipped or used`).toEqual([bag, gear]);
          for (let d = 4; d <= tall!.max + 12; d += 4) {
            slide(from.x, from.y - d, p.engine);
            p.engine.step(1);
          }
          finger(from.x, from.y - tall!.max - 12, false, p.engine);
          p.engine.step(2);
          const after = ui.pickedTip();
          expect(after, `${where}: still picked (no tap where the drag ended)`).not.toBeNull();
          expect(after!.scroll, `${where}: scrolled to its end`).toBe(tall!.max);
          expect(after!.lines.at(-1), `${where}: its last line in view`).toBe(lines.at(-1));
          expect(after!.lines.join(' '), `${where}: "compared to equipped" in view`).toContain(t('item.tip.compared'));
          expect(JSON.stringify(loot.store.state.inventory), 'nothing moved').toBe(bag);
          expect(p.rl.state().ui, 'the windows open').toEqual(['inventory']);
          // a flick down from the tooltip where it covers a title bar scrolls back, never closes the windows
          const bar = ui.rects().map((r) => ({ x: r.x, y: r.y, w: r.w, h: HEADER })).find((b) => overlaps(b, s));
          if (bar) overBar++;
          const on = bar ? { x: Math.max(bar.x, s.x) + 4, y: Math.max(bar.y, s.y) + 4 } : { x: from.x, y: s.y + 4 };
          swipe(on.x, on.y, 'down', p.engine);
          expect(p.rl.state().ui, `${where}: a swipe from the tooltip closes nothing`).toEqual(['inventory']);
          expect(ui.pickedTip()!.scroll, 'pulled down: back towards its top').toBeLessThan(tall!.max);
          expect(p.engine.errors).toEqual([]);
        } finally {
          p.engine.dispose();
        }
      }
      expect(overBar, 'a tooltip over a title bar was swiped from').toBeGreaterThan(0);
    },
    T,
  );
});

describe('in town by touch', () => {
  it(
    'a tap on the interact prompt does what F does (the stash opens); an NPC\'s line shows clear of the item windows: a swipe on it ends the talk, a tap puts it away',
    () => {
      const { rl, engine, game } = h;
      engine.input.noteTouch();
      const stash = game.town.interactables.find((x) => x.id === 'stash')!;
      rl.moveTo(stash.position.x, stash.position.z, { radius: Math.min(1.2, stash.radius - 0.4) });
      engine.step(3);
      const prompt = (game as unknown as { touchable: { prompt: Box | null } }).touchable.prompt;
      expect(prompt, 'the prompt shows').not.toBeNull();
      const zone = game.touchPad.stickZone();
      expect(zone, 'the floating stick has its zone on this page').not.toBeNull();
      expect(prompt!.x >= zone!.x + zone!.w || prompt!.y + prompt!.h <= zone!.y, `the prompt ${JSON.stringify(prompt)} is out of the stick's zone ${JSON.stringify(zone)}`).toBe(true);
      tapAt(mid(prompt!).x, mid(prompt!).y);
      engine.step(2);
      expect(stack(), 'the stash opened').toContain('stash');
      rl.ui.close();
      engine.step(2);
      // Brann's anvil: his line in free space, clear of the item windows (`talkPlace`)
      const line = () => (game as unknown as { touchable: { dialogue: Box | null } }).touchable.dialogue;
      expect(rl.talkTo('brann').ok).toBe(true);
      engine.step(2);
      const said = line()!;
      expect(said, 'his line shows').not.toBeNull();
      const talking = stack();
      expect(talking).toEqual(['crafting']);
      const windows = (game.ports.loot as RealLoot).ui!.rects();
      for (const w of windows) expect(said.x + said.w <= w.x || w.x + w.w <= said.x || said.y + said.h <= w.y || w.y + w.h <= said.y, `his line ${JSON.stringify(said)} clear of a window ${JSON.stringify(w)}`).toBe(true);
      // a tap on it puts it away (the press is the line's: the talk goes on)
      tapAt(mid(said).x, mid(said).y);
      engine.step(1);
      expect(line(), 'a tap put it away').toBeNull();
      expect(stack(), 'still at the anvil').toEqual(talking);
      rl.ui.close();
      engine.step(2);
      // a swipe on it ends the talk
      expect(rl.talkTo('brann').ok).toBe(true);
      engine.step(2);
      swipe(mid(line()!).x, mid(line()!).y, 'right');
      expect(stack(), 'the talk is over').toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});

describe('Settings on a touch screen', () => {
  it('shows a finger\'s assists on a page with touch controls only', async () => {
    const { rl, engine } = h;
    rl.ui.open('settings');
    engine.step(2);
    expect(rl.ui.widgets().map((w) => w.id)).toEqual(expect.arrayContaining(['touchAttack', 'touchAim']));
    rl.ui.close();
    const desk = await headlessRiftlight({ seed: 3 });
    desk.rl.ui.open('settings');
    desk.engine.step(2);
    expect(desk.rl.ui.widgets().map((w) => w.id)).not.toContain('touchAttack');
    desk.engine.dispose();
  });

  it(
    'a touch on a desktop\'s page (a touchscreen laptop: no touch controls, no assist rows) gets no assist: the hero swings only when told to',
    async () => {
      const desk = await headlessRiftlight({ seed: 4, viewport: { width: 1920, height: 1080, dpr: 1 } });
      try {
        const { engine, rl, game } = desk;
        expect(engine.renderer.touchDensity, 'no touch controls').toBe(0);
        rl.newRun({ slot: 1, seed: 4 });
        await rl.enterDepth(1);
        rl.dev.ai = false;
        rl.dev.god = true;
        engine.step(30);
        rl.killAll();
        engine.step(30);
        const p = game.hero.actor.position;
        expect(rl.spawn({ seed: 9, x: p.x + 1.6, z: p.z }), 'a monster in reach').toBeTruthy();
        engine.input.noteTouch();
        engine.step(2);
        rl.ui.open('settings');
        engine.step(2);
        expect(rl.ui.widgets().map((w) => w.id), 'Settings has no rows for them').not.toContain('touchAttack');
        rl.ui.close();
        engine.step(2);
        const swings: boolean[] = [];
        const step = game.hero.fixedUpdate.bind(game.hero);
        const spy = vi.spyOn(game.hero, 'fixedUpdate').mockImplementation((dt: number, i: HeroIntent) => (swings.push(i.attack), step(dt, i)));
        engine.input.noteTouch();
        engine.step(20);
        spy.mockRestore();
        expect(engine.input.device).toBe('touch');
        expect(swings.length).toBeGreaterThan(0);
        expect(swings.some(Boolean), 'no auto attack').toBe(false);
      } finally {
        desk.engine.dispose();
      }
    },
    T,
  );
});

describe('a touch session replays', () => {
  it(
    'auto attack and aim assist decide from recorded input: the replay ends on the same fingerprint',
    async () => {
      const { engine, game, rl } = await headlessRiftlight({ seed: 77, viewport: VIEW, options: { touch: true } });
      try {
        rl.newRun({ slot: 1, seed: 77 });
        await rl.enterDepth(1);
        engine.input.noteTouch();
        engine.step(30);
        const p = game.hero.actor.position;
        rl.spawn({ seed: 5, x: p.x + 1.8, z: p.z });
        rl.spawn({ seed: 6, x: p.x + 4, z: p.z + 3 });
        engine.step(2);
        await engine.restore(await engine.snapshot()); // the recording starts at this moment
        engine.input.analog.x = 0.6; // the stick, then let go: the auto attack and the aim assist decide
        engine.step(40);
        engine.input.analog.x = 0;
        engine.step(60);
        const live = engine.fingerprint();
        const rec = JSON.parse(JSON.stringify(engine.recording())) as Parameters<typeof engine.replay>[0];
        await engine.replay(rec, () => engine.loadGame(makeRiftlight(game.store, engine.seed)));
        expect(engine.fingerprint()).toBe(live);
        expect(engine.errors).toEqual([]);
      } finally {
        engine.dispose();
      }
    },
    T,
  );

  it(
    'from a save-state taken while a finger waits to swing: the wait is in the snapshot, and the replay swings on the same step',
    async () => {
      const { engine, game, rl } = await headlessRiftlight({ seed: 79, viewport: VIEW, options: { touch: true } });
      try {
        rl.newRun({ slot: 1, seed: 79 });
        await rl.enterDepth(1);
        rl.dev.ai = false;
        engine.input.noteTouch();
        game.settings.touchAutoAttack = false;
        engine.step(30);
        finger(200, 120, true, engine);
        engine.step(1); // its first step: it waits
        const shell = game as unknown as { fingerHeld: number };
        expect(shell.fingerHeld).toBe(1);
        const snap = await engine.snapshot();
        shell.fingerHeld = 9;
        await engine.restore(snap); // the recording starts at this moment, the finger down
        expect(shell.fingerHeld, 'restored').toBe(1);
        const live = attacks(() => engine.step(6), engine, game);
        expect(live.slice(0, 3), 'live: it swings on its second step from here').toEqual([false, true, true]);
        finger(200, 120, false, engine);
        engine.step(30);
        const print = engine.fingerprint();
        const rec = JSON.parse(JSON.stringify(engine.recording())) as Parameters<typeof engine.replay>[0];
        await engine.replay(rec, () => engine.loadGame(makeRiftlight(game.store, engine.seed)));
        expect(engine.fingerprint()).toBe(print);
        expect(engine.errors).toEqual([]);
      } finally {
        engine.dispose();
      }
    },
    T,
  );

  it(
    'from a save-state: a tap on a loot label in its first frame hits the label the replay saw too (what a finger can tap is in the snapshot)',
    async () => {
      const { engine, game, rl } = await headlessRiftlight({ seed: 78, viewport: VIEW, options: { touch: true } });
      try {
        rl.newRun({ slot: 1, seed: 78 });
        await rl.enterDepth(1);
        rl.dev.ai = false;
        engine.input.noteTouch();
        engine.step(30);
        const loot = game.ports.loot as RealLoot;
        const p = game.hero.actor.position;
        loot.spawn([{ kind: 'item', item: loot.give(game.services.rng, 1)! }], new Vector3(p.x + 2.5, 0, p.z), game.level!, game.services.rng);
        engine.step(40);
        const labels = (game as unknown as { touchable: { loot: { id: number; rect: Box }[] } }).touchable.loot;
        expect(labels.length, 'its label shows').toBeGreaterThan(0);
        const at = mid(labels[0]!.rect);
        const before = rl.state().loot.items;
        await engine.restore(await engine.snapshot()); // the recording starts at this moment
        tapAt(at.x, at.y, engine); // its first frame
        engine.step(150);
        expect(rl.state().loot.items, 'live: picked up').toBe(before - 1);
        const live = engine.fingerprint();
        const rec = JSON.parse(JSON.stringify(engine.recording())) as Parameters<typeof engine.replay>[0];
        expect(rec.from, 'a recording from a save-state').toBeDefined();
        await engine.replay(rec, () => engine.loadGame(makeRiftlight(game.store, engine.seed)));
        expect(engine.fingerprint()).toBe(live);
        expect(engine.errors).toEqual([]);
      } finally {
        engine.dispose();
      }
    },
    T,
  );
});
