/**
 * Riftlight in a 52in1 session (docs/game/session.md): a round is one designed level, played
 * from the hub's seed with a fresh hero levelled for its depth, straight from the page's load: no
 * title, menus or town. The boss's death clears it.
 *
 * - **parallel**: every player clears their own copy; the hub ranks clear times, then scores.
 * - **ghost**: as parallel, and each copy shows the others' heroes where they are (`ghosts.ts`).
 * - **shared-world**: one level for everyone, run by the host's copy (`shared.ts`); the host
 *   reports a team result in co-op, standings by score in versus.
 * - **moments**: one short moment of the game a load (`moments.ts`): set up the same on every copy,
 *   cleared or failed in seconds, reported once (`result({ won, time })`); nothing sent.
 *
 * The round's start comes from the page as a recorded command (`{ rl: 'round' }`), and the hub's
 * events as input commands (engine `hubEvents`), so a session replays like any other run. Play
 * begins when the hub's clock says so (`AIHub.time()` reaches 0, the same moment on every device):
 * that moment, read from real time, enters the game as a recorded command too (`{ rl: 'round-go' }`).
 */
import type { Camera, Vector3 } from 'three/webgpu';
import { type GameContext, type HubEvent, type HubInfo, type HubMode, hubEvents, type HubSession } from '../../engine';
import type { HeroIntent } from '../game/ports';
import type { UiCanvas } from '../ui/kit';
import { BANNER_OPENS } from '../ui/layout';
import { t } from '../lang';
import { MOMENTS, momentById, momentGoal, type MomentSpec } from './moments';

/** Depths a round can be (designed levels short enough for a session round), by round number. */
export const ROUND_DEPTHS: readonly number[] = [1, 2, 3];

/** The hero's level for a round at `depth` (the playtest's: levelled for the depth). */
export const roundHeroLevel = (depth: number): number => Math.max(1, depth * 2 - 1);

/** Seconds a fallen hero waits before rising again at the level's start. */
export const RESPAWN_SECONDS = 3;

/** The round's depth: the hub's round number walks through `ROUND_DEPTHS`. */
export function roundDepth(round: number): number {
  return ROUND_DEPTHS[(Math.max(1, Math.floor(round)) - 1) % ROUND_DEPTHS.length]!;
}

/** What a round needs of the game shell (the `Riftlight` implements it). */
export interface RoundHost {
  readonly ctx: GameContext;
  /** Start a run on `seed` with the hero at `level`, then enter `depth` with the hero at `seat`'s place (resolves when the level is built). */
  startRound(seed: number, depth: number, level: number, seat: number): Promise<void>;
  /** The level's boss life as a fraction (1 untouched, 0 dead), or null when there is none. */
  bossLife(): number | null;
  /** Kills and deaths in this level. */
  readonly session: { readonly kills: number; readonly deaths: number };
  /** Bring a fallen hero back at the level's start. */
  respawn(): void;
  /** A centre banner (countdown, clear), `age` seconds into its showing (0: it opens). */
  banner(title: string, subtitle?: string, seconds?: number, age?: number): void;
  /** What the round's mode adds (ghosts, a shared world), once the level is built. */
  roundModes(info: HubInfo): RoundMode[];
  /** Moments: a fresh run on `seed`, the moment's level built and its hero placed (resolves when built). */
  startMoment(moment: MomentSpec, seed: number): Promise<void>;
  /** Moments: its goal is met (its targets fallen, its spot reached). */
  momentMet(): boolean;
}

/** The round's commands from the page: what the hub said in its welcome, and the moment play began. */
export type RoundCommand = { readonly rl: 'round'; readonly info: HubInfo } | { readonly rl: 'round-go' };

export type RoundPhase = 'loading' | 'waiting' | 'countdown' | 'playing' | 'over' | 'ended';

/** What a mode adds to a round (ghosts, a shared world): told about each step and each message. */
export interface RoundMode {
  /** Each rendered frame while the round runs (after the hub's events). */
  update?(dt: number): void;
  /** Each fixed step while play is on, with this copy's hero's intent for the step. */
  fixedUpdate?(dt: number, intent?: HeroIntent): void;
  /**
   * Each frame before play begins (the card, the countdown: the world is still): a mode tells the
   * others where its hero stands, so traffic flows and their clocks are matched from the start.
   */
  waiting?(dt: number): void;
  /** Its overlays (names over ghosts), each frame of a level. */
  draw?(ui: UiCanvas, camera: Camera): void;
  /** Another copy's data. */
  message?(data: unknown, from: number): void;
  /** A player left the round. */
  leave?(id: number): void;
  /** The round ended (the engine is quiet). */
  end?(): void;
  /** The boss fell (a shared world's host reports the round). */
  cleared?(): void;
  /** The hub called time (a shared world's host reports the round). */
  timeUp?(): void;
  /** Where the camera looks when this copy has no hero of its own (a server), or null. */
  watch?(): Vector3 | null;
  dispose?(): void;
}

