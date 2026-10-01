import { BoxGeometry, ConeGeometry, Group, Mesh, type Object3D, Vector3 } from 'three/webgpu';
import { PALETTE } from '../../engine/palette';
import { toonMaterial } from '../../engine/render/toon';
import { flat, type Mod, type StatSheet } from '../core/mods';
import { StatQuery } from './stats';
import { Actor, type ActorWorld, type Brain } from '../actors/Actor';
import { buildSkill } from '../skills/build';
import type { ResolvedSkill, SkillGem } from '../skills/types';
import type { Combat, SummonRequest } from './Combat';
import { glow } from './visuals';

/** Minion base stats by genome (the monster system supplies real genomes). */
export const MINION_BASE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  minion: { life: 60, 'move.speed': 5.5, 'life.regen': 2, accuracy: 300 },
  spectre: { life: 90, 'move.speed': 4.5, 'life.regen': 3, accuracy: 300 },
};

/** The minion's own melee swing (its damage comes from the summon gem). */
export const MINION_STRIKE: SkillGem = {
  id: 'minion-strike', name: 'Minion Strike', description: 'A minion melee swing.', tags: ['attack', 'melee', 'strike', 'physical', 'damage', 'minion'],
  cost: 0, cooldown: 0, castTime: 0.8, anim: 'Slash1', delivery: { kind: 'strike', range: 1.4, arc: 100 },
  effects: [{ kind: 'damage', base: {}, effectiveness: 1 }, { kind: 'knockback', force: 1.5 }],
  look: { color: 'white', burst: 'spark', sound: { hit: 'hit' } }, weight: 0,
};

/**
 * What an owner's sheet gives its minions: every `minion.<stat>` mod as `<stat>`, and every mod
 * scoped to the 'minion' tag without that scope (passives, gear, auras of the summoner).
 */
export function ownerMinionMods(owner: StatSheet): Mod[] {
  const out: Mod[] = [];
  for (const { mod } of owner.entries()) {
    if (mod.stat.startsWith('minion.')) out.push({ ...mod, stat: mod.stat.slice(7) });
    else if (mod.tags?.includes('minion')) {
      const tags = mod.tags.filter((t) => t !== 'minion');
      out.push({ ...mod, tags: tags.length ? tags : undefined });
    }
  }
  return out;
}

/** Strip the 'minion' scope from a summoner's mods so they apply on the minion's own sheet. */
export function minionMods(mods: readonly Mod[]): Mod[] {
  return mods.filter((m) => !m.tags || m.tags.includes('minion')).map((m) => {
    const tags = m.tags?.filter((t) => t !== 'minion');
    return { ...m, tags: tags?.length ? tags : undefined };
  });
}

