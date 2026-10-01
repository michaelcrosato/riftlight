import { Rng } from '../../core/rng';
import { type Cell, clearance, FLOOR, findPath, flood, Layout, type LayoutStyle, N4, type Room, type Spot, VOID, WALL } from './grid';
import { type Stencil, stencil, templatesFor } from './templates';

/**
 * The layout generator: LevelSpec.layout → a `Layout` (grid + rooms + spots + critical path).
 *
 *  1. A **graph grammar** grows the room graph: start → boss, then rules (data, `GRAMMAR`)
 *     insert combat rooms and connectors on the critical chain and hang side branches with
 *     treasure and shrines off it.
 *  2. **Placement** walks the graph and stamps a room template (rotated/mirrored stencil) for
 *     each node next to its parent, joined by a straight corridor, rejecting overlaps. The
 *     critical chain flows across the map; branches go sideways.
 *  3. **Style passes**: caves erode rooms into organic blobs (cellular automata), ruins break
 *     walls and scatter rubble, bridges leave void instead of walls; town has its own
 *     generator (districts and buildings). Arena = a short approach to a big boss room.
 *  4. **Walls** surround every floor cell (not for bridges), then the **critical path**
 *     (Dijkstra, preferring room centres) runs from the entrance to the exit.
 *  5. **Guarantee**: every room must be reachable from the start and the exit reachable;
 *     otherwise the attempt is thrown away and retried with a forked seed (and, after a few
 *     failures, a slightly larger grid). The same seed always gives the same layout.
 */

export interface LayoutParams {
  readonly style: LayoutStyle | string;
  /** Room count target (including start and boss). */
  readonly rooms: number;
  /** Grid size in cells (square). Grows by 10% after repeated failed attempts. */
  readonly size: number;
  readonly seed: number;
}

// ------------------------------------------------------------------ graph grammar

export type RoomRole = 'start' | 'combat' | 'treasure' | 'shrine' | 'boss' | 'hall';

export interface GraphNode {
  readonly id: number;
  readonly role: RoomRole;
  parent: number;
  critical: boolean;
}

export interface RoomGraph {
  readonly nodes: GraphNode[];
  /** Critical chain, start → boss. */
  readonly chain: number[];
}

export interface GrammarTargets {
  readonly rooms: number;
  readonly critical: number;
  readonly style: string;
}

/** A rewrite rule of the room-graph grammar. Rules are data: add one to change level shapes. */
export interface GrammarRule {
  readonly id: string;
  readonly weight: number;
  when(g: RoomGraph, t: GrammarTargets): boolean;
  apply(g: RoomGraph, rng: Rng): void;
}

function addNode(g: RoomGraph, role: RoomRole, parent: number, critical: boolean): GraphNode {
  const n: GraphNode = { id: g.nodes.length, role, parent, critical };
  g.nodes.push(n);
  return n;
}

/** Insert a node into the critical chain at a random position between start and boss. */
function insertCritical(g: RoomGraph, rng: Rng, role: RoomRole): void {
  const n = addNode(g, role, -1, true);
  const at = rng.int(1, g.chain.length - 1);
  g.chain.splice(at, 0, n.id);
  for (let i = 1; i < g.chain.length; i++) g.nodes[g.chain[i]!]!.parent = g.chain[i - 1]!;
}

/** A chain node that can carry a branch (not start or boss, not already crowded). */
function branchRoot(g: RoomGraph, rng: Rng): number {
  const options = g.chain.slice(1, -1).filter((id) => g.nodes.filter((n) => n.parent === id && !n.critical).length < 2);
  return rng.pick(options.length ? options : g.chain.slice(1, -1));
}

