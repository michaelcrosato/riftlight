import { type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import { projectileMesh, ringDecal } from '../visuals';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** Height projectiles fly at. */
export const FLY_HEIGHT = 1.05;
/** How far a chain or homing projectile looks for its next target. */
export const SEEK_RANGE = 8;
/** Fork angle (each side). */
export const FORK_ANGLE = 0.5;

export interface Shot {
  pos: Vector3;
  prev: Vector3;
  vel: Vector3;
  left: number;
  pierce: number;
  chain: number;
  fork: number;
  /** Ids this shot already hit (a chain never returns to the same target). */
  hit: Set<number>;
  mesh: Object3D | null;
  alive: boolean;
}

/** Spread `count` directions evenly across `spreadDeg`, centred on `dir`. */
export function fan(dir: Vector3, count: number, spreadDeg: number): Vector3[] {
  const base = Math.atan2(dir.x, dir.z);
  const spread = (spreadDeg * Math.PI) / 180;
  return Array.from({ length: count }, (_, i) => {
    const a = count === 1 ? base : base - spread / 2 + (spread * i) / (count - 1);
    return new Vector3(Math.sin(a), 0, Math.cos(a));
  });
}

/** Distance from point p to segment a→b on the ground plane. */
export function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

class Projectiles extends EffectBase {
  readonly kind = 'projectile';
  readonly shots: Shot[] = [];
  private readonly look = this.c.skill.def.look;
  private readonly speed: number;
  private readonly homing: number;
  private bursts: { ring: Mesh; t: number; r: number }[] = [];
  private trailTick = 0;
  private readonly tmp = new Vector3();
  private readonly near: Actor[] = [];

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'projectile') throw new Error('projectile delivery on a non-projectile skill');
    this.speed = d.speed;
    this.homing = d.homing ?? 0;
    const p = c.caster.position;
    const origin = new Vector3(p.x + c.dir.x * 0.5, p.y + FLY_HEIGHT, p.z + c.dir.z * 0.5);
    for (const dir of fan(c.dir, d.count, d.count > 1 ? d.spread : 0)) {
      this.spawn(origin, dir, d.range / d.speed, d.pierce, d.chain, d.fork ?? 0, new Set());
    }
    if (this.look.light) {
      // one light for the volley, following its first live projectile
      const l = this.look.light;
      const first = () => this.shots.find((s) => s.alive)?.pos ?? origin;
      c.combat.light(l.color, l.intensity, l.radius, first, 0, () => this.shots.some((s) => s.alive));
    }
    c.combat.play(this.look.sound?.travel ?? (c.skill.tags.includes('attack') ? undefined : 'projectile'));
  }

  private spawn(at: Vector3, dir: Vector3, life: number, pierce: number, chain: number, fork: number, hit: Set<number>): Shot {
    const mesh = this.show(projectileMesh(this.look));
    const s: Shot = { pos: at.clone(), prev: at.clone(), vel: dir.clone().multiplyScalar(this.speed), left: life, pierce, chain, fork, hit, mesh, alive: true };
    mesh.position.copy(s.pos);
    this.shots.push(s);
    return s;
  }

  step(dt: number): boolean {
    this.age += dt;
    const c = this.c;
    for (const s of [...this.shots]) {
      if (!s.alive) continue;
      if (this.homing > 0) this.steer(s, dt);
      s.prev.copy(s.pos);
      s.pos.addScaledVector(s.vel, dt);
      s.left -= dt;
      // walls first: the shot stops where the wall is
      const wall = c.combat.wall(s.prev, s.pos);
      if (wall !== null) {
        s.pos.lerpVectors(s.prev, s.pos, wall);
        this.impact(s, null);
        continue;
      }
      // enemies along this step's segment
      const mid = this.tmp.addVectors(s.prev, s.pos).multiplyScalar(0.5);
      const reach = s.prev.distanceTo(s.pos) / 2 + 0.8;
      let target: Actor | null = null;
      for (const a of c.combat.actors.query(mid, reach, this.near)) {
        if (!a.alive || !c.caster.hostileTo(a) || s.hit.has(a.id)) continue;
        if (segmentDistance(a.position, s.prev, s.pos) <= a.radius + 0.2) {
          target = a;
          break;
        }
      }
      if (target) this.onHit(s, target);
      else if (s.left <= 0) this.impact(s, null, true);
    }
    for (const b of this.bursts) b.t += dt;
    this.bursts = this.bursts.filter((b) => {
      if (b.t < 0.25) return true;
      b.ring.removeFromParent();
      return false;
    });
    return this.shots.some((s) => s.alive) || this.bursts.length > 0;
  }

  private steer(s: Shot, dt: number): void {
    const c = this.c;
    const t = c.combat.actors.nearest(s.pos, SEEK_RANGE, (a) => a.alive && c.caster.hostileTo(a) && !s.hit.has(a.id));
    if (!t) return;
    const want = this.tmp.set(t.position.x - s.pos.x, 0, t.position.z - s.pos.z).normalize().multiplyScalar(this.speed);
    const k = Math.min(1, this.homing * dt);
    s.vel.lerp(want, k).setY(0).setLength(this.speed);
  }

  private onHit(s: Shot, target: Actor): void {
    const c = this.c;
    s.hit.add(target.id);
    c.combat.hit(c.caster, target, c.skill, { from: s.prev });
    const explode = c.skill.def.explode;
    if (explode) this.explode(s, explode * Math.sqrt(c.skill.area), target);
    if (s.fork > 0) {
      // split in two, angled away, leaving the original
      const base = Math.atan2(s.vel.x, s.vel.z);
      for (const sign of [-1, 1]) {
        const a = base + sign * FORK_ANGLE;
        const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
        this.spawn(s.pos, dir, Math.max(0.3, s.left), s.pierce, s.chain, s.fork - 1, new Set(s.hit));
      }
      this.kill(s);
      return;
    }
    if (s.chain > 0) {
      const next = c.combat.actors.nearest(target.position, SEEK_RANGE, (a) => a.alive && c.caster.hostileTo(a) && !s.hit.has(a.id));
      if (next) {
        s.chain--;
        s.vel.set(next.position.x - s.pos.x, 0, next.position.z - s.pos.z).setLength(this.speed);
        s.left = Math.max(s.left, SEEK_RANGE / this.speed);
        return;
      }
    }
    if (s.pierce > 0) {
      s.pierce--;
      return;
    }
    this.impact(s, target);
  }

  /** The shot ends: on a wall, a target it can't pass, or at the end of its range. */
  private impact(s: Shot, target: Actor | null, fizzle = false): void {
    const c = this.c;
    const explode = c.skill.def.explode;
    if (!fizzle && !target && explode) this.explode(s, explode * Math.sqrt(c.skill.area), null);
    else c.combat.burst(fizzle ? 'smoke' : (this.look.burst ?? 'spark'), s.pos, { count: fizzle ? 3 : 6 });
    this.kill(s);
  }

  private explode(s: Shot, radius: number, direct: Actor | null): void {
    const c = this.c;
    const ground = new Vector3(s.pos.x, c.caster.position.y, s.pos.z);
    c.combat.area(c.caster, c.skill, ground, radius, { exclude: direct ? new Set([direct.id]) : undefined, from: ground, quiet: true });
    c.combat.burst(this.look.burst ?? 'fire', s.pos, { scale: Math.max(1, radius / 1.5) });
    c.combat.play(this.look.sound?.impact ?? 'explode', { pitch: c.combat.rng.range(-1, 1) });
    if (this.look.shake) c.combat.shake.add(this.look.shake);
    if (this.look.light) {
      const p = s.pos.clone();
      c.combat.light(this.look.light.color, this.look.light.intensity * 1.4, this.look.light.radius * 1.3, () => p, 0.3);
    }
    const ring = ringDecal(this.look.glow?.[0] ?? this.look.color, 0.6);
    ring.position.set(ground.x, ground.y + 0.05, ground.z);
    ring.scale.setScalar(radius * 0.3);
    c.combat.root.add(ring);
    this.bursts.push({ ring, t: 0, r: radius });
  }

  private kill(s: Shot): void {
    s.alive = false;
    if (s.mesh) s.mesh.visible = false;
  }

  render(dt: number): void {
    this.trailTick += dt;
    const trail = this.trailTick >= 1 / 30 ? this.look.trail : undefined;
    if (trail) this.trailTick = 0;
    for (const s of this.shots) {
      if (!s.alive || !s.mesh) continue;
      s.mesh.position.copy(s.pos);
      s.mesh.lookAt(s.pos.x + s.vel.x, s.pos.y, s.pos.z + s.vel.z);
      if (this.look.shape === 'orb' || !this.look.shape) s.mesh.rotateZ(this.age * 12);
      if (trail) this.c.combat.burst(trail, s.pos);
    }
    for (const b of this.bursts) {
      const k = Math.min(1, b.t / 0.25);
      b.ring.scale.setScalar(b.r * (0.3 + 0.75 * k));
    }
  }

  override dispose(): void {
    super.dispose();
    for (const b of this.bursts) b.ring.removeFromParent();
    this.bursts = [];
  }
}

/** Projectiles: count, spread, pierce, chain, fork and homing, stopped by walls (`combat.wall`). */
export const projectile = (c: CastContext): CombatEffect => new Projectiles(c);
