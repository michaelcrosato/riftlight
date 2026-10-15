/* global window -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-snapshot": Riftlight save-states (docs/GAME.md, *Save-states*). A run in
// town is played by input (the stick, the mouse aiming and swinging, a skill now and then: the
// townsfolk bark, the cat runs, cooldowns tick), then `engine.snapshot()` keeps the moment as
// JSON. Played on from there, then restored and played on the same way, the game reaches the
// same `engine.fingerprint()`, also when restored from inside a level with the inventory open,
// and in a fresh Riftlight a recording made after a restore replays to it. A snapshot taken
// just after a restore is the one restored; a different input plays differently; an open panel
// is refused with the reason. Then every designed depth (every mechanic): a fight by input
// (monsters spawned beside the hero, skills, a dodge), a snapshot mid-fight with effects in
// flight, played on, restored (the level built again), played on the same way: the same
// fingerprint; the first one restored from another level, from town, from the title and in a
// replay after a restore.
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
    // helpers shared by the town and level parts (window.__SNAP__)
    await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const I = e.input;
      const task = () => new Promise((r) => setTimeout(r, 0)); // promise callbacks run here
      const game = () => e.game;
      const api = () => window.__RIFTLIGHT__;
      const fresh = () => e.loadGame(window.__PIXEL_GAMES__.riftlight());
      /** Play `frames` by input: the stick in a slow loop, the pointer circling ahead, a swing, a skill. */
      const play = (frames, phase, prints = null) => {
        for (let f = 0; f < frames; f++) {
          if (prints && f % 30 === 0) prints.push(e.fingerprint());
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
      /** The pointer over a world point (normalised device coordinates through the camera). */
      const pointAt = (p) => {
        const v = p.clone().setY(p.y + 0.6).project(e.camera.camera);
        I.setPointer(Math.max(-0.98, Math.min(0.98, v.x)), Math.max(-0.98, Math.min(0.98, v.y)));
      };
      /** The stick toward world (dx, dz), through the camera's ground basis. */
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
      /**
       * Fight `frames` by input, deciding from what the game shows only (no memory of its own, so
       * a restored game is driven the same way): the pointer on the nearest monster, the stick to
       * it (or to the exit when none is near), the left button held in reach, a right click, the
       * second and third skills and a dodge now and then.
       */
      const fight = (frames, phase = 0) => {
        for (let f = 0; f < frames; f++) {
          const g = game();
          const hp = g.hero.actor.position;
          const ms = (g.level?.monsters() ?? []).filter((m) => m.actor.alive);
          const m = ms.length ? ms.reduce((a, b) => (a.actor.position.distanceTo(hp) <= b.actor.position.distanceTo(hp) ? a : b)) : null;
          const d = m ? m.actor.position.distanceTo(hp) : Infinity;
          if (m && d < 14) {
            pointAt(m.actor.position);
            if (d > 1.8) stickToward(m.actor.position.x - hp.x, m.actor.position.z - hp.z);
            else I.analog.x = I.analog.y = 0;
          } else if (g.level) {
            const x = g.level.exit;
            pointAt(x);
            stickToward(x.x - hp.x, x.z - hp.z);
          }
          const k = (f + phase) % 240;
          I.setButtons((k === 60 ? 2 : 0) | (d < 2.6 ? 1 : 0));
          I.setKey('Digit2', k === 120);
          I.setKey('Digit3', k === 180);
          I.setKey('Space', k === 200 && d < 3);
          e.step(1);
        }
        I.analog.x = I.analog.y = 0;
        I.setButtons(0);
        for (const c of ['Digit2', 'Digit3', 'Space']) I.setKey(c, false);
        e.step(1);
      };
      /** Into a depth (the level builds in promise callbacks). */
      const enter = async (depth) => {
        const entering = game().enterDepth(depth);
        for (let k = 0; k < 60 && game().screen !== 'level'; k++) {
          await task();
          e.step(1);
        }
        await entering;
        e.step(2);
      };
      /** A snapshot through JSON, as it would be kept. */
      const take = async () => JSON.parse(JSON.stringify(await e.snapshot()));
      /** Where two snapshots differ (the first few paths). */
      /**
       * Pictures only, compared right after a restore but not after playing on: a monster's look-at
       * mid cross-fade, and the hero's drawn pose (a restore lets planted feet go, so the stride
       * may settle a few frames differently; nothing in play reads it).
       */
      window.__PICTURE__ = /\.body\.look|\.hc\.animator|\.hc\.drawn/;
      /** Where two snapshots differ (the first few paths; `ignore`: paths that are pictures only). */
      const diff = (a, b, ignore = null) => {
        const out = [];
        const walk = (x, y, path) => {
          if (out.length > 6 || (ignore && ignore.test(path))) return;
          if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) {
            if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${path}: ${JSON.stringify(x)?.slice(0, 60)} vs ${JSON.stringify(y)?.slice(0, 60)}`);
            return;
          }
          for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[key], y[key], `${path}.${key}`);
        };
        walk({ ...a, engine: 0 }, { ...b, engine: 0 }, '');
        return out;
      };
      window.__SNAP__ = { e, I, task, game, api, fresh, play, fight, enter, take, diff };
    });
    const out = await R(async () => {
      const { e, task, game, api, fresh, play, take, diff } = window.__SNAP__;
      e.manual = true;
      await fresh();
      await task();
      api().newRun({ slot: 1, seed: 99 });
      e.step(3);
      await task();
      e.step(3);
      const at = () => [...game().hero.actor.position.toArray().map((x) => +x.toFixed(3))];
      const res = { town: game().screen };
      const counts = () => game().hero.hc.stats;
      const before = { ...counts() };
      const npcAt = () => game().town.npcs.map((n) => n.position.toArray().join());
      const npcs0 = npcAt();
      const cat0 = game().town.saveState().cat.position.join();
      play(360, 0);
      res.lively = { attacks: counts().attacks - before.attacks, casts: counts().casts - before.casts, npcsMoved: npcAt().filter((p, i) => p !== npcs0[i]).length, catMoved: game().town.saveState().cat.position.join() !== cat0 };
      // every skill and a dodge just before: cooldowns run at the snapshot; and a buff that never ends (Infinity)
      for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Space']) {
        e.input.setKey(k, true);
        e.step(1);
        e.input.setKey(k, false);
        e.step(2);
      }
      game().hero.actor.addBuff('e2e-forever', [], 0);
      const snap = await take();
      res.snapAt = { frame: e.state().frame, hero: at(), bytes: JSON.stringify(snap).length, cooldowns: snap.state.hero.hc.cooldowns.length };

      // the run as it went on (its fingerprint every 30 frames)
      const wentPrints = [];
      play(300, 1000, wentPrints);
      res.went = { print: e.fingerprint(), hero: at(), barks: game().town.npcs.map((n) => n.bubble?.text ?? '') };

      // restored and played on the same way
      let t0 = performance.now(); // real time: how long a restore takes
      await e.restore(snap);
      res.restoreMs = performance.now() - t0; // real time
      const again = await take();
      res.snapshotDiff = diff(snap, again);
      res.sameSnapshot = res.snapshotDiff.length === 0;
      const restoredPrints = [];
      play(300, 1000, restoredPrints);
      res.restored = { print: e.fingerprint(), hero: at(), forever: game().hero.actor.hasBuff('e2e-forever') };
      res.trajectory = restoredPrints.findIndex((p, i) => p !== wentPrints[i]);
      const rec = JSON.parse(JSON.stringify(e.recording()));
      res.recFrom = !!rec.from;

      // a different input from the same moment plays differently
      await e.restore(snap);
      play(300, 2000);
      res.other = e.fingerprint();
      // a snapshot that doesn't fit this town: refused before anything changes, the game as it was
      const beforeMisfit = { print: e.fingerprint(), time: e.time, hero: game().hero.actor.position.toArray().join() };
      res.misfit = await e.restore({ ...snap, state: { ...snap.state, town: { ...snap.state.town, extensions: [] } } }).then(
        () => '',
        (err) => err.message,
      );
      res.misfitKept = JSON.stringify(beforeMisfit) === JSON.stringify({ print: e.fingerprint(), time: e.time, hero: game().hero.actor.position.toArray().join() });

      // skills in flight when a restore comes (a nova, a dash): gone, the moment as it was
      await e.restore(snap);
      play(240, 3000); // past the snapshot's cooldowns
      const flying = () => game().hero.world?.combat?.effects.length ?? -1;
      for (const k of ['Digit2', 'Digit3', 'Digit1']) {
        e.input.setKey(k, true);
        e.step(1);
        e.input.setKey(k, false);
        for (let f = 0; f < 40 && flying() <= 0; f++) e.step(1); // its wind-up, then it flies
        if (flying() > 0) break;
      }
      res.inFlight = flying();
      await e.restore(snap);
      const afterFlight = JSON.parse(JSON.stringify(await e.snapshot()));
      res.inFlightDiff = JSON.stringify(afterFlight.state.hero) === JSON.stringify(snap.state.hero) ? '' : 'the hero differs';
      play(300, 1000);
      res.inFlightPrint = e.fingerprint();
      // from the arcade and from photo mode (modes with cameras of their own)
      await game().showcase.open(game().showcase.arcade, { instant: true });
      e.step(2);
      res.arcade = e.camera.preset;
      await e.restore(snap);
      play(300, 1000);
      res.fromArcade = e.fingerprint();
      game().photoMode();
      e.step(2);
      res.photo = e.camera.preset;
      await e.restore(snap);
      play(300, 1000);
      res.fromPhoto = e.fingerprint();

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
      res.levelTaken = await e.snapshot().then(
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
    check(out.sameSnapshot, `a snapshot just after restoring is the one restored${out.sameSnapshot ? '' : `: ${out.snapshotDiff.join('; ')}`}`);
    check(out.restored.print === out.went.print && out.trajectory === -1, `restored and played on the same way, the same game every 30 frames: ${out.went.print} vs ${out.restored.print}${out.trajectory >= 0 ? `, apart from frame ${out.trajectory * 30}` : ''} (hero at ${out.restored.hero.join(', ')} vs ${out.went.hero.join(', ')})`);
    check(out.snapAt.cooldowns > 0 && out.restored.forever, `cooldowns running at the snapshot (${out.snapAt.cooldowns}) and a buff that never ends come back`);
    check(out.inFlight > 0 && out.inFlightDiff === '' && out.inFlightPrint === out.went.print, `skills in flight at a restore (${out.inFlight} effects) are gone: the same moment, the same game (${out.inFlightPrint})${out.inFlightDiff ? `; ${out.inFlightDiff}` : ''}`);
    check(out.arcade !== 'iso' && out.fromArcade === out.went.print, `restored from the arcade (camera ${out.arcade}): the same game (${out.fromArcade})`);
    check(out.photo !== 'iso' && out.fromPhoto === out.went.print, `restored from photo mode (camera ${out.photo}): the same game (${out.fromPhoto})`);
    check(out.restoreMs < 500, `a restore takes ${out.restoreMs.toFixed(0)} ms`);
    check(out.other !== out.went.print, `a different input from the same moment plays differently (${out.other})`);
    check(/extensions/.test(out.misfit) && out.misfitKept, `a snapshot that doesn't fit this town is refused, the game as it was ("${out.misfit}")`);
    check(/panel is open/.test(out.panelRefused), `a snapshot with a panel open is refused: "${out.panelRefused}"`);
    check(out.level === 'level' && out.levelTaken === '', `a snapshot in a level is taken${out.levelTaken ? `: refused, "${out.levelTaken}"` : ''}`);
    check(out.fromLevel.screen === 'town' && out.fromLevel.ui === '' && out.fromLevel.print === out.went.print, `restored from a level with the inventory open: back in town, panels closed, the same game (${out.fromLevel.print}, ${out.fromLevelMs.toFixed(0)} ms)`);
    check(out.recFrom && out.replayed === out.went.print, `a recording made after a restore replays in a fresh Riftlight to the same moment (${out.replayed})`);
    check(out.errors.length === 0, `no game errors${out.errors.length ? ': ' + out.errors.join('; ') : ''}`);
    await capture(page, `riftlight-snapshot-${tag}.png`);

    // levels: a snapshot mid-fight on every designed depth (every mechanic), restored and played
    // on the same way; then the first one restored from another level, from town and from the title
    const lv = await R(async () => {
      const { e, task, game, api, fresh, fight, enter, take, diff } = window.__SNAP__;
      e.manual = true;
      await fresh();
      await task();
      api().newRun({ slot: 2, seed: 4242 });
      e.step(3);
      await task();
      e.step(3);
      game().dev.god = true; // a new hero lives through depth 12 (the same in every run: the snapshot keeps it)
      const rows = [];
      let first = null;
      for (let depth = 1; depth <= 12; depth++) {
        await enter(depth);
        const L = game().level;
        const hp = game().hero.actor.position;
        L.spawn(1000 + depth, hp.clone().set(hp.x + 4, hp.y, hp.z + 1), 'rare');
        L.spawn(2000 + depth, hp.clone().set(hp.x - 3, hp.y, hp.z + 3), 'magic');
        fight(150, depth * 7);
        const r = { depth, theme: L.spec.theme, mechanics: L.spec.mechanics.join('+') };
        let snap;
        try {
          snap = await take();
        } catch (err) {
          rows.push({ ...r, refused: err.message });
          continue;
        }
        r.kb = +(JSON.stringify(snap).length / 1024).toFixed(1);
        r.effects = L.world?.combat?.effects.length ?? -1;
        r.monsters = L.monsters().length;
        fight(180, 999);
        r.went = e.fingerprint();
        const wentSnap = await take();
        const t0 = performance.now(); // real time: how long a restore takes
        await e.restore(snap);
        r.ms = Math.round(performance.now() - t0); // real time
        r.diff = diff(snap, await take());
        fight(180, 999);
        r.restored = e.fingerprint();
        // everything, not only the fingerprint, after playing on (a monster's look-at mid cross-fade is a picture)
        r.played = diff(wentSnap, await take(), window.__PICTURE__);
        rows.push(r);
        if (depth === 1) first = { snap, went: r.went };
      }
      const from = {};
      const back = async (where) => {
        await e.restore(first.snap);
        fight(180, 999);
        from[where] = e.fingerprint() === first.went;
      };
      // a level this game would plan differently (another seed): refused before anything changes
      const lvl = first.snap.state.level;
      const other = { ...first.snap, state: { ...first.snap.state, level: { ...lvl, entry: { ...lvl.entry, spec: { ...lvl.entry.spec, seed: lvl.entry.spec.seed + 1 } } } } };
      const before = { print: e.fingerprint(), screen: game().screen, depth: game().level?.spec.depth };
      from.misfit = await e.restore(other).then(
        () => '',
        (err) => err.message,
      );
      from.misfitKept = JSON.stringify(before) === JSON.stringify({ print: e.fingerprint(), screen: game().screen, depth: game().level?.spec.depth });
      await back('level 12');
      game().returnToTown();
      e.step(5);
      await back('town');
      game().toTitle();
      e.step(5);
      await back('title');
      // a recording made after the restore replays in a fresh Riftlight to the same moment
      const rec = JSON.parse(JSON.stringify(e.recording()));
      await e.replay(rec, fresh);
      from.replayed = e.fingerprint() === first.went;
      return { rows, from, errors: e.state().errors };
    });
    for (const r of lv.rows) {
      const label = `depth ${r.depth} (${r.theme}, ${r.mechanics})`;
      if (r.refused) {
        check(false, `${label}: a snapshot mid-fight was refused: ${r.refused}`);
        continue;
      }
      check(
        r.diff.length === 0 && r.restored === r.went && r.played.length === 0,
        `${label}: mid-fight (${r.monsters} monsters, ${r.effects} effects in flight, ${r.kb} KB), restored in ${r.ms} ms, plays on the same (${r.went}${r.restored === r.went ? '' : ` vs ${r.restored}`})${r.diff.length ? `; the snapshot after the restore differs: ${r.diff.join('; ')}` : ''}${r.played.length ? `; 180 frames on, the state differs: ${r.played.join('; ')}` : ''}`,
      );
    }
    check(lv.rows.some((r) => r.effects > 0), `snapshots taken with combat effects in flight (${lv.rows.map((r) => r.effects).join(', ')})`);
    const slowest = Math.max(...lv.rows.map((r) => r.ms ?? 0));
    check(slowest < 2000, `a level restores in under 2 s (it is built again): slowest ${slowest} ms`);
    const { misfit, misfitKept, ...back } = lv.from;
    check(/built the same/.test(misfit) && misfitKept, `a level this game would plan differently is refused, the game as it was ("${misfit}")`);
    check(Object.values(back).every(Boolean), `depth 1's moment comes back the same from level 12, from town, from the title, and replayed after a restore (${JSON.stringify(back)})`);
    check(lv.errors.length === 0, `no game errors in levels${lv.errors.length ? ': ' + lv.errors.join('; ') : ''}`);
    await capture(page, `riftlight-snapshot-${tag}-level.png`);

    // a summoner (skeletons, a spectre) against waves: minions die and leave while monsters still
    // point at them (kept as ghosts); then a hero who can be hurt (hazards, mechanics, monsters)
    const sm = await R(async () => {
      const { e, I, task, game, api, fresh, fight, enter, take, diff } = window.__SNAP__;
      e.manual = true;
      await fresh();
      await task();
      api().newRun({ slot: 2, seed: 4242 });
      e.step(3);
      await task();
      e.step(3);
      game().dev.god = true;
      api().give({ levels: 20 });
      e.step(2);
      let uid = 1;
      const gem = (id) => ({ uid: `e2e-gem-${uid++}`, base: 'skill-gem', rarity: 'normal', level: 1, name: id, affixes: [], gem: { id, level: 8, support: false } });
      const sockets = [
        { slot: 0, gem: gem('summon-skeletons'), supports: [] },
        { slot: 1, gem: gem('raise-spectre'), supports: [] },
      ];
      const g0 = game();
      g0.save.hero.skills = sockets;
      g0.ports.loot.setSockets?.(sockets);
      g0.hero.setSkills(sockets);
      await enter(3);
      const out = { tries: 0, refused: [], ghostAt: -1, minions: 0 };
      let held = null;
      for (let f = 0; f < 1200; f += 10) {
        const g = game();
        g.hero.actor.mana = g.hero.actor.maxMana;
        if (f % 300 === 0) {
          const hp = g.hero.actor.position;
          for (let i = 0; i < 6; i++) g.level.spawn(300 + f + i, hp.clone().set(hp.x + 5 * Math.cos(i), hp.y, hp.z + 5 * Math.sin(i)), 'normal');
        }
        I.setKey('Digit1', f % 120 === 0);
        fight(10, f);
        out.minions = Math.max(out.minions, g.level.world.actors.actors.filter((a) => a.owner === g.hero.actor).length);
        out.tries++;
        try {
          const s = await take();
          if (!held && s.state.level.state.world.combat.actors.some((a) => a.kind === 'ghost')) {
            held = s;
            out.ghostAt = f;
          }
        } catch (err) {
          out.refused.push(`${f}: ${err.message}`);
        }
      }
      I.setKey('Digit1', false);
      // a moment holding a ghost, restored twice (into the run that went on, then again): the same
      if (held) {
        await e.restore(held);
        fight(240, 11);
        const a = { print: e.fingerprint(), snap: await take() };
        await e.restore(held);
        fight(240, 11);
        out.twice = { same: e.fingerprint() === a.print, diff: diff(a.snap, await take(), window.__PICTURE__) };
      }
      // hurt for real: no god mode, depth 2 mid-fight, the whole state compared after playing on
      game().dev.god = false;
      await enter(2);
      const L = game().level;
      const hp = game().hero.actor.position;
      L.spawn(4001, hp.clone().set(hp.x + 3, hp.y, hp.z), 'rare');
      fight(120, 5);
      const snap = await take();
      let low = Infinity;
      for (let f = 0; f < 240; f += 10) {
        fight(10, 21 + f);
        low = Math.min(low, game().hero.actor.life);
      }
      const went = { print: e.fingerprint(), snap: await take(), life: low, max: game().hero.actor.maxLife };
      await e.restore(snap);
      for (let f = 0; f < 240; f += 10) fight(10, 21 + f);
      out.mortal = { hurt: went.life < went.max, same: e.fingerprint() === went.print, diff: diff(went.snap, await take(), window.__PICTURE__), life: [went.life, went.max] };
      out.errors = e.state().errors;
      return out;
    });
    check(sm.minions > 0 && sm.ghostAt >= 0 && sm.refused.length === 0, `a summoner fights waves (up to ${sm.minions} minions): ${sm.tries} snapshots tried every 10 frames, none refused${sm.refused.length ? ` (refused ${sm.refused.length}: ${sm.refused.slice(0, 2).join('; ')})` : ''}; a minion gone but still pointed at was kept as a ghost from frame ${sm.ghostAt}`);
    check(!!sm.twice && sm.twice.same && sm.twice.diff.length === 0, `that moment, restored twice, plays on the same${sm.twice?.diff.length ? `: ${sm.twice.diff.join('; ')}` : ''}`);
    check(sm.mortal.hurt && sm.mortal.same && sm.mortal.diff.length === 0, `without god mode (the hero hurt: down to ${sm.mortal.life.map((x) => Math.round(x)).join(' of ')} life), restored mid-fight and played on: the same state${sm.mortal.diff.length ? `: ${sm.mortal.diff.join('; ')}` : ''}`);
    check(sm.errors.length === 0, `no game errors with the summoner${sm.errors.length ? ': ' + sm.errors.join('; ') : ''}`);
    checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs, 'riftlight snapshot: ');
  } catch (e) {
    check(false, `riftlight snapshot crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
  }
}
