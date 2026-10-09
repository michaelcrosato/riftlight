/**
 * Bullets as data: a pool of thousands of projectiles (position, velocity, life, radius,
 * team, kind) simulated without allocations, and emitters that fire patterns (an aimed
 * fan, a ring, a spiral, a sweeping wave, a burst) on a timer. Hits are circle tests on the
 * ground plane against targets; walls are a callback (a NavGrid's `walkable`). Pure and
 * seeded; drawn by any instanced mesh. The Bullet Hell room is built on it.
 *
 *   const pool = new BulletPool(4000);
 *   const turret = emitter({ pattern: 'spiral', every: 0.08, count: 3, speed: 5, turn: 11 });
 *   // per fixed step:
 *   turret.update(pool, dt, [x, z], aimAt);
 *   pool.step(dt, (x, z) => nav.walkable(x, z));
 *   const hit = pool.hits(heroX, heroZ, 0.12, 'enemy');   // indices of bullets touching
 */
import { seeded } from '../physics/fracture';

export type Team = 'enemy' | 'player';

export class BulletPool {
  readonly capacity: number;
  /** x, z, vx, vz per bullet. */
  readonly state: Float32Array;
  readonly life: Float32Array;
  readonly radius: Float32Array;
  /** 0 enemy, 1 player. */
  readonly team: Uint8Array;
  /** A small number games use for the look (colour, size). */
  readonly kind: Uint8Array;
  /** 1 once a bullet has been grazed (counted by `graze`), so each counts once. */
  readonly grazed: Uint8Array;
  /** Live bullets are 0 .. alive − 1 (dead ones are swapped to the end). */
  alive = 0;
  /** Bullets that hit a wall last step (x, z pairs), for sparks. */
  readonly sparks: number[] = [];
  fired = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.state = new Float32Array(capacity * 4);
    this.life = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.team = new Uint8Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.grazed = new Uint8Array(capacity);
  }

  fire(x: number, z: number, vx: number, vz: number, o: { life?: number; radius?: number; team?: Team; kind?: number } = {}): number {
    if (this.alive >= this.capacity) return -1;
    const i = this.alive++;
    const k = i * 4;
    this.state[k] = x;
    this.state[k + 1] = z;
    this.state[k + 2] = vx;
    this.state[k + 3] = vz;
    this.life[i] = o.life ?? 6;
    this.radius[i] = o.radius ?? 0.12;
    this.team[i] = o.team === 'player' ? 1 : 0;
    this.kind[i] = o.kind ?? 0;
    this.grazed[i] = 0;
    this.fired++;
    return i;
  }

  kill(i: number): void {
    if (i < 0 || i >= this.alive) return;
    const last = --this.alive;
    if (i === last) return;
    this.state.copyWithin(i * 4, last * 4, last * 4 + 4);
    this.life[i] = this.life[last]!;
    this.radius[i] = this.radius[last]!;
    this.team[i] = this.team[last]!;
    this.kind[i] = this.kind[last]!;
    this.grazed[i] = this.grazed[last]!;
  }

  /**
   * Kill several (indices from `hits`): highest first, since a kill moves the last live
   * bullet into the gap and would otherwise shift an index still to come.
   */
  killAll(indices: number[]): void {
    indices.sort((a, b) => b - a);
    let prev = -1;
    for (const i of indices) {
      if (i !== prev) this.kill(i); // each once, however often it is listed
      prev = i;
    }
  }

  clear(): void {
    this.alive = 0;
  }

  /** Move every bullet; ones whose life runs out or that hit a wall (`open(x, z)` false) die. */
  step(dt: number, open?: (x: number, z: number) => boolean): void {
    this.sparks.length = 0;
    for (let i = this.alive - 1; i >= 0; i--) {
      const k = i * 4;
      const x = (this.state[k] = this.state[k]! + this.state[k + 2]! * dt);
      const z = (this.state[k + 1] = this.state[k + 1]! + this.state[k + 3]! * dt);
      this.life[i] = this.life[i]! - dt;
      if (this.life[i]! <= 0) this.kill(i);
      else if (open && !open(x, z)) {
        this.sparks.push(x, z);
        this.kill(i);
      }
    }
  }

  /** Indices of live bullets of `team` within `r` of (x, z), each tested as a circle. */
  hits(x: number, z: number, r: number, team: Team, out: number[] = []): number[] {
    out.length = 0;
    const t = team === 'player' ? 1 : 0;
    for (let i = 0; i < this.alive; i++) {
      if (this.team[i] !== t) continue;
      const dx = this.state[i * 4]! - x;
      const dz = this.state[i * 4 + 1]! - z;
      const rr = r + this.radius[i]!;
      if (dx * dx + dz * dz < rr * rr) out.push(i);
    }
    return out;
  }

  /** Bullets within `r` of a point, of `team` or any (bombs, danger meters). */
  near(x: number, z: number, r: number, team?: Team): number {
    let n = 0;
    const t = team === undefined ? -1 : team === 'player' ? 1 : 0;
    for (let i = 0; i < this.alive; i++) {
      if (t >= 0 && this.team[i] !== t) continue;
      const dx = this.state[i * 4]! - x;
      const dz = this.state[i * 4 + 1]! - z;
      if (dx * dx + dz * dz < r * r) n++;
    }
    return n;
  }
  /**
   * Grazes: bullets of `team` within `r` of (x, z) not counted before. Each bullet grazes
   * once (shoot-'em-ups score the near misses); call it after the hit test, so a bullet that
   * hits is gone and never grazes.
   */
  graze(x: number, z: number, r: number, team: Team): number {
    let n = 0;
    const t = team === 'player' ? 1 : 0;
    for (let i = 0; i < this.alive; i++) {
      if (this.team[i] !== t || this.grazed[i]) continue;
      const dx = this.state[i * 4]! - x;
      const dz = this.state[i * 4 + 1]! - z;
      if (dx * dx + dz * dz < r * r) {
        this.grazed[i] = 1;
        n++;
      }
    }
    return n;
  }

}

