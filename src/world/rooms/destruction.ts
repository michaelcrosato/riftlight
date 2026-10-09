/**
 * Destruction: walls that shatter where you punch them (4, 12 or 30 pieces), a bridge of
 * crumbling tiles over a pit that drop a moment after you step on them and grow back, and
 * barrels that blow up and break everything near them.
 */
import { CylinderGeometry, Mesh, Vector3 } from 'three/webgpu';
import { type Breakable, Breakables, PALETTE, RAPIER, setLookLayer, toonMaterial } from '../../engine';
import { Strikes } from '../kit/strike';
import type { Knob, RoomDef, Vec3 } from '../types';

const W = 30;
const D = 24;
/** The pit the crumbling bridge crosses: x from -12 to -4, z from 1 to 9. */
const PIT = { x0: -12, x1: -4, z0: 1, z1: 9 };
const WALLS: { x: number; cuts: [number, number, number]; color: 'sand' | 'orange' | 'red'; label: string }[] = [
  { x: -8, cuts: [2, 2, 1], color: 'sand', label: '4 PIECES' },
  { x: 0, cuts: [4, 3, 1], color: 'orange', label: '12 PIECES' },
  { x: 8, cuts: [6, 5, 1], color: 'red', label: '30 PIECES' },
];
const BARRELS: Vec3[] = [
  [6, 0.6, 4.5],
  [10.5, 0.6, 7.5],
];

function rows(): string[] {
  return Array.from({ length: D }, (_, r) =>
    Array.from({ length: W }, (_, c) => {
      const x = c - W / 2 + 0.5;
      const z = r - D / 2 + 0.5;
      if (r === 0 || c === 0) return '#';
      if (r === D - 1 || c === W - 1) return '=';
      if (x > PIT.x0 && x < PIT.x1 && z > PIT.z0 && z < PIT.z1) return ' ';
      return '.';
    }).join(''),
  );
}

