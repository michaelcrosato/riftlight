import { AnimationMixer, BoxGeometry, Mesh, type Object3D, PlaneGeometry, Vector3 } from 'three/webgpu';
import {
  compileClips,
  ContactShadow,
  type Game,
  type GameContext,
  type PaletteColor,
  PlatformerCharacter,
  RAPIER,
  readMoveInput,
  toonMaterial,
} from '../engine';
import { HERO_CLIPS } from './hero/animations';
import { HERO_RIG } from './hero/rig';

/**
 * Demo: "Move Playground" — a data-driven island with a station for every move.
 * Collect all coins. Everything is described in LEVEL so agents can reshape it freely.
 *
 *   stairs + plateau edge     step up / step down / teeter / hard-ish drops
 *   crawl tunnel (0.75 high)  prone + crawl (crouching is too tall)
 *   ledge block & wall        jump → hang → shimmy → pull up
 *   vine block (climbable)    climb up and over the top
 *   slippery slope            slope slide
 *   wall-kick chimney         wall kicks
 *   tower + ladder            climb, then jump off for a hard landing (or dive)
 *   crates (pushable)         push
 *   nook block (grabbable)    grab + pull it out (a coin hides behind it)
 */

type Vec3 = [number, number, number];

export interface BlockDef {
  at: Vec3;
  size: Vec3;
  color: PaletteColor;
  side?: PaletteColor;
  /** Rotation about Z in degrees (ramps). */
  tiltZ?: number;
  tags?: string[];
}

const steps: BlockDef[] = [0, 1, 2, 3, 4].map((i) => ({
  at: [-2.4 - 0.8 * i, 0.14 * (i + 1), 0],
  size: [0.8, 0.28 * (i + 1), 4],
  color: 'mist',
  side: 'slate',
}));

export const LEVEL = {
  spawn: [0, 0, 3] as Vec3,
  killY: -10,
  blocks: [
    { at: [0, -0.6, 0], size: [32, 1.2, 32], color: 'green', side: 'plum' },
    ...steps,
    { at: [-8.2, 0.7, 0], size: [4, 1.4, 4], color: 'mist', side: 'slate' },
    // ledge block on the main lane and a long ledge wall at the back
    { at: [6.5, 1.4, 0], size: [2.4, 2.8, 4], color: 'sand', side: 'orange' },
    { at: [0, 1.5, -9], size: [6, 3, 2], color: 'mist', side: 'slate' },
    // climbable vine block, with a slippery slope down its far side
    { at: [8, 2.25, -9], size: [3, 4.5, 3], color: 'lime', side: 'green', tags: ['climbable'] },
    { at: [12.25, 2.3, -9], size: [7, 0.3, 3], color: 'cyan', side: 'sky', tiltZ: -38, tags: ['slippery'] },
    { at: [15.7, 0.6, -9], size: [0.4, 1.2, 4], color: 'orange', side: 'plum' }, // slide run-out bumper
    // wall-kick chimney
    { at: [-4.6, 2.5, -9], size: [0.5, 5, 3], color: 'night', side: 'slate', tags: ['noLedge'] },
    { at: [-6.6, 2.5, -9], size: [0.5, 5, 3], color: 'night', side: 'slate', tags: ['noLedge'] },
    // tower with a ladder
    { at: [-12, 3.5, -9], size: [2.6, 7, 2.6], color: 'mist', side: 'slate' },
    { at: [-12, 3.5, -7.6], size: [1.0, 7, 0.2], color: 'orange', side: 'plum', tags: ['climbable'] },
    // crawl tunnel
    { at: [-8, 0.95, 7], size: [3, 0.4, 2.4], color: 'slate', side: 'night' },
    { at: [-8, 0.375, 5.95], size: [3, 0.75, 0.3], color: 'slate', side: 'night' },
    { at: [-8, 0.375, 8.05], size: [3, 0.75, 0.3], color: 'slate', side: 'night' },
    // pull nook
    { at: [12.75, 1, 6], size: [0.5, 2, 3.6], color: 'mist', side: 'slate' },
    { at: [11.25, 1, 4.4], size: [2.5, 2, 0.4], color: 'mist', side: 'slate' },
    { at: [11.25, 1, 7.6], size: [2.5, 2, 0.4], color: 'mist', side: 'slate' },
  ] satisfies BlockDef[],
  crates: [
    { at: [2.5, 0.5, 0] as Vec3, tags: ['pushable'] },
    { at: [3, 0.5, 5.5] as Vec3, tags: ['pushable'] },
    { at: [12, 0.5, 6] as Vec3, tags: ['pushable', 'grabbable'] },
  ],
  trees: [[-14, 0, 13], [-11, 0, 14], [14, 0, 13], [-14, 0, -14], [3, 0, 13], [14, 0, -14]] as Vec3[],
  coins: [
    [0, 0, 6], [-4, 0, 5], [4, 0, -4],
    [-8.2, 1.4, 0], [6.5, 2.8, 0], [0, 3, -9], [8, 4.5, -9], [-5.6, 4.2, -9],
    [-12, 7, -9], [14.5, 0, -9], [-8, 0.05, 7], [12.3, 0, 6],
  ] as Vec3[],
};

