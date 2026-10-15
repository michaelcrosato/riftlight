/* global window, document -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-replay": a Riftlight session recorded and replayed (docs/DOCTRINE.md,
// principle 1). Everything the session does goes through `ctx.input`, as a player's would: New
// Run clicked with the mouse (the run's seed arrives as a command), a slot picked by key, the
// walk to Vex on the stick, F and Enter into depth 1, a fight aimed with the mouse (the pointer
// over each monster in turn, the left button held, a right click for a skill), the pause menu's
// Resume clicked, and a passive-tree node allocated in the tree's own view (the mouse over it,
// Enter, Escape: its actions reach the game as commands). Then storage changes under it (another
// save in slot 1, other settings) and the recording, through JSON, replays in a fresh Riftlight to
// the same `engine.fingerprint()` (`Riftlight.fingerprint`: hero, monsters, ground loot, the save
// and the bags, the run's random stream), writing nothing to storage; an edited recording (the
// pointer in a corner for a second of the fight) does not.
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
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4242');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);

    // a player, scripted: what it decides it reads from the game, what it does is input only
    await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const I = e.input;
      const task = () => new Promise((r) => setTimeout(r, 0)); // promise callbacks (a level loading) run here
      const game = () => e.game;
      const api = () => window.__RIFTLIGHT__; // each Riftlight installs its own
      const tap = (code) => {
        I.setKey(code, true);
        e.step(1);
        I.setKey(code, false);
        e.step(2);
      };
      /** Click a widget of the top menu with the mouse (its rect is in art pixels). */
      const click = (id) => {
        const w = api().ui.widgets().find((x) => x.id === id);
        if (!w?.rect) return false;
        const res = e.renderer.resolution;
        I.setPointer(((w.rect.x + w.rect.w / 2) / res.width) * 2 - 1, 1 - ((w.rect.y + w.rect.h / 2) / res.height) * 2);
        e.step(1);
        I.setButtons(1);
        e.step(1);
        I.setButtons(0);
        e.step(2);
        return true;
      };
      /** The stick toward world (x, z): the stick is the camera's right and forward on the ground. */
      const stickToward = (dx, dz) => {
        const m = e.camera.camera.matrixWorld.elements;
        const n = (x, z) => {
          const l = Math.hypot(x, z) || 1;
          return [x / l, z / l];
        };
        const [rx, rz] = n(m[0], m[2]);
        const [fx, fz] = n(-m[8], -m[10]);
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
      const pointAt = (p, lift = 0.6) => {
        const v = p.clone().setY(p.y + lift).project(e.camera.camera);
        I.setPointer(Math.max(-0.98, Math.min(0.98, v.x)), Math.max(-0.98, Math.min(0.98, v.y)));
      };
      window.__REPLAY_PLAYER__ = { e, I, task, game, api, tap, click, walkTo, pointAt, stickToward };
    });

    const run = await R(async () => {
      const { e, I, task, game, api, tap, click, walkTo, pointAt, stickToward } = window.__REPLAY_PLAYER__;
      e.manual = true;
      await e.loadGame(window.__PIXEL_GAMES__.riftlight()); // the recording starts at its setup
      await task();
      e.step(10);
      const out = { clickedNew: click('new') }; // New Run, with the mouse: the slot picker
      tap('Enter'); // slot 1: the run's seed goes through ctx.input.send
      await task();
      e.step(5);
      out.town = api().state().screen;
      const vex = game().town.interactables.find((x) => x.id === 'vex');
      walkTo(vex.position.x, vex.position.z, Math.min(1.2, vex.radius - 0.4));
      tap('KeyF'); // talk: the rift menu
      out.rift = api().state().ui.join(',');
      tap('Enter'); // depth 1
      for (let k = 0; k < 20 && game().screen !== 'level'; k++) {
        await task(); // the level builds in promise callbacks
        e.step(1);
      }
      out.level = api().state().screen;
      e.step(30);
      // fight: the pointer on the nearest monster, the left button held, a right click now and then
      const before = api().state().monsters;
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
      out.fight = { before, after: api().state().monsters, rightClicks, aimed, xp: api().state().hero.xp };
      // the pointer on bare ground beside the hero, away from every monster: the hero aims there
      // (auto-aim would pick a monster, or straight ahead)
      const hp = game().hero.actor.position;
      const spot = hp.clone().set(hp.x - 2.2, hp.y, hp.z + 1.4);
      pointAt(spot, 0);
      e.step(3);
      const aim = game().intent.aim;
      out.aim = { off: Math.hypot(aim.x - spot.x, aim.z - spot.z) };
      // the pause menu, and Resume clicked with the mouse
      tap('Escape');
      out.paused = api().state().ui.join(',');
      out.resumed = click('resume') && api().state().ui.length === 0;
      // the passive tree: P opens its view (a page overlay with its own input)
      tap('KeyP');
      const panel = game().layer.top?.panel;
      const view = panel?.view;
      const pick = view && panel.state.unspent > 0 ? view.tree.nodes.find((n) => panel.state.pathTo(n.id)?.length === 1) : null;
      if (pick) view.focus(pick.id, 0.4);
      e.step(2);
      out.tree = { open: api().state().ui.join(','), unspent: panel?.state?.unspent ?? 0, pick: pick?.id ?? null, before: [...game().save.hero.allocated] };
      return out;
    });
    // the mouse over the node, Enter, Escape: the tree view's own (DOM) input, handed to the game
    const node = await R((id) => {
      const view = window.__PIXEL_ENGINE__.game.layer.top.panel.view;
      const [x, y] = view.screenOf(id);
      const r = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
      const art = view.debug().art;
      return { x: r.left + ((x + 0.5) / art.width) * r.width, y: r.top + ((y + 0.5) / art.height) * r.height };
    }, run.tree.pick);
    await page.mouse.move(node.x, node.y);
    await page.keyboard.press('Enter');
    await R(() => window.__PIXEL_ENGINE__.step(3));
    await page.keyboard.press('Escape');
    const end = await R(() => {
      const { e, api, game } = window.__REPLAY_PLAYER__;
      e.step(30);
      return { tree: { after: [...game().save.hero.allocated], ui: api().state().ui.join(',') }, state: api().state(), print: e.fingerprint(), rec: JSON.stringify(e.recording()), errors: e.state().errors };
    });
    check(run.clickedNew && run.town === 'town' && run.rift.includes('rift') && run.level === 'level', `a session by input alone: New Run clicked → slot by key → town → the stick to Vex → F → depth 1 (${run.town}, ${run.rift}, ${run.level})`);
    check(run.fight.after.killed > run.fight.before.killed && run.fight.aimed > 30, `a fight with the mouse: ${run.fight.after.killed - run.fight.before.killed} kills over ${run.fight.aimed} frames of pointing, ${run.fight.rightClicks} right clicks`);
    check(run.aim.off < 0.3, `the hero aims where the pointer is, on bare ground (${run.aim.off.toFixed(2)} m from it)`);
    check(run.paused === 'pause' && run.resumed, `Escape pauses, Resume clicked with the mouse plays on (${run.paused}, resumed ${run.resumed})`);
    check(
      run.tree.open === 'tree' && run.tree.pick !== null && end.tree.after.length === run.tree.before.length + 1 && end.tree.after.includes(run.tree.pick) && end.tree.ui === '',
      `the passive tree's own view allocates ${run.tree.pick} (the mouse over it, Enter) and closes (Escape): ${run.tree.before.length} → ${end.tree.after.length} nodes, ${run.tree.unspent} point(s) were free`,
    );
    const rec = JSON.parse(end.rec);
    const commands = rec.frames.flatMap((f) => f.commands ?? []).map((c) => c.rl);
    check(['settings', 'saves', 'run', 'tree'].every((k) => commands.includes(k)), `the recording holds what came from the page: ${[...new Set(commands)].join(', ')} (commands)`);
    await capture(page, `riftlight-replay-${tag}-live.png`);

    // storage changes under the replay: another save in slot 1, other settings
    const stored = await R(() => {
      const g = window.__PIXEL_ENGINE__.game;
      const other = JSON.parse(JSON.stringify(g.save));
      other.hero.level = 7;
      other.hero.gold = 12345;
      g.store.save(0, other);
      localStorage.setItem('riftlight:settings', JSON.stringify({ screenShake: 0, zoom: 1.4, damageNumbers: false, glyphs: 'keyboard' }));
      return { slot: localStorage.getItem('riftlight:slot:0'), settings: localStorage.getItem('riftlight:settings') };
    });
    const again = await R(async (text) => {
      const e = window.__PIXEL_ENGINE__;
      const fresh = () => e.loadGame(window.__PIXEL_GAMES__.riftlight());
      const rec = JSON.parse(text);
      const t0 = performance.now(); // real time: how long the replay took
      await e.replay(rec, fresh);
      const ms = performance.now() - t0; // real time: how long the replay took
      const same = { print: e.fingerprint(), end: window.__RIFTLIGHT__.state(), slot: localStorage.getItem('riftlight:slot:0'), settings: localStorage.getItem('riftlight:settings') };
      // the pointer in a corner for a second of the fight: the same session must not match
      const edited = JSON.parse(text);
      const fight = edited.frames.findIndex((f, i) => i > edited.frames.length * 0.3 && f.held?.includes('MouseLeft'));
      for (let i = fight; i >= 0 && i < Math.min(fight + 60, edited.frames.length); i++) edited.frames[i].pointer = [0.95, 0.95, 1, 0];
      await e.replay(edited, fresh);
      const editedPrint = e.fingerprint();
      // an agent's newRun before the first frame stands: the slots and settings sent at setup give way
      await fresh();
      const g = e.game;
      window.__RIFTLIGHT__.newRun({ slot: 2, seed: 7 });
      g.settings.screenShake = 0.25;
      e.step(2);
      const agent = { slot: !g.saves.slots[2].empty && g.saves.last === 2, shake: g.settings.screenShake };
      return { ...same, ms, frames: rec.frames.length, editedPrint, editedAt: fight, agent, errors: e.state().errors };
    }, end.rec);
    check(again.print === end.print, `the session replays to the same fingerprint over other saves and settings (${end.print} vs ${again.print}; ${again.frames} frames in ${(again.ms / 1000).toFixed(1)} s)`);
    check(
      JSON.stringify(again.end.hero.position) === JSON.stringify(end.state.hero.position) && again.end.monsters.killed === end.state.monsters.killed && again.end.hero.gold === end.state.hero.gold && again.end.hero.xp === end.state.hero.xp,
      `and to the same run: hero at ${again.end.hero.position.join(', ')}, ${again.end.monsters.killed} kills, ${again.end.hero.xp} xp, ${again.end.hero.gold} gold`,
    );
    // the slot as it was; the settings as they were (a game's setup writes them back whole, same values)
    const kept = (a, b) => ['screenShake', 'zoom', 'damageNumbers', 'glyphs'].every((k) => JSON.parse(a)[k] === JSON.parse(b)[k]);
    check(again.slot === stored.slot && kept(again.settings, stored.settings), `the replay wrote nothing to storage: slot 1 ${again.slot === stored.slot ? 'kept' : 'overwritten'}, settings ${kept(again.settings, stored.settings) ? 'kept' : `changed (${again.settings})`}`);
    check(again.editedAt > 0 && again.editedPrint !== end.print, `a recording with the pointer in a corner for a second of the fight (from frame ${again.editedAt}) plays differently (${again.editedPrint})`);
    check(again.agent.slot && again.agent.shake === 0.25, `an agent's newRun before the first frame stands (slot 3 saved ${again.agent.slot}, shake ${again.agent.shake})`);
    check(end.errors.length === 0 && again.errors.length === 0, `no game errors${end.errors.concat(again.errors).length ? ': ' + end.errors.concat(again.errors).join('; ') : ''}`);
    await capture(page, `riftlight-replay-${tag}-replayed.png`);
    checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs, 'riftlight replay: ');
  } catch (e) {
    check(false, `riftlight replay crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
  }
}
