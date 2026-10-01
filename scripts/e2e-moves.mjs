// Moveset verification helpers, shared by scripts/e2e.mjs. Each move runs in the live
// game (third-person camera, yaw 0 → W = -Z, S = +Z, D = +X, A = -X) by injecting keys and
// teleporting, then asserts on the character's state machine and position.
//
// Time is game time: the helpers advance the engine with Engine.step (exact 1/60 s frames),
// so `wait(500)` is always 30 frames however slowly the machine renders (CI runners too).

/** Installed into the page: small async DSL over window.__PIXEL_ENGINE__. */
export const PAGE_HELPERS = () => {
  const e = window.__PIXEL_ENGINE__;
  const g = e.game;
  const frames = async (n) => e.step(Math.max(0, Math.round(n)));
  const T = {
    frames,
    /** Game time in milliseconds. */
    wait: (ms) => frames((ms * 60) / 1000),
    set: (keys, down) => keys.forEach((k) => e.input.setKey(k, down)),
    releaseAll: () => ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'KeyF', 'KeyJ', 'ShiftLeft'].forEach((k) => e.input.setKey(k, false)),
    async hold(keys, ms) {
      T.set(keys, true);
      await T.wait(ms);
      T.set(keys, false);
    },
    async tap(key) {
      e.input.setKey(key, true);
      await frames(2);
      e.input.setKey(key, false);
      await frames(1);
    },
    /** Teleport feet to [x,y,z] facing yaw (0 = +Z, π/2 = +X). */
    async place(pos, yaw = 0) {
      T.releaseAll();
      g.hero.teleport(pos);
      g.hero.facing = yaw;
      g.hero.hvel.set(0, 0, 0);
      await frames(8);
    },
    /** Poll until predicate(hero) or timeout; returns the set of states seen. */
    async until(pred, ms = 3000) {
      const seen = new Set();
      for (let f = 0; f < (ms * 60) / 1000; f++) {
        seen.add(g.hero.state);
        if (pred(g.hero)) return { ok: true, seen: [...seen] };
        await frames(1);
      }
      return { ok: false, seen: [...seen] };
    },
    snap: () => ({ state: g.hero.state, anim: g.hero.anim, feet: g.hero.feet.toArray().map((v) => +v.toFixed(2)), stance: g.hero.stance, jumpKind: g.hero.jumpKind, stats: { ...g.hero.stats } }),
  };
  window.__T = T;
  return true;
};

/**
 * Each move: { name, run: async () => ({ ok, detail }) } executed in the page.
 * Written as strings of async function bodies so they run page-side.
 */
