# Themes, props and mechanics (`levels/themes/`, `levels/mechanics/`)

## Themes and props

A `LevelTheme` (`themes/themes.ts`) is data: palette (floor, wall, accent, fog, sky, light),
`floorAlt`, `trim`, `cliff`, ambient and sun colours and intensities, height-fog distances, torch
intensity/radius/flicker, prop ids and density, wall height, `surfaces`, a `song` id and optional
`filters`. Floors stay mid-dark and quiet, walls darker (silhouettes), trim and accent carry the
identity, and in dark themes ambient + sun stay low so the dynamic lights carry the mood.
`surfaces` textures the floor and the wall faces with library textures (docs/assets/textures.md; `npm run tex -- zoo surface`): each binds every slot of its texture to a theme tone,
one of the theme's colours by name (`floor`, `floorAlt`, `wall`, `trim`, `cliff`, `accent`) or
`[name, k]` tinted like `tint` (`{ texture: 'flagstones', slots: { joint: ['floor', -0.35], slab:
'floor', slab2: 'floorAlt' } }`), so a rift's shift recolours it too. Keep the fill slots (slabs,
stones, tiles, plates) close in lightness, since a floor is the backdrop actors read on; dark joints
and seams are fine. What holds a floor quiet is its texel edges: how much a surface shimmers as the
camera zooms tracks the share of neighbouring texels that differ in colour, not their contrast
(docs/assets/textures.md *Texel density*: Gate B's line is a share of about 36%), and a floor fills most of
the frame, so `levels.test.ts` holds every theme's floor, in its tones and in rift shifts, under
33% (walls, a small part of the frame, under 45%). Slots bound to one tone bake as one colour,
which is the cheap fix: the cobbles' lit and shadow rims take the stone's tone (46% of texel pairs
differ with the rims, 27% without), and Gravewell's plates' lit edge takes the plate's (30% to
20%). Textures sit in world space at the engine's texel density (Gate B), so they run on across
cells and round the corners the camera sees; floor cells along a wall take the floor surface
darkened, and caps, trim bands and cliffs stay flat. Without a floor surface the floor is flat, in a
2×2 pattern of `floor` and `floorAlt`; without a wall surface the walls are flat. **Add a theme:** add an
entry to `THEMES`; `npm run level -- themes` shows it with three rift shifts and its floor/wall
contrast. **Add a prop:** add a `PropDef` to `PROPS` (`themes/props.ts`) naming a library model
(`model: 'barrel'`; docs/ASSETS.md, `npm run model -- find`) and, if the theme should dress it, a
`bind(theme)` that gives its slots the theme's tints, its light the theme's torch and its params; a
model with a `light` makes the prop request one. The binding can also place the model in its cell
(`at`: the wall torch backs onto the cell's −z edge) and size it (`scale`, when its params can't). A
prop with fire sets `flame`: its flame faces the camera (docs/ASSETS.md, *Fire faces the camera*),
so `'fixed'` keeps a round prop unturned and a param name (the wall torch's `turn`) hands the prop's
turn to a model that turns its flame back. A missing model is a new library entry first
(`src/engine/model/library/`). Seeded models vary per prop (each gets its own seed from the level's
rng). **Pack variants:** a prop may also wear an imported pack's model in the themes that read
better with it (`variants`: the model, its odds against the prop's own, the designed theme ids, a
`bind` with the theme's tints and a size; `propModels(def, theme)` lists them): Mini Dungeon barrels,
chests, columns, pots and stones in the forge, the crypt, the cathedral, the observatory and the
ruins; Nature stones, rocks, pines, bushes, stumps, logs, mushrooms, flowers, a sign and statues in
the cliffs, the jungle, the swamp, the peaks and the caverns (the log and the obelisk in the ruins
too, the obelisk in the crypt); the Castle kit's war pennant for the banner. Each
prop picks from its own stream after its seed (`buildProp`), so the plan is untouched: the same
cells hold the same props, block the same cells and keep the bypass guarantee, and a level looks
the same every time it's built from the same seed. A variant's palette binds the pack's shared
slots (`dungeonStone`, `natureStone`, `natureLeaves`), cut to the slots the model has (`fitSlots`).
The packs load before a level is built (`loadRiftlightPacks`; `validateSpec` loads them in node), and
`props.test.ts` holds every variant of a blocking prop to its cell like the prop's own model.
Props are picked by `weight` (lanterns and glowcaps weigh more and candles less, so a theme's
lighting holds as it gains kinds); a theme naming a prop with no `PropDef` throws. Blocking props
only land where all 8 neighbours are open floor (a single blocked cell can't cut a path) and never
on the critical path; actors collide with that one cell, so nothing of a blocking prop below 1.8 m
reaches more than 0.75 m from its centre (`themes/props.test.ts` checks every theme's).

Rifts shift a theme's palette (`shiftTheme`: hue rotation, contrast, saturation) and clamp
it back into readability bounds: floor lightness 0.16–0.5, walls ≥ 0.07 darker than floors,
saturated accents. A shifted theme id (`ember-forge~h40c105s110`) resolves anywhere with
`resolveTheme`, so specs stay plain data.

Lighting: emissive props (torches on back walls, braziers, candles, lanterns, crystals, mushrooms),
mechanic elements, chests, shrines, the portal and effects all request lights from the
engine's `LightPool` (docs/engine/lights.md); the pool lights the 4/8/16 that
matter most near the camera and fades the rest.

## Mechanics

A mechanic is a `LevelMechanicDef` (`mechanics/types.ts`): `place(ctx)` adds elements to a
generated layout (pure data, runs headless in the CLI) and `install(level)` returns the
runtime (`update(dt)`, `affect(actor, dt)` every fixed step for every actor, `dispose()`).
`install` receives a `MechanicLevel`: the core `LevelRuntimeContext` plus the theme, its
elements, `light`, `burst`, `sound`, `emit`, `damage` (through `hooks.applyHit`), `buff`
(timed stat sources), `addTarget` (hittable objects), `setCell` (runtime grid changes) and
the `env` lighting multipliers. Effects on actors go through `ActorLike.push` and the
`StatSheet`: each mechanic sets a source `mechanic:<id>` whose mods use a condition (`when`)
it toggles with `stats.setCondition`. Every mechanic emits `mechanic { id, event, at }`.

| mechanic | elements | affects actors | events | speedrun / power-level reward |
| --- | --- | --- | --- | --- |
| Embers | braziers (solid, hittable) | fire blast + knockback, chains | explode, chain, relight | chain buff: xp.gain, fire damage |
| Gloom | lanterns (solid), wisps on the main road | `inDark`: monsters more damage, hero more damage taken | lanternLit, allLit | xp.gain per lantern; all lit: shrine buff |
| Gale | wind lanes (aimed at pits when possible) | gust pushes; `tailwind` +move.speed | gust, blownIntoPit | tailwind speed, pit kills |
| Frostglass | ice sheets | momentum push; `onIce`: +speed, cold vulnerability | shatter, shatterChain | shatter-chain buff |
| Thornweave | thorn patches | physical ticks + bleed; `inThorns` slow | thornHit, harvest | harvest xp.gain per thorn kill |
| Stormspire | pylon pairs (solid, hittable) + arcs | lightning + shock on the arc | arc, overcharge, zap, conduct | overcharge: monsters-only arcs; conductor buff |
| Mire | mud pools, haste pads beside the road | `inMud` slow | haste, hasteChain | chained haste (move/attack speed) |
| Echoes | resonance crystals (solid) | replays hero skills 2 s later (`hooks.replaySkill`) | record, replay | full-damage echoes + damage buff near crystals |
| Riftgates | paired gates in far-apart critical rooms | teleports any actor (`hooks.teleport`) | teleport | shortcuts + rift-haste |
| Bloodmoon | blood altars (solid) | monsters explode on death (`kill`), red tint; blasts landing on the hero together hurt 1/k each | explode, chain, pact | chain xp.gain; pact spares + heals the hero |
| Gravewell | wells (radius 2–3) | pulsing pull (hero resists) | pulse, shard | gravity shards: area, xp.gain |
| Collapse | crumbling floor zones (+ loot caches) | floor drops into the void behind the hero and rises back 9 s later (nothing is cut off for good); a fall returns the hero to solid floor | crumble, cache, bonusLoot | caches; bonus loot for clears under par |

**Loot that bends a mechanic** (the power-leveller's side: affixes and uniques in
`loot/data/`, read off the hero's sheet by the mechanic with `heroScale` / `heroFlat` /
`heroHas` in `mechanics/common.ts`; `levels/affixes.test.ts` checks each):

| mechanic | stats | effect |
| --- | --- | --- |
| Embers | `brazier.area`, `brazier.damage`, `explosion.damage`, `brazier.selfIgnite` | wider blasts and chain reach; harder blasts on monsters; blasts set the hero alight (`ignited` for 6 s, Emberheart's more damage) instead of hurting it |
| Gloom | `lantern.duration` | lantern XP and the all-lit shrine buff last longer |
| Gale | `wind.resist` (negative on Galecaller), `inWind` | less (or more) push from gusts; `inWind` while in a gust (Galecaller's extra projectile, the Galeborn prefix) |
| Frostglass | `shatter.chance` | the hero's kills shatter off the ice too |
| Thornweave | `thorns.immune`, `thorns.reflect` | vines part for the hero (no damage, no slow); vines hurt monsters (1 + 3 × reflect)× harder |
| Stormspire | `pylon.chain`, `nearPylon` | an arc leaps from each monster it hits to that many more; `nearPylon` within 4 m of a pylon (the Pylonbound prefix) |
| Mire | `mire.immune`, `haste.duration` | mud never slows the hero; haste pads last longer |
| Echoes | `echo.damage`, `echo.delay`, `echo.repeatsSkills` | stronger, sooner echoes; every cast echoes twice |
| Riftgates | `gate.damage`, `recentlyGated` | gates tear at monsters passing through and empower the hero for 4 s; `recentlyGated` for 4 s |
| Bloodmoon | `explosion.damage` | corpse explosions hit harder |
| Gravewell | `well.immune`, `well.resist` | the pull skips or weakens on the hero |
| Collapse | `collapse.bonusLoot`, `collapse.fallImmune` | more items from caches and the under-par bonus; falls (any level) cost no life |

`excludes`: gloom ↔ bloodmoon (both relight the level), frostglass ↔ mire (both are floor
surfaces), riftgates ↔ collapse (gates over vanishing floor). **Add a mechanic:** write a
`LevelMechanicDef` in `mechanics/`, add it to `MECHANICS` (`mechanics/index.ts`), give it
`excludes` for combinations that make no sense, then `npm run level -- validate` and
`npm run level -- map <depth>`; rifts start using it automatically.
