import { model } from '../..';

/**
 * Gate A's Kit weapon rack (src/engine/model/fixtures/gate-a/weapon-rack-a.ts) traced in primitives, in the
 * trace's frame (footprint centred). Every weapon leans back 7° about one pivot, so they share
 * one turned group; the axe's blades mirror about its haft.
 *
 *   npm run model -- trace weapon-rack --against gate-a:weapon-rack-a --reference
 *   npm run model -- trace src/engine/model/fixtures/trace/weapon-rack.ts --against gate-a:weapon-rack-a
 *
 * The reference listed 27 pieces, all exact boxes but the spearhead (an 8-sided double cone),
 * the weapons' boxes each turned -7° about their own centres: one pivot fits them all. The first
 * scoring passed (game IoU 0.982, close 0.979, dE 0.004); the check found the sword hanging 2 cm
 * over the floor, as the Kit's does, so its blade reaches down to it. The colour left is the
 * spearhead's split and the axe's cap (the Kit's night, clustered into ink).
 */
export default model({
  id: 'weapon-rack',
  about: 'Weapon rack: two posts on sled feet, a top and a low rail, a sword, a spear and a double axe leaning in it',
  tags: ['town', 'wood', 'weapon', 'furniture', 'traced'],
  palette: { frame: 'plum', trim: 'red', steel: 'white', iron: 'mist', wood: 'sand', haft: 'orange', fitting: 'slate', floor: 'ink' },
  parts: [
    { box: [1.9, 0.12, 0.36], at: [0, 0.14, 0.02], c: 'frame', name: 'base' },
    { box: [1.88, 0.02, 0.34], at: [0, 0.2, 0.02], c: 'floor' },
    { box: [2.02, 0.12, 0.1], at: [0, 0.78, -0.12], c: 'trim', name: 'rail' },
    { box: [1.94, 0.09, 0.06], at: [0, 0.24, 0.2], c: 'trim' },
    {
      mirror: [
        { box: [0.13, 0.94, 0.13], at: [0.95, 0.47, -0.12], c: 'frame', name: 'post' },
        { box: [0.16, 0.12, 0.66], at: [0.95, 0.06, 0], c: 'frame', name: 'foot' },
        { box: [0.19, 0.07, 0.19], at: [0.95, 0.97, -0.12], c: 'trim' },
      ],
    },
    {
      name: 'weapons',
      at: [0, 1.362, -0.042],
      rot: [-7, 0, 0],
      group: [
        // sword, point down (its tip on the floor; the Kit's hangs 2 cm over it)
        { box: [0.2, 0.96, 0.05], at: [-0.58, -0.69, 0], c: 'steel', name: 'sword' },
        { box: [0.06, 0.86, 0.06], at: [-0.58, -0.641, 0], c: 'iron' },
        { box: [0.48, 0.1, 0.12], at: [-0.58, -0.17, 0], c: 'wood' },
        { box: [0.09, 0.26, 0.09], at: [-0.58, 0, 0], c: 'trim' },
        { box: [0.15, 0.13, 0.15], at: [-0.58, 0.19, 0], c: 'wood' },
        // spear
        { box: [0.076, 1.65, 0.075], at: [0, -0.346, 0], c: 'wood', name: 'spear' },
        { box: [0.11, 0.07, 0.11], at: [0, 0.389, 0], c: 'trim' },
        { box: [0.12, 0.1, 0.12], at: [0, 0.49, 0], c: 'fitting' },
        { cone: [0.24, 0.21, 0.24], seg: 8, at: [0, 0.641, 0], rot: [180, 0, 0], c: 'iron' },
        { cone: [0.24, 0.42, 0.24], seg: 8, at: [0, 0.956, 0], c: 'steel' },
        // double axe
        {
          name: 'axe',
          at: [0.64, 0, 0],
          group: [
            { box: [0.085, 1.32, 0.085], at: [0, -0.511, 0], c: 'haft' },
            { box: [0.15, 0.32, 0.15], c: 'fitting' },
            { box: [0.1, 0.1, 0.1], at: [0, 0.2, 0], c: 'floor' },
            {
              mirror: [
                { box: [0.16, 0.24, 0.071], at: [0.14, 0, 0], c: 'iron' },
                { box: [0.12, 0.44, 0.07], at: [0.27, 0, 0], c: 'iron' },
                { box: [0.08, 0.6, 0.075], at: [0.36, 0, 0], c: 'steel' },
              ],
            },
          ],
        },
      ],
    },
  ],
  source: { url: 'src/engine/model/fixtures/gate-a/weapon-rack-a.ts', licence: 'LicenseRef-own', author: 'riftlight', tool: 'trace', fidelity: { iou: 0.9821, iouClose: 0.9788, colour: 0.0048, bounds: [0, -0.003, 0] } },
});
