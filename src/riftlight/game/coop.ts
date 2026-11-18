/**
 * Couch co-op (docs/game/shell.md *Couch co-op*): two to four players on one screen, one view they
 * share. Player 1 plays as always (keyboard and mouse, or a pad: the engine's merged input); every
 * other player has a pad of their own (`input.player(slot)`), and joins by pressing Cross on it
 * (`input.joinWith`: in the Couch co-op menu, and in town while player 1 is on a pad). A guest's
 * hero is a teammate as a shared world's host makes them: player 1's level, skills and gear, no
 * save, inventory or loot of its own (what it kills is player 1's XP and loot). It reads its pad by
 * player 1's rules (`readActions`; the right stick's aim with assist, else the cone along the move),
 * rises beside player 1 `COOP.rise` s after it falls, and is put beside player 1 when it strays past
 * the leash. The camera follows the group's centre and zooms out to keep it in view, to a cap.
 * Monsters stay as they are for one player (balance is not part of this). Everything a guest does
 * comes from recorded input (its pad, the join), so a couch session replays.
 */
import { type Mesh, Vector3, type Camera } from 'three/webgpu';
import { HUB_COLORS, type Input, type KeyReader } from '../../engine';
import { AIM, autoAim, stickAim } from '../actors/aim';
import type { ActorLike } from '../core/types';
import { t } from '../lang';
import { disposeRing, seatRing } from '../session/remote';
import type { UiCanvas } from '../ui/kit';
import { project } from '../ui/world';
import type { GuestStrip } from '../ui/hud';
import { readActions } from './controls';
import type { HeroIntent, HeroPort } from './ports';

export const COOP = {
  /** Players at most: player 1 and three guests. */
  seats: 4,
  /** A guest farther than this (m) from player 1 is put beside them. */
  leash: 12,
  /** The group's spread (m from its centre) the camera shows before it zooms out. */
  spread: 5,
  /** The camera zooms out to this share of its zoom at most. */
  zoomOut: 0.72,
  /** Seconds a fallen guest lies before rising beside player 1. */
  rise: 5,
  /** Metres from player 1 a guest is put (joining, rising, a new stage, the leash). */
  beside: 1.4,
  /** The nearest monster whichever way a guest's cone finds nothing ahead (the shell's last resort, as player 1's). */
  around: 7,
} as const;

/** What couch co-op needs of the shell. */
export interface CoopHost {
  readonly input: Input;
  /** Player 1's hero. */
  hero(): HeroPort;
  /**
   * A guest's hero: levelled, skilled and geared as player 1's, in the stage on now, `at`; null
   * when there is no stage to play in (a title, a loading screen).
   */
  guestHero(at: Vector3, facing: number): Promise<HeroPort | null>;
  /** A guest's hero levelled, skilled and geared as player 1's again (a stage entry). */
  fitGuest(hero: HeroPort): void;
  /** Where a guest of `seat` stands beside `p` (on walkable ground), or `p` itself. */
  besideSpot(p: Vector3, seat: number): Vector3;
  /** Put a hero into the stage on now at `at`. */
  enterStage(hero: HeroPort, at: Vector3, facing: number): void;
  /** The monsters a guest may aim at. */
  foes(): readonly ActorLike[];
  /** The camera's ground basis (screen right, screen up). */
  basis(right: Vector3, forward: Vector3): void;
  /** A line in the loot feed. */
  feed(text: string): void;
}

/** A player 2 to 4 at this screen. */
export class Guest {
  /** Its hero (null until made: a join makes it a few microtasks later). */
  hero: HeroPort | null = null;
  readonly intent = { move: { x: 0, z: 0 }, aim: new Vector3(), attack: false, skill: -1, dodge: false, held: 0 };
  /** Seconds since it fell, or null while up. */
  down: number | null = null;
  ring: Mesh | null = null;
  /** Its hero is being made. */
  making = false;

  constructor(
    /** Its pad's slot (`input.player(slot)`). */
    readonly slot: number,
    /** Its seat, 2 to 4 (its colour, its P2 tag). */
    readonly seat: number,
  ) {}

  /** Its seat's colour, as 52in1 colours seats (`HUB_COLORS`). */
  get color(): string {
    return HUB_COLORS[(this.seat - 1) % HUB_COLORS.length]!;
  }
}

/** A guest's saved state, for a fingerprint or a check. */
export interface GuestView {
  readonly seat: number;
  readonly slot: number;
  readonly at: readonly [number, number, number] | null;
  readonly life: number;
  readonly down: number | null;
}

