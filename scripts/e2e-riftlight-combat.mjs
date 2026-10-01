/* global window -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-combat": the Riftlight combat arena (/?game=arena) in the production
// build, on WebGPU and the WebGL 2 fallback. Everything runs on Engine.step (exact 1/60 s
// frames), so it is deterministic however slowly the machine renders.
//
//   npm run build && E2E_PORT=4401 npm run test:e2e -- riftlight-combat
//
// Covers: the arena boots clean (hero, sword, dummies); the basic attack combo lands on its
// hit frame with hit-stop, knockback, a flash and a damage number; a dodge roll moves the
// hero with i-frames and cancels an attack after its hit frame; a skill (fireball) pays mana,
// flies and hits; killing a dummy emits kill/death and its corpse pops and is removed; mouse
// buttons (virtual keys) attack; the frame renders with no GPU or console errors.
// Frames land in .scratch/e2e/riftlight-combat-*.png.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, colorCount, checkClean }
 */
export async function runRiftlightCombat(h) {
  const { exe, scenario: s, openPage, check, capture, state, colorCount, checkClean } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight-combat (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=arena&debug=0&touch=0');
    const { page, logs } = ctx;
    const st = await state(page);
    check(st.game === 'Riftlight Arena', `arena loads (${st.game}, ${st.backend})`);

    const boot = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      e.step(2);
      // page-side event log for the rest of the suite
      const log = [];
      g.actors.events.onAny((type, p) => log.push({ type, frame: e.frame, skill: p?.hit?.skill ?? p?.skill, total: p?.result?.total ?? 0, target: p?.target?.name ?? p?.actor?.name, crit: p?.result?.crit ?? false }));
      window.__RL = { log };
      return {
        hero: !!g.hero && g.hero.actor.alive,
        sword: !!g.heroModel.getObjectByName('Sword'),
        dummies: g.dummies.filter((d) => d.alive).length,
        slots: [g.hero.basic.id, ...g.hero.slots.map((x) => x?.id ?? null)],
        resolutionKey: e.debugKeys.resolution.join(','),
      };
    });
    check(boot.hero && boot.sword, `hero spawns with a sword in hand (${JSON.stringify({ hero: boot.hero, sword: boot.sword })})`);
    check(boot.dummies === 5, `five training dummies (${boot.dummies})`);
    check(boot.slots.join(',') === 'slash,cleave,fireball,frost-nova,leap-slam,whirlwind', `skill bar resolved (${boot.slots.join(', ')})`);
    check(boot.resolutionKey === 'F2', `R is a skill key: resolution hotkey moved to F2 (${boot.resolutionKey})`);

    // ------------------------------------------------------------ basic combo
    const combo = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const log = window.__RL.log;
      const dummy = g.dummies.find((d) => d.name === 'training dummy');
      dummy.brain = null; // stands still for the measurement
      g.hero.teleport([0, 0, 0.6]);
      g.hero.facing = Math.PI;
      e.step(10);
      const life0 = dummy.life;
      const z0 = dummy.position.z;
      const press = e.frame;
      e.input.setKey('KeyJ', true);
      e.step(2);
      e.input.setKey('KeyJ', false);
      let hitFrame = -1;
      let stop = { hero: 0, dummy: 0 };
      let flash = false;
      let dealt = 0;
      for (let i = 0; i < 40 && hitFrame < 0; i++) {
        e.step(1);
        const hit = log.find((l) => l.type === 'hit' && l.frame > press && l.target === 'training dummy' && l.total > 0);
        if (hit) {
          hitFrame = hit.frame;
          // what the hit took off the dummy (the still dummy regenerates, so its life later says little)
          dealt = life0 - dummy.life;
          stop = { hero: g.hero.actor.hitStop, dummy: dummy.hitStop };
          flash = dummy.fx.flashing;
        }
      }
      const numbers = g.combat.numbers.floaters.length;
      const clip = g.hero.anim;
      e.step(40);
      // the whole chain: J held keeps the combo going
      e.input.setKey('KeyJ', true);
      e.step(70);
      e.input.setKey('KeyJ', false);
      const steps = g.hero.stats.attacks;
      e.step(40);
      return { hitAfter: hitFrame - press, stop, flash, numbers, clip, damage: dealt, pushed: +(dummy.position.z - z0).toFixed(2), attacks: steps };
    });
    // Slash1 hits at frame 5 of 12 (0.42 s at 100% speed) → ~10.5 game frames after the press
    check(combo.hitAfter >= 8 && combo.hitAfter <= 13, `first slash lands on its hit frame (${combo.hitAfter} frames after the press)`);
    check(combo.damage > 0, `the dummy takes damage (${combo.damage.toFixed?.(1) ?? combo.damage})`);
    check(combo.stop.hero > 0 && combo.stop.dummy > 0, `hit-stop freezes hero and target (${JSON.stringify(combo.stop)})`);
    check(combo.flash, 'the target flashes on hit');
    check(combo.numbers > 0, `a damage number pops (${combo.numbers})`);
    check(combo.pushed < -0.05, `knockback pushes the dummy away (${combo.pushed} m)`);
    check(combo.attacks >= 4, `holding attack chains the combo (${combo.attacks} swings)`);

    // ------------------------------------------------------------ dodge roll + cancel
    const dodge = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      // open floor: the default iso camera turns D into a diagonal, clear of the pillars from here
      g.hero.teleport([0, 0, 10]);
      g.hero.facing = Math.PI / 2;
      e.step(10);
      const p0 = g.hero.feet;
      e.input.setKey('KeyD', true);
      e.input.setKey('Space', true);
      e.step(2);
      e.input.setKey('Space', false);
      e.step(2);
      const during = { state: g.hero.state, iframes: g.hero.actor.iframes, anim: g.hero.anim };
      e.step(24);
      e.input.setKey('KeyD', false);
      const moved = g.hero.feet.distanceTo(p0);
      e.step(20);
      // attack, then dodge right after the hit frame: the swing is cancelled
      g.hero.teleport([0, 0, 10]);
      g.hero.facing = Math.PI / 2;
      e.step(10);
      e.input.setKey('KeyJ', true);
      e.step(2);
      e.input.setKey('KeyJ', false);
      e.step(10);
      const cancels = g.hero.stats.cancels;
      e.input.setKey('Space', true);
      e.step(2);
      e.input.setKey('Space', false);
      e.step(2);
      const cancelled = { state: g.hero.state, cancels: g.hero.stats.cancels - cancels };
      e.step(40);
      return { during, moved: +moved.toFixed(2), cancelled };
    });
    check(dodge.during.state === 'dodge' && dodge.during.iframes > 0 && dodge.during.anim === 'Roll', `Space rolls with i-frames (${JSON.stringify(dodge.during)})`);
    check(dodge.moved > 3, `the roll covers ground (${dodge.moved} m)`);
    check(dodge.cancelled.state === 'dodge' && dodge.cancelled.cancels >= 1, `a dodge cancels an attack after its hit frame (${JSON.stringify(dodge.cancelled)})`);

    // ------------------------------------------------------------ a skill: fireball (Q)
    const fire = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const log = window.__RL.log;
      g.hero.teleport([0, 0, 4]);
      g.hero.facing = Math.PI;
      e.step(30);
      const mana0 = g.hero.actor.mana;
      const press = e.frame;
      e.input.setKey('KeyQ', true);
      e.step(2);
      e.input.setKey('KeyQ', false);
      const spent = mana0 - g.hero.actor.mana;
      let flying = 0;
      for (let i = 0; i < 30; i++) {
        e.step(1);
        flying = Math.max(flying, g.combat.active('projectile').length);
      }
      e.step(60);
      const hits = log.filter((l) => l.type === 'hit' && l.frame > press && l.skill === 'fireball' && l.total > 0).length;
      return { spent: +spent.toFixed(1), flying, hits };
    });
    check(fire.spent > 0, `fireball costs mana (${fire.spent})`);
    check(fire.flying > 0, 'the fireball flies (a projectile effect)');
    check(fire.hits > 0, `and hits a dummy (${fire.hits} hits)`);

    // ------------------------------------------------------------ mouse button = attack
    const mouse = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const before = g.hero.stats.attacks;
      e.input.setKey('MouseLeft', true);
      e.step(2);
      e.input.setKey('MouseLeft', false);
      e.step(30);
      return g.hero.stats.attacks - before;
    });
    check(mouse === 1, `the left mouse button attacks (${mouse})`);

    // ------------------------------------------------------------ kills, death pop, removal
    const kill = await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      const g = e.game;
      const log = window.__RL.log;
      const victim = g.dummies.find((d) => d.alive && d.name === 'dummy');
      victim.life = 1;
      victim.brain = null;
      g.hero.teleport([victim.position.x, 0, victim.position.z + 1.4]);
      g.hero.facing = Math.PI;
      e.step(6);
      const from = e.frame;
      e.input.setKey('KeyJ', true);
      e.step(24);
      e.input.setKey('KeyJ', false);
      const kills = log.filter((l) => l.type === 'kill' && l.frame >= from).length;
      const deaths = log.filter((l) => l.type === 'death' && l.frame >= from).length;
      const popped = victim.body.position.y > 0.05 || !victim.body.visible;
      const particles = e.particles.alive;
      e.step(120);
      return { kills, deaths, popped, particles, removed: !g.actors.actors.includes(victim) };
    });
    check(kill.kills >= 1 && kill.deaths >= 1, `a kill emits kill and death (${kill.kills}/${kill.deaths})`);
    check(kill.popped && kill.particles > 0, `the corpse pops with particles (${kill.particles} alive)`);
    check(kill.removed, 'the corpse is removed after its flicker');

    // ------------------------------------------------------------ the frame
    await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      e.game.hero.teleport([0, 0, 3]);
      e.input.setKey('KeyE', true);
      e.step(2);
      e.input.setKey('KeyE', false);
      e.step(26);
    });
    const shot = await capture(page, `riftlight-combat-${tag}.png`);
    check(colorCount(shot) > 12, `the arena renders (${colorCount(shot)} colours)`);
    await page.evaluate(() => (window.__PIXEL_ENGINE__.manual = false));
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `riftlight-combat crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
