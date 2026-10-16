# The hero (`src/riftlight/actors/`)

## The hero's controls

Riftlight's keys are `KEYS`, `MOUSE` and `PAD_BUTTONS` in `game/controls.ts` (its header lists
them): WASD / left stick moves (camera-relative); the mouse aims at the ground under the cursor (with
a pad, the nearest enemy ahead). LMB / J / pad A is the 3-hit combo (hold to keep swinging), RMB or
1 Q · 2 E · 3 R · 4 T / pad X Y LB RB are the skill bar, Space / pad B is the dodge roll, F / pad RT
interacts. Pad buttons become virtual `Pad*` codes so menus tell A = confirm from Space = dodge.
Presses buffer for 0.2 s, any action cancels into a dodge or the next action after its hit frame,
casting slows movement instead of locking it (the legs keep running under the arms), and attack
clips play at the rate attack / cast speed asks for. On a phone the touch buttons are the bar
(docs/game/ui.md *On a touch screen*). The shell moves the engine's debug hotkeys P and R to F8 and
F7 (`rebindDebugKeys`). The arena (`?game=arena`, `combat/arena.ts`) keeps its own map,
`HERO_KEYS` in `actors/controls.ts` (RMB / K, Q, E, R, F, or 1–4), and passes
`HERO_GAMEPAD_BUTTONS` and `HERO_DEBUG_KEYS` (R is a skill there, so with `?debug=1` the
resolution hotkey moves to F2). Every timing is in `HERO_TUNING`.

**All of it is `ctx.input`, so a session replays** (docs/engine/determinism.md *Recording and replay*):
the cursor is the engine's `pointer` over the canvas (`game/controls.ts` `Pointer`: art pixels,
the ground under it, and the menus' pointer events), the mouse buttons are its `MouseLeft` /
`MouseRight` keys (a click shorter than a frame still attacks; a finger on the world is `Touch`),
and the item windows read the same (`ItemsUi.update`). What the game takes from the page goes
through `ctx.input.send` and arrives a frame later, recorded: the settings play depends on at
setup (`playSettings`: zoom and shake move what the mouse points at), the save slots the menus
show (`SavesView`), a save loaded or a new run's seed (`Riftlight.play`), an imported file, and
what the passive tree does (allocate, refund, close: its view runs on the page, so it hands them
over and the tree panel does them when they arrive). Actor ids count from 1 and prop ids from
1,000,000 again at each game's setup, so a replay numbers them as the recorded run did.
`Riftlight.fingerprint` (part of `engine.fingerprint()`) is the hero and every monster (where,
facing, life), the ground loot, the save and the bags, and the run's random stream. A replay
writes nothing to storage (the saves, settings and volumes are the player's: the engine puts the
volumes back when it ends, and a replayed Import or Export does nothing), and the settings and
slots sent at setup give way to anything the game changed before its first frame (an agent's
`newRun`). The e2e suite `riftlight-replay` plays a session by input alone (New Run and Resume
clicked, the walk to Vex on the stick, a fight aimed with the mouse, a volume and the zoom
changed in Settings, a tree node allocated in the tree's view), replays it over other saves and
settings to the same fingerprint with storage untouched, and shows an edited recording does
not. The agent API's calls (`newRun`, `moveTo`, `fight`...) are not input: a session they drive
does not replay.

## How the hero moves on screen (`actors/HeroController.ts`, `heroAnimator.ts`)

Gameplay is instant (the facing snaps to the aim, speed is full at once, an action starts on
the press), so the presentation does the smoothing, with no say over gameplay:

- **Feet.** `HeroAnimator` runs the engine's `FootPlacement` (docs/ANIMATION.md *At runtime*)
  with a ground probe (the Rapier world, a stage's `groundY`, else flat): a planted foot stays
  where it touched down through blends, wind-ups and twisting hips, and re-plants with a quick
  step when the body moves on. `PoseLayers` springs the hat (`Cap`).
- **Facing.** The drawn body follows the gameplay facing: small corrections smoothly, a
  standing turn of more than `hopTurn` degrees as a quick hop round (`hopTime`), so the feet
  never pivot on the floor. The whirlwind spins the whole model (`spinTurns`); its clip only
  holds the pose.
- **Lifts.** Where the clip has the feet down but the body must travel, it is lifted a few
  centimetres instead of skating: a melee lunge bounds in (`lungeHop`), a roll springs off
  (`rollPush`), a standing start at a run springs off (`startHop`), a hard shove staggers
  (`staggerHop`).
- **Root motion.** Dashes and the dodge roll move by a speed profile matched to their clips
  (`combat/deliveries/dash.ts` `ROLL_PROFILE`, `DASH_PROFILE`; `Motion.profile`): the roll
  brakes as its feet come down, then creeps on exactly as fast as the clip slides them back
  under the rising body. Walk and Run share one phase; a stop finishes the stride in the air.
- **Weapons** (`actors/weapons.ts`): one mesh per weapon class (sword, axe, mace, sceptre,
  dagger, wand, staff in the right fist; a bow in the left, its string drawn to the right hand
  between a bow clip's `draw` frames and let go at its hit frame). Each is the engine library's
  model of its class (`src/engine/model/library/weapons.ts`), the same one a drop of that class
  shows lying flat on the ground (`loot/world.ts`, its grip in the rarity colour). The equipped
  item's `weapon.<class>` flag picks it (`weaponClassOf`; no flag is the starter sword;
  two-handers are drawn a size up). With a staff or wand, `Cast` / `CastBig` become
  `CastWeapon` / `CastBigWeapon` (same hit frames): the weapon points.

Hit frames and cancel points are `COMBAT_TIMING` (`src/game/hero/clips/combat.ts`); move a hit
in a clip and move it there too. Check the hero in the arena with
`npm run film -- all --game arena` (the `arena-*` films: combo steps, every delivery kind,
weapons, the roll in 8 directions, hurt, death).
