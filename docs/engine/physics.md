# Physics (`src/engine/physics/`)

Triggers, movers, force fields, joints, destruction, instanced bodies, vehicles and bullets. Soft bodies, ragdolls and water: docs/engine/physics-soft.md.

## Triggers and collision events

```ts
const coin = physics.trigger({ cylinder: { halfHeight: 0.6, radius: 0.45 } }, [x, y + 0.5, z], {
  tag: 'character',          // only the hero (PlatformerCharacter tags its collider)
  once: true,                // removes itself after the first enter
  onEnter: (other, trigger) => collect(),
  onExit: (other) => {},
});
const zone = physics.trigger({ box: [2, 1, 2] }, [0, 1, 0], { onEnter: () => alarm() });
zone.position.set(4, 1, 0);  // movable; zone.enabled = false; zone.remove()
```

Shapes: `{ box: [hx, hy, hz] }`, `{ sphere: r }`, `{ capsule: { halfHeight, radius } }`,
`{ cylinder: { halfHeight, radius } }`. A trigger is not a collider: after every fixed step
Physics runs a Rapier intersection query for it and diffs the result, so it never blocks the
character, ray casts or the camera. It reports dynamic and kinematic bodies (set
`includeStatic` for level geometry); `filter(collider)` narrows further.

## Moving platforms and conveyors

```ts
const lift = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
physics.addMover(lift, { path: [[0, 0, 0], [0, 4, 0]], speed: 1.5, hold: 1 });     // pingpong, eased legs
physics.addMover(disc, { spin: [0, 0.8, 0] });                                      // rad/s
physics.addMover(blade, { swing: { axis: [0, 0, 1], angle: 60, period: 2.2 } });
physics.addMover(seat, { curve: orbit([0, 3, 0], 2.5, 12, { start: Math.PI / 2 }) }); // a Ferris wheel seat
physics.addMover(swing, { curve: pendulum([0, 9, 0], 5, 30, 6) });                 // level, on an arc
physics.conveyor(beltCollider, [2, 0, 0]);       // m/s: drags what touches it; the hero rides it
const look = beltMaterial(PALETTE.slate, PALETTE.night, { length: 10, speed: 2 }); // look.advance(dt)
```

A mover (`physics/movers.ts`, pure, unit-tested) drives a kinematic body as a **pure function
of its own clock** (`mover.time`: 0 when it was added, and the body starts where that says, so
a level starts the same whatever ran before): the same at any frame rate, in `engine.step()`
and in replays. `mover.set()` changes it (it jumps to where the new options say it is now;
keep a turn continuous with `phase`); removing its body stops it. Before every fixed step
Physics poses every mover, then the game's `fixedUpdate`
runs, so the character standing on one reads where it goes this step and moves with it:
`PlatformerCharacter` finds the collider under its feet (`groundCollider`), and for a
kinematic body adds the platform's motion at that point (next pose × this pose⁻¹, turns
included: a turntable turns the character too); for a dynamic one (a rope bridge's plank) it
follows the body's velocity there and presses it down with its `weight` (0 by default: set it
and a rope bridge sags where the character stands); for a conveyor it
adds the belt's speed. A kinematic body coming down on the head with the floor underneath
crushes the character: `crushed` and `stats.crushes` say so, the game decides what happens
(Engine World respawns). Bodies a mover carries ride by friction. `beltMaterial` scrolls
stripes on game time.

## Force fields and explosions

```ts
physics.fields.add({ box: [1, 4, 1], at: [4, 4, 0], force: [0, 90, 0], falloff: true, drag: 0.5 }); // an updraft
physics.fields.add({ sphere: 5, at: [0, 1, 0], radial: -20, falloff: true });                     // a gravity well
physics.fields.add({ box: [5, 1.6, 2], at: [0, 1.6, 6], force: [16, 0, 0] });                     // a wind tunnel
physics.explode([0, 0.5, 0], { radius: 4, impulse: 12 });   // returns how many bodies it pushed
```

A field (`physics/forces.ts`) is a box or a sphere with an acceleration in a direction, toward
or away from its centre (`radial`), optionally weaker toward the edge or the top (`falloff`),
with optional `drag`. Every fixed step every dynamic body inside gets it (× its mass: light and
heavy alike); the character reads it at its chest: in the air it changes the velocity (an
updraft lifts, the drag settles the bobbing; a rise in an updraft isn't cut short by letting go
of jump), standing it drifts the feet by `TUNING.body.windGrip`, and an upward push stronger
than the character's gravity (32 m/s²) lifts it off. `character: false` / `bodies: false` limit
who it pushes (and drags); `enabled`, `force` and `radial` change live.
`character.launch(vy, { hvel })` throws the character up on an arc the jump button can't cut
short (trampolines, geysers, a blast).

## Joints: chains, bridges, doors, spring pads, seesaws

```ts
const wrecker = chain(ctx, [0, 6.4, 0], { links: 10, end: { ball: 0.7, density: 6 } });
const bridge = ropeBridge(ctx, [-3, 0, 0], [3, 0, 0], { planks: 10, sag: 0.35 });
bridge.cut('to');                                // it swings down and hangs from the other end
hingeDoor(ctx, [8, 0, 3], { width: 1.2, swing: 110, closing: 4 });   // a spring swings it shut
springPad(ctx, [6, -0.15, -7], { stiffness: 40, travel: 0.7 });      // sinks under weight
seesaw(ctx, [-9, 0, 5], { length: 6 });
wrecker.remove();                                // bodies, joints and meshes
```

