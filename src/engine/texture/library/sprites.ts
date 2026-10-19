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

// More item icons: weapons, gear and consumables, upright where they have a long axis, lit from
// the top left, outlined in ink (steel, wood, cloth) or plum (gold, paper, meat).

export const spearIcon = textureDef({
  id: 'spear-icon',
  about: 'A spear, point up: a leaf-shaped steel head bound with red cord to a long wooden shaft',
  tags: ['icon', 'item', 'weapon', 'spear', 'loot'],
  size: [10, 16],
  palette: { light: 'mist', dark: 'slate', glint: 'white', cord: 'red', wood: 'orange', grain: 'plum', edge: 'ink' },
  layers: [
    {
      pixels: [
        '..........',
        '....ls....',
        '...lwss...',
        '...lwss...',
        '...llss...',
        '...llss...',
        '....ls....',
        '...rrrr...',
        '....hd....',
        '....hd....',
        '....hd....',
        '....hd....',
        '....hd....',
        '....hd....',
        '....hd....',
        '..........',
      ],
      legend: { l: 'light', s: 'dark', w: 'glint', r: 'cord', h: 'wood', d: 'grain' },
    },
    { outline: 'edge' },
  ],
});

export const cloakIcon = textureDef({
  id: 'cloak-icon',
  about: 'A green hooded cloak with a gold clasp, the face in shadow under the hood',
  tags: ['icon', 'item', 'armor', 'cloak', 'loot'],
  size: [12, 14],
  palette: { light: 'green', dark: 'teal', clasp: 'sand', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '....lllD....',
        '...llllDD...',
        '...ll..DD...',
        '...ll..DD...',
        '...llccDD...',
        '..llllDDDD..',
        '..llllDDDD..',
        '..lDllDDlD..',
        '.llDllDDlDD.',
        '.llDllDDlDD.',
        '.llDllDDlDD.',
        '.lllllDDDDD.',
        '............',
      ],
      legend: { l: 'light', D: 'dark', c: 'clasp' },
    },
    { outline: 'edge' },
  ],
});

export const arrowsIcon = textureDef({
  id: 'arrows-icon',
  about: 'Three arrows, points up and staggered, with red fletching: ammunition',
  tags: ['icon', 'item', 'ammo', 'arrow', 'loot'],
  size: [13, 15],
  palette: { head: 'mist', shaft: 'orange', fletch: 'red', edge: 'ink' },
  layers: [
    {
      pixels: [
        '.............',
        '......m......',
        '.....mmm.....',
        '..m..mmm..m..',
        '.mmm..h..mmm.',
        '.mmm..h..mmm.',
        '..h...h...h..',
        '..h...h...h..',
        '..h...h...h..',
        '..h...h...h..',
        '..h..fhf..h..',
        '..h..fhf..h..',
        '.fhf.....fhf.',
        '.fhf.....fhf.',
        '.............',
      ],
      legend: { m: 'head', h: 'shaft', f: 'fletch' },
    },
    { outline: 'edge' },
  ],
});

export const bombIcon = textureDef({
  id: 'bomb-icon',
  about: 'A round black bomb with a steel cap and a lit fuse',
  tags: ['icon', 'item', 'bomb', 'consumable', 'loot'],
  size: [12, 14],
  palette: { glint: 'mist', body: 'slate', shade: 'night', fuse: 'orange', spark: 'sand', flare: 'white', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '........ws..',
        '......ffss..',
        '.....ff.....',
        '....gg......',
        '...bbbb.....',
        '..bbbbbb....',
        '.bggbbbbd...',
        '.bgbbbbbd...',
        '.bbbbbbdd...',
        '.bbbbbbdd...',
        '..bbbbdd....',
        '...dddd.....',
        '............',
      ],
      legend: { g: 'glint', b: 'body', d: 'shade', f: 'fuse', s: 'spark', w: 'flare' },
    },
    { outline: 'edge' },
  ],
});

export const torchIcon = textureDef({
  id: 'torch-icon',
  about: 'A burning torch: a flame with a white heart over a wrapped head and a wooden handle',
  tags: ['icon', 'item', 'torch', 'light', 'loot'],
  size: [8, 16],
  palette: { core: 'white', flame: 'sand', flame2: 'orange', wrap: 'slate', wood: 'orange', grain: 'red', edge: 'ink' },
  layers: [
    {
      pixels: [
        '........',
        '....o...',
        '...oo...',
        '..oyoo..',
        '..oyyo..',
        '.oywyyo.',
        '.oyyyyo.',
        '.ooyyoo.',
        '..cccc..',
        '..cccc..',
        '...hd...',
        '...hd...',
        '...hd...',
        '...hd...',
        '...dd...',
        '........',
      ],
      legend: { w: 'core', y: 'flame', o: 'flame2', c: 'wrap', h: 'wood', d: 'grain' },
    },
    { outline: 'edge' },
  ],
});

export const mapIcon = textureDef({
  id: 'map-icon',
  about: 'A folded treasure map: three parchment panels, a dashed red trail to a red X',
  tags: ['icon', 'item', 'map', 'quest', 'loot'],
  size: [14, 12],
  palette: { paper: 'sand', fold: 'orange', mark: 'red', edge: 'plum' },
  layers: [
    {
      pixels: [
        '..............',
        '.pppp....pppp.',
        '.ppppPPPPpppp.',
        '.ppppPPPPmppm.',
        '.ppppPPPPpmmp.',
        '.ppppPPPPpmmp.',
        '.ppppPPPPmppm.',
        '.ppppPPmmpppp.',
        '.pmmpPPPPpppp.',
        '.ppppPPPPpppp.',
        '.....PPPP.....',
        '..............',
      ],
      legend: { p: 'paper', P: 'fold', m: 'mark' },
    },
    { outline: 'edge' },
  ],
});

