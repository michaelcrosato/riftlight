// e2e suite "riftlight-loot": Riftlight loot in the real game (production build): what only a
// page shows.
//
//   npm run build && npm run test:e2e -- riftlight-loot
//
// Opens the Loot Lab (`?game=lootlab`): boss kills drop loot (a picture of the drops), I opens
// the inventory and hovering an item draws its tooltip on the item windows' canvas (a picture),
// Ctrl-click stashes it (a picture of the stash), Escape hides the windows' canvas; zero console
// errors / warnings and zero GPU errors. The gameplay (drops, pickup, the filter, equipping by
// right-click and drag, the stash, Escape) is checked headless: src/riftlight/loot/lootlab.test.ts.
//
// Frames land in .scratch/e2e/riftlight-loot-*.png. Self-contained: e2e.mjs passes its helpers in.
/* global window, document */
import { writeFile } from 'node:fs/promises';

/**
 * @param {object} h helpers from e2e.mjs:
 *   { exe, scenario, openPage, check, capture, checkClean, encodePng, OUT }
 */
export async function runRiftlightLoot(h) {
  const { exe, scenario: s, openPage, check, capture, checkClean, encodePng, OUT } = h;
  const tag = s.name;
  console.log(`\n▶ riftlight-loot (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=lootlab&debug=0');
    const { page, logs } = ctx;
    const E = (fn, arg) => page.evaluate(fn, arg);
    await page.waitForFunction(() => !!window.__LOOTLAB__, null, { timeout: 60000 });
    const step = (n) => E((k) => window.__PIXEL_ENGINE__.step(k), n);
    await step(2);

    // ---------------------------------------------------------------- drops
    await E(() => window.__LOOTLAB__.kill('boss', 2, 1));
    await step(42);
    await saveComposite(page, `riftlight-loot-${tag}-drops.png`);

    // ---------------------------------------------------------------- inventory
    await E(() => {
      const lab = window.__LOOTLAB__;
      for (const [base, rarity] of [['leather-belt', 'magic'], ['ruby-ring', 'magic'], ['iron-hat', 'normal']]) lab.give(base, rarity, false);
    });
    await page.keyboard.press('KeyI');
    await step(2);

    // Hover: a tooltip with a comparison.
    const hat = await E(() => window.__LOOTLAB__.give('leather-cap', 'rare', false).uid);
    await step(1);
    const hatPt = await E((uid) => {
      const ui = window.__LOOTLAB__.ui;
      const c = ui.itemCenter(uid);
      return ui.toClient(c.x, c.y);
    }, hat);
    const opaque = () =>
      E(() => {
        const c = document.querySelector('canvas[data-items-ui]');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
        return n;
      });
    const quiet = await opaque();
    await page.mouse.move(hatPt.x, hatPt.y);
    await step(2);
    const tip = await opaque();
    check(tip > quiet + 2000, `hovering an item draws its tooltip (${quiet} → ${tip} opaque px)`);
    await saveComposite(page, `riftlight-loot-${tag}-inventory.png`);

    // Ctrl-click into the stash.
    await page.keyboard.press('KeyT');
    await step(2);
    await page.keyboard.down('Control');
    await page.mouse.click(hatPt.x, hatPt.y);
    await page.keyboard.up('Control');
    await step(2);
    await saveComposite(page, `riftlight-loot-${tag}-stash.png`);
    await page.keyboard.press('Escape');
    await step(2);
    check(await E(() => document.querySelector('canvas[data-items-ui]').style.display === 'none'), "Escape hides the item windows' canvas");

    const st = await E(() => window.__PIXEL_ENGINE__.state());
    checkClean(st, logs, 'riftlight-loot: ');
  } catch (err) {
    check(false, `riftlight-loot (${s.backend}) ran: ${err.message}`);
  } finally {
    await ctx?.browser.close();
  }

  /** The presented frame with the HUD and the item windows composited on top. */
  async function saveComposite(page, file) {
    const frame = await capture(page, file);
    const overlays = await page.evaluate(() =>
      ['canvas[data-hud]', 'canvas[data-items-ui]']
        .map((sel) => document.querySelector(sel))
        .filter((c) => c && c.style.display !== 'none' && c.width > 0)
        .map((c) => ({ w: c.width, h: c.height, data: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data] })),
    );
    const scale = await page.evaluate(() => window.__PIXEL_ENGINE__.renderer.framing.scale);
    const px = frame.pixels;
    for (const o of overlays) {
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const i = (Math.floor(y / scale) * o.w + Math.floor(x / scale)) * 4;
          if (!o.data[i + 3]) continue;
          px.set(o.data.slice(i, i + 3), (y * frame.width + x) * 4);
        }
      }
    }
    await writeFile(new URL(file, OUT), encodePng(frame));
  }
}
