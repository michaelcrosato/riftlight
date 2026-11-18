// Rift Runner on its own (`?game=arcade`, ArcadeGame): its hints name real controls for the device in
// use, never the actions' ids. Only the Riftlight shell once named them (it set the language's
// controlLabel), so the standalone cabinet read "MOVE RUN  JUMP JUMP  POUND POUND"; the engine now
// names any game's `controls` itself. It promises no "leave" (there is nothing to leave to), and its
// "again" is what restarts it on every device.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../../../engine';
import { headlessGame, stepUntil } from '../../headless';
import { lang, t } from '../../lang';
import { hints } from '../hints';
import { ARCADE_TOUCH_BUTTONS, ArcadeGame } from './ArcadeGame';

let engine: Engine;
let game: ArcadeGame;
/** What the HUD holds this frame (its retained text). */
const hudText = () => (engine.hud as unknown as { items: { kind: string; text?: string }[] }).items.filter((i) => i.kind === 'text').map((i) => i.text!);

beforeAll(async () => {
  game = new ArcadeGame();
  engine = await headlessGame(game, { touch: true }); // as on a phone: touch controls show, so a touch names them
  await stepUntil(engine, () => game.stage.phase === 'play', { max: 600, what: 'the race starts' });
}, 60_000);

afterAll(() => {
  expect(engine.errors).toEqual([]);
  engine.dispose();
});

describe('Rift Runner standalone: prompts', () => {
  it('its hints name the keys, then the pad’s buttons (PlayStation’s, or Xbox’s), then the touch controls', () => {
    engine.step(2);
    expect(hudText()).toContain(hints(['run', 'jump', 'pound'], '   '));
    expect(hints(['run', 'jump', 'pound'], '   ')).toBe('WASD run   Space jump   C pound');
    expect(lang().t('showcase.hint.again')).toBe('Enter again');
    engine.input.noteDevice('pad');
    expect(t('showcase.hint.jump')).toBe('Cross jump');
    expect(t('showcase.hint.run')).toBe('Left stick run');
    engine.settings.set({ padGlyphs: 'xbox' });
    expect([t('showcase.hint.jump'), t('showcase.hint.pound')]).toEqual(['A jump', 'B pound']);
    engine.settings.set({ padGlyphs: undefined });
    engine.input.noteDevice('touch');
    expect([t('showcase.hint.run'), t('showcase.hint.again')]).toEqual(['Stick run', 'Tap again']);
    engine.input.noteDevice('keyboard');
    // standalone there is nowhere to leave to: no hint says so
    expect(hudText().join(' ')).not.toContain(t('showcase.hint.leave'));
  });

  it('Options (or Esc, ≡) pauses it: the clock stops; Circle resumes (and never crouches the hero while held); Restart starts the course over; Settings opens the engine\'s panel over it', () => {
    const tap = (code: string) => {
      engine.input.setKey(code, true);
      engine.step(1);
      engine.input.setKey(code, false);
      engine.step(1);
    };
    game.stage.start();
    game.stage.skipIntro();
    engine.step(90);
    tap('PadStart');
    expect(game.pause?.items).toEqual(['resume', 'restart', 'settings']);
    const clock = game.stage.time;
    engine.step(60);
    expect(game.stage.time, 'the clock stands still').toBe(clock);
    expect(hudText()).toContain(t('menu.pause.title'));
    // Circle resumes, held a moment as a real press is: the run's hero does not crouch on it
    engine.input.setKey('PadB', true);
    const states = new Set<string>();
    for (let i = 0; i < 8; i++) {
      engine.step(1);
      states.add(String(game.stage.hero?.hero?.state));
    }
    engine.input.setKey('PadB', false);
    engine.step(1);
    expect(game.pause).toBeNull();
    expect([...states].filter((s) => s.startsWith('crouch')), 'the Circle that resumed is not a crouch').toEqual([]);
    engine.step(30);
    expect(game.stage.time).toBeGreaterThan(clock);
    tap('Escape');
    tap('ArrowDown');
    tap('PadA');
    expect(game.pause).toBeNull();
    expect(game.stage.time, 'Restart: the run from the start').toBe(0);
    // Settings: the engine's panel (a pad drives it) over the pause, which stays up under it
    const open = vi.spyOn(engine.settings, 'open');
    try {
      tap('PadStart');
      tap('ArrowDown');
      tap('ArrowDown');
      expect(hudText()).toContain(t('menu.pause.settings'));
      tap('PadA');
      expect(open, 'Settings opens the engine\'s panel').toHaveBeenCalledTimes(1);
      expect(game.pause?.items, 'the pause stays under it').toEqual(['resume', 'restart', 'settings']);
    } finally {
      open.mockRestore();
    }
    tap('PadB');
    expect(game.pause, 'Circle resumes').toBeNull();
    // a phone: B jumps, A attacks, ≡ pauses, as the hints name them
    expect(ARCADE_TOUCH_BUTTONS.map((b) => [b.label, b.code])).toEqual([
      ['B', 'Space'],
      ['A', 'KeyJ'],
      ['≡', 'Escape'],
    ]);
    engine.input.noteDevice('touch');
    expect(t('showcase.hint.jump')).toBe('B jump');
    engine.input.noteDevice('keyboard');
  });

  it('"again" restarts it from the pad too', async () => {
    game.stage.autopilot = null;
    // finish fast: the results card is what "again" is on
    (game.stage as unknown as { finish: () => void }).finish?.();
    if (game.stage.phase !== 'done') {
      game.stage.autopilot = (await import('./autoplay')).arcadeAutopilot();
      await stepUntil(engine, () => game.stage.phase === 'done', { max: 60 * 90, every: 30, what: 'the run finishes' });
    }
    engine.step(60);
    expect(hudText()).toContain(hints(['again'], '   '));
    engine.input.setKey('PadA', true);
    engine.step(1);
    engine.input.setKey('PadA', false);
    engine.step(1);
    expect(game.stage.phase).not.toBe('done');
  }, 60_000);
});
