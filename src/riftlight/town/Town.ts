/**
 * Emberfall, the town hub: a plaza with a fountain, Brann's smithy, Ilsa's market stall,
 * Oru's mystic tent, the stash chest and the rift obelisk where Vex keeps watch, cottages,
 * lanterns, trees and two villagers and a cat on the paths. Built once from primitives
 * (town/kit.ts → one merged mesh per material) and kept alive while levels come and go
 * (hidden, not rebuilt). Lights come from the shared pool; a day–night tint cycles the sun,
 * ambient and sky, lanterns and fireflies come out at night, the forge throws sparks.
 *
 * Layout coordinates are screen-space metres (`sx` right, `sy` up the screen) for the iso
 * camera at 45° yaw, converted with `iso()`, so the data reads like the picture.
 */
import { Color, CylinderGeometry, Group, Mesh, type Object3D, OctahedronGeometry, TorusGeometry, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor, toonMaterial } from '../../engine';
import { Rng } from '../core/rng';
import type { ActorLike } from '../core/types';
import type { PooledLight, ShellServices, StageWorld } from '../game/ports';
import { Cat } from './critters';
import { type Blocker, collideBlockers, faceted, Kit } from './kit';
import { type Bubble, Npc, type NpcAction, NPCS } from './npcs';

const S2 = Math.SQRT1_2;
/** Screen-space (sx right, sy up) → world (x, z) for the iso camera at yaw 45°. */
export const iso = (sx: number, sy: number): [number, number] => [(sx - sy) * S2, (-sx - sy) * S2];
const isoV = (sx: number, sy: number, y = 0) => {
  const [x, z] = iso(sx, sy);
  return new Vector3(x, y, z);
};
/** Yaw (degrees) that turns a building's local +Z toward the plaza centre. */
const facePlaza = (sx: number, sy: number) => {
  const [x, z] = iso(sx, sy);
  return (Math.atan2(-x, -z) * 180) / Math.PI;
};

export const TOWN_LAYOUT = {
  radius: 15.5,
  plaza: 5.2,
  fountain: [0, 0.4] as const,
  obelisk: [0, 8.6] as const,
  /** Buildings with a keeper face between the plaza and the camera, so nobody stands under a roof. */
  smithy: [-9.4, 3.0, 88] as const,
  market: [9.4, 3.0, 2] as const,
  tent: [8.4, -4.4, 10] as const,
  stash: [-4.9, -3.9, 80] as const,
  vex: [2.8, 6.4] as const,
  houses: [
    [-11.5, 10, 'red'],
    [11.5, 10.5, 'teal'],
    [-14, -4, 'plum'],
  ] as const,
  lanterns: [
    [-4.6, 3.2],
    [4.6, 3.2],
    [-3.6, -4.6],
    [3.6, -4.6],
  ] as const,
  spawn: [0, -2.9] as const,
  portalSpawn: [0, 5.1] as const,
};

/** Where the hero walks to talk to an NPC or use a prop. */
export interface Interactable {
  readonly id: string;
  readonly name: string;
  readonly verb: string;
  readonly position: Vector3;
  readonly radius: number;
  /** `showcase`: one of the showcase pieces (arcade, bestiary), by `id` (showcase/Showcase.ts). */
  readonly action: NpcAction | 'stash' | 'showcase';
  readonly npc?: Npc;
}

export class Town implements StageWorld {
  readonly kind = 'town' as const;
  readonly root = new Group();
  readonly npcs: Npc[] = [];
  readonly spawn = isoV(...TOWN_LAYOUT.spawn);
  readonly portalSpawn = isoV(...TOWN_LAYOUT.portalSpawn);
  private blockers: Blocker[] = [];
  private readonly lights: PooledLight[] = [];
  private lanternLights: PooledLight[] = [];
  private forgeLight: PooledLight | null = null;
  private obeliskLight: PooledLight | null = null;
  private tentLight: PooledLight | null = null;
  private crystal!: Object3D;
  private halo!: Object3D;
  private chestLid!: Object3D;
  private readonly orbs: Mesh[] = [];
  private cat!: Cat;
  private time = 0;
  /** 0..1 time of day (0.25 noon, 0.5 dusk, 0.75 midnight, 0 dawn). */
  dayTime = 0.42;
  /** Seconds per full day. 0 freezes the time of day. */
  dayLength = 300;
  private flash = 0;
  private chestOpen = 0;
  private readonly rng: Rng;
  private readonly forgeAt = new Vector3();
  private readonly chimneys: Vector3[] = [];
  private readonly fountainAt = isoV(...TOWN_LAYOUT.fountain);
  /** The town's own sky colour (the engine's default background object is left alone). */
  private readonly sky = new Color(PALETTE.sky);
  active = false;
  readonly interactables: Interactable[] = [];
  /** Things added after the build (showcase props): shown, updated and lit with the town. */
  private readonly extensions: TownExtension[] = [];

  constructor(private readonly services: ShellServices) {
    this.rng = services.rng.fork('town');
    this.root.name = 'town';
  }

