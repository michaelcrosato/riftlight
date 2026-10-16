# Levels (`src/riftlight/levels/`)

Themes, props and the twelve mechanics: docs/game/mechanics.md.

## The 12 designed levels

Each level introduces one mechanic and is named after it. Levels 7–12 also bring back
earlier mechanics in new combinations. **Bypass** is how a casual player clears the level
without using the mechanic; **exploit** is how a speedrunner or power-leveller uses it.

| # | level | mechanic | bypass (casual) | exploit (speedrun / power-level) |
| --- | --- | --- | --- | --- |
| 1 | **Embers** | explosive braziers: hit one to blast everything near it | fight normally | pull packs onto braziers, chain the blasts |
| 2 | **Gloom** | darkness: the light radius matters, lanterns relight areas, monsters hit harder in the dark | stay near lit paths | light lanterns for big XP shrine buffs |
| 3 | **Gale** | wind lanes push every actor | walk across between gusts | ride gusts for speed, blow packs into pits |
| 4 | **Frostglass** | ice floors: momentum and sliding; frozen monsters shatter | stay on stone paths | slide-dash, shatter chains |
| 5 | **Thornweave** | vine traps that hurt anyone | step around them | kite monsters through thorns |
| 6 | **Stormspire** | lightning pylons chain between conductors | ignore pylons | charge pylons to zap whole corridors |
| 7 | **Mire** | slowing mud plus haste pads, with Gale gusts over the mire | slog through | chain haste pads, gust-boost |
| 8 | **Echoes** | an echo replays your attacks 2 s later | ignore it | double-dip burst windows |
| 9 | **Riftgates** | paired portals between rooms (with Stormspire pylons) | walk the long way | shortcuts; knock monsters through gates |
| 10 | **Bloodmoon** | monsters explode on death (with Embers braziers) | fight carefully | chain explosions across rooms |
| 11 | **Gravewell** | gravity wells pull actors in (with Frostglass) | avoid the wells | group packs for area skills |
| 12 | **Collapse** | floors crumble behind you (with Gloom) | keep moving | fastest clears, collapse bonus loot |

Each level has a hand-tuned layout seed, theme, encounter table and boss. The bosses are
assembled from genomes with boss modules: phases, telegraphed slams, adds and arenas built
around that level's mechanic.

## Plan and build

A level is **planned** as pure data, then **built**:

```
LevelSpec ──planLevel──▶ LevelPlan (layout, mechanic elements, props, packs, chests, shrines)
          ──buildLevel(spec, ctx, hooks)──▶ Level (geometry, colliders, lights, mechanic runtimes, encounters)
```

| file | what |
| --- | --- |
| `layout/templates.ts` | room templates: ASCII stencils with tags (`ROOM_TEMPLATES`) |
| `layout/generate.ts` | the graph grammar (`GRAMMAR`), placement, style passes, critical path |
| `layout/geometry.ts` | floors, walls, cliffs, props → a few merged meshes; greedy-merged colliders |
| `themes/themes.ts` · `palette.ts` · `props.ts` | 12 themes, the rift palette shifter, prop builders |
| `mechanics/*.ts` | the 12 mechanics (`MECHANICS` registry, `compatible`, `pickCompatible`) |
| `plan.ts` | `planLevel`: layout + mechanics + packs + chests/shrines (`SHRINES`) + props |
| `Level.ts` · `nav.ts` | `buildLevel`, the runtime, walkability, wall raycasts, the flow field |
| `designed.ts` · `rift.ts` | the 12 designed `LevelSpec`s, `riftSpec(seed, depth)`, `levelSpec(depth)` |
| `validate.ts` | the checks behind `npm run level -- validate` and the unit tests |
| `levelLab.ts` | `/?game=levellab&depth=N` with placeholder capsule actors |

## Using a level from the game

```ts
const level = buildLevel(levelSpec(depth, runSeed), {
  scene: ctx.scene, events, actors: () => [hero, ...monsters],          // required
  physics: ctx.physics, lights: ctx.lights, particles: ctx.particles, audio: ctx.audio,
  world: { scene: ctx.scene, sun: ctx.engine.sun, ambient: ctx.engine.ambient },
}, {
  spawnMonster: (s) => buildMonster(...),  // s: archetype, rank, position, level, depth, pack, room, genome, eliteBudget, power
  applyHit, replaySkill, teleport, dropLoot, onExit, onFall,   // optional, see LevelHooks
});
// fixedUpdate: level.fixedUpdate(dt) (mechanic forces, falls)   update: level.update(dt)
level.nav.direction(x, z, out);   // flow field toward the hero (rebuilt only when the hero changes cell)
level.nav.path(a, b); level.isWalkable(x, z); level.raycastWalls(from, dir, max);
level.targets();                  // braziers, pylons…: neutral ActorLikes combat may hit
level.minimap.explored;           // cells the hero has seen
```

