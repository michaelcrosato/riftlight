import { BoxGeometry, Group, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { PALETTE } from '../../engine/palette';
import { toonMaterial } from '../../engine/render/toon';
import { type Mod, override, type StatSheet } from '../core/mods';
import { Actor, type ActorWorld, type Brain } from '../actors/Actor';
import type { ResolvedSkill } from '../skills/types';
import type { Combat } from './Combat';
import { AIM_RANGE } from './deliveries/slam';
import { EffectBase, type CastContext } from './deliveries/types';
import { StatQuery } from './stats';
import { glow, ringDecal } from './visuals';

/**
 * Totems: a support (Spell Totem, Ballista Totem) turns a skill into a carved pole the hero
 * plants; the totem is an `Actor` on the hero's side that casts the linked skill at the
 * nearest enemy in reach, with a snapshot of its owner's stats (gear, tree, buffs, charges at
 * the moment it was planted). Monsters see it as a target and can break it.
 *
 *   totem.count  flat: more totems at once (1 + it); planting another replaces the oldest
 *   totem.life   inc/more: its life (TOTEM_TUNING.life × the owner's maximum life)
 *   totem.speed  inc/more: planting speed (skills/build.ts, PLACEMENT.totemTime)
 *
 * Its hits carry the `totem` tag (the support adds it), so `inc('damage', 0.2, ['totem'])`
 * scales them and Ancestral Bond's `cannotDealDamage.self` spares them. Kills count for both
 * the totem and its owner (charges on kill, Rampage).
 */
export const TOTEM_TUNING = {
  /** Totems before `totem.count`. */
  baseCount: 1,
  /** Life as a share of the owner's maximum life, before `totem.life`. */
  life: 0.6,
  /** Seconds a totem stands (× the skill's duration multiplier). */
  duration: 12,
  /** How far from the hero it is planted toward the aim (m). */
  reach: 2.5,
  /** Seconds between casts as a multiple of the skill's cast time. */
  castRate: 1.1,
} as const;

/** How many totems a caster with `sheet` keeps. */
export function totemLimit(sheet: StatSheet): number {
  return Math.max(1, Math.round(TOTEM_TUNING.baseCount + sheet.get('totem.count')));
}

/** A totem's life for an owner (`totem.life` inc/more on the owner, with the skill's tags). */
export function totemLife(owner: Actor, skill: ResolvedSkill): number {
  return Math.max(1, owner.maxLife * TOTEM_TUNING.life * new StatQuery(owner.stats, skill.mods).scale('totem.life', skill.tags));
}

/** How far a totem looks for something to cast at, by delivery. */
export function totemRange(skill: ResolvedSkill): number {
  const d = skill.delivery;
  switch (d.kind) {
    case 'projectile':
      return Math.min(14, d.range);
    case 'strike':
      return d.range + 0.6;
    case 'nova':
      return d.radius;
    case 'aura':
      return d.radius;
    case 'beam':
      return d.length;
    default:
      return skill.def.target === 'aim' ? Math.min(AIM_RANGE, 10) : 4;
  }
}

/** The owner's stat sources as a frozen copy (the totem's own sheet starts from it). */
function snapshot(owner: StatSheet): Record<string, Mod[]> {
  const out: Record<string, Mod[]> = {};
  for (const { source, mod } of owner.entries()) {
    if (source.startsWith('curse:')) continue; // its owner's curses stay with its owner
    (out[source] ??= []).push(mod);
  }
  return out;
}

const geo = new Map<string, BoxGeometry>();
const box = (w: number, h: number, d: number) => {
  const k = `${w},${h},${d}`;
  let g = geo.get(k);
  if (!g) {
    g = new BoxGeometry(w, h, d);
    g.userData.shared = true;
    geo.set(k, g);
  }
  return g;
};
const part = (g: BoxGeometry, color: number, x: number, y: number, z: number, toon = true): Mesh => {
  const m = new Mesh(g, toon ? toonMaterial(color) : glow(color));
  m.position.set(x, y, z);
  m.castShadow = toon;
  if (!toon) m.userData.noFlash = true;
  return m;
};

/**
 * A carved totem pole about as tall as the hero: stone foot, dark pole, two stacked sand-
 * coloured faces banded in plum, glowing eyes and a crest in the skill's colour, and two
 * glowing "wings" so it reads as magic at a glance. `face` is the upper head (it nods when
 * the totem casts); the ring under it turns.
 */
export function totemBody(skill: ResolvedSkill): { root: Object3D; face: Object3D; eyes: Mesh[]; ring: Mesh } {
  const color = PALETTE[skill.def.look.color];
  const root = new Group();
  root.name = 'totem';
  const carved = PALETTE.sand;
  const dark = PALETTE.plum;
  root.add(part(box(0.8, 0.25, 0.8), PALETTE.slate, 0, 0.125, 0), part(box(0.3, 1.75, 0.3), dark, 0, 1.0, 0));
  // lower face with a jaw and side wings
  const low = new Group();
  low.position.y = 1.05;
  low.add(
    part(box(0.5, 0.42, 0.4), carved, 0, 0, 0),
    part(box(0.56, 0.08, 0.44), dark, 0, 0.2, 0),
    part(box(0.34, 0.08, 0.05), dark, 0, -0.1, 0.21),
    part(box(0.36, 0.1, 0.1), color, -0.42, 0.06, 0, false),
    part(box(0.36, 0.1, 0.1), color, 0.42, 0.06, 0, false),
  );
  // upper face (nods on cast): glowing eyes and a crest
  const face = new Group();
  face.position.y = 1.62;
  const eyes = [part(box(0.12, 0.08, 0.05), color, -0.11, 0.04, 0.22, false), part(box(0.12, 0.08, 0.05), color, 0.11, 0.04, 0.22, false)];
  face.add(part(box(0.56, 0.48, 0.42), carved, 0, 0, 0), part(box(0.7, 0.09, 0.18), dark, 0, 0.29, 0), part(box(0.1, 0.36, 0.1), color, 0, 0.5, 0, false), ...eyes);
  root.add(low, face);
  const ring = ringDecal(skill.def.look.color, 0.8, 12);
  ring.position.y = 0.03;
  ring.scale.setScalar(0.7);
  root.add(ring);
  return { root, face, eyes, ring };
}

/** Rooted: turn to the nearest enemy in reach and cast the skill at it whenever ready. */
export class TotemBrain implements Brain {
  cooldown = 0.25;
  /** Seconds since the last cast (the nod). */
  sinceCast = 9;
  casts = 0;
  private readonly range: number;

  constructor(
    private readonly combat: Combat,
    readonly skill: ResolvedSkill,
  ) {
    this.range = totemRange(skill);
  }

  think(a: Actor, dt: number, world: ActorWorld): void {
    a.velocity.set(0, 0, 0);
    this.cooldown -= dt * a.actionSpeed;
    this.sinceCast += dt;
    const target = world.nearest(a.position, this.range, (x) => x.alive && a.hostileTo(x) && !x.tags.includes('prop'));
    if (!target) return;
    a.facing = Math.atan2(target.position.x - a.position.x, target.position.z - a.position.z);
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.15, this.skill.castTime * TOTEM_TUNING.castRate);
    this.sinceCast = 0;
    this.casts++;
    this.combat.cast(a, this.skill, target.position.clone());
  }
}

