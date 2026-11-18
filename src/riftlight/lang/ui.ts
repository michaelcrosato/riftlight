/**
 * The words of Riftlight's screens (docs/game/lang.md): one whole sentence per line with named
 * `{blanks}`, plural forms where a number counts something, `{key:action}` where a control is
 * named. Grouped by where they show; ids say where (`round.go`).
 */
import type { LineArea } from './area';

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
    'round.stat.kills': 'Kills',
    'round.stat.deaths': 'Deaths',
    'round.stat.depth': 'Depth',
    'round.moment_cleared': 'Cleared!',
    'round.moment_failed': 'Failed',
    'round.moment_left': { one: '{count} second left', other: '{count} seconds left' },
  },
  notes: {
    'round.get_ready': 'Under the countdown numbers before a round with friends starts.',
    'round.go': 'The moment the round starts. Very short.',
    'round.clear_the_rift': 'Under "Go!": the round’s goal (kill the rift’s boss).',
    'round.kills': 'The player’s standing on the hub’s scoreboard, at most 24 letters.',
    'round.respawn': 'After the hero falls in a round: seconds until they rise again.',
    'round.cleared': 'Banner when the rift’s boss falls in a round with friends.',
    'round.cleared_in': 'Under "Rift cleared": how long it took, as 1:23.',
    'round.stat.kills': 'A number’s name on the results after a round with friends: monsters this player killed. At most 16 letters.',
    'round.stat.deaths': 'A number’s name on the results after a round with friends: how often this player’s hero fell. At most 16 letters.',
    'round.stat.depth': 'A number’s name on the results after a round with friends: which level of the dungeon the round was. At most 16 letters.',
    'round.moment_cleared': 'Big banner when the player meets a moment’s goal (a few seconds of play against friends). Very short.',
    'round.moment_failed': 'Big banner when the player’s hero falls or time runs out in a moment. Very short.',
    'round.moment_left': 'At the top of the screen during a moment: seconds left to meet its goal.',
  },
  max: { 'round.go': 8, 'round.kills': 24, 'round.stat.kills': 16, 'round.stat.deaths': 16, 'round.stat.depth': 16, 'round.moment_cleared': 16, 'round.moment_failed': 16 },
};

/**
 * The moments' goals (session/moments.ts): what clears each, shown under the countdown and, in
 * English with the boss's name filled in, in the page's `hub:moment` tags (at most 60 characters).
 */
const MOMENT: LineArea = {
  lines: {
    'moment.vorgath': 'Defeat {boss}',
    'moment.crypt_hall': 'Defeat every monster in the dark hall',
    'moment.skraal': 'Stay alive against {boss}',
    'moment.gale_escape': 'Escape the elite pack: run to the marked spot',
  },
  notes: {
    'moment.vorgath': 'A moment’s goal (a few seconds of play against friends): kill the first level’s boss. {boss} is his name, as the game names him.',
    'moment.crypt_hall': 'A moment’s goal: kill all the monsters in a dark crypt hall.',
    'moment.skraal': 'A moment’s goal: don’t die while the third level’s boss attacks, until the moment’s time is up. {boss} is her name, as the game names her.',
    'moment.gale_escape': 'A moment’s goal: a strong monster leader and its pack charge the hero, too strong to fight; run back to the spot marked on the ground before they catch you.',
  },
  max: { 'moment.vorgath': 60, 'moment.crypt_hall': 60, 'moment.skraal': 60, 'moment.gale_escape': 60 },
};

export const UI: LineArea = {
  lines: { ...ROUND.lines, ...MOMENT.lines },
  notes: { ...ROUND.notes, ...MOMENT.notes },
  max: { ...ROUND.max, ...MOMENT.max },
};
