// e2e suite "systems": the engine's game systems in the real game (production build).
//
//   npm run build && npm run test:e2e -- systems
//
// Covers:
//   hud        pixel HUD overlay: art-resolution canvas, integer-scaled with the framing,
//              follows R (320×180), draws the coin counter in palette colors
//   audio      unlock on first input, music, mute (key, panel, persisted)
//   particles  visible in the frame
//   gamepad    standard gamepad: left stick moves, A jumps; the device used last follows use (a
//              connected pad is not a use, a press is, a mouse move gives it back); rumble
//   pause      game time and presses freeze while paused (the live loop); nothing fires on resume
//   keys       engine hotkeys are configurable (engine.debugKeys)
//   lifecycle  engine.loadGame between two games ×5: GPU geometries/textures back to baseline;
//              the sandbox's textured toon floor and its textured model (brick-wall), built and
//              merged, show their textures; the first frame after a slow load; dispose() frees
//              the canvases and UI
//   52in1      a fake window.AIHubSettings: the real bus gains are the game's volumes × the hub's
//              (never its master), again on change; the speaker bus plays from the controller's
//              node; the light bar and triggers are sent once, only while allowed, given back at
//              loadGame (the headless side: src/engine/hub/settings.test.ts)
//
// Gameplay checks run headless in vitest: hero events → sounds, particles and coin triggers in
// src/engine/systems.test.ts; loadGame (world counts, level doors, concurrent loads, input while
// loading, dispose during a load, the sandbox's materials) in src/engine/loadGame.test.ts.
//
// Frames land in .scratch/e2e/systems-*.png. Self-contained: e2e.mjs passes its helpers in.
import { writeFile } from 'node:fs/promises';
import { PAGE_HELPERS } from './e2e-moves.mjs';
import { watchConsole } from './page.mjs';

/**
 * @param {object} h helpers from e2e.mjs:
 *   { exe, scenario, openPage, ready, until, check, capture, state, waitFrames, colorCount, meanDiff, checkClean, encodePng, OUT }
 */
