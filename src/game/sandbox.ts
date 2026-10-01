import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu';
import {
  compileClip,
  type Game,
  type GameContext,
  PALETTE,
  type PaletteColor,
  PlatformerCharacter,
  readMoveInput,
  toonMaterial,
  toonify,
} from '../engine';
import { restPoseOf } from '../engine/animation';
import { HERO_MODEL } from './hero';
import { HERO_CLIPS } from './hero/animations';
import { HERO_RIG } from './hero/rig';

/**
 * A second, tiny level: the engine's level-lifecycle demo (engine.loadGame switches
 * between it and the playground) and its textured-material showcase. A checkerboard
 * texture and a vertex-colored pillar go through `toonify` like any GLB would, crates are
 * dynamic bodies, and a trigger zone puffs smoke whenever something enters it.
 * Open it with `?game=sandbox`.
 */
export class Sandbox implements Game {
  readonly name = 'Sandbox';
  hero!: PlatformerCharacter;
  heroModel!: Object3D;
  floor!: Mesh;
  /** Things that entered the smoke zone (tests). */
  zoneEntries = 0;

  async setup(ctx: GameContext): Promise<void> {
    const { scene, physics, palette } = ctx;

    // Floor: a generated 2×2 checker texture, repeated, nearest-filtered by toonify.
    const map = checkerTexture('lime', 'green');
    map.wrapS = map.wrapT = RepeatWrapping;
    map.repeat.set(8, 8);
    const top = new MeshStandardMaterial({ map });
    const side = new MeshStandardMaterial({ color: PALETTE.teal });
    this.floor = new Mesh(new BoxGeometry(16, 1, 16), [side, side, top, side, side, side]);
    this.floor.position.y = -0.5;
    scene.add(toonify(this.floor));
    physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [8, 0.5, 8] });

    // Pillar: vertex colors, bottom to top through three palette colors.
    const pillar = new Mesh(gradientBox(1, 3, 1, ['plum', 'red', 'orange']), new MeshStandardMaterial({ vertexColors: true }));
    pillar.position.set(-3, 1.5, -3);
    scene.add(toonify(pillar));
    physics.addStaticBox({ position: [-3, 1.5, -3], halfExtents: [0.5, 1.5, 0.5] });

    for (let i = 0; i < 4; i++) {
      const mesh = new Mesh(new BoxGeometry(0.8, 0.8, 0.8), toonMaterial(palette.orange));
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      physics.bind(physics.addDynamicBox({ position: [2 + (i % 2), 0.4 + 0.9 * Math.floor(i / 2), -2], halfExtents: [0.4, 0.4, 0.4] }), mesh);
    }

    // Smoke zone: anything dynamic (crates, the hero) entering it puffs smoke.
    const zoneMesh = new Mesh(new BoxGeometry(2, 0.05, 2), toonMaterial(palette.slate));
    zoneMesh.position.set(3, 0.03, 2);
    scene.add(zoneMesh);
    physics.trigger({ box: [1, 1, 1] }, [3, 1, 2], {
      onEnter: () => {
        this.zoneEntries++;
        ctx.particles.burst('smoke', [3, 0.2, 2]);
        ctx.audio.play('coin', { pitch: -7 });
      },
    });

    const hero = await ctx.loadModel(HERO_MODEL, { castShadow: false });
    this.heroModel = hero.scene;
    scene.add(this.heroModel);
    this.hero = new PlatformerCharacter(physics, { position: [0, 0, 3], lockDepth: ctx.camera.lockDepth });
    const rest = restPoseOf(this.heroModel, HERO_RIG);
    this.hero.attachModel(this.heroModel, HERO_CLIPS.map((d) => compileClip(d, HERO_RIG, rest)));
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
    if (this.hero.feet.y < -10) this.hero.teleport([0, 0, 3]);
    ctx.hud.clear();
    ctx.hud.text(6, 6, 'SANDBOX', { color: 'cyan' });
  }

  cameraTarget(): Vector3 {
    const p = this.heroModel ? this.heroModel.position : new Vector3(0, 0, 3);
    return p.clone().setY(p.y + 0.9);
  }

  eyePosition(ctx: GameContext): Vector3 {
    return this.hero.eye(ctx.physics.alpha);
  }

  status(): string {
    return `Sandbox · zone ${this.zoneEntries} · ${this.hero?.state ?? ''}`;
  }
}

/** 2×2 checkerboard texture in two palette colors (sRGB). */
function checkerTexture(a: PaletteColor, b: PaletteColor): DataTexture {
  const px = (c: PaletteColor) => [(PALETTE[c] >> 16) & 255, (PALETTE[c] >> 8) & 255, PALETTE[c] & 255, 255];
  const tex = new DataTexture(new Uint8Array([...px(a), ...px(b), ...px(b), ...px(a)]), 2, 2, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Box in horizontal color bands (bottom to top), as vertex colors. Non-indexed with one
 * color per triangle, so bands stay crisp palette colors instead of blending.
 */
function gradientBox(w: number, h: number, d: number, colors: PaletteColor[]): BufferGeometry {
  const geo = new BoxGeometry(w, h, d, 1, colors.length, 1).toNonIndexed();
  const pos = geo.getAttribute('position');
  const out: number[] = [];
  const c = new Color();
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const t = (y + h / 2) / h; // 0 bottom .. 1 top
    c.setHex(PALETTE[colors[Math.min(colors.length - 1, Math.floor(t * colors.length))]!]);
    for (let k = 0; k < 3; k++) out.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(out, 3));
  return geo;
}
