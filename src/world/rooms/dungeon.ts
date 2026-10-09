/**
 * Dungeon Forge: wave function collapse builds a dungeon from ten 3 x 3 tiles (and their
 * turns) whose edges must match. Watch it decide one cell at a time, least certain last, each
 * choice ruling out tiles next door; then a flood fill from the entrance finds the rooms you
 * can't reach. Walls become colliders when it is done, and you can walk in.
 */
import { BoxGeometry, Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { PALETTE, patternTiles, type RAPIER, toonMaterial, Wfc } from '../../engine';
import { Grid } from '../kit/map';
import type { Knob, RoomDef } from '../types';

/** Tiles across and down, sub-cells per tile side, metres per sub-cell. */
const TW = 11;
const TH = 6;
const N = 3;
const CELL = 1.2;
const SW = TW * N; // sub-cells across
const SH = TH * N;
/** The dungeon's centre (x, z): north of the plaza. */
const CX = 0;
const CZ = -4.2;
const WALL = 1.4;

/** Each look's tile weights: rock, hall, corner, tee, cross, end, floor, wall, nook, door. */
const LOOKS: readonly { name: string; weights: readonly number[] }[] = [
  { name: 'Mixed', weights: [2.5, 2, 1, 0.5, 0.3, 0.3, 2, 1, 1, 0.5] },
  { name: 'Mazes', weights: [2, 4, 3, 1.2, 0.6, 0.4, 0.2, 0.2, 0.2, 0.05] },
  { name: 'Halls', weights: [1, 0.8, 0.6, 0.2, 0.1, 0.1, 5, 2, 1.5, 0.8] },
];
const PATTERNS: readonly { name: string; pattern: readonly string[] }[] = [
  { name: 'rock', pattern: ['###', '###', '###'] },
  { name: 'hall', pattern: ['#.#', '#.#', '#.#'] },
  { name: 'corner', pattern: ['#.#', '#..', '###'] },
  { name: 'tee', pattern: ['#.#', '...', '###'] },
  { name: 'cross', pattern: ['#.#', '...', '#.#'] },
  { name: 'end', pattern: ['#.#', '#.#', '###'] },
  { name: 'floor', pattern: ['...', '...', '...'] },
  { name: 'wall', pattern: ['###', '...', '...'] },
  { name: 'nook', pattern: ['###', '#..', '#..'] },
  { name: 'door', pattern: ['#.#', '...', '...'] },
];

export const DUNGEON: RoomDef = {
  id: 'dungeon',
  title: 'Dungeon Forge',
  wing: 'procedural',
  about:
    'A dungeon built by wave function collapse: ten little tiles (and their turns) whose edges must match their neighbours. Watch it decide one square at a time, always the least certain one next, each choice ruling out tiles next door. Then walk in. A flood fill from the door finds the rooms nobody can reach.',
  try: ['Step on SOLVE and watch it collapse', 'NEW SEED, then walk the halls', 'Mazes, Halls or Mixed (T)', 'Find a sealed room (dark floor)'],
  spawn: [0, 0, 11],
  facing: Math.PI,
  background: 'night',
  // steeper and further out than the other rooms: the whole floor plan in view, down into the halls
  camera: { preset: 'iso', pitch: 60, yaw: 45, viewHeight: 24, stiffness: 7, minZoom: 0.4, maxZoom: 3 },
  guide: {
    what: 'A dungeon floor north of the plaza, built from 3 x 3 tiles, its walls rising as each square is decided; pads that solve it slowly or at once, or with a new seed.',
    how: [
      'The tiles are tiny maps (# wall, . floor), each turned four ways. A tile\'s edges are its border rows and columns read as strings: two tiles may sit side by side when the edges that touch are the same.',
      'Every square starts able to be any tile (the "wave"). Its entropy is how undecided it is: many likely options, high; one option, zero.',
      'Each step decides the square with the least entropy (ties broken at random) by picking one of its tiles, weighted. Then constraint propagation: each neighbour drops the tiles that no longer fit anything left here, and if that changed it, its neighbours check again, and so on.',
      'If a square runs out of options (a contradiction), it starts again with the next seed. Squares on the edge must show wall outward, except the entrance, fixed to a hall going south.',
      'The rules are only local: two squares fit, but nothing promises every room joins up. A flood fill from the entrance walks every floor square it can reach; the rest (dark) are sealed. A game would regenerate, or knock a door through.',
    ],
    uses: [
      'Townscaper and Bad North build with it; Caves of Qud generates levels with it; Oskar Stalberg\'s and Maxim Gumin\'s demos made it famous.',
      'Tile-based level generation in roguelikes, texture synthesis, and puzzle solvers (sudoku is the same propagation).',
    ],
    ask: ['wave function collapse level generation', 'a dungeon from tiles that must fit together', 'procedural dungeon with a seed', 'check every room is reachable (flood fill)'],
    cost: 'Each step looks at every square for the least entropy and propagates through its neighbours: a few milliseconds for the whole 11 x 6 grid of 29 tiles. Drawing is one instanced mesh of 594 boxes; the walls become merged box colliders.',
    code: [
      {
        title: 'Observe: the least entropy, a hair of noise to break ties',
        file: 'src/engine/procgen/wfc.ts',
        src: `const e = this.entropy(c) + this.rand() * 1e-6;`,
      },
      {
        title: 'Propagate: a neighbour\'s tile goes when nothing here fits it',
        file: 'src/engine/procgen/wfc.ts',
        src: `for (let a = 0; a < T && !supported; a++) supported = this.wave[c * T + a] === 1 && fits[a * T + b] === 1;
this.ban(n, b);`,
      },
      {
        title: 'Two tiles fit when the edges that touch are the same',
        file: 'src/engine/procgen/wfc.ts',
        src: `for (let a = 0; a < T; a++) for (let b = 0; b < T; b++) f[a * T + b] = tiles[a]!.edges[d] === tiles[b]!.edges[OPP[d]!] ? 1 : 0;`,
      },
    ],
    words: ['wave function collapse', 'entropy', 'constraint propagation', 'flood fill', 'seed', 'procedural generation'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(42, 32, { floor: ['night', 'ink'], wall: { color: 'plum', side: 'ink' } });
    kit.label([0, 3.4, CZ - SH * CELL * 0.5 - 0.2], 'WAVE FUNCTION COLLAPSE', { color: 'sand', range: 30 });

    // one box per sub-cell, scaled and tinted to show what it is
    const boxes = new InstancedMesh(new BoxGeometry(1, 1, 1), toonMaterial(0xffffff), SW * SH);
    boxes.castShadow = true;
    boxes.receiveShadow = true;
    boxes.frustumCulled = false;
    const tint = new Color();
    for (let i = 0; i < SW * SH; i++) boxes.setColorAt(i, tint.setHex(PALETTE.mist)); // instanceColor before the first draw
    ctx.scene.add(boxes);

    let seed = 1;
    let look = 0;
    let speed = 40; // collapses per second while watching
    let watching = false;
    let budget = 0;
    let wfc: Wfc;
    let tiles = patternTiles(PATTERNS.map((p, i) => ({ ...p, weight: LOOKS[look]!.weights[i] })));
    const entry = Math.floor(TW / 2) + (TH - 1) * TW;
    let colliders: RAPIER.Collider[] = [];
    let reach = { floor: 0, reachable: 0 };
    const sealed = new Uint8Array(SW * SH); // floor squares the flood fill never reached

    const start = () => {
      tiles = patternTiles(PATTERNS.map((p, i) => ({ ...p, weight: LOOKS[look]!.weights[i] })));
      const hall = tiles.findIndex((t) => t.name === 'hall');
      wfc = new Wfc(tiles, TW, TH, { seed, border: '###', fixed: { [entry]: hall } });
      for (const c of colliders) ctx.physics.remove(c);
      colliders = [];
      sealed.fill(0);
      reach = { floor: 0, reachable: 0 };
    };
    const charAt = (sx: number, sy: number): string | null => {
      const t = wfc.result[Math.floor(sx / N) + Math.floor(sy / N) * TW]!;
      if (t < 0 || wfc.options[Math.floor(sx / N) + Math.floor(sy / N) * TW] !== 1) return null;
      return (tiles[t] as (typeof tiles)[number]).pattern[sy % N]![sx % N]!;
    };
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const maxEntropy = Math.log(tiles.length);
    const draw = () => {
      for (let sy = 0; sy < SH; sy++) {
        for (let sx = 0; sx < SW; sx++) {
          const i = sx + sy * SW;
          const x = CX + (sx + 0.5 - SW / 2) * CELL;
          const z = CZ + (sy + 0.5 - SH / 2) * CELL;
          const ch = charAt(sx, sy);
          if (ch === '#') {
            m.compose(p.set(x, WALL / 2, z), q, s.set(CELL, WALL, CELL));
            tint.setHex(PALETTE.slate);
          } else if (ch === '.') {
            m.compose(p.set(x, 0.03, z), q, s.set(CELL * 0.96, 0.06, CELL * 0.96));
            tint.setHex(sealed[i] ? PALETTE.night : PALETTE.sand);
          } else {
            // undecided: a thin tile, bluer the fewer options are left
            const c = Math.floor(sx / N) + Math.floor(sy / N) * TW;
            const e = Math.min(1, wfc.entropy(c) / maxEntropy);
            m.compose(p.set(x, 0.02, z), q, s.set(CELL * 0.9, 0.04, CELL * 0.9));
            tint.setHex(PALETTE.sky).lerp(new Color(PALETTE.mist), e);
          }
          boxes.setMatrixAt(i, m);
          boxes.setColorAt(i, tint);
        }
      }
      boxes.instanceMatrix.needsUpdate = true;
      if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    };
    /** Done: walls become colliders (merged runs), the flood fill marks what can't be reached. */
    const finish = () => {
      const rows = Array.from({ length: SH }, (_, sy) => Array.from({ length: SW }, (_, sx) => charAt(sx, sy) ?? '#').join(''));
      const grid = new Grid(rows, CELL);
      for (const r of grid.merge((ch) => (ch === '#' ? '#' : null))) {
        const b = grid.rect(r);
        colliders.push(ctx.physics.addStaticBox({ position: [CX + b.x, WALL / 2, CZ + b.z], halfExtents: [b.w / 2, WALL / 2, b.d / 2] }));
      }
      // flood fill from the entrance's open sub-cell on the bottom row
      const seen = new Uint8Array(SW * SH);
      const startX = (entry % TW) * N + 1;
      const queue = [startX + (SH - 1) * SW];
      seen[queue[0]!] = 1;
      while (queue.length) {
        const i = queue.pop()!;
        const x = i % SW;
        const y = (i - x) / SW;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          const j = nx + ny * SW;
          if (nx < 0 || ny < 0 || nx >= SW || ny >= SH || seen[j] || rows[ny]![nx] !== '.') continue;
          seen[j] = 1;
          queue.push(j);
        }
      }
      let floor = 0;
      let reachable = 0;
      for (let i = 0; i < SW * SH; i++) {
        if (rows[Math.floor(i / SW)]![i % SW] !== '.') continue;
        floor++;
        if (seen[i]) reachable++;
        else sealed[i] = 1;
      }
      reach = { floor, reachable };
      // anyone a wall just rose into (anywhere under their capsule) goes back to the plaza
      const h = room.hero?.hero;
      if (h) {
        const f = h.feetInto(p);
        const inWall = [
          [0, 0],
          [0.3, 0.3],
          [0.3, -0.3],
          [-0.3, 0.3],
          [-0.3, -0.3],
        ].some(([dx, dz]) => {
          const sx = Math.floor((f.x + dx! - CX) / CELL + SW / 2);
          const sy = Math.floor((f.z + dz! - CZ) / CELL + SH / 2);
          return sx >= 0 && sy >= 0 && sx < SW && sy < SH && rows[sy]![sx] === '#';
        });
        if (inWall) room.respawn();
      }
    };
    const solveNow = () => {
      start();
      wfc.run();
      watching = false;
      if (wfc.done) finish();
      draw();
    };
    const watch = () => {
      start();
      watching = true;
      budget = 0;
      draw();
    };
    kit.pad([-6, 0, 12.5], { label: 'SOLVE', color: 'sky', note: 'Collapse it a square at a time: the least certain square last, each choice spreading to its neighbours.', apply: watch });
    kit.pad([-2, 0, 12.5], { label: 'INSTANT', color: 'lime', note: 'The same seed solved at once (the same dungeon you would watch).', apply: solveNow });
    kit.pad([2, 0, 12.5], { label: 'NEW SEED', color: 'orange', note: 'Another seed: another dungeon from the same ten tiles.', apply: () => ((seed = (seed % 999) + 1), watch()) });
    const knobs: Knob[] = [
      { kind: 'choice', id: 'look', label: 'Tiles', options: LOOKS.map((l) => l.name), get: () => look, set: (i) => ((look = i), watch()), hint: 'The same tiles, weighted differently: twisty mazes, open halls, or both.' },
      { id: 'speed', label: 'Watch speed', min: 5, max: 200, step: 5, get: () => speed, set: (v) => (speed = v), format: (v) => `${v} per s`, initial: 40 },
      { id: 'seed', label: 'Seed', min: 1, max: 999, step: 1, get: () => seed, set: (v) => ((seed = v), solveNow()), initial: 1 },
    ];
    solveNow();
    return {
      knobs,
      fixedUpdate(dt) {
        if (!watching) return;
        budget += speed * dt;
        let changed = false;
        while (budget >= 1 && watching) {
          budget--;
          changed = true;
          if (!wfc.step()) {
            watching = false;
            if (wfc.done) finish();
          }
        }
        if (changed) draw();
      },
      draw() {
        const undecided = wfc.options.reduce((n, o) => n + (o > 1 ? 1 : 0), 0);
        const line = wfc.failed
          ? 'NO DUNGEON: CONTRADICTIONS EVERY TIME'
          : !wfc.done
            ? `COLLAPSING · ${undecided} SQUARES UNDECIDED · ATTEMPT ${wfc.attempt}`
            : `SEED ${seed} · ${wfc.choices} CHOICES · ${wfc.attempt - 1} CONTRADICTIONS · ${Math.round((100 * reach.reachable) / Math.max(1, reach.floor))}% OF THE FLOOR REACHABLE`;
        ctx.hud.text(4, 18, line, { anchor: 'bottom-left', color: 'sand' });
      },
      status: () => `seed ${seed} done ${wfc.done} attempt ${wfc.attempt} reach ${reach.reachable}/${reach.floor}`,
      api: {
        solve: solveNow,
        watch,
        seed: (v: number) => ((seed = v), solveNow()),
        look: (i: number) => ((look = i), solveNow()),
        done: () => wfc.done,
        watching: () => watching,
        attempts: () => wfc.attempt,
        undecided: () => wfc.options.reduce((n, o) => n + (o > 1 ? 1 : 0), 0),
        reach: () => ({ ...reach }),
        walls: () => colliders.length,
        /** The dungeon as rows of # and . (null squares undecided as ?). */
        map: () => Array.from({ length: SH }, (_, sy) => Array.from({ length: SW }, (_, sx) => charAt(sx, sy) ?? '?').join('')),
        /** Every pair of neighbouring tiles fits, and the edge is wall but for the way in. */
        valid: () => {
          for (let y = 0; y < TH; y++) {
            for (let x = 0; x < TW; x++) {
              const t = tiles[wfc.result[x + y * TW]!];
              if (!t) return false;
              if (x + 1 < TW && t.edges[1] !== tiles[wfc.result[x + 1 + y * TW]!]!.edges[3]) return false;
              if (y + 1 < TH && t.edges[2] !== tiles[wfc.result[x + (y + 1) * TW]!]!.edges[0]) return false;
              if ((y === 0 && t.edges[0] !== '###') || (x === 0 && t.edges[3] !== '###') || (x === TW - 1 && t.edges[1] !== '###')) return false;
              if (y === TH - 1 && x + y * TW !== entry && t.edges[2] !== '###') return false;
            }
          }
          return true;
        },
        /** World x, z of the entrance (where the hall meets the plaza). */
        entrance: () => [CX + ((entry % TW) * N + 1.5 - SW / 2) * CELL, CZ + (SH / 2) * CELL],
      },
    };
  },
};
