// e2e suite "systems": the engine's game systems in the real game (production build).
//
//   npm run build && npm run test:e2e -- systems
//
// Runs on WebGPU and on the WebGL 2 fallback. Covers:
//   hud        pixel HUD overlay: art-resolution canvas, integer-scaled with the framing,
//              follows R (320×180), draws the coin counter in palette colors
//   audio      unlock on first input, hero events → sound effects, music, mute (key, panel,
//              persisted), headless-safe (counted even when silent)
//   particles  landing dust, skid dust, coin sparkle, ground-pound impact; one emitter
//              (draw) per preset; visible in the frame
//   triggers   coins are trigger volumes (collected once, the trigger is removed)
//   gamepad    standard gamepad: left stick moves, A jumps
//   pause      game time and presses freeze while paused; nothing fires on resume
//   keys       engine hotkeys are configurable (engine.debugKeys), ` creates the panel
//   lifecycle  engine.loadGame between two games ×5: bodies, colliders, controllers,
//              triggers, tags, scene objects, GPU geometries/textures back to baseline;
//              the sandbox's textured + vertex-colored toon materials render; dispose()
//
// Frames land in .scratch/e2e/systems-*.png. Self-contained: e2e.mjs passes its helpers in.
import { writeFile } from 'node:fs/promises';
import { PAGE_HELPERS } from './e2e-moves.mjs';

/**
 * @param {object} h helpers from e2e.mjs:
 *   { exe, scenario, openPage, ready, until, check, capture, state, waitFrames, colorCount, meanDiff, checkClean, encodePng, OUT }
 */
