import type { Mod } from '../../core/mods';
import type { Entry } from '../../core/registry';
import type { Genome } from '../../core/types';

/** One phase of a boss fight: active from `from` (life fraction) down to the next phase. */
export interface BossPhase {
  /** Life fraction at which the phase begins (the first phase starts at 1). */
  readonly from: number;
  readonly name: string;
  /** BOSS_ATTACKS ids it rotates through. */
  readonly attacks: readonly string[];
  /** Seconds between signature attacks. */
  readonly cadence: number;
  /** Attacks fired the moment the phase starts (adds, hazards). */
  readonly onEnter?: readonly string[];
  /** Extra mods while in the phase (as a StatSheet source 'phase'). */
  readonly mods?: readonly Mod[];
}

export interface BossDef extends Entry {
  readonly name: string;
  /** Designed level (1..12) or 0 for a generated rift boss. */
  readonly level: number;
  /** The level mechanic it is built around. */
  readonly mechanics: readonly string[];
  readonly genome: Genome;
  readonly phases: readonly BossPhase[];
  /** The attack the fight is remembered by. */
  readonly signature: string;
  readonly enrage: { readonly after: number; readonly mods: readonly Mod[] };
  /** Arena: radius (m) and hazards the level should place for this fight. */
  readonly arena: { readonly radius: number; readonly hazards: readonly string[] };
  readonly flavour: string;
}