export const GRAMMAR: readonly GrammarRule[] = [
  {
    id: 'extend', // start → … → X → boss  ⇒  … → combat → X …
    weight: 5,
    when: (g, t) => g.chain.length < t.critical,
    apply: (g, rng) => insertCritical(g, rng, 'combat'),
  },
  {
    id: 'connector', // a quiet hall between fights (pacing)
    weight: 1,
    when: (g, t) => g.chain.length < t.critical && g.chain.length >= 4 && t.style !== 'town',
    apply: (g, rng) => insertCritical(g, rng, 'hall'),
  },
  {
    id: 'branch-treasure', // a dead end with a chest: the power-leveller's detour
    weight: 2,
    when: (g, t) => g.chain.length >= t.critical && g.nodes.length < t.rooms,
    apply: (g, rng) => void addNode(g, 'treasure', branchRoot(g, rng), false),
  },
  {
    id: 'branch-guarded', // combat → treasure off the main road
    weight: 1.5,
    when: (g, t) => g.chain.length >= t.critical && g.nodes.length + 1 < t.rooms,
    apply: (g, rng) => {
      const guard = addNode(g, 'combat', branchRoot(g, rng), false);
      addNode(g, 'treasure', guard.id, false);
    },
  },
  {
    id: 'branch-shrine',
    weight: 1.5,
    when: (g, t) => g.chain.length >= t.critical && g.nodes.length < t.rooms && g.nodes.filter((n) => n.role === 'shrine').length < 2,
    apply: (g, rng) => void addNode(g, 'shrine', branchRoot(g, rng), false),
  },
];

/** Grow a room graph for `rooms` rooms. */
export function buildGraph(rng: Rng, rooms: number, style: string): RoomGraph {
  const g: RoomGraph = { nodes: [], chain: [] };
  const start = addNode(g, 'start', -1, true);
  const boss = addNode(g, 'boss', start.id, true);
  g.chain.push(start.id, boss.id);
  const total = Math.max(3, rooms);
  const t: GrammarTargets = { rooms: total, critical: Math.max(3, Math.round(total * (style === 'arena' ? 0.8 : 0.62))), style };
  for (let guard = 0; guard < 200 && (g.nodes.length < t.rooms || g.chain.length < t.critical); guard++) {
    const rules = GRAMMAR.filter((r) => r.when(g, t));
    if (!rules.length) {
      // Out of rules but short of rooms: extend anyway.
      insertCritical(g, rng, 'combat');
      continue;
    }
    rng.weighted(rules, (r) => r.weight).apply(g, rng);
  }
  return g;
}

// ------------------------------------------------------------------ placement

interface Rect {
  x: number;
  z: number;
  w: number;
  h: number;
}

interface Placed {
  node: GraphNode;
  st: Stencil;
  x: number;
  z: number;
}

interface Corridor {
  rect: Rect;
  /** 'x' runs along x (east/west), 'z' along z. */
  axis: 'x' | 'z';
  a: number;
  b: number;
}

const STYLE: Record<LayoutStyle, { corridor: [number, number]; width: number }> = {
  dungeon: { corridor: [2, 5], width: 3 },
  caves: { corridor: [3, 6], width: 3 },
  ruins: { corridor: [2, 4], width: 3 },
  arena: { corridor: [3, 5], width: 3 },
  bridges: { corridor: [3, 7], width: 2 },
  town: { corridor: [2, 3], width: 4 },
};

const DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const overlaps = (a: Rect, b: Rect, m = 0) => a.x - m < b.x + b.w && b.x < a.x + a.w + m && a.z - m < b.z + b.h && b.z < a.z + a.h + m;

function asStyle(s: string): LayoutStyle {
  return (s in STYLE ? s : 'dungeon') as LayoutStyle;
}

