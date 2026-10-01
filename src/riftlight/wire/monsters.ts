import { type Object3D, Vector3 } from 'three/webgpu';
import type { PaletteColor } from '../../engine/palette';
import { Actor } from '../actors/Actor';
import { StatQuery } from '../combat/stats';
import { flat, more, type Mod } from '../core/mods';
import { Rng } from '../core/rng';
import { type Rank, RANK, SCALING } from '../core/scaling';
import type { ActorLike, Genome, HitResult } from '../core/types';
import type { MonsterBuildOptions, MonsterHandle, MonsterPort, ShellServices, Telegraph } from '../game/ports';
import {
  ARCHETYPES,
  type BossDef,
  BossBrain,
  bossSkills,
  type BrainWorld,
  buildMonster,
  type BuiltMonster,
  createTelegraph,
  ELITE_MODS,
  generateBoss,
  generateGenome,
  genomeTags,
  MONSTER_SKILLS,
  MonsterBrain,
  type MonsterBody,
  type MonsterEvent,
  type MonsterSkillDef,
  MonsterRuntime,
  type TelegraphSpec,
} from '../monsters';
import type { Telegraph as Decal } from '../monsters/telegraph';
import { buildSkill } from '../skills/build';
import type { SkillGem, SkillLook } from '../skills/types';
import { type GridStage, StageMover } from './stage';
import { bossBudget, monsterBase, monsterDepthMods } from './progression';
import { WIRE_TUNING } from './tuning';
import { type CombatWorld, isProp, type Worlds } from './world';

const M = WIRE_TUNING.monster;

/**
 * What a monster needs from the stage it lives in. The level implements it (wire/levels.ts):
 * the grid it walks, the flow field toward the hero, the combat world, a brain world, and a
 * handler for what brains ask the world to do (adds, hazards, auras...).
 */
export interface MonsterHost {
  readonly services: ShellServices;
  readonly world: CombatWorld;
  readonly stage: GridStage;
  readonly depth: number;
  /** True while the level loads: monsters compile every clip now (no hitches later). */
  readonly loading: boolean;
  /** Where telegraph decals go. */
  readonly root: Object3D;
  readonly nav: { direction(x: number, z: number, out: Vector3): Vector3; lineOfSight(a: { x: number; z: number }, b: { x: number; z: number }): boolean } | null;
  readonly brainWorld: BrainWorld;
  heroActor(): Actor | null;
  /** Brains and elite behaviours asking the world for something (wire/hazards.ts). */
  monsterEvent(unit: MonsterUnit, e: MonsterEvent): void;
  /** Animation culling: what the camera looks at. */
  focus(): Vector3;
}

// ---------------------------------------------------------------- data

/**
 * Monster flags as the combat mods they mean (stat names themselves are made canonical by
 * every StatSheet: core/stats.ts).
 */
export function translateMods(mods: readonly Mod[]): Mod[] {
  const out: Mod[] = [];
  for (const m of mods) {
    if (m.stat === 'knockbackImmune') out.push(flat('mass', 50));
    else if (m.stat === 'stunImmune') out.push(flat('avoid.stun', 1), flat('avoid.freeze', 0.5));
    else if (m.stat === 'frontalBlock') out.push({ ...flat('block.chance', 0.3), when: m.when });
    else out.push(m);
  }
  return out;
}

const THEME_WORD: Readonly<Record<string, string>> = {
  fire: 'Cinder', ice: 'Frost', undead: 'Grave', insect: 'Chitin', beast: 'Feral', construct: 'Iron', void: 'Void', storm: 'Storm',
  poison: 'Blight', nature: 'Thorn', blood: 'Blood', earth: 'Stone', shadow: 'Shade', crystal: 'Crystal', arcane: 'Rune', water: 'Tide',
};
const PLAN_WORD: Readonly<Record<string, string>> = {
  biped: 'Stalker', brute: 'Brute', quadruped: 'Hound', hexapod: 'Crawler', serpent: 'Serpent', floater: 'Wisp', blob: 'Ooze', avian: 'Shrike', centipede: 'Centipede',
};

/** "Hasted Cinder Hound": theme word + body word, elite mods in front. */
export function monsterName(g: Genome): string {
  const theme = THEME_WORD[genomeTags(g)[0] ?? ''] ?? 'Rift';
  const body = PLAN_WORD[g.plan] ?? 'Beast';
  const elite = g.elite[0] && ELITE_MODS.has(g.elite[0]) ? `${ELITE_MODS.get(g.elite[0]).name} ` : '';
  return `${g.rank === 'normal' ? '' : elite}${theme} ${body}`;
}

