// An agent's run is recorded input (docs/game/shell.md *Agent API*): the bot's intent, `rl.step`'s
// and `rl.moveTo`'s reach the game through `ctx.input` (`{ rl: 'intent' }`), and what the bot does
// besides (a panel closed, home after a death or through the portal) as `{ rl: 'bot' }`. So the
// recording of a bot run replays, in a fresh Riftlight, to the same fingerprint.
import { describe, expect, it } from 'vitest';
import { headlessRiftlight, makeRiftlight } from '../headless';

const T = 60_000;

describe('a bot run', () => {
  it(
    "replays from its recording to the same fingerprint (the bot, rl.step's intent, rl.moveTo)",
    async () => {
      const { engine, game, rl } = await headlessRiftlight({ seed: 4242 });
      try {
        rl.newRun({ seed: 2 });
        await rl.enterDepth(1);
        engine.step(30);
        // an intent moves the hero in the frame it is sent for (taken before that frame's fixed step)
        const x0 = game.hero.actor.position.x;
        rl.step(1, { move: { x: 1, z: 0 } });
        expect(game.hero.actor.position.x - x0, 'no frame of lag').toBeGreaterThan(0.01);
        await engine.restore(await engine.snapshot()); // the recording starts at this moment
        rl.bot.start();
        rl.bot.advance(900);
        const p = game.hero.actor.position;
        rl.step(20, { move: { x: 0, z: 1 }, attack: true, skill: 1 });
        rl.moveTo(p.x - 2, p.z, { maxFrames: 60 });
        engine.step(10);
        const live = engine.fingerprint();
        expect(rl.bot.report().kills, 'the bot fought').toBeGreaterThan(0);
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
    "keeps what the bot does besides (a panel it closes, home after its death), and a replayed game plays on as the live one",
    async () => {
      const { engine, game, rl } = await headlessRiftlight({ seed: 4242 });
      try {
        rl.newRun({ seed: 5 });
        await rl.enterDepth(6); // the bot dies here in a few seconds
        engine.step(2);
        await engine.restore(await engine.snapshot());
        rl.bot.start();
        rl.bot.advance(60);
        rl.press('Escape');
        expect(rl.ui.stack(), 'paused').toContain('pause');
        rl.bot.advance(1);
        expect(rl.ui.stack(), 'the bot closed the pause menu').toEqual([]);
        const { report } = rl.bot.advance(3000);
        expect(report.outcome).toBe('died');
        expect(game.screen, 'home after the death').toBe('town');
        rl.step(5, { move: { x: 1, z: 0 } });
        const rec = JSON.parse(JSON.stringify(engine.recording())) as Parameters<typeof engine.replay>[0];
        const stood = game.hero.actor.position.clone();
        engine.step(30); // on from there, live: the player's input, no intent left over
        expect(game.hero.actor.position.distanceTo(stood), 'the hero stops when the agent lets go').toBeLessThan(0.5);
        const live = engine.fingerprint();
        await engine.replay(rec, () => engine.loadGame(makeRiftlight(game.store, engine.seed)));
        engine.step(30);
        expect(engine.fingerprint()).toBe(live);
        expect(engine.errors).toEqual([]);
      } finally {
        engine.dispose();
      }
    },
    T,
  );
});