/** Generate a layout. Deterministic for a given params object. */
export function generateLayout(params: LayoutParams): Layout {
  const style = asStyle(params.style);
  const root = new Rng(params.seed).fork(`layout:${style}`);
  let size = Math.max(32, Math.round(params.size));
  const reasons = new Map<string, number>();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (attempt > 0 && attempt % 6 === 0) size = Math.round(size * 1.1);
    const rng = root.fork(`attempt:${attempt}`);
    const rooms = style === 'arena' ? Math.min(params.rooms, 5) : params.rooms;
    const layout = style === 'town' ? generateTown(rng, rooms, size, params.seed) : generateRooms(rng, style, rooms, size, params.seed);
    const problem = typeof layout === 'string' ? layout : finish(layout);
    if (!problem && typeof layout !== 'string') {
      layout.attempts = attempt + 1;
      return layout;
    }
    reasons.set(problem!, (reasons.get(problem!) ?? 0) + 1);
  }
  const why = [...reasons].map(([r, n]) => `${r} ×${n}`).join(', ');
  throw new Error(`generateLayout: no valid ${style} layout for seed ${params.seed} (${params.rooms} rooms, size ${params.size}): ${why}`);
}

/** A layout, or why the attempt failed. */
function generateRooms(rng: Rng, style: LayoutStyle, rooms: number, size: number, seed: number): Layout | string {
  const graph = buildGraph(rng.fork('graph'), rooms, style);
  const cfg = STYLE[style];
  const placed: Placed[] = [];
  const corridors: Corridor[] = [];
  const rects = () => placed.map((p) => ({ x: p.x, z: p.z, w: p.st.w, h: p.st.h }));
  // The critical chain flows across the map along two directions (e.g. east and south).
  const flowA = rng.int(0, 3);
  const flowB = (flowA + (rng.chance(0.5) ? 1 : 3)) % 4;
  const flow = [flowA, flowB];

  const pickStencil = (node: GraphNode, r: Rng): Stencil => {
    const t = r.weighted(templatesFor(node.role, style), (e) => e.weight ?? 1);
    return stencil(t, r.int(0, 3), r.chance(0.5));
  };

  /** One placement attempt of `node` next to `p`; pushes the room + corridor on success. */
  const tryPlace = (node: GraphNode, p: Placed, r: Rng): boolean => {
    const id = node.id;
    const st = pickStencil(node, r);
    // Critical rooms go with the flow (sideways sometimes), branches sideways or anywhere.
    const dirWeights = DIRS.map((_, i) => {
      if (node.critical) return flow.includes(i) ? 4 : flow.includes((i + 2) % 4) ? 0 : 1;
      return flow.includes(i) ? 1 : 2;
    });
    const dir = r.weighted([0, 1, 2, 3], (i) => dirWeights[i]!);
    const [ddx, ddz] = DIRS[dir]!;
    const len = r.int(cfg.corridor[0], cfg.corridor[1]);
    const cw = cfg.width;
    let x: number;
    let z: number;
    if (ddx !== 0) {
      x = ddx > 0 ? p.x + p.st.w + len : p.x - len - st.w;
      const lo = p.z - st.h + cw + 2;
      const hi = p.z + p.st.h - cw - 2;
      if (hi < lo) return false;
      z = r.int(lo, hi);
    } else {
      z = ddz > 0 ? p.z + p.st.h + len : p.z - len - st.h;
      const lo = p.x - st.w + cw + 2;
      const hi = p.x + p.st.w - cw - 2;
      if (hi < lo) return false;
      x = r.int(lo, hi);
    }
    if (x < 3 || z < 3 || x + st.w > size - 3 || z + st.h > size - 3) return false;
    const rect: Rect = { x, z, w: st.w, h: st.h };
    if (rects().some((o) => overlaps(rect, o, 2))) return false;
    // Corridor across the gap, inside the overlap of both rooms' spans.
    let corr: Corridor;
    if (ddx !== 0) {
      const lo = Math.max(p.z, z) + 1;
      const hi = Math.min(p.z + p.st.h, z + st.h) - 1 - cw;
      if (hi < lo) return false;
      const cz = r.int(lo, hi);
      const x0 = ddx > 0 ? p.x + p.st.w : x + st.w;
      corr = { rect: { x: x0, z: cz, w: len, h: cw }, axis: 'x', a: p.node.id, b: id };
    } else {
      const lo = Math.max(p.x, x) + 1;
      const hi = Math.min(p.x + p.st.w, x + st.w) - 1 - cw;
      if (hi < lo) return false;
      const cx = r.int(lo, hi);
      const z0 = ddz > 0 ? p.z + p.st.h : z + st.h;
      corr = { rect: { x: cx, z: z0, w: cw, h: len }, axis: 'z', a: p.node.id, b: id };
    }
    const others = placed.filter((o) => o !== p).map((o) => ({ x: o.x, z: o.z, w: o.st.w, h: o.st.h }));
    if (others.some((o) => overlaps(corr.rect, o, 2))) return false;
    if (corridors.some((c) => overlaps(corr.rect, c.rect, 1))) return false;
    placed.push({ node, st, x, z });
    corridors.push(corr);
    return true;
  };

  // Start room in the corner the flow leaves from.
  const startNode = graph.nodes[0]!;
  const st0 = pickStencil(startNode, rng.fork('room:0'));
  const dx = DIRS[flowA]![0] + DIRS[flowB]![0];
  const dz = DIRS[flowA]![1] + DIRS[flowB]![1];
  const sx = dx > 0 ? 3 : dx < 0 ? size - 3 - st0.w : Math.floor((size - st0.w) / 2);
  const sz = dz > 0 ? 3 : dz < 0 ? size - 3 - st0.h : Math.floor((size - st0.h) / 2);
  placed.push({ node: startNode, st: st0, x: sx, z: sz });

  // Breadth-first over the tree: the chain first (in order), then branches.
  const order = [...graph.chain.slice(1), ...graph.nodes.filter((n) => !n.critical).map((n) => n.id)];
  for (const id of order) {
    const node = graph.nodes[id]!;
    const own = placed.find((p) => p.node.id === node.parent);
    if (!own) return `no parent for ${node.role}`;
    const r = rng.fork(`room:${id}`);
    // Branches may move to another chain room when their own has no space left.
    const parents = node.critical ? [own] : [own, ...r.shuffle(placed.filter((p) => p !== own && p.node.critical && p.node.role !== 'boss'))];
    let ok = false;
    for (const parent of parents) {
      for (let tries = 0; tries < (parent === own ? 40 : 12) && !ok; tries++) ok = tryPlace(node, parent, r);
      if (ok) {
        node.parent = parent.node.id;
        break;
      }
    }
    if (!ok) return `no space for ${node.critical ? 'critical' : 'side'} ${node.role}`;
  }

  // Loops: extra corridors between close, aligned rooms (alternative routes).
  if (style !== 'arena' && style !== 'bridges') addLoops(rng.fork('loops'), placed, corridors, cfg.width);

  // ---------------------------------------------------------------- carve
  const layout = new Layout(size, size, style, seed);
  const W = size;
  const pit = new Uint8Array(W * size);
  const pillar = new Uint8Array(W * size);
  const protect = new Uint8Array(W * size); // spots + corridor cells: style passes keep them
  const roomsOut: Room[] = [];
  const spots: Spot[] = [];
  const idOf = new Map<number, number>(); // graph node → room id
  placed.forEach((p, i) => idOf.set(p.node.id, i));
  const depthOf = graphDepths(graph);
  placed.forEach((p, i) => {
    const n = p.node;
    roomsOut.push({
      id: i,
      x: p.x,
      z: p.z,
      w: p.st.w,
      h: p.st.h,
      tags: [n.role, ...(n.critical ? ['critical'] : ['side'])],
      template: p.st.template,
      critical: n.critical,
      depth: depthOf.get(n.id) ?? 0,
    });
    for (let z = 0; z < p.st.h; z++) {
      for (let x = 0; x < p.st.w; x++) {
        const c = p.st.cells[z * p.st.w + x];
        if (!c) continue;
        const gi = (p.z + z) * W + p.x + x;
        layout.roomOf[gi] = i;
        if (c === 'floor') layout.cells[gi] = FLOOR;
        else if (c === 'pit') pit[gi] = 1;
        else pillar[gi] = 1;
      }
    }
    for (const s of p.st.spots) {
      spots.push({ x: p.x + s.x, z: p.z + s.z, tag: s.tag, room: i });
      protect[(p.z + s.z) * W + p.x + s.x] = 1;
    }
  });
  for (const c of corridors) carveCorridor(layout, c, pit, pillar, protect);
  layout.rooms = roomsOut;
  layout.edges = corridors.map((c) => [idOf.get(c.a)!, idOf.get(c.b)!]);
  layout.critical = graph.chain.map((id) => idOf.get(id)!);
  layout.spots = spots;

  if (style === 'caves') erodeCaves(layout, rng.fork('caves'), protect, pit, pillar);
  // Pillars are solid; pits stay void.
  for (let i = 0; i < W * size; i++) if (pillar[i] && layout.cells[i] !== FLOOR) layout.cells[i] = WALL;
  if (style === 'caves') for (let i = 0; i < W * size; i++) if (pillar[i]) layout.cells[i] = WALL;
  buildWalls(layout, style === 'bridges' ? null : pit);
  if (style === 'ruins') ruin(layout, rng.fork('ruins'), protect);
  return layout;
}

