/**
 * Townsfolk models: the hero's jointed rig (same joint names and positions, so HERO_RIG,
 * its foot IK and every clip helper work unchanged) dressed with different meshes and
 * colours. Built in code from boxes and prisms with cached toon materials; no GLB.
 *
 *   Pelvis ─┬─ Torso ─┬─ Head
 *           │         ├─ ArmR ─ ForearmR ─ HandR      (right = -X; the model faces +Z)
 *           │         └─ ArmL ─ ForearmL ─ HandL
 *           ├─ LegR ─ ShinR ─ FootR
 *           └─ LegL ─ ShinL ─ FootL
 *
 * Mesh names the animation tools rely on: ShoeR/ShoeL (soles), GloveR/GloveL (traced).
 * `npm run anim -- check --character brann` measures these models with their clips.
 */
import { BoxGeometry, CylinderGeometry, Mesh, Object3D, OctahedronGeometry } from 'three/webgpu';
// Direct module imports (not the engine index): the anim CLI loads this file in node.
import { PALETTE, type PaletteColor } from '../../engine/palette';
import { toonMaterial } from '../../engine/render/toon';
import { faceted } from './kit';

type V3 = [number, number, number];

function box(name: string, size: V3, color: PaletteColor, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): Mesh {
  const g = new BoxGeometry(...size);
  const m = new Mesh(g, toonMaterial(PALETTE[color]));
  m.name = name;
  m.position.set(...at);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function prism(name: string, rTop: number, rBottom: number, h: number, segs: number, color: PaletteColor, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]): Mesh {
  const m = new Mesh(faceted(new CylinderGeometry(rTop, rBottom, h, segs)), toonMaterial(PALETTE[color]));
  m.name = name;
  m.position.set(...at);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function joint(name: string, at: V3, ...children: Object3D[]): Object3D {
  const o = new Object3D();
  o.name = name;
  o.position.set(...at);
  if (children.length) o.add(...children);
  return o;
}

/** What a townsperson wears. Sizes are multipliers on the hero's box sizes. */
export interface Outfit {
  skin: PaletteColor;
  shirt: PaletteColor;
  sleeve?: PaletteColor;
  /** Lower torso / belt area. */
  waist: PaletteColor;
  legs: PaletteColor;
  shoes: PaletteColor;
  hands?: PaletteColor;
  /** Torso width / depth multiplier (1 = hero). */
  bulk?: number;
  /** Arm thickness multiplier. */
  arms?: number;
  /** Extra meshes per joint, built by the caller. */
  extras?: Partial<Record<'Head' | 'Torso' | 'Pelvis' | 'HandR' | 'HandL' | 'ForearmR' | 'ForearmL' | 'LegR' | 'LegL' | 'ShinR' | 'ShinL', Object3D[]>>;
  /** Hide the stock face features (hoods, masks). */
  noFace?: boolean;
  eyes?: PaletteColor;
}

/** Build a townsperson on the hero rig. The root faces +Z with its feet at y = 0. */
export function buildTownsfolk(name: string, o: Outfit): Object3D {
  const bulk = o.bulk ?? 1;
  const armK = o.arms ?? 1;
  const ex = (j: keyof NonNullable<Outfit['extras']>) => o.extras?.[j] ?? [];
  const side = (S: 'R' | 'L') => {
    const x = S === 'R' ? -1 : 1;
    const arm = joint(
      `Arm${S}`,
      [0.36 * x * (0.92 + 0.08 * bulk), 0.5, 0],
      box(`Sleeve${S}`, [0.16 * armK, 0.28, 0.17 * armK], o.sleeve ?? o.shirt, [0, -0.11, 0]),
      joint(
        `Forearm${S}`,
        [0, -0.25, 0],
        box(`Forearm${S}_Mesh`, [0.13 * armK, 0.17, 0.14 * armK], o.sleeve ?? o.skin, [0, -0.07, 0]),
        ...ex(`Forearm${S}`),
        joint(`Hand${S}`, [0, -0.16, 0], box(`Glove${S}`, [0.16, 0.15, 0.16], o.hands ?? o.skin, [0, -0.06, 0.01]), ...ex(`Hand${S}`)),
      ),
    );
    const leg = joint(
      `Leg${S}`,
      [0.14 * x, 0, 0],
      box(`Thigh${S}`, [0.2, 0.32, 0.22], o.legs, [0, -0.14, 0]),
      ...ex(`Leg${S}`),
      joint(
        `Shin${S}`,
        [0, -0.3, 0],
        box(`Shin${S}_Mesh`, [0.17, 0.22, 0.19], o.legs, [0, -0.1, 0]),
        ...ex(`Shin${S}`),
        joint(`Foot${S}`, [0, -0.22, 0], box(`Shoe${S}`, [0.21, 0.12, 0.32], o.shoes, [0, -0.04, 0.05])),
      ),
    );
    return { arm, leg };
  };
  const r = side('R');
  const l = side('L');
  const face: Object3D[] = o.noFace
    ? []
    : [box('Eyes', [0.3, 0.07, 0.04], o.eyes ?? 'ink', [0, 0.27, 0.215]), box('Nose', [0.11, 0.1, 0.09], o.skin === 'sand' ? 'orange' : o.skin, [0, 0.19, 0.245])];
  const head = joint('Head', [0, 0.6, 0], box('Face', [0.44, 0.42, 0.4], o.skin, [0, 0.21, 0]), ...face, ...ex('Head'));
  const torso = joint(
    'Torso',
    [0, 0, 0],
    box('Belly', [0.52 * bulk, 0.4, 0.33 * bulk], o.waist, [0, 0.2, 0]),
    box('Chest', [0.55 * bulk, 0.22, 0.35 * bulk], o.shirt, [0, 0.5, 0]),
    ...ex('Torso'),
    head,
    r.arm,
    l.arm,
  );
  const pelvis = joint('Pelvis', [0, 0.62, 0], torso, r.leg, l.leg, ...ex('Pelvis'));
  const root = new Object3D();
  root.name = name;
  root.add(pelvis);
  return root;
}

// ------------------------------------------------------------------ the cast

/** Brann the blacksmith: broad, bald, ink beard, leather apron, a hammer in his right hand. */
export function buildBrann(): Object3D {
  const hammer = [
    box('HammerHandle', [0.06, 0.5, 0.06], 'plum', [0, -0.2, 0.02]),
    box('HammerHead', [0.13, 0.13, 0.26], 'slate', [0, -0.44, 0.03]),
    box('HammerFace', [0.11, 0.11, 0.05], 'mist', [0, -0.44, -0.12]),
  ];
  return buildTownsfolk('Brann', {
    skin: 'sand',
    shirt: 'orange',
    sleeve: 'sand',
    waist: 'plum',
    legs: 'night',
    shoes: 'ink',
    hands: 'plum',
    bulk: 1.18,
    arms: 1.25,
    extras: {
      Head: [
        box('Beard', [0.4, 0.22, 0.12], 'ink', [0, 0.06, 0.2]),
        box('BeardChin', [0.26, 0.12, 0.1], 'ink', [0, -0.05, 0.2]),
        box('Brow', [0.36, 0.05, 0.05], 'ink', [0, 0.33, 0.21]),
        box('EarR', [0.05, 0.1, 0.08], 'sand', [-0.24, 0.22, 0]),
        box('EarL', [0.05, 0.1, 0.08], 'sand', [0.24, 0.22, 0]),
      ],
      Torso: [
        box('Apron', [0.5, 0.62, 0.05], 'plum', [0, 0.28, 0.2]),
        box('ApronStrap', [0.08, 0.26, 0.05], 'plum', [0, 0.62, 0.19]),
        box('ApronPocket', [0.22, 0.1, 0.03], 'red', [0, 0.18, 0.23]),
      ],
      Pelvis: [box('ApronSkirt', [0.48, 0.28, 0.05], 'plum', [0, -0.1, 0.19])],
      HandR: hammer,
      ForearmR: [box('BracerR', [0.17, 0.08, 0.17], 'plum', [0, -0.1, 0])],
      ForearmL: [box('BracerL', [0.17, 0.08, 0.17], 'plum', [0, -0.1, 0])],
    },
  });
}

/** Ilsa the merchant: teal dress, red headscarf, satchel of coins. */
export function buildIlsa(): Object3D {
  return buildTownsfolk('Ilsa', {
    skin: 'sand',
    shirt: 'teal',
    sleeve: 'teal',
    waist: 'teal',
    legs: 'teal',
    shoes: 'plum',
    bulk: 0.92,
    arms: 0.9,
    extras: {
      Head: [
        box('Scarf', [0.48, 0.18, 0.46], 'red', [0, 0.4, -0.02]),
        box('ScarfBack', [0.46, 0.3, 0.12], 'red', [0, 0.2, -0.2]),
        box('ScarfKnot', [0.12, 0.1, 0.08], 'orange', [0.18, 0.44, 0.18]),
        box('Hair', [0.46, 0.1, 0.08], 'plum', [0, 0.36, 0.18]),
        box('EarringL', [0.05, 0.07, 0.05], 'sand', [0.24, 0.12, 0.02]),
      ],
      Torso: [
        box('Collar', [0.5, 0.06, 0.37], 'white', [0, 0.6, 0]),
        box('Sash', [0.54, 0.08, 0.36], 'sand', [0, 0.06, 0]),
        box('Satchel', [0.16, 0.18, 0.1], 'orange', [0.3, 0.08, 0.06]),
        box('SatchelStrap', [0.05, 0.5, 0.05], 'plum', [0.14, 0.32, 0.17], [0, 0, -0.5]),
      ],
      Pelvis: [prism('Skirt', 0.3, 0.42, 0.5, 8, 'teal', [0, -0.25, 0])],
    },
  });
}

/** Oru the mystic: hooded plum robe, long sleeves, a pale glowing mask of a face. */
export function buildOru(): Object3D {
  return buildTownsfolk('Oru', {
    skin: 'mist',
    shirt: 'plum',
    sleeve: 'plum',
    waist: 'plum',
    legs: 'plum',
    shoes: 'night',
    hands: 'mist',
    bulk: 0.95,
    noFace: true,
    extras: {
      Head: [
        box('Hood', [0.52, 0.5, 0.46], 'plum', [0, 0.25, -0.04]),
        box('HoodPeak', [0.3, 0.14, 0.3], 'plum', [0, 0.54, -0.08]),
        box('Shadow', [0.36, 0.3, 0.04], 'ink', [0, 0.2, 0.19]),
        box('EyeR', [0.07, 0.05, 0.03], 'cyan', [-0.08, 0.24, 0.21]),
        box('EyeL', [0.07, 0.05, 0.03], 'cyan', [0.08, 0.24, 0.21]),
        box('Rune', [0.06, 0.06, 0.03], 'sand', [0, 0.4, 0.2]),
      ],
      Torso: [
        box('Stole', [0.14, 0.5, 0.05], 'sand', [-0.12, 0.35, 0.19]),
        box('StoleL', [0.14, 0.5, 0.05], 'sand', [0.12, 0.35, 0.19]),
        box('Beads', [0.3, 0.06, 0.05], 'cyan', [0, 0.52, 0.2]),
      ],
      Pelvis: [prism('Robe', 0.3, 0.38, 0.4, 8, 'plum', [0, -0.18, 0])],
      ForearmR: [box('CuffR', [0.2, 0.12, 0.2], 'plum', [0, -0.14, 0])],
      ForearmL: [box('CuffL', [0.2, 0.12, 0.2], 'plum', [0, -0.14, 0])],
    },
  });
}

/** Vex the rift keeper: tall navy greatcoat, silver hair, a staff with a rift crystal. */
export function buildVex(): Object3D {
  const staff = [
    box('StaffShaft', [0.06, 1.7, 0.06], 'night', [0, 0.04, 0.02]),
    box('StaffBand', [0.1, 0.08, 0.1], 'sand', [0, 0.76, 0.02]),
    box('StaffFork', [0.2, 0.06, 0.06], 'night', [0, 0.86, 0.02]),
    Object.assign(new Mesh(faceted(new OctahedronGeometry(0.11)), toonMaterial(PALETTE.cyan)), { name: 'StaffCrystal' }),
  ];
  staff[3]!.position.set(0, 1.0, 0.02);
  return buildTownsfolk('Vex', {
    skin: 'sand',
    shirt: 'navy',
    sleeve: 'navy',
    waist: 'night',
    legs: 'night',
    shoes: 'ink',
    hands: 'slate',
    bulk: 1,
    extras: {
      Head: [
        box('Hair', [0.48, 0.16, 0.44], 'white', [0, 0.42, -0.02]),
        box('HairBack', [0.46, 0.34, 0.1], 'white', [0, 0.2, -0.2]),
        box('Visor', [0.34, 0.06, 0.05], 'cyan', [0, 0.28, 0.22]),
        box('Collar', [0.5, 0.18, 0.44], 'navy', [0, 0.02, -0.02]),
      ],
      Torso: [
        box('Lapel', [0.16, 0.5, 0.05], 'sky', [0, 0.3, 0.18]),
        box('Belt', [0.56, 0.07, 0.36], 'sand', [0, 0.04, 0]),
        box('Pauldron', [0.66, 0.08, 0.3], 'slate', [0, 0.66, 0]),
      ],
      Pelvis: [
        box('CoatTailR', [0.24, 0.62, 0.06], 'navy', [-0.13, -0.24, -0.18]),
        box('CoatTailL', [0.24, 0.62, 0.06], 'navy', [0.13, -0.24, -0.18]),
        box('CoatFrontR', [0.2, 0.42, 0.05], 'navy', [-0.15, -0.16, 0.18]),
        box('CoatFrontL', [0.2, 0.42, 0.05], 'navy', [0.15, -0.16, 0.18]),
      ],
      HandL: staff,
    },
  });
}

/** Two villagers who stroll the paths. */
export function buildVillager(variant: 0 | 1): Object3D {
  if (variant === 0)
    return buildTownsfolk('Villager', {
      skin: 'sand',
      shirt: 'green',
      waist: 'plum',
      legs: 'slate',
      shoes: 'plum',
      extras: {
        Head: [box('Cap', [0.46, 0.12, 0.44], 'orange', [0, 0.45, 0]), box('CapBrim', [0.36, 0.04, 0.14], 'orange', [0, 0.4, 0.24])],
        HandL: [box('Basket', [0.24, 0.16, 0.2], 'orange', [0, -0.18, 0.04]), box('Bread', [0.18, 0.06, 0.12], 'sand', [0, -0.08, 0.04])],
      },
    });
  return buildTownsfolk('Villager2', {
    skin: 'orange',
    shirt: 'sky',
    waist: 'blue',
    legs: 'navy',
    shoes: 'ink',
    bulk: 0.9,
    extras: {
      Head: [box('HairBun', [0.46, 0.16, 0.44], 'ink', [0, 0.42, -0.02]), box('Bun', [0.16, 0.14, 0.14], 'ink', [0, 0.5, -0.2])],
      Pelvis: [prism('Skirt', 0.28, 0.36, 0.42, 8, 'blue', [0, -0.2, 0])],
    },
  });
}

/** Every townsperson by id (the anim CLI and the town both use this). */
export const TOWNSFOLK: Record<string, () => Object3D> = {
  brann: buildBrann,
  ilsa: buildIlsa,
  oru: buildOru,
  vex: buildVex,
  villager: () => buildVillager(0),
  villager2: () => buildVillager(1),
};
