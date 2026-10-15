import { Group, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '../../engine/snapshot';
import { flag, flat } from '../core/mods';
import { Rng } from '../core/rng';
import type { ActorIndex } from '../core/saved';
import { Actor, type ActorState, type ActorWorld, actorIds, type Brain, setActorIds } from '../actors/Actor';
import { ActorManager, type ActorManagerState } from '../actors/ActorManager';
import { GridMover, type GridMoverState } from '../actors/movers';
import { buildSkill } from '../skills/build';
import type { ResolvedSkill, SupportLink } from '../skills/types';
import { DUMMY_SWAT } from './arena';
import { Combat, type CombatState } from './Combat';
import type { CastOptions } from './deliveries/types';

/**
 * Save-states of a fight (docs/GAME.md, *Save-states*): a scripted fight casts every delivery,
 * the supports that queue repeats, traps (and the Trap support's stand-ins), totems and
 * minions while dummies fight back; at moments through it the whole world is saved, the fight
 * goes on, and the saved moment is loaded (through JSON, as `engine.snapshot` keeps it) into a
 * fresh world built the same way, or into one mid-fight, and played on with the same input:
 * the same world, step for step, and an equal save.
 */
const DT = 1 / 60;
/** Steps played on after each save. */
const ON = 45;

/** A dummy that walks up and swats, or stands back and casts (its skill's gem is not a registry one: it travels whole). */
class DummyBrain implements Brain {
  cooldown: number;
  windup = 0;
  constructor(
    private readonly combat: Combat,
    private readonly skill: ResolvedSkill,
    private readonly ranged: boolean,
    seed: number,
  ) {
    this.cooldown = 0.4 + (seed % 4) * 0.25;
  }

  think(a: Actor, dt: number, world: ActorWorld): void {
    a.velocity.set(0, 0, 0);
    const foe = world.nearest(a.position, 12, (x) => x.alive && a.hostileTo(x));
    if (!foe) return;
    const dx = foe.position.x - a.position.x;
    const dz = foe.position.z - a.position.z;
    const d = Math.hypot(dx, dz);
    a.facing = Math.atan2(dx, dz);
    this.cooldown -= dt * a.actionSpeed;
    if (this.windup > 0) {
      this.windup -= dt * a.actionSpeed;
      if (this.windup <= 0) this.combat.cast(a, this.skill, foe.position.clone());
      return;
    }
    if (!this.ranged && d > a.radius + foe.radius + 0.9) {
      a.velocity.set((dx / d) * a.moveSpeed, 0, (dz / d) * a.moveSpeed);
      return;
    }
    if (this.cooldown <= 0) {
      this.cooldown = this.ranged ? 1.6 : 1.1;
      this.windup = 0.3;
    }
  }

  save(): { cooldown: number; windup: number } {
    return { cooldown: this.cooldown, windup: this.windup };
  }

  load(s: { cooldown: number; windup: number }): void {
    this.cooldown = s.cooldown;
    this.windup = s.windup;
  }
}

interface DummySpec {
  at: [number, number, number];
  life: number;
  skill: 'swat' | 'chaos-bolt' | 'flame-wall';
}
const DUMMIES: readonly DummySpec[] = [
  { at: [0, 0, 4], life: 900, skill: 'swat' },
  { at: [-3, 0, 5], life: 60, skill: 'swat' },
  { at: [3, 0, 5], life: 140, skill: 'swat' },
  { at: [2.5, 0, 9], life: 45, skill: 'chaos-bolt' },
  { at: [-6, 0, 1], life: 300, skill: 'flame-wall' },
  { at: [0, 0, 11], life: 400, skill: 'chaos-bolt' },
  { at: [5, 0, 2], life: 300, skill: 'swat' },
];

/** What the hero does at a step: cast a skill (gem, supports) at a point, with a channel held for some steps. */
interface Move {
  skill: string;
  supports?: SupportLink[];
  at: [number, number, number];
  hold?: number;
  combo?: number;
  /** Cast after the step's actors and effects moved (as a level's hazard does): a minion added then waits for the next step's sort. */
  late?: boolean;
}
const SCRIPT = new Map<number, Move>([
  [0, { skill: 'haste-aura', at: [0, 0, 5] }],
  [2, { skill: 'summon-skeletons', at: [0, 0, 3] }],
  [5, { skill: 'fireball', supports: ['spell-totem'], at: [1, 0, 5] }],
  [8, { skill: 'fire-trap', at: [-2, 0, 5] }],
  [10, { skill: 'fireball', supports: ['trap-support'], at: [2, 0, 4] }],
  [12, { skill: 'vulnerability', at: [0, 0, 5] }],
  [14, { skill: 'cleave', supports: ['multistrike'], at: [0, 0, 4] }],
  [20, { skill: 'fireball', supports: ['spell-echo'], at: [0, 0, 8] }],
  [24, { skill: 'arc', at: [0, 0, 9] }],
  [26, { skill: 'chaos-bolt', supports: ['fork'], at: [2, 0, 9] }],
  [30, { skill: 'frost-nova', at: [0, 0, 4] }],
  [34, { skill: 'meteor', at: [0, 0, 6] }],
  [40, { skill: 'leap-slam', at: [-1, 0, 6] }],
  [80, { skill: 'whirlwind', at: [0, 0, 5], hold: 30 }],
  [120, { skill: 'searing-beam', at: [0, 0, 8], hold: 30 }],
  [160, { skill: 'dash', at: [0, 0, 8] }],
  [175, { skill: 'blink', at: [3, 0, 3] }],
  [182, { skill: 'dodge-roll', at: [0, 0, 0] }],
  [190, { skill: 'flame-wall', at: [0, 0, 6] }],
  [196, { skill: 'raise-spectre', at: [1, 0, 2] }],
  [200, { skill: 'storm-call', at: [0, 0, 7] }],
  [205, { skill: 'rain-of-arrows', at: [1, 0, 7] }],
  [210, { skill: 'explosive-arrow', at: [0, 0, 9] }],
  [215, { skill: 'split-arrow', at: [0, 0, 9] }],
  [220, { skill: 'ice-spear', at: [0, 0, 10] }],
  [226, { skill: 'slash', at: [0, 0, 4], combo: 2 }],
  [232, { skill: 'ground-slam', at: [0, 0, 4] }],
  [238, { skill: 'war-cry', at: [0, 0, 4] }],
  [244, { skill: 'frost-mine', at: [1, 0, 4] }],
  [250, { skill: 'temporal-chains', at: [0, 0, 7] }],
  [256, { skill: 'shield-charge', at: [0, 0, 9] }],
  [262, { skill: 'molten-shell', at: [0, 0, 4] }],
  [270, { skill: 'lightning-arrow', at: [0, 0, 9] }],
  [286, { skill: 'summon-skeletons', at: [0, 0, 2], late: true }],
]);
/** Dummies (by index) struck down at a step: the flame-wall caster dies, crumbles and leaves while its wall burns on. */
const KILLS = new Map<number, number>([[130, 4]]);
/** The moments saved. */
const SAVES = [3, 9, 11, 13, 16, 21, 25, 27, 31, 36, 42, 47, 60, 90, 105, 125, 140, 162, 177, 184, 193, 198, 203, 212, 228, 246, 258, 265, 287, 300, 340];

interface WorldState {
  step: number;
  ids: number;
  manager: ActorManagerState;
  combat: CombatState;
  units: { actor: ActorState; mover: GridMoverState; brain: { cooldown: number; windup: number } | null }[];
}

function world() {
  setActorIds(1);
  const scene = new Group();
  const actors = new ActorManager(undefined, scene);
  const wall = (a: Vector3, b: Vector3) => ((a.x - 7) * (b.x - 7) <= 0 && a.x !== b.x ? (7 - a.x) / (b.x - a.x) : null);
  const combat = new Combat({ actors, scene, wall, rng: new Rng('saved-test') });
  const hero = actors.add(new Actor({ faction: 'hero', base: { mana: 900, 'mana.regen': 6, life: 900, 'life.regen': 0 }, mods: { weapon: [flat('weapon.physical.min', 6), flat('weapon.physical.max', 12)], keystone: [flag('rampage')] }, seed: 'hero' }));
  const dummy = (spec: DummySpec, i: number): Actor => {
    const d = new Actor({ faction: 'monster', at: spec.at, base: { life: spec.life, 'life.regen': 0, evasion: 0, 'move.speed': 2.5 }, seed: `dummy:${i}` });
    const skill = spec.skill === 'swat' ? buildSkill(DUMMY_SWAT, [], d.stats) : buildSkill(spec.skill, [], d.stats);
    d.brain = new DummyBrain(combat, skill, spec.skill !== 'swat', i);
    return d;
  };
  const units: Actor[] = [hero, ...DUMMIES.map((s, i) => actors.add(dummy(s, i)))];
  const w = {
    actors,
    combat,
    hero,
    units,
    step: 0,
    /** The keys held (a channel's `hold`) and the live aim, both input. */
    keys: new Set<string>(),
    aimNow: new Vector3(),
  };
  // the hero's channels are held by named keys; beams follow the live aim (wiring, as the hero controller gives)
  combat.wire(hero, (o) => ({ held: o.hold !== undefined ? () => w.keys.has(o.hold as string) : undefined, aimNow: o.aimNow ? () => w.aimNow : undefined }));

  /** The input of a step: the script's cast (now, or `late` in it), the keys held, the aim. */
  const input = (step: number, late = false): void => {
    if (!late) {
      w.keys.clear();
      for (const [at, m] of SCRIPT) if (m.hold && step >= at && step < at + m.hold) w.keys.add(m.skill);
      w.aimNow.set(Math.sin(step * 0.05) * 4, 0, 6);
      const k = KILLS.get(step);
      if (k !== undefined) units[k + 1]!.die(hero);
    }
    const m = SCRIPT.get(step);
    if (!m || !!m.late !== late) return;
    const skill = buildSkill(m.skill, m.supports ?? [], hero.stats);
    const opts: CastOptions = { combo: m.combo, aimNow: () => w.aimNow, ...(m.hold ? { held: () => w.keys.has(m.skill), hold: m.skill } : {}) };
    combat.cast(hero, skill, new Vector3(...m.at), opts);
  };
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      input(w.step);
      actors.fixedUpdate(DT);
      combat.fixedUpdate(DT);
      input(w.step, true);
      actors.update(DT, 1);
      combat.update(DT);
      w.step++;
    }
  };
  const inWorld = (a: Actor) => actors.actors.includes(a);
  const save = (): WorldState => ({
    step: w.step,
    ids: actorIds(),
    manager: actors.save(),
    combat: combat.save(),
    units: units.filter(inWorld).map((a) => ({ actor: a.save(), mover: (a.mover as GridMover).save(), brain: a.brain ? (a.brain as DummyBrain).save() : null })),
  });
  /**
   * A restore as the game's would run it: combat's own actors made with their ids, the stage's
   * (here: the test's) actors made again when gone and loaded through the index, the world, combat.
   */
  const load = (s: WorldState): void => {
    const index: ActorIndex = combat.index();
    combat.make(s.combat, index);
    for (const u of s.units) {
      let a = units.find((x) => x.id === u.actor.id)!;
      if (!inWorld(a)) {
        const i = units.indexOf(a) - 1;
        setActorIds(a.id);
        a = actors.add(dummy(DUMMIES[i]!, i));
        units[i + 1] = a;
      }
      a.load(u.actor, index);
      (a.mover as GridMover).load(u.mover);
      if (u.brain) (a.brain as DummyBrain).load(u.brain);
    }
    actors.load(s.manager);
    combat.load(s.combat, index);
    setActorIds(s.ids);
    w.step = s.step;
  };
  /** What can be seen: every actor where it is, facing, its life, and what combat runs. */
  const look = () => ({
    actors: actors.actors.map((a) => ({ id: a.id, at: a.position.toArray(), facing: a.facing, life: a.life, mana: a.mana })),
    effects: combat.effects.map((e) => `${e.kind}:${e.caster.id}:${e.skill}`),
    stats: { ...combat.stats },
  });
  return Object.assign(w, { run, save, load, look });
}
type World = ReturnType<typeof world>;