function graphDepths(g: RoomGraph): Map<number, number> {
  const d = new Map<number, number>();
  const get = (id: number): number => {
    const cached = d.get(id);
    if (cached !== undefined) return cached;
    const n = g.nodes[id]!;
    const v = n.parent < 0 ? 0 : get(n.parent) + 1;
    d.set(id, v);
    return v;
  };
  for (const n of g.nodes) get(n.id);
  return d;
}

function addLoops(rng: Rng, placed: Placed[], corridors: Corridor[], cw: number): void {
  const connected = new Set(corridors.map((c) => `${Math.min(c.a, c.b)}:${Math.max(c.a, c.b)}`));
  let added = 0;
  const pairs: [Placed, Placed][] = [];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) pairs.push([placed[i]!, placed[j]!]);
  rng.shuffle(pairs);
  for (const [p, q] of pairs) {
    if (added >= 2) break;
    const k = `${Math.min(p.node.id, q.node.id)}:${Math.max(p.node.id, q.node.id)}`;
    if (connected.has(k)) continue;
    let corr: Corridor | null = null;
    // East-west neighbours.
    const [l, r] = p.x < q.x ? [p, q] : [q, p];
    const gapX = r.x - (l.x + l.st.w);
    const lo = Math.max(p.z, q.z) + 1;
    const hi = Math.min(p.z + p.st.h, q.z + q.st.h) - 1 - cw;
    if (gapX >= 2 && gapX <= 7 && hi >= lo) corr = { rect: { x: l.x + l.st.w, z: rng.int(lo, hi), w: gapX, h: cw }, axis: 'x', a: l.node.id, b: r.node.id };
    else {
      const [t, b] = p.z < q.z ? [p, q] : [q, p];
      const gapZ = b.z - (t.z + t.st.h);
      const lo2 = Math.max(p.x, q.x) + 1;
      const hi2 = Math.min(p.x + p.st.w, q.x + q.st.w) - 1 - cw;
      if (gapZ >= 2 && gapZ <= 7 && hi2 >= lo2) corr = { rect: { x: rng.int(lo2, hi2), z: t.z + t.st.h, w: cw, h: gapZ }, axis: 'z', a: t.node.id, b: b.node.id };
    }
    if (!corr) continue;
    const c = corr;
    const blocked =
      placed.some((o) => o !== p && o !== q && overlaps(c.rect, { x: o.x, z: o.z, w: o.st.w, h: o.st.h }, 2)) || corridors.some((o) => overlaps(c.rect, o.rect, 1));
    if (blocked) continue;
    corridors.push(c);
    connected.add(k);
    added++;
  }
}

