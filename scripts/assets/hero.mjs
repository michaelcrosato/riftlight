// Hero character rig (geometry + joint hierarchy only). Animations are authored as data
// in src/game/hero/animations.ts and compiled at runtime (src/engine/animation/).
//
// The character faces +Z; feet at y = 0. L/R are the CHARACTER'S OWN sides: its right
// side is at -X, its left side at +X.
//
//   Hero
//   └─ Pelvis (hip height; root of the pose: position, rotation, squash/stretch)
//      ├─ Torso ─┬─ Head
//      │         ├─ ArmR ─ ForearmR ─ HandR        (right = -X)
//      │         └─ ArmL ─ ForearmL ─ HandL        (left  = +X)
//      ├─ LegR ─ ShinR ─ FootR
//      └─ LegL ─ ShinL ─ FootL
//
// Joint names are a contract with the animation data and src/game/hero/rig.ts.
import * as THREE from 'three';

const C = {
  ink: 0x1a1c2c, plum: 0x5d275d, red: 0xb13e53, orange: 0xef7d57, sand: 0xffcd75,
  lime: 0xa7f070, green: 0x38b764, teal: 0x257179, navy: 0x29366f, blue: 0x3b5dc9,
  sky: 0x41a6f6, cyan: 0x73eff7, white: 0xf4f4f4, mist: 0x94b0c2, slate: 0x566c86, night: 0x333c57,
};

export const HIP = 0.62;

const mat = (color, name) => new THREE.MeshStandardMaterial({ color, name, roughness: 1, metalness: 0 });

function box(name, [w, h, d], color, [x = 0, y = 0, z = 0] = []) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const m = new THREE.Mesh(g, mat(color, name));
  m.name = name;
  return m;
}

function joint(name, [x, y, z], ...children) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  if (children.length) o.add(...children);
  return o;
}

function buildRig() {
  const side = (S) => {
    const x = S === 'R' ? -1 : 1; // character's right side is -X
    const arm = joint(`Arm${S}`, [0.36 * x, 0.5, 0],
      box(`Sleeve${S}`, [0.16, 0.28, 0.17], C.red, [0, -0.11, 0]),
      joint(`Forearm${S}`, [0, -0.25, 0],
        box(`Forearm${S}_Mesh`, [0.13, 0.17, 0.14], C.red, [0, -0.07, 0]),
        joint(`Hand${S}`, [0, -0.16, 0],
          box(`Glove${S}`, [0.18, 0.17, 0.18], C.white, [0, -0.06, 0.01]))));
    const leg = joint(`Leg${S}`, [0.14 * x, 0, 0],
      box(`Thigh${S}`, [0.2, 0.32, 0.22], C.blue, [0, -0.14, 0]),
      joint(`Shin${S}`, [0, -0.3, 0],
        box(`Shin${S}_Mesh`, [0.17, 0.22, 0.19], C.blue, [0, -0.1, 0]),
        joint(`Foot${S}`, [0, -0.22, 0],
          box(`Shoe${S}`, [0.21, 0.12, 0.32], C.plum, [0, -0.04, 0.05]))));
    return { arm, leg };
  };
  const r = side('R');
  const l = side('L');
  const head = joint('Head', [0, 0.6, 0],
    box('Face', [0.46, 0.42, 0.42], C.sand, [0, 0.21, 0]),
    box('Hat', [0.52, 0.15, 0.48], C.red, [0, 0.45, -0.01]),
    box('Brim', [0.4, 0.05, 0.16], C.red, [0, 0.39, 0.27]),
    box('Eyes', [0.3, 0.08, 0.04], C.ink, [0, 0.27, 0.215]),
    box('Nose', [0.12, 0.1, 0.1], C.orange, [0, 0.18, 0.25]),
    box('Moustache', [0.28, 0.06, 0.05], C.ink, [0, 0.11, 0.225]));
  const torso = joint('Torso', [0, 0, 0],
    box('Overalls', [0.54, 0.4, 0.34], C.blue, [0, 0.2, 0]),
    box('Shirt', [0.56, 0.2, 0.36], C.red, [0, 0.5, 0]),
    box('ButtonR', [0.07, 0.07, 0.03], C.sand, [-0.14, 0.36, 0.175]),
    box('ButtonL', [0.07, 0.07, 0.03], C.sand, [0.14, 0.36, 0.175]),
    head, r.arm, l.arm);
  const pelvis = joint('Pelvis', [0, HIP, 0], torso, r.leg, l.leg);
  const root = new THREE.Object3D();
  root.name = 'Hero';
  root.add(pelvis);
  return root;
}

export function hero() {
  return { scene: buildRig(), animations: [] };
}
