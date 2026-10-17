import { AmbientLight, DirectionalLight, Scene, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { GameContext } from '../../engine';
import { LightPool } from '../../engine/render/lights';
import { decodeState, encodeState } from '../../engine/snapshot';
import { Actor, actorIds, type ActorState, setActorIds } from '../actors/Actor';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import type { GameEvents } from '../core/types';
import type { LevelDeps, ShellServices } from '../game/ports';
import { PropTarget } from '../levels/mechanics/common';
import { levelSpec } from '../levels/rift';
import type { MonsterEvent } from '../monsters';
import { LevelStage, type UnitsState } from './levels';
import { type MonsterUnit, RealMonsters } from './monsters';
import { StageMover } from './stage';
import { isProp, Worlds } from './world';

/**
 * Save-states of a level's monsters and hazards (`LevelStage.saveUnits` / `loadUnits`): a real
 * level built headless, fought into the middle (telegraphs winding up, a boss mid-phase, hazards
 * staged, adds summoned and split, a dev spawn, corpses lying and gone), saved, played on; then
 * that moment loaded into a fresh build of the level, and into the same stage played on (twice),
 * and played on the same way: the same monsters, life, actions, telegraphs and hazards, frame
 * for frame, and the same save.
 *
 * What other pieces of a save keep is kept here by the harness the way the integrator will
 * (the hero, the combat world's clock and order, the run's and combat's random streams, the
 * level's light environment); the level's own runtime (mechanics, globes) stands still in
 * these tests, and combat's effects in flight are left out (the fight is saved when none is in
 * flight, or they hit nothing).
 */

const DT = 1 / 60;

function fakeContext(): GameContext {
  const scene = new Scene();
  const presets = new Map<string, unknown>();
  return {
    scene,
    lights: new LightPool({ size: 8, parent: scene }),
    particles: { presets, register: (n: string, p: unknown) => presets.set(n, p), burst: () => {} },
    audio: { register: () => {}, play: () => {} },
    engine: { sun: new DirectionalLight(), ambient: new AmbientLight(), camera: { focus: new Vector3() }, filters: [], availableFilters: [], setFilters: () => {} },
    physics: { alpha: 1 },
    // faked on purpose: a run and its replays live side by side, each with its own scene and pool;
    // one engine has one of each
  } as unknown as GameContext;
}

interface Rig {
  stage: LevelStage;
  hero: Actor;
  heroMover: StageMover;
  services: ShellServices;
  frame: number;
  /** Scripted play by frame number (the same input on every run). */
  script: (r: Rig, frame: number) => void;
}

/** A moment: the units' save and what the other pieces would keep. */
interface Moment {
  frame: number;
  ids: number;
  units: UnitsState;
  hero: ActorState;
  heroMover: ReturnType<StageMover['save']>;
  actors: ReturnType<LevelStage['world']['actors']['save']>;
  combat: { time: number; stats: LevelStage['world']['combat']['stats']; rng: number };
  shell: number;
  env: { ambient: number; sun: number };
}

async function build(depth: number, script: Rig['script'], o: { ai?: boolean } = {}): Promise<Rig> {
  setActorIds(1);
  PropTarget.setIds();
  const ctx = fakeContext();
  const services = {
    ctx,
    events: new EventBus<GameEvents>(),
    lights: null,
    rng: new Rng(11),
    difficulty: () => ({}),
    difficultyMods: () => [],
    settings: () => ({ damageNumbers: false, lootFilter: 0, screenShake: 0 }),
    dev: () => ({ god: false, ai: o.ai ?? true, hitboxes: false }),
    shake: () => {},
    // as above: one per rig, next to the others
  } as unknown as ShellServices;
  const worlds = new Worlds();
  const deps = { services, monsters: new RealMonsters(worlds), loot: { rollDrops: () => [], spawn: () => [] }, hero: {} } as unknown as LevelDeps;
  const stage = new LevelStage(levelSpec(depth, 7), deps, worlds);
  await stage.load();
  // the level's own runtime is another piece of the save: still here (the flow field follows the hero)
  const level = stage.level as unknown as { fixedUpdate(dt: number): void; update(dt: number): void };
  level.fixedUpdate = () => {};
  level.update = () => {
    stage.level.nav.setTarget(hero.position);
    stage.level.nav.update();
  };
  const globes = stage.globes as unknown as Record<string, () => void>;
  for (const k of ['fixedUpdate', 'update', 'drop']) globes[k] = () => {};
  const boss = stage.units().find((u) => u.boss)!;
  const at = boss.actor.position.clone().add(new Vector3(0, 0, 3));
  for (let r = 0; !stage.walkable(at.x, at.z, false); r += 0.5) at.set(boss.actor.position.x + Math.sin(r) * (3 + r * 0.2), 0, boss.actor.position.z + Math.cos(r) * (3 + r * 0.2));
  const heroMover = new StageMover(stage, at, 0.35);
  const hero = new Actor({ faction: 'hero', name: 'hero', base: { life: 1e7, 'life.regen': 0 }, mover: heroMover, at, radius: 0.35, order: 0 });
  stage.world.addHero(hero);
  stage.level.nav.setTarget(hero.position);
  return { stage, hero, heroMover, services, frame: 0, script };
}

const bossOf = (r: Rig): MonsterUnit | null => r.stage.units().find((u) => u.boss) ?? null;

/** One frame: the script, a fixed step, a rendered frame. */
function step(r: Rig): void {
  r.script(r, r.frame++);
  r.stage.fixedUpdate(DT);
  r.stage.update(DT);
}

const combatOf = (r: Rig) => r.stage.world.combat as unknown as { effects: { dispose(): void }[]; queue: unknown[] };
const quiet = (r: Rig) => combatOf(r).effects.length === 0 && combatOf(r).queue.length === 0;

function take(r: Rig): Moment {
  const c = r.stage.world.combat;
  return {
    frame: r.frame,
    ids: actorIds(),
    units: r.stage.saveUnits(),
    hero: r.hero.save(),
    heroMover: r.heroMover.save(),
    actors: r.stage.world.actors.save(),
    combat: { time: c.time, stats: { ...c.stats }, rng: c.rng.state },
    shell: r.services.rng.state,
    env: { ambient: r.stage.level.env.ambient, sun: r.stage.level.env.sun },
  };
}

/** Back to `m`, as the integrator does it: the units through `loadUnits`, the rest around it. */
function put(r: Rig, m: Moment): void {
  const c = r.stage.world.combat;
  for (const e of combatOf(r).effects) e.dispose();
  combatOf(r).effects.length = 0;
  combatOf(r).queue.length = 0;
  r.frame = m.frame;
  Object.assign(r.stage.level.env, m.env);
  const others = (id: number | null) => (id === r.hero.id ? r.hero : (r.stage.world.actors.actors.find((a) => a.id === id && isProp(a)) ?? null));
  const index = r.stage.loadUnits(m.units, others);
  r.hero.load(m.hero, index);
  r.heroMover.load(m.heroMover);
  r.stage.world.actors.load(m.actors);
  c.time = m.combat.time;
  Object.assign(c.stats, m.combat.stats);
  c.rng.state = m.combat.rng;
  r.services.rng.state = m.shell;
  r.stage.level.nav.setTarget(r.hero.position);
  setActorIds(m.ids);
}

/** What can be seen of the fight in one frame. */
function look(r: Rig): unknown {
  const p = (v: Vector3) => [v.x, v.y, v.z];
  const b = r.stage.boss();
  return {
    hero: [...p(r.hero.position), r.hero.life, r.hero.ailments.length],
    units: r.stage.units().map((u) => {
      const t = u.telegraph();
      return [u.actor.id, ...p(u.actor.position), u.actor.facing, u.actor.life, u.actor.alive, u.actor.gone, u.brain.state, u.brain.action, u.brain.target?.id ?? null, u.runtime.clip, t ? [t.remaining, ...p(t.at)] : null, u.phase];
    }),
    boss: b ? [b.life, b.phase] : null,
    hazards: r.stage.hazards.count,
    telegraphs: r.stage.hazards.telegraphs().map((t) => [t.remaining, t.radius, ...p(t.at)]),
    env: [r.stage.level.env.ambient, r.stage.level.env.sun],
    actors: r.stage.world.actors.actors.map((a) => a.id),
    // the level counts its own monsters by their actors (the dead ones stay dead)
    alive: r.stage.level.monsters().map((a) => a.id),
  };
}

function play(r: Rig, frames: number): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < frames; i++) {
    step(r);
    out.push(look(r));
  }
  return out;
}

