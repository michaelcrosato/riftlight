/**
 * The Hall of Beasts: a long, dark gallery built from primitives (the town's kit), lit only by
 * the engine's light pool. Pedestals line both walls; the Rift Altar (two parent plinths and
 * a glowing vat) closes the far end. Pure layout + meshes + Rapier colliders; the exhibits on
 * the pedestals are `BestiaryMode`'s business.
 *
 *   hall local axes: +x right, the long aisle runs toward -z, the entrance is at z = +2.
 */
import { BoxGeometry, ConeGeometry, Group, type Material, Mesh, MeshBasicNodeMaterial, type Object3D, Vector3 } from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d';
import { PALETTE, type Song } from '../../../engine';
import type { Physics } from '../../../engine/physics/Physics';
import { glowMaterial } from '../../levels/themes/props';
import { Kit } from '../../town/kit';

export const HALL = {
  /** Pedestals per side and their spacing along the aisle (m). */
  perSide: 5,
  spacing: 5,
  /** Pedestal centres: ±x, first z. */
  pedestalX: 3.8,
  firstZ: -5,
  width: 12,
  height: 5.6,
  /** Where the visitor starts (feet) and the doorway line that leads back out. */
  spawn: [0, 0, 1] as const,
  exitZ: 2.6,
} as const;

/** One pedestal: where an exhibit stands (top centre, world), which way it faces, its light. */
export interface Pedestal {
  readonly index: number;
  readonly top: Vector3;
  /** Yaw that faces the aisle. */
  readonly yaw: number;
  /** Where its light hangs. */
  readonly light: Vector3;
  /** Where to stand to look at it. */
  readonly viewpoint: Vector3;
}

export interface Altar {
  readonly child: Vector3;
  readonly parents: readonly [Vector3, Vector3];
  readonly light: Vector3;
  /** Where to stand to use it. */
  readonly viewpoint: Vector3;
}

export class Hall {
  readonly root = new Group();
  readonly pedestals: Pedestal[] = [];
  altar!: Altar;
  /** Floor lamps by the door (lit). */
  readonly lamps: Vector3[] = [];
  readonly length: number;
  private readonly colliders: RAPIER.Collider[] = [];

  constructor(readonly origin: Vector3) {
    this.root.name = 'hall-of-beasts';
    this.length = -HALL.firstZ + HALL.spacing * (HALL.perSide - 1) + 11;
  }

  /** World point of a hall-local point. */
  at(x: number, y: number, z: number): Vector3 {
    return new Vector3(this.origin.x + x, this.origin.y + y, this.origin.z + z);
  }

