/**
 * A shared world (docs/game/session.md): every player in one level, run by the host's copy.
 *
 * - **The host** runs the level for real, with a hero for every player: its own, driven by its
 *   player, and the others' (`RemoteHero` over a real hero in the level's combat world), driven by
 *   the steps their copies send. It tells the others what they can't work out themselves: about
 *   ten times a second a frame of the world (where each monster is and its life, each hero's life,
 *   the kills, the damage numbers), and as they happen the monsters' skills and telegraphs, the adds
 *   that join and the deaths.
 * - **A client** builds the same level from the same seed (the same monsters, ids and all), then
 *   makes every monster a puppet of the host's (no brain; hits show but take no life; it walks to
 *   where the host says and starts what the host starts), and its own hero takes its life and its
 *   death from the host. Its hero still moves at once under its player (the client decides where it
 *   stands; the host's copy follows), so the controls feel local.
 *
 * Every copy sends its own hero, one `HeroStep` per fixed step (as in ghost mode). The host reports
 * the round: a team win when the boss falls, a loss at time-up; standings by kills.
 */
import { Vector3 } from 'three/webgpu';
import type { GameContext, HubPlayer, HubSession } from '../../engine';
import { lerpAngle, RemoteTrack } from '../../engine';
import type { Actor } from '../actors/Actor';
import type { ActorLike, Genome } from '../core/types';
import type { HeroIntent, HeroPort } from '../game/ports';
import type { TelegraphSpec } from '../monsters';
import type { UiCanvas } from '../ui/kit';
import { project } from '../ui/world';
import type { LevelStage } from '../wire/levels';
import type { MonsterObserver, MonsterUnit } from '../wire/monsters';
import { heroStep, IDLE, isHeroStep, RemoteHero } from './remote';
import type { RoundMode } from './round';
import type { Camera } from 'three/webgpu';

/** What a shared world needs of the game shell. */
export interface SharedShell {
  readonly ctx: GameContext;
  /** This copy's hero (on a server: a stand-in, hidden and out of the fight). */
  readonly hero: HeroPort;
  readonly dead: boolean;
  /** The level now on, as built (the real level stage). */
  stageNow(): LevelStage | null;
  /** A hero for another player in the level, at its start: a fighter here (the host), or a phantom (a client). */
  teammate(fighter: boolean): Promise<HeroPort | null>;
  /** A damage number over a spot (a client: the host's numbers). */
  number(at: Vector3, total: number, crit: boolean): void;
  /** This copy's hero was hit for `total` (a client: what the host says). */
  hurtBy(total: number): void;
}

// ------------------------------------------------------------------ the wire

/** A frame of the world: [t, monsters [[id, x, z, facing, life ‰]], heroes [[player, life ‰, dead, deaths]], kills [[player, n]], numbers [[id, total, crit]]]. */
type WorldFrame = [number, number[][], number[][], number[][], number[][]];

/** What the host sends, besides its own hero's steps. */
interface HostMessage {
  /** A frame of the world. */
  readonly w?: WorldFrame;
  /** A monster started a skill: [id, skill, x, y, z]. */
  readonly a?: [number, string, number, number, number];
  /** A telegraph went down: [id, spec, from x, z, to x, z, seconds]. */
  readonly g?: [number, TelegraphSpec, number, number, number, number, number];
  /** An add joined: [id, genome, x, z]. */
  readonly s?: [number, Genome, number, number];
  /** A monster died. */
  readonly d?: number;
}

/** Fixed steps between two frames of the world (six: ten a second). */
const FRAME_EVERY = 6;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The players by kills, ties together: the hub's standings. */
export function killStandings(players: readonly number[], kills: ReadonlyMap<number, number>): number[][] {
  const by = new Map<number, number[]>();
  for (const id of players) {
    const k = kills.get(id) ?? 0;
    by.set(k, [...(by.get(k) ?? []), id]);
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids);
}

// ------------------------------------------------------------------ both sides

abstract class SharedWorld implements RoundMode {
  readonly remotes = new Map<number, RemoteHero>();
  /** Kills by player. */
  readonly kills = new Map<number, number>();
  protected steps = 0;

