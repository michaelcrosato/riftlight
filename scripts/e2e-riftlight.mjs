// e2e suite "riftlight": one browser run of the game shell (production build), driven
// frame-exactly through window.__RIFTLIGHT__ (Engine.step) and the real keyboard path for menus,
// for what only a page shows: the pictures, the pixel HUD, what is stored in localStorage, the
// page's own parts and a real reload.
//
//   title (the town behind the logo, the HUD drawn) → New Run (keys) → town → Oru on a pad (his
//   line in the tree's own view, tapped away or gone after a while; no OS pointer over the view
//   while the pad drives it, none hidden in a replay, back once the mouse moves) → Vex → rift menu →
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

    // ---------------------------------------------------------------- Oru's respec on a pad: the tree's own view
    // his line under the view's top bar (the shell's would be under its canvas) until a tap puts it
    // away, else for its reading time; no OS pointer over the view while the pad drives it (never in
    // a replay), and back once the mouse moves
    const treeView = () => R(() => window.__RIFTLIGHT__.game.layer.find('tree')?.debug() ?? null);
    /** The tree's view drawn again (its own frames), then the OS pointer's style at `at` (default: the middle). */
    const treePointer = (at) =>
      R(async (p) => {
        const v = window.__RIFTLIGHT__.game.layer.find('tree').view;
        const f = v.debug().frames;
        v.refresh();
        for (let i = 0; i < 120 && v.debug().frames === f; i++) await new Promise((r) => requestAnimationFrame(r));
        const c = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
        const [x, y] = p ?? [c.left + c.width / 2, c.top + c.height / 2];
        return getComputedStyle(document.elementFromPoint(x, y)).cursor;
      }, at);
    const oru = await R(() => {
      window.__PIXEL_ENGINE__.input.noteDevice('pad');
      return window.__RIFTLIGHT__.talkTo('oru');
    });
    need(oru.ok && oru.state.ui.join() === 'tree', `walk to Oru on a pad, talk: the respec's tree opens (ui ${oru.state.ui.join(',')})`);
    await page.waitForFunction(() => window.__RIFTLIGHT__.game.layer.find('tree')?.debug().talk, null, { timeout: 10000 }).catch(() => {});
    const oruSaid = await R(() => window.__RIFTLIGHT__.game.layer.find('tree').host.talk());
    let tv = await treeView();
    check(!!oruSaid && tv?.talk === oruSaid, `Oru's line shows in the tree's own view (${JSON.stringify(tv?.talk)})`);
    check((await treePointer()) === 'none', 'the pad drives the tree: no OS pointer over its view');
    await R(() => (window.__PIXEL_ENGINE__.input.playing = true)); // as in a replay of a pad recording
    const inReplay = await treePointer();
    await R(() => {
      const e = window.__PIXEL_ENGINE__;
      e.input.playing = false;
      e.input.noteDevice('pad');
    });
    check(inReplay !== 'none', `a replay keeps the OS pointer over the tree's view (${inReplay})`);
    // the mouse moves onto Oru's line: the pointer shows; a click on the line puts it away (before
    // the frames are taken: his line goes after its reading time, and a click where it was would
    // prove nothing)
    const line = await R(() => window.__RIFTLIGHT__.game.layer.find('tree').view.debug().talk);
    need(line?.box, `Oru's line still up to click (${JSON.stringify(line)})`);
    const lineAt = await R((box) => {
      const c = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
      const art = window.__RIFTLIGHT__.game.layer.find('tree').view.debug().art;
      return [c.left + ((box.x + box.w / 2) / art.width) * c.width, c.top + ((box.y + box.h / 2) / art.height) * c.height];
    }, line.box);
    await page.mouse.move(lineAt[0] - 30, lineAt[1] + 20);
    await page.mouse.move(lineAt[0], lineAt[1], { steps: 4 });
    const moved = await treePointer(lineAt);
    check(moved !== 'none', `the mouse moved over the tree: the OS pointer shows again (${moved})`);
    const before = (await treeView())?.talk;
    await page.mouse.click(lineAt[0], lineAt[1]);
    await treePointer();
    tv = await treeView();
    check(!!before && tv?.talk === null, `a click on Oru's line puts it away (up before it: ${!!before}; after: ${JSON.stringify(tv?.talk)})`);
    rs = await R(() => window.__RIFTLIGHT__.press('PadB'));
    need(rs.ui.length === 0, `pad B closes the tree (ui ${rs.ui.join(',')})`);
    // again, left alone: the line goes after its reading time (the view's own clock); the frames of
    // the view with his line while it shows (the pad's, as it opened the first time)
    await R(() => {
      window.__PIXEL_ENGINE__.input.noteDevice('pad');
      return window.__RIFTLIGHT__.talkTo('oru');
    });
    await page.waitForFunction(() => window.__RIFTLIGHT__.game.layer.find('tree')?.debug().talk, null, { timeout: 10000 }).catch(() => {});
    const shown = (await treeView())?.talk;
    await captureWithHud(page, `riftlight-${tag}-oru-hud.png`);
    await page.screenshot({ path: new URL(`riftlight-${tag}-oru-tree.png`, OUT).pathname });
    const gone = await page
      .waitForFunction(() => window.__RIFTLIGHT__.game.layer.find('tree')?.debug().talk === null, null, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check(!!shown && gone, `left alone, Oru's line goes after its reading time (${JSON.stringify(shown)} → ${gone ? 'gone' : 'still there'})`);
    rs = await R(() => window.__RIFTLIGHT__.press('PadB'));
    need(rs.ui.length === 0, `pad B closes the tree (ui ${rs.ui.join(',')})`);
    await R(() => window.__PIXEL_ENGINE__.input.noteDevice('keyboard'));

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

/**
 * Couch co-op on a TV (docs/game/shell.md *Couch co-op*), in a 1920×1080 page: player 1 on a pad in
 * town, a second pad's Cross joins (`input.setGamepads`, as e2e-systems feeds pads), the guest comes
 * into depth 1 beside player 1 and walks off on its own stick; the frame shows both heroes (each
 * projects inside the view) and the guest's strip and tag in seat 2's colour on the pixel HUD.
 * Frames: .scratch/e2e/riftlight-couch-1080*.png.
 */
export async function runRiftlightCouch(h) {
  const { exe, scenario: s, openPage, check, capture, state, checkClean, encodePng, OUT } = h;
  console.log(`\n▶ riftlight couch co-op (${s.backend}, 1920×1080)`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=4242', { viewport: { width: 1920, height: 1080 } });
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    /** Pads by slot (`l` the left stick, x right, y forward; `b` the buttons held), then two frames. */
    const pads = (list) =>
      R((l) => {
        const make = (p, index) => (p ? { connected: true, mapping: 'standard', index, axes: [p.l?.[0] ?? 0, -(p.l?.[1] ?? 0), 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: (p.b ?? []).includes(i), value: (p.b ?? []).includes(i) ? 1 : 0 })) } : null);
        window.__PIXEL_ENGINE__.input.setGamepads(l.map(make));
        window.__PIXEL_ENGINE__.step(2);
      }, list);
    await R(() => window.__RIFTLIGHT__.newRun({ seed: 3 }));
    await R(() => window.__PIXEL_ENGINE__.step(20));
    await pads([{}, {}]);
    await pads([{ b: [3] }, {}]); // player 1 picks up pad 0
    await pads([{}, {}]);
    await pads([{}, { b: [0] }]); // Cross on pad 1: it joins
    await pads([{}, {}]);
    const rs = await R(() => window.__RIFTLIGHT__.state());
    check(rs.coop.length === 1 && rs.coop[0].seat === 2, `Cross on another pad in town joins as player 2 (seats ${JSON.stringify(rs.coop.map((g) => g.seat))})`);
    await R(() => window.__RIFTLIGHT__.enterDepth(1));
    await page.waitForFunction(() => window.__RIFTLIGHT__.state().screen === 'level', null, { timeout: 30000 });
    await R(() => window.__PIXEL_ENGINE__.step(20));
    for (let i = 0; i < 12; i++) await pads([{}, { l: [0.9, 0.2] }]); // the guest walks off on its own stick
    await pads([{}, {}]);
    await R(() => window.__PIXEL_ENGINE__.step(30)); // the camera settles on the pair
    const frame = await capture(page, 'riftlight-couch-1080.png');
    const view = await R(() => {
      const e = window.__PIXEL_ENGINE__;
      const st = window.__RIFTLIGHT__.state();
      const cam = e.camera.camera;
      const inView = (p) => {
        const v = cam.position.clone().set(p[0], p[1] + 0.9, p[2]).project(cam);
        return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95;
      };
      const p1 = st.hero.position;
      const g = st.coop[0]?.at;
      // the guest's strip and tag in seat 2's colour on the pixel HUD (52in1's blue)
      const c = document.querySelector('canvas[data-hud]');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let blue = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] && d[i] === 0x3b && d[i + 1] === 0x82 && d[i + 2] === 0xf6) blue++;
      return { p1: inView(p1), guest: !!g && inView(g), apart: g ? Math.hypot(g[0] - p1[0], g[2] - p1[2]) : 0, blue };
    });
    check(view.p1 && view.guest && view.apart > 1.5, `both heroes in view at 1920×1080, ${view.apart.toFixed(1)} m apart (player 1 ${view.p1}, the guest ${view.guest})`);
    check(view.blue > 30, `the guest's strip and tag in seat 2's colour on the HUD (${view.blue} px)`);
    if (encodePng && OUT) {
      // the frame with the pixel HUD on top (the strip, the P2 tag)
      const hud = await R(() => {
        const c = document.querySelector('canvas[data-hud]');
        return { w: c.width, h: c.height, data: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data] };
      });
      const px = frame.pixels;
      for (let y = 0; y < frame.height; y++)
        for (let x = 0; x < frame.width; x++) {
          const i = (Math.floor((y * hud.h) / frame.height) * hud.w + Math.floor((x * hud.w) / frame.width)) * 4;
          if (hud.data[i + 3] === 255) px.set(hud.data.slice(i, i + 3), (y * frame.width + x) * 4);
        }
      await writeFile(new URL('riftlight-couch-1080-hud.png', OUT), encodePng(frame));
    }
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `riftlight couch co-op crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

/**
 * A shout uses War Cry (docs/game/actors.md *The hero's controls*, docs/engine/hub.md *Shouts*), in
 * a page with a fake `window.AIHubSettings` from its first script on, as 52in1's companion sets it.
 * The microphone not allowed yet: Settings → Controller's Voice row is off with 52in1's line, so is
 * the engine panel's Microphone row, and `openMicrophone` is never called though the game listens
 * (War Cry on the bar). Allowed: the engine opens it once, a stream from an OscillatorNode
 * (`createMediaStreamDestination`) the test turns loud, then quiet, and War Cry fires once, through
 * one recorded `VoiceShout`; the Voice setting turned off stops the stream's tracks. With a DualSense's
 * speaker open, the portal from it is an echo: the microphone loud all through it presses nothing,
 * and once it has ended (and `SHOUT.echoS` after) a shout presses once. A steady hum louder than
 * `SHOUT.loud`, in a new stream from its first sample, is the room's floor: it never fires War Cry,
 * and a shout over it does; Settings → Controller shows the level beside Voice, a mark where a shout
 * counts (the meter).
 * Frames: .scratch/e2e/riftlight-voice-*.png.
 */
export async function runRiftlightVoice(h) {
  const { exe, scenario: s, openPage, check, state, checkClean, OUT } = h;
  console.log(`\n▶ riftlight voice (${s.backend}, 52in1's microphone)`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&save=memory&seed=4242');
    const { page, logs } = ctx;
    await page.addInitScript(() => {
      // `start`: the tone's gain as a stream opens (a room's hum from its first sample)
      const mic = (window.__mic = { calls: 0, gain: null, stream: null, start: 0 });
      window.AIHubSettings = Object.assign(new EventTarget(), {
        version: 1,
        music: 1,
        effects: 1,
        vibration: 1,
        mic: false,
        micLater: false,
        muted: false,
        dualsense: { connected: false },
        // the microphone: a tone the test turns up and down (its gain), in a context of the hub's own
        openMicrophone: async () => {
          mic.calls++;
          const ac = new AudioContext();
          const tone = ac.createOscillator();
          tone.frequency.value = 220;
          mic.gain = ac.createGain();
          mic.gain.gain.value = mic.start;
          const out = ac.createMediaStreamDestination();
          tone.connect(mic.gain).connect(out);
          tone.start();
          await ac.resume();
          return (mic.stream = out.stream);
        },
      });
    });
    await page.reload(); // the page again, 52in1's settings there from its first script on
    await page.waitForFunction(() => window.__RIFTLIGHT__?.state, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const shot = (name) => page.screenshot({ path: new URL(`riftlight-voice-${name}.png`, OUT).pathname });
    await page.keyboard.press('ShiftLeft'); // a gesture: the engine's sound starts (it measures the microphone)
    const into = await R(async () => {
      const rl = window.__RIFTLIGHT__;
      const e = window.__PIXEL_ENGINE__;
      rl.newRun({ slot: 0, seed: 4242 });
      await rl.enterDepth(1);
      rl.dev.ai = false;
      rl.dev.god = true;
      for (const m of rl.game.level.monsters()) m.actor.life = 0;
      e.step(150); // past the hero's pose on arriving
      return { hub: e.hubSettings.present, mic: !!e.microphone, bar: rl.game.hero.skills().some((k) => k.id === 'war-cry'), listening: e.input.voice, on: e.voiceOn, sound: e.audio.unlocked, calls: window.__mic.calls };
    });
    check(into.hub && into.mic && into.bar && into.listening && into.sound, `in 52in1 with War Cry on the bar the game listens for shouts (52in1 ${into.hub}, microphone ${into.mic}, War Cry ${into.bar}, listening ${into.listening}, sound ${into.sound})`);
    // not allowed: Riftlight's Voice row off, with 52in1's line, and it doesn't change
    const row = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const e = window.__PIXEL_ENGINE__;
      rl.ui.open('settings');
      rl.ui.click('controller');
      const menu = rl.game.layer.top.panel;
      menu.focusId('voice');
      rl.ui.click('voice');
      e.step(2);
      const w = menu.items().find((x) => x.id === 'voice');
      return { on: w.get(), disabled: !!w.disabled, hint: w.hint, setting: e.settings.values.voice ?? null };
    });
    await shot('off');
    check(!row.on && row.disabled && row.setting === null && row.hint === 'Allow the microphone in 52in1 Settings, under Sound', `not allowed: Settings → Controller's Voice row is off and stays off, with 52in1's line (${row.on ? 'on' : 'off'}, "${row.hint}")`);
    // and the engine panel's Microphone row (Sound page), as 52in1 asks of a voice feature
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.ui.close();
      rl.ui.close();
      window.__PIXEL_ENGINE__.manual = false; // the panel runs in the live loop
      window.__PIXEL_ENGINE__.settings.open();
    });
    await page.waitForFunction(() => document.querySelector('.settings-ui .row'), null, { timeout: 10000 });
    await page.keyboard.press('KeyE'); // the Sound page
    await page.waitForFunction(() => document.querySelector('.settings-ui .row[data-row="voice"]'), null, { timeout: 10000 });
    const panel = await R(() => {
      const r = document.querySelector('.settings-ui .row[data-row="voice"]');
      return { label: r.querySelector('.label').textContent, value: r.querySelector('.value').textContent, off: r.classList.contains('off'), note: r.querySelector('.note').textContent };
    });
    await shot('panel');
    await R(() => window.__PIXEL_ENGINE__.settings.close());
    check(panel.value === 'Off' && panel.off && panel.note === '52in1 allows the microphone in its Settings, under Sound.', `not allowed: the settings panel's ${panel.label} row is off with 52in1's line (${panel.value}, "${panel.note}")`);
    await page.waitForTimeout(500); // the game listening in the live loop
    const never = await R(() => ({ calls: window.__mic.calls, open: window.__PIXEL_ENGINE__.microphone.open, listening: window.__PIXEL_ENGINE__.input.voice }));
    check(never.calls === 0 && !never.open && never.listening, `not allowed: openMicrophone is never called while the game listens (${never.calls} calls)`);

    // allowed (the player, in 52in1's Settings): the engine opens it once, and hears it
    await R(() => {
      Object.assign(window.AIHubSettings, { mic: true });
      window.AIHubSettings.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => window.__PIXEL_ENGINE__.microphone.level() !== null, null, { timeout: 10000 });
    /** The microphone's loudness as the engine hears it, over `ms`: the highest. */
    const hear = (ms) =>
      R(async (ms) => {
        let top = 0;
        for (const t = performance.now(); performance.now() - t < ms; await new Promise((r) => setTimeout(r, 20))) top = Math.max(top, window.__PIXEL_ENGINE__.microphone.level() ?? 0);
        return top;
      }, ms);
    const quiet = await hear(800); // the room (quiet) learnt: `SHOUT.learnS`
    const shouts = () => R(() => window.__PIXEL_ENGINE__.recording().frames.filter((f) => f.pressed?.includes('VoiceShout')).length);
    const before = { shouts: await shouts(), cast: await R(() => window.__RIFTLIGHT__.game.hero.actor.hasBuff('war-cry')) };
    // a shout: loud for 0.8 s, then quiet
    await R(() => (window.__mic.gain.gain.value = 0.8));
    const loud = await hear(800);
    await R(() => (window.__mic.gain.gain.value = 0));
    await hear(800);
    const after = await R(() => {
      const hero = window.__RIFTLIGHT__.game.hero;
      return { cast: hero.actor.hasBuff('war-cry'), cooldown: hero.skills().find((k) => k.id === 'war-cry').remaining, calls: window.__mic.calls };
    });
    const shouted = await shouts();
    await shot('cry');
    check(quiet < 0.01 && loud > 0.2, `the engine hears the microphone's stream: quiet ${quiet.toFixed(3)}, loud ${loud.toFixed(3)} (RMS)`);
    check(before.shouts === 0 && !before.cast && shouted === 1 && after.cast && after.cooldown > 0, `allowed: a shout fires War Cry once, through one recorded VoiceShout (${shouted} shouts; its buff ${after.cast}, cooldown ${after.cooldown.toFixed(1)} s)`);
    check(after.calls === 1, `the engine opens the microphone once (${after.calls} calls)`);
    // the Voice setting off: the stream's tracks stop
    const off = await R(async () => {
      const e = window.__PIXEL_ENGINE__;
      e.settings.set({ voice: false });
      await new Promise((r) => setTimeout(r, 300));
      const tracks = window.__mic.stream.getTracks().map((t) => t.readyState);
      const open = e.microphone.open;
      e.settings.set({ voice: undefined });
      return { tracks, open };
    });
    check(off.tracks.length > 0 && off.tracks.every((t) => t === 'ended') && !off.open, `the Voice setting off stops the stream's tracks (${off.tracks.join(', ')})`);

    // a DualSense's speaker (52in1 opens it for the game): the portal from it, the microphone loud
    // all through, is no shout; still loud once it has ended (and a moment after), a shout
    const echo = await R(async () => {
      const e = window.__PIXEL_ENGINE__;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const speaker = async (c) => {
        const g = c.createGain();
        g.connect(c.destination);
        return g;
      };
      Object.assign(window.AIHubSettings, { dualsense: { connected: true, speaker: true, openSpeaker: speaker } });
      window.AIHubSettings.dispatchEvent(new Event('change'));
      for (let k = 0; k < 100 && !(e.audio.speakerRouted && e.microphone.level() !== null); k++) await wait(20);
      await wait(800); // the new stream's room learnt (`SHOUT.learnS`)
      const shouts = () => e.recording().frames.filter((f) => f.pressed?.includes('VoiceShout')).length;
      const before = shouts();
      window.__mic.gain.gain.value = 0.8;
      e.audio.play('rl.portal', { bus: 'speaker' });
      const t0 = performance.now(); // real time: how long the speaker kept the shout out
      let echoes = 0;
      let top = 0;
      while (e.audio.speakerPlaying(0.3) && performance.now() - t0 < 5000) {
        echoes += e.microphone.echo ? 1 : 0;
        top = Math.max(top, e.microphone.level() ?? 0);
        await wait(20);
      }
      const guarded = performance.now() - t0;
      const during = shouts() - before;
      await wait(600);
      window.__mic.gain.gain.value = 0;
      await wait(400);
      return { routed: e.audio.speakerRouted, guarded, echoes, top, during, after: shouts() - before - during };
    });
    check(echo.routed && echo.echoes > 0 && echo.top > 0.2 && echo.guarded > 600, `the portal from the controller's speaker is an echo while it plays and 0.3 s after (${echo.guarded.toFixed(0)} ms, loud ${echo.top.toFixed(3)})`);
    check(echo.during === 0 && echo.after === 1, `a shout heard through the controller's speaker presses nothing; still loud after it, one press (${echo.during} during, ${echo.after} after)`);

    // a steady hum (a fan, a TV) louder than `SHOUT.loud` (0.2), in a new stream from its first
    // sample: the room's floor, so it never fires War Cry; a shout over it (`SHOUT.floorLoud` times it) does
    const hum = await R(async () => {
      const e = window.__PIXEL_ENGINE__;
      const hero = window.__RIFTLIGHT__.game.hero;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const shouts = () => e.recording().frames.filter((f) => f.pressed?.includes('VoiceShout')).length;
      const ready = () => !hero.actor.hasBuff('war-cry') && hero.skills().find((k) => k.id === 'war-cry').remaining <= 0;
      /** The highest loudness heard over `ms`. */
      const top = async (ms) => {
        let t = 0;
        for (const t0 = performance.now(); performance.now() - t0 < ms; await wait(20)) t = Math.max(t, e.microphone.level() ?? 0);
        return t;
      };
      Object.assign(window.AIHubSettings, { dualsense: { connected: false } }); // the speaker gone again
      window.AIHubSettings.dispatchEvent(new Event('change'));
      for (let k = 0; k < 300 && !ready(); k++) await wait(50); // War Cry's buff and cooldown over (6 s)
      hero.actor.mana = hero.actor.maxMana;
      e.settings.set({ voice: false }); // the stream closed: the next one is a new room
      await wait(200);
      window.__mic.start = 0.32; // a sine this loud: 0.23 RMS
      e.settings.set({ voice: undefined });
      for (let k = 0; k < 100 && e.microphone.level() === null; k++) await wait(20);
      const before = shouts();
      const humTop = await top(3000);
      const during = { shouts: shouts() - before, cast: hero.actor.hasBuff('war-cry'), ready: ready(), need: e.input.shoutMeter?.loud ?? 0 };
      window.__mic.gain.gain.value = 1.5; // a shout over it
      const shoutTop = await top(600);
      window.__mic.gain.gain.value = 0.32;
      await wait(1000);
      return { humTop, during, shoutTop, over: shouts() - before - during.shouts, cast: hero.actor.hasBuff('war-cry') };
    });
    check(hum.humTop > 0.2 && hum.during.shouts === 0 && !hum.during.cast && hum.during.ready, `a steady hum louder than a shout's 0.2 (${hum.humTop.toFixed(3)} RMS), heard from its stream's start, fires nothing in 3 s (${hum.during.shouts} shouts; War Cry ready ${hum.during.ready}); a shout needs ${hum.during.need.toFixed(3)} over it`);
    check(hum.shoutTop > hum.during.need && hum.over === 1 && hum.cast, `a shout over the hum (${hum.shoutTop.toFixed(3)} RMS) fires War Cry once (${hum.over} shouts, cast ${hum.cast})`);
    // Settings → Controller: the level beside Voice, a mark where a shout counts (presentation only)
    const meter = await R(async () => {
      const rl = window.__RIFTLIGHT__;
      rl.ui.open('settings');
      rl.ui.click('controller');
      await new Promise((r) => setTimeout(r, 400));
      const menu = rl.game.layer.top.panel;
      return { rect: menu.rects.get('voice:meter') ?? null, ids: menu.items().map((w) => w.id), heard: window.__PIXEL_ENGINE__.input.shoutMeter };
    });
    await shot('meter');
    await R(() => {
      window.__RIFTLIGHT__.ui.close();
      window.__RIFTLIGHT__.ui.close();
    });
    check(!!meter.rect && meter.ids.includes('voiceSensitivity') && meter.heard?.level > 0.2, `Settings → Controller: Shout sensitivity under Voice, and a meter beside Voice (${meter.rect ? `${meter.rect.w}×${meter.rect.h} art px` : 'none'}, level ${meter.heard?.level.toFixed(3)} of ${meter.heard?.loud.toFixed(3)})`);
    checkClean(await state(page), logs, 'voice: ');
  } catch (e) {
    check(false, `riftlight voice crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
