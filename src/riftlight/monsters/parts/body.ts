import { flag, flat, inc, more } from '../../core/mods';
import { ball, box, cone, cyl, horn, lump, pair, part, slab, taper } from './kit';

/**
 * Body parts. Back parts: unit space has +Y pointing out of the body and Z along the
 * spine (spans z ±0.5). Shoulders: left socket, +Y up. Wings: one call per wing segment
 * (socket.data.segment 1 = inner half, 2 = outer half), extending along +X, membranes
 * trailing back (−Z). Tails: built at the tail tip, pointing −Z. Units: the socket size.
 */
const seg = (c: { socket: { data?: Readonly<Record<string, unknown>> } }) => Number(c.socket.data?.segment ?? 1);
/** Flat outline in x/z (y = thickness), for membranes: outline y becomes z. */
const FLAT: [number, number, number] = [90, 0, 0];

export const BACKS = [
  part('spikes.back', 'Back Spikes', ['back'], ['any'], 1, [flat('thorns', 5)], (c) => {
    [-0.35, -0.12, 0.12, 0.35].forEach((z, i) => cone(c, 'accent', [0, 0.1, z], [0.14, i % 2 ? 0.26 : 0.36, 0.14], { rot: [-20, 0, 0] }));
  }, { weight: 2 }),
  part('plates.back', 'Dorsal Plates', ['back'], ['beast', 'earth', 'nature', 'fire'], 2, [flat('armour', 25)], (c) => {
    [-0.36, -0.12, 0.12, 0.36].forEach((z, i) =>
      slab(c, 'plate', [[-0.5, 0], [0.5, 0], [0.15, 0.7], [-0.25, 0.55]], 0.25, i % 2 ? 'accent' : 'secondary', [0, 0.04, z], [0.3, 0.38 - Math.abs(z) * 0.3, 0.3], { rot: [0, 90, 0] }),
    );
  }),
  part('shell.turtle', 'Domed Shell', ['back'], ['water', 'earth', 'nature', 'construct'], 2, [flat('armour', 40), inc('move.speed', -0.05)], (c) => {
    ball(c, 'secondary', [0, 0, 0], [0.6, 0.36, 0.9]);
    box(c, 'dark', [0, 0.16, 0], [0.08, 0.06, 0.8]);
    pair((sx) => box(c, 'dark', [0.15 * sx, 0.13, 0], [0.06, 0.05, 0.6], { rot: [0, 0, -20 * sx] }));
  }),
  part('shell.beetle', 'Beetle Elytra', ['back'], ['insect', 'poison', 'void'], 2, [flat('armour', 30), inc('evasion', 0.05)], (c) => {
    pair((sx) => ball(c, sx > 0 ? 'secondary' : 'secondary', [0.13 * sx, 0.02, -0.05], [0.28, 0.24, 0.95], { rot: [0, -6 * sx, 0] }));
    box(c, 'dark', [0, 0.12, -0.05], [0.03, 0.04, 0.9]);
  }),
  part('fin.dorsal', 'Dorsal Fin', ['back'], ['water', 'beast', 'storm'], 1, [inc('move.speed', 0.06)], (c) => {
    slab(c, 'dorsal', [[-0.45, 0], [0.4, 0], [0.05, 0.42], [-0.3, 0.35]], 0.05, 'accent', [0, 0.02, 0], [1, 1, 1], { rot: [0, -90, 0] });
  }),
  part('crystals.back', 'Crystal Growth', ['back'], ['crystal', 'ice', 'arcane', 'earth'], 2, [flat('res.cold', 0.15), flat('res.lightning', 0.15), inc('damage', 0.08, ['spell'])], (c) => {
    cone(c, 'glow', [0, 0.18, 0], [0.16, 0.5, 0.16], { glow: true });
    cone(c, 'glow', [0.1, 0.1, -0.2], [0.12, 0.34, 0.12], { glow: true, rot: [-20, 0, -25] });
    cone(c, 'accent', [-0.1, 0.1, 0.18], [0.13, 0.36, 0.13], { rot: [20, 0, 25] });
    cone(c, 'glow', [-0.08, 0.08, -0.32], [0.1, 0.26, 0.1], { glow: true, rot: [-30, 0, 15] });
  }),
  part('armour.back', 'Plate Armour', ['back'], ['construct', 'earth', 'storm', 'blood'], 2, [flat('armour', 35), more('move.speed', -0.05)], (c) => {
    box(c, 'dark', [0, 0.02, 0], [0.62, 0.1, 0.8]);
    box(c, 'accent', [0, 0.08, 0], [0.1, 0.04, 0.82]);
    pair((sx) => [-0.3, 0, 0.3].forEach((z) => ball(c, 'accent', [0.24 * sx, 0.07, z], [0.05, 0.05, 0.05])));
  }),
  part('back.bones', 'Exposed Ribs', ['back'], ['undead', 'shadow', 'blood'], 1, [inc('life.leech', 0.02)], (c) => {
    [-0.3, -0.1, 0.1, 0.3].forEach((z) => pair((sx) => horn(c, 'secondary', [0.03 * sx, 0, z], 0.4, 0.12, 90, { rot: [0, 90 * sx, 0] })));
    box(c, 'secondary', [0, 0.04, 0], [0.08, 0.08, 0.8]);
  }),
  part('back.vents', 'Furnace Vents', ['back'], ['fire', 'construct'], 2, [inc('fire.damage', 0.15), flat('res.fire', 0.2)], (c) => {
    pair((sx) => {
      cyl(c, 'dark', [0.16 * sx, 0.14, -0.1], [0.14, 0.32, 0.14]);
      cyl(c, 'glow', [0.16 * sx, 0.31, -0.1], [0.1, 0.04, 0.1], { glow: true });
    });
    cyl(c, 'dark', [0, 0.1, 0.22], [0.12, 0.22, 0.12]);
  }),
  part('back.mushrooms', 'Fungal Caps', ['back'], ['nature', 'poison', 'shadow'], 1, [flat('chance.poison', 0.1), flat('life.regen', 2)], (c) => {
    for (const [x, z, s] of [[0, 0, 1], [0.15, -0.25, 0.7], [-0.14, 0.24, 0.6], [-0.1, -0.35, 0.5]] as const) {
      cyl(c, 'secondary', [x, 0.08 * s, z], [0.06 * s, 0.16 * s, 0.06 * s]);
      cone(c, 'accent', [x, 0.2 * s, z], [0.32 * s, 0.14 * s, 0.32 * s]);
    }
  }),
  part('back.sail', 'Spined Sail', ['back'], ['fire', 'beast', 'water', 'void'], 1, [flat('res.fire', 0.1), inc('life', 0.05)], (c) => {
    slab(c, 'sail', [[-0.45, 0], [0.45, 0], [0.32, 0.36], [0.1, 0.46], [-0.15, 0.42], [-0.38, 0.28]], 0.03, 'accent', [0, 0.02, 0], [1, 1, 1], { rot: [0, -90, 0] });
    [-0.3, 0, 0.3].forEach((z) => cyl(c, 'dark', [0, 0.22, z], [0.03, 0.44, 0.03]));
  }),
];

