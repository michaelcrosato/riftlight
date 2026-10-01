import { BoxGeometry, type BufferGeometry, type Material, Mesh, type Object3D, OctahedronGeometry, PlaneGeometry, Vector3 } from 'three/webgpu';
import { StatSheet } from '../../core/mods';
import type { Rng } from '../../core/rng';
import { SCALING } from '../../core/scaling';
import type { ActorLike, Faction, Hit, HitResult, LevelRuntimeContext } from '../../core/types';
import { type Cell, FLOOR, flood, type Layout, WALL } from '../layout/grid';
import { pathCorridor } from '../layout/generate';
import type { ElementInit, MechanicElement, MechanicLevel, PlaceContext } from './types';

// ------------------------------------------------------------------ placement

/**
 * Shared placement state for every mechanic of one level. `add` enforces the **bypass
 * guarantee**: an element is accepted only if the exit stays reachable from the start with
 * every element cell (of every mechanic so far) blocked, and it overlaps nothing reserved
 * (the critical path corridor, entrance/exit/boss spots, other elements, solid props).
 */
export class Placement {
  readonly elements: MechanicElement[] = [];
  /** 1 = no element may use this cell. */
  readonly reserved: Uint8Array;
  /** 1 = covered by an element (blocked for the bypass check). */
  readonly blocked: Uint8Array;
  private nextId = 1;
  /** Elements refused because they would break the bypass guarantee (diagnostics). */
  refused = 0;

  constructor(
    readonly layout: Layout,
    readonly clearance: Uint8Array,
  ) {
    const W = layout.width;
    this.reserved = pathCorridor(layout, 1);
    this.blocked = new Uint8Array(W * layout.height);
    for (const s of layout.spots) if (s.tag === 'entrance' || s.tag === 'exit' || s.tag === 'boss' || s.tag === 'treasure' || s.tag === 'shrine') this.reserveAround(s.x, s.z, 1);
  }

  reserveAround(x: number, z: number, r: number): void {
    const l = this.layout;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (l.inBounds(x + dx, z + dz)) this.reserved[(z + dz) * l.width + x + dx] = 1;
  }

  /** Context for one mechanic. */
  context(mechanic: string, combined: readonly string[], rng: Rng, depth: number): PlaceContext {
    const l = this.layout;
    const W = l.width;
    const elements = this.elements;
    const isFree = (x: number, z: number) => l.inBounds(x, z) && l.isFloor(x, z) && !this.reserved[z * W + x] && !this.blocked[z * W + x];
    return {
      layout: l,
      rng,
      depth,
      mechanic,
      combined,
      clearance: this.clearance,
      elements,
      isFree,
      add: (el: ElementInit) => this.add(mechanic, el),
      free: (f = {}) => {
        const out: Cell[] = [];
        for (let z = 0; z < l.height; z++)
          for (let x = 0; x < W; x++) {
            if (!isFree(x, z)) continue;
            const i = z * W + x;
            if (f.minClearance && this.clearance[i]! < f.minClearance) continue;
            const room = l.roomOf[i]!;
            if (f.room !== undefined && room !== f.room) continue;
            if (f.critical !== undefined && (room < 0 || l.rooms[room]!.critical !== f.critical)) continue;
            out.push({ x, z });
          }
        return out;
      },
      rooms: (o = {}) =>
        l.rooms.filter((r) => {
          if (r.tags.includes('start')) return false;
          if (r.tags.includes('boss') && !o.boss) return false;
          if (o.side === false && !r.critical) return false;
          return true;
        }),
      slots: (room) => l.spots.filter((s) => s.tag === 'mechanic' && (room === undefined || s.room === room) && isFree(s.x, s.z)),
      disc: (cx, cz, r) => {
        const out: number[] = [];
        const ir = Math.ceil(r);
        for (let dz = -ir; dz <= ir; dz++)
          for (let dx = -ir; dx <= ir; dx++) {
            if (dx * dx + dz * dz > r * r + 0.01) continue;
            const x = Math.floor(cx) + dx;
            const z = Math.floor(cz) + dz;
            if (l.inBounds(x, z)) out.push(z * W + x);
          }
        return out;
      },
      rect: (x, z, w, h) => {
        const out: number[] = [];
        for (let zz = z; zz < z + h; zz++) for (let xx = x; xx < x + w; xx++) if (l.inBounds(xx, zz)) out.push(zz * W + xx);
        return out;
      },
    };
  }

  /** Accept an element if it keeps the guarantee (see class comment). */
  add(mechanic: string, el: ElementInit): MechanicElement | null {
    const l = this.layout;
    // Only floor cells count; reserved or taken cells refuse the whole element.
    const cells = el.cells.filter((i) => l.cells[i] === FLOOR);
    if (!cells.length) return null;
    for (const i of cells) if (this.reserved[i] || this.blocked[i]) return null;
    for (const i of cells) this.blocked[i] = 1;
    if (!this.bypassHolds()) {
      for (const i of cells) this.blocked[i] = 0;
      this.refused++;
      return null;
    }
    const W = l.width;
    const ci = Math.floor(el.z) * W + Math.floor(el.x);
    const element: MechanicElement = {
      id: this.nextId++,
      mechanic,
      kind: el.kind,
      x: el.x,
      z: el.z,
      cells,
      block: el.block,
      room: el.room ?? l.roomOf[ci] ?? -1,
      data: el.data ?? {},
    };
    this.elements.push(element);
    return element;
  }

