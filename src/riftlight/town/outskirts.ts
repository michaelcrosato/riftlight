/**
 * Emberfall's outskirts: the ring of districts between the plaza's buildings and the forest, built
 * mostly from the imported Kenney packs (docs/ASSETS.md, *Imported so far*; `loadRiftlightPacks`
 * puts them in the library before the town is built) with the town's kit, so they merge with the
 * rest of the town into one mesh per material:
 *
 *   north      the Old Watch: a curtain wall of castle stone on an arc behind the obelisk, its east
 *              tower broken where the rift tore through (a glowing crack of crystals runs back to the
 *              obelisk), a colonnade up to the old gate, banners, a wrecked catapult and ballista
 *   north-east the tavern, a timber-framed inn with a patio of tables, chairs and barrels
 *   east       the woodland edge: a stream (river tiles, set into a cut in the ground) crossed by a
 *              wooden bridge, and across it a hunter's camp (tent, campfire, log seats, a canoe)
 *   south-east the watchmen's graves, low headstones in a low wall
 *   south      the road out through a timber gate between two watch towers, a signpost
 *   south-west the willow pond
 *   west       the farmstead: a fenced field of crops, a barn, a well
 *
 * and the forest ring past the walkable edge (pack trees mixed with the town's own `tree.glb`).
 * Positions come from TOWN_LAYOUT (screen-space metres, `iso`). Trees and posts block at their
 * trunks, buildings, walls and furniture by their footprints, the water everywhere but the bridge.
 * Model ids are written out in full (`kenney-nature/tree-oak`): the single-file build finds the
 * pack models the game uses by them (scripts/build-single.mjs).
 */
import { Vector3, type Object3D } from 'three/webgpu';
import type { ModelBuild } from '../../engine/model/build';
import type { Binding } from '../../engine/model/expand';
import { MODEL_LIBRARY } from '../../engine/model/library';
import type { Rng } from '../core/rng';
import type { Kit, ModelPlacement, V3 } from './kit';
import { iso, screenOf, TOWN_LAYOUT } from './layout';

/** What the town lights and animates out here (world points, fixed once built). */
export interface OutskirtsBuild {
  /** The hunter's fire: its light, embers and smoke. */
  readonly campfire: Vector3;
  /** The rift's crack at the Old Watch: a cyan glow. */
  readonly rift: Vector3;
  /** Chimney tops (smoke). */
  readonly chimneys: Vector3[];
}

const DEG = Math.PI / 180;
/** Models that cast no shadow: ground tiles, rows, flowers, grass, small plants and stones, lilies, reeds, rubble, banners. */
const FLAT = /ground-|crops-dirt|flower-|grass|plant-bush-small|plant-flat|mushroom|lily|reeds|rubble|stone-small|banner|canoe-paddle|path-/;
const L = TOWN_LAYOUT;

/** Castle stone in the town's greys (the kit's own sand and clay would read as another town). */
const STONE: Readonly<Record<string, Binding>> = { c1: 'slate', c3: 'mist', c4: 'mist', c2: 'plum' };
/** River and pond tiles: blue water, sandy banks like the paths. */
const WATER: Readonly<Record<string, Binding>> = { stone: 'blue', dirt: 'sand' };
/** Golden wheat. */
const WHEAT: Readonly<Record<string, Binding>> = { c1: 'sand' };

/** World point of a screen-space spot. */
const at = (sx: number, sy: number, y = 0): V3 => {
  const [x, z] = iso(sx, sy);
  return [x, y, z];
};
/** World yaw (degrees) that turns a model's front (+Z) from one screen spot toward another. */
const toward = (sx: number, sy: number, tx: number, ty: number): number => {
  const [x, z] = iso(sx, sy);
  const [u, w] = iso(tx, ty);
  return Math.atan2(u - x, w - z) / DEG;
};
/** World yaw for a front facing screen direction `deg` (0 = the camera, 90 = right, 180 = away, -90 = left). */
const face = (deg: number): number => 45 + deg;

/** The deck of the stream's bridge: its height under a world point (0 off the bridge), a ramp over its steps. */
export function bridgeDeck(x: number, z: number): number {
  const [sx, sy] = screenOf(x, z);
  const d = Math.abs(sx - L.stream.sx);
  if (Math.abs(sy - L.stream.bridge) > 1.25 || d > 1.75) return 0;
  // the deck's top (the tile sunk with the stream): 0.445 m over the water, steps down to the banks
  return d <= 1.15 ? 0.445 : (0.445 * (1.75 - d)) / 0.6;
}

/**
 * The ground as flat polygons (world x, z): a big disc cut along the stream (its tiles fill the
 * cut) with a hole for the pond. Each piece overlaps the tiles' grass by a few centimetres; the
 * tiles sit just below, so nothing z-fights.
 */
export function groundPieces(radius = 54, segments = 64): { outline: [number, number][]; holes: [number, number][][] }[] {
  const disc: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    disc.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  const cut = 1.42; // the tiles are 3 m wide: the ground overlaps their grass by 8 cm
  const west = clip(disc, (p) => L.stream.sx - cut - p[0]);
  const east = clip(disc, (p) => p[0] - (L.stream.sx + cut));
  const [px, py, scale] = L.pond;
  const h = 1.5 * scale - 0.08; // the pond's tile, drawn `scale` times as big
  const hole: [number, number][] = [
    [px - h, py - h],
    [px + h, py - h],
    [px + h, py + h],
    [px - h, py + h],
  ];
  const world = (poly: [number, number][]) => poly.map(([sx, sy]) => iso(sx, sy));
  return [
    { outline: world(west), holes: [world(hole)] },
    { outline: world(east), holes: [] },
  ];
}