const ELEMENT_LOOK: Readonly<Record<string, SkillLook>> = {
  fire: { color: 'orange', glow: ['sand', 'orange', 'red'], shape: 'orb', trail: 'ember', burst: 'fire', sound: { cast: 'cast', impact: 'explode', hit: 'burn' }, light: { color: 'orange', intensity: 4, radius: 4 }, shake: 0.12 },
  cold: { color: 'cyan', glow: ['white', 'cyan', 'sky'], shape: 'shard', trail: 'frost', burst: 'frost', sound: { cast: 'cast', hit: 'ice' } },
  lightning: { color: 'sand', glow: ['white', 'cyan'], shape: 'bolt', trail: 'spark', burst: 'zap', sound: { cast: 'zap', hit: 'zap' }, light: { color: 'cyan', intensity: 3, radius: 4 } },
  chaos: { color: 'lime', glow: ['lime', 'green'], shape: 'orb', trail: 'toxic', burst: 'toxic', sound: { cast: 'cast', hit: 'hit' } },
  physical: { color: 'red', glow: ['orange', 'red'], shape: 'rock', burst: 'blood', sound: { cast: 'swing', hit: 'hit', impact: 'explode' }, shake: 0.1 },
};

const gems = new Map<string, SkillGem>();
/** A monster skill as a combat gem: its look by element, leaps for pounces, slams at the caster. */
export function monsterGem(def: MonsterSkillDef): SkillGem {
  let g = gems.get(def.id);
  if (g) return g;
  const dmg = def.effects.find((e) => e.kind === 'damage');
  const type = dmg && dmg.kind === 'damage' ? (Object.keys(dmg.base)[0] ?? 'physical') : 'physical';
  const look = ELEMENT_LOOK[type] ?? ELEMENT_LOOK.physical!;
  g = {
    ...def,
    tags: def.tags.includes('damage') ? def.tags : [...def.tags, 'damage'],
    moveDuringCast: 0,
    target: 'self',
    leap: def.role === 'leap' ? { range: def.range + 1, height: 2.2 } : undefined,
    look: def.role === 'area' || def.role === 'leap' ? { ...look, burst: type === 'physical' ? 'impact' : look.burst, shake: 0.25 } : look,
  } as SkillGem;
  gems.set(def.id, g);
  return g;
}

export { bossBudget } from './progression';

/** Bosses picked by the level (designed or generated), found again by genome at build time. */
const BOSS_DEFS = new WeakMap<Genome, BossDef>();
export function registerBoss(def: BossDef): Genome {
  BOSS_DEFS.set(def.genome, def);
  return def.genome;
}

// ---------------------------------------------------------------- the monster

interface Action {
  readonly def: MonsterSkillDef;
  readonly gem: SkillGem;
  t: number;
  readonly windup: number;
  readonly end: number;
  fired: boolean;
  readonly aim: Vector3;
  lockAim: boolean;
  target: ActorLike | null;
  readonly clip: string;
}

/** A live telegraph: the decal plus what the bot and the HUD read. */
export interface LiveTelegraph extends Telegraph {
  readonly decal: Decal | null;
  t: number;
  total: number;
  /** Seconds until it lands (Telegraph.remaining). */
  readonly remaining: number;
}

class TelegraphState implements LiveTelegraph {
  t = 0;
  constructor(
    readonly decal: Decal | null,
    readonly at: Vector3,
    readonly radius: number,
    public total: number,
    readonly kind: 'circle' | 'cone' | 'line',
    readonly source?: ActorLike,
    readonly dir?: { x: number; z: number },
    readonly length?: number,
    readonly width?: number,
  ) {}
  get remaining(): number {
    return Math.max(0, this.total - this.t);
  }
}

