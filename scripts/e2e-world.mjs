/* global window, requestAnimationFrame */
// e2e suite "world": Engine World (src/world, ?game=world), the engine's tech demo, in the browser:
// what only a page can show, driven frame-exactly through window.__WORLD__ and Engine.step():
//
//   pictures     the Atrium and every room render (a frame with content), mirrored sprites draw,
//                the gallery's and the workshop's exhibits are drawn (hiding them changes the
//                frame), a flat tile hides the plinth, a mosaic covers the frame and reveals it
//   GPU          the swarm's compute shader and the views' render targets, read back
//   page         a pointer event on the canvas lands where aimed, the sandbox saves to the
//                browser's storage, no engine hotkeys without ?debug=1, live play at the
//                browser's pace (requestAnimationFrame) records and replays, also in a fresh page
//
// The gameplay (doors, feel, panels, every wing's rooms, replays, save-states, leaks) is checked
// headless: src/world/*.headless.test.ts and src/world/rooms/*.headless.test.ts.
//
// Frames land in .scratch/e2e/world-*.png. Self-contained: e2e.mjs passes its helpers in.

/**
 * A small game for the replay checks, defined in the page as `window.__replayProbe()`: a box
 * on a floor, pushed by keys, hopping from a tween's promise a tenth of a second after Space,
 * and lifted by data the page sends (`ctx.input.send({ lift })`). It has save-states: its
 * counters and its box's handle (the engine keeps the box itself, in the physics world).
 */
function defineProbe() {
  window.__replayProbe = () => {
    const Vec = window.__PIXEL_ENGINE__.scene.position.constructor;
    return {
      name: 'replay-probe',
      target: new Vec(0, 0.5, 0),
      kicks: 0,
      lifts: 0,
      setup(ctx) {
        ctx.physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [8, 0.5, 8] });
        this.box = ctx.physics.addDynamicBox({ position: [0, 0.5, 0], halfExtents: [0.3, 0.3, 0.3] });
      },
      fixedUpdate(ctx) {
        const i = ctx.input;
        if (i.consumePress('Space')) ctx.tweens.call(0.1, () => {}).done.then(() => (this.box.applyImpulse({ x: 0, y: 2, z: 0 }, true), this.kicks++));
        if (i.consumePress('KeyJ')) this.box.applyImpulse({ x: ctx.random.range(-1, 1), y: 1, z: ctx.random.range(-1, 1) }, true);
        if (i.isDown('KeyD')) this.box.applyImpulse({ x: 0.04, y: 0, z: 0 }, true);
        if (i.isDown('KeyA')) this.box.applyImpulse({ x: -0.04, y: 0, z: 0 }, true);
      },
      update(ctx) {
        for (const c of ctx.input.commands) {
          if (!c || typeof c.lift !== 'number') continue;
          this.box.applyImpulse({ x: 0, y: c.lift, z: 0 }, true);
          this.lifts++;
        }
      },
      cameraTarget() {
        return this.target;
      },
      status() {
        return `kicks ${this.kicks} lifts ${this.lifts}`;
      },
      fingerprint() {
        return `${this.kicks} ${this.lifts}`;
      },
      snapshot() {
        return { kicks: this.kicks, lifts: this.lifts, box: this.box.handle };
      },
      restore(ctx, s) {
        this.kicks = s.kicks;
        this.lifts = s.lifts;
        this.box = ctx.physics.world.getRigidBody(s.box);
      },
    };
  };
}

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, ready, check, capture, checkClean, colorCount }
 */