Packs spawn when the hero comes within 16 m or enters their room. The boss's death opens the
exit portal and emits `levelClear { depth, time }`; walking into the open portal calls
`hooks.onExit`. Chests (`dropLoot`) and shrines (a timed `StatSheet` source of `SHRINES` mods)
open on contact. Grid cell (x, z) covers world [x, x+1] × [z, z+1]; floors are at y = 0.
The ARPG camera is the `iso` preset at pitch 42°, yaw 45°, view height 15 (zoom with the
wheel); the lab sets it unless the URL picks a camera.

## Layouts

Six styles: `dungeon` (rooms + corridors), `caves` (cellular-automata blobs), `ruins` (broken
walls, rubble), `arena` (a short approach to a big boss room), `bridges` (islands and 2-wide
bridges over the void), `town` (districts on a street grid, buildings as blocks). The graph
grammar grows start → boss with rules from `GRAMMAR` (extend the critical chain, add a quiet
connector, hang treasure, guarded treasure and shrine branches); placement stamps a
rotated/mirrored stencil per node next to its parent, joined by a straight corridor. The
critical path is a Dijkstra path from the entrance to the exit that prefers room centres.
Every attempt must reach every room and the exit; failures retry with a forked seed (the
error lists why each attempt failed). Back walls are tall, front walls (between the iso
camera and a floor) are cut low, every wall has a trim band and cap, lone wall cells become
pillars, and everything below the floor sinks into the theme's height fog.

**Add a room template:** add an entry to `ROOM_TEMPLATES` (`layout/templates.ts`): the
interior as ASCII (`.` floor, `~` pit, `P` pillar, `S` spawn, `T` treasure, `H` shrine, `M`
mechanic slot, `B` boss, `E` entrance, `X` exit, `o` prop, space = not part of the room) and
tags: its role (`start`, `combat`, `hall`, `treasure`, `shrine`, `boss`) and the styles it
suits. **Add a layout style:** add it to `LayoutStyle` and `STYLE` (corridor length/width) in
`generate.ts`, plus a style pass (like `erodeCaves` or `ruin`) if it needs one.

## The bypass guarantee

Every level must be clearable **without using its mechanics**: the exit is reachable from the
start while treating every mechanic element (solid, hazard or zone) as blocked. It is
enforced while placing: `Placement.add` (`mechanics/common.ts`) refuses any element that
overlaps the critical path corridor (the path ± 1 cell), the entrance/exit/boss/chest/shrine
spots or another element, or that would cut the start from the exit; mechanics simply try
another spot. `validate.ts` re-checks it independently (with reachability, room count,
encounter budget, overlaps and build time) for `npm run level -- validate 1..60` and the
unit tests. Mechanics still place their best spots next to the road (haste pads two cells
away, wisps lighting it, lanes aimed at pits), so exploiting them is always one step aside.

## Encounters

Each room gets packs by area × `SCALING.density(depth)`; each pack has a power budget
`SCALING.monsterBudget(depth)`: a rare or magic leader by chance, normals up to 4–7 members,
and the rest as per-member `power` for the monsters system (bigger bodies, parts, elite
mods), so deep packs get stronger rather than bigger. The boss room holds the boss (the
spec's `boss` genome) plus packs. Validation keeps spending within 80–120% of the budget.

## Rifts (endless)

`riftSpec(seed, depth)` (depth > 12) picks `SCALING.riftMechanics(depth)` (2–4) mutually
compatible mechanics, a theme (half the time the first mechanic's home theme) with a palette
shift that swings wider deeper, a weighted layout style, 3–5 archetypes, a boss genome
placeholder, and names it after its mechanics: *Rift 37: Frostglass Embers Gloom*.
`levelSpec(depth, runSeed)` gives designed levels for 1–12 and rifts beyond. `core/scaling.ts`
gives monster life, damage, XP, item level and gold for any depth, with no cap.

## Tools

- `npm run level -- map 7` → `.scratch/levels/07-mire.png`: floor, walls, pits, rooms (id +
  role), the critical path, mechanic elements (solid framed, hazards hatched, zones filled),
  packs by rank, chests, shrines, torches, start, exit and a legend with the validation.
- `npm run level -- validate 1..60` (exit 1 on problems), `rift <seed> <depth>`, `themes`.
- `/?game=levellab&depth=N` (`&seed=S`, `&god=1`): WASD, J/Space swings (hits braziers and
  pylons too), K casts a firebolt (a moving light). `window.__LEVEL_LAB__` has `autopilot`,
  `killBoss()`, `teleport(x, z)`, `log` (mechanic events) and the level.

## What levels need from actors and combat

`ActorLike` is enough to run, but the real game should provide: multiplier stats with base 1
(`move.speed`, `attack.speed`, `damage`, `damage.taken` (with the hit's tags), `xp.gain`,
`light.radius`, `area`, `item.rarity`) and read them; honour `StatSheet` conditions
(`inDark`, `tailwind`, `onIce`, `inThorns`, `inMud`); treat `push` as a velocity impulse;
emit `skill` for every hero skill use and `kill` for every death (Echoes, Bloodmoon,
Frostglass, Thornweave, Gravewell listen); include `level.targets()` in hit queries; and
implement `hooks.applyHit`, `replaySkill`, `teleport`, `dropLoot`, `onFall`.