  /** The exit is reachable from the start with every element cell blocked. */
  bypassHolds(): boolean {
    return bypassReachable(this.layout, this.blocked);
  }
}

/** Reachability start → exit over floor cells not in `blocked`. */
export function bypassReachable(layout: Layout, blocked: Uint8Array): boolean {
  const W = layout.width;
  const seen = flood(W, layout.height, layout.start, (i) => layout.cells[i] === FLOOR && !blocked[i]);
  return seen[layout.exit.z * W + layout.exit.x] === 1;
}

/** Solid elements turn their cells into walls (pylons, braziers, altars): call after placement. */
export function solidify(layout: Layout, elements: readonly MechanicElement[]): void {
  for (const e of elements) if (e.block === 'solid') for (const i of e.cells) layout.cells[i] = WALL;
}

// ------------------------------------------------------------------ runtime helpers

/** The `MechanicLevel` a mechanic's `install` gets from `buildLevel`. */
export function asMechanicLevel(level: LevelRuntimeContext): MechanicLevel {
  const l = level as MechanicLevel;
  if (typeof l.elementsOf !== 'function') throw new Error('mechanic installed outside buildLevel: needs a MechanicLevel context');
  return l;
}

/** Cell index of an actor (or -1 outside the grid). */
export function cellIndexOf(layout: Layout, p: Vector3): number {
  const x = Math.floor(p.x);
  const z = Math.floor(p.z);
  return layout.inBounds(x, z) ? z * layout.width + x : -1;
}

/** Set of cell indices for fast "is the actor in this area" checks. */
export function cellSet(elements: readonly MechanicElement[]): Map<number, MechanicElement> {
  const m = new Map<number, MechanicElement>();
  for (const e of elements) for (const c of e.cells) m.set(c, e);
  return m;
}

/** Damage a mechanic deals at `depth` (`SCALING.hazardDamage`: a step behind the monsters of that depth). */
export function mechanicDamage(depth: number, base: number): number {
  return Math.round(base * SCALING.hazardDamage(depth));
}

/** Damage that kills-or-nearly-kills a normal monster of that depth (explosions, shatters). */
export function monsterScaleDamage(depth: number, base: number): number {
  return Math.round(base * SCALING.monsterLife(depth));
}

// ------------------------------------------------------------------ mechanic affixes

/**
 * How loot and passives bend a mechanic: the level reads these off the hero's StatSheet (the
 * affixes and uniques in loot/data that name a mechanic). `inc`/`more` stats are multipliers
 * (base 1), flat stats are plain numbers, flags are on/off.
 *
 *   heroScale(hero, 'brazier.damage')   1.6 with "+60% brazier damage"
 *   heroFlat(hero, 'pylon.chain')       3 with Stormspire Conductor
 *   heroHas(hero, 'well.immune')        true with Gravewell Anchor
 */
export function heroScale(hero: ActorLike | null, stat: string): number {
  if (!hero) return 1;
  // (1 + Σinc) × Π(1 + more), the last override wins (as combat's StatQuery.scale)
  let inc = 0;
  let more = 1;
  let over: number | undefined;
  for (const { mod } of hero.stats.explain(stat)) {
    if (mod.kind === 'inc') inc += mod.value;
    else if (mod.kind === 'more') more *= 1 + mod.value;
    else if (mod.kind === 'override') over = mod.value;
  }
  return Math.max(0, over ?? Math.max(0, 1 + inc) * more);
}
export function heroFlat(hero: ActorLike | null, stat: string): number {
  return hero ? hero.stats.get(stat) : 0;
}
export function heroHas(hero: ActorLike | null, stat: string): boolean {
  return !!hero && hero.stats.has(stat);
}
/** Force multiplier from a `<x>.resist` stat (inc): +30% → 0.7× the push, −50% → 1.5×, never below 0 or above 2. */
export function resistFactor(hero: ActorLike | null, stat: string): number {
  return Math.max(0, Math.min(2, 2 - heroScale(hero, stat)));
}

const ZERO_RESULT: HitResult = { total: 0, byType: {}, crit: false, killed: false, ailments: [] };

/**
 * A hittable world object (brazier, pylon, lantern) for combat to target. Neutral faction,
 * one life pool; `onHit` decides what a hit does. Combat should include `level.targets()`.
 */
