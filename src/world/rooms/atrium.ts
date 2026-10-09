/**
 * The Atrium: the hub. A plaza with a fountain and four corridors; every room has a door
 * on a corridor wall, grouped by wing (east: movement and looks, north: physics and
 * genres, west: animation and the workshop, south: effects). Walk into a door, or press G.
 */
import { Mesh, SphereGeometry } from 'three/webgpu';
import { PALETTE, type PaletteColor } from '../../engine';
import { rooms } from '../shell';
import type { RoomDef, Vec3, WingId } from '../types';
import { wing } from '../wings';

const PLAZA = 13; // half size
const CORRIDOR = 4; // half width
const DOOR_GAP = 5.5; // between doors along a wall

/** Which corridor a wing's doors are on: direction (unit x, z). */
const CORRIDORS: { dir: [number, number]; wings: WingId[] }[] = [
  { dir: [1, 0], wings: ['movement', 'looks'] },
  { dir: [0, -1], wings: ['physics', 'genres'] },
  { dir: [-1, 0], wings: ['animation', 'workshop'] },
  { dir: [0, 1], wings: ['effects'] },
];

export interface DoorSpot {
  room: RoomDef;
  /** Door centre on the floor. */
  at: Vec3;
  /** Direction you walk through it (radians about Y, 0 = +Z). */
  facing: number;
}

/** Where every room's door is (pure: the e2e suite and arrivals use it too). */
export function doorLayout(all: readonly RoomDef[]): { doors: DoorSpot[]; lengths: number[] } {
  const doors: DoorSpot[] = [];
  const lengths: number[] = [];
  for (const c of CORRIDORS) {
    const list = all.filter((r) => c.wings.includes(r.wing));
    const pairs = Math.ceil(list.length / 2);
    const length = Math.max(10, pairs * DOOR_GAP + 4);
    lengths.push(length);
    const [dx, dz] = c.dir;
    // the two walls: left and right of the walking direction
    const side: [number, number] = [-dz, dx];
    list.forEach((room, i) => {
      const along = PLAZA + 3 + Math.floor(i / 2) * DOOR_GAP + DOOR_GAP / 2;
      const s = i % 2 === 0 ? 1 : -1;
      const x = dx * along + side[0] * s * CORRIDOR;
      const z = dz * along + side[1] * s * CORRIDOR;
      // walk out of the corridor through the wall: along side × s
      const facing = Math.atan2(side[0] * s, side[1] * s);
      doors.push({ room, at: [x, 0, z], facing });
    });
  }
  return { doors, lengths };
}

/** Floor in front of a door, facing back into the corridor (arrivals). */
export function inFrontOf(d: DoorSpot): { at: Vec3; facing: number } {
  const back = 1.8;
  return {
    at: [d.at[0] - Math.sin(d.facing) * back, 0, d.at[2] - Math.cos(d.facing) * back],
    facing: d.facing + Math.PI,
  };
}

