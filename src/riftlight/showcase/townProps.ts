/**
 * The showcase's places in Emberfall, built with the town's own kit (town/kit.ts) and added
 * through `Town.extend`: an arcade booth with two cabinets (one plays Rift Runner) on the
 * south-west of the road, the Hall of Beasts (an archway with a lectern and the bestiary
 * book) on the south-east, and the Engine Workshop east of the plaza by the road to the bridge (a
 * rift ring into Engine World, an easel of models and textures into the Asset Gallery). They turn
 * three-quarters to the camera, so the hero walks up to them from the plaza. Their glow comes from the engine's light pool, only while the town is shown.
 */
import { Group, Mesh, type Object3D, BoxGeometry, CylinderGeometry, Vector3 } from 'three/webgpu';
import { type LightHandle, PALETTE } from '../../engine';
import { t } from '../lang';
import { glowMaterial } from '../levels/themes/props';
import { Kit } from '../town/kit';
import { type Interactable, iso, type TownExtension } from '../town/Town';
import { TOWN_LAYOUT } from '../town/layout';
import type { GameContext } from '../../engine';

/** Screen-space spots (town layout units, see `iso`) and the yaw that faces the camera. */
export const SHOWCASE_LAYOUT = {
  arcade: [-6.4, -8.4] as const,
  bestiary: [6.4, -8.4] as const,
  /** Yaws (local +Z = the front): both turn toward the south road, three-quarters to the camera. */
  arcadeYaw: 90,
  bestiaryYaw: 0,
  /** The Engine Workshop: east of the plaza, below the road to the bridge, facing the camera. */
  workshop: TOWN_LAYOUT.workshop,
  workshopYaw: 0,
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

  // ---------------------------------------------------------------- the Engine Workshop
  // a standing rift ring (Engine World) and an easel of tiles beside a turning crystal (the Asset
  // Gallery): the engine's own demos, a walk from the plaza
  const [wx, wz] = iso(...SHOWCASE_LAYOUT.workshop);
  const RING = { x: -0.8, y: 1.5, z: -0.45, r: 1.05 };
  let ringCentre = new Vector3();
  let easel = new Vector3();
  let worldFront = new Vector3();
  let galleryFront = new Vector3();
  const spinner = new Group();
  let crystal: Mesh | null = null;
  let spinYaw = 0;
  kit.frame(wx, wz, SHOWCASE_LAYOUT.workshopYaw, () => {
    kit.box([4.2, 0.14, 2.2], 'slate', [0.2, 0.07, -0.2], { cast: false });
    kit.box([3.8, 0.1, 1.8], 'night', [0.2, 0.16, -0.25], { cast: false });
    // the ring: a dark disc in a frame of glowing segments, on two stone feet
    const disc = new Mesh(new CylinderGeometry(RING.r - 0.08, RING.r - 0.08, 0.06, 20), glowMaterial(PALETTE.navy));
    disc.position.copy(kit.world([RING.x, RING.y, RING.z - 0.04]));
    disc.rotation.set(0, (kit.worldYaw() * Math.PI) / 180, 0);
    disc.rotateX(Math.PI / 2);
    glow.push(disc);
    const SEGS = 16;
    for (let i = 0; i < SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const m = new Mesh(new BoxGeometry(0.44, 0.16, 0.2), glowMaterial(i % 2 ? PALETTE.cyan : PALETTE.sky));
      m.position.copy(kit.world([RING.x + Math.cos(a) * RING.r, RING.y + Math.sin(a) * RING.r, RING.z]));
      m.rotation.set(0, (kit.worldYaw() * Math.PI) / 180, 0);
      m.rotateZ(a + Math.PI / 2);
      m.castShadow = false;
      glow.push(m);
    }
    for (const fx of [-0.75, 0.75]) kit.box([0.5, 0.5, 0.6], 'mist', [RING.x + fx, 0.4, RING.z], { top: 'slate' });
    kit.box([1.9, 0.18, 0.7], 'slate', [RING.x, 0.24, RING.z]);
    // the swirl inside: three spokes turning (update)
    for (let i = 0; i < 3; i++) {
      const spoke = new Mesh(new BoxGeometry(1.6, 0.07, 0.03), glowMaterial([PALETTE.cyan, PALETTE.lime, PALETTE.white][i]!));
      spoke.rotation.z = (i * Math.PI) / 3;
      spinner.add(spoke);
    }
    ringCentre = kit.world([RING.x, RING.y, RING.z + 0.02]);
    spinner.position.copy(ringCentre);
    spinYaw = (kit.worldYaw() * Math.PI) / 180;
    kit.blockBox(RING.x, RING.z, 2.4, 0.75);
    // the easel: a board of tiles (textures), and a crystal turning on a plinth (models)
    for (const lx of [-0.5, 0.5]) kit.box([0.08, 2.0, 0.08], 'orange', [1.3 + lx, 1.0, -0.62], { rot: [-8, 0, lx * -10] });
    kit.box([0.08, 1.9, 0.08], 'orange', [1.3, 0.95, -0.95], { rot: [14, 0, 0] });
    kit.box([1.3, 1.0, 0.08], 'ink', [1.3, 1.55, -0.55], { rot: [-8, 0, 0] });
    kit.box([1.4, 0.08, 0.2], 'orange', [1.3, 1.0, -0.47]);
    const tiles = [PALETTE.red, PALETTE.sand, PALETTE.lime, PALETTE.sky, PALETTE.plum, PALETTE.orange, PALETTE.green, PALETTE.cyan, PALETTE.white];
    tiles.forEach((c, i) => glowBox([0.32, 0.24, 0.03], c, [1.3 + ((i % 3) - 1) * 0.38, 1.82 - Math.floor(i / 3) * 0.28, -0.5], -8));
    kit.cyl(0.26, 0.32, 0.8, 8, 'mist', [2.3, 0.4, -0.1], { top: 'slate' });
    crystal = kit.box([0.34, 0.34, 0.34], 'cyan', [2.3, 1.1, -0.1], { rot: [45, 0, 35], dynamic: true });
    kit.blockBox(1.3, -0.65, 1.5, 0.5);
    kit.blockCircle(2.3, -0.1, 0.36);
    easel = kit.world([1.3, 1.6, -0.3]);
    worldFront = kit.world([RING.x, 0, 0.75]);
    galleryFront = kit.world([1.6, 0, 0.75]);
  });
  spinner.rotation.set(0, spinYaw, 0);

  const root = new Group();
  root.name = 'showcase-props';
  root.add(kit.build(), ...glow, spinner);

  const interactables: Interactable[] = [
    {
      id: 'arcade',
      get name() {
        return t('showcase.arcade.name');
      },
      get verb() {
        return t('showcase.verb.play');
      },
      get prompt() {
        return t('showcase.prompt.arcade', { game: t('showcase.arcade.name') });
      },
      position: arcadeFront,
      radius: 1.6,
      action: 'showcase',
    },
    {
      id: 'bestiary',
      get name() {
        return t('showcase.bestiary.name');
      },
      get verb() {
        return t('showcase.verb.enter');
      },
      get prompt() {
        return t('showcase.prompt.bestiary');
      },
      position: lectern,
      radius: 1.7,
      action: 'showcase',
    },
    ...(['world', 'gallery'] as const).map(
      (id): Interactable => ({
        id,
        get name() {
          return t(`menu.title.${id}`);
        },
        get verb() {
          return t('showcase.verb.visit');
        },
        get prompt() {
          return t(`showcase.prompt.${id}`);
        },
        get title() {
          return t(`menu.title.${id}.hint`);
        },
        position: id === 'world' ? worldFront : galleryFront,
        radius: 1.3,
        action: 'showcase',
      }),
    ),
  ];

  // lights: the cabinet screen and the braziers, borrowed from the engine's pool while the town shows
  let lights: LightHandle[] = [];
  let clock = 0;
  const extension: TownExtension = {
    root,
    blockers: kit.blockers,
    interactables,
    activate() {
      if (lights.length) return;
      lights = [
        ctx.lights.request({ position: arcadeScreen.clone().add(new Vector3(0.5, 0, 0.5)), color: PALETTE.cyan, intensity: 5, radius: 4.5, flicker: 'pulse' }),
        ...braziers.map((b) => ctx.lights.request({ position: b, color: PALETTE.orange, intensity: 7, radius: 5, flicker: 'brazier' })),
        ctx.lights.request({ position: ringCentre.clone().add(new Vector3(0.6, 0, 0.6)), color: PALETTE.cyan, intensity: 6, radius: 5, flicker: 'pulse' }),
        ctx.lights.request({ position: easel.clone().add(new Vector3(0.5, 0, 0.5)), color: PALETTE.sand, intensity: 3, radius: 3.5 }),
      ];
    },
    deactivate() {
      for (const l of lights) l.release();
      lights = [];
    },
    update(dt, night) {
      clock += dt;
      // the cabinet's attract mode: its light cycles through the screen's colours
      const screen = lights[0];
      if (screen) screen.update({ color: [PALETTE.cyan, PALETTE.lime, PALETTE.sand, PALETTE.red][Math.floor(clock * 1.5) % 4]!, intensity: 4 + 3 * night });
      for (const l of lights.slice(1, 1 + braziers.length)) l.update({ intensity: 5 + 6 * night });
      // the workshop: the swirl turns in the ring, the crystal on its plinth
      spinner.rotation.set(0, spinYaw, 0);
      spinner.rotateZ(clock * 1.4);
      if (crystal) crystal.rotation.y = clock * 0.9;
      if (Math.floor(clock * 4) !== Math.floor((clock - dt) * 4)) for (const b of braziers) ctx.particles.burst('rl.ember', b);
    },
    save: () => clock,
    load(s) {
      clock = s as number;
    },
  };
  return { extension, arcadeScreen, bestiaryDoor };
}
