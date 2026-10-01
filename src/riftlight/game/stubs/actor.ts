/**
 * STUB (replaced by combat/actors at integration): a minimal `ActorLike` with a StatSheet,
 * life/mana/energy shield, resistances and knockback, plus `strike()`, the one-line hit
 * pipeline the stubs share (mitigate → emit `hit` → emit `kill` / `death`).
 */
import { Vector3 } from 'three/webgpu';
import { StatSheet } from '../../core/mods';
import type { Rank } from '../../core/scaling';
import type { ActorLike, AilmentType, DamageType, Faction, GameEventBus, Hit, HitResult } from '../../core/types';
import { DAMAGE_TYPES } from '../../core/types';

let nextId = 1;

export class StubActor implements ActorLike {
  readonly id = nextId++;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly stats: StatSheet;
  life: number;
  mana: number;
  es = 0;
  level: number;
  /** Seconds left of the white hit flash. */
  flash = 0;
  /** Invulnerable (dodge i-frames, god mode). */
  invulnerable = false;
  rank: Rank = 'normal';
  depth = 1;
  lastHitBy: ActorLike | null = null;

  constructor(
    readonly faction: Faction,
    readonly name: string,
    readonly radius: number,
    base: Readonly<Record<string, number>>,
    level = 1,
  ) {
    this.stats = new StatSheet(base);
    this.level = level;
    this.life = this.maxLife;
    this.mana = this.maxMana;
    this.es = this.maxEs;
  }

  get alive(): boolean {
    return this.life > 0;
  }

  get maxLife(): number {
    return Math.max(1, this.stats.get('life'));
  }

  get maxMana(): number {
    return this.stats.get('mana');
  }

  get maxEs(): number {
    return this.stats.get('es');
  }

  /** Re-read max pools after the sheet changed, keeping the current fractions. */
  rescale(prev: { life: number; mana: number; es: number }): void {
    if (prev.life > 0) this.life = Math.min(this.maxLife, (this.life / prev.life) * this.maxLife);
    if (prev.mana > 0) this.mana = Math.min(this.maxMana, (this.mana / prev.mana) * this.maxMana);
    if (prev.es > 0) this.es = Math.min(this.maxEs, (this.es / prev.es) * this.maxEs);
  }

  takeHit(hit: Hit): HitResult {
    if (!this.alive) return { total: 0, byType: {}, crit: false, killed: false, ailments: [] };
    if (this.invulnerable) return { total: 0, byType: {}, crit: hit.crit, killed: false, evaded: true, ailments: [] };
    const byType: Partial<Record<DamageType, number>> = {};
    let total = 0;
    for (const t of DAMAGE_TYPES) {
      const raw = hit.damage[t] ?? 0;
      if (raw <= 0) continue;
      const res = Math.min(0.75, this.stats.get(`res.${t}`) / 100);
      const taken = raw * (1 - res) * (t === 'physical' ? 100 / (100 + this.stats.get('armour')) : 1);
      byType[t] = taken;
      total += taken;
    }
    // Energy shield soaks everything but chaos first.
    let rest = total;
    const chaos = byType.chaos ?? 0;
    const shieldable = total - chaos;
    const soaked = Math.min(this.es, shieldable);
    this.es -= soaked;
    rest -= soaked;
    this.life = Math.max(0, this.life - rest);
    this.flash = 0.09;
    this.lastHitBy = hit.source;
    if (hit.knockback && hit.from) {
      const away = this.position.clone().sub(hit.from).setY(0);
      if (away.lengthSq() > 1e-6) this.push(away.normalize().multiplyScalar(hit.knockback));
    }
    const ailments: AilmentType[] = [];
    return { total, byType, crit: hit.crit, killed: this.life <= 0, ailments };
  }

  push(impulse: Vector3): void {
    this.velocity.add(impulse);
  }
}

/** The stubs' hit pipeline: apply, then tell everyone through the bus. */
export function strike(events: GameEventBus, target: StubActor, hit: Hit): HitResult {
  const result = target.takeHit(hit);
  if (result.total > 0 || result.evaded) events.emit('hit', { target, result, hit });
  if (result.killed) {
    events.emit('kill', { target, killer: hit.source, rank: target.rank, depth: target.depth });
    events.emit('death', { actor: target });
  }
  return result;
}
