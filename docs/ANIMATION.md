# Animation system

Animations are **plain data** that agents write, measure and look at, then adjust. There is no
DCC tool and no baked clips in the GLB. `src/game/hero/clips/` holds every hero clip, one file
per family:

| file | clips |
| --- | --- |
| `helpers.ts` | `arm`, `arms`, `leg`, `pelvis`, `squash`, `F`, `track`, `flat`, `spinRoot`, `somersault` |
| `standing.ts` | Idle, IdleLook, Teeter (and `STAND_BODY` / `STAND_FEET`) |
| `locomotion.ts` | Tiptoe, Walk, Run, Skid, SkidTurn, StepUp, StepDown |
| `crouch.ts` | Crouch, CrouchWalk, CrouchSlide, ProneDown, Prone, Crawl, GetUpFront, Sit, LieDown, LieIdle, Sleep, GetUp |
| `air.ts` | jumps and flips, WallKick, WallSlide, Fall, Dive, BellySlide, ground pound, Land, HardLand, Slide |
| `ledge.ts` | Hang, ShimmyRight/Left, PullUp, Climb, ClimbIdle |
| `block.ts` | Push, PushIdle, Grab, Pull |
| `attacks.ts` | Punch, Punch2, Kick, SweepKick, JumpKick |
| `emotes.ts` | Wave, Victory, Hurt |