/** As `engine.snapshot()` keeps it: JSON, with `-0`, `Infinity` and `NaN` marked. */
const wire = <T>(v: T): T => decodeState(JSON.parse(JSON.stringify(encodeState(v)))) as T;
const exact = (v: unknown) => encodeState(v);

/** Until `ok` holds (or fail after `max` frames). */
function until(r: Rig, ok: (r: Rig) => boolean, max = 1500): void {
  for (let i = 0; i < max; i++) {
    step(r);
    if (ok(r)) return;
  }
  throw new Error(`never reached the moment (frame ${r.frame})`);
}

/**
 * The checks: `a` plays on from `m` (the reference); a fresh build loaded with `m` plays on the
 * same way; then `a` itself (mid-fight, further on) loaded with `m` twice plays on the same way.
 */
async function same(a: Rig, m: Moment, frames: number, fresh: () => Promise<Rig>): Promise<void> {
  const ahead = play(a, frames);
  const saved = a.stage.saveUnits();
  const b = await fresh();
  put(b, wire(m));
  const loaded = exact(b.stage.saveUnits());
  expect(play(b, frames), 'loaded into a fresh build').toEqual(ahead);
  expect(loaded, 'a save just after a load is the one loaded').toEqual(exact(m.units));
  expect(exact(b.stage.saveUnits())).toEqual(exact(saved));
  put(a, wire(m));
  put(a, wire(m));
  const reloaded = exact(a.stage.saveUnits());
  expect(play(a, frames), 'loaded twice into the stage played on').toEqual(ahead);
  expect(reloaded).toEqual(exact(m.units));
  expect(exact(a.stage.saveUnits())).toEqual(exact(saved));
}