export async function runWorld(h) {
  const { exe, scenario: s, openPage, ready, check, capture, checkClean, colorCount } = h;
  const tag = s.name;
  console.log(`\n▶ world (${s.backend})`);
  let ctx;
  try {
    ctx = await openPage(exe, s, 'game=world&debug=0');
    const { page, logs } = ctx;
    // openPage waited for window.__PIXEL_READY__: __WORLD__ is set by then
    const first = await page.evaluate(() => ({ room: window.__WORLD__?.state().room, hotkeys: Object.values(window.__PIXEL_ENGINE__.debugKeys).flat().length }));
    check(first.room === 'atrium', `window.__WORLD__ is up once the engine is ready, in the Atrium (${first.room})`);
    check(first.hotkeys === 0, `no engine hotkeys without ?debug=1 (${first.hotkeys})`);
    const W = (fn, arg) => page.evaluate(fn, arg);
    const rooms = await W(() => window.__WORLD__.rooms());
    await W(() => window.__PIXEL_ENGINE__.step(30));
    const atriumShot = await capture(page, `world-${tag}-atrium.png`);
    check(colorCount(atriumShot) > 30, `the Atrium renders (${colorCount(atriumShot)} colours)`);

    // ------------------------------------------------------------- every room renders
    const bad = [];
    for (const r of rooms) {
      const room = await W(async (id) => {
        const w = window.__WORLD__;
        const e = window.__PIXEL_ENGINE__;
        await w.goto(id, { instant: true });
        e.step(20);
        const pads = w.state().pads;
        if (pads.length) w.pad(pads[0].label);
        e.step(10);
        return w.state().room;
      }, r.id);
      const colours = colorCount(await capture(page, `world-${tag}-${r.id}.png`));
      if (room !== r.id || colours < 12) bad.push(`${r.id}: room ${room}, ${colours} colours`);
    }
    check(bad.length === 0, `every room renders${bad.length ? ':\n    ' + bad.join('\n    ') : ` (${rooms.length})`}`);

    // ------------------------------------------------------------- sprites: mirrored ones draw
    const sprites = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      await w.goto('sprites', { instant: true });
      e.step(10);
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
      return { facing, mirrored };
    });
    check(sprites.facing > 30 && sprites.mirrored > sprites.facing * 0.6, `mirrored sprites draw (${sprites.mirrored} px against ${sprites.facing} facing right)`);
    await capture(page, `world-${tag}-crowd.png`);

    // ------------------------------------------------------------- sandbox: the canvas's pointer, the browser's storage
    const sandbox = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      await w.goto('sandbox', { instant: true });
      e.step(60);
      const V = e.camera.camera.position.constructor;
      const top = new V(4, 3.6, -4).project(e.camera.camera);
      // the pointer's device coordinates come from a real event on the canvas
      const canvas = e.renderer.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new window.PointerEvent('pointermove', { clientX: rect.left + ((top.x + 1) / 2) * rect.width, clientY: rect.top + ((1 - top.y) / 2) * rect.height, bubbles: true }));
      const mapped = Math.hypot(e.input.pointer.x - top.x, e.input.pointer.y - top.y);
      const saved = w.room.save();
      const before = JSON.stringify(w.room.layout());
      w.room.clear();
      const loaded = w.room.restore();
      return { mapped, saved, loaded, same: JSON.stringify(w.room.layout()) === before, count: w.room.count() };
    });
    check(sandbox.mapped < 1e-3, `a pointer event on the canvas lands where it was aimed (off by ${sandbox.mapped.toExponential(1)})`);
    check(sandbox.saved && sandbox.loaded && sandbox.same, `a sandbox layout saves to the browser's storage and loads back the same (${sandbox.count} props)`);

    // ------------------------------------------------------------- live play at the browser's pace
    // frames at the browser's own pace, a pause, and a game acting in a promise callback (a
    // tween's `done`), recorded in real time, then replayed
    await page.evaluate(defineProbe);
    await page.addInitScript(defineProbe); // the same game after a reload, below
    const realtime = await W(async () => {
      const e = window.__PIXEL_ENGINE__;
      const probe = window.__replayProbe;
      const frames = (n) =>
        new Promise((done) => {
          let k = 0;
          const next = () => (++k >= n ? done() : requestAnimationFrame(next));
          requestAnimationFrame(next);
        });
      const tap = (code) => (e.input.setKey(code, true), e.input.setKey(code, false));
      await e.loadGame(probe());
      tap('KeyJ'); // pressed before the first frame: it queues at the level's start
      e.manual = false;
      e.input.setKey('KeyD', true);
      e.input.send({ lift: 1 });
      await frames(10);
      tap('Space');
      await frames(20);
      e.input.setKey('KeyD', false);
      tap('KeyJ');
      await frames(10);
      e.paused = true;
      e.input.setKey('KeyA', true);
      e.input.send({ lift: 1.5 }); // sent while paused: it arrives once, at the first frame that runs
      await frames(5);
      e.paused = false;
      await frames(15);
      e.input.setKey('KeyA', false);
      tap('Space');
      await frames(30);
      e.manual = true;
      const rec = JSON.parse(JSON.stringify(e.recording()));
      const run = { print: e.fingerprint(), status: e.game.status(e.context) };
      await e.replay(rec, () => e.loadGame(probe()));
      const again = { print: e.fingerprint(), status: e.game.status(e.context) };
      const dts = rec.frames.map((f) => f.dt);
      return { rec, run, again, frames: rec.frames.length, sync: rec.frames.filter((f) => f.sync).length, dt: [Math.min(...dts), Math.max(...dts)], errors: e.state().errors };
    });
    await W(() => window.__WORLD__.goto('sandbox', { instant: true }));
    check(
      realtime.run.status === 'kicks 2 lifts 2' && realtime.frames >= 80 && realtime.rec.frames.filter((f) => f.commands).length === 2 && realtime.sync === 0 && realtime.errors.length === 0,
      `live play records at the browser's pace (${realtime.frames} frames, dt ${realtime.dt.map((d) => d.toFixed(3)).join(' to ')} s, a pause, data from the page on ${realtime.rec.frames.filter((f) => f.commands).length} frames; ${realtime.run.status})`,
    );
    check(
      realtime.again.print === realtime.run.print && realtime.again.status === realtime.run.status,
      `live play replays to the same state, its promise callbacks on the same frames (${realtime.run.print} vs ${realtime.again.print})`,
    );

    // ------------------------------------------------------------- rendering lab: the GPU, read back
    const gfx = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      const out = {};
      // GPU swarm: a compute shader places and moves every particle; read back from the GPU
      await w.goto('swarm', { instant: true }); // the second visit: the first swarm was freed on the way out
      e.step(30);
      const cover = await w.room.coverage();
      const placed = await w.room.sample();
      w.room.follow(true);
      e.step(240);
      const followed = await w.room.sample();
      const steps = w.room.steps();
      // made again with the same options (the count knob back where it was): placed again, spread out
      w.room.follow(false);
      w.room.size(1);
      e.step(30);
      const remade = await w.room.coverage();
      out.swarm = { cover, placed, followed, steps, remade, spread: (await w.room.sample()).spread };
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
      out.errors = e.state().errors;
      return out;
    });
    const sw = gfx.swarm;
    check(sw.cover.pixels > 300 && sw.remade.pixels > 300, `GPU swarm: it covers ${sw.cover.pixels} pixels of the frame, and ${sw.remade.pixels} when made again with the same options (a swarm never placed is one spot)`);
    check(sw.placed.finite === sw.placed.n && sw.placed.placed === sw.placed.n && sw.placed.y > 0.3 && sw.placed.n >= 8192 && sw.placed.spread > 1 && sw.spread > 1, `GPU swarm: a compute shader placed all ${sw.placed.n} particles (read back from the GPU, ${sw.steps} dispatches, mean height ${sw.placed.y.toFixed(2)} m, spread ${sw.placed.spread.toFixed(2)} m, ${sw.spread.toFixed(2)} m remade)`);
    check(sw.followed.finite === sw.followed.n && sw.followed.z > sw.placed.z + 1 && sw.followed.dist < 6, `FOLLOW: the swarm moves toward the hero (mean z ${sw.placed.z.toFixed(2)} → ${sw.followed.z.toFixed(2)}) and holds together (${sw.followed.dist.toFixed(2)} m from them on average)`);
    check(gfx.views.feeds.every((f) => f.colours > 8) && gfx.views.renders.every((n) => n > 0), `monitors: two cameras render the room to textures (${gfx.views.feeds.map((f) => `${f.w}x${f.h}, ${f.colours} colours`).join('; ')})`);
    check(gfx.views.near.colours > 8 && gfx.views.mirror > 0 && gfx.views.again.hash === gfx.views.near.hash && gfx.views.hidden.hash !== gfx.views.near.hash, `the mirror reflects the room (${gfx.views.near.colours} colours) and the hero standing at it (hiding the hero changes the reflection; the same frame again does not)`);
    check(gfx.errors.length === 0, `the rendering lab runs without errors${gfx.errors.length ? ': ' + gfx.errors.join('; ') : ''}`);

    // ------------------------------------------------------------- asset gallery: the exhibit is drawn
    const gal = await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      // pixels that differ between two frames: what the exhibit covers
      const changed = (a, b) => {
        let n = 0;
        for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
        return n;
      };
      await w.goto('gallery', { instant: true });
      e.step(20);
      const r = w.room;
      const out = {};
      r.spin(false);
      r.show('barrel');
      e.step(30);
      const shown = (await e.renderer.capture()).pixels.slice();
      r.hide(true);
      e.step(2);
      out.barrel = changed(shown, (await e.renderer.capture()).pixels);
      r.hide(false);
      r.show('well');
      e.step(30);
      const well = (await e.renderer.capture()).pixels.slice();
      r.hide(true);
      e.step(2);
      out.well = changed(well, (await e.renderer.capture()).pixels);
      r.hide(false);
      // an asset from each imported pack is drawn too (a model, then a tile), when there are packs
      out.packDrawn = [];
      for (const id of r.shelves().filter((x) => x.title.startsWith('PACK')).map((x) => x.id)) {
        r.shelf(id);
        e.step(30);
        const a = (await e.renderer.capture()).pixels.slice();
        r.hide(true);
        e.step(2);
        out.packDrawn.push({ id: r.current().id, pixels: changed(a, (await e.renderer.capture()).pixels) });
        r.hide(false);
      }
      // a flat ground tile stands clear of the plinth: at its centre (a box well inside the tile, a
      // diamond at this angle), hiding it changes every pixel; where it shares the plinth's depth,
      // the plinth shows through in a pattern that flickers
      out.flat = null;
      if (r.show('kenney-nature/ground-grass')) {
        e.step(30);
        const shown = await e.renderer.capture();
        const a = shown.pixels.slice();
        r.hide(true);
        e.step(2);
        const b = (await e.renderer.capture()).pixels;
        r.hide(false);
        const half = Math.round(shown.height / 24);
        let n = 0;
        let through = 0;
        for (let y = shown.height / 2 - half; y < shown.height / 2 + half; y++) {
          for (let x = shown.width / 2 - half; x < shown.width / 2 + half; x++) {
            const i = (Math.round(y) * shown.width + Math.round(x)) * 4;
            n++;
            if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) through++;
          }
        }
        out.flat = { through, n };
      }
      out.errors = e.state().errors;
      return out;
    });
    check(gal.barrel > 500 && gal.well > 500, `asset gallery: the exhibit is drawn (hiding it changes ${gal.barrel} pixels for the barrel, ${gal.well} for the well)`);
    check(gal.packDrawn.every((p) => p.pixels > 300), `asset gallery: every pack's first asset is drawn (${gal.packDrawn.map((p) => `${p.id} ${p.pixels} px`).join(', ') || 'no packs'})`);
    check(gal.flat !== null && gal.flat.through === 0, `asset gallery: a flat ground tile hides the plinth under it (${gal.flat ? `${gal.flat.through} of ${gal.flat.n} pixels at its centre show the plinth through it` : 'kenney-nature/ground-grass is not in the gallery'})`);
    check(gal.errors.length === 0, `the asset gallery runs without errors${gal.errors.length ? ': ' + gal.errors.join('; ') : ''}`);
    await capture(page, `world-${tag}-gallery.png`);

    await checkWorkshop({ W, check, capture, page, tag });

    // ------------------------------------------------------------- transitions room: a mosaic
    await W(async () => {
      const w = window.__WORLD__;
      const e = window.__PIXEL_ENGINE__;
      await w.goto('transitions', { instant: true });
      e.step(10);
      void e.screen.cover('mosaic', { duration: 0.2 });
      e.step(20);
    });
    const covered = await capture(page, `world-${tag}-mosaic.png`);
    check(colorCount(covered) <= 3, `a mosaic covers the frame (${colorCount(covered)} colours)`);
    await W(async () => {
      const e = window.__PIXEL_ENGINE__;
      void e.screen.reveal('mosaic', { duration: 0.2 });
      e.step(20);
    });
    const revealed = await capture(page, `world-${tag}-revealed.png`);
    check(colorCount(revealed) > 20, `and reveals it again (${colorCount(revealed)} colours)`);

    const st = await W(() => window.__PIXEL_ENGINE__.state());
    check(st.errors.length === 0, `no game errors${st.errors.length ? ': ' + st.errors.join('; ') : ''}`);
    checkClean(st, logs);

    // ------------------------------------------------------------- a recording is a file
    // the live play recorded above, replayed in a fresh page (another engine, its clocks at 0)
    await page.reload();
    await ready(page);
    const fresh = await W(async (rec) => {
      const e = window.__PIXEL_ENGINE__;
      await e.replay(rec, () => e.loadGame(window.__replayProbe()));
      return { print: e.fingerprint(), status: e.game.status(e.context), errors: e.state().errors };
    }, realtime.rec);
    check(
      fresh.print === realtime.run.print && fresh.status === realtime.run.status && fresh.errors.length === 0,
      `live play saved as JSON replays the same in a fresh page (${realtime.run.print} vs ${fresh.print}; ${fresh.status})`,
    );
  } catch (e) {
    check(false, `world (${s.name}) crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }
}

/**
 * The Asset Workshop (`workshop`) in pictures: each kind of asset goes down and is drawn (hiding it
 * changes the frame); then a floor to look at. Where each goes down, the picker, the pointer, undo
 * and clear are checked headless (src/world/rooms/assets.headless.test.ts). Exported so it can run
 * on its own against a page already open on Engine World.
 * @param {object} h { W: evaluate in the page, check, capture, page, tag }
 */
export async function checkWorkshop({ W, check, capture, page, tag }) {
  const k = await W(async () => {
    const w = window.__WORLD__;
    const e = window.__PIXEL_ENGINE__;
    const changed = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
      return n;
    };
    await w.goto('workshop', { instant: true });
    e.step(20);
    const r = w.room;
    r.preview(false); // frames then differ by what went down, not by the hovering preview
    // each kind is drawn: hiding it changes the frame
    const drawn = async (spawn) => {
      r.clear();
      const placed = spawn();
      e.step(10);
      const a = (await e.renderer.capture()).pixels.slice();
      r.hide(true);
      e.step(2);
      const px = changed(a, (await e.renderer.capture()).pixels);
      r.hide(false);
      return { id: placed?.id, px };
    };
    const pack = r.shelves().find((s) => s.title.startsWith('PACK') && !s.id.endsWith('/textures'));
    const kinds = {
      library: await drawn(() => r.spawn('barrel', [-2, 2])),
      pack: pack ? await drawn(() => (r.shelf(pack.id), r.spawn(undefined, [-2, 2]))) : null,
      tile: await drawn(() => r.spawn('floor-tiles', [-2, 2])),
      sprite: await drawn(() => r.spawn('coin-spin', [-2, 2])),
    };
    // a floor to look at: a tile, models from the library and a pack, a sprite
    r.clear();
    r.spawn('floor-tiles', [-2, 2]);
    r.spawn('campfire', [-2, 2]);
    r.spawn('barrel', [-0.5, 1]);
    r.spawn('kenney-nature/tree-oak', [-4.5, 0.5]);
    r.spawn('kenney-furniture/chair', [-0.8, 3]);
    r.spawn('coin-spin', [-3.5, 3]);
    e.step(20);
    return kinds;
  });
  check(k.library.px > 300, `asset workshop: a library model is drawn (${k.library.id}, ${k.library.px} px)`);
  check(k.pack !== null && k.pack.px > 300, `asset workshop: a pack's model is drawn (${k.pack ? `${k.pack.id}, ${k.pack.px} px` : 'no pack shelf'})`);
  check(k.tile.px > 300, `asset workshop: a tiling texture is drawn as a floor (${k.tile.id}, ${k.tile.px} px)`);
  check(k.sprite.px > 100, `asset workshop: a sprite is drawn (${k.sprite.id}, ${k.sprite.px} px)`);
  await capture(page, `world-${tag}-workshop-floor.png`);
}
