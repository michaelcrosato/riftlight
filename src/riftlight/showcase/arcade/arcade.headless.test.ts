// Rift Runner on its own (`?game=arcade`, ArcadeGame): its hints name real controls for the device in
// use, never the actions' ids. Only the Riftlight shell once named them (it set the language's
// controlLabel), so the standalone cabinet read "MOVE RUN  JUMP JUMP  POUND POUND"; the engine now
// names any game's `controls` itself. It promises no "leave" (there is nothing to leave to), and its
// "again" is what restarts it on every device.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../../engine';
import { headlessGame, stepUntil } from '../../headless';
import { lang, t } from '../../lang';
import { hints } from '../hints';
import { ArcadeGame } from './ArcadeGame';

let engine: Engine;
let game: ArcadeGame;
/** What the HUD holds this frame (its retained text). */
const hudText = () => (engine.hud as unknown as { items: { kind: string; text?: string }[] }).items.filter((i) => i.kind === 'text').map((i) => i.text!);

beforeAll(async () => {
  game = new ArcadeGame();
  engine = await headlessGame(game);
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
