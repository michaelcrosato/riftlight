import { BoxGeometry, type BufferGeometry, Group, Mesh, type Object3D } from 'three/webgpu';
import { PALETTE } from '../../engine/palette';
import { toonMaterial } from '../../engine/render/toon';

const geo = new Map<string, BufferGeometry>();
function box(key: string, w: number, h: number, d: number, z: number): BufferGeometry {
  let g = geo.get(key);
  if (!g) {
    g = new BoxGeometry(w, h, d).translate(0, 0, z);
    g.userData.shared = true;
    geo.set(key, g);
  }
  return g;
}

/** Blade tilt toward the fingers (see src/game/hero/clips/combat.ts). */
export const SWORD_TILT = (20 * Math.PI) / 180;

/**
 * The hero's sword, built in code (the generated hero.glb has no weapon): grip, guard and a
 * chunky blade along +Z, in toon materials. `attachSword` puts it in the right fist.
 */
export function createSword(): Group {
  const sword = new Group();
  sword.name = 'Sword';
  const part = (key: string, w: number, h: number, d: number, z: number, color: number) => {
    const m = new Mesh(box(key, w, h, d, z), toonMaterial(color));
    m.castShadow = true;
    m.name = `Sword${key}`;
    sword.add(m);
    return m;
  };
  part('Grip', 0.06, 0.06, 0.2, -0.02, PALETTE.plum);
  part('Pommel', 0.09, 0.09, 0.07, -0.15, PALETTE.sand);
  part('Guard', 0.3, 0.07, 0.07, 0.11, PALETTE.sand);
  part('Blade', 0.11, 0.035, 0.68, 0.48, PALETTE.white);
  part('Edge', 0.04, 0.045, 0.6, 0.5, PALETTE.mist);
  return sword;
}

/** Put the sword in the hero's right hand (the glove's centre, blade tilted toward the fingers). */
export function attachSword(model: Object3D, sword: Object3D = createSword()): Object3D {
  const hand = model.getObjectByName('HandR');
  if (!hand) throw new Error('attachSword: the model has no HandR joint');
  sword.position.set(0, -0.08, 0.02);
  sword.rotation.set(SWORD_TILT, 0, 0);
  hand.add(sword);
  return sword;
}
