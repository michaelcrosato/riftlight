// Riftlight on the AI Hub: what its page tells the hub (AI Hub Catalogue v1) and each session mode's
// card (Session Protocol v1). One place for these words: `npm run build:single` writes them into the
// page's head (scripts/hub/head.mjs). docs/game/session.md.

/** The session modes Riftlight plays (docs/game/session.md); the page declares one. */
export const MODES = ['shared-world', 'ghost', 'parallel'];

/** The mode a page declares when the build is not told otherwise: co-op in one world. */
export const DEFAULT_MODE = 'shared-world';

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

/** Tags per mode: a ghost game is tagged race, a shared-world one co-op (the catalogue's rule). */
const TAGS = {
  'shared-world': ['action-rpg', 'pixel art', 'isometric', 'loot', 'co-op'],
  ghost: ['action-rpg', 'pixel art', 'isometric', 'loot', 'race'],
  parallel: ['action-rpg', 'pixel art', 'isometric', 'loot', 'dungeon crawler'],
};

/** What the hub's card says, per mode (goal at most 60 characters, controls 80). */
const CARD = {
  'shared-world': { goal: 'Slay the rift boss together before time runs out', howto: 'WASD move · click attack · right click or 1-4 skills · Space dodge' },
  ghost: { goal: 'Slay the rift boss first; most kills if time runs out', howto: 'WASD move · click attack · right click or 1-4 skills · Space dodge' },
  parallel: { goal: 'Slay the rift boss first; most kills if time runs out', howto: 'WASD move · click attack · right click or 1-4 skills · Space dodge' },
};

/** Minutes a round takes (the hub calls time at half again as long). */
export const ROUND_MINUTES = 5;

/**
 * The page's catalogue and session tags for `mode`. `model` and `effort` name what built this
 * build (the hand-over build is given them: `build:single -- --model ... --effort ...`).
 */
export function riftlightTags(mode = DEFAULT_MODE, { model, effort } = {}) {
  if (!MODES.includes(mode)) throw new Error(`riftlightTags: mode is one of ${MODES.join(', ')}`);
  const together = mode === 'ghost' || mode === 'shared-world';
  return {
    tags: {
      'hub:catalogue': '1',
      'hub:type': CATALOGUE.type,
      'hub:genre': CATALOGUE.genre,
      'hub:tags': TAGS[mode].join(', '),
      'hub:controls': CATALOGUE.controls,
      'hub:model': model,
      'hub:effort': effort,
      'hub:harness': CATALOGUE.harness,
      'hub:session': '1',
      'hub:players': together ? '1-4' : undefined,
      'hub:webgpu': CATALOGUE.webgpu,
    },
    session: {
      'hub:session-players': '1-4',
      'hub:session-mode': mode,
      'hub:session-goal': CARD[mode].goal,
      'hub:session-howto': CARD[mode].howto,
      'hub:session-minutes': String(ROUND_MINUTES),
    },
  };
}
