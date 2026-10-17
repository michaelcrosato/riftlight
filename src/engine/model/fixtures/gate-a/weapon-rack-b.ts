import { model } from '../..';

// A wooden weapon rack: a plank base with an iron-lined trough at the front, two posts and a rail
// at the back. Three weapons stand in the trough, resting against the rail, each a distinct
// silhouette: a sword point-down with its hilt up (left), a tall spear with a red tassel (middle),
// a bearded axe (right). Heads are drawn a little oversize so they still read at 480×270.
export default model({
  id: 'weapon-rack',
  about: 'Wooden weapon rack holding a sword, a spear and an axe',
  tags: ['weapon', 'furniture', 'wood', 'armoury'],
  palette: { wood: 'orange', iron: 'night', steel: 'mist', edge: 'white', haft: 'sand', gold: 'sand', leather: 'red' },
  size: [1.55, 2.28, 0.5],
  parts: [
    // rack
    { name: 'base', box: [1.5, 0.14, 0.5], at: [0, 0.07, 0], c: 'wood' },
    { box: [1.3, 0.02, 0.18], at: [0, 0.135, 0.02], c: 'iron' },
    { mirror: [{ box: [0.12, 0.7, 0.12], at: [0.69, 0.49, -0.12], c: 'wood' }] },
    { mirror: [{ cyl: [0.16, 0.08, 0.16], at: [0.69, 0.88, -0.12], seg: 4, rot: [0, 45, 0], top: 0.5, c: 'iron' }] },
    { name: 'rail', box: [1.5, 0.12, 0.14], at: [0, 0.72, -0.12], c: 'wood' },
    // sword, point down in the trough, hilt up
    {
      name: 'sword',
      at: [-0.45, 0.14, 0],
      group: [
        { slab: [[-0.11, 0.16], [0, 0], [0.11, 0.16], [0.11, 0.94], [-0.11, 0.94]], depth: 0.06, c: 'steel' },
        { box: [0.5, 0.09, 0.11], at: [0, 0.97, 0], c: 'gold' },
        { cyl: [0.08, 0.22, 0.08], at: [0, 1.12, 0], seg: 6, c: 'leather' },
        { ball: [0.15, 0.15, 0.15], at: [0, 1.28, 0], c: 'gold' },
      ],
    },
    // spear, head up
    {
      name: 'spear',
      at: [0, 0.14, 0],
      group: [
        { cyl: [0.07, 1.56, 0.07], at: [0, 0.78, 0], seg: 6, c: 'haft' },
        { cyl: [0.12, 0.1, 0.12], at: [0, 1.56, 0], seg: 6, c: 'iron' },
        { box: [0.1, 0.18, 0.04], at: [-0.04, 1.45, 0.05], rot: [0, 0, -12], c: 'leather' },
        { slab: [[0, 0], [0.16, 0.16], [0.1, 0.36], [0, 0.54], [-0.1, 0.36], [-0.16, 0.16]], depth: 0.08, at: [0, 1.6, 0], c: 'steel' },
      ],
    },
    // bearded axe, head up: a crescent blade toward +X, a spike behind
    {
      name: 'axe',
      at: [0.36, 0.14, 0],
      group: [
        { cyl: [0.07, 1.4, 0.07], at: [0, 0.7, 0], seg: 6, c: 'haft' },
        { box: [0.12, 0.24, 0.11], at: [0, 1.26, 0], c: 'iron' },
        {
          slab: [[0.04, -0.09], [0.15, -0.11], [0.31, -0.34], [0.41, -0.14], [0.43, 0.04], [0.4, 0.22], [0.31, 0.34], [0.15, 0.11], [0.04, 0.09]],
          depth: 0.08,
          at: [0, 1.26, 0],
          c: 'steel',
        },
        {
          slab: [[0.315, -0.355], [0.42, -0.145], [0.44, 0.04], [0.41, 0.23], [0.315, 0.355], [0.27, 0.27], [0.345, 0.2], [0.375, 0.04], [0.355, -0.12], [0.27, -0.27]],
          depth: 0.09,
          at: [0, 1.26, 0],
          c: 'edge',
        },
        { cone: [0.09, 0.16, 0.09], at: [-0.13, 1.26, 0], rot: [0, 0, 90], seg: 4, c: 'iron' },
      ],
    },
  ],
});
