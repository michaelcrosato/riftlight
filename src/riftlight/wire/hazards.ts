import { type Mesh, Vector3 } from 'three/webgpu';
import type { Actor } from '../actors/Actor';
import { StatQuery } from '../combat/stats';
import { createTelegraph } from '../combat/telegraph';
import { ringDecal } from '../combat/visuals';
import { inc, more } from '../core/mods';
import type { Rng } from '../core/rng';
import type { AilmentType, DamageType } from '../core/types';
import type { Level } from '../levels/Level';
import { MONSTER_SKILLS, type MonsterEvent } from '../monsters';
import { buildSkill } from '../skills/build';
import { SKILLS } from '../skills/actives';
import type { SkillGem } from '../skills/types';
import { type LiveTelegraph, makeTelegraph, type MonsterUnit, monsterGem } from './monsters';
import { WIRE_TUNING } from './tuning';
import { type CombatWorld, isProp, PropActor } from './world';

const H = WIRE_TUNING.hazard;

/** What the hazard stager needs from its level (wire/levels.ts implements it). */
export interface HazardHost {
  readonly world: CombatWorld;
  readonly level: Level;
  readonly root: import('three/webgpu').Object3D;
  readonly rng: Rng;
  readonly ctx: import('../../engine').GameContext;
  shake(strength: number, seconds?: number): void;
  heroActor(): Actor | null;
  units(): readonly MonsterUnit[];
  /** Spawn adds around a monster (summons, splits, clones). */
  spawnAdds(from: MonsterUnit, o: { count: number; archetype?: string; scale?: number; mode: 'summon' | 'split' | 'clone'; at: Vector3 }): void;
}

interface Effect {
  /** Fixed step; false when done. */
  step(dt: number): boolean;
  render?(dt: number): void;
  dispose(): void;
  readonly tele?: LiveTelegraph | null;
  /** Elite toggles ('beam', 'aura') keep a key to switch off. */
  readonly key?: string;
}

