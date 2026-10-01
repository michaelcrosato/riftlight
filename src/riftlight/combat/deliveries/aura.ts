import { type Mesh, Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import type { Mod } from '../../core/mods';
import { StatQuery } from '../stats';
import { ringDecal } from '../visuals';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** How often an aura refreshes its buff on allies in range, and how long each refresh lasts. */
export const AURA_PULSE = 0.25;
export const AURA_LINGER = 0.6;

class Aura extends EffectBase {
  readonly kind = 'aura';
  private readonly ring: Mesh;
  private readonly radius: number;
  private next = 0;
  private readonly near: Actor[] = [];

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'aura') throw new Error('aura delivery on a non-aura skill');
    this.radius = d.radius;
    this.ring = this.show(ringDecal(c.skill.def.look.color, 0.95, 40));
    c.combat.burst(c.skill.def.look.burst, new Vector3(c.caster.position.x, c.caster.position.y + 0.5, c.caster.position.z));
  }

  /** Buff mods scaled by the caster's `aura.effect` (inc/more; 1 = as written). */
  private scaled(mods: readonly Mod[]): readonly Mod[] {
    const k = new StatQuery(this.c.caster.stats, this.c.skill.mods).scale('aura.effect', this.c.skill.tags);
    return k === 1 ? mods : mods.map((m) => (m.kind === 'flag' || m.kind === 'override' ? m : { ...m, value: m.value * k }));
  }

  step(dt: number): boolean {
    this.age += dt;
    const c = this.c;
    if (!c.caster.alive) return false;
    if (this.age >= this.next) {
      this.next = this.age + AURA_PULSE;
      for (const e of c.skill.effects) {
        if (e.kind !== 'buff') continue;
        const hostile = e.target === 'enemies';
        // keystone `auras.selfOnly`: allied auras touch only the caster
        const selfOnly = !hostile && c.caster.stats.has('auras.selfOnly');
        for (const a of c.combat.actors.query(c.caster.position, this.radius, this.near, (x) => x.alive && (selfOnly ? x === c.caster : hostile ? c.caster.hostileTo(x) : !c.caster.hostileTo(x)))) {
          a.addBuff(`aura:${c.skill.id}`, this.scaled(e.mods), AURA_LINGER);
        }
      }
    }
    return true;
  }

  render(): void {
    const p = this.c.caster.body.position;
    this.ring.position.set(p.x, p.y + 0.035, p.z);
    this.ring.scale.setScalar(this.radius * (0.97 + 0.03 * Math.sin(this.age * 4)));
    if (Math.floor(this.age * 20) % 25 === 0) this.c.combat.burst('sparkle', new Vector3(p.x, p.y + 0.2, p.z), { count: 2, colors: this.c.skill.def.look.glow });
  }
}

/**
 * A toggled aura around the caster: buffs allies (or debuffs enemies) in range while on.
 * Casting it again turns it off (and returns null).
 */
export const aura = (c: CastContext): CombatEffect | null => {
  if (c.combat.stop(c.caster, c.skill.id) > 0) {
    c.caster.removeBuff(`aura:${c.skill.id}`);
    return null;
  }
  return new Aura(c);
};
