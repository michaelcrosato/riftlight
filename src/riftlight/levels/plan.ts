import { inc, more, type Mod } from '../core/mods';
import { Registry, type Entry } from '../core/registry';
import { Rng } from '../core/rng';
import { SCALING, type Rank } from '../core/scaling';
import type { LevelSpec } from '../core/types';
import { resolveTheme } from './designed';
import { generateLayout, pathCorridor } from './layout/generate';
import { clearance, FLOOR, type Layout, WALL } from './layout/grid';
import { Placement, solidify } from './mechanics/common';
import { MECHANICS } from './mechanics';
import type { MechanicElement } from './mechanics/types';
import { PROPS } from './themes/props';
import type { LevelTheme } from './themes/themes';

/**
 * A level plan: everything about a level that is data — layout, mechanic elements, props,
 * monster packs, chests and shrines — with no three.js scene, physics or GPU. `buildLevel`
 * turns a plan into a running level; `npm run level` maps and validates plans headless.
 */

export interface PropPlacement {
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly rot: number;
  readonly blocks: boolean;
}

export interface PackMember {
  readonly x: number;
  readonly z: number;
  readonly rank: Rank;
}

export interface Pack {
  readonly id: number;
  readonly room: number;
  readonly archetype: string;
  /** Strongest rank in the pack (map colour, loot expectations). */
  readonly rank: Rank;
  readonly members: readonly PackMember[];
  /**
   * Power budget spent: ranks (normal 1, magic 2.5, rare 5, boss 12) plus `power` for every
   * member (what's left of the pack's budget: the monsters system spends it on bigger
   * bodies, parts and elite mods, so deep packs get stronger, not just bigger).
   */
  readonly cost: number;
  /** Extra power per member for the monster generator. */
  readonly power: number;
}

/** Shrines: buffs as Mods (the one modifier language). */
export interface ShrineDef extends Entry {
  readonly name: string;
  readonly mods: readonly Mod[];
  readonly duration: number;
  readonly color: number;
}

export const SHRINES = new Registry<ShrineDef>('shrine', [
  { id: 'haste', name: 'Shrine of Haste', mods: [inc('move.speed', 0.3), inc('attack.speed', 0.2), inc('cast.speed', 0.2)], duration: 40, color: 0xa7f070 },
  { id: 'might', name: 'Shrine of Might', mods: [more('damage', 0.3)], duration: 40, color: 0xef7d57 },
  { id: 'fortune', name: 'Shrine of Fortune', mods: [inc('item.rarity', 0.5), inc('xp.gain', 0.25)], duration: 90, color: 0xffcd75 },
  { id: 'warding', name: 'Shrine of Warding', mods: [inc('damage.taken', -0.25), inc('life.regen', 0.02)], duration: 40, color: 0x73eff7 },
]);

export interface Feature {
  readonly kind: 'chest' | 'shrine';
  readonly x: number;
  readonly z: number;
  readonly room: number;
  readonly shrine?: string;
  /** Chest rarity. */
  readonly rarity?: 'normal' | 'magic' | 'rare';
}

export const RANK_COST: Readonly<Record<Rank, number>> = { normal: 1, magic: 2.5, rare: 5, boss: 12 };

export interface LevelPlan {
  readonly spec: LevelSpec;
  readonly theme: LevelTheme;
  readonly layout: Layout;
  readonly elements: readonly MechanicElement[];
  /** Cells owned by a mechanic's own floor (Collapse tiles): the geometry leaves them out. */
  readonly dynamicFloor: Uint8Array;
  readonly props: readonly PropPlacement[];
  readonly packs: readonly Pack[];
  readonly features: readonly Feature[];
  /** Total pack budget vs the target from SCALING. */
  readonly budget: { readonly spent: number; readonly target: number };
  /** Elements refused by the bypass guarantee while placing. */
  readonly refused: number;
  /** Milliseconds per stage. */
  readonly timings: Readonly<Record<string, number>>;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()); // real time: timing the planner

