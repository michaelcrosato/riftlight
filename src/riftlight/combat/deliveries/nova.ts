import { type Mesh, Vector3 } from 'three/webgpu';
import { arcDecal, ringDecal } from '../visuals';
import { areaCenter } from './slam';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** A channel pays its cost per second and stops when the key is released or mana runs out. */
export function payChannel(c: CastContext, dt: number): boolean {
  if (!c.caster.alive || c.caster.stopped) return false;
  if (c.opts.held && !c.opts.held()) return false;
  const cost = c.skill.cost * dt;
  if (c.caster.mana < cost) return false;
  c.caster.mana -= cost;
  return true;
}

class Nova extends EffectBase {
  readonly kind = 'nova';
  private readonly radius: number;
  private readonly ring: Mesh;
  private readonly spin: Mesh | null = null;
  private readonly center: Vector3;
  private readonly channel: boolean;
  private tick = 0;
  private readonly look = this.c.skill.def.look;

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'nova') throw new Error('nova delivery on a non-nova skill');
    this.radius = d.radius;
    this.channel = c.skill.channel;
    this.center = areaCenter(c, this.radius);
    this.ring = this.show(ringDecal(this.look.glow?.[0] ?? this.look.color, this.channel ? 0.9 : 0.75));
    if (this.channel) {
      this.spin = this.show(arcDecal(this.look.glow?.[0] ?? 'white', 160, this.radius * 0.5, this.radius * 0.95));
      this.pulse(); // first hit right away
    } else {
      this.pulse();
      c.combat.burst(this.look.burst, new Vector3(this.center.x, this.center.y + 0.3, this.center.z), { scale: Math.max(1, this.radius / 3) });
      if (this.look.light) {
        const p = this.center.clone();
        c.combat.light(this.look.light.color, this.look.light.intensity, this.look.light.radius, () => p, 0.4);
      }
      if (this.look.shake) c.combat.shake.add(this.look.shake);
    }
  }

  /** One wave: hits everyone inside once (channels: a fraction of a hit per tick). */
  private pulse(): void {
    const c = this.c;
    const center = this.channel ? c.caster.position : this.center;
    const hit = c.combat.area(c.caster, c.skill, center, this.radius, { scale: this.channel ? (c.skill.def.tickDamage ?? 0.5) : 1, quiet: this.channel && this.tick % 2 === 1 });
    for (const a of hit) c.combat.applyEnemyBuffs(a, c.skill);
    // debuffs reach enemies even when the nova deals no damage (war cry)
    if (!c.skill.damage) {
      for (const a of c.combat.actors.query(center, this.radius, [], (x) => x.alive && c.caster.hostileTo(x))) {
        c.combat.applyEnemyBuffs(a, c.skill);
        const kb = c.skill.effects.find((e) => e.kind === 'knockback');
        if (kb && kb.kind === 'knockback') a.push(new Vector3(a.position.x - center.x, 0, a.position.z - center.z).setLength(kb.force));
      }
    }
    this.tick++;
  }

  step(dt: number): boolean {
    this.age += dt;
    if (!this.channel) return this.age < 0.3;
    if (!payChannel(this.c, dt)) return false;
    const period = Math.max(0.12, 0.3 / this.c.skill.speed);
    if (this.age >= this.tick * period) {
      this.pulse();
      this.c.combat.play('swing', { pitch: 3, volume: 0.6 });
    }
    return true;
  }

  render(dt: number): void {
    const p = this.channel ? this.c.caster.body.position : this.center;
    this.ring.position.set(p.x, p.y + 0.04, p.z);
    if (this.channel && this.spin) {
      this.ring.scale.setScalar(this.radius);
      this.spin.position.set(p.x, p.y + 0.6, p.z);
      this.spin.rotation.y -= dt * 22;
      if (Math.floor(this.age * 30) % 3 === 0) this.c.combat.burst(this.look.trail, new Vector3(p.x, p.y + 0.5, p.z));
      return;
    }
    const k = Math.min(1, this.age / 0.2);
    this.ring.scale.setScalar(Math.max(0.05, this.radius * (0.2 + 0.8 * k)));
    this.ring.visible = this.age < 0.28;
  }
}

/** Area burst around the caster (or a target); channelled novas (whirlwind) pulse while held. */
export const nova = (c: CastContext): CombatEffect => new Nova(c);
