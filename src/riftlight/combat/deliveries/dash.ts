import { Vector3 } from 'three/webgpu';
import type { Actor } from '../../actors/Actor';
import { EffectBase, type CastContext, type CombatEffect } from './types';

/** Share of a dodge roll that is invulnerable (from the start). */
export const DODGE_IFRAMES = 0.85;
/** A dash covers its distance in this share of the skill's cast time. */
export const DASH_TIME = 0.8;

/** A speed profile over u = 0..1 scaled so it averages exactly 1 (the distance is kept). */
export function normalizedProfile(shape: (u: number) => number): (u: number) => number {
  let sum = 0;
  const n = 400;
  for (let i = 0; i < n; i++) sum += shape((i + 0.5) / n);
  const k = n / sum;
  return (u) => shape(u) * k;
}
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/**
 * Root motion of the dodge roll, matched to the Roll clip (played over the same time): it
 * pushes off already moving (the feet leave the floor at once), rolls at full speed, brakes
 * as the ball comes over and the feet come down (Roll frame 8.5 of 14), then creeps on at
 * the speed the clip slides the planted feet back under the rising body (about 0.2 m), so
 * they stay planted instead of skating.
 */
export const ROLL_PROFILE = normalizedProfile((u) => (u < 0.1 ? 0.45 + 0.55 * smooth(u / 0.1) : u < 0.36 ? 1 : u < 0.6 ? 1 - 0.945 * smooth((u - 0.36) / 0.24) : 0.055));
/** Dashes and charges: off the mark fast, and brake into the last stride. */
export const DASH_PROFILE = normalizedProfile((u) => (u < 0.1 ? 0.5 + 0.5 * smooth(u / 0.1) : u < 0.7 ? 1 : 1 - 0.9 * smooth((u - 0.7) / 0.3)));

class Dash extends EffectBase {
  readonly kind = 'dash';
  private done = false;
  private readonly hitIds = new Set<number>();
  private readonly near: Actor[] = [];
  private readonly look = this.c.skill.def.look;
  readonly start: Vector3;

  constructor(c: CastContext) {
    super(c);
    const d = c.skill.delivery;
    if (d.kind !== 'dash') throw new Error('dash delivery on a non-dash skill');
    const caster = c.caster;
    this.start = caster.position.clone();
    const p = caster.position;
    caster.facing = Math.atan2(c.dir.x, c.dir.z);
    if (c.skill.def.teleport) {
      // blink: up to `distance` toward the aim, stopping short of walls
      const dist = Math.min(d.distance, Math.max(1, Math.hypot(c.aim.x - p.x, c.aim.z - p.z)));
      const from = new Vector3(p.x, p.y + 0.5, p.z);
      const to = from.clone().addScaledVector(c.dir, dist);
      const wall = c.combat.wall(from, to);
      const k = wall === null ? 1 : Math.max(0, wall - 0.4 / dist);
      c.combat.burst(this.look.burst ?? 'blink', from);
      caster.mover.teleport(p.x + c.dir.x * dist * k, p.y, p.z + c.dir.z * dist * k);
      caster.position.copy(caster.mover.position);
      caster.iframes = Math.max(caster.iframes, 0.15);
      c.combat.burst(this.look.burst ?? 'blink', new Vector3(caster.position.x, caster.position.y + 0.5, caster.position.z));
      if (this.look.light) {
        const at = caster.position.clone();
        c.combat.light(this.look.light.color, this.look.light.intensity, this.look.light.radius, () => at, 0.3);
      }
      this.done = true;
      return;
    }
    const time = Math.max(0.1, c.skill.castTime * DASH_TIME);
    const speed = d.distance / time;
    const dodge = c.skill.tags.includes('dodge');
    if (dodge) caster.iframes = Math.max(caster.iframes, time * DODGE_IFRAMES);
    caster.startMotion({
      vx: c.dir.x * speed,
      vz: c.dir.z * speed,
      left: time,
      total: time,
      profile: dodge ? ROLL_PROFILE : DASH_PROFILE,
      onStep: (a) => this.along(a, d.hitWidth),
      onEnd: () => {
        this.done = true;
      },
    });
  }

  /** Hit enemies the caster passes through (once each). */
  private along(a: Actor, width: number): void {
    const c = this.c;
    if (Math.floor(this.age * 60) % 2 === 0) c.combat.burst(this.look.trail, new Vector3(a.position.x, a.position.y + 0.1, a.position.z));
    if (width <= 0 || !c.skill.damage) return;
    for (const t of c.combat.actors.query(a.position, width / 2 + 0.3, this.near, (x) => x.alive && a.hostileTo(x))) {
      if (this.hitIds.has(t.id)) continue;
      this.hitIds.add(t.id);
      // knocked aside and forward, out of the way
      const from = a.position.clone().addScaledVector(this.c.dir, -1);
      c.combat.hit(a, t, c.skill, { from });
    }
  }

  step(dt: number): boolean {
    this.age += dt;
    return !this.done && this.age < 3;
  }
}

/** Movement skill: dash (hits along the path), dodge roll (i-frames) or blink (teleport). */
export const dash = (c: CastContext): CombatEffect => new Dash(c);
