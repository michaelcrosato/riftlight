import { AmbientLight, DirectionalLight, Group, type Object3D, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { GameContext } from '../../engine';
import type { LightRequestOptions } from '../../engine/render/lights';
import { decodeState, encodeState } from '../../engine/snapshot';
import { Actor, setActorIds } from '../actors/Actor';
import { EventBus } from '../core/events';
import { inc } from '../core/mods';
import { Rng } from '../core/rng';
import type { ActorIndex } from '../core/saved';
import type { ActorLike, GameEvents, Item } from '../core/types';
import { NORMAL } from '../game/difficulty';
import type { HeroPort, LevelDeps, LootPort, ShellServices, StageWorld } from '../game/ports';
import { PropTarget } from '../levels/mechanics/common';
import { levelSpec } from '../levels/rift';
import { rollItem } from '../loot/generate';
import { WorldLoot } from '../loot/world';
import { Globes } from './globes';
import { type LevelStage, RealLevels } from './levels';
import { RealLoot } from './loot';
import { RealMonsters } from './monsters';
import { isProp, Worlds } from './world';

/**
 * Save-states of what a level holds besides its monsters: the stage's runtime
 * (`LevelStage.saveRuntime` / `loadRuntime`), the health globes on the floor and the loot on
 * the ground (`WorldLoot`, `RealLoot`). Each is saved, made again the same way, loaded (also
 * twice, also into the one played on) and played on next to the original.
 */
const DT = 1 / 60;
const roundTrip = <T>(v: T): T => decodeState(JSON.parse(JSON.stringify(encodeState(v)))) as T;
const text = (v: unknown) => JSON.stringify(encodeState(v));

/** A light pool stand-in that knows which lights are held. */
function fakeLights() {
  const live = new Set<{ name: string; position: Vector3; intensity: number }>();
  return {
    live,
    request(o: LightRequestOptions) {
      const h = {
        name: o.name ?? '',
        position: new Vector3(),
        intensity: o.intensity ?? 4,
        update(u: LightRequestOptions) {
          if (u.intensity !== undefined) h.intensity = u.intensity;
          return h;
        },
        release() {
          live.delete(h);
        },
      };
      if (o.position) h.position.fromArray(o.position instanceof Vector3 ? o.position.toArray() : o.position);
      if (!o.lifetime) live.add(h);
      return h;
    },
    digest: () => [...live].map((h) => `${h.name} ${h.position.toArray()} ${h.intensity}`).sort(),
  };
}

/** What the engine gives a game, as far as levels, globes and loot use it headless. */
function context() {
  const lights = fakeLights();
  const camera = new PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 20, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const pressed = new Set<string>();
  const ctx = {
    scene: new Scene(),
    lights,
    particles: { presets: new Map(), register() {}, burst() {} },
    audio: { register() {}, play() {}, playMusic() {} },
    engine: { sun: new DirectionalLight(), ambient: new AmbientLight(), filters: [], availableFilters: [], setFilters() {}, camera: { focus: new Vector3() }, renderer: { resolution: { width: 320, height: 180 } } },
    physics: { alpha: 0 },
    camera: { camera },
    hud: { measure: (t: string) => ({ width: t.length * 4, height: 7 }), rect() {}, text() {} },
    input: { wasPressed: (...codes: string[]) => codes.some((c) => pressed.has(c)), buttonEvents: [] as { down: boolean; code: string; x: number; y: number }[] },
  };
  return { ctx: ctx as unknown as GameContext, lights, pressed, raw: ctx };
}

function services(): ShellServices & { lights: never } {
  const { ctx } = context();
  return {
    ctx,
    events: new EventBus<GameEvents>(),
    lights: null as never,
    rng: new Rng(7),
    difficulty: () => NORMAL,
    difficultyMods: () => [],
    settings: () => ({ damageNumbers: false, lootFilter: 0, screenShake: 0, glyphs: 'auto' }),
    dev: () => ({ god: false, ai: false, hitboxes: false }),
    shake() {},
    hero: () => null,
  };
}

/** The first frame two runs differ at (null when the same), around the first differing character. */
function firstDiff(got: string[], want: string[]): string | null {
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    const g = got[i] ?? '';
    const w = want[i] ?? '';
    if (g === w) continue;
    let k = 0;
    while (g[k] === w[k]) k++;
    return `frame ${i}: …${g.slice(Math.max(0, k - 80), k + 60)}… ≠ …${w.slice(Math.max(0, k - 80), k + 60)}…`;
  }
  return null;
}

