/* global window */
// e2e suite "riftlight-levels": Riftlight levels and the dynamic light pool in the real game
// (production build): what only a page shows.
//
//   npm run build && npm run test:e2e -- riftlight-levels
//
// For designed levels 1, 6 and 12 and a rift (/?game=levellab&depth=N):
//   build      the level runs on the page's backend and renders a lit frame
//   lights     moving and recolouring many light requests compiles no new shaders; the pool's
//              CPU update (average of 200) stays under a millisecond in the page
//   walk       the rift (depth 20) only: the autopilot walks start → exit, the boss dies and the
//              hero takes the portal, for the pictures and the GPU along the way
//   clean      zero GPU errors, zero console errors/warnings
// The gameplay (the level's layout and mechanics, the floor surface, the pool's 8 lights and how
// they are shared, the walk, encounters, boss and portal at every depth) is checked headless:
// src/riftlight/levels/levelLab.headless.test.ts.
//
// Frames land in .scratch/e2e/riftlight-levels-*.png. Self-contained: e2e.mjs passes its helpers in.

const LEVELS = [
  { depth: 1, query: 'depth=1' },
  { depth: 6, query: 'depth=6' },
  { depth: 12, query: 'depth=12' },
  { depth: 20, query: 'depth=20&seed=7', walk: true },
];

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, state, colorCount, checkClean }
 */
export async function runRiftlightLevels(h) {
  const { exe, scenario: s, openPage, check, capture, state, colorCount, checkClean } = h;
  const tag = s.name;
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
        return { name: l.spec.name, backend: window.__PIXEL_ENGINE__.state().backend };
      });
      const label = `L${lv.depth} ${info.name}: `;
      check(info.backend === s.backend, `${label}levellab runs on ${info.backend}`);

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
        // Warm up with the real frame, then flood the pool with moving, recolouring requests.
        await e.renderer.capture();
        const before = nodes();
        const hero = lab.hero.position;
        const reqs = [];
        for (let i = 0; i < 24; i++) reqs.push(e.lights.request({ position: [hero.x + Math.cos(i) * 4, 1.5, hero.z + Math.sin(i) * 4], color: 0xff0000 + i * 0x0a0a, intensity: 4 + (i % 5), radius: 5, flicker: i % 2 ? 'torch' : 'spell' }));
        let maxUpdate;
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
        const requests = e.lights.stats().requests;
        for (const r of reqs) r.release();
        e.step(30);
        return { before, after, requests, maxUpdate };
      });
      check(lights.before > 0 && lights.after === lights.before, `${label}moving + recolouring lights compiles no shaders (node builds ${lights.before} → ${lights.after})`);
      check(lights.maxUpdate < 1, `${label}pool update costs ${lights.maxUpdate.toFixed(3)} ms CPU per frame (${lights.requests} requests, average of 200)`);

      // ---------------------------------------------------------- walk start → exit, boss → portal
      if (lv.walk) {
        await E(() => {
          const e = window.__PIXEL_ENGINE__;
          const lab = window.__LEVEL_LAB__;
          lab.autopilot = true;
          for (let frames = 0; lab.exitDistance() > 1.6 && frames < 6000; frames += 60) e.step(60);
          lab.autopilot = false;
        });
        await capture(page, `riftlight-levels-${tag}-${lv.depth}-exit.png`);
        await E(() => {
          const e = window.__PIXEL_ENGINE__;
          const lab = window.__LEVEL_LAB__;
          lab.killBoss();
          e.step(5);
          const p = lab.level.exitPortal.position;
          lab.teleport(p.x, p.z);
          e.step(5);
        });
        await capture(page, `riftlight-levels-${tag}-${lv.depth}-portal.png`);
      }

      checkClean(await state(page), logs, label);
    } catch (e) {
      check(false, `L${lv.depth} (${s.backend}): ${e.message}`);
    } finally {
      await ctx?.browser.close();
    }
  }
}
