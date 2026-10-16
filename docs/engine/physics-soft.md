# Soft bodies, ragdolls, water (`src/engine/physics/`)

## Soft bodies: cloth, ropes, jelly

```ts
const flag = clothGrid({ width: 2.4, height: 1.5, cols: 14, rows: 9, origin: [x, 4, z], pin: 'left' });
flag.wind = [6, 0, 1];
const sheet = clothGrid({ ..., down: [0, 0, 1], pin: 'none' });      // laid flat: it falls and drapes
const rope = ropeLine([0, 3.4, 0], [0, 0.7, 0], 12);
const jelly = softBlob([0, 0.8, 0], 0.8, { pressure: 0.6 });
body.spheres.push(heroSphere); body.boxes.push(tableBox); body.floor = 0;
scene.add(new SoftMesh(flag, toonMaterial(PALETTE.red), { uv: flag.uv }), new RopeMesh(rope, mat, 0.07));
// per fixed step: body.step(dt); per frame: mesh.sync()
```

`physics/verlet.ts` (pure, unit-tested): particles moved by Verlet integration, then a few
passes of constraints (edges back to their rest lengths, pins, the floor, spheres and boxes,
and for blobs a pressure that keeps the volume). Cloth gets wind per triangle: pressure along
its normal growing with the relative speed squared, plus skin drag along it, shared out by area
so a finer cloth flaps the same; ropes are pulled toward the wind's speed. `drag`, `gust`,
`iterations` and `pressure` change live. Soft bodies react to colliders you give them; they
don't push back. `SoftMesh` re-uploads the positions and normals each frame (double-sided
copy of the material); `RopeMesh` is one instanced box per segment.

## Ragdolls

```ts
const doll = new Ragdoll(physics, model, HERO_RAGDOLL);   // parts: a capsule per joint, how it hangs
doll.enable({ velocity: [0, 1, 3] });                     // bodies from the model's pose this frame
doll.push(hitPoint, [0, 1, 4]);                           // the nearest part gains this velocity
// per frame, after the physics update (stop the model's mixer meanwhile): doll.sync()
const blend = doll.release({ ground: (x, z) => groundY, offset: getUpStartPelvis });
mixer.clipAction(getUp).reset().play();                  // then per frame: mixer.update(dt); blend.apply(t / 0.35)
```

`physics/ragdoll.ts` turns a jointed model (a hierarchy of named Object3D joints with rest
rotations at identity, like the hero's) into one dynamic body per listed part, a capsule from
the joint toward `to`. A part hangs from its `parent` by a hinge about the joint's local X with
limits in degrees (`hinge: [min, max]`: knees, elbows, Rapier's revolute joint) or a ball joint
whose swing is held inside a `cone` (degrees: after every physics step a part past the cone is
turned back onto its edge, carrying the parts below it along, and the spin carrying it further
out is removed; a part touching something may sit up to 12° past it, so a head pressed into a
stair doesn't shake against it and the ragdoll comes to rest. Kept outside the solver, the
limits can still nudge a resting part by hairs, enough to keep its bodies awake). Parts collide with the world but not with any ragdoll's parts (a collision
group of their own). `sync()` writes the bodies into the joints
between the last two physics steps. `rootPose()` says where the pelvis lies, whether face up,
and the heading to get up with; `release()` removes the bodies, moves the model root under the
pelvis (`ground` a height or a function called once the bodies are gone; `offset` the next clip's
first-frame pelvis position, so the blend doesn't slide), and returns a blend from the ragdoll
pose to whatever animation writes next (it follows each joint the mixer writes, and holds the
rest where the mixer last left them). `HERO_RAGDOLL` (src/game/hero/ragdoll.ts, exported by the
engine kit) is the hero's eleven parts. Part sizes and `offset` are in metres at the model's
scale 1 (scale them for a scaled model); a hinge part twisted off its X axis when enabled snaps
onto it in the first step (the hero's clips bend elbows and knees about X only).

## Water and buoyancy

```ts
const ripples = new RippleField({ size: [14, 8], cells: [112, 64], center: [0, -6] });
const water = new WaterSurface({ size: [14, 8], at: [0, -0.2, -6], waves: WAVES_CALM, ripples, opacity: 0.6 });
scene.add(water);
const floaters = new Floaters(physics.world, (x, z) => (water.covers(x, z) ? water.heightAt(x, z, physics.time) : null), { onSplash });
floaters.add(crate.body);
ripples.splash(x, z, 0.4, 0.06);                 // a footstep, a raindrop, a splash
// per fixed step: floaters.step(dt); ripples.step(dt)   per frame: water.update(physics.time, engine.sunDir)
water.setWaves(WAVES_CHOPPY);
```

`physics/water.ts` (pure, unit-tested) sums travelling waves (`waterHeight`) and runs the 2D
wave equation on a grid (`RippleField`: dents spread as rings, bounce off the edges, die
away). `WaterSurface` moves a grid of vertices by the same waves in its vertex shader (up to
four, as uniforms) plus the ripple heights (a small float texture), lights them from the
waves' own slopes, lightens crests, puts foam on the highest and hard pixel sun glints, and
can be see-through by an ordered dither (`opacity`, a uniform: no blending, no sorting).
`Floaters` (`physics/buoyancy.ts`) splits each body into eight octants: each one under the
surface pushes up, at its centre, by the weight of the water it displaces (how deep its own
turned height is in; water density 1 in world mass units), so bodies tilt with the waves,
right themselves and float whichever way up they land; water drag slows them; `onSplash`
fires when one comes down into the water fast. The volume comes from the collider's shape (box,
ball, capsule, cylinder or cone).
