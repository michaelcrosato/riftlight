// e2e suite "riftlight": one browser run of the game shell (production build), driven
// frame-exactly through window.__RIFTLIGHT__ (Engine.step) and the real keyboard path for menus,
// for what only a page shows: the pictures, the pixel HUD, what is stored in localStorage, the
// page's own parts and a real reload.
//
//   title (the town behind the logo, the HUD drawn) → New Run (keys) → town → Vex → rift menu →
//   level 1 → cleared → pause → Tuning → Settings → Engine (saved in localStorage, no ⚙, no
//   engine hotkeys without ?debug=1) → look studio (L): Game Boy on the characters, remembered in
//   localStorage, H hides the panel → death recap → town → save → reload → Continue (the town
//   renders). Zero console errors and GPU errors.
//
// The gameplay of the same flow (the outskirts tour, the fight, gems, gold, the portal and the loot
// window, the tuning on live monsters, the look studio's state, the death and its penalty, Continue
// restoring the run) is checked headless: src/riftlight/game/flow.test.ts, flowFight.test.ts and
// flowLevel.test.ts.
//
// Frames land in .scratch/e2e/riftlight-*.png (`*-hud.png`: the frame with the pixel HUD on
// top, which `renderer.capture()` leaves out: the logo, menus, bars). Self-contained: e2e.mjs
// passes its helpers in.
import { writeFile } from 'node:fs/promises';

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, checkClean, colorCount }
 */