/** Couch co-op: the guests at this screen and what they do each step. */
export class LocalCoop {
  readonly guests: Guest[] = [];
  private readonly right = new Vector3();
  private readonly forward = new Vector3();
  private readonly mid = new Vector3();

  constructor(private readonly host: CoopHost) {}

  /** Seats taken (2 to 4). */
  get seats(): number[] {
    return this.guests.map((g) => g.seat);
  }

  /** A seat is free. */
  get open(): boolean {
    return this.guests.length < COOP.seats - 1;
  }

  /** Once a frame: each pad that joined this frame (`input.joinedNow`, recorded) takes a free seat. */
  frame(): void {
    for (const slot of this.host.input.joinedNow) this.join(slot);
  }

  /** The pad in `slot` takes the first free seat (none free: it plays player 1 again). */
  join(slot: number): Guest | null {
    const input = this.host.input;
    let seat = 2;
    while (this.guests.some((g) => g.seat === seat)) seat++;
    if (seat > COOP.seats || this.guests.some((g) => g.slot === slot)) {
      if (!this.guests.some((g) => g.slot === slot)) input.joined.delete(slot);
      return null;
    }
    input.joined.add(slot);
    const guest = new Guest(slot, seat);
    this.guests.push(guest);
    this.guests.sort((a, b) => a.seat - b.seat);
    this.host.feed(t('feed.coop.joined', { seat }));
    void this.make(guest);
    return guest;
  }

  /** Its hero, beside player 1 (if it is still seated when the hero is made, and there is a stage). */
  private async make(guest: Guest): Promise<void> {
    if (guest.making || guest.hero) return;
    guest.making = true;
    const p1 = this.host.hero().actor;
    const at = this.host.besideSpot(p1.position, guest.seat);
    const hero = await this.host.guestHero(at, (p1 as { facing?: number }).facing ?? 0);
    guest.making = false;
    if (!hero) return;
    if (!this.guests.includes(guest)) return hero.dispose();
    guest.hero = hero;
    guest.ring = seatRing(hero, guest.color);
    this.placeRing(guest);
  }

  /** The guest in `seat` leaves: its hero goes, its pad plays player 1 again. */
  leave(seat: number): void {
    const i = this.guests.findIndex((g) => g.seat === seat);
    if (i < 0) return;
    const [guest] = this.guests.splice(i, 1);
    this.host.input.joined.delete(guest!.slot);
    this.drop(guest!);
    this.host.feed(t('feed.coop.left', { seat }));
  }

  /** Everyone but player 1 leaves (the title, the game unloading). */
  leaveAll(): void {
    for (const g of this.guests) {
      this.host.input.joined.delete(g.slot);
      this.drop(g);
    }
    this.guests.length = 0;
  }

  private drop(guest: Guest): void {
    disposeRing(guest.ring);
    guest.ring = null;
    guest.hero?.dispose();
    guest.hero = null;
  }

  /** A new stage (town, a level, player 1 rising): every guest beside player 1, up and refitted. */
  enter(at: Vector3, facing: number): void {
    for (const g of this.guests) {
      if (!g.hero) {
        void this.make(g); // joined while there was no stage to play in
        continue;
      }
      this.host.fitGuest(g.hero);
      this.host.enterStage(g.hero, this.host.besideSpot(at, g.seat), facing);
      g.hero.restore();
      g.down = null;
      g.hero.object.visible = true;
      this.placeRing(g);
    }
  }

  /** One fixed step of play: each guest reads its pad and acts; a fallen one rises in time; a straggler comes back. */
  fixedUpdate(dt: number): void {
    if (!this.guests.length) return;
    const host = this.host;
    host.basis(this.right, this.forward);
    const p1 = host.hero().actor;
    const foes = host.foes();
    for (const g of this.guests) {
      const hero = g.hero;
      if (!hero) continue;
      const i = g.intent;
      if (!hero.actor.alive) {
        // down: it stands still, and rises beside player 1 in time (player 1 up)
        g.down = (g.down ?? 0) + dt;
        Object.assign(i, { attack: false, skill: -1, dodge: false, held: 0 });
        i.move.x = i.move.z = 0;
        hero.fixedUpdate(dt, i);
        if (g.down >= COOP.rise && p1.alive) this.rise(g);
        continue;
      }
      g.down = null;
      guestIntent(host.input.player(g.slot), this.right, this.forward, hero.actor.position, foes, i);
      hero.fixedUpdate(dt, i);
      // past the leash: beside player 1 again
      const p = hero.actor.position;
      if (p1.alive && Math.hypot(p.x - p1.position.x, p.z - p1.position.z) > COOP.leash) hero.snap?.(host.besideSpot(p1.position, g.seat), (p1 as { facing?: number }).facing ?? 0);
    }
  }

