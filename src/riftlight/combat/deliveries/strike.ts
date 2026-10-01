import type { Mesh } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import { arcDecal } from '../visuals';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** Damage, arc and knockback bonus of a combo's last hit. */
export const FINISHER = { damage: 1.6, arc: 1.25, knockback: 2.2, shake: 0.25 } as const;

/** Is this cast the last step of a multi-step combo? */
export function isFinisher(c: CastContext): boolean {
  const n = c.skill.anims.length;
  return n > 1 && (c.opts.combo ?? 0) % n === n - 1;
}

/** Enemies inside a melee arc: within `range` (plus their radius) and `arc` degrees of `dir`. */
export function inArc(c: CastContext, range: number, arcDeg: number): Actor[] {
  const { caster, dir, combat } = c;
  const half = ((arcDeg / 2) * Math.PI) / 180;
  const cosHalf = Math.cos(half);
  return combat.actors.query(caster.position, range, [], (a) => {
    if (!a.alive || !caster.hostileTo(a)) return false;
    const dx = a.position.x - caster.position.x;
    const dz = a.position.z - caster.position.z;
    const d = Math.hypot(dx, dz);
    if (d < a.radius + caster.radius) return true; // touching: always in the arc
    // the target's body counts: widen the arc by its angular radius
    const cos = (dx * dir.x + dz * dir.z) / d;
    const widen = Math.asin(Math.min(1, a.radius / d));
    return cos >= Math.cos(Math.min(Math.PI, half + widen)) || cos >= cosHalf;
  });
}

class Strike extends EffectBase {
  readonly kind = 'strike';
  private readonly swoosh: Mesh;
  private readonly life = 0.12;
  /** Actors this strike hit (tests and inspectors). */
  readonly hit: Actor[];

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'strike') throw new Error('strike delivery on a non-strike skill');
    const fin = isFinisher(c);
    const arc = d.arc * (fin ? FINISHER.arc : 1);
    this.hit = [];
    for (const t of inArc(c, d.range, arc)) {
      if (c.combat.wall(c.caster.position, t.position) !== null) continue;
      const r = c.combat.hit(c.caster, t, c.skill, { scale: fin ? FINISHER.damage : 1, knockback: fin ? FINISHER.knockback : 1 });
      if (r) this.hit.push(t);
    }
    if (fin && this.hit.length) c.combat.shake.add(FINISHER.shake);
    // the swoosh: a flat arc at chest height, white for the finisher
    const look = c.skill.def.look;
    this.swoosh = this.show(arcDecal(fin ? 'white' : (look.glow?.[0] ?? look.color), arc, d.range * 0.45, d.range * 0.95));
    this.swoosh.position.set(c.caster.position.x, c.caster.position.y + 0.95, c.caster.position.z);
    this.swoosh.rotation.y = Math.atan2(c.dir.x, c.dir.z);
    // alternate the tilt per combo step so the swings read as left/right/overhead
    const step = (c.opts.combo ?? 0) % 3;
    this.swoosh.rotation.z = step === 0 ? 0.25 : step === 1 ? -0.25 : 0;
    if (fin) this.swoosh.rotation.x = -0.35;
  }

  step(dt: number): boolean {
    this.age += dt;
    return this.age < this.life;
  }

  render(): void {
    const t = Math.min(1, this.age / this.life);
    this.swoosh.scale.setScalar(0.85 + 0.25 * t);
    this.swoosh.visible = t < 0.95;
  }
}

/** Melee arc hit at the hit frame, with a combo chain (the last step is a stronger finisher). */
export const strike = (c: CastContext): CombatEffect => new Strike(c);
