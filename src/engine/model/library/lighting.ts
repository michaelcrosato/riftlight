import { model } from '../helpers';

export const lampPost = model({
  id: 'lamp-post',
  about: 'Iron street lamp with a hanging lantern',
  tags: ['lighting', 'town'],
  palette: { iron: 'night', flame: 'sand' },
  light: { at: [0.42, 1.74, 0], c: 'flame', intensity: 6, radius: 6, flicker: 'candle' },
  parts: [
    { cyl: [0.3, 0.2, 0.3], at: [0, 0.1, 0], top: 0.6, c: 'iron' },
    { cyl: [0.09, 2.0, 0.09], at: [0, 1.1, 0], seg: 6, c: 'iron' },
    { box: [0.5, 0.06, 0.06], at: [0.22, 2.02, 0], c: 'iron' },
    {
      name: 'lantern',
      at: [0.42, 1.74, 0],
      group: [
        { box: [0.22, 0.04, 0.22], at: [0, -0.13, 0], c: 'iron' },
        { box: [0.16, 0.22, 0.16], c: 'flame', glow: true },
        { cyl: [0.32, 0.1, 0.32], at: [0, 0.16, 0], top: 0.25, seg: 4, rot: [0, 45, 0], c: 'iron' },
        { cyl: [0.06, 0.1, 0.06], at: [0, 0.25, 0], seg: 4, c: 'iron' },
      ],
    },
  ],
});

export const LIGHTING = [lampPost];
