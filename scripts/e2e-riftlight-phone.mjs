/* global window, document, getComputedStyle */
// Riftlight on a phone (part of the `phone` suite): the page a player opens, with no ?debug.
//
//   portrait 390×844 (WebGPU) and landscape 844×390 (the WebGL 2 fallback), DPR 2, touch:
//   - no engine tool bar (⚙ P R ◐ ♪) and no debug panel without ?debug; ?debug=1 brings the bar back
//   - the touch controls stay off the title menu and off every panel, and come back after it
//   - every skill-bar slot has a touch button (attack, dodge, skills 1-4, ≡) at least 40 CSS px
//     across, and tapping each one reaches the game (its key; the four skills fire)
//   - no fixed-HUD element (orbs, XP bar, level, top-left text, minimap) overlaps a touch
//     control (DOM rects vs `__RIFTLIGHT__.ui.hud()`), and the HUD draws no skill bar
//   - ≡ opens the pause menu, the panel's close box closes it (taps)
//   - portrait: the pause menu, codex, loot window and death recap fit the screen with tap
//     targets of at least 40 CSS px
// Screens land in .scratch/e2e/riftlight-phone-*.png (DOM included: the controls show).

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, launch, ready, check, checkClean, state, BASE, OUT }
 * @param {'portrait' | 'landscape'} orientation
 */
