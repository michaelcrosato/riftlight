// Save-states mid-fight, depth 7 (docs/game/save-states.md; the other depths in their own
// snapshot.depth*.test.ts files, one engine each, ~15 s): on each designed depth a fight by input,
// a snapshot with effects in flight, played on, restored (the level built again), played on the
// same way: the same fingerprint and the same state.
import { describeDepths } from './testSnapshot';

describeDepths([7]);
