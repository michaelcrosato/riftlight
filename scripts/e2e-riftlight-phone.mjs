/* global window, document, getComputedStyle */
// Riftlight on a phone (part of the `phone` suite): the page a player opens, with no ?debug.
//
//   portrait 390×844 and landscape 844×390, DPR 2, touch:
//   - no engine tool bar (ⓘ P R ◐ ♪) and no debug panel without ?debug; ?debug=1 brings the bar back
//   - the touch controls stay off the title menu and off every panel, and come back after it
//   - every skill-bar slot has a touch button (attack, dodge, skills 1-4, ≡) at least 40 CSS px
//     across, and tapping each one reaches the game (its key; the four skills fire)
//   - the art is Riftlight's phone density (two CSS pixels per art pixel at least: 195 rows in
//     landscape); the joystick floats (its zone in the lower left), and nothing on the HUD a
//     finger taps (the corner map) is in its zone
//   - no fixed-HUD element (orbs, XP bar, level, top-left block, minimap, gold, the level card)
//     overlaps a touch control or another (DOM rects vs `__RIFTLIGHT__.ui.hud()`), and the HUD
//     draws no skill bar
//   - a pad picked up: the controls step aside and the HUD draws the pad's skill bar; a touch
//     brings the touch layout back
//   - every title entry shows, a thumb tall (two columns of tiles in landscape), with a save and
//     without (landscape)
//   - ≡ opens the pause menu, the panel's close box closes it (taps)
//   - the pause menu's rows are at least 40 CSS px in both orientations (two columns of tiles in
//     landscape); the passive tree draws at the game's art size and names a finger's gestures
//   - real touches (CDP): a quick swipe from the pause menu closes it, one down from the tree's top
//     bar closes the tree; the floating stick and a skill button work at once; two fingers on the
//     world pinch the zoom and hold no press
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
    // every entry of the title menu shows (two columns of tiles under the logo in landscape), a thumb tall
    const titleRows = () =>
      R(() => {
        const rl = window.__RIFTLIGHT__;
        const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        const k = c.width / rl.game.ui.w;
        const ws = rl.ui.widgets().filter((w) => w.kind === 'button');
        return { top: rl.state().ui.at(-1), ids: ws.map((w) => w.id), hidden: ws.filter((w) => !w.rect).map((w) => w.id), least: Math.min(...ws.filter((w) => w.rect).map((w) => w.rect.h * k)) };
      });
    const title = await titleRows();
    check(title.top === 'title' && title.ids.length >= 4 && title.hidden.length === 0 && title.least >= 40, `${orientation}: every title entry shows, at least 40 CSS px tall, with no save (${title.ids.join(' ')}; hidden ${title.hidden.join(' ') || 'none'}; ${Math.round(title.least)} CSS px)`);
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
    // the orbs, the XP bar, the minimap and the gold never meet (the mana orb once sat under the minimap in landscape)
    const solid = hud.zones.filter((z) => ['life', 'mana', 'xp', 'minimap', 'gold'].includes(z.id));
    const meet = solid.flatMap((a, i) => solid.slice(i + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).map((b) => `${a.id}/${b.id}`));
    check(meet.length === 0, `${orientation}: the orbs, the XP bar, the minimap and the gold are clear of each other${meet.length ? ` (${meet.join(', ')})` : ''}`);
    // Riftlight's phone density, and the floating stick: its zone in the lower left, the corner map (a tap opens the map) out of it
    const dense = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const c = e.renderer.renderer.domElement.getBoundingClientRect();
      const z = e.touch.rects().zone;
      return { k: c.width / e.renderer.resolution.width, art: { ...e.renderer.resolution }, mode: e.touch.stickMode, zone: z && { x: z.left, y: z.top, w: z.width, h: z.height } };
    });
    check(dense.k >= 2 - 1e-6 && dense.k < 3.01, `${orientation}: the art is at two to three CSS pixels per art pixel (${dense.art.width}×${dense.art.height}, ${dense.k.toFixed(2)})`);
    if (!portrait) check(dense.art.height >= 180 && dense.art.height <= 200, `${orientation}: a landscape phone draws about 195 rows (${dense.art.height})`);
    const map = hud.zones.find((z) => z.id === 'minimap');
    const inZone = (r) => dense.zone && r.x < dense.zone.x + dense.zone.w && dense.zone.x < r.x + r.w && r.y < dense.zone.y + dense.zone.h && dense.zone.y < r.y + r.h;
    check(dense.mode === 'floating' && !!dense.zone && dense.zone.x === 0 && !!map && !inZone(map), `${orientation}: the joystick floats in the lower left and the corner map is out of its zone (${JSON.stringify(dense.zone)})`);
    await shot('level');

    // a pad picked up: the touch controls step aside and the HUD takes the pad's layout, its own
    // skill bar drawn (never neither); the next touch brings the touch layout back
    const devices = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const layout = () => {
        const h = window.__RIFTLIGHT__.ui.hud();
        return { device: e.input.device, away: e.touch.deviceHidden, touch: h.touch, skillbar: h.zones.some((z) => z.id === 'skillbar') };
      };
      e.input.noteDevice('pad');
      e.step(2);
      const pad = layout();
      e.input.noteTouch();
      e.step(2);
      return { pad, back: layout() };
    });
    check(
      devices.pad.away && !devices.pad.touch && devices.pad.skillbar && !devices.back.away && devices.back.touch && !devices.back.skillbar,
      `${orientation}: a pad picked up gives the HUD the pad's layout with its skill bar, a touch gives the touch layout back (${JSON.stringify(devices)})`,
    );

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
    check(fit.rows.length >= 9 && Math.min(...fit.rows) >= 40, `${orientation}: every pause menu row shows, at least 40 CSS px tall (${fit.rows.length} rows, ${Math.round(Math.min(...fit.rows))} CSS px at ${fit.k.toFixed(2)} CSS px per art pixel)`);
    await shot('pause');
    await page.touchscreen.tap(fit.close.x, fit.close.y);
    await R(() => window.__PIXEL_ENGINE__.step(3));
    st = await R(() => ({ ui: window.__RIFTLIGHT__.state().ui, hidden: !!document.querySelector('.touch-ui.hidden') }));
    check(st.ui.length === 0 && !st.hidden, `${orientation}: tapping the close box closes it and the controls come back (ui ${st.ui.join(',') || 'none'})`);

    // a finger's gestures on the real page (CDP touches, as a phone sends them)
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 3, radiusY: 3, force: 1 })) });
    // a quick swipe sideways from the pause menu closes it (the game resumes)
    await tapCode('Escape');
    await R(() => window.__PIXEL_ENGINE__.step(3));
    const pr = await R(() => {
      const g = window.__RIFTLIGHT__.game;
      const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      const k = c.width / g.ui.w;
      const r = g.layer.top.rect;
      return { x: c.left + (r.x + r.w / 2) * k, y: c.top + (r.y + r.h / 2) * k };
    });
    await touch('touchStart', [[pr.x, pr.y, 21]]);
    for (let k = 1; k <= 4; k++) await touch('touchMove', [[pr.x - k * 35, pr.y, 21]]);
    await touch('touchEnd', []);
    st = await R(() => {
      window.__PIXEL_ENGINE__.step(3);
      return { ui: window.__RIFTLIGHT__.state().ui };
    });
    check(st.ui.length === 0, `${orientation}: a quick swipe sideways from the pause menu closes it (ui ${st.ui.join(',') || 'none'})`);
    // the floating stick and a skill at once: the stick held off to the right while skill 1 is pressed
    const both = await (async () => {
      const skill = (await controls()).find((c) => c.code === 'Digit1');
      const zone = await R(() => {
        const z = window.__PIXEL_ENGINE__.touch.rects().zone;
        return { x: z.left + z.width * 0.4, y: z.top + z.height * 0.6 };
      });
      await R(() => {
        const g = window.__RIFTLIGHT__.game;
        for (let f = 0; f < 120 && g.hero.busy > 0; f++) window.__PIXEL_ENGINE__.step(1);
        g.hero.actor.mana = g.hero.vitals().maxMana;
        window.__touchKeys.length = 0;
      });
      await touch('touchStart', [[zone.x, zone.y, 31]]);
      await touch('touchMove', [[zone.x + 50, zone.y, 31]]);
      await touch('touchStart', [[zone.x + 50, zone.y, 31], [skill.x + skill.w / 2, skill.y + skill.h / 2, 32]]);
      const held = await R(() => {
        const e = window.__PIXEL_ENGINE__;
        e.step(2);
        return { analog: e.input.analog.x, keys: [...window.__touchKeys] };
      });
      await touch('touchEnd', [[zone.x + 50, zone.y, 31]]);
      await touch('touchEnd', []);
      await R(() => window.__PIXEL_ENGINE__.step(2));
      return held;
    })();
    check(both.analog > 0.3 && both.keys.includes('Digit1'), `${orientation}: the floating stick and a skill button work at once (analog ${both.analog.toFixed(2)}, keys ${both.keys.join(' ')})`);
    // two fingers on the world pinch the camera's zoom, and are no swing (the finger's press lets go)
    const pinch = await (async () => {
      const c = await R(() => {
        const r = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.3, zoom: window.__RIFTLIGHT__.game.settings.zoom };
      });
      await touch('touchStart', [[c.x - 20, c.y, 41]]);
      await touch('touchStart', [[c.x - 20, c.y, 41], [c.x + 20, c.y, 42]]);
      const down = await R(() => window.__PIXEL_ENGINE__.input.isDown('Touch'));
      for (let k = 1; k <= 6; k++) await touch('touchMove', [[c.x - 20 - k * 12, c.y, 41], [c.x + 20 + k * 12, c.y, 42]]);
      await touch('touchEnd', []);
      const zoom = await R(() => {
        window.__PIXEL_ENGINE__.step(2);
        return window.__RIFTLIGHT__.game.settings.zoom;
      });
      return { before: c.zoom, after: zoom, down };
    })();
    check(pinch.after !== pinch.before && !pinch.down, `${orientation}: two fingers pinch the zoom (${pinch.before} → ${pinch.after}) and hold no press (Touch ${pinch.down})`);
    await R((z) => (window.__RIFTLIGHT__.game.settings.zoom = z), pinch.before);

    // the passive tree draws at the game's art size (its phone density) and names a finger's gestures
    const tree = await R(async () => {
      const rl = window.__RIFTLIGHT__;
      rl.ui.open('tree');
      window.__PIXEL_ENGINE__.manual = false;
      await new Promise((r) => setTimeout(r, 300));
      const view = rl.game.layer.find('tree').view;
      const res = window.__PIXEL_ENGINE__.renderer.resolution;
      const out = { art: view.debug().art, res: { width: res.width, height: res.height }, hints: view.debug().hints };
      rl.ui.close();
      window.__PIXEL_ENGINE__.manual = true;
      return out;
    });
    check(tree.art.width === tree.res.width && tree.art.height === tree.res.height && tree.hints.includes('tap') && !tree.hints.includes('take'), `${orientation}: the passive tree draws at the game's ${tree.res.width}×${tree.res.height} and its bar names taps, not clicks (${tree.hints.join(', ')})`);
    // a swipe down from the tree's top bar closes it (its own canvas: sent, so recorded), off its search box
    await R(() => {
      window.__RIFTLIGHT__.ui.open('tree');
      window.__PIXEL_ENGINE__.manual = false;
    });
    await page.waitForTimeout(300);
    const topBar = await R((share) => {
      const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      return { x: c.left + c.width * share, y: c.top + 4 };
    }, portrait ? 0.6 : 0.08);
    await touch('touchStart', [[topBar.x, topBar.y, 51]]);
    for (let k = 1; k <= 4; k++) await touch('touchMove', [[topBar.x, topBar.y + k * 40, 51]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    const treeUi = await R(() => {
      window.__PIXEL_ENGINE__.manual = true;
      return window.__RIFTLIGHT__.state().ui;
    });
    check(!treeUi.includes('tree'), `${orientation}: a swipe down from the tree's top bar closes it (ui ${treeUi.join(',') || 'none'})`);
    if (treeUi.includes('tree')) await R(() => window.__RIFTLIGHT__.ui.close('tree'));
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
        return { last: ws[ws.length - 1].rect, from: { x: c.left + (r.x + r.w / 2) * k, y: c.top + (r.y + r.h * 0.9) * k }, to: c.top + (r.y + r.h * 0.1) * k };
      });
      // drags up the menu until its last row shows (rows a thumb tall: a few screens' worth)
      let after = { last: null, ui: [] };
      for (let i = 0; i < 6 && after.last === null; i++) {
        await page.mouse.move(before.from.x, before.from.y);
        await page.mouse.down();
        await page.mouse.move(before.from.x, before.to, { steps: 8 });
        await page.mouse.up();
        after = await R(() => {
          window.__PIXEL_ENGINE__.step(2);
          const ws = window.__RIFTLIGHT__.ui.widgets();
          const st = window.__RIFTLIGHT__.state().ui;
          return { last: ws[ws.length - 1].rect, ui: st };
        });
      }
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
        const back = p?.panel.buttons?.find((b) => b.id === 'continue')?.rect; // Return to town
        out.recap = { id: p?.panel.id, fits: p && inside(p.rect), button: back ? back.h * k : 0, inPanel: back ? back.y + back.h <= p.rect.y + p.rect.h : false };
        return out;
      });
      check(panels.codex.narrow && panels.codex.fits && panels.codex.row >= 40, `${orientation}: the codex lists its entries in rows a thumb can hit (${Math.round(panels.codex.row)} CSS px) and fits`);
      check(panels.loot.id === 'loot' && panels.loot.fits && panels.loot.inPanel && panels.loot.row >= 40, `${orientation}: the loot window fits, its rows and buttons are at least 40 CSS px (${Math.round(panels.loot.row)})`);
      check(panels.recap.id === 'death' && panels.recap.fits && panels.recap.inPanel && panels.recap.button >= 40, `${orientation}: the death recap fits with a ${Math.round(panels.recap.button)} CSS px button`);
      await shot('recap');
    }
    if (!portrait) {
      // back to the title with a save: Continue joins the entries, and every one still shows
      await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.save(0);
        rl.game.saveAndQuit();
        window.__PIXEL_ENGINE__.step(3);
      });
      const saved = await titleRows();
      check(saved.top === 'title' && saved.ids.includes('continue') && saved.hidden.length === 0 && saved.least >= 40, `${orientation}: every title entry shows, at least 40 CSS px tall, with a save (${saved.ids.join(' ')}; hidden ${saved.hidden.join(' ') || 'none'}; ${Math.round(saved.least)} CSS px)`);
      await shot('title-save');
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