export const ATRIUM: RoomDef = {
  id: 'atrium',
  title: 'The Atrium',
  wing: 'hub',
  about:
    'The hub of Engine World. Every door leads to a room that shows one thing the engine does, with pads to step on and a guide that explains it. Corridors east, north, west and south hold the wings.',
  try: ['Walk into any door (or press G for the list)', 'Press H in any room for how it works', 'Press T to change the game speed, the look or the camera anywhere'],
  spawn: [0, 0, 7],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A plaza and four corridors with a door for every room. Each door is a portal: walking into it covers the screen with a transition, loads the room as a whole new game, and opens on it.',
    how: [
      'Every room is its own Game object. A door calls engine.loadGame(room): the engine unloads the old room (its meshes, materials, physics bodies, triggers, lights, particles and music) and builds the new one, so a room can never leak into the next.',
      'The screen transition is engine.screen: an iris closes on the hero before the load and opens after it. It runs on real time, so it keeps moving while the room loads.',
      'Rooms are mostly data: an ASCII map (one character per metre: walls, floors, steps, pads), a card, a guide and pads. Neighbouring cells that build the same thing merge into one box, and every static box merges into one draw call per material.',
      'The shell (H, T, G, Esc, the card, the toasts, the labels) survives every load: it lives outside the rooms and draws on the engine HUD each frame.',
      'Arriving back here, the hero stands in front of the door of the room they left.',
    ],
    uses: [
      'Hubs: Super Mario 64 (the castle), Spyro (homeworlds), Hollow Knight (Dirtmouth) connect levels through one walkable place.',
      'Level streaming by scene swap: most 90s console games load a level behind a fade or an iris.',
      'Tech demos and test levels: studios keep "gyms" like these rooms to check movement, physics and lighting on their own.',
    ],
    ask: ['a hub level with a door per level', 'swap levels behind an iris transition', 'make each level its own Game so loading one frees the last', 'an ASCII map for a room with walls, steps and pads'],
    cost: 'A room change costs one unload and one build (tens of milliseconds) plus compiling any shader the new room has not used yet. The Atrium itself is 80-odd boxes merged into a dozen draws.',
    code: [
      {
        title: 'A door: transition, load, transition',
        file: 'src/world/shell.ts',
        src: `if (o.instant || !(await engine.screen.cover(kind, { duration: 0.4, center: hero ? hero.clone().setY(hero.y + 0.9) : undefined }))) engine.screen.set(kind, 1);
await engine.loadGame(new RoomGame(def, from));
...
else await engine.screen.reveal(kind, { duration: 0.4, center: next ? next.clone().setY(next.y + 0.9) : undefined });`,
      },
      {
        title: 'Rooms as ASCII maps, merged into boxes',
        file: 'src/world/kit/map.ts',
        src: `let w = 1;
while (col + w < width && !used[row * width + col + w] && keyOf(col + w, row) === key) w++;
let h = 1;
grow: while (row + h < height) {
  for (let c = col; c < col + w; c++) if (used[(row + h) * width + c] || keyOf(c, row + h) !== key) break grow;
  h++;
}`,
      },
    ],
    words: ['game loop', 'screen transition', 'iris', 'draw call', 'trigger', 'pad', 'agent API'],
  },
  build(room) {
    const { kit, ctx } = room;
    const all = rooms().filter((r) => r.id !== 'atrium');
    const { doors, lengths } = doorLayout(all);
    // plaza: warm stone tiles; low walls with corridor openings
    const tiles: [PaletteColor, PaletteColor] = ['sand', 'orange'];
    const size = PLAZA * 2;
    const rows: string[] = [];
    for (let r = 0; r < size + 2; r++) {
      let line = '';
      for (let c = 0; c < size + 2; c++) {
        const edge = r === 0 || c === 0 || r === size + 1 || c === size + 1;
        const mid = Math.abs(c - (size + 1) / 2) < CORRIDOR && Math.abs(r - (size + 1) / 2) < CORRIDOR;
        const opening = (r === 0 || r === size + 1) ? Math.abs(c - (size + 1) / 2) < CORRIDOR : (c === 0 || c === size + 1) && Math.abs(r - (size + 1) / 2) < CORRIDOR;
        line += edge && !opening ? '=' : mid ? 'f' : '.';
      }
      rows.push(line);
    }
    kit.map(rows, {
      floor: tiles,
      legend: {
        '=': { block: { height: 0.9, color: 'mist', side: 'slate' } },
        f: { floorColor: 'white' },
      },
    });
    // the fountain: basin, column and a glowing orb
    kit.cylinder([0, 0.35, 0], 2.6, 0.7, 'slate', { segments: 16 });
    kit.cylinder([0, 0.72, 0], 2.25, 0.06, 'sky', { ghost: true, segments: 16 });
    kit.cylinder([0, 1.4, 0], 0.35, 2, 'mist', { segments: 8 });
    const orb = new Mesh(new SphereGeometry(0.5, 12, 8), kit.glow('cyan'));
    orb.position.set(0, 2.8, 0);
    ctx.scene.add(orb);
    kit.light({ position: [0, 3.2, 0], color: PALETTE.cyan, intensity: 9, radius: 9, flicker: 'pulse', priority: 2 });
    kit.label([0, 3.9, 0], 'ENGINE WORLD', { color: 'sand', always: true, scale: 1 });
    kit.label([0, 0.3, 5.5], 'WALK INTO A DOOR · G FOR ANY ROOM', { color: 'white', range: 6 });

    // corridors
    CORRIDORS.forEach((c, i) => {
      const length = lengths[i]!;
      const [dx, dz] = c.dir;
      const mid = PLAZA + 1 + length / 2;
      const cx = dx * mid;
      const cz = dz * mid;
      const along: [number, number] = dx !== 0 ? [length + 2, CORRIDOR * 2] : [CORRIDOR * 2, length + 2];
      kit.box([cx, -0.25, cz], [along[0], 0.5, along[1]], i % 2 ? 'mist' : 'white', { side: 'night' });
      // end wall
      const ex = dx * (PLAZA + 2 + length + 0.25);
      const ez = dz * (PLAZA + 2 + length + 0.25);
      kit.box([ex, 1.5, ez], dx !== 0 ? [0.5, 3, CORRIDOR * 2 + 1] : [CORRIDOR * 2 + 1, 3, 0.5], 'slate', { side: 'night' });
      // wing signs at the corridor mouth
      const names = c.wings.filter((w) => all.some((r) => r.wing === w)).map((w) => wing(w).title.toUpperCase());
      if (names.length) kit.label([dx * (PLAZA + 1), 3.2, dz * (PLAZA + 1)], names.join(' · '), { color: wing(c.wings[0]!).color, always: true });
      // lamps along the corridor
      for (let k = 0; k < Math.floor(length / 11) + 1; k++) {
        const a = PLAZA + 4 + k * 11;
        for (const s of [-1, 1]) {
          const lx = dx * a + (dx === 0 ? s * (CORRIDOR - 0.6) : 0);
          const lz = dz * a + (dz === 0 ? s * (CORRIDOR - 0.6) : 0);
          kit.cylinder([lx, 1.1, lz], 0.1, 2.2, 'night', { segments: 6 });
          kit.box([lx, 2.35, lz], [0.35, 0.3, 0.35], 'sand', { ghost: true, castShadow: false });
          kit.light({ position: [lx, 2.5, lz], color: PALETTE.sand, intensity: 5, radius: 6, flicker: 'torch' });
        }
      }
    });
    for (const d of doors) {
      const w = wing(d.room.wing);
      kit.door(d.at, d.facing, w.color, () => room.goto(d.room.id), { title: d.room.title });
    }
    for (const [i, c] of CORRIDORS.entries()) {
      const length = lengths[i]!;
      const [dx, dz] = c.dir;
      for (const s of [-1, 1]) {
        // wall segments between door gaps: the doors on this wall, by distance along it
        const gaps = doors
          .filter((d) => Math.abs((dx === 0 ? d.at[0] : d.at[2]) - s * CORRIDOR) < 0.01 && (dx === 0 ? Math.sign(d.at[2]) === dz : Math.sign(d.at[0]) === dx))
          .map((d) => Math.abs(dx === 0 ? d.at[2] : d.at[0]))
          .sort((a, b) => a - b);
        let from = PLAZA + 1;
        const to = PLAZA + 2 + length;
        // a low wall between the doors (with a taller invisible collider: no hopping out)
        for (const g of [...gaps, to + 1.4]) {
          const a = from;
          const b = Math.min(to, g - 1.4);
          if (b > a + 0.05) {
            const m = (a + b) / 2;
            const x = dx !== 0 ? dx * m : s * (CORRIDOR + 0.25);
            const z = dz !== 0 ? dz * m : s * (CORRIDOR + 0.25);
            const len = b - a;
            kit.box([x, 0.45, z], dx !== 0 ? [len, 0.9, 0.5] : [0.5, 0.9, len], 'mist', { ghost: true, side: 'slate' });
            kit.solid([x, 1.5, z], dx !== 0 ? [len, 3, 0.5] : [0.5, 3, len]);
          }
          from = g + 1.4;
        }
      }
    }
    // coming back from a room: in front of its door
    const back = doors.find((d) => d.room.id === room.arrivedFrom);
    if (back) {
      const p = inFrontOf(back);
      room.setSpawn(p.at, p.facing);
    }
    return {
      status: () => `${all.length} rooms`,
      api: { doors: () => doors.map((d) => ({ id: d.room.id, at: d.at, facing: d.facing })) },
    };
  },
};