export function planLevel(spec: LevelSpec): LevelPlan {
  const timings: Record<string, number> = {};
  let t0 = now();
  const theme = resolveTheme(spec.theme);
  const rng = new Rng(spec.seed).fork(`level:${spec.depth}`);
  const layout = generateLayout({ style: spec.layout.style, rooms: spec.layout.rooms, size: spec.layout.size, seed: spec.seed });
  timings.layout = now() - t0;

  // ---- mechanics (data), with the bypass guarantee
  t0 = now();
  const clr = clearance(layout.width, layout.height, (i) => layout.cells[i] === FLOOR);
  const placement = new Placement(layout, clr);
  for (const id of spec.mechanics) MECHANICS.get(id).place(placement.context(id, spec.mechanics, rng.fork(`mechanic:${id}`), spec.depth));
  solidify(layout, placement.elements);
  const W = layout.width;
  const dynamicFloor = new Uint8Array(W * layout.height);
  for (const e of placement.elements) if (e.data.dynamicFloor) for (const c of e.cells) dynamicFloor[c] = 1;
  timings.mechanics = now() - t0;

  // ---- encounters + features (before props, so props stay out of their way)
  t0 = now();
  const taken = new Uint8Array(W * layout.height); // element/pack/feature/prop cells
  for (const e of placement.elements) for (const c of e.cells) taken[c] = 1;
  const features: Feature[] = [];
  const fr = rng.fork('features');
  for (const s of layout.spots) {
    if (s.tag === 'treasure') features.push({ kind: 'chest', x: s.x + 0.5, z: s.z + 0.5, room: s.room, rarity: fr.chance(0.25 + spec.depth * 0.01) ? 'rare' : 'magic' });
    else if (s.tag === 'shrine') features.push({ kind: 'shrine', x: s.x + 0.5, z: s.z + 0.5, room: s.room, shrine: SHRINES.pick(fr).id });
    if (s.tag === 'treasure' || s.tag === 'shrine') taken[s.z * W + s.x] = 1;
  }
  const { packs, spent, target } = planPacks(spec, layout, rng.fork('packs'), taken);
  timings.encounters = now() - t0;

  // ---- props
  t0 = now();
  const props = decorate(layout, theme, rng.fork('props'), taken, dynamicFloor);
  timings.props = now() - t0;

  return { spec, theme, layout, elements: placement.elements, dynamicFloor, props, packs, features, budget: { spent, target }, refused: placement.refused, timings };
}

