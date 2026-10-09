/* global window */
// e2e suite "world": Engine World (src/world, ?game=world), the engine's tech demo, on WebGPU
// and the WebGL 2 fallback, driven frame-exactly through window.__WORLD__ and Engine.step():
//
//   atrium       a door for every room; the hero walks into one: an iris closes on them (no
//                frame-rate dependent waits), the room loads as its own Game, the iris opens
//   every room   loads, renders (frame has content), its first pad works, no errors
//   leaks        back in the Atrium after every room: the same physics and scene counts
//   feel         a hit: hitstop freezes game time while shake and the flash run on real time;
//                the game speed knob slows game time to 0.25x
//   transitions  a mosaic covers the frame (ink), reveals it again
//   panels       the station guide, the tweak panel and the room list open and close
//
// Frames land in .scratch/e2e/world-*.png. Self-contained: e2e.mjs passes its helpers in.

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, checkClean, colorCount }
 */
export async function runWorld(h) {
  const { exe, scenario: s, openPage, check, capture, checkClean, colorCount } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ world (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=world&debug=0');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__WORLD__ && window.__WORLD__.state().room === 'atrium', null, { timeout: 60000 });
    const W = (fn, arg) => page.evaluate(fn, arg);
    const rooms = await W(() => window.__WORLD__.rooms());
    const doors = await W(() => window.__WORLD__.room.doors());
    check(rooms[0].id === 'atrium' && rooms.length >= 10, `${rooms.length} rooms, the Atrium first`);
    check(doors.length === rooms.length - 1 && rooms.slice(1).every((r) => doors.some((d) => d.id === r.id)), `the Atrium has a door for every room (${doors.length})`);
    await W(() => window.__PIXEL_ENGINE__.step(30));
    const atriumShot = await capture(page, `world-${tag}-atrium.png`);
    check(colorCount(atriumShot) > 30, `the Atrium renders (${colorCount(atriumShot)} colours)`);
    const base = await W(() => ({ physics: window.__PIXEL_ENGINE__.physics.counts(), children: window.__PIXEL_ENGINE__.scene.children.length }));

    // ------------------------------------------------------------- walk through a door
    const walk = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const d = w.room.doors().find((x) => x.id === 'feel');
      e.game.visitor.teleport([d.at[0] - Math.sin(d.facing) * 1.5, 0, d.at[2] - Math.cos(d.facing) * 1.5], d.facing);
      e.step(5);
      // movement is camera-relative: push the stick toward the door in the camera's ground basis
      const { right, forward } = e.camera.groundBasis();
      const dx = Math.sin(d.facing);
      const dz = Math.cos(d.facing);
      e.input.analog.x = dx * right.x + dz * right.z;
      e.input.analog.y = dx * forward.x + dz * forward.z;
      let covered = 0;
      for (let i = 0; i < 240 && !w.state().busy; i++) e.step(1);
      const busy = w.state().busy;
      for (let i = 0; i < 30; i++) {
        e.step(1);
        covered = Math.max(covered, e.screen.state().progress);
      }
      e.input.analog.x = e.input.analog.y = 0;
      return { busy, covered, kind: e.screen.state().transition };
    });
    check(walk.busy && walk.covered > 0.3 && walk.kind === 'iris', `walking into the Game Feel Lab door starts an iris (progress ${walk.covered})`);
    const arrived = await page
      .waitForFunction(
        () => {
          const w = window.__WORLD__;
          window.__PIXEL_ENGINE__.step(2);
          return w.state().room === 'feel' && !w.state().busy;
        },
        null,
        { timeout: 90000, polling: 30 },
      )
      .then(() => true, () => false);
    const inFeel = await W(() => ({ game: window.__PIXEL_ENGINE__.game.name, screen: window.__PIXEL_ENGINE__.screen.state() }));
    check(arrived && inFeel.game === 'Engine World: Game Feel Lab' && inFeel.screen.progress === 0, `the room loads as its own Game and the iris opens (${inFeel.game})`);

    // ------------------------------------------------------------- feel: hitstop, shake, flash, speed
    const feel = await W(() => {
      const e = window.__PIXEL_ENGINE__;
      e.step(10);
      const t0 = e.time;
      window.__WORLD__.room.hit();
      const after = { hitstop: e.state().hitstop, trauma: e.shake.trauma, flash: e.screen.state().flash };
      e.step(3); // 0.05 s: inside the 0.09 s hitstop
      const frozen = e.time - t0;
      e.step(30);
      const resumed = e.time - t0;
      window.__WORLD__.knob('engine-speed', 0.25);
      const t1 = e.time;
      e.step(60);
      const slow = e.time - t1;
      window.__WORLD__.knob('engine-speed', 1);
      return { ...after, frozen, resumed, slow, hits: window.__WORLD__.room.hits() };
    });
    check(feel.hitstop > 0.05 && feel.trauma > 0.3 && feel.flash > 0, `a hit: hitstop ${feel.hitstop}s, trauma ${feel.trauma.toFixed(2)}, flash ${feel.flash}`);
    check(feel.frozen === 0 && feel.resumed > 0.3, `game time stops during the hitstop and resumes (${feel.frozen.toFixed(3)} → ${feel.resumed.toFixed(3)} s)`);
    check(Math.abs(feel.slow - 0.25) < 0.01, `game speed 0.25x: 60 frames are ${feel.slow.toFixed(3)} s of game time`);
    await capture(page, `world-${tag}-feel.png`);

    // ------------------------------------------------------------- panels
    const panels = await W(() => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const got = [];
      for (const p of ['guide', 'tweak', 'rooms', 'pause', 'glossary']) {
        got.push(w.open(p));
        e.step(4);
        w.close();
      }
      const guide = w.guide('feel');
      return { got, guideLines: guide.length, headings: guide.filter((l) => l.startsWith('## ')).length, speed: e.timeScale };
    });
    check(panels.got.join() === 'guide,tweak,rooms,pause,glossary', `panels open: ${panels.got.join(', ')}`);
    check(panels.headings >= 8 && panels.guideLines > 30, `the station guide has ${panels.headings} sections, ${panels.guideLines} lines`);
    check(panels.speed === 1, 'closing the room list and the menu thaws the game');

    // ------------------------------------------------------------- every room
    const bad = [];
    for (const r of rooms) {
      const res = await W(async (id) => {
        const w = window.__WORLD__;
        const e = window.__PIXEL_ENGINE__;
        await w.goto(id, { instant: true });
        e.step(20);
        const pads = w.state().pads;
        const stepped = pads.length ? w.pad(pads[0].label) : true;
        e.step(10);
        const ids = w.knobs().map((k) => k.id);
        return { room: w.state().room, pads: pads.length, stepped, errors: e.state().errors, labels: w.state().labels, knobsUnique: new Set(ids).size === ids.length };
      }, r.id);
      const shot = await capture(page, `world-${tag}-${r.id}.png`);
      const colours = colorCount(shot);
      if (res.room !== r.id || !res.stepped || !res.knobsUnique || res.errors.length || colours < 12) bad.push(`${r.id}: room ${res.room}, pad ${res.stepped}, unique knobs ${res.knobsUnique}, ${colours} colours, ${res.errors.join('; ')}`);
    }
    check(bad.length === 0, `every room loads, renders and its first pad works${bad.length ? ':\n    ' + bad.join('\n    ') : ` (${rooms.length})`}`);

    // ------------------------------------------------------------- lights: the sun dial moves the sun
    const sun = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      await w.goto('lights', { instant: true });
      w.pad('DAWN');
      e.step(5);
      const dawn = e.sunDir.toArray();
      w.pad('NOON');
      e.step(5);
      return { dawn, noon: e.sunDir.toArray(), stats: e.lights.stats() };
    });
    check(sun.dawn[0] > 0.8 && sun.noon[1] > 0.8, `the sun dial points the sun (dawn x ${sun.dawn[0].toFixed(2)}, noon y ${sun.noon[1].toFixed(2)})`);
    check(sun.stats.lit === sun.stats.size, `the light pool lends all ${sun.stats.size} lights (${sun.stats.requests} requests)`);
    await capture(page, `world-${tag}-noon.png`);

    // ------------------------------------------------------------- transitions room: a mosaic
    const mosaic = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      await w.goto('transitions', { instant: true });
      e.step(10);
      void e.screen.cover('mosaic', { duration: 0.2 });
      e.step(20);
      return e.screen.state();
    });
    const covered = await capture(page, `world-${tag}-mosaic.png`);
    check(mosaic.progress === 1 && colorCount(covered) <= 3, `a mosaic covers the frame (${colorCount(covered)} colours)`);
    await W(async () => {
      const e = window.__PIXEL_ENGINE__;
      void e.screen.reveal('mosaic', { duration: 0.2 });
      e.step(20);
    });
    const revealed = await capture(page, `world-${tag}-revealed.png`);
    check(colorCount(revealed) > 20, `and reveals it again (${colorCount(revealed)} colours)`);

    // ------------------------------------------------------------- leaks: back to the Atrium
    const back = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      await w.goto('lights', { instant: true });
      e.step(5);
      await w.goto('atrium', { instant: true });
      e.step(5);
      const hero = w.state().hero.at;
      const door = w.room.doors().find((d) => d.id === 'lights').at;
      return { physics: e.physics.counts(), children: e.scene.children.length, near: Math.hypot(hero[0] - door[0], hero[2] - door[2]) };
    });
    check(JSON.stringify(back.physics) === JSON.stringify(base.physics), `after every room the Atrium has the same physics (${JSON.stringify(back.physics)})`);
    check(back.children === base.children, `and the same scene objects (${back.children})`);
    check(back.near < 3, `arriving from a room puts the hero in front of its door (${back.near.toFixed(2)} m)`);
    const st = await W(() => window.__PIXEL_ENGINE__.state());
    check(st.errors.length === 0, `no game errors${st.errors.length ? ': ' + st.errors.join('; ') : ''}`);
    checkClean(st, logs);
  } catch (e) {
    check(false, `world (${s.name}) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}
