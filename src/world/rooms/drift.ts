/**
 * Drift Track: a little car on Rapier's ray-cast vehicle controller. Step into it (pad), drive
 * round a track of cones with the movement keys, pull the handbrake to slide the tail out, and
 * leave skid marks where the rear tyres slip. Everything about the car is tunable live.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh, Quaternion, Vector3 } from 'three/webgpu';
import { Decals, PALETTE, RAPIER, setLookLayer, toonMaterial, Vehicle } from '../../engine';
import type { Knob, RoomDef } from '../types';

const UP = new Vector3(0, 1, 0);

export const DRIFT: RoomDef = {
  id: 'drift',
  title: 'Drift Track',
  wing: 'genres',
  about:
    'A little car on a ray-cast vehicle: four wheels that are rays with springs, each with grip along and across. Get in, drive round the cones, and pull the handbrake (Space) in a corner: the rear tyres lose their grip and the tail swings out. Skid marks show where they slid.',
  try: ['Step on DRIVE and lap the cones', 'Handbrake (Space) into a corner: drift', 'Less grip, more power (T)', 'EXIT on C'],
  spawn: [0, 0, 9],
  facing: Math.PI,
  background: 'teal',
  guide: {
    what: 'An oval of cones on a big yard, a car, pads to get in and to put it back on its wheels, skid marks, and the car\'s settings.',
    how: [
      'The car is one dynamic box (the chassis). Each wheel is a ray cast down from the chassis: where it hits, a spring and damper (the suspension) pushes the chassis up, so it rolls and pitches on its springs.',
      'At each contact the tyre pushes along its heading (the engine on the rear wheels, the brakes on all four) and resists sliding sideways up to a limit (the friction slip: grip). Past the limit it slides.',
      'Steering turns the front wheels\' rays, less at speed (stable at 20 m/s, nimble at 5). The handbrake locks the rear wheels and cuts their sideways grip, and (the arcade part) pushes the car round toward the steering: the rear slides out while the front still steers, which is a drift.',
      'How much it slides is the slip angle: between where the car points and where it is going. Past about 17 degrees the rear tyres leave skid marks (decals on the ground) and smoke.',
      'While you drive, the hero is out of the world (no body, not drawn) and the camera follows the car; getting out (slowly) puts the hero back beside it, on the first side where a hero-sized capsule fits: right, left, ahead, behind.',
    ],
    uses: [
      'Arcade racers and kart games: Mario Kart, Ridge Racer, Rocket League (cars are ray-cast vehicles there too).',
      'Vehicles in open worlds: GTA, Just Cause, Halo\'s Warthog.',
    ],
    ask: ['a drivable car with suspension', 'drifting with a handbrake', 'skid marks', 'get in and out of a vehicle'],
    cost: 'Four rays per car per physics step and a little math per wheel. Skid marks reuse a fixed pool of decals.',
    code: [
      {
        title: 'A wheel is a ray with a spring',
        file: 'src/engine/physics/vehicle.ts',
        src: `this.controller.addWheel({ x: m[0], y: m[1], z: m[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, this.o.suspension, r);`,
      },
      {
        title: 'The handbrake: the rear tyres lose their sideways grip',
        file: 'src/engine/physics/vehicle.ts',
        src: `c.setWheelSideFrictionStiffness(i, rear && hb ? 0.05 : 1);`,
      },
    ],
    words: ['vehicle', 'suspension', 'raycast', 'decal'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(40, 30, { floor: ['slate', 'night'], wall: { color: 'teal', side: 'navy', height: 1 } });
    // the cones: an oval
    const cone = new CylinderGeometry(0.05, 0.25, 0.6, 8).translate(0, 0.3, 0);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      for (const r of [5.5, 11]) {
        const m = new Mesh(cone, toonMaterial(i % 2 ? PALETTE.orange : PALETTE.white));
        m.position.set(Math.cos(a) * r * 1.3, 0, Math.sin(a) * r * 0.8);
        m.castShadow = true;
        ctx.scene.add(m);
      }
    }
    const car = new Vehicle(ctx.physics, { at: [-9, 1, 0], yaw: Math.PI });
    // the car's look: a body and a cabin on the chassis, drawn between physics steps by a
    // binding; the wheels are its children, posed in the chassis' own space
    const body = new Group();
    const shell = new Mesh(new BoxGeometry(1.8, 0.5, 3.4), toonMaterial(PALETTE.red));
    shell.position.y = 0.05;
    const cabin = new Mesh(new BoxGeometry(1.5, 0.45, 1.6), toonMaterial(PALETTE.sky));
    cabin.position.set(0, 0.5, -0.2);
    body.add(shell, cabin);
    const wheels = [0, 1, 2, 3].map(() => {
      const w = new Mesh(new CylinderGeometry(0.38, 0.38, 0.3, 12).rotateZ(Math.PI / 2), toonMaterial(PALETTE.ink));
      body.add(w);
      return w;
    });
    for (const m of [shell, cabin, ...wheels]) {
      m.castShadow = true;
      setLookLayer(m, 'actors');
    }
    ctx.scene.add(body);
    ctx.physics.bind(car.body, body);
    const decals = new Decals(ctx.scene, { capacity: 400 });
    let driving = false;
    let scripted = false; // driven by the test hooks, not the keyboard
    let skid = 0;
    let marks = 0;
    let topSpeed = 0;
    const getIn = () => {
      if (driving || !room.hero?.hero) return;
      room.leaveWorld();
      driving = true;
      room.toast('Driving: W/S or up/down, A/D or left/right, Space handbrake, C to get out.', 4);
    };
    // getting out: beside the car (right, left), then ahead and behind, on the ground, where a
    // hero-sized capsule touches nothing
    const capsule = new RAPIER.Capsule(0.5, 0.35);
    const hit = { y: 0, nx: 0, ny: 0, nz: 0, id: 0 };
    const EXITS: [number, number][] = [
      [-1.9, 0],
      [1.9, 0],
      [0, 2.9],
      [0, -2.9],
    ];
    const NO_ROT = { x: 0, y: 0, z: 0, w: 1 };
    const exitSpot = (): [number, number, number] | null => {
      const t = car.body.translation();
      const yaw = car.yaw;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (const [lx, lz] of EXITS) {
        const x = t.x + lx * c + lz * sn;
        const z = t.z - lx * sn + lz * c;
        if (!ctx.physics.castDown(x, t.y + 2, z, 6, hit)) continue;
        const free = !ctx.physics.world.intersectionWithShape({ x, y: hit.y + 0.95, z }, NO_ROT, capsule, undefined, undefined, undefined, car.body);
        if (free) return [x, hit.y + 0.05, z];
      }
      return null;
    };
    const getOut = () => {
      if (!driving) return false;
      if (Math.abs(car.speed) > 2) {
        room.toast('Slow down to get out.', 1.5);
        return false;
      }
      const at = exitSpot();
      if (!at) {
        room.toast('No room to get out here.', 1.5);
        return false;
      }
      driving = scripted = false;
      room.enterWorld(at, car.yaw);
      return true;
    };
    kit.pad([-9, 0, 4.5], { label: 'DRIVE', color: 'red', note: 'Get in the car: the hero leaves the world and the camera follows the car.', apply: getIn });
    kit.pad([0, 0, 4.5], { label: 'FLIP BACK', color: 'sky', note: 'Put the car back on its wheels at the start.', apply: () => car.reset([-9, 1, 0], Math.PI) });
    const knobs: Knob[] = [
      { id: 'grip', label: 'Grip', min: 0.5, max: 5, step: 0.1, get: () => car.o.grip, set: (v) => (car.o.grip = v), initial: 2.2, hint: 'How much sideways force the tyres hold before they slide.' },
      { id: 'power', label: 'Engine', min: 10, max: 80, step: 5, get: () => car.o.power, set: (v) => (car.o.power = v), initial: 30 },
      { id: 'top', label: 'Top speed', min: 6, max: 30, step: 1, get: () => car.o.topSpeed, set: (v) => (car.o.topSpeed = v), format: (v) => `${v} m/s`, initial: 16 },
      { id: 'stiffness', label: 'Suspension', min: 5, max: 80, step: 1, get: () => car.o.stiffness, set: (v) => car.setSuspension(v), initial: 28, hint: 'Soft: it rolls and pitches. Stiff: a go-kart.' },
    ];
    const pos = new Vector3();
    const rot = new Quaternion();
    const input = { throttle: 0, steer: 0, brake: false, handbrake: false };
    return {
      knobs,
      fixedUpdate(dt) {
        const inp = e.input;
        if (driving && !scripted) {
          if (room.inputFree) {
            // keys (or a stick): up is forward; pulling back while rolling forward brakes, and
            // only reverses once stopped (and the other way round)
            const ax = inp.moveAxis();
            const keyY = (inp.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (inp.isDown('KeyS', 'ArrowDown') ? 1 : 0);
            const keyX = (inp.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (inp.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
            const want = keyY || ax.y;
            const v = car.speed;
            input.brake = (want < 0 && v > 1) || (want > 0 && v < -1);
            input.throttle = input.brake ? 0 : want;
            input.steer = keyX || ax.x;
            input.handbrake = inp.isDown('Space');
            if (inp.consumePress('KeyC')) getOut();
          } else Object.assign(input, { throttle: 0, steer: 0, brake: false, handbrake: false });
        } else if (!driving) {
          input.throttle = input.steer = 0;
          input.handbrake = false;
          input.brake = true;
        }
        car.drive(input, dt);
        topSpeed = Math.max(topSpeed, Math.abs(car.speed));
        // skid marks under the rear wheels while the tail slides, laid along the chassis
        skid = Math.max(0, skid - dt);
        const lv = car.body.linvel();
        if (car.slipAngle > 0.3 && Math.hypot(lv.x, lv.z) > 2 && skid === 0) {
          skid = 0.04;
          for (let i = 2; i < 4; i++) {
            car.wheelPose(i, pos, rot);
            decals.add('splat', pos.setY(0.01), UP, { size: 0.35, color: PALETTE.ink, life: 6, rotation: car.yaw });
            marks++;
          }
          if (Math.random() < 0.3) ctx.particles.burst('smoke', pos, { count: 2 });
        }
      },
      update(dt) {
        decals.update(dt);
        wheels.forEach((w, i) => car.wheelPose(i, w.position, w.quaternion, true));
      },
      cameraTarget: () => (driving ? body.position : null),
      dispose() {
        car.dispose();
      },
      status: () => `driving ${driving} speed ${car.speed.toFixed(1)} slip ${((car.slipAngle * 180) / Math.PI).toFixed(0)}°`,
      api: {
        getIn,
        getOut,
        driving: () => driving,
        speed: () => car.speed,
        slip: () => car.slipAngle,
        top: () => topSpeed,
        marks: () => marks,
        car: () => {
          const t = car.body.translation();
          return [t.x, t.y, t.z];
        },
        /** Drive without the keyboard (tests): throttle, steer, handbrake. */
        drive: (throttle: number, steer: number, handbrake = false) => {
          if (!driving) getIn();
          scripted = true;
          Object.assign(input, { throttle, steer, handbrake, brake: false });
        },
        /** Back to the keyboard (tests): the keys drive again. */
        keys: () => {
          if (!driving) getIn();
          scripted = false;
        },
      },
    };
  },
};
