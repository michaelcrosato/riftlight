# Showcase: other genres inside Riftlight (`src/riftlight/showcase/`)

The same engine, hero and town also run a side-scroller, a first-person gallery and a photo
mode. Each piece is small and complete, written to be copied as the start of a new game.

| piece | where in game | camera | code |
| --- | --- | --- | --- |
| **Arcade: Rift Runner** | the cabinet booth south-west of the plaza (F) · `?game=arcade` on its own | `side` | `showcase/arcade/` |
| **Hall of Beasts** | the archway and lectern south-east of the plaza (F) | `first`, `free`, an orbit on `fixed` | `showcase/bestiary/` |
| **Engine Workshop** | east of the plaza, by the road to the bridge (F): the ring opens Engine World, the easel its Asset Gallery (the run is saved, then the page goes to `?game=world`; Engine World's way back opens the title) | Engine World's own | `showcase/townProps.ts` |
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
stage removes every collider, trigger and controller it added (`showcase/headless.test.ts` checks
`physics.counts()` comes back to where it was). The town gets the booth, the archway and the workshop through
`Town.extend({ root, blockers, interactables, activate, deactivate, update })`
(`showcase/townProps.ts`), lights from the engine's pool only while the town shows.

**On every device.** Options, Esc or ≡ pause a mode (`showcase/pause.ts` `StagePause`: Resume,
Restart in the arcade, Photo mode, Back to town; the stage and its clock stand still), and the
pause's Back to town is the way out (standalone Rift Runner's pause has Settings instead: the
engine's panel, which a pad drives, over the pause). While the showcase owns the frame it puts
`SHOWCASE_CONTROLS` (`hints.ts`) in `engine.controls`, so every `{key:...}` hint names what its
screens do: R1 / L1 zoom the card (the wheel and a pinch on the others), R1 steps photo mode's
field of view, R1 / L1 or the < > at the screen's sides on a phone turn the Hall's wing (never the
hero's lie down and prone), L1 (`photo_hide`) or Create hides photo mode's panel, R2 / L2 fly it up and down; Circle
backs out of the Hall's card and of photo mode. A swipe acts only where it starts on what it
moves, since a drag looks or orbits everywhere else (and a quick one is a swipe too): a sideways
one from the Hall's card closes it, one from photo mode's panel hides it (a tap on "show" brings
it back, and its hint says tap: `show`), and a finger presses a card button or a panel arrow when it lifts there without
swiping (a click at once). A press the card, the pause or photo mode took is theirs
(`showcase/held.ts`, `Showcase.presses`): the Cross or Space that chose Back never jumps the
hero, and the Circle that closed one never crouches it while it is held. On a
phone (`Showcase.touch()` → `TouchPad.sync`) the stick, A, B (it jumps), ≡ and the mode's own
interact (the Hall's LOOK, only at an exhibit; the nearest is enough there) show, no skill icons;
none of them over the Hall's card, whose hint names its way back there as the swipe (`card_back`:
Esc, Circle, a swipe from the card; photo mode's `back` is the ≡, Options or Esc, which leave it
there); HUDs keep clear of the buttons (`touchFloor`, `touchLeft`; `controlBoxes` gives them
where the page lays them out, or from their data without a page, as a replay of a phone's
recording draws them), and hints along the bottom sit in a gap between the stick and the buttons
where one holds them, else over them (`hintsAt`, `drawHints`; the prompt over them, `clearAbove`):
`phone.headless.test.ts` checks the Hall and photo mode on a phone held either way.

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
  parallax layers that follow the camera at a fraction, and its HUD on `ctx.hud`, laid out by
  `hud.width` (a phone in portrait is 130 art columns: the best time and the title stack under
  the coins, the controls wrap with `hintRows`, the results card shrinks its title and wraps;
  `arcade/hud.test.ts` checks every line stays on screen and apart).
- **Input** (`readArcadeInput`, `ARCADE_KEYS`): the stick's x runs along the course, down or C
  (pad B or L2) crouches (a ground pound in the air), Space / pad A / touch B jumps, J / pad X
  attacks, Shift / pad R2 held walks. The character is created with
  `lockDepth: true`, so any camera works, but the game uses `side` (`ARCADE_OPTIONS`:
  `{ preset: 'side', viewHeight: 12 }` and the `16bit` + `crt` look).
- **The template** is `ArcadeGame.ts` (`?game=arcade`): about 60 lines around the stage. Its
  `controls` are Riftlight's `CONTROLS`, so the engine names its hints for the device in use
  ("WASD run · Space jump", "Left stick run · Cross jump", "Stick run · B jump" on its phone
  buttons, `ARCADE_TOUCH_BUTTONS`: B jumps, A attacks, ≡ pauses); it promises no "leave"
  (`canLeave: false`), Options, Esc or ≡ pause it (Resume, Restart), and Enter, Cross or a tap
  restarts it once done (`ARCADE_AGAIN`, `arcade/arcade.headless.test.ts`). In portrait the side
  camera pulls back (`arcadeZoom`) so the course ahead stays in view.
- **Scripted run** (`autoplay.ts`): a reactive pilot in beats (run, jump the pit, double jump
  from the step's edge, wall-kick the chimney, ground-pound the slabs, hop to the flag) that
  reads the hero's state, so `showcase/headless.test.ts` proves the course can be finished with the real
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
  Tab / pad Y flies with `free`, N / R1 (L1 back) or a phone's < > turn the wing. **Inspecting**
  (F, R2, a left click, a phone's LOOK; recorded input only, so a replay inspects what the run did)
  switches to `fixed` and moves the camera by hand around the exhibit (drag, Q/E or the right
  stick; the wheel, a pinch or R1 / L1), framing it left of the card (above it on a narrow
  screen, a phone held upright, where the card sits along the bottom and the camera starts
  farther out, never past the far wall); Circle, Esc or a sideways swipe from the card goes back;
  a button per clip (`MonsterRuntime.play`; one < clip > row on a card too tall for the screen,
  then fewer rows of parts), the turntable. Esc and Options pause the Hall from recorded input
  only, never the page's pointer lock (`replay.headless.test.ts`). **Breeding**: `crossover` + `mutate` of two species,
  the child grows on the vat (`Spawn`), a seed from the save keeps it reproducible.

## Build a photo mode (`showcase/photo/PhotoMode.ts`)

Save what you will change (camera config, filters, render mode, resolution, sun and ambient,
time of day), switch to `free` from the current view, freeze the world (the shell stops
advancing it), and give each setting a row: every `FILTER_PRESETS` look and every single
`FILTER_IDS` filter (`PHOTO_LOOKS`), pixel / raw, 480 / 320, time of day (town), sun and ambient
scale, a fill light that follows the camera (`ctx.lights.request({ follow: camera })`). Tab
switches fly / edit (the rig's `fixed` flag), drag looks (no pointer lock, so the panel stays
clickable). P / Square saves `renderer.capture()` as a PNG through a 2D canvas (the HUD is not in
it); H, L1 (`photo_hide`: Triangle is taken), Create or a sideways swipe from the panel hides it (a
tap on "show" brings it back); R1 steps the field of view (`nextFovStep`); Circle leaves the rows,
then photo mode; Esc or Options puts everything back. The panel is as wide as its words up to the
HUD's width: narrower (a phone held upright), each value wraps under its label, the title starts
right of a phone's ≡, and held sideways the panel sits right of the joystick.

## Agent API

| call | does |
| --- | --- |
| `await arcade.start({ instant? })`, `arcade.state()`, `arcade.autoplay({ maxFrames })`, `arcade.restart()`, `arcade.leave()` | the cabinet: phase, time, coins, slabs, result, record, camera, filters |
| `await bestiary.open()`, `bestiary.entries()`, `state()`, `inspect(i)`, `play(clip, i?)`, `view('walk' \| 'fly' \| 'inspect' \| 'breed')`, `turntable(on)`, `wing(dir)`, `breed(a, b)`, `mutate()`, `close()` | the Hall of Beasts |
| `photo.open()`, `state()`, `setLook(name \| index)`, `next(dir)`, `setMode('pixel' \| 'raw')`, `setTime(t)`, `setLight(i)`, `await capture({ download })`, `close()` | photo mode (`capture` returns the PNG's data URL) |

`src/riftlight/showcase/headless.test.ts` plays the arcade and the Hall of Beasts headless; the
`riftlight-showcase` e2e suite (`scripts/e2e-riftlight-showcase.mjs`, `@cameras`) draws their frames
and plays photo mode; frames in `.scratch/e2e/showcase-*.png`.
