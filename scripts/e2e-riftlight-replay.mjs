/* global window -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-replay": a Riftlight session recorded and replayed (docs/DOCTRINE.md,
// principle 1). Everything the session does goes through `ctx.input`, as a player's would: the
// title menu by keys (the new run's seed arrives as a command), the walk to Vex on the stick, F
// and Enter into depth 1, then a fight aimed with the mouse (the pointer over each monster in
// turn, the left button held, a right click for a skill), the inventory opened and clicked.
// The recording, through JSON, replays in a fresh Riftlight to the same `engine.fingerprint()`
// (which holds `Riftlight.fingerprint`: hero, monsters, ground loot, the save, the run's random
// stream), and an edited recording (the pointer in a corner for a second of the fight) does not.
//
//   npm run build && npm run test:e2e -- riftlight-replay
//
// Frames land in .scratch/e2e/riftlight-replay-*.png.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, checkClean }
 */
export async function runRiftlightReplay(h) {
  const { exe, scenario: s, openPage, check, capture, checkClean } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight-replay (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4242&save=memory');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });

    // a player, scripted: what it decides it reads from the game, what it does is input only
    await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const I = e.input;
      const task = () => new Promise((r) => setTimeout(r, 0)); // promise callbacks (a level loading) run here
      const game = () => e.game;
      const tap = (code) => {
        I.setKey(code, true);
        e.step(1);
        I.setKey(code, false);
        e.step(2);
      };
      /** Stick the hero toward world (x, z): the stick is the camera's right and forward on the ground. */
      const stickToward = (dx, dz) => {
        const m = e.camera.camera.matrixWorld.elements;
        const right = [m[0], m[2]];
        const fwd = [-m[8], -m[10]];
        const n = (v) => {
          const l = Math.hypot(v[0], v[1]) || 1;
          return [v[0] / l, v[1] / l];
        };
        const [rx, rz] = n(right);
        const [fx, fz] = n(fwd);
        const d = Math.hypot(dx, dz) || 1;
        I.analog.x = (dx * rx + dz * rz) / d;
        I.analog.y = (dx * fx + dz * fz) / d;
      };
      /** Walk to (x, z) on the stick, sidestepping what it bumps into (as the agent API's moveTo). */
      const walkTo = (x, z, radius, max = 900) => {
        let stuck = 0;
        let side = 0;
        let last = null;
        for (let f = 0; f < max; f++) {
          const p = game().hero.actor.position;
          const dx = x - p.x;
          const dz = z - p.z;
          const d = Math.hypot(dx, dz);
          if (d <= radius) break;
          stuck = last && Math.hypot(p.x - last[0], p.z - last[1]) < 0.01 ? stuck + 1 : 0;
          if (stuck > 12) side = 30;
          const k = side-- > 0 ? 1 : 0;
          stickToward(dx / d - (k * dz) / d, dz / d + (k * dx) / d);
          last = [p.x, p.z];
          e.step(1);
        }
        I.analog.x = I.analog.y = 0;
        e.step(1);
      };
      /** The pointer over a world point (normalised device coordinates through the camera). */
      const pointAt = (p) => {
        const v = p.clone().setY(p.y + 0.6).project(e.camera.camera);
        I.setPointer(Math.max(-0.98, Math.min(0.98, v.x)), Math.max(-0.98, Math.min(0.98, v.y)));
      };
      window.__REPLAY_PLAYER__ = { e, I, task, game, tap, walkTo, pointAt, stickToward };
    });

    const run = await page.evaluate(async () => {
      const { e, I, task, game, tap, walkTo, pointAt, stickToward } = window.__REPLAY_PLAYER__;
      const R = () => window.__RIFTLIGHT__; // each Riftlight installs its own
      e.manual = true;
      const fresh = () => e.loadGame(window.__PIXEL_GAMES__.riftlight());
      await fresh(); // the recording starts at its setup
      await task();
      e.step(10);
      tap('Enter'); // New Run
      tap('Enter'); // slot 1: the run's seed goes through ctx.input.send
      await task();
      e.step(5);
      const out = { town: R().state().screen };
      const vex = game().town.interactables.find((x) => x.id === 'vex');
      walkTo(vex.position.x, vex.position.z, Math.min(1.2, vex.radius - 0.4));
      tap('KeyF'); // talk: the rift menu
      out.rift = R().state().ui.join(',');
      tap('Enter'); // depth 1
      for (let k = 0; k < 20 && game().screen !== 'level'; k++) {
        await task(); // the level builds in promise callbacks
        e.step(1);
      }
      out.level = R().state().screen;
      e.step(30);
      // fight: the pointer on the nearest monster, the left button held, a right click now and then
      const life0 = R().state().monsters;
      let rightClicks = 0;
      let aimed = 0;
      for (let f = 0; f < 900 && game().level; f++) {
        const hp = game().hero.actor.position;
        const ms = game().level.monsters().filter((m) => m.actor.alive);
        if (!ms.length) break;
        const m = ms.reduce((a, b) => (a.actor.position.distanceTo(hp) <= b.actor.position.distanceTo(hp) ? a : b));
        const d = m.actor.position.distanceTo(hp);
        pointAt(m.actor.position);
        aimed++;
        if (d > 1.6) stickToward(m.actor.position.x - hp.x, m.actor.position.z - hp.z);
        else I.analog.x = I.analog.y = 0;
        if (f % 120 === 60) {
          I.setButtons(2); // a right click: skill 1
          e.step(1);
          I.setButtons(0);
          rightClicks++;
        }
        I.setButtons(d < 2.5 ? 1 : 0);
        e.step(1);
      }
      I.setButtons(0);
      I.analog.x = I.analog.y = 0;
      e.step(5);
      out.fight = { before: life0, after: R().state().monsters, rightClicks, aimed, idle: game().pointer.idle };
      // the pointer on bare ground beside the hero, away from every monster: the hero aims there
      // (auto-aim would pick a monster, or straight ahead)
      const hp = game().hero.actor.position;
      const spot = hp.clone().set(hp.x - 2.2, hp.y, hp.z + 1.4);
      const v = spot.clone().project(e.camera.camera);
      I.setPointer(v.x, v.y);
      e.step(3);
      const aim = game().intent.aim;
      out.aim = { spot: [spot.x, spot.z], aim: [aim.x, aim.z], off: Math.hypot(aim.x - spot.x, aim.z - spot.z) };
      // the inventory: open it, click in the bag, close it
      tap('KeyI');
      I.setPointer(0.5, 0);
      e.step(1);
      I.setButtons(1);
      e.step(1);
      I.setButtons(0);
      e.step(2);
      tap('KeyI');
      e.step(30);
      out.end = R().state();
      out.print = e.fingerprint();
      out.rec = JSON.stringify(e.recording());
      out.errors = e.state().errors;
      return out;
    });
    check(run.town === 'town' && run.rift.includes('rift') && run.level === 'level', `a session by input alone: title keys → town → the stick to Vex → F → depth 1 (${run.town}, ${run.rift}, ${run.level})`);
    check(run.fight.after.killed > run.fight.before.killed && run.fight.aimed > 30, `a fight with the mouse: ${run.fight.after.killed - run.fight.before.killed} kills over ${run.fight.aimed} frames of pointing, ${run.fight.rightClicks} right clicks`);
    check(run.aim.off < 0.3, `the hero aims where the pointer is, on bare ground (${run.aim.off.toFixed(2)} m from it)`);
    const rec = JSON.parse(run.rec);
    check(rec.frames.some((f) => f.commands?.some((c) => c.rl === 'run')) && rec.frames.some((f) => f.commands?.some((c) => c.rl === 'settings')), 'the recording holds what came from the page: the settings and the new run (commands)');
    await capture(page, `riftlight-replay-${tag}-live.png`);

    const again = await page.evaluate(async (text) => {
      const e = window.__PIXEL_ENGINE__;
      const R = () => window.__RIFTLIGHT__;
      const fresh = () => e.loadGame(window.__PIXEL_GAMES__.riftlight());
      const rec = JSON.parse(text);
      const t0 = performance.now(); // real time: how long the replay took
      await e.replay(rec, fresh);
      const ms = performance.now() - t0; // real time: how long the replay took
      const same = { print: e.fingerprint(), end: R().state() };
      // the pointer in a corner for a second of the fight: the same session must not match
      const edited = JSON.parse(text);
      const fight = edited.frames.findIndex((f, i) => i > edited.frames.length * 0.3 && f.held?.includes('MouseLeft'));
      for (let i = fight; i >= 0 && i < Math.min(fight + 60, edited.frames.length); i++) edited.frames[i].pointer = [0.95, 0.95, 1, 0];
      await e.replay(edited, fresh);
      return { ...same, ms, frames: rec.frames.length, editedPrint: e.fingerprint(), editedAt: fight, errors: e.state().errors };
    }, run.rec);
    check(again.print === run.print, `the session replays to the same fingerprint (${run.print} vs ${again.print}; ${again.frames} frames in ${(again.ms / 1000).toFixed(1)} s)`);
    check(
      JSON.stringify(again.end.hero.position) === JSON.stringify(run.end.hero.position) && again.end.monsters.killed === run.end.monsters.killed && again.end.hero.gold === run.end.hero.gold && again.end.hero.xp === run.end.hero.xp,
      `and to the same run: hero at ${again.end.hero.position.join(', ')}, ${again.end.monsters.killed} kills, ${again.end.hero.xp} xp, ${again.end.hero.gold} gold`,
    );
    check(again.editedAt > 0 && again.editedPrint !== run.print, `a recording with the pointer in a corner for a second of the fight (from frame ${again.editedAt}) plays differently (${again.editedPrint})`);
    check(run.errors.length === 0 && again.errors.length === 0, `no game errors${run.errors.concat(again.errors).length ? ': ' + run.errors.concat(again.errors).join('; ') : ''}`);
    await capture(page, `riftlight-replay-${tag}-replayed.png`);
    checkClean(await page.evaluate(() => window.__PIXEL_ENGINE__.state()), logs, 'riftlight replay: ');
  } catch (e) {
    check(false, `riftlight replay crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
  }
}
