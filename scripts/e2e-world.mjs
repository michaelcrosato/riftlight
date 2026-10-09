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
//   physics      a blast topples the tower, instanced bodies fall asleep, the bridge sags and
//                hangs when cut, sheets drape, the lift carries the hero, a wall shatters into
//                pieces that dissolve, the well gathers bodies, a launch pad throws the hero
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

    // ------------------------------------------------------------- physics wing
    const phys = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // rigid bodies: a blast knocks the tower down; a stress fill settles and falls asleep
      await w.goto('bodies', { instant: true });
      e.step(30);
      const before = w.room.standing();
      w.room.blast();
      e.step(90);
      w.room.fill(100);
      e.step(400);
      out.bodies = { before, after: w.room.standing(), stress: w.room.stress() };
      // joints: the wrecking ball knocks crates over; a cut bridge hangs down
      await w.goto('joints', { instant: true });
      e.step(30);
      const sag = Math.min(...w.room.bridge());
      w.room.swing();
      e.step(90);
      w.room.cut();
      e.step(150);
      out.joints = { sag, standing: w.room.standing(), hanging: Math.min(...w.room.bridge()) };
      // soft bodies: sheets drape over the table and the ball; released flags fall
      await w.goto('soft', { instant: true });
      w.room.drop();
      w.room.release();
      e.step(200);
      out.soft = { sheets: w.room.sheets().map((c) => c[1]), flags: w.room.flags().map((f) => f[1]), particles: w.room.particles() };
      // platforms: the lift carries the hero up
      await w.goto('platforms', { instant: true });
      w.room.restartLift(); // at the bottom, waiting 1.5 s: the same ride whatever ran before
      e.step(2);
      const lift = w.room.lift();
      e.game.visitor.teleport([10, lift + 0.3, -8.5], 0);
      e.step(10);
      const on = w.room.standingOn();
      let top = 0;
      for (let i = 0; i < 360; i++) {
        e.step(1);
        top = Math.max(top, w.state().hero.at[1]);
      }
      out.platforms = { on, top };
      // destruction: a wall shatters into its pieces, which dissolve away
      await w.goto('destruction', { instant: true });
      e.step(10);
      w.room.punch(1);
      e.step(5);
      const chunks = w.room.chunks();
      e.step(330);
      out.destruction = { chunks, later: w.room.chunks(), broken: w.room.broken() };
      // fields: the well gathers the crates and balls; a launch pad throws the hero up
      await w.goto('fields', { instant: true });
      e.step(240);
      const gathered = w.room.gathered();
      e.game.visitor.teleport([4, 0, 2.2], 0);
      const { right, forward } = e.camera.groundBasis();
      e.input.analog.x = right.z;
      e.input.analog.y = forward.z;
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        e.step(1);
        if (i === 25) e.input.analog.x = e.input.analog.y = 0;
        peak = Math.max(peak, w.state().hero.at[1]);
      }
      e.input.analog.x = e.input.analog.y = 0;
      out.fields = { gathered, launches: w.room.launches(), peak };
      out.errors = e.state().errors;
      return out;
    });
    check(phys.bodies.after < phys.bodies.before - 4, `rigid bodies: a blast knocks the tower down (${phys.bodies.before} → ${phys.bodies.after} crates standing)`);
    check(phys.bodies.stress.bodies === 100 && phys.bodies.stress.asleep >= 30, `100 instanced bodies rain in and fall asleep (${phys.bodies.stress.asleep} asleep, step ${phys.bodies.stress.stepMs.toFixed(2)} ms)`);
    check(phys.joints.sag < -0.15 && phys.joints.standing < 9 && phys.joints.hanging < -3, `joints: the bridge sags (${phys.joints.sag.toFixed(2)}), the wrecking ball knocks crates over (${phys.joints.standing} of 9 left), a cut bridge hangs (${phys.joints.hanging.toFixed(2)})`);
    check(phys.soft.sheets.every((y) => y > 0.3 && y < 1.6) && phys.soft.flags.every((y) => y < 0.5), `soft bodies: sheets drape (${phys.soft.sheets.map((y) => y.toFixed(2))}), released flags fall (${phys.soft.flags.map((y) => y.toFixed(2))}), ${phys.soft.particles} particles`);
    check(phys.platforms.on === 'lift' && phys.platforms.top > 4.5, `platforms: the hero rides the lift up (${phys.platforms.on}, top ${phys.platforms.top.toFixed(2)} m)`);
    check(phys.destruction.chunks === 12 && phys.destruction.later === 0 && phys.destruction.broken === 1, `destruction: a wall breaks into 12 pieces that dissolve away (${phys.destruction.chunks} → ${phys.destruction.later})`);
    // HOP 12: 12² / (2 × 32) = 2.25 m
    check(phys.fields.gathered >= 6 && phys.fields.launches >= 1 && phys.fields.peak > 1.9, `fields: the well gathers ${phys.fields.gathered} bodies, a launch pad throws the hero ${phys.fields.peak.toFixed(2)} m up`);
    check(phys.errors.length === 0, `the physics wing runs without errors${phys.errors.length ? ': ' + phys.errors.join('; ') : ''}`);
    await capture(page, `world-${tag}-fields.png`);

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
