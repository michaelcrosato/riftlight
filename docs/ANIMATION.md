# Animation system

Animations are **plain data** that agents write, measure and look at, then adjust. There is no
DCC tool and no baked clips in the GLB. `src/game/hero/animations.ts` holds every hero clip.
At runtime (and in the tools) the clips are compiled against the model's joints.

```
animations.ts ──► ClipDef (keys, feet track, layers) ──► compileClip() ──► three.js AnimationClip
        ▲                                                   │
        │   npm run anim -- check / sheet                   ├─► game (PlatformerCharacter)
        └── agent edits numbers ◄── metrics + contact sheets ◄┘   Animation Lab (/lab.html)
```

## The loop

1. Edit a clip in `src/game/hero/animations.ts`.
2. `npm run anim -- check Walk` prints the metrics table. The command exits 1 on problems.
3. `npm run anim -- sheet Walk` writes `.scratch/anim/Walk.png`. Open the PNG to look at it.
4. Optionally run `npm run dev` and open `/lab.html?clip=Walk`. The clip plays in the real
   renderer and hot-reloads on save.
5. Repeat until the sheet looks right and `check` is clean. Unit tests fail on any problem
   (`src/engine/animation/animation.test.ts`).

### What the tools show you

**Metrics** (`analyzeClip`) come from actually posing the model:

| metric | meaning | problem / warning |
| --- | --- | --- |
| `soleMin` (+ frame) | lowest point of either shoe | < −3 cm: feet through the floor (every clip, airborne too; the capsule bottom is the floor) |
| body (+ mesh, frame) | lowest point of any other part (knees, hands, head, hat) | < −5 cm problem, < −2 cm warning |
| `slide` | how fast floor-touching sole vertices move, compared with the clip's `speed` | grounded clips: > 0.6 m/s problem, > 0.3 m/s warning; other clips with a feet track: > 0.6 m/s warning ("feet drag") |
| `seam°` | largest joint jump between the last and first frame of a loop | > 3°, or > 0.01 in position/squash |
| `fastest` | fastest joint rotation | > 1200°/s warning, unless the clip is `fast: true` |
| limits | joint angles outside `rig.limits` | warning |
| `pelvisY` | how much the body bobs | — |

**Contact sheets** (`renderSheet`) are drawn by a small software rasterizer, so they need no GPU:

- Rows show the side, front, 3/4 and top views. Columns show frames (by default the key
  frames, marked `*`).
- The skeleton overlay colours the right side orange, the left side cyan and the centre
  yellow.
- A green bar under a shoe means it's on the floor; a red bar means it's through the floor.
- **TRAIL**: onion-skinned stick figures, plus paths of the hands, feet and head over two
  cycles. For locomotion the figures travel at the clip's speed, so a planted foot shows as
  a single point and a sliding foot shows as a smear.
- Problems and warnings are printed underneath.

Other commands:

- `npm run anim -- overview [clips]` shows every clip as a side-view strip in one PNG.
- `npm run anim -- pose Run 3` prints JSON: the authored rotations and the world positions of
  every joint and sole.
- `--json` makes any command's output machine-readable.

**Animation Lab** (`/lab.html`, built as a second page):

- Pick a clip, play or pause it, scrub it frame by frame (`,` and `.`), and set the playback
  speed.
- Views: side, front, 3/4, top and orbit.
- Toggle Pixel / Raw 3D, the skeleton and the treadmill grid. The grid scrolls at the clip's
  speed, so planted feet stick to it.
- The panel shows the clip's metrics and can open its contact sheet.
- URL: `?clip=Run&view=side&frame=6&speed=0.25&paused=1`.
- Agent handle, `window.__ANIM_LAB__`:
  - `clips()`, `select(name)`, `seek(frame)`, `play()`, `pause()`, `state()`
  - `pose()`: joint rotations and world positions
  - `metrics(name)`
  - `sheet(name)`: PNG data URL
  - `capture()`: the rendered frame as a PNG data URL

## Writing clips

The format is described in `src/engine/animation/types.ts`. The rotation cheat-sheet is in
`src/game/hero/rig.ts`.

- **Frames at 30 fps.** `frames: 24` lasts 0.8 s. Keys are `[frame, pose, ease?]`, where the
  ease applies to the span that follows the key: `linear`, `in`, `out`, `inOut` (the default),
  `hold`, `inBack` or `outBack`.
