import { type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import { boxMesh, ringDecal, trapMesh } from '../visuals';
import { segmentDistance } from './projectile';
import { areaCenter } from './slam';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** Seconds a thrown trap flies before it lands. */
export const THROW_TIME = 0.25;
/** An armed trap goes off when an enemy comes within this share of its radius. */
export const TRIGGER_SHARE = 0.55;

class Trap extends EffectBase {
  readonly kind = 'trap';
  readonly at: Vector3;
  private readonly from: Vector3;
  private readonly radius: number;
  private readonly arm: number;
  private readonly duration: number;
  private readonly model: Object3D;
  private ring: Mesh | null = null;
  private state: 'flying' | 'arming' | 'armed' | 'boom' = 'flying';
  private t = 0;
  private readonly near: Actor[] = [];
  private readonly look = this.c.skill.def.look;

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'trap') throw new Error('trap delivery on a non-trap skill');
    this.radius = d.radius;
    this.arm = d.arm;
    this.duration = d.duration;
    this.at = areaCenter(c, this.radius);
    this.from = c.caster.position.clone().setY(c.caster.position.y + 1);
    this.model = this.show(trapMesh(this.look, c.skill.tags.includes('mine')));
    this.model.position.copy(this.from);
  }

  step(dt: number): boolean {
    this.age += dt;
    this.t += dt;
    if (this.state === 'flying' && this.t >= THROW_TIME) {
      this.state = 'arming';
      this.t = 0;
      this.ring = this.show(ringDecal(this.look.color, 0.92));
      this.ring.position.set(this.at.x, this.at.y + 0.03, this.at.z);
      this.ring.scale.setScalar(this.radius * TRIGGER_SHARE);
    } else if (this.state === 'arming' && this.t >= this.arm) {
      this.state = 'armed';
      this.t = 0;
    } else if (this.state === 'armed') {
      const c = this.c;
      if (this.t >= this.duration || !c.caster.alive) return false;
      const near = c.combat.actors.query(this.at, this.radius * TRIGGER_SHARE, this.near, (x) => x.alive && c.caster.hostileTo(x));
      if (near.length) this.boom();
    } else if (this.state === 'boom') return this.t < 0.3;
    return true;
  }

  private boom(): void {
    const c = this.c;
    this.state = 'boom';
    this.t = 0;
    c.combat.area(c.caster, c.skill, this.at, this.radius, { from: this.at });
    c.combat.burst(this.look.burst ?? 'fire', new Vector3(this.at.x, this.at.y + 0.3, this.at.z), { scale: this.radius / 2 });
    c.combat.play(this.look.sound?.impact ?? 'explode');
    if (this.look.shake) c.combat.shake.add(this.look.shake);
    if (this.look.light) {
      const p = this.at.clone();
      c.combat.light(this.look.light.color, this.look.light.intensity, this.look.light.radius, () => p, 0.35);
    }
    this.model.visible = false;
    if (this.ring) this.ring.scale.setScalar(this.radius * 0.3);
  }

  render(): void {
    if (this.state === 'flying') {
      const k = Math.min(1, this.t / THROW_TIME);
      this.model.position.lerpVectors(this.from, this.at, k);
      this.model.position.y += Math.sin(k * Math.PI) * 1.2 - k * 0.0;
      this.model.rotation.y = this.age * 14;
    } else if (this.state !== 'boom') {
      this.model.position.copy(this.at);
      // blink slowly while arming, fast once armed
      const rate = this.state === 'armed' ? 8 : 3;
      this.model.children[1]!.visible = Math.floor(this.age * rate) % 2 === 0;
    } else if (this.ring) {
      const k = Math.min(1, this.t / 0.25);
      this.ring.scale.setScalar(this.radius * (0.3 + 0.75 * k));
      this.ring.visible = k < 1;
    }
  }
}

/** A burning wall (or circle) on the ground that ticks damage on whoever stands in it. */
class Zone extends EffectBase {
  readonly kind = 'zone';
  private readonly a: Vector3;
  private readonly b: Vector3;
  private readonly center: Vector3;
  private readonly width = 0.9;
  private readonly duration: number;
  private readonly period: number;
  private ticks = 0;
  private readonly flames: Mesh[] = [];
  private readonly near: Actor[] = [];
  private readonly look = this.c.skill.def.look;

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'trap') throw new Error('zone delivery on a non-trap skill');
    this.duration = d.duration;
    this.period = Math.max(0.1, c.skill.def.zone!.tick);
    this.center = areaCenter(c, d.radius);
    const wall = c.skill.def.zone!.shape === 'wall';
    // a wall stands across the aim direction; a circle is a = b
    const side = new Vector3(c.dir.z, 0, -c.dir.x).multiplyScalar(wall ? d.radius : 0);
    this.a = this.center.clone().sub(side);
    this.b = this.center.clone().add(side);
    const n = wall ? Math.max(3, Math.round(d.radius * 2.5)) : 6;
    for (let i = 0; i < n; i++) {
      const f = this.show(boxMesh(i % 2 ? this.look.color : (this.look.glow?.[0] ?? 'sand')));
      const k = n === 1 ? 0.5 : i / (n - 1);
      const p = wall ? new Vector3().lerpVectors(this.a, this.b, k) : this.center.clone().add(new Vector3(Math.sin(k * 6.28) * d.radius * 0.7, 0, Math.cos(k * 6.28) * d.radius * 0.7));
      f.position.copy(p);
      f.userData.phase = i * 1.7;
      this.flames.push(f);
    }
    if (this.look.light) {
      const l = this.look.light;
      c.combat.light(l.color, l.intensity, l.radius, () => this.center, this.duration);
    }
  }

  step(dt: number): boolean {
    this.age += dt;
    const c = this.c;
    if (this.age >= this.duration) return false;
    if (this.age >= this.ticks * this.period) {
      this.ticks++;
      const reach = this.a.distanceTo(this.b) / 2 + this.width;
      for (const t of c.combat.actors.query(this.center, reach, this.near, (x) => x.alive && c.caster.hostileTo(x))) {
        if (segmentDistance(t.position, this.a, this.b) <= this.width / 2 + t.radius) {
          c.combat.hit(c.caster, t, c.skill, { scale: c.skill.def.tickDamage ?? 0.25, knockback: 0, quiet: this.ticks % 4 !== 0 });
        }
      }
    }
    return true;
  }

  render(): void {
    const fade = Math.min(1, (this.duration - this.age) / 0.4);
    for (const f of this.flames) {
      const ph = (f.userData.phase as number) + this.age * 9;
      const h = (0.55 + 0.35 * Math.abs(Math.sin(ph))) * fade;
      f.scale.set(0.32, Math.max(0.01, h), 0.32);
      f.position.y = this.center.y + h / 2;
    }
    if (Math.floor(this.age * 30) % 2 === 0 && this.flames.length) {
      const f = this.flames[Math.floor(this.age * 37) % this.flames.length]!;
      this.c.combat.burst(this.look.trail, f.position);
    }
  }
}

/** Traps and mines: thrown, armed, triggered by an enemy; `zone` skills leave a burning area instead. */
export const trap = (c: CastContext): CombatEffect => (c.skill.def.zone ? new Zone(c) : new Trap(c));
