/* global window */
// e2e suite "riftlight-monsters": the Monster Lab (/monster-lab.html) in the production build.
//
//   npm run build && npm run test:e2e -- riftlight-monsters
//
// Runs on WebGPU and on the WebGL 2 fallback. Covers: the lab renders a generated monster
// (nonblank frame), plays clips (walk, an attack, death), switches plan/seed, evolves a grid of
// 9 children and selects one, crossover and mutation, genome export, a contact sheet rendered
// in the browser, and zero GPU / console errors. Frames land in .scratch/e2e/monsters-*.png.
// Self-contained: e2e.mjs passes its helpers in.
import { writeFile } from 'node:fs/promises';

/**
 * @param {object} h helpers from e2e.mjs:
 *   { exe, scenario, openPage, until, check, capture, state, colorCount, checkClean, OUT }
 */
export async function runRiftlightMonsters(h) {
  const { exe, scenario: s, openPage, until, check, capture, state, colorCount, checkClean, OUT } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight-monsters (${s.backend})`);
  let ctx;
  try {
    const url = new URL('monster-lab.html', s.url.split('?')[0]).href + (s.url.includes('?') ? `?${s.url.split('?')[1]}` : '');
    ctx = await openPage(exe, { ...s, url }, 'seed=7&plan=quadruped&archetype=charger&debug=0');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__MONSTER_LAB__, null, { timeout: 60000 });
    const L = (fn, arg) => page.evaluate(fn, arg);
    const st0 = await state(page);
    check(st0.backend.startsWith(s.backend === 'WebGPU' ? 'WebGPU' : 'WebGL 2'), `backend is ${st0.backend}`);
    const plans = await L(() => window.__MONSTER_LAB__.plans());
    const archetypes = await L(() => window.__MONSTER_LAB__.archetypes());
    check(plans.length >= 9 && archetypes.length >= 10, `lab lists ${plans.length} plans and ${archetypes.length} archetypes`);
    let lab = await L(() => window.__MONSTER_LAB__.state());
    check(lab.mode === 'single' && lab.plan === 'quadruped' && lab.joints > 10, `URL seed/plan generate a quadruped (${lab.joints} joints, skills ${lab.skills.join(',')})`);
    const first = await capture(page, `monsters-${tag}-quadruped.png`);
    check(colorCount(first) > 12, `monster renders (${colorCount(first)} colours)`);

    // clips play
    const clips = await L(() => window.__MONSTER_LAB__.clips());
    check(['Idle', 'Walk', 'Run', 'Hit', 'Death', 'Spawn'].every((c) => clips.includes(c)) && clips.length >= 8, `clips: ${clips.join(', ')}`);
    for (const clip of ['Walk', clips.find((c) => ['Bite', 'Claw', 'Slam', 'ChargeWindup'].includes(c)) ?? 'Hit', 'Death']) {
      await L((c) => window.__MONSTER_LAB__.play(c), clip);
      const f0 = (await L(() => window.__MONSTER_LAB__.state())).frame;
      const moved = await until(page, (e, a) => window.__MONSTER_LAB__.state().frame !== a, f0, 30);
      lab = await L(() => window.__MONSTER_LAB__.state());
      check(moved && lab.clip === clip, `${clip} plays (frame ${lab.frame.toFixed(1)})`);
    }
    await L(() => window.__MONSTER_LAB__.seek(6));
    lab = await L(() => window.__MONSTER_LAB__.state());
    check(!lab.playing && Math.abs(lab.frame - 6) < 0.01, `seek pauses at frame 6 (${lab.frame})`);

    // another plan and seed
    await L(() => window.__MONSTER_LAB__.generate({ seed: 3, plan: 'hexapod', archetype: undefined }));
    lab = await L(() => window.__MONSTER_LAB__.state());
    check(lab.plan === 'hexapod', `generate({seed: 3, plan: 'hexapod'}) → ${lab.plan} ${lab.archetype}`);
    await L(() => window.__MONSTER_LAB__.play('Walk'));
    await until(page, () => window.__MONSTER_LAB__.state().frame > 2, null, 30);
    const spider = await capture(page, `monsters-${tag}-hexapod-walk.png`);
    check(colorCount(spider) > 12, 'hexapod walks on screen');

    // evolve: a grid of 9 children, select one
    const kids = await L(() => window.__MONSTER_LAB__.evolve(0.5).length);
    lab = await L(() => window.__MONSTER_LAB__.state());
    check(kids === 9 && lab.mode === 'grid' && lab.children === 9, `evolve shows ${lab.children} children`);
    await until(page, () => true, null, 3);
    const gridImg = await capture(page, `monsters-${tag}-evolve.png`);
    check(colorCount(gridImg) > 12, 'the evolve grid renders');
    const picked = await L(() => window.__MONSTER_LAB__.select(4));
    lab = await L(() => window.__MONSTER_LAB__.state());
    check(lab.mode === 'single' && lab.plan === picked.plan, `select(4) keeps child 5 (${picked.plan})`);

    // crossover and mutation
    await L(() => window.__MONSTER_LAB__.storeParent());
    await L(() => window.__MONSTER_LAB__.generate({ seed: 11, plan: 'biped' }));
    const child = await L(() => window.__MONSTER_LAB__.crossover());
    check(['biped', picked.plan].includes(child.plan) && child.parts.length >= 2, `crossover → ${child.plan} with ${child.parts.length} parts`);
    const mutant = await L(() => window.__MONSTER_LAB__.mutate(0.6));
    check(mutant.seed !== child.seed, 'mutate gives a new genome');

    // genome export, stats, sheets
    const json = await L(() => window.__MONSTER_LAB__.exportGenome());
    const g = JSON.parse(json);
    check(g.plan && Array.isArray(g.parts) && typeof g.genes === 'object' && g.palette && g.archetype, `exportGenome() is a genome (${json.length} chars)`);
    const stats = await L(() => window.__MONSTER_LAB__.stats());
    check(stats.mods.length > 0 && stats.skills.length > 0, `stats: ${stats.mods.length} mods, skills ${stats.skills.join(', ')}`);
    const sheet = await L(() => window.__MONSTER_LAB__.sheet('Idle'));
    check(sheet.startsWith('data:image/png') && sheet.length > 10000, 'contact sheet renders in the browser');
    await writeFile(new URL(`monsters-${tag}-sheet.png`, OUT), Buffer.from(sheet.split(',')[1], 'base64'));
    // the boss end of the scale
    await L(() => window.__MONSTER_LAB__.generate({ seed: 5, plan: 'brute', rank: 'boss' }));
    await until(page, () => true, null, 3);
    const boss = await capture(page, `monsters-${tag}-boss.png`);
    check(colorCount(boss) > 12, 'a boss-rank monster renders');
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `riftlight-monsters crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
