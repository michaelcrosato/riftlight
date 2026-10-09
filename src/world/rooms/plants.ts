/**
 * Plant Lab: four plants grown from L-systems, a string of turtle commands rewritten by rules
 * a few times over, then drawn. Each plinth shows its rule; GROW draws them again in the
 * order the turtle walks the string, and the settings change how many generations it grows
 * and how far it turns.
 */
import { CylinderGeometry, Group, InstancedMesh, Matrix4, OctahedronGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { expand, PALETTE, PLANTS, setLookLayer, toonMaterial, turtle, type TurtleOptions } from '../../engine';
import type { Knob, RoomDef } from '../types';

type Name = keyof typeof PLANTS;

const BEDS: readonly { name: Name; x: number; scale: number; bark: number; leaf: number; rule: string }[] = [
  { name: 'bush', x: -9, scale: 1.4, bark: PALETTE.orange, leaf: PALETTE.lime, rule: 'A -> [&FL!A]/////[&FL!A]...' },
  { name: 'fern', x: -3, scale: 0.95, bark: PALETTE.green, leaf: PALETTE.lime, rule: 'X -> F+[[X]-XL]-F[-FXL]+X' },
  { name: 'weed', x: 3, scale: 1.9, bark: PALETTE.teal, leaf: PALETTE.sand, rule: 'F -> F[+FL]///F[-FL]F | ...' },
  { name: 'tree', x: 9, scale: 1.5, bark: PALETTE.plum, leaf: PALETTE.green, rule: 'B -> F[+&BL]\\\\[-^BL]FL' },
];
const BED_Z = -2;
const PLINTH = 0.5;
/** Thinnest twig drawn (metres): about an art pixel across, so the finest branches still show. */
const MIN_RADIUS = 0.03;

export const PLANTS_ROOM: RoomDef = {
  id: 'plants',
  title: 'Plant Lab',
  wing: 'procedural',
  about:
    'Four plants grown from a line of text. An L-system rewrites a string by rules (every F becomes F[+F]F[-F]F, say) a few times over, then a turtle reads it: F walk forward drawing a branch, + and - turn, [ remember this spot, ] go back to it. The plinths show each rule; GROW draws them again, branch by branch.',
  try: ['Step on GROW and watch the turtle draw', 'NEW SEEDS: the weed differs every time', 'More or fewer generations (T)', 'Wider or narrower angles (T)'],
  spawn: [0, 0, 4],
  facing: Math.PI,
  background: 'sky',
  guide: {
    what: 'A bush, a fern, a weed and a tree on plinths, each with its rule written above it, swaying in a breeze.',
    how: [
      'An L-system is an axiom (the starting string) and rules. Each generation every symbol with a rule is replaced by the rule\'s right side, all at once. A few generations turn one symbol into thousands.',
      'A stochastic rule has several right sides with probabilities, chosen by a seeded random number each time: the weed is a different weed for every seed, but always the same for the same seed.',
      'Then a turtle walks the string in 3D: F moves forward drawing a branch; + and - turn left and right, & and ^ pitch down and up, \\ and / roll; [ saves where it is and ] goes back there, which is what makes branches.',
      'Each [ also makes what follows shorter and thinner, so twigs are finer than the trunk; L hangs a leaf. The tree bends a little toward the ground on every segment (tropism), as heavy branches droop.',
      'Branches are drawn as one instanced mesh of cylinders per plant (each one placed, turned and stretched from its start and end points), leaves as another.',
    ],
    uses: [
      'SpeedTree, which grows the trees of most big games, started from the same ideas; Spore\'s and No Man\'s Sky\'s plants grow from rules.',
      'Fractals, coastlines and road networks: anything that branches the same way at every scale.',
    ],
    ask: ['procedural trees with an L-system', 'plants that grow from rules and a seed', 'a turtle that turns a string into branches', 'make every tree a little different'],
    cost: 'Growing is string rewriting (thousands of symbols in well under a millisecond); drawing is two instanced draws per plant, a few hundred to fifteen hundred branches each.',
    code: [
      {
        title: 'One generation: every symbol replaced at once',
        file: 'src/engine/procgen/lsystem.ts',
        src: `if (r === undefined) out += ch;
else if (typeof r === 'string') out += r;`,
      },
      {
        title: 'The turtle: [ remembers, ] goes back, each branch shorter and thinner',
        file: 'src/engine/procgen/lsystem.ts',
        src: `stack.push({ pos: pos.clone(), q: q.clone(), length, radius, depth });
length *= lengthScale;
radius *= radiusScale;`,
      },
    ],
    words: ['L-system', 'turtle graphics', 'seed', 'procedural generation', 'instancing'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(28, 18, { floor: ['green', 'lime'], wall: { color: 'teal', side: 'navy' } });
    const cyl = new CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0);
    const leafGeo = new OctahedronGeometry(0.13);
    let generations = 0; // more or fewer than each plant's own
    let spread = 1; // the turn angle, times this
    let wind = 0.6;
    let seed = 3;
    let grown = 1; // 0..1 of the drawing shown
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const d = new Vector3();
    const Y = new Vector3(0, 1, 0);
    const plants = BEDS.map((bed, i) => {
      kit.box([bed.x, PLINTH / 2, BED_Z], [2.6, PLINTH, 2.6], 'sand', { side: 'orange' });
      kit.label([bed.x, 4.6, BED_Z + 1.6], `${bed.name.toUpperCase()}: ${bed.rule}`, { color: 'white', range: 9 });
      const group = new Group();
      group.position.set(bed.x, PLINTH, BED_Z);
      ctx.scene.add(group);
      return { bed, group, phase: i * 1.7, branches: null as InstancedMesh | null, leaves: null as InstancedMesh | null, counts: { branches: 0, leaves: 0, height: 0 } };
    });
    const grow = () => {
      for (const plant of plants) {
        const preset = PLANTS[plant.bed.name];
        const iterations = Math.max(1, preset.iterations + generations);
        const t: TurtleOptions = { ...preset.turtle, angle: (preset.turtle.angle ?? 25) * spread, jitter: 4, seed: seed * 31 + plant.phase };
        const { branches, leaves } = turtle(expand(preset.system, iterations, seed), t);
        // replace the meshes (their size changes with the generations)
        for (const old of [plant.branches, plant.leaves]) {
          if (!old) continue;
          old.removeFromParent();
          old.dispose();
        }
        const bm = new InstancedMesh(cyl, toonMaterial(plant.bed.bark), Math.max(1, branches.length));
        const lm = new InstancedMesh(leafGeo, toonMaterial(plant.bed.leaf), Math.max(1, leaves.length));
        for (const mesh of [bm, lm]) {
          mesh.castShadow = true;
          mesh.frustumCulled = false;
          setLookLayer(mesh, 'actors');
          mesh.scale.setScalar(plant.bed.scale);
          plant.group.add(mesh);
        }
        branches.forEach((b, k) => {
          d.set(b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]);
          const len = d.length();
          q.setFromUnitVectors(Y, d.divideScalar(Math.max(len, 1e-6)));
          const r = Math.max(b.radius, MIN_RADIUS / plant.bed.scale);
          m.compose(p.set(...b.from), q, s.set(r, len, r));
          bm.setMatrixAt(k, m);
        });
        leaves.forEach((l, k) => {
          m.compose(p.set(...l.at), q.identity(), s.setScalar(1));
          lm.setMatrixAt(k, m);
        });
        plant.branches = bm;
        plant.leaves = lm;
        plant.counts = { branches: branches.length, leaves: leaves.length, height: Math.max(0, ...branches.map((b) => b.to[1])) * plant.bed.scale };
      }
      grown = 0;
    };
    const show = () => {
      for (const plant of plants) {
        // the turtle's own order: the drawing appears as it walked the string
        if (plant.branches) plant.branches.count = Math.ceil(grown * plant.counts.branches);
        if (plant.leaves) plant.leaves.count = Math.ceil(Math.max(0, grown * 1.1 - 0.1) * plant.counts.leaves);
      }
    };
    kit.pad([-3, 0, 6], { label: 'GROW', color: 'lime', note: 'Draw them again, branch by branch, in the order the turtle reads the string.', apply: grow });
    kit.pad([1, 0, 6], { label: 'NEW SEEDS', color: 'orange', note: 'Another seed: the weed\'s rules choose differently, and every turn wobbles a little differently.', apply: () => ((seed = (seed % 99) + 1), grow()) });
    const knobs: Knob[] = [
      { id: 'generations', label: 'Generations', min: -3, max: 1, step: 1, get: () => generations, set: (v) => ((generations = v), grow()), format: (v) => (v > 0 ? `+${v}` : `${v}`), initial: 0, hint: 'Rewrites before drawing: each one multiplies the branches.' },
      { id: 'spread', label: 'Angle', min: 0.4, max: 1.6, step: 0.05, get: () => spread, set: (v) => ((spread = v), grow()), format: (v) => `${v.toFixed(2)}x`, initial: 1, hint: 'How far + - & ^ turn: a narrow cypress or a wide oak from the same rules.' },
      { id: 'wind', label: 'Breeze', min: 0, max: 2, step: 0.1, get: () => wind, set: (v) => (wind = v), initial: 0.6 },
    ];
    grow();
    grown = 1;
    show();
    let t = 0;
    return {
      knobs,
      update(dt) {
        t += dt;
        if (grown < 1) {
          grown = Math.min(1, grown + dt / 3);
          show();
        }
        for (const plant of plants) {
          plant.group.rotation.z = Math.sin(t * 1.3 + plant.phase) * 0.035 * wind;
          plant.group.rotation.x = Math.sin(t * 0.9 + plant.phase * 2) * 0.025 * wind;
        }
      },
      status: () => plants.map((pl) => `${pl.bed.name} ${pl.counts.branches}`).join(' '),
      api: {
        grow,
        grown: () => grown,
        seed: (v: number) => ((seed = v), grow()),
        generations: (v: number) => ((generations = v), grow()),
        counts: () => plants.map((pl) => ({ name: pl.bed.name, ...pl.counts, shown: pl.branches?.count ?? 0 })),
      },
    };
  },
};
