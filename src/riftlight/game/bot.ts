/**
 * The playtest bot: a scripted player that only uses the ports, so it plays the stubs and the
 * real systems alike. Each frame it reads a `BotView` and returns an intent:
 *
 *   1. dodge: a telegraph about to land on it → step out of it (sideways out of lines and
 *      cones, away from circles) and roll when it is close; plain swings (`soft`) are traded
 *      unless life is low;
 *   2. recover: low on life → back away from the pack, firing ranged skills while it regens;
 *   3. fight: the nearest monster (the boss when it is near) → skills by their tags (areas
 *      on groups, ranged at range, gap closers, finishers on elites), the basic combo in reach;
 *   4. loot: items and gold nearby → walk over (gold) or walk up and press interact;
 *   5. travel: follow the level's critical path (grid BFS) to the next monster or the exit;
 *   6. exit: when the portal is open, walk in.
 *
 * Deterministic: decisions depend only on the game state, which `Engine.step` advances
 * frame-exactly. `runBot()` drives the game frame by frame and returns a report.
 */
import { Vector3 } from 'three/webgpu';
import type { LayoutLike } from '../core/types';
import { bfs } from './nav';
import type { HeroIntent, HeroPort, LevelHandle, MonsterHandle, SkillSlotView, Telegraph, WorldLoot } from './ports';

/** A mutable intent (the bot rewrites one object every frame). */
export interface BotIntent extends HeroIntent {
  move: { x: number; z: number };
  attack: boolean;
  skill: number;
  dodge: boolean;
  interact: boolean;
}

export interface BotView {
  hero: HeroPort;
  level: LevelHandle;
  loot: readonly WorldLoot[];
  frame: number;
}

export interface BotReport {
  depth: number;
  cleared: boolean;
  /** Seconds of game time to clear (or until the run ended). */
  time: number;
  frames: number;
  deaths: number;
  damageTaken: number;
  kills: number;
  xp: number;
  gold: number;
  items: number;
  stuck: number;
  outcome: 'cleared' | 'died' | 'timeout';
}

export interface BotOptions {
  /** Use skills (default true); false = basic attack only. */
  skills?: boolean;
  /** Walk to loot (default true). */
  loot?: boolean;
  /** Head for the exit when nothing is left (default true). */
  exit?: boolean;
  /** Dodge telegraphs (default true). */
  dodge?: boolean;
}

/** How the bot reads a skill (from its tags; the stub skills by their ids). */
type Role = 'area' | 'nova' | 'ranged' | 'gap' | 'buff' | 'none';

function roleOf(s: SkillSlotView): Role {
  const t = s.tags;
  if (!t) return s.id === 'cleave' ? 'area' : s.id === 'nova' ? 'nova' : s.id === 'dash' ? 'gap' : s.id === 'warcry' ? 'buff' : 'none';
  if (t.includes('movement')) return 'gap';
  if (t.includes('nova')) return 'nova';
  if (t.includes('projectile') || t.includes('chain')) return 'ranged';
  if (t.includes('area') || t.includes('strike')) return 'area';
  if (t.includes('buff') || t.includes('warcry') || t.includes('aura')) return 'buff';
  return 'none';
}

export class PlaytestBot {
  constructor(private readonly o: BotOptions = {}) {}

  private readonly intent: BotIntent = { move: { x: 0, z: 0 }, aim: new Vector3(), attack: false, skill: -1, dodge: false, interact: false };
  private route: { x: number; z: number }[] = [];
  private routeFor = '';
  private routeAge = 0;
  private lastPos = new Vector3();
  private stillFrames = 0;
  private sidestep = 0;
  private sideDir = 1;
  /** Frames left of steering cell by cell after a corner stopped us. */
  private careful = 0;
  private recovering = false;
  /** Monsters it could not reach, until this frame. */
  private readonly blocked = new Map<number, number>();
  private chase: { id: number; best: number; since: number } | null = null;
  private frame = 0;
  /** Frames spent trying to pick each drop up. */
  private readonly tried = new Map<number, number>();
  stuckCount = 0;