`clips/index.ts` lists them in `HERO_CLIPS` (the order the tools and the Lab use); a new clip
goes in its family's file and in that list. `src/game/hero/animations.ts` re-exports
`HERO_CLIPS`, so hot reload and older imports keep working. Poses shared between families
(`STAND_BODY`, `CROUCH_BODY`, `SKID_BODY`, `STRETCH`, `DESCEND`, …) are exported from their family.
A unit test (`src/game/hero/clips.test.ts`) fails when a clip is never played by the character
or the playground, unless it is listed there as pending (nothing is, now).
At runtime (and in the tools) the clips are compiled against the model's joints, and the
game adds procedural layers on top of them (see [At runtime](#at-runtime-blend-space-foot-placement-procedural-layers)).
A clip is authored on flat ground; stairs, slopes, leaning and landing squash are not in it.

```
clips/*.ts ──► ClipDef (keys, feet track, layers) ──► compileClip() ──► three.js AnimationClip
        ▲                                                   │
        │   npm run anim -- check / sheet / curves / diff   ├─► game (PlatformerCharacter) ─► npm run film
        └── agent edits numbers ◄── metrics, sheets, curves, films ◄┘   Animation Lab (/lab.html)
```

## The loop

1. Edit a clip in `src/game/hero/clips/<family>.ts`.
2. `npm run anim -- check Walk` prints the metrics table. The command exits 1 on problems.
3. **Look at the poses:** `npm run anim -- sheet Walk --compare` writes `.scratch/anim/Walk.png`.
   Open the PNG. With `--compare`, the previous version is drawn in magenta.
4. **Look at the timing:** `npm run anim -- curves Walk --compare` writes
   `.scratch/anim/Walk.curves.png`, the graph editor. `npm run anim -- diff Walk` says in words
   what your edit changed.
5. **Look at it in the game:** `npm run film -- run-stop` (about 5 s) plays the move in the real
   renderer, through the real state machine and blends. It writes a filmstrip and prints every
   pop, foot slip and sinking foot. A clip that looks right on its own can still pop, slide or
   snap when it's entered, left or blended.
6. Repeat until the sheet, curves and film all look right and `check` is clean. Unit tests fail
   on any problem (`src/engine/animation/animation.test.ts`).

Optionally, run `npm run dev` and open `/lab.html?clip=Walk`. The clip plays in the real renderer
and hot-reloads on save.

### What each view is for

| question | look at |
| --- | --- |
| Is the pose right? Silhouette, balance, contacts? | contact **sheet** (4 views, key frames) |
| Is the timing right? Easing, anticipation, overshoot, holds, snaps, the loop wrap? | motion **curves** |
| Does it travel right? Arcs, spacing, planted feet? | the sheet's **TRAIL** row (a dot per frame) |
| What did my edit change? | `--compare` (sheet / curves) and `anim -- diff` |
| Does it work in the game? Transitions, blends, speed matching, terrain? | `npm run film` |
| Does it read at game resolution? | `npm run film` (pixel mode, the real toon pipeline) |

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

**Motion curves** (`renderCurves`) are the animator's graph editor, as a PNG:

- **HEIGHTS**: world height of the feet, hands, head and pelvis. This is the bouncing-ball
  view: arcs, contact timing, hang time. The floor is the grey line.
- **ROOT**: pelvis offset (x, y, z) and squash, as authored.
- **One panel per moving joint**: X red, Y green, Z blue, in degrees as authored. Red ticks
  under a panel mark frames where that joint turns faster than 1200°/s.
- **SPEED**: the fastest joint rotation per frame. Spikes are pops.
- Dashed verticals are keys. Loops are drawn twice so the wrap is visible. `--joints ArmR,LegL`
  zooms in on a few joints, `--cycles 1` and `--width 1200` spread them out.
- Read them like an animator:
  - A flat stretch is a hold. Is it meant to be?
  - A curve that eases into a key and straight out again looks mechanical.
  - A good hit overshoots and settles.
  - A corner is a velocity snap.
  - The first frames should move *against* the action (anticipation).

**TRAIL spacing**: the white dots on the trail paths are one per frame. Bunched dots mean slow
(easing in or out, hang time); spread dots mean fast. Even spacing everywhere is robotic.

**Versions**: every `sheet` and `curves` run saves the clip to `.scratch/anim/history/`. So
`--compare` and `diff` always refer to the last *different* version you rendered. If the
length changed, `diff` compares the two on a scaled timeline: its frame numbers are on the
longer version's frames.

**Film** (`npm run film`, `scripts/film.ts`): the real game in Chromium, advanced one exact
1/60 s frame at a time with `Engine.step()`, driven by a small input script:

- `npm run film -- list` shows the named scenarios:
  - idle, walk, run-stop, bonk, skid, jump, run-jump, triple-jump, backflip, long-jump, side-flip
  - crouch, crawl, punches, ground-pound, dive, lie-down, sit, stairs, ledge, climb, hard-land
  - ramp (walk up and down the 15° ramp), ramp-run, wall-slide (slide down a wall, then wall
    kick), push-wall (lean on a wall: PushIdle), hurt (run onto the spike pad)
- Films use the game's iso camera turned to yaw 0, so the keys move along the axes:
  W = −Z, S = +Z, A = −X, D = +X (place yaw: 0 = facing +Z, 90 = facing +X).
- Several names run in one browser session. `all` films every scenario.
- A scenario is just a script. You can pass your own:
  `npm run film -- "place 0 0 4 90; down D; wait 30; tap SPACE; until land; up D; wait 20"`.
  Commands:
  - `place x y z [yaw°]`
  - `hold KEYS n`, `down` / `up KEYS`, `tap KEYS`
  - `wait n`
  - `until STATE [max]` (or `until grounded`). An `until` that gives up is listed as an
    `until` issue and the film exits 1, so a scenario that never reaches its state fails.
- Output in `.scratch/film/`:
  - A PNG filmstrip. Each cell shows state, dominant clip and blend partner, from a camera
    that follows the hero.
  - Under the cells, a timeline: state and clip bands, ground speed, fastest joint, sole
    height above the ground, planted-foot slip.
  - A JSON log of every frame, including `footPlacement` (pelvis drop, and per foot the
    offset, pitch, lock and step state: why a foot is where it is).
  - `--gif` also writes an animated GIF, for a human to watch.
- The console prints the state/clip timeline and flags:
  - **pop**: a joint jumps in one frame, 3× faster than the frames around it.
  - **slip**: a planted foot slides more than 0.5 m/s outside skid and slide states.
  - **sink**: a foot goes more than 3 cm into the ground.
  - Sole height and slip are measured along the normal of the ground under each foot, so a
    flat foot on a ramp reads 0; rays that start inside a collider (a foot in a step) are
    ignored.
  - **float**: both feet are more than 4 cm up while standing or walking.
- Options:
  - `--view side|front|three|back|game` (the default is side, relative to the hero's facing)
  - `--size` (metres framed)
  - `--every` (frames per image)
  - `--mode raw`
  - `--look snes`
  - `--webgpu` (under xvfb)
  - `--preview` (serve the production build)
  - `--cols` (filmstrip columns)
  - `--out` and `--name` (where the files go)
  - `--verbose` (progress and page console)

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
- The panel shows the clip's metrics and can open its contact sheet or motion curves.
- URL: `?clip=Run&view=side&frame=6&speed=0.25&paused=1`.
- Agent handle, `window.__ANIM_LAB__`:
  - `clips()`, `select(name)`, `seek(frame)`, `play()`, `pause()`, `state()`
  - `pose()`: joint rotations and world positions
  - `metrics(name)`
  - `sheet(name)`, `curves(name)`: PNG data URLs
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
- **Friendly limb helpers** in `clips/helpers.ts`:
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
  - `plant` (0..1): how much of the swing's end matches ground speed, so the foot arrives
    still in the world instead of skating at touchdown (Tiptoe, Walk and Run use 1)
  - arm `swing`, `elbow`, `pump`, `spread`, `forward`, `lag`

  From that, each foot is planted and slides back at exactly `speed` during stance, then
  swings forward on an arc that clears the floor by `lift`. The result has zero foot slide
  by construction. `speed` is stored on the compiled clip, and `PlatformerCharacter` scales
  playback so the feet match the real ground speed.
- **Layers** add a sine wave on one channel (breathing, sway). For loops, `period` must divide
  `frames`.
- `mirrorClip(clip, 'ShimmyLeft', RIG)` builds the other side's clip, including its feet
  track.
- Somersaults (`somersault()` / `spinRoot()` in `clips/helpers.ts`) turn the body around its
  middle, not the hips, so the head stays inside the character's capsule.
- `blend(a, b, t)` and `offset(pose, deltas)` build pose variations.
- `fast: true` marks snappy moves (flips, punches, launches), so the fast-rotation warning is
  skipped. `grounded: true` turns on the slide and floating checks. `notes` is printed on
  sheets and in the Lab.

## At runtime: blend space, foot placement, procedural layers

`PlatformerCharacter` plays clips through an `Animator` (`src/engine/character/animator.ts`).
Each frame it runs, in order:

1. **The mixer.** Cross-fades are re-blended by `RotationBlend` so a joint never flips.
2. **The locomotion blend space.** Walking and running aren't separate clips that cross-fade.
   They are one 1D blend space over Tiptoe, Walk and Run (`TUNING.gait`):
   - All three clips share a single phase. It advances at ground speed ÷ the blended stride
     length, so the feet match the ground at every speed.
   - Walk turns into Run across a speed band (`blend: [2.8, 4.2]` m/s, smoothstepped). The
     Tiptoe share comes from the stick tilt, so a gentle tilt still tiptoes.
   - A state asks for it with `{ gait: { speed, tiptoe } }` in its `AnimRequest`.
   - Entering from a standstill starts the phase with the forward foot at the matching
     stance point (`ClipDef.stance`, written by `gaitClip`). The first step is therefore a
     step, not a snap.
3. **Procedural pose layers** (`src/engine/animation/poseLayers.ts`, numbers in
   `TUNING.visual` and `TUNING.layers`):
   - **lean**: roll into turns (turn rate × speed) and pitch into acceleration, about the
     feet. Only states marked `lean: true` lean.
   - **look**: the head turns toward the direction of travel, or toward `hero.lookAt` when
     set. The playground points it at the nearest coin. The torso takes 30% of the turn.
   - **impact**: landing on the move adds a squash (pelvis drop, squash, torso bend),
     scaled by the landing speed, without locking input.
   - **cap**: a springy hat, when the rig names `spine.cap` (a joint no clip animates). The
     hero's `Cap` sits under `Head` with the Hat and Brim on it: it tips against the head's
     acceleration (`capGain` deg per m/s², a spring of `capStiffness`/`capDamping`, at most
     `capMax`) and settles. `poseLayers.test.ts` checks it lags and settles.
4. **Foot placement** (`src/engine/animation/footPlacement.ts`, numbers in `TUNING.feet`
   and `FOOT_PLACEMENT_DEFAULTS`). The state table's `feet` field picks the mode:
   - `'ik'`: each foot keeps the clip's height above the *real* ground. A heel ray and a toe
     ray find the slope or the step edge under it. The pelvis drops for the lower foot, the
     foot pitches to the slope, and the legs are re-solved (two-bone IK plus hip abduction).
     Swinging feet look ahead, so they clear a step up instead of clipping it. A gait's
     swinging foot knows where it will land instead (`SwingInfo` from the blend space's
     phase, stance and stride): it travels from the ground it took off from to the ground at
     the landing point over the swing (`swingUp`, `swingDown`), in world space, so the body
     stepping up or down under it doesn't move it.
   - The pelvis drops for the lower planted foot on a critically damped spring in world space
     (`dropRate`); starting over (a landing) it starts from the drop that leaves the legs as
     the clip has them, not from none or all of it.
   - Every correction a foot gets (its terrain offset, the lock's, the slope pitch) goes
     through a `PopGuard` (`src/engine/animation/popGuard.ts`): it follows its target's own
     speed up to `guardMove` m/s / `guardPitch` deg/s, and a faster jump (a correction
     switching on, a new target) eases over in a few frames instead of one. A locked foot's
     hold and a re-planting step are never held back. The drawn body height (`groundRoot`)
     is guarded the same way where it is lowered toward lower ground ahead.
   - `'lock'`: like `'ik'`, but a foot the clip puts on the ground **stays where it landed in
     the world**. When the body drifts more than `maxDrift` from it, or the foot is about to
     go out of reach, it takes a quick step (`stepTime`, `stepLift`). Starts, stops, idles,
     skid-turns and blends therefore don't skate. Feet in swing (moving faster than the
     body) are never locked. A lock holds the point that touched first (heel or toe) and
     lets go when the foot is clearly lifted (`release` × `contact`). A re-planting step
     goes from where the foot stands in the world to where the clip has it (its duration
     grows with the distance, `stepSpeed`), lifted. A foot planted across a step's edge stands
     on the lower step unless its middle is over the higher one.
   - Leave it unset (airborne states) for clip feet only. Mode changes fade, and the mode
     follows the interpolated render position, not the physics step.

   Clips are authored on flat ground, so *never* bake a slope or a step into a clip. The
   game puts the feet on the terrain. `hero.footPlacement()` (logged by `npm run film`)
   says what it did. The PlatformerCharacter unit tests and `footPlacement.test.ts` cover
   stairs, slopes and locking.

Because the mixer only writes joints whose blended value changed, the animator snapshots the
animated pose after the mixer and restores it before the next update. Without that, layers
would accumulate. Layers capture the clip's feet *before* leaning, so a lean never moves a
planted foot.

States that exist for the feel:

| state | clip | what |
| --- | --- | --- |
| `skidTurn` | SkidTurn | the end of a reversing skid: a hop round to the new direction, feet locked |
| `wallSlide` | WallSlide | falling while pushing into a wall slides down it; jump = wall kick |
| `push` (`leaning`) | PushIdle | pushing a wall or a crate that won't move: lean on it |
| `hurt` | Hurt | `hero.hurt(fromDirection, strength)`: knocked back in an arc, then invulnerable |
| `sit`, `standUp` | SitDown → Sit, StandUp | sitting down and getting up step the feet (one at a time) instead of sliding them, feet locked |

**Known limit: stairs.** The playground stairs have 28 cm risers on 0.8 m treads (half a
leg). The gait keeps its stride, so the trailing foot sometimes leaves the lower tread while
the pelvis is still low for it, and its toe skims the next tread's top or nose on the way
up: `npm run film -- stairs` reports that as a few one-frame "slips" of a swinging foot
(sole within 1.5 cm of a surface, moving at swing speed) and a few-cm "sinks" at a riser,
not a planted foot sliding. A real fix is a stair gait (lift first, then swing) rather
than more foot-placement rules.

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
   `PlatformerCharacter.attachModel(model, clips, rig)`. Passing the `rig` turns on foot
   placement and the pose layers; for the look layer it needs `spine: { torso, head }`. `compileClips(defs, rig, model)` is a
   shortcut that reads the rest pose from the model, so only use it on a model that hasn't
   animated yet. Calling `attachModel` again swaps the clip set; the playground does this on
   hot reload, using the saved rest pose.
