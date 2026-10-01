// e2e suite "riftlight": the game shell end to end (production build), on WebGPU and the
// WebGL 2 fallback, driven frame-exactly through window.__RIFTLIGHT__ (Engine.step) and the
// real keyboard path for menus:
//
//   title → New Run (keys) → town → walk to Vex → rift menu → level 1 (real monsters and
//   its boss) → kill every monster, the boss too, with the basic attack (kill events, XP
//   rising) → collect gold → clear → portal → loot window → town (autosaved) → pause →
//   Tuning → enemy life slider (keys) → applies to live monsters (difficulty Mod source,
//   life fraction kept) → the boss kills the hero → recap names it → town with the penalty
//   → save → reload → Continue → same run. Zero console errors and GPU errors.
//
// Frames land in .scratch/e2e/riftlight-*.png. Self-contained: e2e.mjs passes its helpers in.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, checkClean, colorCount }
 */
export async function runRiftlight(h) {
  const { exe, scenario: s, openPage, check, capture, state, checkClean, colorCount } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4242');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const st = () => R(() => window.__RIFTLIGHT__.state());

    // ---------------------------------------------------------------- title
    let rs = await st();
    check(rs.screen === 'title' && rs.ui.includes('title'), `opens on the title screen (${rs.screen}, ui ${rs.ui.join(',')})`);
    await R(() => window.__PIXEL_ENGINE__.step(20));
    const title = await capture(page, `riftlight-${tag}-title.png`);
    check(colorCount(title) > 16, `title renders the town behind the logo (${colorCount(title)} colours)`);
    const hudPixels = await R(() => {
      const c = document.querySelector('canvas[data-hud]');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      return n;
    });
    check(hudPixels > 2000, `title logo and menu are drawn on the pixel HUD (${hudPixels} px)`);

    // New Run with the keyboard: Enter on "New Run", Enter on slot 1
    await R(() => window.__RIFTLIGHT__.press('Enter'));
    rs = await st();
    check(rs.ui.includes('slots'), `Enter on New Run opens the slot picker (ui ${rs.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('Enter'));
    rs = await st();
    check(rs.screen === 'town' && rs.hero.level === 1 && rs.deepest === 0, `a new run starts in town (${rs.screen}, level ${rs.hero.level})`);
    await R(() => window.__PIXEL_ENGINE__.step(30));
    await capture(page, `riftlight-${tag}-town.png`);

    // ---------------------------------------------------------------- town → rift keeper → level 1
    const talk = await R(() => window.__RIFTLIGHT__.talkTo('vex'));
    check(talk.ok && talk.state.ui.includes('rift'), `walk to Vex, talk: the rift menu opens (ui ${talk.state.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('Enter')); // the first entry is the next depth: I · EMBERS
    await page.waitForFunction(() => window.__RIFTLIGHT__.state().screen === 'level', null, { timeout: 30000 });
    rs = await R(() => {
      window.__PIXEL_ENGINE__.step(5);
      return window.__RIFTLIGHT__.state();
    });
    check(rs.depth === 1 && rs.levelName === 'Embers' && rs.monsters.total > 0, `entered depth 1 "${rs.levelName}" with ${rs.monsters.total} monsters`);
    check(rs.codex.includes('embers'), 'the codex unlocked the level mechanic');
    const roster = await R(() => {
      const ms = window.__RIFTLIGHT__.game.level.monsters();
      const boss = ms.find((m) => m.rank === 'boss');
      return { real: ms.filter((m) => typeof m.runtime?.play === 'function' && m.genome).length, total: ms.length, boss: boss && { name: boss.name, life: boss.actor.life, maxLife: boss.actor.maxLife, alive: boss.actor.alive } };
    });
    check(roster.real === roster.total, `every monster is a real animated genome (${roster.real}/${roster.total})`);
    check(!!roster.boss && roster.boss.alive && roster.boss.life === roster.boss.maxLife && roster.boss.maxLife > 0, `a boss spawned on level 1 (${roster.boss?.name}, ${roster.boss?.maxLife} life)`);
    await capture(page, `riftlight-${tag}-level.png`);

    // ---------------------------------------------------------------- fight with the basic attack
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      window.__KILLS__ = [];
      rl.game.events.on('kill', (e) => {
        const h = rl.state().hero;
        window.__KILLS__.push({ rank: e.rank, name: e.target.name, byHero: e.killer === rl.game.hero.actor, xp: h.xp, level: h.level });
      });
    });
    const fight = await R(() => window.__RIFTLIGHT__.fight({ skills: false, maxFrames: 60 * 150 }));
    rs = fight.state;
    const kills = await R(() => window.__KILLS__);
    const first = kills[0];
    check(!!first && first.byHero && (first.xp > 0 || first.level > 1), `a monster died to the hero and XP rose (${first?.name}: xp ${first?.xp}, level ${first?.level})`);
    check(kills.length === rs.monsters.killed, `every death was a kill event (${kills.length} events, ${rs.monsters.killed} killed)`);
    const bossKill = kills.find((k) => k.rank === 'boss');
    check(!!bossKill && bossKill.name === roster.boss?.name, `the boss died too (${bossKill?.name ?? 'alive'})`);
    check(kills.every((k, i) => i === 0 || k.level > kills[i - 1].level || k.xp >= kills[i - 1].xp), 'XP only rose kill by kill');
    check(rs.monsters.killed === rs.monsters.total && rs.monsters.total > 0, `killed every monster with the basic attack (${rs.monsters.killed}/${rs.monsters.total} in ${fight.frames} frames)`);
    check(rs.cleared && rs.exitOpen, `the level is clear and the portal open (cleared ${rs.cleared}, exit ${rs.exitOpen})`);
    check(rs.hero.xp > 0 || rs.hero.level > 1, `XP gained (level ${rs.hero.level}, xp ${rs.hero.xp})`);
    const gold0 = rs.hero.gold;
    const collect = await R(() => window.__RIFTLIGHT__.collectGold());
    rs = collect.state;
    check(rs.loot.gold === 0 && rs.hero.gold > gold0, `collected the gold (${gold0} → ${rs.hero.gold})`);
    await capture(page, `riftlight-${tag}-cleared.png`);

    // ---------------------------------------------------------------- portal → loot window → town
    const exit = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const ex = rl.game.level.exit;
      // leave one item on the floor so the loot window has something to offer
      if (!rl.game.ports.loot.ground().length) rl.game.ports.loot.spawn([{ kind: 'item', item: rl.game.ports.loot.give(rl.game.services.rng, 1) }], rl.game.hero.actor.position, rl.game.level, rl.game.services.rng);
      rl.game.ports.loot.counts();
      return rl.moveTo(ex.x, ex.z, { radius: 1.2, maxFrames: 2400 });
    });
    rs = await st();
    const sawWindow = rs.ui.includes('loot');
    if (sawWindow) {
      await R(() => window.__RIFTLIGHT__.ui.click('takeAll'));
      await R(() => window.__RIFTLIGHT__.ui.click('leave'));
    }
    await R(() => window.__PIXEL_ENGINE__.step(5));
    rs = await st();
    check(exit.arrived || sawWindow, `walked into the portal (arrived ${exit.arrived})`);
    check(sawWindow, 'the level-clear loot window offered what was left on the floor');
    check(rs.screen === 'town' && rs.deepest === 1, `back in town with depth 1 cleared (screen ${rs.screen}, deepest ${rs.deepest})`);
    const saved = await R(() => window.__RIFTLIGHT__.slots()[0]);
    check(!saved.empty && saved.deepest === 1, `autosaved on clear and town entry (slot 1: deepest ${saved.deepest})`);

    // ---------------------------------------------------------------- pause → Tuning → enemy life
    await R(async () => {
      await window.__RIFTLIGHT__.enterDepth(1);
      window.__PIXEL_ENGINE__.step(5);
    });
    const before = await R(() => window.__RIFTLIGHT__.actors().map((a) => ({ id: a.id, life: a.life, max: a.maxLife })));
    // hurt the first monster so we can see the life fraction survive the change
    await R(() => {
      const m = window.__RIFTLIGHT__.game.level.monsters()[0].actor;
      m.life = m.stats.get('life') / 2;
    });
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    rs = await st();
    check(rs.ui.includes('pause') && rs.paused, `Esc opens the pause menu and freezes the world (ui ${rs.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('ArrowDown'));
    await R(() => window.__RIFTLIGHT__.press('Enter'));
    rs = await st();
    check(rs.ui.at(-1) === 'tuning', `Resume ↓ Tuning ⏎ opens the tuning panel (ui ${rs.ui.join(',')})`);
    const widgets = await R(() => window.__RIFTLIGHT__.ui.widgets().map((w) => w.id));
    check(['preset', 'playerDamage', 'playerLife', 'playerSpeed', 'enemyDamage', 'enemyLife', 'enemySpeed', 'reset'].every((id) => widgets.includes(id)), `tuning has the presets, six sliders and reset (${widgets.join(',')})`);
    for (let i = 0; i < 5; i++) await R(() => window.__RIFTLIGHT__.press('ArrowDown'));
    const focused = await R(() => window.__RIFTLIGHT__.ui.widgets().find((w) => w.focus)?.id);
    check(focused === 'enemyLife', `↓×5 focuses the enemy life slider (${focused})`);
    for (let i = 0; i < 5; i++) await R(() => window.__RIFTLIGHT__.press('ArrowRight'));
    await capture(page, `riftlight-${tag}-tuning.png`);
    rs = await st();
    check(Math.abs(rs.difficulty.enemyLife - 1.5) < 1e-6, `→×5 sets enemy life to 1.5× (${rs.difficulty.enemyLife})`);
    const after = await R(() => window.__RIFTLIGHT__.actors().map((a) => ({ id: a.id, life: a.life, max: a.maxLife })));
    const ratio = after[0].max / before[0].max;
    check(Math.abs(ratio - 1.5) < 0.01, `live monsters' max life follows the slider (×${ratio.toFixed(3)})`);
    check(Math.abs(after[0].life / after[0].max - 0.5) < 0.01, `a hurt monster keeps its life fraction (${(after[0].life / after[0].max).toFixed(3)})`);
    const source = await R(() => window.__RIFTLIGHT__.game.level.monsters()[0].actor.stats.explain('life').map((e) => e.source));
    check(source.includes('difficulty'), `applied as the "difficulty" Mod source (${source.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    rs = await st();
    check(rs.ui.length === 0 && !rs.paused, `Esc backs out of the menus (ui ${rs.ui.join(',') || 'none'})`);
    const spawned = await R(() => window.__RIFTLIGHT__.spawn({ seed: 7 }));
    const fresh = await R((id) => window.__RIFTLIGHT__.actors().find((a) => a.id === id), spawned.id);
    check(fresh && Math.abs(fresh.life - fresh.maxLife) < 1e-6, `a monster spawned now is born with the tuned life (${fresh?.life} / ${fresh?.maxLife})`);

    // ---------------------------------------------------------------- death → recap → town with a penalty
    let goldBefore = (await st()).hero.gold;
    // walk up to the level boss with 1 life; the rest of the level (and the adds it calls)
    // are cleared away so the blow that lands is the boss's own
    const duel = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const level = rl.game.level;
      const boss = level.monsters().find((m) => m.rank === 'boss' && m.actor.alive);
      if (!boss) return { boss: null };
      const others = () => {
        for (const m of level.monsters()) if (m !== boss && m.actor.alive) m.actor.die(null);
      };
      others();
      let at = null;
      for (let k = 0; k < 16 && !at; k++) {
        const p = boss.actor.position.clone();
        p.x += Math.cos((k / 16) * Math.PI * 2) * 2.2;
        p.z += Math.sin((k / 16) * Math.PI * 2) * 2.2;
        if (level.stage.walkable(p.x, p.z, false)) at = p;
      }
      if (!at) return { boss: boss.name, placed: false };
      rl.setDifficulty({ enemyDamage: 4 });
      rl.game.hero.enter(level.stage, at, 0);
      rl.game.hero.actor.life = 1;
      let bar = null;
      let gold = rl.state().hero.gold;
      for (let i = 0; i < 900 && !rl.state().ui.includes('death'); i++) {
        gold = rl.state().hero.gold; // the penalty is taken when the recap opens
        others();
        window.__PIXEL_ENGINE__.step(1);
        bar ??= rl.state().boss?.name ?? null;
      }
      return { boss: boss.name, placed: true, bar, gold, killer: rl.game.layer.find('death')?.recap?.killer ?? null };
    });
    rs = await st();
    goldBefore = duel.gold ?? goldBefore;
    check(!!duel.boss && duel.placed, `stood next to the boss (${duel.boss})`);
    check(duel.bar === duel.boss, `the boss bar shows it once it is close (${duel.bar})`);
    check(rs.dead && rs.ui.includes('death'), `dying opens the death recap (dead ${rs.dead}, ui ${rs.ui.join(',')})`);
    check(!!duel.killer && duel.killer === duel.boss, `the recap names the boss as the killer (${duel.killer})`);
    await capture(page, `riftlight-${tag}-death.png`);
    await R(() => window.__RIFTLIGHT__.press('Enter'));
    rs = await st();
    check(rs.screen === 'town' && !rs.dead && rs.hero.life === rs.hero.maxLife, `Enter on the recap respawns in town at full life (${rs.screen})`);
    check(rs.hero.gold < goldBefore || goldBefore === 0, `the death penalty took gold (${goldBefore} → ${rs.hero.gold})`);
    await R(() => window.__RIFTLIGHT__.setDifficulty({ enemyDamage: 1 }));

    // ---------------------------------------------------------------- save → reload → continue
    const snapshot = await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.save(0);
      const s = rl.state();
      return { level: s.hero.level, xp: s.hero.xp, gold: s.hero.gold, deepest: s.deepest, enemyLife: s.difficulty.enemyLife, exported: rl.exportSave(0)?.length ?? 0 };
    });
    check(snapshot.exported > 200, `the slot exports as JSON (${snapshot.exported} chars)`);
    await page.reload();
    await page.waitForFunction(() => window.__RIFTLIGHT__ && window.__PIXEL_ENGINE__?.frame >= 2, null, { timeout: 90000 });
    const continueFirst = await R(() => {
      window.__PIXEL_ENGINE__.step(2);
      return window.__RIFTLIGHT__.ui.widgets()[0]?.id;
    });
    check(continueFirst === 'continue', `after a reload the title offers Continue (${continueFirst})`);
    await R(() => window.__RIFTLIGHT__.press('Enter'));
    rs = await st();
    check(
      rs.screen === 'town' && rs.hero.level === snapshot.level && rs.hero.xp === snapshot.xp && rs.hero.gold === snapshot.gold && rs.deepest === snapshot.deepest && rs.difficulty.enemyLife === snapshot.enemyLife,
      `Continue restores the run: level ${rs.hero.level}, xp ${rs.hero.xp}, gold ${rs.hero.gold}, deepest ${rs.deepest}, enemy life ${rs.difficulty.enemyLife}`,
    );
    await R(() => window.__PIXEL_ENGINE__.step(10));
    const town = await capture(page, `riftlight-${tag}-continued.png`);
    check(colorCount(town) > 16, 'the continued town renders');
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `riftlight crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