  build(physics: Physics): void {
    const kit = new Kit();
    const W = HALL.width;
    const H = HALL.height;
    const L = this.length;
    const back = 2 - L; // back wall z
    const box = (size: [number, number, number], at: [number, number, number]) => {
      const c = physics.addStaticBox({ position: this.at(...at).toArray() as [number, number, number], halfExtents: [size[0] / 2, size[1] / 2, size[2] / 2] });
      this.colliders.push(c);
    };
    const glows: Object3D[] = [];
    const glow = (size: [number, number, number], color: number, at: [number, number, number]) => {
      const m = new Mesh(new BoxGeometry(...size), glowMaterial(color));
      m.position.set(...at);
      m.castShadow = false;
      glows.push(m);
    };
    kit.frame(0, 0, 0, () => {
      // floor: a checker of slate and night tiles, a red runner down the aisle
      const tiles = Math.ceil(L / 2);
      for (let i = 0; i < tiles; i++)
        for (let j = 0; j < 6; j++) kit.box([2, 0.1, 2], (i + j) % 2 ? 'slate' : 'night', [-W / 2 + 1 + j * 2, -0.05, 2 - 1 - i * 2], { cast: false });
      kit.box([2.2, 0.02, L - 1], 'red', [0, 0.01, 2 - L / 2], { cast: false });
      kit.box([1.8, 0.025, L - 1.2], 'plum', [0, 0.015, 2 - L / 2], { cast: false });
      box([W + 2, 1, L + 2], [0, -0.5, 2 - L / 2]);
      // walls, ceiling, the back wall, the entrance wall with its door
      for (const sx of [-1, 1]) {
        kit.box([0.6, H, L], 'night', [sx * (W / 2 + 0.3), H / 2, 2 - L / 2], { top: 'ink' });
        box([0.6, H, L], [sx * (W / 2 + 0.3), H / 2, 2 - L / 2]);
      }
      kit.box([W + 1.2, 0.4, L + 0.6], 'ink', [0, H + 0.2, 2 - L / 2]);
      kit.box([W, H, 0.6], 'night', [0, H / 2, back - 0.3]);
      box([W, H, 0.6], [0, H / 2, back - 0.3]);
      for (const sx of [-1, 1]) {
        kit.box([W / 2 - 1.2, H, 0.6], 'night', [sx * (W / 4 + 0.6), H / 2, 3.3]);
        box([W / 2 - 1.2, H, 0.6], [sx * (W / 4 + 0.6), H / 2, 3.3]);
      }
      kit.box([2.4, H - 3, 0.6], 'night', [0, 3 + (H - 3) / 2, 3.3]);
      kit.box([2.4, 3, 0.1], 'ink', [0, 1.5, 3.5]);
      box([2.4, 3, 0.4], [0, 1.5, 3.7]);
      // columns along the walls with banners between them, sconces on the columns
      for (let z = 0; z > back + 1; z -= HALL.spacing / 2) {
        for (const sx of [-1, 1]) {
          const x = sx * (W / 2 - 0.35);
          kit.box([0.7, H, 0.7], 'slate', [x, H / 2, z], { top: 'mist' });
          kit.box([0.9, 0.3, 0.9], 'mist', [x, 0.15, z]);
          kit.box([0.9, 0.3, 0.9], 'mist', [x, H - 0.15, z]);
          glow([0.16, 0.24, 0.16], PALETTE.sand, [x - sx * 0.42, 2.9, z]);
          kit.box([0.2, 0.08, 0.2], 'ink', [x - sx * 0.42, 2.74, z]);
        }
      }
      for (let k = 0; k < HALL.perSide; k++) {
        const z = HALL.firstZ - k * HALL.spacing;
        for (const sx of [-1, 1]) {
          const x = sx * (W / 2 - 0.05);
          kit.box([0.06, 2.4, 1.3], k % 2 ? 'plum' : 'red', [x, 3.4, z]);
          kit.box([0.08, 0.3, 1.3], 'sand', [x, 2.3, z]);
          kit.cone(0.65, 0.5, 4, k % 2 ? 'plum' : 'red', [x, 2.0, z], { rot: [180, 45, 0] });
        }
      }
      // the pedestals
      for (let k = 0; k < HALL.perSide; k++) {
        const z = HALL.firstZ - k * HALL.spacing;
        for (const sx of [-1, 1]) {
          const x = sx * HALL.pedestalX;
          kit.cyl(1.25, 1.35, 0.25, 8, 'slate', [x, 0.125, z]);
          kit.cyl(1.0, 1.1, 0.45, 8, 'mist', [x, 0.47, z], { top: 'mist' });
          kit.cyl(1.05, 1.05, 0.06, 8, 'sand', [x, 0.72, z]);
          // the brass plaque toward the aisle
          kit.box([0.7, 0.3, 0.06], 'sand', [x - sx * 1.08, 0.45, z], { rot: [0, sx * 90, 0] });
          this.colliders.push(physics.addStaticCylinder(this.at(x, 0.4, z).toArray() as [number, number, number], 0.4, 1.15));
          const index = this.pedestals.length;
          this.pedestals.push({
            index,
            top: this.at(x, 0.75, z),
            yaw: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
            light: this.at(x - sx * 1.6, 3.6, z + 0.6),
            viewpoint: this.at(x - sx * 2.6, 0, z),
          });
        }
      }
      // the Rift Altar at the far end: a ring dais, a vat for the child, two parent plinths
      const az = back + 4.2;
      kit.cyl(3.0, 3.2, 0.2, 10, 'night', [0, 0.1, az]);
      kit.cyl(2.6, 2.6, 0.06, 10, 'plum', [0, 0.23, az]);
      kit.cyl(0.95, 1.1, 0.5, 8, 'slate', [0, 0.45, az], { top: 'ink' });
      // the vat: a ring of short crystal fangs around a glowing pool
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        kit.cone(0.12, 0.55, 4, 'cyan', [Math.cos(a) * 1.0, 0.95, az + Math.sin(a) * 1.0]);
      }
      glow([0.9, 0.05, 0.9], PALETTE.cyan, [0, 0.72, az]);
      this.colliders.push(physics.addStaticCylinder(this.at(0, 0.6, az).toArray() as [number, number, number], 0.6, 1.2));
      for (const sx of [-1, 1]) {
        kit.cyl(0.7, 0.8, 0.6, 6, 'mist', [sx * 2.9, 0.3, az + 0.6]);
        kit.cyl(0.74, 0.74, 0.06, 6, sx < 0 ? 'red' : 'sky', [sx * 2.9, 0.62, az + 0.6]);
        this.colliders.push(physics.addStaticCylinder(this.at(sx * 2.9, 0.3, az + 0.6).toArray() as [number, number, number], 0.3, 0.8));
      }
      this.altar = {
        child: this.at(0, 0.75, az),
        parents: [this.at(-2.9, 0.65, az + 0.6), this.at(2.9, 0.65, az + 0.6)],
        light: this.at(0, 3.8, az + 1.6),
        viewpoint: this.at(0, 0, az + 4.2),
      };
      // lamps by the door
      for (const sx of [-1, 1]) {
        kit.cyl(0.12, 0.16, 1.6, 6, 'ink', [sx * 1.9, 0.8, 2.2]);
        glow([0.3, 0.3, 0.3], PALETTE.orange, [sx * 1.9, 1.75, 2.2]);
        this.lamps.push(this.at(sx * 1.9, 2.1, 2.0));
      }
    });
    const built = kit.build();
    const g = new Group();
    g.position.copy(this.origin);
    g.add(built, ...glows, ...this.shafts());
    this.root.add(g);
  }

  /** Faint light shafts from the ceiling onto each pedestal (unlit, see-through). */
  private shafts(): Mesh[] {
    const out: Mesh[] = [];
    const mat = new MeshBasicNodeMaterial({ color: PALETTE.sand, transparent: true, opacity: 0.07, depthWrite: false });
    const geo = new ConeGeometry(1.15, HALL.height - 0.8, 8, 1, true);
    for (const p of this.pedestals) {
      const m = new Mesh(geo, mat);
      m.position.set(p.top.x - this.origin.x, p.top.y + (HALL.height - 0.8) / 2 - 0.05, p.top.z - this.origin.z);
      m.castShadow = m.receiveShadow = false;
      m.renderOrder = 2;
      out.push(m);
    }
    return out;
  }

  dispose(physics: Physics): void {
    for (const c of this.colliders) physics.remove(c);
    this.colliders.length = 0;
    this.root.removeFromParent();
    const materials = new Set<Material>();
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.userData.shared) m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (!mat.userData.shared) materials.add(mat);
    });
    for (const m of materials) m.dispose();
  }
}

/** A slow, low organ-ish loop for the hall (the engine's song format). */
export const HALL_SONG: Song = {
  bpm: 70,
  tracks: {
    pad: { wave: 'triangle', attack: 0.08, decay: 0.6, volume: 0.14 },
    bass: { wave: 'triangle', decay: 0.5, volume: 0.22 },
    bell: { wave: 'sine', decay: 0.6, volume: 0.06 },
  },
  patterns: {
    a: {
      pad: 'A3 - - - C4 - - - E4 - - - C4 - - -',
      bass: 'A2 - - - - - - - F2 - - - - - - -',
      bell: 'E5 . . . . . . . . . . . A5 . . .',
    },
    b: {
      pad: 'F3 - - - A3 - - - G3 - - - E3 - - -',
      bass: 'F2 - - - - - - - E2 - - - - - - -',
      bell: '. . . . C6 . . . . . . . B5 . . .',
    },
  },
  order: ['a', 'b'],
};
