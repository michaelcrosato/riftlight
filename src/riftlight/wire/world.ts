import { type Object3D, Vector3 } from 'three/webgpu';
import type { LightHandle, LightPool as EngineLightPool } from '../../engine/render/lights';
import { Actor } from '../actors/Actor';
import { ActorManager } from '../actors/ActorManager';
import { GridMover } from '../actors/movers';
import { Combat, type WallQuery } from '../combat/Combat';
import type { ActorLike, Hit, HitResult, LightRequest } from '../core/types';
import type { ShellServices, StageWorld } from '../game/ports';

/**
 * The combat world of one stage: one `ActorManager` and one `Combat` shared by the hero,
 * monsters, minions, projectiles and the level's hittable props. Created when a stage is
 * entered (the level port builds one per level, the hero port one for the town) and disposed
 * when it is left, so nothing of a stage outlives it.
 *
 *   const world = new CombatWorld({ services, root: level.root, depth: 3, wall });
 *   worlds.set(stage, world);                    // the hero and monster ports find it by stage
 *   // fixed step: world.fixedUpdate(dt)          (actors: brains, movement, statuses; combat: deliveries)
 *   // frame:      world.update(dt, alpha)        (bodies, effects, claimed lights)
 *
 * Juice flows into the shell: combat's camera shake goes through `services.shake` (which
 * honours the screen-shake setting), its dynamic lights are claimed by the engine's light
 * pool (`ctx.lights`, never an extra PointLight), and hits / kills / deaths go out on the
 * shell's event bus (`services.events`), which the shell turns into damage numbers, XP and
 * the death recap.
 */
export interface CombatWorldOptions {
  readonly services: ShellServices;
  /** Parent for actor bodies and effects (the stage's root). */
  readonly root: Object3D;
  /** Depth stamped on `kill` events (0 in town). */
  readonly depth: number;
  /** Walls between two points (projectiles, line of sight for area hits). */
  readonly wall?: WallQuery;
}

export class CombatWorld {
  readonly actors: ActorManager;
  readonly combat: Combat;
  readonly services: ShellServices;
  /** Monster host of the stage (the level), when it has monsters. */
  host: unknown = null;
  private hero: Actor | null = null;
  private readonly claims: { req: LightRequest; handle: LightHandle; age: number }[] = [];
  private readonly offs: (() => void)[] = [];
  private readonly tmp = new Vector3();
  private disposed = false;

  constructor(o: CombatWorldOptions) {
    this.services = o.services;
    const ctx = o.services.ctx;
    this.actors = new ActorManager(o.services.events, o.root);
    this.actors.depth = o.depth;
    // Claim combat's light requests before Combat sees them: the engine pool drives them, so
    // combat never builds its fallback PointLights (a light-count change recompiles shaders).
    this.offs.push(o.services.events.on('light', (req) => this.claim(req, ctx.lights)));
    this.combat = new Combat({
      actors: this.actors,
      scene: o.root,
      audio: ctx.audio,
      particles: ctx.particles as never,
      wall: o.wall,
      rng: o.services.rng.fork(`combat:${o.depth}`),
      hero: () => this.hero,
    });
    // Combat's trauma becomes the shell's shake (which honours the screen-shake setting).
    this.combat.shake.add = (amount: number) => {
      if (amount > 0) o.services.shake(Math.min(0.55, amount * 0.6), 0.1 + Math.min(0.3, amount * 0.5));
    };
  }

  /** The hero joins this world (stage entry). */
  addHero(actor: Actor): void {
    if (this.hero === actor) return;
    this.hero = actor;
    if (!this.actors.actors.includes(actor)) this.actors.add(actor);
    actor.depth = this.actors.depth;
  }

  /** The hero leaves (without being disposed: it lives on in the next stage). */
  removeHero(): void {
    const h = this.hero;
    if (!h) return;
    const i = this.actors.actors.indexOf(h);
    if (i >= 0) this.actors.actors.splice(i, 1);
    // its effects (channels, auras, projectiles in flight) end with the stage it leaves
    for (let k = this.combat.effects.length - 1; k >= 0; k--) {
      const e = this.combat.effects[k]!;
      if (e.caster === h) {
        e.dispose();
        this.combat.effects.splice(k, 1);
      }
    }
    h.endMotion(true);
    this.hero = null;
  }

