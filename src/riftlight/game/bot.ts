/**
 * The playtest bot: a scripted player that only uses the ports, so it plays the stubs now
 * and the real systems later. Each frame it reads a `BotView` and returns an intent:
 *
 *   1. dodge: a telegraph about to land on it → step out (and roll if the roll is ready);
 *   2. fight: the nearest monster in reach → basic attack + skills when they pay off
 *      (cleave on 2+, nova on 3+, war cry for packs and bosses, dash to close a gap);
 *   3. loot: items and gold nearby → walk over (gold) or walk up and press interact;
 *   4. travel: follow the level's critical path (grid BFS) to the next monster or the exit;
 *   5. exit: when the portal is open, walk in.
 *
 * Deterministic: decisions depend only on the game state, which `Engine.step` advances
 * frame-exactly. `runBot()` drives the game frame by frame and returns a report.
 */
import { Vector3 } from 'three/webgpu';
import type { LayoutLike } from '../core/types';
import { bfs } from './nav';
import type { HeroIntent, HeroPort, LevelHandle, SkillSlotView, WorldLoot } from './ports';

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

export class PlaytestBot {
  private readonly intent: BotIntent = { move: { x: 0, z: 0 }, aim: new Vector3(), attack: false, skill: -1, dodge: false, interact: false };
  private route: { x: number; z: number }[] = [];
  private routeFor = '';
  private routeAge = 0;
  private lastPos = new Vector3();
  private stillFrames = 0;
  private sidestep = 0;
  private sideDir = 1;
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

    // 1. dodge telegraphs about to land on us
    for (const t of v.level.telegraphs()) {
      const d = Math.hypot(p.x - t.at.x, p.z - t.at.z);
      if (d < t.radius + hero.actor.radius + 0.2 && t.remaining < 0.5) {
        const away = new Vector3(p.x - t.at.x, 0, p.z - t.at.z);
        if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
        away.normalize();
        i.move.x = away.x;
        i.move.z = away.z;
        i.aim.copy(p).add(away);
        const dodge = slot(hero.skills(), 'dodge');
        i.dodge = !!dodge && dodge.remaining <= 0 && t.remaining < 0.3;
        return i;
      }
    }

    // 2. fight the nearest monster in reach
    const monsters = v.level.monsters().filter((m) => m.actor.alive);
    let target = null as (typeof monsters)[number] | null;
    let td = Infinity;
    for (const m of monsters) {
      const d = m.actor.position.distanceTo(p);
      if (d < td) {
        td = d;
        target = m;
      }
    }
    const skills = hero.skills();
    const ready = (s: number) => {
      const k = slot(skills, s);
      return !!k && k.id !== null && k.remaining <= 0 && k.usable;
    };
    if (target && td < 9) {
      const tp = target.actor.position;
      i.aim.copy(tp);
      const reach = 1.7 + target.actor.radius;
      const near = (r: number) => monsters.filter((m) => m.actor.position.distanceTo(p) < r).length;
      if (td <= reach) {
        i.attack = true;
        if (ready(3) && (near(5) >= 3 || target.rank === 'boss')) i.skill = 3;
        else if (ready(1) && near(4) >= 3) i.skill = 1;
        else if (ready(0) && near(2.6) >= 2) i.skill = 0;
        else if (ready(0) && target.rank !== 'normal') i.skill = 0;
        return i;
      }
      if (ready(2) && td > 4 && td < 7 && this.lineOfSight(v.level, p, tp)) i.skill = 2;
      this.goTo(v.level, p, tp, i);
      return i;
    }

    // 3. loot
    let best: WorldLoot | null = null;
    let bd = 8;
    for (const l of v.loot) {
      if (l.filtered) continue;
      const d = Math.hypot(l.position.x - p.x, l.position.z - p.z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    if (best) {
      if (best.drop.kind === 'item' && bd < 1.5) i.interact = true;
      else this.goTo(v.level, p, best.position, i);
      i.aim.copy(best.position);
      return i;
    }

    // 4./5. travel: the next monster anywhere, else the exit
    const goal = target ? target.actor.position : v.level.exit;
    this.goTo(v.level, p, goal, i);
    i.aim.copy(goal);
    if (!target && v.level.exitOpen && p.distanceTo(v.level.exit) < 2) i.interact = true;
    return i;
  }

  private track(p: Vector3): void {
    if (p.distanceTo(this.lastPos) < 0.02) this.stillFrames++;
    else this.stillFrames = 0;
    this.lastPos.copy(p);
  }

  /** Walk toward `to` along a grid route (rebuilt every 20 frames or when the goal moves). */
  private goTo(level: LevelHandle, p: Vector3, to: Vector3, i: BotIntent): void {
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
    // aim at a cell a few steps ahead (smooths corners)
    let next = { x: to.x, z: to.z };
    if (this.route.length > 1) {
      let k = this.route.findIndex((c) => c.x === from.x && c.z === from.z);
      if (k < 0) k = 0;
      const c = this.route[Math.min(this.route.length - 1, k + 3)]!;
      next = { x: c.x + 0.5 + o.x, z: c.z + 0.5 + o.z };
      if (k + 3 >= this.route.length - 1) next = { x: to.x, z: to.z };
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
