/**
 * Riftlight in an AI Hub session (docs/game/session.md): a round is one designed level, played
 * from the hub's seed with a fresh hero levelled for its depth, straight from the page's load: no
 * title, menus or town. The boss's death clears it.
 *
 * - **parallel**: every player clears their own copy; the hub ranks clear times, then scores.
 * - **ghost**: as parallel, and each copy shows the others' heroes where they are (`ghosts.ts`).
 * - **shared-world**: one level for everyone, run by the host's copy (`shared.ts`); the host
 *   reports a team result.
 *
 * The round's start comes from the page as a recorded command (`{ rl: 'round' }`), and the hub's
 * events as input commands (engine `hubEvents`), so a session replays like any other run. The
 * countdown runs in game time from the hub's `start` (`in` ms), the same on every copy.
 */
import { type GameContext, type HubEvent, type HubInfo, type HubMode, hubEvents, type HubSession } from '../../engine';
import { t } from '../lang';

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
  /** Start a run on `seed` with the hero at `level`, then enter `depth` (resolves when the level is built). */
  startRound(seed: number, depth: number, level: number): Promise<void>;
  /** The level's boss life as a fraction (1 untouched, 0 dead), or null when there is none. */
  bossLife(): number | null;
  /** Kills and deaths in this level. */
  readonly session: { readonly kills: number; readonly deaths: number };
  /** Bring a fallen hero back at the level's start. */
  respawn(): void;
  /** A centre banner (countdown, clear). */
  banner(title: string, subtitle?: string, seconds?: number): void;
}

/** The round's command from the page: what the hub said in its welcome. */
export interface RoundCommand {
  readonly rl: 'round';
  readonly info: HubInfo;
}

export type RoundPhase = 'loading' | 'waiting' | 'countdown' | 'playing' | 'over' | 'ended';

/** What a mode adds to a round (ghosts, a shared world): told about each step and each message. */
export interface RoundMode {
  /** Each rendered frame while the round runs (after the hub's events). */
  update?(dt: number): void;
  /** Each fixed step while play is on. */
  fixedUpdate?(dt: number): void;
  /** Another copy's data. */
  message?(data: unknown, from: number): void;
  /** A player left the round. */
  leave?(id: number): void;
  /** The round ended (the engine is quiet). */
  end?(): void;
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
  /** Seconds of countdown left (game time), from the hub's `start`. */
  countdown = 0;
  /** Seconds of play (game time). */
  playTime = 0;
  /** The hub's clock when the boss fell (the result), or null. */
  clearedAt: number | null = null;
  /** Seconds until a fallen hero rises, or null. */
  respawnIn: number | null = null;
  /** Players still in the round. */
  players: number[] = [];
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
    this.depth = roundDepth(info.round);
    void this.host.startRound(info.seed, this.depth, roundHeroLevel(this.depth)).then(() => {
      if (this.phase === 'loading') this.phase = 'waiting';
      this.session.ready();
    });
  }

  /** The world waits for the start (and stays as it is once the round is over for the hub). */
  get frozen(): boolean {
    return this.phase === 'loading' || this.phase === 'waiting' || this.phase === 'countdown' || this.phase === 'ended';
  }

  /** Play is on (moving, fighting, scoring). */
  get playing(): boolean {
    return this.phase === 'playing' || this.phase === 'over';
  }

  /** This frame's hub events (from `ctx.input.commands`), then the countdown and the score. */
  update(commands: readonly unknown[], dt: number): void {
    for (const e of hubEvents(commands)) this.event(e);
    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - dt);
      const shown = Math.ceil(this.countdown);
      if (shown !== this.lastShown) {
        this.lastShown = shown;
        this.host.banner(shown > 0 ? String(shown) : t('round.go'), shown > 0 ? t('round.get_ready') : t('round.clear_the_rift'), shown > 0 ? 0.95 : 1.2);
        if (shown > 0) this.host.ctx.audio.play('rl.bark', { volume: 0.5 });
      }
      if (this.countdown <= 0) this.phase = 'playing';
    }
    if (this.playing) {
      this.playTime += dt;
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
  }

  fixedUpdate(dt: number): void {
    if (!this.playing) return;
    for (const m of this.modes) m.fixedUpdate?.(dt);
  }

  /** Score for the hub's board: kills, and the boss's lost life (it weighs most). */
  score(): number {
    const boss = this.host.bossLife();
    return this.host.session.kills + Math.round((1 - (boss ?? 1)) * 50) + (this.clearedAt !== null ? 100 : 0);
  }

  /** The hero fell: up again after a moment (a round never ends on a death). */
  heroDied(): void {
    if (this.playing && this.respawnIn === null) this.respawnIn = RESPAWN_SECONDS;
  }

  /** The boss fell: this player's round is over (parallel and ghost report their time). */
  cleared(): void {
    if (this.clearedAt !== null || !this.playing) return;
    this.clearedAt = this.session.time();
    this.phase = 'over';
    if (this.mode !== 'shared-world') this.report(true);
  }

  private progress(): void {
    if (this.mode === 'shared-world' || this.reported) return;
    const kills = this.host.session.kills;
    this.session.progress(this.score(), t('round.kills', { count: kills })); // the hub shows it as written: in the player's language
  }

  /** Parallel and ghost: the result, once (a clear time, or the score when time ran out). */
  report(clear: boolean): void {
    if (this.reported || this.mode === 'shared-world') return;
    this.reported = true;
    const stats = { kills: this.host.session.kills, deaths: this.host.session.deaths, depth: this.depth };
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
      if (this.mode !== 'shared-world') this.report(false);
    } else if (e.type === 'end') {
      this.phase = 'ended';
      for (const m of this.modes) m.end?.();
    }
  }
}
