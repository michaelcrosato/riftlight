import type { Slot } from './types';

/**
 * Silhouette by behaviour: what each archetype does to a body, so players read the brain
 * from the shape before it acts. Two layers, both data:
 *
 * - `genes`: nudges added to the generated genes (chargers hunch forward, leapers get long
 *   legs, tanks go wide and thick-limbed, swarms get big heads), so the plan's grammar
 *   draws a different body. They apply when a genome is generated (saved genomes keep their
 *   genes) and a forced gene (`GenomeOptions.genes`) still wins.
 * - `marks`: cosmetic parts (`parts/marks.ts`, no mods, no cost) on slots the genome left
 *   empty: the bomber's glowing sac, the caster's rune, the tank's plates. Every plan that
 *   has the slot gets them, so one entry dresses all nine body plans.
 *
 * Add an archetype's look here; an unknown archetype simply has none.
 */
export interface ArchetypeLook {
  readonly genes?: Readonly<Record<string, number>>;
  readonly marks?: readonly { readonly slot: Slot; readonly part: string }[];
}

export const ARCHETYPE_LOOKS: Readonly<Record<string, ArchetypeLook>> = {
  charger: { genes: { posture: 0.16, neck: -0.08, girth: 0.08, headSize: 0.06 }, marks: [{ slot: 'helm', part: 'mark.ram' }] },
  skirmisher: { genes: { girth: -0.12, limbThickness: -0.08, legLength: 0.08, tailLength: 0.12 }, marks: [{ slot: 'back', part: 'mark.fins' }] },
  caster: { genes: { posture: -0.14, legLength: 0.05, neck: 0.08 }, marks: [{ slot: 'core', part: 'mark.rune' }] },
  summoner: { genes: { posture: 0.08, headSize: 0.06 }, marks: [{ slot: 'helm', part: 'mark.motes' }] },
  bomber: { genes: { girth: 0.18, length: -0.1, legLength: -0.06 }, marks: [{ slot: 'core', part: 'mark.sac' }] },
  tank: { genes: { girth: 0.15, limbThickness: 0.12, legLength: -0.08 }, marks: [{ slot: 'back', part: 'mark.plates' }] },
  swarm: { genes: { headSize: 0.12, limbThickness: -0.05 } },
  sniper: { genes: { neck: 0.16, legLength: 0.08, girth: -0.06 }, marks: [{ slot: 'back', part: 'mark.quills' }] },
  leaper: { genes: { legLength: 0.16, posture: 0.1, hop: 0.12 }, marks: [{ slot: 'back', part: 'mark.spines' }] },
  totem: { genes: { girth: 0.06 }, marks: [{ slot: 'back', part: 'mark.obelisk' }] },
};

/**
 * Bosses wear their theme: a mantle (`parts/dress.ts`) layered on the back, picked by the
 * body's leading theme tag (`genomeTags`), so a designed boss and a rift boss of the same
 * element share a silhouette language (the ember brute's brazier, the storm beast's
 * pylons, the void warden's rift ring).
 */
export const BOSS_DRESS: Readonly<Record<string, string>> = {
  fire: 'dress.brazier',
  blood: 'dress.bloodmoon',
  shadow: 'dress.lanterns',
  undead: 'dress.lanterns',
  storm: 'dress.pylons',
  ice: 'dress.glass',
  crystal: 'dress.glass',
  nature: 'dress.thorns',
  poison: 'dress.bog',
  water: 'dress.bog',
  arcane: 'dress.echo',
  void: 'dress.rift',
  earth: 'dress.ruins',
  construct: 'dress.ruins',
  beast: 'dress.trophies',
  insect: 'dress.trophies',
};

/** The look of an archetype (empty for an unknown one). */
export function lookOf(archetype: string): ArchetypeLook {
  return ARCHETYPE_LOOKS[archetype] ?? {};
}
