// Riftlight on 52in1: what its page tells the hub (AI Hub Catalogue v1) and each online mode's card
// (Session Protocol v1). One place for these words: `npm run build:single` writes them into the
// page's head (scripts/hub/head.mjs). docs/game/session.md.

/**
 * Every way Riftlight plays together (`hub:multiplayer`, the catalogue's *Playing together*): where,
 * how (a shared world's), and how many. One page offers them all; the hub picks one each round.
 */
export const MULTIPLAYER = [
  { where: 'shared-world', how: 'co-op', players: '1-4' },
  { where: 'shared-world', how: 'versus', players: '2-4' },
  { where: 'ghost', players: '1-4' },
  { where: 'parallel', players: '1-4' },
  { where: 'moments', players: '1-4' },
];

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
  controls: 'WASD to move; click or J to attack; right click, 1–4 or Q E R T to use skills; Space to dodge; F to interact; Esc to pause',
  /** The agent tool that builds it (the model and its effort are given to the hand-over build). */
  harness: 'Claude Code',
  webgpu: 'required',
};

/** The wall's tags (2 to 5): what it is, and co-op (its default mode; `hub:multiplayer` says the rest). */
const TAGS = ['action-rpg', 'pixel art', 'isometric', 'loot', 'co-op'];

const HOWTO = 'WASD move · click attack · right click or 1-4 skills · Space dodge';

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
 * The page's catalogue and session tags: every online mode in `hub:multiplayer`, the default's card
 * as the plain `hub:session-goal`/`-howto`, each mode's own beside it, and one `hub:moment` per moment
 * (`moments`: their tags' contents, from the game's table: src/riftlight/session/moments.ts).
 * `model` and `effort` name what built this build (the hand-over build is given them).
 */
export function riftlightTags({ model, effort, moments = [] } = {}) {
  const main = MULTIPLAYER.find((m) => m.where === DEFAULT_MODE);
  const own = {};
  for (const m of MULTIPLAYER) {
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
      // how many play at once: the most a ghost or shared world seats (parallel and moments aside)
      'hub:players': '1-4',
      'hub:multiplayer': multiplayerTag(),
      'hub:webgpu': CATALOGUE.webgpu,
    },
    session: {
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