export async function runSystems(h) {
  const { exe, scenario: s, openPage, until, check, capture, state, waitFrames, colorCount, meanDiff, checkClean, encodePng, OUT } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
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
      stored: localStorage.getItem('pixel-engine:audio'),
      button: document.querySelector('[data-a="mute"]').textContent,
    }));
    check(muted.muted && JSON.parse(muted.stored).muted === true && muted.button === 'Sound: off', `M mutes, persisted (${muted.stored}), panel shows "${muted.button}"`);
    await page.click('[data-a="mute"]');
    await until(page, (e) => !e.audio.muted);
    check(await E(() => !window.__PIXEL_ENGINE__.audio.muted), 'the panel button unmutes');

    // ---------------------------------------------------------------- hero events → sound + particles
    const events = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const T = window.__T;
      const a = e.audio.counts;
      const before = { ...a };
      const out = {};
      await T.place([0, 0, 4]);
      // jump → land: jump sound, land sound, dust
      await T.tap('Space');
      const peakDust = { n: 0 };
      await T.until((hero) => hero.state === 'jump', 500);
      const land = await T.until((hero) => hero.stats.landings > 0 && hero.state !== 'jump' && hero.state !== 'fall', 2500);
      peakDust.n = e.particles.alive;
      out.jump = (a.jump ?? 0) - (before.jump ?? 0);
      out.land = (a.land ?? 0) - (before.land ?? 0);
      out.dust = peakDust.n;
      out.landed = land.ok;
      // double jump: jump again right on landing, while running
      await T.place([-6, 0, 10], Math.PI / 2);
      T.set(['KeyD'], true);
      await T.until((hero) => hero.state === 'run', 2500);
      const kinds = [];
      for (let i = 0; i < 2; i++) {
        await T.tap('Space');
        kinds.push(e.game.hero.jumpKind);
        await T.until((hero) => hero.grounded && hero.state !== 'jump' && hero.state !== 'fall', 2500);
      }
      T.set(['KeyD'], false);
      out.doubleJump = (a.doubleJump ?? 0) - (before.doubleJump ?? 0);
      out.kind = kinds.join(',');
      await T.wait(1500);
      // ground pound: impact particles + boom
      await T.place([0, 0, 4]);
      await T.tap('Space');
      await T.until((hero) => hero.state === 'jump' && hero.vy < 6, 1500);
      await T.tap('KeyC');
      await T.until((hero) => hero.state === 'groundPoundLand', 3000);
      out.groundPound = (a.groundPound ?? 0) - (before.groundPound ?? 0);
      out.whoosh = (a.whoosh ?? 0) - (before.whoosh ?? 0);
      out.impact = e.particles.alive;
      // freeze right after the impact and look at it
      out.emitters = e.particles.emitterCount;
      out.sprites = e.scene.getObjectByName('particles').children.length;
      return out;
    });
    check(events.jump >= 1 && events.land >= 1 && events.landed, `jump + land sounds (${events.jump}, ${events.land})`);
    check(events.dust >= 3, `landing dust (${events.dust} particles)`);
    check(events.doubleJump >= 1 && events.kind.includes('DoubleJump'), `double jump sound (${events.doubleJump}, ${events.kind})`);
    check(events.groundPound === 1 && events.whoosh >= 1 && events.impact >= 15, `ground pound: whoosh + boom + ${events.impact} impact particles`);
    check(events.sprites === events.emitters && events.emitters <= 5, `one emitter (draw call) per preset: ${events.emitters}`);
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

    const more = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const T = window.__T;
      const a = e.audio.counts;
      const before = { ...a };
      await T.wait(1000);
      // skid: run, reverse
      await T.place([-4, 0, 6]);
      T.set(['KeyD'], true);
      await T.until((hero) => hero.state === 'run', 2500);
      await T.wait(300);
      T.set(['KeyA'], true);
      T.set(['KeyD'], false);
      const sk = await T.until((hero) => hero.state === 'skid', 800);
      await T.wait(60);
      const skidDust = e.particles.alive;
      T.set(['KeyA'], false);
      await T.wait(800);
      // steps + punch
      T.set(['KeyD'], true);
      await T.wait(600);
      T.set(['KeyD'], false);
      await T.wait(300);
      await T.tap('KeyJ');
      await T.wait(300);
      // coin via trigger: sparkle + coin sound, trigger removed
      const triggers0 = e.physics.counts().triggers;
      const coins0 = e.game.collected;
      const coinSounds0 = a.coin ?? 0;
      await T.wait(1000); // let earlier particles die out
      await T.place([4, 0, -4]);
      const sparkle = e.particles.alive;
      const coinSounds = (a.coin ?? 0) - coinSounds0;
      // fall off the world: hurt
      await T.place([0, 0, 18]);
      await T.until(() => e.game.respawns > 0, 4000);
      return {
        skid: sk.ok,
        skidSound: (a.skid ?? 0) - (before.skid ?? 0),
        skidDust,
        step: (a.step ?? 0) - (before.step ?? 0),
        punch: (a.punch ?? 0) - (before.punch ?? 0),
        coin: coinSounds,
        collected: e.game.collected - coins0,
        triggers: triggers0 - e.physics.counts().triggers,
        sparkle,
        hurt: (a.hurt ?? 0) - (before.hurt ?? 0),
      };
    });
    check(more.skid && more.skidSound >= 1 && more.skidDust >= 1, `skid sound + skid dust (${more.skidSound}, ${more.skidDust})`);
    check(more.step >= 2 && more.punch >= 1, `footsteps (${more.step}) and punch (${more.punch}) sounds`);
    check(more.collected === 1 && more.coin === 1 && more.triggers === 1 && more.sparkle >= 5, `coin trigger: collected once, coin sound, sparkle (${more.sparkle}), trigger removed`);
    check(more.hurt === 1, 'falling off the island plays hurt');

    // ---------------------------------------------------------------- gamepad
    const pad = await E(async () => {
      const e = window.__PIXEL_ENGINE__;
      const T = window.__T;
      await T.place([0, 0, 4]);
      const fake = { connected: true, mapping: 'standard', axes: [1, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      const real = navigator.getGamepads;
      navigator.getGamepads = () => [fake];
      const x0 = e.game.hero.feet.toArray();
      await T.frames(40);
      const x1 = e.game.hero.feet.toArray();
      fake.axes = [0.1, 0.1, 0, 0]; // inside the deadzone
      await T.frames(30);
      const axisRest = e.input.moveAxis();
      const jumps = e.game.hero.stats.jumps;
      fake.buttons[0] = { pressed: true, value: 1 };
      await T.frames(3);
      fake.buttons[0] = { pressed: false, value: 0 };
      await T.frames(3);
      const r = { moved: Math.hypot(x1[0] - x0[0], x1[2] - x0[2]), jumped: e.game.hero.stats.jumps - jumps, axisRest, connected: e.input.gamepadConnected };
      navigator.getGamepads = real;
      await T.frames(60);
      return r;
    });
    check(pad.connected && pad.moved > 1, `gamepad left stick moves the hero (${pad.moved.toFixed(2)})`);
    check(pad.axisRest.x === 0 && pad.axisRest.y === 0, 'stick deadzone reads as centred');
    check(pad.jumped === 1, 'gamepad A jumps');

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
      let objects = 0;
      e.scene.traverse(() => objects++);
      const mem = e.renderer.renderer.info.memory;
      return { game: e.game.name, ...e.physics.counts(), children: e.scene.children.length, objects, geometries: mem.geometries, textures: mem.textures };
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
      check(same && first.game.length > 0, `${name} ×${seen[name].length}: counts return to baseline ${JSON.stringify(first)}${same ? '' : ' → ' + JSON.stringify(rest)}`);
    }
    check(seen.playground[0].controllers === 1 && seen.playground[0].triggers > 0, 'baseline holds exactly one character controller and the coin triggers');

    // Sandbox: textured floor + vertex-colored pillar through toonify.
    await load('sandbox');
    await E(async () => {
      await window.__PIXEL_ENGINE__.setCamera({ preset: 'iso', zoom: 1.6 });
      window.__PIXEL_ENGINE__.paused = true;
    });
    await waitFrames(page, 5);
    const textured = await freshCapture(page, `systems-${tag}-sandbox.png`);
    const tex = await E(() => {
      const f = window.__PIXEL_ENGINE__.game.floor;
      const m = f.material[2]; // the top face
      window.__floorMat = m;
      return { map: !!m.map, nearest: m.map?.magFilter === 1003 && m.map?.minFilter === 1003, toon: m.isMeshToonNodeMaterial === true };
    });
    check(tex.map && tex.nearest && tex.toon, 'toonify kept the floor texture, nearest-filtered, on a toon material');
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
      e.paused = false;
    });
    await waitFrames(page, 3);
    checkClean(await state(page), logs);

    // dispose(): everything goes, nothing throws.
    const disposed = await E(() => {
      const e = window.__PIXEL_ENGINE__;
      e.dispose();
      return { canvases: document.querySelectorAll('canvas').length, debug: !!document.querySelector('.debug-ui'), counts: (() => { try { return e.physics.counts(); } catch { return 'freed'; } })() };
    });
    check(disposed.canvases === 0 && !disposed.debug, `engine.dispose() removes canvases and UI (${JSON.stringify(disposed)})`);
    await page.waitForTimeout(300);
    check(logs.length === 0, `no errors after dispose${logs.length ? ': ' + logs.join(' | ') : ''}`);
  } catch (e) {
    check(false, `systems crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
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