  constructor(
    protected readonly session: HubSession,
    protected readonly host: SharedShell,
    players: readonly HubPlayer[],
    fighters: boolean,
  ) {
    for (const p of players) if (p.id !== session.me) this.addRemote(p, fighters);
  }

  protected addRemote(p: HubPlayer, fighter: boolean): void {
    const remote = new RemoteHero(p.id, p.name, p.color);
    this.remotes.set(p.id, remote);
    void this.host.teammate(fighter).then((hero) => {
      if (!hero) return;
      if (this.remotes.get(p.id) !== remote) return hero.dispose();
      remote.attach(hero, { see: false });
    });
  }

  /** Our hero's step to everyone (a server has none); the others' heroes play on here. */
  fixedUpdate(dt: number, intent?: HeroIntent): void {
    const now = this.host.ctx.time;
    if (intent && !this.session.server) this.session.send({ h: heroStep(now, intent, this.host.hero, this.host.dead) });
    for (const r of this.remotes.values()) r.fixedUpdate(dt, now);
    this.steps++;
  }

  update(dt: number): void {
    const now = this.host.ctx.time;
    for (const r of this.remotes.values()) r.update(dt, now);
  }

  message(data: unknown, from: number): void {
    const step = (data as { h?: unknown } | null)?.h;
    if (isHeroStep(step)) this.remotes.get(from)?.receive(step, this.host.ctx.time);
  }

  leave(id: number): void {
    const r = this.remotes.get(id);
    // a player who leaves takes their hero along: down first, so nothing goes on chasing it
    const a = r?.hero?.actor as Actor | undefined;
    if (a?.alive) a.die(null, true);
    r?.dispose();
    this.remotes.delete(id);
  }

  private wait = 0;

  /** Before play: where our hero stands, ten times a second (a host: the world too). */
  waiting(dt: number): void {
    this.wait += dt;
    if (this.wait < 0.1) return;
    this.wait = 0;
    if (!this.session.server) this.session.send({ h: heroStep(this.host.ctx.time, IDLE, this.host.hero, this.host.dead) });
    this.idle();
  }

  /** What a side sends besides its hero before play (the host: a frame of the world). */
  protected idle(): void {}

  /** Each other player's name over their hero, in their colour. */
  draw(ui: UiCanvas, camera: Camera): void {
    const now = this.host.ctx.time;
    for (const r of this.remotes.values()) {
      if (!r.hero || !r.shown(now)) continue;
      const at = project(r.hero.actor.position.clone().setY(r.hero.actor.position.y + 2.3), camera, ui);
      if (at) ui.text(at.x, at.y, r.name, { align: 'center', color: parseInt(r.color.slice(1), 16), shadow: 'ink' });
    }
  }

  dispose(): void {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }
}

// ------------------------------------------------------------------ the host

/** The host's copy: the real world, told to everyone else. */
export class HostWorld extends SharedWorld implements MonsterObserver {
  private readonly owner = new Map<ActorLike, number>();
  /** Each player's hero's deaths, and whether it was up at the last frame (a client applies each death once). */
  private readonly downs = new Map<number, { deaths: number; up: boolean }>();
  private numbers = new Map<number, [number, number]>();
  private readonly offs: (() => void)[] = [];

  constructor(session: HubSession, host: SharedShell, players: readonly HubPlayer[]) {
    super(session, host, players, true);
    const stage = host.stageNow();
    if (stage) {
      stage.observer = this;
      stage.noDrops = true;
    }
    if (!session.server) this.owner.set(host.hero.actor, session.me);
    const events = stage?.services.events ?? null;
    if (events) {
      this.offs.push(
        events.on('hit', ({ target, result }) => {
          if (result.total <= 0) return;
          const n = this.numbers.get(target.id) ?? [0, 0];
          this.numbers.set(target.id, [n[0] + result.total, n[1] || (result.crit ? 1 : 0)]);
        }),
        events.on('kill', ({ target, killer }) => {
          if (target.faction !== 'monster') return;
          const who = killer ? this.owner.get(killer) : undefined;
          if (who !== undefined) this.kills.set(who, (this.kills.get(who) ?? 0) + 1);
        }),
        events.on('death', ({ actor }) => {
          if (actor.faction === 'monster') this.session.send({ d: actor.id } satisfies HostMessage);
        }),
      );
    }
  }

