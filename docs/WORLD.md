# Engine World: the engine's tech demo

`?game=world` (any room on its own: `?game=world&room=<id>`). A hub, the **Atrium**, with a
door for every room; each room shows one thing the engine does, explains it, and lets you
change it while you watch. It is also the engine's showroom for agents: every room is a
complete, small example of an engine system, written to be copied.

## Playing it

| Keyboard and mouse | Pad (PlayStation · Xbox) | Phone | Does |
| --- | --- | --- | --- |
| WASD, Space, C, J, F, Z... | left stick, Cross, Circle, Square, Triangle, L1... | stick, JUMP, DUCK, HIT, GRAB (and PRONE in the Moveset Playground) | the hero's whole moveset (docs/engine/character.md) |
| **Esc** | **Options** · Menu | **≡** | menu: every panel below, Tweak and settings, the room card, field guide, back to the Atrium, reset the room, Riftlight (it stops the room; a DualSense's triggers let go) |
| **G** (F2) | **Create** · View | **GO** | go to any room |
| **H** (F1) | **R3** or the touchpad · RS | **?** | how it works: the room's station guide |
| **T** | in the menu | in the menu | tweak: the room's live settings, then the engine's (game speed, camera, the room-change transition, shake) and every one of the player's, saved (look, pixel art, pixel size, quality (auto or a level), frame rate, sound, volume, music, effects, the controller's buttons, vibration, debug info), and Reset settings |
| **I** | in the menu | a tap on it | the room's card again, or away |
| Esc / Backspace | Circle | a sideways swipe, the close box | close a panel |
| Tab / Shift+Tab | R1 / L1 | drag | a guide's next or previous heading |

Walk into a door to enter a room; every room has its pads on the floor: step on one to
change something (the toast says what and why; the guide lists them all). A swipe or a tap sends
the card and a toast away, and a click or a tap on one is the shell's: nothing is placed, grabbed
or skipped behind it, even when the finger lifts (`RoomRuntime.pointerFree`); so is one a panel
took (a menu row, the close box) until it lets go, and the Cutscene skips on a tap as it lifts, so
the swipe that sends the card away skips nothing. Every prompt (the row along the bottom, the card, toasts, labels, the
guide, the menu, each panel's legend: ✕ Select ○ Back, a guide's L1 R1 Headings) names the control for
the input used last (`controls.ts` `WORLD_CONTROLS`, each room's `Game.controls`; a line names one as
`{key:action}`, `keyText`). Rooms with actions of their
own have them on every device: the Time Lab rewinds on R, L2 or <<; the Gallery steps on Q / E,
L1 / R1 or a phone's < > and changes shelf on comma / period, L2 / R2 or >> (back a shelf on a
phone: its < SHELF pad); the Workshop picks on
Q / E or L1 / R1, changes shelf on comma / period or L2 / R2 and places, turns and undoes on
Square, Triangle and Circle (a phone taps a row, the panel's arrows for a shelf and the floor to
place, and has UNDO); the press that closes a panel is the panel's, never the room's too
(`RoomRuntime.inputFree`), and while it is held (`RoomRuntime.held`, `showcase/held.ts`): the
Circle that closed the guide never crouches the hero, the Cross that chose Resume never pulls the
car's handbrake; the Sandbox carries on E, R2 or HOLD; the car
drives on analog R2 / L2 (adaptive triggers that push back, rumble on knocks and slides) and
gets out on C or Circle; Bullet Hell rumbles on hits and grazes, lights the DualSense's bar and
fires by itself on a phone. There is no DOM ⚙: the menu's Tweak and settings has all the player's settings.

## Rooms

