import { BoxGeometry, type BufferGeometry, Group, type Material, Mesh, type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { PALETTE } from '../../engine/palette';
import { toonMaterial } from '../../engine/render/toon';

/**
 * The hero's weapons, built in code from chunky boxes (the generated hero.glb has none), one
 * per weapon class the loot can equip (`weapon.<class>` flags, WEAPON_CLASS_TAGS):
 *
 *   sword, axe, mace, sceptre, dagger, wand, staff  in the right fist
 *   bow                                             in the left fist, its string drawn to the right hand
 *
 * Conventions (src/game/hero/clips/combat.ts): a one-hand weapon's grip runs through the fist
 * along the hand's +Z, tipped 20° toward the fingers, so with the wrist curled back (wrist
 * −60) it extends the arm and with a straight wrist it stands up off the fist; edges and axe
 * heads face the hand's ±X (the way a flat swing travels). The bow stands along the left
 * hand's Z (upright when the arm points ahead), bulging away from the archer (the hand's −Y).
 *
 * `HeroWeapons` holds one of each under the hands and shows the equipped one; the anim CLI
 * attaches the same meshes for contact sheets (`npm run anim -- sheet BowDraw --weapon bow`).
 */
export type WeaponClass = 'sword' | 'axe' | 'mace' | 'sceptre' | 'dagger' | 'wand' | 'staff' | 'bow';
export const WEAPON_KINDS: readonly WeaponClass[] = ['sword', 'axe', 'mace', 'sceptre', 'dagger', 'wand', 'staff', 'bow'];

/** Blade tilt toward the fingers (see src/game/hero/clips/combat.ts). */
export const SWORD_TILT = (20 * Math.PI) / 180;

/** Where a right-hand weapon's grip sits in the fist (hand space), and the bow's in the left. */
const GRIP: [number, number, number] = [0, -0.08, 0.02];
const BOW_GRIP: [number, number, number] = [0, -0.08, 0.0];

/** Bow geometry (bow space: limbs along ±Z, the archer at +Y). */
export const BOW = {
  /** Half the bow's height (m) and how far its tips curl back toward the archer. */
  half: 0.6,
  curl: 0.17,
  /** The string at rest lies this far behind the grip (toward the archer). */
  brace: 0.2,
  /** The nock follows the drawing hand within this reach of the string's middle (m). */
  reach: 0.75,
  /** The arrow shows once the string is drawn back this far (m). */
  nockAt: 0.12,
} as const;

type Mat = (color: number) => Material;

const geo = new Map<string, BufferGeometry>();
function boxGeo(key: string, w: number, h: number, d: number, x = 0, y = 0, z = 0): BufferGeometry {
  const k = `${key}:${w}:${h}:${d}:${x}:${y}:${z}`;
  let g = geo.get(k);
  if (!g) {
    g = new BoxGeometry(w, h, d).translate(x, y, z);
    g.userData.shared = true;
    geo.set(k, g);
  }
  return g;
}

function part(parent: Object3D, name: string, mat: Mat, color: number, size: [number, number, number], at: [number, number, number] = [0, 0, 0]): Mesh {
  const m = new Mesh(boxGeo(name, ...size, ...at), mat(color));
  m.name = name;
  m.castShadow = true;
  parent.add(m);
  return m;
}

const P = PALETTE;

/** A one-hand weapon of `kind` (grip origin at the fist, along +Z). */
function build(kind: Exclude<WeaponClass, 'bow'>, mat: Mat): Group {
  const g = new Group();
  g.name = kind[0]!.toUpperCase() + kind.slice(1);
  const n = (s: string) => `${g.name}${s}`;
  switch (kind) {
    case 'sword':
      part(g, n('Grip'), mat, P.plum, [0.06, 0.06, 0.2], [0, 0, -0.02]);
      part(g, n('Pommel'), mat, P.sand, [0.09, 0.09, 0.07], [0, 0, -0.15]);
      part(g, n('Guard'), mat, P.sand, [0.3, 0.07, 0.07], [0, 0, 0.11]);
      part(g, n('Blade'), mat, P.white, [0.11, 0.035, 0.68], [0, 0, 0.48]);
      part(g, n('Edge'), mat, P.mist, [0.04, 0.045, 0.6], [0, 0, 0.5]);
      break;
    case 'axe':
      // a haft with a bearded head on the leading side (+X) and a spike behind
      part(g, n('Haft'), mat, P.plum, [0.06, 0.06, 0.74], [0, 0, 0.22]);
      part(g, n('Cap'), mat, P.slate, [0.08, 0.08, 0.06], [0, 0, -0.16]);
      part(g, n('Socket'), mat, P.slate, [0.1, 0.09, 0.16], [0, 0, 0.5]);
      part(g, n('Head'), mat, P.mist, [0.2, 0.05, 0.2], [0.13, 0, 0.5]);
      part(g, n('Bit'), mat, P.white, [0.05, 0.06, 0.3], [0.24, 0, 0.48]);
      part(g, n('Spike'), mat, P.slate, [0.1, 0.04, 0.06], [-0.09, 0, 0.52]);
      break;
    case 'mace':
      part(g, n('Haft'), mat, P.plum, [0.055, 0.055, 0.56], [0, 0, 0.15]);
      part(g, n('Pommel'), mat, P.sand, [0.08, 0.08, 0.06], [0, 0, -0.14]);
      part(g, n('Head'), mat, P.slate, [0.17, 0.17, 0.2], [0, 0, 0.5]);
      part(g, n('FlangeX'), mat, P.mist, [0.27, 0.06, 0.15], [0, 0, 0.5]);
      part(g, n('FlangeY'), mat, P.mist, [0.06, 0.27, 0.15], [0, 0, 0.5]);
      part(g, n('Tip'), mat, P.mist, [0.07, 0.07, 0.08], [0, 0, 0.63]);
      break;
    case 'sceptre':
      part(g, n('Haft'), mat, P.sand, [0.05, 0.05, 0.52], [0, 0, 0.14]);
      part(g, n('Pommel'), mat, P.sand, [0.08, 0.08, 0.06], [0, 0, -0.13]);
      part(g, n('Crown'), mat, P.sand, [0.18, 0.18, 0.07], [0, 0, 0.42]);
      part(g, n('Gem'), mat, P.cyan, [0.12, 0.12, 0.14], [0, 0, 0.51]);
      part(g, n('Point'), mat, P.sand, [0.05, 0.05, 0.08], [0, 0, 0.61]);
      break;
    case 'dagger':
      part(g, n('Grip'), mat, P.plum, [0.05, 0.05, 0.14], [0, 0, -0.01]);
      part(g, n('Pommel'), mat, P.sand, [0.07, 0.07, 0.05], [0, 0, -0.1]);
      part(g, n('Guard'), mat, P.sand, [0.17, 0.05, 0.05], [0, 0, 0.08]);
      part(g, n('Blade'), mat, P.white, [0.08, 0.03, 0.3], [0, 0, 0.25]);
      break;
    case 'wand':
      part(g, n('Shaft'), mat, P.teal, [0.045, 0.045, 0.38], [0, 0, 0.1]);
      part(g, n('Band'), mat, P.sand, [0.07, 0.07, 0.04], [0, 0, 0.22]);
      part(g, n('Gem'), mat, P.cyan, [0.09, 0.09, 0.11], [0, 0, 0.33]);
      part(g, n('Butt'), mat, P.sand, [0.06, 0.06, 0.04], [0, 0, -0.1]);
      break;
    case 'staff':
      // long: held a third of the way up, the head well above the fist
      part(g, n('Shaft'), mat, P.plum, [0.065, 0.065, 1.55], [0, 0, 0.27]);
      part(g, n('Ferrule'), mat, P.slate, [0.08, 0.08, 0.07], [0, 0, -0.48]);
      part(g, n('Band'), mat, P.sand, [0.09, 0.09, 0.05], [0, 0, 0.9]);
      part(g, n('Claw'), mat, P.sand, [0.2, 0.06, 0.12], [0, 0, 1.08]);
      part(g, n('Crystal'), mat, P.cyan, [0.13, 0.13, 0.2], [0, 0, 1.16]);
      break;
  }
  return g;
}

/** The bow: grip in the left fist, limbs along ±Z curling back to the archer (+Y), a drawable string and a nocked arrow. */
export class Bow {
  readonly group = new Group();
  private readonly strings: [Mesh, Mesh];
  private readonly arrow = new Group();
  private readonly top = new Vector3(0, BOW.curl, BOW.half);
  private readonly bottom = new Vector3(0, BOW.curl, -BOW.half);
  private readonly nock = new Vector3();
  /** How far the string is drawn now (m). */
  draw = 0;

  constructor(mat: Mat) {
    const g = this.group;
    g.name = 'Bow';
    part(g, 'BowGrip', mat, P.plum, [0.07, 0.08, 0.16]);
    // each limb: three segments on an arc, from the grip out to the tip
    const seg = 3;
    for (const s of [1, -1]) {
      for (let i = 0; i < seg; i++) {
        const z0 = (i / seg) * BOW.half;
        const z1 = ((i + 1) / seg) * BOW.half;
        const y0 = BOW.curl * (z0 / BOW.half) ** 2 - 0.03;
        const y1 = BOW.curl * (z1 / BOW.half) ** 2 - 0.03;
        const len = Math.hypot(z1 - z0, y1 - y0) + 0.02;
        const limb = part(g, `BowLimb${s > 0 ? 'Top' : 'Bottom'}${i}`, mat, i === seg - 1 ? P.orange : P.sand, [0.06, 0.045, len]);
        limb.position.set(0, (y0 + y1) / 2, (s * (z0 + z1)) / 2);
        limb.rotation.x = -s * Math.atan2(y1 - y0, z1 - z0);
      }
    }
    this.strings = [part(g, 'BowStringTop', mat, P.white, [0.018, 0.018, 1]), part(g, 'BowStringBottom', mat, P.white, [0.018, 0.018, 1])];
    for (const s of this.strings) s.castShadow = false;
    // the arrow points from the nock (origin) away from the archer (−Y)
    const a = this.arrow;
    a.name = 'BowArrow';
    const shaft = part(a, 'BowArrowShaft', mat, P.sand, [0.025, 0.66, 0.025], [0, -0.33, 0]);
    shaft.castShadow = false;
    part(a, 'BowArrowHead', mat, P.mist, [0.05, 0.08, 0.05], [0, -0.68, 0]);
    part(a, 'BowArrowFletch', mat, P.red, [0.012, 0.1, 0.06], [0, -0.06, 0]);
    a.visible = false;
    g.add(a);
    this.setString(null);
  }

  /**
   * Draw the string to `hand` (world position of the drawing hand), or let it rest (null, or
   * a hand out of reach). Call after the model is posed and its matrices are current.
   */
  setString(hand: Vector3 | null): void {
    const rest = V0.set(0, BOW.brace, 0);
    let pull = rest;
    if (hand) {
      this.group.updateWorldMatrix(true, false);
      const local = V1.copy(hand);
      this.group.worldToLocal(local);
      // only behind the string (toward the archer) and roughly at its middle
      if (local.y > BOW.brace - 0.02 && Math.abs(local.z) < 0.35 && local.distanceTo(rest) < BOW.reach) pull = local.setX(local.x * 0.3);
    }
    this.nock.copy(pull);
    this.draw = pull.y - BOW.brace;
    span(this.strings[0], this.top, this.nock);
    span(this.strings[1], this.bottom, this.nock);
    this.arrow.visible = this.draw > BOW.nockAt;
    this.arrow.position.copy(this.nock);
  }
}

const V0 = new Vector3();
const V1 = new Vector3();
const DIR = new Vector3();
const Z = new Vector3(0, 0, 1);
const Q = new Quaternion();

/** Stretch a unit-length (along Z) box from `a` to `b`. */
function span(m: Mesh, a: Vector3, b: Vector3): void {
  DIR.subVectors(b, a);
  const len = Math.max(1e-3, DIR.length());
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.copy(Q.setFromUnitVectors(Z, DIR.divideScalar(len)));
  m.scale.set(1, 1, len);
}

/** Which weapon class the equipped item gives (`weapon.<class>` flags); no flag = the starter sword. */
export function weaponClassOf(has: (flag: string) => boolean): WeaponClass {
  for (const k of ['bow', 'staff', 'wand', 'dagger', 'axe', 'mace', 'sceptre', 'sword'] as const) if (has(`weapon.${k}`)) return k;
  return 'sword';
}

/**
 * Every weapon in the hero's hands, one shown at a time. Two-handers are drawn larger.
 *
 *   const weapons = new HeroWeapons(model);   // the sword shows
 *   weapons.equip('bow', false);
 *   weapons.update(model);                    // per frame, after posing: the bow string follows the right hand
 */
export class HeroWeapons {
  readonly meshes = new Map<WeaponClass, Object3D>();
  readonly bow: Bow;
  kind: WeaponClass = 'sword';
  twoHand = false;
  private readonly handR: Object3D;
  private readonly hand = new Vector3();

  constructor(model: Object3D, mat: Mat = toonMaterial) {
    const handR = model.getObjectByName('HandR');
    const handL = model.getObjectByName('HandL');
    if (!handR || !handL) throw new Error('HeroWeapons: the model has no HandR / HandL joint');
    this.handR = handR;
    for (const k of WEAPON_KINDS) {
      if (k === 'bow') continue;
      const w = build(k, mat);
      w.position.set(...GRIP);
      w.rotation.set(SWORD_TILT, 0, 0);
      handR.add(w);
      this.meshes.set(k, w);
    }
    this.bow = new Bow(mat);
    this.bow.group.position.set(...BOW_GRIP);
    handL.add(this.bow.group);
    this.meshes.set('bow', this.bow.group);
    this.equip('sword', false);
  }

  /** Show the weapon of class `kind` (two-handed: drawn a size up). */
  equip(kind: WeaponClass, twoHand: boolean): void {
    this.kind = kind;
    this.twoHand = twoHand;
    for (const [k, m] of this.meshes) {
      m.visible = k === kind;
      const s = twoHand && k !== 'bow' && k !== 'staff' ? 1.3 : 1;
      m.scale.setScalar(s);
    }
  }

  /** The shown weapon. */
  get current(): Object3D {
    return this.meshes.get(this.kind)!;
  }

  /** Per frame, after the model is posed: the bow's string follows the drawing hand. */
  update(model: Object3D): void {
    if (this.kind !== 'bow') return;
    model.updateMatrixWorld(true);
    this.handR.localToWorld(this.hand.set(0, -0.07, 0.01)); // the glove's middle
    this.bow.setString(this.hand);
  }
}

/** The sword alone (kept for callers of the old API): a `HeroWeapons`' sword. */
export function createSword(mat: Mat = toonMaterial): Group {
  const w = build('sword', mat);
  return w;
}

/** Put the sword in the hero's right hand (the glove's centre, blade tilted toward the fingers). */
export function attachSword(model: Object3D, sword: Object3D = createSword()): Object3D {
  const hand = model.getObjectByName('HandR');
  if (!hand) throw new Error('attachSword: the model has no HandR joint');
  sword.position.set(...GRIP);
  sword.rotation.set(SWORD_TILT, 0, 0);
  hand.add(sword);
  return sword;
}