/** Monster packs per room by density and budget (see GAME.md rule 4). */
function planPacks(spec: LevelSpec, layout: Layout, rng: Rng, taken: Uint8Array): { packs: Pack[]; spent: number; target: number } {
  const W = layout.width;
  const depth = spec.depth;
  const packs: Pack[] = [];
  const archetypes = spec.archetypes.length ? spec.archetypes : ['charger'];
  const near = pathCorridor(layout, 0);
  const free = (x: number, z: number) => layout.inBounds(x, z) && layout.cells[z * W + x] === FLOOR && !taken[z * W + x];
  let target = 0;
  let spent = 0;
  const rareChance = Math.min(0.35, 0.05 + depth * 0.02);
  const magicChance = Math.min(0.55, 0.22 + depth * 0.02);
  for (const room of layout.rooms) {
    const role = room.tags[0]!;
    if (role === 'start') continue;
    const area = layout.roomCells(room.id).length;
    const perArea = layout.style === 'town' ? 90 : 48;
    const base = role === 'combat' ? area / perArea : role === 'boss' ? 1 : role === 'hall' ? 0.5 : 0.6;
    const count = Math.min(5, Math.max(role === 'combat' ? 1 : 0, Math.round(base * SCALING.density(depth) * rng.range(0.8, 1.2))));
    if (role === 'boss') {
      const b = layout.spotsOf('boss', room.id)[0];
      const at = b ?? layout.roomCells(room.id)[0]!;
      taken[at.z * W + at.x] = 1;
      const power = SCALING.monsterBudget(depth) * 2;
      target += RANK_COST.boss + power;
      spent += RANK_COST.boss + power;
      packs.push({ id: packs.length, room: room.id, archetype: spec.boss?.archetype ?? rng.pick(archetypes), rank: 'boss', members: [{ x: at.x + 0.5, z: at.z + 0.5, rank: 'boss' }], cost: RANK_COST.boss + power, power });
    }
    const anchors = rng.shuffle(layout.spotsOf('spawn', room.id).filter((s) => free(s.x, s.z)));
    for (let k = 0; k < count; k++) {
      const budget = SCALING.monsterBudget(depth) * rng.range(0.8, 1.2);
      target += SCALING.monsterBudget(depth);
      let anchor = anchors[k] ?? null;
      if (!anchor) {
        const cells = layout.roomCells(room.id).filter((c) => free(c.x, c.z) && !near[c.z * W + c.x]);
        if (!cells.length) continue;
        const c = rng.pick(cells);
        anchor = { x: c.x, z: c.z, tag: 'spawn', room: room.id };
      }
      // Composition: a leader (rare/magic) by chance, then normals up to a pack size; the
      // rest of the budget becomes per-member power (deep packs get stronger, not bigger).
      const ranks: Rank[] = [];
      let left = budget;
      const r = rng.next();
      if (r < rareChance) {
        ranks.push('rare');
        left -= RANK_COST.rare;
      } else if (r < rareChance + magicChance) {
        const n = rng.int(1, 2);
        for (let i = 0; i < n; i++) ranks.push('magic');
        left -= n * RANK_COST.magic;
      }
      const size = rng.int(4, 7);
      while (left >= 1 && ranks.length < size) {
        ranks.push('normal');
        left -= 1;
      }
      if (ranks.length < 2) ranks.push('normal');
      const members = spread(layout, anchor.x, anchor.z, ranks, free, taken);
      if (!members.length) continue;
      const base = members.reduce((s, m) => s + RANK_COST[m.rank], 0);
      // Whatever the ranks didn't use becomes per-member power (parts, size, elite mods).
      const power = Math.max(0, (budget - base) / members.length);
      const cost = base + power * members.length;
      spent += cost;
      packs.push({ id: packs.length, room: room.id, archetype: rng.pick(archetypes), rank: ranks.includes('rare') ? 'rare' : ranks.includes('magic') ? 'magic' : 'normal', members, cost, power });
    }
  }
  return { packs, spent, target };
}

/** Members around an anchor on free floor (rings outward), marking their cells taken. */
function spread(layout: Layout, ax: number, az: number, ranks: readonly Rank[], free: (x: number, z: number) => boolean, taken: Uint8Array): PackMember[] {
  const out: PackMember[] = [];
  const W = layout.width;
  for (let r = 0; r <= 3 && out.length < ranks.length; r++)
    for (let dz = -r; dz <= r && out.length < ranks.length; dz++)
      for (let dx = -r; dx <= r && out.length < ranks.length; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = ax + dx;
        const z = az + dz;
        if (!free(x, z)) continue;
        taken[z * W + x] = 1;
        out.push({ x: x + 0.5, z: z + 0.5, rank: ranks[out.length]! });
      }
  return out;
}

/**
 * Scatter the theme's props: 'o' template spots first, then random open cells by density.
 * Blocking props only go where all 8 neighbours are open floor (a single blocked cell then
 * can't cut a path) and never near the critical path; their cells become walls.
 * Torches go on back walls (visible from the iso camera) and request lights.
 */
