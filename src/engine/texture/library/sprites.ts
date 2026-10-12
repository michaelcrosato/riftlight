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

export const SPRITES = [gemIcon, coinSpin];
