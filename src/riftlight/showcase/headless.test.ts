// The showcase headless: the arcade cabinet and the Hall of Beasts played through the agent API
// and the engine's input (moved from e2e riftlight-showcase, whose pictures, photo mode and URL
// check stay in the browser); then what needs a page (pointer lock, a picture, a file download or
// picker) does nothing, and the game plays on. One engine for the file, tests in order.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FirstPersonRig, FreeRig, type HeadlessView, type HudColor } from '../../engine';
import { type HeadlessRiftlight, headlessRiftlight, pointAtArt, stepUntil } from '../headless';
import { t } from '../lang';
import { UiCanvas } from '../ui/kit';
import { hints } from './hints';
import { FOV_STEPS, nextFovStep } from './photo/PhotoMode';
import { showcaseOf } from './save';

const T = 30_000;
let h: HeadlessRiftlight;

/** Art pixel (x, y) in the engine's pointer coordinates (normalised device coordinates). */
const ndc = (x: number, y: number) => {
  const { width, height } = h.engine.renderer.resolution;
  return { x: ((x + 0.5) / width) * 2 - 1, y: 1 - ((y + 0.5) / height) * 2 };
};
/**
 * A finger on the canvas at art pixel (x, y), going down or lifting, for one frame: the pointer
 * event a phone's touch makes (a `Touch` button event where it is). With `look` the frame also
 * carries what that finger dragged (pixels) and, with `swipe`, the quick flick it made: what a
 * fast drag on a phone is to the game, a look and a swipe at once.
 */
const finger = (x: number, y: number, down: boolean, o: { look?: number; swipe?: 'SwipeLeft' | 'SwipeRight' } = {}) => {
  const input = h.engine.input;
  const at = ndc(x, y);
  input.pointer.x = at.x;
  input.pointer.y = at.y;
  input.pointer.over = true;
  const events = vi.spyOn(input, 'buttonEvents', 'get').mockReturnValue([{ code: 'Touch', down, x: at.x, y: at.y }]);
  if (o.look) input.addPointer(o.look, 0);
  if (o.swipe) input.setKey(o.swipe, true);
  try {
    h.engine.step(1);
  } finally {
    events.mockRestore();
    if (o.swipe) input.setKey(o.swipe, false);
  }
  h.engine.step(1);
};
/** A quick finger drag of `px` pixels from art (x, y): down, then up with the look and the swipe it makes. */
const flick = (x: number, y: number, px: number) => {
  finger(x, y, true);
  finger(x + px / 4, y, false, { look: px, swipe: px < 0 ? 'SwipeLeft' : 'SwipeRight' });
};

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 777 });
}, T);
afterAll(() => h?.engine.dispose());

