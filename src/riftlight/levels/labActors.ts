import { CapsuleGeometry, type Material, Mesh, type MeshToonNodeMaterial, type Object3D, Vector3 } from 'three/webgpu';
import { toonMaterial } from '../../engine/render/toon';
import { StatSheet } from '../core/mods';
import type { ActorLike, Faction, Hit, HitResult } from '../core/types';
import type { Rank } from '../core/scaling';
import { FLOOR, type Layout, WALL } from './layout/grid';

/**
 * Placeholder actors for the level lab: capsules that implement `ActorLike` with simple
 * grid collision. The real `Actor` (combat/actors agent) replaces them at integration;
 * nothing in the level system depends on this file.
 */
const capsule = new CapsuleGeometry(0.34, 0.9, 3, 8).translate(0, 0.79, 0);
capsule.userData.shared = true;

const RANK_COLOR: Record<Rank, number> = { normal: 0x94b0c2, magic: 0x41a6f6, rare: 0xffcd75, boss: 0xb13e53 };
const flash = () => toonMaterial(0xf4f4f4);

export class LabActor implements ActorLike {
  private static next = 1;
  readonly id = LabActor.next++;
  readonly stats: StatSheet;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly mesh: Mesh;
  life: number;
  mana = 100;
  level = 1;
  /** Hit flash timer (seconds). */
  private flashT = 0;
  private readonly material: Material;
  /** Hero only: ignore damage (e2e walks). */
  god = false;
  attackTimer = 0;
  awake = false;

  constructor(
    readonly faction: Faction,
    readonly rank: Rank,
    at: Vector3,
    readonly radius = 0.4,
    life = 100,
  ) {
    // Multiplier stats start at 1 so `inc`/`more` mods (shrines, mechanics) scale them.
    this.stats = new StatSheet({ life, 'move.speed': 1, 'attack.speed': 1, damage: 1, 'damage.taken': 1, 'xp.gain': 1, 'light.radius': 1, area: 1 });
    this.life = life;
    this.position.copy(at);
    this.material = toonMaterial(faction === 'hero' ? 0xef7d57 : RANK_COLOR[rank]);
    this.mesh = new Mesh(capsule, this.material);
    this.mesh.castShadow = true;
    this.mesh.name = `actor:${faction}:${rank}`;
    if (rank === 'boss') this.mesh.scale.setScalar(2);
    else if (rank === 'rare') this.mesh.scale.setScalar(1.25);
    this.mesh.position.copy(at);
  }

  get alive(): boolean {
    return this.life > 0;
  }

  takeHit(hit: Hit): HitResult {
    if (!this.alive) return { total: 0, byType: {}, crit: false, killed: false, ailments: [] };
    let total = 0;
    for (const v of Object.values(hit.damage)) total += v ?? 0;
    total *= this.stats.get('damage.taken', hit.tags);
    if (this.god) total = 0;
    this.life = Math.max(0, this.life - total);
    this.flashT = 0.1;
    if (hit.knockback && hit.from) {
      const away = this.position.clone().sub(hit.from).setY(0);
      if (away.lengthSq() > 1e-6) this.velocity.addScaledVector(away.normalize(), hit.knockback);
    }
    const ailments = Object.entries(hit.ailments ?? {})
      .filter(([, p]) => (p ?? 0) >= 1)
      .map(([a]) => a) as HitResult['ailments'];
    return { total, byType: hit.damage, crit: hit.crit, killed: this.life <= 0, ailments };
  }

  push(impulse: Vector3): void {
    this.velocity.x += impulse.x;
    this.velocity.z += impulse.z;
  }

  /**
   * One fixed step: walk `wish` (unit or zero) at `speed` m/s, plus pushes (velocity) that
   * decay. Walking stops at walls and the edge of the void; pushes stop only at walls (so
   * wind and wells can throw you into pits).
   */
  step(layout: Layout, wish: Vector3, speed: number, dt: number): void {
    const walkOk = (c: number) => c === FLOOR;
    const pushOk = (c: number) => c !== WALL;
    this.move(layout, wish.x * speed * dt, wish.z * speed * dt, walkOk);
    this.move(layout, this.velocity.x * dt, this.velocity.z * dt, pushOk);
    this.velocity.multiplyScalar(Math.exp(-5 * dt));
  }

  private move(layout: Layout, dx: number, dz: number, ok: (c: number) => boolean): void {
    const r = this.radius;
    const blocked = (x: number, z: number) => {
      for (const [ox, oz] of [
        [-r, -r],
        [r, -r],
        [-r, r],
        [r, r],
      ] as const)
        if (!ok(layout.cell(Math.floor(x + ox), Math.floor(z + oz)))) return true;
      return false;
    };
    // The actor's own cell may already be "bad" (pushed over the edge): never trap it.
    const free = (x: number, z: number) => !blocked(x, z) || blocked(this.position.x, this.position.z);
    if (dx && free(this.position.x + dx, this.position.z)) this.position.x += dx;
    if (dz && free(this.position.x, this.position.z + dz)) this.position.z += dz;
  }

  /** Visual follow (and the hit flash). */
  sync(dt: number): void {
    this.mesh.position.copy(this.position);
    this.flashT -= dt;
    this.mesh.material = this.flashT > 0 ? flash() : this.material;
    if (!this.alive) this.mesh.visible = false;
  }

  get object(): Object3D {
    return this.mesh;
  }

  get toon(): MeshToonNodeMaterial {
    return this.material as MeshToonNodeMaterial;
  }
}
