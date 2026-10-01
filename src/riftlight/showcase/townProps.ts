/**
 * The showcase's places in Emberfall, built with the town's own kit (town/kit.ts) and added
 * through `Town.extend`: an arcade booth with two cabinets (one plays Rift Runner) on the
 * south-west of the road, and the Hall of Beasts (an archway with a lectern and the bestiary
 * book) on the south-east. Both turn toward the south road, three-quarters to the camera, so
 * the hero walks up to them from the plaza. Their glow comes from the engine's light pool, only while the town is shown.
 */
import { Group, Mesh, type Object3D, BoxGeometry, Vector3 } from 'three/webgpu';
import { type LightHandle, PALETTE } from '../../engine';
import { glowMaterial } from '../levels/themes/props';
import { Kit } from '../town/kit';
import { type Interactable, iso, type TownExtension } from '../town/Town';
import type { GameContext } from '../../engine';

/** Screen-space spots (town layout units, see `iso`) and the yaw that faces the camera. */
export const SHOWCASE_LAYOUT = {
  arcade: [-6.4, -8.4] as const,
  bestiary: [6.4, -8.4] as const,
  /** Yaws (local +Z = the front): both turn toward the south road, three-quarters to the camera. */
  arcadeYaw: 90,
  bestiaryYaw: 0,
};

export interface ShowcaseProps {
  readonly extension: TownExtension;
  /** World points the camera swoops into (the playable cabinet's screen, the hall's doorway). */
  readonly arcadeScreen: Vector3;
  readonly bestiaryDoor: Vector3;
}