export async function runSystems(h) {
  const { exe, scenario: s, openPage, ready, until, check, capture, state, waitFrames, colorCount, meanDiff, checkClean, encodePng, OUT } = h;
  const tag = s.name;
  console.log(`\n▶ systems (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'debug=1');
    const { page, logs } = ctx;
    await page.evaluate(PAGE_HELPERS);
    const E = (fn, arg) => page.evaluate(fn, arg);

    // Browsers allow sound only after a user gesture: nothing may be created before one.
    check(await E(() => window.__PIXEL_ENGINE__.audio.context === null), 'no AudioContext before the first user input');

    // ---------------------------------------------------------------- HUD
    await E(() => {
      window.__PIXEL_ENGINE__.step(2);
      window.__PIXEL_ENGINE__.manual = false;
    });
    const hud = await E(() => {
      const e = window.__PIXEL_ENGINE__;
      const c = document.querySelector('canvas[data-hud]');
      const f = e.renderer.framing;
      const r = c.getBoundingClientRect();
      const g = e.renderer.renderer.domElement.getBoundingClientRect();
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let sand = 0;
      for (let i = 0; i < img.length; i += 4) if (img[i] === 0xff && img[i + 1] === 0xcd && img[i + 2] === 0x75 && img[i + 3] === 255) sand++;
      const res = e.renderer.resolution;
      return { w: c.width, h: c.height, art: [res.width, res.height], css: [r.width, r.height, r.left, r.top], game: [g.width, g.height, g.left, g.top], scale: f.scale, sand, pe: getComputedStyle(c).pointerEvents };
    });
    check(hud.w === hud.art[0] && hud.h === hud.art[1] && hud.h === 270, `HUD canvas is the art resolution (${hud.w}×${hud.h})`);
    check(JSON.stringify(hud.css) === JSON.stringify(hud.game), `HUD overlays the game canvas exactly (${hud.css.join(',')} vs ${hud.game.join(',')})`);
    check(hud.sand > 20 && hud.pe === 'none', `HUD draws the coin counter in palette sand (${hud.sand} px), ignores pointer input`);
    await saveComposite(page, `systems-${tag}-hud.png`);
    await page.keyboard.press('KeyR');
    await until(page, (e) => document.querySelector('canvas[data-hud]').height === 180 && e.renderer.resolution.height === 180);
    const hud320 = await E(() => {
      const c = document.querySelector('canvas[data-hud]');
      const r = c.getBoundingClientRect();
      const g = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      return { w: c.width, h: c.height, same: r.width === g.width && r.height === g.height && r.left === g.left && r.top === g.top };
    });
    check(hud320.w === 320 && hud320.h === 180 && hud320.same, `HUD follows R to 320×180 and the new framing`);
    await page.keyboard.press('KeyR');
    await until(page, () => document.querySelector('canvas[data-hud]').height === 270);

    // ---------------------------------------------------------------- audio unlock + mute
    // A real click is a user gesture (the R presses above were too): audio is unlocked.
    await page.mouse.click(700, 400);
    await until(page, (e) => e.audio.context !== null && e.audio.playing !== '');
    const unlocked = await E(() => ({ ctx: !!window.__PIXEL_ENGINE__.audio.context, playing: window.__PIXEL_ENGINE__.audio.playing }));
    check(unlocked.ctx && unlocked.playing === 'playground', `audio unlocks on the first click, music "${unlocked.playing}" is on`);
    await page.keyboard.press('KeyM');
    await until(page, (e) => e.audio.muted && document.querySelector('[data-a="mute"]').textContent === 'Sound: off');
    const muted = await E(() => ({
      muted: window.__PIXEL_ENGINE__.audio.muted,
      stored: localStorage.getItem('pixel-engine:audio:playground'),
      shared: localStorage.getItem('pixel-engine:audio'),
      button: document.querySelector('[data-a="mute"]').textContent,
    }));
    // saved under the game's own key (52in1's games share one origin), never the key all once shared
    check(muted.muted && JSON.parse(muted.stored ?? 'null')?.muted === true && muted.shared === null && muted.button === 'Sound: off', `M mutes, persisted for this game (${muted.stored}; the shared key ${muted.shared}), panel shows "${muted.button}"`);
    await page.click('[data-a="mute"]');
    await until(page, (e) => !e.audio.muted);
    check(await E(() => !window.__PIXEL_ENGINE__.audio.muted), 'the panel button unmutes');

    // ---------------------------------------------------------------- particles in the frame
    await E(() => window.__T.place([0, 0, 4]));
    // Particles are visible: the same frame with and without them (a sparkle burst in
    // front of the hero, a few frames old so it has spread out).
    await E(() => {
      const e = window.__PIXEL_ENGINE__;
      e.step(60);
      const f = e.game.hero.feet;
      e.particles.burst('sparkle', [f.x + 1.5, f.y + 1, f.z + 1.5], { count: 40, scale: 2 });
      e.particles.burst('impact', [f.x - 1.5, f.y, f.z + 1.5]);
      e.step(8);
    });
    const withParticles = await freshCapture(page, `systems-${tag}-particles.png`);
    await E(() => (window.__PIXEL_ENGINE__.particles.group.visible = false));
    const without = await freshCapture(page, `systems-${tag}-particles-hidden.png`);
    await E(() => (window.__PIXEL_ENGINE__.particles.group.visible = true));
    const pd = meanDiff(withParticles, without);
    check(pd > 0.05 && pd < 5, `particles show up in the frame, and nothing else changes (mean diff ${pd.toFixed(3)})`);

    // ---------------------------------------------------------------- gamepad
    const pad = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const T = window.__T;
      await T.place([0, 0, 4]);
      const rumbles = [];
      const vibrationActuator = { playEffect: (type, params) => (rumbles.push([type, params.strongMagnitude, params.weakMagnitude]), Promise.reject(new Error('fake pad: no motors'))) };
      const fake = { connected: true, mapping: 'standard', index: 0, axes: [1, 0, 0, 0], buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })), vibrationActuator };
      const real = navigator.getGamepads;
      navigator.getGamepads = () => [fake];
      e.input.noteDevice('keyboard');
      const x0 = e.game.hero.feet.toArray();
      await T.frames(40);
      const x1 = e.game.hero.feet.toArray();
      const connectedOnly = e.input.device; // the stick was already over at first sight: not a use
      fake.axes = [0.1, 0.1, 0, 0]; // inside the deadzone
      await T.frames(30);
      const axisRest = e.input.moveAxis();
      const jumps = e.game.hero.stats.jumps;
      fake.buttons[0] = { pressed: true, value: 1 };
      await T.frames(3);
      fake.buttons[0] = { pressed: false, value: 0 };
      await T.frames(3);
      const used = e.input.device;
      e.input.rumble({ strong: 0.5, weak: 1, ms: 80 }); // a rejected effect must log nothing
      await T.frames(2);
      const r = { moved: Math.hypot(x1[0] - x0[0], x1[2] - x0[2]), jumped: e.game.hero.stats.jumps - jumps, axisRest, connected: e.input.gamepadConnected, connectedOnly, used, rumbles };
      navigator.getGamepads = real;
      await T.frames(60);
      return r;
    });
    check(pad.connected && pad.moved > 1, `gamepad left stick moves the hero (${pad.moved.toFixed(2)})`);
    check(pad.axisRest.x === 0 && pad.axisRest.y === 0, 'stick deadzone reads as centred');
    check(pad.jumped === 1, 'gamepad A jumps');
    check(pad.connectedOnly === 'keyboard' && pad.used === 'pad', `the device follows use, not connection (${pad.connectedOnly} → ${pad.used})`);
    check(JSON.stringify(pad.rumbles) === JSON.stringify([['dual-rumble', 0.5, 1]]), `rumble plays a dual-rumble on the pad in use (${JSON.stringify(pad.rumbles)})`);
    // the mouse moving over the canvas takes the device back to the keyboard and mouse; while the
    // pad is in use the OS pointer is hidden over the canvas, and it shows again as the mouse moves
    const box = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      e.input.noteDevice('pad'); // as if the pad was in use
      await window.__T.frames(2);
      const c = e.renderer.renderer.domElement;
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, cursor: getComputedStyle(c).cursor };
    });
    check(box.cursor === 'none', `the pad in use hides the OS pointer over the canvas (${box.cursor})`);
    await page.mouse.move(box.x, box.y);
    await page.mouse.move(box.x + 40, box.y + 10, { steps: 4 });
    const afterMouse = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      await window.__T.frames(2);
      return { device: e.input.device, cursor: getComputedStyle(e.renderer.renderer.domElement).cursor };
    });
    check(afterMouse.device === 'keyboard', `a mouse move over the canvas is the keyboard and mouse again (${afterMouse.device})`);
    check(afterMouse.cursor !== 'none', `and the OS pointer shows again (${afterMouse.cursor})`);
    // a replay of a pad recording hides nothing: its device is the recording's, the viewer's mouse could not bring it back
    const replayed = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      e.input.playing = true;
      e.input.playFrom('pad'); // what a pad recording's level began with
      await window.__T.frames(2);
      const r = { device: e.controls.device, cursor: getComputedStyle(e.renderer.renderer.domElement).cursor };
      e.input.playing = false;
      e.input.noteDevice('keyboard');
      await window.__T.frames(2);
      return r;
    });
    check(replayed.device === 'pad' && replayed.cursor !== 'none', `a replay of the pad keeps the OS pointer over the canvas (${replayed.device}: ${replayed.cursor})`);

    // ---------------------------------------------------------------- capture freshness
    // renderer.capture() right after engine.step() in a frame the loop already rendered
    // must show the stepped state, not the frame rendered before the step (npm run film).
    const fresh = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      e.manual = false;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // the loop rendered this frame
      e.game.hero.teleport([-8.2, 1.4, 0]);
      e.step(30);
      const a = await e.renderer.capture();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = await e.renderer.capture();
      let sum = 0;
      for (let i = 0; i < a.pixels.length; i += 4) sum += Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]);
      return sum / (a.pixels.length / 4) / 3;
    });
    check(fresh < 0.05, `capture() right after step() shows the stepped frame (diff to a later capture ${fresh.toFixed(3)})`);

    // ---------------------------------------------------------------- pause
    await E(() => (window.__PIXEL_ENGINE__.manual = false));
    await waitFrames(page, 5);
    const pause = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const frames = (n) => new Promise((res) => {
        const f0 = e.frame;
        const poll = () => (e.frame >= f0 + n ? res() : requestAnimationFrame(poll));
        poll();
      });
      e.paused = true;
      const t0 = e.time;
      const jumps = e.game.hero.stats.jumps;
      e.input.setKey('Space', true);
      await frames(10);
      const t1 = e.time;
      const queued = e.input.queuedPresses.length;
      e.paused = false;
      await frames(10);
      e.input.setKey('Space', false);
      return { frozen: t1 === t0, queued, jumped: e.game.hero.stats.jumps - jumps, resumed: e.time > t1 };
    });
    check(pause.frozen && pause.resumed, 'ctx.time stops while paused and resumes after');
    check(pause.queued === 0 && pause.jumped === 0, `a press made while paused is dropped (queued ${pause.queued}, jumps ${pause.jumped})`);

    // ---------------------------------------------------------------- engine hotkeys
    const keys = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      e.debugKeys = { ...e.debugKeys, resolution: [] };
      return e.renderer.resolution.width;
    });
    await page.keyboard.press('KeyR');
    await waitFrames(page, 3);
    check((await state(page)).resolution.width === keys, 'a disabled hotkey (resolution) does nothing');
    await E(() => {
      const e = window.__PIXEL_ENGINE__;
      e.debugKeys = { ...e.debugKeys, resolution: ['KeyR'] };
    });

    // ---------------------------------------------------------------- level lifecycle
    const probe = () => {
      const e = window.__PIXEL_ENGINE__;
      const mem = e.renderer.renderer.info.memory;
      return { game: e.game.name, geometries: mem.geometries, textures: mem.textures };
    };
    const load = async (name) => {
      await E(async (n) => {
        const e = window.__PIXEL_ENGINE__;
        e.manual = false;
        await e.loadGame(window.__PIXEL_GAMES__[n]());
      }, name);
      await waitFrames(page, 10); // render a few frames so GPU resources are (re)created
      return E(probe);
    };
    const seen = { playground: [], sandbox: [] };
    for (const name of ['sandbox', 'playground', 'sandbox', 'playground', 'sandbox', 'playground']) seen[name].push(await load(name));
    for (const name of ['playground', 'sandbox']) {
      const [first, ...rest] = seen[name];
      const same = rest.every((p) => JSON.stringify(p) === JSON.stringify(first));
      check(same && first.game.length > 0, `${name} ×${seen[name].length}: GPU geometries and textures return to baseline ${JSON.stringify(first)}${same ? '' : ' → ' + JSON.stringify(rest)}`);
    }

    // Sandbox: textured floor + vertex-colored pillar through toonify.
    await load('sandbox');
    await E(async () => {
      await window.__PIXEL_ENGINE__.setCamera({ preset: 'iso', zoom: 1.6 });
      window.__PIXEL_ENGINE__.paused = true;
    });
    await waitFrames(page, 5);
    const textured = await freshCapture(page, `systems-${tag}-sandbox.png`);
    await E(() => (window.__floorMat = window.__PIXEL_ENGINE__.game.floor.material[2])); // the top face
    await E(() => {
      const f = window.__PIXEL_ENGINE__.game.floor;
      const plain = f.material[2].clone();
      plain.map = null;
      f.material = f.material.map((m, i) => (i === 2 ? plain : m));
    });
    await waitFrames(page, 3);
    const plain = await freshCapture(page, `systems-${tag}-sandbox-untextured.png`);
    check(meanDiff(textured, plain) > 2 && colorCount(textured) > colorCount(plain), `the checker texture is visible (diff ${meanDiff(textured, plain).toFixed(2)}, ${colorCount(textured)} vs ${colorCount(plain)} colors)`);
    await E(() => {
      const e = window.__PIXEL_ENGINE__;
      e.game.floor.material = e.game.floor.material.map((m, i) => (i === 2 ? window.__floorMat : m));
    });
    // A textured model (buildModel, the bricks texture) and a merged copy
    await E(() => {
      const g = window.__PIXEL_ENGINE__.game;
      const built = [];
      g.wall.traverse((o) => o.isMesh && o.material.map && built.push(o));
      window.__walls = [...built, ...g.mergedWall.filter((m) => m.material.map)].map((m) => [m, m.material]);
    });
    await waitFrames(page, 3);
    const bricks = await freshCapture(page, `systems-${tag}-sandbox-walls.png`);
    await E(() => {
      for (const [m, mat] of window.__walls) {
        const plain = mat.clone();
        plain.map = null;
        m.material = plain;
      }
    });
    await waitFrames(page, 3);
    const flat = await freshCapture(page, `systems-${tag}-sandbox-walls-untextured.png`);
    check(meanDiff(bricks, flat) > 0.5 && colorCount(bricks) > colorCount(flat), `the walls show their bricks, built and merged (diff ${meanDiff(bricks, flat).toFixed(2)}, ${colorCount(bricks)} vs ${colorCount(flat)} colors)`);
    await E(() => {
      for (const [m, mat] of window.__walls) {
        m.material.dispose();
        m.material = mat;
      }
      window.__PIXEL_ENGINE__.paused = false;
    });
    await waitFrames(page, 3);
    checkClean(await state(page), logs);

    // ---------------------------------------------------------------- loadGame edge cases
    // Two loads at once: the latest wins and nothing of the other level is left over.
    await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const G = window.__PIXEL_GAMES__;
      await Promise.allSettled([e.loadGame(G.sandbox()), e.loadGame(G.playground())]);
    });
    await waitFrames(page, 10);
    const both = await E(probe);
    const base = seen.playground[0];
    // GPU counts can only be lower (the sandbox never rendered), never higher.
    check(both.game === base.game && both.geometries <= base.geometries && both.textures <= base.textures, `concurrent loadGame(sandbox) + loadGame(playground): no GPU resources of the sandbox left (${JSON.stringify(both)})`);
    checkClean(await state(page), logs, 'concurrent loads: ');

    // A hotkey pressed while a level loads does not fire once it runs (hotkeys are the live loop's),
    // and a slow load does not make the first frame catch up on the clock.
    const loadInput = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const mode = e.renderer.mode;
      const game = window.__PIXEL_GAMES__.playground();
      const setup = game.setup.bind(game);
      game.setup = async (ctx) => {
        e.input.setKey('KeyP', true); // pressed while the level loads
        await setup(ctx);
        await new Promise((r) => setTimeout(r, 250)); // a slow load: the clock moves on
      };
      await e.loadGame(game);
      const steps0 = e.physics.steps;
      await new Promise((r) => requestAnimationFrame(r)); // the engine ticks first in this frame
      const firstSteps = e.physics.steps - steps0;
      await new Promise((r) => setTimeout(r, 300));
      e.input.setKey('KeyP', false);
      return { mode: e.renderer.mode === mode, firstSteps };
    });
    check(loadInput.mode, 'a hotkey (P) pressed while loading does nothing once the level runs');
    check(loadInput.firstSteps <= 1, `the first frame after loading is one 1/60 s step, not a stale-clock catch-up (${loadInput.firstSteps} physics steps)`);

    // dispose() while a load is in flight: the canvases and the UI go.
    const disposed = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const p = e.loadGame(window.__PIXEL_GAMES__.sandbox());
      await new Promise((r) => setTimeout(r, 0));
      e.dispose();
      const settled = await p.then(() => 'resolved', (err) => `rejected: ${err?.message}`);
      await new Promise((r) => setTimeout(r, 200));
      return {
        settled,
        canvases: document.querySelectorAll('canvas').length,
        debug: !!document.querySelector('.debug-ui'),
      };
    });
    check(disposed.canvases === 0 && !disposed.debug, `engine.dispose() during a loadGame: canvases and UI go (${JSON.stringify(disposed)})`);
    await page.waitForTimeout(300);
    check(logs.length === 0, `no errors after dispose${logs.length ? ': ' + logs.join(' | ') : ''}`);

    await hubSettings(ctx.browser, page.url());
  } catch (e) {
    check(false, `systems crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }

  /**
   * The player's 52in1 settings in a real page (docs/engine/hub.md *The player's settings*): a
   * fake `window.AIHubSettings`, as the hub's companion script makes it, from the page's first
   * script on. The real buses' gains are the game's own volumes × the hub's (its master never),
   * again on `change`; the speaker bus reaches the node `openSpeaker` gives (an analyser hears it);
   * the light bar and triggers are sent once, only while allowed, and given back at loadGame; the
   * DualSense's motion and touches are never read.
   */
  async function hubSettings(browser, url) {
    const hubPage = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const hubLogs = watchConsole(hubPage, { warnings: true });
    try {
      await hubPage.addInitScript(() => {
        const calls = (window.__hubCalls = []);
        const ds = {
          connected: true,
          lightbar: true,
          triggers: true,
          motion: true,
          touchpad: true,
          speaker: true,
          aim: false,
          light: (c) => calls.push(['light', c]),
          trigger: (which, effect) => calls.push(['trigger', which, effect]),
          // a node in the game's own context: what reaches it plays from the controller
          openSpeaker: async (context) => {
            calls.push(['speaker']);
            const analyser = context.createAnalyser();
            window.__speaker = analyser;
            return analyser;
          },
        };
        for (const f of ['gyro', 'accel', 'touches']) Object.defineProperty(ds, f, { enumerable: true, get: () => (calls.push(['read', f]), f === 'touches' ? [] : { x: 0, y: 0, z: 0 }) });
        window.AIHubSettings = Object.assign(new EventTarget(), { version: 1, music: 0.5, effects: 0.25, vibration: 1, mic: false, micLater: false, muted: false, dualsense: ds, openMicrophone: async () => null });
      });
      await hubPage.goto(url);
      await ready(hubPage);
      await hubPage.mouse.click(700, 400); // a gesture: audio starts
      await until(hubPage, (e) => e.audio.unlocked && e.audio.speakerRouted, null, 120);
      /** The real nodes' gains next to the game's own volumes. */
      const gains = () =>
        hubPage.evaluate(() => {
          const a = window.__PIXEL_ENGINE__.audio;
          return { own: { ...a.volume }, master: a.master.gain.value, sfx: a.buses.sfx.gain.value, music: a.buses.music.gain.value, speaker: a.buses.speaker.gain.value, routed: a.speakerRouted, running: a.unlocked };
        });
      const near = (a, b) => Math.abs(a - b) < 1e-4;
      const g = await gains();
      const ownMaster = g.own.muted ? 0 : g.own.master;
      check(g.running && near(g.music, g.own.music * 0.5) && near(g.sfx, g.own.sfx * 0.25) && near(g.speaker, g.sfx), `52in1's volumes multiply the game's: music ${g.music.toFixed(3)} = ${g.own.music} × 0.5, sfx ${g.sfx.toFixed(3)} = ${g.own.sfx} × 0.25`);
      check(near(g.master, ownMaster), `the hub's master is never applied: the master gain is the game's own (${g.master.toFixed(3)})`);
      await hubPage.evaluate(() => {
        Object.assign(window.AIHubSettings, { music: 1, effects: 0.5 });
        window.AIHubSettings.dispatchEvent(new Event('change'));
      });
      const g2 = await gains();
      check(near(g2.music, g2.own.music) && near(g2.sfx, g2.own.sfx * 0.5), `again on the hub's change: music ${g2.music.toFixed(3)}, sfx ${g2.sfx.toFixed(3)}`);

      // the speaker bus plays from the controller: the analyser the hub's node is hears it, and only it
      const loudness = () =>
        hubPage.evaluate(async () => {
          const an = window.__speaker;
          const buf = new Float32Array(an.fftSize);
          let peak = 0;
          for (let i = 0; i < 12; i++) {
            await new Promise((r) => setTimeout(r, 25));
            an.getFloatTimeDomainData(buf);
            for (const v of buf) peak = Math.max(peak, Math.abs(v));
          }
          return peak;
        });
      const before = await loudness();
      await hubPage.evaluate(() => window.__PIXEL_ENGINE__.audio.play('fanfare', { bus: 'speaker' }));
      const during = await loudness();
      check(g.routed && before < 1e-4 && during > 0.01, `a sound on the speaker bus plays from the controller's speaker, and nothing else does (peak ${before.toFixed(4)} → ${during.toFixed(4)})`);

      const ds = await hubPage.evaluate(async () => {
        const e = window.__PIXEL_ENGINE__;
        const calls = window.__hubCalls;
        const bow = { kind: 'resist', from: 0.2, strength: 0.7 };
        for (let i = 0; i < 3; i++) {
          e.dualsense.light('#FF8800');
          e.dualsense.trigger('right', bow);
        }
        const once = JSON.stringify(calls.filter((c) => c[0] !== 'speaker'));
        const mark = calls.length;
        await e.loadGame(window.__PIXEL_GAMES__.sandbox());
        const unloaded = JSON.stringify(calls.slice(mark));
        Object.assign(window.AIHubSettings.dualsense, { lightbar: false });
        window.AIHubSettings.dispatchEvent(new Event('change'));
        const off = calls.length;
        e.dualsense.light('#00ff00'); // the player took the light bar back: nothing is sent
        return { once, unloaded, whileOff: calls.length - off, reads: calls.filter((c) => c[0] === 'read').length, speakers: calls.filter((c) => c[0] === 'speaker').length };
      });
      check(ds.once === JSON.stringify([['light', '#ff8800'], ['trigger', 'right', { kind: 'resist', from: 0.2, strength: 0.7 }]]), `the light bar and R2 are sent once, however often the game asks (${ds.once})`);
      check(ds.unloaded === JSON.stringify([['light', null], ['trigger', 'right', null]]), `the next level gives the light bar back and lets R2 go (${ds.unloaded})`);
      check(ds.whileOff === 0, 'nothing is sent while the player has the light bar off for games');
      check(ds.reads === 0 && ds.speakers === 1, `the DualSense's motion and touches are never read (${ds.reads}), its speaker opened once (${ds.speakers})`);
      await hubPage.waitForTimeout(200);
      check(hubLogs.length === 0, `52in1 settings: zero console errors/warnings${hubLogs.length ? ': ' + hubLogs.join(' | ') : ''}`);
    } finally {
      await hubPage.close();
    }
  }

  /** A capture of the current state (renderer.capture() starts a fresh node frame). */
  async function freshCapture(page, file) {
    return capture(page, file);
  }

  /** Save the captured frame with the HUD canvas composited on top (what the player sees). */
  async function saveComposite(page, file) {
    const frame = await freshCapture(page, file);
    const overlay = await page.evaluate(() => {
      const c = document.querySelector('canvas[data-hud]');
      return { w: c.width, h: c.height, scale: window.__PIXEL_ENGINE__.renderer.framing.scale, data: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data] };
    });
    const px = frame.pixels;
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const o = (Math.floor(y / overlay.scale) * overlay.w + Math.floor(x / overlay.scale)) * 4;
        if (overlay.data[o + 3] === 0) continue;
        px.set(overlay.data.slice(o, o + 3), (y * frame.width + x) * 4);
      }
    }
    await writeFile(new URL(file, OUT), encodePng(frame));
  }
}