  /** Build everything (once). `tree` is the shared tree model (assets/tree.glb). */
  build(tree: Object3D): void {
    const kit = new Kit();
    this.ground(kit);
    this.plaza(kit);
    this.obelisk(kit);
    this.smithy(kit);
    this.market(kit);
    this.tent(kit);
    this.stash(kit);
    for (const [sx, sy, roof] of TOWN_LAYOUT.houses) this.house(kit, sx, sy, roof);
    for (const [sx, sy] of TOWN_LAYOUT.lanterns) this.lantern(kit, sx, sy);
    this.props(kit, tree);
    this.root.add(kit.build());
    this.blockers = kit.blockers;
    this.townsfolk();
    this.cat = new Cat(this.rng.fork('cat'), isoV(-6.8, -1.6), [isoV(-7.2, -0.8), isoV(-5.2, -2.6), isoV(-7.6, -5.2), isoV(-9.6, -2.2)]);
    this.root.add(this.cat.root);
  }

  // ---------------------------------------------------------------- building

  private ground(k: Kit): void {
    k.disc(46, 24, 'green', [0, 0, 0], { receive: true });
    // darker grass patches and a dirt ring road
    const rng = this.rng.fork('grass');
    for (let i = 0; i < 18; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(7, 22);
      k.disc(rng.range(0.8, 1.8), 7, rng.chance(0.3) ? 'teal' : 'lime', [Math.cos(a) * r, 0.005, Math.sin(a) * r], { receive: true, rot: [0, rng.range(0, 90), 0] });
    }
    // paths from the plaza to each place (dirt strips)
    const path = (sx: number, sy: number, len: number, width = 2.2) => {
      const [x, z] = iso(sx, sy);
      const yaw = facePlaza(sx, sy);
      k.frame(x, z, yaw, () => k.box([width, 0.02, len], 'sand', [0, 0.012, len / 2], { cast: false }));
    };
    path(-8.2, 2, 4);
    path(8.2, 2, 4);
    path(6.2, -4.8, 2.5);
    path(0, 6.6, 2.5, 2.6);
    path(0, -7.2, 11, 2.6);
    path(-10.2, 8.6, 7);
    path(10.2, 9, 7);
    // tufts and flowers
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(6.5, 18);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (rng.chance(0.7)) k.cone(0.12, rng.range(0.25, 0.4), 4, rng.chance(0.5) ? 'green' : 'lime', [x, 0.15, z], { cast: false, rot: [0, rng.range(0, 90), 0] });
      else k.box([0.12, 0.12, 0.12], rng.pick(['red', 'sand', 'white', 'sky'] as const), [x, 0.1, z], { cast: false });
    }
  }

  private plaza(k: Kit): void {
    const R = TOWN_LAYOUT.plaza;
    k.disc(R + 0.55, 24, 'slate', [0, 0.02, 0]);
    k.disc(R, 24, 'mist', [0, 0.03, 0]);
    // a ring of edging stones and a few worn cobbles
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      k.box([0.5, 0.06, 0.3], i % 2 ? 'night' : 'slate', [Math.cos(a) * (R + 0.25), 0.05, Math.sin(a) * (R + 0.25)], { cast: false, rot: [0, (-a * 180) / Math.PI + 90, 0] });
    }
    const rng = this.rng.fork('cobbles');
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = 1.9 + Math.sqrt(rng.next()) * (R - 2.4);
      k.box([rng.range(0.25, 0.45), 0.02, rng.range(0.2, 0.35)], 'slate', [Math.cos(a) * r, 0.04, Math.sin(a) * r], { cast: false, rot: [0, rng.range(0, 90), 0] });
    }
    // fountain
    const [fx, fz] = iso(...TOWN_LAYOUT.fountain);
    k.frame(fx, fz, 0, () => {
      k.cyl(1.55, 1.65, 0.5, 8, 'slate', [0, 0.25, 0]);
      k.cyl(1.4, 1.4, 0.06, 8, 'blue', [0, 0.47, 0], { cast: false });
      k.cyl(1.25, 1.25, 0.06, 8, 'sky', [0, 0.5, 0], { cast: false });
      k.cyl(0.32, 0.42, 1.3, 6, 'mist', [0, 0.9, 0]);
      k.cyl(0.6, 0.35, 0.18, 6, 'mist', [0, 1.55, 0]);
      k.cyl(0.5, 0.5, 0.05, 6, 'cyan', [0, 1.64, 0], { cast: false });
      k.blockCircle(0, 0, 1.7);
    });
    // benches
    for (const [sx, sy] of [[-3.4, 1.4], [3.4, 1.4]] as const) {
      const [x, z] = iso(sx, sy);
      k.frame(x, z, facePlaza(sx, sy), () => {
        k.box([1.6, 0.1, 0.5], 'orange', [0, 0.45, 0]);
        k.box([1.6, 0.4, 0.1], 'orange', [0, 0.7, -0.22]);
        for (const lx of [-0.65, 0.65]) k.box([0.12, 0.42, 0.42], 'plum', [lx, 0.21, 0]);
        k.blockBox(0, 0, 1.7, 0.6);
      });
    }
  }

  private obelisk(k: Kit): void {
    const [x, z] = iso(...TOWN_LAYOUT.obelisk);
    k.frame(x, z, 45, () => {
      k.cyl(3.4, 3.6, 0.12, 8, 'slate', [0, 0.06, 0]);
      k.cyl(2.6, 2.8, 0.28, 8, 'night', [0, 0.2, 0]);
      k.cyl(1.9, 2.1, 0.3, 8, 'slate', [0, 0.45, 0]);
      // the obelisk: a tapering four-sided shaft with glowing runes
      k.cyl(0.42, 0.75, 4.2, 4, 'night', [0, 2.7, 0]);
      k.cone(0.42, 0.6, 4, 'night', [0, 5.1, 0]);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        for (const [y, h] of [[1.4, 0.5], [2.3, 0.35], [3.1, 0.5], [3.9, 0.25]] as const) {
          const r = 0.75 - (y - 0.6) * 0.078;
          k.box([0.12, h, 0.05], i % 2 ? 'cyan' : 'sky', [Math.cos(a) * (r - 0.02), y, Math.sin(a) * (r - 0.02)], { rot: [0, (-a * 180) / Math.PI + 90, 0], cast: false });
        }
      }
      // standing stones with rune caps
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const sx = Math.cos(a) * 2.9;
        const sz = Math.sin(a) * 2.9;
        k.box([0.5, 1.4, 0.4], 'slate', [sx, 0.7, sz], { rot: [0, (-a * 180) / Math.PI, i % 2 ? 6 : -5] });
        k.box([0.3, 0.1, 0.3], 'cyan', [sx, 1.45, sz], { cast: false });
        k.blockCircle(sx, sz, 0.45);
      }
      k.blockCircle(0, 0, 2.3);
    });
    // floating crystal and halo (animated)
    const crystal = new Mesh(faceted(new OctahedronGeometry(0.55)), toonMaterial(PALETTE.cyan));
    crystal.scale.set(1, 1.6, 1);
    crystal.position.set(x, 6.4, z);
    crystal.castShadow = true;
    const halo = new Mesh(new TorusGeometry(1.0, 0.07, 4, 16), toonMaterial(PALETTE.sky));
    halo.position.set(x, 6.4, z);
    halo.rotation.x = Math.PI / 2;
    this.crystal = crystal;
    this.halo = halo;
    this.root.add(crystal, halo);
  }

  private smithy(k: Kit): void {
    const [sx, sy, yaw] = TOWN_LAYOUT.smithy;
    const [x, z] = iso(sx, sy);
    k.frame(x, z, yaw, () => {
      // A lean-to forge against a stone wall; the anvil stands in the open yard in front, so
      // Brann is never under the roof from the camera's angle.
      k.box([6.2, 0.12, 4.6], 'slate', [0, 0.06, -0.2], { cast: false });
      k.box([6.2, 3.2, 0.5], 'mist', [0, 1.6, -2.4], { top: 'slate' });
      k.box([0.45, 2.6, 2.2], 'mist', [-3, 1.3, -1.4], { top: 'slate' });
      k.box([0.45, 1.1, 2.2], 'mist', [3, 0.55, -1.4], { top: 'slate' });
      for (const px of [-3, 3]) k.box([0.26, 2.3, 0.26], 'plum', [px, 1.15, -0.45]);
      k.box([6.4, 0.2, 0.26], 'plum', [0, 2.32, -0.45]);
      // the lean-to roof: from the back wall (3.3 m) down to the front beam (2.4 m)
      const depth = 2.3;
      const drop = 0.9;
      const slope = Math.hypot(depth, drop);
      const tilt = (-Math.atan2(drop, depth) * 180) / Math.PI;
      k.box([6.8, 0.14, slope + 0.3], 'red', [0, 2.4 + drop / 2 + 0.08, -0.45 - depth / 2 + 0.05], { rot: [tilt, 0, 0] });
      for (let i = 0; i < 6; i++) k.box([0.08, 0.06, slope + 0.32], 'plum', [-2.8 + i * 1.12, 2.52 + drop / 2, -0.45 - depth / 2 + 0.05], { rot: [tilt, 0, 0], cast: false });
      // forge: stone block with glowing coals, bellows, a chimney through the roof
      k.box([1.6, 1.0, 1.3], 'slate', [-1.7, 0.5, -1.55], { top: 'night' });
      k.box([1.1, 0.12, 0.8], 'orange', [-1.7, 1.04, -1.5], { cast: false });
      k.box([0.6, 0.1, 0.45], 'sand', [-1.7, 1.09, -1.5], { cast: false });
      k.box([0.8, 3.4, 0.8], 'slate', [-1.7, 2.7, -2.0]);
      k.box([0.9, 0.2, 0.9], 'night', [-1.7, 4.45, -2.0]);
      k.box([0.8, 0.5, 0.6], 'plum', [-0.65, 0.75, -1.6], { rot: [0, 0, -15] });
      this.chimneys.push(k.world([-1.7, 4.6, -2.0]));
      this.forgeAt.copy(k.world([-1.7, 1.3, -1.5]));
      // rack of blades on the back wall, a water barrel, a grindstone
      k.box([2.2, 0.12, 0.18], 'plum', [1.2, 1.6, -2.1]);
      for (let i = 0; i < 5; i++) k.box([0.07, 0.95, 0.05], i % 2 ? 'mist' : 'white', [0.4 + i * 0.4, 1.25, -2.05], { rot: [0, 0, i % 2 ? 6 : -4] });
      k.cyl(0.36, 0.36, 0.85, 8, 'plum', [2.3, 0.43, -1.5]);
      k.cyl(0.37, 0.37, 0.07, 8, 'slate', [2.3, 0.72, -1.5]);
      k.cyl(0.3, 0.3, 0.05, 8, 'blue', [2.3, 0.86, -1.5], { cast: false });
      k.cyl(0.42, 0.42, 0.14, 10, 'mist', [-2.5, 0.75, 1.0], { rot: [0, 0, 90] });
      k.box([0.12, 0.7, 0.5], 'plum', [-2.5, 0.35, 1.0]);
      // the anvil on its stump, out in the yard
      const ax = 0.5;
      const az = 1.1;
      k.cyl(0.34, 0.4, 0.5, 7, 'plum', [ax, 0.25, az]);
      k.box([0.42, 0.18, 0.3], 'night', [ax, 0.6, az]);
      k.box([0.74, 0.16, 0.34], 'slate', [ax, 0.76, az]);
      k.box([0.22, 0.12, 0.2], 'slate', [ax + 0.4, 0.76, az]);
      this.anvilAt = k.world([ax, 0.86, az]);
      // finished pieces leaning on the stump, a coal pile
      k.box([0.07, 0.8, 0.05], 'white', [ax - 0.55, 0.38, az + 0.25], { rot: [20, 0, 10] });
      k.box([0.5, 0.5, 0.08], 'slate', [ax + 0.7, 0.28, az + 0.35], { rot: [15, 30, 0] });
      k.cone(0.45, 0.35, 6, 'ink', [1.9, 0.18, -0.3], { cast: false });
      // blockers
      k.blockBox(0, -2.4, 6.2, 0.6);
      k.blockBox(-3, -1.4, 0.5, 2.2);
      k.blockBox(3, -1.4, 0.5, 2.2);
      k.blockBox(-1.7, -1.55, 1.6, 1.3);
      k.blockCircle(2.3, -1.5, 0.42);
      k.blockCircle(ax, az, 0.48);
      k.blockCircle(-2.5, 1.0, 0.45);
      for (const px of [-3, 3]) k.blockCircle(px, -0.45, 0.22);
    });
  }

  private anvilAt = new Vector3();

  private market(k: Kit): void {
    const [sx, sy, yaw] = TOWN_LAYOUT.market;
    const [x, z] = iso(sx, sy);
    k.frame(x, z, yaw, () => {
      // counter with goods, striped awning on posts
      k.box([4.2, 1.0, 0.8], 'orange', [0, 0.5, 0.9], { top: 'sand' });
      k.box([4.4, 0.08, 1.0], 'plum', [0, 1.02, 0.9]);
      for (const px of [-2.1, 2.1]) {
        k.box([0.2, 2.95, 0.2], 'plum', [px, 1.48, 0.62]);
        k.box([0.2, 3.5, 0.2], 'plum', [px, 1.75, -1.6]);
      }
      k.box([4.4, 1.6, 0.12], 'orange', [0, 1.3, -1.65]);
      for (let i = 0; i < 5; i++) k.box([0.5, 0.4, 0.3], i % 2 ? 'sand' : 'orange', [-1.6 + i * 0.8, 2.3, -1.5]);
      for (let i = 0; i < 7; i++) k.box([0.66, 0.08, 2.5], i % 2 ? 'white' : 'red', [-1.98 + i * 0.66, 3.25, -0.55], { rot: [-16, 0, 0] });
      for (let i = 0; i < 7; i++) k.box([0.66, 0.3, 0.06], i % 2 ? 'white' : 'red', [-1.98 + i * 0.66, 2.85, 0.66]);
      // goods: apples, jars, sacks, crates
      for (let i = 0; i < 6; i++) k.box([0.16, 0.16, 0.16], i % 3 ? 'red' : 'lime', [-1.7 + i * 0.12, 1.14, 0.85 + (i % 2) * 0.12]);
      for (let i = 0; i < 3; i++) k.cyl(0.12, 0.15, 0.32, 6, i % 2 ? 'sky' : 'orange', [0.3 + i * 0.3, 1.22, 0.9]);
      k.box([0.5, 0.06, 0.4], 'sand', [1.5, 1.09, 0.9]);
      k.box([0.3, 0.12, 0.3], 'sand', [1.5, 1.16, 0.9]);
      k.cyl(0.35, 0.45, 0.7, 7, 'sand', [-2.7, 0.35, 0.2]);
      k.box([0.8, 0.8, 0.8], 'orange', [2.8, 0.4, -0.4], { top: 'sand' });
      k.box([0.6, 0.6, 0.6], 'orange', [2.7, 1.1, -0.4], { rot: [0, 20, 0], top: 'sand' });
      k.blockBox(0, 0.9, 4.4, 0.9);
      k.blockCircle(-2.7, 0.2, 0.5);
      k.blockBox(2.8, -0.4, 0.9, 0.9);
      k.blockBox(0, -1.6, 4.4, 0.4);
    });
  }

  private tent(k: Kit): void {
    const [sx, sy, yaw] = TOWN_LAYOUT.tent;
    const [x, z] = iso(sx, sy);
    k.frame(x, z, yaw, () => {
      k.cone(2.5, 3.4, 8, 'plum', [0, 1.7, -1.6]);
      k.cyl(2.52, 2.52, 0.3, 8, 'sand', [0, 0.3, -1.6]);
      k.cone(0.4, 0.8, 8, 'sand', [0, 3.6, -1.6]);
      k.box([1.0, 1.6, 0.1], 'ink', [0, 0.8, 0.12], { rot: [-34, 0, 0] });
      k.box([0.12, 1.2, 0.12], 'sand', [0, 4.2, -1.6]);
      // rug, cushions, crystal ball table, candles
      k.box([2.8, 0.03, 2.2], 'red', [0, 0.02, 1.9], { cast: false });
      k.box([2.4, 0.035, 1.8], 'orange', [0, 0.025, 1.9], { cast: false });
      for (const px of [-1.6, 1.6]) k.box([0.5, 0.2, 0.5], 'navy', [px, 0.1, 2.4]);
      k.cyl(0.32, 0.2, 0.6, 6, 'night', [1.5, 0.3, 1.0]);
      k.cyl(0.24, 0.24, 0.3, 8, 'cyan', [1.5, 0.75, 1.0]);
      for (const [cx, cz] of [[-1.3, 0.9], [-1.0, 3.0], [1.2, 3.0]]) {
        k.cyl(0.06, 0.06, 0.3, 5, 'white', [cx!, 0.15, cz!]);
        k.box([0.05, 0.08, 0.05], 'sand', [cx!, 0.34, cz!], { cast: false });
      }
      k.blockCircle(0, -1.6, 2.5);
      k.blockCircle(1.5, 1.0, 0.35);
      this.tentAt = k.world([0, 1.6, 1.6]);
    });
  }

  private tentAt = new Vector3();

  private stash(k: Kit): void {
    const [sx, sy, yaw] = TOWN_LAYOUT.stash;
    const [x, z] = iso(sx, sy);
    k.frame(x, z, yaw, () => {
      k.box([1.3, 0.6, 0.8], 'plum', [0, 0.3, 0], { top: 'orange' });
      for (const bx of [-0.45, 0.45]) k.box([0.1, 0.62, 0.82], 'sand', [bx, 0.31, 0]);
      k.box([0.2, 0.2, 0.06], 'sand', [0, 0.45, 0.42]);
      k.blockBox(0, 0, 1.4, 0.9);
    });
    // the lid is animated (opens when used)
    const lid = new Group();
    const top = new Mesh(faceted(new CylinderGeometry(0.4, 0.4, 1.3, 6, 1, false, 0, Math.PI)), toonMaterial(PALETTE.orange));
    top.rotation.z = Math.PI / 2;
    top.position.set(0, 0, 0.4);
    top.castShadow = true;
    lid.add(top);
    lid.position.set(x, 0.6, z);
    lid.rotation.y = (yaw * Math.PI) / 180;
    const pivot = new Group();
    pivot.position.set(0, 0, -0.4);
    pivot.add(top);
    lid.add(pivot);
    this.chestLid = pivot;
    this.root.add(lid);
    this.interactables.push({ id: 'stash', name: 'Stash', verb: 'OPEN', position: new Vector3(x, 0, z), radius: 2, action: 'stash' });
  }

  private house(k: Kit, sx: number, sy: number, roof: PaletteColor): void {
    const [x, z] = iso(sx, sy);
    k.frame(x, z, facePlaza(sx, sy), () => {
      k.box([4.2, 2.4, 3.4], 'white', [0, 1.2, 0], { top: 'mist' });
      // timber frame
      for (const px of [-2.05, 2.05]) k.box([0.18, 2.4, 0.18], 'plum', [px, 1.2, 1.66]);
      k.box([4.3, 0.18, 0.18], 'plum', [0, 2.35, 1.66]);
      k.box([4.3, 0.14, 0.14], 'plum', [0, 1.2, 1.68]);
      k.box([0.9, 1.5, 0.08], 'plum', [-0.9, 0.75, 1.72]);
      k.box([0.8, 0.7, 0.06], 'sand', [1.1, 1.45, 1.72]);
      k.box([0.9, 0.1, 0.1], 'plum', [1.1, 1.08, 1.75]);
      k.roof(4.2, 3.4, 2.4, 1.5, roof, 0.3, 'plum');
      k.box([0.6, 1.2, 0.6], 'slate', [1.3, 3.6, -0.6]);
      this.chimneys.push(k.world([1.3, 4.3, -0.6]));
      k.blockBox(0, 0, 4.4, 3.6);
    });
  }

  private readonly lanternAt: Vector3[] = [];

  private lantern(k: Kit, sx: number, sy: number): void {
    const [x, z] = iso(sx, sy);
    k.frame(x, z, 45, () => {
      k.cyl(0.08, 0.1, 2.3, 5, 'night', [0, 1.15, 0]);
      k.box([0.5, 0.06, 0.06], 'night', [0.22, 2.25, 0]);
      k.box([0.24, 0.32, 0.24], 'sand', [0.42, 2.0, 0]);
      k.box([0.3, 0.06, 0.3], 'night', [0.42, 2.18, 0]);
      this.lanternAt.push(k.world([0.42, 2.0, 0]));
      k.blockCircle(0, 0, 0.2);
    });
  }

  private props(k: Kit, tree: Object3D): void {
    const rng = this.rng.fork('props');
    // a ring of trees around the town edge, leaving the paths open
    const trees: Object3D[] = [];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + rng.range(-0.06, 0.06);
      const r = rng.range(15, 21);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // keep the south road (toward the camera) and the houses clear
      const [px, pz] = iso(0, -12);
      if (Math.hypot(x - px, z - pz) < 5) continue;
      const t = tree.clone(true);
      t.position.set(x, 0, z);
      t.rotation.y = rng.range(0, Math.PI * 2);
      t.scale.setScalar(rng.range(1.1, 1.7));
      trees.push(t);
      k.blockers.push({ kind: 'circle', x, z, r: 0.45 });
    }
    for (const t of trees) k.statics.push(t);
    // barrels, crates, hay
    const crate = (sx: number, sy: number, s = 0.7) => {
      const [x, z] = iso(sx, sy);
      k.box([s, s, s], 'orange', [x, s / 2, z], { top: 'sand', rot: [0, rng.range(0, 40), 0] });
      k.blockers.push({ kind: 'circle', x, z, r: s * 0.6 });
    };
    crate(-6.8, 5.4);
    crate(-6.1, 6.1, 0.55);
    crate(7.4, 5.8);
    const [hx, hz] = iso(-12.6, 3.6);
    k.cyl(0.6, 0.6, 0.8, 8, 'sand', [hx, 0.4, hz], { rot: [0, 0, 90] });
    k.blockers.push({ kind: 'circle', x: hx, z: hz, r: 0.6 });
    // low fence along the south edge
    for (let i = -6; i <= 6; i++) {
      if (Math.abs(i) <= 1) continue;
      const [x, z] = iso(i * 1.6, -11.5);
      k.frame(x, z, 45, () => {
        k.box([0.12, 0.8, 0.12], 'plum', [0, 0.4, 0]);
        k.box([1.6, 0.1, 0.06], 'orange', [0, 0.6, 0]);
        k.box([1.6, 0.1, 0.06], 'orange', [0, 0.3, 0]);
      });
    }
  }

  private townsfolk(): void {
    const place = (id: string, sx: number, sy: number, yaw: number | null = null): Npc => {
      const at = isoV(sx, sy);
      const npc = new Npc(NPCS[id]!, at, yaw ?? facePlaza(sx, sy), this.rng.fork(id));
      this.root.add(npc.root);
      this.npcs.push(npc);
      return npc;
    };
    // Brann works at the anvil, facing out over it toward the plaza.
    const smYaw = TOWN_LAYOUT.smithy[2];
    const brannAt = this.anvilAt.clone().sub(new Vector3(Math.sin((smYaw * Math.PI) / 180), 0, Math.cos((smYaw * Math.PI) / 180)).multiplyScalar(0.72));
    const brann = new Npc(NPCS.brann!, brannAt.setY(0), smYaw, this.rng.fork('brann'));
    this.root.add(brann.root);
    this.npcs.push(brann);
    brann.onBeat = () => {
      this.services.ctx.particles.burst('rl.sparks', this.anvilAt);
      this.flash = 1;
      this.audio('rl.anvil', this.anvilAt, 0.8);
    };
    const mk = TOWN_LAYOUT.market;
    const ilsa = place('ilsa', mk[0], mk[1], mk[2]);
    // in front of her stall, beside the goods (behind the counter the awning would hide her)
    ilsa.position.copy(isoV(mk[0], mk[1]).add(this.local(mk[2], -1.3, 1.75)));
    ilsa.onBeat = (kind) => kind === 'coin' && this.audio('rl.coin', ilsa.position, 0.6);
    const tn = TOWN_LAYOUT.tent;
    const oru = place('oru', tn[0], tn[1], tn[2]);
    oru.position.copy(isoV(tn[0], tn[1]).add(this.local(tn[2], 0, 1.8)));
    const vex = place('vex', ...TOWN_LAYOUT.vex);
    void vex;
    // Oru's orbs
    for (let i = 0; i < 3; i++) {
      const orb = new Mesh(faceted(new OctahedronGeometry(0.1)), toonMaterial(PALETTE[i === 1 ? 'sky' : 'cyan']));
      this.orbs.push(orb);
      this.root.add(orb);
    }
    // villagers on loops
    const wren = place('villager', -3, 6.8);
    wren.path = [isoV(-3, 6.8), isoV(-6.8, 3.8), isoV(-6.6, -2.6), isoV(-2.4, -6.4), isoV(2.6, -6.8), isoV(-0.8, -5.6)];
    const pell = place('villager2', 6.4, 4.6);
    pell.path = [isoV(6.4, 4.6), isoV(10.8, 7.6), isoV(7.4, 8.6), isoV(3.4, 5.8), isoV(5.4, -1.2)];
    for (const n of this.npcs) {
      if (!n.def.action) continue;
      const front = n.position.clone().add(new Vector3(Math.sin(n.yaw), 0, Math.cos(n.yaw)).multiplyScalar(n.def.id === 'brann' ? 1.5 : 1.0));
      this.interactables.push({ id: n.def.id, name: n.def.name, verb: 'TALK', position: front, radius: n.def.id === 'vex' ? 2.2 : 2.0, action: n.def.action, npc: n });
    }
    void ilsa;
  }

  /** A point in a building's local frame (x right, z toward the plaza), as a world offset. */
  private local(yawDeg: number, lx: number, lz: number): Vector3 {
    const yaw = (yawDeg * Math.PI) / 180;
    return new Vector3(lx * Math.cos(yaw) + lz * Math.sin(yaw), 0, -lx * Math.sin(yaw) + lz * Math.cos(yaw));
  }

  /** Positional-ish sound: quieter with distance from the hero. */
  private heroAt: Vector3 | null = null;
  private audio(name: string, at: Vector3, volume: number): void {
    if (!this.active || !this.heroAt) return;
    const d = this.heroAt.distanceTo(at);
    if (d > 16) return;
    this.services.ctx.audio.play(name, { volume: volume * Math.max(0.1, 1 - d / 16) });
  }

  /**
   * Add something built elsewhere (the showcase's arcade cabinet and bestiary): its meshes,
   * the blockers actors collide with, interactables, and hooks that run with the town's own
   * activate / deactivate / update.
   */
  extend(ext: TownExtension): void {
    if (ext.root) this.root.add(ext.root);
    if (ext.blockers) this.blockers.push(...ext.blockers);
    if (ext.interactables) this.interactables.push(...ext.interactables);
    this.extensions.push(ext);
    if (this.active) ext.activate?.();
  }

  // ---------------------------------------------------------------- stage

  /** Show the town and borrow its lights. */
  activate(): void {
    for (const e of this.extensions) e.activate?.();
    this.active = true;
    this.root.visible = true;
    const L = this.services.lights;
    const take = (c: number, i: number, d: number, at: Vector3) => {
      const l = L.acquire(c, i, d, at);
      if (l) this.lights.push(l);
      return l;
    };
    this.obeliskLight = take(PALETTE.cyan, 30, 12, isoV(...TOWN_LAYOUT.obelisk, 4.5));
    this.forgeLight = take(PALETTE.orange, 16, 6, this.forgeAt);
    this.tentLight = take(PALETTE.sky, 8, 5, this.tentAt);
    this.lanternLights = this.lanternAt.map((p) => take(PALETTE.sand, 0, 7.5, p)).filter((l): l is PooledLight => !!l);
  }

  deactivate(): void {
    for (const e of this.extensions) e.deactivate?.();
    this.active = false;
    this.root.visible = false;
    for (const l of this.lights) this.services.lights.release(l);
    this.lights.length = 0;
    this.lanternLights = [];
    this.forgeLight = this.obeliskLight = this.tentLight = null;
    this.restoreSky();
  }

  openChest(open: boolean): void {
    this.chestOpen = open ? 1 : 0;
    if (open) this.services.ctx.audio.play('rl.chest');
  }

  collide(p: Vector3, radius: number): void {
    collideBlockers(p, radius, this.blockers);
    // townsfolk are solid too (they move, so they're checked live)
    for (const n of this.npcs) {
      const dx = p.x - n.position.x;
      const dz = p.z - n.position.z;
      const d = Math.hypot(dx, dz);
      const min = radius + 0.4 * n.def.scale;
      if (d < min && d > 1e-6) {
        p.x = n.position.x + (dx / d) * min;
        p.z = n.position.z + (dz / d) * min;
      }
    }
    const d = Math.hypot(p.x, p.z);
    const R = TOWN_LAYOUT.radius;
    if (d > R) {
      p.x *= R / d;
      p.z *= R / d;
    }
  }

  groundY(): number {
    return 0;
  }

  actors(): readonly ActorLike[] {
    return [];
  }

  /** Every bubble on screen (HUD). */
  bubbles(): Bubble[] {
    const out: Bubble[] = [];
    for (const n of this.npcs) if (n.bubble) out.push(n.bubble);
    if (this.cat.bubble) out.push(this.cat.bubble);
    return out;
  }

  /** The interactable in reach of `p`, nearest first. */
  nearest(p: Vector3): Interactable | null {
    let best: Interactable | null = null;
    let bd = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(p.x - it.position.x, p.z - it.position.z);
      if (d < it.radius && d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  /** Camera path for the title screen: a slow drift across the plaza toward the obelisk. */
  titleTarget(t: number, out: Vector3): Vector3 {
    const u = (Math.sin(t * 0.05) + 1) / 2;
    const [x, z] = iso(-3 + 6 * u, 2.6 + 1.6 * Math.sin(t * 0.07));
    return out.set(x, 1.6, z);
  }

  update(dt: number, hero: Vector3 | null): void {
    if (!this.active) return;
    this.time += dt;
    this.heroAt = hero;
    if (this.dayLength > 0) this.dayTime = (this.dayTime + dt / this.dayLength) % 1;
    const night = this.applySky();
    for (const n of this.npcs) n.update(dt, hero);
    for (const e of this.extensions) e.update?.(dt, night);
    this.cat.update(dt, hero, this.blockers);
    const t = this.time;
    // obelisk crystal: bob, spin, pulse
    const [ox, oz] = iso(...TOWN_LAYOUT.obelisk);
    this.crystal.position.set(ox, 6.3 + Math.sin(t * 1.3) * 0.18, oz);
    this.crystal.rotation.y = t * 0.8;
    this.halo.position.set(ox, 6.3 + Math.sin(t * 1.3 + 0.6) * 0.12, oz);
    this.halo.rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.25, 0, t * 0.5);
    if (this.obeliskLight) this.obeliskLight.intensity = 26 + 8 * Math.sin(t * 2.1) + 18 * night;
    // forge: flicker + strike flashes
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.forgeLight) this.forgeLight.intensity = 7 + 2 * Math.sin(t * 13) * Math.sin(t * 5.3) + 12 * this.flash + 5 * night;
    if (this.tentLight) this.tentLight.intensity = 6 + 2 * Math.sin(t * 1.7) + 6 * night;
    for (const [i, l] of this.lanternLights.entries()) l.intensity = night * (16 + 2 * Math.sin(t * 9 + i * 1.7));
    // Oru's orbs orbit him, leaving faint trails
    const oru = this.npcs.find((n) => n.def.id === 'oru');
    if (oru) {
      this.orbs.forEach((orb, i) => {
        const a = t * (0.9 + i * 0.15) + (i * Math.PI * 2) / 3;
        const r = 0.85 + 0.1 * Math.sin(t * 2 + i);
        orb.position.set(oru.position.x + Math.cos(a) * r, 1.35 + 0.35 * Math.sin(a * 1.5 + i), oru.position.z + Math.sin(a) * r);
        orb.rotation.y = t * 3;
        if (this.tick(dt, 7, i)) this.services.ctx.particles.burst('rl.orb', orb.position);
      });
    }
    // ambient particles: embers, chimney smoke, motes, fountain spray, fireflies
    if (this.tick(dt, 6)) this.services.ctx.particles.burst('rl.ember', this.forgeAt);
    if (this.tick(dt, 1.2)) for (const c of this.chimneys) this.services.ctx.particles.burst('rl.chimney', c);
    if (this.tick(dt, 5)) this.services.ctx.particles.burst('rl.mote', isoV(...TOWN_LAYOUT.obelisk, 1));
    if (this.tick(dt, 10)) this.services.ctx.particles.burst('rl.spray', this.fountainAt.clone().setY(1.7));
    if (night > 0.3 && this.tick(dt, 4 * night)) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(6, 16);
      this.services.ctx.particles.burst('rl.firefly', [Math.cos(a) * r, this.rng.range(0.5, 1.8), Math.sin(a) * r]);
    }
    // chest lid
    const lidTarget = this.chestOpen * -1.9;
    this.chestLid.rotation.x += (lidTarget - this.chestLid.rotation.x) * (1 - Math.exp(-10 * dt));
  }

  /** True `rate` times a second (stable for a given phase). */
  private tick(dt: number, rate: number, phase = 0): boolean {
    return Math.floor((this.time + phase * 0.13) * rate) !== Math.floor((this.time - dt + phase * 0.13) * rate);
  }

  /** Sun, ambient and sky for the time of day. Returns night 0..1. */
  private applySky(): number {
    const e = this.services.ctx.engine;
    // day 0.0–0.45, dusk 0.45–0.55, night 0.55–0.95, dawn 0.95–1.0
    const t = this.dayTime;
    const night = smooth(0.45, 0.6, t) * (1 - smooth(0.9, 1, t)) + (t < 0.05 ? 1 - smooth(0, 0.05, t) : 0);
    const dusk = Math.max(0, 1 - Math.abs(t - 0.5) / 0.08) + Math.max(0, 1 - Math.abs(t - 0.97) / 0.05);
    mixHex(e.sun.color, PALETTE.white, PALETTE.orange, Math.min(1, dusk));
    if (night > 0) mixHex(e.sun.color, e.sun.color.getHex(), PALETTE.sky, night);
    e.sun.intensity = 3.2 * (1 - night) + 1.2 * night - 0.6 * Math.min(1, dusk);
    mixHex(e.ambient.color, PALETTE.mist, PALETTE.plum, Math.min(1, dusk) * 0.6);
    if (night > 0) mixHex(e.ambient.color, e.ambient.color.getHex(), PALETTE.navy, night);
    e.ambient.intensity = 1.1 * (1 - night) + 1.9 * night;
    mixHex(this.sky, PALETTE.sky, PALETTE.orange, Math.min(1, dusk));
    if (night > 0) mixHex(this.sky, this.sky.getHex(), PALETTE.ink, night);
    e.scene.background = this.sky;
    return night;
  }

  private restoreSky(): void {
    const e = this.services.ctx.engine;
    e.sun.color.setHex(PALETTE.white);
    e.sun.intensity = 3.2;
    e.ambient.color.setHex(PALETTE.mist);
    e.ambient.intensity = 1.1;
  }

  dispose(): void {
    for (const n of this.npcs) n.dispose();
    this.cat.dispose();
    this.deactivate();
    this.root.removeFromParent();
  }
}

/** See `Town.extend`. */
export interface TownExtension {
  readonly root?: Object3D;
  readonly blockers?: readonly Blocker[];
  readonly interactables?: readonly Interactable[];
  activate?(): void;
  deactivate?(): void;
  /** Per frame while the town is active; `night` is 0..1. */
  update?(dt: number, night: number): void;
}

function smooth(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

function mixHex(target: Color, a: number, b: number, t: number): void {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  target.setRGB((ar + (br - ar) * t) / 255, (ag + (bg - ag) * t) / 255, (ab + (bb - ab) * t) / 255, 'srgb');
}