export const bookIcon = textureDef({
  id: 'book-icon',
  about: 'A closed blue tome with gold bands and a gold boss, its white pages showing',
  tags: ['icon', 'item', 'book', 'magic', 'loot'],
  size: [12, 13],
  palette: { cover: 'blue', shade: 'navy', gold: 'sand', pages: 'white', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '.Scccccccc..',
        '.ScccccccCp.',
        '.ScggggggCp.',
        '.ScccccccCp.',
        '.ScccggccCp.',
        '.ScccggccCp.',
        '.ScccccccCp.',
        '.ScggggggCp.',
        '.ScccccccCp.',
        '.SCCCCCCCCp.',
        '..ppppppppp.',
        '............',
      ],
      legend: { S: 'shade', c: 'cover', C: 'shade', g: 'gold', p: 'pages' },
    },
    { outline: 'edge' },
  ],
});

export const coinPouchIcon = textureDef({
  id: 'coin-pouch-icon',
  about: 'A leather coin pouch tied at the neck, a gold coin stamped on its front',
  tags: ['icon', 'item', 'coin', 'pouch', 'loot'],
  size: [12, 14],
  palette: { leather: 'orange', shade: 'red', tie: 'sand', edge: 'plum' },
  layers: [
    {
      pixels: [
        '............',
        '...ll..ld...',
        '....llld....',
        '....tttt....',
        '....llld....',
        '...llllld...',
        '..lllllldd..',
        '.llllllllld.',
        '.llllttllld.',
        '.llllttllld.',
        '.lllllllldd.',
        '..lllllddd..',
        '...dddddd...',
        '............',
      ],
      legend: { l: 'leather', d: 'shade', t: 'tie' },
    },
    { outline: 'edge' },
  ],
});

export const meatIcon = textureDef({
  id: 'meat-icon',
  about: 'A roast drumstick: browned meat with a crisp highlight, the white bone sticking out',
  tags: ['icon', 'item', 'food', 'consumable', 'loot'],
  size: [12, 12],
  palette: { crisp: 'sand', meat: 'orange', shade: 'red', bone: 'white', bone2: 'mist', edge: 'plum' },
  layers: [
    {
      pixels: [
        '............',
        '...oooo.....',
        '..ossoooo...',
        '.ossoooooo..',
        '.osooooorr..',
        '.ooooooorr..',
        '..oooorrrr..',
        '...rrrrrbb..',
        '.......bbm..',
        '.......bbbb.',
        '........bmm.',
        '............',
      ],
      legend: { s: 'crisp', o: 'meat', r: 'shade', b: 'bone', m: 'bone2' },
    },
    { outline: 'edge' },
  ],
});

export const herbIcon = textureDef({
  id: 'herb-icon',
  about: 'A sprig of green herb: paired leaves up a thin stem, lit on the left',
  tags: ['icon', 'item', 'herb', 'consumable', 'loot'],
  size: [10, 13],
  palette: { light: 'lime', dark: 'green', stem: 'teal', edge: 'ink' },
  layers: [
    {
      pixels: [
        '..........',
        '....ll....',
        '....ld....',
        '.ll.s.dd..',
        '.lllsddd..',
        '..llsdd...',
        '....s.....',
        '.ll.s.dd..',
        '.lllsddd..',
        '..llsdd...',
        '....s.....',
        '....s.....',
        '..........',
      ],
      legend: { l: 'light', d: 'dark', s: 'stem' },
    },
    { outline: 'edge' },
  ],
});

export const runeStoneIcon = textureDef({
  id: 'rune-stone-icon',
  about: 'A flat dark pebble carved with a glowing cyan rune (a trident)',
  tags: ['icon', 'item', 'rune', 'magic', 'loot'],
  size: [12, 11],
  palette: { glint: 'mist', stone: 'slate', shade: 'night', rune: 'cyan', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '...hhmmms...',
        '..hmmmmmss..',
        '.hmmcmcmcss.',
        '.mmmcmcmcss.',
        '.mmmcccccss.',
        '.mmmmmcmsss.',
        '.mmmmmcssss.',
        '..msssssss..',
        '...ssssss...',
        '............',
      ],
      legend: { h: 'glint', m: 'stone', s: 'shade', c: 'rune' },
    },
    { outline: 'edge' },
  ],
});

// Skill icons: a glyph for what the skill does, in its element's colours (fire sand to red,
// cold white to blue, lightning white and sand, poison lime to teal, physical white to slate).

export const fireballIcon = textureDef({
  id: 'fireball-icon',
  about: 'A fireball flying up and right: a white-hot heart in sand and orange, a red flame trail',
  tags: ['icon', 'skill', 'fire', 'fireball'],
  size: [12, 12],
  palette: { core: 'white', inner: 'sand', flame: 'orange', outer: 'red', edge: 'plum' },
  layers: [
    {
      pixels: [
        '............',
        '......oooo..',
        '.....oyyyyo.',
        '...rroywwyo.',
        '..roooywwyo.',
        '.rooooyyyyo.',
        '.roooooooo..',
        '.rrooorr....',
        '.rr.rrr.....',
        '.rr..r......',
        '.r..........',
        '............',
      ],
      legend: { w: 'core', y: 'inner', o: 'flame', r: 'outer' },
    },
    { outline: 'edge' },
  ],
});

