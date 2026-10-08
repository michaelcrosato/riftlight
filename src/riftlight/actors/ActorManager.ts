import type { Object3D, Vector3 } from 'three/webgpu';
import { setLookLayer } from '../../engine/render/lookLayer';
import { EventBus } from '../core/events';
import type { Faction, GameEventBus, GameEvents } from '../core/types';
import { Actor, type ActorWorld } from './Actor';

/**
 * Every actor in the level, in update order (hero, then minions, then monsters), with a
 * spatial hash for range queries. Rebuilt every fixed step; queries are cheap enough for
 * hundreds of actors.
 *
 *   const near = actors.query(hero.position, 4);              // anything within 4 m
 *   const foe = actors.nearest(p, 10, (a) => hero.hostileTo(a));
 */
export class ActorManager implements ActorWorld {
  readonly actors: Actor[] = [];
  /** Level depth, stamped on `kill` events. */
  depth = 1;
  time = 0;
  /** Called when an actor is removed (death visuals over, or `remove`). */
  onRemove: ((a: Actor) => void) | null = null;
  private readonly cells = new Map<number, Actor[]>();
  private readonly pool: Actor[][] = [];
  private dirtyOrder = false;

  constructor(
    readonly events: GameEventBus = new EventBus<GameEvents>(),
    /** Where actor bodies go (optional: headless sims leave it null). */
    readonly scene: Object3D | null = null,
    readonly cellSize = 4,
  ) {}

  add<T extends Actor>(actor: T): T {
    actor.events = this.events;
    actor.depth = this.depth;
    this.actors.push(actor);
    this.dirtyOrder = true;
    // characters get the "characters & objects" look (render/look.ts)
    setLookLayer(actor.body, 'actors');
    if (this.scene && !actor.body.parent) this.scene.add(actor.body);
    this.insert(actor);
    return actor;
  }

  remove(actor: Actor): void {
    const i = this.actors.indexOf(actor);
    if (i < 0) return;
    this.actors.splice(i, 1);
    this.onRemove?.(actor);
    actor.dispose();
  }

  get(id: number): Actor | undefined {
    return this.actors.find((a) => a.id === id);
  }

  alive(faction?: Faction): Actor[] {
    return this.actors.filter((a) => a.alive && (!faction || a.faction === faction));
  }

  /** One fixed step for every actor, in order; finished corpses are removed. */
  fixedUpdate(dt: number): void {
    this.time += dt;
    if (this.dirtyOrder) {
      this.actors.sort((a, b) => a.order - b.order || a.id - b.id);
      this.dirtyOrder = false;
    }
    this.rebuild();
    this.separate();
    for (const a of [...this.actors]) a.fixedUpdate(dt, this);
    for (let i = this.actors.length - 1; i >= 0; i--) if (this.actors[i]!.gone) this.remove(this.actors[i]!);
  }

  /** Per rendered frame: bodies, animation, effects. */
  update(dt: number, alpha: number): void {
    for (const a of this.actors) a.update(dt, alpha);
  }

  /**
   * Bodies don't overlap: every overlapping pair gets a push apart (m/s per metre of overlap),
   * shared by mass, applied with the next move. Soft, so crowds flow instead of jamming.
   */
  private separate(): void {
    const near = this.near;
    for (const a of this.actors) a.separation.set(0, 0, 0);
    for (const a of this.actors) {
      if (!a.alive) continue;
      for (const b of this.query(a.position, a.radius + 1, near)) {
        if (b.id <= a.id || !b.alive) continue;
        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        let d = Math.hypot(dx, dz);
        const overlap = a.radius + b.radius - d;
        if (overlap <= 0) continue;
        if (d < 1e-4) {
          // exactly on top of each other: split along a fixed direction per pair
          dx = Math.cos(a.id * 2.399);
          dz = Math.sin(a.id * 2.399);
          d = 1;
        }
        const ma = Math.max(0.1, a.stats.get('mass') || 1);
        const mb = Math.max(0.1, b.stats.get('mass') || 1);
        const k = (overlap * ActorManager.SEPARATION) / d;
        a.separation.x -= dx * k * (mb / (ma + mb));
        a.separation.z -= dz * k * (mb / (ma + mb));
        b.separation.x += dx * k * (ma / (ma + mb));
        b.separation.z += dz * k * (ma / (ma + mb));
      }
    }
  }

  /** Separation stiffness (m/s per metre of overlap). */
  static SEPARATION = 14;
  private readonly near: Actor[] = [];

  // ------------------------------------------------------------------ spatial hash

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  private insert(a: Actor): void {
    const k = this.key(Math.floor(a.position.x / this.cellSize), Math.floor(a.position.z / this.cellSize));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = this.pool.pop() ?? []));
    list.push(a);
  }

  /** Re-bucket every actor (each fixed step; call it yourself after teleporting many). */
  rebuild(): void {
    for (const list of this.cells.values()) {
      list.length = 0;
      this.pool.push(list);
    }
    this.cells.clear();
    for (const a of this.actors) this.insert(a);
  }

  /** Actors whose body circle touches the circle (`center`, `radius`) on the ground plane, nearest first. */
  query(center: Vector3, radius: number, out: Actor[] = [], filter?: (a: Actor) => boolean): Actor[] {
    out.length = 0;
    const s = this.cellSize;
    const reach = radius + 1.5; // + the largest actor radius we expect
    const x0 = Math.floor((center.x - reach) / s);
    const x1 = Math.floor((center.x + reach) / s);
    const z0 = Math.floor((center.z - reach) / s);
    const z1 = Math.floor((center.z + reach) / s);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const a of list) {
          const dx = a.position.x - center.x;
          const dz = a.position.z - center.z;
          const r = radius + a.radius;
          if (dx * dx + dz * dz <= r * r && (!filter || filter(a))) out.push(a);
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => dist2(a.position, center) - dist2(b.position, center));
    return out;
  }

  nearest(from: Vector3, radius: number, filter: (a: Actor) => boolean): Actor | null {
    return this.query(from, radius, [], filter)[0] ?? null;
  }

  /** Living enemies of `actor` within `radius`. */
  enemiesNear(actor: Actor, center: Vector3, radius: number, out: Actor[] = []): Actor[] {
    return this.query(center, radius, out, (a) => a.alive && actor.hostileTo(a));
  }

  /** Remove everything (level unload). */
  clear(): void {
    for (const a of [...this.actors]) this.remove(a);
    this.cells.clear();
  }
}

function dist2(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