export const SHOULDERS = [
  part('armour.pauldron', 'Pauldron', ['shoulders'], ['construct', 'earth', 'storm', 'undead'], 1, [flat('armour', 15)], (c) => {
    ball(c, 'dark', [0.08, 0.1, 0], [1.3, 0.8, 1.3]);
    box(c, 'accent', [0.08, 0.02, 0], [1.4, 0.15, 1.35]);
  }),
  part('spikes.shoulder', 'Shoulder Spikes', ['shoulders'], ['any'], 1, [flat('thorns', 4)], (c) => {
    cone(c, 'accent', [0.1, 0.4, 0], [0.4, 1.0, 0.4], { rot: [0, 0, -25] });
    cone(c, 'accent', [0.2, 0.25, -0.35], [0.3, 0.7, 0.3], { rot: [-30, 0, -35] });
    cone(c, 'accent', [0.2, 0.25, 0.35], [0.3, 0.7, 0.3], { rot: [30, 0, -35] });
  }, { weight: 1.5 }),
  part('crystals.shoulder', 'Shoulder Crystals', ['shoulders'], ['crystal', 'ice', 'arcane'], 1, [inc('damage', 0.06, ['spell']), flat('res.cold', 0.1)], (c) => {
    cone(c, 'glow', [0.1, 0.45, 0], [0.45, 1.2, 0.45], { glow: true, rot: [0, 0, -20] });
    cone(c, 'glow', [0.3, 0.25, 0.25], [0.3, 0.7, 0.3], { glow: true, rot: [20, 0, -45] });
  }),
  part('bone.shoulder', 'Bone Hooks', ['shoulders'], ['undead', 'beast', 'shadow'], 1, [inc('damage', 0.05, ['melee'])], (c) => {
    horn(c, 'secondary', [0.1, 0.2, 0], 1.4, 0.18, 70, { rot: [0, 90, -20] });
  }),
];

