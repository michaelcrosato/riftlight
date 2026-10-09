/**
 * Destruction: walls and blocks that shatter into chunks (cut along jittered planes so the
 * pieces tile the block exactly, physics/fracture.ts), and floor tiles that crumble a moment
 * after you step on them and grow back later. Chunks are dynamic bodies that fly, tumble and
 * settle, then dissolve away (the toon material's pixel dissolve) and leave the world.
 *
 *   const breaks = new Breakables(ctx);
 *   const wall = breaks.add({ at: [0, 1.5, 0], size: [3, 3, 0.4], color: 'sand', cuts: [4, 4, 1] });
 *   breaks.break(wall, punchPoint, 6);                 // a punch, a blast
 *   const tile = breaks.crumble({ at: [2, -0.25, 0], size: [1, 0.5, 1], color: 'mist' });
 *   // per frame: breaks.update(dt, hero.groundCollider)
 */
import { BoxGeometry, type Material, Mesh, Vector3 } from 'three/webgpu';
import type { GameContext } from '../Engine';
import { PALETTE, type PaletteColor } from '../palette';
import { setLookLayer } from '../render/lookLayer';
import { type DissolvableMaterial, toonMaterial } from '../render/toon';
import { fractureBox } from './fracture';
import { RAPIER } from './Physics';

type Vec3 = readonly [number, number, number];
type Ctx = Pick<GameContext, 'physics' | 'scene' | 'particles'>;

export interface BreakableOptions {
  /** Centre and full size of the block. */
  at: Vec3;
  size: Vec3;
  /** Turn about Y (radians). */
  rotationY?: number;
  color: PaletteColor;
  /** Pieces along x, y, z (default [3, 3, 1]). */
  cuts?: Vec3;
  jitter?: number;
  seed?: number;
  /** Seconds the pieces lie around before they dissolve (default 4). */
  linger?: number;
  /** Chunk density (default 1.5). */
  density?: number;
  tags?: string[];
}

export interface Breakable {
  readonly o: BreakableOptions;
  readonly mesh: Mesh;
  collider: RAPIER.Collider | null;
  broken: boolean;
}

export interface CrumbleOptions {
  at: Vec3;
  size: Vec3;
  color: PaletteColor;
  /** Seconds standing on it before it drops (it shakes meanwhile). Default 0.6. */
  delay?: number;
  /** Seconds until it grows back (0: never). Default 5. */
  regrow?: number;
}

export interface Crumble {
  readonly o: CrumbleOptions;
  readonly mesh: Mesh;
  collider: RAPIER.Collider | null;
  /** 'solid' → 'shaking' → 'falling' → (regrow) 'solid'. */
  state: 'solid' | 'shaking' | 'falling';
  t: number;
}

interface Debris {
  bodies: RAPIER.RigidBody[];
  meshes: Mesh[];
  material: DissolvableMaterial;
  t: number;
  linger: number;
}

export class Breakables {
  readonly blocks: Breakable[] = [];
  readonly tiles: Crumble[] = [];
  private debris: Debris[] = [];
  private falling: { tile: Crumble; body: RAPIER.RigidBody; t: number }[] = [];
  /** Chunks alive now (tests, HUDs). */
  get chunks(): number {
    return this.debris.reduce((n, d) => n + d.bodies.length, 0);
  }

  constructor(private readonly ctx: Ctx) {}

  add(o: BreakableOptions): Breakable {
    const top = toonMaterial(PALETTE[o.color]);
    const mesh = new Mesh(new BoxGeometry(...o.size), top);
    mesh.position.set(...o.at);
    mesh.rotation.y = o.rotationY ?? 0;
    mesh.castShadow = mesh.receiveShadow = true;
    const b: Breakable = { o, mesh, collider: null, broken: true };
    this.restore(b);
    this.blocks.push(b);
    return b;
  }

