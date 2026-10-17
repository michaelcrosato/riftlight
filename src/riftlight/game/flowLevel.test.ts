// The Riftlight shell in a level, headless (part 3 of the flow e2e `riftlight` keeps one browser
// run of; it keeps the pictures and what is stored in the page): pause → Tuning → the enemy life
// slider by keys, applied to live monsters → Settings → Engine → the look studio (L) → a monster
// spawned after the tuning → the boss kills the hero → the recap → town with the penalty → save →
// a reload (a new engine on the same saves) → Continue. Tests in order; one engine at a time.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import type { Menu } from '../ui/menu';
import { SaveStore } from './save';
import type { LevelStage } from '../wire/levels';
import type { MonsterUnit } from '../wire/monsters';

const T = 30_000;
let h: HeadlessRiftlight;
/** The page's localStorage saves: kept across the reload. */
const store = new SaveStore(null);

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 4242, store });
  h.rl.newRun({ seed: 4242 }); // the page's ?seed=4242 is the run's seed too (headless has no URL)
  await h.rl.enterDepth(1);
  h.engine.step(5);
}, T);
afterAll(() => h?.engine.dispose());

const widgetIds = () => h.rl.ui.widgets().map((w) => w.id);

describe('Riftlight flow: menus in a level, death, reload and Continue', () => {
  it(
    'Esc pauses; Tuning by keys sets enemy life to 1.5×, live monsters follow as the "difficulty" Mod source and a hurt one keeps its life fraction',
    () => {
      const { rl } = h;
      const before = rl.actors().map((a) => ({ id: a.id, life: a.life, max: a.maxLife }));
      // hurt the first monster so we can see the life fraction survive the change
      const m = rl.game.level!.monsters()[0]!.actor;
      m.life = m.stats.get('life') / 2;
      let rs = rl.press('Escape');
      expect(rs.ui, 'Esc opens the pause menu').toContain('pause');
      expect(rs.paused, 'and freezes the world').toBe(true);
      rl.press('ArrowDown');
      rs = rl.press('Enter');
      expect(rs.ui.at(-1), 'Resume ↓ Tuning ⏎ opens the tuning panel').toBe('tuning');
      expect(widgetIds(), 'tuning has the presets, six sliders and reset').toEqual(
        expect.arrayContaining(['preset', 'playerDamage', 'playerLife', 'playerSpeed', 'enemyDamage', 'enemyLife', 'enemySpeed', 'reset']),
      );
      for (let i = 0; i < 5; i++) rl.press('ArrowDown');
      expect(rl.ui.widgets().find((w) => w.focus)?.id, '↓×5 focuses the enemy life slider').toBe('enemyLife');
      for (let i = 0; i < 5; i++) rl.press('ArrowRight');
      rs = rl.state();
      expect(rs.difficulty.enemyLife, '→×5 sets enemy life to 1.5×').toBeCloseTo(1.5, 6);
      const after = rl.actors().map((a) => ({ id: a.id, life: a.life, max: a.maxLife }));
      expect(after[0]!.id).toBe(before[0]!.id);
      expect(after[0]!.max / before[0]!.max, "live monsters' max life follows the slider").toBeCloseTo(1.5, 2);
      expect(after[0]!.life / after[0]!.max, 'a hurt monster keeps its life fraction').toBeCloseTo(0.5, 2);
      const sources = rl.game.level!.monsters()[0]!.actor.stats.explain('life').map((e) => e.source);
      expect(sources, 'applied as the "difficulty" Mod source').toContain('difficulty');
      rl.press('Escape');
      rs = rl.press('Escape');
      expect(rs.ui, 'Esc backs out of the menus').toEqual([]);
      expect(rs.paused).toBe(false);
    },
    T,
  );

  it(
    "Settings → Engine holds the engine's options, and they apply (pixel size chunky: 180 rows, reset: 270)",
    () => {
      const { engine, rl } = h;
      rl.ui.open('settings');
      expect(rl.ui.click('engine'), 'the Engine tab opens').toBe(true);
      expect(widgetIds()).toEqual(expect.arrayContaining(['pixelArt', 'pixelSize', 'fps', 'sound', 'debugInfo']));
      const size = (rl.game.layer.top!.panel as Menu).items().find((w) => w.id === 'pixelSize') as unknown as { set(v: number): void };
      size.set(1); // chunky
      engine.step(2);
      expect(engine.renderer.baseResolution.height).toBe(180);
      expect(engine.settings.values.pixelSize, 'the choice is the player setting').toBe('chunky');
      engine.settings.reset();
      engine.step(2);
      expect(engine.renderer.baseResolution.height).toBe(270);
      rl.ui.close();
      rl.ui.close();
      expect(rl.state().ui).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'L opens the look studio docked beside the picture; Palettes → Game Boy on the characters only, remembered in the settings',
    () => {
      const { engine, rl } = h;
      const g = rl.game;
      let rs = rl.press('KeyL');
      expect(rs.ui.at(-1)).toBe('look');
      expect(rs.paused).toBe(true);
      const r = g.layer.top!.rect;
      expect(g.ui!.w - (r.x + r.w), 'docked at the right edge (px)').toBeLessThanOrEqual(8);
      expect(widgetIds(), 'the studio has looks, a target, pixel art and every filter type').toEqual(
        expect.arrayContaining(['preset', 'target', 'pixel', 'shading', 'palette', 'color', 'era', 'display', 'signal', 'stylize', 'reset']),
      );
      rl.press('ArrowDown');
      rl.press('ArrowRight'); // apply to: characters
      rl.ui.click('palette');
      rl.ui.click('gameboy');
      engine.step(2);
      rs = rl.state();
      expect(rs.ui.at(-1)).toBe('look.palette');
      expect(engine.look.actors.filters.map((f) => f.id), 'Game Boy on the characters').toEqual(['gameboy']);
      expect(engine.look.environment.filters, 'and not on the environment').toEqual([]);
      expect(engine.state().split, 'two passes').toBe(true);
      expect(widgetIds(), 'an active filter shows its preset and sliders').toEqual(expect.arrayContaining(['gameboy.preset', 'gameboy.dither', 'gameboy.amount']));
      expect(g.settings.look, 'the custom look is the setting').toBe('custom');
      expect((g.settings.customLook?.actors?.filters ?? []).map((f) => f.id)).toEqual(['gameboy']);
    },
    T,
  );

  it(
    'H hides the studio, ← still tweaks the focused slider (Game Boy dither 0.85), H shows it again; Reset and Esc close it',
    () => {
      const { engine, rl } = h;
      const g = rl.game;
      rl.press('ArrowDown');
      rl.press('ArrowDown');
      rl.press('KeyH');
      rl.press('ArrowLeft');
      engine.step(2);
      expect(g.layer.peeking, 'H hides the studio').toBe(true);
      expect(rl.state().ui.at(-1)).toBe('look.palette');
      expect(engine.look.actors.filters[0]!.params?.dither).toBeCloseTo(0.85, 6);
      expect(g.layer.top!.panel.focusLine?.()).toMatch(/dither 0\.85/i);
      rl.press('KeyH');
      expect(g.layer.peeking, 'H shows it again').toBe(false);
      rl.press('Escape');
      rl.ui.click('reset');
      const rs = rl.press('Escape');
      expect(rs.ui, 'Esc closes the studio').toEqual([]);
      expect(engine.state().look, 'reset to default').toBe('none');
      expect(engine.state().split).toBe(false);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'a monster spawned now is born with the tuned life',
    () => {
      const { rl } = h;
      const spawned = rl.spawn({ seed: 7 })!;
      const fresh = rl.actors().find((a) => a.id === spawned.id)!;
      expect(fresh).toBeDefined();
      expect(fresh.life).toBeCloseTo(fresh.maxLife, 6);
      const m = rl.game.level!.monsters().find((x) => x.actor.id === spawned.id)!;
      expect(m.actor.stats.explain('life').map((e) => e.source), 'its life carries the tuning').toContain('difficulty');
    },
    T,
  );

  it(
    'the boss kills the hero: its bar shows once it is close, the recap names it, Enter respawns in town at full life, the penalty took gold',
    () => {
      const { engine, rl } = h;
      rl.give({ gold: 100 });
      const level = rl.game.level as LevelStage;
      // walk up to the level boss with 1 life; the rest of the level (and the adds it calls) are
      // cleared away so the blow that lands is the boss's own
      const boss = (level.monsters() as readonly MonsterUnit[]).find((m) => m.rank === 'boss' && m.actor.alive);
      expect(boss, 'the boss is alive').toBeDefined();
      const others = () => {
        for (const m of level.monsters() as readonly MonsterUnit[]) if (m !== boss && m.actor.alive) m.actor.die(null);
      };
      others();
      let at = null;
      for (let k = 0; k < 16 && !at; k++) {
        const p = boss!.actor.position.clone();
        p.x += Math.cos((k / 16) * Math.PI * 2) * 2.2;
        p.z += Math.sin((k / 16) * Math.PI * 2) * 2.2;
        if (level.stage.walkable(p.x, p.z, false)) at = p;
      }
      expect(at, `stood next to the boss (${boss!.name})`).not.toBeNull();
      rl.setDifficulty({ enemyDamage: 4 });
      rl.game.hero.enter(level.stage, at!, 0);
      rl.game.hero.actor.life = 1;
      let bar: string | null = null;
      let gold = rl.state().hero.gold;
      for (let i = 0; i < 900 && !rl.state().ui.includes('death'); i++) {
        gold = rl.state().hero.gold; // the penalty is taken when the recap opens
        others();
        engine.step(1);
        bar ??= rl.state().boss?.name ?? null;
      }
      expect(bar, 'the boss bar shows it once it is close').toBe(boss!.name);
      let rs = rl.state();
      expect(rs.dead, 'dying').toBe(true);
      expect(rs.ui, 'opens the death recap').toContain('death');
      const recap = rl.game.layer.find('death') as unknown as { recap: { killer: string | null } } | undefined;
      expect(recap?.recap.killer, 'the recap names the boss as the killer').toBe(boss!.name);
      rs = rl.press('Enter');
      expect(rs.screen, 'Enter on the recap respawns in town').toBe('town');
      expect(rs.dead).toBe(false);
      expect(rs.hero.life, 'at full life').toBe(rs.hero.maxLife);
      expect(gold).toBeGreaterThan(0);
      expect(rs.hero.gold, `the death penalty took gold (${gold} → ${rs.hero.gold})`).toBeLessThan(gold);
      rl.setDifficulty({ enemyDamage: 1 });
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the slot exports as JSON; after a reload the title offers Continue, and Continue restores the run',
    async () => {
      const { rl } = h;
      rl.save(0);
      const s = rl.state();
      const snapshot = { level: s.hero.level, xp: s.hero.xp, gold: s.hero.gold, deepest: s.deepest, enemyLife: s.difficulty.enemyLife };
      expect(rl.exportSave(0)?.length ?? 0, 'the slot exports as JSON (chars)').toBeGreaterThan(200);
      // a reload: the page's engine goes, a new one boots on the same saves
      h.engine.dispose();
      h = await headlessRiftlight({ seed: 4242, store });
      h.engine.step(2);
      expect(h.rl.state().screen).toBe('title');
      expect(h.rl.ui.widgets()[0]?.id, 'after a reload the title offers Continue').toBe('continue');
      const rs = h.rl.press('Enter');
      expect(rs.screen).toBe('town');
      expect({ level: rs.hero.level, xp: rs.hero.xp, gold: rs.hero.gold, deepest: rs.deepest, enemyLife: rs.difficulty.enemyLife }, 'Continue restores the run').toEqual(snapshot);
      h.engine.step(10);
      expect(h.engine.errors).toEqual([]);
    },
    T,
  );
});
