/* global window, document -- page.evaluate callbacks run in the browser */
// e2e suite "settings": the player's settings (engine.settings, the ⚙ panel) and the engine
// hotkeys' default, in the real game (production build: the playground with no debug flag).
//
//   npm run build && npm run test:e2e -- settings
//
// Covers:
//   hotkeys  off without ?debug=1: R, P, M, ], ` change nothing
//   button   the ⚙ waits faded until the mouse moves, shows, fades again; it opens the panel
//   panel    open, the game is paused and keys stay in the panel (D moves no one, picks
//            nothing); every control changes the engine: look, pixel art, pixel size, quality,
//            frame rate, sound, volume, debug info; smooth 3D draws no look, so Look is off
//            then; Escape closes it and the game goes on
//   saved    the choices are saved per game and applied at the next start; a review flag in
//            the URL (?look=) wins over the saved look; Reset gives the game its own picture
//   replay   the settings stay shut while a replay plays (its input must play on untouched)
//
// Frames land in .scratch/e2e/settings-*.png (the panel as the player sees it).
import { fileURLToPath } from 'node:url';

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, ready, until, check, state, waitFrames, checkClean, OUT }
 */
export async function runSettings(h) {
  const { exe, scenario: s, openPage, ready, until, check, state, waitFrames, checkClean, OUT } = h;
  console.log('\n▶ settings');
  let ctx;
  try {
    ctx = await openPage(exe, s, 'debug=0', { viewport: { width: 1280, height: 720 } });
    const { page, logs } = ctx;
    const E = (fn, arg) => page.evaluate(fn, arg);
    const engine = () =>
      E(() => {
        const e = window.__PIXEL_ENGINE__;
        return {
          keys: Object.values(e.debugKeys).flat().length,
          height: e.renderer.baseResolution.height,
          mode: e.renderer.mode,
          look: JSON.stringify(e.look),
          quality: e.quality,
          fps: e.maxFps,
          debug: e.debugShown,
          muted: e.audio.muted,
          master: e.audio.volume.master,
          paused: e.paused,
          open: e.settings.isOpen,
          panel: !document.querySelector('.settings-ui').hidden,
        };
      });
    const lookOf = (name) => E((n) => JSON.stringify(window.__PIXEL_ENGINE__.lookPresets[n]), name);
    const gear = page.locator('.settings-button');
    const control = (id) => page.locator(`.settings-ui [data-s="${id}"]`);

    // ---------------------------------------------------------------- hotkeys: off
    const before = await engine();
    for (const key of ['KeyR', 'KeyP', 'KeyM', 'BracketRight', 'Backquote']) await page.keyboard.press(key);
    await waitFrames(page, 5);
    const after = await engine();
    check(
      before.keys === 0 && after.height === before.height && after.mode === before.mode && after.look === before.look && after.muted === before.muted && !after.debug,
      `without ?debug=1 the engine hotkeys are off: R, P, M, ], \` change nothing (${after.height} rows, ${after.mode}, debug panel ${after.debug})`,
    );

    // ---------------------------------------------------------------- the ⚙ button
    const idle = () => gear.evaluate((b) => b.classList.contains('idle'));
    const waited = await idle();
    await page.mouse.move(600, 300);
    await page.mouse.move(640, 320);
    const woke = !(await idle());
    const faded = await page
      .waitForFunction(() => document.querySelector('.settings-button').classList.contains('idle'), null, { timeout: 10000 })
      .then(() => true, () => false);
    check((await gear.count()) === 1 && waited && woke && faded, `the ⚙ waits faded, shows when the mouse moves and fades again (${waited}, ${woke}, ${faded})`);
    await page.mouse.move(700, 340);
    await gear.click();
    await until(page, (e) => e.settings.isOpen && e.paused);
    const opened = await engine();
    await page.screenshot({ path: fileURLToPath(new URL('settings-panel.png', OUT)) });
    const start = (await state(page)).target;
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyD');
    const held = (await state(page)).target;
    const still = Math.hypot(held[0] - start[0], held[2] - start[2]);
    check(opened.panel && opened.paused && still < 0.01 && (await engine()).look === before.look, `the ⚙ opens the panel and pauses the game; D moves no one and picks nothing (moved ${still.toFixed(3)} m)`);

    // ---------------------------------------------------------------- every control
    await control('look').selectOption('noir');
    await control('pixelArt').uncheck();
    const lookOff = await control('look').isDisabled();
    await control('pixelSize').selectOption('chunky');
    await control('quality').selectOption('high');
    await control('fps').selectOption('30');
    await control('debugInfo').check();
    await control('sound').uncheck();
    await control('master').fill('50');
    const set = await engine();
    const noir = await lookOf('noir');
    check(
      set.look === noir && set.mode === 'raw' && set.height === 180 && set.quality === 'high' && set.fps === 30 && set.debug && set.muted && set.master === 0.5,
      `each control changes the engine: look noir, smooth 3D, 320×180, high quality, 30 fps, debug panel, sound off, volume 50% (${set.mode}, ${set.height} rows, ${set.quality}, ${set.fps} fps, ${set.master})`,
    );
    check(lookOff, `smooth 3D draws no look: the Look is off while pixel art is (disabled ${lookOff})`);
    await page.screenshot({ path: fileURLToPath(new URL('settings-changed.png', OUT)) });
    await page.keyboard.press('Escape');
    await until(page, (e) => !e.settings.isOpen && !e.paused);
    const closed = await engine();
    // the hero walks again (smooth 3D at full size is slow on a software GPU: give it time)
    const p0 = (await state(page)).target;
    await page.keyboard.down('KeyD');
    const walked = await page
      .waitForFunction((from) => Math.hypot(window.__PIXEL_ENGINE__.state().target[0] - from[0], window.__PIXEL_ENGINE__.state().target[2] - from[2]) > 0.3, p0, { timeout: 15000 })
      .then(() => true, () => false);
    await page.keyboard.up('KeyD');
    check(!closed.panel && !closed.paused && walked, `Escape closes the panel and the game goes on (panel ${closed.panel}, paused ${closed.paused}, the hero walks ${walked})`);

    // ---------------------------------------------------------------- saved, and the URL wins
    const stored = await E(() => JSON.parse(localStorage.getItem('pixel-engine:settings:playground') ?? 'null'));
    check(
      JSON.stringify(stored) === JSON.stringify({ look: 'noir', pixelArt: false, pixelSize: 'chunky', quality: 'high', fps: 30, debugInfo: true }),
      `the choices are saved for this game: ${JSON.stringify(stored)}`,
    );
    await page.reload();
    await ready(page);
    const again = await engine();
    // this page says ?debug=0: a review flag, so the saved debug panel stays off
    check(
      again.look === noir && again.mode === 'raw' && again.height === 180 && again.quality === 'high' && again.fps === 30 && !again.debug && again.muted,
      `the next start applies them, the sound stays off, and ?debug=0 wins over the saved debug panel (noir ${again.look === noir}, ${again.mode}, ${again.height} rows, ${again.quality}, ${again.fps} fps, debug ${again.debug}, muted ${again.muted})`,
    );
    const url = new URL(page.url());
    url.searchParams.delete('debug');
    url.searchParams.set('look', 'handheld');
    await page.goto(url.href);
    await ready(page);
    const flagged = await engine();
    check(
      flagged.look === (await lookOf('handheld')) && flagged.mode === 'raw' && flagged.debug && flagged.keys === 0,
      `?look=handheld wins over the saved look; with no ?debug the saved debug panel shows (${flagged.debug}) and the hotkeys stay off; the rest still apply`,
    );

    // ---------------------------------------------------------------- Reset
    url.searchParams.delete('look');
    await page.goto(url.href);
    await ready(page);
    await E(() => window.__PIXEL_ENGINE__.settings.open());
    await page.locator('.settings-ui [data-a="reset"]').click();
    const reset = await engine();
    const left = await E(() => localStorage.getItem('pixel-engine:settings:playground'));
    check(
      reset.look === before.look && reset.mode === 'pixel' && reset.height === 270 && reset.quality === 'medium' && reset.fps === 60 && !reset.debug && !reset.muted && reset.master === 0.8 && left === null,
      `Reset gives the game its own picture and the default sound back, and forgets the choices (${reset.mode}, ${reset.height} rows, ${reset.quality}, ${reset.fps} fps)`,
    );
    await page.locator('.settings-ui [data-a="done"]').click();

    // ---------------------------------------------------------------- a replay plays on untouched
    const duringReplay = await E(() => {
      const e = window.__PIXEL_ENGINE__;
      e.input.playing = true; // what a replay sets while it plays
      e.settings.open();
      const shut = { open: e.settings.isOpen, paused: e.paused };
      e.input.playing = false;
      return shut;
    });
    check(!duringReplay.open && !duringReplay.paused, `the settings stay shut while a replay plays, and the game unpaused (open ${duringReplay.open}, paused ${duringReplay.paused})`);
    checkClean(await state(page), logs, 'settings: ');
  } catch (e) {
    check(false, `settings crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
  }
}
