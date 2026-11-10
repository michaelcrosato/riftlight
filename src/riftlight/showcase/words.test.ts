// The showcase's words are lines (docs/game/lang.md): the arcade's HUD, the Hall of Beasts' plaques,
// card and hints, photo mode's panel, drawn under the test language en-XA, show nothing that isn't
// a line (a line is bracketed, its vowels accented). Their hints name controls by tag, never a key.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { strays as straysIn } from '../../../scripts/lang-strays.mjs';
import { type Hud, Lang, textWidthPx } from '../../engine';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { installLanguage, riftlightLines } from '../lang';
import { bossNameShown } from '../lang/monsters';
import { HINTS } from '../lang/showcase';
import type { UiCanvas } from '../ui/kit';
import { monsterName } from '../wire/monsters';
import { ArcadeStage } from './arcade/ArcadeStage';
import { entryName } from './bestiary/BestiaryMode';
import { hints } from './hints';
import { PHOTO_LOOKS } from './photo/PhotoMode';

const T = 60_000;
const english = () => installLanguage(new Lang(riftlightLines()));
/** The test language; the shell names keys (`{key:...}`) in the game, a stand-in here. */
const testLanguage = () => {
  const l = new Lang(riftlightLines(), {}, { code: 'en-XA' });
  l.controlLabel = () => '[Kéy]';
  installLanguage(l);
};
afterEach(english);

/** Text drawn that isn't a line under en-XA (scripts/lang-strays.mjs: the audit's test). */
function strays(drawn: readonly string[]): string[] {
  return drawn.filter((s) => straysIn(s, riftlightLines().names).length);
}

/** A UI canvas that keeps the text drawn on it. */
function canvas(w = 480, h = 270): { ui: UiCanvas; drawn: string[] } {
  const drawn: string[] = [];
  const keep = (s: string) => (drawn.push(s), textWidthPx(s));
  const ui = {
    w,
    h,
    pad: false,
    pointer: { x: -1, y: -1, down: false, used: false },
    measure: (s: string, scale = 1) => textWidthPx(s, scale),
    hover: () => false,
    text: (_x: number, _y: number, s: string) => keep(s),
    mini: (_x: number, _y: number, s: string) => keep(s),
    button: (r: unknown, label: string) => (keep(label), r),
    prompt: (_x: number, _y: number, _a: string, label: string) => keep(label),
    glyphWidth: () => 7,
    rect: () => {},
    outline: () => {},
    bar: () => {},
    panel: () => {},
    sprite: () => {},
  };
  return { ui: ui as unknown as UiCanvas, drawn };
}

/** A pixel HUD that keeps the text drawn on it. */
function hud(): { hud: Hud; drawn: string[] } {
  const drawn: string[] = [];
  const h = { width: 480, height: 270, text: (_x: number, _y: number, s: string) => drawn.push(s), measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }), sprite: () => {}, rect: () => {} };
  return { hud: h as unknown as Hud, drawn };
}

describe('the showcase’s lines', () => {
  it('every hint names its control by a tag and says what it does; a row of them reads in order', () => {
    for (const [name, line] of Object.entries(HINTS)) {
      expect(line, name).toMatch(/^\{key:\w+\}( \{key:\w+\})? \p{Ll}/u);
      expect(riftlightLines().lines[`showcase.hint.${name}`]).toBe(line);
    }
    expect(hints(['move', 'leave'])).toBe('move move · pause leave'); // the shell fills the tags with keys
  });

  it('every photo look has a name line', () => {
    const lines = riftlightLines().lines;
    for (const l of PHOTO_LOOKS) expect(lines[l.line], l.name).toBeTypeOf('string');
    expect(lines['showcase.photo.look.home_computer']).toBe('Home computer');
    expect(lines['showcase.photo.filter.crt']).toBe('CRT');
  });
});

describe('the showcase drawn under en-XA', () => {
  let h: HeadlessRiftlight;
  beforeAll(async () => {
    h = await headlessRiftlight({ seed: 777 });
  }, T);
  afterAll(() => h?.engine.dispose());

  it(
    'the arcade: ready, the hints, the results card',
    async () => {
      const stage = new ArcadeStage(h.game.ctx, { onFinish: () => ({ best: 40, newBest: true, reward: 25 }) });
      testLanguage();
      const { hud: d, drawn } = hud();
      stage.drawHud(d);
      stage.phase = 'play';
      stage.drawHud(d);
      stage.phase = 'done';
      stage.phaseTime = 2;
      stage.result = { time: 41.5, coins: 9, total: 12, best: 40, newBest: true, reward: 25 };
      stage.drawHud(d);
      stage.result = { ...stage.result, newBest: false, reward: 0 };
      stage.drawHud(d);
      expect(drawn.length).toBeGreaterThan(10);
      expect(strays(drawn)).toEqual([]);
      stage.dispose();
    },
    T,
  );

  it(
    'the Hall of Beasts (walking, an exhibit’s card, the altar) and photo mode',
    async () => {
      const { rl, engine, game } = h;
      rl.newRun({ slot: 0, seed: 777 });
      engine.step(5);
      await rl.enterDepth(1);
      engine.step(5);
      rl.killAll();
      engine.step(5);
      rl.toTown();
      engine.step(5);
      const entries = game.showcase.bestiary.entries;
      expect(entries.length).toBeGreaterThan(1);
      // a boss by its English name (data), a monster by its genome: shown in the player's language
      const boss = entries.find((e) => e.rank === 'boss')!;
      expect(entryName(boss)).toBe(bossNameShown(boss.name));
      const other = entries.find((e) => e.rank !== 'boss')!;
      expect(entryName(other)).toBe(monsterName(other.genome));
      await rl.bestiary.open();
      engine.step(10);
      testLanguage();
      const { ui, drawn } = canvas();
      game.showcase.bestiary.draw(ui);
      rl.bestiary.inspect(0);
      game.showcase.bestiary.draw(ui);
      rl.bestiary.breed(0, 1);
      game.showcase.bestiary.draw(ui);
      english();
      await rl.bestiary.close();
      rl.photo.open();
      testLanguage();
      game.showcase.photo.draw(ui);
      game.showcase.photo.sub = 'edit';
      game.showcase.photo.draw(ui);
      game.showcase.photo.hidden = true;
      game.showcase.photo.draw(ui);
      english();
      rl.photo.close();
      expect(drawn.length).toBeGreaterThan(30);
      expect(strays(drawn)).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
