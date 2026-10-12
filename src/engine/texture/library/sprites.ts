import { textureDef } from '../helpers';

export const gemIcon = textureDef({
  id: 'gem-icon',
  about: 'A cut gem with a glint, outlined: an icon for the HUD or loot',
  tags: ['icon', 'loot', 'sprite'],
  size: [10, 9],
  palette: { glint: 'white', light: 'cyan', mid: 'sky', dark: 'blue', edge: 'navy' },
  layers: [
    // the left half, mirrored right
    { pixels: ['.llg', 'llmm', 'lmmm', 'dddm', '.ddm', '..dm', '...d'], legend: { g: 'glint', l: 'light', m: 'mid', d: 'dark' }, at: [1, 1], mirror: 'x' },
    { outline: 'edge' },
  ],
});

export const coinSpin = textureDef({
  id: 'coin-spin',
  about: 'A gold coin turning: face, three-quarter, edge, three-quarter (4 frames of 8 x 8)',
  tags: ['coin', 'loot', 'sprite', 'animated'],
  size: [32, 8],
  frames: 4,
  palette: { face: 'sand', rim: 'orange', shine: 'white', edge: 'plum' },
  layers: [
    {
      pixels: [
        '................................',
        '..ssss.....ss......oo......ss...',
        '.swssso...swso.....oo.....osws..',
        '.swssso...swso.....oo.....osws..',
        '.ssssso...ssso.....oo.....osss..',
        '.ssssso...ssso.....oo.....osss..',
        '..oooo.....oo......oo......oo...',
        '................................',
      ],
      legend: { s: 'face', o: 'rim', w: 'shine' },
    },
    { outline: 'edge' },
  ],
});

// Item icons: read at 1x in an inventory slot, lit from the top left, a 1-texel outline.

/** A round flask with a cork; the potions share it and differ in their palette. */
const flask = {
  pixels: [
    '............',
    '....cccc....',
    '.....cc.....',
    '....wrrr....',
    '..rrwrrrrr..',
    '.rrwrrrrrrd.',
    '.rrwrrrrrdd.',
    '.rrrrrrrrdd.',
    '.rrrrrrrddd.',
    '.rrrrrrrddd.',
    '..rrrrrddd..',
    '....dddd....',
    '............',
  ],
  legend: { c: 'cork', r: 'liquid', d: 'shade', w: 'glint' },
} as const;

export const potionRed = textureDef({
  id: 'potion-red',
  about: 'A round flask of red potion with a cork and a glint: a health potion icon',
  tags: ['icon', 'item', 'potion', 'loot'],
  size: [12, 13],
  palette: { cork: 'sand', liquid: 'red', shade: 'plum', glint: 'white', edge: 'ink' },
  layers: [flask, { outline: 'edge' }],
});

export const potionBlue = textureDef({
  id: 'potion-blue',
  about: 'A round flask of blue potion with a cork and a glint: a mana potion icon',
  tags: ['icon', 'item', 'potion', 'loot'],
  size: [12, 13],
  palette: { cork: 'sand', liquid: 'sky', shade: 'blue', glint: 'white', edge: 'ink' },
  layers: [flask, { outline: 'edge' }],
});