  /** Put a broken block back, whole (its old pieces dissolve as usual). */
  restore(b: Breakable): void {
    if (!b.broken) return;
    const o = b.o;
    this.ctx.scene.add(b.mesh);
    const body = this.ctx.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(...o.at)
        .setRotation({ x: 0, y: Math.sin((o.rotationY ?? 0) / 2), z: 0, w: Math.cos((o.rotationY ?? 0) / 2) }),
    );
    b.collider = this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2), body);
    if (o.tags?.length) this.ctx.physics.tag(b.collider, ...o.tags);
    b.broken = false;
  }

  /** The block whose collider this is (a punch's ray hit, a projectile). */
  byCollider(handle: number): Breakable | undefined {
    return this.blocks.find((b) => !b.broken && b.collider?.handle === handle);
  }

  /** The unbroken block nearest to `at` within `reach` of its surface (a punch, a blast radius). */
  near(at: Vec3, reach: number): Breakable | undefined {
    let best: Breakable | undefined;
    let bestD = reach;
    for (const b of this.blocks) {
      if (b.broken) continue;
      // distance to the box (in its own turned space)
      const a = -(b.o.rotationY ?? 0);
      const dx = at[0] - b.o.at[0];
      const dz = at[2] - b.o.at[2];
      const lx = dx * Math.cos(a) + dz * Math.sin(a);
      const lz = -dx * Math.sin(a) + dz * Math.cos(a);
      const ex = Math.max(0, Math.abs(lx) - b.o.size[0] / 2);
      const ey = Math.max(0, Math.abs(at[1] - b.o.at[1]) - b.o.size[1] / 2);
      const ez = Math.max(0, Math.abs(lz) - b.o.size[2] / 2);
      const d = Math.hypot(ex, ey, ez);
      if (d <= bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  /** Shatter a block: chunks fly away from `at` (default its middle) at up to `speed` m/s. */
  break(b: Breakable, at?: Vec3, speed = 5): void {
    if (b.broken) return;
    b.broken = true;
    const { physics, scene, particles } = this.ctx;
    if (b.collider) physics.remove(b.collider);
    b.collider = null;
    b.mesh.removeFromParent();
    const o = b.o;
    const chunks = fractureBox(o.size, { cuts: o.cuts ?? [3, 3, 1], jitter: o.jitter ?? 0.3, seed: o.seed ?? Math.round(o.at[0] * 31 + o.at[2] * 17) });
    const material = toonMaterial(PALETTE[o.color], { dissolve: true }).clone() as DissolvableMaterial;
    material.userData.shared = false;
    material.dissolve = 0;
    const yaw = o.rotationY ?? 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const from = at ?? o.at;
    const debris: Debris = { bodies: [], meshes: [], material, t: 0, linger: o.linger ?? 4 };
    for (const ch of chunks) {
      const [lx, ly, lz] = ch.center;
      const wx = o.at[0] + lx * c + lz * s;
      const wy = o.at[1] + ly;
      const wz = o.at[2] - lx * s + lz * c;
      const dx = wx - from[0];
      const dy = wy - from[1];
      const dz = wz - from[2];
      const d = Math.hypot(dx, dy, dz) || 1;
      const k = speed * Math.max(0.25, 1 - d / Math.max(...o.size));
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(wx, wy, wz)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setLinvel((dx / d) * k, (dy / d) * k + k * 0.4, (dz / d) * k)
          .setAngvel({ x: dz * 2, y: 0, z: -dx * 2 })
          .setLinearDamping(0.2),
      );
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(ch.size[0] / 2, ch.size[1] / 2, ch.size[2] / 2).setDensity(o.density ?? 1.5).setFriction(0.8), body);
      const mesh = new Mesh(new BoxGeometry(...ch.size), material);
      mesh.castShadow = mesh.receiveShadow = true;
      setLookLayer(mesh, 'actors');
      scene.add(mesh);
      physics.bind(body, mesh);
      debris.bodies.push(body);
      debris.meshes.push(mesh);
    }
    this.debris.push(debris);
    particles.burst('impact', from);
    particles.burst('smoke', o.at, { scale: 1.5 });
  }

  /** A floor tile that drops shortly after you step on it, and grows back. */
  crumble(o: CrumbleOptions): Crumble {
    const mesh = new Mesh(new BoxGeometry(...o.size), toonMaterial(PALETTE[o.color]));
    mesh.position.set(...o.at);
    mesh.castShadow = mesh.receiveShadow = true;
    this.ctx.scene.add(mesh);
    const tile: Crumble = { o, mesh, collider: null, state: 'solid', t: 0 };
    this.solidify(tile);
    this.tiles.push(tile);
    return tile;
  }

  /**
   * Per frame: tiles under `standing` (a collider handle: the character's `groundCollider`)
   * start to shake, shaking tiles drop, dropped ones grow back; old chunks dissolve away.
   */
  update(dt: number, standing = -1): void {
    for (const tile of this.tiles) {
      if (tile.state === 'solid' && tile.collider && tile.collider.handle === standing) {
        tile.state = 'shaking';
        tile.t = 0;
      }
      if (tile.state === 'shaking') {
        tile.t += dt;
        const k = Math.min(1, tile.t / (tile.o.delay ?? 0.6));
        tile.mesh.position.set(tile.o.at[0] + Math.sin(tile.t * 60) * 0.03 * k, tile.o.at[1], tile.o.at[2] + Math.cos(tile.t * 47) * 0.03 * k);
        if (tile.t >= (tile.o.delay ?? 0.6)) this.drop(tile);
      }
    }
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i]!;
      f.t += dt;
      const regrow = f.tile.o.regrow ?? 5;
      if (f.t > 2.5 && f.body) {
        // gone below: stop simulating it
        this.ctx.physics.remove(f.body);
        f.body = null as unknown as RAPIER.RigidBody;
        f.tile.mesh.visible = false;
      }
      if (regrow > 0 && f.t >= regrow) {
        if (f.body) this.ctx.physics.remove(f.body);
        this.solidify(f.tile);
        this.falling.splice(i, 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.t += dt;
      if (d.t > d.linger) d.material.dissolve = Math.min(1, (d.t - d.linger) / 0.6);
      if (d.t > d.linger + 0.65) {
        for (const b of d.bodies) this.ctx.physics.remove(b);
        for (const m of d.meshes) {
          m.removeFromParent();
          m.geometry.dispose();
        }
        (d.material as Material).dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  private solidify(tile: Crumble): void {
    const o = tile.o;
    tile.mesh.position.set(...o.at);
    tile.mesh.rotation.set(0, 0, 0);
    tile.mesh.visible = true;
    if (!tile.mesh.parent) this.ctx.scene.add(tile.mesh);
    this.ctx.physics.unbind(tile.mesh);
    const body = this.ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...o.at));
    tile.collider = this.ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2), body);
    tile.state = 'solid';
    tile.t = 0;
  }

  private drop(tile: Crumble): void {
    const { physics, particles } = this.ctx;
    if (tile.collider) physics.remove(tile.collider);
    tile.collider = null;
    tile.state = 'falling';
    const o = tile.o;
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...o.at).setAngvel({ x: 1.5, y: 0, z: -1 }));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(o.size[0] / 2 - 0.02, o.size[1] / 2 - 0.02, o.size[2] / 2 - 0.02).setDensity(1).setCollisionGroups(0x0004_fffb), body);
    physics.bind(body, tile.mesh);
    this.falling.push({ tile, body, t: 0 });
    particles.burst('dust', new Vector3(o.at[0], o.at[1] + o.size[1] / 2, o.at[2]), { scale: 1.2 });
  }
}