export async function runRiftlightPhone(h, orientation) {
  const { exe, scenario: s, launch, ready, check, checkClean, state, BASE, OUT } = h;
  const portrait = orientation === 'portrait';
  const viewport = portrait ? { width: 390, height: 844 } : { width: 844, height: 390 };
  const tag = `riftlight-phone-${orientation}`;
  console.log(`\n▶ riftlight on a phone (${orientation} ${viewport.width}×${viewport.height}, ${s.backend})`);
  let ctx;
  try {
    ctx = await launch(exe, s, { viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const { page, logs } = ctx;
    const R = (fn, arg) => page.evaluate(fn, arg);
    // a screenshot needs the render loop (Engine.step does not present the 3D frame): a moment of real time first
    const shot = async (name) => {
      await R(() => (window.__PIXEL_ENGINE__.manual = false));
      await page.waitForTimeout(1000);
      await page.screenshot({ path: new URL(`${tag}-${name}.png`, OUT).pathname });
    };
    // what a player opens: no ?debug (touch=1 forces the controls; a phone gets them from its coarse pointer)
    await page.goto(`${BASE}?game=riftlight&touch=1&save=memory&seed=4242`);
    await ready(page);
    await page.waitForFunction(() => window.__RIFTLIGHT__?.state, null, { timeout: 60000 });
    const dom = await R(() => ({ bar: document.querySelectorAll('.touch-ui .bar').length, panel: document.querySelectorAll('.debug-ui').length, hidden: !!document.querySelector('.touch-ui.hidden') }));
    check(dom.bar === 0 && dom.panel === 0, `${orientation}: no engine tool bar or debug panel without ?debug (bar ${dom.bar}, panel ${dom.panel})`);
    check(dom.hidden, `${orientation}: the touch controls stay off the title menu`);
    await shot('title');

    // a level, safe to tap around in: god mode, monsters idle
    await R(async () => {
      const rl = window.__RIFTLIGHT__;
      rl.newRun({ slot: 0, seed: 4242 });
      await rl.enterDepth(1);
      rl.dev.god = true;
      rl.dev.ai = false;
      window.__PIXEL_ENGINE__.step(30);
    });
    // record every key the touch buttons press
    await R(() => {
      const input = window.__PIXEL_ENGINE__.input;
      window.__touchKeys = [];
      const set = input.setKey.bind(input);
      input.setKey = (code, down) => {
        if (down) window.__touchKeys.push(code);
        set(code, down);
      };
    });
    const controls = () =>
      R(() =>
        [...document.querySelectorAll('.touch-ui .stick, .touch-ui > button, .touch-ui .pad button')]
          .filter((el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.touch-ui.hidden'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { code: el.dataset.code ?? 'stick', x: r.left, y: r.top, w: r.width, h: r.height };
          }),
      );
    const visible = await controls();
    const codes = visible.map((c) => c.code);
    const want = ['KeyJ', 'Space', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Escape'];
    check(want.every((c) => codes.includes(c)) && codes.includes('stick'), `${orientation}: the stick and a button for attack, dodge, skills 1-4 and ≡ (${codes.join(' ')})`);
    const small = visible.filter((c) => c.w < 40 || c.h < 40);
    check(small.length === 0, `${orientation}: every touch control is at least 40 CSS px (${visible.map((c) => `${c.code} ${Math.round(c.w)}`).join(', ')})`);
    const off = visible.filter((c) => c.x < 0 || c.y < 0 || c.x + c.w > viewport.width || c.y + c.h > viewport.height);
    check(off.length === 0, `${orientation}: every touch control is on screen`);
    // the controls are round: two overlap when their centres are closer than their radii
    const round = (c) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2, r: Math.min(c.w, c.h) / 2 });
    const clash = visible.flatMap((a, i) =>
      visible
        .slice(i + 1)
        .filter((b) => {
          const p = round(a);
          const q = round(b);
          return Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r;
        })
        .map((b) => `${a.code}/${b.code}`),
    );
    check(clash.length === 0, `${orientation}: no two touch controls overlap${clash.length ? ` (${clash.join(', ')})` : ''}`);

    // the HUD lays out around the controls: no fixed-HUD rect under a control
    const hud = await R(() => {
      const h = window.__RIFTLIGHT__.ui.hud();
      const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      const k = c.width / h.art.w;
      return { touch: h.touch, zones: h.zones.map((z) => ({ id: z.id, x: c.left + z.x * k, y: c.top + z.y * k, w: z.w * k, h: z.h * k })) };
    });
    check(hud.touch && !hud.zones.some((z) => z.id === 'skillbar'), `${orientation}: the HUD takes the touch layout (no skill bar of its own: the buttons are the bar)`);
    const under = hud.zones.flatMap((z) => visible.filter((c) => z.x < c.x + c.w && c.x < z.x + z.w && z.y < c.y + c.h && c.y < z.y + z.h).map((c) => `${z.id} under ${c.code}`));
    check(under.length === 0, `${orientation}: no HUD element overlaps a touch control${under.length ? ` (${under.join(', ')})` : ` (${hud.zones.map((z) => z.id).join(', ')})`}`);
    await shot('level');

    // every slot reachable by touch: each tap presses its key, and the four skills fire
    const tapCode = async (code) => {
      const c = (await controls()).find((x) => x.code === code);
      if (!c) return false;
      await page.touchscreen.tap(c.x + c.w / 2, c.y + c.h / 2);
      return true;
    };
    for (const [i, code] of ['Digit1', 'Digit2', 'Digit3', 'Digit4'].entries()) {
      const before = await R((i) => {
        const g = window.__RIFTLIGHT__.game;
        for (let f = 0; f < 120 && g.hero.busy > 0; f++) window.__PIXEL_ENGINE__.step(1);
        g.hero.actor.mana = g.hero.vitals().maxMana; // full mana: every skill is affordable
        window.__touchKeys.length = 0;
        const s = g.hero.skills().find((x) => x.slot === i);
        return { mana: g.hero.vitals().mana, id: s?.id, cost: s?.cost ?? 0 };
      }, i);
      const tapped = await tapCode(code);
      const after = await R((i) => {
        const g = window.__RIFTLIGHT__.game;
        let fired = false;
        for (let f = 0; f < 20 && !fired; f++) {
          window.__PIXEL_ENGINE__.step(1);
          const s = g.hero.skills().find((x) => x.slot === i);
          fired = (s?.remaining ?? 0) > 0 || g.hero.busy > 0;
        }
        return { keys: [...window.__touchKeys], mana: g.hero.vitals().mana, fired };
      }, i);
      const spent = before.mana - after.mana;
      check(tapped && after.keys.includes(code) && (after.fired || spent >= before.cost * 0.5), `${orientation}: tapping skill ${i + 1} (${before.id}) presses ${code} and casts it (keys ${after.keys.join(' ')}, mana -${spent.toFixed(1)}, fired ${after.fired})`);
    }
    for (const code of ['KeyJ', 'Space']) {
      await R(() => (window.__touchKeys.length = 0));
      const tapped = await tapCode(code);
      const keys = await R(() => {
        window.__PIXEL_ENGINE__.step(2);
        return [...window.__touchKeys];
      });
      check(tapped && keys.includes(code), `${orientation}: tapping the ${code === 'KeyJ' ? 'attack' : 'dodge'} button presses ${code}`);
    }
    await R(() => window.__PIXEL_ENGINE__.step(30));
    await shot('skills');

    // ≡ opens the pause menu (the controls step aside), its close box closes it
    await tapCode('Escape');
    await R(() => window.__PIXEL_ENGINE__.step(3));
    let st = await R(() => ({ ui: window.__RIFTLIGHT__.state().ui, hidden: !!document.querySelector('.touch-ui.hidden') }));
    check(st.ui.includes('pause') && st.hidden, `${orientation}: ≡ opens the pause menu and the controls step aside (ui ${st.ui.join(',')}, hidden ${st.hidden})`);
    const fit = await R(() => {
      const g = window.__RIFTLIGHT__.game;
      const top = g.layer.top;
      const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      const k = c.width / g.ui.w;
      const rows = window.__RIFTLIGHT__.ui.widgets().filter((w) => w.rect).map((w) => w.rect.h * k);
      return { k, rect: top.rect, w: g.ui.w, h: g.ui.h, rows, close: { x: c.left + (top.rect.x + top.rect.w - 7) * k, y: c.top + (top.rect.y - 8) * k } };
    });
    check(fit.rect.x >= 0 && fit.rect.y >= 0 && fit.rect.x + fit.rect.w <= fit.w && fit.rect.y + fit.rect.h <= fit.h, `${orientation}: the pause menu fits the screen`);
    if (portrait) check(Math.min(...fit.rows) >= 40, `${orientation}: pause menu rows are at least 40 CSS px tall (${Math.round(Math.min(...fit.rows))})`);
    else console.log(`    (landscape: pause menu rows are ${Math.round(Math.min(...fit.rows))} CSS px at ${fit.k.toFixed(2)} CSS px per art pixel)`);
    await shot('pause');
    await page.touchscreen.tap(fit.close.x, fit.close.y);
    await R(() => window.__PIXEL_ENGINE__.step(3));
    st = await R(() => ({ ui: window.__RIFTLIGHT__.state().ui, hidden: !!document.querySelector('.touch-ui.hidden') }));
    check(st.ui.length === 0 && !st.hidden, `${orientation}: tapping the close box closes it and the controls come back (ui ${st.ui.join(',') || 'none'})`);

    if (portrait) {
      // the settings menu is taller than a phone: a drag scrolls it until its last row shows
      const before = await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.ui.open('settings');
        window.__PIXEL_ENGINE__.step(2);
        const ws = rl.ui.widgets();
        const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        const k = c.width / rl.game.ui.w;
        const r = rl.game.layer.top.rect;
        return { last: ws[ws.length - 1].rect, from: { x: c.left + (r.x + r.w / 2) * k, y: c.top + (r.y + r.h * 0.7) * k }, k };
      });
      await page.mouse.move(before.from.x, before.from.y);
      await page.mouse.down();
      await page.mouse.move(before.from.x, before.from.y - 60 * before.k, { steps: 6 });
      await page.mouse.up();
      const after = await R(() => {
        window.__PIXEL_ENGINE__.step(2);
        const ws = window.__RIFTLIGHT__.ui.widgets();
        const st = window.__RIFTLIGHT__.state().ui;
        return { last: ws[ws.length - 1].rect, ui: st };
      });
      check(before.last === null && after.last !== null && after.ui.includes('settings'), `${orientation}: the settings menu scrolls with a drag (last row hidden ${before.last === null}, shown after ${after.last !== null})`);
      await shot('settings');
      await R(() => window.__RIFTLIGHT__.ui.close());

      // the codex, the loot window and the death recap lay out for the phone: on screen, big targets
      const panels = await R(() => {
        const rl = window.__RIFTLIGHT__;
        const g = rl.game;
        const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        const k = c.width / g.ui.w;
        const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= g.ui.w && r.y + r.h <= g.ui.h;
        const out = {};
        rl.ui.open('codex');
        window.__PIXEL_ENGINE__.step(2);
        let p = g.layer.top;
        out.codex = { narrow: p.panel.narrow, fits: inside(p.rect), row: Math.min(...p.panel.rows.map((r) => r.h)) * k };
        rl.ui.close();
        g.ports.loot.spawn([{ kind: 'item', item: g.ports.loot.give(g.services.rng, 1) }], g.hero.actor.position, g.level, g.services.rng);
        window.__PIXEL_ENGINE__.step(30);
        g.atPortal();
        window.__PIXEL_ENGINE__.step(2);
        p = g.layer.top;
        out.loot = { id: p?.panel.id, fits: p && inside(p.rect), row: p ? Math.min(...p.panel.rects.map((r) => r.h)) * k : 0, inPanel: p ? p.panel.rects.every((r) => r.x >= p.rect.x && r.x + r.w <= p.rect.x + p.rect.w && r.y + r.h <= p.rect.y + p.rect.h) : false };
        rl.ui.close();
        rl.dev.god = false;
        g.hero.actor.die(null);
        for (let f = 0; f < 240 && !rl.state().ui.includes('death'); f++) window.__PIXEL_ENGINE__.step(1);
        window.__PIXEL_ENGINE__.step(2);
        p = g.layer.top;
        out.recap = { id: p?.panel.id, fits: p && inside(p.rect), button: p ? p.panel.button.h * k : 0, inPanel: p ? p.panel.button.y + p.panel.button.h <= p.rect.y + p.rect.h : false };
        return out;
      });
      check(panels.codex.narrow && panels.codex.fits && panels.codex.row >= 40, `${orientation}: the codex lists its entries in rows a thumb can hit (${Math.round(panels.codex.row)} CSS px) and fits`);
      check(panels.loot.id === 'loot' && panels.loot.fits && panels.loot.inPanel && panels.loot.row >= 40, `${orientation}: the loot window fits, its rows and buttons are at least 40 CSS px (${Math.round(panels.loot.row)})`);
      check(panels.recap.id === 'death' && panels.recap.fits && panels.recap.inPanel && panels.recap.button >= 40, `${orientation}: the death recap fits with a ${Math.round(panels.recap.button)} CSS px button`);
      await shot('recap');
    }
    checkClean(await state(page), logs, `${orientation}: `);
    await ctx.browser.close();
    ctx = null;

    // ?debug=1 brings the engine's tool bar back
    ctx = await launch(exe, s, { viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await ctx.page.goto(`${BASE}?game=riftlight&touch=1&save=memory&debug=1`);
    await ready(ctx.page);
    const bar = await ctx.page.evaluate(() => document.querySelectorAll('.touch-ui .bar button').length);
    check(bar >= 4, `${orientation}: ?debug=1 shows the engine tool bar (${bar} buttons)`);
  } catch (e) {
    check(false, `riftlight on a phone (${orientation}) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