/**
 * The game's side of one session round: it starts the level, readies up, counts down, freezes the
 * world until play begins, scores and reports. Mode-specific traffic is a `RoundMode`.
 */
export class SessionRound {
  readonly mode: HubMode;
  phase: RoundPhase = 'loading';
  /** The welcome as the round's command delivered it (null until it arrives). */
  info: HubInfo | null = null;
  depth = 1;
  /** Seconds of countdown left (the hub's clock), from its `start`. */
  countdown = 0;
  private goSent = false;
  /** Seconds of play (game time). */
  playTime = 0;
  /** The hub's clock when the boss fell (the result), or null. */
  clearedAt: number | null = null;
  /** Seconds until a fallen hero rises, or null. */
  respawnIn: number | null = null;
  /** Players still in the round. */
  players: number[] = [];
  /** Moments: the moment this load plays, and how it went (null while it is on). */
  moment: MomentSpec | null = null;
  outcome: 'cleared' | 'failed' | null = null;
  readonly modes: RoundMode[] = [];
  private lastShown = -1;
  private reported = false;

  constructor(
    readonly session: HubSession,
    private readonly host: RoundHost,
  ) {
    this.mode = session.mode;
  }

  /** The page's part at setup: the round's command (recorded, so a replay starts the same round). */
  announce(): void {
    this.host.ctx.input.send({ rl: 'round', info: this.session.info } satisfies RoundCommand);
  }

  /** The round's command arrived (live or replayed): build the level, then ready up. */
  begin(info: HubInfo): void {
    if (this.info) return;
    this.info = info;
    this.players = info.players.map((p) => p.id);
    let built: Promise<void>;
    if (this.mode === 'moments') {
      // the moment the hub named (every copy the same), its set-up drawn from the hub's seed for it
      const moment = momentById(info.moment) ?? MOMENTS[0]!;
      this.moment = moment;
      this.depth = moment.depth;
      built = this.host.startMoment(moment, this.session.rng(moment.id).int(1, 2 ** 31 - 2));
    } else {
      this.depth = roundDepth(info.round);
      const seat = info.server ? 0 : Math.max(0, info.players.findIndex((p) => p.id === info.me));
      built = this.host.startRound(info.seed, this.depth, roundHeroLevel(this.depth), seat);
    }
    void built
      .then(() => {
        this.modes.push(...this.host.roundModes(info));
        if (this.phase === 'loading') this.phase = 'waiting';
        this.session.ready();
      })
      .catch((e: unknown) => this.session.fail(`Riftlight could not build the round: ${e instanceof Error ? e.message : String(e)}`));
  }

  /** The world waits for the start (and stays as it is once the round is over for the hub). */
  get frozen(): boolean {
    return this.phase === 'loading' || this.phase === 'waiting' || this.phase === 'countdown' || this.phase === 'ended';
  }

  /** Play is on (moving, fighting, scoring). */
  get playing(): boolean {
    return this.phase === 'playing' || this.phase === 'over';
  }

  /** This frame's hub events and round commands (from `ctx.input.commands`), then the countdown and the score. */
  update(commands: readonly unknown[], dt: number): void {
    for (const e of hubEvents(commands)) this.event(e);
    for (const c of commands) if ((c as { rl?: string } | null)?.rl === 'round-go' && this.phase === 'countdown') this.go();
    if (this.phase === 'countdown') {
      // the hub's clock, the same on every device (real time; the moment it reaches 0 is recorded);
      // a replay has no hub clock: its countdown runs in game time from the start's `in`
      const now = this.session.time();
      if (Number.isFinite(now)) this.countdown = Math.max(0, -now / 1000);
      else this.countdown = Math.max(0, this.countdown - dt);
      if (now >= 0 && !this.goSent) {
        this.goSent = true;
        this.host.ctx.input.send({ rl: 'round-go' } satisfies RoundCommand);
      }
      const shown = Math.ceil(this.countdown);
      if (shown !== this.lastShown) {
        this.lastShown = shown;
        const goal = this.moment ? momentGoal(this.moment) : t('round.clear_the_rift');
        this.host.banner(shown > 0 ? String(shown) : t('round.go'), shown > 0 && !this.moment ? t('round.get_ready') : goal, shown > 0 ? 1.05 : 1.2); // each number until the next replaces it
        if (shown > 0) this.host.ctx.audio.play('rl.bark', { volume: 0.5 });
      }
    }
    if (this.playing) {
      this.playTime += dt;
      if (this.moment && this.outcome === null && this.host.momentMet()) this.finishMoment(true);
      this.progress();
      if (this.respawnIn !== null) {
        this.respawnIn -= dt;
        if (this.respawnIn <= 0) {
          this.respawnIn = null;
          this.host.respawn();
        }
      }
    }
    for (const m of this.modes) m.update?.(dt);
    if (this.phase === 'waiting' || this.phase === 'countdown') for (const m of this.modes) m.waiting?.(dt);
  }

  fixedUpdate(dt: number, intent?: HeroIntent): void {
    if (!this.playing) return;
    for (const m of this.modes) m.fixedUpdate?.(dt, intent);
  }