/** Sutherland–Hodgman: the part of a convex polygon (screen space) where `side(p) >= 0`. */
function clip(poly: readonly [number, number][], side: (p: readonly [number, number]) => number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push([a[0], a[1]]);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Spots on screen kept clear of scattered dressing (paths, buildings, the stream...). */
type Keep = (sx: number, sy: number) => boolean;

class Outskirts {
  readonly chimneys: Vector3[] = [];
  campfire = new Vector3();
  rift = new Vector3();
  /** Trunks and big pieces placed so far (screen space), so scattered dressing keeps off them. */
  private readonly taken: { sx: number; sy: number; r: number }[] = [];

  constructor(
    readonly k: Kit,
    readonly rng: Rng,
    readonly tree: Object3D,
  ) {}

  /**
   * `Kit.model`, with a shared palette (STONE, WATER) narrowed to the slots the model has; null,
   * and nothing placed, for a pack model whose pack didn't load (`loadRiftlightPacks`).
   */
  m(id: string, p: V3, o: ModelPlacement = {}): ModelBuild | null {
    if (!MODEL_LIBRARY.has(id)) return null;
    // ground tiles and small dressing cast no shadow worth its pass
    const cast = o.cast ?? !FLAT.test(id);
    if (!o.palette) return this.k.model(id, p, { ...o, cast });
    const slots = MODEL_LIBRARY.get(id).palette;
    const palette = Object.fromEntries(Object.entries(o.palette).filter(([slot]) => slot in slots));
    return this.k.model(id, p, { ...o, palette, cast });
  }

  /** A model at a screen spot (world yaw), remembered as taken. */
  put(id: string, sx: number, sy: number, o: ModelPlacement & { y?: number; r?: number } = {}): void {
    this.m(id, at(sx, sy, o.y ?? 0), o);
    this.taken.push({ sx, sy, r: o.r ?? 0.8 });
  }

  /**
   * A tree (or anything round) that blocks only at its trunk; `hides` (m), a crown big enough to
   * hide the hero, also closes the ground behind it (`Kit.closeBehind`).
   */
  trunk(id: string, sx: number, sy: number, r = 0.4, o: ModelPlacement & { hides?: number } = {}): void {
    const size = this.m(id, at(sx, sy), { yaw: this.rng.range(0, 360), ...o, block: false })?.bounds.size;
    if (!size) return; // its pack didn't load: nothing there, nothing to bump into
    const [x, z] = iso(sx, sy);
    this.k.blockers.push({ kind: 'circle', x, z, r: r * (o.scale ?? 1) });
    if (o.hides) {
      const crown = Math.min(size[0], size[2]) * (o.scale ?? 1) * 0.8;
      this.k.closeBehind(x, z, crown, crown, o.hides, L.view);
    }
    this.taken.push({ sx, sy, r: 1.2 * (o.scale ?? 1) });
  }

  /** The town's own tree (assets/tree.glb), as the old ring had them. */
  glbTree(sx: number, sy: number, scale: number): void {
    const t = this.tree.clone(true);
    const [x, z] = iso(sx, sy);
    t.position.set(x, 0, z);
    t.rotation.y = this.rng.range(0, Math.PI * 2);
    t.scale.setScalar(scale);
    this.k.statics.push(t);
    this.k.blockers.push({ kind: 'circle', x, z, r: 0.45 });
    this.taken.push({ sx, sy, r: 1.2 * scale });
  }

  /** The hub's buildings and every lantern post, built before the outskirts: scattered dressing keeps off them. */
  reserveHub(): void {
    for (const [sx, sy] of [...L.houses, L.smithy, L.market, L.tent]) this.taken.push({ sx, sy, r: 3.4 });
    for (const [sx, sy] of L.lanterns) this.taken.push({ sx, sy, r: 0.7 });
  }

  free(sx: number, sy: number, r: number): boolean {
    return this.taken.every((t) => Math.hypot(t.sx - sx, t.sy - sy) >= t.r + r);
  }

  /** A sand path through screen-space points (`w` wide), rounded at its bends. */
  path(points: readonly (readonly [number, number])[], w = 2.2): void {
    const k = this.k;
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[i + 1]!;
      const [x0, z0] = iso(ax, ay);
      const [x1, z1] = iso(bx, by);
      const len = Math.hypot(x1 - x0, z1 - z0);
      k.frame((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) / DEG, () => k.box([w, 0.02, len], 'sand', [0, 0.012, 0], { cast: false }));
      if (i > 0) k.cyl(w / 2, w / 2, 0.02, 10, 'sand', [x0, 0.012, z0], { cast: false });
    }
  }

  /** Scatter `n` of `ids` over a screen-space box, clear of what's taken and of `keep`. */
  scatter(ids: readonly string[], n: number, box: readonly [number, number, number, number], o: { r?: number; keep?: Keep; block?: number; scale?: [number, number] } = {}): void {
    const [x0, y0, x1, y1] = box;
    const r = o.r ?? 0.6;
    for (let placed = 0, tries = 0; placed < n && tries < n * 30; tries++) {
      const sx = this.rng.range(x0, x1);
      const sy = this.rng.range(y0, y1);
      if (Math.hypot(sx, sy) > L.radius + 6 || !this.free(sx, sy, r) || o.keep?.(sx, sy)) continue;
      const id = this.rng.pick(ids);
      const scale = o.scale ? this.rng.range(o.scale[0], o.scale[1]) : 1;
      if (o.block) this.trunk(id, sx, sy, o.block, { scale });
      else {
        this.m(id, at(sx, sy), { yaw: this.rng.range(0, 360), block: false, scale });
        this.taken.push({ sx, sy, r });
      }
      placed++;
    }
  }

  // ------------------------------------------------------------------ districts

  /** The Old Watch: the curtain wall on its arc, the towers, the gate, the courtyard, the rift's crack. */
  watch(): void {
    const { wall: R, from, to, gate } = L.watch;
    const k = this.k;
    const onArc = (phi: number, r: number = R): [number, number] => [Math.cos(phi * DEG) * r, Math.sin(phi * DEG) * r];
    const segment = (phi: number, build: () => void) => {
      const [x, z] = iso(...onArc(phi));
      const [nx, nz] = iso(Math.cos(phi * DEG), Math.sin(phi * DEG)); // outward
      // local +X points out of town, local Z runs along the wall
      k.frame(x, z, Math.atan2(-nz, nx) / DEG, () => {
        build();
        // nothing walks behind the wall (it would hide the hero): the strip out past the edge is
        // closed, deep enough that anything pushed out of it goes back toward the town
        k.blockBox(3.85, 0, 6.3, 3.2);
      });
    };
    const piece = (id: string, o: ModelPlacement = {}) => () => this.m(id, [0, 0, 0], { palette: STONE, ...o });
    for (let phi = from; phi <= to; phi += 6) {
      if (phi === from) {
        // the broken east tower, where the rift came through
        segment(phi, () => {
          this.m('kenney-castle/tower-hexagon-base', [0, 0, 0], { palette: STONE, yaw: 12 });
          this.m('kenney-castle/tower-hexagon-mid', [0, 3.93, 0], { palette: STONE, yaw: 12, block: false });
          this.m('kenney-castle/rocks-small', [-1.2, 0, 1.8], { palette: STONE, yaw: 40, scale: 0.7, block: false });
        });
      } else if (phi === to) {
        // the west tower still stands, its banner up
        segment(phi, () => {
          this.m('kenney-castle/tower-base', [0, 0, 0], { palette: STONE });
          this.m('kenney-castle/tower-top', [0, 3.93, 0], { palette: STONE, block: false });
          this.m('kenney-castle/flag-banner-long', [0.2, 4.0, 0], { block: false, yaw: 90 });
        });
      } else if (phi === gate) {
        // the old gate, choked with rubble beyond
        segment(phi, () => {
          this.m('kenney-castle/wall-narrow-gate', [0, 0, 0], { palette: STONE });
          this.m('kenney-castle/rocks-small', [1.6, 0, 0], { palette: STONE, yaw: 90, scale: 0.8, block: false });
        });
      } else if (phi === from + 12 || phi === to - 12) {
        // breaches: the wall lies where it fell
        segment(phi, piece('kenney-castle/rocks-large', { yaw: phi === from + 12 ? 8 : -14, scale: 0.85 }));
      } else if (phi === gate - 6) segment(phi, piece('kenney-castle/wall-narrow-stairs', { yaw: 180 }));
      else {
        segment(phi, piece('kenney-castle/wall-narrow'));
        if (phi === gate - 12 || phi === gate + 6) {
          const [sx, sy] = onArc(phi);
          this.put('kenney-castle/flag', sx, sy, { y: 3.93, yaw: face(0), block: false });
        }
      }
      if (phi === from + 6 || phi === to - 6) {
        // a watch banner on the inside of the wall
        const [sx, sy] = onArc(phi, R - 0.85);
        this.put('kenney-mini-dungeon/banner', sx, sy, { y: 1.7, yaw: toward(sx, sy, 0, 0), block: false });
      }
    }
    // the colonnade up to the gate: pairs of columns, one cracked, one fallen toward the rift
    const [gx] = onArc(gate);
    for (const sy of [15.4, 18.8, 22.2]) {
      for (const side of [-1, 1]) {
        const sx = gx + side * 3.1;
        if (side === 1 && sy === 18.8) {
          this.trunk('kenney-nature/statue-column-damaged', sx, sy, 0.55, { yaw: face(0) });
          const [x, z] = iso(sx + 2.1, sy + 0.2);
          k.frame(x, z, face(90), () => {
            k.cyl(0.36, 0.36, 2.4, 8, 'mist', [0, 0.36, 0], { rot: [90, 0, 0] });
            k.blockBox(0, 0, 0.8, 2.4);
          });
          this.taken.push({ sx: sx + 2.1, sy: sy + 0.2, r: 1.4 });
        } else this.trunk(sy === 22.2 && side === -1 ? 'kenney-nature/statue-column-damaged' : 'kenney-nature/statue-column', sx, sy, 0.55, { yaw: face(0) });
      }
    }
    this.put('kenney-nature/statue-obelisk', gx - 2.2, 25.2, { yaw: face(0), r: 1 });
    this.put('kenney-nature/statue-obelisk', gx + 2.2, 25.2, { yaw: face(0), r: 1 });
    // the war engines that stood against what came through, wrecked; the old warden's head
    this.put('kenney-castle/siege-catapult-demolished', -10.6, 18.6, { yaw: 25, r: 3 });
    this.put('kenney-castle/siege-ballista-demolished', -11.2, 23.8, { yaw: -60, r: 2.4, scale: 0.8 });
    this.put('kenney-nature/statue-head', -16.2, 19.4, { yaw: toward(-16.2, 19.4, 0, 12), r: 1.6 });
    // the rift's crack: from the obelisk to the broken tower, crystals grown along it
    const a: [number, number] = [2.8, 12.4];
    const b = onArc(from, R - 2.2);
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const jag = (t: number) => (t === 0 || t === 1 ? 0 : Math.sin(t * 23) * 0.55);
      const p0: [number, number] = [a[0] + (b[0] - a[0]) * t0 + jag(t0), a[1] + (b[1] - a[1]) * t0 - jag(t0) * 0.4];
      const p1: [number, number] = [a[0] + (b[0] - a[0]) * t1 + jag(t1), a[1] + (b[1] - a[1]) * t1 - jag(t1) * 0.4];
      const [x0, z0] = iso(...p0);
      const [x1, z1] = iso(...p1);
      const len = Math.hypot(x1 - x0, z1 - z0);
      k.frame((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) / DEG, () => {
        k.box([0.36 + 0.24 * Math.sin(i * 1.7) ** 2, 0.02, len + 0.1], 'night', [0, 0.014, 0], { cast: false });
        k.box([0.1, 0.02, len + 0.1], i % 2 ? 'cyan' : 'sky', [0, 0.02, 0], { cast: false });
      });
    }
    const crystals: [number, number, number][] = [
      [5.3, 14.8, 0.8],
      [7.7, 18.6, 1.05],
      [10.3, 22.2, 1.35],
      [9.0, 20.0, 0.6],
    ];
    for (const [sx, sy, s] of crystals) this.trunk('crystal', sx, sy, 0.45, { scale: s, yaw: 0 });
    this.rift = new Vector3(...at(7.6, 19.6, 1.2));
    this.m('rubble', at(4.4, 17.6), { block: false, seed: 4 });
    this.m('rubble', at(gx - 1.2, 26.4), { block: false, seed: 7 });
    this.m('rubble', at(12.6, 23.4), { block: false, seed: 9 });
    this.m('rubble', at(-7.4, 24.8), { block: false, seed: 2 });
  }

  /** The tavern: a timber-framed inn facing the plaza, a patio of tables and barrels before it. */
  tavern(): void {
    const k = this.k;
    const [sx, sy] = L.tavern;
    const [x, z] = iso(sx, sy);
    k.frame(x, z, toward(sx, sy, 0, 0), () => {
      // stone plinth, plastered ground floor in a timber frame, an overhanging upper floor, a hip roof
      k.box([5.6, 0.3, 4.2], 'slate', [0, 0.15, 0], { top: 'night' });
      k.box([5.2, 2.4, 3.8], 'white', [0, 1.5, 0]);
      for (const px of [-2.6, -0.9, 0.9, 2.6]) k.box([0.2, 2.4, 0.2], 'plum', [px, 1.5, 1.92]);
      for (const pz of [-1.9, 1.9]) k.box([0.2, 2.4, 0.2], 'plum', [-2.6, 1.5, pz]);
      k.box([5.4, 0.22, 4.0], 'plum', [0, 2.78, 0]);
      k.box([5.8, 1.9, 4.4], 'sand', [0, 3.84, 0.1]);
      for (const px of [-2.85, -1.4, 0, 1.4, 2.85]) k.box([0.16, 1.9, 0.16], 'plum', [px, 3.84, 2.33]);
      k.box([5.9, 0.16, 0.18], 'plum', [0, 4.82, 2.33]);
      // door, windows (warm), the upper windows
      k.box([1.1, 1.9, 0.08], 'plum', [0, 1.25, 1.94]);
      k.box([0.12, 1.9, 0.1], 'night', [0, 1.25, 1.96]);
      for (const px of [-1.75, 1.75]) {
        k.box([0.9, 0.8, 0.06], 'orange', [px, 1.6, 1.93]);
        k.box([0.95, 0.1, 0.12], 'plum', [px, 1.15, 1.96]);
      }
      for (const px of [-2.1, -0.7, 0.7, 2.1]) k.box([0.6, 0.7, 0.06], 'orange', [px, 3.9, 2.34]);
      k.roof(5.8, 4.4, 4.8, 2.1, 'navy', 0.35, 'plum');
      k.box([0.7, 1.6, 0.7], 'slate', [1.7, 6.2, -1.0]);
      this.chimneys.push(k.world([1.7, 7.1, -1.0]));
      // the sign: an iron arm and a board with a mug on it
      k.box([0.08, 0.08, 1.0], 'night', [-2.75, 3.1, 2.4]);
      k.box([0.08, 0.7, 0.6], 'red', [-2.75, 2.65, 2.75]);
      k.box([0.1, 0.3, 0.2], 'sand', [-2.75, 2.65, 2.75]);
      k.blockBox(0, 0, 5.8, 4.4);
      k.closeBehind(0, 0, 5.8, 4.4, { eaves: 4.8, ridge: 6.9 }, L.view);
      // the patio: a deck before the door, two tables with chairs, barrels, potted plants
      k.box([6.6, 0.03, 3.6], 'plum', [0, 0.015, 4.2], { cast: false });
      for (let i = 0; i < 6; i++) k.box([0.06, 0.035, 3.6], 'night', [-2.75 + i * 1.1, 0.018, 4.2], { cast: false });
      const table = (tx: number, tz: number) => {
        this.m('kenney-furniture/table-cross-cloth', [tx, 0, tz], { yaw: 0 });
        for (const [cx, cz, cy] of [
          [-0.55, 0.7, 180],
          [0.55, 0.7, 180],
          [-0.55, -0.7, 0],
          [0.55, -0.7, 0],
        ] as const)
          this.m('kenney-furniture/chair', [tx + cx, 0, tz + cz], { yaw: cy, block: false });
      };
      table(-1.5, 4.3);
      table(1.7, 4.5);
      this.m('kenney-mini-dungeon/barrel', [-3.3, 0, 2.7], { scale: 0.72 });
      this.m('kenney-mini-dungeon/barrel', [-3.5, 0, 3.6], { yaw: 30, scale: 0.72 });
      this.m('kenney-furniture/potted-plant', [-0.9, 0, 2.35], { block: false });
      this.m('kenney-furniture/potted-plant', [0.9, 0, 2.35], { block: false });
      this.m('keg', [3.4, 0, 2.6], { yaw: 90 });
    });
    // the building, its patio, and the view of it from the plaza's side kept clear of trees
    this.taken.push({ sx, sy, r: 4.4 }, { sx: sx - 3.2, sy: sy - 3.2, r: 3 }, { sx: sx - 2.4, sy: sy - 6.6, r: 3.4 });
  }

  /** The stream (river tiles in a cut in the ground), the bridge over it. */
  stream(): void {
    const k = this.k;
    const S = L.stream.sx;
    const B = L.stream.bridge;
    for (let j = -18; j <= 18; j++) {
      const sy = B + j * 3;
      if (Math.hypot(S, sy) > 55) continue;
      const [x, z] = iso(S, sy);
      k.frame(x, z, 45, () => {
        this.m(j % 4 === 2 ? 'kenney-nature/ground-river-rocks' : 'kenney-nature/ground-river-straight', [0, -0.155, 0], { palette: WATER, block: false });
        if (j === 0) {
          // the bridge: its deck crosses along local X; the rails keep walkers on it
          this.m('kenney-nature/bridge-wood', [0, -0.155, 0], { palette: { stone: 'sand', dirt: 'plum' }, block: false });
          for (const s of [-1, 1]) k.blockBox(0, s * 1.36, 3.12, 0.3, true);
        } else k.blockBox(-0.1, 0, 1.56, 3.02, true);
        if (j === -3 || j === 4) this.m('kenney-nature/lily-large', [0.2, -0.15, 0.6], { block: false });
        if (j === 2 || j === -5) this.m('kenney-nature/lily-small', [-0.3, -0.15, -0.5], { block: false, yaw: 70 });
      });
      this.taken.push({ sx: S, sy, r: 1.9 });
    }
    // reeds and stones on the banks
    for (const [sx, sy] of [
      [21.2, -4.8],
      [24.9, 6.9],
      [24.8, -9.6],
    ] as const)
      this.m('reeds', at(sx, sy), { block: false, seed: Math.round(sy * 10) });
  }

  /** The hunter's camp across the stream: a tent, the fire, log seats, firewood, a canoe on the bank. */
  camp(): void {
    const [cx, cy] = L.camp;
    this.m('campfire', at(cx, cy), { yaw: 0, block: false });
    this.k.blockers.push({ kind: 'circle', x: iso(cx, cy)[0], z: iso(cx, cy)[1], r: 0.75 });
    this.campfire = new Vector3(...at(cx, cy, 0.9));
    this.taken.push({ sx: cx, sy: cy, r: 2.2 });
    this.put('kenney-nature/tent-detailed-open', cx + 1.3, cy + 3.4, { yaw: toward(cx + 1.3, cy + 3.4, cx, cy), r: 1.8 });
    // seats round the fire with room to walk between them and up to it
    // (the west one a metre off the water: no gap there narrower than a walker)
    this.put('kenney-nature/log', cx - 2.2, cy - 0.6, { yaw: face(0), r: 1.2 });
    this.put('kenney-nature/log', cx + 0.6, cy - 2.6, { yaw: face(90), r: 1.2 });
    this.put('kenney-nature/stump-round', cx + 2.2, cy - 1.2, { r: 0.7 });
    this.put('kenney-nature/log-stack', cx + 3.1, cy + 0.6, { yaw: face(0), r: 1.2 });
    this.put('kenney-nature/pot-small', cx - 0.9, cy + 1.2, { block: false, r: 0.5 });
    this.put('kenney-nature/canoe', 25.3, 9.6, { yaw: face(4), r: 1.6 });
    this.put('kenney-nature/canoe-paddle', 26.2, 8.6, { yaw: face(30), block: false, r: 0.5 });
    this.put('kenney-mini-dungeon/weapon-spear', cx + 2.6, cy + 2.3, { yaw: face(-20), block: false, r: 0.4 });
    // the woods around it
    const woods = ['kenney-nature/tree-oak', 'kenney-nature/tree-default', 'kenney-nature/tree-default-dark', 'kenney-nature/tree-detailed', 'kenney-nature/tree-pine-round-d', 'kenney-nature/tree-pine-tall-a'];
    const clearing: Keep = (sx, sy) => Math.hypot(sx - cx, sy - cy) < 4.6 || Math.abs(sx - L.stream.sx) < 2.4 || Math.hypot(sx - 26, sy - 1.5) < 2.2;
    this.scatter(woods, 13, [25, -22, 33, 22], { r: 1.3, keep: clearing, block: 0.35, scale: [0.85, 1.2] });
    this.scatter(['kenney-nature/mushroom-red-group', 'kenney-nature/mushroom-tan-group', 'kenney-nature/mushroom-red', 'kenney-nature/mushroom-tan-tall'], 10, [25, -20, 32, 20], { r: 0.4, keep: clearing });
    this.scatter(['kenney-nature/stump-old', 'kenney-nature/stump-round-detailed', 'kenney-nature/stone-large-b', 'kenney-nature/stone-small-d', 'kenney-nature/stone-tall-c'], 6, [25, -20, 31, 18], { r: 0.8, keep: clearing, block: 0.45 });
    this.put('kenney-nature/log-large', 28.4, 10.6, { yaw: face(60), r: 1.8 });
  }

  /** The farmstead: the fenced field, the barn, the well, haystacks, the cart. */
  farm(): void {
    const k = this.k;
    const [fx, fy, w, h] = L.field;
    const [x, z] = iso(fx, fy);
    k.frame(x, z, 45, () => {
      // local X = screen right, local Z = toward the camera; rows run up the screen
      // [row, crop, its size (the pack's pumpkins and carrots are a metre and more), palette]
      const rows: [number, string, number, Readonly<Record<string, Binding>> | undefined][] = [
        [-2.7, 'kenney-nature/crops-corn-stage-b', 1, undefined],
        [-0.9, 'kenney-nature/crops-wheat-stage-b', 1, WHEAT],
        [0.9, 'kenney-nature/crops-leafs-stage-b', 0.8, undefined],
        [2.7, 'kenney-nature/crop-pumpkin', 0.5, undefined],
      ];
      for (const [rx, crop, size, palette] of rows) {
        for (const tz of [-4.5, -1.5, 1.5, 4.5]) {
          this.m('kenney-nature/crops-dirt-row', [rx, 0, tz], { yaw: 90, block: false });
          // wheat is dense (360 triangles a sheaf): one to a row piece, the rest two
          for (const dz of crop.includes('wheat') ? [0] : [-0.75, 0.75]) {
            const carrot = rx === 2.7 && dz < 0;
            this.m(carrot ? 'kenney-nature/crop-carrot' : crop, [rx, 0.1, tz + dz], { yaw: this.rng.range(0, 360), block: false, scale: carrot ? 0.55 : size, ...(palette ? { palette } : {}) });
          }
        }
      }
      // the fence: three pieces a side across, four up, the gate toward the farmyard (east)
      const hx = w / 2 + 0.9;
      const hz = h / 2;
      for (const px of [-3, 0, 3]) for (const pz of [-hz, hz]) this.m('kenney-nature/fence-simple', [px, 0, pz], { block: false });
      for (const pz of [-4.5, -1.5, 1.5, 4.5]) {
        this.m('kenney-nature/fence-simple', [-hx, 0, pz], { yaw: 90, block: false });
        this.m(pz === -1.5 ? 'kenney-nature/fence-gate' : 'kenney-nature/fence-simple', [hx, 0, pz], { yaw: 90, block: false });
      }
      k.blockBox(0, 0, hx * 2 + 0.3, hz * 2 + 0.3);
    });
    this.taken.push({ sx: fx, sy: fy, r: 6.8 });
    // the barn: red planks, a slate roof, a hay loft
    const [bx, by] = L.barn;
    const [x2, z2] = iso(bx, by);
    // its gable end (local -X) faces the farmyard, toward the camera: the big doors and the loft door
    k.frame(x2, z2, face(50), () => {
      k.box([5.4, 0.2, 4.4], 'slate', [0, 0.1, 0]);
      k.box([5.2, 2.9, 4.2], 'red', [0, 1.55, 0]);
      for (const px of [-2.6, 2.6]) for (const pz of [-2.1, 2.1]) k.box([0.22, 3.0, 0.22], 'plum', [px, 1.5, pz]);
      k.box([0.08, 2.3, 2.0], 'plum', [-2.62, 1.25, 0]);
      for (const s of [-1, 1]) k.box([0.06, 2.9, 0.12], 'white', [-2.67, 1.25, 0], { rot: [s * 39, 0, 0] });
      k.box([0.08, 0.12, 2.1], 'white', [-2.67, 2.42, 0]);
      k.box([0.08, 0.8, 0.9], 'plum', [-2.68, 3.55, 0]);
      for (const pz of [-1.2, 1.2]) k.box([0.06, 0.9, 0.7], 'night', [-2.64, 1.7, pz * 1.35]);
      k.roof(5.2, 4.2, 3.0, 2.2, 'slate', 0.35, 'night', 'red');
      k.blockBox(0, 0, 5.6, 4.6);
      k.closeBehind(0, 0, 5.6, 4.6, { eaves: 3.6, ridge: 5.2 }, L.view);
    });
    // between that and the edge, slivers too narrow to walk into: closed out past the edge
    k.frame(...iso(-27.5, 16.25), 45, () => k.blockBox(0, 0, 7, 7.5));
    this.taken.push({ sx: bx, sy: by, r: 3.8 });
    this.put('well', ...L.well, { yaw: face(20), r: 1.3 });
    this.put('haystack', bx - 1.2, by - 4.2, { r: 1.2, seed: 3 });
    // round bales like the one by the smithy
    for (const [sx, sy, turn] of [
      [bx + 2.6, by + 2.6, 20],
      [bx + 1.3, by + 3.7, -35],
    ] as const) {
      const [x3, z3] = iso(sx, sy);
      k.cyl(0.6, 0.6, 0.8, 8, 'sand', [x3, 0.6, z3], { rot: [0, turn, 90] });
      k.blockers.push({ kind: 'circle', x: x3, z: z3, r: 0.6 });
      this.taken.push({ sx, sy, r: 0.9 });
    }
    this.put('kenney-nature/log-stack-large', bx - 4.4, by - 1.4, { yaw: face(60), r: 1.4 });
    this.put('cart', -18.0, -6.6, { yaw: face(170), r: 1.4 });
    this.put('wheelbarrow', -19.7, 9.4, { yaw: face(-30), r: 1 });
    this.put('water-trough', bx + 2.6, by - 3.4, { yaw: face(50), r: 1 });
    for (const [sx, sy] of [
      [-19.3, -1.6],
      [-19.1, -2.6],
      [-19.6, -3.3],
    ] as const)
      this.put('kenney-nature/crop-pumpkin', sx, sy, { yaw: this.rng.range(0, 360), scale: 0.45, block: false, r: 0.4 });
  }

  /** The willow pond: a pond tile (drawn big) in a hole in the ground, lilies, reeds, the willow, a bench. */
  pond(): void {
    const k = this.k;
    const [px, py, scale] = L.pond;
    const [x, z] = iso(px, py);
    const water = 0.7 * scale; // the tile's water reaches ±0.7 m (its banks ±1.15 m)
    k.frame(x, z, 45, () => {
      this.m('kenney-nature/ground-river-tile', [0, -0.155 * scale, 0], { palette: WATER, block: false, scale });
      const surface = -0.155 * scale + 0.005; // the water, at the sunk tile's base
      this.m('kenney-nature/lily-large', [-0.6, surface, 0.3], { block: false });
      this.m('kenney-nature/lily-large', [0.7, surface, -0.5], { block: false, yaw: 200 });
      this.m('kenney-nature/lily-small', [0.9, surface, 0.6], { block: false, yaw: 120 });
      this.m('kenney-nature/lily-small', [-0.4, surface, -0.9], { block: false, yaw: 40 });
      k.blockBox(-0.05 * scale, 0.03 * scale, water * 2 + 0.2, water * 2 + 0.2, true);
    });
    const bank = 1.15 * scale;
    this.taken.push({ sx: px, sy: py, r: bank });
    // the willow stands south-west of the water, clear of the view of it
    this.trunk('willow', px - bank - 1.4, py - 1.2, 0.5, { seed: 2, hides: 2.4 });
    this.put('reeds', px + bank - 0.6, py + bank - 0.9, { block: false, r: 0.5, seed: 11 });
    this.put('reeds', px - bank + 0.5, py + 0.8, { block: false, r: 0.5, seed: 12 });
    this.put('reeds', px + 0.4, py - bank + 0.4, { block: false, r: 0.5, seed: 13 });
    this.put('park-bench', px + bank + 0.9, py + 0.8, { yaw: toward(px + bank + 0.9, py + 0.8, px, py), r: 0.9 });
    for (const [sx, sy, id] of [
      [px - bank + 0.2, py - 1.0, 'kenney-nature/stone-small-e'],
      [px + 1.2, py + bank, 'kenney-nature/stone-small-flat-a'],
      [px + bank, py - 1.4, 'kenney-nature/stone-small-c'],
    ] as const)
      this.put(id, sx, sy, { yaw: this.rng.range(0, 360), block: false, r: 0.5 });
    this.scatter(['kenney-nature/flower-yellow-a', 'kenney-nature/flower-red-b', 'kenney-nature/flower-purple-a', 'kenney-nature/flower-yellow-c'], 10, [px - 6, py - 5, px + 6, py + 5], { r: 0.3 });
  }

  /**
   * The watchmen's graves, south-east of the road: rows of low headstones inside a low stone wall
   * open toward the town, a memorial stone, candles, a dead tree at the back. Everything here is
   * low (the camera looks over it from the south), the tree stands at the far edge.
   */
  graves(): void {
    const k = this.k;
    const [gx, gy] = L.graves;
    const [x, z] = iso(gx, gy);
    const rng = this.rng.fork('graves');
    k.frame(x, z, 45, () => {
      // local X = screen right, local Z = toward the camera; the open side faces up the screen (the lane)
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 4; col++) {
          if (row === 2 && col === 3) continue;
          const lx = -2.7 + col * 1.8 + rng.range(-0.15, 0.15);
          const lz = -1.6 + row * 1.9;
          const tilt = rng.range(-6, 6);
          const tall = rng.range(0.55, 0.8);
          k.box([0.7, 0.08, 1.2], 'teal', [lx, 0.04, lz + 0.75], { cast: false });
          if ((row + col) % 3 === 1) {
            // a cross
            k.box([0.12, tall + 0.2, 0.12], 'mist', [lx, (tall + 0.2) / 2, lz], { rot: [0, 0, tilt] });
            k.box([0.5, 0.12, 0.12], 'mist', [lx, tall * 0.8, lz], { rot: [0, 0, tilt] });
          } else {
            k.box([0.56, tall, 0.16], (row + col) % 2 ? 'slate' : 'mist', [lx, tall / 2, lz], { rot: [rng.range(-5, 5), 0, tilt], top: 'mist' });
            k.cyl(0.28, 0.28, 0.16, 6, (row + col) % 2 ? 'slate' : 'mist', [lx, tall, lz], { rot: [90, 0, 0] });
          }
          k.blockBox(lx, lz, 0.6, 0.3);
        }
      // the low wall on three sides, open toward the lane (local -Z, up the screen)
      for (const s of [-1, 1]) {
        k.box([0.4, 0.6, 6.6], 'slate', [s * 4.0, 0.3, 1.0], { top: 'mist' });
        k.blockBox(s * 4.0, 1.0, 0.4, 6.6);
      }
      k.box([8.4, 0.6, 0.4], 'slate', [0, 0.3, 4.3], { top: 'mist' });
      k.blockBox(0, 4.3, 8.4, 0.4);
      // the ground between the back wall and the edge is shut in (the gate's tower on one side, the
      // edge on the other): closed, out past the edge
      k.blockBox(0, 7.4, 8.4, 6);
      for (const s of [-1, 1]) k.box([0.6, 0.9, 0.6], 'mist', [s * 4.0, 0.45, -2.3], { top: 'slate' });
      for (const [cx, cz] of [
        [-0.9, -1.3],
        [0.95, 0.4],
        [-2.6, 2.3],
      ] as const)
        this.m('candles', [cx, 0, cz], { yaw: -45, block: false, seed: Math.round(cx * 10 + 50) });
    });
    this.taken.push({ sx: gx, sy: gy - 1, r: 5.2 });
    this.trunk('dead-tree', gx + 2.6, gy - 5.6, 0.4, { seed: 3 });
    this.put('kenney-nature/statue-block', gx + 5.6, gy + 2.6, { yaw: face(-30), r: 0.9 });
  }

  /**
   * The road out: a timber gate over the road (posts and a beam: it hides little of the road behind
   * it) between low palisades, a watch tower each side off the road, a signpost, a notice board, a cart.
   */
  gate(): void {
    const k = this.k;
    const [gx, gy] = L.gate;
    const [x, z] = iso(gx, gy);
    k.frame(x, z, 45, () => {
      // local X = screen right, local Z = toward the camera; the road runs along local Z
      for (const s of [-1, 1]) {
        k.box([0.32, 3.4, 0.32], 'plum', [s * 1.75, 1.7, 0]);
        k.box([0.5, 0.3, 0.5], 'slate', [s * 1.75, 0.15, 0]);
        k.blockCircle(s * 1.75, 0, 0.3);
        // the palisade out to the towers, and the towers
        this.m('kenney-nature/fence-planks-double', [s * 3.6, 0, 0], { block: false });
        k.blockBox(s * 3.6, 0, 3.1, 0.3);
        this.m('kenney-castle/tower-square-base', [s * 6.6, 0, 0.4], { palette: STONE });
        this.m('kenney-castle/tower-square-top-roof', [s * 6.6, 3.03, 0.4], { palette: STONE, block: false });
        k.closeBehind(s * 6.6, 0.4, 3, 3, { eaves: 3.4, ridge: 6 }, L.view);
      }
      k.box([4.2, 0.26, 0.3], 'plum', [0, 3.3, 0]);
      k.box([4.5, 0.12, 0.42], 'night', [0, 3.48, 0]);
      // the town's board under the beam: an ember on it
      k.box([1.8, 0.6, 0.08], 'orange', [0, 2.75, 0.12]);
      k.box([1.9, 0.08, 0.1], 'plum', [0, 3.08, 0.12]);
      k.box([0.3, 0.3, 0.1], 'red', [0, 2.75, 0.18], { rot: [0, 0, 45] });
      k.box([0.14, 0.14, 0.11], 'sand', [0, 2.75, 0.2], { rot: [0, 0, 45] });
      // past the gate the road leaves the town: nothing to walk to beyond it (closed from the gate's
      // line, no gap to be wedged in behind the palisade, and well past the edge, so anything
      // pushed out of it goes back into the town)
      k.blockBox(0, 3.3, 16, 6.3);
    });
    this.taken.push({ sx: gx, sy: gy, r: 2.4 }, { sx: gx - 3.6, sy: gy, r: 1.8 }, { sx: gx + 3.6, sy: gy, r: 1.8 }, { sx: gx - 6.6, sy: gy, r: 2.4 }, { sx: gx + 6.6, sy: gy, r: 2.4 });
    this.put('signpost', 2.6, -15.4, { yaw: face(-40), r: 1 });
    this.put('notice-board', -2.8, -21.0, { yaw: face(50), r: 1, seed: 6 });
    this.put('cart', 3.6, -23.2, { yaw: face(-10), r: 1.6 });
    this.put('crate', 2.4, -25.6, { yaw: 20, r: 0.6 });
    this.put('sack', 3.2, -26.0, { block: false, r: 0.5, seed: 4 });
  }

  /** Paths from the plaza's ring out to every district (`PATHS`). */
  paths(): void {
    for (const p of PATHS) this.path(p.points, p.width);
  }

  /** Trees, bushes and rocks between the districts, inside the edge. */
  woodlands(): void {
    const keep: Keep = (sx, sy) => {
      const r = Math.hypot(sx, sy);
      return r < 15.5 || Math.abs(sx - L.stream.sx) < 2.6 || nearPath(sx, sy);
    };
    const oaks = ['kenney-nature/tree-oak', 'kenney-nature/tree-fat', 'kenney-nature/tree-oak', 'kenney-nature/tree-fat'];
    const pines = ['kenney-nature/tree-pine-round-d', 'kenney-nature/tree-pine-small-b', 'kenney-nature/tree-pine-small-c', 'kenney-nature/tree-pine-small-c'];
    // the west bank between the market and the stream
    this.scatter(oaks, 6, [13, -9, 21, 10], { r: 1.6, keep, block: 0.35, scale: [0.85, 1.1] });
    // the north-west corner between the farm and the watch, the north-east behind the tavern
    this.scatter(pines, 7, [-24, 14, -12, 27], { r: 1.5, keep, block: 0.35 });
    this.scatter(oaks, 4, [8, 20, 21, 29], { r: 1.6, keep, block: 0.35 });
    // the south-west and south-east fringes
    this.scatter(oaks, 5, [-26, -24, -14, -10], { r: 1.6, keep, block: 0.35, scale: [0.85, 1.1] });
    this.scatter(pines, 4, [14, -27, 22, -12], { r: 1.5, keep, block: 0.35 });
    const small = ['kenney-nature/plant-bush', 'kenney-nature/plant-bush-large', 'kenney-nature/plant-bush-small', 'kenney-nature/grass-leafs', 'kenney-nature/flower-yellow-a', 'kenney-nature/flower-purple-a'];
    this.scatter(small, 34, [-31, -31, 31, 31], { r: 0.5, keep });
    this.scatter(['kenney-nature/stone-large-c', 'kenney-nature/stone-small-g', 'kenney-nature/stone-tall-e', 'kenney-nature/stump-old'], 8, [-30, -30, 30, 30], { r: 0.9, keep, block: 0.45 });
  }

  /** The forest past the edge: the town's own trees and pack trees in loose rings, small ones to the south. */
  forest(): void {
    // the low-poly kinds (50 to 120 triangles): there are a hundred and more of them
    const tall = ['kenney-nature/tree-pine-tall-a', 'kenney-nature/tree-pine-tall-c', 'kenney-nature/tree-default-dark', 'kenney-nature/tree-tall-dark', 'kenney-nature/tree-simple-dark', 'kenney-nature/tree-pine-tall-b'];
    const low = ['kenney-nature/tree-pine-small-c', 'kenney-nature/tree-pine-small-d', 'kenney-nature/tree-small-dark', 'kenney-nature/tree-fat-darkh', 'kenney-nature/plant-bush-large'];
    for (let ring = 0; ring < 4; ring++) {
      const r0 = L.radius + 1.6 + ring * 2.9;
      const n = Math.round((2 * Math.PI * r0) / (ring < 2 ? 3.6 : 5.2));
      for (let i = 0; i < n; i++) {
        const a = ((i + this.rng.range(-0.3, 0.3)) / n) * Math.PI * 2;
        const south = Math.sin(a) < -0.55; // toward the camera: low trees, a little farther out, so the edge stays in view
        const r = r0 + this.rng.range(-0.8, 0.8) + (south ? 2.4 : 0);
        const sx = Math.cos(a) * r;
        const sy = Math.sin(a) * r;
        if (Math.abs(sx - L.stream.sx) < 2.8 || (sy < 0 && Math.abs(sx) < 3.6) || !this.free(sx, sy, 0.9)) continue;
        const pick = this.rng.next();
        if (!south && pick < 0.3) this.glbTree(sx, sy, this.rng.range(1.2, 1.7));
        else this.trunk(this.rng.pick(south ? low : tall), sx, sy, 0.35, { scale: this.rng.range(0.9, 1.25) });
      }
    }
  }
}