/** Build a telegraph decal + state (monsters and hazards share it). */
export function makeTelegraph(root: Object3D, spec: TelegraphSpec, from: Vector3, to: Vector3, seconds: number, color: number, source?: ActorLike): LiveTelegraph {
  const decal = createTelegraph(spec, color, 1);
  let at: Vector3;
  let dir: { x: number; z: number } | undefined;
  if (spec.shape === 'circle') {
    at = to.clone().setY(0);
    decal.object.position.set(at.x, 0.03, at.z);
  } else {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    dir = { x: dx / d, z: dz / d };
    decal.object.position.set(from.x, 0.03, from.z);
    decal.object.rotation.y = Math.atan2(dir.x, dir.z);
    at = spec.shape === 'line' ? new Vector3(from.x + (dir.x * spec.size) / 2, 0, from.z + (dir.z * spec.size) / 2) : from.clone().setY(0);
  }
  root.add(decal.object);
  const radius = spec.shape === 'circle' ? spec.size : spec.shape === 'line' ? spec.size / 2 : spec.size;
  return new TelegraphState(decal, at, radius, seconds, spec.shape, source, dir, spec.size, spec.width);
}

/**
 * A live monster: R4's built body, procedural clips (`MonsterRuntime`) and brain
 * (`MonsterBrain` / `BossBrain`) on an R1 combat `Actor` that walks the level grid. It is the
 * brain's `MonsterBody` (move, face, skills timed to the clip's hit frame, telegraphs, glow,
 * conditions, world events) and the shell's `MonsterHandle`.
 *
 * Skills run on game time: `useSkill` plays the attack clip at the rate that puts its hit
 * frame at the end of the wind-up, and the fixed step fires the skill through combat when the
 * wind-up ends (frame-exact under `Engine.step`). Telegraphed attacks lock their aim when the
 * decal appears, melee locks it late in the swing, so a dodge or a step back makes them miss.
 */
export class MonsterUnit implements MonsterHandle {
  readonly actor: Actor;
  readonly object: Object3D;
  readonly name: string;
  readonly rank: Rank;
  readonly built: BuiltMonster;
  readonly runtime: MonsterRuntime;
  readonly brain: MonsterBrain;
  /** What the brain drives (R4's `MonsterBody`), backed by this unit. */
  readonly body: MonsterBody;
  readonly boss: BossDef | null;
  /** Summoned mid-fight (adds, splits, clones): no loot. */
  readonly add: boolean;
  phase = 0;
  private act: Action | null = null;
  private readonly cds = new Map<string, number>();
  private pending: LiveTelegraph | null = null;
  private tele: LiveTelegraph | null = null;
  private glow = 0;
  private wantFacing: number | null = null;
  private deadT = -1;
  private hitAnimUntil = 0;
  private time = 0;
  private dieAt = -1;
  private readonly mover: StageMover;
  private readonly tmp = new Vector3();
  private readonly flow = new Vector3();
  removed = false;

  constructor(
    readonly genome: Genome,
    readonly host: MonsterHost,
    o: { at: Vector3; depth: number; mods: Readonly<Record<string, readonly Mod[]>>; boss?: BossDef | null; add?: boolean },
  ) {
    this.boss = o.boss ?? null;
    this.add = o.add ?? false;
    const eager = host.loading;
    this.built = this.boss ? buildMonster(this.boss.genome, { eager, extraSkills: bossSkills(this.boss) }) : buildMonster(genome, { eager });
    this.object = this.built.object;
    this.runtime = new MonsterRuntime(this.built);
    this.rank = genome.rank;
    this.name = this.boss?.name ?? monsterName(genome);
    const depth = o.depth;
    const radius = Math.max(0.3, Math.min(1.6, this.built.radius));
    // walls are checked with a slim footprint: every body fits through a 1-cell corridor
    this.mover = new StageMover(host.stage, o.at, Math.min(M.wallRadius, radius * 0.8), () => this.actor.impulse.lengthSq() > 25);
    const mods: Record<string, readonly Mod[]> = { genome: translateMods(this.built.stats), depth: monsterDepthMods(depth) };
    if (this.rank === 'boss') mods.boss = bossBudget(mods.genome ?? []);
    for (const [k, v] of Object.entries(o.mods)) if (v.length) mods[k] = v;
    this.actor = new Actor({
      faction: 'monster',
      name: this.name,
      base: monsterBase(depth, genome.scale, this.add),
      mods,
      level: SCALING.monsterLevel(depth),
      rank: this.rank,
      radius,
      body: this.object,
      mover: this.mover,
      death: 'anim',
      seed: `monster:${genome.seed}:${o.at.x.toFixed(2)}:${o.at.z.toFixed(2)}`,
      tags: this.add ? ['monster', 'add'] : ['monster'],
    });
    this.actor.facing = host.services.rng.range(-Math.PI, Math.PI);
    this.actor.animate = (_a, dt) => this.animate(dt);
    this.actor.brain = { think: (_a, dt) => this.think(dt) };
    this.actor.fx.flash(0); // its own flash materials now (the loading screen), not on the first hit
    this.body = {
      actor: this.actor,
      moveTo: (t, s) => this.moveTo(t, s),
      stop: () => this.stop(),
      face: (t) => this.face(t),
      useSkill: (id, t) => this.useSkill(id, t),
      busy: () => this.busy(),
      cooldown: (id) => this.cooldown(id),
      teleport: (to) => this.teleport(to),
      telegraph: (spec, from, to, seconds) => this.showTelegraph(spec, from, to, seconds),
      setGlow: (k) => this.setGlow(k),
      setCondition: (n, on) => this.setCondition(n, on),
      emit: (e) => this.emit(e),
    };
    const scale = genome.scale;
    const brainOpts = { body: this.body, skills: this.built.skills, home: o.at.clone(), scale: Math.max(0.6, scale), maxLife: this.actor.maxLife };
    this.brain = this.boss ? new BossBrain(this.boss, brainOpts) : new MonsterBrain({ ...brainOpts, archetype: genome.archetype, elite: genome.elite });
    this.object.position.copy(o.at);
    this.object.rotation.y = this.actor.facing;
  }

