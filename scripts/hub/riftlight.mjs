// Riftlight on 52in1: what its page tells the hub (AI Hub Catalogue v1) and each online mode's card
// (Session Protocol v1). One place for these words: `npm run build:single` writes them into the
// page's head (scripts/hub/head.mjs). docs/game/session.md.

/**
 * Every way Riftlight plays together (`hub:multiplayer`, the catalogue's *Playing together*): where,
 * how (a shared world's, or one device's), and how many. The online four are a session's: one page
 * offers them all and the hub picks one each round. Couch co-op (`same-screen`, game/coop.ts) is the
 * game's own, offered from its pause menu, a pad for each player but the first: never a session's.
 */
export const MULTIPLAYER = [
  { where: 'shared-world', how: 'co-op', players: '1-4' },
  { where: 'shared-world', how: 'versus', players: '2-4' },
  { where: 'ghost', players: '1-4' },
  { where: 'parallel', players: '1-4' },
  { where: 'moments', players: '1-4' },
  { where: 'same-screen', how: 'co-op', players: '2-4' },
];

/** The session protocol's modes, played online (the catalogue's other WHEREs are on one device). */
const ONLINE = ['parallel', 'ghost', 'shared-world', 'moments'];
/** Whether a way to play is online, a session's (`hub:session-*` and its card are for these alone). */
export const isOnline = (m) => ONLINE.includes(m.where);

/** The mode it plays when nothing says which (`hub:session-mode`): co-op in one world. */
export const DEFAULT_MODE = 'shared-world';

/** A mode's word in the per-mode card tags (`hub:session-goal-WORD`): a shared world's play, else its own. */
export const modeWord = (m) => (m.where === 'shared-world' ? m.how : m.where);

export const CATALOGUE = {
  name: 'Riftlight',
  tagline: 'A hack-and-slash of endless rifts',
  description:
    'An isometric pixel-art hack-and-slash. Fight through designed rifts and endless generated ones, slay their bosses, and build a hero from loot, skill gems and a passive tree.',
  /** The rift's warm light (PALETTE.orange). */
  themeColor: '#ef7d57',
  type: 'Game',
  genre: 'RPG',
  /**
   * Keys first, as the Couch draws them (keycaps, then what they do: the catalogue's *Controls*;
   * game/controls.ts `KEYS`, `MOUSE`), then a pad or touch for it all, then couch co-op's pads.
   */
  controls: 'WASD to move; click to attack; right click or 1–4 for skills; Space to dodge; F to interact; Tab for the map; gamepad or touch to play; gamepads for players 2–4',
  /**
   * A DualSense's extras it uses through 52in1 (`hub:dualsense`): the light bar (the hero's life,
   * game/padFeel.ts), haptics (play's rumbles), motion aim (`turnAim`), the touchpad's press (the
   * map) and the speaker (the portal and loud drops on the `speaker` bus). No adaptive triggers
   * (only Engine World's Drift Track has them), no microphone.
   */
  dualsense: 'light bar, haptics, motion, touchpad, speaker',
  /** The agent tool that builds it (the model and its effort are given to the hand-over build). */
  harness: 'Claude Code',
  webgpu: 'required',
};

/**
 * The wall's tags (2 to 5, the catalogue's *The lists*): what it is, co-op (online by default, and
 * on the couch; `hub:multiplayer` says the rest), and the inputs it plays fully on, a controller
 * and touch alone (52in1's filters and the Friends view go by them).
 */
export const TAGS = ['action-rpg', 'pixel art', 'co-op', 'gamepad', 'touch'];

const HOWTO = 'WASD move · click attack · 1-4 skills · Space dodge · or a gamepad or touch';

/** What the hub's card says, per mode's word (goal at most 60 characters, controls 80). */
export const CARD = {
  'co-op': { goal: 'Slay the rift boss together before time runs out', howto: HOWTO },
  versus: { goal: 'Outscore the others: most kills, and hit the boss hardest', howto: HOWTO },
  ghost: { goal: 'Slay the rift boss first; most kills if time runs out', howto: HOWTO },
  parallel: { goal: 'Slay the rift boss first; most kills if time runs out', howto: HOWTO },
  moments: { goal: 'Clear each moment, and quicker than your friends', howto: HOWTO },
};

/** Minutes a round takes (the hub calls time at half again as long); a moment lasts its own seconds. */
export const ROUND_MINUTES = 5;

/** `hub:multiplayer`'s text. */
export const multiplayerTag = () => MULTIPLAYER.map((m) => [m.where, m.how, m.players].filter(Boolean).join(' ')).join(', ');

/**
 * The page's catalogue and session tags: every way to play together in `hub:multiplayer`, the
 * default's card as the plain `hub:session-goal`/`-howto`, each online mode's own beside it (couch
 * co-op has no card: it is no session's), and one `hub:moment` per moment
 * (`moments`: their tags' contents, from the game's table: src/riftlight/session/moments.ts).
 * `model` and `effort` name what built this build (the hand-over build is given them).
 */
export function riftlightTags({ model, effort, moments = [] } = {}) {
  const main = MULTIPLAYER.find((m) => m.where === DEFAULT_MODE);
  const own = {};
  for (const m of MULTIPLAYER.filter(isOnline)) {
    const word = modeWord(m);
    own[`hub:session-goal-${word}`] = CARD[word].goal;
    own[`hub:session-howto-${word}`] = CARD[word].howto;
  }
  return {
    tags: {
      'hub:catalogue': '1',
      'hub:type': CATALOGUE.type,
      'hub:genre': CATALOGUE.genre,
      'hub:tags': TAGS.join(', '),
      'hub:controls': CATALOGUE.controls,
      'hub:model': model,
      'hub:effort': effort,
      'hub:harness': CATALOGUE.harness,
      'hub:session': '1',
      // how many play at once: the most a ghost, a shared world or the couch seats (parallel and moments aside)
      'hub:players': '1-4',
      'hub:multiplayer': multiplayerTag(),
      'hub:webgpu': CATALOGUE.webgpu,
      'hub:dualsense': CATALOGUE.dualsense,
    },
    session: {
      // the players of its online modes (the couch is no session's)
      'hub:session-players': '1-4',
      'hub:session-mode': DEFAULT_MODE,
      'hub:session-goal': CARD[modeWord(main)].goal,
      'hub:session-howto': CARD[modeWord(main)].howto,
      'hub:session-minutes': String(ROUND_MINUTES),
      ...own,
    },
    moments,
  };
}