/** A boss fight: the hero chips at the boss (its phases), kills what comes near, a dev spawn and a split join in. */
const fight: Rig['script'] = (r, f) => {
  const { stage, hero } = r;
  const boss = bossOf(r);
  if (f % 20 === 0 && boss?.actor.alive) boss.actor.takeHit({ source: hero, tags: ['attack', 'melee'], damage: { physical: boss.actor.maxLife * 0.025 }, crit: false });
  if (f % 45 === 0) {
    const near = stage.units().find((u) => !u.boss && u.actor.alive && u.actor.position.distanceTo(hero.position) < 14);
    near?.actor.takeHit({ source: hero, tags: ['attack', 'spell'], damage: { fire: near.actor.maxLife * 0.6 }, crit: false, ailments: { ignite: 1 } });
  }
  if (f === 560 && boss) stage.spawn(4242, boss.actor.position.clone().add(new Vector3(1.5, 0, 0)), 'magic');
  if (f === 170 && boss) stage.spawnAdds(boss, { count: 3, mode: 'split', scale: 0.6, at: boss.actor.position.clone() });
};

describe('level save-states: monsters and hazards', () => {
  it('a boss fight comes back exactly: mid-phase with telegraphs and adds, a corpse leaving, the boss gone', async () => {
    const depth = 7;
    const a = await build(depth, fight);
    const units = (r: Rig) => r.stage.units();
    // mid-fight: past the first phase, adds alive, a telegraph winding up, hazards staged
    until(a, (r) => r.frame >= 600 && quiet(r) && (bossOf(r)?.phase ?? 0) >= 1 && units(r).some((u) => u.add && u.actor.alive) && units(r).some((u) => u.liveTelegraph && u.liveTelegraph.remaining > 0.2) && r.stage.hazards.count >= 1);
    const m1 = take(a);
    expect(m1.units.units.some((e) => e.made?.add), 'adds made since the build').toBe(true);
    expect(m1.units.units.some((e) => e.made && !e.made.add), 'a dev spawn').toBe(true);
    expect(m1.units.removed.length, 'corpses gone').toBeGreaterThan(0);
    expect(m1.units.units.some((e) => e.state.tele && e.state.act && !e.state.act.fired), 'a telegraphed wind-up').toBe(true);
    await same(a, m1, 240, () => build(depth, fight));
    // a corpse leaving the combat world on the next step (its unit already out of the list)
    until(a, (r) => quiet(r) && r.stage.world.actors.actors.some((x) => x.gone && !units(r).some((u) => u.actor === x)));
    const m2 = take(a);
    expect(m2.units.kept.some((k) => k.inWorld)).toBe(true);
    await same(a, m2, 120, () => build(depth, fight));
    // the boss dead and its corpse gone: its bar still reads it
    until(a, (r) => quiet(r) && !bossOf(r), 3000);
    const m3 = take(a);
    expect(m3.units.kept.some((k) => k.id === m3.units.boss && !k.inWorld)).toBe(true);
    await same(a, m3, 120, () => build(depth, fight));
  }, 300000);

  it('every kind of hazard and staged work comes back mid-way', async () => {
    const depth = 1;
    // monsters stand still (AI off): only the hazards and their adds act
    const events = (r: Rig): [MonsterUnit, MonsterEvent][] => {
      const boss = bossOf(r)!;
      const h = r.hero.position;
      const near = r.stage.units().filter((u) => !u.boss && u.actor.alive).sort((x, y) => x.actor.position.distanceTo(h) - y.actor.position.distanceTo(h));
      const far = [...near].reverse().find((u) => u.actor.position.distanceTo(h) > 24)!;
      const [m1, m2, m3] = near;
      const at = (dx: number, dz: number) => h.clone().add(new Vector3(dx, 0, dz));
      const hz = (id: string, data: Record<string, number | string>): MonsterEvent => ({ type: 'hazard', id, at: h.clone(), data: { delay: 0.6, ...data } });
      return [
        [boss, hz('slamWave', { rings: 3, speed: 6, gap: 1.2, damage: 'physical' })],
        [boss, hz('slamWave', { rings: 2, speed: 4, gap: 2, slow: 0.5 })],
        [boss, hz('echo', { delay: 1.5 })],
        [boss, hz('gust', { force: 6, length: 12 })],
        [boss, hz('pull', { radius: 8, force: 4, duration: 1.5, collapse: 1 })],
        [boss, hz('darkness', { duration: 2 })],
        [boss, hz('beam', { count: 2, length: 8, speed: 0.7, duration: 3 })],
        [boss, hz('nova', { radius: 3, corpses: 1 })],
        [boss, hz('meteor', { count: 3, radius: 1.6, interval: 0.4, damage: 'lightning' })],
        [boss, hz('quake', { tiles: 9, delay: 1 })],
        [boss, hz('portal', {})],
        [boss, hz('summon', { count: 2, archetype: 'swarm' })],
        [boss, hz('hazard', { hazard: 'braziers', delay: 0.3 })],
        [boss, hz('hazard', { hazard: 'pylons', arcs: 2 })],
        [boss, hz('hazard', { hazard: 'ice', radius: 5, duration: 3 })],
        [boss, hz('hazard', { hazard: 'thorns', lines: 3, length: 4, duration: 2 })],
        [boss, hz('hazard', { hazard: 'other' })],
        [far, hz('spiral', { arms: 3, shots: 36, turn: 0.4, damage: 'fire', delay: 0.2 })],
        [m1!, { type: 'summon', at: m1!.actor.position.clone(), count: 2, archetype: 'swarm', scale: 0.8 }],
        [m1!, { type: 'nova', at: at(1, 0), radius: 3, damage: 'fire', ailment: 'ignite' }],
        [m1!, { type: 'aura', radius: 4, effect: 'chill', on: true }],
        [m2!, { type: 'aura', radius: 4, effect: 'empower', on: true }],
        [m2!, { type: 'trail', at: at(-1, 1), damage: 'fire', duration: 3 }],
        [m2!, { type: 'strike', at: at(0, -1), radius: 1.4, delay: 1.1, damage: 'lightning' }],
        [m3!, { type: 'beam', count: 2, length: 6, speed: 0.6, on: true }],
        [m3!, { type: 'pull', at: at(0, 0), radius: 7, force: 6 }],
        [m3!, { type: 'clone', at: m3!.actor.position.clone(), count: 2 }],
        [m3!, { type: 'shield', on: true, amount: 0.75 }],
        [m3!, { type: 'roar', at: m3!.actor.position.clone() }],
        [m3!, { type: 'split', at: m3!.actor.position.clone(), count: 2, scale: 0.65 }],
      ];
    };
    const script: Rig['script'] = (r, f) => {
      if (f === 2) for (const [u, e] of events(r)) r.stage.hazards.handle(u, e);
      if (f === 4) for (const u of r.stage.units().filter((x) => !x.boss && x.actor.alive).slice(0, 2)) u.actor.takeHit({ source: r.hero, tags: ['spell'], damage: { chaos: 1e9 }, crit: false });
    };
    const a = await build(depth, script, { ai: false });
    // staged work still waiting, hazards running
    until(a, (r) => r.frame === 30);
    const m1 = take(a);
    const kinds = (m: Moment) => new Set(m.units.hazards.effects.map((e) => (e.kind === 'later' ? `later:${e.op.op}` : e.kind)));
    const staged = ['adds', 'beams', 'darkness', 'echo', 'gust', 'portal', 'prop', 'pull', 'rings', 'strike', 'strikeNear', 'zone'].map((op) => `later:${op}`);
    for (const k of [...staged, 'aura', 'beams', 'pull', 'strike', 'zone', 'spiral']) expect(kinds(m1).has(k), k).toBe(true);
    expect(m1.units.units.filter((e) => e.made?.add).length, 'summoned, split and cloned adds').toBeGreaterThanOrEqual(5);
    await same(a, m1, 150, () => build(depth, script, { ai: false }));
    // the staged work done: rings rolling, darkness, a spiral mid-way, zones, beams, pulls
    const b = await build(depth, script, { ai: false });
    until(b, (r) => r.frame === 75);
    const m2 = take(b);
    for (const k of ['rings', 'darkness', 'spiral', 'zone', 'beams', 'pull', 'strike']) expect(kinds(m2).has(k), k).toBe(true);
    expect(m2.units.hazards.effects.some((e) => e.kind === 'beams' && e.duration === Infinity), 'an elite beam with no end').toBe(true);
    await same(b, m2, 150, () => build(depth, script, { ai: false }));
  }, 300000);
});