- **Full poses.** Any joint missing from a key is at rest. Share poses by spreading them:
  `{ ...CROUCH_BODY, Head: [-10, 0, 0] }`.
- **Degrees, Euler XYZ, relative to rest.** Values interpolate per axis, so a front flip is
  simply `Pelvis: { r: [360, 0, 0] }`.
- **Root.** On `Pelvis`, `p` is an offset in metres from standing, and `s` is squash &
  stretch. Use the `squash(0.1)` helper for it.
- **Friendly limb helpers** in `animations.ts`:
  - `arm(side, swing, out, elbow, wrist)`: swing −90 = ahead, −180 = overhead; `out` is
    positive away from the body.
  - `leg(side, swing, out, knee, toes)`.
- **Feet are IK, not angles.** Anything standing on the floor pins its feet:
  - `F(body, { R: { z: 0.1 }, L: { z: -0.05, pitch: 30, pivot: 'ball' } })` solves the legs
    for one pose.
    - `z` is the forward position, `y` the height above the floor.
    - `pitch` is the sole angle; positive raises the heel.
    - `pivot` is the point the foot pivots on while pitched: `'heel'`, `'ball'` (toe tip) or
      `'ankle'`.
  - `track([[frame, body, feetGoals | null, ease?], ...])` does the same per key, and also
    emits a **feet track**. Wherever two neighbouring keys both have goals, the legs are
    re-solved **every frame**, so feet stay planted or roll through transitions (kneel → stand,
    sit → lie). `null` means the legs follow the keyed angles (airborne, lying).
  - The ankle position accounts for the root's offset, rotation and squash. It is exact for
    pitch; yaw and roll are approximated, because the solve stays in the leg's own plane.
    The foot's sole angle ignores squash.
  - Knees never fold past 150°. Gaits also keep the swinging ankle out of the last 10°, so
    legs don't whip.
  - `validateClip` rejects keys whose legs don't match their own feet goals. Build keys
    with `track()` or `placeFeet()`, and the hand-off between keyed and solved legs stays
    continuous.
- **Locomotion comes from `gaitClip`**, not keys. You describe the gait:
  - `speed`, `frames` per cycle, `stance` fraction, `hip` height, `bob`, `squash`
  - `lift`, `heelStrike`, `toeOff`, `tiptoe`, `lean`, `twist`, `sway`
  - arm `swing`, `elbow`, `pump`, `spread`, `forward`, `lag`

  From that, each foot is planted and slides back at exactly `speed` during stance, then
  swings forward on an arc that clears the floor by `lift`. The result has zero foot slide
  by construction. `speed` is stored on the compiled clip, and `PlatformerCharacter` scales
  playback so the feet match the real ground speed.
- **Layers** add a sine wave on one channel (breathing, sway). For loops, `period` must divide
  `frames`.
- `mirrorClip(clip, 'ShimmyLeft', RIG)` builds the other side's clip, including its feet
  track.
- Somersaults (`somersault()` / `spinRoot()` in `animations.ts`) turn the body around its
  middle, not the hips, so the head stays inside the character's capsule.
- `blend(a, b, t)` and `offset(pose, deltas)` build pose variations.
- `fast: true` marks snappy moves (flips, punches, launches), so the fast-rotation warning is
  skipped. `grounded: true` turns on the slide and floating checks. `notes` is printed on
  sheets and in the Lab.

## Adding a character

1. Build a jointed rig (see `scripts/assets/hero.mjs`). Joints are named `Object3D`s, meshes
   hang off them, and the model faces +Z with its feet at y = 0.
2. Describe it in a `RigSpec`:
   - joints (in hierarchy order)
   - `root`
   - `mirror` pairs
   - sole meshes
   - trace points
   - limits
   - `legs` geometry (for IK and gaits)
3. Write its `ClipDef[]` and register it in `CHARACTERS` in `scripts/anim.ts`.
4. At runtime, capture `const rest = restPoseOf(model, rig)` **once, before anything plays**.
   Then pass `defs.map((d) => compileClip(d, rig, rest))` to
   `PlatformerCharacter.attachModel(model, clips)`. `compileClips(defs, rig, model)` is a
   shortcut that reads the rest pose from the model, so only use it on a model that hasn't
   animated yet. Calling `attachModel` again swaps the clip set; the playground does this on
   hot reload, using the saved rest pose.
