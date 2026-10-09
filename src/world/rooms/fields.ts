/**
 * Forces & Fields: zones that push and pull. A wind tunnel to walk into, updraft vents that
 * float you up to a ledge, a gravity well that gathers crates and balls (or flings them), and
 * launch pads. The same field pushes the hero and the bodies.
 */
import { CylinderGeometry, Group, Mesh, BoxGeometry, SphereGeometry, Vector3 } from 'three/webgpu';
import { type Field, PALETTE, RAPIER, setLookLayer, toonMaterial } from '../../engine';
import type { Knob, RoomDef, Vec3 } from '../types';

const TUNNEL = { x0: -13, x1: -3, z: -7 };
const VENTS: Vec3[] = [
  [4, 0, -8],
  [8, 0, -8],
];
const LEDGE: Vec3 = [10.8, 3.6, -8.5]; // a short drift from the second vent
const WELL: Vec3 = [-8, 1.6, 5];
const LAUNCHERS: { at: Vec3; vy: number; hz: number; label: string }[] = [
  { at: [4, 0, 4], vy: 12, hz: 0, label: 'HOP 12' },
  { at: [7.5, 0, 4], vy: 17, hz: 0, label: 'HIGH 17' },
  { at: [11, 0, 3], vy: 15, hz: 4.2, label: 'ONTO THE TOWER' },
];
const TOWER: Vec3 = [11, 4, 7.6];

