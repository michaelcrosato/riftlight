/* global window, document -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-builds": the build systems the passive tree and loot feed, in the
// production build, for what only a page shows: frames of each (charges as pips orbiting the
// hero, a Vulnerability rune and tint, a Spell Totem, an armed trap; in the real game a brazier
// blast with a mechanic affix, a monster cursed and an Arc totem among the props), the HUD's
// mana globe with an aura's reserved share (a ×4 crop), zero console and GPU errors.
//
// The gameplay is checked headless: src/riftlight/combat/builds.arena.test.ts (charges, curses,
// totems, traps, auras, Discharge) and builds.level.test.ts (the brazier affixes, the globe's
// reserved share, a real monster cursed, an Arc totem casting).
//
//   npm run build && E2E_PORT=4602 npm run test:e2e -- riftlight-builds
//
// Frames land in .scratch/e2e/riftlight-builds-*.png.

import { writeFile } from 'node:fs/promises';

const BAR = 'vulnerability,fireball+spell-totem,fireball+trap-support,haste-aura,discharge';

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, colorCount, checkClean, OUT }
 */
export async function runRiftlightBuilds(h) {
  const { exe, scenario: s, openPage, check, capture, state, checkClean, OUT } = h;
  const tag = s.name;
  console.log(`\n▶ riftlight-builds (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, `game=arena&debug=0&touch=0&skills=${BAR}`);
    const { page, logs } = ctx;
    const R = (fn, arg) => page.evaluate(fn, arg);
    // a hero who can afford everything and dummies that stand still; three kills: nine charges
    await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      e.step(2);
      const a = g.hero.actor;
      a.stats.set('e2e', [
        { stat: 'mana', kind: 'flat', value: 400 },
        { stat: 'life', kind: 'flat', value: 2000 },
        { stat: 'mana.regen', kind: 'flat', value: 40 },
        { stat: 'charge.onKill', kind: 'flat', value: 1 },
      ]);
      a.mana = a.maxMana;
      a.life = a.maxLife;
      for (const d of g.dummies) d.brain = null;
      for (const d of g.dummies.filter((x) => x.name === 'dummy').slice(0, 3)) {
        d.life = 1;
        g.hero.teleport([d.position.x, 0, d.position.z + 1.3]);
        g.hero.facing = Math.PI;
        e.step(4);
        e.input.setKey('KeyJ', true);
        e.step(2);
        e.input.setKey('KeyJ', false);
        for (let i = 0; i < 40 && d.alive; i++) e.step(1);
        e.step(20);
      }
      g.hero.teleport([0, 0, 3]);
      g.hero.facing = Math.PI;
      e.step(30);
    });
    await capture(page, `riftlight-builds-${tag}-charges.png`);
    const press = (k, before, after) =>
      R(
        ({ k, before, after }) => {
          const e = window.__PIXEL_ENGINE__;
          const g = e.game;
          if (before.dummies) {
            g.spawnDummies();
            for (const d of g.dummies) d.brain = null;
          }
          g.hero.teleport(before.at);
          g.hero.facing = before.facing;
          e.step(before.frames);
          e.input.setKey(k, true);
          e.step(2);
          e.input.setKey(k, false);
          e.step(after);
        },
        { k, before, after },
      );
    // the curse: the hex circle fades, the rune under the cursed dummy stays
    await press('KeyK', { dummies: true, at: [0, 0, 1], facing: Math.PI, frames: 4 }, 60);
    await capture(page, `riftlight-builds-${tag}-curse.png`);
    await press('KeyQ', { at: [0, 0, 3], facing: Math.PI, frames: 10 }, 150);
    await capture(page, `riftlight-builds-${tag}-totem.png`);
    await press('KeyE', { dummies: true, at: [5, 0, 6], facing: 0, frames: 4 }, 60);
    await capture(page, `riftlight-builds-${tag}-trap.png`);
    checkClean(await state(page), logs, 'arena: ');
  } catch (e) {
    check(false, `riftlight-builds (arena) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }

  // ------------------------------------------------------------ the real game
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4343&save=memory');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    await R(async () => {
      const rl = window.__RIFTLIGHT__;
      rl.newRun({ slot: 0, seed: 4343 });
      await rl.enterDepth(1);
      window.__PIXEL_ENGINE__.step(5);
    });
    // a brazier blast with brazier.selfIgnite and brazier.area: the hero alight, a monster beside
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      const g = rl.game;
      const e = window.__PIXEL_ENGINE__;
      const level = g.level.level;
      const b = level.plan.elements.find((x) => x.mechanic === 'embers' && x.kind === 'brazier');
      rl.dev.ai = false;
      g.hero.setMods('e2e', [
        { stat: 'brazier.selfIgnite', kind: 'flag', value: 1 },
        { stat: 'brazier.area', kind: 'inc', value: 1 },
      ]);
      g.hero.hc.teleport([b.x, 0, b.z + 1.4]);
      const a = g.hero.actor;
      a.life = a.maxLife;
      rl.spawn({ seed: 7, x: b.x + 4.1, z: b.z, rank: 'normal' });
      const target = level.targets().find((t) => Math.hypot(t.position.x - b.x, t.position.z - b.z) < 0.1);
      target.takeHit({ source: a, tags: ['attack'], damage: { physical: 1 }, crit: false });
      e.step(20);
    });
    await capture(page, `riftlight-builds-${tag}-embers.png`);

    // an aura on the real bar: the HUD is its own 2D canvas; a ×4 crop of the mana globe (bottom
    // right) shows the reserved share's sealed cap
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      const g = rl.game;
      g.hero.hc.setSlot(0, { skill: 'haste-aura' });
      g.hero.actor.mana = g.hero.actor.maxMana;
      rl.step(40, { skill: 0 });
    });
    const hud = await R(() => {
      const src = document.querySelector('canvas[data-hud]');
      const c = document.createElement('canvas');
      c.width = c.height = 280;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#333c57';
      g.fillRect(0, 0, 280, 280);
      g.drawImage(src, src.width - 70, src.height - 70, 70, 70, 0, 0, 280, 280);
      return c.toDataURL('image/png');
    });
    await writeFile(new URL(`riftlight-builds-${tag}-globe.png`, OUT), Buffer.from(hud.split(',')[1], 'base64'));

    // a real monster, cursed, and a totem in a real level (how they read among the props)
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      const g = rl.game;
      const e = window.__PIXEL_ENGINE__;
      g.hero.hc.setSlot(1, { skill: 'vulnerability' });
      g.hero.hc.setSlot(2, { skill: 'arc', supports: ['spell-totem'] });
      const a = g.hero.actor;
      a.mana = a.unreservedMana;
      const p = a.position.clone();
      rl.spawn({ seed: 11, x: p.x + 3.5, z: p.z, rank: 'magic' });
      const unit = g.level.monsters().filter((u) => u.actor.alive).sort((u, v) => u.actor.position.distanceTo(p) - v.actor.position.distanceTo(p))[0];
      // hold the monsters still (dev AI off): they would walk out of the frame
      rl.dev.ai = false;
      const aim = { x: unit.actor.position.x, z: unit.actor.position.z };
      rl.step(20, { skill: 1, aim });
      rl.step(30, { skill: 2, aim });
      e.step(60);
    });
    await capture(page, `riftlight-builds-${tag}-level-curse-totem.png`);
    checkClean(await state(page), logs, 'game: ');
  } catch (e) {
    check(false, `riftlight-builds (game) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