  // ------------------------------------------------------------- MonsterHandle

  telegraph(): Telegraph | null {
    if (this.tele) return this.tele;
    const a = this.act;
    if (!a || a.fired || !this.actor.alive) return null;
    // an untelegraphed swing: its reach around the monster, for the bot and the HUD
    const reach = (a.def.delivery.kind === 'strike' ? a.def.delivery.range : a.def.range) + this.actor.radius;
    return { at: this.actor.position, radius: reach, remaining: Math.max(0, a.windup - a.t), kind: 'circle', source: this.actor, soft: true };
  }

  /** Live telegraph decal (null between attacks). */
  get liveTelegraph(): LiveTelegraph | null {
    return this.tele;
  }

  fixedUpdate(): void {
    /* the combat world steps the actor (brain → think) */
  }

  update(): void {
    /* the combat world renders the actor (animate) */
  }

  // ------------------------------------------------------------- MonsterBody

  moveTo(target: Vector3, speed = 1): void {
    const a = this.actor;
    if (this.act && !this.act.fired) return void a.velocity.set(0, 0, 0);
    const me = a.position;
    let dx = target.x - me.x;
    let dz = target.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return this.stop();
    dx /= d;
    dz /= d;
    // around walls: the level's flow field toward the hero (where every chase ends up anyway)
    const nav = this.host.nav;
    const hero = this.host.heroActor();
    if (nav && hero && Math.hypot(target.x - hero.position.x, target.z - hero.position.z) < 12 && !nav.lineOfSight(me, target)) {
      nav.direction(me.x, me.z, this.flow);
      if (this.flow.lengthSq() > 1e-4) {
        dx = this.flow.x;
        dz = this.flow.z;
      }
    }
    const v = a.moveSpeed * speed;
    a.velocity.set(dx * v, 0, dz * v);
    this.wantFacing = Math.atan2(dx, dz);
  }

  stop(): void {
    this.actor.velocity.set(0, 0, 0);
  }

  face(target: Vector3): void {
    const p = this.actor.position;
    if (Math.abs(target.x - p.x) + Math.abs(target.z - p.z) < 1e-3) return;
    this.wantFacing = Math.atan2(target.x - p.x, target.z - p.z);
  }

  busy(): boolean {
    return !!this.act || !!this.actor.motion || this.dieAt >= 0;
  }

  cooldown(id: string): number {
    return this.cds.get(id) ?? 0;
  }