/** Everything under a root (name, shown, where), sorted: what a scene shows. */
function scene(root: Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => out.push(`${o.name}|${o.visible}|${o.frustumCulled}|${o.position.toArray()}|${o.rotation.toArray().slice(0, 3)}|${o.scale.toArray()}`));
  return out.sort();
}

// ------------------------------------------------------------------ the stage's runtime

const IDS = { actors: 300, props: 3_000_000 };

async function stage(depth: number): Promise<LevelStage> {
  setActorIds(IDS.actors);
  PropTarget.setIds(IDS.props);
  const worlds = new Worlds();
  const loot = { rollDrops: () => [], spawn: () => [] } as unknown as LootPort;
  const deps: LevelDeps = { services: services(), monsters: new RealMonsters(worlds), loot, hero: {} as HeroPort };
  return (await new RealLevels(worlds).build(levelSpec(depth, 5), deps)) as LevelStage;
}

/** What the stage shows of its own (the level, the globes; the monsters' bodies are theirs). */
const shows = (s: LevelStage) => [...scene(s.level.root), ...s.root.children.filter((o) => o.name.startsWith('globe')).flatMap((o) => scene(o))].sort();

const indexOf = (s: LevelStage): ActorIndex => {
  const by = new Map<number, ActorLike>();
  for (const a of s.world.actors.actors) by.set(a.id, a);
  for (const t of s.level.targets()) by.set(t.id, t);
  return (id) => (id === null ? null : (by.get(id) ?? null));
};

function frames(s: LevelStage, n: number): string[] {
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    s.fixedUpdate(DT);
    s.update(DT);
    out.push(text(s.saveRuntime()));
  }
  return out;
}

describe('LevelStage.saveRuntime / loadRuntime', () => {
  it('keeps the counters, the level, the globes and the props of a level built again', async () => {
    const a = await stage(1);
    expect(() => a.saveRuntime()).not.toThrow();
    // play it a little (no hero, monsters idle): the brazier farthest from the monsters blows, globes drop
    const monsters = a.world.actors.actors.filter((x) => !isProp(x));
    const away = (t: ActorLike) => Math.min(...monsters.map((m) => m.position.distanceTo(t.position)));
    const brazier = [...a.level.targets()].sort((x, y) => away(y) - away(x))[0]!;
    brazier.takeHit({ source: null, tags: ['attack'], damage: { physical: 1 }, crit: false });
    a.globes.drop('boss', a.level.start.clone().add(new Vector3(2, 0, 0)));
    monsters.at(-1)!.die(null); // a kill (counted, globes maybe)
    const prop = a.world.actors.actors.find(isProp)!;
    (prop as Actor).addBuff('hexed', [inc('damage.taken', 0.2)], 60); // something on a prop's combat actor
    frames(a, 30);
    a.globes.drop('boss', a.level.start.clone().add(new Vector3(0, 0, 2)));
    const at = a.saveRuntime();
    expect(at.globes.globes.length).toBeGreaterThan(0);
    expect(at.warmFrames).toBe(0);
    expect(at.killed).toBe(1);
    const brazierState = (at.level.mechanics[0]!.state as { braziers: { lit: boolean }[] }).braziers;
    expect(brazierState.some((b) => !b.lit)).toBe(true);
    const snap = roundTrip(at);
    const sceneThen = shows(a);
    const ahead = frames(a, 90);

    const b = await stage(1);
    b.loadRuntime(snap, indexOf(b));
    expect(text(b.saveRuntime())).toBe(text(snap));
    expect(shows(b)).toEqual(sceneThen);
    expect(firstDiff(frames(b, 90), ahead)).toBe(null);

    // twice, and into the stage that was played on
    b.loadRuntime(snap, indexOf(b));
    b.loadRuntime(snap, indexOf(b));
    expect(text(b.saveRuntime())).toBe(text(snap));
    a.loadRuntime(snap, indexOf(a));
    expect(shows(a)).toEqual(sceneThen);
    expect(firstDiff(frames(a, 90), ahead)).toBe(null);
    a.dispose();
    b.dispose();
  }, 30_000);

  it('refuses a stage built with other ids, and one still loading', async () => {
    const a = await stage(1);
    const snap = roundTrip(a.saveRuntime());
    setActorIds(IDS.actors + 7);
    PropTarget.setIds(IDS.props + 7);
    const worlds = new Worlds();
    const deps: LevelDeps = { services: services(), monsters: new RealMonsters(worlds), loot: { rollDrops: () => [], spawn: () => [] } as unknown as LootPort, hero: {} as HeroPort };
    const other = await new RealLevels(worlds).build(levelSpec(1, 5), deps);
    expect(() => (other as LevelStage).loadRuntime(snap, indexOf(other as LevelStage))).toThrow(/not there|prop|actor/);
    a.loading = true;
    expect(() => a.saveRuntime()).toThrow(/loading/);
    expect(() => a.loadRuntime(snap, indexOf(a))).toThrow(/load\(\)/);
    a.dispose();
    other.dispose();
  }, 30_000);
});