  private rise(g: Guest): void {
    const hero = g.hero!;
    const p1 = this.host.hero().actor;
    hero.restore();
    hero.snap?.(this.host.besideSpot(p1.position, g.seat), (p1 as { facing?: number }).facing ?? 0);
    g.down = null;
  }

  /** Each frame: bodies, rings. */
  update(dt: number): void {
    for (const g of this.guests) {
      if (!g.hero) continue;
      g.hero.update(dt);
      this.placeRing(g);
    }
  }

  private placeRing(g: Guest): void {
    const p = g.hero?.actor.position;
    if (p && g.ring) g.ring.position.set(p.x, p.y + 0.04, p.z);
  }

  /** Where the camera looks: the middle of player 1 and the guests standing, into `out` (player 1's spot alone without them). */
  centre(out: Vector3): Vector3 {
    const p1 = this.host.hero().actor.position;
    out.copy(p1);
    let n = 1;
    for (const g of this.guests) {
      if (!g.hero?.actor.alive) continue;
      out.add(g.hero.actor.position);
      n++;
    }
    return out.multiplyScalar(1 / n);
  }

  /** How far the camera zooms out (1: not at all) to keep the group in view: down to `COOP.zoomOut`. */
  zoom(): number {
    if (!this.guests.length) return 1;
    const c = this.centre(this.mid);
    let far = Math.hypot(this.host.hero().actor.position.x - c.x, this.host.hero().actor.position.z - c.z);
    for (const g of this.guests) if (g.hero?.actor.alive) far = Math.max(far, Math.hypot(g.hero.actor.position.x - c.x, g.hero.actor.position.z - c.z));
    return Math.max(COOP.zoomOut, Math.min(1, COOP.spread / Math.max(COOP.spread, far)));
  }

  /** Each guest's strip on the HUD: its seat, life, skills' readiness, and the seconds until it rises. */
  strips(): GuestStrip[] {
    return this.guests.map((g) => {
      const v = g.hero?.vitals();
      const skills = g.hero?.skills() ?? [];
      return {
        seat: g.seat,
        color: parseInt(g.color.slice(1), 16),
        life: v && v.maxLife > 0 ? Math.max(0, v.life) / v.maxLife : 0,
        skills: [0, 1, 2, 3].map((s) => {
          const k = skills.find((x) => x.slot === s);
          return !k?.id ? -1 : k.remaining > 0 && k.cooldown > 0 ? 1 - k.remaining / k.cooldown : k.usable ? 1 : 0;
        }),
        rise: g.down === null ? null : Math.max(0, COOP.rise - g.down),
      };
    });
  }

  /** Each guest's seat tag over its head, in its colour. */
  draw(ui: UiCanvas, camera: Camera): void {
    for (const g of this.guests) {
      const a = g.hero?.actor;
      if (!a?.alive) continue;
      const at = project(a.position.clone().setY(a.position.y + 2.3), camera, ui);
      if (at) ui.text(at.x, at.y, t('hud.coop.seat', { seat: g.seat }), { align: 'center', color: parseInt(g.color.slice(1), 16), shadow: 'ink' });
    }
  }

  /** The guests as data (fingerprints, tests). */
  view(): GuestView[] {
    return this.guests.map((g) => {
      const a = g.hero?.actor;
      return { seat: g.seat, slot: g.slot, at: a ? [a.position.x, a.position.y, a.position.z] : null, life: a?.life ?? 0, down: g.down };
    });
  }

  dispose(): void {
    this.leaveAll();
  }
}

/**
 * A guest's intent this fixed step from its pad, by player 1's rules: the left stick (or the d-pad)
 * moves along the camera's ground basis; the right stick past `AIM.stick` aims along itself with
 * aim assist, else the cone along the move (standing, along where it aimed); the buttons' actions
 * as player 1's (`readActions`).
 */
export function guestIntent(pad: KeyReader, right: Vector3, forward: Vector3, from: Vector3, foes: readonly ActorLike[], i: Guest['intent']): HeroIntent {
  const axis = pad.moveAxis();
  i.move.x = right.x * axis.x + forward.x * axis.y;
  i.move.z = right.z * axis.x + forward.z * axis.y;
  const look = pad.lookAxis;
  if (Math.hypot(look.x, look.y) > AIM.stick) stickAim(from, right.x * look.x + forward.x * look.y, right.z * look.x + forward.z * look.y, foes, hostile, i.aim);
  else autoAim(from, i.move, i.aim, COOP.around, foes, hostile, i.aim);
  readActions(pad, i);
  return i;
}

const hostile = (a: ActorLike): boolean => a.faction === 'monster';
