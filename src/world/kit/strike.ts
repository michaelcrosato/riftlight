/**
 * Hits from the hero: a strike starts when the hero's animation becomes a punch or a kick.
 * Rooms poll it every fixed step and decide what the fist lands on (a bag, a wall, a chain).
 */
import { Vector3 } from 'three/webgpu';
import type { PlatformerCharacter } from '../../engine';

const STRIKES: Readonly<Record<string, number>> = { Punch: 1, Punch2: 1.1, Kick: 1.6, SweepKick: 1.4, JumpKick: 1.6, Dive: 1.8 };

export interface Strike {
  /** Where the blow lands: a step in front of the hero, at chest height. */
  readonly at: Vector3;
  /** The hero's forward (horizontal, unit). */
  readonly dir: Vector3;
  /** 1 for a punch, more for kicks and dives. */
  readonly strength: number;
  readonly anim: string;
}

export class Strikes {
  private last = '';
  private readonly at = new Vector3();
  private readonly dir = new Vector3();

  /** A strike that started this step, or null. */
  poll(h: PlatformerCharacter, reach = 0.8): Strike | null {
    const anim = h.anim;
    const started = anim !== this.last && STRIKES[anim] !== undefined;
    this.last = anim;
    if (!started) return null;
    h.forwardInto(this.dir);
    h.feetInto(this.at).addScaledVector(this.dir, reach);
    this.at.y += 1;
    return { at: this.at, dir: this.dir, strength: STRIKES[anim]!, anim };
  }
}