| Wing | Room | Shows |
| --- | --- | --- |
| Movement & Feel | `moves` Moveset Playground | the platformer controller: a station for every move |
| | `feel` Game Feel Lab | hitstop, screen shake, flash, particles, game speed, a shockwave slam |
| | `cameras` Camera Bench | seven camera presets over one course, zoom, shake |
| Physics Lab | `bodies` Rigid Body Yard | a crate tower to blast or shoot down, friction ramps, restitution balls, a stress pit of 1000 instanced bodies that fall asleep |
| | `joints` Joints & Ropes | a rope bridge that sags (cut it), a wrecking ball on a chain, a seesaw, spring pads, saloon doors you shove open, bead curtains |
| | `soft` Cloth & Soft Bodies | flags in the wind (let them go), a curtain to walk through, sheets that drape, ropes, jelly blobs |
| | `platforms` Moving Platforms | a Ferris wheel, a pendulum, a lift and a shuttle around a pit, a turntable, conveyor belts |
| | `destruction` Destruction | walls that shatter where you punch them, a crumbling bridge, explosive barrels |
| | `fields` Forces & Fields | a wind tunnel, updrafts to float on, a gravity well, launch pads |
| Animation Lab | `clips` Clip Gallery | the hero's clips as data, on mannequins, by family |
| | `secondary` Secondary Motion | a scarf, a tail and an antenna on spring chains, slimes that squash and stretch |
| | `legs` Procedural Legs | a six-legged walker that follows you up steps, a crab and a robot: planted feet, stepping gaits, two-bone IK |
| | `ragdolls` Ragdolls | dummies that go limp when hit, tumble down stairs, get knocked over by a cannon, then blend into a get-up clip |
| | `sprites` Pixel Sprites | pixel-art critters, trees and torches as camera-facing sprites drawn in code, a crowd of 300 in three draws |
| Visual Effects | `lights` Lights & Shadows | the light pool, flicker presets, RGB mixing, a moving lantern, the sun dial, quality |
| | `particles` Particle Garden | every particle effect, built in and registered as data |
| | `water` Water & Buoyancy | waves and ripples drawn by the vertex shader, floating crates and a raft, rain rings, dithered see-through water |
| | `weather` Weather & Sky | a day and night cycle, rain, a storm with lightning, snow that settles, ground fog |
| | `foliage` Grass & Wind | thousands of instanced blades that lean, ripple with gusts and part round the hero; swaying trees |
| | `trails` Trails & Decals | footprints, fist and kick ribbons, a comet, paint splats, cracks, scorch marks |
| Looks & Filters | `consoles` Retro Consoles | whole-screen stacks copying old hardware |
| | `layers` Mix & Match | looks per layer: characters vs environment |
| | `filters` Filter Bench | every filter on a pad; build a stack |
| | `transitions` Screen Transitions | nine transitions, a flash, a shockwave |
| | `gallery` Asset Gallery | every library model and texture and every imported pack, one at a time on a turntable: Q/E step, comma/period change shelf, `&asset=<id>` opens one (docs/ASSETS.md, *Finding assets*) |
| Genre Wing | `stealth` Stealth | guards on patrol with vision cones that stop at walls; seen too long, they all chase you along A* paths |
| | `flocks` Flocks & Herds | birds, a school of fish and a pen of sheep as boids; they scatter from the hero |
| | `drift` Drift Track | get in a car on a ray-cast vehicle: suspension, grip, a handbrake drift, skid marks |
| | `bullets` Bullet Hell | a turret firing six seeded patterns (hundreds of bullets, one draw call); dodge, graze, punch back |
| Workshop | `sandbox` Sandbox | spawn props, grab and throw them with the mouse, save and load the layout as JSON |
| | `workshop` Asset Workshop | every library model and texture and every pack in a picker on the HUD (the wheel over it or Q/E scroll, comma/period change shelf, a click picks); Enter, the SPAWN pad or a click on the floor places the pick, a right click or Backspace takes one away, Tab shows what it is made of; pads at the back explain models, textures, packs and search (docs/ASSETS.md, *Finding assets*) |
| | `rewind` Time Lab | dominoes, a pyramid and a ball; hold R and everything plays backwards (the hero glides back the way it came) |
| Procedural | `terrain` Terrain Lab | a land from a seed: fractal or ridged noise, droplet erosion, trees placed by rules, a heightfield you walk on |
| | `dungeon` Dungeon Forge | wave function collapse from ten 3 × 3 tiles: watch it collapse, walk the halls; a flood fill finds sealed rooms |
| | `plants` Plant Lab | a bush, a fern, a weed and a tree grown from L-systems, their rules on the plinths, drawn branch by branch |
| Rendering Lab | `swarm` GPU Swarm | 32,768 particles moved by a TSL compute shader, never touching the CPU; they follow you |
| | `views` Mirrors & Monitors | two security cameras rendered to textures on monitors, and a mirror that reflects you, in the iso view |
| | `shaders` Shader Gallery | hologram, force field, lava, marble, wood and crystal: TSL materials with no textures, see-through by dither |
| AI & Direction | `robots` Robot Yard | four robots on behaviour trees: flee the hero, recharge, carry crystals, wander; one robot's tree drawn live |
| | `cutscene` Cutscene Stage | a scene on a timeline: camera keys on a curve and cuts, actors on cues, subtitles, bars; skip it and the world still ends right |
| | `sounds` Sound Garden | four looping sounds placed in the world: falloff with distance, stereo pan, muffled behind a wall (a ray cast) |

