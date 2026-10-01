import { type Mesh, Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import { beamMesh } from '../visuals';
import { payChannel } from './nova';
import { FLY_HEIGHT, segmentDistance } from './projectile';
import { EffectBase, type CastContext, type CombatEffect } from './types';

class Beam extends EffectBase {
  readonly kind = 'beam';
  private readonly outer: Mesh;
  private readonly inner: Mesh;
  readonly from = new Vector3();
  readonly to = new Vector3();
  private readonly dir = new Vector3();
  private ticks = 0;
  private readonly length: number;
  private readonly width: number;
  private readonly period: number;
  private readonly look = this.c.skill.def.look;
  private readonly near: Actor[] = [];

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'beam') throw new Error('beam delivery on a non-beam skill');
    this.length = d.length;
    this.width = d.width;
    this.period = Math.max(0.05, d.tick / c.skill.speed);
    this.dir.copy(c.dir);
    this.outer = this.show(beamMesh(this.look.color));
    this.inner = this.show(beamMesh(this.look.glow?.[0] ?? 'white'));
    this.aim();
    if (this.look.light) {
      const l = this.look.light;
      c.combat.light(l.color, l.intensity, l.radius, () => this.to, 0, () => this.visuals.length > 0);
    }
    this.pulse();
  }

  /** Recompute the segment from the caster's hand toward the (live) aim, stopped by walls. */
  private aim(): void {
    const c = this.c;
    const p = c.caster.position;
    const live = c.opts.aimNow?.();
    if (live) {
      const d = new Vector3(live.x - p.x, 0, live.z - p.z);
      if (d.lengthSq() > 0.04) this.dir.copy(d.normalize());
    }
    this.from.set(p.x + this.dir.x * 0.5, p.y + FLY_HEIGHT, p.z + this.dir.z * 0.5);
    this.to.copy(this.from).addScaledVector(this.dir, this.length);
    const wall = c.combat.wall(this.from, this.to);
    if (wall !== null) this.to.lerpVectors(this.from, this.to, wall);
  }

  private pulse(): void {
    const c = this.c;
    const mid = new Vector3().addVectors(this.from, this.to).multiplyScalar(0.5);
    const reach = this.from.distanceTo(this.to) / 2 + this.width;
    const ground = (v: Vector3) => new Vector3(v.x, c.caster.position.y, v.z);
    const a0 = ground(this.from);
    const a1 = ground(this.to);
    for (const a of c.combat.actors.query(ground(mid), reach, this.near, (x) => x.alive && c.caster.hostileTo(x))) {
      if (segmentDistance(a.position, a0, a1) <= this.width / 2 + a.radius) c.combat.hit(c.caster, a, c.skill, { scale: c.skill.def.tickDamage ?? 1, from: a0, quiet: this.ticks % 3 !== 0 });
    }
    if (this.look.burst) c.combat.burst(this.look.burst, this.to, { count: 3 });
    this.ticks++;
  }

  step(dt: number): boolean {
    this.age += dt;
    if (this.c.skill.channel) {
      if (!payChannel(this.c, dt)) return false;
    } else if (this.age > 0.3) return false;
    this.aim();
    this.c.caster.facing = Math.atan2(this.dir.x, this.dir.z);
    if (this.age >= this.ticks * this.period) this.pulse();
    return true;
  }

  render(): void {
    const len = this.from.distanceTo(this.to);
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    const jitter = 1 + 0.25 * Math.sin(this.age * 50);
    for (const [m, w] of [[this.outer, this.width * jitter], [this.inner, this.width * 0.4]] as const) {
      m.position.copy(this.from).setY(this.from.y - w / 2);
      m.rotation.set(0, yaw, 0);
      m.scale.set(w, w, len);
    }
    if (this.look.trail && Math.floor(this.age * 60) % 3 === 0) {
      this.c.combat.burst(this.look.trail, new Vector3().lerpVectors(this.from, this.to, (this.age * 2.7) % 1));
    }
  }
}

/** A channelled line from the caster toward the cursor that hits everything along it every tick. */
export const beam = (c: CastContext): CombatEffect => new Beam(c);
