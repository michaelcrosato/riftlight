// Generates the demo's local GLB assets (public/assets/*.glb) with three's GLTFExporter.
// Deterministic: re-running produces byte-identical files. Run with `npm run assets`.
//
// Models are chunky low-poly primitives colored from the engine palette; the engine
// re-shades every loaded material with its 3-band toon material, so only base colors matter.
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { hero } from './assets/hero.mjs';

// GLTFExporter uses FileReader for binary output; Node has Blob but not FileReader.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

// Sweetie 16 (keep in sync with src/engine/palette.ts)
const C = {
  ink: 0x1a1c2c, plum: 0x5d275d, red: 0xb13e53, orange: 0xef7d57, sand: 0xffcd75,
  lime: 0xa7f070, green: 0x38b764, teal: 0x257179, navy: 0x29366f, blue: 0x3b5dc9,
  sky: 0x41a6f6, cyan: 0x73eff7, white: 0xf4f4f4, mist: 0x94b0c2, slate: 0x566c86, night: 0x333c57,
};

const mat = (color, name) => new THREE.MeshStandardMaterial({ color, name, roughness: 1, metalness: 0 });

const q = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
const rotTrack = (node, times, eulers) =>
  new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, eulers.flatMap((e) => q(...e)));
const posTrack = (node, times, positions) =>
  new THREE.VectorKeyframeTrack(`${node}.position`, times, positions.flat());

function coin() {
  const root = new THREE.Object3D();
  root.name = 'Coin';
  const spin = new THREE.Object3D();
  spin.name = 'Spinner';
  const faceGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 10).rotateX(Math.PI / 2);
  const face = new THREE.Mesh(faceGeo, mat(C.sand, 'Coin_Face'));
  face.name = 'Coin_Face';
  const markGeo = new THREE.BoxGeometry(0.08, 0.3, 0.1);
  const mark = new THREE.Mesh(markGeo, mat(C.orange, 'Coin_Mark'));
  mark.name = 'Coin_Mark';
  spin.add(face, mark);
  spin.position.y = 0.45;
  root.add(spin);
  const clip = new THREE.AnimationClip('Spin', 1.6, [
    rotTrack('Spinner', [0, 0.4, 0.8, 1.2, 1.6], [[0, 0, 0], [0, Math.PI / 2, 0], [0, Math.PI, 0], [0, 1.5 * Math.PI, 0], [0, 2 * Math.PI, 0]]),
    posTrack('Spinner', [0, 0.8, 1.6], [[0, 0.45, 0], [0, 0.55, 0], [0, 0.45, 0]]),
  ]);
  return { scene: root, animations: [clip] };
}

function flat(geo) {
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

function tree() {
  const root = new THREE.Object3D();
  root.name = 'Tree';
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.9, 6).translate(0, 0.45, 0), mat(C.plum, 'Trunk'));
  trunk.name = 'Trunk';
  const low = new THREE.Mesh(flat(new THREE.ConeGeometry(0.85, 1.1, 7).translate(0, 1.25, 0)), mat(C.teal, 'Leaves_Low'));
  low.name = 'Leaves_Low';
  const high = new THREE.Mesh(flat(new THREE.ConeGeometry(0.6, 0.9, 7).translate(0, 1.85, 0)), mat(C.green, 'Leaves_High'));
  high.name = 'Leaves_High';
  root.add(trunk, low, high);
  return { scene: root, animations: [] };
}

const exporter = new GLTFExporter();
await mkdir(new URL('../public/assets/', import.meta.url), { recursive: true });
for (const [name, build] of Object.entries({ hero, coin, tree })) {
  const { scene, animations } = build();
  const glb = await exporter.parseAsync(scene, { binary: true, animations });
  await writeFile(new URL(`../public/assets/${name}.glb`, import.meta.url), Buffer.from(glb));
  console.log(`public/assets/${name}.glb  ${glb.byteLength} bytes  clips: ${animations.map((a) => a.name).join(', ') || '-'}`);
}