export const MOVES = [
  ['walk / run', `
    await T.place([0, 0, 4]);
    T.set(['KeyD'], true); const r = await T.until(h => h.state === 'run', 2500); T.set(['KeyD'], false);
    return { ok: r.ok, detail: r.seen };`],
  ['tiptoe / walk modifier', `
    await T.place([0, 0, 4]);
    T.set(['KeyD', 'ShiftLeft'], true); await T.wait(700); const s = T.snap(); T.set(['KeyD', 'ShiftLeft'], false);
    return { ok: s.state === 'walk' && ['Tiptoe', 'Walk'].includes(s.anim), detail: s };`],
  ['skid turn', `
    await T.place([-4, 0, 6]);
    T.set(['KeyD'], true); await T.until(h => h.state === 'run', 2500); await T.wait(300);
    T.set(['KeyA'], true); T.set(['KeyD'], false); // straight into reverse (letting go alone would brake)
    const r = await T.until(h => h.state === 'skid', 800); const turned = await T.until(h => Math.sin(h.facing) < -0.7, 1500); T.set(['KeyA'], false);
    return { ok: r.ok && turned.ok, detail: { skid: r.seen, turned: turned.seen } };`],
  ['brake to a stop from a run', `
    await T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true); await T.until(h => h.state === 'run' && h.speed > 5.5, 2500); T.set(['KeyD'], false);
    const r = await T.until(h => h.state === 'skid', 300); const s = await T.until(h => h.state === 'idle', 2000);
    return { ok: r.ok && s.ok, detail: { brake: r.seen, stop: s.seen } };`],
  ['step up stairs', `
    await T.place([-1.4, 0, 0], -Math.PI / 2);
    T.set(['KeyA'], true); const r = await T.until(h => h.feet.y > 1.3, 5000); T.set(['KeyA'], false);
    return { ok: r.ok, detail: { seen: r.seen, feet: T.snap().feet } };`],
  ['teeter at edge', `
    await T.place([-9.9, 1.4, 0], -Math.PI / 2);
    const r = await T.until(h => h.state === 'teeter', 1500);
    return { ok: r.ok, detail: r.seen };`],
  ['jump + land', `
    await T.place([0, 0, 4]);
    await T.tap('Space'); const r = await T.until(h => h.state === 'land' || h.state === 'idle' && h.stats.landings > 0, 2500);
    return { ok: r.ok && r.seen.includes('jump'), detail: { seen: r.seen, kind: T.snap().jumpKind } };`],
  ['double + triple jump', `
    await T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true); await T.until(h => h.state === 'run', 2500);
    const kinds = new Set();
    for (let i = 0; i < 3; i++) {
      await T.tap('Space');
      kinds.add(T.snap().jumpKind);
      await T.until(h => h.grounded && h.state !== 'jump' && h.state !== 'fall', 2500);
      kinds.add(T.snap().jumpKind);
    }
    T.set(['KeyD'], false);
    return { ok: kinds.has('DoubleJump') && kinds.has('TripleJump'), detail: [...kinds] };`],
  ['backflip (crouch + jump)', `
    await T.place([0, 0, 4]);
    T.set(['KeyC'], true); await T.frames(6); await T.tap('Space'); const k = T.snap().jumpKind;
    const r = await T.until(h => h.grounded && h.state !== 'jump' && h.state !== 'fall', 2500); T.set(['KeyC'], false);
    return { ok: k === 'Backflip' && !r.seen.includes('groundPound'), detail: { k, seen: r.seen } };`],
  ['long jump (run + crouch + jump)', `
    await T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true); await T.until(h => h.state === 'run', 2500); await T.wait(200);
    T.set(['KeyC'], true); await T.frames(1); await T.tap('Space'); const k = T.snap().jumpKind; T.set(['KeyC', 'KeyD'], false);
    await T.until(h => h.grounded && h.state !== 'jump', 2500);
    return { ok: k === 'LongJump', detail: k };`],
  ['side flip (skid + jump)', `
    await T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true); await T.until(h => h.state === 'run', 2500); await T.wait(300);
    T.set(['KeyA'], true); T.set(['KeyD'], false); await T.until(h => h.state === 'skid', 800); await T.tap('Space'); const k = T.snap().jumpKind; T.set(['KeyA'], false);
    await T.until(h => h.grounded && h.state !== 'jump', 2500);
    return { ok: k === 'SideFlip', detail: k };`],
  ['crouch + crouch walk', `
    await T.place([0, 0, 4]);
    T.set(['KeyC'], true); const a = await T.until(h => h.state === 'crouch' && h.stance === 'crouch', 800);
    T.set(['KeyD'], true); const b = await T.until(h => h.state === 'crouchWalk', 800); T.set(['KeyD', 'KeyC'], false);
    const c = await T.until(h => h.state === 'idle' && h.stance === 'stand', 1500);
    return { ok: a.ok && b.ok && c.ok, detail: [a.seen, b.seen, c.seen] };`],
  ['prone + crawl through tunnel', `
    await T.place([-5.5, 0, 7], -Math.PI / 2);
    await T.tap('KeyZ'); const a = await T.until(h => h.state === 'prone', 1500);
    T.set(['KeyA'], true); const b = await T.until(h => h.feet.x < -9.8, 9000); const mid = T.snap(); T.set(['KeyA'], false);
    await T.tap('KeyZ'); const c = await T.until(h => h.state === 'idle', 2000);
    return { ok: a.ok && b.ok && b.seen.includes('crawl') && c.ok, detail: { a: a.seen, b: b.seen, mid, c: c.seen } };`],
  ['stand blocked under tunnel roof', `
    await T.place([-5.5, 0, 7], -Math.PI / 2);
    await T.tap('KeyZ'); await T.until(h => h.state === 'prone', 1500);
    T.set(['KeyA'], true); await T.until(h => h.feet.x < -8, 6000); T.set(['KeyA'], false);
    await T.tap('KeyZ'); await T.frames(20); const s = T.snap();
    return { ok: s.stance === 'prone', detail: s };`],
  ['lie down + get up', `
    await T.place([0, 0, 4]);
    await T.tap('KeyX'); const a = await T.until(h => h.state === 'lying', 2500);
    await T.tap('KeyX'); const b = await T.until(h => h.state === 'idle', 2500);
    return { ok: a.ok && b.ok && b.seen.includes('getUp'), detail: [a.seen, b.seen] };`],
  ['sit + wave', `
    await T.place([0, 0, 4]);
    await T.tap('KeyB'); const a = await T.until(h => h.state === 'sit', 800);
    await T.tap('KeyB'); await T.until(h => h.state === 'idle', 800);
    await T.tap('KeyV'); const b = await T.until(h => h.state === 'emote', 800);
    return { ok: a.ok && b.ok, detail: [a.seen, b.seen] };`],
  ['punch, punch, kick combo', `
    await T.place([0, 0, 4]);
    const clips = new Set();
    for (let i = 0; i < 3; i++) {
      await T.tap('KeyJ');
      await T.until(h => { clips.add(h.anim); return h.state !== 'attack'; }, 1500);
    }
    await T.until(h => h.state === 'idle', 2000);
    return { ok: clips.has('Punch') && clips.has('Punch2') && clips.has('Kick'), detail: [...clips] };`],
  ['ledge: jump → hang → pull up', `
    await T.place([4.8, 0, 0], Math.PI / 2);
    T.set(['KeyD'], true); await T.tap('Space'); const a = await T.until(h => h.state === 'hang', 2000); T.set(['KeyD'], false);
    await T.wait(300);
    T.set(['KeyD'], true); await T.until(h => h.state === 'pullUp', 1500); T.set(['KeyD'], false);
    const b = await T.until(h => h.state === 'idle' && h.feet.y > 2.7, 3000);
    return { ok: a.ok && b.ok && b.seen.includes('pullUp'), detail: { a: a.seen, b: b.seen, s: T.snap() } };`],
  ['ledge: shimmy + drop', `
    await T.place([0, 0, -7.4], Math.PI);
    T.set(['KeyW'], true); await T.tap('Space'); const a = await T.until(h => h.state === 'hang', 2000); T.set(['KeyW'], false);
    await T.wait(300); const x0 = T.snap().feet[0];
    T.set(['KeyD'], true); await T.wait(900); T.set(['KeyD'], false); const x1 = T.snap().feet[0];
    await T.tap('KeyC'); const b = await T.until(h => h.grounded && h.state !== 'fall' && h.state !== 'hang', 2500);
    return { ok: a.ok && Math.abs(x1 - x0) > 0.5 && b.ok, detail: { a: a.seen, x0, x1, b: b.seen } };`],
  ['climb vine wall and over the top', `
    await T.place([8, 0, -6.9], Math.PI);
    T.set(['KeyW'], true); const a = await T.until(h => h.state === 'climb', 2000);
    await T.until(h => h.state === 'pullUp', 9000); T.set(['KeyW'], false);
    const b = await T.until(h => h.state === 'idle' && h.feet.y > 4.3, 3000);
    return { ok: a.ok && b.ok, detail: { a: a.seen, b: b.seen, s: T.snap() } };`],
  ['climb ladder to tower top', `
    await T.place([-12, 0, -6.8], Math.PI);
    T.set(['KeyW'], true); const a = await T.until(h => h.state === 'climb', 2000);
    const b = await T.until(h => h.feet.y > 6.8 && (h.state === 'idle' || h.state === 'walk'), 12000); T.set(['KeyW'], false);
    return { ok: a.ok && b.ok, detail: { a: a.seen, b: b.seen, s: T.snap() } };`],
  ['hard landing from the tower', `
    await T.place([-12, 7, -9.2], Math.PI);
    T.set(['KeyW'], true); const r = await T.until(h => h.state === 'hardLand', 5000); T.set(['KeyW'], false);
    const b = await T.until(h => h.state === 'idle', 3000);
    return { ok: r.ok && r.seen.includes('fall') && b.ok, detail: [r.seen, b.seen] };`],
  ['slope slide', `
    await T.place([10.3, 4.6, -9], Math.PI / 2);
    const r = await T.until(h => h.state === 'slide', 2500);
    const b = await T.until(h => h.feet.y < 0.5 && h.state !== 'slide', 6000);
    return { ok: r.ok && b.ok, detail: [r.seen, b.seen, T.snap()] };`],
  ['wall kick in the chimney', `
    await T.place([-5.6, 0, -9], Math.PI / 2);
    T.set(['KeyD'], true); await T.tap('Space');
    await T.until(h => h.feet.x > -5.3, 1200);
    let kicked = false;
    for (let i = 0; i < 20 && !kicked; i++) { await T.tap('Space'); kicked = T.snap().jumpKind === 'WallKick'; }
    T.set(['KeyD'], false);
    await T.until(h => h.grounded && h.state !== 'jump', 3000);
    return { ok: kicked, detail: T.snap() };`],
  ['wall slide → wall kick', `
    await T.place([-5.6, 0, -9], Math.PI / 2);
    T.set(['KeyD'], true); await T.tap('Space');
    const a = await T.until(h => h.state === 'wallSlide', 2000);
    const vy = window.__PIXEL_ENGINE__.game.hero.vy;
    await T.tap('Space'); const k = T.snap().jumpKind; T.set(['KeyD'], false);
    await T.until(h => h.grounded && h.state !== 'jump', 3000);
    return { ok: a.ok && vy >= -3.1 && k === 'WallKick', detail: { seen: a.seen, vy, k } };`],
  ['lean on a wall (PushIdle)', `
    await T.place([0, 0, -6.6], Math.PI);
    T.set(['KeyW', 'ShiftLeft'], true); const r = await T.until(h => h.state === 'idle' && h.anim === 'PushIdle', 3000); T.set(['KeyW', 'ShiftLeft'], false);
    const b = await T.until(h => h.anim === 'Idle', 1000);
    return { ok: r.ok && b.ok, detail: { a: r.seen, b: b.seen, s: T.snap() } };`],
  ['hurt by the spike pad: knockback, stun, invulnerable', `
    await T.place([9, 0, 12.4], 0);
    const g = window.__PIXEL_ENGINE__.game;
    const before = g.hurts;
    T.set(['KeyS'], true); const r = await T.until(h => h.state === 'hurt', 2000);
    const z0 = T.snap().feet[2]; const inv = g.hero.invulnerable;
    await T.wait(300); const z1 = T.snap().feet[2]; const still = g.hero.state === 'hurt';
    T.set(['KeyS'], false);
    const b = await T.until(h => h.state === 'idle', 2000);
    return { ok: r.ok && g.hurts === before + 1 && inv > 1 && still && z1 < z0 - 0.5 && b.ok, detail: { seen: r.seen, z0, z1, inv, still, hurts: g.hurts - before } };`],
  ['dive → belly slide → get up', `
    await T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true); await T.until(h => h.state === 'run', 2500); await T.tap('Space');
    await T.until(h => h.state === 'jump' && h.feet.y > 0.3, 1500); await T.tap('KeyJ'); T.set(['KeyD'], false);
    const r = await T.until(h => h.state === 'idle', 5000);
    return { ok: r.ok && r.seen.includes('dive') && r.seen.includes('bellySlide'), detail: r.seen };`],
  ['ground pound', `
    await T.place([0, 0, 4]);
    await T.tap('Space'); await T.until(h => h.state === 'jump' && h.vy < 6, 1500);
    await T.tap('KeyC'); await T.until(h => h.state === 'groundPound', 1000);
    const r = await T.until(h => h.state === 'idle', 4000);
    return { ok: r.ok && r.seen.includes('groundPound') && r.seen.includes('groundPoundLand'), detail: r.seen };`],
  ['push crate', `
    await T.place([1.3, 0, 0], Math.PI / 2);
    const crate = window.__PIXEL_ENGINE__.physics.world.bodies.getAll().find(b => b.isDynamic() && Math.abs(b.translation().z) < 0.1 && b.translation().x > 2);
    const x0 = crate.translation().x;
    T.set(['KeyD'], true); const r = await T.until(h => h.state === 'push', 2000); await T.wait(1500); T.set(['KeyD'], false);
    const x1 = crate.translation().x;
    return { ok: r.ok && x1 - x0 > 1, detail: { seen: r.seen, x0, x1 } };`],
  ['grab + pull block out of the nook', `
    await T.place([10.95, 0, 6], Math.PI / 2);
    const block = window.__PIXEL_ENGINE__.physics.world.bodies.getAll().find(b => b.isDynamic() && b.translation().x > 11.5);
    const x0 = block.translation().x;
    T.set(['KeyF'], true); const a = await T.until(h => h.state === 'grab', 1500);
    T.set(['KeyA'], true); const b = await T.until(h => h.state === 'pull', 1500); await T.wait(1500); T.set(['KeyA', 'KeyF'], false);
    const x1 = block.translation().x;
    return { ok: a.ok && b.ok && x0 - x1 > 1, detail: { a: a.seen, b: b.seen, x0, x1 } };`],
  ['falls off the island and respawns', `
    await T.place([15.5, 0, 12], Math.PI / 2);
    const before = window.__PIXEL_ENGINE__.game.respawns;
    T.set(['KeyD'], true); const r = await T.until(h => h.state === 'fall', 3000); T.set(['KeyD'], false);
    await T.until(() => window.__PIXEL_ENGINE__.game.respawns > before, 5000);
    return { ok: r.ok && window.__PIXEL_ENGINE__.game.respawns > before, detail: r.seen };`],
];
