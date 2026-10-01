import type { Rng } from '../../core/rng';

/**
 * Boss names: a harsh syllable name plus an epithet from the boss's theme —
 * "Vorgath, the Emberhide". Deterministic in the Rng.
 */
const START = ['Vor', 'Kra', 'Mal', 'Zyr', 'Gor', 'Thal', 'Nyx', 'Ul', 'Bra', 'Skar', 'Vex', 'Mor', 'Xal', 'Dra', 'Ith', 'Kor', 'Sev', 'Ghar', 'Az', 'Ry'];
const MIDDLE = ['', '', 'a', 'o', 'u', 'e', 'ra', 'go', 'ul', 'eth', 'ma', 'iz'];
const END = ['gath', 'rok', 'mire', 'thas', 'vex', 'dun', 'nax', 'zul', 'grim', 'ra', 'loth', 'mar', 'ketch', 'vor', 'ith', 'goth'];

const EPITHETS: Readonly<Record<string, readonly string[]>> = {
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

export function bossName(rng: Rng, tags: readonly string[]): string {
  const name = `${rng.pick(START)}${rng.pick(MIDDLE)}${rng.pick(END)}`;
  const theme = tags.find((t) => EPITHETS[t]) ?? 'beast';
  return `${name}, the ${rng.pick(EPITHETS[theme]!)}`;
}
