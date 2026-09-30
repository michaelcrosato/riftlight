// Hero character: jointed blocky rig + a large baked animation library.
//
// Rig (character faces +Z, feet at y=0):
//   Hero
//   └─ Pelvis (hip height; animated position + rotation → flips, prone, lying down)
//      ├─ Torso ─┬─ Head
//      │         ├─ ArmL ─ ForearmL      ├─ ArmR ─ ForearmR
//      ├─ LegL ─ ShinL
//      └─ LegR ─ ShinR
//
// Rotation conventions (radians, Euler XYZ):
//   Legs/arms point down at rest: negative X swings them FORWARD (arms overhead ≈ -π).
//   Knees/elbows: shin +X bends the knee (foot goes back); forearm -X bends the elbow.
//   Torso/Pelvis point up: positive X leans FORWARD. Pelvis X = +π/2 → face down (prone),
//   -π/2 → on back. Front flip = Pelvis X 0 → 2π, backflip 0 → -2π.
//   Left side is -X; for ArmL, negative Z raises the arm sideways (outward).
import * as THREE from 'three';

const C = {
  ink: 0x1a1c2c, plum: 0x5d275d, red: 0xb13e53, orange: 0xef7d57, sand: 0xffcd75,
  lime: 0xa7f070, green: 0x38b764, teal: 0x257179, navy: 0x29366f, blue: 0x3b5dc9,
  sky: 0x41a6f6, cyan: 0x73eff7, white: 0xf4f4f4, mist: 0x94b0c2, slate: 0x566c86, night: 0x333c57,
};

export const HIP = 0.62;
const PI = Math.PI;

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
  const side = (s, L) => {
    const x = s < 0 ? -1 : 1;
    const arm = joint(`Arm${L}`, [0.36 * x, 0.5, 0],
      box(`Sleeve${L}`, [0.16, 0.28, 0.17], C.red, [0, -0.11, 0]),
      joint(`Forearm${L}`, [0, -0.25, 0],
        box(`Forearm${L}_Mesh`, [0.13, 0.17, 0.14], C.red, [0, -0.07, 0]),
        box(`Glove${L}`, [0.18, 0.17, 0.18], C.white, [0, -0.22, 0.01])));
    const leg = joint(`Leg${L}`, [0.14 * x, 0, 0],
      box(`Thigh${L}`, [0.2, 0.32, 0.22], C.blue, [0, -0.14, 0]),
      joint(`Shin${L}`, [0, -0.3, 0],
        box(`Shin${L}_Mesh`, [0.17, 0.22, 0.19], C.blue, [0, -0.1, 0]),
        box(`Shoe${L}`, [0.21, 0.12, 0.32], C.plum, [0, -0.26, 0.05])));
    return { arm, leg };
  };
  const l = side(-1, 'L');
  const r = side(1, 'R');
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
    box('ButtonL', [0.07, 0.07, 0.03], C.sand, [-0.14, 0.36, 0.175]),
    box('ButtonR', [0.07, 0.07, 0.03], C.sand, [0.14, 0.36, 0.175]),
    head, l.arm, r.arm);
  const pelvis = joint('Pelvis', [0, HIP, 0], torso, l.leg, r.leg);
  const root = new THREE.Object3D();
  root.name = 'Hero';
  root.add(pelvis);
  return root;
}

// ---------------------------------------------------------------- poses

const JOINTS = ['Pelvis', 'Torso', 'Head', 'ArmL', 'ForearmL', 'ArmR', 'ForearmR', 'LegL', 'ShinL', 'LegR', 'ShinR'];
const REST = {
  Pelvis: { p: [0, HIP, 0], r: [0, 0, 0] },
  Torso: [0, 0, 0], Head: [0, 0, 0],
  ArmL: [0, 0, -0.1], ForearmL: [-0.15, 0, 0], ArmR: [0, 0, 0.1], ForearmR: [-0.15, 0, 0],
  LegL: [0, 0, 0], ShinL: [0, 0, 0], LegR: [0, 0, 0], ShinR: [0, 0, 0],
};