function decorate(layout: Layout, theme: LevelTheme, rng: Rng, taken: Uint8Array, dynamicFloor: Uint8Array): PropPlacement[] {
  const W = layout.width;
  const H = layout.height;
  const out: PropPlacement[] = [];
  const near = pathCorridor(layout, 1);
  const kinds = theme.props.filter((k) => PROPS.has(k));
  if (!kinds.length) return out;
  const open = (x: number, z: number) => layout.inBounds(x, z) && layout.cells[z * W + x] === FLOOR && !taken[z * W + x] && !dynamicFloor[z * W + x];
  const ringOpen = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!open(x + dx, z + dz) || near[(z + dz) * W + x + dx]) return false;
    return true;
  };
  const put = (kind: string, x: number, z: number) => {
    const def = PROPS.get(kind);
    if (def.blocks && !ringOpen(x, z)) return false;
    if (!def.blocks && (!open(x, z) || near[z * W + x])) return false;
    taken[z * W + x] = 1;
    if (def.blocks) layout.cells[z * W + x] = WALL;
    out.push({ kind, x: x + 0.5, z: z + 0.5, rot: rng.range(0, Math.PI * 2), blocks: def.blocks });
    return true;
  };
  const wallSide = kinds.filter((k) => PROPS.get(k).nearWall);
  const freeSide = kinds.filter((k) => !PROPS.get(k).nearWall);
  for (const s of layout.spots) if (s.tag === 'prop') put(rng.pick(freeSide.length ? freeSide : kinds), s.x, s.z);
  // Density: per 100 floor cells.
  const floorCells: number[] = [];
  for (let i = 0; i < W * H; i++) if (layout.cells[i] === FLOOR) floorCells.push(i);
  const want = Math.round((floorCells.length / 100) * theme.propDensity * (layout.style === 'town' ? 0.45 : 1));
  for (let n = 0, tries = 0; n < want && tries < want * 8; tries++) {
    const i = rng.pick(floorCells);
    const x = i % W;
    const z = (i - x) / W;
    const againstWall = layout.cell(x - 1, z) === WALL || layout.cell(x, z - 1) === WALL;
    const kind = againstWall && wallSide.length && rng.chance(0.6) ? rng.pick(wallSide) : rng.pick(freeSide.length ? freeSide : kinds);
    if (put(kind, x, z)) n++;
  }
  // Bridges have no walls: lantern posts at island edges light the way instead.
  if (layout.style === 'bridges') {
    for (const room of layout.rooms) {
      const edge = layout.roomCells(room.id).filter((c) => open(c.x, c.z) && !near[c.z * W + c.x] && [layout.cell(c.x + 1, c.z), layout.cell(c.x - 1, c.z), layout.cell(c.x, c.z + 1), layout.cell(c.x, c.z - 1)].includes(0));
      rng.shuffle(edge);
      let placed = 0;
      for (const c of edge) {
        if (placed >= 2) break;
        if (out.some((p) => p.kind === 'lantern' && Math.hypot(p.x - c.x - 0.5, p.z - c.z - 0.5) < 5)) continue;
        taken[c.z * W + c.x] = 1;
        out.push({ kind: 'lantern', x: c.x + 0.5, z: c.z + 0.5, rot: 0, blocks: false });
        placed++;
      }
    }
  }
  // Wall torches: on floor cells whose -x or -z neighbour is a wall (back walls face the camera).
  for (const room of layout.rooms) {
    const cand = layout.roomCells(room.id).filter((c) => open(c.x, c.z) && (layout.cell(c.x - 1, c.z) === WALL || layout.cell(c.x, c.z - 1) === WALL));
    rng.shuffle(cand);
    const n = Math.min(cand.length, Math.max(1, Math.round(Math.sqrt(room.w * room.h) / 4)));
    let placed = 0;
    for (const c of cand) {
      if (placed >= n) break;
      if (out.some((p) => p.kind === 'torch' && Math.hypot(p.x - c.x - 0.5, p.z - c.z - 0.5) < 4)) continue;
      const rot = layout.cell(c.x - 1, c.z) === WALL ? Math.PI / 2 : 0; // faces away from its wall
      taken[c.z * W + c.x] = 1;
      out.push({ kind: 'torch', x: c.x + 0.5, z: c.z + 0.5, rot, blocks: false });
      placed++;
    }
  }
  return out;
}