  override fixedUpdate(dt: number, intent?: HeroIntent): void {
    super.fixedUpdate(dt, intent);
    // their hero is theirs: the kills it makes count for them
    for (const r of this.remotes.values()) if (r.hero && !this.owner.has(r.hero.actor)) this.owner.set(r.hero.actor, r.id);
    if (this.steps % FRAME_EVERY === 0) this.sendFrame();
  }

  /** A frame of the world to everyone. */
  private sendFrame(): void {
    const stage = this.host.stageNow();
    if (!stage) return;
    const monsters: number[][] = [];
    for (const u of stage.units()) {
      const a = u.actor;
      if (!a.alive) continue;
      const max = a.stats.get('life') || a.maxLife || 1;
      monsters.push([a.id, r2(a.position.x), r2(a.position.z), r2(a.facing), Math.round((Math.max(0, a.life) / max) * 1000)]);
    }
    const heroes: number[][] = [];
    const vital = (id: number, hero: HeroPort | null) => {
      if (!hero) return;
      const v = hero.vitals();
      const d = this.downs.get(id) ?? { deaths: 0, up: true };
      if (d.up && !hero.actor.alive) d.deaths++;
      d.up = hero.actor.alive;
      this.downs.set(id, d);
      heroes.push([id, Math.round((Math.max(0, v.life) / Math.max(1, v.maxLife)) * 1000), hero.actor.alive ? 0 : 1, d.deaths]);
    };
    if (!this.session.server) vital(this.session.me, this.host.hero);
    for (const r of this.remotes.values()) vital(r.id, r.hero);
    const numbers = [...this.numbers.entries()].map(([id, [total, crit]]) => [id, Math.round(total), crit]);
    this.numbers.clear();
    const frame: WorldFrame = [r2(this.host.ctx.time), monsters, heroes, [...this.kills.entries()], numbers];
    this.session.send({ w: frame } satisfies HostMessage);
  }

  protected override idle(): void {
    this.sendFrame();
  }

  // MonsterObserver: what the host's monsters start, for the others to start too
  act(unit: MonsterUnit, skill: string, aim: Vector3): void {
    this.session.send({ a: [unit.actor.id, skill, r2(aim.x), r2(aim.y), r2(aim.z)] } satisfies HostMessage);
  }

  telegraph(unit: MonsterUnit, spec: TelegraphSpec, from: Vector3, to: Vector3, seconds: number): void {
    this.session.send({ g: [unit.actor.id, spec, r2(from.x), r2(from.z), r2(to.x), r2(to.z), r2(seconds)] } satisfies HostMessage);
  }

  spawn(unit: MonsterUnit, genome: Genome, at: Vector3): void {
    this.session.send({ s: [unit.actor.id, genome, r2(at.x), r2(at.z)] } satisfies HostMessage);
  }

  /** A server has no hero: the camera follows the first player still in. */
  watch(): Vector3 | null {
    if (!this.session.server) return null;
    for (const r of this.remotes.values()) if (r.hero) return r.hero.actor.position;
    return null;
  }

  /** The boss fell: a team win. */
  cleared(): void {
    this.report(true);
  }

  /** Time is up before the boss fell: a team loss. */
  timeUp(): void {
    this.report(false);
  }

  private report(won: boolean): void {
    const ids = this.session.players.map((p) => p.id);
    const scores: Record<number, number> = {};
    for (const id of ids) scores[id] = this.kills.get(id) ?? 0;
    this.sendFrame(); // the last word on who is where, before the round ends
    this.session.finish({ standings: killStandings(ids, this.kills), scores, won, stats: Object.fromEntries(ids.map((id) => [id, { kills: scores[id]! }])) });
  }

  override dispose(): void {
    for (const off of this.offs) off();
    const stage = this.host.stageNow();
    if (stage?.observer === this) stage.observer = null;
    super.dispose();
  }
}

// ------------------------------------------------------------------ a client