/** Carve a corridor and extend it into both rooms until it meets their floor. */
function carveCorridor(layout: Layout, c: Corridor, pit: Uint8Array, pillar: Uint8Array, protect: Uint8Array): void {
  const W = layout.width;
  const { x, z, w, h } = c.rect;
  const carve = (cx: number, cz: number) => {
    const i = cz * W + cx;
    layout.cells[i] = FLOOR;
    pit[i] = 0;
    pillar[i] = 0;
    protect[i] = 1;
  };
  for (let zz = z; zz < z + h; zz++) for (let xx = x; xx < x + w; xx++) carve(xx, zz);
  // Extend each lane into the rooms on both ends.
  if (c.axis === 'x') {
    for (let zz = z; zz < z + h; zz++) {
      for (let xx = x - 1; xx >= 0 && layout.cells[zz * W + xx] !== FLOOR; xx--) carve(xx, zz);
      for (let xx = x + w; xx < W && layout.cells[zz * W + xx] !== FLOOR; xx++) carve(xx, zz);
    }
  } else {
    for (let xx = x; xx < x + w; xx++) {
      for (let zz = z - 1; zz >= 0 && layout.cells[zz * W + xx] !== FLOOR; zz--) carve(xx, zz);
      for (let zz = z + h; zz < layout.height && layout.cells[zz * W + xx] !== FLOOR; zz++) carve(xx, zz);
    }
  }
}

