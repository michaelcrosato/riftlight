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
//   - the controls laid out from their data (headless, a replay) are where the page lays them, and
//     so is the floating stick's zone, with the interact button hidden and shown, at DPR 2 and 3
//   - ≡ opens the pause menu, the panel's close box closes it (taps)
//   - the pause menu's rows are at least 40 CSS px in both orientations (two columns of tiles in
//     landscape); the passive tree draws at the game's art size and names a finger's gestures
//   - real touches (CDP): a quick swipe from the pause menu closes it, one down from the tree's top
//     bar closes the tree, one sideways from a row of the codex's list (portrait) closes the codex
//     and a tap on a row opens its entry; the floating stick and a skill button work at once; two
//     fingers on the world pinch the zoom and hold no press, and are no swing landing a frame apart
//   - photo mode: the floating stick's zone gives way to its open panel (a tap on a row's < inside
//     the zone steps that row back), a thumb in the zone off the panel still moves the stick, and ≡
//     leaves photo mode with the whole zone the stick's again
//   - portrait: the pause menu, codex, loot window and death recap fit the screen with tap
//     targets of at least 40 CSS px; on a 360×800 phone (120 art columns) the character sheet's
//     labels and header and the save slots' entries are whole (two rows where long), never cut
//   - in 52in1 (window.AIHubSettings on the page): ≡ below the hub's wake band (its top at 90 CSS
//     px or lower), the top-left block right of it, the data's layout the page's; the corner map
//     takes a real tap only below the band (a thumb tall at least), one in the band opens nothing
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
    // a condition in the page, waited for but bounded: true once it holds, false if it never does
    // (only a timeout is false: a predicate that throws fails the suite with its own error)
    const until = (fn, arg, timeout = 10000) =>
      page.waitForFunction(fn, arg, { timeout }).then(
        () => true,
        (e) => {
          if (e?.name === 'TimeoutError') return false;
          throw e;
        },
      );
    // a screenshot needs the render loop (Engine.step does not present the 3D frame): a moment of real time first
    const shot = async (name) => {
      await R(() => (window.__PIXEL_ENGINE__.manual = false));
      await page.waitForTimeout(1000);
      await page.screenshot({ path: new URL(`${tag}-${name}.png`, OUT).pathname });
    };
    // the controls as the page lays them out (the HUD's rects, the floating stick's zone) and as
    // their data does where there is no page (headless, a replay of a phone's recording): the same art pixels
    const agree = async (where) => {
      const a = await R(() => {
        const g = window.__RIFTLIGHT__.game;
        const e = window.__PIXEL_ENGINE__;
        e.step(1);
        const z = e.touch.rects().zone;
        const tl = z && g.pointer.toArt(z.left, z.top);
        const br = z && g.pointer.toArt(z.right, z.bottom);
        return { page: window.__RIFTLIGHT__.ui.hud().controls, data: g.touchPad.dataLayout(), zone: z && { x: tl.x, y: tl.y, w: br.x - tl.x + 1, h: br.y - tl.y + 1 }, dataZone: g.touchPad.stickZone() };
      });
      const same = JSON.stringify(a.page) === JSON.stringify(a.data) && JSON.stringify(a.zone) === JSON.stringify(a.dataZone);
      check(same && a.page.length >= 7, `${orientation} ${where}: the controls from their data are where the page lays them (${a.page.length} rects${same ? '' : `: page ${JSON.stringify(a.page)} zone ${JSON.stringify(a.zone)} vs data ${JSON.stringify(a.data)} zone ${JSON.stringify(a.dataZone)}`})`);
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

    // a level, safe to tap around in: god mode, monsters idle; the controls step aside while it
    // loads (no frame of the game's runs then, so none would hide them) and come back in it
    const loading = await R(async () => {
      const rl = window.__RIFTLIGHT__;
      const e = window.__PIXEL_ENGINE__;
      rl.newRun({ slot: 0, seed: 4242 });
      e.step(2);
      const town = e.touch.visible;
      const entering = rl.enterDepth(1);
      const during = e.touch.visible;
      await entering;
      rl.dev.god = true;
      rl.dev.ai = false;
      e.step(30);
      return { town, during, level: e.touch.visible };
    });
    check(loading.town && !loading.during && loading.level, `${orientation}: the touch controls step aside while a level loads (town ${loading.town}, loading ${loading.during}, level ${loading.level})`);
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
    await agree('in a level');

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

    // a finger's gestures on the real page (CDP touches, as a phone sends them): a gesture's events
    // carry its own clock, a frame (16 ms) apart at most from the first finger down, so a quick
    // swipe stays quick (SWIPE.ms is event time) however long a slow machine takes to deliver them
    const cdp = await page.context().newCDPSession(page);
    let fingers = 0;
    let at = 0;
    const touch = (type, points) => {
      const now = Date.now() / 1000; // real time: CDP's timestamp is seconds since the epoch
      at = fingers === 0 ? now : Math.min(now, at + 1 / 60);
      fingers = points.length; // touchEnd lists the fingers still down
      return cdp.send('Input.dispatchTouchEvent', { type, timestamp: at, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 3, radiusY: 3, force: 1 })) });
    };
    // the last finger lifts; true once the page has had its pointerup (a check then steps the frames
    // that act on it: manual time, never a guess at how much real time they take)
    const lift = async () => {
      await R(() => {
        window.__lifted = false;
        window.addEventListener('pointerup', () => (window.__lifted = true), { capture: true, once: true });
      });
      await touch('touchEnd', []);
      return until(() => window.__lifted);
    };
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
    const swipeLifted = await lift();
    st = await R(() => {
      window.__PIXEL_ENGINE__.step(3);
      return { ui: window.__RIFTLIGHT__.state().ui };
    });
    check(swipeLifted && st.ui.length === 0, `${orientation}: a quick swipe sideways from the pause menu closes it (ui ${st.ui.join(',') || 'none'}${swipeLifted ? '' : '; the page never had the pointerup'})`);
    if (st.ui.length) await R(() => (window.__RIFTLIGHT__.ui.close(), window.__PIXEL_ENGINE__.step(2))); // the checks after it play on
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
    // the second finger a frame after the first: still no swing (a finger alone on the world waits a
    // moment before it swings, and the second lets go of its press); auto attack off, the hero's
    // steps recorded as it gets them
    const apart = await (async () => {
      const c = await R(() => {
        const g = window.__RIFTLIGHT__.game;
        g.settings.touchAutoAttack = false;
        const step = g.hero.fixedUpdate.bind(g.hero);
        window.__swings = [];
        g.hero.fixedUpdate = (dt, i) => (window.__swings.push(i.attack), step(dt, i));
        const r = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        return { x: r.left + r.width * 0.62, y: r.top + r.height * 0.3, zoom: g.settings.zoom };
      });
      await touch('touchStart', [[c.x - 20, c.y, 43]]);
      await R(() => window.__PIXEL_ENGINE__.step(1));
      await touch('touchStart', [[c.x - 20, c.y, 43], [c.x + 20, c.y, 44]]);
      await R(() => window.__PIXEL_ENGINE__.step(6));
      await touch('touchEnd', []);
      return R((zoom) => {
        const g = window.__RIFTLIGHT__.game;
        window.__PIXEL_ENGINE__.step(2);
        delete g.hero.fixedUpdate; // its own method again
        g.settings.touchAutoAttack = true;
        g.settings.zoom = zoom;
        return { steps: window.__swings.length, swings: window.__swings.filter(Boolean).length };
      }, c.zoom);
    })();
    check(apart.steps >= 8 && apart.swings === 0, `${orientation}: two fingers a frame apart pinch with no swing either (${apart.swings} swings in ${apart.steps} steps)`);

    // photo mode: the floating stick's zone gives way to the open panel, so a finger taps a row's <
    // inside the zone (it steps that row back); the zone keeps the rest (a thumb there still moves
    // the stick), ≡ goes back to the game, and the whole zone is the stick's again
    const photo = await (async () => {
      const at = await R(() => {
        const rl = window.__RIFTLIGHT__;
        const e = window.__PIXEL_ENGINE__;
        rl.photo.open();
        e.step(3);
        const g = rl.game;
        const p = g.showcase.photo;
        const c = e.renderer.renderer.domElement.getBoundingClientRect();
        const k = c.width / g.ui.w;
        const z = e.touch.rects().zone;
        const panel = p.panelRect;
        const client = (r) => ({ x: c.left + r.x * k, y: c.top + r.y * k, w: r.w * k, h: r.h * k });
        const inZone = (x, y) => x > z.left && x < z.right && y > z.top && y < z.bottom;
        // the rows' < (a sun, ambient, light or look row: nothing that resizes the art), the first inside the zone
        const order = ['sun', 'ambient', 'light', 'look'];
        const arrows = [...p.rects]
          .filter(([id]) => id.endsWith(':l') && order.includes(id.split(':')[0]))
          .map(([id, r]) => ({ row: id.split(':')[0], ...client(r) }))
          .map((r) => ({ ...r, cx: r.x + r.w / 2, cy: r.y + r.h / 2 }))
          .filter((r) => inZone(r.cx, r.cy))
          .sort((a, b) => order.indexOf(a.row) - order.indexOf(b.row));
        // a point of the zone off the panel: under it, else left of it
        const pc = client(panel);
        const below = pc.y + pc.h + 12 < z.bottom - 8 ? { x: z.left + z.width * 0.4, y: (pc.y + pc.h + z.bottom) / 2 } : { x: (z.left + pc.x) / 2, y: z.top + z.height * 0.6 };
        return { arrow: arrows[0] ?? null, rows: arrows.map((a) => a.row), off: inZone(below.x, below.y) && !(below.x > pc.x && below.x < pc.x + pc.w && below.y > pc.y && below.y < pc.y + pc.h) ? below : null };
      });
      if (!at.arrow) return { ...at, tapped: false };
      const value = (row) =>
        R((row) => {
          const g = window.__RIFTLIGHT__.game;
          const p = g.showcase.photo;
          return { sun: p.sunScale, ambient: p.ambientScale, light: p.fill, look: p.look }[row];
        }, row);
      const before = await value(at.arrow.row);
      await touch('touchStart', [[at.arrow.cx, at.arrow.cy, 61]]);
      await touch('touchEnd', []);
      await R(() => window.__PIXEL_ENGINE__.step(2));
      const after = await value(at.arrow.row);
      // a thumb in the zone off the panel: the stick
      let analog = null;
      if (at.off) {
        await touch('touchStart', [[at.off.x, at.off.y, 62]]);
        await touch('touchMove', [[at.off.x + 50, at.off.y, 62]]);
        analog = await R(() => {
          window.__PIXEL_ENGINE__.step(1);
          return window.__PIXEL_ENGINE__.input.analog.x;
        });
        await touch('touchEnd', []);
        await R(() => window.__PIXEL_ENGINE__.step(2));
      }
      await shot('photo');
      await tapCode('Escape');
      const closed = await R(() => {
        window.__PIXEL_ENGINE__.step(3);
        const zone = document.querySelector('.touch-ui .stick-zone');
        return { active: window.__RIFTLIGHT__.photo.state().active, clip: zone ? getComputedStyle(zone).clipPath : null };
      });
      return { ...at, before, after, analog, closed };
    })();
    // back, not just changed: sun and ambient step down (from 1, never at their floor), light and
    // look go to the one before (from the first, round to the last)
    const back = !photo.arrow ? false : ['sun', 'ambient'].includes(photo.arrow.row) ? photo.after < photo.before : photo.after === photo.before - 1 || (photo.before === 0 && photo.after > 0);
    check(
      back,
      `${orientation}: in photo mode a tap on a row's < inside the stick's zone steps the row back (${photo.arrow ? `${photo.arrow.row} ${photo.before} → ${photo.after}` : `no < in the zone: ${JSON.stringify(photo)}`})`,
    );
    check(photo.off === null || photo.analog > 0.3, `${orientation}: in photo mode a thumb in the zone off the panel still moves the stick (analog ${photo.analog})`);
    check(photo.closed && !photo.closed.active && photo.closed.clip === 'none', `${orientation}: ≡ leaves photo mode and the zone is the stick's again (${JSON.stringify(photo.closed)})`);

    // the passive tree draws at the game's art size (its phone density) and names a finger's gestures;
    // the view paints its first frame as it opens (its own canvas: no frame of the game's needed)
    await R(() => window.__RIFTLIGHT__.ui.open('tree'));
    const drawn = await until(() => window.__RIFTLIGHT__.game.layer.find('tree')?.view?.debug().frames > 0);
    const tree = await R(() => {
      const view = window.__RIFTLIGHT__.game.layer.find('tree')?.view?.debug();
      const res = window.__PIXEL_ENGINE__.renderer.resolution;
      window.__RIFTLIGHT__.ui.close();
      return { art: view?.art ?? {}, res: { width: res.width, height: res.height }, hints: view?.hints ?? [] };
    });
    check(drawn && tree.art.width === tree.res.width && tree.art.height === tree.res.height && tree.hints.includes('tap') && !tree.hints.includes('take'), `${orientation}: the passive tree draws at the game's ${tree.res.width}×${tree.res.height} and its bar names taps, not clicks (${tree.hints.join(', ')}${drawn ? '' : '; never drawn'})`);
    // a swipe down from the tree's top bar closes it (its own canvas: sent, so recorded), off its
    // search box: the finger lands as the tree opens, on the view's canvas, and the frames that do
    // the close it sent are stepped (manual time: no guess at how many frames real time holds)
    const topBar = await R((share) => {
      window.__RIFTLIGHT__.ui.open('tree');
      const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      return { x: c.left + c.width * share, y: c.top + 4 };
    }, portrait ? 0.6 : 0.08);
    // drawn and its canvas under the finger: every open builds a new panel and view (wire/tree.ts),
    // whose frame count starts at 0, so a frame counted is this open's
    const onBar = await until(({ x, y }) => window.__RIFTLIGHT__.game.layer.find('tree')?.view?.debug().frames > 0 && document.elementFromPoint(x, y)?.dataset.riftTree === 'canvas', topBar);
    await touch('touchStart', [[topBar.x, topBar.y, 51]]);
    for (let k = 1; k <= 4; k++) await touch('touchMove', [[topBar.x, topBar.y + k * 40, 51]]);
    const treeLifted = await lift();
    const treeUi = await R(() => {
      window.__PIXEL_ENGINE__.step(2);
      return window.__RIFTLIGHT__.state().ui;
    });
    check(onBar && treeLifted && !treeUi.includes('tree'), `${orientation}: a swipe down from the tree's top bar closes it (ui ${treeUi.join(',') || 'none'}${onBar ? '' : '; the tree was not open under the finger'}${treeLifted ? '' : '; the page never had the pointerup'})`);
    if (treeUi.includes('tree')) await R(() => window.__RIFTLIGHT__.ui.close('tree'));
    if (portrait) {
      // the codex's list (a phone held upright): a quick swipe sideways from one of its rows closes
      // the codex (a press opens an entry only as the finger lifts on the row, never on a swipe)
      const codexRow = await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.ui.open('codex');
        window.__PIXEL_ENGINE__.step(10);
        const p = rl.game.layer.top;
        const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        const k = c.width / rl.game.ui.w;
        const r = p.panel.rows[1];
        return { narrow: p.panel.narrow, x: c.left + (r.x + r.w / 2) * k, y: c.top + (r.y + r.h / 2) * k };
      });
      await touch('touchStart', [[codexRow.x, codexRow.y, 61]]);
      for (let k = 1; k <= 4; k++) await touch('touchMove', [[codexRow.x - k * 30, codexRow.y, 61]]);
      const codexLifted = await lift();
      const codex = await R(() => {
        window.__PIXEL_ENGINE__.step(3);
        const top = window.__RIFTLIGHT__.game.layer.top;
        return { ui: window.__RIFTLIGHT__.state().ui, reading: top?.panel.id === 'codex' ? top.panel.reading : null };
      });
      check(codexRow.narrow && codexLifted && !codex.ui.includes('codex'), `${orientation}: a quick swipe sideways from a row of the codex's list closes the codex (ui ${codex.ui.join(',') || 'none'}${codex.reading ? ', an entry opened' : ''}${codexRow.narrow ? '' : '; the codex was not a phone\'s list'}${codexLifted ? '' : '; the page never had the pointerup'})`);
      if (codex.ui.includes('codex')) await R(() => window.__RIFTLIGHT__.ui.close('codex'));
      // a tap on a row opens its entry as the finger lifts
      const tapRow = await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.ui.open('codex');
        window.__PIXEL_ENGINE__.step(10);
        const c = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
        const k = c.width / rl.game.ui.w;
        const r = rl.game.layer.top.panel.rows[0];
        return { x: c.left + (r.x + r.w / 2) * k, y: c.top + (r.y + r.h / 2) * k };
      });
      await touch('touchStart', [[tapRow.x, tapRow.y, 62]]);
      const tapLifted = await lift();
      const opened = await R(() => {
        window.__PIXEL_ENGINE__.step(3);
        const top = window.__RIFTLIGHT__.game.layer.top;
        const reading = top?.panel.id === 'codex' && top.panel.reading;
        window.__RIFTLIGHT__.ui.close('codex');
        window.__PIXEL_ENGINE__.step(2);
        return reading;
      });
      check(tapLifted && opened, `${orientation}: a tap on a row of the codex's list opens its entry${tapLifted ? '' : ' (the page never had the pointerup)'}`);
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
    // in town by the stash: the interact button shows too
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.toTown();
      window.__PIXEL_ENGINE__.step(5);
      window.__PIXEL_ENGINE__.input.noteTouch();
      const stash = rl.game.town.interactables.find((x) => x.id === 'stash');
      rl.moveTo(stash.position.x, stash.position.z, { radius: Math.min(1.2, stash.radius - 0.4) });
      window.__PIXEL_ENGINE__.step(3);
    });
    const offered = await R(() => [...document.querySelectorAll('.touch-ui > button')].some((b) => b.dataset.code === 'KeyF' && getComputedStyle(b).display !== 'none'));
    check(offered, `${orientation}: by the stash the interact button shows`);
    await agree('in town, interact on offer');
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

    // DPR 3 (an iPhone's, most Androids'): the data and the page agree there too
    ctx = await launch(exe, s, { viewport, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    {
      const page3 = ctx.page;
      const R3 = (fn, arg) => page3.evaluate(fn, arg);
      await page3.goto(`${BASE}?game=riftlight&touch=1&save=memory&seed=4242`);
      await ready(page3);
      await page3.waitForFunction(() => window.__RIFTLIGHT__?.state, null, { timeout: 60000 });
      await R3(async () => {
        const rl = window.__RIFTLIGHT__;
        rl.newRun({ slot: 0, seed: 4242 });
        await rl.enterDepth(1);
        rl.dev.ai = false;
        window.__PIXEL_ENGINE__.input.noteTouch();
        window.__PIXEL_ENGINE__.step(30);
      });
      const a = await R3(() => {
        const g = window.__RIFTLIGHT__.game;
        const e = window.__PIXEL_ENGINE__;
        e.step(1);
        const z = e.touch.rects().zone;
        const tl = g.pointer.toArt(z.left, z.top);
        const br = g.pointer.toArt(z.right, z.bottom);
        return { page: window.__RIFTLIGHT__.ui.hud().controls, data: g.touchPad.dataLayout(), zone: { x: tl.x, y: tl.y, w: br.x - tl.x + 1, h: br.y - tl.y + 1 }, dataZone: g.touchPad.stickZone() };
      });
      const same = JSON.stringify(a.page) === JSON.stringify(a.data) && JSON.stringify(a.zone) === JSON.stringify(a.dataZone);
      check(same && a.page.length >= 7, `${orientation} at DPR 3: the controls from their data are where the page lays them (${a.page.length} rects${same ? '' : `: page ${JSON.stringify(a.page)} zone ${JSON.stringify(a.zone)} vs data ${JSON.stringify(a.data)} zone ${JSON.stringify(a.dataZone)}`})`);
      checkClean(await state(page3), ctx.logs, `${orientation} at DPR 3: `);
    }
    await ctx.browser.close();
    ctx = null;

    if (portrait) {
      // a 360×800 phone (120 art columns): the character sheet's labels and header, the slots'
      // entries and the codex's names whole (a long one on two rows), never cut with a '.'
      ctx = await launch(exe, s, { viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
      const page360 = ctx.page;
      await page360.goto(`${BASE}?game=riftlight&touch=1&save=memory&seed=4242`);
      await ready(page360);
      await page360.waitForFunction(() => window.__RIFTLIGHT__?.state, null, { timeout: 60000 });
      const small = await page360.evaluate(async () => {
        const rl = window.__RIFTLIGHT__;
        const e = window.__PIXEL_ENGINE__;
        rl.newRun({ slot: 0, seed: 4242 });
        await rl.enterDepth(1);
        rl.dev.ai = false;
        rl.save(0);
        e.input.noteTouch();
        e.step(10);
        /** The texts the next frame draws. */
        const frame = () => {
          window.__PIXEL_TEXT_LOG__ = new Set();
          e.step(1);
          const drawn = [...window.__PIXEL_TEXT_LOG__];
          window.__PIXEL_TEXT_LOG__ = undefined;
          return drawn;
        };
        /** `text` drawn whole: on one row, or on rows one after another. */
        const whole = (drawn, text) => drawn.includes(text) || drawn.some((row) => row && text.startsWith(row) && /^\s/.test(text.slice(row.length)) && whole(drawn, text.slice(row.length).trimStart()));
        const cut = [];
        const g = rl.game;
        g.openPanel('character');
        e.step(10);
        const sheet = g.layer.top.panel;
        // its pages (English: the page has no ?lang): the labels that ran into their values whole,
        // and nothing cut short with a '.' (none of its words end with one)
        const labels = [['Attack damage', 'Attack speed', 'Move speed'], ['Energy shield', 'Life regen'], ['Lightning res']];
        for (const [i, want] of labels.entries()) {
          sheet.page = i;
          const drawn = frame();
          for (const label of want) if (!whole(drawn, label)) cut.push(`the sheet's ${label}`);
          for (const text of drawn) if (/\.$/.test(text)) cut.push(`the sheet's ${text}`);
          if (!whole(drawn, sheet.header())) cut.push(`the sheet's header ${sheet.header()}`);
        }
        rl.ui.close();
        g.openPanel('slots');
        e.step(10);
        const slots = frame();
        for (const w of g.layer.top.panel.items().filter((x) => x.kind === 'button' && g.layer.top.panel.rects.has(x.id))) if (!whole(slots, w.label)) cut.push(`the slots' ${w.label}`);
        rl.ui.close();
        return { art: [e.hud.width, e.hud.height], cut, shown: slots.length };
      });
      check(small.art[0] === 120 && small.cut.length === 0 && small.shown > 3, `portrait 360×800 (${small.art.join('×')} art): the character sheet's labels and header and the slots' entries are whole${small.cut.length ? `; cut: ${small.cut.join(', ')}` : ''}`);
      await page360.evaluate(() => {
        window.__RIFTLIGHT__.game.openPanel('character');
        window.__PIXEL_ENGINE__.manual = false;
      });
      await page360.waitForTimeout(1000);
      await page360.screenshot({ path: new URL(`${tag}-360-character.png`, OUT).pathname });
      checkClean(await state(page360), ctx.logs, 'portrait 360×800: ');
      await ctx.browser.close();
      ctx = null;
    }

    // in 52in1 (its companion sets window.AIHubSettings before the game's first script): ≡ below the
    // hub's wake band (a touch above 90 CSS px brings the hub's bar over the game), the top-left
    // text right of it, the data's layout the page's
    ctx = await launch(exe, s, { viewport, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    {
      const pageH = ctx.page;
      await pageH.addInitScript(() => {
        const dualsense = { connected: false, lightbar: false, triggers: false, motion: false, touchpad: false, speaker: false, aim: false };
        window.AIHubSettings = Object.assign(new EventTarget(), { version: 1, music: 1, effects: 1, vibration: 1, mic: false, micLater: false, muted: false, dualsense, openMicrophone: async () => null });
      });
      await pageH.goto(`${BASE}?game=riftlight&touch=1&save=memory&seed=4242`);
      await ready(pageH);
      await pageH.waitForFunction(() => window.__RIFTLIGHT__?.state, null, { timeout: 60000 });
      const hub = await pageH.evaluate(async () => {
        const rl = window.__RIFTLIGHT__;
        const e = window.__PIXEL_ENGINE__;
        rl.newRun({ slot: 0, seed: 4242 });
        await rl.enterDepth(1);
        rl.dev.ai = false;
        e.input.noteTouch();
        e.step(30);
        const g = rl.game;
        const menu = e.touch.rects().buttons.find((b) => b.code === 'Escape');
        const where = rl.ui.hud().zones.find((z) => z.id === 'where');
        const m = g.touchPad.dataLayout().at(-1);
        return { hub: e.hubSettings.present, top: menu.rect.top, cy: menu.rect.top + menu.rect.height / 2, hidden: menu.hidden, page: rl.ui.hud().controls, data: g.touchPad.dataLayout(), where, menuArt: m };
      });
      const same = JSON.stringify(hub.page) === JSON.stringify(hub.data);
      check(hub.hub && !hub.hidden && hub.top >= 90 && hub.cy >= 112, `${orientation} in 52in1: ≡ below the hub's wake band (top ${Math.round(hub.top)} CSS px, centre ${Math.round(hub.cy)})`);
      check(same && hub.where && hub.where.x > hub.menuArt.x + hub.menuArt.w - 1, `${orientation} in 52in1: the controls from their data are where the page lays them, the top-left block right of ≡ (${same ? `block at x ${hub.where?.x}, ≡ to ${hub.menuArt.x + hub.menuArt.w}` : `page ${JSON.stringify(hub.page)} vs data ${JSON.stringify(hub.data)}`})`);
      // the corner map, a tap target: below the wake band where it fits (upright), else only its part
      // below the band takes a tap (on its side the skills' arc is under it); a real finger's tap there
      // opens the level's map, one on its part in the band (the hub's) opens nothing
      const map = await pageH.evaluate(() => {
        const e = window.__PIXEL_ENGINE__;
        const z = window.__RIFTLIGHT__.ui.hud().zones.find((b) => b.id === 'minimap');
        const c = e.renderer.renderer.domElement.getBoundingClientRect();
        const res = e.renderer.resolution;
        return { x: c.left + ((z.x + z.w / 2) / res.width) * c.width, top: c.top + (z.y / res.height) * c.height, bottom: c.top + ((z.y + z.h) / res.height) * c.height };
      });
      const below = { top: Math.max(map.top, 90), bottom: map.bottom };
      const tapMap = async (y) => {
        await pageH.touchscreen.tap(map.x, y);
        return pageH.evaluate(() => {
          window.__PIXEL_ENGINE__.step(2);
          return window.__RIFTLIGHT__.game.mapOpen;
        });
      };
      const inBand = map.top < 90 ? await tapMap((map.top + 90) / 2) : false;
      const opened = await tapMap((below.top + below.bottom) / 2);
      check(!inBand && opened && below.bottom - below.top >= 44, `${orientation} in 52in1: the corner map takes a tap only below the wake band (map ${Math.round(map.top)}-${Math.round(map.bottom)} CSS px; a tap in the band opened ${inBand ? 'the map' : 'nothing'}, below it ${opened ? 'the map' : 'nothing'})`);
      await pageH.screenshot({ path: new URL(`${tag}-hub-map.png`, OUT).pathname });
      await tapMap(pageH.viewportSize().height / 2); // a tap on the big map closes it
      await pageH.evaluate(() => (window.__PIXEL_ENGINE__.manual = false));
      await pageH.waitForTimeout(1000);
      await pageH.screenshot({ path: new URL(`${tag}-hub.png`, OUT).pathname });
      checkClean(await state(pageH), ctx.logs, `${orientation} in 52in1: `);
    }
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
