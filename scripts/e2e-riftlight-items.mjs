/* global window, document */
// Part of the e2e suite "riftlight": the real LootPort and TreePort in the game shell (production
// build). Their gameplay (drops, the loot filter, pickup, equip and stats, sockets, the tree's
// allocation and respec, vendor, crafting, the stash, save → reload → Continue, the phone layout) is
// checked headless: src/riftlight/ui/items/{items,phone}.headless.test.ts and
// src/riftlight/ui/tree/tree.headless.test.ts. Here, what needs a page:
//
//   one run through every window for its frame (drops, the inventory and a tooltip, the skill
//   panel, Ilsa's gems, Brann's anvil, the stash) → the passive tree's canvas: a click on a node
//   allocates it; real Escape closes it without the pause menu; P toggles it → a loot label click
//   after a GPU device loss → a portrait phone (390×844): every window and a tap's tooltip as
//   frames, the tree's canvas fills the screen.
//
// Frames (the 3D frame with the HUD and the item / tree overlays composited) land in
// .scratch/e2e/riftlight-items-*.png. Self-contained: e2e.mjs passes its helpers in.

import { writeFile } from 'node:fs/promises';

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, checkClean, encodePng, OUT }
 */
export async function runRiftlightItems(h) {
  const { exe, scenario: s, openPage, check, capture, checkClean, encodePng, OUT } = h;
  const tag = s.name;
  console.log(`\n▶ riftlight items, skills and tree (${s.backend})`);
  let ctx;
  try {
    // a fresh browser profile: the item windows' frames, as a player first sees them
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=777');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const st = () => R(() => window.__RIFTLIGHT__.state());
    const step = (n = 1) => R((k) => window.__PIXEL_ENGINE__.step(k), n);
    /** Art pixel of the item windows → page point. */
    const itemsPt = (x, y) => R(([a, b]) => window.__RIFTLIGHT__.game.ports.loot.ui.toClient(a, b), [x, y]);
    // frames: every window
    const shot = (name) => composite(page, `riftlight-items-${tag}-${name}.png`);
    /** Stand at a townsperson (or the chest) and press F: the same path as walking there (the core suite walks). */
    const talkTo = (id) =>
      R((who) => {
        const rl = window.__RIFTLIGHT__;
        const it = rl.game.town.interactables.find((x) => x.id === who);
        rl.game.hero.enter(rl.game.town, it.position.clone(), 0);
        window.__PIXEL_ENGINE__.step(2);
        const ok = rl.game.interact();
        window.__PIXEL_ENGINE__.step(1);
        return { ok, state: rl.state() };
      }, id);

    // ---------------------------------------------------------------- a new run → a boss's drops
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.newRun({ slot: 1, seed: 777 });
      rl.give({ levels: 12, gold: 20000 });
    });
    await R(async () => {
      await window.__RIFTLIGHT__.enterDepth(1);
      window.__PIXEL_ENGINE__.step(5);
    });
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      for (const m of rl.game.level.monsters()) m.actor.life = 0.001; // the level's own pack: keep them out of the way
      const p = rl.game.hero.actor.position;
      rl.spawn({ seed: 31, x: p.x + 1.5, z: p.z, rank: 'boss' });
      rl.killAll();
      window.__PIXEL_ENGINE__.step(45); // the drops arc out and land
    });
    await shot('drops');
    await R(() => window.__RIFTLIGHT__.toTown());
    await step(5);

    // ---------------------------------------------------------------- inventory: a tooltip, the belt equipped
    await R(() => {
      // a known magic belt
      window.__RIFTLIGHT__.game.ports.loot.add({ uid: 'e2e-belt', base: 'leather-belt', rarity: 'magic', level: 5, name: 'Hale Leather Belt', affixes: [{ id: 'life', tier: 0, mods: [{ stat: 'life', kind: 'flat', value: 25 }] }] });
      window.__RIFTLIGHT__.press('KeyI');
    });
    const beltAt = await R(() => window.__RIFTLIGHT__.game.ports.loot.ui.itemCenter('e2e-belt'));
    const beltPt = await itemsPt(beltAt.x, beltAt.y);
    await page.mouse.move(beltPt.x, beltPt.y);
    await step(2);
    await shot('inventory-tooltip');
    await page.mouse.click(beltPt.x, beltPt.y, { button: 'right' });
    await step(2);
    await shot('inventory');
    await R(() => window.__RIFTLIGHT__.press('Escape'));

    // ---------------------------------------------------------------- skill panel: a gem socketed, the socket's tooltip
    await R(() => {
      window.__RIFTLIGHT__.game.ports.loot.add({ uid: 'e2e-fireball', base: 'skill-gem', rarity: 'normal', level: 1, name: 'Fireball', affixes: [], gem: { id: 'fireball', level: 3, support: false } });
      window.__RIFTLIGHT__.press('KeyG');
    });
    await step(1);
    const gemPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-fireball');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(gemPt.x, gemPt.y, { button: 'right' });
    await step(2);
    const sockPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.socketCenter(0, -1);
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.move(sockPt.x, sockPt.y);
    await step(2);
    await shot('skills');
    await R(() => window.__RIFTLIGHT__.press('Escape'));

    // ---------------------------------------------------------------- passive tree: the view's canvas and keys
    // (allocation, stats, refunds and Oru: src/riftlight/ui/tree/tree.headless.test.ts)
    await page.keyboard.press('KeyP');
    await step(2);
    const node = await R(() => {
      const panel = window.__RIFTLIGHT__.game.layer.find('tree');
      const st = panel.state;
      const tree = panel.view.tree;
      const near = [...tree.roots].flatMap((r) => tree.neighbours(r)).filter((n) => st.canAllocate(n) && tree.node(n).mods.length);
      const id = near.find((n) => tree.node(n).mods[0].kind === 'flat') ?? near[0];
      panel.view.focus(id, 0.6);
      return { id };
    });
    await new Promise((r) => setTimeout(r, 150)); // the tree view repaints on its own frame
    const nodePt = await R((id) => {
      const panel = window.__RIFTLIGHT__.game.layer.find('tree');
      const [x, y] = panel.view.screenOf(id);
      const c = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
      const d = panel.view.debug().art;
      return { x: c.left + ((x + 0.5) / d.width) * c.width, y: c.top + ((y + 0.5) / d.height) * c.height };
    }, node.id);
    await page.mouse.click(nodePt.x, nodePt.y);
    await step(2);
    check(await R((id) => window.__RIFTLIGHT__.game.save.hero.allocated.includes(id), node.id), `a click on the tree's canvas allocates ${node.id}`);
    await new Promise((r) => setTimeout(r, 150));
    await shot('tree');
    await page.keyboard.press('Escape');
    await step(2);
    let rs = await st();
    check(!rs.ui.includes('tree') && !rs.ui.includes('pause') && !rs.paused, `real Escape closes the tree and never reaches the pause menu (ui ${rs.ui.join(',') || 'none'})`);
    await page.keyboard.press('KeyP');
    await step(2);
    await page.keyboard.press('KeyP');
    await step(2);
    rs = await st();
    check(rs.ui.length === 0, `P toggles the tree open and shut (ui ${rs.ui.join(',') || 'none'})`);

    // ---------------------------------------------------------------- Ilsa's gems tab, Brann's anvil, the stash
    await talkTo('ilsa');
    await step(1);
    const tabPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.tabCenter(1);
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(tabPt.x, tabPt.y);
    await step(2);
    const gemWare = await R(() => {
      const loot = window.__RIFTLIGHT__.game.ports.loot;
      const g = loot.store.vendor.stock.find((x) => x.gem);
      const c = loot.ui.itemCenter(g.uid);
      return loot.ui.toClient(c.x, c.y);
    });
    await page.mouse.move(gemWare.x, gemWare.y);
    await step(2);
    await shot('vendor-gems');
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => {
      const loot = window.__RIFTLIGHT__.game.ports.loot;
      loot.add({ uid: 'e2e-boots', base: 'rawhide-boots', rarity: 'normal', level: 8, name: 'Rawhide Boots', affixes: [] });
      loot.add({ uid: 'e2e-orb', base: 'kindling-shard', rarity: 'normal', level: 1, name: 'Kindling Shard', affixes: [], quantity: 3 });
    });
    await talkTo('brann');
    await step(1);
    const bootsPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-boots');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(bootsPt.x, bootsPt.y);
    await step(1);
    const orbPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.orbCenter('kindling-shard');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.move(orbPt.x, orbPt.y);
    await step(1);
    await page.mouse.click(orbPt.x, orbPt.y);
    await step(2);
    await shot('crafting');
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await talkTo('stash');
    await step(1);
    const storePt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-boots');
      return ui.toClient(c.x, c.y);
    });
    await page.keyboard.down('Control');
    await page.mouse.click(storePt.x, storePt.y);
    await page.keyboard.up('Control');
    await step(2);
    await shot('stash');
    await R(() => window.__RIFTLIGHT__.press('Escape'));

    // ---------------------------------------------------------------- a label click after a lost GPU device
    {
      await R(async () => {
        await window.__RIFTLIGHT__.enterDepth(1);
        window.__PIXEL_ENGINE__.step(5);
      });
      await R(() => {
        window.__PIXEL_ENGINE__.renderer.renderer.backend.device.destroy();
      });
      await page.waitForFunction(() => window.__PIXEL_ENGINE__.state().gpuRecoveries === 1, null, { timeout: 60000 });
      await R(() => window.__RIFTLIGHT__.realtime());
      await new Promise((r) => setTimeout(r, 300));
      const drop = await R(() => {
        const rl = window.__RIFTLIGHT__;
        const g = rl.game;
        const item = { uid: 'e2e-ring', base: 'iron-ring', rarity: 'rare', level: 5, name: 'Grim Coil', affixes: [] };
        g.ports.loot.spawn([{ kind: 'item', item }], g.hero.actor.position.clone(), g.level, g.services.rng);
        window.__PIXEL_ENGINE__.step(40);
        const l = g.ports.loot.ground().find((x) => x.drop.kind === 'item');
        const v = l.position.clone().project(g.ctx.engine.camera.camera);
        const res = g.ctx.engine.renderer.resolution;
        const ax = Math.round(((v.x + 1) / 2) * res.width);
        const ay = Math.round(((1 - v.y) / 2) * res.height) - 14 + 5;
        const c = g.ctx.engine.renderer.renderer.domElement.getBoundingClientRect();
        return { x: c.left + ((ax + 0.5) / res.width) * c.width, y: c.top + ((ay + 0.5) / res.height) * c.height };
      });
      await page.mouse.move(drop.x, drop.y);
      await step(2);
      await page.mouse.click(drop.x, drop.y);
      await step(2);
      const got = await R(() => {
        const g = window.__RIFTLIGHT__.game;
        const l = g.ports.loot.ground().find((x) => x.drop.kind === 'item');
        return {
          inBag: g.ports.loot.store.state.inventory.items.some((p) => p.item.uid === 'e2e-ring'),
          left: l ? { d: +l.position.distanceTo(g.hero.actor.position).toFixed(2) } : null,
          pointer: { ...g.pointer.art },
          ui: g.layer.stack.map((o) => o.panel.id),
        };
      });
      check(got.inBag, `after a lost GPU device a click on a loot label still picks it up (${JSON.stringify(got)})`);
    }
    checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs);
  } catch (e) {
    check(false, `riftlight items crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }

  // ---------------------------------------------------------------- a phone in portrait
  await runPhone();

  async function runPhone() {
    let phone;
    try {
      phone = await openPage(exe, s, 'game=riftlight&debug=0&seed=777&save=memory&touch=1', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
      const { page, logs } = phone;
      await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
      const R = (fn, arg) => page.evaluate(fn, arg);
      await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.newRun({ slot: 2, seed: 99 });
        rl.give({ levels: 5, items: 4 });
        rl.game.ports.loot.add({ uid: 'p-orb', base: 'ember-bead', rarity: 'normal', level: 1, name: 'Ember Bead', affixes: [], quantity: 4 });
      });
      for (const view of ['inventory', 'stash', 'vendor', 'crafting', 'skills']) {
        await R((v) => {
          window.__RIFTLIGHT__.ui.open(v);
          window.__PIXEL_ENGINE__.step(2);
        }, view);
        await composite(page, `riftlight-items-phone-${view}.png`);
        if (view !== 'inventory' && view !== 'skills') {
          await R(() => window.__RIFTLIGHT__.ui.close());
          continue;
        }
        // a tap on the first item shows its tooltip (the second would act)
        const tap = await R(() => {
          const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
          const it = ui.store.state.inventory.items[0];
          if (!it) return null;
          const c = ui.itemCenter(it.item.uid);
          return ui.toClient(c.x, c.y);
        });
        if (tap) {
          await page.touchscreen.tap(tap.x, tap.y);
          await R(() => window.__PIXEL_ENGINE__.step(2));
        }
        await composite(page, `riftlight-items-phone-${view}-tap.png`);
        await R(() => window.__RIFTLIGHT__.ui.close());
      }
      // the passive tree fills the portrait screen at the engine's art size, and a tap shows a node
      const tree = await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.ui.open('tree');
        window.__PIXEL_ENGINE__.step(2);
        const view = rl.game.layer.find('tree').view;
        const res = window.__PIXEL_ENGINE__.renderer.resolution;
        return { art: view.debug().art, res: { width: res.width, height: res.height } };
      });
      check(tree.art.width === tree.res.width && tree.art.height === tree.res.height, `phone: the passive tree fills the screen at ${tree.art.width}×${tree.art.height}`);
      await new Promise((r) => setTimeout(r, 200));
      await composite(page, 'riftlight-items-phone-tree.png');
      await R(() => window.__RIFTLIGHT__.press('PadB'));
      checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs, 'phone: ');
    } catch (e) {
      check(false, `riftlight items on a phone crashed: ${e.message}\n    ${phone?.logs.join('\n    ') ?? ''}`);
    } finally {
      await phone?.browser.close();
    }
  }

  /** The presented frame with the HUD, the item windows and the passive tree composited on top. */
  async function composite(page, file) {
    const frame = await capture(page, file);
    const overlays = await page.evaluate(() =>
      ['canvas[data-hud="true"].pixel-hud', 'canvas[data-items-ui]', 'canvas[data-rift-tree="canvas"]']
        .map((sel) => document.querySelector(sel))
        .filter((c) => c && c.width > 0 && c.style.display !== 'none' && c.closest('[style*="display: none"]') === null)
        .map((c) => {
          const r = c.getBoundingClientRect();
          return { w: c.width, h: c.height, left: r.left, top: r.top, cw: r.width, ch: r.height, data: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data] };
        }),
    );
    const view = await page.evaluate(() => {
      const r = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    });
    const px = frame.pixels;
    for (const o of overlays) {
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          // frame pixel → page point → overlay pixel
          const cx = view.left + ((x + 0.5) / frame.width) * view.w;
          const cy = view.top + ((y + 0.5) / frame.height) * view.h;
          const ox = Math.floor(((cx - o.left) / o.cw) * o.w);
          const oy = Math.floor(((cy - o.top) / o.ch) * o.h);
          if (ox < 0 || oy < 0 || ox >= o.w || oy >= o.h) continue;
          const i = (oy * o.w + ox) * 4;
          if (!o.data[i + 3]) continue;
          px.set(o.data.slice(i, i + 3), (y * frame.width + x) * 4);
        }
      }
    }
    await writeFile(new URL(file, OUT), encodePng(frame));
  }
}