/** Every non-floor cell next to floor (8-neighbourhood) becomes wall; pits stay void. */
function buildWalls(layout: Layout, pit: Uint8Array | null): void {
  const W = layout.width;
  const H = layout.height;
  if (!pit) return; // bridges: void all around
  const out = layout.cells.slice();
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      if (layout.cells[i] !== VOID || pit[i]) continue;
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nz >= 0 && nx < W && nz < H && layout.cells[nz * W + nx] === FLOOR) {
            near = true;
            break;
          }
        }
      if (near) out[i] = WALL;
    }
  }
  layout.cells.set(out);
}

/** Caves: grow and smooth each room into an organic blob (cellular automata). */
function erodeCaves(layout: Layout, rng: Rng, protect: Uint8Array, pit: Uint8Array, pillar: Uint8Array): void {
  const W = layout.width;
  const H = layout.height;
  for (const room of layout.rooms) {
    const x0 = Math.max(1, room.x - 2);
    const z0 = Math.max(1, room.z - 2);
    const x1 = Math.min(W - 2, room.x + room.w + 1);
    const z1 = Math.min(H - 2, room.z + room.h + 1);
    const floorN = (x: number, z: number) => {
      let n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && layout.cells[(z + dz) * W + x + dx] === FLOOR) n++;
      return n;
    };
    // Grow: random bulges out of the room's edge.
    for (let pass = 0; pass < 2; pass++) {
      const grow: number[] = [];
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const i = z * W + x;
          if (layout.cells[i] === FLOOR || pit[i] || pillar[i]) continue;
          if (floorN(x, z) >= 2 && rng.chance(0.42)) grow.push(i);
        }
      for (const i of grow) {
        layout.cells[i] = FLOOR;
        if (layout.roomOf[i]! < 0) layout.roomOf[i] = room.id;
      }
    }
    // Smooth: lonely floor goes, enclosed rock opens up.
    for (let pass = 0; pass < 2; pass++) {
      const next = layout.cells.slice();
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const i = z * W + x;
          if (protect[i] || pit[i] || pillar[i]) continue;
          const n = floorN(x, z);
          if (layout.cells[i] === FLOOR && n <= 2) next[i] = VOID;
          else if (layout.cells[i] !== FLOOR && n >= 6) {
            next[i] = FLOOR;
            if (layout.roomOf[i]! < 0) layout.roomOf[i] = room.id;
          }
        }
      layout.cells.set(next);
    }
  }
  // Rocky outcrops inside big caverns (single cells: can't disconnect anything).
  const clr = clearance(W, H, (i) => layout.cells[i] === FLOOR);
  for (let i = 0; i < W * H; i++) if (clr[i]! >= 4 && !protect[i] && rng.chance(0.03)) pillar[i] = 1;
}