// ------------------------------------------------------------------ globes

describe('Globes.save / load', () => {
  const make = () => {
    const root = new Group();
    const globes = new Globes(root, context().ctx, new Rng(3).fork('globes'));
    setActorIds(IDS.actors);
    const hero = new Actor({ faction: 'hero', base: { life: 100, 'life.regen': 0 }, at: [0, 0, -6] });
    hero.life = 20;
    return { root, globes, hero };
  };
  /** The hero walks through the globes; each frame: its life and the globes' state. */
  const walk = (g: ReturnType<typeof make>, n: number, t0: number) => {
    const out: string[] = [];
    for (let k = 0; k < n; k++) {
      g.hero.position.z += 0.05;
      g.globes.fixedUpdate(DT, g.hero);
      g.globes.update(t0 + k * DT);
      out.push(`${g.hero.life} ${text(g.globes.save())}`);
    }
    return out;
  };
  it('the globes on the floor, their ages, bob and blink, and the drop stream', () => {
    const a = make();
    for (const [i, rank] of (['boss', 'rare', 'magic', 'normal', 'boss'] as const).entries()) a.globes.drop(rank, new Vector3(i - 2, 0, i % 2));
    // nobody near for 28 s: the globes blink before they fade
    let t = 0;
    const idle = () => {
      a.globes.fixedUpdate(DT, null);
      a.globes.update((t += DT));
    };
    for (let k = 0; k < 28 / DT; k++) idle();
    while (a.root.children.every((o) => o.visible)) idle();
    const snap = roundTrip(a.globes.save());
    const hero = a.hero.save();
    const sceneThen = scene(a.root);
    const ahead = walk(a, 200, t);
    expect(Number(ahead.at(-1)!.split(' ')[0])).toBeGreaterThan(20); // some were picked up
    a.globes.drop('boss', new Vector3(0, 0, 0));
    const after = a.globes.save();

    const b = make();
    b.globes.drop('normal', new Vector3(9, 0, 9)); // already there: goes
    b.globes.load(snap);
    b.hero.load(hero, () => null);
    expect(scene(b.root)).toEqual(sceneThen);
    expect(firstDiff(walk(b, 200, t), ahead)).toBe(null);
    b.globes.drop('boss', new Vector3(0, 0, 0));
    expect(text(b.globes.save())).toBe(text(after)); // the same stream: the same drops

    a.globes.load(snap);
    a.globes.load(snap);
    a.hero.load(hero, () => null);
    expect(scene(a.root)).toEqual(sceneThen);
    expect(firstDiff(walk(a, 200, t), ahead)).toBe(null);
  });
});

// ------------------------------------------------------------------ loot on the ground

