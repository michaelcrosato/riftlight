// The whole PlatformerCharacter moveset in the Move Playground, headless (third-person camera,
// yaw 0: W = -Z, S = +Z, D = +X, A = -X): each move is driven by keys from a teleport and checked
// on the character's state machine and position. One engine for the file: the moves run in order,
// as e2e `moves` ran them in one page (what stays there: Engine.step and capture in the live page).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Engine } from '../engine';
import type { Playground } from './playground';
import { bootPlayground, type MoveScript } from './testPlayground';

const T_BOOT = 30_000;
const T_MOVE = 10_000;

let engine: Engine;
let game: Playground;
let T: MoveScript;

beforeAll(async () => {
  ({ engine, game, T } = await bootPlayground());
}, T_BOOT);

afterAll(() => {
  expect(engine.errors, 'no hook errors in the whole moveset').toEqual([]);
  engine.dispose();
});

/** The move's verdict, with what it saw when it fails. */
const pass = (ok: boolean, detail: unknown) => expect(ok, JSON.stringify(detail).slice(0, 400)).toBe(true);
const landed = (h: { grounded: boolean; state: string }) => h.grounded && h.state !== 'jump' && h.state !== 'fall';

describe('Move Playground: the moveset', () => {
  it('walk / run', () => {
    T.place([0, 0, 4]);
    T.set(['KeyD'], true);
    const r = T.until((h) => h.state === 'run', 2500);
    T.set(['KeyD'], false);
    pass(r.ok, r.seen);
  }, T_MOVE);

  it('tiptoe / walk modifier', () => {
    T.place([0, 0, 4]);
    T.set(['KeyD', 'ShiftLeft'], true);
    T.wait(700);
    const s = T.snap();
    T.set(['KeyD', 'ShiftLeft'], false);
    pass(s.state === 'walk' && ['Tiptoe', 'Walk'].includes(s.anim), s);
  }, T_MOVE);

  it('skid turn', () => {
    T.place([-4, 0, 6]);
    T.set(['KeyD'], true);
    T.until((h) => h.state === 'run', 2500);
    T.wait(300);
    T.set(['KeyA'], true);
    T.set(['KeyD'], false); // straight into reverse (letting go alone would brake)
    const r = T.until((h) => h.state === 'skid', 800);
    const turned = T.until((h) => Math.sin(h.facing) < -0.7, 1500);
    T.set(['KeyA'], false);
    pass(r.ok && turned.ok, { skid: r.seen, turned: turned.seen });
  }, T_MOVE);

  it('brake to a stop from a run', () => {
    T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true);
    T.until((h) => h.state === 'run' && h.speed > 5.5, 2500);
    T.set(['KeyD'], false);
    const r = T.until((h) => h.state === 'skid', 300);
    const s = T.until((h) => h.state === 'idle', 2000);
    pass(r.ok && s.ok, { brake: r.seen, stop: s.seen });
  }, T_MOVE);

  it('step up stairs', () => {
    T.place([-1.4, 0, 0], -Math.PI / 2);
    T.set(['KeyA'], true);
    const r = T.until((h) => h.feet.y > 1.3, 5000);
    T.set(['KeyA'], false);
    pass(r.ok, { seen: r.seen, feet: T.snap().feet });
  }, T_MOVE);

  it('teeter at edge', () => {
    T.place([-9.9, 1.4, 0], -Math.PI / 2);
    const r = T.until((h) => h.state === 'teeter', 1500);
    pass(r.ok, r.seen);
  }, T_MOVE);

  it('jump + land', () => {
    T.place([0, 0, 4]);
    T.tap('Space');
    const r = T.until((h) => h.state === 'land' || (h.state === 'idle' && h.stats.landings > 0), 2500);
    pass(r.ok && r.seen.includes('jump'), { seen: r.seen, kind: T.snap().jumpKind });
  }, T_MOVE);

  it('double + triple jump', () => {
    T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true);
    T.until((h) => h.state === 'run', 2500);
    const kinds = new Set<string>();
    for (let i = 0; i < 3; i++) {
      T.tap('Space');
      kinds.add(T.snap().jumpKind);
      T.until(landed, 2500);
      kinds.add(T.snap().jumpKind);
    }
    T.set(['KeyD'], false);
    pass(kinds.has('DoubleJump') && kinds.has('TripleJump'), [...kinds]);
  }, T_MOVE);

  it('backflip (crouch + jump)', () => {
    T.place([0, 0, 4]);
    T.set(['KeyC'], true);
    T.frames(6);
    T.tap('Space');
    const k = T.snap().jumpKind;
    const r = T.until(landed, 2500);
    T.set(['KeyC'], false);
    pass(k === 'Backflip' && !r.seen.includes('groundPound'), { k, seen: r.seen });
  }, T_MOVE);

  it('long jump (run + crouch + jump)', () => {
    T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true);
    T.until((h) => h.state === 'run', 2500);
    T.wait(200);
    T.set(['KeyC'], true);
    T.frames(1);
    T.tap('Space');
    const k = T.snap().jumpKind;
    T.set(['KeyC', 'KeyD'], false);
    T.until((h) => h.grounded && h.state !== 'jump', 2500);
    pass(k === 'LongJump', k);
  }, T_MOVE);

  it('side flip (skid + jump)', () => {
    T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true);
    T.until((h) => h.state === 'run', 2500);
    T.wait(300);
    T.set(['KeyA'], true);
    T.set(['KeyD'], false);
    T.until((h) => h.state === 'skid', 800);
    T.tap('Space');
    const k = T.snap().jumpKind;
    T.set(['KeyA'], false);
    T.until((h) => h.grounded && h.state !== 'jump', 2500);
    pass(k === 'SideFlip', k);
  }, T_MOVE);

  it('crouch + crouch walk', () => {
    T.place([0, 0, 4]);
    T.set(['KeyC'], true);
    const a = T.until((h) => h.state === 'crouch' && h.stance === 'crouch', 800);
    T.set(['KeyD'], true);
    const b = T.until((h) => h.state === 'crouchWalk', 800);
    T.set(['KeyD', 'KeyC'], false);
    const c = T.until((h) => h.state === 'idle' && h.stance === 'stand', 1500);
    pass(a.ok && b.ok && c.ok, [a.seen, b.seen, c.seen]);
  }, T_MOVE);

  it('prone + crawl through tunnel', () => {
    T.place([-5.5, 0, 7], -Math.PI / 2);
    T.tap('KeyZ');
    const a = T.until((h) => h.state === 'prone', 1500);
    T.set(['KeyA'], true);
    const b = T.until((h) => h.feet.x < -9.8, 9000);
    const mid = T.snap();
    T.set(['KeyA'], false);
    T.tap('KeyZ');
    const c = T.until((h) => h.state === 'idle', 2000);
    pass(a.ok && b.ok && b.seen.includes('crawl') && c.ok, { a: a.seen, b: b.seen, mid, c: c.seen });
  }, T_MOVE);

  it('stand blocked under tunnel roof', () => {
    T.place([-5.5, 0, 7], -Math.PI / 2);
    T.tap('KeyZ');
    T.until((h) => h.state === 'prone', 1500);
    T.set(['KeyA'], true);
    T.until((h) => h.feet.x < -8, 6000);
    T.set(['KeyA'], false);
    T.tap('KeyZ');
    T.frames(20);
    const s = T.snap();
    pass(s.stance === 'prone', s);
  }, T_MOVE);

  it('lie down + get up', () => {
    T.place([0, 0, 4]);
    T.tap('KeyX');
    const a = T.until((h) => h.state === 'lying', 2500);
    T.tap('KeyX');
    const b = T.until((h) => h.state === 'idle', 2500);
    pass(a.ok && b.ok && b.seen.includes('getUp'), [a.seen, b.seen]);
  }, T_MOVE);

  it('sit + wave', () => {
    T.place([0, 0, 4]);
    T.tap('KeyB');
    const a = T.until((h) => h.state === 'sit', 800);
    T.tap('KeyB');
    T.until((h) => h.state === 'idle', 800);
    T.tap('KeyV');
    const b = T.until((h) => h.state === 'emote', 800);
    pass(a.ok && b.ok, [a.seen, b.seen]);
  }, T_MOVE);

  it('punch, punch, kick combo', () => {
    T.place([0, 0, 4]);
    const clips = new Set<string>();
    for (let i = 0; i < 3; i++) {
      T.tap('KeyJ');
      T.until((h) => {
        clips.add(h.anim);
        return h.state !== 'attack';
      }, 1500);
    }
    T.until((h) => h.state === 'idle', 2000);
    pass(clips.has('Punch') && clips.has('Punch2') && clips.has('Kick'), [...clips]);
  }, T_MOVE);

  it('ledge: jump → hang → pull up', () => {
    T.place([4.8, 0, 0], Math.PI / 2);
    T.set(['KeyD'], true);
    T.tap('Space');
    const a = T.until((h) => h.state === 'hang', 2000);
    T.set(['KeyD'], false);
    T.wait(300);
    T.set(['KeyD'], true);
    T.until((h) => h.state === 'pullUp', 1500);
    T.set(['KeyD'], false);
    const b = T.until((h) => h.state === 'idle' && h.feet.y > 2.7, 3000);
    pass(a.ok && b.ok && b.seen.includes('pullUp'), { a: a.seen, b: b.seen, s: T.snap() });
  }, T_MOVE);

  it('ledge: shimmy + drop', () => {
    T.place([0, 0, -7.4], Math.PI);
    T.set(['KeyW'], true);
    T.tap('Space');
    const a = T.until((h) => h.state === 'hang', 2000);
    T.set(['KeyW'], false);
    T.wait(300);
    const x0 = T.snap().feet[0]!;
    T.set(['KeyD'], true);
    T.wait(900);
    T.set(['KeyD'], false);
    const x1 = T.snap().feet[0]!;
    T.tap('KeyC');
    const b = T.until((h) => h.grounded && h.state !== 'fall' && h.state !== 'hang', 2500);
    pass(a.ok && Math.abs(x1 - x0) > 0.5 && b.ok, { a: a.seen, x0, x1, b: b.seen });
  }, T_MOVE);

  it('climb vine wall and over the top', () => {
    T.place([8, 0, -6.9], Math.PI);
    T.set(['KeyW'], true);
    const a = T.until((h) => h.state === 'climb', 2000);
    T.until((h) => h.state === 'pullUp', 9000);
    T.set(['KeyW'], false);
    const b = T.until((h) => h.state === 'idle' && h.feet.y > 4.3, 3000);
    pass(a.ok && b.ok, { a: a.seen, b: b.seen, s: T.snap() });
  }, T_MOVE);

  it('climb ladder to tower top', () => {
    T.place([-12, 0, -6.8], Math.PI);
    T.set(['KeyW'], true);
    const a = T.until((h) => h.state === 'climb', 2000);
    const b = T.until((h) => h.feet.y > 6.8 && (h.state === 'idle' || h.state === 'walk'), 12000);
    T.set(['KeyW'], false);
    pass(a.ok && b.ok, { a: a.seen, b: b.seen, s: T.snap() });
  }, T_MOVE);

  it('hard landing from the tower', () => {
    T.place([-12, 7, -9.2], Math.PI);
    T.set(['KeyW'], true);
    const r = T.until((h) => h.state === 'hardLand', 5000);
    T.set(['KeyW'], false);
    const b = T.until((h) => h.state === 'idle', 3000);
    pass(r.ok && r.seen.includes('fall') && b.ok, [r.seen, b.seen]);
  }, T_MOVE);

  it('slope slide', () => {
    T.place([10.3, 4.6, -9], Math.PI / 2);
    const r = T.until((h) => h.state === 'slide', 2500);
    const b = T.until((h) => h.feet.y < 0.5 && h.state !== 'slide', 6000);
    pass(r.ok && b.ok, [r.seen, b.seen, T.snap()]);
  }, T_MOVE);

  it('wall kick in the chimney', () => {
    T.place([-5.6, 0, -9], Math.PI / 2);
    T.set(['KeyD'], true);
    T.tap('Space');
    T.until((h) => h.feet.x > -5.3, 1200);
    let kicked = false;
    for (let i = 0; i < 20 && !kicked; i++) {
      T.tap('Space');
      kicked = T.snap().jumpKind === 'WallKick';
    }
    T.set(['KeyD'], false);
    T.until((h) => h.grounded && h.state !== 'jump', 3000);
    pass(kicked, T.snap());
  }, T_MOVE);

  it('wall slide → wall kick', () => {
    T.place([-5.6, 0, -9], Math.PI / 2);
    T.set(['KeyD'], true);
    T.tap('Space');
    const a = T.until((h) => h.state === 'wallSlide', 2000);
    const vy = game.hero.vy;
    T.tap('Space');
    const k = T.snap().jumpKind;
    T.set(['KeyD'], false);
    T.until((h) => h.grounded && h.state !== 'jump', 3000);
    pass(a.ok && vy >= -3.1 && k === 'WallKick', { seen: a.seen, vy, k });
  }, T_MOVE);

  it('lean on a wall (PushIdle)', () => {
    T.place([0, 0, -6.6], Math.PI);
    T.set(['KeyW', 'ShiftLeft'], true);
    const r = T.until((h) => h.state === 'idle' && h.anim === 'PushIdle', 3000);
    T.set(['KeyW', 'ShiftLeft'], false);
    const b = T.until((h) => h.anim === 'Idle', 1000);
    pass(r.ok && b.ok, { a: r.seen, b: b.seen, s: T.snap() });
  }, T_MOVE);

  it('hurt by the spike pad: knockback, stun, invulnerable', () => {
    T.place([9, 0, 12.4], 0);
    const before = game.hurts;
    T.set(['KeyS'], true);
    const r = T.until((h) => h.state === 'hurt', 2000);
    const z0 = T.snap().feet[2]!;
    const inv = game.hero.invulnerable;
    T.wait(300);
    const z1 = T.snap().feet[2]!;
    const still = game.hero.state === 'hurt';
    T.set(['KeyS'], false);
    const b = T.until((h) => h.state === 'idle', 2000);
    pass(r.ok && game.hurts === before + 1 && inv > 1 && still && z1 < z0 - 0.5 && b.ok, { seen: r.seen, z0, z1, inv, still, hurts: game.hurts - before });
  }, T_MOVE);

  it('dive → belly slide → get up', () => {
    T.place([-6, 0, 10], Math.PI / 2);
    T.set(['KeyD'], true);
    T.until((h) => h.state === 'run', 2500);
    T.tap('Space');
    T.until((h) => h.state === 'jump' && h.feet.y > 0.3, 1500);
    T.tap('KeyJ');
    T.set(['KeyD'], false);
    const r = T.until((h) => h.state === 'idle', 5000);
    pass(r.ok && r.seen.includes('dive') && r.seen.includes('bellySlide'), r.seen);
  }, T_MOVE);

  it('ground pound', () => {
    T.place([0, 0, 4]);
    T.tap('Space');
    T.until((h) => h.state === 'jump' && h.vy < 6, 1500);
    T.tap('KeyC');
    T.until((h) => h.state === 'groundPound', 1000);
    const r = T.until((h) => h.state === 'idle', 4000);
    pass(r.ok && r.seen.includes('groundPound') && r.seen.includes('groundPoundLand'), r.seen);
  }, T_MOVE);

  it('push crate', () => {
    T.place([1.3, 0, 0], Math.PI / 2);
    const crate = engine.physics.world.bodies.getAll().find((b) => b.isDynamic() && Math.abs(b.translation().z) < 0.1 && b.translation().x > 2);
    expect(crate, 'the crate by the stairs').toBeDefined();
    const x0 = crate!.translation().x;
    T.set(['KeyD'], true);
    const r = T.until((h) => h.state === 'push', 2000);
    T.wait(1500);
    T.set(['KeyD'], false);
    const x1 = crate!.translation().x;
    pass(r.ok && x1 - x0 > 1, { seen: r.seen, x0, x1 });
  }, T_MOVE);

  it('grab + pull block out of the nook', () => {
    T.place([10.95, 0, 6], Math.PI / 2);
    const block = engine.physics.world.bodies.getAll().find((b) => b.isDynamic() && b.translation().x > 11.5);
    expect(block, 'the block in the nook').toBeDefined();
    const x0 = block!.translation().x;
    T.set(['KeyF'], true);
    const a = T.until((h) => h.state === 'grab', 1500);
    T.set(['KeyA'], true);
    const b = T.until((h) => h.state === 'pull', 1500);
    T.wait(1500);
    T.set(['KeyA', 'KeyF'], false);
    const x1 = block!.translation().x;
    pass(a.ok && b.ok && x0 - x1 > 1, { a: a.seen, b: b.seen, x0, x1 });
  }, T_MOVE);

  it('falls off the island and respawns', () => {
    T.place([15.5, 0, 12], Math.PI / 2);
    const before = game.respawns;
    T.set(['KeyD'], true);
    const r = T.until((h) => h.state === 'fall', 3000);
    T.set(['KeyD'], false);
    T.until(() => game.respawns > before, 5000);
    pass(r.ok && game.respawns > before, r.seen);
  }, T_MOVE);
});