/** Ruins: break thin walls into gaps, scatter rubble on open floor. */
function ruin(layout: Layout, rng: Rng, protect: Uint8Array): void {
  const W = layout.width;
  const H = layout.height;
  const c = layout.cells;
  for (let z = 1; z < H - 1; z++)
    for (let x = 1; x < W - 1; x++) {
      const i = z * W + x;
      if (c[i] !== WALL) continue;
      const ew = c[i - 1] === FLOOR && c[i + 1] === FLOOR;
      const ns = c[i - W] === FLOOR && c[i + W] === FLOOR;
      if ((ew || ns) && rng.chance(0.45)) c[i] = FLOOR;
    }
  // Rubble: isolated single blocks on open floor (all 8 neighbours floor, so never a blocker).
  for (let z = 2; z < H - 2; z++)
    for (let x = 2; x < W - 2; x++) {
      const i = z * W + x;
      if (c[i] !== FLOOR || protect[i] || !rng.chance(0.025)) continue;
      let open = true;
      for (let dz = -2; dz <= 2 && open; dz++) for (let dx = -2; dx <= 2; dx++) if (c[(z + dz) * W + x + dx] !== FLOOR) open = false;
      if (open) c[i] = WALL;
    }
}

// ------------------------------------------------------------------ town

/** Town-like open layout: districts (rooms) on a street grid, buildings as wall blocks. */
function generateTown(rng: Rng, rooms: number, size: number, seed: number): Layout | string {
  const layout = new Layout(size, size, 'town', seed);
  const W = size;
  const cols = Math.max(2, Math.round(Math.sqrt(rooms * 1.3)));
  const rows = Math.max(2, Math.ceil(rooms / cols));
  const margin = 3;
  const street = 4;
  const dw = Math.floor((size - 2 * margin - (cols - 1) * street) / cols);
  const dh = Math.floor((size - 2 * margin - (rows - 1) * street) / rows);
  if (dw < 11 || dh < 11) return 'districts too small';
  // Carve the whole town area.
  const x0 = margin;
  const z0 = margin;
  const x1 = margin + cols * dw + (cols - 1) * street;
  const z1 = margin + rows * dh + (rows - 1) * street;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) layout.cells[z * W + x] = FLOOR;
  // Districts, numbered in a snake from the start corner, so the critical chain is a tour.
  const cellsOrder: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) cellsOrder.push([r % 2 ? cols - 1 - k : k, r]);
  const used = cellsOrder.slice(0, Math.min(rooms, cols * rows));
  const n = used.length;
  const spots: Spot[] = [];
  const out: Room[] = [];
  used.forEach(([cx, cz], id) => {
    const x = x0 + cx * (dw + street);
    const z = z0 + cz * (dh + street);
    const role = id === 0 ? 'start' : id === n - 1 ? 'boss' : rng.chance(0.2) ? 'treasure' : rng.chance(0.15) ? 'shrine' : 'combat';
    out.push({ id, x, z, w: dw, h: dh, tags: [role, id === 0 || id === n - 1 || role === 'combat' ? 'critical' : 'side'], template: 'district', critical: true, depth: id });
    for (let zz = z; zz < z + dh; zz++) for (let xx = x; xx < x + dw; xx++) layout.roomOf[zz * W + xx] = id;
    const mid = { x: x + (dw >> 1), z: z + (dh >> 1) };
    const spot = (tag: Spot['tag'], sx: number, sz: number) => spots.push({ x: sx, z: sz, tag, room: id });
    if (role === 'start') spot('entrance', mid.x, mid.z);
    else if (role === 'boss') {
      spot('boss', mid.x, mid.z);
      spot('exit', mid.x, z + dh - 2);
      spot('spawn', mid.x - 3, mid.z - 2);
      spot('spawn', mid.x + 3, mid.z - 2);
    } else {
      // Buildings in the corners of the district, a plaza in the middle.
      for (const [qx, qz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        if (!rng.chance(0.9)) continue;
        const bw = rng.int(4, Math.max(4, (dw >> 1) - 2));
        const bh = rng.int(4, Math.max(4, (dh >> 1) - 2));
        const bx = qx ? x + dw - 1 - bw : x + 1;
        const bz = qz ? z + dh - 1 - bh : z + 1;
        for (let zz = bz; zz < bz + bh; zz++) for (let xx = bx; xx < bx + bw; xx++) layout.cells[zz * W + xx] = WALL;
      }
      if (role === 'treasure') spot('treasure', mid.x, mid.z);
      else if (role === 'shrine') spot('shrine', mid.x, mid.z);
      spot('spawn', mid.x - 2, mid.z);
      spot('spawn', mid.x + 2, mid.z + 1);
      spot('mechanic', mid.x, mid.z - 3);
      spot('mechanic', mid.x, mid.z + 3);
      spot('prop', mid.x + 3, mid.z - 3);
    }
  });
  layout.rooms = out;
  layout.edges = out.slice(1).map((r) => [r.id - 1, r.id]);
  layout.critical = out.map((r) => r.id);
  layout.spots = spots;
  buildWalls(layout, new Uint8Array(W * size));
  return layout;
}