describe('loot on the ground (WorldLoot, RealLoot)', () => {
  const items = (n: number): Item[] => Array.from({ length: n }, (_, i) => rollItem(new Rng(100 + i), { itemLevel: 30, rarity: (['normal', 'magic', 'rare', 'unique'] as const)[i % 4]! }));
  const world = () => {
    const c = context();
    const heroAt = new Vector3(0, 0, -8);
    const picked: string[] = [];
    const w = new WorldLoot(c.ctx, {
      events: new EventBus<GameEvents>(),
      rng: new Rng(1).fork('loot'),
      depth: 8,
      hero: () => heroAt,
      onPickup: (item) => (picked.push(item.uid), true),
      onGold: (n) => picked.push(`${n} gold`),
      lights: { request: (at, color, intensity) => c.lights.request({ position: at, color, intensity, name: 'loot beam' }) },
    });
    return { w, c, heroAt, picked };
  };
  /** The hero walks across the drops (auto-loots gold and orbs, clicked items when near); each frame's state. */
  const walk = (x: ReturnType<typeof world>, n: number) => {
    const out: string[] = [];
    const from = x.picked.length;
    for (let k = 0; k < n; k++) {
      x.heroAt.z += 0.06;
      x.w.update(DT);
      out.push(`${x.picked.slice(from).join(',')} ${text(x.w.saveState())} ${x.c.lights.digest().join(';')}`);
    }
    return out;
  };
  const ground = (w: WorldLoot) => w.drops.map((d) => `${d.id} ${d.item?.uid ?? d.gold} ${d.to.toArray()} ${d.tier} ${d.t} ${!!d.beam} ${!!d.light}`);

  it('WorldLoot: every drop with its id, item, arc, tier, beam and light; a click walking to one', () => {
    const a = world();
    const list = items(8);
    list.forEach((it, i) => a.w.spawn(it, new Vector3(i - 4, 0, i % 3)));
    a.w.spawnGold(37, new Vector3(1, 0, 1));
    a.w.filterEnabled = false;
    walk(a, 40); // they land (rares light up)
    list.slice(0, 2).forEach((it, i) => a.w.spawn(structuredClone(it), new Vector3(i, 0, -3))); // these still fly
    walk(a, 5);
    // click a landed label: too far, so the hero walks to it
    a.w.update(0); // labels drawn
    const target = a.w.drops.find((d) => d.t >= 1 && d.label)!;
    expect(target).toBeTruthy();
    expect(a.w.clickAt(target.label!.x + 1, target.label!.y + 1)).toBe(true);
    const snap = roundTrip(a.w.saveState());
    expect(snap.pending).toBe(target.id);
    expect(snap.drops.some((d) => d.t < 1)).toBe(true);
    expect(snap.drops.some((d) => d.beam !== null && d.light)).toBe(true);
    const heroThen = a.heroAt.clone(); // where the (stand-in) hero stands is the hero's to keep
    const groundThen = ground(a.w);
    const sceneThen = scene(a.w.root);
    const lightsThen = a.c.lights.digest();
    const ahead = walk(a, 240);
    expect(a.picked.length).toBeGreaterThan(0);

    const b = world();
    b.w.spawn(items(1)[0]!, new Vector3(5, 0, 5)); // already on the ground: goes
    b.w.loadState(snap);
    b.heroAt.copy(heroThen);
    expect(ground(b.w)).toEqual(groundThen);
    expect(scene(b.w.root)).toEqual(sceneThen);
    expect(b.c.lights.digest()).toEqual(lightsThen);
    expect(text(b.w.saveState())).toBe(text(snap));
    expect(firstDiff(walk(b, 240), ahead)).toBe(null);

    // into the one played on, twice
    a.heroAt.copy(heroThen);
    a.w.loadState(snap);
    a.w.loadState(snap);
    expect(scene(a.w.root)).toEqual(sceneThen);
    expect(a.c.lights.digest()).toEqual(lightsThen);
    expect(firstDiff(walk(a, 240), ahead)).toBe(null);
  });

  it('RealLoot: the shell sees the same drops (ids, places, labels, tiers) on the stage built again; refused without a stage', () => {
    const port = () => {
      const s = services();
      const loot = new RealLoot();
      loot.init(s);
      const st: StageWorld = { kind: 'level', root: new Group(), collide() {}, groundY: () => 0, actors: () => [] };
      return { loot, st };
    };
    const a = port();
    const rng = new Rng(9);
    a.loot.spawn([...items(5).map((item) => ({ kind: 'item' as const, item })), { kind: 'gold', amount: 120 }], new Vector3(3, 0, 3), a.st, rng);
    for (let k = 0; k < 40; k++) a.loot.update(DT);
    a.loot.spawn([{ kind: 'item', item: items(3)[2]! }], new Vector3(-3, 0, 1), a.st, rng);
    a.loot.update(DT);
    const view = (l: RealLoot) => l.ground().map((d) => `${d.id} ${d.position.toArray()} ${d.label} ${d.color} ${d.filtered} ${d.tier} ${d.drop.kind}`);
    const snap = roundTrip(a.loot.saveState());
    const seen = view(a.loot);
    expect(seen.length).toBe(7);

    const b = port();
    expect(() => b.loot.loadState(snap)).toThrow(/stage/);
    b.loot.loadState(snap, b.st);
    expect(view(b.loot)).toEqual(seen);
    expect(b.st.root.children).toContain(b.loot.world!.root.parent);
    expect(text(b.loot.saveState())).toBe(text(snap));
    // pick one up on both: the same item leaves both grounds
    const take = (l: RealLoot) => {
      const d = l.ground().find((x) => x.drop.kind === 'gold')!;
      return l.pickup(d);
    };
    expect(take(b.loot)).toEqual(take(a.loot));
    expect(view(b.loot)).toEqual(view(a.loot));
  });
});
