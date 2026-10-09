/**
 * Trails & Decals: marks things leave. Footprints in the sand behind the hero, ribbons behind
 * fists and kicks, a comet with a long tail, paint splats where you punch the wall, cracks
 * where you ground-pound, scorch marks where a bomb goes off. Marks fade away by dithering.
 */
import { Mesh, Object3D, SphereGeometry, Vector3 } from 'three/webgpu';
import { DECAL_SHAPES, Decals, PALETTE, type PaletteColor, Trail } from '../../engine';
import { Strikes } from '../kit/strike';
import type { Knob, RoomDef } from '../types';

const PAINT: PaletteColor[] = ['red', 'orange', 'sand', 'lime', 'sky', 'plum'];
const UP = new Vector3(0, 1, 0);

export const TRAILS: RoomDef = {
  id: 'trails',
  title: 'Trails & Decals',
  wing: 'effects',
  about:
    'The marks things leave behind: footprints in the sand that fade, ribbons that follow your fists and feet, a comet with a long tail, paint splats where you punch the wall, cracks where you ground-pound and scorch marks where a bomb goes off.',
  try: ['Walk on the sand and look back', 'Punch the wall (J): paint', 'Ground-pound (jump, C): a crack', 'Step on BOMB'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'A sand yard with a paint wall, a comet circling a pillar, and pads for a bomb, the decal shapes and clearing every mark.',
    how: [
      'A decal is a small flat square laid on a surface, turned to face along the surface\'s normal and nudged off it (plus a depth offset) so it never flickers into the floor.',
      'Its shape is cut out in the shader from its texture coordinates (a sole and a heel, a ragged blob, a splat with drops, cracks, a ring): no textures, any size, crisp at any scale. Each shape is one instanced draw; each mark has its own colour.',
      'Marks fade by an ordered 4x4 dither: a growing share of their pixels is dropped over a second, so there is no blending and no sorting. When a pool is full the oldest mark is reused.',
      'Footprints come from the feet themselves: when a foot comes down after being lifted, a print goes where it landed, turned the way the hero faces.',
      'A trail is a ribbon through the last few dozen points something passed, rebuilt every frame to face the camera, narrowing toward the tail and stepping from its colour to its tail colour as points age.',
    ],
    uses: [
      'Footprints in snow and sand: Journey, Red Dead Redemption 2, The Legend of Zelda.',
      'Weapon trails and dash streaks: Devil May Cry, Hades, every action game.',
      'Bullet holes, scorch marks, blood and paint: Splatoon is decals as a whole game.',
    ],
    ask: ['footprints that fade away', 'a sword trail', 'scorch marks after explosions', 'paint splats where projectiles hit', 'cracks in the ground after a slam'],
    cost: 'Decals: one draw call per shape, a matrix and a colour per mark; fading updates one number per mark. Trails: a few dozen vertices rebuilt per frame each.',
    code: [
      {
        title: 'A mark laid along the surface normal',
        file: 'src/engine/render/decals.ts',
        src: `this.q.setFromUnitVectors(Z, this.n);
this.p.set(at.x, at.y, at.z).addScaledVector(this.n, 0.012);`,
      },
      {
        title: 'A ribbon that faces the camera',
        file: 'src/engine/render/trail.ts',
        src: `this.side.crossVectors(this.tan, this.view);`,
      },
    ],
    words: ['decal', 'trail', 'instancing', 'dither', 'draw call'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(26, 22, { floor: ['sand', 'sand'], wall: { color: 'orange', side: 'plum' } });
    const decals = new Decals(ctx.scene, { capacity: 160 });
    let life = 10;
    // the paint wall
    kit.box([0, 1.6, -7], [10, 3.2, 0.5], 'white', { side: 'mist' });
    kit.label([0, 3.7, -7], 'PAINT WALL · PUNCH IT', { color: 'sand', range: 10 });
    // the comet's pillar
    kit.cylinder([-7, 1.2, 1], 0.5, 2.4, 'slate');
    const comet = new Mesh(new SphereGeometry(0.22, 10, 8), kit.glow('sky', 1.2));
    ctx.scene.add(comet);
    const cometTrail = new Trail({ points: 48, width: 0.5, life: 1.2, color: PALETTE.white, tail: PALETTE.blue });
    // the hero's ribbons: fists and feet
    const fists = [new Trail({ width: 0.3, life: 0.25, color: PALETTE.sand, tail: PALETTE.orange }), new Trail({ width: 0.3, life: 0.25, color: PALETTE.sand, tail: PALETTE.orange })];
    const kicks = [new Trail({ width: 0.35, life: 0.25, color: PALETTE.white, tail: PALETTE.sky }), new Trail({ width: 0.35, life: 0.25, color: PALETTE.white, tail: PALETTE.sky })];
    const dash = new Trail({ points: 32, width: 0.6, life: 0.3, color: PALETTE.plum, tail: PALETTE.navy });
    ctx.scene.add(cometTrail, ...fists, ...kicks, dash);
    // bones on the hero model, looked up once it exists
    let bones: { hands: Object3D[]; feet: Object3D[] } | null = null;
    const findBones = () => {
      const model = room.hero?.model;
      if (!model) return null;
      const get = (n: string) => model.getObjectByName(n);
      const hands = [get('HandR'), get('HandL')];
      const feet = [get('FootR'), get('FootL')];
      if (hands.some((b) => !b) || feet.some((b) => !b)) return null;
      return { hands: hands as Object3D[], feet: feet as Object3D[] };
    };
    let paint = 0;
    let striking = 0;
    let kicking = 0;
    const footUp = [false, false];
    let prints = 0;
    const bomb = () => {
      const at = new Vector3(5, 0, 1);
      decals.add('scorch', at, UP, { size: 2.4, color: PALETTE.night, life: life * 1.5 });
      decals.add('crack', at, UP, { size: 2, color: PALETTE.ink, life: life * 1.5 });
      ctx.particles.burst('impact', at, { count: 30, speed: 7 });
      ctx.particles.burst('smoke', at, { count: 20, scale: 2 });
      e.screen.shockwave(at, { radius: 0.5 });
      e.shake.add(0.5);
      ctx.audio.play('groundPound', { pitch: -4 });
    };
    kit.pad([5, 0, 4], { label: 'BOMB', color: 'red', note: 'A blast leaves a scorch mark and cracks: two decals, one draw call per shape.', apply: bomb });
    kit.pad([8, 0, 4], {
      label: 'EVERY SHAPE',
      color: 'sky',
      note: `Every decal shape, cut out in the shader: ${DECAL_SHAPES.join(', ')}.`,
      apply: () => DECAL_SHAPES.forEach((s, i) => decals.add(s, new Vector3(-4 + i * 2, 0, 9), UP, { size: 1.4, color: PALETTE[PAINT[i % PAINT.length]!], life: life * 2, rotation: 0 })),
    });
    kit.pad([-4, 0, 4], { label: 'CLEAR MARKS', color: 'slate', note: 'Every decal gone (the pools stay for reuse).', apply: () => decals.clear() });
    kit.light({ position: [0, 4, 0], color: PALETTE.sand, intensity: 5, radius: 14, flicker: 'none' });
    kit.light({ position: [-7, 3, 1], color: PALETTE.sky, intensity: 4, radius: 6, flicker: 'none' });

    const strikes = new Strikes();
    const knobs: Knob[] = [{ id: 'life', label: 'Marks last', min: 1, max: 30, step: 1, get: () => life, set: (v) => (life = v), format: (v) => `${v} s`, initial: 10 }];
    const tmp = new Vector3();
    const feet = new Vector3();
    let lastLandings = 0;
    return {
      knobs,
      fixedUpdate() {
        const h = room.hero?.hero;
        if (!h) return;
        const s = strikes.poll(h, 0.6);
        if (s) {
          if (s.anim.includes('Kick')) kicking = 0.35;
          else striking = 0.3;
          // a punch into the wall leaves paint where the fist lands
          if (Math.abs(s.at.z + 6.75) < 0.6 && Math.abs(s.at.x) < 5) {
            const c = PAINT[paint++ % PAINT.length]!;
            decals.add('splat', new Vector3(s.at.x, s.at.y, -6.75), new Vector3(0, 0, 1), { size: 1.1, color: PALETTE[c], life });
            ctx.particles.burst('impact', s.at, { colors: [c, 'white'], count: 12 });
            ctx.audio.play('punch');
          }
        }
        if (h.stats.landings !== lastLandings) {
          lastLandings = h.stats.landings;
          if (h.state === 'groundPoundLand') {
            const f = h.feetInto(feet);
            decals.add('crack', f, UP, { size: 2.2, color: PALETTE.plum, life });
            decals.add('ring', f, UP, { size: 2.6, color: PALETTE.orange, life: life / 2 });
          }
        }
      },
      update(dt) {
        const t = ctx.physics.time;
        decals.update(dt);
        // the comet: a figure eight round the pillar
        comet.position.set(-7 + Math.sin(t * 1.4) * 3, 1.6 + Math.sin(t * 2.8) * 0.6, 1 + Math.sin(t * 2.8) * 1.6);
        cometTrail.push(comet.position, t);
        cometTrail.update(t, ctx.camera.camera);
        bones ??= findBones();
        const h = room.hero?.hero;
        striking = Math.max(0, striking - dt);
        kicking = Math.max(0, kicking - dt);
        if (bones && h) {
          bones.hands.forEach((b, i) => {
            if (striking > 0) fists[i]!.push(b.getWorldPosition(tmp), t);
            fists[i]!.update(t, ctx.camera.camera);
          });
          bones.feet.forEach((b, i) => {
            const p = b.getWorldPosition(tmp);
            if (kicking > 0) kicks[i]!.push(p, t);
            kicks[i]!.update(t, ctx.camera.camera);
            // a print where a lifted foot comes down
            const ground = h.feetInto(feet).y;
            const up = p.y > ground + 0.16;
            if (footUp[i] && !up && h.grounded && h.speed > 0.5) {
              decals.add('footprint', new Vector3(p.x, ground, p.z), UP, { size: 0.42, rotation: h.facing + Math.PI, color: PALETTE.orange, life });
              prints++;
            }
            footUp[i] = up;
          });
          if (h.speed > 6.5) dash.push(h.feetInto(feet).setY(h.feetY() + 0.9), t);
          dash.update(t, ctx.camera.camera);
        }
      },
      status: () => `marks ${decals.count()} prints ${prints}`,
      api: {
        bomb,
        marks: () => decals.count(),
        prints: () => prints,
        comet: () => cometTrail.length,
        paint: (x: number, y: number) => decals.add('splat', new Vector3(x, y, -6.75), new Vector3(0, 0, 1), { size: 1.1, color: PALETTE.red, life }),
      },
    };
  },
};
