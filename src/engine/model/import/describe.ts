/**
 * Words and tags for an imported model or texture, from its name, so imports search and read
 * like the library (`search`, `npm run model -- find`, the kit's LIBRARY.md): Kenney's
 * `tree_pineDefault_a.glb` becomes "Tree pine default a" with the tags nature, tree and plant.
 * `NAME_TAGS` maps a word of a name to library tags (docs/ASSETS.md *Importing*); a word it
 * doesn't know adds nothing, and the name's words stay searchable through the id and `about`.
 */
import { searchWords, wordForms } from '../../catalog';

const NATURE = ['nature'];
const PLANT = ['nature', 'plant'];
const TREE = ['nature', 'tree', 'plant'];
const CROP = ['farm', 'plant', 'food'];
const ROCK = ['nature', 'stone'];
const WATER = ['nature', 'water'];
const ARCH = ['architecture'];
const FURN = ['furniture'];
const SEAT = ['furniture', 'seat'];
const STORE = ['furniture', 'storage'];
const KITCHEN = ['furniture', 'kitchen'];
const BATH = ['furniture', 'bathroom'];
const TECH = ['electronics'];
const WEAPON = ['weapon'];
const SIEGE = ['weapon', 'siege'];
const CHAR = ['character'];
const MONSTER = ['character', 'monster'];
const LOOT = ['loot'];
const CONTAINER = ['container'];

/** A name's word (singular) → the library tags it adds. */
export const NAME_TAGS: Readonly<Record<string, readonly string[]>> = {
  // nature
  tree: TREE, pine: TREE, oak: TREE, palm: TREE, birch: TREE, forest: TREE, sapling: TREE,
  bush: PLANT, plant: PLANT, flower: [...PLANT, 'flower'], grass: [...PLANT, 'grass'], leaf: PLANT, bamboo: PLANT,
  cactus: [...PLANT, 'desert'], lily: [...PLANT, 'water'], moss: PLANT, mushroom: PLANT, vine: PLANT, hedge: PLANT,
  crop: CROP, corn: CROP, wheat: CROP, carrot: CROP, melon: CROP, pumpkin: CROP, turnip: CROP,
  rock: ROCK, stone: ['stone'], boulder: ROCK, cliff: ROCK, plateau: ROCK, hill: ROCK, cave: [...ROCK, 'cave'],
  river: WATER, waterfall: WATER, beach: [...NATURE, 'sand'], water: WATER, well: ['water', 'town'],
  stump: [...NATURE, 'wood'], log: [...NATURE, 'wood'], dirt: ['ground'], ground: ['ground'], path: ['ground', 'road'], mud: ['ground'],
  cobble: ['ground', 'road', 'stone'],
  campfire: ['fire', 'camp'], fire: ['fire'], tent: ['camp', 'cloth'], canoe: ['transport', 'water', 'wood'], paddle: ['tool', 'wood'],
  // building
  wall: [...ARCH, 'wall'], tower: [...ARCH, 'tower'], gate: [...ARCH, 'door'], door: [...ARCH, 'door'], doorway: [...ARCH, 'door'],
  portcullis: [...ARCH, 'door'], archway: [...ARCH, 'door'], arch: ARCH, roof: [...ARCH, 'roof'], gable: [...ARCH, 'roof'], stair: [...ARCH, 'stairs'],
  step: [...ARCH, 'stairs'], floor: [...ARCH, 'floor'], ceiling: [...ARCH, 'ceiling'], bridge: [...ARCH, 'bridge'], column: [...ARCH, 'column'],
  pillar: [...ARCH, 'column'], window: [...ARCH, 'window'], battlement: [...ARCH, 'wall'], castle: ['castle'], brick: ['stone', 'wall'],
  fence: ['fence', 'farm'], rail: ['fence'], plank: ['wood'], paneling: ['wood', 'wall'], ladder: ['ladder', 'wood'],
  platform: ARCH, slope: ARCH, statue: ['monument', 'stone'], obelisk: ['monument', 'stone'], grave: ['grave', 'tomb'], gravestone: ['grave', 'tomb'],
  sign: ['sign'], signpost: ['sign'], flag: ['banner', 'cloth'], banner: ['banner', 'cloth'], pennant: ['banner', 'cloth'],
  // siege
  siege: SIEGE, ballista: SIEGE, catapult: SIEGE, trebuchet: SIEGE, ram: SIEGE,
  // furniture
  table: [...FURN, 'table'], desk: [...FURN, 'table'], chair: SEAT, sofa: SEAT, bench: SEAT, stool: SEAT, ottoman: SEAT, lounge: SEAT, seat: SEAT,
  bed: [...FURN, 'bed'], bunk: [...FURN, 'bed'], cabinet: STORE, bookcase: [...STORE, 'books'], shelf: STORE, drawer: STORE, dresser: STORE,
  coat: FURN, rack: FURN, rug: [...FURN, 'cloth'], cushion: [...FURN, 'cloth'], pillow: [...FURN, 'cloth'], doormat: [...FURN, 'cloth'],
  kitchen: KITCHEN, fridge: KITCHEN, stove: KITCHEN, sink: KITCHEN, microwave: KITCHEN, toaster: KITCHEN, blender: KITCHEN, hood: KITCHEN,
  washer: KITCHEN, dryer: KITCHEN, trashcan: FURN, bathroom: BATH, toilet: BATH, shower: BATH, bathtub: BATH, mirror: FURN,
  television: TECH, computer: TECH, laptop: TECH, keyboard: TECH, mouse: TECH, screen: TECH, speaker: TECH, radio: TECH, antenna: TECH,
  lamp: ['lighting', 'light'], lantern: ['lighting', 'light'], torch: ['lighting', 'light', 'fire'], candle: ['lighting', 'light'], fan: TECH,
  book: ['books'], bear: ['toy'], box: CONTAINER, cardboard: CONTAINER, crate: [...CONTAINER, 'wood'], barrel: [...CONTAINER, 'wood'],
  chest: [...CONTAINER, ...LOOT], pot: [...CONTAINER, 'clay'], sack: CONTAINER, bucket: CONTAINER, basin: ['water'], cart: ['transport', 'wood'],
  anvil: ['tool', 'iron'], beehive: ['farm'], target: ['training'], cursor: ['ui'], marker: ['ui'],
  // dungeon, loot and weapons
  coin: [...LOOT, 'gold', 'coin'], key: [...LOOT, 'key'], potion: [...LOOT, 'potion', 'consumable'], vial: [...LOOT, 'potion', 'consumable'],
  trap: ['trap'], drain: ['dungeon'], mimic: [...MONSTER, 'container'],
  weapon: WEAPON, sword: [...WEAPON, 'sword'], broadsword: [...WEAPON, 'sword'], dagger: [...WEAPON, 'dagger'], cleaver: WEAPON,
  spear: [...WEAPON, 'spear'], axe: [...WEAPON, 'axe'], hammer: [...WEAPON, 'hammer'], mallet: [...WEAPON, 'hammer'], staff: [...WEAPON, 'staff', 'magic'],
  bow: [...WEAPON, 'bow'], arrow: ['ammo', 'arrow'], bomb: [...WEAPON, 'bomb'], shield: ['shield'],
  pickaxe: ['tool'], pitchfork: ['tool', 'farm'], sickle: ['tool', 'farm'],
  // characters
  character: CHAR, human: CHAR, villager: CHAR, peasant: CHAR, knight: CHAR, soldier: CHAR, wizard: [...CHAR, 'magic'], dwarf: CHAR,
  rogue: CHAR, bandit: CHAR, elder: CHAR, maiden: CHAR, orc: MONSTER, slime: MONSTER, cyclops: MONSTER, ghost: MONSTER,
  bat: [...MONSTER, 'critter'], spider: [...MONSTER, 'critter'], rat: [...MONSTER, 'critter'], demon: MONSTER, crab: MONSTER,
};