export const key = textureDef({
  id: 'key',
  about: 'A gold key lying flat: a round bow with a hole, the shaft and two teeth',
  tags: ['icon', 'item', 'key', 'loot'],
  size: [16, 10],
  palette: { light: 'sand', dark: 'orange', glint: 'white', edge: 'plum' },
  layers: [
    {
      pixels: [
        '................',
        '..wlll..........',
        '.llllld.........',
        '.ll..ld.........',
        '.ll..ldllllllll.',
        '.ld..dddddddddd.',
        '.lddddd...dd.dd.',
        '..dddd....dd.dd.',
        '.............dd.',
        '................',
      ],
      legend: { l: 'light', d: 'dark', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const scroll = textureDef({
  id: 'scroll',
  about: 'A parchment scroll between two rolls, three lines of writing',
  tags: ['icon', 'item', 'scroll', 'loot'],
  size: [14, 14],
  palette: { paper: 'sand', shade: 'orange', glint: 'white', edge: 'plum' },
  layers: [
    {
      pixels: [
        '..............',
        '.wlllllllllll.',
        '.dddddddddddd.',
        '..llllllllll..',
        '..lddddddlll..',
        '..llllllllll..',
        '..lddddddddl..',
        '..llllllllll..',
        '..ldddddllll..',
        '..llllllllll..',
        '.dddddddddddd.',
        '.wlllllllllll.',
        '.dddddddddddd.',
        '..............',
      ],
      legend: { l: 'paper', d: 'shade', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const ring = textureDef({
  id: 'ring',
  about: 'A gold ring set with a red stone, the hole showing through',
  tags: ['icon', 'item', 'jewel', 'loot'],
  size: [12, 11],
  palette: { light: 'sand', dark: 'orange', stone: 'red', glint: 'white', edge: 'plum' },
  layers: [
    {
      pixels: [
        '............',
        '....gwgg....',
        '...lggggd...',
        '..ll....dd..',
        '.ll......dd.',
        '.ll......dd.',
        '.ll......dd.',
        '.ld......dd.',
        '..dd....dd..',
        '...dddddd...',
        '............',
      ],
      legend: { l: 'light', d: 'dark', g: 'stone', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const amulet = textureDef({
  id: 'amulet',
  about: 'A gold pendant set with a green stone, on a chain',
  tags: ['icon', 'item', 'jewel', 'loot'],
  size: [12, 13],
  palette: { light: 'sand', dark: 'orange', stone: 'green', glint: 'lime', edge: 'plum' },
  layers: [
    {
      pixels: [
        '............',
        '.l........l.',
        '.l........l.',
        '..l......l..',
        '..l......l..',
        '...l....l...',
        '...l....l...',
        '....llll....',
        '...lwwggd...',
        '...lwgggd...',
        '...lggggd...',
        '....dddd....',
        '............',
      ],
      legend: { l: 'light', d: 'dark', g: 'stone', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const shieldIcon = textureDef({
  id: 'shield-icon',
  about: 'A heater shield: a blue field in a gold rim, lit on its left half',
  tags: ['icon', 'item', 'armor', 'loot'],
  size: [12, 13],
  palette: { rim: 'sand', field: 'blue', shade: 'navy', glint: 'white', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '.rrrrrrrrrr.',
        '.rwfffFFFFr.',
        '.rwfffFFFFr.',
        '.rffffFFFFr.',
        '.rffffFFFFr.',
        '.rffffFFFFr.',
        '.rffffFFFFr.',
        '.rrfffFFFrr.',
        '..rrffFFrr..',
        '...rrfFrr...',
        '....rrrr....',
        '............',
      ],
      legend: { r: 'rim', f: 'field', F: 'shade', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const helmetIcon = textureDef({
  id: 'helmet-icon',
  about: 'A steel helm with an eye slit and a red crest',
  tags: ['icon', 'item', 'armor', 'loot'],
  size: [12, 12],
  palette: { light: 'mist', dark: 'slate', crest: 'red', glint: 'white', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '.....pp.....',
        '.....pp.....',
        '...mmmmss...',
        '..mwmmmsss..',
        '.mwmmmmssss.',
        '.mmmmmmssss.',
        '.m........s.',
        '.mmmmmmssss.',
        '.mmmmmsssss.',
        '.mmmmmmssss.',
        '............',
      ],
      legend: { m: 'light', s: 'dark', p: 'crest', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const bootsIcon = textureDef({
  id: 'boots-icon',
  about: 'A leather boot with a folded cuff and a dark sole, toe to the right',
  tags: ['icon', 'item', 'armor', 'loot'],
  size: [12, 11],
  palette: { cuff: 'sand', leather: 'orange', shade: 'red', sole: 'plum', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '.ccccccc....',
        '..lllld.....',
        '..lllld.....',
        '..lllld.....',
        '..lllld.....',
        '..llllldd...',
        '..llllclldd.',
        '..lllllllld.',
        '..ppp..pppp.',
        '............',
      ],
      legend: { c: 'cuff', l: 'leather', d: 'shade', p: 'sole' },
    },
    { outline: 'edge' },
  ],
});

export const armorIcon = textureDef({
  id: 'armor-icon',
  about: 'A steel breastplate with shoulder guards and a gold belt',
  tags: ['icon', 'item', 'armor', 'loot'],
  size: [14, 12],
  palette: { light: 'mist', dark: 'slate', belt: 'sand', glint: 'white', edge: 'ink' },
  layers: [
    {
      pixels: [
        '..............',
        '.mmmm....ssss.',
        '.mwmmm..sssss.',
        '.mmmmmmssssss.',
        '..mmmmmsssss..',
        '...mmmmssss...',
        '...mmmmssss...',
        '...mmmmssss...',
        '...bbbbbbbb...',
        '...mmmmssss...',
        '..mmmmmsssss..',
        '..............',
      ],
      legend: { m: 'light', s: 'dark', b: 'belt', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const swordIcon = textureDef({
  id: 'sword-icon',
  about: 'A straight sword, point up: a two-tone blade, a gold guard and pommel',
  tags: ['icon', 'item', 'weapon', 'loot'],
  size: [10, 16],
  palette: { light: 'mist', dark: 'slate', gold: 'sand', glint: 'white', edge: 'ink' },
  layers: [
    {
      pixels: [
        '..........',
        '....l.....',
        '....ls....',
        '....ws....',
        '....ws....',
        '....ls....',
        '....ls....',
        '....ls....',
        '....ls....',
        '....ls....',
        '.gggggggg.',
        '....ss....',
        '....ss....',
        '....gg....',
        '....gg....',
        '..........',
      ],
      legend: { l: 'light', s: 'dark', g: 'gold', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const bowIcon = textureDef({
  id: 'bow-icon',
  about: 'A wooden bow, upright, with a wrapped grip and its string',
  tags: ['icon', 'item', 'weapon', 'loot'],
  size: [10, 16],
  palette: { light: 'orange', dark: 'red', grip: 'sand', string: 'mist', edge: 'ink' },
  layers: [
    {
      pixels: [
        '..........',
        '......ll..',
        '.....lls..',
        '....gl.s..',
        '...ld..s..',
        '...ld..s..',
        '..gg...s..',
        '..gg...s..',
        '..gg...s..',
        '..gg...s..',
        '...ld..s..',
        '...ld..s..',
        '....dd.s..',
        '.....dds..',
        '......dd..',
        '..........',
      ],
      legend: { l: 'light', d: 'dark', g: 'grip', s: 'string' },
    },
    { outline: 'edge' },
  ],
});

export const goldIcon = textureDef({
  id: 'gold-icon',
  about: 'Two stacks of gold coins, a tall one and a short one beside it',
  tags: ['icon', 'item', 'coin', 'loot'],
  size: [15, 14],
  palette: { light: 'sand', dark: 'orange', glint: 'white', edge: 'plum' },
  layers: [
    {
      pixels: [
        '...............',
        '..llll.........',
        '.lwllll........',
        '.llllll........',
        '.dddddd........',
        '.llllll..llll..',
        '.dddddd.lwllll.',
        '.llllll.llllll.',
        '.dddddd.dddddd.',
        '.llllll.llllll.',
        '.dddddd.dddddd.',
        '.llllll.llllll.',
        '..dddd...dddd..',
        '...............',
      ],
      legend: { l: 'light', d: 'dark', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

// UI glyphs: 8 x 8 with their outline, for health, rating and death marks.

export const heart = textureDef({
  id: 'heart',
  about: 'A red heart with a glint: health',
  tags: ['icon', 'ui', 'health'],
  size: [8, 8],
  palette: { body: 'red', shade: 'plum', glint: 'white', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '.rr..rr.', '.rwrrrr.', '.rrrrrd.', '.rrrrdd.', '..rrdd..', '...dd...', '........'],
      legend: { r: 'body', d: 'shade', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const star = textureDef({
  id: 'star',
  about: 'A gold five-pointed star with a glint: a rating or a favourite',
  tags: ['icon', 'ui', 'rating'],
  size: [8, 8],
  palette: { body: 'sand', shade: 'orange', glint: 'white', edge: 'plum' },
  layers: [
    {
      pixels: ['........', '...ws...', '...ss...', '.ssssss.', '..ssso..', '..ssoo..', '.ss..oo.', '........'],
      legend: { s: 'body', o: 'shade', w: 'glint' },
    },
    { outline: 'edge' },
  ],
});

export const skull = textureDef({
  id: 'skull',
  about: 'A white skull with dark eyes: death, danger or a kill count',
  tags: ['icon', 'ui', 'death'],
  size: [8, 8],
  palette: { bone: 'white', shade: 'mist', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '..bbbb..', '.bbbbbs.', '.b.bb.s.', '.b.bs.s.', '.bbbsss.', '..b..s..', '........'],
      legend: { b: 'bone', s: 'shade' },
    },
    { outline: 'edge' },
  ],
});

// Animated sprites: frames of 8 x 8, left to right, each outlined inside its own frame.

export const spark = textureDef({
  id: 'spark',
  about: 'A spark: a white point that flares into a cross and breaks into fading bits (4 frames of 8 x 8)',
  tags: ['icon', 'effect', 'sprite', 'animated'],
  size: [32, 8],
  frames: 4,
  palette: { core: 'white', flare: 'sand', tip: 'orange', ember: 'red', edge: 'plum' },
  layers: [
    {
      // one frame per string: point, cross, burst, embers
      pixels: [
        '........' + '........' + '........' + '........',
        '........' + '........' + '...tt...' + '...ee...',
        '........' + '...ff...' + '...ff...' + '........',
        '...cc...' + '..fccf..' + '.tfccft.' + '.e....e.',
        '...cc...' + '..fccf..' + '.tfccft.' + '.e....e.',
        '........' + '...ff...' + '...ff...' + '........',
        '........' + '........' + '...tt...' + '...ee...',
        '........' + '........' + '........' + '........',
      ],
      legend: { c: 'core', f: 'flare', t: 'tip', e: 'ember' },
    },
    { outline: 'edge' },
  ],
});

export const smokePuff = textureDef({
  id: 'smoke-puff',
  about: 'A puff of smoke that swells, then thins into wisps (4 frames of 8 x 8)',
  tags: ['icon', 'effect', 'sprite', 'animated'],
  size: [32, 8],
  frames: 4,
  palette: { light: 'white', mid: 'mist', dark: 'slate', edge: 'night' },
  layers: [
    {
      // one frame per string: a small puff, swelling, at its fullest, broken into wisps
      pixels: [
        '........' + '........' + '........' + '........',
        '........' + '..ll....' + '.ll..lm.' + '.mm.....',
        '...ll...' + '.lllmm..' + '.lllmmm.' + '.mm..mm.',
        '..llmm..' + '.llmmmm.' + '.llmmmm.' + '.dd..mm.',
        '..lmmm..' + '.lmmmmd.' + '.mmmmmd.' + '.....dd.',
        '...mm...' + '..mmddd.' + '.mmmddd.' + '..mm....',
        '........' + '........' + '..dd.dd.' + '..dd....',
        '........' + '........' + '........' + '........',
      ],
      legend: { l: 'light', m: 'mid', d: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const SPRITES = [gemIcon, coinSpin, potionRed, potionBlue, key, scroll, ring, amulet, shieldIcon, helmetIcon, bootsIcon, armorIcon, swordIcon, bowIcon, goldIcon, heart, star, skull, spark, smokePuff];
