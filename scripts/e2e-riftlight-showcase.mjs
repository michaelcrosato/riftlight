/* global window, document, Image, location */
// e2e suite "riftlight-showcase": the showcase pieces inside Riftlight (src/riftlight/showcase),
// on WebGPU and the WebGL 2 fallback, driven frame-exactly through window.__RIFTLIGHT__:
//
//   arcade    walk to the cabinet in Emberfall and use it (the swoop + iris, no loadGame), the
//             `side` camera and the 16-bit + CRT look; the scripted run (jumps, a double jump, a
//             wall kick, a ground pound through the cracked floor) reaches the flag; best time and
//             gold land in the save; Esc walks back out with camera, filters and physics as before.
//   bestiary  kill level 1's monsters, open the Hall of Beasts: first person, exhibits rebuilt
//             from their genomes (the boss too), inspect (orbit camera, a clip plays), breed two
//             species at the altar (crossover + mutate), fly with the free camera, leave.
//   photo     O in town: free camera; a gameboy look captured as a PNG (the frame holds only the
//             palette's shades), raw mode, time of day; Esc restores everything.
//
// Frames land in .scratch/e2e/showcase-*.png. Self-contained: e2e.mjs passes its helpers in.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, checkClean, colorCount }
 */
export async function runRiftlightShowcase(h) {
  const { exe, scenario: s, openPage, check, capture, state, checkClean, colorCount } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight-showcase (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=777&save=memory');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.newRun({ slot: 0, seed: 777 });
      rl.setTimeOfDay(0.3);
      window.__PIXEL_ENGINE__.step(20);
    });
    const ids = await R(() => window.__RIFTLIGHT__.game.town.interactables.map((i) => i.id));
    check(ids.includes('arcade') && ids.includes('bestiary'), `Emberfall has the arcade cabinet and the Hall of Beasts (${ids.join(',')})`);
    const physics0 = await R(() => window.__PIXEL_ENGINE__.physics.counts());

    // ---------------------------------------------------------------- arcade: the player's way in
    const walk = await R(() => window.__RIFTLIGHT__.talkTo('arcade'));
    check(walk.ok, 'walk to the cabinet and use it (F)');
    await R(() => window.__PIXEL_ENGINE__.step(20));
    const swoop = await R(() => ({ iris: !!window.__RIFTLIGHT__.game.showcase.iris, zoom: window.__PIXEL_ENGINE__.camera.zoom }));
    check(swoop.iris && swoop.zoom > 1.6, `the camera swoops into the screen behind an iris (zoom ${swoop.zoom.toFixed(2)})`);
    await capture(page, `showcase-${tag}-swoop.png`);
    const inside = await page
      .waitForFunction(
        () => {
          window.__PIXEL_ENGINE__.step(5);
          const a = window.__RIFTLIGHT__.arcade.state();
          return a.active && !window.__RIFTLIGHT__.game.showcase.iris && a.phase;
        },
        null,
        { timeout: 60000, polling: 50 },
      )
      .then(() => true, () => false);
    let a = await R(() => window.__RIFTLIGHT__.arcade.state());
    check(inside && a.camera === 'side', `inside the cabinet: the side camera (${a.camera})`);
    check(a.filters.join() === '16bit,crt', `the 16-bit + CRT look (${a.filters.join(',')})`);
    check((await R(() => window.__RIFTLIGHT__.state().screen)) === 'town' && (await R(() => window.__PIXEL_ENGINE__.game.name)) === 'Riftlight', 'no loadGame: still the Riftlight game, the town kept');
    await R(() => window.__PIXEL_ENGINE__.step(80));
    const arcadeShot = await capture(page, `showcase-${tag}-arcade.png`);
    check(colorCount(arcadeShot) > 12, `the stage renders (${colorCount(arcadeShot)} colours)`);
    const gold0 = await R(() => window.__RIFTLIGHT__.state().hero.gold);
    const moves = await R(() => {
      const st = window.__RIFTLIGHT__.game.showcase.arcade.stage;
      const seen = new Set();
      const kinds = new Set();
      const orig = st.fixedUpdate.bind(st);
      st.fixedUpdate = (dt, input) => {
        orig(dt, input);
        const hh = st.hero?.hero;
        if (hh) {
          seen.add(hh.state);
          if (hh.state === 'jump') kinds.add(hh.jumpKind);
        }
      };
      window.__ARCADE_SEEN__ = { seen, kinds };
      return true;
    });
    a = await R(() => window.__RIFTLIGHT__.arcade.autoplay({ maxFrames: 60 * 60 }));
    const seen = await R(() => ({ states: [...window.__ARCADE_SEEN__.seen], jumps: [...window.__ARCADE_SEEN__.kinds] }));
    check(moves && a.phase === 'done' && a.result, `the scripted run reaches the flag (${a.time}s, ${a.frames} frames, ${a.coins}/${a.total} coins)`);
    check(seen.jumps.includes('DoubleJump') && seen.jumps.includes('WallKick'), `with the platformer moveset: ${seen.jumps.join(', ')}`);
    check(a.broken && seen.states.includes('groundPound'), 'a ground pound broke the cracked floor');
    check(a.coins > 10, `coins collected by trigger volumes (${a.coins})`);
    const gold1 = await R(() => window.__RIFTLIGHT__.state().hero.gold);
    check(a.record.best > 0 && Math.abs(a.record.best - a.time) < 0.01 && a.result.newBest, `best time kept (${a.record.best}s)`);
    check(gold1 - gold0 === a.result.reward && a.result.reward > 0, `a small gold reward (+${a.result.reward}: ${gold0} → ${gold1})`);
    const saved = await R(() => JSON.parse(window.__RIFTLIGHT__.exportSave(0)).data.showcase?.arcade?.best ?? 0);
    check(Math.abs(saved - a.record.best) < 0.01, `the best time is in the save slot (${saved})`);
    await capture(page, `showcase-${tag}-arcade-done.png`);
    // Esc, the player's way out
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => {
      for (let i = 0; i < 120 && window.__RIFTLIGHT__.game.showcase.active; i++) window.__PIXEL_ENGINE__.step(1);
    });
    const out = await R(() => ({ active: window.__RIFTLIGHT__.game.showcase.active, cam: window.__PIXEL_ENGINE__.camera.preset, filters: [...window.__PIXEL_ENGINE__.filters], physics: window.__PIXEL_ENGINE__.physics.counts(), url: location.search, hero: window.__RIFTLIGHT__.game.hero.object.visible }));
    check(!out.active && out.cam === 'iso' && out.filters.length === 0 && out.hero, `Esc walks back to town: iso camera, no filters (${out.cam}, [${out.filters.join(',')}])`);
    check(JSON.stringify(out.physics) === JSON.stringify(physics0), `the stage left nothing in the physics world (${JSON.stringify(out.physics)})`);
    check(!/camera=|cam=/.test(out.url), `the URL keeps the game's own camera (${out.url})`);

    // ---------------------------------------------------------------- bestiary
    await R(async () => {
      const rl = window.__RIFTLIGHT__;
      await rl.enterDepth(1);
      window.__PIXEL_ENGINE__.step(5);
      rl.killAll();
      window.__PIXEL_ENGINE__.step(5);
      rl.toTown();
      window.__PIXEL_ENGINE__.step(5);
    });
    const entries = await R(() => window.__RIFTLIGHT__.bestiary.entries());
    check(entries.length >= 3 && entries[0].rank === 'boss', `the kills are in the bestiary (${entries.length} species, first: ${entries[0]?.name})`);
    let b = await R(() => window.__RIFTLIGHT__.bestiary.open());
    check(b.active && b.camera === 'first', `the Hall of Beasts in first person (${b.camera})`);
    check(b.exhibits.length === Math.min(10, entries.length) && b.exhibits.every((e) => e.meshes > 3), `every exhibit is rebuilt from its genome (${b.exhibits.length} on pedestals, ${b.exhibits.map((e) => e.meshes).join('/')} meshes)`);
    check(b.exhibits[0].name === entries[0].name, `the boss stands first (${b.exhibits[0].name})`);
    await R(() => window.__PIXEL_ENGINE__.step(30));
    const hall = await capture(page, `showcase-${tag}-hall.png`);
    check(colorCount(hall) > 16, `the hall renders (${colorCount(hall)} colours)`);
    const lights = await R(() => window.__PIXEL_ENGINE__.lights.stats());
    check(lights.lit > 0 && lights.requests >= b.exhibits.length, `exhibits lit by the light pool (${lights.lit} lit of ${lights.requests} requests)`);
    // walking: the visitor moves in first person
    const walked = await R(() => {
      const before = window.__RIFTLIGHT__.bestiary.state().hero[2];
      const e = window.__PIXEL_ENGINE__;
      e.input.setKey('KeyW', true);
      e.step(40);
      e.input.setKey('KeyW', false);
      e.step(2);
      return { before, after: window.__RIFTLIGHT__.bestiary.state().hero[2] };
    });
    check(walked.after < walked.before - 1, `W walks down the aisle (z ${walked.before} → ${walked.after})`);
    b = await R(() => window.__RIFTLIGHT__.bestiary.inspect(0));
    check(b.view === 'inspect' && b.focus === entries[0].name && b.camera === 'fixed', `inspect: the orbit camera and the card (${b.focus}, ${b.camera})`);
    const clip = b.exhibits[0].clips.includes('Death') ? 'Death' : b.exhibits[0].clips.at(-1);
    const played = await R((c) => window.__RIFTLIGHT__.bestiary.play(c), clip);
    check(played.ok && played.state.exhibits[0].clip === clip, `a clip button plays ${clip}`);
    await R(() => window.__PIXEL_ENGINE__.step(12));
    await capture(page, `showcase-${tag}-inspect.png`);
    b = await R(() => window.__RIFTLIGHT__.bestiary.breed(0, 1));
    check(!!b.child && b.child.generation === 1 && b.child.parts > 0, `the Rift Altar breeds two kills (${b.child?.plan} ${b.child?.archetype}, seed ${b.child?.seed})`);
    const child1 = b.child.seed;
    b = await R(() => window.__RIFTLIGHT__.bestiary.mutate());
    check(b.child.generation === 2 && b.child.seed !== child1, `and mutates the child (generation ${b.child.generation})`);
    await R(() => window.__PIXEL_ENGINE__.step(40));
    await capture(page, `showcase-${tag}-breed.png`);
    b = await R(() => window.__RIFTLIGHT__.bestiary.view('fly'));
    check(b.camera === 'free', `Tab flies with the free camera (${b.camera})`);
    b = await R(() => window.__RIFTLIGHT__.bestiary.close());
    const back = await R(() => ({ cam: window.__PIXEL_ENGINE__.camera.preset, active: window.__RIFTLIGHT__.game.showcase.active, physics: window.__PIXEL_ENGINE__.physics.counts() }));
    check(!back.active && back.cam === 'iso' && JSON.stringify(back.physics) === JSON.stringify(physics0), `out of the hall: iso camera, physics as before (${JSON.stringify(back.physics)})`);

    // ---------------------------------------------------------------- photo mode
    await R(() => {
      window.__PIXEL_ENGINE__.step(30);
      window.__RIFTLIGHT__.press('KeyO');
    });
    let p = await R(() => window.__RIFTLIGHT__.photo.state());
    check(p.active && p.camera === 'free', `O opens photo mode with the free camera (${p.camera})`);
    const plain = await capture(page, `showcase-${tag}-photo-plain.png`);
    p = (await R(() => window.__RIFTLIGHT__.photo.setLook('gameboy'))).state;
    check(p.filters.join() === 'gameboy', `cycle to a palette (${p.filters.join(',')}, ${p.looks} looks in the list)`);
    const shot = await R(async () => {
      const c = await window.__RIFTLIGHT__.photo.capture({ download: false });
      const img = new Image();
      img.src = c.dataUrl;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const colours = new Set();
      for (let i = 0; i < d.length; i += 4) colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return { w: c.width, h: c.height, png: c.dataUrl.startsWith('data:image/png;base64,'), colours: colours.size, last: window.__RIFTLIGHT__.photo.state().last };
    });
    check(shot.png && shot.w > 0 && shot.h > 0, `P saves a PNG (${shot.w}x${shot.h}, ${shot.last?.bytes} bytes, ${shot.last?.name})`);
    check(shot.colours <= 4 && colorCount(plain) > 16, `the PNG has the filter applied: ${shot.colours} gameboy shades (plain frame ${colorCount(plain)} colours)`);
    await capture(page, `showcase-${tag}-photo-gameboy.png`);
    p = await R(() => window.__RIFTLIGHT__.photo.setMode('raw'));
    check(p.mode === 'raw', 'raw render mode from photo mode');
    p = await R(() => window.__RIFTLIGHT__.photo.setTime(0.62));
    check(Math.abs(p.timeOfDay - 0.62) < 1e-6, 'time of day set to night');
    await R(() => window.__RIFTLIGHT__.photo.setMode('pixel'));
    await R(() => window.__RIFTLIGHT__.photo.setLook('dream'));
    await capture(page, `showcase-${tag}-photo-night.png`);
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    p = await R(() => window.__RIFTLIGHT__.photo.state());
    check(!p.active && p.camera === 'iso' && p.filters.length === 0 && p.mode === 'pixel' && Math.abs(p.timeOfDay - 0.3) < 0.01, `Esc restores camera, filters, mode and time (${p.camera}, [${p.filters.join(',')}], ${p.mode}, ${p.timeOfDay.toFixed(2)})`);
    checkClean(await state(page), logs);
  } catch (e) {
    check(false, `riftlight-showcase crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