  useSkill(id: string, target: ActorLike | Vector3 | null): boolean {
    const a = this.actor;
    if (this.act || !a.alive || a.stopped || a.motion || !MONSTER_SKILLS.has(id)) return false;
    if ((this.cds.get(id) ?? 0) > 0) return false;
    const def = MONSTER_SKILLS.get(id);
    const gem = monsterGem(def);
    const q = new StatQuery(a.stats);
    const speed = Math.max(0.25, q.scale(def.tags.includes('spell') ? 'cast.speed' : 'attack.speed', def.tags));
    const windup = Math.max(0.2, def.castTime / speed);
    const clip = this.runtime.has(def.anim) ? def.anim : this.runtime.has('Bite') ? 'Bite' : 'Idle';
    const info = this.built.clipInfo(clip);
    const len = this.built.clip(clip)?.duration ?? 1;
    const hit = info?.hitTime ?? len * 0.5;
    const rate = hit > 0.01 ? hit / windup : 1;
    const end = windup + Math.max(0.15, (len - hit) / rate);
    const targetActor = target && !(target instanceof Vector3) ? target : null;
    const aim = (targetActor ? targetActor.position : target instanceof Vector3 ? target : a.position).clone();
    const act: Action = { def, gem, t: 0, windup, end, fired: false, aim, lockAim: false, target: targetActor, clip };
    // a telegraph made for this attack this step: the attack lands where it says
    if (this.pending) {
      this.tele?.decal?.dispose();
      this.tele = this.pending;
      this.pending = null;
      this.tele.t = 0;
      this.tele.total = windup + (def.role === 'leap' ? windup * 0.5 : 0);
      act.lockAim = true;
      if (this.tele.kind === 'circle') act.aim.copy(this.tele.at);
      else if (this.tele.dir) act.aim.set(a.position.x + this.tele.dir.x * (this.tele.length ?? 4), 0, a.position.z + this.tele.dir.z * (this.tele.length ?? 4));
    }
    this.act = act;
    this.cds.set(id, def.cooldown);
    a.velocity.set(0, 0, 0);
    this.face(aim);
    a.facing = this.wantFacing ?? a.facing;
    this.runtime.play(clip, { restart: true, rate, fade: 0.08 });
    return true;
  }

  teleport(to: Vector3): void {
    const st = this.host.stage;
    if (!st.walkable(to.x, to.z, false)) return;
    const fx = this.host.services.ctx.particles;
    fx.burst('blink', this.actor.position.clone().setY(0.6));
    this.actor.mover.teleport(to.x, 0, to.z);
    this.actor.position.copy(this.actor.mover.position);
    fx.burst('blink', to.clone().setY(0.6));
  }

  showTelegraph(spec: TelegraphSpec, from: Vector3, to: Vector3, seconds: number): void {
    this.pending?.decal?.dispose();
    const color = this.rank === 'boss' ? 0xb13e53 : 0xef7d57;
    this.pending = makeTelegraph(this.host.root, spec, from, to, seconds, color, this.actor);
  }

  setGlow(amount: number): void {
    this.glow = amount;
  }

  setCondition(name: string, on: boolean): void {
    this.actor.stats.setCondition(name, on);
    if (name === 'enraged' && this.boss) {
      if (on) this.actor.stats.set('enrage', this.boss.enrage.mods);
      else this.actor.stats.remove('enrage');
    }
  }

  emit(e: MonsterEvent): void {
    if (e.type === 'phase' && this.boss) {
      this.phase = e.phase;
      const mods = this.boss.phases[e.phase]?.mods ?? [];
      if (mods.length) this.actor.stats.set('phase', mods);
    }
    if (e.type === 'heal') return void this.actor.heal(e.amount);
    this.host.monsterEvent(this, e);
  }

  // ------------------------------------------------------------- simulation (fixed step)

  /** The actor's brain hook: skills on game time, then the brain decides, then turning. */
  private think(dt: number): void {
    const a = this.actor;
    this.time += dt;
    for (const [id, left] of this.cds) {
      if (left - dt <= 0) this.cds.delete(id);
      else this.cds.set(id, left - dt);
    }
    if (this.dieAt >= 0) {
      a.velocity.set(0, 0, 0);
      if (this.time >= this.dieAt) a.die(null);
      return;
    }
    this.step(dt);
    if (this.host.services.dev().ai) this.brain.update(dt, this.host.brainWorld);
    else a.velocity.set(0, 0, 0);
    if (this.act && !this.act.fired) a.velocity.set(0, 0, 0);
    // turn
    if (this.wantFacing !== null) {
      let d = this.wantFacing - a.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const max = (this.act ? 20 : M.turnRate) * dt;
      a.facing += Math.max(-max, Math.min(max, d));
    }
  }

