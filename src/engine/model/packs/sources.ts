/**
 * Third-party packs the importer may fetch (`npm run model -- import-pack <id>`,
 * docs/plans/asset-system.md §7.1). Committing someone else's content is a licence decision, so a
 * pack joins this list only once the repository owner approves it on the licence escalation (#49,
 * https://github.com/michaelcrosato/riftlight/issues/49), and `approved` links that comment
 * (`APPROVAL` checks the link's form). Agents here act through the owner's GitHub account, so no
 * code can prove a comment's author is human: approval is the owner's own comment, never one an
 * agent wrote. A pack the owner hasn't approved isn't listed, so `import-pack` refuses it.
 * `packSourceProblems` (tested) checks every entry: id, https url, sha256, licence and approval.
 */
import type { PaletteColor } from '../../palette';

export interface PackSource {
  readonly id: string;
  /** The archive (zip) or single file to download. */
  readonly url: string;
  /** Its sha256 (64 lower-case hex digits): a download that differs is refused. */
  readonly sha256: string;
  /** SPDX id (a key of `LICENCES`), checked against the licence files in the download. */
  readonly licence: string;
  readonly author: string;
  readonly homepage: string;
  /** Link to the owner's approving comment on #49. */
  readonly approved: string;
  /** The pack's name as people know it ("Kenney Nature Kit 2.1"): each asset's `about` says it. */
  readonly title?: string;
  /**
   * Source units → metres for its models (default 1: glTF is in metres). Kits made in tile units
   * need it: Kenney's are about half a metre, so a doorway comes in 1 m tall at 1 and 2 m at 2.
   * Pick it so a door or a character matches the hero (1.6 m) and the library.
   */
  readonly scale?: number;
  /** Library tags every asset of the pack gets (docs/assets/importing.md *Packs*), beside those its name adds. */
  readonly tags?: readonly string[];
  /**
   * Slots of the pack's models' colour map bound to other PALETTE entries: an agent's choice,
   * made once from the import's swatches (`model -- import-pack` prints them), so the pack sits
   * in the engine's style. A sheet has a colour map of its own: `PackSheet.palette`.
   */
  readonly palette?: Readonly<Record<string, PaletteColor>>;
  /** 2D: pixel-art sheets in the download to slice into textures (`npm run tex -- import-pack`). */
  readonly sheets?: readonly PackSheet[];
}

/** One pixel-art sheet in a pack's download, sliced on a grid into one texture per cell. */
export interface PackSheet {
  /** Its path in the download. */
  readonly file: string;
  /** Cell size in pixels. */
  readonly grid: readonly [w: number, h: number];
  /** Cell names by reading-order index (`''` or missing: the cell's index); ids are `<pack>/<name>`. */
  readonly names?: readonly string[];
  /** Names of the cells that tile seamlessly (floors, walls, grass). */
  readonly tiles?: readonly string[];
  /** Tags every texture of this sheet gets. */
  readonly tags?: readonly string[];
  /** Slots of this sheet's colour map bound to other PALETTE entries (`tex -- import-pack` prints them). */
  readonly palette?: Readonly<Record<string, PaletteColor>>;
}

/** The owner's approval of the six Kenney packs below (all CC0, sha256s listed there) on #49. */
const KENNEY_APPROVED = 'https://github.com/michaelcrosato/riftlight/issues/49#issuecomment-6180012221';

