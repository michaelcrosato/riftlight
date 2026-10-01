/* global window, document -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-builds": the build systems the passive tree and loot feed, in the
// production build, on WebGPU and the WebGL 2 fallback. Everything runs on Engine.step.
//
//   npm run build && E2E_PORT=4602 npm run test:e2e -- riftlight-builds
//
// In the combat arena (/?game=arena with a custom skill bar):
//   charges   kills grant endurance / frenzy / power charges (`charge.onKill`), shown as pips
//             orbiting the hero; Discharge spends them all for a bigger hit
//   curses    Vulnerability hexes the dummies (rune circle + tint on them, more damage taken)
//   totems    Fireball + Spell Totem plants a totem that casts fireballs at the dummies
//   traps     Fireball + Trap throws a trap that releases a fireball when a dummy walks in
//   auras     Haste reserves a quarter of the mana pool instead of paying a cost per toggle
// In the real game (level 1, Embers):
//   a mechanic affix: with `brazier.selfIgnite` and `brazier.area` a brazier blast sets the hero
//   alight instead of hurting it and reaches a monster outside the normal blast; an aura's
//   reservation shows on the mana globe.
// Zero console and GPU errors. Frames land in .scratch/e2e/riftlight-builds-*.png.

import { writeFile } from 'node:fs/promises';

const BAR = 'vulnerability,fireball+spell-totem,fireball+trap-support,haste-aura,discharge';

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, colorCount, checkClean, OUT }
 */
