/* global window -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-snapshot": Riftlight save-states (docs/GAME.md, *Save-states*). A run in
// town is played by input (the stick, the mouse aiming and swinging, a skill now and then: the
// townsfolk bark, the cat runs, cooldowns tick), then `engine.snapshot()` keeps the moment as
// JSON. Played on from there, then restored and played on the same way, the game reaches the
// same `engine.fingerprint()`, also when restored from inside a level with the inventory open,
// and in a fresh Riftlight a recording made after a restore replays to it. A snapshot taken
// just after a restore is the one restored; a different input plays differently; a level or an
// open panel is refused with the reason.
//
//   npm run build && npm run test:e2e -- riftlight-snapshot
//
// Frames land in .scratch/e2e/riftlight-snapshot-*.png.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, checkClean }
 */
export async function runRiftlightSnapshot(h) {
  const { exe, scenario: s, openPage, check, capture, checkClean } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight-snapshot (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4242');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const out = await R(async () => {
      const e = window.__PIXEL_ENGINE__;
      const I = e.input;
      const task = () => new Promise((r) => setTimeout(r, 0)); // promise callbacks run here
      const game = () => e.game;
      const api = () => window.__RIFTLIGHT__;
      const fresh = () => e.loadGame(window.__PIXEL_GAMES__.riftlight());
      e.manual = true;
      await fresh();
      await task();
      api().newRun({ slot: 1, seed: 99 });
      e.step(3);
      await task();
      e.step(3);
      /** Play `frames` by input: the stick in a slow loop, the pointer circling ahead, a swing, a skill. */
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
      /** A snapshot once nothing is in flight (a skill's effect still flying is refused). */
      const settle = async () => {
        let last = '';
        for (let k = 0; k < 40; k++) {
          try {
            return JSON.parse(JSON.stringify(await e.snapshot()));
          } catch (err) {
            last = err.message;
            e.step(5);
          }
        }
        throw new Error(`no snapshot: ${last}`);
      };
      const at = () => [...game().hero.actor.position.toArray().map((x) => +x.toFixed(3))];
      const res = { town: game().screen };
      const counts = () => game().hero.hc.stats;
      const before = { ...counts() };
      const npcAt = () => game().town.npcs.map((n) => n.position.toArray().join());
      const npcs0 = npcAt();
      const cat0 = game().town.saveState().cat.position.join();
      play(360, 0);
      res.lively = { attacks: counts().attacks - before.attacks, casts: counts().casts - before.casts, npcsMoved: npcAt().filter((p, i) => p !== npcs0[i]).length, catMoved: game().town.saveState().cat.position.join() !== cat0 };
      const snap = await settle();
      res.snapAt = { frame: e.state().frame, hero: at(), bytes: JSON.stringify(snap).length };

      // the run as it went on
      play(300, 1000);
      res.went = { print: e.fingerprint(), hero: at(), barks: game().town.npcs.map((n) => n.bubble?.text ?? '') };

      // restored and played on the same way
      let t0 = performance.now(); // real time: how long a restore takes
      await e.restore(snap);
      res.restoreMs = performance.now() - t0; // real time
      const again = JSON.parse(JSON.stringify(await e.snapshot()));
      res.sameSnapshot = JSON.stringify({ ...again, engine: 0 }) === JSON.stringify({ ...snap, engine: 0 });
      if (!res.sameSnapshot) {
        const diff = [];
        const walk = (a, b, path) => {
          if (diff.length > 6) return;
          if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
            if (JSON.stringify(a) !== JSON.stringify(b)) diff.push(`${path}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`);
            return;
          }
          for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`);
        };
        walk(snap, again, '');
        res.snapshotDiff = diff;
      }
      play(300, 1000);
      res.restored = { print: e.fingerprint(), hero: at() };
      const rec = JSON.parse(JSON.stringify(e.recording()));
      res.recFrom = !!rec.from;

      // a different input from the same moment plays differently
      await e.restore(snap);
      play(300, 2000);
      res.other = e.fingerprint();

      // refused: an open panel, a level; restored from inside a level with the inventory open
      await e.restore(snap);
      api().ui.open('inventory');
      e.step(2);
      res.panelRefused = await e.snapshot().then(
        () => '',
        (err) => err.message,
      );
      api().ui.close();
      e.step(1);
      const entering = game().enterDepth(1);
      for (let k = 0; k < 30 && game().screen !== 'level'; k++) {
        await task();
        e.step(1);
      }
      await entering;
      play(120, 500);
      res.level = game().screen;
      res.levelRefused = await e.snapshot().then(
        () => '',
        (err) => err.message,
      );
      api().ui.open('inventory');
      e.step(2);
      t0 = performance.now(); // real time
      await e.restore(snap);
      res.fromLevelMs = performance.now() - t0; // real time
      res.fromLevel = { screen: game().screen, ui: api().state().ui.join(',') };
      play(300, 1000);
      res.fromLevel.print = e.fingerprint();

      // in a fresh Riftlight, the recording made after the restore replays to the same moment
      await e.replay(rec, fresh);
      res.replayed = e.fingerprint();
      res.errors = e.state().errors;
      return res;
    });
    check(out.town === 'town', `a new run in town (${out.town})`);
    check(out.lively.attacks > 0 && out.lively.casts > 0 && out.lively.npcsMoved > 0, `the town lives while the hero plays: ${out.lively.attacks} swings, ${out.lively.casts} casts, ${out.lively.npcsMoved} townsfolk walked, the cat ${out.lively.catMoved ? 'moved' : 'sat'}`);
    check(out.snapAt.bytes > 1000, `a snapshot in town, after 360 frames of walking, aiming, swinging and a skill: ${(out.snapAt.bytes / 1024).toFixed(1)} KB of JSON, the hero at ${out.snapAt.hero.join(', ')}`);
    check(out.sameSnapshot, `a snapshot just after restoring is the one restored${out.snapshotDiff ? `: ${out.snapshotDiff.join('; ')}` : ''}`);
    check(out.restored.print === out.went.print, `restored and played on the same way, the same game: ${out.went.print} vs ${out.restored.print} (hero at ${out.restored.hero.join(', ')} vs ${out.went.hero.join(', ')})`);
    check(out.restoreMs < 500, `a restore takes ${out.restoreMs.toFixed(0)} ms`);
    check(out.other !== out.went.print, `a different input from the same moment plays differently (${out.other})`);
    check(/panel is open/.test(out.panelRefused), `a snapshot with a panel open is refused: "${out.panelRefused}"`);
    check(out.level === 'level' && /level is not kept/.test(out.levelRefused), `a snapshot in a level is refused (S3): "${out.levelRefused}"`);
    check(out.fromLevel.screen === 'town' && out.fromLevel.ui === '' && out.fromLevel.print === out.went.print, `restored from a level with the inventory open: back in town, panels closed, the same game (${out.fromLevel.print}, ${out.fromLevelMs.toFixed(0)} ms)`);
    check(out.recFrom && out.replayed === out.went.print, `a recording made after a restore replays in a fresh Riftlight to the same moment (${out.replayed})`);
    check(out.errors.length === 0, `no game errors${out.errors.length ? ': ' + out.errors.join('; ') : ''}`);
    await capture(page, `riftlight-snapshot-${tag}.png`);
    checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs, 'riftlight snapshot: ');
  } catch (e) {
    check(false, `riftlight snapshot crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
  }
}
