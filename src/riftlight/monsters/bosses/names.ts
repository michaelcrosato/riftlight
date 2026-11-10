import type { Rng } from '../../core/rng';

/**
 * Boss names: a harsh syllable name plus an epithet from the boss's theme —
 * "Vorgath, the Emberhide". Deterministic in the Rng.
 */
const START = ['Vor', 'Kra', 'Mal', 'Zyr', 'Gor', 'Thal', 'Nyx', 'Ul', 'Bra', 'Skar', 'Vex', 'Mor', 'Xal', 'Dra', 'Ith', 'Kor', 'Sev', 'Ghar', 'Az', 'Ry'];
const MIDDLE = ['', '', 'a', 'o', 'u', 'e', 'ra', 'go', 'ul', 'eth', 'ma', 'iz'];
const END = ['gath', 'rok', 'mire', 'thas', 'vex', 'dun', 'nax', 'zul', 'grim', 'ra', 'loth', 'mar', 'ketch', 'vor', 'ith', 'goth'];

/** Each theme's epithets (each a line: lang/monsters.ts). */
export const EPITHETS: Readonly<Record<string, readonly string[]>> = {
  fire: ['Emberhide', 'Ashmaw', 'Cinderborn', 'Kiln Heart', 'Pyre Lord'],
  ice: ['Glass Matriarch', 'Rimeborn', 'Frostmantle', 'Winter Tooth', 'Hoarfang'],
  storm: ['Gale Mother', 'Stormcrown', 'Thunderhoof', 'Sky Render', 'Pylon King'],
  shadow: ['Lantern Eater', 'Gloomwalker', 'Night Hollow', 'Dark Feaster'],
  void: ['Gate Warden', 'Hollow Star', 'Riftborn', 'Unmaker', 'Starless'],
  nature: ['Thornweaver', 'Root Mother', 'Bramblemaw', 'Mossback'],
  poison: ['Bog Sovereign', 'Rotmaw', 'Venom Queen', 'Mire Tyrant'],
  blood: ['Sanguine', 'Bloodmoon Herald', 'Red Feast', 'Gorehound'],
  earth: ['Ruin Titan', 'Stonebreaker', 'Faultline', 'Deep Wyrm'],
  arcane: ['Twice-Struck', 'Echo Lord', 'Spellwright', 'Mirrored One'],
  undead: ['Gravecaller', 'Boneking', 'Deathless', 'Hollow King'],
  insect: ['Swarm Mother', 'Chitin King', 'Hive Tyrant'],
  beast: ['Packlord', 'Great Maw', 'Old Tusk', 'Alpha'],
  construct: ['Iron Colossus', 'Forge Engine', 'Clockwork Tyrant'],
  crystal: ['Prism Wyrm', 'Shardmother', 'Geode King'],
  water: ['Tide Eater', 'Deep Mother', 'Drowned King'],
};

/** A generated boss's name (in English: data, the bestiary's key); `bossNameParts` takes it apart, lang/monsters.ts shows it. */
export function bossName(rng: Rng, tags: readonly string[]): string {
  const name = `${rng.pick(START)}${rng.pick(MIDDLE)}${rng.pick(END)}`;
  const theme = tags.find((t) => EPITHETS[t]) ?? 'beast';
  return `${name}, the ${rng.pick(EPITHETS[theme]!)}`;
}

const KNOWN_EPITHETS: ReadonlySet<string> = new Set(Object.values(EPITHETS).flat());

/**
 * A generated boss's name taken apart: the invented name (a proper name, never translated) and
 * its epithet (one of `EPITHETS`); null for any other name (a designed boss's, a monster's).
 */
export function bossNameParts(full: string): { readonly name: string; readonly epithet: string } | null {
  const m = /^([^,]+), the (.+)$/.exec(full);
  return m && KNOWN_EPITHETS.has(m[2]!) ? { name: m[1]!, epithet: m[2]! } : null;
}

/** The phases every boss fight runs through (`BossPhase.name`), each a line. */
export const BOSS_PHASES = ['Awakened', 'Wrath', 'Desperation'] as const;