const geo = new Map<string, BoxGeometry | ConeGeometry>();
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
const part = (g: BoxGeometry | ConeGeometry, color: number, x: number, y: number, z: number): Mesh => {
  const m = new Mesh(g, toonMaterial(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

/** A chunky skeleton (genome 'minion') or a floating hooded spectre ('spectre'). */
export function minionBody(genome: string): { root: Object3D; model: Object3D } {
  const root = new Group();
  const model = new Group();
  root.add(model);
  if (genome === 'spectre') {
    let robe = geo.get('robe');
    if (!robe) {
      robe = new ConeGeometry(0.42, 1.2, 6);
      robe.userData.shared = true;
      geo.set('robe', robe);
    }
    model.add(part(robe, PALETTE.plum, 0, 0.9, 0), part(box(0.36, 0.34, 0.34), PALETTE.night, 0, 1.55, 0));
    const eyes = new Mesh(box(0.24, 0.06, 0.04), glow('lime'));
    eyes.position.set(0, 1.56, 0.17);
    eyes.userData.noFlash = true;
    model.add(eyes);
  } else {
    const bone = PALETTE.white;
    model.add(
      part(box(0.36, 0.42, 0.22), bone, 0, 0.95, 0),
      part(box(0.3, 0.28, 0.28), bone, 0, 1.33, 0.02),
      part(box(0.1, 0.42, 0.1), PALETTE.mist, -0.25, 0.92, 0),
      part(box(0.1, 0.42, 0.1), PALETTE.mist, 0.25, 0.92, 0),
      part(box(0.12, 0.5, 0.12), PALETTE.mist, -0.1, 0.38, 0),
      part(box(0.12, 0.5, 0.12), PALETTE.mist, 0.1, 0.38, 0),
      part(box(0.06, 0.5, 0.06), PALETTE.slate, 0.3, 0.95, 0.25),
    );
    const eyes = new Mesh(box(0.2, 0.05, 0.04), glow('red'));
    eyes.position.set(0, 1.36, 0.17);
    eyes.userData.noFlash = true;
    model.add(eyes);
  }
  return { root, model };
}

/**
 * Minion AI: follow the owner, fight the nearest enemy (melee swings, or bolts for casters),
 * catch up by teleporting when left far behind.
 */
export class MinionBrain implements Brain {
  private cooldown = 0;
  private sync = 1;
  private swing = 0;
  constructor(
    private readonly combat: Combat,
    private readonly attack: ResolvedSkill,
    private readonly ranged: boolean,
  ) {}

  think(a: Actor, dt: number, world: ActorWorld): void {
    // the owner's `minion.*` stats follow it (gear swaps, buffs), checked once a second
    this.sync -= dt;
    if (this.sync <= 0 && a.owner) {
      this.sync = 1;
      a.stats.set('owner', ownerMinionMods(a.owner.stats));
    }
    this.cooldown -= dt * a.actionSpeed;
    this.swing = Math.max(0, this.swing - dt);
    const owner = a.owner;
    a.velocity.set(0, 0, 0);
    if (owner && owner.alive && a.position.distanceTo(owner.position) > 14) {
      a.mover.teleport(owner.position.x + 1, owner.position.y, owner.position.z + 1);
      a.position.copy(a.mover.position);
      return;
    }
    const target = world.nearest(a.position, this.ranged ? 9 : 7, (x) => x.alive && a.hostileTo(x));
    if (target) {
      const dx = target.position.x - a.position.x;
      const dz = target.position.z - a.position.z;
      const d = Math.hypot(dx, dz);
      a.facing = Math.atan2(dx, dz);
      const reach = this.ranged ? 8 : a.radius + target.radius + 0.6;
      if (d > reach) {
        a.velocity.set((dx / d) * a.moveSpeed, 0, (dz / d) * a.moveSpeed);
      } else if (this.cooldown <= 0) {
        this.cooldown = this.attack.castTime / Math.max(0.2, new StatQuery(a.stats, this.attack.mods).scale(this.ranged ? 'cast.speed' : 'attack.speed', this.attack.tags));
        this.swing = 0.2;
        this.combat.cast(a, this.attack, target.position.clone());
      }
      return;
    }
    if (owner && owner.alive) {
      const dx = owner.position.x - a.position.x;
      const dz = owner.position.z - a.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.5) {
        const k = Math.min(1, (d - 2) / 2) * a.moveSpeed;
        a.velocity.set((dx / d) * k, 0, (dz / d) * k);
        a.facing = Math.atan2(dx, dz);
      }
    }
  }

  /** 0..1 while swinging (for the procedural lunge). */
  get swingAmount(): number {
    return this.swing / 0.2;
  }
}

/**
 * The default summon factory: placeholder skeletons and spectres built from boxes, with
 * MinionBrain. The monster system can replace it (`combat.summonFactory = ...`) to raise
 * real genomes.
 */
export function placeholderMinion(req: SummonRequest): Actor {
  const { root, model } = minionBody(req.genome);
  const ranged = req.genome === 'spectre';
  const mods = [...req.mods];
  const actor = new Actor({
    faction: req.owner.faction,
    name: req.genome,
    base: MINION_BASE[req.genome] ?? MINION_BASE.minion,
    mods: { summoner: mods, owner: ownerMinionMods(req.owner.stats), level: [flat('life', 8 * (req.skill.level - 1))] },
    level: req.owner.level,
    body: root,
    at: req.at,
    order: 1,
    radius: 0.4,
    tags: ['minion', req.skill.id],
    death: 'ragdoll',
    seed: `minion:${req.owner.id}:${req.skill.id}:${req.index}:${req.combat.time.toFixed(3)}`,
  });
  actor.owner = req.owner;
  const base = ranged ? buildSkill('chaos-bolt', [], actor.stats) : buildSkill(MINION_STRIKE, [], actor.stats);
  // the swing / bolt time follows the minion's own attack / cast speed (summoner and owner mods)
  const attack: ResolvedSkill = { ...base, damage: req.attack ? { ...req.attack, tags: base.damage?.tags ?? req.attack.tags } : base.damage, castTime: ranged ? 1.3 : MINION_STRIKE.castTime };
  const brain = new MinionBrain(req.combat, attack, ranged);
  actor.brain = brain;
  let t = req.index * 0.7;
  actor.animate = (_a, dt) => {
    t += dt;
    const moving = actor.velocity.lengthSq() > 0.5;
    model.position.y = ranged ? 0.25 + Math.sin(t * 3) * 0.08 : moving ? Math.abs(Math.sin(t * 12)) * 0.08 : 0;
    model.rotation.x = brain.swingAmount * 0.5 + (moving ? 0.12 : 0);
    model.position.z = brain.swingAmount * 0.2;
  };
  return actor;
}

export const minionPosition = (center: Vector3, i: number, n: number): Vector3 => {
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  return new Vector3(center.x + Math.sin(a) * 1.1, center.y, center.z + Math.cos(a) * 1.1);
};
