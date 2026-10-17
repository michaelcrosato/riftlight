# Save-states (`Riftlight.snapshot` / `restore`)

A moment of play kept as JSON and put back at once (docs/engine/determinism.md *Save-states*), instead of
replaying everything before it:

```ts
const snap = await engine.snapshot();   // in town ~15 KB of JSON, mid-fight in a level 0.2-0.8 MB
engine.step(600);                       // play on (another level, a death, anything)
await engine.restore(snap);             // back at that moment: town in milliseconds, a level in under a second
```

`Riftlight.snapshot()` keeps the save and the slots it knows, the run's random stream, the id
counters (actors from 1, props from 1,000,000), the hero (`RealHero.saveState`: the controller
and its actor with every stat source in order, the action in progress, cooldowns, charges,
curses, the animation blend's clocks and weights and how the body is drawn (gait clocks, hips,
hops), the town's combat world), the loot
(`RealLoot.saveState`: bags, gear, sockets, this visit's vendor stock, the crafting stream, the
item windows' tabs), the town (`Town.saveState`: its clock and time of day, each townsperson's
walk, timers, random stream and clip, the cat, the extensions' own) and what the shell keeps
(timers, banners, damage numbers, the camera's lead, the pointer, key repeat). Only the
settings play reads are kept (`playSettings`); storage is not touched. Each part is plain
data with a `save`/`load` (or `saveState`/`loadState`) beside the code that owns it, returned
as it is (a buff that never ends expires at `Infinity`: never copy state through JSON), and a
load replaces what is there (skills in flight, an actor made since: gone); an actor another
one points at is saved as its id (`core/saved.ts`). Restoring works from anywhere: photo mode,
the arcade and the Hall of Beasts are left first (`beforeRestore`), a level is left and panels
close, quietly (no autosave, banner or sound). A snapshot that doesn't fit (another town, a skill
gem this game doesn't have, a level whose plan this game would build differently:
`LevelPort.signature`) is refused before anything changes (`Town.fits`, `RealHero.fits`); one
that still fails part way (a level that loads differently from its plan) leaves the game at the
title, never half a moment.

A snapshot is taken in town or in a level, mid-fight included (effects in flight, telegraphs
winding up, hazards staged, adds and minions out, loot on the ground), with no panel open and
nobody talked to; the title, loading and the showcase are refused, saying so.

**A level is built again, then loaded.** Entering a level is deterministic from the save, the
run's random stream and the id counters, so `snapshot()` keeps what it was built from
(`LevelEntry`: the spec, the shell's random stream and the actor and prop id counters as
`ports.levels.build` was called) and the level's own state (`LevelStage.saveState`: its monsters
and hazards, its runtime and props, its combat world). `restore()` builds it again the same way
(the same layout, props and monsters with the same ids and genomes), enters the hero, and loads,
in an order that lets everything find what it points at: the actors combat made (minions,
totems, trap stand-ins: `CombatWorld.make`), the monsters (`loadUnits`: adds made since entry
made again from their genomes with their own ids, monsters gone since taken away, then every
unit's state, packs, brains, hazards), the runtime and props (`loadRuntime`), then the hero
through the full index, the combat world last (it re-links motions in progress). An actor is
always made again with its own id (`setActorIds(id)` right before), never by replaying who was
made in what order, and the counters go back to the snapshot's after. The shell's level fields
(time, cleared, the recap, combat heat and music, the loot under the pointer) come back with
it. `Riftlight.fingerprint` includes the town (townsfolk, the cat, the time of day, its random
stream) as well as the hero, every living monster and the loot, so a level or a town that went
on differently shows. A monster's target or attack that has left the world (a minion that died)
is kept by combat as a ghost (`Combat.holdRefs`), so a summoner's fight is never refused. Not
kept, because they are pictures that play never reads: particles, light flicker, a cross-fade in
progress and the feet foot placement has planted (a restore lets them go, so a stride may settle
a few frames differently).

Tests: headless, `src/riftlight/game/snapshot.*.test.ts` (town and every designed depth,
mid-fight, restored and played on to the same fingerprint; the `riftlight-snapshot` e2e suite
restores one of each in the browser for its frames) and the unit tests that
round-trip each part (`actors/saved.test.ts`, `town/saved.test.ts`, `combat/saved.test.ts`,
`wire/monsters-saved.test.ts`, `levels/saveState.test.ts`, `wire/levelSave.test.ts`).

**Combat in a save-state** (`combat/Combat.ts`, `wire/world.ts` `CombatWorld`). `Combat.save()`
is `CombatState`: the clock, counters, random stream, shake and the damage numbers on screen
(kept, not rebuilt), every running effect in order and the queued repeats (multistrike, spell
echo: data, `{ at, op: 'repeat', caster, skill, aim, opts }`, run by `fixedUpdate`), the short
flashes still lit, and the actors combat made. Each effect class saves `{ kind, cast, ...its
own }` (the cast: caster by id, the skill as `SavedSkill`, aim, direction, options) and
`RESTORE` (`deliveries/index.ts`) makes it again from that: its state and meshes, its light
asked for again, a dash's or leap's motion linked back onto its caster, none of its start-up
(no hits, sounds or bursts). A cast's closures are wiring: `held` is saved as what it tests
(`CastOptions.hold`, the hero's key name) and `aimNow` as a flag, and the caster's owner makes
them again (`Combat.wire(actor, wiring)`; the hero controller registers its own). A trap no
longer holds a closure: a sprung Trap-support trap calls `Combat.spring`. Minions and totems
come back by their construction arguments (genome, owner, spot, skill, time; recorded with
`Combat.adopt`) and their actor, mover and brain states; trap stand-ins (`proxyOf`) by owner
and spot while an effect or an ailment still points at them; an actor gone from the world that
an effect, a queued repeat, an owner, an ailment or a curse still points at (a monster that
crumbled while its flame wall burns) comes back bare as a *ghost* so that reference holds. A
restore is three steps after the stage rebuilt its own actors: `world.make(s)` (combat's
actors with their saved ids: `setActorIds(id)` right before each, the counter put back after),
every other actor's state loaded through `world.index()`, then `world.load(s)` last (actors
that are not in the state leave quietly; what ran goes without a sound; everything above comes
back). Status visuals follow the actors' state; a body's flash and ragdoll are in `ActorState`
(a corpse leaves when its ragdoll ends). Refused, saying why: a cast held by a closure with no
`hold`, a cast whose closures nothing wires again, a minion whose brain or mover keeps no
state, a summon factory that does not build exactly one actor with the id asked for.
`combat/saved.test.ts` plays a scripted fight with every delivery and saves it at 30 moments;
each comes back the same in a fresh world, mid-fight, and loaded twice.

**Monsters and hazards in a save-state** (`wire/monsters.ts`, `wire/hazards.ts`, `monsters/`).
`LevelStage.saveUnits()` keeps each unit in the level's list (alive or a corpse still lying
there) by its actor's id, with what it was made from when the level's build didn't make it (an
add, a split, a clone, a dev spawn: genome, place), its pack and its state: the action and its
telegraph in progress, cooldowns, the brain's (target by id, timers, its random stream), the
boss's phase and attack schedule, its mover and animation; also the units out of the list
something still points at (the boss bar, a hazard's source), the level's own monsters gone
since, the packs, the add genome cache, the stage's and the brains' random streams, and every
staged hazard. A hazard is a small class holding its arguments and clocks, and a delayed one is
data (`LaterOp`) run by a dispatcher in the same order as before, reading positions when it
fires; loading replaces what is staged without side effects. Telegraph decals are pictures:
their owner keeps the progress and draws them again.

**The level runtime in a save-state** (`levels/Level.ts`, `levels/mechanics/`, `wire/globes.ts`,
`loot/world.ts`). `Level.save()` keeps the clock, cleared and exited, the portal, each pack's
spawn and actors by id, ranks, timed buffs, opened chests and used shrines, the last safe spot,
the explored map, the light environment, both random streams, the flow field and the props, and
each of the twelve mechanics' runtime (`install()` returns it with `save` / `load`: embers'
relight timers, gale's gusts, frostglass's shatter stream, collapse's falling cells...).
`saveRuntime()` adds the stage's counters and warm-up, the globes on the floor and each prop's
combat actor; the loot on the ground is the loot port's (`WorldLoot`: item or gold, arc, tier,
beam, light, label, the drop a click is walking to). A level built differently (another pack
count, mechanic list, prop or actor ids) is refused before anything changes.