export class PropTarget implements ActorLike {
  private static next = 1_000_000;
  readonly id = PropTarget.next++;
  readonly faction: Faction = 'neutral';
  readonly stats = new StatSheet();
  readonly position: Vector3;
  life: number;
  mana = 0;
  level = 1;
  constructor(
    readonly kind: string,
    position: Vector3,
    readonly radius: number,
    private readonly onHit: (hit: Hit, self: PropTarget) => boolean,
    life = 1,
  ) {
    this.position = position.clone();
    this.life = life;
  }
  get alive(): boolean {
    return this.life > 0;
  }
  takeHit(hit: Hit): HitResult {
    if (!this.alive) return ZERO_RESULT;
    const took = this.onHit(hit, this);
    return took ? { ...ZERO_RESULT, total: 1 } : ZERO_RESULT;
  }
  push(): void {
    /* rooted */
  }
}

/** Tracks per-actor velocity from position changes (momentum effects: ice, wind). */
export class VelocityTracker {
  private readonly last = new WeakMap<ActorLike, { p: Vector3; v: Vector3 }>();
  velocity(actor: ActorLike, dt: number): Vector3 {
    let s = this.last.get(actor);
    if (!s) {
      s = { p: actor.position.clone(), v: new Vector3() };
      this.last.set(actor, s);
      return s.v;
    }
    if (dt > 0) s.v.subVectors(actor.position, s.p).divideScalar(dt).setY(0);
    s.p.copy(actor.position);
    return s.v;
  }
}

// ------------------------------------------------------------------ visuals

const tileGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
tileGeo.userData.shared = true;
const boxGeo = new BoxGeometry(1, 1, 1);
boxGeo.userData.shared = true;
/** Shared unit octahedron (crystals, orbs). */
export const OctaGeo = new OctahedronGeometry(0.5, 0);
OctaGeo.userData.shared = true;

/** A flat tile over each cell (decals: ice, mud, thorns, crumble cracks), as source meshes to merge. */
export function cellTiles(layout: Layout, cells: Iterable<number>, material: Material, y = 0.02, inset = 0): Mesh[] {
  const out: Mesh[] = [];
  for (const i of cells) {
    const x = i % layout.width;
    const z = (i - x) / layout.width;
    const m = new Mesh(tileGeo, material);
    m.position.set(x + 0.5, y, z + 0.5);
    m.scale.set(1 - inset, 1, 1 - inset);
    m.receiveShadow = true;
    out.push(m);
  }
  return out;
}

/** A box mesh (shared geometry) at a position. */
export function box(material: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): Mesh {
  const m = new Mesh(boxGeo, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function mesh(geometry: BufferGeometry, material: Material, x: number, y: number, z: number, s = 1): Mesh {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  m.scale.setScalar(s);
  m.castShadow = true;
  return m;
}

/** Add objects to the level root, with a name (inspectors). */
export function addTo(root: Object3D, name: string, ...objects: Object3D[]): void {
  for (const o of objects) {
    o.name ||= name;
    root.add(o);
  }
}

/** Distance on the ground plane. */
export function flatDistance(a: Vector3, x: number, z: number): number {
  return Math.hypot(a.x - x, a.z - z);
}

// ------------------------------------------------------------------ placement helpers

/** Grow a random blob of free floor cells from (x, z), up to `size` cells. */
export function growBlob(ctx: PlaceContext, x: number, z: number, size: number): number[] {
  const W = ctx.layout.width;
  const out: number[] = [];
  const seen = new Set<number>();
  const frontier = [z * W + x];
  while (frontier.length && out.length < size) {
    const k = ctx.rng.int(0, frontier.length - 1);
    const i = frontier.splice(k, 1)[0]!;
    if (seen.has(i)) continue;
    seen.add(i);
    const cx = i % W;
    const cz = (i - cx) / W;
    if (!ctx.isFree(cx, cz)) continue;
    out.push(i);
    frontier.push(i + 1, i - 1, i + W, i - W);
  }
  return out;
}

/** World centre of a set of cells. */
export function centroid(cells: readonly number[], width: number): [number, number] {
  let sx = 0;
  let sz = 0;
  for (const i of cells) {
    const x = i % width;
    sx += x + 0.5;
    sz += (i - x) / width + 0.5;
  }
  return [sx / cells.length, sz / cells.length];
}

/** A free cell in a room: a mechanic slot ('M') first, else a random open cell. */
export function slotOrFree(ctx: PlaceContext, room: number, minClearance = 2): Cell | null {
  const slots = ctx.slots(room);
  if (slots.length) return ctx.rng.pick(slots);
  const free = ctx.free({ room, minClearance });
  return free.length ? ctx.rng.pick(free) : null;
}

/** Place `count(room)` elements per room via `tryRoom` (true when one was placed), a few tries each. */
export function perRoom(rooms: readonly { id: number }[], count: (room: { id: number }) => number, tryRoom: (room: number) => boolean): number {
  let placed = 0;
  for (const r of rooms) {
    const want = count(r);
    for (let k = 0, tries = 0; k < want && tries < want * 6; tries++) {
      if (!tryRoom(r.id)) continue;
      k++;
      placed++;
    }
  }
  return placed;
}
