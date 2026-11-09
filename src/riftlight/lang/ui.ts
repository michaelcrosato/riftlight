/**
 * The words of Riftlight's screens (docs/game/lang.md): one whole sentence per line with named
 * `{blanks}`, plural forms where a number counts something, `{key:action}` where a control is
 * named. Grouped by where they show; ids say where (`round.go`).
 */
import type { Line } from '../../engine';

export interface LineArea {
  readonly lines: Readonly<Record<string, Line>>;
  readonly notes?: Readonly<Record<string, string>>;
  readonly max?: Readonly<Record<string, number>>;
}

/** A session round (session/round.ts): the countdown and its banners. */
const ROUND: LineArea = {
  lines: {
    'round.get_ready': 'Get ready',
    'round.go': 'Go!',
    'round.clear_the_rift': 'Clear the rift',
    'round.kills': { one: '{count} kill', other: '{count} kills' },
    'round.cleared': 'Rift cleared',
    'round.cleared_in': 'Cleared in {time}',
    'round.respawn': 'Back in {seconds}…',
    'round.waiting': 'Waiting for the other players',
  },
  notes: {
    'round.get_ready': 'Under the countdown numbers before a round with friends starts.',
    'round.go': 'The moment the round starts. Very short.',
    'round.clear_the_rift': 'Under "Go!": the round’s goal (kill the rift’s boss).',
    'round.kills': 'The player’s standing on the hub’s scoreboard, at most 24 letters.',
    'round.respawn': 'After the hero falls in a round: seconds until they rise again.',
  },
  max: { 'round.go': 8, 'round.kills': 24 },
};

export const UI: LineArea = {
  lines: { ...ROUND.lines },
  notes: { ...ROUND.notes },
  max: { ...ROUND.max },
};
