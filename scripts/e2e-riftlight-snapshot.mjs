/* global window -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-snapshot": Riftlight save-states (docs/game/save-states.md) in a page,
// for what only a page shows: a run in town played by input, kept with `engine.snapshot()`,
// restored and played on, renders; a level mid-fight, restored (the level built again), renders;
// zero GPU and console errors.
//
// The gameplay (the same fingerprint and state after a restore in town and on every depth, the
// refusals, restores from the arcade, photo mode, a level, the title, replays after a restore,
// the summoner's ghosts, a hero who can be hurt) is checked headless:
// src/riftlight/game/snapshot.*.test.ts.
//
//   npm run build && npm run test:e2e -- riftlight-snapshot
//
// Frames land in .scratch/e2e/riftlight-snapshot-*.png.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, checkClean }
 */
export async function runRiftlightSnapshot(h) {
  const { exe, scenario: s, openPage, check, capture, checkClean } = h;
  const tag = s.name;
  console.log(`\n▶ riftlight-snapshot (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4242');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    // the town: played by input (the stick in a slow loop, the pointer circling, a swing, a skill),
    // a snapshot, played on, restored and played on the same way
    await R(async () => {
      const e = window.__PIXEL_ENGINE__;
      const I = e.input;
      const task = () => new Promise((r) => setTimeout(r, 0)); // promise callbacks run here
      const play = (frames, phase) => {
        for (let f = 0; f < frames; f++) {
          const a = (f + phase) * 0.021;
          I.analog.x = Math.cos(a);
          I.analog.y = Math.sin(a * 1.3);
          I.setPointer(0.35 * Math.cos(a * 2), 0.3 * Math.sin(a * 2));
          I.setButtons(f % 50 < 6 ? 1 : 0);
          I.setKey('Digit1', f % 140 === 70);
          e.step(1);
        }
        I.analog.x = I.analog.y = 0;
        I.setButtons(0);
        I.setKey('Digit1', false);
        e.step(1);
      };
      e.manual = true;
      window.__RIFTLIGHT__.newRun({ slot: 1, seed: 99 });
      e.step(3);
      await task();
      e.step(3);
      play(360, 0);
      const snap = JSON.parse(JSON.stringify(await e.snapshot()));
      play(300, 1000);
      await e.restore(snap);
      play(300, 1000);
    });
    await capture(page, `riftlight-snapshot-${tag}.png`);

    // a level: monsters beside the hero, a fight, a snapshot mid-fight, restored (built again)
    await R(async () => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const task = () => new Promise((r) => setTimeout(r, 0));
      g.dev.god = true;
      const entering = g.enterDepth(1);
      for (let k = 0; k < 60 && g.screen !== 'level'; k++) {
        await task();
        e.step(1);
      }
      await entering;
      e.step(2);
      const hp = g.hero.actor.position;
      g.level.spawn(1001, hp.clone().set(hp.x + 4, hp.y, hp.z + 1), 'rare');
      g.level.spawn(2001, hp.clone().set(hp.x - 3, hp.y, hp.z + 3), 'magic');
      window.__RIFTLIGHT__.step(150, { attack: true });
      const snap = JSON.parse(JSON.stringify(await e.snapshot()));
      e.step(180);
      await e.restore(snap);
      e.step(180);
    });
    await capture(page, `riftlight-snapshot-${tag}-level.png`);
    checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs, 'riftlight snapshot: ');
  } catch (e) {
    check(false, `riftlight snapshot crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
  }
}