export const WINGS = [
  part('wing.bat', 'Bat Wings', ['wings'], ['shadow', 'void', 'blood', 'fire', 'undead'], 2, [inc('move.speed', 0.12), inc('evasion', 0.05)], (c) => {
    if (seg(c) === 1) {
      cyl(c, 'dark', [0.25, 0, 0], [0.04, 0.52, 0.04], { rot: [0, 0, 90] });
      slab(c, 'bat1', [[0, 0.03], [0.5, 0.02], [0.5, -0.32], [0.28, -0.2], [0, -0.3]], 0.015, 'primary', [0, 0, 0], [1, 1, 1], { rot: FLAT });
    } else {
      cyl(c, 'dark', [0.27, 0, 0.0], [0.03, 0.56, 0.03], { rot: [0, 0, 90] });
      cyl(c, 'dark', [0.2, 0, -0.14], [0.02, 0.44, 0.02], { rot: [0, -40, 90] });
      slab(c, 'bat2', [[0, 0.02], [0.56, 0.0], [0.42, -0.14], [0.32, -0.1], [0.2, -0.3], [0, -0.32]], 0.015, 'primary', [0, 0, 0], [1, 1, 1], { rot: FLAT });
    }
  }),
  part('wing.feather', 'Feathered Wings', ['wings'], ['nature', 'storm', 'beast', 'arcane', 'ice'], 2, [inc('move.speed', 0.1), flat('evasion', 20)], (c) => {
    if (seg(c) === 1) {
      slab(c, 'feather1', [[0, 0.04], [0.5, 0.04], [0.5, -0.28], [0, -0.26]], 0.04, 'primary', [0, 0, 0], [1, 1, 1], { rot: FLAT });
      [0.08, 0.22, 0.36].forEach((x) => box(c, 'secondary', [x, -0.01, -0.3], [0.12, 0.025, 0.14]));
    } else {
      slab(c, 'feather2', [[0, 0.04], [0.5, 0.0], [0.66, -0.1], [0.42, -0.24], [0.18, -0.32], [0, -0.28]], 0.035, 'primary', [0, 0, 0], [1, 1, 1], { rot: FLAT });
      [0.12, 0.3, 0.48].forEach((x, i) => box(c, 'secondary', [x, -0.01, -0.26 + i * 0.06], [0.14, 0.022, 0.16], { rot: [0, -20, 0] }));
    }
  }),
  part('wing.insect', 'Insect Wings', ['wings'], ['insect', 'poison', 'arcane', 'nature'], 1, [inc('move.speed', 0.15), inc('attack.speed', 0.05)], (c) => {
    if (seg(c) === 1) slab(c, 'insect1', [[0, 0], [0.25, 0.1], [0.5, 0.08], [0.56, 0], [0.3, -0.1], [0, -0.04]], 0.01, 'accent', [0, 0.01, 0], [1, 1, 1], { rot: FLAT });
    else slab(c, 'insect2', [[0, 0.06], [0.3, 0.12], [0.6, 0.06], [0.62, -0.04], [0.3, -0.08], [0, -0.06]], 0.01, 'accent', [0, 0.01, -0.05], [1, 1, 1], { rot: FLAT });
  }),
  part('wing.bone', 'Bone Wings', ['wings'], ['undead', 'shadow'], 1, [inc('move.speed', 0.06), flat('res.chaos', 0.1)], (c) => {
    cyl(c, 'secondary', [0.25, 0, 0], [0.04, 0.52, 0.04], { rot: [0, 0, 90] });
    if (seg(c) === 2) for (const a of [0, -25, -50]) cyl(c, 'secondary', [0.18, 0, -0.08], [0.025, 0.4, 0.025], { rot: [0, a, 90] });
    else slab(c, 'tatter', [[0, 0], [0.5, 0], [0.42, -0.18], [0.3, -0.1], [0.15, -0.24], [0, -0.15]], 0.01, 'dark', [0, -0.01, 0], [1, 1, 1], { rot: FLAT });
  }),
];

