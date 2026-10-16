import { Group, type InstancedMesh, type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '../../engine/snapshot';
import type { LightPool, LightRequestOptions } from '../../engine/render/lights';
import { Actor, actorIds, type ActorState, setActorIds } from '../actors/Actor';
import { GridMover } from '../actors/movers';
import { EventBus } from '../core/events';
import { flat } from '../core/mods';
import type { ActorIndex, Vec } from '../core/saved';
import type { Rank } from '../core/scaling';
import type { ActorLike, GameEvents, Hit } from '../core/types';
import { FLOOR, WALL } from './layout/grid';
import { buildLevel, type Level, type LevelState } from './Level';
import { MECHANIC_ORDER } from './mechanics';
import { PropTarget } from './mechanics/common';
import { levelSpec } from './rift';

/**
 * Save-states inside a level (docs/game/save-states.md): a level played by a little bot
 * (it walks a tour of every mechanic element, swings at what is near, monsters spawn as in
 * the game), saved mid-action, played on; the same level built again from its spec with the
 * same id counters, the save loaded, played on the same way: the same moments step for step
 * (actors, events, the level's own state, what the scene shows, the lights it holds) and the
 * same save at the end. Also: loading twice, loading into the level that was played on, and
 * a JSON round trip of the save (`encodeState`, as `engine.snapshot()` does).
 */
const DT = 1 / 60;
const SEED = 11;
const IDS = { actors: 500, props: 2_000_000 };

/** A light pool stand-in: which lights a level holds and how (lights with a lifetime are fire-and-forget, left out). */
class FakeLights {
  readonly live = new Set<FakeLight>();
  request(o: LightRequestOptions): FakeLight {
    const h = new FakeLight(this, o);
    if (!o.lifetime) this.live.add(h);
    return h;
  }
  digest(): string[] {
    return [...this.live].map((h) => `${h.name} ${h.position.toArray().join(',')} ${h.intensity} ${h.radius}`).sort();
  }
}
class FakeLight {
  readonly position = new Vector3();
  intensity = 4;
  radius = 6;
  name = '';
  alive = true;
  constructor(
    private readonly pool: FakeLights,
    o: LightRequestOptions,
  ) {
    this.update(o);
  }
  update(o: LightRequestOptions): this {
    if (o.position) this.position.fromArray(o.position instanceof Vector3 ? o.position.toArray() : o.position);
    if (o.intensity !== undefined) this.intensity = o.intensity;
    if (o.radius !== undefined) this.radius = o.radius;
    if (o.name !== undefined) this.name = o.name;
    return this;
  }
  release(): void {
    this.alive = false;
    this.pool.live.delete(this);
  }
}

interface Spawned {
  readonly x: number;
  readonly z: number;
  readonly rank: Rank;
}
interface Bot {
  wp: number;
  path: number[];
  at: number;
  timer: number;
  swing: number;
  lastSafe: Vec;
  steps: number;
}
interface SimState {
  readonly level: LevelState;
  readonly hero: ActorState;
  readonly monsters: readonly { readonly spawn: Spawned; readonly state: ActorState }[];
  readonly bot: Bot;
  readonly ids: { readonly actors: number; readonly props: number };
}

/** JSON as `engine.snapshot()` keeps it (−0, Infinity and NaN marked). */
const roundTrip = <T>(v: T): T => decodeState(JSON.parse(JSON.stringify(encodeState(v)))) as T;
const text = (v: unknown) => JSON.stringify(encodeState(v));

/** A designed level with a hero, its packs as plain monsters, and a bot that tours every mechanic element. */
class Sim {
  readonly events = new EventBus<GameEvents>();
  readonly lights = new FakeLights();
  readonly level: Level;
  readonly hero: Actor;
  monsters: { spawn: Spawned; actor: Actor }[] = [];
  readonly log: string[] = [];
  bot: Bot;
  private readonly tour: { x: number; z: number }[];

  constructor(
    readonly depth: number,
    /** The mechanic whose elements the tour visits first. */
    readonly focus = '',
  ) {
    setActorIds(IDS.actors);
    PropTarget.setIds(IDS.props);
    const events = this.events;
    this.level = buildLevel(
      levelSpec(depth, SEED),
      { scene: new Group(), events, actors: () => [this.hero, ...this.monsters.map((m) => m.actor)].filter((a) => a?.alive), lights: this.lights as unknown as LightPool, activation: 1e9 },
      {
        spawnMonster: (s) => this.spawn({ x: s.position.x, z: s.position.z, rank: s.rank }),
        applyHit: (target, hit) => {
          const r = target.takeHit(hit);
          if (!(target instanceof Actor)) {
            events.emit('hit', { target, result: r, hit });
            if (r.killed) events.emit('kill', { target, killer: hit.source, rank: 'normal', depth });
          }
          return r;
        },
        teleport: (a, to) => this.place(a, to.x, to.z),
        replaySkill: (_a, skill, o) => this.log.push(`replay ${skill} ${o.damageScale} ${o.at.x},${o.at.z}`),
        dropLoot: (at, o) => this.log.push(`drop ${o.source} ${o.quantity} ${at.x},${at.z}`),
        onFall: (a) => {
          if (a === this.hero) this.place(a, this.bot.lastSafe[0], this.bot.lastSafe[2]);
          else if (a instanceof Actor) a.die(this.hero);
        },
      },
    );
    const L = this.level.layout;
    // Frostglass Edge-ish: most of the hero's kills shatter (Frostglass's random stream at work)
    this.hero = new Actor({ faction: 'hero', base: { life: 1e6, 'life.regen': 0, mana: 100 }, mods: { gear: [flat('shatter.chance', 0.6)] }, mover: new GridMover({ walkable: (x, z) => this.level.isWalkable(x, z) }, this.level.start, 0.35), radius: 0.35 });
    this.hero.events = events;
    events.on('mechanic', ({ id, event, at }) => this.log.push(`${id}:${event}${at ? `@${at.x},${at.z}` : ''}`));
    events.on('kill', ({ target }) => this.log.push(`kill ${target.id}`));
    events.on('levelClear', ({ time }) => this.log.push(`clear ${time}`));
    // the tour: every mechanic element, chest and shrine, then the exit (walked to the nearest floor cell)
    const W = L.width;
    const floorNear = (x: number, z: number) => {
      for (let r = 0; r < 4; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            const cx = Math.floor(x) + dx;
            const cz = Math.floor(z) + dz;
            if (L.cell(cx, cz) === FLOOR) return { x: cx + 0.5, z: cz + 0.5 };
          }
      return { x, z };
    };
    const els = this.level.plan.elements.filter((e) => e.kind !== 'arc');
    const s0 = this.level.start;
    const near = (e: { x: number; z: number }) => Math.hypot(e.x - s0.x, e.z - s0.z);
    const first = els.filter((e) => e.mechanic === focus).sort((a, b) => near(a) - near(b));
    const features = [...this.level.features].sort((a, b) => near(a) - near(b));
    const stops = focus === 'features' ? [...features, ...els] : [...first, ...els.filter((e) => e.mechanic !== focus), ...features];
    this.tour = stops.map((e) => floorNear(e.x, e.z));
    this.tour.push(floorNear(L.exit.x + 0.5, L.exit.z + 0.5));
    void W;
    this.bot = { wp: -1, path: [], at: 0, timer: 0, swing: 0, lastSafe: this.level.start.toArray(), steps: 0 };
  }

  private spawn(s: Spawned): Actor {
    const L = () => this.level.layout;
    const mover = new GridMover({ walkable: (x, z) => L().cell(Math.floor(x), Math.floor(z)) !== WALL }, [s.x, 0, s.z], 0.4);
    const a = new Actor({ faction: 'monster', rank: s.rank, base: { life: s.rank === 'boss' ? 400 : 30, 'life.regen': 0 }, mover, radius: 0.4 });
    a.events = this.events;
    this.monsters.push({ spawn: s, actor: a });
    return a;
  }

  private place(a: ActorLike, x: number, z: number): void {
    if (!(a instanceof Actor)) return void a.position.set(x, 0, z);
    a.mover.teleport(x, 0, z);
    a.position.copy(a.mover.position);
    a.impulse.set(0, 0, 0);
  }

  step(): void {
    const { hero, bot, level } = this;
    bot.steps++;
    // walk the tour along floor paths (the next stop when there, after 20 s, or when out of reach)
    const W = level.layout.width;
    bot.timer += DT;
    if ((!bot.path.length || bot.timer > 20) && bot.wp < this.tour.length) {
      bot.wp++;
      bot.timer = 0;
      const goal = this.tour[bot.wp];
      bot.path = goal ? level.nav.path(hero.position, goal).map((c) => c.z * W + c.x) : [];
      bot.at = 0;
    }
    const cell = bot.path[bot.at];
    if (cell !== undefined) {
      const tx = (cell % W) + 0.5;
      const tz = Math.floor(cell / W) + 0.5;
      const d = Math.hypot(tx - hero.position.x, tz - hero.position.z);
      if (d < 0.25) {
        bot.at++;
        if (bot.at >= bot.path.length) bot.path = [];
      }
      hero.velocity.set(d > 1e-6 ? ((tx - hero.position.x) / d) * 5 : 0, 0, d > 1e-6 ? ((tz - hero.position.z) / d) * 5 : 0);
    } else hero.velocity.set(0, 0, 0);
    // swing at what is near (monsters and props), a cast echoes may record
    bot.swing -= DT;
    if (bot.swing <= 0) {
      bot.swing = 0.4;
      const hit = (): Hit => ({ source: hero, skill: 'slash', tags: ['attack', 'melee'], damage: { physical: 12 }, crit: false });
      for (const { actor } of this.monsters) if (actor.alive && actor.position.distanceTo(hero.position) < 2.2) actor.takeHit(hit());
      for (const t of level.targets()) if (Math.hypot(t.position.x - hero.position.x, t.position.z - hero.position.z) < 2) t.takeHit(hit());
      this.events.emit('skill', { actor: hero, skill: 'slash' });
    }
    hero.fixedUpdate(DT);
    for (const { actor } of this.monsters) actor.fixedUpdate(DT);
    level.fixedUpdate(DT);
    const c = level.layout.cell(Math.floor(hero.position.x), Math.floor(hero.position.z));
    if (c === FLOOR && !level.plan.dynamicFloor[Math.floor(hero.position.z) * W + Math.floor(hero.position.x)]) bot.lastSafe = hero.position.toArray();
    level.update(DT);
  }

  run(steps: number, each?: (k: number) => void): void {
    for (let k = 0; k < steps; k++) {
      this.step();
      each?.(k);
    }
  }

  index(): ActorIndex {
    const by = new Map<number, ActorLike>([[this.hero.id, this.hero]]);
    for (const { actor } of this.monsters) by.set(actor.id, actor);
    for (const t of this.level.targets()) by.set(t.id, t);
    return (id) => (id === null ? null : (by.get(id) ?? null));
  }

  save(): SimState {
    return {
      level: this.level.save(),
      hero: this.hero.save(),
      monsters: this.monsters.map((m) => ({ spawn: m.spawn, state: m.actor.save() })),
      bot: { ...this.bot, path: [...this.bot.path] },
      ids: { actors: actorIds(), props: PropTarget.nextId() },
    };
  }

  /** As the game restores: actors made again with their own ids (those not saved go), states loaded, then the level, then the counters. */
  load(s: SimState): void {
    const have = new Map(this.monsters.map((m) => [m.actor.id, m]));
    this.monsters = [];
    for (const m of s.monsters) {
      const live = have.get(m.state.id);
      if (live) this.monsters.push(live);
      else {
        setActorIds(m.state.id);
        this.spawn(m.spawn);
      }
    }
    const index = this.index();
    for (const [a, st] of [[this.hero, s.hero] as const, ...s.monsters.map((m, i) => [this.monsters[i]!.actor, m.state] as const)]) {
      a.load(st, index);
      a.mover.teleport(a.position.x, a.position.y, a.position.z);
    }
    this.level.load(s.level, index);
    this.bot = { ...s.bot, path: [...s.bot.path], lastSafe: [...s.bot.lastSafe] };
    setActorIds(s.ids.actors);
    PropTarget.setIds(s.ids.props);
  }

  /** What the level shows: every object under its root (name, shown, where, turned, scaled, its colour), the instanced tiles, the lights. */
  scene(): string[] {
    const out: string[] = [];
    this.level.root.traverse((o: Object3D) => {
      const m = o as Mesh & { material?: { color?: { getHexString(): string } } };
      let line = `${o.name}|${o.visible}|${o.position.toArray()}|${o.rotation.toArray().slice(0, 3)}|${o.scale.toArray()}|${m.material?.color?.getHexString?.() ?? ''}`;
      if ((o as InstancedMesh).isInstancedMesh) line += `|${Array.from((o as InstancedMesh).instanceMatrix.array).join(',')}`;
      out.push(line);
    });
    return [...out.sort(), ...this.lights.digest()];
  }

  /** One step's observable state: the actors, the hero's conditions, what happened this step (events, replays, drops). */
  observe(from: number): string {
    const a = (x: Actor) => `${x.id} ${x.position.toArray()} ${x.life} ${x.impulse.toArray()} ${x.alive}`;
    return [a(this.hero), this.hero.stats.save().conditions.join(','), ...this.monsters.map((m) => a(m.actor)), this.log.slice(from).join(';')].join('|');
  }
}

/** Play on `steps`, recording each step (and the level's whole state every 15 steps). */
function playOn(sim: Sim, steps: number): string[] {
  const out: string[] = [];
  let from = sim.log.length;
  sim.run(steps, (k) => {
    out.push(sim.observe(from));
    from = sim.log.length;
    if (k % 15 === 0) out.push(text(sim.level.save()));
  });
  return out;
}

const mech = (level: Level, id: string) => level.mechanics.find((m) => m.def.id === id)!.runtime.save() as Record<string, unknown>;

/** For each mechanic: the moment worth saving (something in flight), read off its saved state. */
const MIDWAY: Record<(typeof MECHANIC_ORDER)[number], (m: Record<string, unknown>, s: { time: number }) => boolean> = {
  embers: (m) => (m.braziers as { lit: boolean; fuse: number }[]).some((b) => !b.lit || b.fuse >= 0),
  gloom: (m) => (m.litCount as number) > 0,
  gale: (m) => (m.pushedAt as unknown[]).length > 0 && (m.gusting as [number, boolean][]).some(([, on]) => on),
  frostglass: (m) => (m.chainUntil as number) > 0 && (m.velocity as unknown[]).length > 0,
  thornweave: (m) => (m.timers as unknown[]).length > 0,
  stormspire: (m) => (m.leaps as unknown[]).length > 0 || (m.over as number[]).some((o) => o > 0),
  mire: (m) => (m.recharge as number[]).some((r) => r > 0),
  echoes: (m) => (m.pending as unknown[]).length > 0,
  riftgates: (m, s) => (m.cooldown as [number, number][]).some(([, t]) => t > s.time),
  bloodmoon: (m) => (m.blasts as unknown[]).length > 0,
  gravewell: (m) => (m.pulsing as boolean[]).some((p) => p),
  collapse: (m) => (m.tiles as number[][]).some((t) => t[1] === 1 || t[1] === 2),
};

/** Play a level until `id` is midway (at most `max` seconds), a few steps on, and save there. */
function midway(depth: number, id: (typeof MECHANIC_ORDER)[number], max = 120): { sim: Sim; snap: SimState } {
  const sim = new Sim(depth, id);
  for (let k = 0; k < max / DT; k++) {
    sim.step();
    if (MIDWAY[id](mech(sim.level, id), sim.level)) break;
  }
  sim.run(3);
  expect(MIDWAY[id](mech(sim.level, id), sim.level), `${id} never got going in ${max} s`).toBe(true);
  return { sim, snap: roundTrip(sim.save()) };
}

const N = 180;

/** What one scene shows and the other doesn't (an empty list on both sides when they are the same). */
function sceneDiff(got: string[], want: string[]): { extra: string[]; missing: string[] } {
  const count = (l: string[]) => l.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const g = count(got);
  const w = count(want);
  const less = (a: Map<string, number>, b: Map<string, number>) => [...a].filter(([k, n]) => n > (b.get(k) ?? 0)).map(([k]) => k.slice(0, 300));
  return { extra: less(g, w), missing: less(w, g) };
}
const NONE = { extra: [], missing: [] };

/** The first step two runs differ at (null when they are the same), with the differing parts. */
function firstDiff(got: string[], want: string[]): { at: number; got: string[]; want: string[] } | null {
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] === want[i]) continue;
    const g = (got[i] ?? '').split(/[|,]/);
    const w = (want[i] ?? '').split(/[|,]/);
    const k = g.findIndex((x, j) => x !== w[j]);
    return { at: i, got: g.slice(Math.max(0, k - 3), k + 6), want: w.slice(Math.max(0, k - 3), k + 6) };
  }
  return null;
}