  get heroActor(): Actor | null {
    return this.hero;
  }

  /** One fixed step: actors (brains, statuses, movement), then deliveries. */
  fixedUpdate(dt: number): void {
    if (this.disposed) return;
    this.actors.fixedUpdate(dt);
    this.combat.fixedUpdate(dt);
  }

  /** One rendered frame: bodies, effects, claimed lights. */
  update(dt: number, alpha: number): void {
    if (this.disposed) return;
    this.actors.update(dt, alpha);
    this.combat.update(dt);
    this.updateClaims(dt);
  }

  private claim(req: LightRequest, pool: EngineLightPool): void {
    if (req.claimed || this.disposed) return;
    req.claimed = true;
    const p = req.position();
    const handle = pool.request({ position: [p.x, p.y + 1.2, p.z], color: req.color, intensity: req.intensity, radius: req.radius, priority: 3, flicker: 'spell', fadeIn: 0.04, fadeOut: 0.12, name: 'combat' });
    this.claims.push({ req, handle, age: 0 });
  }

  private updateClaims(dt: number): void {
    for (let i = this.claims.length - 1; i >= 0; i--) {
      const c = this.claims[i]!;
      c.age += dt;
      const r = c.req;
      const done = (r.duration > 0 && c.age >= r.duration) || (r.alive ? !r.alive() : r.duration <= 0);
      if (done) {
        c.handle.release();
        this.claims.splice(i, 1);
        continue;
      }
      const fade = r.duration > 0 ? Math.min(1, (r.duration - c.age) / (r.duration * 0.3)) : 1;
      c.handle.position.copy(r.position()).add(this.tmp.set(0, 1.2, 0));
      c.handle.update({ intensity: r.intensity * fade });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.removeHero();
    for (const off of this.offs) off();
    for (const c of this.claims) c.handle.release();
    this.claims.length = 0;
    this.actors.clear();
    this.combat.dispose();
    this.disposed = true;
  }
}

/** Which combat world belongs to which stage (shared by the hero, level and monster ports). */
export class Worlds {
  private readonly map = new Map<StageWorld, CombatWorld>();

  get(stage: StageWorld): CombatWorld | null {
    return this.map.get(stage) ?? null;
  }

  set(stage: StageWorld, world: CombatWorld): void {
    this.map.set(stage, world);
  }

  delete(stage: StageWorld): void {
    this.map.delete(stage);
  }

  /** Drop every stage that maps to `world`. */
  forget(world: CombatWorld): void {
    for (const [s, w] of this.map) if (w === world) this.map.delete(s);
  }
}

/**
 * A hittable world object (a level `PropTarget`: brazier, pylon) as a combat `Actor`, so the
 * one combat world's queries, strikes, projectiles and novas reach it. It is on the monster
 * side (the hero and its minions hit it, monsters ignore it), never moves, never dies, never
 * emits `hit` (the prop's own `onHit` decides what a hit does) and is skipped by brains.
 */
export class PropActor extends Actor {
  constructor(readonly target: ActorLike) {
    super({ faction: 'monster', name: (target as { kind?: string }).kind ?? 'prop', radius: target.radius, mover: new GridMover({ walkable: () => true }, target.position, target.radius), tags: ['prop'], order: 3, base: { life: 1e9, mass: 1e6 } });
    this.position.copy(target.position);
  }

  override get alive(): boolean {
    return this.target.alive;
  }

  override takeHit(hit: Hit): HitResult {
    return this.target.takeHit(hit);
  }

  override push(): void {
    /* rooted */
  }

  override fixedUpdate(): void {
    this.position.copy(this.target.position);
  }

  override update(): void {
    /* no body */
  }
}

/** True for combat actors that stand in for level props (not monsters). */
export function isProp(a: ActorLike): boolean {
  return a instanceof PropActor;
}
