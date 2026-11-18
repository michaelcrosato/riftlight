// Rift Runner's pixel HUD at every window shape, headless: fill (the engine's default) gives the
// art the window's shape, so a phone in portrait is 130 art columns. The coins, the title, the
// timer and the best time stack when they don't fit side by side, the controls wrap to the width,
// and the results card shrinks its title and wraps its lines: every text on the screen, none over
// another, from READY to the results.
import { describe, expect, it } from 'vitest';
import { type HudTextBox, headlessGame, hudOverlap, hudTexts, stepUntil } from '../../headless';
import { ArcadeGame, ARCADE_OPTIONS } from './ArcadeGame';
import { arcadeAutopilot } from './autoplay';

const T = 60_000;

function expectLaidOut(lines: HudTextBox[], { width, height }: { width: number; height: number }, when: string): void {
  for (const l of lines) {
    expect(l.x >= 0 && l.y >= 0 && l.x + l.w <= width && l.y + l.h <= height, `${when}: "${l.text}" (${l.x},${l.y} ${l.w}×${l.h}) on the ${width}×${height} screen`).toBe(true);
  }
  for (const [i, a] of lines.entries()) for (const b of lines.slice(i + 1)) expect(hudOverlap(a, b), `${when}: "${a.text}" over "${b.text}"`).toBe(false);
}

describe("Rift Runner's HUD at every window shape", () => {
  it.each([
    [960, 540],
    [390, 844],
    [844, 390],
    [960, 720],
  ])(
    '%i×%i: READY, the run with its controls and the results card keep every line on screen and apart',
    async (width, height) => {
      const game = new ArcadeGame();
      const e = await headlessGame(game, { ...ARCADE_OPTIONS, viewport: { width, height, dpr: 1 } });
      try {
        e.step(2);
        const ready = hudTexts(e);
        expect(ready.map((l) => l.text)).toEqual(expect.arrayContaining(['Rift Runner', 'Ready?']));
        expectLaidOut(ready, e.hud, 'READY');

        await stepUntil(e, () => game.stage.phase === 'play', { max: 600, what: 'GO' });
        e.step(10);
        const play = hudTexts(e);
        expect(play.map((l) => l.text).join(' '), 'the controls show at the start of the run').toMatch(/run.*jump.*pound/);
        expect(play.map((l) => l.text).join(' '), 'the standalone game has nowhere to leave to').not.toMatch(/leave/i);
        expectLaidOut(play, e.hud, 'the run');

        game.stage.autopilot = arcadeAutopilot();
        await stepUntil(e, () => game.stage.phase === 'done', { max: 60 * 90, every: 30, what: 'the finish' });
        e.step(60);
        const done = hudTexts(e);
        expect(game.stage.result?.newBest, 'the first finish is a new best (the longest line)').toBe(true);
        expect(done.map((l) => l.text).join(' ')).toMatch(/Course clear!.*New best!.*again/);
        expect(done.map((l) => l.text).join(' ')).not.toMatch(/leave/i);
        expectLaidOut(done, e.hud, 'the results');
        expect(e.errors).toEqual([]);
      } finally {
        e.dispose();
      }
    },
    T,
  );
});