export async function runRiftlight(h) {
  const { exe, scenario: s, openPage, check, capture, state, checkClean, colorCount, encodePng, OUT } = h;
  /** The presented frame with the HUD canvas composited on top, written as `file`. */
  const captureWithHud = async (page, file) => {
    const frame = await capture(page, file.replace(/-hud\.png$/, '.png'));
    const hud = await page.evaluate(() => {
      const c = document.querySelector('canvas[data-hud]');
      return c && c.width ? { w: c.width, h: c.height, data: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data] } : null;
    });
    if (hud && encodePng && OUT) {
      const px = frame.pixels;
      const sx = frame.width / hud.w;
      const sy = frame.height / hud.h;
      for (let y = 0; y < frame.height; y++)
        for (let x = 0; x < frame.width; x++) {
          const i = (Math.floor(y / sy) * hud.w + Math.floor(x / sx)) * 4;
          if (hud.data[i + 3]) px.set(hud.data.slice(i, i + 3), (y * frame.width + x) * 4);
        }
      await writeFile(new URL(file, OUT), encodePng(frame));
    }
    return frame;
  };
  const tag = s.name;
  console.log(`\n▶ riftlight (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4242');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const st = () => R(() => window.__RIFTLIGHT__.state());

    /** A step the flow needs to go on (its checks are headless): a crash names it when it fails. */
    const need = (ok, what) => {
      if (!ok) throw new Error(`the flow stopped: ${what}`);
    };

    // ---------------------------------------------------------------- title
    let rs = await st();
    need(rs.screen === 'title', `opens on the title screen (${rs.screen})`);
    await R(() => window.__PIXEL_ENGINE__.step(20));
    const title = await captureWithHud(page, `riftlight-${tag}-title-hud.png`);
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
    rs = await R(() => window.__RIFTLIGHT__.press('Enter'));
    need(rs.screen === 'town', `a new run starts in town (${rs.screen})`);
    await R(() => window.__PIXEL_ENGINE__.step(30));
    await capture(page, `riftlight-${tag}-town.png`);

    // ---------------------------------------------------------------- town → rift keeper → level 1
    const talk = await R(() => window.__RIFTLIGHT__.talkTo('vex'));
    need(talk.ok && talk.state.ui.includes('rift'), `walk to Vex, talk: the rift menu opens (ui ${talk.state.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('Enter')); // the first entry is the next depth: I · EMBERS
    await page.waitForFunction(() => window.__RIFTLIGHT__.state().screen === 'level', null, { timeout: 30000 });
    await R(() => window.__PIXEL_ENGINE__.step(5));
    await captureWithHud(page, `riftlight-${tag}-level-hud.png`);
    await R(() => {
      window.__RIFTLIGHT__.killAll();
      window.__PIXEL_ENGINE__.step(40);
    });
    await capture(page, `riftlight-${tag}-cleared.png`);

    // ---------------------------------------------------------------- pause → Tuning
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => window.__RIFTLIGHT__.press('ArrowDown'));
    rs = await R(() => window.__RIFTLIGHT__.press('Enter'));
    need(rs.ui.at(-1) === 'tuning', `Resume ↓ Tuning ⏎ opens the tuning panel (ui ${rs.ui.join(',')})`);
    for (let i = 0; i < 5; i++) await R(() => window.__RIFTLIGHT__.press('ArrowDown'));
    for (let i = 0; i < 5; i++) await R(() => window.__RIFTLIGHT__.press('ArrowRight'));
    await capture(page, `riftlight-${tag}-tuning.png`);
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => window.__RIFTLIGHT__.press('Escape'));

    // ---------------------------------------------------------------- the engine's options: Settings → Engine, in the page
    const eng = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const e = window.__PIXEL_ENGINE__;
      rl.ui.open('settings');
      const opened = rl.ui.click('engine');
      rl.game.layer.top.panel.items().find((w) => w.id === 'pixelSize').set(1); // chunky
      e.step(2);
      const saved = localStorage.getItem('pixel-engine:settings:riftlight');
      e.settings.reset();
      e.step(2);
      rl.ui.close();
      rl.ui.close();
      return { opened, saved, gear: !!document.querySelector('.settings-button'), keys: e.debugKeys.mode.join() };
    });
    check(
      eng.opened && eng.saved === '{"pixelSize":"chunky"}' && !eng.gear && eng.keys === '',
      `Settings → Engine saves the engine's options in localStorage (${eng.saved}); no ⚙ over Riftlight's menus, and no engine hotkeys without ?debug=1 (${eng.keys || 'none'})`,
    );

    // ---------------------------------------------------------------- look studio: a filter on the characters only
    rs = await R(() => window.__RIFTLIGHT__.press('KeyL'));
    need(rs.ui.at(-1) === 'look', `L opens the look studio (ui ${rs.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('ArrowDown'));
    await R(() => window.__RIFTLIGHT__.press('ArrowRight')); // apply to: characters
    await R(() => window.__RIFTLIGHT__.ui.click('palette'));
    await R(() => window.__RIFTLIGHT__.ui.click('gameboy'));
    await R(() => window.__PIXEL_ENGINE__.step(2));
    const stored = await R(() => {
      const saved = JSON.parse(localStorage.getItem('riftlight:settings') ?? '{}');
      return { look: saved.look, actors: (saved.customLook?.actors?.filters ?? []).map((f) => f.id) };
    });
    check(stored.look === 'custom' && stored.actors.join() === 'gameboy', `the custom look is remembered in localStorage (${stored.look}, ${stored.actors.join(',')})`);
    await captureWithHud(page, `riftlight-${tag}-look-studio-hud.png`);
    // H hides the panel; the arrows still tweak the focused slider (Game Boy dither), H shows it
    await R(() => window.__RIFTLIGHT__.press('ArrowDown'));
    await R(() => window.__RIFTLIGHT__.press('ArrowDown'));
    await R(() => window.__RIFTLIGHT__.press('KeyH'));
    await R(() => window.__RIFTLIGHT__.press('ArrowLeft'));
    await R(() => window.__PIXEL_ENGINE__.step(2));
    await captureWithHud(page, `riftlight-${tag}-look-studio-hidden-hud.png`);
    await R(() => window.__RIFTLIGHT__.press('KeyH'));
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => window.__RIFTLIGHT__.ui.click('reset'));
    rs = await R(() => window.__RIFTLIGHT__.press('Escape'));
    need(rs.ui.length === 0, `Esc closes the studio (ui ${rs.ui.join(',')})`);

    // ---------------------------------------------------------------- death → recap → town
    rs = await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.game.hero.actor.die(null);
      for (let i = 0; i < 300 && !rl.state().ui.includes('death'); i++) window.__PIXEL_ENGINE__.step(1);
      return rl.state();
    });
    need(rs.ui.includes('death'), `dying opens the death recap (ui ${rs.ui.join(',')})`);
    await capture(page, `riftlight-${tag}-death.png`);
    rs = await R(() => window.__RIFTLIGHT__.press('Enter'));
    need(rs.screen === 'town', `Enter on the recap respawns in town (${rs.screen})`);

    // ---------------------------------------------------------------- save → reload → continue
    await R(() => window.__RIFTLIGHT__.save(0));
    await page.reload();
    await page.waitForFunction(() => window.__RIFTLIGHT__ && window.__PIXEL_ENGINE__?.frame >= 2, null, { timeout: 90000 });
    const continueFirst = await R(() => {
      window.__PIXEL_ENGINE__.step(2);
      return window.__RIFTLIGHT__.ui.widgets()[0]?.id;
    });
    need(continueFirst === 'continue', `after a reload the title offers Continue (${continueFirst})`);
    rs = await R(() => window.__RIFTLIGHT__.press('Enter'));
    need(rs.screen === 'town', `Continue goes to town (${rs.screen})`);
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
