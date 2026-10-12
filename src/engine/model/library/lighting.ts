import { boxFrame, model } from '../helpers';

export const lampPost = model({
  id: 'lamp-post',
  about: 'Iron street lamp with a hanging lantern',
  tags: ['lighting', 'town'],
  palette: { iron: 'night', flame: 'sand' },
  light: { at: [0.42, 1.78, 0], c: 'flame', intensity: 6, radius: 6, flicker: 'candle' },
  parts: [
    { cyl: [0.3, 0.2, 0.3], at: [0, 0.1, 0], top: 0.6, c: 'iron' },
    { cyl: [0.09, 2.0, 0.09], at: [0, 1.1, 0], seg: 6, c: 'iron' },
    { box: [0.5, 0.05, 0.05], at: [0.22, 2.02, 0], c: 'iron' },
    {
      name: 'lantern',
      at: [0.42, 1.78, 0],
      group: [
        { cyl: [0.32, 0.1, 0.32], at: [0, 0.19, 0], top: 0.25, seg: 4, rot: [0, 45, 0], c: 'iron' },
        boxFrame({ size: [0.2, 0.26, 0.2], beam: 0.03, c: 'iron' }),
        { box: [0.14, 0.2, 0.14], c: 'flame', glow: true },
        { cyl: [0.024, 0.1, 0.024], at: [0, 0.29, 0], c: 'iron' },
      ],
    },
  ],
});

export const LIGHTING = [lampPost];
