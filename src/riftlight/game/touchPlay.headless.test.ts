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
import type { Box } from '../ui/layout';
import type { RealLoot } from '../wire/loot';
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
      const shake = rl.ui.widgets().find((w) => w.id === 'zoom' || w.id === 'shake');
      const track = (top().panel as unknown as { rects: Map<string, Box> }).rects.get(`${shake?.id}:track`);
      if (track) {
        swipe(mid(track).x, mid(track).y, 'right');
        expect(stack(), 'sideways on a slider moves it').toEqual(['settings']);
      }
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
    'the item windows: down from a window\'s title bar closes them; from an item it is a drag, not a dismissal',
    () => {
      const { rl, engine, game } = h;
      expect(rl.ui.open('inventory')).toBe(true);
      engine.step(2);
      const win = (game.ports.loot as RealLoot).ui!.rects()[0]!;
      swipe(win.x + 30, win.y + 60, 'down');
      expect(stack(), 'from the paper doll: open').toEqual(['inventory']);
      swipe(win.x + 30, win.y + 6, 'down');
      expect(stack(), 'from the title bar: closed').toEqual([]);
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
      if (equip) {
        tapAt(mid(equip.rect).x, mid(equip.rect).y);
        expect(findItem(ui.store.state.inventory, item.uid), 'out of the bag: worn').toBeUndefined();
      }
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

describe('in town by touch', () => {
  it(
    'a tap on the interact prompt does what F does (the stash opens); a swipe on an NPC\'s line over its panel ends the talk',
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
      // Brann's anvil: his line over the panel
      expect(rl.talkTo('brann').ok).toBe(true);
      engine.step(2);
      const line = (game as unknown as { touchable: { dialogue: Box | null } }).touchable.dialogue;
      expect(line, 'his line shows').not.toBeNull();
      expect(stack().length).toBeGreaterThan(0);
      swipe(mid(line!).x, mid(line!).y, 'right');
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
});
