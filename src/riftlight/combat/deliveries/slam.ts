import { type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { boxMesh, discDecal, projectileMesh, ringDecal } from '../visuals';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** Gravity used for leap arcs (matches the movers). */
export const LEAP_GRAVITY = 30;
/** Max distance an aimed area can land from the caster. */
export const AIM_RANGE = 12;

/** Where an area skill lands: at the caster, ahead of it, or at the (clamped) aim point. */
export function areaCenter(c: CastContext, radius: number): Vector3 {
  const p = c.caster.position;
  const target = c.skill.def.target ?? 'self';
  if (target === 'ahead') return new Vector3(p.x + c.dir.x * radius * 0.75, p.y, p.z + c.dir.z * radius * 0.75);
  if (target === 'aim') {
    const d = Math.min(AIM_RANGE, Math.hypot(c.aim.x - p.x, c.aim.z - p.z));
    const end = new Vector3(p.x + c.dir.x * d, p.y, p.z + c.dir.z * d);
    const wall = c.combat.wall(new Vector3(p.x, p.y + 0.5, p.z), new Vector3(end.x, p.y + 0.5, end.z));
    if (wall !== null) end.set(p.x + c.dir.x * d * wall * 0.95, p.y, p.z + c.dir.z * d * wall * 0.95);
    return end;
  }
  return p.clone();
}

class Slam extends EffectBase {
  readonly kind = 'slam';
  private center = new Vector3();
  private readonly radius: number;
  private readonly delay: number;
  private phase: 'leap' | 'telegraph' | 'impact' = 'telegraph';
  private t = 0;
  private fill: Mesh | null = null;
  private edge: Mesh | null = null;
  private burstRing: Mesh | null = null;
  private faller: Object3D | null = null;
  private readonly look = this.c.skill.def.look;

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'slam') throw new Error('slam delivery on a non-slam skill');
    this.radius = d.radius;
    this.delay = d.delay;
    const leap = c.skill.def.leap;
    if (leap) {
      // jump to the aim point (clamped), slam where we land
      const p = c.caster.position;
      // land in front of an enemy standing at the aim point, not on top of it
      const foe = c.combat.actors.nearest(c.aim, 1.2, (x) => x.alive && c.caster.hostileTo(x));
      const short = foe ? foe.radius + c.caster.radius + 0.15 : 0;
      const dist = Math.max(0, Math.min(leap.range, Math.hypot(c.aim.x - p.x, c.aim.z - p.z) - short));
      const time = c.opts.airTime ?? c.skill.castTime * 0.5;
      this.center.set(p.x + c.dir.x * dist, p.y, p.z + c.dir.z * dist);
      this.phase = 'leap';
      c.caster.launch = (LEAP_GRAVITY * time) / 2;
      c.caster.startMotion({
        vx: (c.dir.x * dist) / time,
        vz: (c.dir.z * dist) / time,
        left: time,
        onEnd: (a, interrupted) => {
          if (this.phase !== 'leap') return;
          this.center.copy(a.position);
          this.phase = interrupted ? 'impact' : 'telegraph';
          this.t = interrupted ? 99 : 0;
        },
      });
    } else this.center = areaCenter(c, this.radius);
    if (this.delay > 0) {
      // telegraph: a filling disc inside a ring, at the target, during the delay
      this.edge = this.show(ringDecal(this.look.color, 0.9));
      this.fill = this.show(discDecal(this.look.glow?.at(-1) ?? this.look.color));
      this.edge.scale.setScalar(this.radius);
      this.place();
      if (this.look.shape === 'rock' || this.look.shape === 'bolt') {
        this.faller = this.show(this.look.shape === 'rock' ? projectileMesh(this.look) : boxMesh(this.look.glow?.[0] ?? 'white'));
        if (this.look.shape === 'bolt') this.faller.scale.set(0.35, 12, 0.35);
        this.faller.visible = false;
      }
    }
  }

  private place(): void {
    const y = this.center.y + 0.03;
    this.edge?.position.set(this.center.x, y, this.center.z);
    this.fill?.position.set(this.center.x, y - 0.005, this.center.z);
  }

  step(dt: number): boolean {
    this.age += dt;
    if (this.phase === 'leap') return true;
    this.t += dt;
    if (this.phase === 'telegraph') {
      if (this.t < this.delay) {
        // rain of arrows: arrows start falling in the last part of the delay
        if (this.look.burst === 'arrows' && this.t > this.delay - 0.3 && Math.round(this.t * 60) % 4 === 0) {
          this.c.combat.burst('arrows', new Vector3(this.center.x, this.center.y + 5, this.center.z), { count: 6 });
        }
        return true;
      }
      this.impact();
      this.phase = 'impact';
      this.t = 0;
      return true;
    }
    if (this.t > 1 && this.c.skill.def.leap && !this.burstRing) this.impact(); // interrupted leap still lands
    return this.t < 0.3;
  }

  private impact(): void {
    const c = this.c;
    if (!c.caster.alive) return;
    const hit = c.combat.area(c.caster, c.skill, this.center, this.radius, { from: this.center });
    for (const a of hit) c.combat.applyEnemyBuffs(a, c.skill);
    c.combat.play(this.look.sound?.impact, { pitch: c.combat.rng.range(-1, 1) });
    const at = new Vector3(this.center.x, this.center.y + 0.2, this.center.z);
    c.combat.burst(this.look.burst ?? 'impact', at, { scale: Math.max(1, this.radius / 2.5) });
    c.combat.burst('dust', at, { scale: Math.max(1, this.radius / 2) });
    if (this.look.shake) c.combat.shake.add(this.look.shake);
    if (this.look.light) {
      const p = this.center.clone();
      c.combat.light(this.look.light.color, this.look.light.intensity, this.look.light.radius, () => p, 0.35);
    }
    if (this.fill) this.fill.visible = false;
    if (this.edge) this.edge.visible = false;
    if (this.faller) this.faller.visible = false;
    this.burstRing = this.show(ringDecal(this.look.glow?.[0] ?? this.look.color, 0.7));
    this.burstRing.position.set(this.center.x, this.center.y + 0.05, this.center.z);
    this.burstRing.scale.setScalar(this.radius * 0.3);
  }

  render(): void {
    if (this.phase === 'telegraph' && this.fill) {
      const k = Math.min(1, this.t / Math.max(0.01, this.delay));
      this.fill.scale.setScalar(Math.max(0.01, this.radius * k));
      if (this.edge) this.edge.visible = Math.floor(this.age * 12) % 2 === 0 || k > 0.7;
      if (this.faller) {
        // falls during the last 40% of the delay
        const f = Math.max(0, (k - 0.6) / 0.4);
        this.faller.visible = f > 0;
        const h = this.look.shape === 'bolt' ? 6 : 14 * (1 - f) + 0.3;
        this.faller.position.set(this.center.x - (1 - f) * 4, this.center.y + h, this.center.z - (1 - f) * 2);
        this.faller.rotation.set(this.age * 5, this.age * 3, 0);
      }
    }
    if (this.burstRing) {
      const k = Math.min(1, this.t / 0.25);
      this.burstRing.scale.setScalar(this.radius * (0.3 + 0.75 * k));
      this.burstRing.visible = k < 1;
    }
    if (this.phase === 'leap') this.place();
  }
}

/** Delayed area hit with a telegraph decal (meteor, storm call, rain of arrows); leaps first for leap slam. */
export const slam = (c: CastContext): CombatEffect => new Slam(c);
