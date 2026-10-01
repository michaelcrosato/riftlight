import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrthographicCamera, type Object3D, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Physics } from '../../engine/physics/Physics';
import { HERO_CLIPS } from '../../game/hero';
import { inc } from '../core/mods';
import { Combat } from '../combat/Combat';
import { Actor } from './Actor';
import { ActorManager } from './ActorManager';
import { HeroController, type InputLike } from './HeroController';

// The real controller on Rapier with the real hero model (no renderer): input in, state out.

const DT = 1 / 60;

async function heroModel(): Promise<Object3D> {
  const buf = readFileSync(new URL('../../../public/assets/hero.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
  return gltf.scene;
}

/** Keys held and presses queued, like the engine's Input. */
class FakeInput implements InputLike {
  held = new Set<string>();
  queued = new Set<string>();
  axis = { x: 0, y: 0 };
  gamepadConnected = false;
  mouseDelta = { x: 0, y: 0 };
  moveAxis() {
    return this.axis;
  }
  consumeAny(codes: readonly string[]) {
    let hit = false;
    for (const c of codes) if (this.queued.delete(c)) hit = true;
    return hit;
  }
  anyDown(codes: readonly string[]) {
    return codes.some((c) => this.held.has(c));
  }
  press(code: string) {
    this.queued.add(code);
  }
}

async function world(o: { mods?: Parameters<StatsSet>[1] } = {}) {
  const physics = await Physics.create();
  physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [40, 0.5, 40] });
  const actors = new ActorManager();
  const combat = new Combat({ actors });
  const hero = new HeroController({ physics, combat, model: await heroModel(), clips: HERO_CLIPS, at: [0, 0, 0], slots: [{ skill: 'cleave' }, { skill: 'fireball' }] });
  if (o.mods) hero.actor.stats.set('test', o.mods);
  actors.add(hero.actor);
  const input = new FakeInput();
  const camera = { camera: new OrthographicCamera(), groundBasis: () => ({ right: new Vector3(1, 0, 0), forward: new Vector3(0, 0, -1) }) };
  const dummy = (x: number, z: number) => actors.add(new Actor({ faction: 'monster', at: [x, 0, z], base: { life: 1e6, 'life.regen': 0 } }));
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      hero.fixedUpdate({ input, camera }, DT);
      actors.fixedUpdate(DT);
      combat.fixedUpdate(DT);
      physics.world.step();
      actors.update(DT, 1);
      hero.update(DT);
      combat.update(DT);
    }
  };
  step(5);
  return { physics, actors, combat, hero, input, step, dummy };
}
type StatsSet = Actor['stats']['set'];

describe('HeroController', () => {
  it('a press attacks, turns instantly to the aim, and lands on the clip hit frame', async () => {
    const w = await world();
    const d = w.dummy(1.2, 1.2); // 45° to the hero's right; it faces +Z (auto-aim takes a 70° cone)
    w.step(1);
    w.input.press('KeyJ');
    w.step(1);
    expect(w.hero.state).toBe('attack');
    expect(w.hero.facing).toBeCloseTo(Math.PI / 4, 1);
    let frames = 1;
    while (d.counters.hitsTaken === 0 && frames < 40) {
      w.step(1);
      frames++;
    }
    // Slash1: hit at frame 5 of 12, the whole clip in 0.42 s → 0.175 s ≈ 10.5 steps
    expect(frames).toBeGreaterThanOrEqual(10);
    expect(frames).toBeLessThanOrEqual(13);
  });
  it('chains the 3-hit combo on repeated presses and starts over after a pause', async () => {
    const w = await world();
    w.dummy(0, 1.6);
    const clips: string[] = [];
    for (let i = 0; i < 3; i++) {
      w.input.press('KeyJ');
      w.step(4); // past the short blend in
      clips.push(w.hero.anim);
      w.step(i === 2 ? 40 : 15);
    }
    expect(clips).toEqual(['Slash1', 'Slash2', 'Slash3']);
    w.step(60);
    w.input.press('KeyJ');
    w.step(4);
    expect(w.hero.anim).toBe('Slash1');
  });
  it('queues a press made early in an action and plays it when the action allows', async () => {
    const w = await world();
    w.input.press('KeyJ');
    w.step(3);
    w.input.press('KeyQ'); // fireball, pressed mid-swing
    w.step(2);
    expect(w.hero.state).toBe('attack');
    w.step(12); // the swing reaches its cancel point (~15 steps): the queued cast starts
    expect(w.hero.stats.casts).toBe(1);
    expect(w.hero.state).toBe('cast');
    w.step(20); // and releases at its own hit frame
    expect(w.combat.active('projectile').length).toBe(1);
  });
  it('a dodge cancels an attack once its hit frame has passed', async () => {
    const w = await world();
    w.input.press('KeyJ');
    w.step(12); // past the hit frame (~10.5)
    w.input.press('Space');
    w.step(1);
    expect(w.hero.state).toBe('dodge');
    expect(w.hero.actor.iframes).toBeGreaterThan(0);
    expect(w.hero.stats.cancels).toBe(1);
  });
  it('a dodge pressed before the hit frame waits for it (the hit still lands)', async () => {
    const w = await world();
    const d = w.dummy(0, 1.6);
    w.input.press('KeyJ');
    w.step(4);
    w.input.press('Space');
    w.step(1);
    expect(w.hero.state).toBe('attack');
    w.step(9);
    expect(d.counters.hitsTaken).toBe(1);
    expect(w.hero.state).toBe('dodge');
  });
  it('casting slows movement instead of locking it', async () => {
    const w = await world();
    w.input.axis = { x: 1, y: 0 };
    w.step(20);
    const free = w.hero.actor.velocity.length();
    w.input.press('KeyQ');
    w.step(2);
    expect(w.hero.state).toBe('cast');
    const casting = w.hero.actor.velocity.length();
    expect(free).toBeCloseTo(5.6, 1);
    expect(casting).toBeGreaterThan(0.5);
    expect(casting).toBeLessThan(free * 0.5);
  });
  it('attack speed shortens the swing and plays its clip faster', async () => {
    const slow = await world();
    const fast = await world({ mods: [inc('attack.speed', 1)] });
    for (const w of [slow, fast]) {
      w.step(1);
      w.input.press('KeyJ');
    }
    let a = 0;
    let b = 0;
    for (let i = 0; i < 60; i++) {
      slow.step(1);
      fast.step(1);
      if (slow.hero.state === 'attack') a++;
      if (fast.hero.state === 'attack') b++;
    }
    expect(b).toBeLessThan(a * 0.6);
  });
  it('no mana, no cast', async () => {
    const w = await world();
    w.hero.actor.mana = 0;
    w.input.press('KeyQ');
    w.step(2);
    expect(w.hero.state).not.toBe('cast');
    expect(w.hero.feedback?.text).toBe('NO MANA');
  });
});