export function buildShowcaseProps(ctx: GameContext): ShowcaseProps {
  const kit = new Kit();
  const glow: Object3D[] = [];
  /** A glowing (unlit) box in the current kit frame. */
  const glowBox = (size: [number, number, number], color: number, at: [number, number, number], rotX = 0) => {
    const m = new Mesh(new BoxGeometry(...size), glowMaterial(color));
    const p = kit.world(at);
    m.position.copy(p);
    m.rotation.set(0, (kit.worldYaw() * Math.PI) / 180, 0);
    m.rotateX((rotX * Math.PI) / 180);
    m.castShadow = false;
    glow.push(m);
    return m;
  };

  // ---------------------------------------------------------------- the arcade booth
  const [ax, az] = iso(...SHOWCASE_LAYOUT.arcade);
  let arcadeScreen = new Vector3();
  let arcadeFront = new Vector3();
  kit.frame(ax, az, SHOWCASE_LAYOUT.arcadeYaw, () => {
    // a plank floor, a back wall and a striped canopy over the cabinets only (never between
    // the iso camera and a screen)
    kit.box([3.6, 0.1, 2.4], 'plum', [0, 0.05, -0.2], { cast: false });
    kit.box([3.5, 2.6, 0.16], 'orange', [0, 1.3, -1.36], { top: 'plum' });
    for (const px of [-1.7, 1.7]) for (const pz of [-1.36, -0.1]) kit.box([0.14, 2.75, 0.14], 'night', [px, 1.37, pz]);
    for (let i = 0; i < 6; i++) kit.box([0.62, 0.08, 1.6], i % 2 ? 'white' : 'blue', [-1.55 + i * 0.62, 2.8, -0.7], { rot: [-12, 0, 0] });
    for (let i = 0; i < 6; i++) kit.box([0.62, 0.24, 0.06], i % 2 ? 'white' : 'blue', [-1.55 + i * 0.62, 2.66, 0.06]);
    // the sign on the back wall: RIFT RUNNER in lamps (a row of bulbs)
    for (let i = 0; i < 9; i++) glowBox([0.12, 0.12, 0.05], i % 2 ? PALETTE.sand : PALETTE.red, [-1.2 + i * 0.3, 2.35, -1.26]);
    // two cabinets: the left one plays (navy and red), the right one is "out of order"
    const cabinet = (x: number, body: 'navy' | 'teal', trim: 'red' | 'lime', screen: number) => {
      kit.box([1.0, 1.85, 0.9], body, [x, 0.95, -0.6], { top: 'ink' });
      for (const sx of [-0.52, 0.52]) kit.box([0.06, 1.9, 0.96], trim, [x + sx, 0.97, -0.6]);
      kit.box([0.96, 0.36, 0.5], trim, [x, 2.06, -0.5]); // the marquee
      glowBox([0.8, 0.18, 0.04], PALETTE.sand, [x, 2.06, -0.24]);
      kit.box([0.9, 0.62, 0.1], 'ink', [x, 1.42, -0.12], { rot: [-10, 0, 0] }); // bezel
      glowBox([0.72, 0.5, 0.04], screen, [x, 1.43, -0.06], -10);
      kit.box([0.98, 0.14, 0.42], body, [x, 0.98, 0.02], { rot: [14, 0, 0] }); // control panel
      kit.cyl(0.03, 0.03, 0.16, 5, 'ink', [x - 0.22, 1.12, 0.04]);
      kit.cyl(0.06, 0.06, 0.07, 6, 'red', [x - 0.22, 1.21, 0.04]);
      for (const bx of [0.06, 0.2, 0.34]) kit.cyl(0.045, 0.045, 0.05, 6, bx === 0.2 ? 'sand' : 'red', [x + bx, 1.07, 0.06]);
      kit.box([0.16, 0.22, 0.04], 'slate', [x, 0.55, -0.14]); // coin door
      kit.blockBox(x, -0.6, 1.0, 0.95);
    };
    cabinet(-0.62, 'navy', 'red', PALETTE.cyan);
    cabinet(0.62, 'teal', 'lime', PALETTE.slate);
    for (const px of [-1.7, 1.7]) kit.blockCircle(px, -0.1, 0.14);
    kit.blockBox(0, -1.36, 3.6, 0.3);
    arcadeScreen = kit.world([-0.62, 1.43, -0.06]);
    arcadeFront = kit.world([-0.62, 0, 0.95]);
  });

  // ---------------------------------------------------------------- the Hall of Beasts
  const [bx, bz] = iso(...SHOWCASE_LAYOUT.bestiary);
  let bestiaryDoor = new Vector3();
  let lectern = new Vector3();
  const braziers: Vector3[] = [];
  kit.frame(bx, bz, SHOWCASE_LAYOUT.bestiaryYaw, () => {
    kit.box([4.4, 0.16, 2.6], 'slate', [0, 0.08, -0.4], { cast: false });
    kit.box([3.8, 0.12, 2.0], 'night', [0, 0.18, -0.6], { cast: false });
    // the archway: two pillars and a lintel, a dark doorway between
    for (const px of [-1.35, 1.35]) {
      kit.box([0.6, 3.1, 0.6], 'mist', [px, 1.55, -1.2], { top: 'slate' });
      kit.box([0.76, 0.24, 0.76], 'slate', [px, 0.3, -1.2]);
      kit.box([0.76, 0.2, 0.76], 'slate', [px, 3.05, -1.2]);
      kit.blockBox(px, -1.2, 0.7, 0.7);
    }
    kit.box([3.5, 0.5, 0.8], 'mist', [0, 3.35, -1.2], { top: 'slate' });
    kit.box([2.1, 2.9, 0.1], 'ink', [0, 1.6, -1.4]);
    kit.blockBox(0, -1.4, 2.2, 0.3);
    // the emblem: a horned skull over the arch
    kit.box([0.62, 0.5, 0.36], 'white', [0, 3.85, -1.05]);
    kit.box([0.44, 0.18, 0.3], 'white', [0, 3.52, -1.0]);
    for (const ex of [-0.14, 0.14]) glowBox([0.12, 0.1, 0.04], PALETTE.red, [ex, 3.88, -0.86]);
    for (const hx of [-1, 1]) kit.cone(0.1, 0.55, 5, 'sand', [hx * 0.42, 4.12, -1.05], { rot: [0, 0, -hx * 40] });
    // braziers on the corners
    for (const px of [-1.95, 1.95]) {
      kit.cyl(0.18, 0.24, 0.9, 6, 'slate', [px, 0.45, -0.1]);
      kit.cyl(0.32, 0.22, 0.22, 6, 'night', [px, 1.0, -0.1]);
      glowBox([0.3, 0.16, 0.3], PALETTE.orange, [px, 1.15, -0.1]);
      braziers.push(kit.world([px, 1.5, -0.1]));
      kit.blockCircle(px, -0.1, 0.3);
    }
    // the lectern with the open book
    kit.box([0.5, 0.95, 0.4], 'plum', [0, 0.5, 0.65]);
    kit.box([0.7, 0.08, 0.5], 'orange', [0, 1.02, 0.65], { rot: [-20, 0, 0] });
    kit.box([0.3, 0.04, 0.42], 'white', [-0.16, 1.08, 0.65], { rot: [-20, 0, 6] });
    kit.box([0.3, 0.04, 0.42], 'white', [0.16, 1.08, 0.65], { rot: [-20, 0, -6] });
    kit.box([0.04, 0.05, 0.44], 'red', [0, 1.09, 0.66], { rot: [-20, 0, 0] });
    kit.blockCircle(0, 0.65, 0.35);
    bestiaryDoor = kit.world([0, 1.6, -1.3]);
    lectern = kit.world([0, 0, 1.45]);
  });

  const root = new Group();
  root.name = 'showcase-props';
  root.add(kit.build(), ...glow);

  const interactables: Interactable[] = [
    { id: 'arcade', name: 'Rift Runner', verb: 'PLAY', position: arcadeFront, radius: 1.6, action: 'showcase' },
    { id: 'bestiary', name: 'Hall of Beasts', verb: 'ENTER', position: lectern, radius: 1.7, action: 'showcase' },
  ];

  // lights: the cabinet screen and the braziers, borrowed from the engine's pool while the town shows
  let lights: LightHandle[] = [];
  let t = 0;
  const extension: TownExtension = {
    root,
    blockers: kit.blockers,
    interactables,
    activate() {
      if (lights.length) return;
      lights = [
        ctx.lights.request({ position: arcadeScreen.clone().add(new Vector3(0.5, 0, 0.5)), color: PALETTE.cyan, intensity: 5, radius: 4.5, flicker: 'pulse' }),
        ...braziers.map((b) => ctx.lights.request({ position: b, color: PALETTE.orange, intensity: 7, radius: 5, flicker: 'brazier' })),
      ];
    },
    deactivate() {
      for (const l of lights) l.release();
      lights = [];
    },
    update(dt, night) {
      t += dt;
      // the cabinet's attract mode: its light cycles through the screen's colours
      const screen = lights[0];
      if (screen) screen.update({ color: [PALETTE.cyan, PALETTE.lime, PALETTE.sand, PALETTE.red][Math.floor(t * 1.5) % 4]!, intensity: 4 + 3 * night });
      for (const l of lights.slice(1)) l.update({ intensity: 5 + 6 * night });
      if (Math.floor(t * 4) !== Math.floor((t - dt) * 4)) for (const b of braziers) ctx.particles.burst('rl.ember', b);
    },
  };
  return { extension, arcadeScreen, bestiaryDoor };
}
