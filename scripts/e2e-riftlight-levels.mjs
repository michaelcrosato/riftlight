/* global window */
// e2e suite "riftlight-levels": Riftlight levels and the dynamic light pool in the real game
// (production build), on WebGPU and on the WebGL 2 fallback.
//
//   npm run build && npm run test:e2e -- riftlight-levels
//
// For designed levels 1, 6 and 12 and a rift (/?game=levellab&depth=N):
//   build      the level builds (layout, critical path, mechanics) and renders a lit frame
//   lights     the light pool keeps a constant number of PointLights (quality medium: 8);
//              moving and recolouring many light requests compiles no new shaders; the
//              pool's CPU update (average of 200) stays under a millisecond
//   walk       the placeholder hero walks start → exit along the critical path with
//              Engine.step (frame-exact), lights follow (the pool re-assigns), no errors
//   portal     killing the boss opens the exit portal (levelClear) and the hero takes it
//   clean      zero GPU errors, zero console errors/warnings
//
// Frames land in .scratch/e2e/riftlight-levels-*.png. Self-contained: e2e.mjs passes its helpers in.

const LEVELS = [
  { depth: 1, query: 'depth=1' },
  { depth: 6, query: 'depth=6' },
  { depth: 12, query: 'depth=12' },
  { depth: 20, query: 'depth=20&seed=7' },
];

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, colorCount, checkClean }
 */