Builders in `physics/joints.ts` make Rapier bodies and impulse joints, bind toon meshes and
return `{ bodies, remove() }`. Chains are links on ball joints whose links weigh at least 1/15
of the end and get extra solver passes, so a heavy end stretches them by centimetres; bridges
are planks with two ball joints per seam. Doors and spring pads drive their joints with a
**force-based** motor scaled by the body's mass or inertia: Rapier's default (acceleration
based) motor holds against outside pushes, so a pad would not sink under the character.
Set `character.shove` (the most mass shoved at walking speed; 0, the default, makes dynamic
bodies walls) and walking into a door, a hanging bag or debris pushes it; bodies tagged
`pushable` are left to the push state. Ledges are only ever fixed bodies: hanging doesn't
ride, so a loose body or a moving platform is never grabbed.

## Destruction

```ts
const breaks = new Breakables(ctx);
const wall = breaks.add({ at: [0, 1.5, -5], size: [4, 3, 0.5], color: 'orange', cuts: [4, 3, 1], linger: 4 });
breaks.break(wall, punchPoint, 6);               // or breaks.near(at, reach), breaks.byCollider(handle)
breaks.restore(wall);
const tile = breaks.crumble({ at: [0, -0.25, 5], size: [1, 0.5, 1.4], color: 'sand', delay: 0.45, regrow: 4 });
// per frame: breaks.update(dt, hero.groundCollider)
```

`fractureBox` (`physics/fracture.ts`, pure, seeded) cuts a box along jittered planes (each
column its own horizontal cuts: bricks, not a grid), so the pieces tile it exactly. Breaking
swaps the static box for one dynamic body per piece, thrown from the hit (faster when close),
with an impact burst; after `linger` seconds the pieces dissolve (one shared dissolving toon
material per block) and leave the world. Crumbling tiles shake while stood on, drop, and grow
back.

## Many bodies: `InstancedBodies`

```ts
const balls = new InstancedBodies(physics, scene, { shape: 'ball', size: 0.22, capacity: 600, restitution: 0.3 });
balls.add([x, 8, z], { color: PALETTE.lime, velocity: [0, -2, 0] });
shots.spawn(at, { velocity });                   // when full, the oldest is reused (a cannon)
// per frame: balls.sync(physics.alpha);   balls.sleeping(), balls.recycle(y, to), balls.clear()
```

One `InstancedMesh` per shape (one draw call for hundreds of bodies), interpolated between the
last two steps like `physics.bind` (`physics.onStep` keeps the poses). `ccd: true` sweeps fast
ones. `physics.stepMs` is what a step of Rapier costs (smoothed); `physics.counts()` adds
joints, movers, fields and belts. `physics.clear()` (every unload) also restores gravity and
the solver's iterations, and drops movers, fields, belts and step listeners.

## Vehicles and bullets

```ts
const car = new Vehicle(physics, { at: [0, 1, 0], yaw: 0 });  // a box chassis on four ray wheels
// per fixed step: car.drive({ throttle, steer, brake, handbrake }, dt); car.speed, car.slipAngle
car.wheelPose(i, mesh.position, mesh.quaternion);           // per frame, for each wheel mesh
const pool = new BulletPool(4000);                          // bullets as numbers: no allocations
const spiral = emitter({ pattern: 'spiral', every: 0.06, count: 3, speed: 4.5, turn: 11 });
spiral.update(pool, dt, [0, 0], heroXZ); pool.step(dt, (x, z) => nav.walkable(x, z));
pool.killAll(pool.hits(heroX, heroZ, 0.15, 'enemy'));       // circle tests; pool.graze(x, z, 0.7, 'enemy') counts near misses once
```

`Vehicle` (physics/vehicle.ts) is Rapier's ray-cast vehicle with game defaults: suspension on
springs (`stiffness`, `setSuspension`), rear-wheel drive that gives out toward `topSpeed` (and
pushes at full strength against the motion, so reverse throttle brakes), steering that narrows
with speed, brakes (impulses per step, scaled by the car's mass) and a little rolling
resistance when coasting, and a handbrake that locks the rear, cuts its sideways grip and (the
arcade part, `driftYaw`, 0 for none) swings the car round toward the steering: a drift.
`speed` is along the heading; `slip` and `slipAngle` say how much it slides (skid marks).
`wheelPose(i, pos, rot, true)` gives a wheel in the chassis' space, for wheel meshes parented
to a chassis mesh that `physics.bind` draws between steps. `reset` puts it back on its wheels,
`dispose` removes it (`physics.clear()` frees vehicle controllers too). `BulletPool` (ai/bullets.ts) keeps position, velocity, life, radius,
team and kind in typed arrays with the live bullets packed at the front (a dead one swaps with
the last); `emitter` fires seeded patterns (`aimed`, `fan`, `ring`, `spiral`, `wave`, `burst`)
on a timer. Draw them with one instanced mesh (the Bullet Hell room does).