export type Pattern = 'aimed' | 'fan' | 'ring' | 'spiral' | 'wave' | 'burst';

export interface PatternDef {
  pattern: Pattern;
  /** Seconds between volleys. */
  every: number;
  /** Bullets per volley (arms of a spiral, the size of a ring or fan). */
  count?: number;
  /** Spread of a fan or a burst (degrees). */
  spread?: number;
  speed?: number;
  /** Spiral and wave: degrees turned per volley. */
  turn?: number;
  /** Wave: half the sweep (degrees) and its period (s). */
  sweep?: number;
  period?: number;
  life?: number;
  radius?: number;
  kind?: number;
  team?: Team;
  /** Seconds before the first volley. */
  delay?: number;
  seed?: number;
}

export interface Emitter {
  readonly def: PatternDef;
  /** Volleys fired. */
  volleys: number;
  enabled: boolean;
  /** Fire due volleys from (x, z); `aim` is what aimed patterns turn toward. */
  update(pool: BulletPool, dt: number, at: readonly [number, number], aim?: readonly [number, number] | null): void;
}

/** An emitter for a pattern (pure: the same volleys every run). */
export function emitter(def: PatternDef): Emitter {
  const rand = seeded(def.seed ?? 7);
  let clock = -(def.delay ?? 0);
  let angle = 0;
  const deg = Math.PI / 180;
  const e: Emitter = {
    def,
    volleys: 0,
    enabled: true,
    update(pool, dt, at, aim) {
      if (!e.enabled) return;
      const every = Math.max(0.01, def.every); // 0 or less would never stop firing
      clock += dt;
      // a long hitch fires a few catch-up volleys, not hundreds from one spot
      for (let k = 0; clock >= every && k < 8; k++) {
        clock -= every;
        volley(pool, at, aim);
        e.volleys++;
      }
      clock = Math.min(clock, every);
    },
  };
  const shoot = (pool: BulletPool, at: readonly [number, number], a: number, speed: number) =>
    pool.fire(at[0], at[1], Math.sin(a) * speed, Math.cos(a) * speed, { life: def.life, radius: def.radius, team: def.team, kind: def.kind });
  const volley = (pool: BulletPool, at: readonly [number, number], aim?: readonly [number, number] | null) => {
    const n = Math.max(1, def.count ?? 1);
    const speed = def.speed ?? 5;
    const toward = aim ? Math.atan2(aim[0] - at[0], aim[1] - at[1]) : 0;
    switch (def.pattern) {
      case 'aimed':
        for (let i = 0; i < n; i++) shoot(pool, at, toward, speed * (1 - (0.5 * i) / Math.max(1, n - 1))); // a short stream: full speed down to half
        break;
      case 'fan': {
        const s = (def.spread ?? 50) * deg;
        for (let i = 0; i < n; i++) shoot(pool, at, toward + (n === 1 ? 0 : -s / 2 + (s * i) / (n - 1)), speed);
        break;
      }
      case 'ring':
        angle += (def.turn ?? 0) * deg;
        for (let i = 0; i < n; i++) shoot(pool, at, angle + (i / n) * Math.PI * 2, speed);
        break;
      case 'spiral':
        angle += (def.turn ?? 12) * deg;
        for (let i = 0; i < n; i++) shoot(pool, at, angle + (i / n) * Math.PI * 2, speed);
        break;
      case 'wave': {
        const t = e.volleys * Math.max(0.01, def.every);
        const a = toward + Math.sin((t / (def.period ?? 2)) * Math.PI * 2) * (def.sweep ?? 50) * deg;
        for (let i = 0; i < n; i++) shoot(pool, at, a + (i - (n - 1) / 2) * 0.12, speed);
        break;
      }
      case 'burst': {
        const s = (def.spread ?? 360) * deg;
        for (let i = 0; i < n; i++) shoot(pool, at, toward + (rand() - 0.5) * s, speed * (0.6 + rand() * 0.6));
        break;
      }
    }
  };
  return e;
}