// ------------------------------------------------------------------ finish + checks

/** Entrance/exit, critical path and the reachability guarantee. A string = reject the attempt (why). */
function finish(layout: Layout): string | null {
  const W = layout.width;
  const H = layout.height;
  const entrance = layout.spots.find((s) => s.tag === 'entrance');
  const exit = layout.spots.find((s) => s.tag === 'exit');
  if (!entrance || !exit) return 'no entrance or exit';
  layout.start = { x: entrance.x, z: entrance.z };
  layout.exit = { x: exit.x, z: exit.z };
  // Spots must be standable (style passes may have eaten one): drop the ones that aren't.
  layout.spots = layout.spots.filter((s) => layout.isFloor(s.x, s.z));
  if (!layout.isFloor(layout.start.x, layout.start.z) || !layout.isFloor(layout.exit.x, layout.exit.z)) return 'entrance or exit not on floor';
  const walk = (i: number) => layout.cells[i] === FLOOR;
  const reach = flood(W, H, layout.start, walk);
  // Every room must be reachable (at least one of its floor cells).
  for (const r of layout.rooms) {
    let ok = false;
    for (let z = r.z; z < r.z + r.h && !ok; z++) for (let x = r.x; x < r.x + r.w; x++) if (reach[z * W + x] && layout.roomOf[z * W + x] === r.id) ok = true;
    if (!ok) return 'unreachable room';
  }
  // Unreachable pockets (cave bubbles) become rock; their spots go too.
  const pocket = layout.style === 'bridges' ? VOID : WALL;
  for (let i = 0; i < W * H; i++) if (layout.cells[i] === FLOOR && !reach[i]) layout.cells[i] = pocket;
  layout.spots = layout.spots.filter((s) => reach[s.z * W + s.x]);
  const clr = clearance(W, H, walk);
  layout.path = criticalPath(layout, clr);
  return layout.path.length > 0 ? null : 'exit unreachable';
}

/** Dijkstra start → exit preferring cells away from walls (the middle of rooms and corridors). */
export function criticalPath(layout: Layout, clr?: Uint8Array): Cell[] {
  const W = layout.width;
  const walk = (i: number) => layout.cells[i] === FLOOR;
  const c = clr ?? clearance(W, layout.height, walk);
  return findPath(W, layout.height, layout.start, layout.exit, walk, (i) => (c[i]! <= 1 ? 2 : c[i]! === 2 ? 0.4 : 0));
}

/** Cells within `r` (Chebyshev) of the path: kept free of mechanic elements. */
export function pathCorridor(layout: Layout, r = 1): Uint8Array {
  const W = layout.width;
  const H = layout.height;
  const out = new Uint8Array(W * H);
  for (const p of layout.path)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (x >= 0 && z >= 0 && x < W && z < H) out[z * W + x] = 1;
      }
  return out;
}

export { N4 };
