/* global window, requestAnimationFrame */
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
//   effects      floaters sit in the water and the anchor sinks, wading ripples, lamps at night,
//                settling snow, a storm's lightning, a meadow of blades, footprints and decals
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
      // a pile sleeps as one island once every body in it has been still for 2 s, so the count
      // jumps from a few to most at a moment the rooms visited before decide (step 140 to 330
      // and beyond, measured): wait for it, up to 15 s
      for (let i = 0; i < 900 && (i < 400 || w.room.stress().asleep < 30); i++) e.step(1);
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

    // ------------------------------------------------------------- effects wing
    const fx = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // water: floaters sit in the water, the anchor sinks, wading makes ripples
      await w.goto('water', { instant: true });
      e.step(240);
      const sub = w.room.submerged();
      e.game.visitor.teleport([0, -0.9, -5], 0);
      const { right, forward } = e.camera.groundBasis();
      e.input.analog.x = right.x;
      e.input.analog.y = forward.x;
      e.step(60);
      e.input.analog.x = e.input.analog.y = 0;
      out.water = { crates: sub.crates, raft: sub.raft, anchor: sub.anchor, wades: w.room.wades(), ripples: w.room.ripples() };
      // weather: night lights the lamps; snow settles; a storm flashes
      await w.goto('weather', { instant: true });
      w.room.time(22.5);
      w.room.weather('snow');
      e.step(240);
      const night = w.room.state();
      w.room.time(12);
      w.room.weather('storm');
      e.step(480);
      out.weather = { lamps: night.lamps, snow: night.snow, noonSun: w.room.state().sun, bolts: w.room.state().bolts, wet: w.room.state().wet };
      // foliage: blades placed; the ball rolls
      await w.goto('foliage', { instant: true });
      e.step(20);
      out.foliage = { blades: w.room.blades(), flowers: w.room.flowers() };
      // trails: a bomb leaves marks; walking leaves footprints; the comet has a tail
      await w.goto('trails', { instant: true });
      e.step(10);
      w.room.bomb();
      e.game.visitor.teleport([-3, 0, 6], 0);
      const b2 = e.camera.groundBasis();
      e.input.analog.x = b2.right.x;
      e.input.analog.y = b2.forward.x;
      e.step(90);
      e.input.analog.x = e.input.analog.y = 0;
      out.trails = { marks: w.room.marks(), prints: w.room.prints(), comet: w.room.comet() };
      out.errors = e.state().errors;
      return out;
    });
    check(fx.water.crates.every((d) => d > 0.2 && d < 0.8) && fx.water.raft > 0.1 && fx.water.raft < 0.7 && fx.water.anchor < -0.5, `water: crates float (${fx.water.crates.map((d) => d.toFixed(2))}), the raft too (${fx.water.raft.toFixed(2)}), the anchor sinks (${fx.water.anchor.toFixed(2)})`);
    check(fx.water.wades > 3 && fx.water.ripples > 0.5, `wading makes ripples (${fx.water.wades} splashes, energy ${fx.water.ripples.toFixed(2)})`);
    check(fx.weather.lamps.every((i) => i > 5) && fx.weather.snow > 0.15 && fx.weather.noonSun > 2.5 && fx.weather.bolts >= 1 && fx.weather.wet > 0.5, `weather: lamps lit at night, snow settles (${fx.weather.snow.toFixed(2)}), a storm flashes (${fx.weather.bolts} bolts) and wets the ground`);
    check(fx.foliage.blades > 5000 && fx.foliage.flowers > 100, `grass: ${fx.foliage.blades} blades and ${fx.foliage.flowers} flowers`);
    check(fx.trails.marks >= 2 && fx.trails.prints >= 2 && fx.trails.comet > 10, `trails: a bomb leaves marks, walking leaves ${fx.trails.prints} footprints, the comet has a ${fx.trails.comet}-point tail`);
    check(fx.errors.length === 0, `the effects wing runs without errors${fx.errors.length ? ': ' + fx.errors.join('; ') : ''}`);
    await capture(page, `world-${tag}-trails.png`);

    // ------------------------------------------------------------- animation wing
    const anim = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // secondary motion: the scarf trails a running hero; slimes squash only while SQUASH is on
      await w.goto('secondary', { instant: true });
      e.step(60);
      const idle = w.room.swing(); // gravity sags the scarf a little even standing still
      const { right, forward } = e.camera.groundBasis();
      e.input.analog.x = right.x;
      e.input.analog.y = forward.x;
      e.step(40);
      const running = w.room.swing();
      e.input.analog.x = e.input.analog.y = 0;
      let squashOn = 0;
      for (let i = 0; i < 120; i++) {
        e.step(1);
        squashOn = Math.max(squashOn, ...w.room.squash().map(Math.abs));
      }
      w.pad('SQUASH');
      e.step(120);
      let squashOff = 0;
      for (let i = 0; i < 120; i++) {
        e.step(1);
        squashOff = Math.max(squashOff, ...w.room.squash().map(Math.abs));
      }
      out.secondary = { idle, running, still: w.room.swing(), squashOn, squashOff, landings: w.room.landings() };
      // procedural legs: the walker follows the hero up the steps; planted feet never slide
      await w.goto('legs', { instant: true });
      e.step(10);
      const steps0 = w.room.steps()[0];
      e.game.visitor.teleport([-2.5, 1.4, -6.5], Math.PI);
      e.step(300);
      const [wx, wy, wz] = w.room.walker();
      const hero = w.state().hero.at;
      out.legs = { steps: w.room.steps()[0] - steps0, others: w.room.steps().slice(1), far: Math.hypot(wx - hero[0], wz - hero[2]), height: wy, slide: w.room.slide() };
      // sprites: a crowd is one draw per sheet; walking flips their frames
      await w.goto('sprites', { instant: true });
      e.step(10);
      const draws = w.room.draws();
      const seen = new Set();
      for (let i = 0; i < 60; i++) {
        e.step(1);
        for (const f of w.room.frames()) seen.add(f);
      }
      // mirrored sprites draw as many pixels as unmirrored ones (the sky-blue critters' bodies)
      const blue = async () => {
        e.step(2);
        const f = await e.renderer.capture();
        let n = 0;
        for (let i = 0; i < f.pixels.length; i += 4) if (Math.abs(f.pixels[i] - 0x41) + Math.abs(f.pixels[i + 1] - 0xa6) + Math.abs(f.pixels[i + 2] - 0xf6) < 40) n++;
        return n;
      };
      w.room.flip(false);
      const facing = await blue();
      w.room.flip(true);
      const mirrored = await blue();
      w.room.flip(undefined);
      w.pad('300 CRITTERS');
      e.step(5);
      out.sprites = { draws, frames: seen.size, crowd: w.room.critters(), facing, mirrored };
      // ragdolls: limp dummies lie down and get back up; one tumbles down the stairs; the cannon knocks one over
      await w.goto('ragdolls', { instant: true });
      e.step(10);
      w.pad('ALL LIMP');
      let n = 0;
      while (w.room.states().some((st) => st !== 'stand') && n++ < 1200) e.step(1);
      const standing = w.room.pelvis().slice(0, 3).map((p) => p[1]);
      const lay = w.room.lay().slice(0, 3);
      const ups3 = w.room.ups()[3]; // the stairs dummy may have got up once already (ALL LIMP)
      w.pad('PUSH');
      n = 0;
      while (w.room.ups()[3] === ups3 && n++ < 1200) e.step(1);
      const stairs = w.room.lay()[3];
      const before = w.room.falls().slice(0, 3).reduce((a, b) => a + b, 0);
      w.room.fire();
      e.step(90);
      const after = w.room.falls().slice(0, 3).reduce((a, b) => a + b, 0);
      out.ragdolls = { lying: lay.map((l) => l.at[1]), rested: lay.map((l) => l.rested), standing, ups: w.room.ups(), stairs, knocked: after - before };
      out.errors = e.state().errors;
      return out;
    });
    check(anim.secondary.running > anim.secondary.idle + 0.08 && anim.secondary.still < anim.secondary.running, `secondary motion: the scarf trails a running hero (${anim.secondary.running.toFixed(2)} m, ${anim.secondary.idle.toFixed(2)} standing) and settles (${anim.secondary.still.toFixed(2)})`);
    check(anim.secondary.squashOn > 0.1 && anim.secondary.squashOff < 0.02 && anim.secondary.landings >= 3, `slimes squash and stretch (${anim.secondary.squashOn.toFixed(2)}), not when it is off (${anim.secondary.squashOff.toFixed(3)})`);
    check(anim.legs.steps > 10 && anim.legs.others.every((n) => n > 3) && anim.legs.far < 4 && anim.legs.height > 1.4, `procedural legs: the walker follows the hero onto the deck (${anim.legs.steps} steps, ${anim.legs.far.toFixed(2)} m away, body at ${anim.legs.height.toFixed(2)} m), the crab and the robot walk (${anim.legs.others})`);
    check(anim.legs.slide < 1e-6, `planted feet never slide (${anim.legs.slide})`);
    check(anim.sprites.draws === 3 && anim.sprites.frames === 4 && anim.sprites.crowd === 300, `sprites: three sheets, three batches, walk frames flip (${anim.sprites.frames} seen), a crowd of ${anim.sprites.crowd}`);
    check(anim.sprites.facing > 30 && anim.sprites.mirrored > anim.sprites.facing * 0.6, `mirrored sprites draw (${anim.sprites.mirrored} px against ${anim.sprites.facing} facing right)`);
    check(anim.ragdolls.lying.every((y) => y < 0.35) && anim.ragdolls.rested.every(Boolean) && anim.ragdolls.standing.every((y) => y > 0.5) && anim.ragdolls.ups.slice(0, 3).every((n) => n === 1), `ragdolls: limp dummies lie down (pelvis ${anim.ragdolls.lying.map((y) => y.toFixed(2))}), come to rest (${anim.ragdolls.rested}) and get back up (${anim.ragdolls.standing.map((y) => y.toFixed(2))})`);
    // where on the stairs it stops is chaos; that it left the landing (2.8 m up), came down them and lay still is not
    check(anim.ragdolls.stairs.at[1] < 1.8 && anim.ragdolls.stairs.at[2] > -3.5 && anim.ragdolls.stairs.rested, `a pushed dummy tumbles down the stairs and lies still (at ${anim.ragdolls.stairs.at.map((v) => v.toFixed(1))})`);
    check(anim.ragdolls.knocked >= 1, `the cannon knocks a dummy over (${anim.ragdolls.knocked})`);
    check(anim.errors.length === 0, `the animation wing runs without errors${anim.errors.length ? ': ' + anim.errors.join('; ') : ''}`);
    await capture(page, `world-${tag}-crowd.png`);

    // ------------------------------------------------------------- genre wing
    const genres = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // stealth: unseen at the start; in front of the watch guard you are seen, chased and caught
      await w.goto('stealth', { instant: true });
      e.step(180);
      const quiet = { states: w.room.states(), alarms: w.room.alarms() };
      e.game.visitor.teleport([-0.5, 0, 0], 0);
      let n = 0;
      let onFloor = true;
      while (w.room.caught() < 1 && n++ < 900) {
        e.step(1);
        onFloor &&= w.room.onFloor();
      }
      const caught = w.room.caught();
      const alarms = w.room.alarms();
      n = 0;
      while (w.room.states().some((st) => st !== 'patrol') && n++ < 1800) {
        e.step(1);
        onFloor &&= w.room.onFloor();
      }
      const back = w.room.states();
      const hero = w.state().hero.at;
      // an alarm with the hero in the far corner: every guard comes along its path, round walls and crates
      w.room.raise();
      const before = w.room.distances();
      for (let i = 0; i < 90; i++) {
        e.step(1);
        onFloor &&= w.room.onFloor();
      }
      const closed = w.room.distances().map((d, i) => before[i] - d);
      out.stealth = { quiet, alarms, caught, onFloor, back, hero, before, closed };
      // flocks: birds and fish line up; sheep scatter from the hero
      await w.goto('flocks', { instant: true });
      e.step(240);
      // alignment swings as a flock wheels: average it over two seconds
      const order = { birds: { alignment: 0 }, fish: { alignment: 0 } };
      for (let i = 0; i < 12; i++) {
        e.step(10);
        const o = w.room.order();
        order.birds.alignment += o.birds.alignment / 12;
        order.fish.alignment += o.fish.alignment / 12;
      }
      // sheep within 2 m of the middle of the pen, before and after the hero stands there
      const near = () => w.room.sheep().filter(([x, z]) => Math.hypot(x + 8, z + 2) < 2).length;
      const calm = near();
      e.game.visitor.teleport([-8, 0, -2], 0);
      e.step(120);
      out.flocks = { birds: order.birds.alignment, fish: order.fish.alignment, calm, scared: near() };
      // drift: the car drives, steers, slides with the handbrake (skid marks), and lets the hero out
      await w.goto('drift', { instant: true });
      e.step(10);
      // the keys: W drives forward (speed > 0 is along the car's heading)
      w.room.keys();
      e.input.setKey('KeyW', true);
      e.step(60);
      e.input.setKey('KeyW', false);
      const keyed = w.room.speed();
      w.pad('FLIP BACK'); // back to the start, then a run-up and a drift in the open
      w.room.drive(1, 0);
      e.step(100);
      const speed = w.room.speed();
      w.room.drive(0.6, 1, true);
      let slip = 0;
      for (let i = 0; i < 60; i++) {
        e.step(1);
        slip = Math.max(slip, w.room.slip());
      }
      w.room.drive(0, 0);
      e.step(120);
      const out1 = w.room.getOut();
      e.step(30);
      const car = w.room.car();
      const at = w.state().hero?.at ?? [99, 99, 99];
      out.drift = { keyed, speed: Math.abs(speed), slip, marks: w.room.marks(), driving: w.room.driving(), out: out1, beside: Math.hypot(at[0] - car[0], at[2] - car[2]), feet: at[1] };
      // bullet hell: every pattern at once fills the arena; standing in it gets you hit; punches hurt the turret
      await w.goto('bullets', { instant: true });
      w.pad('ALL');
      e.step(180);
      const live = w.room.bullets();
      const hits = w.room.hits();
      w.room.patterns([]); // a ceasefire: shoot the turret in peace
      e.step(240);
      e.game.visitor.teleport([0, 0, 3], Math.PI); // facing the turret
      for (let i = 0; i < 6; i++) {
        e.input.setKey('KeyJ', true);
        e.step(2);
        e.input.setKey('KeyJ', false);
        e.step(16);
      }
      e.step(30);
      out.bullets = { live, hits, shots: w.room.shots(), hp: w.room.hp() };
      out.errors = e.state().errors;
      return out;
    });
    check(genres.stealth.quiet.alarms === 0 && genres.stealth.quiet.states.every((st) => st === 'patrol'), `stealth: the guards patrol and nobody sees you at the start (${genres.stealth.quiet.states})`);
    check(genres.stealth.alarms >= 1 && genres.stealth.caught === 1, `in front of a guard you are seen and caught (${genres.stealth.alarms} alarm)`);
    check(genres.stealth.back.every((st) => st === 'patrol') && genres.stealth.hero[0] < -10, `then the hero is back at the start and the guards back on their rounds (${genres.stealth.back})`);
    check(genres.stealth.closed.every((d) => d > 1.5), `an alarm brings every guard in along its path (from ${genres.stealth.before.map((d) => d.toFixed(1))} m, closer by ${genres.stealth.closed.map((d) => d.toFixed(1))} m in 1.5 s)`);
    check(genres.stealth.onFloor, 'no guard ever stands in a wall or a crate');
    check(genres.flocks.birds > 0.45 && genres.flocks.fish > 0.4, `flocks: birds (${genres.flocks.birds.toFixed(2)}) and fish (${genres.flocks.fish.toFixed(2)}) line up (two seconds' average)`);
    check(genres.flocks.calm >= 3 && genres.flocks.scared <= 2, `sheep scatter from the hero (${genres.flocks.calm} → ${genres.flocks.scared} within 2 m of where the hero stands)`);
    check(genres.drift.speed > 6 && genres.drift.slip > 0.4 && genres.drift.marks > 0, `drift: the car gets up to ${genres.drift.speed.toFixed(1)} m/s; the handbrake swings the tail out ${((genres.drift.slip * 180) / Math.PI).toFixed(0)}° and leaves ${genres.drift.marks} skid marks`);
    check(genres.drift.keyed > 2, `W drives the car forward (${genres.drift.keyed.toFixed(1)} m/s along its heading)`);
    check(genres.drift.out && !genres.drift.driving && genres.drift.beside < 3.5 && Math.abs(genres.drift.feet) < 0.2, `getting out puts the hero on the ground beside the car (${genres.drift.beside.toFixed(1)} m off, feet at ${genres.drift.feet.toFixed(2)})`);
    check(genres.bullets.live > 300 && genres.bullets.hits >= 1, `bullet hell: ${genres.bullets.live} bullets at once, the hero hit ${genres.bullets.hits} times`);
    check(genres.bullets.shots >= 6 && genres.bullets.hp < 100, `punches shoot back (${genres.bullets.shots} shots) and hurt the turret (${genres.bullets.hp}%)`);
    check(genres.errors.length === 0, `the genre wing runs without errors${genres.errors.length ? ': ' + genres.errors.join('; ') : ''}`);
    await capture(page, `world-${tag}-bullets.png`);

    // ------------------------------------------------------------- workshop
    const shop = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // sandbox: the mouse picks the tower's top crate and drags it away; a layout saves and loads back
      await w.goto('sandbox', { instant: true });
      e.step(60);
      const V = e.camera.camera.position.constructor;
      const top = new V(4, 3.6, -4).project(e.camera.camera);
      // the pointer's device coordinates come from a real event on the canvas
      const canvas = e.renderer.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const px = { clientX: rect.left + ((top.x + 1) / 2) * rect.width, clientY: rect.top + ((1 - top.y) / 2) * rect.height, bubbles: true };
      canvas.dispatchEvent(new window.PointerEvent('pointermove', px));
      const mapped = Math.hypot(e.input.pointer.x - top.x, e.input.pointer.y - top.y);
      const picked = w.room.pick(top.x, top.y);
      e.input.setPointer(top.x, top.y, true);
      e.step(2);
      const held = w.room.holding();
      for (let i = 0; i < 40; i++) {
        e.input.setPointer(top.x - i * 0.02, top.y, true);
        e.step(1);
      }
      e.input.setPointer(top.x - 0.8, top.y, false);
      e.step(60);
      const crates = w.room.layout().filter((p) => p.kind === 'crate');
      const moved = Math.max(...crates.map((c) => Math.hypot(c.at[0] - 4, c.at[2] + 4)));
      const saved = w.room.save();
      const before = JSON.stringify(w.room.layout());
      w.room.clear();
      const cleared = w.room.count();
      const loaded = w.room.restore();
      const same = JSON.stringify(w.room.layout()) === before;
      // a layout that is not one changes nothing
      const bad = [w.room.load({}), w.room.load([null]), w.room.load([{ kind: 'constructor', at: [0, 1, 0], rot: [0, 0, 0, 1] }]), w.room.load([{ kind: 'crate', at: [0, NaN, 0], rot: [0, 0, 0, 1] }])];
      out.sandbox = { mapped, picked, held, moved, saved, cleared, loaded, same, bad, count: w.room.count() };
      // time lab: the dominoes fall, holding R stands them back up
      await w.goto('rewind', { instant: true });
      e.step(10);
      const keys = { lab: [...e.debugKeys.resolution] };
      const parked = w.room.ball();
      const standing = w.room.standing();
      w.pad('DOMINOES');
      e.step(240);
      const fallen = w.room.standing();
      e.input.setKey('KeyR', true);
      e.step(300);
      e.input.setKey('KeyR', false);
      const back = w.room.standing();
      const rewound = w.room.rewound();
      e.step(30);
      const still = w.room.standing();
      // the ball rolls off its ramp; rewound to before that, it sleeps there again
      w.room.roll();
      e.step(90);
      const rolled = w.room.ball();
      e.input.setKey('KeyR', true);
      e.step(150);
      e.input.setKey('KeyR', false);
      e.step(60);
      const ball = { parked, rolled, after: w.room.ball() };
      out.rewind = { standing, fallen, back, rewound, still, ball, keys };
      out.errors = e.state().errors;
      return out;
    });
    await capture(page, `world-${tag}-rewind.png`);
    // out of the lab, R is the resolution key again
    shop.rewind.keys.after = await W(async () => {
      await window.__WORLD__.goto('sandbox', { instant: true });
      return [...window.__PIXEL_ENGINE__.debugKeys.resolution];
    });
    check(shop.sandbox.mapped < 1e-3, `a pointer event on the canvas lands where it was aimed (off by ${shop.sandbox.mapped.toExponential(1)})`);
    check(shop.sandbox.picked === 'crate' && shop.sandbox.held === 'crate' && shop.sandbox.moved > 1, `sandbox: the mouse picks a crate (${shop.sandbox.picked}) and drags it ${shop.sandbox.moved.toFixed(1)} m`);
    check(shop.sandbox.saved && shop.sandbox.cleared === 0 && shop.sandbox.loaded && shop.sandbox.same, `a layout saves, clears and loads back the same (${shop.sandbox.count} props)`);
    check(shop.sandbox.bad.every((n) => n === -1) && shop.sandbox.count > 0, `a broken layout is refused and the yard kept (${shop.sandbox.bad}, ${shop.sandbox.count} props)`);
    check(shop.rewind.standing === 22 && shop.rewind.fallen < 4 && shop.rewind.back === 22 && shop.rewind.still === 22 && shop.rewind.rewound > 200, `time lab: ${shop.rewind.standing} dominoes stand, ${shop.rewind.fallen} after a nudge, ${shop.rewind.back} again after holding R, ${shop.rewind.still} still after letting go`);
    const { parked, rolled, after } = shop.rewind.ball;
    const off = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]);
    check(parked.asleep && off(rolled, parked) > 1 && after.asleep && off(after, parked) < 0.05, `the ball sleeps on its ramp, rolls ${off(rolled, parked).toFixed(1)} m, and rewound sleeps there again (${off(after, parked).toFixed(3)} m off)`);
    check(shop.rewind.keys.lab[0] === 'F7' && shop.rewind.keys.after[0] === 'KeyR', `R rewinds in the lab (resolution on ${shop.rewind.keys.lab}) and is the resolution key again outside it`);
    check(shop.errors.length === 0, `the workshop runs without errors${shop.errors.length ? ': ' + shop.errors.join('; ') : ''}`);

    // ------------------------------------------------------------- procedural
    const proc = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // terrain: the collider is where the mesh is (off the grid points), a seed is a land, rain erodes it
      await w.goto('terrain', { instant: true });
      e.step(10);
      const probes = [
        [0.13, -5.27],
        [-10.31, 2.17],
        [12.41, -11.73],
        [-15.6, -9.9],
      ].map(([x, z]) => w.room.probe(x, z));
      const first = w.room.heights();
      w.room.seed(8);
      e.step(2);
      const second = w.room.heights();
      w.room.seed(7);
      e.step(2);
      const again = w.room.heights();
      w.room.erode();
      for (let i = 0; i < 60 && w.room.eroding(); i++) e.step(1);
      const eroded = w.room.heights();
      const drops = w.room.drops();
      // more rain on the same land: it wears down, it never digs a pit
      for (let n = 0; n < 3; n++) {
        w.room.erode();
        for (let i = 0; i < 60 && w.room.eroding(); i++) e.step(1);
      }
      const after = [
        [0.13, -5.27],
        [-10.31, 2.17],
        [12.41, -11.73],
      ].map(([x, z]) => w.room.probe(x, z));
      const gap = (ps) => Math.max(...ps.map((p) => (p.collider === null ? 99 : Math.abs(p.collider - p.mesh))));
      out.terrain = { off: Math.max(gap(probes), gap(after)), first, second, again, drops, eroded, rained: w.room.heights(), trees: w.room.trees() };
      // dungeon: a valid solve, walls as colliders, most of the floor reachable; watched, it collapses step by step
      await w.goto('dungeon', { instant: true });
      e.step(5);
      const solved = { done: w.room.done(), valid: w.room.valid(), reach: w.room.reach(), walls: w.room.walls() };
      w.room.watch();
      e.step(20);
      const midway = { undecided: w.room.undecided(), watching: w.room.watching() };
      for (let i = 0; i < 600 && w.room.watching(); i++) e.step(1);
      out.dungeon = { solved, midway, watched: { done: w.room.done(), valid: w.room.valid(), walls: w.room.walls() } };
      // plants: four L-systems grown; GROW draws them again over three seconds
      await w.goto('plants', { instant: true });
      e.step(5);
      const grownAt = w.room.counts();
      w.room.grow();
      e.step(60);
      const half = w.room.grown();
      e.step(150);
      out.plants = { counts: grownAt, half, full: w.room.grown() };
      out.errors = e.state().errors;
      return out;
    });
    check(proc.terrain.off < 0.01, `terrain: the heightfield collider is where the mesh is (off by at most ${proc.terrain.off.toFixed(4)} m)`);
    check(proc.terrain.first.max > 1.5 && proc.terrain.second.max !== proc.terrain.first.max && proc.terrain.again.max === proc.terrain.first.max, `a seed is a land: seed 7 peaks at ${proc.terrain.first.max.toFixed(2)} m, seed 8 at ${proc.terrain.second.max.toFixed(2)} m, seed 7 again at ${proc.terrain.again.max.toFixed(2)} m`);
    check(proc.terrain.drops >= 3000 && proc.terrain.eroded.max < proc.terrain.first.max && proc.terrain.trees > 5, `rain erodes it (${proc.terrain.drops} drops, peak ${proc.terrain.first.max.toFixed(2)} → ${proc.terrain.eroded.max.toFixed(2)} m) and trees grow by the rules (${proc.terrain.trees})`);
    check(proc.terrain.rained.min > proc.terrain.first.min - 1 && proc.terrain.rained.max <= proc.terrain.eroded.max + 0.01, `four times the rain wears it down without digging pits (lowest ${proc.terrain.first.min.toFixed(2)} → ${proc.terrain.rained.min.toFixed(2)} m)`);
    check(proc.dungeon.solved.done && proc.dungeon.solved.valid && proc.dungeon.solved.walls > 5 && proc.dungeon.solved.reach.reachable > proc.dungeon.solved.reach.floor * 0.3, `dungeon: wave function collapse fits every tile (${proc.dungeon.solved.walls} wall colliders, ${proc.dungeon.solved.reach.reachable}/${proc.dungeon.solved.reach.floor} floor squares reachable)`);
    check(proc.dungeon.midway.undecided > 0 && proc.dungeon.midway.watching && proc.dungeon.watched.done && proc.dungeon.watched.valid, `watched, it collapses square by square (${proc.dungeon.midway.undecided} undecided midway) and ends valid`);
    check(proc.plants.counts.every((c) => c.branches > 20 && c.shown === c.branches && c.height > 1) && proc.plants.half > 0.1 && proc.plants.half < 0.9 && proc.plants.full === 1, `plants: four L-systems grown (${proc.plants.counts.map((c) => `${c.name} ${c.branches}`).join(', ')}), drawn again branch by branch (${(proc.plants.half * 100).toFixed(0)}% a second in)`);
    check(proc.errors.length === 0, `the procedural wing runs without errors${proc.errors.length ? ': ' + proc.errors.join('; ') : ''}`);
    await capture(page, `world-${tag}-plants.png`);

    // ------------------------------------------------------------- rendering lab
    const gfx = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // GPU swarm: a compute shader places and moves every particle; read back from the GPU
      await w.goto('swarm', { instant: true }); // the second visit: the first swarm was freed on the way out
      e.step(30);
      const gpu = e.state().backend === 'WebGPU';
      // SwiftShader runs WebGL 2 compute (transform feedback) slowly: frames stepped in one batch
      // queue up on the GPU and a read-back waits for all of them (hundreds lose the context).
      // There: short batches, and two animation frames for the GPU to catch up before reading.
      const settle = async () => {
        if (!gpu) for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(() => r()));
      };
      await settle();
      const cover = await w.room.coverage();
      const placed = gpu ? await w.room.sample() : null;
      w.room.follow(true);
      e.step(gpu ? 240 : 30); // FOLLOW is measured on WebGPU (a buffer read-back)
      const followed = gpu ? await w.room.sample() : null;
      const steps = w.room.steps();
      // made again with the same options (the count knob back where it was): placed again, spread out
      w.room.follow(false);
      w.room.size(gpu ? 1 : 0);
      e.step(30);
      await settle();
      const remade = await w.room.coverage();
      out.swarm = { gpu, cover, placed, followed, steps, remade, spread: gpu ? (await w.room.sample()).spread : null };
      // mirrors and monitors: two camera feeds and a mirror, rendered before the frame
      await w.goto('views', { instant: true });
      e.step(10);
      await e.renderer.capture();
      const feeds = [await w.room.feed(0), await w.room.feed(1)];
      w.room.stand(-3.5, -5.6); // in front of the glass
      e.step(20);
      // the same moment drawn three times (a capture renders without advancing time): the
      // reflection is stable, and hiding the hero changes it, so the hero is in the mirror
      await e.renderer.capture();
      const near = await w.room.reflection();
      await e.renderer.capture();
      const again = await w.room.reflection();
      e.game.visitor.model.visible = false;
      await e.renderer.capture();
      const hidden = await w.room.reflection();
      e.game.visitor.model.visible = true;
      out.views = { feeds, near, again, hidden, renders: w.room.renders(), mirror: w.room.mirrorRenders() };
      // shaders: one clock drives them; frozen, it holds
      await w.goto('shaders', { instant: true });
      e.step(30);
      const ran = w.room.clock();
      w.room.freeze(true);
      e.step(30);
      out.shaders = { ran, held: w.room.clock() === ran, pieces: w.room.pieces().length };
      await e.renderer.capture();
      out.errors = e.state().errors;
      return out;
    });
    const sw = gfx.swarm;
    check(sw.cover.pixels > 300 && sw.remade.pixels > 300, `GPU swarm: it covers ${sw.cover.pixels} pixels of the frame, and ${sw.remade.pixels} when made again with the same options (a swarm never placed is one spot)`);
    if (sw.gpu) {
      check(sw.placed.finite === sw.placed.n && sw.placed.placed === sw.placed.n && sw.placed.y > 0.3 && sw.placed.n >= 8192 && sw.placed.spread > 1 && sw.spread > 1, `GPU swarm: a compute shader placed all ${sw.placed.n} particles (read back from the GPU, ${sw.steps} dispatches, mean height ${sw.placed.y.toFixed(2)} m, spread ${sw.placed.spread.toFixed(2)} m, ${sw.spread.toFixed(2)} m remade)`);
      check(sw.followed.finite === sw.followed.n && sw.followed.z > sw.placed.z + 1 && sw.followed.dist < 6, `FOLLOW: the swarm moves toward the hero (mean z ${sw.placed.z.toFixed(2)} → ${sw.followed.z.toFixed(2)}) and holds together (${sw.followed.dist.toFixed(2)} m from them on average)`);
    } else check(sw.steps >= 60, `GPU swarm: ${sw.steps} compute dispatches on the WebGL 2 fallback (transform feedback)`);
    check(gfx.views.feeds.every((f) => f.colours > 8) && gfx.views.renders.every((n) => n > 0), `monitors: two cameras render the room to textures (${gfx.views.feeds.map((f) => `${f.w}x${f.h}, ${f.colours} colours`).join('; ')})`);
    check(gfx.views.near.colours > 8 && gfx.views.mirror > 0 && gfx.views.again.hash === gfx.views.near.hash && gfx.views.hidden.hash !== gfx.views.near.hash, `the mirror reflects the room (${gfx.views.near.colours} colours) and the hero standing at it (hiding the hero changes the reflection; the same frame again does not)`);
    check(gfx.shaders.ran > 0.3 && gfx.shaders.held && gfx.shaders.pieces >= 6, `shader gallery: ${gfx.shaders.pieces} TSL materials on one clock (${gfx.shaders.ran.toFixed(2)} s), which freezes`);
    check(gfx.errors.length === 0, `the rendering lab runs without errors${gfx.errors.length ? ': ' + gfx.errors.join('; ') : ''}`);
    await capture(page, `world-${tag}-shaders.png`);

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