## How it is built (`src/world/`)

| File | What |
| --- | --- |
| `types.ts` | `RoomDef` (a room as data: card, guide, camera, look, spawn, `build`), `RoomLogic` (what `build` returns: per-frame hooks, knobs, HUD, an agent API), `PadDef`, `Knob`, `Guide` |
| `shell.ts` | `WorldShell`: what survives room loads (the UI, hotkeys, transitions, visited rooms); `RoomGame`: a room as a `Game` (the hero, the room's build and logic, the shell's UI) |
| `controls.ts` | the World's controls on every device: `WORLD_CONTROLS` (key, pad, touch per action: the prompts), `WORLD_KEYS` (the codes each reads), `WORLD_TOUCH_BUTTONS` (the hero's cluster, ≡ GO ?, three room slots), `keyText` |
| `kit/RoomKit.ts` | the building kit: `box`, `cylinder`, `solid`, `crate`, `map` / `room` (ASCII maps), `pad` / `padGrid`, `label`, `door`, `light`, `glow` |
| `kit/map.ts` | ASCII maps merged into as few boxes as possible (pure, unit-tested) |
| `kit/mannequin.ts`, `kit/diorama.ts` | hero clones playing a clip; the village the look rooms show |
| `kit/strike.ts` | `Strikes`: a punch or kick starting, where it lands and how hard (rooms decide what it hits) |
| `rooms/*.ts`, `rooms/index.ts` | the rooms and their order |
| `ui/reader.ts`, `ui/panels.ts` | the station guide, field guide, tweak panel, room list, menu (Riftlight's UI kit) |
| `glossary.ts` | the field guide's words |
| `api.ts` | `window.__WORLD__` |

**Every room is its own `Game`.** A door calls `shell.goto(id)`: `engine.screen.cover('iris')`
closes on the hero, `engine.loadGame(new RoomGame(def))` unloads the old room (its meshes,
physics, triggers, lights, particles, tweens) and builds the new one, `engine.screen.reveal()`
opens on it. A room can never leak into the next (`src/world/rooms.headless.test.ts` checks the
Atrium's physics and scene counts after visiting every room, headless), and any room opens on its
own from the URL.

**Rooms are mostly data.** A `RoomDef` holds the card (`about`, `try`; where all of it doesn't fit, a
summary and the tries that fit, each whole, wider held sideways if need be: `touchHud.headless.test.ts`
checks every room's on a phone held either way and a desktop; on a 360 px phone the menus' long
buttons take two rows, the room list's line is the words before `about`'s colon, and the guide is
titled by its room), the station guide
(`guide`: what you are seeing, how it works step by step, where games use it, what to ask
for, what it costs, the engine's code, field-guide words) and a `build(room)` that uses the
kit. Floors and walls can be an ASCII map (one character per metre, merged into boxes);
pads are `{ label, note, group, apply(room, pad), enabled? }` (`enabled()` false: stepping on
it does nothing, no note, no sound). A room's words name controls as `{key:action}` (an action of
`WORLD_CONTROLS`), filled in for the device in use; `RoomDef.controls` renames an action where the
room's own controls differ on a device (the Workshop's shelves on a phone are its panel's < >), so
a line never names a button the room has not got, nor a bare key: the hero's moves and Tweak are
tags too ("Punch ({key:attack})", "in Tweak ({key:tweak})"), and a keyboard's or a mouse's own way
says so ("on a keyboard Shift+E", "with a mouse, a right click"); `words.headless.test.ts` reads
every room's card, guide, pads, labels and Tweak rows on a pad and a phone. A room's own actions read keys and pad buttons
together (`WORLD_KEYS`); `RoomLogic.touch()` puts them on a phone (a touch slot `TouchSlot1`..`3`
with its label, or a base button relabelled or hidden: the car's JUMP is BRAKE), and
`RoomLogic.claims` lists pad buttons the hero's moves must not also take (the Gallery's L1 / R1).
A room reads input itself only while `room.inputFree`: false while a panel or a room change owns
the keys and for the rest of a frame that began with one, so the Circle that closes the guide is
not the Workshop's undo as well; a held action through `room.held(...codes)`, which leaves out a
key a panel's press still holds; the pointer's buttons only while `room.pointerFree` (a click or
a tap that hid the card, or that a panel took, is theirs until it lets go). The card and a toast
count down on the frame's recorded time (`shownTime`: unscaled, so slow motion doesn't hold them;
held while a menu freezes the room), the card's length comes from the recorded args (14 s on a
fresh start, 8 s through a door), and a room's level starts with nothing held (`roomStarted`), so
whether the card or a toast takes a click is input-derived and a recording replays it at any frame rate.