export async function runRiftlightLevels(h) {
  const { exe, scenario: s, openPage, check, capture, state, colorCount, checkClean } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight-levels (${s.backend})`);
  for (const lv of LEVELS) {
    let ctx;
    try {
      ctx = await openPage(exe, s, `game=levellab&${lv.query}&god=1&quality=medium&debug=0`);
      const { page, logs } = ctx;
      const E = (fn, arg) => page.evaluate(fn, arg);
      const info = await E(() => {
        const lab = window.__LEVEL_LAB__;
        const l = lab.level;
        return { game: window.__PIXEL_ENGINE__.state().game, name: l.spec.name, path: l.layout.path.length, rooms: l.layout.rooms.length, mechanics: l.mechanics.length, want: l.spec.mechanics.length, backend: window.__PIXEL_ENGINE__.state().backend };
      });
      const label = `L${lv.depth} ${info.name}: `;
      check(info.game === 'Riftlight Level Lab' && info.backend === s.backend, `${label}levellab runs on ${info.backend}`);
      check(info.path > 10 && info.rooms >= 5 && info.mechanics === info.want, `${label}level built (${info.rooms} rooms, path ${info.path}, ${info.mechanics} mechanics)`);

      // ---------------------------------------------------------- renders
      await E(() => window.__PIXEL_ENGINE__.step(10));
      const frame = await capture(page, `riftlight-levels-${tag}-${lv.depth}-start.png`);
      const colors = colorCount(frame);
      check(colors > 24, `${label}renders a lit level (${colors} colours)`);

      // ---------------------------------------------------------- the light pool
      const lights = await E(async () => {
        const e = window.__PIXEL_ENGINE__;
        const lab = window.__LEVEL_LAB__;
        const nodes = () => e.renderer.renderer._nodes?.nodeBuilderCache?.size ?? -1;
        const size0 = e.lights.lights.length;
        const inScene = e.lights.group.children.length;
        // Warm up with the real frame, then flood the pool with moving, recolouring requests.
        await e.renderer.capture();
        const before = nodes();
        const hero = lab.hero.position;
        const reqs = [];
        for (let i = 0; i < 24; i++) reqs.push(e.lights.request({ position: [hero.x + Math.cos(i) * 4, 1.5, hero.z + Math.sin(i) * 4], color: 0xff0000 + i * 0x0a0a, intensity: 4 + (i % 5), radius: 5, flicker: i % 2 ? 'torch' : 'spell' }));
        let maxUpdate;
        const assigned0 = e.lights.stats().assignments;
        // Only the lights change between these frames (the game doesn't advance), so any
        // new node build here would be the lights' fault.
        for (let k = 0; k < 6; k++) {
          for (const [i, r] of reqs.entries()) {
            r.position.set(hero.x + Math.cos(i + k) * (3 + k), 1.5, hero.z + Math.sin(i + k) * (3 + k));
            r.color.setHSL(((i + k * 3) % 24) / 24, 0.8, 0.6);
            r.intensity = 3 + ((i + k) % 7);
          }
          for (let f = 0; f < 8; f++) e.lights.update(1 / 60, hero, 20);
          await e.renderer.capture();
        }
        // CPU cost: the average over many updates (single samples are at the timer's 0.1 ms
        // resolution and catch GC pauses on a busy machine).
        const t0 = performance.now();
        for (let f = 0; f < 200; f++) e.lights.update(1 / 60, hero, 20);
        maxUpdate = (performance.now() - t0) / 200;
        const after = nodes();
        const st = e.lights.stats();
        for (const r of reqs) r.release();
        e.step(30);
        return { size0, inScene, size1: e.lights.lights.length, before, after, lit: st.lit, requests: st.requests, reassigned: st.assignments - assigned0, maxUpdate, left: e.lights.stats().requests };
      });
      check(lights.size0 === 8 && lights.inScene === 8 && lights.size1 === 8, `${label}light pool: a constant 8 PointLights in the scene`);
      check(lights.requests > lights.size0 && lights.lit === 8, `${label}${lights.requests} light requests share the 8 lights (${lights.lit} lit)`);
      check(lights.reassigned > 0, `${label}moving requests re-assign lights (${lights.reassigned} hand-overs)`);
      check(lights.before > 0 && lights.after === lights.before, `${label}moving + recolouring lights compiles no shaders (node builds ${lights.before} → ${lights.after})`);
      check(lights.maxUpdate < 1, `${label}pool update costs ${lights.maxUpdate.toFixed(3)} ms CPU per frame (${lights.requests} requests, average of 200)`);

      // ---------------------------------------------------------- walk start → exit
      const walk = await E(async () => {
        const e = window.__PIXEL_ENGINE__;
        const lab = window.__LEVEL_LAB__;
        lab.autopilot = true;
        const start = lab.hero.position.clone();
        const a0 = e.lights.stats().assignments;
        let frames = 0;
        let d = lab.exitDistance();
        const samples = [];
        while (d > 1.6 && frames < 6000) {
          e.step(60);
          frames += 60;
          d = lab.exitDistance();
          if (frames % 600 === 0) samples.push(e.lights.describe().filter((r) => r.slot >= 0).map((r) => r.id).join(','));
        }
        lab.autopilot = false;
        return { frames, d, moved: start.distanceTo(lab.hero.position), reassigned: e.lights.stats().assignments - a0, spawned: lab.monsters.length, log: lab.log, distinct: new Set(samples).size };
      });
      check(walk.d <= 1.6, `${label}hero walked start → exit along the critical path (${(walk.frames / 60).toFixed(0)} s game time, ${walk.moved.toFixed(0)} m)`);
      check(walk.reassigned > 0, `${label}lights followed the walk (${walk.reassigned} re-assignments)`);
      check(walk.spawned > 0 && (walk.log['level:packSpawn'] ?? 0) > 0, `${label}encounters spawned on the way (${walk.spawned} monsters)`);
      await capture(page, `riftlight-levels-${tag}-${lv.depth}-exit.png`);

      // ---------------------------------------------------------- boss → portal → exit
      const portal = await E(() => {
        const e = window.__PIXEL_ENGINE__;
        const lab = window.__LEVEL_LAB__;
        let cleared = 0;
        lab.events.on('levelClear', () => cleared++);
        lab.killBoss();
        e.step(5);
        const open = lab.level.exitPortal.open;
        const p = lab.level.exitPortal.position;
        lab.teleport(p.x, p.z);
        e.step(5);
        return { cleared, open, exited: lab.exited, levelCleared: lab.level.cleared };
      });
      check(portal.cleared === 1 && portal.open && portal.levelCleared, `${label}boss down: levelClear emitted, exit portal open`);
      check(portal.exited, `${label}the hero takes the open portal (onExit)`);
      await capture(page, `riftlight-levels-${tag}-${lv.depth}-portal.png`);

      checkClean(await state(page), logs, label);
    } catch (e) {
      check(false, `L${lv.depth} (${s.backend}): ${e.message}`);
    } finally {
      await ctx?.browser.close();
    }
  }
}