export const PACK_SOURCES: readonly PackSource[] = [
  {
    id: 'kenney-castle',
    url: 'https://kenney.nl/media/pages/assets/castle-kit/a395102d20-1711543616/kenney_castle-kit.zip',
    sha256: '921f3f73927bb23106cae34bc21d5ab4b033a9fc120475e96f714a406e3169df',
    licence: 'CC0-1.0',
    author: 'Kenney',
    homepage: 'https://kenney.nl/assets/castle-kit',
    approved: KENNEY_APPROVED,
    title: 'Kenney Castle Kit 2.0',
    tags: ['castle'],
    scale: 3,
  },
  {
    id: 'kenney-furniture',
    url: 'https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip',
    sha256: 'e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0',
    licence: 'CC0-1.0',
    author: 'Kenney',
    homepage: 'https://kenney.nl/assets/furniture-kit',
    approved: KENNEY_APPROVED,
    title: 'Kenney Furniture Kit 2.0',
    tags: ['furniture', 'interior'],
    scale: 2,
    palette: { woodDark: 'orange', lamp: 'sand', plant: 'green' },
  },
  {
    id: 'kenney-nature',
    url: 'https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip',
    sha256: 'fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d',
    licence: 'CC0-1.0',
    author: 'Kenney',
    homepage: 'https://kenney.nl/assets/nature-kit',
    approved: KENNEY_APPROVED,
    title: 'Kenney Nature Kit 2.1',
    tags: ['nature'],
    scale: 3,
    palette: { grass: 'green', leafsDark: 'teal', purple: 'plum' },
  },
  {
    id: 'kenney-mini-dungeon',
    url: 'https://kenney.nl/media/pages/assets/mini-dungeon/6cd72dc849-1785314274/kenney_mini-dungeon.zip',
    sha256: '19c4648680cb1d2e8836cade96cbf9781c0c1f45fbc6d2ce41cee8239a3ec4d8',
    licence: 'CC0-1.0',
    author: 'Kenney',
    homepage: 'https://kenney.nl/assets/mini-dungeon',
    approved: KENNEY_APPROVED,
    title: 'Kenney Mini Dungeon 2.0',
    tags: ['dungeon'],
    scale: 2,
    palette: { c15: 'sand' },
  },
  {
    id: 'kenney-tiny-dungeon',
    url: 'https://kenney.nl/media/pages/assets/tiny-dungeon/f8422efb44-1674742415/kenney_tiny-dungeon.zip',
    sha256: 'c109438ab06f65fd80f9b2686a4cf9c7c11dc64444b47333ec71d602f8bb5fc7',
    licence: 'CC0-1.0',
    author: 'Kenney',
    homepage: 'https://kenney.nl/assets/tiny-dungeon',
    approved: KENNEY_APPROVED,
    title: 'Kenney Tiny Dungeon 1.0',
    tags: ['dungeon', 'sprite'],
    sheets: [
      {
        file: 'Tilemap/tilemap_packed.png',
        grid: [16, 16],
        names: [
          'wall-top', 'wall-top-b', 'wall-ledge-corner-a', 'wall-ledge-corner-b', 'wall-cap-left', 'wall-cap-right', 'wall-pillar', 'wall-fountain', 'wall-fountain-slime', 'doorway-rubble', 'doorway-left', 'doorway-right',
          'wall-top-holes', 'wall-edge-right', 'brick-wall', 'wall-edge-left', 'wall-frame-left', 'wall-frame-right', 'column', 'wall-demon-face', 'wall-demon-slime', 'door-open-left', 'door-open', 'door-open-right',
          'wall-top-rubble', 'wall-top-c', 'wall-base-left', 'wall-base-right', 'wall-vent', 'banner-red', 'floor-pillar-base', 'basin', 'basin-slime', 'door-ajar-left', 'door-ajar', 'door-ajar-right',
          'stairs-left', 'stairs', 'stairs-right', 'stairs-narrow', 'brick-wall-b', 'gate-bars', 'floor-flagstones', 'drain', 'drain-slime', 'door-closed', 'door-double-left', 'door-double-right',
          'floor', 'floor-speckled', 'floor-patch-a', 'floor-patch-b', 'floor-patch-c', 'floor-patch-d', 'iron-box', 'stone-frame', 'hole', 'brick-pillar-a', 'brick-pillar-b', 'brick-pillar-c',
          'cursor', 'marker-box', 'marker-stripes', 'bookshelf', 'grave-cross', 'gravestone', 'wooden-board', 'ladder', 'ladder-b', 'rail-curve-left', 'rail-straight', 'rail-curve-right',
          'table', 'stool', 'anvil', 'cabinet', 'fence-left', 'fence', 'fence-right', 'rail-a', 'rail-b', 'ladder-c', 'barrel', 'ladder-d',
          'wizard', 'villager', 'peasant', 'dwarf', 'rogue', 'chest', 'chest-wood', 'chest-iron', 'mimic', 'rail-bend-left', 'rail-bend', 'rail-bend-right',
          'knight', 'knight-visor', 'soldier', 'maiden', 'elder', 'shield-square', 'shield-round', 'dagger', 'sword', 'cleaver', 'broadsword', 'wooden-sword',
          'slime', 'cyclops', 'crab-demon', 'dark-wizard', 'bandit', 'potion-empty', 'potion-green', 'potion-red', 'potion-blue', 'hammer', 'double-axe', 'axe',
          'bat', 'ghost', 'spider', 'rat', 'rat-grey', 'vial-empty', 'vial-green', 'vial-red', 'vial-blue', 'staff-purple', 'staff-blue', 'spear',
        ],
        tiles: ['wall-top', 'wall-top-b', 'wall-top-c', 'brick-wall', 'brick-wall-b', 'floor', 'floor-speckled'],
        palette: { c6: 'plum', c10: 'red' },
      },
    ],
  },
  {
    id: 'kenney-tiny-town',
    url: 'https://kenney.nl/media/pages/assets/tiny-town/a415fbeb49-1735736916/kenney_tiny-town.zip',
    sha256: '9768692dccff1d706408a5aedd6ca4f6cd1409506cbc84cb2f862919764be977',
    licence: 'CC0-1.0',
    author: 'Kenney',
    homepage: 'https://kenney.nl/assets/tiny-town',
    approved: KENNEY_APPROVED,
    title: 'Kenney Tiny Town 1.1',
    tags: ['town', 'sprite'],
    sheets: [
      {
        file: 'Tilemap/tilemap_packed.png',
        grid: [16, 16],
        names: [
          'grass', 'grass-tufts', 'grass-flowers', 'pine-autumn', 'pine', 'bush', 'forest-a', 'forest-b', 'forest-c', 'forest-autumn-a', 'forest-autumn-b', 'forest-autumn-c',
          'path-top-left', 'path-top', 'path-top-right', 'tree-autumn', 'tree', 'sapling', 'forest-d', 'forest-e', 'forest-f', 'forest-autumn-d', 'forest-autumn-e', 'forest-autumn-f',
          'path-left', 'path', 'path-right', 'pine-autumn-b', 'pine-b', 'mushrooms', 'forest-g', 'forest-h', 'forest-i', 'forest-autumn-g', 'forest-autumn-h', 'forest-autumn-i',
          'path-bottom-left', 'path-bottom', 'path-bottom-right', 'path-corner-a', 'path-corner-b', 'path-corner-c', 'path-corner-d', 'cobbles', 'fence-left', 'fence', 'fence-right', 'fence-post',
          'roof-grey-left', 'roof-grey', 'roof-grey-right', 'roof-grey-window', 'roof-red-left', 'roof-red', 'roof-red-right', 'roof-red-window', 'fence-vertical-top', 'cart', 'fence-vertical', 'fence-vertical-bottom',
          'roof-grey-low-left', 'roof-grey-low', 'roof-grey-low-right', 'gable-grey', 'roof-red-low-left', 'roof-red-low', 'roof-red-low-right', 'gable-red', 'fence-corner', 'fence-gap-left', 'fence-gap-right', 'fence-post-b',
          'wall-wood-left', 'wall-wood', 'doorway-wood', 'wall-wood-right', 'wall-stone-left', 'wall-stone', 'doorway-stone', 'wall-stone-right', 'rail-left', 'rail', 'rail-right', 'signpost',
          'window-wood', 'door-wood', 'door-wood-b', 'door-wood-c', 'window-stone', 'door-stone', 'door-stone-b', 'door-stone-c', 'dirt-mound', 'coin', 'beehive', 'target',
          'castle-top-left', 'castle-top', 'castle-top-right', 'battlement-left', 'battlement', 'battlement-right', 'battlement-narrow', 'ladder', 'well', 'bomb', 'log', 'sack',
          'castle-wall-left', 'castle-wall', 'castle-wall-right', 'portcullis-left', 'portcullis-right', 'archway-left', 'archway-right', 'pickaxe', 'pitchfork', 'key', 'bow', 'arrow',
          'castle-base-left', 'castle-base', 'castle-base-right', 'tower-left', 'tower-dark', 'tower-window', 'bricks', 'axe', 'mallet', 'sickle', 'bucket', 'bucket-water',
        ],
        tiles: ['grass', 'grass-tufts', 'grass-flowers', 'path', 'cobbles', 'roof-grey', 'roof-red', 'castle-wall', 'bricks'],
        palette: { c1: 'ink', c2: 'sand', c9: 'plum' },
      },
    ],
  },
];