  decide(v: BotView): BotIntent {
    const i = this.intent;
    const hero = v.hero;
    const p = hero.actor.position;
    i.attack = false;
    i.skill = -1;
    i.dodge = false;
    i.interact = false;
    i.move.x = i.move.z = 0;
    this.track(p);
    this.frame++;
    const vit = hero.vitals?.();
    const life = vit ? vit.life / Math.max(1, vit.maxLife) : 1;
    const skills = hero.skills();

    // 1. dodge telegraphs about to land on us
    if (this.o.dodge !== false) {
      const esc = this.escape(v.level.telegraphs(), p, hero.actor.radius, life);
      if (esc) {
        i.move.x = esc.dir.x;
        i.move.z = esc.dir.z;
        i.aim.copy(p).add(esc.dir);
        const roll = slot(skills, 'dodge');
        i.dodge = !!roll && roll.remaining <= 0 && roll.usable !== false && esc.remaining < 0.3;
        return i;
      }
    }

    const monsters = v.level.monsters().filter((m) => m.actor.alive);
    const near = (r: number, from = p) => monsters.filter((m) => m.actor.position.distanceTo(from) < r + m.actor.radius).length;
    let target: MonsterHandle | null = null;
    let td = Infinity;
    for (const m of monsters) {
      if ((this.blocked.get(m.actor.id) ?? -1) > this.frame) continue; // can't get to it (across a pit): later
      const d = m.actor.position.distanceTo(p) - (m.rank === 'boss' ? 3 : 0); // bosses first when close
      if (d < td) {
        td = d;
        target = m;
      }
    }
    if (target) td = target.actor.position.distanceTo(p);
    this.watchProgress(target, td);
    const ready = (s: SkillSlotView | undefined) => this.o.skills !== false && !!s && s.id !== null && s.remaining <= 0 && s.usable;
    const bar = [0, 1, 2, 3].map((n) => slot(skills, n)).filter((s): s is SkillSlotView => !!s && !!s.id);
    const pick = (role: Role) => bar.find((s) => roleOf(s) === role && ready(s));

    // 2. low on life: back off, keep shooting; grab a health globe when one is close
    this.recovering = this.recovering ? life < 0.7 : life < 0.32;
    if (life < 0.75) {
      let globe: Vector3 | null = null;
      let gd = this.recovering ? 14 : 6;
      for (const g of v.level.pickups?.() ?? []) {
        const d = Math.hypot(g.x - p.x, g.z - p.z);
        if (d < gd) {
          gd = d;
          globe = g;
        }
      }
      if (globe) {
        this.goTo(v.level, p, globe, i);
        if (target) {
          i.aim.copy(target.actor.position);
          i.attack = td < 2.2;
        }
        return i;
      }
    }
    if (target && this.recovering && td < 7 && monsters.length) {
      const away = new Vector3();
      for (const m of monsters) {
        const d = m.actor.position.distanceTo(p);
        if (d < 8) away.add(new Vector3(p.x - m.actor.position.x, 0, p.z - m.actor.position.z).divideScalar(Math.max(0.5, d * d)));
      }
      if (away.lengthSq() > 1e-6) {
        away.normalize();
        // don't back into walls: slide along them
        const ahead = new Vector3(p.x + away.x * 1.2, 0, p.z + away.z * 1.2);
        if (!this.open(v.level, ahead)) away.set(-away.z, 0, away.x);
        i.move.x = away.x;
        i.move.z = away.z;
        i.aim.copy(target.actor.position);
        const ranged = pick('ranged');
        const nova = pick('nova');
        if (ranged && td > 2.5) i.skill = ranged.slot as number;
        else if (nova && td < 3.5) i.skill = nova.slot as number;
        return i;
      }
    }

    // 3. fight the nearest monster in reach
    if (target && td < 10 && !(v.level.exitOpen && this.o.exit !== false && td > 6)) {
      const tp = target.actor.position;
      i.aim.copy(tp);
      const reach = 1.7 + target.actor.radius;
      const elite = target.rank !== 'normal';
      const use = (s: SkillSlotView | undefined) => {
        if (s) i.skill = s.slot as number;
      };
      // in reach and not around a wall corner (a swing there hits the wall: step round first)
      const sight = this.lineOfSight(v.level, p, tp);
      if (td <= reach + 0.6 && sight) {
        i.attack = true;
        const nova = pick('nova');
        const area = pick('area');
        const buff = pick('buff');
        if (buff && (near(6) >= 3 || target.rank === 'boss')) use(buff);
        else if (nova && (near(3.6) >= 3 || (elite && near(3.6) >= 1 && life < 0.6))) use(nova);
        else if (area && (near(3) >= 2 || elite)) use(area);
        if (td <= reach) return i;
      }
      const ranged = pick('ranged');
      const gap = pick('gap');
      if (gap && td > 3.5 && td < 7.5 && sight && life > 0.45) use(gap);
      else if (ranged && td > 2.5 && td < 11 && sight) use(ranged);
      if (td > reach || !sight) this.goTo(v.level, p, tp, i);
      return i;
    }

    // 4. loot
    let best: WorldLoot | null = null;
    let bd = 8;
    for (const l of this.o.loot === false ? [] : v.loot) {
      if (l.filtered || (this.tried.get(l.id) ?? 0) > 240) continue; // 4 s on one drop (bag full, out of reach): leave it
      const d = Math.hypot(l.position.x - p.x, l.position.z - p.z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    if (best) {
      this.tried.set(best.id, (this.tried.get(best.id) ?? 0) + 1);
      if (best.drop.kind === 'item' && bd < 1.5) {
        i.interact = true;
      }
      else this.goTo(v.level, p, best.position, i);
      i.aim.copy(best.position);
      return i;
    }

    // 5./6. travel: toward the exit (the boss guards it), fighting what is on the way; a bot
    // told not to leave (`fight`) hunts every monster instead. Once the portal is open,
    // stragglers far away are left behind: a player walks out.
    if (!target && this.o.exit === false) return i;
    const hunt = this.o.exit === false || td < 14;
    const leave = v.level.exitOpen && this.o.exit !== false && (!target || td > 8);
    const goal = target && hunt && !leave ? target.actor.position : v.level.exit;
    this.goTo(v.level, p, goal, i);
    i.aim.copy(goal);
    if ((!target || leave) && v.level.exitOpen && p.distanceTo(v.level.exit) < 2) i.interact = true;
    return i;
  }

  /** A target we chase for 4 s without getting 0.5 m closer (out of reach, kiting us over a pit) is skipped for a while. */
  private watchProgress(target: MonsterHandle | null, d: number): void {
    if (!target) return void (this.chase = null);
    const c = this.chase;
    if (!c || c.id !== target.actor.id) return void (this.chase = { id: target.actor.id, best: d, since: this.frame });
    if (d < c.best - 0.5) {
      c.best = d;
      c.since = this.frame;
    } else if (d > 2.6 && this.frame - c.since > 240) {
      this.blocked.set(c.id, this.frame + 600);
      this.chase = null;
    }
  }

  /** The way out of the telegraph that lands soonest on us, or null when we're safe. */
  private escape(tels: readonly Telegraph[], p: Vector3, r: number, life: number): { dir: Vector3; remaining: number } | null {
    let best: { dir: Vector3; remaining: number } | null = null;
    for (const t of tels) {
      const soft = t.soft === true;
      if (soft && life > 0.45) continue; // a plain swing: trade blows
      if (t.remaining > (soft ? 0.45 : 0.7)) continue;
      const dir = this.outOf(t, p, r);
      if (!dir) continue;
      if (!best || t.remaining < best.remaining) best = { dir, remaining: t.remaining };
    }
    return best;
  }

  /** Direction out of a telegraph if `p` is inside it (with a margin), else null. */
  private outOf(t: Telegraph, p: Vector3, r: number): Vector3 | null {
    const m = r + 0.3;
    if ((t.kind === 'line' || t.kind === 'cone') && t.dir && t.length) {
      const sx = t.kind === 'line' ? t.at.x - (t.dir.x * t.length) / 2 : t.at.x;
      const sz = t.kind === 'line' ? t.at.z - (t.dir.z * t.length) / 2 : t.at.z;
      const dx = p.x - sx;
      const dz = p.z - sz;
      const along = dx * t.dir.x + dz * t.dir.z;
      const side = dx * -t.dir.z + dz * t.dir.x;
      if (along < -m || along > t.length + m) return null;
      if (t.kind === 'line') {
        if (Math.abs(side) > (t.width ?? 1) / 2 + m) return null;
      } else {
        const half = (((t.width ?? 90) / 2) * Math.PI) / 180;
        if (Math.abs(Math.atan2(side, Math.max(0.01, along))) > half + 0.15) return null;
      }
      const s = side >= 0 ? 1 : -1;
      return new Vector3(-t.dir.z * s, 0, t.dir.x * s);
    }
    const d = Math.hypot(p.x - t.at.x, p.z - t.at.z);
    if (d > t.radius + m) return null;
    const away = new Vector3(p.x - t.at.x, 0, p.z - t.at.z);
    if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
    return away.normalize();
  }

  private open(level: LevelHandle, at: Vector3): boolean {
    return level.layout.cell(Math.floor(at.x - level.origin.x), Math.floor(at.z - level.origin.z)) === 1;
  }

  private track(p: Vector3): void {
    if (p.distanceTo(this.lastPos) < 0.02) this.stillFrames++;
    else this.stillFrames = 0;
    this.lastPos.copy(p);
  }

  /** One frame of walking toward `to` outside `decide` (the `moveTo` helper): watches for corners too. */
  walk(level: LevelHandle, p: Vector3, to: Vector3, i: BotIntent): void {
    this.track(p);
    this.goTo(level, p, to, i);
  }

  /** Walk toward `to` along a grid route (rebuilt every 20 frames or when the goal moves). */
  goTo(level: LevelHandle, p: Vector3, to: Vector3, i: BotIntent): void {
    if (this.sidestep > 0) {
      this.sidestep--;
      const d = new Vector3(to.x - p.x, 0, to.z - p.z).normalize();
      i.move.x = -d.z * this.sideDir;
      i.move.z = d.x * this.sideDir;
      return;
    }
    if (this.stillFrames > 45) {
      this.stillFrames = 0;
      this.sidestep = 24;
      this.sideDir = -this.sideDir;
      this.stuckCount++;
      this.routeAge = 999;
    }
    const L = level.layout;
    const o = level.origin;
    const from = { x: Math.floor(p.x - o.x), z: Math.floor(p.z - o.z) };
    const goal = { x: Math.floor(to.x - o.x), z: Math.floor(to.z - o.z) };
    const key = `${goal.x},${goal.z}`;
    this.routeAge++;
    if (key !== this.routeFor || this.routeAge > 20 || !this.route.length) {
      this.route = walkable(L, from) && walkable(L, goal) ? bfs(L, from, goal) : [];
      this.routeFor = key;
      this.routeAge = 0;
    }
    // aim at a cell a few steps ahead (smooths corners); when that cuts a corner we can't
    // pass (no progress), aim at the very next cell instead
    let next = { x: to.x, z: to.z };
    if (this.route.length > 1) {
      let k = this.route.findIndex((c) => c.x === from.x && c.z === from.z);
      if (k < 0) k = 0;
      // (stays careful for a while: flipping back to the far cell walks into the same corner)
      if (this.stillFrames > 6) this.careful = 40;
      const ahead = this.careful > 0 ? 1 : 3;
      if (this.careful > 0) this.careful--;
      const c = this.route[Math.min(this.route.length - 1, k + ahead)]!;
      next = { x: c.x + 0.5 + o.x, z: c.z + 0.5 + o.z };
      if (k + ahead >= this.route.length - 1 && ahead > 1) next = { x: to.x, z: to.z };
    }
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) {
      i.move.x = dx / len;
      i.move.z = dz / len;
    }
  }

  private lineOfSight(level: LevelHandle, a: Vector3, b: Vector3): boolean {
    const n = Math.ceil(a.distanceTo(b) * 2);
    for (let k = 1; k < n; k++) {
      const x = Math.floor(a.x + ((b.x - a.x) * k) / n - level.origin.x);
      const z = Math.floor(a.z + ((b.z - a.z) * k) / n - level.origin.z);
      if (level.layout.cell(x, z) !== 1) return false;
    }
    return true;
  }
}

function walkable(L: LayoutLike, c: { x: number; z: number }): boolean {
  return L.cell(c.x, c.z) === 1;
}

function slot(skills: readonly SkillSlotView[], s: number | 'attack' | 'dodge'): SkillSlotView | undefined {
  return skills.find((k) => k.slot === s);
}