export const FIELDS: RoomDef = {
  id: 'fields',
  title: 'Forces & Fields',
  wing: 'physics',
  about:
    'Invisible zones that push and pull: walk into the wind tunnel, jump into an updraft and float up to the ledge, switch the gravity well between pulling and flinging, and bounce off launch pads. One field pushes the hero and the physics bodies alike.',
  try: ['Walk into the wind tunnel, then REVERSE the fan', 'Jump into a vent: drift from one updraft to the next and onto the ledge', 'PULL, then PUSH at the gravity well', 'Step on the launch pads'],
  spawn: [0, 0, 8],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A wind tunnel with a fan and loose crates, two updraft vents beside a high ledge, a gravity well full of crates and balls, and three launch pads, one of which throws you onto a tower.',
    how: [
      'A field is a box or a sphere with an acceleration: a direction (wind, updrafts), toward or away from its centre (a well), with or without falloff (weaker toward the edge or the top), and optional drag.',
      'Every fixed step, every dynamic body inside a field gets its acceleration times its mass as an impulse: light and heavy crates are blown alike.',
      'The character asks the fields what pushes its chest. In the air the push changes its velocity (momentum: an updraft lifts, a gust carries you); standing, a sideways push only drifts the feet a little, so you can walk into the wind.',
      'The updrafts fade toward the top (falloff), so they lift you to a height where the push equals gravity, and their drag damps the bobbing: you float there, and air control drifts you to the next vent or the ledge.',
      'Launch pads call character.launch(speed): a jump whose arc the jump button can\'t cut short (a normal jump is lower when you let go early).',
    ],
    uses: [
      'Updrafts and wind: Zelda: Breath of the Wild\'s paraglider vents, Spyro\'s gliding, Journey.',
      'Gravity wells and magnets: Super Mario Galaxy, Portal\'s excursion funnels, Control\'s launch.',
      'Bounce pads and geysers: Sonic\'s springs, Mario\'s trampolines.',
    ],
    ask: ['a fan that blows the player back', 'an updraft the player floats up', 'a black hole that pulls objects in', 'a spring pad that launches the player high', 'wind that pushes crates'],
    cost: 'Each field checks every dynamic body each step (a few multiplies each): nothing for a handful of fields. The character asks once per step.',
    code: [
      {
        title: 'Fields push dynamic bodies: acceleration × mass, every step',
        file: 'src/engine/physics/forces.ts',
        src: `const m = b.mass();
if (ax !== 0 || ay !== 0 || az !== 0) b.applyImpulse({ x: ax * m * dt, y: ay * m * dt, z: az * m * dt }, true);`,
      },
      {
        title: 'The character in the air: the field changes its velocity',
        file: 'src/engine/character/PlatformerCharacter.ts',
        src: `if (airborne) {
this.vy += a[1] * dt;
this.hvel.x += a[0] * dt;`,
      },
      {
        title: 'Standing: a sideways push only drifts the feet',
        file: 'src/engine/character/PlatformerCharacter.ts',
        src: `c.x += a[0] * dt * T.body.windGrip;`,
      },
    ],
    words: ['force field', 'drag', 'impulse', 'dynamic body', 'density', 'character controller', 'fixed timestep'],
  },
  build(room) {
    const { kit, ctx } = room;
    const physics = ctx.physics;
    const world = physics.world;
    kit.room(30, 24, { floor: ['mist', 'white'], wall: { color: 'blue', side: 'navy' } });
    ctx.particles.register('streak', { count: 1, life: [0.5, 0.8], speed: [5, 7], spread: 6, drag: 0, size: [2, 1], colors: ['white', 'mist', 'sky'], radius: 0.1 });

    // ---------------------------------------------------------------- the wind tunnel
    const tunnelLen = TUNNEL.x1 - TUNNEL.x0;
    const midX = (TUNNEL.x0 + TUNNEL.x1) / 2;
    kit.box([midX, 0.7, TUNNEL.z - 2.2], [tunnelLen, 1.4, 0.3], 'sky', { side: 'blue' });
    kit.box([midX, 0.7, TUNNEL.z + 2.2], [tunnelLen, 1.4, 0.3], 'sky', { side: 'blue' });
    const fan = new Group();
    fan.position.set(TUNNEL.x0 - 0.4, 1.6, TUNNEL.z);
    const bladeMat = toonMaterial(PALETTE.slate);
    for (let i = 0; i < 3; i++) {
      const blade = new Mesh(new BoxGeometry(0.1, 2.8, 0.5), bladeMat);
      blade.rotation.x = (i * Math.PI) / 3;
      blade.castShadow = true;
      fan.add(blade);
    }
    ctx.scene.add(fan);
    kit.box([TUNNEL.x0 - 0.8, 1.6, TUNNEL.z], [0.4, 3.4, 3.6], 'night', { side: 'ink' });
    let fanSpeed = 16;
    let fanDir = 1;
    const wind: Field = physics.fields.add({ name: 'wind', box: [tunnelLen / 2, 1.6, 2], at: [midX, 1.6, TUNNEL.z], force: [fanSpeed, 0, 0] });
    const setWind = () => (wind.force = [fanSpeed * fanDir, 0, 0]);
    for (let i = 0; i < 4; i++) kit.crate([TUNNEL.x0 + 2 + i * 1.6, 0.4, TUNNEL.z + (i % 2 ? 0.7 : -0.7)], { size: 0.7, color: 'sand', side: 'white', density: 0.5 });
    kit.pad([TUNNEL.x1 + 1.2, 0, TUNNEL.z - 3.4], {
      label: 'FAN',
      color: 'sky',
      initial: true,
      note: 'The wind tunnel\'s field on or off: a box that accelerates everything inside along +x.',
      apply: (_r, p) => {
        wind.enabled = !wind.enabled;
        kit.lightPad(p, wind.enabled);
      },
    });
    kit.pad([TUNNEL.x1 + 1.2, 0, TUNNEL.z + 3.4], {
      label: 'REVERSE',
      color: 'blue',
      note: 'The fan sucks instead: the same field, its force turned round.',
      apply: () => {
        fanDir = -fanDir;
        setWind();
      },
    });
    kit.label([midX, 2.4, TUNNEL.z], 'WIND TUNNEL', { color: 'sky', range: 12 });

    // ---------------------------------------------------------------- updrafts and the ledge
    let lift = 90;
    const vents = VENTS.map((v) => {
      const grate = new Mesh(new CylinderGeometry(0.9, 0.9, 0.08, 16), kit.glow('cyan', 0.5));
      grate.position.set(v[0], 0.04, v[2]);
      kit.decorate(grate);
      return physics.fields.add({ name: 'updraft', box: [0.85, 4, 0.85], at: [v[0], 4, v[2]], force: [0, lift, 0], falloff: true, drag: 0.5 });
    });
    kit.box(LEDGE, [3, 0.4, 3], 'lime', { side: 'green' });
    kit.box([LEDGE[0], LEDGE[1] / 2 - 0.1, LEDGE[2]], [0.6, LEDGE[1] - 0.2, 0.6], 'slate', { ghost: true });
    kit.solid([LEDGE[0], LEDGE[1] / 2 - 0.1, LEDGE[2]], [0.6, LEDGE[1] - 0.2, 0.6]);
    const gem = new Mesh(new SphereGeometry(0.3, 10, 8), kit.glow('sand', 1));
    gem.position.set(LEDGE[0], LEDGE[1] + 0.7, LEDGE[2]);
    ctx.scene.add(gem);
    kit.label([6, 1.2, -8], 'UPDRAFTS · JUMP IN', { color: 'cyan', range: 10 });
    // a few light balls bob in the updrafts
    const ballMat = toonMaterial(PALETTE.orange);
    for (const [i, v] of VENTS.entries()) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(v[0] + 0.2, 2 + i, v[2]).setLinearDamping(0.8));
      world.createCollider(RAPIER.ColliderDesc.ball(0.25).setDensity(0.3), body);
      const mesh = new Mesh(new SphereGeometry(0.25, 10, 8), ballMat);
      mesh.castShadow = true;
      setLookLayer(mesh, 'actors');
      ctx.scene.add(mesh);
      physics.bind(body, mesh);
    }

    // ---------------------------------------------------------------- the gravity well
    let wellStrength = 22;
    const well: Field = physics.fields.add({ name: 'well', sphere: 5.5, at: WELL, radial: -wellStrength, falloff: true });
    const core = new Mesh(new SphereGeometry(0.45, 12, 10), kit.glow('plum', 1.2));
    core.position.set(...WELL);
    ctx.scene.add(core);
    world.createCollider(RAPIER.ColliderDesc.ball(0.45), world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...WELL)));
    const orbiters: RAPIER.RigidBody[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 2.5 + (i % 3) * 0.8;
      const at: Vec3 = [WELL[0] + Math.cos(a) * r, 0.4 + (i % 2) * 0.6, WELL[2] + Math.sin(a) * r];
      if (i % 2) orbiters.push(kit.crate(at, { size: 0.45, color: i % 4 === 1 ? 'red' : 'sky', side: 'white', density: 1 }).body);
      else {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...at).setLinearDamping(0.2));
        world.createCollider(RAPIER.ColliderDesc.ball(0.22).setDensity(1).setRestitution(0.3), body);
        const mesh = new Mesh(new SphereGeometry(0.22, 10, 8), toonMaterial(PALETTE.lime));
        mesh.castShadow = true;
        setLookLayer(mesh, 'actors');
        ctx.scene.add(mesh);
        physics.bind(body, mesh);
        orbiters.push(body);
      }
    }
    const wellMode = (mode: 'pull' | 'push' | 'off') => {
      well.enabled = mode !== 'off';
      well.radial = mode === 'push' ? wellStrength * 1.6 : -wellStrength;
    };
    kit.pad([WELL[0] - 3, 0, 10.4], { label: 'PULL', color: 'plum', group: 'well', initial: true, note: 'A sphere field pulling toward its centre, stronger near it (falloff).', apply: () => wellMode('pull') });
    kit.pad([WELL[0], 0, 10.4], { label: 'PUSH', color: 'red', group: 'well', note: 'The same field pushing out: everything is flung away.', apply: () => wellMode('push') });
    kit.pad([WELL[0] + 3, 0, 10.4], { label: 'OFF', color: 'slate', group: 'well', note: 'The well off: things just fall and roll.', apply: () => wellMode('off') });
    kit.label([WELL[0], 3.4, WELL[2]], 'GRAVITY WELL', { color: 'plum', range: 11 });

    // ---------------------------------------------------------------- launch pads
    kit.box(TOWER, [3, 0.4, 3], 'orange', { side: 'red' });
    kit.box([TOWER[0], TOWER[1] / 2 - 0.1, TOWER[2]], [1, TOWER[1] - 0.2, 1], 'slate', { side: 'night' });
    let launches = 0;
    const springs = LAUNCHERS.map((l) => {
      const mesh = new Mesh(new CylinderGeometry(0.75, 0.85, 0.2, 14), kit.glow('lime', 0.6));
      mesh.position.set(l.at[0], 0.1, l.at[2]);
      ctx.scene.add(mesh);
      physics.trigger({ box: [0.7, 0.3, 0.7] }, [l.at[0], 0.3, l.at[2]], {
        tag: 'character',
        onEnter: () => {
          const h = room.hero?.hero;
          if (!h) return;
          h.launch(l.vy, l.hz ? { hvel: new Vector3(0, 0, l.hz) } : {});
          launches++;
          squash = { mesh, t: 0 };
          ctx.particles.burst('dust', l.at, { count: 12 });
          ctx.audio.play('doubleJump');
        },
      });
      kit.label([l.at[0], 0.6, l.at[2] - 1.1], l.label, { color: 'lime', range: 8, small: true });
      return mesh;
    });
    let squash: { mesh: Mesh; t: number } | null = null;

    kit.light({ position: [-8, 3, 5], color: PALETTE.plum, intensity: 6, radius: 8, flicker: 'none' });
    kit.light({ position: [6, 5, -6], color: PALETTE.cyan, intensity: 5, radius: 10, flicker: 'none' });
    kit.light({ position: [0, 5, 4], color: PALETTE.white, intensity: 3, radius: 14, flicker: 'none' });

    const knobs: Knob[] = [
      { id: 'fan', label: 'Fan wind', min: 0, max: 40, step: 1, get: () => fanSpeed, set: (v) => ((fanSpeed = v), setWind()), format: (v) => `${v} m/s²`, initial: 16 },
      { id: 'updraft', label: 'Updraft', min: 0, max: 100, step: 2, get: () => lift, set: (v) => ((lift = v), vents.forEach((f) => (f.force = [0, v, 0]))), format: (v) => `${v} m/s²`, initial: 90, hint: 'The hero falls at 32 m/s² (bodies at 24): they float where the faded push equals that.' },
      { id: 'well', label: 'Well pull', min: 0, max: 60, step: 1, get: () => wellStrength, set: (v) => ((wellStrength = v), (well.radial = well.radial! > 0 ? v * 1.6 : -v)), format: (v) => `${v} m/s²`, initial: 22 },
    ];
    let t = 0;
    return {
      knobs,
      update(dt) {
        t += dt;
        fan.rotation.x += dt * (wind.enabled ? fanSpeed * fanDir * 0.6 : 0);
        gem.rotation.y += dt * 2;
        core.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
        if (squash) {
          squash.t += dt;
          const k = Math.max(0, 1 - squash.t / 0.25);
          squash.mesh.scale.set(1 + k * 0.3, 1 - k * 0.6, 1 + k * 0.3);
          if (k === 0) squash = null;
        }
        // show the fields with a few particles
        if (Math.floor(t * 10) !== Math.floor((t - dt) * 10)) {
          if (wind.enabled) ctx.particles.burst('streak', [fanDir > 0 ? TUNNEL.x0 + 0.5 : TUNNEL.x1 - 0.5, 0.5 + ((t * 7.3) % 2.4), TUNNEL.z + (((t * 3.1) % 3) - 1.5)], { direction: [fanDir, 0, 0], speed: fanSpeed / 10 });
          for (const v of VENTS) ctx.particles.burst('streak', [v[0] + (((t * 5.7) % 1.4) - 0.7), 0.2, v[2] + (((t * 3.9) % 1.4) - 0.7)], { direction: [0, 1, 0], speed: lift / 40 });
          if (well.enabled) {
            const a = t * 2.3;
            const out = (well.radial ?? 0) > 0;
            ctx.particles.burst('sparkle', [WELL[0] + Math.cos(a) * (out ? 0.6 : 4), WELL[1], WELL[2] + Math.sin(a) * (out ? 0.6 : 4)], { count: 2, direction: [Math.cos(a) * (out ? 1 : -1), 0, Math.sin(a) * (out ? 1 : -1)] });
          }
        }
      },
      status: () => `wind ${wind.enabled ? fanSpeed * fanDir : 0} well ${well.enabled ? well.radial : 0} launches ${launches}`,
      api: {
        launches: () => launches,
        /** How many orbiters are within `r` of the well's centre. */
        gathered: (r = 2.2) => orbiters.filter((b) => new Vector3(b.translation().x - WELL[0], b.translation().y - WELL[1], b.translation().z - WELL[2]).length() < r).length,
        well: (mode: 'pull' | 'push' | 'off') => wellMode(mode),
        crates: () => orbiters.length,
        springs: () => springs.length,
      },
    };
  },
};
