# Procedural motion

Clips, foot IK, gaits and the animation tools are docs/ANIMATION.md; this is motion worked out per frame.

`src/engine/animation/procedural.ts` (pure, unit-tested) is motion worked out every frame
from other motion, for things that are not hero clips:

```ts
const scarf = new SpringChain({ segments: 7, length: 0.13, rest: [0, -0.25, -1], stiffness: 6 });
scarf.update(dt, rootWorldPosition, [right, up, forward]);   // then draw between scarf.points
const squash = new Squash();                                   // squash.kick(-5) on landing
squash.update(dt); const [h, v] = squash.scale(); mesh.scale.set(h, v, h); // keeps the volume
const legs = new LegStepper({ legs: rests.map((rest, i) => ({ rest, partners: gaitPartners(6)[i] })) });
legs.update(dt, body, yaw, velocity, groundHeightAt);          // legs.feet[i].at: planted or stepping
const knee = twoBoneIK(hip, legs.feet[0].at, thigh, shin, pole);
```

- `SpringChain`: points hanging off a moving root that keep their velocity, sag under
  gravity, are pulled toward their rest direction in the root's axes, and keep their
  lengths: scarves, tails, antennae (follow-through for free). It steps at a fixed 120 Hz
  (the root moving evenly between frames), so it swings the same at any frame rate.
- `Squash`: a damped spring on one number drawn as a volume-preserving scale.
- `LegStepper`: a foot stays where it is in the world until it is `threshold` from its
  target (its rest spot, ahead by `lead` × velocity, on the ground), then steps there in an
  arc, but only while its `partners` are planted (partners are mutual); `gaitPartners(n)`
  gives six legs a tripod and four a trot.
- `twoBoneIK`: the middle joint of a two-bone limb in 3D, bent toward a pole (the law of
  cosines; out of reach straightens toward the target, too close folds as far as it goes).
