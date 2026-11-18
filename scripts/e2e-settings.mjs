/* global window, document, getComputedStyle, PointerEvent -- page.evaluate callbacks run in the browser */
// e2e suite "settings": the player's settings (engine.settings, the ⚙ panel) and the engine
// hotkeys' default, in the real game (production build: the playground with no debug flag, which
// opts into `settings: { padButton: true }`: Options and Esc open the panel).
//
//   npm run build && npm run test:e2e -- settings
//
// Covers:
//   hotkeys  off without ?debug=1: R, P, M, ], ` change nothing
//   button   the ⚙ waits faded until the mouse moves, shows, fades again; it opens the panel
//   keys     open, the game is paused; a key held when it opened holds nothing in it; the arrows
//            move the focus and change values (◀ value ▶), Enter changes, Q / E turn the page,
//            and the panel never moves as they do (it keeps its tallest page's height); the rows
//            are a listbox whose aria-activedescendant follows the focus;
//            every row changes the engine: look, pixel art, pixel size, quality, frame rate, debug
//            info, sound, volume, button prompts, vibration; smooth 3D draws no look, so Look is
//            off then; the legend shows the keys; Escape closes it and the game goes on
//   saved    the choices are saved per game and applied at the next start; a review flag in
//            the URL (?look=) wins over the saved look; the legend's Reset, pressed twice (the
//            first says Press again to reset), gives the game its own picture
//   pad      Options opens it (and the press that opened it does not close it), the legend shows
//            the pad's buttons (Xbox's when chosen), the d-pad moves and changes, R1 turns the
//            page, Circle closes; the Cross pressed in it never jumps the hero after; the pad's
//            glyphs are drawn at a whole multiple of their 7 art pixels; a left stick still held
//            from a run when Options opens it steps nothing until it goes back to rest
//   mouse    hover moves the focus, a click on ▶ changes the row and leaves the keys the panel's
//            (the next Enter steps once; after a click on Reset, Enter changes the row only), a
//            click beside it closes
//   touch    (a phone, touch controls on) a tap on the ⚙ opens it, the legend says Tap and Swipe
//            (Tap · Change a hint, not a button), a tap on ▶ changes a row, a quick swipe down
//            closes it
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
  let phone;
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
          values: e.settings.values,
          panel: !document.querySelector('.settings-ui').hidden,
        };
      });
    /** The panel as drawn: its page, the focused row, each row's value, the legend's words and glyphs. */
    const panel = () =>
      E(() => {
        const root = document.querySelector('.settings-ui');
        const rows = [...root.querySelectorAll('.row')];
        return {
          page: root.querySelector('.tab[aria-selected="true"]')?.dataset.page,
          focus: rows.find((r) => r.classList.contains('focus'))?.dataset.row,
          values: Object.fromEntries(rows.map((r) => [r.dataset.row, r.querySelector('.value').textContent])),
          off: rows.filter((r) => r.classList.contains('off')).map((r) => r.dataset.row),
          legend: [...root.querySelectorAll('.legend button')].map((b) => [b.querySelector('kbd')?.textContent ?? (b.querySelector('canvas') ? 'glyph' : ''), b.textContent.replace(b.querySelector('kbd')?.textContent ?? '', '')]),
          pageGlyphs: [...root.querySelectorAll('.page-glyph')].map((g) => g.textContent || (g.querySelector('canvas') ? 'glyph' : '')),
          device: root.dataset.device,
          font: parseFloat(getComputedStyle(root).fontSize),
          rowHeight: rows[0]?.getBoundingClientRect().height ?? 0,
          box: (({ top, height }) => [Math.round(top), Math.round(height)])(root.querySelector('.panel').getBoundingClientRect()),
          // the rows hold the keyboard focus, and name the focused row to a screen reader
          aria: root.querySelector('.rows').getAttribute('aria-activedescendant') === rows.find((r) => r.classList.contains('focus'))?.id && document.activeElement === root.querySelector('.rows'),
          glyphs: [...root.querySelectorAll('.legend canvas')].map((c) => parseFloat(getComputedStyle(c).width)),
          resetWords: root.querySelector('.legend [data-act="reset"] > span')?.textContent,
        };
      });
    const lookOf = (name) => E((n) => JSON.stringify(window.__PIXEL_ENGINE__.lookPresets[n]), name);
    const gear = page.locator('.settings-button');
    const key = async (code, n = 1) => {
      for (let i = 0; i < n; i++) {
        await page.keyboard.press(code);
        await waitFrames(page, 2);
      }
    };
    const shot = (name) => page.screenshot({ path: fileURLToPath(new URL(`settings-${name}.png`, OUT)) });

    // ---------------------------------------------------------------- hotkeys: off
    const before = await engine();
    for (const k of ['KeyR', 'KeyP', 'KeyM', 'BracketRight', 'Backquote']) await page.keyboard.press(k);
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

    // ---------------------------------------------------------------- keys
    await page.keyboard.down('KeyD'); // walking right when the ⚙ is clicked
    await page.mouse.move(700, 340);
    await gear.click();
    await until(page, (e) => e.settings.isOpen && e.paused);
    const start = (await state(page)).target;
    await page.waitForTimeout(700); // past the menu's key repeat: a held D must not step a value
    await page.keyboard.up('KeyD');
    const opened = await engine();
    const first = await panel();
    const held = (await state(page)).target;
    const still = Math.hypot(held[0] - start[0], held[2] - start[2]);
    await shot('panel');
    check(
      opened.panel && opened.paused && still < 0.01 && first.values.look === "The game's" && first.page === 'picture' && first.focus === 'look',
      `the ⚙ opens the panel on Picture and pauses the game; the D held when it opened holds nothing in it (look ${first.values.look}, moved ${still.toFixed(2)} m)`,
    );
    check(
      first.font >= 18 && first.rowHeight >= 44 && JSON.stringify(first.legend) === JSON.stringify([['Enter', 'Change'], ['Esc', 'Close'], ['R', 'Reset']]) && first.pageGlyphs.join() === 'Q,E',
      `ten-foot rows (${first.font}px text, ${first.rowHeight.toFixed(0)}px rows) and a legend of the keys: ${JSON.stringify(first.legend)}, pages ${first.pageGlyphs.join(' ')}`,
    );
    await key('KeyE');
    const soundPage = await panel();
    await key('KeyE');
    const controlsPage = await panel();
    await key('KeyE'); // round to Picture
    await key('ArrowDown');
    const moved = await panel();
    await key('ArrowUp');
    check(
      [soundPage, controlsPage].every((p) => p.box.join() === first.box.join()) && controlsPage.page === 'controls' && first.aria && moved.aria && moved.focus === 'pixelArt',
      `turning the page never moves the panel (top, height: ${first.box} on Picture, ${soundPage.box} on Sound, ${controlsPage.box} on Controls); the rows hold the keys and name the focused row (${first.aria}, ${moved.aria})`,
    );
    await key('ArrowRight'); // Look: the next one
    await key('ArrowDown');
    await key('Enter'); // Pixel art: off
    const lookOff = (await panel()).off.includes('look');
    await key('ArrowDown');
    await key('Enter'); // Pixel size: chunky
    await key('ArrowDown');
    await key('ArrowLeft'); // Quality: auto → high (round)
    await key('ArrowDown');
    await key('ArrowRight'); // Frame rate: 30
    await key('ArrowDown');
    await key('Enter'); // Debug info: on
    const picture = await panel();
    await key('KeyE'); // Sound
    await key('Enter'); // off
    await key('ArrowDown');
    await key('ArrowLeft', 3); // volume 80% → 50%
    const sound = await panel();
    await key('KeyE'); // Controls
    await key('Enter'); // Xbox
    await key('ArrowDown');
    await key('ArrowLeft', 5); // vibration 50%
    const controls = await panel();
    const set = await engine();
    const noir = await lookOf('noir');
    check(
      set.mode === 'raw' && set.height === 180 && set.quality === 'high' && set.fps === 30 && set.debug && set.muted && set.master === 0.5 && set.values.padGlyphs === 'xbox' && set.values.vibration === 0.5,
      `each row changes the engine: smooth 3D, 320×180, high quality, 30 fps, debug panel, sound off, volume 50%, Xbox prompts, vibration 50% (${set.mode}, ${set.height} rows, ${set.quality}, ${set.fps} fps, ${set.master}, ${JSON.stringify(set.values)})`,
    );
    check(lookOff && picture.off.includes('look'), `smooth 3D draws no look: the Look row is off while pixel art is (${picture.off})`);
    check(
      picture.focus === 'debugInfo' && sound.page === 'sound' && sound.values.master === '50%' && controls.page === 'controls' && controls.values.padGlyphs === 'Xbox' && controls.values.vibration === '50%',
      `the arrows move and change, E turns the page (${picture.focus}; ${sound.page} ${sound.values.master}; ${controls.page} ${controls.values.padGlyphs} ${controls.values.vibration})`,
    );
    await shot('changed');
    await key('Escape');
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
    const look = stored?.look;
    check(
      JSON.stringify(stored) === JSON.stringify({ look, pixelArt: false, pixelSize: 'chunky', quality: 'high', fps: 30, debugInfo: true, padGlyphs: 'xbox', vibration: 0.5 }) && typeof look === 'string',
      `the choices are saved for this game: ${JSON.stringify(stored)}`,
    );
    await E((n) => window.__PIXEL_ENGINE__.settings.set({ look: n }), 'noir');
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
    await waitFrames(page, 2);
    await page.locator('.settings-ui .legend [data-act="reset"]').click();
    await waitFrames(page, 2);
    const armed = await engine();
    const armedPanel = await panel();
    await page.locator('.settings-ui .legend [data-act="reset"]').click();
    await waitFrames(page, 2);
    const reset = await engine();
    const left = await E(() => localStorage.getItem('pixel-engine:settings:playground'));
    check(
      armed.mode === 'raw' && armedPanel.resetWords === 'Press again to reset' && reset.look === before.look && reset.mode === 'pixel' && reset.height === 270 && reset.quality === 'medium' && reset.fps === 60 && !reset.debug && !reset.muted && reset.master === 0.8 && left === null,
      `the legend's Reset asks for a second press (${armedPanel.resetWords}; still ${armed.mode}), then gives the game its own picture and the default sound back, and forgets the choices (${reset.mode}, ${reset.height} rows, ${reset.quality}, ${reset.fps} fps)`,
    );
    await key('Enter'); // on Look: after a click on Reset, Enter changes the row, and only the row
    const afterReset = await engine();
    const afterResetPanel = await panel();
    check(
      JSON.stringify(Object.keys(afterReset.values)) === '["look"]' && afterResetPanel.resetWords === 'Reset' && afterResetPanel.aria,
      `after a click on the legend's Reset, Enter changes the focused row only (${JSON.stringify(afterReset.values)}; the legend says ${afterResetPanel.resetWords})`,
    );
    await E(() => window.__PIXEL_ENGINE__.settings.reset());
    await page.locator('.settings-ui .legend [data-act="close"]').click();
    await until(page, (e) => !e.settings.isOpen);

    // ---------------------------------------------------------------- a pad
    await E(() => {
      const pad = { connected: true, mapping: 'standard', index: 0, id: 'fake', axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
      window.__pad = pad;
      window.__realPads = navigator.getGamepads;
      navigator.getGamepads = () => [pad];
    });
    /** Hold pad buttons for `n` frames (a press), then let go. */
    const press = async (buttons, n = 3) => {
      await E((b) => window.__pad.buttons.forEach((x, i) => ((x.pressed = b.includes(i)), (x.value = b.includes(i) ? 1 : 0))), buttons);
      await waitFrames(page, n);
      await E(() => window.__pad.buttons.forEach((x) => ((x.pressed = false), (x.value = 0))));
      await waitFrames(page, 3);
    };
    await press([9], 12); // Options, held a while: the press that opens it must not close it
    const padOpen = await engine();
    const padPanel = await panel();
    await shot('pad');
    check(
      padOpen.open && padOpen.paused && padPanel.device === 'pad' && padPanel.legend.every(([g]) => g === 'glyph') && padPanel.pageGlyphs.join() === 'L1,R1',
      `Options opens it (held, it stays open), and the legend shows the pad's buttons: ${JSON.stringify(padPanel.legend)}, pages ${padPanel.pageGlyphs.join(' ')}`,
    );
    check(
      padPanel.glyphs.length === 3 && padPanel.glyphs.every((w) => w >= 21 && w % 7 === 0),
      `the pad's glyphs are drawn at a whole multiple of their 7 art pixels (${padPanel.glyphs.join(', ')} px)`,
    );
    await press([13]); // d-pad down
    await press([15]); // right: pixel art off
    const stepped = await panel();
    await press([5]); // R1
    await press([5]); // R1: Controls
    await press([0]); // Cross: Xbox
    const xbox = await panel();
    await press([0]); // Cross: PlayStation again
    await press([13]);
    await press([14]); // vibration 90%
    const vib = await engine();
    check(
      stepped.focus === 'pixelArt' && stepped.values.pixelArt === 'Off' && xbox.page === 'controls' && xbox.values.padGlyphs === 'Xbox' && xbox.pageGlyphs.join() === 'LB,RB' && vib.values.vibration === 0.9,
      `the d-pad moves and changes, R1 turns the page, Cross changes, and the legend follows the style (${stepped.focus} ${stepped.values.pixelArt}; ${xbox.page} ${xbox.values.padGlyphs}, pages ${xbox.pageGlyphs.join(' ')}; vibration ${vib.values.vibration})`,
    );
    const jumps0 = await E(() => window.__PIXEL_ENGINE__.game.hero.stats.jumps);
    await E(() => window.__pad.buttons[0].pressed = true); // Cross held as Circle closes it
    await press([0, 1]);
    await waitFrames(page, 20);
    const padClosed = await engine();
    const jumps1 = await E(() => window.__PIXEL_ENGINE__.game.hero.stats.jumps);
    check(!padClosed.open && !padClosed.paused && jumps1 === jumps0, `Circle closes it, and the Cross held through it never jumps the hero (open ${padClosed.open}, jumps ${jumps1 - jumps0})`);
    await press([9]);
    await press([9]);
    check(!(await engine()).open, 'Options opens and closes it');
    // a left stick still held from a run when Options opens it steps nothing (keys and buttons are
    // latched the same way), until it goes back to rest
    await E(() => window.__PIXEL_ENGINE__.settings.reset()); // pixel art again: Look can change
    const valuesBefore = JSON.stringify((await engine()).values);
    await E(() => (window.__pad.axes[0] = 1)); // running right
    await waitFrames(page, 10);
    await press([9]); // Options, the thumb still on the stick
    await page.waitForTimeout(1200); // past the menu's repeat delay (0.35 s), many times over
    const leaning = await engine();
    const leanPanel = await panel();
    await E(() => (window.__pad.axes[0] = 0)); // let go
    await waitFrames(page, 3);
    await E(() => (window.__pad.axes[0] = 1)); // and lean again: now it steps
    await page.waitForTimeout(900);
    await E(() => (window.__pad.axes[0] = 0));
    await waitFrames(page, 3);
    const leanAgain = await engine();
    check(
      leaning.open && leanPanel.focus === 'look' && JSON.stringify(leaning.values) === valuesBefore && leanAgain.values.look !== undefined,
      `a stick held from a run into the panel steps nothing for a second (focus ${leanPanel.focus}, ${JSON.stringify(leaning.values)} as before ${valuesBefore}); let go and leaned again, it steps (look ${leanAgain.values.look}, ${JSON.stringify(leanAgain.values)}, open ${leanAgain.open})`,
    );
    await press([9]);
    await E(() => {
      navigator.getGamepads = window.__realPads;
      window.__PIXEL_ENGINE__.settings.reset();
    });

    // ---------------------------------------------------------------- the mouse
    await page.mouse.move(640, 360);
    await page.keyboard.press('Escape');
    await until(page, (e) => e.settings.isOpen);
    await waitFrames(page, 2);
    const rows = await page.locator('.settings-ui .row').all();
    const box = await rows[3].boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 3 });
    await waitFrames(page, 2);
    const hovered = await panel();
    const arrow = await rows[3].locator('.arrow[data-step="1"]').boundingBox();
    await page.mouse.click(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2);
    await waitFrames(page, 2);
    const clicked = await panel();
    await key('Enter'); // the keys are still the panel's: one step, not the ▶ pressed again as well
    const entered = await panel();
    await page.mouse.click(8, 8); // beside the panel
    await until(page, (e) => !e.settings.isOpen);
    check(
      hovered.focus === 'quality' && clicked.values.quality === 'Low' && hovered.device === 'keyboard' && entered.values.quality === 'Medium' && clicked.aria,
      `hover moves the focus (${hovered.focus}), a click on ▶ changes the row (${clicked.values.quality}) and leaves the keys the panel's (Enter: ${entered.values.quality}, one step), a click beside the panel closes it`,
    );
    await E(() => window.__PIXEL_ENGINE__.settings.reset());

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

    // ---------------------------------------------------------------- a phone: taps and swipes
    phone = await openPage(exe, s, 'debug=0&touch=1', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const P = phone.page;
    await P.locator('.settings-button').tap();
    await until(P, (e) => e.settings.isOpen);
    await waitFrames(P, 2);
    const touchPanel = await P.evaluate(() => ({
      device: document.querySelector('.settings-ui').dataset.device,
      legend: [...document.querySelectorAll('.settings-ui .legend > *')].map((b) => b.textContent),
      acts: [...document.querySelectorAll('.settings-ui .legend > *')].map((b) => b.dataset.act ?? 'hint'),
      width: document.querySelector('.settings-ui .panel').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }));
    const pixelSize = P.locator('.settings-ui .row[data-row="pixelSize"] .arrow[data-step="1"]');
    await pixelSize.tap();
    await waitFrames(P, 2);
    const tapped = await P.evaluate(() => window.__PIXEL_ENGINE__.settings.values.pixelSize);
    await P.screenshot({ path: fileURLToPath(new URL('settings-phone.png', OUT)) });
    // a quick swipe down on the panel's tabs closes it
    await P.evaluate(async () => {
      const el = document.querySelector('.settings-ui .tabs');
      const r = el.getBoundingClientRect();
      const at = (type, y) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 51, isPrimary: true, clientX: r.left + r.width / 2, clientY: y, bubbles: true }));
      at('pointerdown', r.top + 4);
      await new Promise((res) => setTimeout(res, 60));
      at('pointermove', r.top + 120);
      at('pointerup', r.top + 260);
    });
    await waitFrames(P, 3);
    const swiped = await P.evaluate(() => window.__PIXEL_ENGINE__.settings.isOpen);
    check(
      touchPanel.device === 'touch' && touchPanel.legend.join('|') === 'TapChange|SwipeClose|Reset' && touchPanel.acts.join() === 'hint,close,reset' && tapped === 'chunky' && !swiped && !touchPanel.overflow && touchPanel.width <= 390 - 32,
      `on a phone a tap on the ⚙ opens it, the legend says ${touchPanel.legend.join(' · ')} (${touchPanel.acts.join(', ')}), a tap on ▶ changes a row (${tapped}), a swipe down closes it (open ${swiped}); it fits (${touchPanel.width}px wide)`,
    );
    await P.evaluate(() => window.__PIXEL_ENGINE__.settings.reset());
    checkClean(await state(P), phone.logs, 'settings (phone): ');
  } catch (e) {
    check(false, `settings crashed: ${e.message}`);
  } finally {
    await ctx?.browser.close();
    await phone?.browser.close();
  }
}