/** Complete pose from a partial one; Pelvis may be {p?, r?} or rotation array (y = HIP). */
function pose(partial = {}) {
  const out = {};
  for (const j of JOINTS) {
    const v = partial[j];
    if (j === 'Pelvis') {
      const pv = Array.isArray(v) ? { r: v } : v ?? {};
      out.Pelvis = { p: pv.p ?? REST.Pelvis.p, r: pv.r ?? REST.Pelvis.r };
    } else {
      out[j] = v ?? REST[j];
    }
  }
  return out;
}

/** Mirror a pose left↔right (for alternating gaits). */
function mirror(p) {
  const m = {};
  const flip = ([x, y, z]) => [x, -y, -z];
  for (const [k, v] of Object.entries(p)) {
    const other = k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k;
    if (k === 'Pelvis') {
      const pv = Array.isArray(v) ? { r: v } : v;
      m.Pelvis = { p: pv.p ? [-pv.p[0], pv.p[1], pv.p[2]] : undefined, r: pv.r ? flip(pv.r) : undefined };
    } else m[other] = flip(v);
  }
  return m;
}

const hip = (y, r = [0, 0, 0], x = 0, z = 0) => ({ p: [x, y, z], r });
const q = (e) => new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));

/** Build a clip from [time, partialPose] keys. Every joint gets a track (clips fully define the pose). */
function clip(name, keys) {
  const times = keys.map(([t]) => t);
  const poses = keys.map(([, p]) => pose(p));
  const tracks = [];
  for (const j of JOINTS) {
    const rots = poses.map((p) => (j === 'Pelvis' ? p.Pelvis.r : p[j]));
    // Keep quaternions on one hemisphere so interpolation takes the short way; big flips
    // are authored with ≤ 90° steps between keys.
    const quats = [];
    let prev = null;
    for (const e of rots) {
      const qq = q(e);
      if (prev && prev.dot(qq) < 0) qq.set(-qq.x, -qq.y, -qq.z, -qq.w);
      quats.push(...qq.toArray());
      prev = qq;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${j}.quaternion`, times, quats));
  }
  tracks.push(new THREE.VectorKeyframeTrack('Pelvis.position', times, poses.flatMap((p) => p.Pelvis.p)));
  return new THREE.AnimationClip(name, times.at(-1), tracks);
}

/** Two-phase cyclic gait: A at 0, mirrored A at half, A at end (plus optional passing poses). */
function gait(name, dur, a, pass) {
  const keys = [[0, a], [dur / 2, mirror(a)], [dur, a]];
  if (pass) {
    keys.splice(1, 0, [dur / 4, pass]);
    keys.splice(3, 0, [(3 * dur) / 4, mirror(pass)]);
  }
  return clip(name, keys);
}

/** Flip keys: rotate Pelvis about `axis` (0=x, 2=z) by `turns`·2π in quarter steps. */
function flipKeys(t0, t1, axis, dir, body, y = HIP) {
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const r = [0, 0, 0];
    r[axis] = (dir * i * PI) / 2;
    out.push([t0 + ((t1 - t0) * i) / 4, { ...body, Pelvis: hip(y, r) }]);
  }
  return out;
}

// Shared body shapes
const CROUCH = { Pelvis: hip(0.36), Torso: [0.45, 0, 0], Head: [-0.25, 0, 0], LegL: [-1.25, 0, -0.05], ShinL: [2.0, 0, 0], LegR: [-1.25, 0, 0.05], ShinR: [2.0, 0, 0], ArmL: [-0.5, 0, -0.2], ForearmL: [-0.6, 0, 0], ArmR: [-0.5, 0, 0.2], ForearmR: [-0.6, 0, 0] };
const TUCK = { Torso: [0.5, 0, 0], LegL: [-1.8, 0, 0], ShinL: [2.2, 0, 0], LegR: [-1.8, 0, 0], ShinR: [2.2, 0, 0], ArmL: [-1.0, 0, -0.3], ForearmL: [-1.3, 0, 0], ArmR: [-1.0, 0, 0.3], ForearmR: [-1.3, 0, 0] };
const PRONE_Y = 0.17;
const PRONE = { Pelvis: hip(PRONE_Y, [PI / 2, 0, 0]), Head: [-0.55, 0, 0], ArmL: [-2.7, 0, -0.35], ForearmL: [-1.2, 0, 0], ArmR: [-2.7, 0, 0.35], ForearmR: [-1.2, 0, 0], LegL: [0, 0, -0.08], LegR: [0, 0, 0.08] };
const ON_BACK = { Pelvis: hip(PRONE_Y, [-PI / 2, 0, 0]), Head: [0.35, 0, 0], ArmL: [-2.9, 0, -0.5], ForearmL: [-2.2, 0, 0], ArmR: [-2.9, 0, 0.5], ForearmR: [-2.2, 0, 0], LegL: [0, 0, -0.12], LegR: [-0.5, 0, 0.1], ShinR: [1.0, 0, 0] };
const SIT = { Pelvis: hip(0.2), Torso: [-0.1, 0, 0], LegL: [-1.5, 0, -0.1], ShinL: [0.2, 0, 0], LegR: [-1.5, 0, 0.1], ShinR: [0.2, 0, 0], ArmL: [0.5, 0, -0.3], ForearmL: [-0.3, 0, 0], ArmR: [0.5, 0, 0.3], ForearmR: [-0.3, 0, 0] };
const HANG = { Pelvis: hip(HIP), Torso: [-0.05, 0, 0], Head: [-0.3, 0, 0], ArmL: [-2.95, 0, 0.12], ForearmL: [-0.1, 0, 0], ArmR: [-2.95, 0, -0.12], ForearmR: [-0.1, 0, 0], LegL: [0.1, 0, 0], ShinL: [0.3, 0, 0], LegR: [-0.05, 0, 0], ShinR: [0.2, 0, 0] };
const PUSH = { Pelvis: hip(0.56), Torso: [0.5, 0, 0], Head: [-0.35, 0, 0], ArmL: [-1.35, 0, 0.12], ForearmL: [-0.35, 0, 0], ArmR: [-1.35, 0, -0.12], ForearmR: [-0.35, 0, 0] };
const GRAB = { Pelvis: hip(0.5), Torso: [0.25, 0, 0], ArmL: [-1.4, 0, 0.15], ForearmL: [-0.2, 0, 0], ArmR: [-1.4, 0, -0.15], ForearmR: [-0.2, 0, 0], LegL: [-0.4, 0, 0], ShinL: [0.7, 0, 0], LegR: [0.3, 0, 0], ShinR: [0.5, 0, 0] };
const CLIMB = { Pelvis: hip(HIP), Torso: [0.1, 0, 0], Head: [-0.35, 0, 0], ArmL: [-2.6, 0, -0.25], ForearmL: [-0.6, 0, 0], ArmR: [-2.0, 0, 0.25], ForearmR: [-1.1, 0, 0], LegL: [-0.9, 0, -0.1], ShinL: [1.5, 0, 0], LegR: [-0.2, 0, 0.1], ShinR: [0.5, 0, 0] };
const FALL = { Torso: [-0.15, 0, 0], ArmL: [-2.4, 0, -0.9], ForearmL: [-0.4, 0, 0], ArmR: [-2.2, 0, 0.9], ForearmR: [-0.6, 0, 0], LegL: [-0.5, 0, -0.1], ShinL: [0.9, 0, 0], LegR: [0.2, 0, 0.1], ShinR: [0.6, 0, 0] };
const DIVE = { Pelvis: hip(HIP, [1.45, 0, 0]), Head: [-0.9, 0, 0], ArmL: [-3.0, 0, 0.15], ForearmL: [0, 0, 0], ArmR: [-3.0, 0, -0.15], ForearmR: [0, 0, 0], LegL: [0.15, 0, -0.05], ShinL: [0.3, 0, 0], LegR: [0.1, 0, 0.05], ShinR: [0.2, 0, 0] };
const SLIDE_SIT = { ...SIT, Pelvis: hip(0.22), Torso: [-0.35, 0, 0], ArmL: [-1.2, 0, -0.9], ArmR: [-1.2, 0, 0.9], ForearmL: [0, 0, 0], ForearmR: [0, 0, 0] };

function animations() {
  const clips = [];
  const add = (c) => clips.push(c);

  // ---- idles
  add(clip('Idle', [
    [0, { Pelvis: hip(HIP), Torso: [0.02, 0, 0] }],
    [1.0, { Pelvis: hip(HIP - 0.015), Torso: [0.06, 0, 0], ArmL: [0.05, 0, -0.16], ArmR: [0.05, 0, 0.16] }],
    [2.0, { Pelvis: hip(HIP), Torso: [0.02, 0, 0] }],
  ]));
  add(clip('IdleLook', [
    [0, {}], [0.6, { Head: [0, 0.8, 0], Torso: [0, 0.15, 0] }], [1.4, { Head: [0, 0.8, 0], Torso: [0, 0.15, 0] }],
    [2.0, { Head: [0, -0.8, 0], Torso: [0, -0.15, 0] }], [2.8, { Head: [0, -0.8, 0], Torso: [0, -0.15, 0] }], [3.4, {}],
  ]));
  add(clip('Teeter', [
    [0, { Torso: [-0.3, 0, 0], ArmL: [-1.6, 0, -1.2], ArmR: [-1.0, 0, 1.4] }],
    [0.3, { Torso: [-0.1, 0, 0.25], ArmL: [-3.2, 0, -1.2], ArmR: [-2.6, 0, 1.4], LegR: [-0.4, 0, 0.2] }],
    [0.6, { Torso: [-0.3, 0, 0], ArmL: [-1.6, 0, -1.2], ArmR: [-1.0, 0, 1.4] }],
  ]));

  // ---- locomotion (gaits authored at contact pose; mirrored for the other side)
  const walk = { Pelvis: hip(HIP - 0.02), Torso: [0.08, 0, 0], LegL: [-0.55, 0, 0], ShinL: [0.15, 0, 0], LegR: [0.45, 0, 0], ShinR: [0.45, 0, 0], ArmL: [0.45, 0, -0.1], ForearmL: [-0.3, 0, 0], ArmR: [-0.45, 0, 0.1], ForearmR: [-0.5, 0, 0] };
  const walkPass = { Pelvis: hip(HIP + 0.03), Torso: [0.08, 0, 0], LegL: [0.05, 0, 0], ShinL: [0.2, 0, 0], LegR: [-0.35, 0, 0], ShinR: [0.9, 0, 0] };
  add(gait('Walk', 0.8, walk, walkPass));
  add(gait('Tiptoe', 1.0, { ...walk, Pelvis: hip(HIP + 0.02), Torso: [0.15, 0, 0], LegL: [-0.3, 0, 0], LegR: [0.25, 0, 0], ArmL: [-0.6, 0, -0.5], ForearmL: [-1.4, 0, 0], ArmR: [-0.6, 0, 0.5], ForearmR: [-1.4, 0, 0] }, walkPass));
  const run = { Pelvis: hip(HIP - 0.04), Torso: [0.3, 0, 0], Head: [-0.2, 0, 0], LegL: [-1.05, 0, 0], ShinL: [0.5, 0, 0], LegR: [0.7, 0, 0], ShinR: [1.3, 0, 0], ArmL: [0.9, 0, -0.15], ForearmL: [-1.5, 0, 0], ArmR: [-0.95, 0, 0.15], ForearmR: [-1.6, 0, 0] };
  const runPass = { Pelvis: hip(HIP + 0.06), Torso: [0.3, 0, 0], Head: [-0.2, 0, 0], LegL: [-0.2, 0, 0], ShinL: [0.4, 0, 0], LegR: [-0.6, 0, 0], ShinR: [2.0, 0, 0], ArmL: [0.1, 0, -0.15], ForearmL: [-1.5, 0, 0], ArmR: [-0.1, 0, 0.15], ForearmR: [-1.5, 0, 0] };
  add(gait('Run', 0.46, run, runPass));
  add(clip('Skid', [[0, { Pelvis: hip(0.5), Torso: [-0.45, 0, 0], LegL: [-0.9, 0, 0], ShinL: [0.3, 0, 0], LegR: [-0.2, 0, 0], ShinR: [0.9, 0, 0], ArmL: [-1.2, 0, -1.2], ArmR: [-1.2, 0, 1.2] }], [0.3, { Pelvis: hip(0.48), Torso: [-0.5, 0, 0], LegL: [-1.0, 0, 0], ShinL: [0.3, 0, 0], LegR: [-0.3, 0, 0], ShinR: [1.0, 0, 0], ArmL: [-1.3, 0, -1.3], ArmR: [-1.3, 0, 1.3] }]]));
  add(clip('StepUp', [[0, walk], [0.12, { ...walkPass, LegL: [-1.1, 0, 0], ShinL: [1.4, 0, 0] }], [0.25, mirror(walk)]]));
  add(clip('StepDown', [[0, walk], [0.12, { ...walkPass, Pelvis: hip(HIP - 0.08), LegR: [-0.1, 0, 0], ShinR: [1.1, 0, 0] }], [0.25, mirror(walk)]]));

  // ---- crouch family
  add(clip('Crouch', [[0, CROUCH], [0.8, { ...CROUCH, Pelvis: hip(0.35), Torso: [0.5, 0, 0] }], [1.6, CROUCH]]));
  add(gait('CrouchWalk', 0.9, { ...CROUCH, LegL: [-1.5, 0, -0.05], ShinL: [1.9, 0, 0], LegR: [-0.9, 0, 0.05], ShinR: [2.1, 0, 0] }));
  add(clip('CrouchSlide', [[0, { ...CROUCH, Torso: [0.15, 0, 0], LegL: [-1.6, 0, 0], ShinL: [1.4, 0, 0] }], [0.4, { ...CROUCH, Torso: [0.15, 0, 0], LegL: [-1.6, 0, 0], ShinL: [1.4, 0, 0] }]]));

  // ---- prone / lying
  add(clip('ProneDown', [[0, {}], [0.2, CROUCH], [0.45, { ...PRONE, Pelvis: hip(0.3, [1.1, 0, 0]) }], [0.6, PRONE]]));
  add(clip('Prone', [[0, PRONE], [1.2, { ...PRONE, Head: [-0.45, 0, 0], Pelvis: hip(PRONE_Y + 0.01, [PI / 2, 0, 0]) }], [2.4, PRONE]]));
  const crawl = { ...PRONE, ArmL: [-2.9, 0, -0.2], ForearmL: [-0.2, 0, 0], ArmR: [-2.0, 0, 0.6], ForearmR: [-1.6, 0, 0], LegL: [-0.5, 0, -0.5], ShinL: [1.3, 0, 0], LegR: [0, 0, 0.1], ShinR: [0.1, 0, 0], Pelvis: hip(PRONE_Y, [PI / 2, 0.08, 0]) };
  add(gait('Crawl', 1.0, crawl));
  add(clip('GetUpFront', [[0, PRONE], [0.25, { ...PRONE, Pelvis: hip(0.3, [1.2, 0, 0]), ArmL: [-1.4, 0, -0.2], ArmR: [-1.4, 0, 0.2], ForearmL: [0, 0, 0], ForearmR: [0, 0, 0] }], [0.5, CROUCH], [0.7, {}]]));
  add(clip('LieDown', [[0, {}], [0.3, CROUCH], [0.6, SIT], [1.0, ON_BACK]]));
  add(clip('LieIdle', [[0, ON_BACK], [1.4, { ...ON_BACK, Pelvis: hip(PRONE_Y + 0.012, [-PI / 2, 0, 0]), LegR: [-0.6, 0, 0.1] }], [2.8, ON_BACK]]));
  add(clip('Sleep', [[0, { ...ON_BACK, Head: [0.35, 0.5, 0] }], [1.8, { ...ON_BACK, Head: [0.4, 0.55, 0], Pelvis: hip(PRONE_Y + 0.02, [-PI / 2, 0, 0]) }], [3.6, { ...ON_BACK, Head: [0.35, 0.5, 0] }]]));
  add(clip('GetUp', [[0, ON_BACK], [0.3, SIT], [0.55, CROUCH], [0.8, {}]]));
  add(clip('Sit', [[0, SIT], [1.5, { ...SIT, Torso: [-0.05, 0, 0], Head: [0.1, 0.2, 0] }], [3.0, SIT]]));

  // ---- airborne
  add(clip('JumpUp', [[0, CROUCH], [0.12, { Pelvis: hip(HIP), ArmL: [-3.0, 0, 0.2], ArmR: [-3.0, 0, -0.2], ForearmL: [0, 0, 0], ForearmR: [0, 0, 0] }], [0.5, { ArmL: [-2.8, 0, -0.3], ArmR: [-2.8, 0, 0.3], LegL: [-0.5, 0, 0], ShinL: [1.0, 0, 0], LegR: [-0.4, 0, 0], ShinR: [0.9, 0, 0] }]]));
  const jump = { Torso: [0.1, 0, 0], ArmR: [-2.9, 0, 0.1], ForearmR: [0, 0, 0], ArmL: [0.6, 0, -0.5], ForearmL: [-0.4, 0, 0], LegL: [-0.9, 0, 0], ShinL: [1.3, 0, 0], LegR: [0.4, 0, 0], ShinR: [0.5, 0, 0] };
  add(clip('Jump', [[0, CROUCH], [0.1, jump], [0.5, { ...jump, LegL: [-1.0, 0, 0], ShinL: [1.6, 0, 0] }]]));
  add(clip('DoubleJump', [[0, jump], [0.12, { ...mirror(jump), ArmL: [-2.6, 0, -0.9], ArmR: [-2.6, 0, 0.9] }], [0.6, { ...mirror(jump), ArmL: [-2.8, 0, -0.7], ArmR: [-2.8, 0, 0.7] }]]));
  add(clip('TripleJump', [[0, jump], ...flipKeys(0.12, 0.72, 0, 1, TUCK), [0.9, { ...jump, ArmL: [-1.6, 0, -1.4], ArmR: [-1.6, 0, 1.4] }]]));
  add(clip('Backflip', [[0, CROUCH], ...flipKeys(0.1, 0.8, 0, -1, TUCK), [0.95, { ArmL: [-2.2, 0, -0.9], ArmR: [-2.2, 0, 0.9] }]]));
  add(clip('SideFlip', [[0, CROUCH], ...flipKeys(0.1, 0.7, 2, -1, { ...TUCK, Torso: [0.2, 0, 0] }), [0.85, { ArmL: [-1.6, 0, -1.3], ArmR: [-1.6, 0, 1.3] }]]));
  const longJump = { Pelvis: hip(HIP, [1.05, 0, 0]), Head: [-0.8, 0, 0], ArmL: [-2.9, 0, 0.2], ForearmL: [0, 0, 0], ArmR: [-2.9, 0, -0.2], ForearmR: [0, 0, 0], LegL: [0.3, 0, -0.1], ShinL: [0.4, 0, 0], LegR: [0.15, 0, 0.1], ShinR: [0.9, 0, 0] };
  add(clip('LongJump', [[0, CROUCH], [0.15, longJump], [0.7, { ...longJump, Pelvis: hip(HIP, [0.8, 0, 0]) }]]));
  add(clip('WallKick', [[0, { Torso: [-0.2, 0, 0], ArmL: [-1.6, 0, -1.4], ArmR: [-1.6, 0, 1.4], LegL: [-0.8, 0, -0.5], LegR: [0.6, 0, 0.5] }], [0.5, jump]]));
  add(clip('WallSlide', [[0, { Torso: [-0.3, 0, 0], ArmL: [-2.3, 0, -0.4], ArmR: [-1.2, 0, 0.9], LegL: [-0.6, 0, 0], ShinL: [1.1, 0, 0] }], [0.6, { Torso: [-0.32, 0, 0], ArmL: [-2.4, 0, -0.4], ArmR: [-1.2, 0, 0.9], LegL: [-0.65, 0, 0], ShinL: [1.1, 0, 0] }]]));
  add(clip('Fall', [[0, FALL], [0.35, mirror(FALL)], [0.7, FALL]]));
  add(clip('Dive', [[0, jump], [0.15, DIVE], [0.5, DIVE]]));
  add(clip('BellySlide', [[0, { ...DIVE, Pelvis: hip(0.22, [PI / 2, 0, 0]) }], [0.3, { ...DIVE, Pelvis: hip(0.22, [PI / 2, 0.06, 0]), LegL: [0.25, 0, -0.1] }], [0.6, { ...DIVE, Pelvis: hip(0.22, [PI / 2, 0, 0]) }]]));
  add(clip('GroundPoundSpin', [[0, jump], ...flipKeys(0.05, 0.3, 0, 1, TUCK)]));
  const cannon = { Pelvis: hip(0.9), Torso: [0.1, 0, 0], LegL: [-1.9, 0, -0.1], ShinL: [2.3, 0, 0], LegR: [-1.9, 0, 0.1], ShinR: [2.3, 0, 0], ArmL: [0.3, 0, -0.5], ForearmL: [-0.4, 0, 0], ArmR: [0.3, 0, 0.5], ForearmR: [-0.4, 0, 0] };
  add(clip('GroundPound', [[0, cannon], [0.3, { ...cannon, Pelvis: hip(0.85) }]]));
  add(clip('GroundPoundLand', [[0, { ...CROUCH, Pelvis: hip(0.3) }], [0.35, CROUCH], [0.5, {}]]));
  add(clip('Land', [[0, { ...CROUCH, Pelvis: hip(0.45) }], [0.18, {}]]));
  add(clip('HardLand', [[0, CROUCH], [0.2, { ...PRONE, Head: [-0.2, 0, 0], ArmL: [-2.2, 0, -1.2], ArmR: [-2.2, 0, 1.2] }], [0.7, PRONE], [0.95, { ...PRONE, Pelvis: hip(0.3, [1.2, 0, 0]) }], [1.15, CROUCH], [1.3, {}]]));
  add(clip('Slide', [[0, SLIDE_SIT], [0.25, { ...SLIDE_SIT, ArmL: [-1.4, 0, -1.0] }], [0.5, SLIDE_SIT]]));

  // ---- ledges & climbing
  add(clip('Hang', [[0, HANG], [0.9, { ...HANG, LegL: [0.2, 0, -0.05], LegR: [-0.15, 0, 0.05] }], [1.8, HANG]]));
  const shimmyA = { ...HANG, ArmL: [-2.95, 0, 0.45], ArmR: [-2.95, 0, 0.2], LegL: [0.1, 0, -0.3], LegR: [0, 0, -0.15] };
  const shimmyB = { ...HANG, ArmL: [-2.95, 0, -0.2], ArmR: [-2.95, 0, -0.45], LegL: [0.1, 0, 0.15], LegR: [0, 0, 0.3] };
  add(clip('ShimmyLeft', [[0, shimmyB], [0.3, shimmyA], [0.6, shimmyB]]));
  add(clip('ShimmyRight', [[0, shimmyA], [0.3, shimmyB], [0.6, shimmyA]]));
  add(clip('PullUp', [
    [0, HANG],
    [0.25, { ...HANG, ArmL: [-2.2, 0, 0.1], ForearmL: [-1.4, 0, 0], ArmR: [-2.2, 0, -0.1], ForearmR: [-1.4, 0, 0], LegL: [-0.6, 0, 0], ShinL: [1.2, 0, 0] }],
    [0.5, { Pelvis: hip(0.45), Torso: [0.6, 0, 0], ArmL: [-0.9, 0, -0.1], ForearmL: [-0.8, 0, 0], ArmR: [-0.9, 0, 0.1], ForearmR: [-0.8, 0, 0], LegL: [-1.6, 0, 0], ShinL: [2.1, 0, 0], LegR: [-0.3, 0, 0], ShinR: [1.4, 0, 0] }],
    [0.75, CROUCH],
    [0.9, {}],
  ]));
  add(clip('ClimbIdle', [[0, CLIMB], [0.8, { ...CLIMB, Torso: [0.12, 0, 0] }], [1.6, CLIMB]]));
  add(clip('Climb', [[0, CLIMB], [0.35, mirror(CLIMB)], [0.7, CLIMB]]));

  // ---- push / pull / grab
  add(clip('PushIdle', [[0, PUSH], [0.8, { ...PUSH, Pelvis: hip(0.55) }], [1.6, PUSH]]));
  add(gait('Push', 1.0, { ...PUSH, LegL: [-0.35, 0, 0], ShinL: [0.5, 0, 0], LegR: [0.75, 0, 0], ShinR: [0.35, 0, 0] }));
  add(clip('Grab', [[0, GRAB], [0.8, { ...GRAB, Pelvis: hip(0.49) }], [1.6, GRAB]]));
  add(gait('Pull', 1.0, { ...GRAB, Torso: [-0.25, 0, 0], LegL: [0.45, 0, 0], ShinL: [0.6, 0, 0], LegR: [-0.5, 0, 0], ShinR: [0.3, 0, 0] }));

  // ---- attacks & emotes
  const guard = { Torso: [0.1, -0.2, 0], ArmL: [-1.2, 0, -0.1], ForearmL: [-1.4, 0, 0], ArmR: [-1.2, 0, 0.1], ForearmR: [-1.4, 0, 0], LegL: [-0.4, 0, 0], ShinL: [0.3, 0, 0], LegR: [0.3, 0, 0], ShinR: [0.3, 0, 0] };
  add(clip('Punch', [[0, guard], [0.08, { ...guard, Torso: [0.15, 0.35, 0], ArmR: [-1.6, 0, 0], ForearmR: [0, 0, 0] }], [0.25, guard]]));
  add(clip('Punch2', [[0, guard], [0.08, { ...guard, Torso: [0.15, -0.45, 0], ArmL: [-1.6, 0, 0], ForearmL: [0, 0, 0] }], [0.25, guard]]));
  add(clip('Kick', [[0, guard], [0.12, { ...guard, Torso: [-0.3, 0, 0], LegR: [-1.7, 0, 0], ShinR: [0, 0, 0], LegL: [0.1, 0, 0] }], [0.4, {}]]));
  add(clip('JumpKick', [[0, jump], [0.1, { Torso: [-0.3, 0, 0], LegR: [-1.5, 0, 0], ShinR: [0, 0, 0], LegL: [0.3, 0, 0], ShinL: [1.4, 0, 0], ArmL: [-1.0, 0, -1.2], ArmR: [-1.0, 0, 1.2] }], [0.45, { Torso: [-0.3, 0, 0], LegR: [-1.5, 0, 0], ShinR: [0, 0, 0], LegL: [0.3, 0, 0], ShinL: [1.4, 0, 0], ArmL: [-1.0, 0, -1.2], ArmR: [-1.0, 0, 1.2] }]]));
  add(clip('SweepKick', [[0, CROUCH], ...flipKeys(0.05, 0.45, 1, 1, { ...CROUCH, LegR: [-0.2, 0, 1.4], ShinR: [0, 0, 0] }, 0.36), [0.55, CROUCH]]));
  add(clip('Wave', [[0, {}], [0.2, { ArmR: [0, 0, 2.7], ForearmR: [0, 0, 0.4] }], [0.45, { ArmR: [0, 0, 2.7], ForearmR: [0, 0, -0.4] }], [0.7, { ArmR: [0, 0, 2.7], ForearmR: [0, 0, 0.4] }], [0.95, { ArmR: [0, 0, 2.7], ForearmR: [0, 0, -0.4] }], [1.2, {}]]));
  add(clip('Victory', [[0, {}], ...flipKeys(0.1, 0.7, 1, 1, { ArmR: [-3.0, 0, 0], ForearmR: [0, 0, 0] }), [1.2, { ArmR: [-3.0, 0, 0], ForearmR: [0, 0, 0], ArmL: [0.3, 0, -0.6], Head: [-0.2, 0, 0] }]]));
  add(clip('Hurt', [[0, {}], [0.1, { Torso: [-0.5, 0, 0], Head: [-0.4, 0, 0], ArmL: [-1.4, 0, -1.2], ArmR: [-1.4, 0, 1.2] }], [0.5, {}]]));

  return clips;
}

export function hero() {
  return { scene: buildRig(), animations: animations() };
}
