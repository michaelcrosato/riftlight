# Engine World: the engine's tech demo

`?game=world` (any room on its own: `?game=world&room=<id>`). A hub, the **Atrium**, with a
door for every room; each room shows one thing the engine does, explains it, and lets you
change it while you watch. It is also the engine's showroom for agents: every room is a
complete, small example of an engine system, written to be copied.

## Playing it

| Key | Does |
| --- | --- |
| WASD, Space, C, J, F, Z... | the hero's whole moveset (docs/ENGINE.md, *Characters*) |
| **H** (F1) | how it works: the room's station guide |
| **T** | tweak: the room's live settings, then the engine's (game speed, look, camera, pixel art, quality, the room-change transition, shake, sound) |
| **G** (F2) | go to any room |
| **I** | the room's card again |
| **Esc** | menu: field guide, back to the Atrium, reset the room |

Walk into a door to enter a room; every room has its pads on the floor: step on one to
change something (the toast says what and why; the guide lists them all). Phones: the
touch buttons add **?** (how it works) and **GO** (rooms).

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
| Genre Wing | `stealth` Stealth | guards on patrol with vision cones that stop at walls; seen too long, they all chase you along A* paths |
| | `flocks` Flocks & Herds | birds, a school of fish and a pen of sheep as boids; they scatter from the hero |
| | `drift` Drift Track | get in a car on a ray-cast vehicle: suspension, grip, a handbrake drift, skid marks |
| | `bullets` Bullet Hell | a turret firing six seeded patterns (hundreds of bullets, one draw call); dodge, graze, punch back |
| Workshop | `sandbox` Sandbox | spawn props, grab and throw them with the mouse, save and load the layout as JSON |
| | `rewind` Time Lab | dominoes, a pyramid and a ball; hold R and everything plays backwards (the hero glides back the way it came) |
| Procedural | `terrain` Terrain Lab | a land from a seed: fractal or ridged noise, droplet erosion, trees placed by rules, a heightfield you walk on |
| | `dungeon` Dungeon Forge | wave function collapse from ten 3 × 3 tiles: watch it collapse, walk the halls; a flood fill finds sealed rooms |
| | `plants` Plant Lab | a bush, a fern, a weed and a tree grown from L-systems, their rules on the plinths, drawn branch by branch |

## How it is built (`src/world/`)

| File | What |
| --- | --- |
| `types.ts` | `RoomDef` (a room as data: card, guide, camera, look, spawn, `build`), `RoomLogic` (what `build` returns: per-frame hooks, knobs, HUD, an agent API), `PadDef`, `Knob`, `Guide` |
| `shell.ts` | `WorldShell`: what survives room loads (the UI, hotkeys, transitions, visited rooms); `RoomGame`: a room as a `Game` (the hero, the room's build and logic, the shell's UI) |
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
opens on it. A room can never leak into the next (the `world` e2e suite checks the Atrium's
physics and scene counts after visiting every room), and any room opens on its own from the URL.

**Rooms are mostly data.** A `RoomDef` holds the card (`about`, `try`), the station guide
(`guide`: what you are seeing, how it works step by step, where games use it, what to ask
for, what it costs, the engine's code, field-guide words) and a `build(room)` that uses the
kit. Floors and walls can be an ASCII map (one character per metre, merged into boxes);
pads are `{ label, note, group, apply(room, pad), enabled? }` (`enabled()` false: stepping on
it does nothing, no note, no sound).

## Add a room

1. Write `src/world/rooms/<id>.ts` exporting a `RoomDef` (copy the closest room). Keep the
   title ≤ 24 characters (it is drawn over its door).
2. Build it in `build(room)` with `room.kit`; return a `RoomLogic` for anything per frame,
   live `knobs` (the T panel and the guide) and an `api` for tests.
3. Write the guide for a reader who has never seen the technique: what is on screen, how the
   engine does it in 4-6 steps, real games that use it, phrases to ask for it, the cost. Quote
   the engine's real code. Add any new word to `glossary.ts`.
4. List it in `rooms/index.ts` (wing order). The Atrium gives it a door, G a button, the
   `world` e2e suite a visit (it loads, renders, its first pad works, nothing leaks).
5. `npm test` checks the guide is whole and its words are defined; run
   `npm run build && npm run test:e2e -- world`.

## Agent API: `window.__WORLD__`

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

The `world` e2e suite (`scripts/e2e-world.mjs`, group `@world`) plays it on WebGPU and the
WebGL 2 fallback; its frames land in `.scratch/e2e/world-*.png`.
