/**
 * Walking the hero to a point, one way for each caller: a click on a thing in the world
 * (`Riftlight.walkTo`) and the agent API's `moveTo` (and `talkTo`, `collectGold`). In town the
 * town's walkable grid (`Town.nav`): the route found again every `TOWN_WALK.replan` steps,
 * steering at a cell `TOWN_WALK.ahead` along it (at the goal itself once close), and a sidestep
 * after some steps bumping into something (a townsperson in the way). In a level the playtest
 * bot's grid route (`PlaytestBot.walk`: rebuilt every 20 steps, a cell or three ahead, a sidestep
 * out of a corner). Plain data (`save` / `load`), so a snapshot keeps a walk in progress.
 */
import { Vector3 } from 'three/webgpu';
import type { NavPoint } from '../town/nav';
import type { Town } from '../town/Town';
import { type BotIntent, type BotNavState, PlaytestBot } from './bot';
import type { LevelHandle } from './ports';

export const TOWN_WALK = {
  /** Steps between finding the route again. */
  replan: 30,
  /** The cell steered at: this many along the route from the one nearest the hero. */
  ahead: 4,
  /** Closer than this (m) the hero steers at the goal itself. */
  near: 1.5,
  /** Steps hardly moving (under `still` m a step) before a sidestep... */
  stuck: 12,
  still: 0.01,
  /** ...of this many steps. */
  side: 30,
} as const;

/** `HeroWalk.save`. */
export interface HeroWalkState {
  readonly steps: number;
  readonly stuck: number;
  readonly side: number;
  readonly last: readonly [number, number, number];
  readonly route: readonly NavPoint[];
  /** The level's walking (the bot's), once it walked in one. */
  readonly level: BotNavState | null;
}

export class HeroWalk {
  private steps = 0;
  private stuck = 0;
  private side = 0;
  /** Where the hero stood the step before. */
  private readonly last = new Vector3();
  private route: NavPoint[] = [];
  /** The level's steering (the bot's grid route), made on the first step in a level. */
  private nav: PlaytestBot | null = null;
  private readonly scratch: BotIntent = { move: { x: 0, z: 0 }, aim: new Vector3(), attack: false, skill: -1, dodge: false, interact: false };

  /** A walk from `from` (the hero's position now). */
  constructor(from: Vector3) {
    this.last.copy(from);
  }

  /**
   * One step from `p` toward `goal` in town: the way to move into `out` (x, z; longer than 1 while
   * it sidesteps: the caller normalises).
   */
  town(town: Town, p: Vector3, goal: Vector3, out: { x: number; z: number }): void {
    const W = TOWN_WALK;
    this.stuck = p.distanceTo(this.last) < W.still ? this.stuck + 1 : 0;
    if (this.stuck > W.stuck) this.side = W.side;
    const k = this.side-- > 0 ? 1 : 0;
    if (this.steps++ % W.replan === 0) this.route = town.nav().route(p, goal);
    // the cell nearest the hero on the route, then a few ahead (or the goal itself, close by)
    const d = Math.hypot(goal.x - p.x, goal.z - p.z);
    let aim: NavPoint = { x: goal.x, z: goal.z };
    const route = this.route;
    if (route.length > 1 && d > W.near) {
      let near = 0;
      for (let i = 1; i < route.length; i++) if (Math.hypot(route[i]!.x - p.x, route[i]!.z - p.z) < Math.hypot(route[near]!.x - p.x, route[near]!.z - p.z)) near = i;
      aim = route[Math.min(route.length - 1, near + W.ahead)]!;
    }
    const ax = aim.x - p.x;
    const az = aim.z - p.z;
    const ad = Math.hypot(ax, az) || 1;
    out.x = ax / ad - (k * az) / ad;
    out.z = az / ad + (k * ax) / ad;
    this.last.copy(p);
  }

  /** One step from `p` toward `goal` in a level (the bot's grid route): the way to move into `out` (unit, or left as it is when there). */
  level(level: LevelHandle, p: Vector3, goal: Vector3, out: { x: number; z: number }): void {
    this.nav ??= new PlaytestBot();
    this.scratch.move = out;
    this.nav.walk(level, p, goal, this.scratch);
  }

  save(): HeroWalkState {
    return { steps: this.steps, stuck: this.stuck, side: this.side, last: [this.last.x, this.last.y, this.last.z], route: this.route.map((c) => ({ x: c.x, z: c.z })), level: this.nav?.saveNav() ?? null };
  }

  static load(s: HeroWalkState): HeroWalk {
    const w = new HeroWalk(new Vector3(...s.last));
    w.steps = s.steps;
    w.stuck = s.stuck;
    w.side = s.side;
    w.route = s.route.map((c) => ({ x: c.x, z: c.z }));
    if (s.level) (w.nav = new PlaytestBot()).loadNav(s.level);
    return w;
  }
}
