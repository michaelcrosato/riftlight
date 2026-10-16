# Showcase: other genres inside Riftlight (`src/riftlight/showcase/`)

The same engine, hero and town also run a side-scroller, a first-person gallery and a photo
mode. Each piece is small and complete, written to be copied as the start of a new game.

| piece | where in game | camera | code |
| --- | --- | --- | --- |
| **Arcade: Rift Runner** | the cabinet booth south-west of the plaza (F) · `?game=arcade` on its own | `side` | `showcase/arcade/` |
| **Hall of Beasts** | the archway and lectern south-east of the plaza (F) | `first`, `free`, an orbit on `fixed` | `showcase/bestiary/` |
| **Photo mode** | anywhere in town, a level, the arcade or the hall: **O**, or pause → Photo mode | `free` | `showcase/photo/` |

**How it plugs into the shell** (`showcase/Showcase.ts`). Riftlight asks the showcase first in
`fixedUpdate`, `update`, `cameraTarget`, `eyePosition` and `onCameraChange`; while a mode is
active it owns the frame and the town stands still behind it. A mode (`ShowcaseMode`) is
`enter()` (build the stage), `leave()` (remove it), `camera()`, `filters`, `fixedUpdate`,
`update`, `draw` and `cameraTarget`. The host runs the transition: the camera swoops toward the
thing you used and an iris closes (HUD rects), the mode builds behind it, then
`engine.setCamera(mode.camera(), { syncUrl: false })` and `setLook(lookFromFilters(mode.filters))`
swap the look and the iris opens. Leaving puts back the player's look, the render mode and the
game's own iso preset. No `engine.loadGame`: the town, the hero, the save and the music player survive, and each
stage removes every collider, trigger and controller it added (the e2e suite checks
`physics.counts()` comes back to where it was). The town gets the booth and the archway through
`Town.extend({ root, blockers, interactables, activate, deactivate, update })`
(`showcase/townProps.ts`), lights from the engine's pool only while the town shows.

**The hero as a platformer** (`showcase/visitor.ts`). `Visitor` is the hero model on the engine's
`PlatformerCharacter` (the whole Mario-64 moveset) with the playground's sounds and dust, clips
compiled once and shared by every clone; `spawn(physics, at, { lockDepth })` / `despawn()`.
Both stages walk with it.

## Build a side-scroller (`showcase/arcade/`)

- **The course is data** (`stage.ts`): blocks (x and y spans, a kind for the look, Rapier tags),
  cracked slabs, coins, checkpoints, the flag x, a par time, parallax scenery and the cabinet's
  chiptune (`ARCADE_SONG`). Coordinates are stage-local; the hero's lane is z = 0.
- **The stage** (`ArcadeStage.ts`) builds it at any `origin` (the cabinet builds it 1 km west of
  town): merged meshes, one collider per block, coin and goal **triggers** filtered to the hero's
  collider, READY → GO, a timer, checkpoints and a kill plane, the ground pound that breaks the
  slabs (`hero.state === 'groundPoundLand'` over them → `physics.remove` their colliders),
  parallax layers that follow the camera at a fraction, and its HUD on `ctx.hud`.
- **Input** (`readArcadeInput`): the stick's x runs along the course, down or C crouches (a
  ground pound in the air), Space / pad A / touch B jumps. The character is created with
  `lockDepth: true`, so any camera works, but the game uses `side` (`ARCADE_OPTIONS`:
  `{ preset: 'side', viewHeight: 12 }` and the `16bit` + `crt` look).
- **The template** is `ArcadeGame.ts` (`?game=arcade`): about 60 lines around the stage.
- **Scripted run** (`autoplay.ts`): a reactive pilot in beats (run, jump the pit, double jump
  from the step's edge, wall-kick the chimney, ground-pound the slabs, hop to the flag) that
  reads the hero's state, so the e2e suite proves the course can be finished with the real
  moveset. After changing the course: `npm run film -- arcade-pit arcade-ledge arcade-chimney
  arcade-pound` and `__RIFTLIGHT__.arcade.autoplay()`.
- In Riftlight a finished run pays `ARCADE_REWARD` gold (finish + a coin per coin + a new best)
  and keeps the best time in `save.showcase.arcade` (autosaved).

## Build a first-person gallery / viewer (`showcase/bestiary/`)

- **Records**: every hero kill is counted by species in `save.showcase.bestiary`
  (`showcase/save.ts`: `speciesKey` is plan + archetype + parts, bosses by name; the genome is kept
  so the exhibit can be rebuilt; at most `BESTIARY_LIMIT` species, bosses always stay). The
  monster's genome reaches the kill event through `object.userData.genome`
  (`wire/monsters.ts`).
- **The hall** (`hall.ts`) is primitives from the town's kit, Rapier boxes and cylinders, ten
  pedestals and the Rift Altar. It is dark on purpose: the sun drops to 0.12, a navy ambient,
  and every exhibit, the door lamps and the altar request a light from the engine's pool (8 of
  13 lit at medium quality, the ones near the camera).
- **Walking**: the `first` preset and `readMoveInput` (WASD strafe, the hero faces the camera),
  Tab / pad Y flies with `free`. **Inspecting** switches to `fixed` and moves the camera by hand
  around the exhibit (drag or Q/E, wheel), framing it left of the card; a button per clip
  (`MonsterRuntime.play`), the turntable. **Breeding**: `crossover` + `mutate` of two species,
  the child grows on the vat (`Spawn`), a seed from the save keeps it reproducible.

## Build a photo mode (`showcase/photo/PhotoMode.ts`)

Save what you will change (camera config, filters, render mode, resolution, sun and ambient,
time of day), switch to `free` from the current view, freeze the world (the shell stops
advancing it), and give each setting a row: every `FILTER_PRESETS` look and every single
`FILTER_IDS` filter (`PHOTO_LOOKS`), pixel / raw, 480 / 320, time of day (town), sun and ambient
scale, a fill light that follows the camera (`ctx.lights.request({ follow: camera })`). Tab
switches fly / edit (the rig's `fixed` flag), drag looks (no pointer lock, so the panel stays
clickable). P saves `renderer.capture()` as a PNG through a 2D canvas (the HUD is not in it);
Esc puts everything back.

## Agent API

| call | does |
| --- | --- |
| `await arcade.start({ instant? })`, `arcade.state()`, `arcade.autoplay({ maxFrames })`, `arcade.restart()`, `arcade.leave()` | the cabinet: phase, time, coins, slabs, result, record, camera, filters |
| `await bestiary.open()`, `bestiary.entries()`, `state()`, `inspect(i)`, `play(clip, i?)`, `view('walk' \| 'fly' \| 'inspect' \| 'breed')`, `turntable(on)`, `wing(dir)`, `breed(a, b)`, `mutate()`, `close()` | the Hall of Beasts |
| `photo.open()`, `state()`, `setLook(name \| index)`, `next(dir)`, `setMode('pixel' \| 'raw')`, `setTime(t)`, `setLight(i)`, `await capture({ download })`, `close()` | photo mode (`capture` returns the PNG's data URL) |

The `riftlight-showcase` e2e suite (`scripts/e2e-riftlight-showcase.mjs`, `@cameras`) plays all
three; frames in `.scratch/e2e/showcase-*.png`.