const TAIL_DOWN: [number, number, number] = [-90, 0, 0];

export const TAILS = [
  part('tail.club', 'Tail Club', ['tail'], ['beast', 'earth', 'construct'], 2, [flat('knockback', 2), flat('stun.chance', 0.1)], (c) => {
    lump(c, 'secondary', [0, 0, -0.5], [1.6, 1.4, 1.8]);
    pair((sx) => cone(c, 'accent', [0.5 * sx, 0.1, -0.5], [0.4, 0.7, 0.4], { rot: [0, 0, -80 * sx] }));
    cone(c, 'accent', [0, 0.6, -0.5], [0.4, 0.7, 0.4]);
  }, { anims: ['TailWhip'] }),
  part('tail.stinger', 'Stinger', ['tail'], ['insect', 'poison', 'void', 'fire'], 2, [flat('chance.poison', 0.25)], (c) => {
    horn(c, 'accent', [0, 0, 0], 1.8, 0.28, 110, { rot: TAIL_DOWN });
    ball(c, 'glow', [0, 1.2, -0.9], [0.25, 0.25, 0.25], { glow: true });
  }, { anims: ['TailWhip'] }),
  part('tail.whip', 'Whip Tail', ['tail'], ['beast', 'shadow', 'blood', 'water'], 1, [inc('attack.speed', 0.05)], (c) => {
    taper(c, 0.15, 'primary', [0, 0, -1.2], [0.4, 2.4, 0.4], { rot: TAIL_DOWN });
    cone(c, 'accent', [0, 0, -2.5], [0.3, 0.5, 0.15], { rot: TAIL_DOWN });
  }, { anims: ['TailWhip'] }),
  part('tail.fan', 'Tail Fan', ['tail'], ['nature', 'storm', 'beast', 'arcane'], 0, [flat('evasion', 15)], (c) => {
    for (const a of [-40, -20, 0, 20, 40]) taper(c, 0.4, a === 0 ? 'accent' : 'secondary', [0, 0.1, -0.2], [0.35, 2.4, 0.12], { rot: [-70, a, 0] });
  }),
  part('tail.flame', 'Flame Tail', ['tail'], ['fire', 'arcane', 'void'], 1, [inc('fire.damage', 0.1), flat('res.fire', 0.15)], (c) => {
    cone(c, 'glow', [0, 0.1, -0.6], [0.8, 1.6, 0.8], { glow: true, rot: [-100, 0, 0] });
    cone(c, 'glow', [0, 0.3, -0.4], [0.5, 1.0, 0.5], { glow: true, rot: [-60, 0, 0] });
  }),
  part('tail.blade', 'Blade Tail', ['tail'], ['construct', 'shadow', 'ice', 'crystal'], 2, [inc('damage', 0.1, ['melee']), flat('chance.bleed', 0.1)], (c) => {
    slab(c, 'tailblade', [[-0.3, 0], [0.3, 0], [0.05, 1.6], [-0.1, 1.2]], 0.08, 'accent', [0, 0, -0.1], [1, 1, 1], { rot: [-90, 0, 90] });
  }, { anims: ['TailWhip'] }),
];