A room's HUD keeps clear of the shell's and of a phone's controls: its line of counts or state
goes through `room.hudLine(text, color)` (bottom left over the prompts, over the joystick and the
buttons where they share its columns, wrapped to a phone's 130 columns); a block of its own
starts at `room.lineTop(width, rows)` (the Time Lab's prompt and bar), a panel along the bottom
ends at `room.hudFloor(x0, x1)` (the Gallery's), one `width` art pixels wide along the top
starts at `room.hudTop(width)` (under ≡ GO ?: the mixer, the robots' tree), and
`room.touchBoxes()` gives the controls for a room that lays a whole panel out around them (the
Workshop keeps left of its slots up the right edge). Without a page they are where their data puts
them (`worldTouchLayout`) while touch controls are on: headless with `touch: true`, or a replay of
a phone's recording (the recording keeps that the page had them, `Recording.touch`), so
`touchHud.headless.test.ts` holds every room's HUD clear of them on a phone held either way, and a
replay lays it out as the phone did. With a mouse and a keyboard they all sit where the rooms'
lines and panels always were.

## Add a room

1. Write `src/world/rooms/<id>.ts` exporting a `RoomDef` (copy the closest room). Keep the
   title ≤ 24 characters (it is drawn over its door).
2. Build it in `build(room)` with `room.kit`; return a `RoomLogic` for anything per frame,
   live `knobs` (the T panel and the guide) and an `api` for tests.
3. Write the guide for a reader who has never seen the technique: what is on screen, how the
   engine does it in 4-6 steps, real games that use it, phrases to ask for it, the cost. Quote
   the engine's real code. Add any new word to `glossary.ts`.
4. List it in `rooms/index.ts` (wing order). The Atrium gives it a door, G a button,
   `rooms.headless.test.ts` a visit (it loads, its first pad works, nothing leaks) and the `world`
   e2e suite a frame of it.
5. `npm test` checks the guide is whole and its words are defined; run
   `npm run build && npm run test:e2e -- world`.

## Agent API: `window.__WORLD__`

Set once the first room runs (it exists when `window.__PIXEL_READY__` resolves) and kept room to room.

| Call | Does |
| --- | --- |
| `rooms()` | every room: id, title, wing, about |
| `await goto(id, { instant? })` | the transition and the load; resolves when the room shows |
| `leave()`, `reset()` | back to the Atrium (in front of the room's door); build the room again |
| `state()` | room, hero (position, state, clip), pads (label, lit), open panel, transition, visited |
| `pad(label)` | step on a pad without walking there |
| `knobs()`, `knob(id, value)` | the room's and the engine's live settings |
| `open('guide' \| 'tweak' \| 'rooms' \| 'pause' \| 'glossary')`, `close()` | the panels |
| `guide(id?)` | a station guide as text lines (what an agent reads to learn a technique) |
| `room` | the current room's own hooks (`RoomLogic.api`): e.g. the Feel Lab's `hit()`, the Atrium's `doors()` |

Headless, `src/world/*.headless.test.ts` and `src/world/rooms/*.headless.test.ts` play the shell and
every wing's rooms (`src/world/testWorld.ts`: `headlessWorld`, `roomApi`). The `world` e2e suite
(`scripts/e2e-world.mjs`, group `@world`) draws them, with the GPU rooms and live play; its frames
land in `.scratch/e2e/world-*.png`.