export const DESTRUCTION: RoomDef = {
  id: 'destruction',
  title: 'Destruction',
  wing: 'physics',
  about:
    'Things that break: punch through walls of 4, 12 and 30 pieces (they shatter from where your fist lands), cross a bridge of tiles that crumble a moment after you step on them, and punch the red barrels: they blow up and break everything around them. The pieces are real bodies for a few seconds, then dissolve away.',
  try: ['Punch (J) the three walls: the pieces fly from your fist', 'Run across the crumbling bridge without stopping', 'Punch a red barrel next to the blocks', 'SLOW-MO, then break something'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'Three breakable walls cut into 4, 12 and 30 pieces, a crumbling tile bridge over a pit, explosive barrels next to piles of breakable blocks, and pads to rebuild and slow time down.',
    how: [
      'Each wall is one static box until it breaks. The pieces are worked out when it does (fracture): cut planes along each axis at jittered positions, a different set of horizontal cuts per column, so the pieces tile the box exactly but look like bricks, not a grid.',
      'Breaking swaps the box for its pieces: each becomes a dynamic body, thrown away from the hit point (faster the closer it was), spinning, with an impact burst and dust.',
      'Debris: after a few seconds the pieces dissolve (the toon material discards more and more pixels in a fixed pattern, with a glowing edge) and their bodies leave the world, so breaking things forever never fills it up.',
      'The bridge tiles know when the hero stands on them (the collider under the character\'s feet): they shake, drop as dynamic bodies, and grow back after a few seconds.',
      'A barrel: physics.explode pushes every dynamic body away, every block within 3 m breaks from the barrel\'s side, and the screen gets a shockwave, a flash and a shake.',
    ],
    uses: [
      'Breakable walls and crates: Zelda\'s bombable walls, Crash Bandicoot\'s crates, Red Faction and Teardown (whole buildings).',
      'Crumbling platforms: Mario\'s donut blocks, Celeste\'s crumble blocks, Spyro.',
      'Explosive barrels: Doom, Half-Life, every shooter since.',
    ],
    ask: ['a wall the player can punch through', 'a floor that falls after you step on it', 'explosive barrels that break nearby walls', 'debris that fades away after a while'],
    cost: 'A whole wall costs one static box. Breaking it adds one dynamic body per piece for a few seconds (30 pieces: about 0.2 ms per step) and one draw call per piece; the dissolve is free (one shared material per wall).',
    code: [
      {
        title: 'Fracture: jittered cuts that tile the box exactly',
        file: 'src/engine/physics/fracture.ts',
        src: `for (let i = 1; i < n; i++) out.push(-length / 2 + i * piece + (rand() * 2 - 1) * jitter * piece);`,
      },
      {
        title: 'Pieces fly from the hit, faster when close',
        file: 'src/engine/physics/breakable.ts',
        src: `const k = speed * Math.max(0.25, 1 - d / Math.max(...o.size));`,
      },
    ],
    words: ['fracture', 'debris', 'dissolve', 'dynamic body', 'impulse', 'rigid body', 'shockwave', 'hitstop', 'time scale'],
  },
  build(room) {
    const { kit, ctx } = room;
    const physics = ctx.physics;
    const e = ctx.engine;
    kit.room(W, D, { rows: rows(), floor: ['slate', 'night'], wall: { color: 'plum', side: 'night' } });
    kit.box([(PIT.x0 + PIT.x1) / 2, -10, (PIT.z0 + PIT.z1) / 2], [PIT.x1 - PIT.x0, 0.5, PIT.z1 - PIT.z0], 'ink', { ghost: true, castShadow: false });
    const breaks = new Breakables(ctx);
    let linger = 4;

    // ---------------------------------------------------------------- walls
    const walls = WALLS.map((w, i) => {
      const b = breaks.add({ at: [w.x, 1.5, -5], size: [4, 3, 0.5], color: w.color, cuts: w.cuts, seed: 11 + i, linger });
      kit.label([w.x, 3.6, -5], w.label, { color: w.color, range: 10 });
      return b;
    });
    // something to find behind each wall
    for (const w of WALLS) {
      const gem = new Mesh(new CylinderGeometry(0.25, 0.25, 0.5, 6), kit.glow('cyan', 0.8));
      gem.position.set(w.x, 0.6, -8);
      kit.decorate(gem);
    }

    // ---------------------------------------------------------------- the crumbling bridge
    const tiles = Array.from({ length: 8 }, (_, i) => breaks.crumble({ at: [PIT.x1 - 0.5 - i, -0.25, 5], size: [0.96, 0.5, 1.4], color: i % 2 ? 'sand' : 'orange', delay: 0.45, regrow: 4 }));
    kit.label([(PIT.x0 + PIT.x1) / 2, 1.5, 5], 'CRUMBLING BRIDGE · KEEP MOVING', { color: 'sand', range: 10 });
    const prize = new Mesh(new CylinderGeometry(0.3, 0.3, 0.6, 6), kit.glow('sand', 0.9));
    prize.position.set(PIT.x0 - 1, 1.2, 5);
    ctx.scene.add(prize);
    kit.pad([PIT.x0 - 1, 0, 7.5], { label: 'MADE IT', color: 'sand', note: 'Across! Each tile counted the time you stood on it: 0.45 s, then it dropped.', apply: () => ctx.audio.play('coin') }, [1.6, 1.6]);

    // ---------------------------------------------------------------- barrels and blocks
    const barrelGeo = new CylinderGeometry(0.45, 0.45, 1.2, 12);
    const barrelMat = toonMaterial(PALETTE.red);
    const barrels = BARRELS.map((at) => {
      const mesh = new Mesh(barrelGeo, barrelMat);
      mesh.position.set(...at);
      mesh.castShadow = true;
      setLookLayer(mesh, 'actors');
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...at));
      physics.world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 0.45), body);
      ctx.scene.add(mesh);
      return { at, mesh, body: body as RAPIER.RigidBody | null };
    });
    const blocks: Breakable[] = [];
    for (const [x, z] of [[7.4, 4.5], [7.4, 5.6], [6, 6], [9.2, 7.5], [10.5, 9], [11.9, 7.5]] as const)
      for (let y = 0; y < 2; y++) blocks.push(breaks.add({ at: [x, 0.5 + y, z], size: [1, 1, 1], color: y ? 'sand' : 'orange', cuts: [2, 2, 2], seed: x * 7 + z * 3 + y, linger }));
    const detonate = (i: number) => {
      const b = barrels[i]!;
      if (!b.body) return;
      physics.remove(b.body);
      b.body = null;
      b.mesh.removeFromParent();
      const at = new Vector3(...b.at);
      // everything in reach breaks (near() finds the closest whole one each time)
      for (let k = 0; k < 16; k++) {
        const next = breaks.near(b.at, 2.6);
        if (!next) break;
        breaks.break(next, b.at, 9);
      }
      physics.explode(at, { radius: 4, impulse: 12 });
      e.screen.shockwave(at, { radius: 0.6, strength: 1.5 });
      e.screen.flash(0xffcd75, { duration: 0.1, strength: 0.6 });
      e.shake.add(0.7);
      e.hitstop(0.08);
      ctx.particles.burst('smoke', at, { count: 40, scale: 2.2, speed: 3 });
      ctx.particles.burst('impact', at, { count: 30, speed: 8 });
      ctx.audio.play('groundPound');
      // the hero is thrown back if close
      const h = room.hero?.hero;
      if (h) {
        const f = h.feet;
        const d = Math.hypot(f.x - at.x, f.z - at.z);
        if (d < 3) h.launch(7, { hvel: new Vector3((f.x - at.x) / (d || 1), 0, (f.z - at.z) / (d || 1)).multiplyScalar(6 * (1 - d / 3)) });
      }
    };
    kit.label([8.5, 2.6, 6.5], 'BARRELS · PUNCH ONE', { color: 'red', range: 10 });

    // ---------------------------------------------------------------- pads
    const rebuild = () => {
      for (const b of breaks.blocks) breaks.restore(b);
      barrels.forEach((b) => {
        if (b.body) return;
        b.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...b.at));
        physics.world.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 0.45), b.body);
        ctx.scene.add(b.mesh);
      });
    };
    kit.pad([-3, 0, 9.5], { label: 'REBUILD', color: 'sand', note: 'Every wall, block and barrel whole again (old pieces still fade out).', apply: rebuild });
    kit.pad([3, 0, 9.5], {
      label: 'SLOW-MO',
      color: 'sky',
      note: 'Game time at 0.3x: watch the pieces fly.',
      apply: (_r, p) => {
        e.timeScale = e.timeScale < 1 ? 1 : 0.3;
        kit.lightPad(p, e.timeScale < 1);
      },
    });
    kit.light({ position: [0, 4, -2], color: PALETTE.sand, intensity: 6, radius: 14, flicker: 'none' });
    kit.light({ position: [8, 3, 6], color: PALETTE.orange, intensity: 5, radius: 9, flicker: 'torch' });

    const strikes = new Strikes();
    const knobs: Knob[] = [
      { id: 'linger', label: 'Debris lingers', min: 0.5, max: 12, step: 0.5, get: () => linger, set: (v) => ((linger = v), breaks.blocks.forEach((b) => (b.o.linger = v))), format: (v) => `${v} s`, initial: 4 },
    ];
    let punched = 0;
    let falls = 0;
    return {
      knobs,
      fixedUpdate() {
        const h = room.hero?.hero;
        if (!h) return;
        const s = strikes.poll(h);
        if (s) {
          const at: Vec3 = [s.at.x, s.at.y, s.at.z];
          const hitBarrel = barrels.findIndex((b) => b.body && Math.hypot(b.at[0] - s.at.x, b.at[2] - s.at.z) < 1.3);
          const block = breaks.near(at, 0.7);
          if (hitBarrel >= 0) detonate(hitBarrel);
          else if (block) {
            breaks.break(block, at, 4 + 2 * s.strength);
            punched++;
            e.hitstop(0.07);
            e.shake.add(0.3 * s.strength);
            ctx.audio.play('punch', { pitch: -4 });
          }
        }
        if (h.feet.y < -3) {
          falls++;
          room.respawn();
          room.toast('Down the pit! Crumbling tiles wait about half a second: keep moving.');
          ctx.audio.play('hurt');
        }
      },
      update(dt) {
        breaks.update(dt, room.hero?.hero?.groundCollider ?? -1);
        prize.rotation.y += dt * 2;
      },
      dispose() {
        e.timeScale = 1;
      },
      status: () => `broken ${breaks.blocks.filter((b) => b.broken).length}/${breaks.blocks.length} chunks ${breaks.chunks} tiles ${tiles.filter((t) => t.state !== 'solid').length} down`,
      api: {
        punch: (i: number) => breaks.break(walls[i]!, [WALLS[i]!.x, 1.5, -4.6], 6),
        detonate,
        rebuild,
        chunks: () => breaks.chunks,
        broken: () => breaks.blocks.filter((b) => b.broken).length,
        tiles: () => tiles.map((t) => t.state),
        punched: () => punched,
        falls: () => falls,
      },
    };
  },
};
