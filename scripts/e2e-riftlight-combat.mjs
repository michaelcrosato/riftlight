/* global window -- page.evaluate callbacks run in the browser */
// e2e suite "riftlight-combat": the Riftlight combat arena (/?game=arena) in the production
// build: what only a page shows. The arena renders mid-fight (a frost nova among the dummies)
// with no GPU or console errors. Everything runs on Engine.step (exact 1/60 s frames).
//
//   npm run build && E2E_PORT=4401 npm run test:e2e -- riftlight-combat
//
// The gameplay (boot, combo, hit-stop, knockback, dodge, skills, mouse, kills, the debug
// hotkeys) is checked headless: src/riftlight/combat/arena.test.ts.
// Frames land in .scratch/e2e/riftlight-combat-*.png.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, colorCount, checkClean }
 */
export async function runRiftlightCombat(h) {
  const { exe, scenario: s, openPage, check, capture, state, colorCount, checkClean } = h;
  const tag = s.name;
  console.log(`\n▶ riftlight-combat (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=arena&debug=0&touch=0');
    const { page, logs } = ctx;

    // ------------------------------------------------------------ the frame
    // the arena mid-fight: a frost nova (E) among the dummies
    await page.evaluate(() => {
      const e = window.__PIXEL_ENGINE__;
      e.step(60); // the dummies walk up
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