/** A client's copy: the host's world, played back. */
export class ClientWorld extends SharedWorld {
  /** The host's monster ids → the monsters here (the same ids from the build; adds by what the host says). */
  private readonly units = new Map<number, MonsterUnit>();
  private readonly tracks = new Map<number, RemoteTrack<{ x: number; z: number; facing: number }>>();
  private readonly at = new Vector3();
  private lastLife = -1;
  /** The host's count of our hero's deaths that this copy has played (each once). */
  private deathsPlayed = 0;

  constructor(session: HubSession, host: SharedShell, players: readonly HubPlayer[]) {
    super(session, host, players, false);
    const stage = host.stageNow();
    if (stage) {
      stage.noDrops = true;
      for (const u of stage.units()) {
        u.makePuppet();
        this.units.set(u.actor.id, u);
      }
    }
    // our own hero's life and death are the host's to decide
    (host.hero.actor as Actor).puppet = true;
  }

  override fixedUpdate(dt: number, intent?: HeroIntent): void {
    super.fixedUpdate(dt, intent);
    const now = this.host.ctx.time;
    for (const [id, track] of this.tracks) {
      const u = this.units.get(id);
      const p = track.sample(now, (a, b, k) => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, facing: lerpAngle(a.facing, b.facing, k) }));
      if (!u || !p || !u.puppet) continue;
      u.puppet.x = p.x;
      u.puppet.z = p.z;
      u.puppet.facing = p.facing;
    }
  }

  override message(data: unknown, from: number): void {
    super.message(data, from);
    if (from !== this.session.info.host) return;
    const m = data as HostMessage | null;
    if (!m || typeof m !== 'object') return;
    if (m.w) this.frame(m.w);
    if (m.a) {
      const [id, skill, x, y, z] = m.a;
      this.units.get(id)?.replaySkill(skill, new Vector3(x, y, z));
    }
    if (m.g) {
      const [id, spec, fx, fz, tx, tz, seconds] = m.g;
      const u = this.units.get(id);
      if (u) u.showTelegraph(spec, new Vector3(fx, u.actor.position.y, fz), new Vector3(tx, u.actor.position.y, tz), seconds);
    }
    if (m.s) {
      const [id, genome, x, z] = m.s;
      const stage = this.host.stageNow();
      if (stage && !this.units.has(id)) this.units.set(id, stage.spawnPuppet(genome, new Vector3(x, 0, z), true));
    }
    if (typeof m.d === 'number') {
      this.units.get(m.d)?.dieNow();
      this.tracks.delete(m.d);
    }
  }

  private frame(w: WorldFrame): void {
    const [t, monsters, heroes, kills, numbers] = w;
    const now = this.host.ctx.time;
    for (const [id, x, z, facing, life] of monsters as [number, number, number, number, number][]) {
      const u = this.units.get(id);
      if (!u || !u.actor.alive) continue;
      let track = this.tracks.get(id);
      if (!track) this.tracks.set(id, (track = new RemoteTrack({ delay: 0.12 })));
      track.push(t, now, { x, z, facing });
      const max = u.actor.stats.get('life') || 1;
      u.actor.life = (max * life) / 1000;
    }
    for (const [id, life, dead, deaths = 0] of heroes as [number, number, number, number?][]) {
      if (id !== this.session.me) continue;
      const hero = this.host.hero;
      const max = hero.vitals().maxLife;
      const before = this.lastLife;
      this.lastLife = life;
      if (deaths > this.deathsPlayed) {
        // a death the host saw: play it once (frames saying "down" after we rose again are old news)
        this.deathsPlayed = deaths;
        if (hero.actor.alive) (hero.actor as Actor).die(null, true);
      } else if (!dead && hero.actor.alive) {
        (hero.actor as Actor).life = (max * life) / 1000;
        if (before >= 0 && life < before) this.host.hurtBy(((before - life) / 1000) * max);
      }
    }
    this.kills.clear();
    for (const [id, n] of kills as [number, number][]) this.kills.set(id, n);
    for (const [id, total, crit] of numbers as [number, number, number][]) {
      const u = this.units.get(id);
      if (u) this.host.number(this.at.copy(u.actor.position).setY(1.6), total, crit === 1);
    }
  }
}
