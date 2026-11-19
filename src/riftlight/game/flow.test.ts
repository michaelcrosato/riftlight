// The Riftlight shell end to end, headless (part 1 of the flow that e2e `riftlight` keeps one
// browser run of): the title's legend on every screen → title → New Run by keys → town → a walk to every district of the outskirts
// and back → a Blink stops at the town's walls → Vex → the rift menu → depth 1. One engine for
// the file (module state outlives an engine), tests in order: each starts where the last ended.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HeadlessView } from '../../engine';
import { RIFTLIGHT_OPTIONS } from '../index';
import { type HeadlessRiftlight, headlessRiftlight, hudTexts, stepUntil } from '../headless';
import { t } from '../lang';
import { miniWidth } from '../ui/kit';
import { overlaps } from '../ui/layout';
import type { Menu } from '../ui/menu';
import type { RealHero } from '../wire/hero';
import type { MonsterUnit } from '../wire/monsters';

const T = 30_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242 });
}, T);
afterAll(() => h?.engine.dispose());

describe('Riftlight flow: title to depth 1', () => {
  it(
    'the title, the first screen a pad meets, says what Cross (Enter) does under its tiles, clear of all else on it at a TV, a laptop and a phone held either way; nothing on a touch screen',
    () => {
      const { engine, game } = h;
      const renderer = engine.renderer as HeadlessView;
      const view = { ...renderer.viewport };
      const select = t('legend.select');
      engine.step(10); // the title's menu opens (its legend shows once it has)
      try {
        for (const [width, height, dpr, touch] of [[1920, 1080, 1, false], [1280, 720, 1, false], [844, 390, 2, true], [390, 844, 3, true]] as const) {
          renderer.setViewport({ width, height, dpr });
          // a phone's page shows touch controls (headless has none), at the game's art density there
          renderer.setTouchDensity(touch ? (RIFTLIGHT_OPTIONS.touchDensity ?? 0) : 0);
          engine.controls.touch = touch;
          // the first tile focused, and one with a hint (Engine World's) on the row under the tiles
          for (const [device, focus] of [['pad', 'new'], ['pad', 'world'], ['keyboard', 'world'], ['touch', 'world']] as const) {
            engine.input.noteDevice(device);
            const menu = game.layer.find('title') as Menu;
            menu.focusId(focus);
            engine.step(2);
            const at = `${width}×${height} ${device}, ${focus} focused`;
            const boxes = hudTexts(engine, 1);
            const words = boxes.find((b) => b.text === select);
            if (device === 'touch' && touch) {
              expect(words, `${at}: none`).toBeUndefined();
              continue;
            }
            expect(words, `${at}: ✕ Select`).toBeDefined();
            const { w: W, h: H } = game.ui;
            const row = { x: words!.x - 12, y: words!.y - 3, w: words!.w + 15, h: 11 }; // its glyph, on its plate
            const mark = { x: W - 4 - miniWidth('RIFTLIGHT'), y: H - 8, w: miniWidth('RIFTLIGHT'), h: 5 }; // the corner's RIFTLIGHT
            const shown = game.layer.stack.find((o) => o.panel === menu)!.rect; // its tiles and the hint row under them
            const others = [...boxes.filter((b) => b !== words), shown, ...menu.rects.values(), mark];
            expect(others.filter((o) => overlaps(row, o, 0)), `${at}: clear of the tiles, their hint and the rest`).toEqual([]);
            expect(row.x >= 0 && row.x + row.w <= W && row.y + row.h <= H, `${at}: on screen`).toBe(true);
          }
          (game.layer.find('title') as Menu).focusId('new');
        }
      } finally {
        renderer.setViewport(view);
        renderer.setTouchDensity(0);
        engine.controls.touch = false;
        engine.input.noteDevice('keyboard');
        engine.step(2);
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'opens on the title screen; Enter on New Run opens the slot picker, Enter on slot 1 starts a run in town',
    () => {
      const { engine, rl } = h;
      let rs = rl.state();
      expect(rs.screen).toBe('title');
      expect(rs.ui).toContain('title');
      engine.step(20);
      rs = rl.press('Enter');
      expect(rs.ui, 'Enter on New Run opens the slot picker').toContain('slots');
      rs = rl.press('Enter');
      expect(rs).toMatchObject({ screen: 'town', deepest: 0 });
      expect(rs.hero.level).toBe(1);
      expect(rl.game.save.seed, "the boot seed is the run's, as ?seed= is in a page").toBe(4242);
      engine.step(30);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'walks on to every district of the outskirts and back to the plaza',
    () => {
      const { rl } = h;
      const town = rl.game.town;
      const ids = Object.keys(town.districts);
      expect(ids.length).toBe(8);
      for (const [id, p] of Object.entries(town.districts)) {
        const r = rl.moveTo(p.x, p.z, { radius: 0.9, maxFrames: 1500 });
        expect(r.arrived, `walks on to the ${id} (${r.frames} frames, at ${r.state.hero.position.map((v) => v.toFixed(1)).join(', ')})`).toBe(true);
      }
      expect(rl.moveTo(town.spawn.x, town.spawn.z, { radius: 0.6, maxFrames: 1500 }).arrived, 'and back to the plaza').toBe(true);
    },
    T,
  );

  it(
    "a Blink in town stops at walls: the hero's combat asks the town (from the Old Watch's courtyard north through its wall)",
    () => {
      const { rl } = h;
      const town = rl.game.town;
      const from = town.districts.watch!.clone().setY(0.5);
      const to = from.clone().add({ x: -7, y: 0, z: -7 }); // up the screen, 10 m, past the wall
      const combat = (rl.game.hero as RealHero).hc.combat.wall(from, to);
      expect(combat).not.toBeNull();
      expect(combat).toBe(town.wall(from, to));
      expect(combat!).toBeLessThan(1);
    },
    T,
  );

  it(
    'walk to Vex, talk: the rift menu opens; Enter on its first entry enters depth 1 "Embers" with real monsters and a boss',
    async () => {
      const { engine, rl } = h;
      const talk = rl.talkTo('vex');
      expect(talk.ok).toBe(true);
      expect(talk.state.ui).toContain('rift');
      rl.press('Enter'); // the first entry is the next depth: I · EMBERS
      await stepUntil(engine, () => rl.state().screen === 'level', { what: 'the level screen' });
      engine.step(5);
      const rs = rl.state();
      expect(rs).toMatchObject({ depth: 1, levelName: 'Embers' });
      expect(rs.monsters.total).toBeGreaterThan(0);
      expect(rs.codex, 'the codex unlocked the level mechanic').toContain('embers');
      const ms = rl.game.level!.monsters() as readonly Partial<MonsterUnit>[];
      expect(ms.filter((m) => typeof m.runtime?.play === 'function' && m.genome).length, 'every monster is a real animated genome').toBe(ms.length);
      const boss = ms.find((m) => m.rank === 'boss');
      expect(boss, 'a boss spawned on level 1').toBeDefined();
      expect(boss!.actor!.alive).toBe(true);
      expect(boss!.actor!.maxLife).toBeGreaterThan(0);
      expect(boss!.actor!.life).toBe(boss!.actor!.maxLife);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