/** A planted totem: lives while its actor stands (the CombatEffect side keeps the count and lifetime). */
export class TotemEffect extends EffectBase {
  readonly kind = 'totem';
  readonly actor: Actor;
  readonly brain: TotemBrain;
  readonly expires: number;

  constructor(c: CastContext) {
    super(c);
    const inner = c.skill.inner!;
    const { combat, caster } = c;
    // the oldest totems make way
    const mine = combat.effects.filter((e): e is TotemEffect => e instanceof TotemEffect && e.caster === caster && e.actor.alive);
    for (let i = 0; i <= mine.length - totemLimit(caster.stats); i++) mine[i]!.actor.die(null);
    const p = caster.position;
    const d = Math.min(TOTEM_TUNING.reach, Math.hypot(c.aim.x - p.x, c.aim.z - p.z));
    const at = new Vector3(p.x + c.dir.x * Math.max(1.2, d), p.y, p.z + c.dir.z * Math.max(1.2, d));
    const wall = combat.wall(new Vector3(p.x, p.y + 0.5, p.z), new Vector3(at.x, p.y + 0.5, at.z));
    if (wall !== null) at.set(p.x + (at.x - p.x) * wall * 0.8, p.y, p.z + (at.z - p.z) * wall * 0.8);
    const body = totemBody(inner);
    const life = totemLife(caster, c.skill);
    const actor = new Actor({
      faction: caster.faction,
      name: `${inner.def.name} totem`,
      mods: {
        ...snapshot(caster.stats),
        totem: [override('life', life), override('es', 0), override('mana', 0), override('life.regen', 0), override('life.regen.pct', 0), override('move.speed', 0), override('mass', 1000)],
      },
      level: caster.level,
      body: body.root,
      at: [at.x, at.y, at.z],
      order: 1,
      radius: 0.42,
      tags: ['totem', inner.id],
      death: 'ragdoll',
      seed: `totem:${caster.id}:${inner.id}:${combat.time.toFixed(3)}`,
    });
    actor.owner = caster;
    actor.facing = caster.facing;
    this.brain = new TotemBrain(combat, inner);
    actor.brain = this.brain;
    // rises out of the ground, nods and flashes its eyes on every cast
    let t = 0;
    actor.animate = (_a, dt) => {
      t += dt;
      const rise = Math.min(1, t / 0.25);
      body.root.scale.set(1, 0.3 + 0.7 * rise, 1);
      const nod = Math.max(0, 1 - this.brain.sinceCast / 0.25);
      body.face.rotation.x = nod * 0.35;
      body.face.position.z = nod * 0.06;
      for (const e of body.eyes) e.scale.setScalar(1 + nod * 0.8);
      body.ring.rotation.y = t * 1.2;
      body.ring.scale.setScalar(0.7 * (1 + 0.06 * Math.sin(t * 4)));
    };
    combat.actors.add(actor);
    this.actor = actor;
    this.expires = combat.time + TOTEM_TUNING.duration * Math.max(0.1, inner.duration);
    combat.burst('impact', new Vector3(at.x, at.y + 0.2, at.z), { count: 10 });
    combat.play('explode', { pitch: -6, volume: 0.5 });
    const look = inner.def.look;
    if (look.light) combat.light(look.light.color, Math.min(2.5, look.light.intensity * 0.4), 3, () => actor.position, 0, () => actor.alive);
  }

  step(): boolean {
    if (!this.actor.alive) return false;
    if (this.c.combat.time >= this.expires) {
      this.actor.die(null);
      return false;
    }
    return true;
  }

  override dispose(): void {
    super.dispose();
    // its caster left the stage (or the effect was stopped): the totem goes too
    if (this.actor.alive) this.actor.die(null);
  }
}

/** Plant a totem for a totem-supported skill (`skill.placement === 'totem'`). */
export const placeTotem = (c: CastContext): TotemEffect => new TotemEffect(c);