export const frostNovaIcon = textureDef({
  id: 'frost-nova-icon',
  about: 'A burst of frost: an eight-pointed ice star round a white core',
  tags: ['icon', 'skill', 'cold', 'frost', 'nova'],
  size: [13, 13],
  palette: { core: 'white', ice: 'cyan', shade: 'sky', edge: 'navy' },
  layers: [
    {
      pixels: [
        '.............',
        '......c......',
        '......c......',
        '...cc.c.ss...',
        '...cccwsss...',
        '....cwwws....',
        '.cccwwwwwsss.',
        '....cwwws....',
        '...cccwsss...',
        '...cc.s.ss...',
        '......s......',
        '......s......',
        '.............',
      ],
      legend: { w: 'core', c: 'ice', s: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const lightningBoltIcon = textureDef({
  id: 'lightning-bolt-icon',
  about: 'A zigzag lightning bolt striking down, white along its lit edge, sand and orange',
  tags: ['icon', 'skill', 'lightning', 'bolt'],
  size: [11, 14],
  palette: { core: 'white', bolt: 'sand', shade: 'orange', edge: 'plum' },
  layers: [
    {
      pixels: [
        '...........',
        '.....wyyy..',
        '.....wyyo..',
        '....wyyo...',
        '....wyyo...',
        '...wyyo....',
        '...wyyyyyo.',
        '...ooooyyo.',
        '......yyo..',
        '......yo...',
        '.....yyo...',
        '.....yo....',
        '.....o.....',
        '...........',
      ],
      legend: { w: 'core', y: 'bolt', o: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const poisonCloudIcon = textureDef({
  id: 'poison-cloud-icon',
  about: 'A billowing green cloud of poison with a white skull in it',
  tags: ['icon', 'skill', 'poison', 'cloud'],
  size: [13, 11],
  palette: { light: 'lime', mid: 'green', dark: 'teal', bone: 'white', eye: 'ink', edge: 'ink' },
  layers: [
    {
      pixels: [
        '.............',
        '...ll...lll..',
        '..llll.lllll.',
        '.llllbbbllgg.',
        '.lllbbbbblgg.',
        '.lllbkbkbggg.',
        '.llgbbbbbggt.',
        '.lgggbgbggtt.',
        '..gggggtttt..',
        '...ggg.ttt...',
        '.............',
      ],
      legend: { l: 'light', g: 'mid', t: 'dark', b: 'bone', k: 'eye' },
    },
    { outline: 'edge' },
  ],
});

export const healIcon = textureDef({
  id: 'heal-icon',
  about: 'A bold green cross with a white glint, two sparkles beside it: healing',
  tags: ['icon', 'skill', 'heal', 'holy'],
  size: [12, 12],
  palette: { glint: 'white', light: 'lime', mid: 'green', edge: 'teal' },
  layers: [
    {
      pixels: [
        '............',
        '....lllg.ww.',
        '....lwlg.ww.',
        '....lllg....',
        '.llllllllll.',
        '.lllllllllg.',
        '.lllllllllg.',
        '.ggglllgggg.',
        '....lllg....',
        '.ww.lllg....',
        '.ww.gggg....',
        '............',
      ],
      legend: { w: 'glint', l: 'light', g: 'mid' },
    },
    { outline: 'edge' },
  ],
});

export const shieldBubbleIcon = textureDef({
  id: 'shield-bubble-icon',
  about: 'A protective bubble: a cyan ring with a white glint round a small gold shield',
  tags: ['icon', 'skill', 'shield', 'buff'],
  size: [14, 14],
  palette: { glint: 'white', light: 'cyan', mid: 'sky', dark: 'blue', gold: 'sand', gold2: 'orange', edge: 'navy' },
  layers: [
    {
      pixels: [
        '..............',
        '.....cccc.....',
        '...cwwccsss...',
        '..ccc....sss..',
        '..cc......ss..',
        '.cc.ggggoo.sb.',
        '.cc.ggggoo.bb.',
        '.cc.ggggoo.bb.',
        '.cs..ggoo..bb.',
        '..ss..go..bb..',
        '..sss....bbb..',
        '...sssbbbbb...',
        '.....bbbb.....',
        '..............',
      ],
      legend: { w: 'glint', c: 'light', s: 'mid', b: 'dark', g: 'gold', o: 'gold2' },
    },
    { outline: 'edge' },
  ],
});

export const dashIcon = textureDef({
  id: 'dash-icon',
  about: 'A dash: a white arrowhead pointing right, trailing grey speed lines',
  tags: ['icon', 'skill', 'movement', 'dash'],
  size: [13, 11],
  palette: { light: 'white', mid: 'mist', dark: 'slate', edge: 'ink' },
  layers: [
    {
      pixels: [
        '.............',
        '.......w.....',
        '.......ww....',
        'sssss..www...',
        '.......wwww..',
        '.mmmmmmwwwww.',
        '.......mmmm..',
        'sssss..mmm...',
        '.......mm....',
        '.......m.....',
        '.............',
      ],
      legend: { w: 'light', m: 'mid', s: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const whirlwindIcon = textureDef({
  id: 'whirlwind-icon',
  about: 'A whirlwind: a funnel of white and grey bands narrowing to a point',
  tags: ['icon', 'skill', 'physical', 'whirlwind'],
  size: [12, 12],
  palette: { light: 'white', mid: 'mist', dark: 'slate', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '.wwwwwwwwmm.',
        '.wwwwwwwwmm.',
        '...mmmmmmss.',
        '...mmmmmmss.',
        '..wwwwmm....',
        '..wwwwmm....',
        '.....mmss...',
        '.....mmss...',
        '....wm......',
        '....wm......',
        '............',
      ],
      legend: { w: 'light', m: 'mid', s: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const leapIcon = textureDef({
  id: 'leap-icon',
  about: 'A leap: a figure flying forward off the end of a dashed arc, coming down onto a burst',
  tags: ['icon', 'skill', 'movement', 'leap'],
  size: [13, 12],
  palette: { glint: 'white', light: 'sand', dark: 'orange', edge: 'plum' },
  layers: [
    {
      pixels: [
        '.............',
        '..........ww.',
        '..........ww.',
        '...ll...llll.',
        '.l.....llll..',
        '.l.......ll..',
        '........llll.',
        '.......ll..ll',
        '.......l....l',
        '.............',
        '.....o.ooo.o.',
        '....ooooooooo',
      ],
      legend: { w: 'glint', l: 'light', o: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const arrowVolleyIcon = textureDef({
  id: 'arrow-volley-icon',
  about: 'A volley: three arrows falling point down, staggered, with white fletching',
  tags: ['icon', 'skill', 'bow', 'arrow', 'volley'],
  size: [13, 11],
  palette: { fletch: 'white', shaft: 'orange', head: 'mist', edge: 'ink' },
  layers: [
    {
      pixels: [
        '.............',
        '.fhf.........',
        '.fhf.....fhf.',
        '..h..fhf.fhf.',
        '..h..fhf..h..',
        '..h...h...h..',
        '.mmm..h...h..',
        '..m...h..mmm.',
        '.....mmm..m..',
        '......m......',
        '.............',
      ],
      legend: { f: 'fletch', h: 'shaft', m: 'head' },
    },
    { outline: 'edge' },
  ],
});

export const summonIcon = textureDef({
  id: 'summon-icon',
  about: 'A summoning: a white skull rising out of a glowing cyan circle',
  tags: ['icon', 'skill', 'summon', 'minion'],
  size: [12, 12],
  palette: { bone: 'white', shade: 'mist', glow: 'cyan', glow2: 'sky', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '....bbbb....',
        '...bbbbbs...',
        '...b.bb.s...',
        '...b.bs.s...',
        '...bbbsss...',
        '....b..s....',
        '............',
        '...cccccc...',
        '.cc......gg.',
        '...gggggg...',
        '............',
      ],
      legend: { b: 'bone', s: 'shade', c: 'glow', g: 'glow2' },
    },
    { outline: 'edge' },
  ],
});

export const curseIcon = textureDef({
  id: 'curse-icon',
  about: 'A curse: a staring white eye with a plum iris in bloodshot red lids, dripping',
  tags: ['icon', 'skill', 'curse', 'hex'],
  size: [12, 12],
  palette: { lid: 'red', eye: 'white', iris: 'plum', pupil: 'ink', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '............',
        '...pppppp...',
        '.pprryyrrpp.',
        '.prryiiyrrp.',
        '.prryiiyrrp.',
        '.pprryyrrpp.',
        '...pppppp...',
        '...pp..pp...',
        '...p....p...',
        '........p...',
        '............',
      ],
      legend: { p: 'lid', r: 'eye', y: 'iris', i: 'pupil' },
    },
    { outline: 'edge' },
  ],
});

export const auraIcon = textureDef({
  id: 'aura-icon',
  about: 'An aura: a gold ring radiating round a white-hot core',
  tags: ['icon', 'skill', 'aura', 'buff'],
  size: [13, 13],
  palette: { core: 'white', light: 'sand', dark: 'orange', edge: 'plum' },
  layers: [
    {
      pixels: [
        '.............',
        '....lllll....',
        '..ll.....lo..',
        '..l...l...o..',
        '.l...lll...o.',
        '.l..lwwwl..o.',
        '.l.llwwwoo.o.',
        '.l..lwwwo..o.',
        '.l...loo...o.',
        '..l...o...o..',
        '..lo.....oo..',
        '....ooooo....',
        '.............',
      ],
      legend: { w: 'core', l: 'light', o: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const trapIcon = textureDef({
  id: 'trap-icon',
  about: 'A bear trap, open: a ring of steel jaws with their teeth turned in round a gold pan, a spring either side',
  tags: ['icon', 'skill', 'trap'],
  size: [13, 11],
  palette: { light: 'mist', dark: 'slate', pan: 'sand', edge: 'ink' },
  layers: [
    {
      pixels: [
        '.............',
        '..lllllllll..',
        '.lll.l.l.lll.',
        '.l.........l.',
        'll...ppp...ll',
        'ss...ppp...ss',
        '.s.........s.',
        '.sss.s.s.sss.',
        '..sssssssss..',
        '.............',
        '.............',
      ],
      legend: { l: 'light', s: 'dark', p: 'pan' },
    },
    { outline: 'edge' },
  ],
});

export const totemIcon = textureDef({
  id: 'totem-icon',
  about: 'A carved wooden totem: a winged top, two stacked faces with dark eyes',
  tags: ['icon', 'skill', 'totem'],
  size: [12, 15],
  palette: { wing: 'sky', wing2: 'blue', light: 'orange', dark: 'red', eye: 'ink', beak: 'sand', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '....hhdd....',
        '.ww.hhdd.WW.',
        '.wwwhhddWWW.',
        '..wwkhdkWW..',
        '....hbbd....',
        '....hhdd....',
        '....hhdd....',
        '....kddk....',
        '....hhdd....',
        '...hbbbdd...',
        '....hhdd....',
        '....hhdd....',
        '...hhhddd...',
        '............',
      ],
      legend: { w: 'wing', W: 'wing2', h: 'light', d: 'dark', k: 'eye', b: 'beak' },
    },
    { outline: 'edge' },
  ],
});

// More UI glyphs: 8 × 8 with their outline like the heart (the gear 12 × 12, the magnifier
// 10 × 10, the quest marker 6 × 10), white for direction, lime for yes and more, red for no and less.

export const arrowUp = textureDef({
  id: 'arrow-up',
  about: 'A white arrow pointing up: scroll, raise, move up',
  tags: ['icon', 'ui', 'arrow', 'up'],
  size: [8, 8],
  palette: { light: 'white', shade: 'mist', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '...ws...', '..wwss..', '.wwwsss.', '..wwss..', '..wwss..', '..wwss..', '........'],
      legend: { w: 'light', s: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const arrowDown = textureDef({
  id: 'arrow-down',
  about: 'A white arrow pointing down: scroll, lower, move down',
  tags: ['icon', 'ui', 'arrow', 'down'],
  size: [8, 8],
  palette: { light: 'white', shade: 'mist', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '..wwss..', '..wwss..', '..wwss..', '.wwwsss.', '..wwss..', '...ws...', '........'],
      legend: { w: 'light', s: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const arrowLeft = textureDef({
  id: 'arrow-left',
  about: 'A white arrow pointing left: back, previous, move left',
  tags: ['icon', 'ui', 'arrow', 'left'],
  size: [8, 8],
  palette: { light: 'white', shade: 'mist', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '...w....', '..wwwww.', '.wwwwww.', '.ssssss.', '..sssss.', '...s....', '........'],
      legend: { w: 'light', s: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const arrowRight = textureDef({
  id: 'arrow-right',
  about: 'A white arrow pointing right: next, forward, move right',
  tags: ['icon', 'ui', 'arrow', 'right'],
  size: [8, 8],
  palette: { light: 'white', shade: 'mist', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '....w...', '.wwwww..', '.wwwwww.', '.ssssss.', '.sssss..', '....s...', '........'],
      legend: { w: 'light', s: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const check = textureDef({
  id: 'check',
  about: 'A lime check mark: yes, done, confirm',
  tags: ['icon', 'ui', 'check', 'confirm'],
  size: [8, 8],
  palette: { body: 'lime', shade: 'green', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '.....ll.', '.....ll.', '.ll.ll..', '.ll.ll..', '..ggg...', '..ggg...', '........'],
      legend: { l: 'body', g: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const cross = textureDef({
  id: 'cross',
  about: 'A red X: no, close, cancel',
  tags: ['icon', 'ui', 'cross', 'cancel'],
  size: [8, 8],
  palette: { body: 'red', shade: 'plum', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '.rr..rr.', '.rr..rr.', '..rrrr..', '..pppp..', '.pp..pp.', '.pp..pp.', '........'],
      legend: { r: 'body', p: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const plus = textureDef({
  id: 'plus',
  about: 'A lime plus: add, more, a higher stat',
  tags: ['icon', 'ui', 'plus', 'add'],
  size: [8, 8],
  palette: { body: 'lime', shade: 'green', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '...lg...', '...lg...', '.lllllg.', '.ggglgg.', '...lg...', '...gg...', '........'],
      legend: { l: 'body', g: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const minus = textureDef({
  id: 'minus',
  about: 'A red minus: remove, less, a lower stat',
  tags: ['icon', 'ui', 'minus', 'remove'],
  size: [8, 8],
  palette: { body: 'red', shade: 'plum', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '........', '........', '.rrrrrr.', '.pppppp.', '........', '........', '........'],
      legend: { r: 'body', p: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const lock = textureDef({
  id: 'lock',
  about: 'A gold padlock with a steel shackle and a keyhole: locked',
  tags: ['icon', 'ui', 'lock', 'locked'],
  size: [8, 8],
  palette: { steel: 'mist', steel2: 'slate', body: 'sand', shade: 'orange', hole: 'plum', edge: 'ink' },
  layers: [
    {
      pixels: ['........', '..mmmt..', '..m..t..', '.bbbbbo.', '.bbkkbo.', '.bbbkbo.', '.oooooo.', '........'],
      legend: { m: 'steel', t: 'steel2', b: 'body', o: 'shade', k: 'hole' },
    },
    { outline: 'edge' },
  ],
});

export const gear = textureDef({
  id: 'gear',
  about: 'A steel cog with eight teeth round a hole: settings, options',
  tags: ['icon', 'ui', 'gear', 'settings'],
  size: [12, 12],
  palette: { light: 'mist', dark: 'slate', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............',
        '.....ll.....',
        '..ll.ll.ll..',
        '..llllllld..',
        '...llllld...',
        '.llll..dddd.',
        '.llll..dddd.',
        '...lldddd...',
        '..lldddddd..',
        '..ld.dd.dd..',
        '.....dd.....',
        '............',
      ],
      legend: { l: 'light', d: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const magnifier = textureDef({
  id: 'magnifier',
  about: 'A magnifying glass: a steel ring round blue glass with a glint, a red handle: search, inspect',
  tags: ['icon', 'ui', 'magnifier', 'search'],
  size: [10, 10],
  palette: { glint: 'white', glass: 'cyan', glass2: 'sky', light: 'mist', dark: 'slate', handle: 'red', edge: 'ink' },
  layers: [
    {
      pixels: ['..........', '..mmmm....', '.mwwccm...', '.mwcccM...', '.mccsdM...', '.mcssdM...', '..MMMMh...', '......hh..', '.......hh.', '..........'],
      legend: { w: 'glint', c: 'glass', s: 'glass2', d: 'dark', m: 'light', M: 'dark', h: 'handle' },
    },
    { outline: 'edge' },
  ],
});

export const questMarker = textureDef({
  id: 'quest-marker',
  about: 'A gold exclamation mark: a quest to give, a warning, something new',
  tags: ['icon', 'ui', 'quest', 'alert'],
  size: [6, 10],
  palette: { glint: 'white', light: 'sand', shade: 'orange', edge: 'plum' },
  layers: [
    {
      pixels: ['......', '.wsso.', '.ssso.', '.ssso.', '..so..', '..so..', '......', '..so..', '..oo..', '......'],
      legend: { w: 'glint', s: 'light', o: 'shade' },
    },
    { outline: 'edge' },
  ],
});

// Critters for a SpriteBatch: frames left to right, each outlined inside its own frame. The
// symmetric ones are drawn as a left half per frame (`at` the frame, `mirror: 'x'`).

export const bat = textureDef({
  id: 'bat',
  about: 'A bat flapping: wings up, then wings down, their leading edges lit, glowing yellow eyes (2 frames of 12 x 8)',
  tags: ['sprite', 'critter', 'bat', 'animated'],
  size: [24, 8],
  frames: 2,
  palette: { rim: 'slate', wing: 'plum', body: 'night', eye: 'sand', edge: 'ink' },
  layers: [
    { pixels: ['......', '.rr...', '.rww.r', '..wwbb', '..wweb', '...wbb', '.....b', '......'], legend: { r: 'rim', w: 'wing', b: 'body', e: 'eye' }, mirror: 'x' },
    { pixels: ['......', '......', '.....r', '....bb', '.rrreb', '.wwwbb', '.ww..b', '......'], legend: { r: 'rim', w: 'wing', b: 'body', e: 'eye' }, at: [12, 0], mirror: 'x' },
    { outline: 'edge' },
  ],
});

export const rat = textureDef({
  id: 'rat',
  about: 'A grey rat scurrying right: stretched out low, then bunched up with its feet under it; pink ears, feet and tail (2 frames of 12 x 8)',
  tags: ['sprite', 'critter', 'rat', 'animated'],
  size: [24, 8],
  frames: 2,
  palette: { fur: 'mist', shade: 'slate', pink: 'red', eye: 'ink', edge: 'ink' },
  layers: [
    {
      pixels: [
        '............' + '............',
        '............' + '......rr....',
        '......rr....' + '..mmmmmmm...',
        '..mmmmmmm...' + 'rrmmmmmmkmr.',
        'rrmmmmmmkmr.' + 'r.ssssssss..',
        '..ssssssss..' + '...rr..rr...',
        '.rr.....rr..' + '...rr..rr...',
        '............' + '............',
      ],
      legend: { m: 'fur', s: 'shade', r: 'pink', k: 'eye' },
    },
    { outline: 'edge' },
  ],
});

export const spider = textureDef({
  id: 'spider',
  about: 'A dark spider seen from above with a red mark and a sheen on its back, its legs stepping (2 frames of 12 x 8)',
  tags: ['sprite', 'critter', 'spider', 'animated'],
  size: [24, 8],
  frames: 2,
  palette: { leg: 'slate', body: 'plum', sheen: 'mist', mark: 'red', eye: 'sand', edge: 'ink' },
  layers: [
    { pixels: ['......', 'l.....', 'llll.e', '....ss', 'llllbm', 'l...bb', '....bs', '......'], legend: { l: 'leg', b: 'body', s: 'sheen', m: 'mark', e: 'eye' }, mirror: 'x' },
    { pixels: ['......', '......', 'llll.e', 'l...ss', 'llllbm', '....bb', 'l...bs', '......'], legend: { l: 'leg', b: 'body', s: 'sheen', m: 'mark', e: 'eye' }, at: [12, 0], mirror: 'x' },
    { outline: 'edge' },
  ],
});

export const slime = textureDef({
  id: 'slime',
  about: 'A green slime bobbing: tall, then squashed flat (2 frames of 10 x 8)',
  tags: ['sprite', 'critter', 'slime', 'animated'],
  size: [20, 8],
  frames: 2,
  palette: { glint: 'white', light: 'lime', mid: 'green', dark: 'teal', eye: 'ink', edge: 'ink' },
  layers: [
    {
      pixels: [
        '..........' + '..........',
        '....ll....' + '..........',
        '...lwlg...' + '..........',
        '..llllgg..' + '...lwllg..',
        '..lkllkg..' + '.llllllgg.',
        '.lllllggg.' + '.llklkggg.',
        '.ggggggtt.' + '.gggggggt.',
        '..........' + '..........',
      ],
      legend: { w: 'glint', l: 'light', g: 'mid', t: 'dark', k: 'eye' },
    },
    { outline: 'edge' },
  ],
});

export const butterfly = textureDef({
  id: 'butterfly',
  about: 'A blue butterfly with white spots: wings open, then folded up (2 frames of 10 x 8)',
  tags: ['sprite', 'critter', 'butterfly', 'animated'],
  size: [20, 8],
  frames: 2,
  palette: { wing: 'sky', wing2: 'blue', spot: 'white', body: 'night', edge: 'ink' },
  layers: [
    { pixels: ['.....', '.ss..', '.sssb', '.swsb', '..oob', '.ooo.', '.....', '.....'], legend: { s: 'wing', o: 'wing2', w: 'spot', b: 'body' }, mirror: 'x' },
    { pixels: ['.....', '.....', '...sb', '...sb', '...ob', '...o.', '.....', '.....'], legend: { s: 'wing', o: 'wing2', b: 'body' }, at: [10, 0], mirror: 'x' },
    { outline: 'edge' },
  ],
});

export const firefly = textureDef({
  id: 'firefly',
  about: 'A firefly glowing: a dim lime point, then a bright white heart in a lime halo (2 frames of 8 x 8)',
  tags: ['sprite', 'critter', 'firefly', 'light', 'animated'],
  size: [16, 8],
  frames: 2,
  palette: { core: 'white', glow: 'lime', halo: 'green' },
  layers: [
    {
      pixels: [
        '........' + '........',
        '........' + '........',
        '........' + '...ll...',
        '...ll...' + '..lwwl..',
        '...ll...' + '..lwwl..',
        '........' + '...ll...',
        '........' + '........',
        '........' + '........',
      ],
      legend: { w: 'core', l: 'glow' },
    },
    { outline: 'halo' },
  ],
});

// Effects: frames left to right like the spark and the smoke puff.

export const fireBurst = textureDef({
  id: 'fire-burst',
  about: 'A burst of fire: a white-hot flash, flames thrown out, a ring of flame, scattered embers (4 frames of 12 x 12)',
  tags: ['sprite', 'effect', 'fire', 'explosion', 'animated'],
  size: [48, 12],
  frames: 4,
  palette: { core: 'white', inner: 'sand', flame: 'orange', outer: 'red', edge: 'plum' },
  layers: [
    {
      pixels: [
        '............' + '............' + '............' + '............',
        '............' + '.....rr.....' + '....rrrr....' + '............',
        '............' + '..rr.oo.rr..' + '.rr.oooo.rr.' + '..rr....rr..',
        '............' + '..rroooorr..' + '.rrooyyoorr.' + '..rr....rr..',
        '....oooo....' + '...oyyyyo...' + '..ooy..yoo..' + '............',
        '...oyyyyo...' + '.rroywwyorr.' + '.roy....yor.' + '.oo......oo.',
        '...oywwyo...' + '.rroywwyorr.' + '.roy....yor.' + '.oo......oo.',
        '...oyyyyo...' + '...oyyyyo...' + '..ooy..yoo..' + '............',
        '....oooo....' + '..rroooorr..' + '.rrooyyoorr.' + '..rr....rr..',
        '............' + '..rr.oo.rr..' + '.rr.oooo.rr.' + '..rr....rr..',
        '............' + '.....rr.....' + '....rrrr....' + '............',
        '............' + '............' + '............' + '............',
      ],
      legend: { w: 'core', y: 'inner', o: 'flame', r: 'outer' },
    },
    { outline: 'edge' },
  ],
});

export const iceShards = textureDef({
  id: 'ice-shards',
  about: 'Ice shattering: a crystal with a white heart, shards flying out, shards scattered (3 frames of 12 x 12)',
  tags: ['sprite', 'effect', 'cold', 'ice', 'animated'],
  size: [36, 12],
  frames: 3,
  palette: { core: 'white', ice: 'cyan', shade: 'sky', edge: 'navy' },
  layers: [
    {
      pixels: [
        '............' + '............' + '............',
        '............' + '.....cs.....' + '.cs......cs.',
        '.....cs.....' + '.....cs.....' + '.ss......ss.',
        '....ccss....' + '.....ss.....' + '............',
        '....cwss....' + '............' + '............',
        '...ccwsss...' + '.ccc.ww.ccc.' + '.....ww.....',
        '...ccwsss...' + '.sss.ww.sss.' + '.....ww.....',
        '....cwss....' + '............' + '............',
        '....ccss....' + '.....cs.....' + '............',
        '.....cs.....' + '.....cs.....' + '.cs......cs.',
        '............' + '.....ss.....' + '.ss......ss.',
        '............' + '............' + '............',
      ],
      legend: { w: 'core', c: 'ice', s: 'shade' },
    },
    { outline: 'edge' },
  ],
});

export const lightningSpark = textureDef({
  id: 'lightning-spark',
  about: 'An electric crackle: a short sand zigzag, then a forked one with a white-hot kink (2 frames of 10 x 10)',
  tags: ['sprite', 'effect', 'lightning', 'spark', 'animated'],
  size: [20, 10],
  frames: 2,
  palette: { core: 'white', bolt: 'sand', edge: 'plum' },
  layers: [
    {
      pixels: [
        '..........' + '..........',
        '..........' + '....yy....',
        '.....yy...' + '....yy....',
        '.....yy...' + '...yy.....',
        '....yy....' + '...yy..yy.',
        '....wwww..' + '..wwwwyy..',
        '......yy..' + '....yy....',
        '.....yy...' + '...yy.....',
        '..........' + '...yy.....',
        '..........' + '..........',
      ],
      legend: { w: 'core', y: 'bolt' },
    },
    { outline: 'edge' },
  ],
});

export const poisonBubbles = textureDef({
  id: 'poison-bubbles',
  about: 'Poison bubbling: small bubbles rise, swell and pop into droplets (3 frames of 8 x 8)',
  tags: ['sprite', 'effect', 'poison', 'bubbles', 'animated'],
  size: [24, 8],
  frames: 3,
  palette: { glint: 'white', light: 'lime', mid: 'green', edge: 'teal' },
  layers: [
    {
      pixels: [
        '........' + '........' + '........',
        '........' + '..lll...' + '.ll..ll.',
        '........' + '..lwl...' + '........',
        '........' + '..llg...' + '.ll..ll.',
        '....ll..' + '........' + '........',
        '.ll.lg..' + '.....ll.' + '.....ll.',
        '.lg.....' + '.....lg.' + '.....lg.',
        '........' + '........' + '........',
      ],
      legend: { w: 'glint', l: 'light', g: 'mid' },
    },
    { outline: 'edge' },
  ],
});

export const healSparkles = textureDef({
  id: 'heal-sparkles',
  about: 'Healing sparkles: a green cross of light with a white heart rising, shrinking and fading (3 frames of 8 x 10)',
  tags: ['sprite', 'effect', 'heal', 'sparkle', 'animated'],
  size: [24, 10],
  frames: 3,
  palette: { core: 'white', light: 'lime', faded: 'green', edge: 'teal' },
  layers: [
    {
      pixels: [
        '........' + '........' + '........',
        '........' + '...ll...' + '...ll...',
        '........' + '...ll...' + '..llll..',
        '...ll...' + '.llwwll.' + '..llll..',
        '...ll...' + '.llwwll.' + '...ll...',
        '.llwwll.' + '...ll...' + '........',
        '.llwwll.' + '...ll...' + '........',
        '...ll...' + '........' + '.....ff.',
        '...ll...' + '.ff.....' + '.....ff.',
        '........' + '.ff.....' + '........',
      ],
      legend: { w: 'core', l: 'light', f: 'faded' },
    },
    { outline: 'edge' },
  ],
});

export const bloodSplat = textureDef({
  id: 'blood-splat',
  about: 'Blood hitting the ground: a drop, a splash, a splat with droplets (3 frames of 10 x 8)',
  tags: ['sprite', 'effect', 'blood', 'hit', 'animated'],
  size: [30, 8],
  frames: 3,
  palette: { light: 'red', dark: 'plum', edge: 'ink' },
  layers: [
    {
      pixels: [
        '..........' + '..........' + '..........',
        '....rr....' + '.rr....rr.' + '..........',
        '....rr....' + '.rr....rr.' + '.rr.......',
        '....dd....' + '..........' + '.rr....rr.',
        '..........' + '...rrrr...' + '...rrrr...',
        '..........' + '..rrrrrr..' + '..rrrrrrr.',
        '..........' + '...dddd...' + '.ddddddd..',
        '..........' + '..........' + '..........',
      ],
      legend: { r: 'light', d: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const dustPuff = textureDef({
  id: 'dust-puff',
  about: 'A puff of dust kicked up from the ground, spreading and settling (3 frames of 10 x 8)',
  tags: ['sprite', 'effect', 'dust', 'animated'],
  size: [30, 8],
  frames: 3,
  palette: { light: 'sand', mid: 'mist', dark: 'slate', edge: 'night' },
  layers: [
    {
      pixels: [
        '..........' + '..........' + '..........',
        '..........' + '..........' + '.ll....ll.',
        '..........' + '..........' + '.mm....mm.',
        '..........' + '..ll..ll..' + '..........',
        '....ll....' + '.llmm.lmm.' + '..........',
        '...llmm...' + '.mmdd.mdd.' + '.ll....ll.',
        '...mmdd...' + '..........' + '.mm....mm.',
        '..........' + '..........' + '..........',
      ],
      legend: { l: 'light', m: 'mid', d: 'dark' },
    },
    { outline: 'edge' },
  ],
});

export const SPRITES = [
  gemIcon, coinSpin, potionRed, potionBlue, key, scroll, goldIcon, heart, star, skull, spark, smokePuff,
  spearIcon, cloakIcon, arrowsIcon, bombIcon, torchIcon, mapIcon, bookIcon, coinPouchIcon, meatIcon, herbIcon, runeStoneIcon,
  fireballIcon, frostNovaIcon, lightningBoltIcon, poisonCloudIcon, healIcon, shieldBubbleIcon, dashIcon, whirlwindIcon, leapIcon, arrowVolleyIcon, summonIcon, curseIcon, auraIcon, trapIcon, totemIcon,
  arrowUp, arrowDown, arrowLeft, arrowRight, check, cross, plus, minus, lock, gear, magnifier, questMarker,
  bat, rat, spider, slime, butterfly, firefly, fireBurst, iceShards, lightningSpark, poisonBubbles, healSparkles, bloodSplat, dustPuff,
];
