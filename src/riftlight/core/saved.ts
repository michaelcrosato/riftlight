/**
 * Save-states (`Riftlight.snapshot`, docs/game/save-states.md): what a saved state can't hold,
 * it names. An actor is its id (they count from 1 at each game's setup, and a restore gives
 * every actor back its own), so a state that pointed at one finds it again by id.
 */
import type { ActorLike } from './types';

/** An actor named by its id (null: none). */
export type ActorRef = number | null;

export const refOf = (a: ActorLike | null | undefined): ActorRef => (a ? a.id : null);

/** Actors by id, for a restore to find what a saved state pointed at (null when it is gone). */
export type ActorIndex = (id: ActorRef) => ActorLike | null;

/** A vector as data. */
export type Vec = readonly [number, number, number];
