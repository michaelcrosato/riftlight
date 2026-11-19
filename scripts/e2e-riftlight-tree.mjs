// e2e suite "riftlight-tree": the passive tree page (/tree.html) in the production build.
//
//   npm run build && npm run test:e2e -- riftlight-tree
//
// Covers: the art-resolution canvas is integer-scaled and renders the tree in palette
// colours; drag, WASD and wheel move/zoom the camera; hovering a node shows it; a click
// allocates the path (with a sound), a right-click refunds a leaf and refuses a node others
// depend on; search highlights matches; Tab shows the stat summary; a standard gamepad moves
// the snapping cursor and A allocates (the page polls it through the engine's input); refreshing
// keeps the allocation; zero console errors; the bottom bar names clicks on a mouse's page and a
// finger's gestures on a phone's before any touch, and the search box names / with the keys, no key
// on a phone, and hides on a pad (nothing to type with); a node's tooltip names the click, the pad's
// button or the tap that takes or refunds it.
//
// Frames land in .scratch/e2e/riftlight-tree-*.png. Self-contained: e2e.mjs passes its helpers in.
/* global window, document */

/**
 * @param {object} h helpers from e2e.mjs: { exe, launch, check, BASE, OUT }
 */
export async function runRiftlightTree(h) {
  const { exe, launch, check, BASE, OUT } = h;
  console.log('\n▶ riftlight-tree (/tree.html)');
  let ctx;
  try {
    // A 2D canvas page: no GPU flags needed.
    ctx = await launch(exe, { name: 'riftlight-tree', args: [] });
    const { page, logs } = ctx;
    await page.goto(`${BASE}tree.html?points=40`);
    await page.waitForFunction(() => window.__RIFT_TREE__?.view.debug().frames > 0, null, { timeout: 30000 });
    const E = (fn, arg) => page.evaluate(fn, arg);
    const dbg = () => E(() => window.__RIFT_TREE__.view.debug());
    const shot = (name) => page.screenshot({ path: new URL(`riftlight-tree-${name}.png`, OUT).pathname });
    const frame = async () => {
      const f = await E(() => (window.__RIFT_TREE__.view.refresh(), window.__RIFT_TREE__.view.debug().frames));
      await page.waitForFunction((f0) => window.__RIFT_TREE__.view.debug().frames > f0, f, { timeout: 10000 });
    };
    const colors = () =>
      E(() => {
        const px = window.__RIFT_TREE__.view.pixels();
        const seen = new Set();
        let lit = 0;
        const ink = 0x1a | (0x1c << 8) | (0x2c << 16); // PALETTE.ink, the background
        for (let i = 0; i < px.length; i += 4) {
          const c = px[i] | (px[i + 1] << 8) | (px[i + 2] << 16);
          seen.add(c);
          if (c !== ink) lit++;
        }
        return { count: seen.size, lit };
      });

    // ------------------------------------------------------------ canvas and framing
    const d0 = await dbg();
    check(d0.open && d0.art.height === 270 && d0.scale === 2, `art resolution ${d0.art.width}×${d0.art.height}, integer scale ${d0.scale}`);
    const box = await E(() => {
      const c = document.querySelector('canvas[data-rift-tree="canvas"]');
      const r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cssW: r.width, cssH: r.height };
    });
    check(box.cssW === box.w * 2 && box.cssH === box.h * 2, `canvas is ${box.w}×${box.h} shown at exactly 2× (${box.cssW}×${box.cssH} CSS px)`);
    // fill, the engine's default, on the page too: a window that isn't a 16:9 multiple of 270 still
    // gets the tree at every edge (adaptive would letterbox 1600×900 to 1440×810 at 80,45)
    for (const [width, height] of [[1600, 900], [960, 720], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await frame();
      const r = await E(() => {
        const c = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
        return { x: c.x, y: c.y, right: c.right, bottom: c.bottom };
      });
      const d = await dbg();
      check(r.x <= 0 && r.y <= 0 && r.right >= width && r.bottom >= height && Number.isInteger(d.scale) && d.scale >= 1, `${width}×${height}: the tree covers every edge (${d.art.width}×${d.art.height} at ${d.scale}×, ${r.x},${r.y} to ${r.right},${r.bottom})`);
    }
    await page.setViewportSize({ width: 960, height: 540 });
    await frame();
    const c0 = await colors();
    check(c0.count >= 6 && c0.count <= 16 && c0.lit > 2000 && c0.lit < 100000, `tree renders in palette colours (${c0.count} colours, ${c0.lit} lit pixels)`);
    await shot('start');
    await E(() => window.__RIFT_TREE__.view.focus(null, 0.035));
    await frame();
    await shot('overview');
    await E(() => window.__RIFT_TREE__.view.focus(null, 0.12));
    await frame();

    // ------------------------------------------------------------ pan and zoom
    const cam0 = (await dbg()).cam;
    await page.mouse.move(700, 300);
    await page.mouse.down();
    await page.mouse.move(600, 260, { steps: 5 });
    await page.mouse.up();
    const cam1 = (await dbg()).cam;
    check(Math.abs(cam1.x - cam0.x - 50 / cam0.zoom) < 2 && Math.abs(cam1.y - cam0.y - 20 / cam0.zoom) < 2, `drag pans the camera (${(cam1.x - cam0.x).toFixed(0)}, ${(cam1.y - cam0.y).toFixed(0)})`);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    const cam2 = (await dbg()).cam;
    check(cam2.x > cam1.x + 50, `D pans right (${(cam2.x - cam1.x).toFixed(0)} units)`);
    await page.mouse.move(480, 270);
    await page.mouse.wheel(0, -400);
    await page.waitForFunction((z) => window.__RIFT_TREE__.view.debug().cam.zoom > z * 1.3, cam2.zoom, { timeout: 5000 }).catch(() => {});
    const cam3 = (await dbg()).cam;
    check(cam3.zoom > cam2.zoom * 1.3, `wheel zooms in (${cam2.zoom.toFixed(3)} → ${cam3.zoom.toFixed(3)})`);

    // ------------------------------------------------------------ hover, allocate, refund
    // A small node next to the Might gate: centre on it, hover it, click it.
    const target = await E(() => {
      const { tree } = window.__RIFT_TREE__;
      const gate = tree.node('start:might');
      return gate.links.find((l) => l.startsWith('p:'));
    });
    await E((id) => window.__RIFT_TREE__.view.focus(id, 0.3), target);
    await frame();
    const at = await E((id) => window.__RIFT_TREE__.view.screenOf(id), target);
    await page.mouse.move(at[0] * 2 + 1, at[1] * 2 + 1);
    await page.waitForFunction((id) => window.__RIFT_TREE__.view.debug().hover === id, target, { timeout: 5000 }).catch(() => {});
    const hovered = await dbg();
    check(hovered.hover === target, `hovering shows ${target}`);
    check(hovered.tip.includes('Click: take 1 point (40 left)'), `a mouse's tooltip names the click that takes it (${hovered.tip.join(' | ')})`);
    await shot('hover');
    await page.mouse.click(at[0] * 2 + 1, at[1] * 2 + 1);
    const afterClick = await E(() => ({ spent: window.__RIFT_TREE__.state.spent, sounds: window.__RIFT_TREE__.sounds() }));
    check(afterClick.spent === 1, `click allocates (spent ${afterClick.spent})`);
    check((afterClick.sounds.treeAllocate ?? 0) + (afterClick.sounds.treeNotable ?? 0) >= 1, 'allocation plays a sound via ctx.audio');
    // Allocate a longer path through the API (as a click on a far node would).
    const far = await E((first) => {
      const { tree } = window.__RIFT_TREE__;
      // A node 3 steps further along from the first allocation.
      let cur = first;
      const seen = new Set(['start:might', first]);
      for (let i = 0; i < 3; i++) {
        cur = tree.node(cur).links.find((l) => !seen.has(l) && tree.passable(l) && !tree.roots.has(l) && !l.startsWith('ring:'));
        seen.add(cur);
      }
      return { id: cur, got: window.__RIFT_TREE__.view.allocate(cur) };
    }, target);
    check(far.got.length === 3 && far.got.at(-1) === far.id, `allocating a far node takes its whole path (${far.got.length} points)`);
    await frame();
    await shot('allocated');
    const refundMid = await E((id) => window.__RIFT_TREE__.view.refund(id), target);
    check(refundMid === false, 'refusing to refund a node others depend on');
    const leafAt = await E((id) => window.__RIFT_TREE__.view.screenOf(id), far.id);
    await page.mouse.move(leafAt[0] * 2 + 1, leafAt[1] * 2 + 1);
    await page.waitForFunction((id) => window.__RIFT_TREE__.view.debug().hover === id, far.id, { timeout: 5000 }).catch(() => {});
    const leafTip = (await dbg()).tip;
    check(leafTip.includes('R-click: refund'), `a mouse's tooltip on a leaf names the right click that refunds it (${leafTip.join(' | ')})`);
    await page.mouse.click(leafAt[0] * 2 + 1, leafAt[1] * 2 + 1, { button: 'right' });
    const afterRefund = await E(() => ({ spent: window.__RIFT_TREE__.state.spent, sounds: window.__RIFT_TREE__.sounds() }));
    check(afterRefund.spent === 3 && afterRefund.sounds.treeRefund >= 1, `right-click refunds a leaf (spent ${afterRefund.spent})`);

    // ------------------------------------------------------------ search and stats
    await page.keyboard.press('Slash');
    await page.keyboard.type('iron');
    await page.waitForFunction(() => window.__RIFT_TREE__.view.debug().matches > 0, null, { timeout: 5000 }).catch(() => {});
    const matches = (await dbg()).matches;
    check(matches >= 2, `search highlights matches (${matches} for "iron")`);
    await page.keyboard.press('Enter');
    await frame();
    await shot('search');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await frame();
    check((await dbg()).showStats, 'Tab opens the stat summary');
    await shot('stats');
    await page.keyboard.press('Tab');

    // ------------------------------------------------------------ gamepad
    const pad = await E(async () => {
      const t = window.__RIFT_TREE__;
      const fake = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      const real = navigator.getGamepads;
      navigator.getGamepads = () => [fake];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      t.view.setQuery(''); // no search under way (one stays in its box on a pad)
      t.view.focus('start:zeal', 0.3);
      await wait(100);
      const c0 = { ...t.view.debug().cursor };
      fake.axes = [0.9, 0, 0, 0];
      await wait(250);
      fake.axes = [0, 0, 0, 0];
      await wait(150);
      const snapped = t.view.debug().hover;
      const c1 = { ...t.view.debug().cursor };
      const spent = t.state.spent;
      // D-pad steps to a node, then A takes it.
      t.view.focus('start:zeal', 0.3);
      await wait(50);
      fake.buttons[15] = { pressed: true, value: 1 };
      await wait(80);
      fake.buttons[15] = { pressed: false, value: 0 };
      await wait(80);
      const stepped = t.view.debug().hover;
      fake.buttons[0] = { pressed: true, value: 1 };
      await wait(80);
      fake.buttons[0] = { pressed: false, value: 0 };
      await wait(80);
      navigator.getGamepads = real;
      return { moved: c1.x - c0.x, snapped, stepped, gained: t.state.spent - spent, sounds: t.sounds(), search: t.view.debug().search, tip: t.view.debug().tip };
    });
    check(pad.moved > 10 && pad.snapped !== null, `left stick moves the cursor and it snaps to a node (${pad.snapped})`);
    check(pad.stepped !== null && pad.gained >= 1, `d-pad steps to ${pad.stepped}, A allocates (+${pad.gained})`);
    check(pad.search === null, `on a pad the top bar draws no search box (${JSON.stringify(pad.search)})`);
    // the node just taken: its tooltip names Square, the pad's refund, and no mouse button
    check(pad.tip.includes('Square: refund') && !pad.tip.some((l) => /click/i.test(l)), `on a pad the tooltip names the pad's buttons, not the mouse's (${pad.tip.join(' | ')})`);
    await shot('pad');

    // ------------------------------------------------------------ persistence and cleanliness
    const before = await E(() => window.__RIFT_TREE__.state.serialize());
    await page.reload();
    await page.waitForFunction(() => window.__RIFT_TREE__?.view.debug().frames > 0, null, { timeout: 30000 });
    const after = await E(() => window.__RIFT_TREE__.state.serialize());
    check(JSON.stringify(before) === JSON.stringify(after) && after.length > 0, `allocation survives a reload (${after.length} entries)`);
    await E(() => localStorage.clear());
    const desk = await dbg();
    check(desk.hints.includes('take') && !desk.hints.includes('tap'), `a mouse's page: the bottom bar names clicks (${desk.hints.join(', ')})`);
    check(desk.search === '/ search', `a mouse's page: the search box names its key (${desk.search})`);
    check(logs.length === 0, `zero console errors/warnings${logs.length ? ':\n    ' + logs.join('\n    ') : ''}`);
    await ctx.browser.close();

    // a phone (a coarse pointer): the bottom bar names a finger's gestures before the first touch
    ctx = await launch(exe, { name: 'riftlight-tree', args: [] }, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    await ctx.page.goto(`${BASE}tree.html?points=40`);
    await ctx.page.waitForFunction(() => window.__RIFT_TREE__?.view.debug().frames > 0, null, { timeout: 30000 });
    const phone = await ctx.page.evaluate(() => window.__RIFT_TREE__.view.debug());
    // (a phone's narrow bar keeps the most useful hint: Tap twice: take)
    check(phone.hints.includes('tap') && !phone.hints.includes('take') && !phone.hints.includes('zoom'), `a phone: the bottom bar names a finger's taps before any touch, not clicks (${phone.hints.join(', ')})`);
    check(phone.search === 'Find', `a phone: the search box names no key, a tap opens it (${phone.search})`);
    await ctx.page.screenshot({ path: new URL('riftlight-tree-phone.png', OUT).pathname });
    // a tap on a node beside a gate shows its tooltip: a second tap takes it, a finger's words
    const tapAt = await ctx.page.evaluate(async () => {
      const { tree, view } = window.__RIFT_TREE__;
      const id = tree.node('start:might').links.find((l) => l.startsWith('p:'));
      view.focus(id, 0.4);
      await new Promise((r) => setTimeout(r, 150));
      const [x, y] = view.screenOf(id);
      const c = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
      const art = view.debug().art;
      return { id, x: c.left + ((x + 0.5) / art.width) * c.width, y: c.top + ((y + 0.5) / art.height) * c.height };
    });
    await ctx.page.touchscreen.tap(tapAt.x, tapAt.y);
    await ctx.page.waitForFunction((id) => window.__RIFT_TREE__.view.debug().hover === id, tapAt.id, { timeout: 5000 }).catch(() => {});
    await ctx.page.waitForTimeout(150);
    const tapped = await ctx.page.evaluate(() => window.__RIFT_TREE__.view.debug());
    check(tapped.hover === tapAt.id && tapped.tip.join(' ').includes('Tap twice: take 1 point (40 left)') && tapped.spent === 0, `a phone: one tap shows a node's tooltip, which names the second tap that takes it (${tapped.hover}: ${tapped.tip.join(' | ')}; spent ${tapped.spent}; a phone's narrow tooltip wraps its lines)`);
    await ctx.page.screenshot({ path: new URL('riftlight-tree-phone-tip.png', OUT).pathname });
    check(ctx.logs.length === 0, `a phone: zero console errors/warnings${ctx.logs.length ? ':\n    ' + ctx.logs.join('\n    ') : ''}`);
  } catch (e) {
    check(false, `riftlight-tree crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
