/**
 * Ghost mode (docs/game/session.md): every player clears their own copy of the round, and each
 * copy shows the other players' heroes where they are, see-through and ringed in their colour,
 * touching nothing (`RemoteHero`: a phantom hero in a combat world of its own). Each copy sends
 * its own hero every fixed step (`{ h: HeroStep }`, bundled by the session under the hub's rate).
 */
import type { Camera } from 'three/webgpu';
import type { GameContext, HubPlayer, HubSession } from '../../engine';
import type { HeroIntent, HeroPort } from '../game/ports';
import type { UiCanvas } from '../ui/kit';
import { project } from '../ui/world';
import { heroStep, isHeroStep, RemoteHero } from './remote';
import type { RoundMode } from './round';

/** What ghosts need of the game shell. */
export interface GhostHost {
  readonly ctx: GameContext;
  /** This copy's own hero. */
  readonly hero: HeroPort;
  readonly dead: boolean;
  /** A phantom hero, in the level now on at its start (null without a level). */
  phantom(): Promise<HeroPort | null>;
}

/** A hero step on the wire. */
interface HeroMessage {
  readonly h: unknown;
}

export class GhostMode implements RoundMode {
  readonly remotes = new Map<number, RemoteHero>();

  constructor(
    private readonly session: HubSession,
    private readonly host: GhostHost,
    players: readonly HubPlayer[],
  ) {
    for (const p of players) if (p.id !== session.me) this.add(p);
  }

  private add(p: HubPlayer): RemoteHero {
    const remote = new RemoteHero(p.id, p.name, p.color);
    this.remotes.set(p.id, remote);
    void this.host.phantom().then((hero) => {
      if (!hero) return;
      if (this.remotes.get(p.id) !== remote) return hero.dispose(); // left meanwhile
      remote.attach(hero);
    });
    return remote;
  }

  /** Our hero's step goes to the others; theirs play on here. */
  fixedUpdate(dt: number, intent?: HeroIntent): void {
    const now = this.host.ctx.time;
    if (intent) this.session.send({ h: heroStep(now, intent, this.host.hero, this.host.dead) } satisfies HeroMessage);
    for (const r of this.remotes.values()) r.fixedUpdate(dt, now);
  }

  update(dt: number): void {
    const now = this.host.ctx.time;
    for (const r of this.remotes.values()) r.update(dt, now);
  }

  message(data: unknown, from: number): void {
    const step = (data as HeroMessage | null)?.h;
    if (!isHeroStep(step)) return;
    this.remotes.get(from)?.receive(step, this.host.ctx.time);
  }

  leave(id: number): void {
    this.remotes.get(id)?.dispose();
    this.remotes.delete(id);
  }

  end(): void {}

  /** Each ghost's name over its head, in its player's colour (names come from the hub: text, never markup). */
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