/** Built again and loaded, loaded twice, loaded into the one played on: the same scene and save at once, the same moments after. */
function restores(a: Sim, snap: SimState, focus: string): void {
  const sceneThen = a.scene();
  const ahead = playOn(a, N);
  const endA = text(a.save());

  // built again from the spec with the entry counters, then the save on top
  const b = new Sim(a.depth, focus);
  b.load(snap);
  expect(sceneDiff(b.scene(), sceneThen)).toEqual(NONE);
  expect(text(b.save())).toBe(text(snap));
  expect(JSON.stringify(firstDiff(playOn(b, N), ahead))).toBe('null');
  expect(text(b.save())).toBe(endA);

  // loading twice (into the one just played on) gives the same
  b.load(snap);
  b.load(snap);
  expect(text(b.save())).toBe(text(snap));
  expect(JSON.stringify(firstDiff(playOn(b, N), ahead))).toBe('null');

  // loading into the level that was played on from the start gives the same
  a.load(snap);
  expect(sceneDiff(a.scene(), sceneThen)).toEqual(NONE);
  expect(text(a.save())).toBe(text(snap));
  expect(JSON.stringify(firstDiff(playOn(a, N), ahead))).toBe('null');
}

describe('a level saved mid-action plays on the same after a rebuild + load', () => {
  MECHANIC_ORDER.forEach((id, i) => {
    it(`${id} (depth ${i + 1})`, () => {
      const { sim, snap } = midway(i + 1, id);
      restores(sim, snap, id);
    }, 30_000);
  });

  it('the level itself: chests and shrines opened, the explored map, the boss dead and the portal open', () => {
    const a = new Sim(1, 'features');
    const kinds = () => a.level.save().opened.map((i) => a.level.features[i]!.kind);
    for (let k = 0; k < 120 / DT && !(kinds().includes('chest') && kinds().includes('shrine')); k++) a.step();
    expect(kinds()).toContain('chest');
    expect(kinds()).toContain('shrine');
    (a.level.boss as Actor).die(a.hero);
    a.run(30);
    const snap = roundTrip(a.save());
    expect(snap.level.portalOpen && snap.level.cleared).toBe(true);
    expect(a.level.timedBuffs(a.hero).some((b) => b.source.startsWith('shrine:'))).toBe(true);
    restores(a, snap, 'features');
  }, 30_000);
});
