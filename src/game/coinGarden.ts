import { AnimationMixer, BoxGeometry, Mesh, type Object3D, PlaneGeometry, Vector3 } from 'three/webgpu';
import { CharacterController, ContactShadow, type Game, type GameContext, type PaletteColor, toonMaterial } from '../engine';

/**
 * Demo: a small 3/4-view platformer diorama. Collect every coin; push crates;
 * fall off the island and you respawn. Everything is data-driven from LEVEL so an
 * agent can reshape the level without touching the logic.
 */

type Vec3 = [number, number, number];

interface BlockDef {
  /** Center position. */
  at: Vec3;
  size: Vec3;
  color: PaletteColor;
  /** Optional darker color for the sides (grass-topped dirt etc.). */
  side?: PaletteColor;
}

export const LEVEL = {
  spawn: [0, 0.2, 4] as Vec3,
  killY: -8,
  blocks: [
    { at: [0, -0.6, 0], size: [22, 1.2, 22], color: 'green', side: 'plum' },
    { at: [-5, 0.25, -3], size: [3, 0.5, 3], color: 'mist', side: 'slate' },
    { at: [-5, 0.6, -6], size: [3, 1.2, 3], color: 'mist', side: 'slate' },
    { at: [-1, 1.1, -7], size: [3, 2.2, 2.5], color: 'mist', side: 'slate' },
    { at: [3.5, 2.2, -7], size: [2, 0.4, 2], color: 'sand', side: 'orange' },
    { at: [6, 0.4, 2], size: [4, 0.8, 5], color: 'lime', side: 'teal' },
    { at: [7, 1.2, -2.5], size: [2, 0.4, 2], color: 'sand', side: 'orange' },
  ] satisfies BlockDef[],
  trees: [[-8, 0, 6], [-6, 0, 8], [8, 0, 7], [-8, 0, -8], [2, 0, 8], [9, 0, -8]] as Vec3[],
  crates: [[2, 0.4, 2], [2.9, 0.4, 2.2], [2.45, 1.2, 2.1], [-3, 0.4, 3]] as Vec3[],
  coins: [
    [-2, 0, 2], [-5, 0.5, -3], [-5, 1.2, -6], [-1, 2.2, -7], [3.5, 2.4, -7],
    [6, 0.8, 2], [7, 1.4, -2.5], [4, 0, 6], [-7, 0, 1],
  ] as Vec3[],
};

interface Coin {
  root: Object3D;
  mixer: AnimationMixer;
  shadow: ContactShadow;
  collected: boolean;
}

export class CoinGarden implements Game {
  readonly name = 'Coin Garden';
  hero!: CharacterController;
  heroModel!: Object3D;
  heroShadow = new ContactShadow(0.42);
  coins: Coin[] = [];
  collected = 0;
  respawns = 0;
  private readonly move = new Vector3();

  async setup(ctx: GameContext): Promise<void> {
    const { scene, physics, loadModel } = ctx;

    // Sea under the island.
    const sea = new Mesh(new PlaneGeometry(200, 200).rotateX(-Math.PI / 2), toonMaterial(ctx.palette.navy));
    sea.position.y = -2.5;
    sea.receiveShadow = true;
    scene.add(sea);

    for (const b of LEVEL.blocks) {
      scene.add(block(b, ctx));
      physics.addStaticBox({ position: b.at, halfExtents: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] });
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

    const crateGeo = new BoxGeometry(0.8, 0.8, 0.8);
    for (const [x, y, z] of LEVEL.crates) {
      const mesh = new Mesh(crateGeo, toonMaterial(ctx.palette.orange));
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      physics.bind(physics.addDynamicBox({ position: [x, y, z], halfExtents: [0.4, 0.4, 0.4], density: 0.6 }), mesh);
    }

    for (const [x, y, z] of LEVEL.coins) {
      const root = coin.scene.clone(true);
      root.position.set(x, y, z);
      const mixer = new AnimationMixer(root);
      const clip = coin.animations[0];
      if (clip) mixer.clipAction(clip).play();
      mixer.setTime(x * 0.37 + z * 0.21); // de-sync the spin
      const shadow = new ContactShadow(0.25);
      shadow.place(x, y, z, 0.45);
      scene.add(root, shadow);
      this.coins.push({ root, mixer, shadow, collected: false });
    }

    this.heroModel = hero.scene;
    scene.add(this.heroModel, this.heroShadow);
    this.hero = new CharacterController(physics, { position: LEVEL.spawn, radius: 0.3, halfHeight: 0.5 });
    this.hero.attachAnimations(this.heroModel, hero.animations);
    this.syncHeroModel(1);
  }

  fixedUpdate(ctx: GameContext, dt: number): void {
    const axis = ctx.input.moveAxis();
    const { right, forward } = ctx.camera.groundBasis();
    this.move.copy(right).multiplyScalar(axis.x).addScaledVector(forward, axis.y);
    this.hero.setInput(this.move, ctx.input.consumePress('Space', 'KeyK'), ctx.input.isDown('Space', 'KeyK'));
    this.hero.fixedUpdate(dt);
  }

  update(ctx: GameContext, dt: number): void {
    const feet = this.syncHeroModel(ctx.physics.alpha);
    this.hero.updateVisual(this.heroModel, dt);

    const ground = ctx.physics.groundBelow(feet.clone().setY(feet.y + 0.1), 20, this.hero.body);
    if (ground) this.heroShadow.place(feet.x, ground.y, feet.z, feet.y - ground.y);
    else this.heroShadow.visible = false;

    for (const c of this.coins) {
      if (c.collected) continue;
      c.mixer.update(dt);
      const d = c.root.position;
      if (Math.hypot(d.x - feet.x, d.z - feet.z) < 0.65 && feet.y > d.y - 0.6 && feet.y < d.y + 1.2) {
        c.collected = true;
        c.root.visible = c.shadow.visible = false;
        this.collected++;
      }
    }

    if (feet.y < LEVEL.killY) {
      this.hero.teleport(LEVEL.spawn);
      this.respawns++;
    }
  }

  cameraTarget(): Vector3 {
    return this.heroModel ? this.heroModel.position.clone().setY(this.heroModel.position.y + 0.8) : new Vector3();
  }

  status(): string {
    const all = this.coins.length;
    return this.collected === all && all > 0 ? `All ${all} coins! You win.` : `Coins ${this.collected}/${all}`;
  }

  /** Visual follows the kinematic body, interpolated between physics steps. */
  private syncHeroModel(alpha: number): Vector3 {
    const feet = this.hero.interpolatedFeet(alpha);
    this.heroModel.position.copy(feet);
    return feet;
  }
}

function block(def: BlockDef, ctx: GameContext): Object3D {
  const [w, h, d] = def.size;
  const top = toonMaterial(ctx.palette[def.color]);
  const side = toonMaterial(ctx.palette[def.side ?? def.color]);
  // Box material order: +x, -x, +y, -y, +z, -z
  const mesh = new Mesh(new BoxGeometry(w, h, d), [side, side, top, side, side, side]);
  mesh.position.set(...def.at);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