describe('riftlight showcase: the arcade and the Hall of Beasts', () => {
  let physics0 = '';
  let entries: { name: string; rank: string }[] = [];

  it(
    'Emberfall has the arcade cabinet and the Hall of Beasts',
    () => {
      const { rl, game, engine } = h;
      rl.newRun({ slot: 0, seed: 777 });
      rl.setTimeOfDay(0.3);
      engine.step(20);
      const ids = game.town.interactables.map((i) => i.id);
      expect(ids).toContain('arcade');
      expect(ids).toContain('bestiary');
      physics0 = JSON.stringify(engine.physics.counts());
    },
    T,
  );

  it(
    'the Engine Workshop in town opens Engine World and its Asset Gallery (the run saved first); headless the page stays',
    () => {
      const { rl, game, engine } = h;
      const ids = game.town.interactables.map((i) => i.id);
      expect(ids).toEqual(expect.arrayContaining(['world', 'gallery']));
      const opened = vi.spyOn(game, 'engineWorld');
      const saved = vi.spyOn(game, 'autosave');
      expect(rl.talkTo('gallery').ok, 'walk to the easel and use it').toBe(true);
      expect(opened).toHaveBeenLastCalledWith('gallery');
      expect(saved).toHaveBeenLastCalledWith('engine world');
      expect(rl.talkTo('world').ok, 'walk to the ring and use it').toBe(true);
      expect(opened).toHaveBeenLastCalledWith(undefined);
      expect(opened).toHaveBeenCalledTimes(2);
      opened.mockRestore();
      saved.mockRestore();
      expect(rl.state().screen).toBe('town');
      expect(game.showcase.active).toBe(false);
      engine.step(10);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    "walk to the cabinet and use it (F): the camera swoops in behind an iris; inside, the side camera and the 16-bit + CRT look, still Riftlight's game with the town kept",
    async () => {
      const { rl, game, engine } = h;
      expect(rl.talkTo('arcade').ok, 'walk to the cabinet and use it').toBe(true);
      engine.step(20);
      expect(game.showcase.iris, 'an iris').not.toBeNull();
      expect(engine.camera.zoom, 'the camera swoops into the screen').toBeGreaterThan(1.6);
      await stepUntil(h.engine, () => rl.arcade.state().active && !game.showcase.iris && !!rl.arcade.state().phase, { max: 3600, every: 5, what: 'inside the cabinet' });
      const a = rl.arcade.state();
      expect(a.camera).toBe('side');
      expect(a.filters.join()).toBe('16bit,crt');
      expect(rl.state().screen, 'no loadGame: the town kept').toBe('town');
      expect(engine.game?.name).toBe('Riftlight');
      engine.step(80);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the scripted run reaches the flag with the platformer moveset (double jump, wall kick, a ground pound through the cracked floor), coins, a best time and a gold reward in the save',
    () => {
      const { rl, game } = h;
      const gold0 = rl.state().hero.gold;
      const stage = game.showcase.arcade.stage!;
      const states = new Set<string>();
      const jumps = new Set<string>();
      const orig = stage.fixedUpdate.bind(stage);
      stage.fixedUpdate = (...args: Parameters<typeof orig>) => {
        orig(...args);
        const hh = stage.hero?.hero;
        if (hh) {
          states.add(hh.state);
          if (hh.state === 'jump') jumps.add(String(hh.jumpKind));
        }
      };
      const a = rl.arcade.autoplay({ maxFrames: 60 * 60 });
      expect(a.phase, `the flag (${a.time}s, ${a.frames} frames)`).toBe('done');
      expect(a.result).not.toBeNull();
      expect([...jumps]).toEqual(expect.arrayContaining(['DoubleJump', 'WallKick']));
      expect(a.broken, 'the cracked floor broke').toBe(true);
      expect(states.has('groundPound'), 'a ground pound').toBe(true);
      expect(a.coins, 'coins collected by trigger volumes').toBeGreaterThan(10);
      expect(a.record.best).toBeGreaterThan(0);
      expect(Math.abs(a.record.best - a.time)).toBeLessThan(0.01);
      expect(a.result!.newBest, 'best time kept').toBe(true);
      expect(a.result!.reward).toBeGreaterThan(0);
      expect(rl.state().hero.gold - gold0, 'a small gold reward').toBe(a.result!.reward);
      const saved = (JSON.parse(rl.exportSave(0)!) as { data: { showcase?: { arcade?: { best?: number } } } }).data.showcase?.arcade?.best ?? 0;
      expect(Math.abs(saved - a.record.best), 'the best time is in the save slot').toBeLessThan(0.01);
    },
    T,
  );

  it(
    'Esc (Options, ≡) pauses the run, its clock stopped; Circle resumes (no crouch while held); the pause\'s Back to town walks back: iso camera, no filters, the hero shown, nothing left in the physics world',
    async () => {
      const { rl, game, engine } = h;
      const stage = game.showcase.arcade.stage!;
      game.showcase.arcade.restart();
      engine.step(120);
      rl.press('Escape');
      expect(game.showcase.pause?.items).toEqual(['resume', 'restart', 'photo', 'leave']);
      const clock = stage.time;
      engine.step(60);
      expect(stage.time, 'the run\'s clock stands still').toBe(clock);
      // Circle: back to the run, held a moment as a real press is (the run's hero does not crouch on it)
      engine.input.setKey('PadB', true);
      const states = new Set<string>();
      for (let i = 0; i < 8; i++) {
        engine.step(1);
        states.add(String(stage.hero?.hero?.state));
      }
      engine.input.setKey('PadB', false);
      engine.step(1);
      expect(game.showcase.pause).toBeNull();
      expect([...states].filter((s) => s.startsWith('crouch')), 'the Circle that resumed is not a crouch').toEqual([]);
      engine.step(30);
      expect(stage.time).toBeGreaterThan(clock);
      rl.press('Escape');
      rl.press('ArrowUp'); // from Resume round to the last row
      expect(game.showcase.pause?.list.index).toBe(3);
      rl.press('Enter');
      await stepUntil(h.engine, () => !game.showcase.active, { max: 120, every: 5, what: 'back in town' });
      expect(engine.camera.preset).toBe('iso');
      expect([...engine.filters]).toEqual([]);
      expect(game.hero.object.visible).toBe(true);
      expect(JSON.stringify(engine.physics.counts())).toBe(physics0);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the kills are in the bestiary; the Hall of Beasts in first person, every exhibit rebuilt from its genome, the boss first, lit by the light pool',
    async () => {
      const { rl, engine } = h;
      await rl.enterDepth(1);
      engine.step(5);
      rl.killAll();
      engine.step(5);
      rl.toTown();
      engine.step(5);
      entries = rl.bestiary.entries();
      expect(entries.length).toBeGreaterThanOrEqual(3);
      expect(entries[0]!.rank).toBe('boss');
      const b = await rl.bestiary.open();
      expect(b.active).toBe(true);
      expect(b.camera).toBe('first');
      expect(b.exhibits.length).toBe(Math.min(10, entries.length));
      expect(b.exhibits.map((e) => e.meshes).every((n) => n > 3), 'rebuilt from the genome').toBe(true);
      expect(b.exhibits[0]!.name, 'the boss stands first').toBe(entries[0]!.name);
      engine.step(30);
      const lights = engine.lights.stats();
      expect(lights.lit).toBeGreaterThan(0);
      expect(lights.requests).toBeGreaterThanOrEqual(b.exhibits.length);
    },
    T,
  );

  it(
    'W walks down the aisle; inspect: the orbit camera and the card; a clip plays; the Rift Altar breeds two kills and mutates the child; Tab flies; out of the hall: iso camera, physics as before',
    () => {
      const { rl, engine } = h;
      // a pad's R2 and Triangle are the hall's (inspect, walk / fly): the hero neither crouches nor grabs on them
      const states = new Set<string | null>();
      engine.input.setKey('PadRT', true);
      for (let i = 0; i < 8; i++) {
        engine.step(1);
        states.add(rl.bestiary.state().heroState);
      }
      engine.input.setKey('PadRT', false);
      if (rl.bestiary.state().view !== 'walk') rl.bestiary.view('walk');
      engine.step(10);
      expect([...states].filter((s) => s?.startsWith('crouch') || s === 'grab'), 'R2 does not crouch in the hall').toEqual([]);
      const z0 = rl.bestiary.state().hero[2]!;
      engine.input.setKey('KeyW', true);
      engine.step(40);
      engine.input.setKey('KeyW', false);
      engine.step(2);
      expect(rl.bestiary.state().hero[2]!, 'down the aisle').toBeLessThan(z0 - 1);
      let b = rl.bestiary.inspect(0);
      expect(b.view).toBe('inspect');
      expect(b.focus).toBe(entries[0]!.name);
      expect(b.camera).toBe('fixed');
      const clip = b.exhibits[0]!.clips.includes('Death') ? 'Death' : b.exhibits[0]!.clips.at(-1)!;
      const played = rl.bestiary.play(clip);
      expect(played.ok).toBe(true);
      expect(played.state.exhibits[0]!.clip).toBe(clip);
      engine.step(12);
      b = rl.bestiary.breed(0, 1);
      expect(b.child?.generation).toBe(1);
      expect(b.child!.parts).toBeGreaterThan(0);
      const seed1 = b.child!.seed;
      b = rl.bestiary.mutate();
      expect(b.child?.generation).toBe(2);
      expect(b.child!.seed).not.toBe(seed1);
      engine.step(40);
      expect(rl.bestiary.view('fly').camera).toBe('free');
      rl.bestiary.close();
      expect(h.game.showcase.active).toBe(false);
      expect(engine.camera.preset).toBe('iso');
      expect(JSON.stringify(engine.physics.counts())).toBe(physics0);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'on a pad and a phone: the card closes on Circle or a sideways swipe, every hint names a control that does it here, Options pauses (Photo mode in it), photo mode hides on L1 or Create, steps its field of view on R1 and backs out on Circle',
    async () => {
      const { rl, game, engine } = h;
      const sc = game.showcase;
      await rl.bestiary.open();
      try {
        rl.bestiary.inspect(0);
        rl.press('PadB');
        expect(rl.bestiary.state().view, 'Circle: back to the hall').toBe('walk');
        rl.bestiary.inspect(0);
        flick(engine.hud.width - 30, 26, 90); // from the card's name line
        expect(rl.bestiary.state().view, 'a sideways swipe from the card').toBe('walk');
        // the phone's interact button: LOOK at the exhibit in front, nothing in the arcade
        sc.bestiary.goTo(sc.bestiary.hall!.pedestals[0]!);
        engine.step(2);
        expect(sc.touch().interact?.verb).toBe(t('touch.verb.look'));
        engine.input.noteDevice('pad');
        // the card's way back is Circle; photo mode's, Options (Circle too, from flying)
        expect([t('showcase.hint.zoom'), t('showcase.hint.next_wing'), t('showcase.hint.photo'), t('showcase.hint.leave'), t('showcase.hint.card_back'), t('showcase.hint.back')]).toEqual(['R1 zoom', 'R1 next wing', 'Options photo', 'Options leave', 'Circle back', 'Options back']);
        rl.press('PadStart');
        expect(sc.pause?.items, 'Options: the pause, its Photo mode and Leave').toEqual(['resume', 'photo', 'leave']);
        rl.press('ArrowDown');
        rl.press('PadA');
        expect(sc.photo.active).toBe(true);
        const hidden = sc.photo.hidden;
        rl.press('PadBack');
        expect(sc.photo.hidden, 'Create hides the panel').toBe(!hidden);
        rl.press('PadBack');
        rl.press('PadLB');
        expect(sc.photo.hidden, 'L1 hides it too (photo_hide), as its hint says').toBe(!hidden);
        rl.press('PadLB');
        expect([t('showcase.hint.hide'), t('showcase.hint.field_of_view')]).toEqual(['L1 hide', 'R1 field of view']);
        // R1 steps the field of view closer, and from the closest back to the widest
        const rig = engine.camera as FreeRig;
        const steps: number[] = [];
        for (let i = 0; i <= FOV_STEPS.length; i++) {
          rl.press('PadRB');
          steps.push(rig.zoom);
        }
        expect(steps.slice(-FOV_STEPS.length - 1, -1).slice().sort((a, b) => a - b), 'every step once').toEqual([...FOV_STEPS]);
        expect(steps.at(-1), 'round again').toBe(nextFovStep(steps.at(-2)!));
        rl.press('PadY'); // into the panel's rows
        rl.press('PadB'); // Circle: out of the rows
        expect(sc.photo.active).toBe(true);
        rl.press('PadB'); // and out of photo mode
        expect(sc.photo.active).toBe(false);
        expect(sc.active, 'back in the hall').toBe(true);
      } finally {
        rl.bestiary.close();
      }
      // the town's prompts again: Options opens the pause menu there, where zoom is
      expect(engine.controls.table).toBe(game.controls);
      expect(t('showcase.hint.zoom')).toBe('Options zoom');
      engine.input.noteDevice('keyboard');
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a press the card, the pause or photo mode took is theirs: Cross or Space on the card\'s Back, or Cross on photo mode\'s Back to game, never jumps the hero; the Circle that closed one never crouches it while held',
    async () => {
      const { rl, game, engine } = h;
      const sc = game.showcase;
      await rl.bestiary.open();
      engine.step(30);
      const card = sc.bestiary as unknown as { buttons: { id: string }[]; cursor: number };
      /** Hold `code` for a real press's length (8 frames), then let go: the hero's states over it and after. */
      const hold = (code: string) => {
        const states = new Set<string>();
        engine.input.setKey(code, true);
        for (let i = 0; i < 8; i++) {
          engine.step(1);
          states.add(String(rl.bestiary.state().heroState));
        }
        engine.input.setKey(code, false);
        for (let i = 0; i < 20; i++) {
          engine.step(1);
          states.add(String(rl.bestiary.state().heroState));
        }
        return [...states].filter((s) => /jump|fall|crouch/i.test(s));
      };
      try {
        expect(hold('PadA'), 'Cross in the hall jumps').toContain('jump');
        engine.step(30);
        for (const code of ['PadA', 'Space']) {
          rl.bestiary.inspect(0);
          engine.step(2);
          card.cursor = card.buttons.findIndex((b) => b.id === 'back');
          expect(hold(code), `${code} on the card's Back`).toEqual([]);
          expect(rl.bestiary.state().view).toBe('walk');
        }
        rl.bestiary.inspect(0);
        engine.step(2);
        expect(hold('PadB'), 'the Circle that closed the card').toEqual([]);
        rl.press('Escape');
        expect(sc.pause).not.toBeNull();
        expect(hold('PadB'), 'the Circle that closed the pause').toEqual([]);
        expect(sc.pause).toBeNull();
        sc.photo.open();
        engine.step(2);
        expect(hold('PadB'), 'the Circle that left photo mode').toEqual([]);
        expect(sc.photo.active).toBe(false);
        sc.photo.open();
        engine.step(2);
        rl.press('PadY'); // into the panel's rows
        const photo = sc.photo as unknown as { row: number; rows(): string[] };
        photo.row = photo.rows().indexOf('exit');
        expect(hold('PadA'), 'the Cross on Back to game').toEqual([]);
        expect(sc.photo.active).toBe(false);
        expect(hold('PadB'), 'with nothing on top, Circle crouches').toContain('crouch');
      } finally {
        if (sc.photo.active) sc.photo.close();
        rl.bestiary.close();
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a phone in the Hall: a fast look drag turns the camera and nothing else (the wing, the card), the < > turn the wing, a swipe from the card closes it, a finger presses a card button when it lifts there',
    async () => {
      const { rl, game, engine } = h;
      const sc = game.showcase;
      const list = showcaseOf(game.save).bestiary;
      const kept = list.length;
      // more than ten species: two wings
      for (let i = 0; list.length <= 12; i++) list.push({ ...list[i % kept]!, key: `test:${i}`, rank: 'normal', kills: 1 });
      await rl.bestiary.open();
      try {
        engine.controls.touch = true; // as on a phone: touch controls show, so a touch names them
        engine.input.noteDevice('touch');
        engine.step(2);
        expect(rl.bestiary.state().wings).toBe(2);
        expect(sc.touch().controls, 'walking: the stick and buttons').toBe(true);
        const rig = engine.camera as FirstPersonRig;
        const yaw = rig.yaw;
        flick(engine.hud.width / 2, engine.hud.height / 2, -100);
        expect(rig.yaw, 'the drag looked').not.toBeCloseTo(yaw, 3);
        expect(rl.bestiary.state().wing, 'a look is no wing turn').toBe(0);
        // the < > at the screen's sides turn it
        finger(engine.hud.width - 8, Math.round(engine.hud.height / 2), true);
        finger(engine.hud.width - 8, Math.round(engine.hud.height / 2), false);
        expect(rl.bestiary.state().wing).toBe(1);
        finger(6, Math.round(engine.hud.height / 2), true);
        finger(6, Math.round(engine.hud.height / 2), false);
        expect(rl.bestiary.state().wing).toBe(0);
        // inspecting: a fast orbit flick on the exhibit keeps the card; one from the card closes it
        rl.bestiary.inspect(0);
        expect(sc.touch().controls, 'the card takes a phone\'s screen: no stick or A / B over its buttons').toBe(false);
        // and no ≡ either: the card's hint names its way back on a phone, a swipe from it
        expect(t('showcase.hint.card_back')).toBe(`${t('key.touch.swipe')} back`);
        const mini = vi.spyOn(UiCanvas.prototype, 'mini');
        try {
          engine.step(1);
          expect(mini.mock.calls.map((c) => c[2]).join(' · '), 'the hint on the card').toContain(`${t('key.touch.swipe')} back`);
        } finally {
          mini.mockRestore();
        }
        flick(60, engine.hud.height / 2, 90);
        expect(rl.bestiary.state().view, 'an orbit is no way back').toBe('inspect');
        const turntable = (sc.bestiary as unknown as { rects: Map<string, { x: number; y: number; w: number; h: number }> }).rects.get('turntable')!;
        const on = sc.bestiary.turntable;
        flick(turntable.x + turntable.w / 2, turntable.y + 5, 90); // a swipe from a button presses nothing
        expect(rl.bestiary.state().view).toBe('walk');
        expect(sc.bestiary.turntable, 'the swipe pressed no button').toBe(on);
        rl.bestiary.inspect(0);
        finger(turntable.x + turntable.w / 2, turntable.y + 5, true);
        expect(sc.bestiary.turntable, 'a finger presses when it lifts').toBe(on);
        finger(turntable.x + turntable.w / 2, turntable.y + 5, false);
        expect(sc.bestiary.turntable, 'a tap on Turntable').toBe(!on);
        sc.bestiary.turntable = on;
      } finally {
        list.length = kept;
        rl.bestiary.close();
        engine.input.noteDevice('keyboard');
        engine.controls.touch = false;
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'R1 and L1 are the Hall\'s: the hero never lies down or goes prone on them; a left click inspects the exhibit ahead without the page\'s pointer lock (a replay has none)',
    async () => {
      const { rl, game, engine } = h;
      const sc = game.showcase;
      await rl.bestiary.open();
      try {
        engine.input.noteDevice('pad');
        expect(rl.bestiary.state().wings).toBe(1);
        const exhibit = sc.bestiary.exhibits[0];
        const states = new Set<string | null>();
        for (const code of ['PadRB', 'PadLB', 'PadRB']) {
          engine.input.setKey(code, true);
          engine.step(1);
          engine.input.setKey(code, false);
          for (let i = 0; i < 30; i++) {
            engine.step(1);
            states.add(rl.bestiary.state().heroState);
          }
        }
        expect([...states].filter((s) => s && /lie|lying|prone|crawl/i.test(s)), 'R1 and L1 are not the hero\'s').toEqual([]);
        expect(sc.bestiary.exhibits[0], 'one wing: R1 and L1 rebuild nothing').toBe(exhibit);
        engine.input.noteDevice('keyboard');
        sc.bestiary.goTo(sc.bestiary.hall!.pedestals[0]!);
        engine.step(2);
        pointAtArt(engine, engine.hud.width / 2, engine.hud.height / 2, true);
        engine.step(1);
        pointAtArt(engine, engine.hud.width / 2, engine.hud.height / 2, false);
        engine.step(1);
        expect(rl.bestiary.state().view, 'a click on the exhibit ahead').toBe('inspect');
      } finally {
        rl.bestiary.close();
        engine.input.noteDevice('keyboard');
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'photo mode on a phone: its hints name the ≡ as the way back (no swipe leaves it), a fast look drag keeps the panel, a sideways swipe from the panel hides it, a tap on "show" (which says tap) brings it back, a swipe from a row changes nothing',
    () => {
      const { rl, game, engine } = h;
      const photo = game.showcase.photo;
      rl.photo.open();
      try {
        engine.controls.touch = true; // as on a phone: touch controls show, so a touch names them
        engine.input.noteDevice('touch');
        const mini = vi.spyOn(UiCanvas.prototype, 'mini');
        try {
          engine.step(2);
          // no swipe leaves photo mode (one from the panel hides it, elsewhere it looks): the ≡ does
          const row = mini.mock.calls.map((c) => c[2]).join(' · ');
          expect(row, 'the hints under the panel').toContain(t('showcase.hint.back'));
          expect(row).not.toContain(`${t('key.touch.swipe')} back`);
          expect(t('showcase.hint.back')).toBe('≡ back');
        } finally {
          mini.mockRestore();
        }
        flick(engine.hud.width - 40, engine.hud.height - 50, -100); // on the world, right of the panel
        expect(photo.hidden, 'a look is no hide').toBe(false);
        const look = rl.photo.state().look;
        const arrow = (photo as unknown as { rects: Map<string, { x: number; y: number; w: number; h: number }> }).rects.get('look:r')!;
        flick(arrow.x + 4, arrow.y + 5, -60);
        expect(photo.hidden, 'a swipe from the panel').toBe(true);
        expect(rl.photo.state().look, 'it changed no row').toBe(look);
        const shown = vi.spyOn(UiCanvas.prototype, 'mini');
        try {
          engine.step(2); // the "show" hint is drawn
          // a tap on it brings the panel back (a swipe does not): it says so
          expect(shown.mock.calls.map((c) => c[2]), 'the hint over the hidden panel').toContain(`${t('key.touch.tap')} show`);
        } finally {
          shown.mockRestore();
        }
        finger(engine.hud.width - 8, engine.hud.height - 6, true);
        finger(engine.hud.width - 8, engine.hud.height - 6, false);
        expect(photo.hidden, 'a tap on "show"').toBe(false);
        engine.step(1);
        finger(arrow.x + 4, arrow.y + 5, true);
        finger(arrow.x + 4, arrow.y + 5, false);
        expect(rl.photo.state().look, 'a tap on the arrow changes the look').not.toBe(look);
      } finally {
        rl.photo.close();
        engine.input.noteDevice('keyboard');
        engine.controls.touch = false;
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});

it(
  'the Hall of Beasts, photo mode, save export / import and the way to Engine World run without a page',
  async () => {
    const { engine, game, rl } = h;
    rl.newRun({ seed: 5 });
    await rl.bestiary.open();
    engine.step(30); // every frame reads pointer lock in a page
    expect(rl.bestiary.state()).toMatchObject({ active: true });
    await rl.bestiary.close();
    rl.photo.open();
    engine.input.setKey('KeyP', true); // the shutter: no picture headless, and no unhandled rejection
    engine.step(2);
    engine.input.setKey('KeyP', false);
    engine.step(2);
    expect(rl.photo.state()).toMatchObject({ active: true, last: null });
    rl.save(0);
    game.exportSlot(0);
    game.importSlot(0);
    engine.step(2);
    game.engineWorld(); // leaving for Engine World: no page to leave headless
    expect(engine.errors).toEqual([]);
  },
  T,
);

/** The next frame's texts (the normal font's, from their left edge, and the mini font's) and its ink rects, as drawn. */
function frame(): { texts: { s: string; x: number; y: number; w: number; mini: boolean }[]; plates: { x: number; y: number; w: number; h: number }[] } {
  const hud = h.engine.hud;
  const texts: { s: string; x: number; y: number; w: number; mini: boolean }[] = [];
  const plates: { x: number; y: number; w: number; h: number }[] = [];
  const { text, rect, clear } = hud;
  const mini = UiCanvas.prototype.mini;
  hud.clear = () => {
    texts.length = 0;
    plates.length = 0;
    clear.call(hud);
  };
  hud.text = (x, y, s, o = {}) => {
    texts.push({ s, x, y, w: hud.measure(s).width, mini: false });
    text.call(hud, x, y, s, o);
  };
  hud.rect = (x: number, y: number, w: number, hh: number, color: HudColor, ...more) => {
    if (color === 'ink') plates.push({ x, y, w, h: hh });
    rect.call(hud, x, y, w, hh, color, ...more);
  };
  UiCanvas.prototype.mini = function (x, y, s, ...more) {
    texts.push({ s, x, y, w: 0, mini: true });
    return mini.call(this, x, y, s, ...more);
  };
  try {
    h.engine.step(1);
  } finally {
    Object.assign(hud, { text, rect, clear });
    UiCanvas.prototype.mini = mini;
  }
  return { texts, plates };
}

it(
  'at ten feet (1920×1080, a pad, no touch controls) the Hall\'s and photo mode\'s hints are in the normal font on an ink plate along the bottom; the Hall names Options once (its menu), the keyboard O for photo mode and Esc for the menu',
  async () => {
    const { engine, rl } = h;
    (engine.renderer as HeadlessView).setViewport({ width: 1920, height: 1080, dpr: 1 });
    const out: string[] = [];
    const check = (where: string, want: string[]) => {
      const { texts, plates } = frame();
      const rows = texts.filter((x) => want.some((w) => x.s.includes(w)));
      if (!rows.length) return out.push(`${where}: no hints (${texts.map((x) => x.s).join(' | ')})`);
      for (const r of rows) {
        if (r.mini) out.push(`${where}: ${r.s} in the mini font`);
        if (!plates.some((p) => p.x <= r.x - 1 && p.x + p.w >= r.x + r.w + 1 && p.y <= r.y - 1 && p.y + p.h >= r.y + 8)) out.push(`${where}: ${r.s} on no plate`);
        if (r.y < engine.hud.height - 30) out.push(`${where}: ${r.s} not along the bottom (y ${r.y})`);
      }
      const all = rows.map((x) => x.s).join(' ');
      for (const w of want) if (!all.includes(w)) out.push(`${where}: no ${w} in ${all}`);
      return all;
    };
    if (rl.photo.state().active) rl.photo.close(); // the test before leaves it open
    engine.controls.touch = false; // a TV: no touch controls
    rl.newRun({ seed: 5 });
    await rl.bestiary.open();
    try {
      engine.input.noteDevice('pad');
      engine.step(5);
      const pad = check('the Hall on a pad', [hints(['menu'])]);
      expect(pad, 'one Options, for the menu').not.toContain(hints(['photo']));
      engine.input.noteDevice('keyboard');
      engine.step(2);
      check('the Hall on the keyboard', [hints(['photo']), hints(['menu'])]);
    } finally {
      await rl.bestiary.close();
    }
    rl.photo.open();
    try {
      engine.input.noteDevice('pad');
      engine.step(5);
      check('photo mode on a pad', [hints(['save']), hints(['back'])]);
    } finally {
      rl.photo.close();
    }
    expect(out).toEqual([]);
    expect(engine.errors).toEqual([]);
  },
  T,
);
