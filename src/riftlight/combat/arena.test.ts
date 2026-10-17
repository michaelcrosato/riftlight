// The combat arena headless (was e2e `riftlight-combat`'s state checks): the arena boots (hero,
// sword, dummies, skill bar), the basic combo lands on its hit frame with hit-stop, knockback, a
// flash and a damage number, a dodge roll moves the hero with i-frames and cancels an attack, a
// fireball pays mana, flies and hits, the left mouse button attacks, a kill emits kill and death
// and the corpse pops and is removed; R is a skill key, so the engine's resolution hotkey sits on
// F2 when the hotkeys are on. The picture stays in e2e. Tests run in order on one engine; the
// hotkey test boots its own after the first is disposed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../../engine';
import { headlessGame } from '../headless';
import { Arena } from './arena';

const T = 30_000;

interface Logged {
  type: string;
  frame: number;
  skill?: string;
  total: number;
  target?: string;
}

describe('the combat arena', () => {
  let e: Engine;
  let g: Arena;
  const log: Logged[] = [];

  beforeAll(async () => {
    g = new Arena();
    e = await headlessGame(g);
    e.step(2);
    g.actors.events.onAny((type, payload) => {
      const p = payload as { hit?: { skill?: string }; skill?: string; result?: { total?: number }; target?: { name?: string }; actor?: { name?: string } } | undefined;
      log.push({ type: String(type), frame: e.frame, skill: p?.hit?.skill ?? p?.skill, total: p?.result?.total ?? 0, target: p?.target?.name ?? p?.actor?.name });
    });
  }, T);
  afterAll(() => e?.dispose());

  /** Press a key for two frames, as a tap. */
  const tap = (code: string) => {
    e.input.setKey(code, true);
    e.step(2);
    e.input.setKey(code, false);
  };

  it('boots with the hero, a sword in hand, five dummies and the skill bar; no resolution hotkey on R', () => {
    expect(e.state().game).toBe('Riftlight Arena');
    expect(g.hero.actor.alive).toBe(true);
    expect(g.heroModel.getObjectByName('Sword'), 'a sword in hand').toBeTruthy();
    expect(g.dummies.filter((d) => d.alive).length, 'five training dummies').toBe(5);
    expect([g.hero.basic.id, ...g.hero.slots.map((x) => x?.id ?? null)].join(',')).toBe('slash,cleave,fireball,frost-nova,leap-slam,whirlwind');
    // R is a skill key: the arena never turns the engine hotkeys on (none here, as with ?debug=0)
    expect(e.debugKeys.resolution).toEqual([]);
  });

  it(
    'the first slash lands on its hit frame with damage, hit-stop, a flash, a number and knockback; holding J chains the combo',
    () => {
      const dummy = g.dummies.find((d) => d.name === 'training dummy')!;
      dummy.brain = null; // stands still for the measurement
      g.hero.teleport([0, 0, 0.6]);
      g.hero.facing = Math.PI;
      e.step(10);
      const life0 = dummy.life;
      const z0 = dummy.position.z;
      const press = e.frame;
      tap('KeyJ');
      let hitFrame = -1;
      let stop = { hero: 0, dummy: 0 };
      let flash = false;
      let dealt = 0;
      for (let i = 0; i < 40 && hitFrame < 0; i++) {
        e.step(1);
        const hit = log.find((l) => l.type === 'hit' && l.frame > press && l.target === 'training dummy' && l.total > 0);
        if (hit) {
          hitFrame = hit.frame;
          // what the hit took off the dummy (the still dummy regenerates, so its life later says little)
          dealt = life0 - dummy.life;
          stop = { hero: g.hero.actor.hitStop, dummy: dummy.hitStop };
          flash = dummy.fx.flashing;
        }
      }
      const numbers = g.combat.numbers.floaters.length;
      e.step(40);
      // Slash1 hits at frame 5 of 12 (0.42 s at 100% speed) → ~10.5 game frames after the press
      const after = hitFrame - press;
      expect(after, `hit ${after} frames after the press`).toBeGreaterThanOrEqual(8);
      expect(after).toBeLessThanOrEqual(13);
      expect(dealt, 'the dummy takes damage').toBeGreaterThan(0);
      expect(stop.hero, 'hit-stop freezes the hero').toBeGreaterThan(0);
      expect(stop.dummy, 'hit-stop freezes the target').toBeGreaterThan(0);
      expect(flash, 'the target flashes on hit').toBe(true);
      expect(numbers, 'a damage number pops').toBeGreaterThan(0);
      expect(dummy.position.z - z0, 'knockback pushes the dummy away').toBeLessThan(-0.05);
      // the whole chain: J held keeps the combo going
      e.input.setKey('KeyJ', true);
      e.step(70);
      e.input.setKey('KeyJ', false);
      expect(g.hero.stats.attacks, 'holding attack chains the combo').toBeGreaterThanOrEqual(4);
      e.step(40);
    },
    T,
  );

  it(
    'Space rolls with i-frames over open floor, and a dodge cancels an attack after its hit frame',
    () => {
      // open floor: the default iso camera turns D into a diagonal, clear of the pillars from here
      g.hero.teleport([0, 0, 10]);
      g.hero.facing = Math.PI / 2;
      e.step(10);
      const p0 = g.hero.feet;
      e.input.setKey('KeyD', true);
      tap('Space');
      e.step(2);
      expect({ state: g.hero.state, anim: g.hero.anim }).toEqual({ state: 'dodge', anim: 'Roll' });
      expect(g.hero.actor.iframes, 'i-frames during the roll').toBeGreaterThan(0);
      e.step(24);
      e.input.setKey('KeyD', false);
      expect(g.hero.feet.distanceTo(p0), 'the roll covers ground').toBeGreaterThan(3);
      e.step(20);
      // attack, then dodge right after the hit frame: the swing is cancelled
      g.hero.teleport([0, 0, 10]);
      g.hero.facing = Math.PI / 2;
      e.step(10);
      tap('KeyJ');
      e.step(10);
      const cancels = g.hero.stats.cancels;
      tap('Space');
      e.step(2);
      expect(g.hero.state).toBe('dodge');
      expect(g.hero.stats.cancels - cancels, 'the dodge cancelled the swing').toBeGreaterThanOrEqual(1);
      e.step(40);
    },
    T,
  );

  it(
    'a fireball (Q) costs mana, flies as a projectile and hits a dummy',
    () => {
      g.hero.teleport([0, 0, 4]);
      g.hero.facing = Math.PI;
      e.step(30);
      const mana0 = g.hero.actor.mana;
      const press = e.frame;
      tap('KeyQ');
      expect(mana0 - g.hero.actor.mana, 'fireball costs mana').toBeGreaterThan(0);
      let flying = 0;
      for (let i = 0; i < 30; i++) {
        e.step(1);
        flying = Math.max(flying, g.combat.active('projectile').length);
      }
      e.step(60);
      expect(flying, 'the fireball flies (a projectile effect)').toBeGreaterThan(0);
      expect(log.filter((l) => l.type === 'hit' && l.frame > press && l.skill === 'fireball' && l.total > 0).length, 'and hits a dummy').toBeGreaterThan(0);
    },
    T,
  );

  it(
    'the left mouse button attacks',
    () => {
      const before = g.hero.stats.attacks;
      e.input.setButtons(1);
      e.step(2);
      e.input.setButtons(0);
      e.step(30);
      expect(g.hero.stats.attacks - before).toBe(1);
    },
    T,
  );

  it(
    'a kill emits kill and death; the corpse pops with particles and is removed after its flicker',
    () => {
      const victim = g.dummies.find((d) => d.alive && d.name === 'dummy')!;
      victim.life = 1;
      victim.brain = null;
      g.hero.teleport([victim.position.x, 0, victim.position.z + 1.4]);
      g.hero.facing = Math.PI;
      e.step(6);
      const from = e.frame;
      e.input.setKey('KeyJ', true);
      e.step(24);
      e.input.setKey('KeyJ', false);
      expect(log.filter((l) => l.type === 'kill' && l.frame >= from).length, 'kill events').toBeGreaterThanOrEqual(1);
      expect(log.filter((l) => l.type === 'death' && l.frame >= from).length, 'death events').toBeGreaterThanOrEqual(1);
      expect(victim.body.position.y > 0.05 || !victim.body.visible, 'the corpse pops').toBe(true);
      expect(e.particles.alive, 'with particles').toBeGreaterThan(0);
      e.step(120);
      expect(g.actors.actors.includes(victim), 'the corpse is removed').toBe(false);
      expect(e.errors).toEqual([]);
    },
    T,
  );
});

describe('the arena with the engine hotkeys on (?debug=1)', () => {
  it(
    'moves the resolution hotkey off R, a skill key, to F2 (mode stays on P)',
    async () => {
      const e = await headlessGame(new Arena(), { debugKeys: true });
      try {
        expect(e.debugKeys.resolution).toEqual(['F2']);
        expect(e.debugKeys.mode).toEqual(['KeyP']);
      } finally {
        e.dispose();
      }
    },
    T,
  );
});