/** Through JSON as a snapshot keeps it (`encodeState` marks Infinity and -0). */
const json = <T>(s: T): T => decodeState(JSON.parse(JSON.stringify(encodeState(s)))) as T;

/** The fight played to each saved moment: its states, and what it looked like `ON` steps later. */
function original(): { saved: Map<number, WorldState>; after: Map<number, { look: unknown; state: unknown }>; w: World } {
  const w = world();
  const saved = new Map<number, WorldState>();
  const after = new Map<number, { look: unknown; state: unknown }>();
  const end = Math.max(...SAVES) + ON;
  while (w.step <= end) {
    if (SAVES.includes(w.step)) saved.set(w.step, json(w.save()));
    const from = w.step - ON;
    if (SAVES.includes(from)) after.set(from, { look: w.look(), state: encodeState(w.save()) });
    w.run(1);
  }
  return { saved, after, w };
}

describe('combat save-states', () => {
  const o = original();

  it('the fight covers every delivery, the queue, totems, minions, trap stand-ins and gone casters', () => {
    const kinds = new Set<string>();
    const made = new Set<string>();
    let queued = 0;
    for (const s of o.saved.values()) {
      for (const e of s.combat.effects) kinds.add(e.kind);
      for (const m of s.combat.actors) made.add(m.kind);
      queued += s.combat.queue.length;
    }
    expect([...kinds].sort()).toEqual(['aura', 'beam', 'curse', 'dash', 'nova', 'projectile', 'slam', 'strike', 'summon', 'totem', 'trap', 'zone']);
    expect([...made].sort()).toEqual(['ghost', 'minion', 'proxy', 'totem']);
    expect(queued).toBeGreaterThan(0);
    expect([...o.saved.values()].some((s) => s.manager.dirty)).toBe(true); // a minion added since the last sort
    expect([...o.saved.values()].some((s) => s.units[0]!.actor.rampage > 0)).toBe(true);
  });

  it('loaded into a fresh world, every saved moment plays on the same: the same world and an equal save', () => {
    for (const [step, s] of o.saved) {
      const w = world();
      w.load(json(s));
      expect(encodeState(w.save()), `just after loading step ${step}`).toEqual(encodeState(s));
      w.run(ON);
      const a = o.after.get(step)!;
      expect(w.look(), `${ON} steps after step ${step}`).toEqual(a.look);
      expect(encodeState(w.save()), `${ON} steps after step ${step}`).toEqual(a.state);
    }
  }, 60_000);

  it('loaded into a world mid-fight, it plays on the same', () => {
    // a world busy with its own fight: repeats queued, a totem, traps, minions, an aura, projectiles in flight
    const busy = () => {
      const w = world();
      w.run(16);
      return w;
    };
    const b = busy().save();
    expect(b.combat.queue.length * b.combat.effects.length).toBeGreaterThan(0);
    for (const [step, s] of o.saved) {
      const w = busy();
      w.load(json(s));
      w.run(ON);
      expect(w.look(), `step ${step} loaded into a busy world`).toEqual(o.after.get(step)!.look);
      expect(encodeState(w.save()), `step ${step} loaded into a busy world`).toEqual(o.after.get(step)!.state);
    }
  }, 60_000);

  it('loaded again and again into the same world as it goes on, it plays on the same', () => {
    const w = o.w;
    for (const step of [...o.saved.keys()].reverse()) {
      w.load(json(o.saved.get(step)!));
      w.run(ON);
      expect(w.look(), `step ${step} loaded mid-fight`).toEqual(o.after.get(step)!.look);
      expect(encodeState(w.save()), `step ${step} loaded mid-fight`).toEqual(o.after.get(step)!.state);
      w.run(7); // and on into the next load
    }
  }, 60_000);

  it('the same state loaded twice gives the same', () => {
    const step = 42;
    const s = json(o.saved.get(step)!);
    const w = world();
    w.run(5);
    w.load(s);
    w.run(10);
    w.load(s);
    w.run(ON);
    expect(encodeState(w.save())).toEqual(o.after.get(step)!.state);
  });

  it('refuses what it cannot make again, saying why', () => {
    const w = world();
    w.combat.cast(w.hero, buildSkill('whirlwind', [], w.hero.stats), new Vector3(0, 0, 4), { held: () => true });
    expect(() => w.combat.save()).toThrow(/held by a closure/);
    const v = world();
    v.combat.cast(v.hero, buildSkill('searing-beam', [], v.hero.stats), new Vector3(0, 0, 4), { held: () => true, hold: 'k', aimNow: () => new Vector3() });
    const s = v.save();
    const fresh = world();
    (fresh.combat as unknown as { wirings: Map<unknown, unknown> }).wirings.clear();
    expect(() => fresh.load(s)).toThrow(/nothing wires them again/);
  });
});