  /** The modes' overlays over the level; in a moment, the seconds left to meet its goal. */
  draw(ui: UiCanvas, camera: Camera, top = 4): void {
    for (const m of this.modes) m.draw?.(ui, camera);
    if (this.moment && this.phase === 'playing' && this.info) {
      const left = Math.max(0, Math.ceil(this.info.limitMs / 1000 - this.playTime));
      ui.text(ui.w / 2, top, t('round.moment_left', { count: left }), { align: 'center', color: left <= 3 ? 'red' : 'white', shadow: 'ink' });
    }
  }

  /** Score for the hub's board: kills, and the boss's lost life (it weighs most). */
  score(): number {
    const boss = this.host.bossLife();
    return this.host.session.kills + Math.round((1 - (boss ?? 1)) * 50) + (this.clearedAt !== null ? 100 : 0);
  }

  /** Play begins (the round's `round-go`, live or replayed). */
  private go(): void {
    this.phase = 'playing';
    this.countdown = 0;
  }

  /** The hero fell: up again after a moment (a round never ends on a death); a moment is failed. */
  heroDied(): void {
    if (this.moment) {
      if (this.playing && this.outcome === null) this.finishMoment(false);
      return;
    }
    if (this.playing && this.respawnIn === null) this.respawnIn = RESPAWN_SECONDS;
  }

  /** The boss fell: this player's round is over (parallel and ghost report their time). A moment's own goal says when it is over. */
  cleared(): void {
    if (this.clearedAt !== null || !this.playing || this.moment) return;
    this.clearedAt = this.session.time();
    this.phase = 'over';
    if (this.mode !== 'shared-world') this.report(true);
    else for (const m of this.modes) m.cleared?.();
  }

  /** Where the camera looks when this copy has no hero of its own (a shared world's server). */
  watch(): Vector3 | null {
    for (const m of this.modes) {
      const at = m.watch?.();
      if (at) return at;
    }
    return null;
  }

  /**
   * The moment is over for this player: cleared (its goal met; at time-up, one whose goal is to
   * last) or failed (the hero fell; at time-up, any other). Reported once, at the hub's time then
   * (a replay has no hub clock: its game time, sent nowhere).
   */
  private finishMoment(won: boolean): void {
    if (this.outcome !== null || !this.moment || !this.info) return;
    this.outcome = won ? 'cleared' : 'failed';
    this.phase = 'over';
    this.reported = true;
    const now = this.session.time();
    const time = Math.round(Math.min(this.info.limitMs, Math.max(0, Number.isFinite(now) ? now : this.playTime * 1000)));
    this.session.result({ won, time, stats: { [t('round.stat.kills')]: this.host.session.kills } });
    // already open: the last result in ends the moment at once, and the end stills the game (its
    // banner too), so one still opening would stay shut, its words never shown
    this.host.banner(won ? t('round.moment_cleared') : t('round.moment_failed'), momentGoal(this.moment), 3, BANNER_OPENS);
    if (won) this.host.ctx.audio.play('rl.clear');
  }

  private progress(): void {
    if (this.mode === 'shared-world' || this.mode === 'moments' || this.reported) return;
    const kills = this.host.session.kills;
    this.session.progress(this.score(), t('round.kills', { count: kills })); // the hub shows it as written: in the player's language
  }

  /** Parallel and ghost: the result, once (a clear time, or the score when time ran out). */
  report(clear: boolean): void {
    if (this.reported || this.mode === 'shared-world' || this.mode === 'moments') return;
    this.reported = true;
    // the results show the stats' names as written: in the player's language
    const stats = { [t('round.stat.kills')]: this.host.session.kills, [t('round.stat.deaths')]: this.host.session.deaths, [t('round.stat.depth')]: this.depth };
    if (clear && this.clearedAt !== null && Number.isFinite(this.clearedAt)) this.session.result({ time: Math.max(0, Math.round(this.clearedAt)), stats });
    else this.session.result({ score: this.score(), stats });
  }

  private event(e: HubEvent): void {
    if (e.type === 'start') {
      if (this.phase === 'loading' || this.phase === 'waiting') {
        this.phase = 'countdown';
        this.countdown = Math.max(0, e.in / 1000);
        this.lastShown = -1;
      }
    } else if (e.type === 'message') {
      for (const m of this.modes) m.message?.(e.data, e.from);
    } else if (e.type === 'leave') {
      this.players = this.players.filter((id) => id !== e.id);
      for (const m of this.modes) m.leave?.(e.id);
    } else if (e.type === 'time-up') {
      // a moment still going: cleared when its goal is to last until time runs out, failed otherwise
      if (this.moment) this.finishMoment(this.moment.clear === 'survive' && this.outcome === null && this.phase === 'playing');
      else if (this.mode !== 'shared-world') this.report(false);
      else if (this.clearedAt === null) for (const m of this.modes) m.timeUp?.();
    } else if (e.type === 'end') {
      this.phase = 'ended';
      for (const m of this.modes) m.end?.();
    }
  }
}
