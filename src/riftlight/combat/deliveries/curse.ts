import { type Mesh, Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import { discDecal, ringDecal } from '../visuals';
import { areaCenter } from './slam';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** Seconds the hex circle stays on the ground after the curse lands. */
export const CURSE_FLASH = 0.7;

class Hex extends EffectBase {
  readonly kind = 'curse';
  readonly center: Vector3;
  /** Actors the hex reached, with what happened (tests, inspectors). */
  readonly outcomes: { actor: Actor; outcome: string }[] = [];
  private readonly radius: number;
  private readonly ring: Mesh;
  private readonly rune: Mesh;
  private readonly shade: Mesh;
  private readonly near: Actor[] = [];

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'curse') throw new Error('curse delivery on a non-curse skill');
    this.radius = d.radius;
    this.center = areaCenter(c, d.radius);
    const look = c.skill.def.look;
    this.shade = this.show(discDecal('ink', 24));
    this.ring = this.show(ringDecal(look.color, 0.9, 6));
    this.rune = this.show(ringDecal(look.glow?.[0] ?? look.color, 0.55, 3));
    for (const m of [this.shade, this.ring, this.rune]) m.position.set(this.center.x, this.center.y + 0.03, this.center.z);
    this.shade.position.y -= 0.01;
    // every enemy in the circle (level props aren't cursed)
    for (const a of c.combat.actors.query(this.center, this.radius, this.near, (x) => x.alive && c.caster.hostileTo(x) && !x.tags.includes('prop'))) {
      if (c.combat.wall(this.center, a.position) !== null) continue;
      this.outcomes.push({ actor: a, outcome: c.combat.curse(c.caster, a, c.skill) ?? 'none' });
    }
    c.combat.burst(look.burst ?? 'sparkle', new Vector3(this.center.x, this.center.y + 0.4, this.center.z), { scale: this.radius / 2, colors: look.glow });
    c.combat.play(look.sound?.impact);
    if (look.light) {
      const p = this.center.clone();
      c.combat.light(look.light.color, look.light.intensity, look.light.radius, () => p, CURSE_FLASH);
    }
  }

  step(dt: number): boolean {
    this.age += dt;
    return this.age < CURSE_FLASH;
  }

  render(): void {
    const k = Math.min(1, this.age / CURSE_FLASH);
    // the circle snaps out to full size, turns, and shrinks away
    const s = this.radius * (k < 0.15 ? k / 0.15 : 1 - Math.max(0, k - 0.7) / 0.3);
    this.shade.scale.setScalar(Math.max(0.01, s * 0.95));
    this.ring.scale.setScalar(Math.max(0.01, s));
    this.rune.scale.setScalar(Math.max(0.01, s * 0.8));
    this.ring.rotation.y = this.age * 1.5;
    this.rune.rotation.y = -this.age * 2.5;
  }
}

/** A hex on an area at the aim point: every enemy inside gets the skill's curse (`Combat.curse`). */
export const curse = (c: CastContext): CombatEffect => new Hex(c);
