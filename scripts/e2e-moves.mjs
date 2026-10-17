// Moveset helpers for the browser, shared by scripts/e2e.mjs (`moves`: Engine.step and capture in
// the live page) and scripts/e2e-systems.mjs. The moveset itself is checked headless:
// src/game/playground.moves.test.ts (src/game/testPlayground.ts is the same script for Node).
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

