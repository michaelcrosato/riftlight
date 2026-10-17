/* global window, document, Image, location */
// e2e suite "riftlight-showcase": the showcase pieces inside Riftlight (src/riftlight/showcase),
// driven frame-exactly through window.__RIFTLIGHT__. Their gameplay (the swoop, the cameras and
// looks, the scripted run, the save, the bestiary's exhibits, inspect, breeding) is checked
// headless in src/riftlight/showcase/headless.test.ts; here, what needs a page:
//
//   arcade    walk to the cabinet in Emberfall and use it: the swoop and the stage render; Esc
//             walks back out and the URL keeps the game's own camera.
//   bestiary  kill level 1's monsters, open the Hall of Beasts: the hall renders (frames of
//             inspect and breeding too).
//   photo     O in town: free camera; a gameboy look captured as a PNG (the frame holds only the
//             palette's shades), raw mode, time of day; Esc restores everything.
//
// Frames land in .scratch/e2e/showcase-*.png. Self-contained: e2e.mjs passes its helpers in.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, checkClean, colorCount }
 */
export async function runRiftlightShowcase(h) {
  const { exe, scenario: s, openPage, check, capture, state, checkClean, colorCount } = h;
  const tag = s.name;
  console.log(`\n▶ riftlight-showcase (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=777&save=memory');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.newRun({ slot: 0, seed: 777 });
      rl.setTimeOfDay(0.3);
      window.__PIXEL_ENGINE__.step(20);
    });

    // ---------------------------------------------------------------- arcade: the player's way in
    await R(() => window.__RIFTLIGHT__.talkTo('arcade'));
    await R(() => window.__PIXEL_ENGINE__.step(20));
    await capture(page, `showcase-${tag}-swoop.png`);
    await page.waitForFunction(
      () => {
        window.__PIXEL_ENGINE__.step(5);
        const a = window.__RIFTLIGHT__.arcade.state();
        return a.active && !window.__RIFTLIGHT__.game.showcase.iris && a.phase;
      },
      null,
      { timeout: 60000, polling: 50 },
    );
    await R(() => window.__PIXEL_ENGINE__.step(80));
    const arcadeShot = await capture(page, `showcase-${tag}-arcade.png`);
    check(colorCount(arcadeShot) > 12, `the stage renders (${colorCount(arcadeShot)} colours)`);
    // Esc, the player's way out
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await page.waitForFunction(
      () => {
        window.__PIXEL_ENGINE__.step(1);
        return !window.__RIFTLIGHT__.game.showcase.active;
      },
      null,
      { timeout: 30000, polling: 50 },
    );
    const url = await R(() => location.search);
    check(!/camera=|cam=/.test(url), `the URL keeps the game's own camera (${url})`);

    // ---------------------------------------------------------------- bestiary
    await R(async () => {
      const rl = window.__RIFTLIGHT__;
      await rl.enterDepth(1);
      window.__PIXEL_ENGINE__.step(5);
      rl.killAll();
      window.__PIXEL_ENGINE__.step(5);
      rl.toTown();
      window.__PIXEL_ENGINE__.step(5);
    });
    await R(() => window.__RIFTLIGHT__.bestiary.open());
    await R(() => window.__PIXEL_ENGINE__.step(30));
    const hall = await capture(page, `showcase-${tag}-hall.png`);
    check(colorCount(hall) > 16, `the hall renders (${colorCount(hall)} colours)`);
    await R(() => window.__RIFTLIGHT__.bestiary.inspect(0));
    await R(() => window.__PIXEL_ENGINE__.step(12));
    await capture(page, `showcase-${tag}-inspect.png`);
    await R(() => {
      window.__RIFTLIGHT__.bestiary.breed(0, 1);
      window.__PIXEL_ENGINE__.step(40);
    });
    await capture(page, `showcase-${tag}-breed.png`);
    await R(() => window.__RIFTLIGHT__.bestiary.close());

    // ---------------------------------------------------------------- photo mode
    await R(() => {
      window.__PIXEL_ENGINE__.step(30);
      window.__RIFTLIGHT__.press('KeyO');
    });
    let p = await R(() => window.__RIFTLIGHT__.photo.state());
    check(p.active && p.camera === 'free', `O opens photo mode with the free camera (${p.camera})`);
    const plain = await capture(page, `showcase-${tag}-photo-plain.png`);
    p = (await R(() => window.__RIFTLIGHT__.photo.setLook('gameboy'))).state;
    check(p.filters.join() === 'gameboy', `cycle to a palette (${p.filters.join(',')}, ${p.looks} looks in the list)`);
    const shot = await R(async () => {
      const c = await window.__RIFTLIGHT__.photo.capture({ download: false });
      const img = new Image();
      img.src = c.dataUrl;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const colours = new Set();
      for (let i = 0; i < d.length; i += 4) colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return { w: c.width, h: c.height, png: c.dataUrl.startsWith('data:image/png;base64,'), colours: colours.size, last: window.__RIFTLIGHT__.photo.state().last };
    });
    check(shot.png && shot.w > 0 && shot.h > 0, `P saves a PNG (${shot.w}x${shot.h}, ${shot.last?.bytes} bytes, ${shot.last?.name})`);
    check(shot.colours <= 4 && colorCount(plain) > 16, `the PNG has the filter applied: ${shot.colours} gameboy shades (plain frame ${colorCount(plain)} colours)`);
    await capture(page, `showcase-${tag}-photo-gameboy.png`);
    p = await R(() => window.__RIFTLIGHT__.photo.setMode('raw'));
    check(p.mode === 'raw', 'raw render mode from photo mode');
    p = await R(() => window.__RIFTLIGHT__.photo.setTime(0.62));
    check(Math.abs(p.timeOfDay - 0.62) < 1e-6, 'time of day set to night');
    await R(() => window.__RIFTLIGHT__.photo.setMode('pixel'));
    await R(() => window.__RIFTLIGHT__.photo.setLook('dream'));
    await capture(page, `showcase-${tag}-photo-night.png`);
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    p = await R(() => window.__RIFTLIGHT__.photo.state());
    check(!p.active && p.camera === 'iso' && p.filters.length === 0 && p.mode === 'pixel' && Math.abs(p.timeOfDay - 0.3) < 0.01, `Esc restores camera, filters, mode and time (${p.camera}, [${p.filters.join(',')}], ${p.mode}, ${p.timeOfDay.toFixed(2)})`);
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `riftlight-showcase crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