const DAMAGE: readonly DamageType[] = ['physical', 'fire', 'cold', 'lightning', 'chaos'];
const asType = (v: unknown, d: DamageType = 'physical'): DamageType => (DAMAGE.includes(v as DamageType) ? (v as DamageType) : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const COLOR: Readonly<Record<DamageType, number>> = { physical: 0xef7d57, fire: 0xef7d57, cold: 0x73eff7, lightning: 0x41a6f6, chaos: 0xa7f070 };
const BOLT: Readonly<Record<DamageType, string>> = { physical: 'voidbolt', fire: 'firebolt', cold: 'frostbolt', lightning: 'sparkbolt', chaos: 'voidbolt' };
const AILMENT: Partial<Record<DamageType, AilmentType>> = { fire: 'ignite', cold: 'chill', lightning: 'shock', chaos: 'poison' };

/** A single projectile of a monster bolt (spirals fire many of them). */
const singles = new Map<string, SkillGem>();
function singleBolt(type: DamageType): SkillGem {
  let g = singles.get(type);
  if (!g) {
    const base = monsterGem(MONSTER_SKILLS.get(BOLT[type]));
    const d = base.delivery;
    g = {
      ...base,
      id: `hazard-bolt-${type}`,
      delivery: d.kind === 'projectile' ? { ...d, count: 1, spread: 0, speed: d.speed * 0.8, range: 13 } : d,
      effects: type === 'physical' ? [{ kind: 'damage', base: { physical: [4, 8] } }] : base.effects.filter((e) => e.kind !== 'light'),
    };
    singles.set(type, g);
  }
  return g;
}

/**
 * Stages what monster brains ask the world for (`MonsterEvent`s): boss signature patterns
 * (slam waves, spirals, gusts, pulls, beams, meteors, quakes, darkness, mechanic hazards,
 * adds) and elite behaviours (death novas, burning trails, chilling and empowering auras,
 * rotating beams, storm strikes, pulls). Everything telegraphs on the floor before it hurts
 * (`telegraphs()` feeds the bot and the HUD), damage goes through the actor's `takeHit` with
 * the source monster's damage scaling (depth, rank, difficulty), and lights come from the
 * engine pool.
 */
export class Hazards {
  private readonly effects: Effect[] = [];
  private readonly tmp = new Vector3();

  constructor(private readonly host: HazardHost) {}

  /** Telegraphs that haven't landed yet. */
  telegraphs(): LiveTelegraph[] {
    const out: LiveTelegraph[] = [];
    for (const e of this.effects) if (e.tele && e.tele.remaining > 0) out.push(e.tele);
    return out;
  }

  get count(): number {
    return this.effects.length;
  }

  fixedUpdate(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      if (!e.step(dt)) {
        e.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  update(dt: number): void {
    for (const e of this.effects) e.render?.(dt);
  }

  dispose(): void {
    for (const e of this.effects) e.dispose();
    this.effects.length = 0;
  }

  // ------------------------------------------------------------- events

  handle(unit: MonsterUnit, e: MonsterEvent): void {
    const src = unit.actor;
    switch (e.type) {
      case 'summon':
        return this.later(0.1, () => this.host.spawnAdds(unit, { count: e.count, archetype: e.archetype, scale: e.scale, mode: 'summon', at: e.at }));
      case 'split':
        return this.host.spawnAdds(unit, { count: e.count, scale: e.scale, mode: 'split', at: e.at });
      case 'clone':
        return this.host.spawnAdds(unit, { count: e.count, mode: 'clone', at: e.at });
      case 'nova':
        return this.strike(src, e.at, e.radius, 0.45, asType(e.damage), 1.2, { ailment: e.ailment as AilmentType | undefined });
      case 'trail':
        return this.zone(src, e.at, 0.9, e.duration, asType(e.damage, 'fire'), 0.25);
      case 'strike':
        return this.strike(src, e.at, e.radius, e.delay, asType(e.damage, 'lightning'), 1.1);
      case 'pull':
        return this.pull(src, e.at, e.radius, e.force, 1.2, false);
      case 'aura':
        return e.on ? this.aura(unit, e.radius, e.effect) : this.off(`aura:${src.id}`);
      case 'beam':
        return e.on ? this.beams(unit, e.count, e.length, e.speed, Infinity, `beam:${src.id}`) : this.off(`beam:${src.id}`);
      case 'shield':
        if (e.on) this.host.ctx.particles.burst('swirl', src.position.clone().setY(1), { count: 16, colors: ['sky', 'white'] });
        return;
      case 'roar':
        this.host.shake(unit.rank === 'boss' ? 0.5 : 0.25, 0.4);
        this.host.ctx.audio.play('rl.roar', { pitch: unit.rank === 'boss' ? -4 : 2 });
        this.host.ctx.particles.burst('dust', e.at.clone().setY(0.2), { count: 18, scale: 2 });
        return;
      case 'phase':
        return;
      case 'heal':
        return void src.heal(e.amount);
      case 'hex':
        // a curse gem through combat (its hex circle, the curse limit, `curse.immune`)
        if (SKILLS.has(e.curse)) this.host.world.combat.cast(src, buildSkill(e.curse, [], src.stats), e.at);
        return;
      case 'hazard':
        return this.pattern(unit, e.id, e.at, e.data ?? {});
    }
  }

  /** A boss signature (BOSS_ATTACKS pattern) staged in the level. */
  private pattern(unit: MonsterUnit, id: string, _at: Vector3, d: Readonly<Record<string, number | string>>): void {
    const src = unit.actor;
    const delay = num(d.delay, 0.8);
    const type = asType(d.damage);
    const hero = this.host.heroActor();
    switch (id) {
      case 'slamWave':
        if (num(d.slow, 0) > 0) return this.later(delay, () => this.rings(src, src.position.clone(), num(d.rings, 2), num(d.speed, 5), num(d.gap, 1.2), type, num(d.slow, 0)));
        return this.later(delay, () => this.rings(src, src.position.clone(), num(d.rings, 3), num(d.speed, 6), num(d.gap, 1.2), type, 0));
      case 'echo':
        return this.later(delay, () => {
          const c = src.position.clone();
          this.rings(src, c, 2, 6, 1.2, 'physical', 0);
          this.strike(src, c, 3, num(d.delay, 2), 'physical', 1.1);
        });
      case 'spiral':
        return this.later(delay, () => this.spiral(src, num(d.arms, 4), num(d.shots, 20), num(d.turn, 0.3), type));
      case 'gust':
        return this.later(delay, () => hero && this.gust(src, hero.position, num(d.force, 12), num(d.length, 12)));
      case 'pull':
        return this.later(delay, () => this.pull(src, src.position.clone(), num(d.radius, 10), num(d.force, 8), num(d.duration, 2), num(d.collapse, 0) > 0));
      case 'darkness':
        return this.later(delay, () => this.darkness(num(d.duration, 6)));
      case 'beam':
        return this.later(delay, () => this.beams(unit, num(d.count, 2), num(d.length, 10), num(d.speed, 0.7), num(d.duration, 5), ''));
      case 'nova': {
        const r = num(d.radius, 4);
        this.strike(src, src.position.clone(), r, delay, type, 1.4);
        // blood nova: every corpse nearby bursts too
        if (num(d.corpses, 0) > 0)
          for (const u of this.host.units()) if (!u.actor.alive && u.actor.position.distanceTo(src.position) < 14) this.strike(src, u.actor.position.clone(), 2, delay + 0.3, 'physical', 0.8);
        return;
      }
      case 'meteor':
        for (let i = 0; i < num(d.count, 4); i++) this.later(delay + i * num(d.interval, 0.45), () => hero && this.strike(src, this.near(hero.position, 1.2), num(d.radius, 1.8), 1.0, type, 1.2));
        return;
      case 'quake': {
        const n = Math.min(24, num(d.tiles, 12));
        const c = (hero ?? src).position.clone();
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + this.host.rng.range(-0.2, 0.2);
          const r = 1.5 + (i % 3) * 1.6;
          this.later(delay * 0.5 + (i % 3) * 0.35, () => this.strike(src, new Vector3(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r), 1.1, num(d.delay, 1.2), 'physical', 0.9));
        }
        return;
      }
      case 'portal':
        return this.later(delay + 0.7, () => {
          if (!hero || !src.alive) return;
          const back = new Vector3(Math.sin(hero.facing), 0, Math.cos(hero.facing)).multiplyScalar(-2.5).add(hero.position);
          if (!this.host.level.isWalkable(back.x, back.z)) return;
          this.host.ctx.particles.burst('blink', src.position.clone().setY(1), { count: 20 });
          src.mover.teleport(back.x, 0, back.z);
          src.position.copy(src.mover.position);
          this.host.ctx.particles.burst('blink', back.clone().setY(1), { count: 20 });
        });
      case 'summon':
        return this.later(delay, () => this.host.spawnAdds(unit, { count: num(d.count, 3), archetype: typeof d.archetype === 'string' ? d.archetype : undefined, mode: 'summon', at: src.position.clone() }));
      case 'hazard':
        return this.mechanicHazard(unit, String(d.hazard ?? ''), d, delay);
      case 'charge':
      case 'leap':
        return; // the skill itself moves the boss
    }
  }

  /** Arena hazards built on the level's mechanic. */
  private mechanicHazard(unit: MonsterUnit, kind: string, d: Readonly<Record<string, number | string>>, delay: number): void {
    const src = unit.actor;
    const hero = this.host.heroActor();
    const props = (k: string) => this.host.world.actors.actors.filter((a): a is PropActor => isProp(a) && (a as PropActor).name === k && a.position.distanceTo(src.position) < 22);
    switch (kind) {
      case 'braziers': {
        let i = 0;
        for (const b of props('brazier')) this.later(delay + num(d.delay, 0.6) * i++, () => b.takeHit({ source: src, tags: ['hazard', 'fire'], damage: { fire: 1 }, crit: false }));
        if (i === 0 && hero) this.later(delay, () => this.rings(src, src.position.clone(), 2, 6, 1, 'fire', 0));
        return;
      }
      case 'pylons': {
        for (const p of props('pylon')) this.later(delay, () => p.takeHit({ source: src, tags: ['hazard', 'lightning'], damage: { lightning: 1 }, crit: false }));
        for (let i = 0; i < num(d.arcs, 3); i++) this.later(delay + i * 0.5, () => hero && this.strike(src, this.near(hero.position, 1.5), 1.6, 0.9, 'lightning', 1));
        return;
      }
      case 'ice':
        return this.later(delay, () => this.zone(src, (hero ?? src).position.clone(), Math.min(5, num(d.radius, 6) * 0.6), num(d.duration, 8), 'cold', 0.2, 'chill'));
      case 'thorns': {
        const lines = num(d.lines, 6);
        const length = num(d.length, 8);
        const c = src.position.clone();
        for (let l = 0; l < lines; l++) {
          const a = (l / lines) * Math.PI * 2;
          for (let r = 2; r <= length; r += 1.6) this.later(delay + r * 0.05, () => this.zone(src, new Vector3(c.x + Math.sin(a) * r, 0, c.z + Math.cos(a) * r), 0.75, num(d.duration, 5), 'physical', 0.3, 'bleed'));
        }
        return;
      }
      default:
        this.later(delay, () => this.rings(src, src.position.clone(), 2, 6, 1.2, 'physical', 0));
    }
  }

  // ------------------------------------------------------------- primitives

  private off(key: string): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i]!.key !== key) continue;
      this.effects[i]!.dispose();
      this.effects.splice(i, 1);
    }
  }

  /** Run `fn` after `seconds` of game time. */
  later(seconds: number, fn: () => void): void {
    let t = 0;
    this.effects.push({
      step: (dt) => {
        t += dt;
        if (t < seconds) return true;
        fn();
        return false;
      },
      dispose: () => {},
    });
  }

  private near(p: Vector3, spread: number): Vector3 {
    const r = this.host.rng;
    return new Vector3(p.x + r.range(-spread, spread), 0, p.z + r.range(-spread, spread));
  }

  /** Hostile actors (not props) inside a circle, nearest first. */
  private victims(src: Actor, center: Vector3, radius: number): Actor[] {
    return this.host.world.actors.query(center, radius, [], (x) => x.alive && !isProp(x) && src.hostileTo(x));
  }

  /** One hazard hit: the source's damage scaling (depth, rank, phase, difficulty) on the base. */
  hit(src: Actor, target: Actor, type: DamageType, mult: number, o: { from?: Vector3; knockback?: number; ailment?: AilmentType } = {}): void {
    const q = new StatQuery(src.stats);
    const scale = q.scale(['damage', `${type}.damage`], ['hazard', 'area', type]);
    const amount = H.damage * mult * scale * this.host.rng.range(0.85, 1.15);
    const ailment = o.ailment ?? AILMENT[type];
    target.takeHit({ source: src, skill: 'hazard', tags: ['hazard', 'area', type], damage: { [type]: amount }, crit: false, knockback: o.knockback ?? 3, from: o.from, ailments: ailment ? { [ailment]: 0.35 } : undefined, hitStop: 2 });
  }

  /** A telegraphed circle that lands after `delay`. */
  strike(src: Actor, at: Vector3, radius: number, delay: number, type: DamageType, mult: number, o: { ailment?: AilmentType } = {}): void {
    const tele = makeTelegraph(this.host.root, { shape: 'circle', size: radius, at: 'target' }, at, at, delay, type, src);
    let t = 0;
    let landed = false;
    this.effects.push({
      tele,
      step: (dt) => {
        t += dt;
        tele.t = t;
        if (t < delay) return true;
        if (!landed) {
          landed = true;
          tele.decal?.dispose();
          for (const v of this.victims(src, at, radius)) this.hit(src, v, type, mult, { from: at, ailment: o.ailment });
          const fx = this.host.ctx;
          const p = at.clone().setY(0.3);
          fx.particles.burst(type === 'fire' ? 'fire' : type === 'cold' ? 'frost' : type === 'lightning' ? 'zap' : type === 'chaos' ? 'toxic' : 'impact', p, { scale: Math.max(1, radius / 1.5) });
          fx.particles.burst('dust', p, { scale: Math.max(1, radius / 2) });
          fx.audio.play(type === 'lightning' ? 'zap' : type === 'cold' ? 'ice' : 'explode', { pitch: this.host.rng.range(-2, 1), volume: 0.6 });
          fx.lights.request({ position: [at.x, 1.2, at.z], color: COLOR[type], intensity: 6, radius: radius + 3, lifetime: 0.3, fadeIn: 0.02, priority: 2, name: 'hazard' });
          this.host.shake(Math.min(0.35, 0.08 * radius), 0.15);
        }
        return t < delay + 0.05;
      },
      render: () => tele.decal?.update(Math.min(1, t / Math.max(0.01, delay))),
      dispose: () => tele.decal?.dispose(),
    });
  }

  /** Shockwave rings rolling out from `center`; each ring hits each target once. */
  rings(src: Actor, center: Vector3, count: number, speed: number, gap: number, type: DamageType, slow: number): void {
    const maxR = 13;
    const rings: { start: number; hit: Set<number>; mesh: Mesh }[] = [];
    for (let i = 0; i < count; i++) {
      const mesh = ringDecal(COLOR[type], 0.8);
      mesh.position.set(center.x, 0.06, center.z);
      mesh.visible = false;
      this.host.root.add(mesh);
      rings.push({ start: i * gap, hit: new Set(), mesh });
    }
    let t = 0;
    this.host.ctx.particles.burst('impact', center.clone().setY(0.2), { scale: 2 });
    this.effects.push({
      step: (dt) => {
        t += dt;
        let live = false;
        for (const r of rings) {
          const age = t - r.start;
          const radius = age * speed;
          if (age < 0 || radius > maxR) continue;
          live = true;
          for (const v of this.victims(src, center, radius + H.band)) {
            if (r.hit.has(v.id)) continue;
            const d = Math.hypot(v.position.x - center.x, v.position.z - center.z);
            if (Math.abs(d - radius) > H.band + v.radius) continue;
            r.hit.add(v.id);
            this.hit(src, v, type, 0.9, { from: center, knockback: 5 });
            if (slow > 0) v.addBuff('mud-wave', [inc('move.speed', -slow)], 2);
          }
        }
        return live || t < (count - 1) * gap;
      },
      render: () => {
        for (const r of rings) {
          const age = t - r.start;
          const radius = age * speed;
          r.mesh.visible = age >= 0 && radius <= maxR;
          r.mesh.scale.setScalar(Math.max(0.05, radius + 0.4));
        }
      },
      dispose: () => {
        for (const r of rings) r.mesh.removeFromParent();
      },
    });
  }

  /** A damaging patch of ground (molten trails, ice, thorns). */
  zone(src: Actor, at: Vector3, radius: number, duration: number, type: DamageType, mult: number, ailment?: AilmentType): void {
    // a lasting patch: the telegraph look held calm (rim + stipple), never an opaque disc
    const mesh = createTelegraph({ shape: 'circle', size: radius }, type, 1, { zone: true }).object;
    mesh.position.set(at.x, 0.01, at.z);
    this.host.root.add(mesh);
    let t = 0;
    let tick = 0;
    this.effects.push({
      step: (dt) => {
        t += dt;
        tick -= dt;
        if (tick <= 0) {
          tick = 0.5;
          for (const v of this.victims(src, at, radius)) this.hit(src, v, type, mult, { knockback: 0, ailment });
        }
        return t < duration;
      },
      render: () => {
        mesh.visible = t < duration - 0.6 || Math.floor(t * 12) % 2 === 0;
        if (this.host.rng.next() < 0.08) this.host.ctx.particles.burst(type === 'fire' ? 'ember' : type === 'cold' ? 'frost' : type === 'physical' ? 'thorn' : 'toxic', at.clone().setY(0.2), { count: 1 });
      },
      dispose: () => mesh.removeFromParent(),
    });
  }

  /** Projectiles fired in rotating arms from the source. */
  spiral(src: Actor, arms: number, shots: number, turn: number, type: DamageType): void {
    const per = Math.max(1, Math.round(shots / Math.max(1, arms)));
    const skill = buildSkill(singleBolt(type), [], src.stats);
    let fired = 0;
    let t = 0;
    const base = src.facing;
    this.effects.push({
      step: (dt) => {
        t += dt;
        while (fired < per && t >= fired * 0.16) {
          if (!src.alive) return false;
          for (let a = 0; a < arms; a++) {
            const ang = base + (a / arms) * Math.PI * 2 + fired * turn;
            const aim = this.tmp.set(src.position.x + Math.sin(ang) * 5, src.position.y, src.position.z + Math.cos(ang) * 5);
            this.host.world.combat.cast(src, skill, aim.clone());
          }
          fired++;
        }
        return fired < per;
      },
      dispose: () => {},
    });
  }

  /** A cone of wind from the source toward `toward`: shoves and stings. */
  gust(src: Actor, toward: Vector3, force: number, length: number): void {
    const dir = new Vector3(toward.x - src.position.x, 0, toward.z - src.position.z).normalize();
    for (const v of this.victims(src, src.position, length)) {
      const to = this.tmp.subVectors(v.position, src.position).setY(0);
      const d = to.length();
      if (d > 0.01 && to.dot(dir) / d < Math.cos((35 * Math.PI) / 180)) continue;
      v.push(dir.clone().multiplyScalar(force));
      this.hit(src, v, 'physical', 0.35, { knockback: 0 });
    }
    for (let i = 1; i < length; i += 1.5) this.host.ctx.particles.burst('wind', new Vector3(src.position.x + dir.x * i, 0.8, src.position.z + dir.z * i), { count: 2 });
    this.host.ctx.audio.play('gust');
  }

  /** Everything hostile is dragged toward `center` for a while (optionally collapsing in a blast). */
  pull(src: Actor, center: Vector3, radius: number, force: number, duration: number, collapse: boolean): void {
    const ring = ringDecal(0x5d275d, 0.9);
    ring.position.set(center.x, 0.05, center.z);
    this.host.root.add(ring);
    let t = 0;
    this.effects.push({
      tele: null,
      step: (dt) => {
        t += dt;
        for (const v of this.victims(src, center, radius)) {
          const d = this.tmp.subVectors(center, v.position).setY(0);
          if (d.lengthSq() < 0.04) continue;
          v.push(d.normalize().multiplyScalar(force * 9 * dt));
        }
        if (t >= duration) {
          if (collapse) this.strike(src, center, 3, 0.01, 'chaos', 1.4);
          return false;
        }
        return true;
      },
      render: () => {
        const k = 1 - (t % 0.6) / 0.6;
        ring.scale.setScalar(Math.max(0.2, radius * k));
        if (this.host.rng.next() < 0.3) this.host.ctx.particles.burst('grav', this.near(center, radius * 0.7).setY(0.5), { count: 1 });
      },
      dispose: () => ring.removeFromParent(),
    });
  }

  /** The level goes dark for a while (lanterns gutter, the hero is `inDark`). */
  darkness(duration: number): void {
    const env = this.host.level.env;
    const k = 0.3;
    env.ambient *= k;
    env.sun *= k;
    let t = 0;
    const hero = () => this.host.heroActor();
    this.effects.push({
      step: (dt) => {
        t += dt;
        hero()?.stats.setCondition('inDark', true);
        return t < duration;
      },
      dispose: () => {
        env.ambient /= k;
        env.sun /= k;
        if (!this.host.level.spec.mechanics.includes('gloom')) hero()?.stats.setCondition('inDark', false);
      },
    });
  }

  /** Rotating beams around a monster (elite Arcane Beams, boss Mirror Beams). */
  beams(unit: MonsterUnit, count: number, length: number, speed: number, duration: number, key: string): void {
    const src = unit.actor;
    const lines = Array.from({ length: count }, () => {
      const tele = makeTelegraph(this.host.root, { shape: 'line', size: length, width: 0.45, at: 'self' }, src.position, src.position.clone().add(new Vector3(0, 0, 1)), 0.01, 'lightning', src);
      tele.decal?.update(1);
      return tele;
    });
    let t = 0;
    let tick = 0;
    let angle = src.facing;
    const hit = new Vector3();
    this.effects.push({
      key: key || undefined,
      step: (dt) => {
        t += dt;
        if (!src.alive || t >= duration) return false;
        angle += speed * dt;
        tick -= dt;
        if (tick > 0) return true;
        tick = 0.2;
        for (let b = 0; b < count; b++) {
          const a = angle + (b / count) * Math.PI * 2;
          const dx = Math.sin(a);
          const dz = Math.cos(a);
          for (const v of this.victims(src, src.position, length + 0.5)) {
            hit.subVectors(v.position, src.position).setY(0);
            const along = hit.x * dx + hit.z * dz;
            if (along < 0 || along > length) continue;
            if (Math.abs(hit.x * dz - hit.z * dx) > 0.35 + v.radius) continue;
            this.hit(src, v, 'lightning', 0.3, { knockback: 1 });
          }
        }
        return true;
      },
      render: () => {
        lines.forEach((l, b) => {
          const o = l.decal?.object;
          if (!o) return;
          o.position.set(src.body.position.x, 0.05, src.body.position.z);
          o.rotation.y = angle + (b / count) * Math.PI * 2;
        });
      },
      dispose: () => {
        for (const l of lines) l.decal?.dispose();
      },
    });
  }

  /** Elite auras: chill everything near it, or empower its allies. */
  aura(unit: MonsterUnit, radius: number, effect: string): void {
    const src = unit.actor;
    const ring = ringDecal(effect === 'chill' ? 'cyan' : 'sand', 0.92);
    ring.scale.setScalar(radius);
    this.host.root.add(ring);
    let tick = 0;
    this.effects.push({
      key: `aura:${src.id}`,
      step: (dt) => {
        if (!src.alive) return false;
        tick -= dt;
        if (tick > 0) return true;
        tick = 0.5;
        if (effect === 'chill') for (const v of this.victims(src, src.position, radius)) v.applyAilment({ id: 'chill', magnitude: 0.3, duration: 1 }, src);
        else for (const a of this.host.world.actors.query(src.position, radius, [], (x) => x.alive && x !== src && !isProp(x) && !x.hostileTo(src))) a.addBuff('empowered', [more('damage', 0.25), inc('attack.speed', 0.1)], 1);
        return true;
      },
      render: () => ring.position.set(src.body.position.x, 0.05, src.body.position.z),
      dispose: () => ring.removeFromParent(),
    });
  }
}