export async function runRiftlightBuilds(h) {
  const { exe, scenario: s, openPage, check, capture, state, checkClean, OUT } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight-builds (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, `game=arena&debug=0&touch=0&skills=${BAR}`);
    const { page, logs } = ctx;
    const R = (fn, arg) => page.evaluate(fn, arg);

    const boot = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      e.step(2);
      const log = [];
      g.actors.events.onAny((type, p) => log.push({ type, frame: e.frame, skill: p?.hit?.skill ?? p?.skill, source: p?.hit?.source?.name ?? p?.actor?.name ?? null, sourceTags: p?.hit?.source?.tags ?? p?.actor?.tags ?? [], total: p?.result?.total ?? 0, target: p?.target?.name ?? null, outcome: p?.outcome }));
      window.__RL = { log };
      // a hero who can afford everything, and dummies that stand still to be measured
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
      return { slots: g.hero.slots.map((x) => x && { id: x.id, placement: x.placement, reservation: x.reservation }) };
    });
    check(boot.slots[1]?.placement === 'totem' && boot.slots[2]?.placement === 'trap' && boot.slots[3]?.reservation > 0, `skill bar: curse, totem, trap, aura, discharge (${JSON.stringify(boot.slots)})`);

    // ------------------------------------------------------------ charges from kills
    const charges = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const a = g.hero.actor;
      let kills = 0;
      for (const d of g.dummies.filter((x) => x.name === 'dummy').slice(0, 3)) {
        // one swing kills it: the hero stands in front and swings with J
        d.life = 1;
        g.hero.teleport([d.position.x, 0, d.position.z + 1.3]);
        g.hero.facing = Math.PI;
        e.step(4);
        e.input.setKey('KeyJ', true);
        e.step(2);
        e.input.setKey('KeyJ', false);
        for (let i = 0; i < 40 && d.alive; i++) e.step(1);
        if (!d.alive) kills++;
        e.step(20);
      }
      g.hero.teleport([0, 0, 3]);
      g.hero.facing = Math.PI;
      e.step(30);
      return { kills, count: { ...a.charges.count }, pips: a.status?.pipCount ?? 0, frenzyDamage: a.stats.explain('damage').some((x) => x.source === 'charges') };
    });
    check(charges.kills === 3, `three dummies killed with the basic attack (${charges.kills})`);
    check(charges.count.endurance === 3 && charges.count.frenzy === 3 && charges.count.power === 3, `each kill granted a charge of every kind (${JSON.stringify(charges.count)})`);
    check(charges.pips === 9 && charges.frenzyDamage, `nine charge pips orbit the hero and the charges are a stat source (${charges.pips} pips)`);
    await capture(page, `riftlight-builds-${tag}-charges.png`);

    // ------------------------------------------------------------ curse
    const curse = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      g.spawnDummies();
      for (const d of g.dummies) d.brain = null;
      g.hero.teleport([0, 0, 1]);
      g.hero.facing = Math.PI;
      e.step(4);
      e.input.setKey('KeyK', true);
      e.step(2);
      e.input.setKey('KeyK', false);
      e.step(40);
      const cursed = g.dummies.filter((d) => d.curses.has('vulnerability'));
      return {
        cursed: cursed.length,
        shown: cursed.filter((d) => d.status?.cursed && d.fx.tinted).length,
        taken: cursed[0] ? cursed[0].stats.get('damage.taken', ['physical']) : 0,
        events: window.__RL.log.filter((l) => l.type === 'curse' && l.outcome === 'applied').length,
      };
    });
    check(curse.cursed > 0 && curse.events >= curse.cursed, `Vulnerability cursed ${curse.cursed} dummies (${curse.events} curse events)`);
    check(curse.shown === curse.cursed, `every cursed dummy shows a rune circle and a tint (${curse.shown}/${curse.cursed})`);
    check(Math.abs(curse.taken - 1.3) < 0.01, `cursed dummies take 30% more physical damage (${curse.taken})`);
    // the hex circle has faded: what stays is the rune under the cursed dummy
    await R(() => window.__PIXEL_ENGINE__.step(20));
    await capture(page, `riftlight-builds-${tag}-curse.png`);

    // ------------------------------------------------------------ totem
    const totem = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const press = (k) => {
        e.input.setKey(k, true);
        e.step(2);
        e.input.setKey(k, false);
      };
      g.hero.teleport([0, 0, 3]);
      g.hero.facing = Math.PI;
      e.step(10);
      const from = window.__RL.log.length;
      press('KeyQ');
      e.step(150);
      const t = g.actors.actors.find((x) => x.tags.includes('totem'));
      const hits = window.__RL.log.slice(from).filter((l) => l.type === 'hit' && l.total > 0 && l.sourceTags.includes('totem'));
      return { totem: !!t && t.alive, owner: t?.owner === g.hero.actor, casts: window.__RL.log.slice(from).filter((l) => l.type === 'skill' && l.sourceTags.includes('totem')).length, hits: hits.length };
    });
    check(totem.totem && totem.owner, `Spell Totem planted a totem for the hero (${JSON.stringify(totem)})`);
    check(totem.casts > 0 && totem.hits > 0, `the totem cast fireballs that hit the dummies (${totem.casts} casts, ${totem.hits} hits)`);
    await capture(page, `riftlight-builds-${tag}-totem.png`);

    // ------------------------------------------------------------ trap
    const trap = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      g.spawnDummies();
      for (const d of g.dummies) d.brain = null;
      g.hero.teleport([5, 0, 6]);
      g.hero.facing = 0;
      e.step(4);
      const from = window.__RL.log.length;
      e.input.setKey('KeyE', true);
      e.step(2);
      e.input.setKey('KeyE', false);
      e.step(60);
      window.__RL.trapFrom = from;
      return { thrown: g.combat.active('trap').length, armed: g.combat.active('trap').some((t) => !t.sprung) };
    });
    await capture(page, `riftlight-builds-${tag}-trap.png`);
    const sprung = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const from = window.__RL.trapFrom;
      // a dummy walks onto it
      const at = g.combat.active('trap')[0]?.at;
      const d = g.dummies.find((x) => x.name === 'dummy');
      if (at && d) {
        d.mover.teleport(at.x + 0.3, 0, at.z);
        d.position.copy(d.mover.position);
      }
      e.step(40);
      const released = window.__RL.log.slice(from).filter((l) => l.type === 'skill' && l.sourceTags.includes('proxy')).length;
      const hits = window.__RL.log.slice(from).filter((l) => l.type === 'hit' && l.total > 0 && l.target === 'dummy').length;
      return { released, hits };
    });
    Object.assign(trap, sprung);
    check(trap.thrown === 1 && trap.armed, `Fireball + Trap threw an armed trap (${JSON.stringify(trap)})`);
    check(trap.released > 0 && trap.hits > 0, `the trap released its fireball when a dummy came near (${trap.released} releases, ${trap.hits} hits)`);

    // ------------------------------------------------------------ aura reservation + discharge
    const aura = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const a = g.hero.actor;
      const press = (k) => {
        e.input.setKey(k, true);
        e.step(2);
        e.input.setKey(k, false);
      };
      g.hero.teleport([0, 0, 2]);
      a.mana = a.maxMana;
      e.step(30);
      const before = a.mana;
      press('KeyR');
      e.step(60);
      const on = { reserved: a.reservedFraction, mana: a.mana, max: a.maxMana, paid: before - a.mana };
      press('KeyR');
      e.step(30);
      // Discharge: every charge for one big storm
      const held = a.charges.total;
      a.mana = a.maxMana;
      press('KeyF');
      e.step(60);
      return { on, off: a.reservedFraction, held, after: a.charges.total };
    });
    check(Math.abs(aura.on.reserved - 0.25) < 1e-6 && aura.on.mana <= aura.on.max * 0.75 + 1e-6, `Haste reserves 25% of the mana pool (${(aura.on.reserved * 100).toFixed(0)}%, mana ${Math.round(aura.on.mana)}/${Math.round(aura.on.max)})`);
    check(aura.off === 0, `toggling it off gives the reservation back (${aura.off})`);
    check(aura.held === 9 && aura.after === 0, `Discharge spent every charge (${aura.held} → ${aura.after})`);
    checkClean(await state(page), logs, 'arena: ');
  } catch (e) {
    check(false, `riftlight-builds (arena) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }

  // ------------------------------------------------------------ the real game: a mechanic affix
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
    const embers = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const g = rl.game;
      const e = window.__PIXEL_ENGINE__;
      const level = g.level.level;
      const b = level.plan.elements.find((x) => x.mechanic === 'embers' && x.kind === 'brazier');
      const events = [];
      const relit = [];
      g.events.on('mechanic', (m) => {
        events.push(m.event);
        if (m.id === 'embers' && m.event === 'relight' && m.at) relit.push(m.at.clone());
      });
      // Monsters hold still: Vorgath's brazier slam detonates braziers too, and one woken by the
      // skip-ahead below can set off this brazier just after it relights (the blast then never comes).
      rl.dev.ai = false;
      const blast = (mods) => {
        g.hero.setMods('e2e', mods);
        g.hero.hc.teleport([b.x, 0, b.z + 1.4]);
        const a = g.hero.actor;
        a.life = a.maxLife;
        const life = a.life;
        // a monster just outside the normal blast (3.2 m)
        const m = rl.spawn({ seed: 7, x: b.x + 4.1, z: b.z, rank: 'normal' });
        const unit = g.level.monsters().find((u) => u.actor.alive && Math.hypot(u.actor.position.x - b.x - 4.1, u.actor.position.z - b.z) < 0.6);
        const mLife = unit ? unit.actor.life : 0;
        const target = level.targets().find((t) => Math.hypot(t.position.x - b.x, t.position.z - b.z) < 0.1);
        target.takeHit({ source: a, tags: ['attack'], damage: { physical: 1 }, crit: false });
        e.step(20);
        return { heroLost: life - a.life, ignited: a.stats.hasCondition('ignited'), monsterLost: unit ? mLife - unit.actor.life : -1, spawned: !!m };
      };
      const plain = blast([]);
      // braziers relight after 18 s: skip ahead until this one has
      const lit = () => relit.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 0.1);
      for (let i = 0; i < 30 * 60 && !lit(); i++) e.step(1);
      if (!lit()) return { plain, geared: { relit: false }, events };
      const geared = blast([
        { stat: 'brazier.selfIgnite', kind: 'flag', value: 1 },
        { stat: 'brazier.area', kind: 'inc', value: 1 },
      ]);
      return { plain, geared, events };
    });
    check(embers.plain.heroLost > 0 && !embers.plain.ignited, `a plain brazier blast hurts the hero (${Math.round(embers.plain.heroLost)} life)`);
    check(embers.geared.heroLost === 0 && embers.geared.ignited && embers.events.includes('selfIgnite'), `with brazier.selfIgnite the blast sets the hero alight instead (${JSON.stringify(embers.geared)})`);
    check(embers.plain.monsterLost === 0 && embers.geared.monsterLost > 0, `brazier.area reaches a monster outside the normal blast (${embers.plain.monsterLost} → ${Math.round(embers.geared.monsterLost)})`);
    await capture(page, `riftlight-builds-${tag}-embers.png`);

    // an aura on the real bar: the globe shows the reserved mana
    const globe = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const g = rl.game;
      g.hero.hc.setSlot(0, { skill: 'haste-aura' });
      g.hero.actor.mana = g.hero.actor.maxMana;
      rl.step(40, { skill: 0 });
      return g.hero.vitals();
    });
    check(globe.reserved > 0 && Math.abs(globe.reserved - globe.maxMana * 0.25) < 0.5, `the mana globe gets the reserved share (${Math.round(globe.reserved)} of ${Math.round(globe.maxMana)})`);
    // the HUD is its own 2D canvas: save it to see the globe's sealed cap
    // (and a ×4 crop of the mana globe, bottom right)
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
    const real = await R(() => {
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
      const totem = g.level.world.actors.actors.find((x) => x.tags.includes('totem') && x.alive);
      return { cursed: unit.actor.curses.list.map((c) => c.id), rune: !!unit.actor.status?.cursed, tinted: unit.actor.fx.tinted, totem: !!totem, casts: totem?.brain?.casts ?? 0 };
    });
    check(real.cursed.includes('vulnerability') && real.rune && real.tinted, `a real monster cursed with Vulnerability shows its rune and tint (${JSON.stringify(real)})`);
    check(real.totem && real.casts > 0, `an Arc totem stands in the level and casts (${real.casts} casts)`);
    await capture(page, `riftlight-builds-${tag}-level-curse-totem.png`);
    checkClean(await state(page), logs, 'game: ');
  } catch (e) {
    check(false, `riftlight-builds (game) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