interface Coin {
  root: Object3D;
  mixer: AnimationMixer;
  shadow: ContactShadow;
  collected: boolean;
}

export class Playground implements Game {
  readonly name = 'Move Playground';
  hero!: PlatformerCharacter;
  heroModel!: Object3D;
  heroShadow = new ContactShadow(0.42);
  coins: Coin[] = [];
  collected = 0;
  respawns = 0;
  private won = false;

  async setup(ctx: GameContext): Promise<void> {
    const { scene, physics, loadModel } = ctx;

    const sea = new Mesh(new PlaneGeometry(300, 300).rotateX(-Math.PI / 2), toonMaterial(ctx.palette.navy));
    sea.position.y = -3;
    sea.receiveShadow = true;
    scene.add(sea);

    for (const b of LEVEL.blocks) {
      scene.add(block(b, ctx));
      const rot = b.tiltZ ? (b.tiltZ * Math.PI) / 180 : 0;
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(...b.at)
          .setRotation({ x: 0, y: 0, z: Math.sin(rot / 2), w: Math.cos(rot / 2) }),
      );
      const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2).setFriction(0.9), body);
      if (b.tags) physics.tag(col, ...b.tags);
    }

    for (const c of LEVEL.crates) {
      const mesh = new Mesh(new BoxGeometry(1, 1, 1), [
        ...Array(2).fill(toonMaterial(ctx.palette.orange)),
        toonMaterial(ctx.palette.sand),
        ...Array(3).fill(toonMaterial(ctx.palette.orange)),
      ]);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(...c.at).setLinearDamping(4).enabledRotations(false, false, false),
      );
      const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.49, 0.49, 0.49).setFriction(0.1).setDensity(8), body);
      physics.tag(col, ...c.tags);
      physics.bind(body, mesh);
    }

    const [tree, coin, hero] = await Promise.all([
      loadModel('assets/tree.glb'),
      loadModel('assets/coin.glb', { castShadow: false }),
      loadModel('assets/hero.glb', { castShadow: false }),
    ]);

    LEVEL.trees.forEach(([x, y, z], i) => {
      const t = tree.scene.clone(true);
      t.position.set(x, y, z);
      t.rotation.y = i * 1.3;
      t.scale.setScalar(1 + (i % 3) * 0.15);
      scene.add(t);
      physics.addStaticCylinder([x, y + 1, z], 1, 0.3);
    });

    for (const [x, y, z] of LEVEL.coins) {
      const root = coin.scene.clone(true);
      root.position.set(x, y, z);
      const mixer = new AnimationMixer(root);
      const clip = coin.animations[0];
      if (clip) mixer.clipAction(clip).play();
      mixer.setTime(x * 0.37 + z * 0.21);
      const shadow = new ContactShadow(0.25);
      shadow.place(x, y, z, 0.45);
      scene.add(root, shadow);
      this.coins.push({ root, mixer, shadow, collected: false });
    }

    this.heroModel = hero.scene;
    scene.add(this.heroModel, this.heroShadow);
    this.hero = new PlatformerCharacter(physics, { position: LEVEL.spawn, lockDepth: ctx.camera.lockDepth });
    // Animations are data (src/game/hero/animations.ts), compiled against the model's rig.
    this.hero.attachModel(this.heroModel, compileClips(HERO_CLIPS, HERO_RIG, this.heroModel));
    // Edit animations.ts while the game runs: clips recompile and swap in place.
    import.meta.hot?.accept('./hero/animations', (mod) => {
      const clips = (mod as { HERO_CLIPS?: typeof HERO_CLIPS } | undefined)?.HERO_CLIPS;
      if (clips) this.hero.attachModel(this.heroModel, compileClips(clips, HERO_RIG, this.heroModel));
    });
    this.heroModel.position.set(...LEVEL.spawn);
    this.heroModel.visible = !ctx.camera.hidesTarget;
  }

  onCameraChange(ctx: GameContext): void {
    this.hero.setLockDepth(ctx.camera.lockDepth);
    this.heroModel.visible = !ctx.camera.hidesTarget;
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    this.hero.fixedUpdate(dt, readMoveInput(ctx, this.hero));
  }

  update(ctx: GameContext, dt: number): void {
    this.hero.updateVisual(this.heroModel, dt, ctx.physics.alpha);
    const feet = this.heroModel.position;

    const ground = ctx.physics.groundBelow(feet.clone().setY(feet.y + 0.1), 20, this.hero.body);
    if (ground && !ctx.camera.hidesTarget) this.heroShadow.place(feet.x, ground.y, feet.z, feet.y - ground.y);
    else this.heroShadow.visible = false;

    for (const c of this.coins) {
      if (c.collected) continue;
      c.mixer.update(dt);
      const d = c.root.position;
      if (Math.hypot(d.x - feet.x, d.z - feet.z) < 0.7 && feet.y > d.y - 0.9 && feet.y < d.y + 1.2) {
        c.collected = true;
        c.root.visible = c.shadow.visible = false;
        this.collected++;
      }
    }
    if (!this.won && this.collected === this.coins.length && this.coins.length > 0) {
      this.won = true;
      this.hero.celebrate();
    }
    if (feet.y < LEVEL.killY) {
      this.hero.teleport(LEVEL.spawn);
      this.respawns++;
    }
  }

  cameraTarget(): Vector3 {
    const p = this.heroModel ? this.heroModel.position : new Vector3(...LEVEL.spawn);
    return p.clone().setY(p.y + 0.9);
  }

  eyePosition(ctx: GameContext): Vector3 {
    return this.hero.eye(ctx.physics.alpha);
  }

  status(): string {
    const all = this.coins.length;
    const coins = this.collected === all && all > 0 ? `All ${all} coins!` : `Coins ${this.collected}/${all}`;
    return `${coins} · ${this.hero?.state ?? ''} (${this.hero?.anim ?? ''})`;
  }
}

function block(def: BlockDef, ctx: GameContext): Object3D {
  const [w, h, d] = def.size;
  const top = toonMaterial(ctx.palette[def.color]);
  const side = toonMaterial(ctx.palette[def.side ?? def.color]);
  const mesh = new Mesh(new BoxGeometry(w, h, d), [side, side, top, side, side, side]);
  mesh.position.set(...def.at);
  if (def.tiltZ) mesh.rotation.z = (def.tiltZ * Math.PI) / 180;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