  private step(dt: number): void {
    const act = this.act;
    const a = this.actor;
    // the telegraph stays until the attack has landed (projectiles and charges travel)
    const tl = this.tele;
    if (tl) {
      tl.t += dt * Math.max(0.1, 1 - a.chill);
      if (tl.t >= tl.total && (!act || act.fired)) {
        tl.decal?.dispose();
        this.tele = null;
      }
    }
    if (!act) return;
    act.t += dt * Math.max(0.1, 1 - a.chill);
    if (!act.fired) {
      // melee follows its target until late in the swing; telegraphed attacks are locked
      if (!act.lockAim && act.target && act.t < act.windup * 0.65) {
        act.aim.copy(act.target.position);
        this.face(act.aim);
      }
      if (act.t >= act.windup) this.fire(act);
    } else if (act.t >= act.end && !a.motion) {
      this.act = null;
      this.glow = 0;
    }
  }

  private fire(act: Action): void {
    act.fired = true;
    const a = this.actor;
    const def = act.def;
    if (this.tele) {
      // keep warning while it flies: a shot's travel time, a charge's run
      const d = def.delivery;
      const dist = Math.hypot(act.aim.x - a.position.x, act.aim.z - a.position.z);
      const extra = d.kind === 'projectile' ? Math.min(d.range, dist) / Math.max(1, d.speed) : d.kind === 'dash' ? def.castTime * 0.8 : 0.05;
      this.tele.total = Math.max(this.tele.total, this.tele.t + extra);
    }
    if (def.role === 'summon') {
      const d = def.delivery;
      this.host.monsterEvent(this, { type: 'summon', at: a.position.clone(), count: d.kind === 'summon' ? d.count : 2 });
      return;
    }
    if (def.role === 'support') {
      for (const b of this.host.world.actors.query(a.position, 6, [], (x) => x.alive && !x.hostileTo(a) && !isProp(x))) {
        for (const e of def.effects) if (e.kind === 'buff') b.addBuff(def.id, e.mods, e.duration);
      }
      this.host.services.ctx.particles.burst('swirl', a.position.clone().setY(0.8), { count: 18 });
      return;
    }
    let skill = buildSkill(act.gem, [], a.stats);
    const role = M.roleDamage[def.role] ?? 1;
    if (role !== 1) skill = { ...skill, mods: [...skill.mods, more('damage', role - 1)] };
    this.host.world.combat.cast(a, skill, act.aim.clone().setY(a.position.y));
    if (def.loopAnim && a.motion) this.runtime.play(def.loopAnim, { fade: 0.06 });
    if (def.selfDestruct) this.dieAt = this.time + 0.12;
  }

  // ------------------------------------------------------------- frame (visuals)

  private animate(dt: number): void {
    const a = this.actor;
    const rt = this.runtime;
    if (!a.alive || a.deadFor >= 0) {
      this.corpse(dt);
      return;
    }
    const f = this.host.focus();
    if (Math.hypot(a.position.x - f.x, a.position.z - f.z) > M.animateRange) return;
    if (this.tele) this.tele.decal?.update(this.tele.total > 0 ? this.tele.t / this.tele.total : 1);
    const act = this.act;
    if (act) {
      if (act.fired && a.motion && act.def.loopAnim) rt.play(act.def.loopAnim, { fade: 0.06 });
      else if (act.fired && act.t >= act.end - 0.05 && !a.motion) rt.locomote(0);
    } else if (a.motion) rt.play(rt.has('Charge') ? 'Charge' : 'Run', { fade: 0.08 });
    else if (this.time >= this.hitAnimUntil) rt.locomote(this.mover.speed);
    const windup = act && !act.fired ? Math.min(1, act.t / Math.max(0.01, act.windup)) : 0;
    rt.setGlow(Math.max(windup * (this.glow || 0.5), 0));
    const target = this.brain.target;
    rt.update(dt, { lookAt: target ? this.tmp.copy(target.position).setY(target.position.y + 1) : null });
  }

  private corpse(dt: number): void {
    if (this.deadT < 0) return;
    this.deadT += dt;
    const len = this.built.clip('Death')?.duration ?? 0.8;
    if (this.deadT < len + M.corpse) this.runtime.update(dt);
    else {
      const s = this.deadT - len - M.corpse;
      const p = this.actor.mover.position;
      this.actor.mover.teleport(p.x, -Math.min(2, s * 1.2) * Math.max(0.5, this.genome.scale), p.z);
      if (s > 1.2) this.actor.gone = true;
    }
  }

