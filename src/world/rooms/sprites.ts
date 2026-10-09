/**
 * Pixel Sprites: flat pixel-art characters in the 3D world (Doom, Paper Mario, Octopath):
 * critters drawn in code, animated by flipping frames, always facing the camera, mirrored by
 * which way they walk, a whole crowd in one draw call; plus billboard trees and torches.
 */
import { drawSheet, PALETTE, SpriteBatch } from '../../engine';
import type { Knob, RoomDef } from '../types';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export const SPRITES: RoomDef = {
  id: 'sprites',
  title: 'Pixel Sprites',
  wing: 'animation',
  about:
    'Flat pixel-art sprites living in the 3D world, like Doom\'s monsters or Paper Mario: little critters drawn in code, animated by flipping frames, always turned to the camera and mirrored to face where they walk. A crowd of one sheet is one draw call. Walk among them and change the camera.',
  try: ['Walk among the critters', 'Change the camera (T): they always face you', 'A crowd of 300 is still one draw call'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'teal',
  guide: {
    what: 'A meadow with wandering pixel critters, billboard trees and flickering torches, all flat sprites in a 3D scene next to the 3D hero.',
    how: [
      'A sprite sheet is drawn in code onto a small canvas: each frame a few rectangles of palette colours (no image files). It is sampled nearest-neighbour, so its pixels stay square.',
      'Every sprite of a sheet is one instance of a quad: its position, size, frame and mirror live in instance attributes. The vertex shader puts the quad\'s corners along the camera\'s right and up around the sprite\'s point, so it always faces the camera whatever the preset, and pushes them toward the camera as far as a standing figure\'s would be, so sprites sort like standing figures.',
      'The fragment shader picks the frame\'s cell of the sheet and drops transparent pixels (an alpha cut-out, no blending, no sorting), so sprites mix with 3D models and the depth buffer sorts them.',
      'Walking critters flip through four frames as they cover ground (frames per metre walked, so their feet keep up) and are mirrored to face their direction of travel: a mirrored sprite reads its frame right to left.',
    ],
    uses: [
      'Doom, Duke Nukem 3D and Wolfenstein: enemies and items as sprites in 3D levels.',
      'Paper Mario, Octopath Traveler, Cult of the Lamb: flat characters in 3D worlds.',
      'Billboard trees and particles in many 3D games.',
    ],
    ask: ['2D pixel-art characters in a 3D world', 'sprites that always face the camera', 'a crowd of animated sprites', 'sprite sheets drawn in code'],
    cost: 'One draw call per sheet whatever the count; a few numbers per sprite updated each frame.',
    code: [
      {
        title: 'Billboard: corners along the camera\'s axes, depth of a standing figure',
        file: 'src/engine/render/sprites.ts',
        src: `material.positionNode = P.xyz.add(right.mul(g.x.mul(P.w).mul(aspect))).add(up.mul(h)).add(back.mul(back.y.mul(h)));`,
      },
      {
        title: 'Mirroring reads the frame right to left',
        file: 'src/engine/render/sprites.ts',
        src: `const u = uv().x.sub(0.5).mul(L.y).add(0.5);`,
      },
    ],
    words: ['billboard', 'sprite', 'instancing', 'nearest-neighbour', 'draw call'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(26, 22, { floor: ['green', 'lime'], wall: { color: 'teal', side: 'navy' } });
    // a critter: 16×16, four walking frames (body bob, legs alternate), in a few colours
    const critter = (body: number, belly: number) =>
      drawSheet({ frame: [16, 16], frames: 4 }, (g, f) => {
        const bob = f % 2;
        g.fillStyle = hex(PALETTE.ink);
        g.fillRect(3, 4 + bob, 10, 9); // outline
        g.fillStyle = hex(body);
        g.fillRect(4, 5 + bob, 8, 7);
        g.fillStyle = hex(belly);
        g.fillRect(5, 9 + bob, 6, 3);
        g.fillStyle = hex(PALETTE.white);
        g.fillRect(9, 6 + bob, 2, 2); // eye
        g.fillStyle = hex(PALETTE.ink);
        g.fillRect(10, 7 + bob, 1, 1);
        // legs
        g.fillStyle = hex(PALETTE.ink);
        const a = f === 1 ? 1 : f === 3 ? -1 : 0;
        g.fillRect(5 + a, 13, 2, 3);
        g.fillRect(9 - a, 13, 2, 3);
      });
    const tree = drawSheet({ frame: [24, 32], frames: 1 }, (g) => {
      g.fillStyle = hex(PALETTE.plum);
      g.fillRect(10, 20, 4, 12);
      g.fillStyle = hex(PALETTE.ink);
      g.fillRect(3, 3, 18, 19);
      g.fillStyle = hex(PALETTE.green);
      g.fillRect(4, 4, 16, 17);
      g.fillStyle = hex(PALETTE.lime);
      g.fillRect(6, 6, 6, 5);
    });
    const torch = drawSheet({ frame: [8, 16], frames: 3 }, (g, f) => {
      g.fillStyle = hex(PALETTE.plum);
      g.fillRect(3, 8, 2, 8);
      g.fillStyle = hex([PALETTE.orange, PALETTE.red, PALETTE.sand][f]!);
      g.fillRect(2, 3 + (f % 2), 4, 5);
      g.fillStyle = hex(PALETTE.sand);
      g.fillRect(3, 5, 2, 2);
    });
    const kinds = [critter(PALETTE.orange, PALETTE.sand), critter(PALETTE.sky, PALETTE.white), critter(PALETTE.red, PALETTE.orange)];
    const crowds = kinds.map((sheet) => new SpriteBatch(sheet, { capacity: 120 }));
    const trees = new SpriteBatch(tree, { capacity: 40 });
    const torches = new SpriteBatch(torch, { capacity: 8 });
    ctx.scene.add(...crowds, trees, torches);
    let seed = 3;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    // a ring of trees round the back and the sides (none between the camera and the hero)
    for (let i = 0; i < 28; i++) {
      const a = Math.PI * (0.9 + rnd() * 1.2);
      const r = 8 + rnd() * 2.5;
      trees.spawn([Math.cos(a) * r, 0, Math.sin(a) * r * 0.75], { size: 2.4 + rnd() });
    }
    for (const [x, z] of [[-3, -2], [3, -2], [-3, 3], [3, 3]] as const) {
      torches.spawn([x, 0, z], { size: 1.2 });
      kit.light({ position: [x, 1.1, z], color: PALETTE.orange, intensity: 4, radius: 5, flicker: 'torch' });
    }
    interface Critter {
      batch: SpriteBatch;
      i: number;
      x: number;
      z: number;
      tx: number;
      tz: number;
      t: number;
      speed: number;
      /** Metres walked: the walk cycle advances with it, so feet match the ground. */
      walked: number;
    }
    const critters: Critter[] = [];
    const populate = (n: number) => {
      for (const b of crowds) b.count = 0;
      critters.length = 0;
      for (let k = 0; k < n; k++) {
        const batch = crowds[k % crowds.length]!;
        const x = (rnd() - 0.5) * 14;
        const z = (rnd() - 0.5) * 10;
        const i = batch.spawn([x, 0, z], { size: 0.8 });
        if (i < 0) break;
        critters.push({ batch, i, x, z, tx: x, tz: z, t: rnd() * 3, speed: 0.8 + rnd() * 1.2, walked: 0 });
      }
    };
    populate(30);
    for (const [i, n] of [30, 120, 300].entries()) kit.pad([-4 + i * 2.6, 0, 8.6], { label: `${n} CRITTERS`, color: 'lime', group: 'crowd', initial: n === 30, note: `${n} sprites in three sheets: three draw calls.`, apply: () => populate(n) });
    let pace = 8;
    const knobs: Knob[] = [{ id: 'pace', label: 'Frames per metre', min: 2, max: 20, step: 1, get: () => pace, set: (v) => (pace = v), initial: 8, hint: 'How fast the walk cycle flips for the distance covered.' }];
    let flick = 0;
    let flipAll: boolean | undefined; // tests: every critter mirrored (or not) whichever way it walks
    return {
      knobs,
      update(dt) {
        for (const c of critters) {
          c.t -= dt;
          if (c.t <= 0) {
            c.t = 1.5 + rnd() * 3;
            c.tx = Math.max(-7, Math.min(7, c.x + (rnd() - 0.5) * 6));
            c.tz = Math.max(-5, Math.min(5, c.z + (rnd() - 0.5) * 6));
          }
          const dx = c.tx - c.x;
          const dz = c.tz - c.z;
          const d = Math.hypot(dx, dz);
          const step = Math.min(d, c.speed * dt);
          if (d > 1e-3) {
            c.x += (dx / d) * step;
            c.z += (dz / d) * step;
          }
          c.walked += step;
          const frame = d > 0.05 ? Math.floor(c.walked * pace) % 4 : 0;
          c.batch.put(c.i, c.x, 0, c.z, frame, flipAll ?? dx < 0);
        }
        flick += dt * 8;
        for (let i = 0; i < torches.count; i++) torches.set(i, { frame: Math.floor(flick + i) });
      },
      status: () => `critters ${critters.length}`,
      api: {
        critters: () => critters.length,
        draws: () => crowds.filter((b) => b.count > 0).length,
        frames: () => critters.slice(0, 20).map((c) => c.batch.frameOf(c.i)),
        flip: (on?: boolean) => (flipAll = on),
      },
    };
  },
};