/** The library tags a name's words add (`NAME_TAGS`), in order, once each. */
export function nameTags(name: string): string[] {
  const out: string[] = [];
  for (const w of searchWords(name)) {
    const key = wordForms(w).find((f) => Object.hasOwn(NAME_TAGS, f));
    for (const t of key ? NAME_TAGS[key]! : []) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** A name as words: `tree-pine-default-a` → "Tree pine default a". */
export function nameWords(name: string): string {
  const s = searchWords(name).join(' ');
  return s ? s[0]!.toUpperCase() + s.slice(1) : name;
}

export interface Describe {
  /** The pack's id: the first tag after 'imported'. */
  readonly pack?: string;
  /** The pack's name, for `about` ("Kenney Nature Kit 2.1"). */
  readonly title?: string;
  /** The file it came from, for `about`. */
  readonly file?: string;
  /** Tags every asset of the pack gets. */
  readonly tags?: readonly string[];
}

/**
 * `about` and `tags` for an imported asset named `name` (an id's last part): the name in words,
 * where it came from, and 'imported', the pack, the pack's tags and the name's (`nameTags`).
 */
export function describeImport(name: string, o: Describe = {}): { about: string; tags: string[] } {
  const from = [o.title ?? o.pack, o.file].filter(Boolean).join(': ');
  const tags: string[] = [];
  for (const t of ['imported', ...(o.pack ? [o.pack] : []), ...(o.tags ?? []), ...nameTags(name)]) if (!tags.includes(t)) tags.push(t);
  return { about: `${nameWords(name)}${from ? ` (imported from ${from})` : ' (imported)'}`, tags };
}