export const CORES = [
  part('core.crystal', 'Crystal Core', ['core'], ['crystal', 'ice', 'arcane', 'construct'], 1, [inc('damage', 0.1, ['spell']), flat('res.cold', 0.1)], (c) => {
    cone(c, 'glow', [0, 0.25, 0], [0.7, 0.6, 0.7], { glow: true });
    cone(c, 'glow', [0, -0.25, 0], [0.7, 0.6, 0.7], { glow: true, rot: [180, 0, 0] });
  }),
  part('core.ember', 'Ember Heart', ['core'], ['fire', 'construct', 'earth'], 1, [inc('fire.damage', 0.12), flat('chance.ignite', 0.1)], (c) => {
    lump(c, 'glow', [0, 0, 0], [0.8, 0.8, 0.8], { glow: true });
    cyl(c, 'dark', [0, 0, 0], [1.0, 0.18, 1.0]);
  }),
  part('core.void', 'Void Core', ['core'], ['void', 'shadow', 'arcane'], 1, [inc('chaos.damage', 0.15), flat('res.chaos', 0.15)], (c) => {
    ball(c, 'dark', [0, 0, 0], [0.8, 0.8, 0.8]);
    cyl(c, 'glow', [0, 0, 0], [1.1, 0.08, 1.1], { glow: true, rot: [20, 0, 15] });
  }),
  part('core.rune', 'Rune Plate', ['core'], ['arcane', 'construct', 'storm', 'undead'], 1, [inc('cast.speed', 0.1), flat('res.lightning', 0.1)], (c) => {
    box(c, 'dark', [0, 0, 0.02], [0.9, 0.9, 0.1]);
    box(c, 'glow', [0, 0, 0.07], [0.5, 0.12, 0.04], { glow: true });
    box(c, 'glow', [0, 0, 0.07], [0.12, 0.5, 0.04], { glow: true });
  }),
  part('core.heart', 'Beating Heart', ['core'], ['blood', 'undead', 'nature'], 1, [flat('life.regen', 3), inc('life', 0.08)], (c) => {
    lump(c, 'accent', [0, 0, 0], [0.8, 0.9, 0.7]);
    ball(c, 'glow', [0.1, 0.1, 0.25], [0.3, 0.3, 0.25], { glow: true });
  }),
];

export const TENTACLES = [
  part('tentacle.plain', 'Tentacles', ['tentacles'], ['water', 'void', 'arcane', 'poison'], 1, [flat('chance.chill', 0.05), inc('attack.speed', 0.05)], (c) => {
    c.chain.forEach((j, i) => taper(c, 0.72, i % 2 ? 'secondary' : 'primary', [0, -0.5, 0], [0.62 - i * 0.12, 1.15, 0.62 - i * 0.12], { joint: j, rot: [180, 0, 0] }));
    cone(c, 'secondary', [0, -1.1, 0], [0.22, 0.4, 0.22], { joint: c.chain[c.chain.length - 1], rot: [180, 0, 0] });
  }),
  part('tentacle.spiked', 'Barbed Tentacles', ['tentacles'], ['void', 'blood', 'poison', 'shadow'], 2, [flat('thorns', 4), flat('chance.bleed', 0.1)], (c) => {
    c.chain.forEach((j, i) => {
      taper(c, 0.72, 'primary', [0, -0.5, 0], [0.62 - i * 0.12, 1.15, 0.62 - i * 0.12], { joint: j, rot: [180, 0, 0] });
      cone(c, 'accent', [0.25, -0.5, 0], [0.16, 0.36, 0.16], { joint: j, rot: [0, 0, -70] });
    });
  }),
  part('tentacle.glow', 'Glowing Filaments', ['tentacles'], ['water', 'ice', 'storm', 'arcane', 'crystal'], 1, [flat('chance.shock', 0.1), inc('lightning.damage', 0.1)], (c) => {
    c.chain.forEach((j, i) => taper(c, 0.6, 'secondary', [0, -0.5, 0], [0.32 - i * 0.06, 1.15, 0.32 - i * 0.06], { joint: j, rot: [180, 0, 0] }));
    ball(c, 'glow', [0, -1.05, 0], [0.3, 0.3, 0.3], { joint: c.chain[c.chain.length - 1], glow: true });
  }),
];

export const MISC = [part('core.aura', 'Aura Stone', ['core'], ['boss', 'arcane', 'crystal'], 3, [flag('aura.empower'), inc('damage', 0.1)], (c) => {
  cone(c, 'glow', [0, 0, 0], [0.6, 1.0, 0.6], { glow: true });
}, { weight: 0.3 })];
