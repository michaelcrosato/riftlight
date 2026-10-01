import { ball, box, cone, cyl, horn, lump, pair, part, slab, spike, taper } from './kit';

/**
 * Boss dressing: one mantle per theme (looks.ts `BOSS_DRESS`), built on the `mantle`
 * socket (the back's spot: +Y out of the body, Z along the spine, units = the back's size),
 * layered over the boss's own back part. Cosmetic only: no mods, no cost, never rolled.
 * Each one is the level mechanic made into a silhouette, big and readable from the iso
 * camera: a brazier of coals, dead lanterns, lightning pylons, glass spires, thorns, a
 * bog-crown, echo rings, a rift ring, a blood moon, ruin slabs, trophy bones.
 */
const DRESS_TAGS = ['dress'];
const W = { weight: 0 };

export const DRESS = [
  part('dress.brazier', 'Brazier Mantle', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // an iron bowl of coals with flames licking up, chains to the shoulders
    taper(c, 1.5, 'dark', [0, 0.22, -0.05], [0.5, 0.2, 0.5]);
    cyl(c, 'dark', [0, 0.1, -0.05], [0.14, 0.2, 0.14]);
    lump(c, 'glow', [0, 0.32, -0.05], [0.56, 0.12, 0.56], { glow: true });
    for (const [x, z, h] of [[0, -0.05, 0.4], [0.14, 0.06, 0.28], [-0.12, -0.16, 0.3], [-0.1, 0.1, 0.22]] as const) cone(c, 'glow', [x, 0.36 + h / 2, z], [0.14, h, 0.14], { glow: true });
    pair((sx) => cyl(c, 'dark', [0.26 * sx, 0.14, 0.12], [0.03, 0.4, 0.03], { rot: [40, 0, -60 * sx] }));
  }, W),

  part('dress.lanterns', 'Eaten Lanterns', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // hooks on the back, each with a cage hanging a guttering light
    for (const [x, z, h] of [[0.24, 0.1, 0.5], [-0.26, -0.05, 0.6], [0.04, -0.3, 0.42]] as const) {
      horn(c, 'dark', [x, 0, z], h, 0.06, -60, { rot: [0, 0, -x * 40] });
      box(c, 'dark', [x * 1.1, h * 0.72, z + 0.1], [0.12, 0.16, 0.12]);
      ball(c, 'glow', [x * 1.1, h * 0.72, z + 0.1], [0.08, 0.1, 0.08], { glow: true });
    }
  }, W),

  part('dress.pylons', 'Pylon Spines', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // two rows of metal rods with crackling tips
    for (const [i, z] of [0.3, 0.05, -0.2].entries())
      pair((sx) => {
        const h = 0.5 - i * 0.08;
        cyl(c, 'dark', [0.14 * sx, h / 2, z], [0.05, h, 0.05], { rot: [-12, 0, -14 * sx] });
        ball(c, 'glow', [0.14 * sx + 0.06 * sx, h, z - 0.05], [0.09, 0.09, 0.09], { glow: true });
      });
    box(c, 'glow', [0, 0.32, 0.05], [0.02, 0.02, 0.5], { glow: true });
  }, W),

  part('dress.glass', 'Glass Spires', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // a crown of tall, pale glass spires with glowing hearts
    for (const [x, z, h, a] of [[0, 0, 0.8, 0], [0.18, -0.1, 0.55, -18], [-0.16, 0.08, 0.6, 16], [0.08, 0.22, 0.42, -8], [-0.1, -0.26, 0.48, 12]] as const) {
      cone(c, 'bone', [x, h / 2, z], [0.16, h, 0.16], { rot: [0, 0, a] });
      cone(c, 'glow', [x, h * 0.35, z + 0.02], [0.08, h * 0.5, 0.08], { glow: true, rot: [0, 0, a] });
    }
  }, W),

  part('dress.thorns', 'Thornweave', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // twisting vines bristling with thorns and a few blooms
    for (const [x, z, a] of [[0.12, 0.1, 30], [-0.14, -0.04, -40], [0.02, -0.26, 10]] as const) {
      horn(c, 'secondary', [x, 0, z], 0.62, 0.12, 120, { rot: [0, a, -x * 60] });
      for (let k = 0; k < 3; k++) spike(c, 'bone', [x + Math.sin(a + k) * 0.08, 0.16 + k * 0.12, z + Math.cos(a + k) * 0.08], [0.05, 0.12, 0.05], { rot: [k * 40, 0, 60] });
    }
    for (const [x, z] of [[0.2, -0.16], [-0.18, 0.18]] as const) ball(c, 'accent', [x, 0.32, z], [0.12, 0.1, 0.12]);
  }, W),

  part('dress.bog', 'Bog Crown', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // a mound of muck with toadstools and glowing spore pods
    lump(c, 'dark', [0, 0.06, 0], [0.7, 0.2, 0.8]);
    for (const [x, z, s] of [[0, 0, 1], [0.2, -0.22, 0.7], [-0.22, 0.18, 0.8], [0.14, 0.26, 0.5]] as const) {
      cyl(c, 'bone', [x, 0.16 * s, z], [0.07 * s, 0.32 * s, 0.07 * s]);
      cone(c, 'accent', [x, 0.34 * s, z], [0.34 * s, 0.18 * s, 0.34 * s]);
    }
    for (const [x, z] of [[-0.12, -0.2], [0.26, 0.04]] as const) ball(c, 'glow', [x, 0.12, z], [0.1, 0.1, 0.1], { glow: true });
  }, W),

  part('dress.echo', 'Echo Rings', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // floating rings and shards that hang in the air behind it
    cyl(c, 'glow', [0, 0.5, -0.1], [0.7, 0.025, 0.7], { glow: true, rot: [70, 0, 0] });
    cyl(c, 'glow', [0, 0.5, -0.12], [0.46, 0.025, 0.46], { glow: true, rot: [70, 0, 20] });
    for (const [x, y] of [[0.36, 0.62], [-0.34, 0.4], [0.05, 0.88]] as const) cone(c, 'bone', [x, y, -0.12], [0.1, 0.22, 0.06], { rot: [0, 0, x * 90] });
  }, W),

  part('dress.rift', 'Rift Ring', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // a standing portal: a dark ring of horns around a glowing tear
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spike(c, 'dark', [Math.sin(a) * 0.32, 0.5 + Math.cos(a) * 0.32, -0.1], [0.08, 0.22, 0.08], { rot: [0, 0, (-a * 180) / Math.PI] });
    }
    slab(c, 'tear', [[0, -0.3], [0.12, 0], [0, 0.3], [-0.12, 0]], 0.03, 'glow', [0, 0.5, -0.1], [1, 1, 1], { glow: true });
    cyl(c, 'dark', [0, 0.2, -0.1], [0.08, 0.36, 0.08]);
  }, W),

  part('dress.bloodmoon', 'Blood Moon', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // a crescent of bone spikes cradling a red moon
    ball(c, 'glow', [0, 0.56, -0.16], [0.34, 0.34, 0.1], { glow: true });
    for (let i = 0; i < 7; i++) {
      const a = -1.3 + (i / 6) * 2.6;
      spike(c, 'bone', [Math.sin(a) * 0.34, 0.18 + Math.cos(a) * 0.16, -0.05], [0.07, 0.3 + (i % 2) * 0.1, 0.07], { rot: [0, 0, (-a * 180) / Math.PI * 0.6] });
    }
  }, W),

  part('dress.ruins', 'Ruin Slabs', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // broken masonry fused to its back, cracks glowing
    box(c, 'secondary', [0.12, 0.24, 0.02], [0.3, 0.46, 0.22], { rot: [-8, 10, -12] });
    box(c, 'secondary', [-0.16, 0.18, -0.18], [0.26, 0.34, 0.2], { rot: [10, -14, 16] });
    box(c, 'dark', [0.02, 0.1, 0.24], [0.4, 0.16, 0.18], { rot: [0, 20, 0] });
    box(c, 'glow', [0.13, 0.3, 0.135], [0.02, 0.26, 0.02], { glow: true, rot: [0, 10, -20] });
    box(c, 'glow', [-0.16, 0.2, -0.07], [0.02, 0.2, 0.02], { glow: true, rot: [10, -14, 30] });
  }, W),

  part('dress.trophies', 'Trophy Bones', ['mantle'], DRESS_TAGS, 0, [], (c) => {
    // a rack of skulls and tusks: what it has killed
    for (const [x, z] of [[0.16, 0.06], [-0.18, -0.08], [0, -0.28]] as const) {
      ball(c, 'bone', [x, 0.2, z], [0.16, 0.15, 0.17]);
      pair((sx) => ball(c, 'dark', [x + 0.04 * sx, 0.21, z + 0.075], [0.04, 0.04, 0.02]));
    }
    pair((sx) => horn(c, 'bone', [0.2 * sx, 0, 0.2], 0.5, 0.14, 70, { rot: [10, 0, -30 * sx] }));
  }, W),
];