  /** A hit landed on this monster (from the world's `hit` listener). */
  onHit(result: HitResult, from: ActorLike | null, tags: readonly string[]): void {
    if (result.total <= 0 || !this.actor.alive) return;
    const src = from?.position ?? this.actor.position;
    this.runtime.flinch(this.tmp.subVectors(this.actor.position, src).setY(0), result.crit ? 1.6 : 1);
    if (!this.act && result.total > this.actor.maxLife * 0.15 && this.runtime.has('Hit')) {
      this.runtime.play('Hit', { restart: true, fade: 0.05 });
      this.hitAnimUntil = this.time + (this.built.clip('Hit')?.duration ?? 0.3);
    }
    this.brain.onHitTaken(result, from, this.host.brainWorld);
    // thorns: melee attackers take some back
    const thorns = this.actor.stats.get('thorns');
    if (thorns > 0 && from && from.alive && tags.includes('melee') && !tags.includes('thorns')) {
      from.takeHit({ source: this.actor, tags: ['thorns', 'physical'], damage: { physical: thorns * SCALING.monsterDamage(this.host.depth) }, crit: false });
    }
  }

  /** This monster's hit landed on someone. */
  onDealt(result: HitResult): void {
    this.brain.onHitDealt(result, this.host.brainWorld);
  }

  /** Died: the Death clip, the brain's last word (pack, elite death effects), then the corpse sinks. */
  onDeath(): void {
    this.act = null;
    this.tele?.decal?.dispose();
    this.tele = null;
    this.pending?.decal?.dispose();
    this.pending = null;
    this.actor.hitStop = 0;
    this.deadT = 0;
    this.runtime.setGlow(0);
    if (this.runtime.has('Death')) this.runtime.play('Death', { fade: 0.08 });
    this.brain.update(0, this.host.brainWorld);
  }

  dispose(): void {
    this.tele?.decal?.dispose();
    this.pending?.decal?.dispose();
    this.runtime.dispose();
    this.object.removeFromParent();
  }
}

// ---------------------------------------------------------------- the port

/** Theme tags for a level's mechanics (palettes and parts lean toward them). */
export const MECHANIC_TAGS: Readonly<Record<string, readonly string[]>> = {
  embers: ['fire'], gloom: ['shadow', 'undead'], gale: ['storm', 'beast'], frostglass: ['ice', 'crystal'], thornweave: ['nature', 'poison'], stormspire: ['storm', 'construct'],
  mire: ['poison', 'water'], echoes: ['arcane'], riftgates: ['void'], bloodmoon: ['blood'], gravewell: ['void', 'crystal'], collapse: ['earth'],
};

export class RealMonsters implements MonsterPort {
  constructor(private readonly worlds: Worlds) {}

  genome(seed: number, depth: number, rank: Rank, archetypes?: readonly string[]): Genome {
    const rng = new Rng(seed);
    const pool = (archetypes ?? []).filter((a) => ARCHETYPES.has(a));
    return generateGenome(rng.fork('genome'), { depth, rank, archetype: pool.length ? rng.fork('archetype').pick(pool) : undefined });
  }

  build(genome: Genome, o: MonsterBuildOptions): MonsterUnit {
    const world = this.worlds.get(o.stage);
    const host = world?.host as MonsterHost | null;
    if (!host) throw new Error('RealMonsters.build: the stage has no monster host (monsters live in levels)');
    let boss: BossDef | null = null;
    if (genome.rank === 'boss') {
      boss = BOSS_DEFS.get(genome) ?? null;
      if (!boss) {
        const g = generateBoss(new Rng(genome.seed).fork('boss'), o.depth, []);
        boss = { ...g, genome };
      }
    }
    const unit = new MonsterUnit(genome, host, { at: o.at, depth: o.depth, mods: o.mods, boss, add: (o as { add?: boolean }).add });
    world!.actors.add(unit.actor);
    return unit;
  }
}

/** XP a kill is worth (the shell's formula), for tools. */
export function killXpOf(level: number, rank: Rank): number {
  return Math.round(SCALING.monsterXp(level) * RANK[rank].xp);
}

/** Palette colour for a rank (labels, minimap). */
export const RANK_COLOR: Readonly<Record<Rank, PaletteColor>> = { normal: 'white', magic: 'sky', rare: 'sand', boss: 'orange' };