/** Screen spots on (or right beside) the outskirts' paths. */
function nearPath(sx: number, sy: number): boolean {
  const near = (ax: number, ay: number, bx: number, by: number, w: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(sx - ax - dx * t, sy - ay - dy * t) < w;
  };
  for (const { points, width } of PATHS) for (let i = 0; i + 1 < points.length; i++) if (near(points[i]![0], points[i]![1], points[i + 1]![0], points[i + 1]![1], width / 2 + 1.1)) return true;
  return false;
}

const S = L.stream.sx;
const B = L.stream.bridge;
/** The Old Watch's gate (screen x): the colonnade runs up to it. */
const GATE_X = Math.cos(L.watch.gate * DEG) * L.watch.wall;
/** The outskirts' sand paths (screen space), out from the plaza's ring to every district. */
const PATHS: readonly { readonly points: readonly (readonly [number, number])[]; readonly width: number }[] = [
  // north: round the obelisk both ways; the west way goes on up the colonnade to the old gate
  { points: [[-3.4, 5.4], [-5.4, 9.4], [-3.6, 13.6], [GATE_X, 15.6], [GATE_X, 26.2]], width: 2.2 },
  { points: [[3.4, 5.4], [5.4, 9.4], [9.4, 15.0], [13.6, 15.2]], width: 2.2 },
  // from the tavern's patio down to the bridge, across it to the camp
  { points: [[13.6, 15.2], [17.8, 11.6], [19.0, 5.8], [S - 1.6, B]], width: 1.8 },
  { points: [[S + 1.6, B], [L.camp[0] - 1.6, L.camp[1] + 1.4]], width: 1.6 },
  // the south road out, the lane from it east to the bridge (past the graves), west to the pond
  { points: [[0, -10.8], [0, -44]], width: 2.6 },
  { points: [[0, -13.4], [8.4, -13.0], [15.2, -7.8], [19.2, -1.6], [S - 1.6, B]], width: 1.8 },
  { points: [[0, -16.6], [-5.2, -16.4], [L.pond[0] + 4.0, L.pond[1] + 2.0]], width: 1.6 },
  // west: round the red house to the farm, down past the field, back by the plum house
  { points: [[-5.4, 9.4], [-8.2, 15.0], [-14.8, 16.0], [-18.4, 10.8], [-18.4, -6.4], [-14.6, -9.4], [-9.6, -6.6], [-5.6, -3.4]], width: 1.8 },
  { points: [[-18.4, L.field[1] + 1.5], [-19.8, L.field[1] + 1.5]], width: 1.4 },
];

/** Build the outskirts into the town's kit. */
export function buildOutskirts(k: Kit, rng: Rng, tree: Object3D): OutskirtsBuild {
  const o = new Outskirts(k, rng, tree);
  o.reserveHub();
  o.paths();
  o.watch();
  o.tavern();
  o.stream();
  o.camp();
  o.farm();
  o.pond();
  o.graves();
  o.gate();
  o.woodlands();
  o.forest();
  return { campfire: o.campfire, rift: o.rift, chimneys: o.chimneys };
}

/** Screen spots on (or within `margin` of) the water, the stream and the pond: the ground's patches and tufts keep off. */
export function onWater(sx: number, sy: number, margin = 0): boolean {
  return Math.abs(sx - L.stream.sx) < 1.6 + margin || Math.hypot(sx - L.pond[0], sy - L.pond[1]) < 1.15 * L.pond[2] + margin;
}
