// e2e suite "riftlight-loot": Riftlight loot end to end in the real game (production build).
//
//   npm run build && npm run test:e2e -- riftlight-loot
//
// Opens the Loot Lab (`?game=lootlab`) on WebGPU and the WebGL 2 fallback and checks:
//   drops      kills burst items and gold out in an arc; they land, show labels, rares a beam
//   pickup     walking over gold collects it, F picks up the nearest item, clicking a label too
//   filter     Alt toggles the loot filter (hidden normal items show)
//   inventory  I opens the window; right-click equips (StatSheet changes), drag and drop onto
//              a paper-doll slot equips, hovering shows a tooltip, Ctrl-click moves to the stash
//   clean      zero console errors / warnings and zero GPU errors
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
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
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
    const before = await E(() => window.__LOOTLAB__.world.drops.length);
    check(before === 0, 'the lab starts with nothing on the ground');
    await E(() => window.__LOOTLAB__.kill('boss', 2, 1));
    const spawned = await E(() => {
      const w = window.__LOOTLAB__.world;
      return { n: w.drops.length, flying: w.drops.filter((d) => d.t < 1).length, items: w.drops.filter((d) => d.item).length, gold: w.drops.filter((d) => !d.item).length };
    });
    check(spawned.items >= 2 && spawned.gold >= 1 && spawned.flying === spawned.n, `two boss kills drop ${spawned.items} items and ${spawned.gold} gold piles, bursting out in an arc`);
    const mid = await E(() => {
      window.__PIXEL_ENGINE__.step(12);
      return window.__LOOTLAB__.world.drops.map((d) => d.mesh.position.y - d.to.y);
    });
    check(
      mid.some((dy) => dy > 0.3),
      `drops arc above the ground mid-flight (max ${Math.max(...mid).toFixed(2)} m)`,
    );
    await step(30);
    const landed = await E(() => {
      const w = window.__LOOTLAB__.world;
      const e = window.__PIXEL_ENGINE__;
      return {
        all: w.drops.every((d) => d.t >= 1 && Math.abs(d.mesh.position.y - d.to.y) < 1e-6),
        labels: w.drops.filter((d) => d.label).length,
        visible: w.drops.filter((d) => d.mesh.visible).length,
        beams: w.drops.filter((d) => d.beam).length,
        rares: w.drops.filter((d) => d.item && (d.item.rarity === 'rare' || d.item.rarity === 'unique')).length,
        sounds: Object.keys(e.audio.counts).filter((k) => k.startsWith('loot-')),
        particles: e.particles.alive,
      };
    });
    check(landed.all, 'every drop landed on the ground');
    check(landed.labels === landed.visible && landed.labels > 0, `every visible drop has a name label (${landed.labels})`);
    check(landed.beams === landed.rares && landed.rares >= 1, `rares and uniques stand in a light beam (${landed.beams}/${landed.rares})`);
    check(landed.sounds.length > 0, `landing plays loot sounds by rarity (${landed.sounds.join(', ')})`);
    await saveComposite(page, `riftlight-loot-${tag}-drops.png`);

    // ---------------------------------------------------------------- pickup
    const goldBefore = await E(() => window.__LOOTLAB__.store.state.gold);
    await E(() => {
      const lab = window.__LOOTLAB__;
      const g = lab.world.drops.find((d) => !d.item);
      lab.hero.teleport([g.mesh.position.x, 0, g.mesh.position.z]);
    });
    await step(6);
    const goldAfter = await E(() => window.__LOOTLAB__.store.state.gold);
    check(goldAfter > goldBefore, `walking over gold collects it (${goldBefore} → ${goldAfter})`);

    const beforeF = await E(() => window.__LOOTLAB__.store.state.inventory.items.length);
    // Away from the other drops, so the belt is the nearest item.
    await E(() => window.__LOOTLAB__.hero.teleport([-7, 0, -7]));
    await step(4);
    const belt = await E(() => window.__LOOTLAB__.give('leather-belt', 'magic').uid);
    await step(40);
    await page.keyboard.down('KeyF');
    await step(2);
    await page.keyboard.up('KeyF');
    await step(2);
    const afterF = await E((uid) => ({ n: window.__LOOTLAB__.store.state.inventory.items.length, has: window.__LOOTLAB__.store.state.inventory.items.some((p) => p.item.uid === uid) }), belt);
    check(afterF.has && afterF.n > beforeF, `F picks up the nearest item (inventory ${beforeF} → ${afterF.n})`);

    // Click a label: move next to an item and click its name.
    const clickTarget = await E(() => {
      const lab = window.__LOOTLAB__;
      const d = lab.world.drops.find((x) => x.item && x.label);
      if (!d) return null;
      lab.hero.teleport([d.mesh.position.x + 0.8, 0, d.mesh.position.z]);
      return d.item.uid;
    });
    if (clickTarget) {
      await step(8);
      const pt = await E((uid) => {
        const lab = window.__LOOTLAB__;
        const d = lab.world.drops.find((x) => x.item && x.item.uid === uid);
        if (!d || !d.label) return null;
        const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        const res = window.__PIXEL_ENGINE__.renderer.resolution;
        return { x: c.left + ((d.label.x + d.label.w / 2) / res.width) * c.width, y: c.top + ((d.label.y + d.label.h / 2) / res.height) * c.height };
      }, clickTarget);
      if (pt) await page.mouse.click(pt.x, pt.y);
      await step(2);
      const got = await E((uid) => window.__LOOTLAB__.store.state.inventory.items.some((p) => p.item.uid === uid), clickTarget);
      check(got, 'clicking an item label picks it up');
    } else check(false, 'a labelled item to click');

    // ---------------------------------------------------------------- filter
    const hidden = await E(() => {
      const lab = window.__LOOTLAB__;
      lab.depth = 30;
      const it = lab.give('iron-hat', 'normal');
      window.__PIXEL_ENGINE__.step(40);
      const d = lab.world.drops.find((x) => x.item && x.item.uid === it.uid);
      return { tier: d.tier, visible: d.mesh.visible };
    });
    await page.keyboard.press('AltLeft');
    await step(2);
    const shown = await E(() => {
      const lab = window.__LOOTLAB__;
      const d = lab.world.drops.find((x) => x.tier === 'hide');
      return { enabled: lab.world.filterEnabled, visible: d.mesh.visible, label: !!d.label };
    });
    check(hidden.tier === 'hide' && !hidden.visible, `the loot filter hides a normal item at depth 30 (${hidden.tier})`);
    check(!shown.enabled && shown.visible && shown.label, 'Alt toggles the filter off: the hidden item and its label show');
    await page.keyboard.press('AltLeft');
    await E(() => (window.__LOOTLAB__.depth = 10));

    // ---------------------------------------------------------------- inventory: equip
    const ring = await E(() => window.__LOOTLAB__.give('ruby-ring', 'magic', false).uid);
    await page.keyboard.press('KeyI');
    await step(2);
    check(await E(() => window.__LOOTLAB__.ui.isOpen && window.__LOOTLAB__.inventory.isOpen()), 'I opens the inventory');
    const lifeBefore = await E(() => window.__LOOTLAB__.sheet.get('life'));
    const beltPt = await E((uid) => {
      const ui = window.__LOOTLAB__.ui;
      const c = ui.itemCenter(uid);
      return c && ui.toClient(c.x, c.y);
    }, belt);
    await page.mouse.click(beltPt.x, beltPt.y, { button: 'right' });
    await step(2);
    const equipped = await E((uid) => {
      const lab = window.__LOOTLAB__;
      return { belt: lab.store.state.equipment.belt?.uid === uid, life: lab.sheet.get('life'), source: lab.sheet.hasSource('item:belt') };
    }, belt);
    check(equipped.belt && equipped.source, 'right-click equips the belt (StatSheet source item:belt)');
    check(equipped.life > lifeBefore, `equipping changes the hero's stats (life ${lifeBefore} → ${equipped.life})`);

    // Drag and drop the ring onto the second ring slot.
    const resBefore = await E(() => window.__LOOTLAB__.sheet.get('res.fire'));
    const drag = await E((uid) => {
      const ui = window.__LOOTLAB__.ui;
      const a = ui.itemCenter(uid);
      const b = ui.slotCenter('ring2');
      return { from: ui.toClient(a.x, a.y), to: ui.toClient(b.x, b.y) };
    }, ring);
    await page.mouse.move(drag.from.x, drag.from.y);
    await page.mouse.down();
    await page.mouse.move((drag.from.x + drag.to.x) / 2, (drag.from.y + drag.to.y) / 2, { steps: 4 });
    await page.mouse.move(drag.to.x, drag.to.y, { steps: 4 });
    await page.mouse.up();
    await step(2);
    const dropped = await E((uid) => ({ ring: window.__LOOTLAB__.store.state.equipment.ring2?.uid === uid, res: window.__LOOTLAB__.sheet.get('res.fire'), held: !!window.__LOOTLAB__.ui.held }), ring);
    check(dropped.ring && !dropped.held, 'dragging a ring onto the paper doll equips it');
    check(dropped.res > resBefore, `the ring's fire resistance reaches the StatSheet (${resBefore} → ${dropped.res})`);

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
    const stashed = await E((uid) => window.__LOOTLAB__.store.state.stash.some((g) => g.items.some((p) => p.item.uid === uid)), hat);
    check(stashed, 'Ctrl-click moves an item into the open stash tab');
    await saveComposite(page, `riftlight-loot-${tag}-stash.png`);
    await page.keyboard.press('Escape');
    await step(2);
    check(await E(() => !window.__LOOTLAB__.ui.isOpen && document.querySelector('canvas[data-items-ui]').style.display === 'none'), 'Escape closes the windows');

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
