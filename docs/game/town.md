# Town (`src/riftlight/town/`)

Emberfall is data in `TOWN_LAYOUT` (`town/layout.ts`: screen-space metres, `iso()` maps them onto
the 45° ground, `screenOf()` back) built from primitives by `town/kit.ts` and merged to one mesh
per material, in cells (the hub as one, the outskirts in 10 m squares: `Kit.build(cell)`), so only
the cells in view draw. The hub is the plaza and its ring (smithy, market, tent, stash, obelisk,
houses); around it the walkable circle (`radius`, 31 m: about 1,900 m² of open ground,
over three times the hub's) holds the **outskirts** (`town/outskirts.ts`), built mostly from the imported
Kenney packs (docs/assets/importing.md *Imported so far*; `loadRiftlightPacks`, `riftlight/packs.ts`,
loads them before the town is built), with sand paths from the hub to each district:

| district | where | what |
| --- | --- | --- |
| the Old Watch | north, behind the obelisk | a curtain wall of castle stone (`kenney-castle/wall-narrow`, the gate, stairs, two breaches of `rocks-large`) on an arc, the west tower standing with its banner, the east one broken where the rift came through: a glowing crack with crystals runs from the obelisk to it (a cyan light); a colonnade (`kenney-nature/statue-column`) up to the old gate, a wrecked catapult and ballista, the old warden's stone head, banners on the wall |
| the tavern | north-east | a timber-framed inn (kit) with a patio: `kenney-furniture` tables and chairs, `kenney-mini-dungeon` barrels, potted plants, a lantern |
| the stream | east | `kenney-nature` river tiles in a cut in the ground (`groundPieces`), lilies and reeds, crossed by `bridge-wood` (its deck is walkable, `Town.groundY` ramps over it; the water is not) |
| the hunter's camp | across the stream | a tent, the library `campfire` (an orange light, embers and smoke), log seats, firewood, a canoe on the bank, the woods |
| the watchmen's graves | south-east | low headstones in a low wall, candles, a memorial stone, a dead tree at the back |
| the road out | south | the road through a timber gate between palisades and two watch towers, a signpost, a notice board, a cart |
| the willow pond | south-west | a pond tile drawn 2.4 times its size in a hole in the ground, lilies, reeds, the library `willow`, a bench |
| the farmstead | west | a fenced field of crop rows (corn, wheat, leaves, pumpkins, carrots), a red barn (kit), the library `well`, haystack, bales, log stack, cart |

Past the edge the forest stands in loose rings (pack trees mixed with `tree.glb`; low kinds to the
south, so the edge toward the camera stays in view). **The camera looks from the south**
(`TOWN_LAYOUT.view`: yaw 45°, pitch 42°), so anything tall hides what stands north of it. Tall
pieces stand on the north side of each district, and where the ground behind something tall can
still be walked (the tavern, the barn, the gate's watch towers, the willow, the hub's houses and
the smithy's back wall), it is closed: `Kit.closeBehind(x, z, w, d, h, view)` closes the ground
from the thing's back edge (as the screen sees it) back by (h − 1.6) / tan(pitch), the hero's head
under its top, or, for a roof (`h` = `{ eaves, ridge }`), from its middle by (ridge − 1.6) /
tan(pitch) where that reaches further, in screen-aligned slices half a metre wide. Each district has a spot in
`TOWN_LAYOUT.districts` (`Town.districts`, world points) where the camera shows the hero, feet to
head (`outskirts.test.ts` casts rays from 0.1, 0.9 and 1.6 m to the camera through the merged
meshes), and the test sweeps every cell the hero can walk to: no patch of ground where he is hidden
is bigger than 5 m², and all of it is under 4% of the town (a tree's crown hides a few steps).

**Walking.** Actors collide with the blockers (`Town.obstacles`: trees and posts as circles at
the trunk, buildings, walls and furniture as boxes from `Kit.model`'s bounds, the water and the
bridge's rails as `low` boxes, closed ground behind the Old Watch's wall, past the gate and behind
the tall pieces) and the circle. `Town.collide` holds an actor to the circle and pushes it out of
the townsfolk, then each blocker in turn (last, so nothing leaves it in a wall), a few passes over;
the closed ground behind the wall and past the gate runs well past the edge, so the nearest way out
of it is always toward the town. Should it still end deep in something (more than 5 cm: wedged in
a gap narrower than it, or landed in the water by a Blink and pushed back and forth), it is set on
the nearest ground that can be walked to from the plaza (`TownNav.nearestReachable`); walking never
sets it off. No gap in the town is narrower than a walker but wider than nothing (the log seat by
the stream stands a metre off the water: the Blink and dash test lands in any it finds), and
nothing is shut in (the pocket test). **A Blink in town** stops short of walls as it does in
a level: the town hands its `wall` query (`Town.wall`, exact: where the line enters a box that isn't
low, or leaves the circle) to the combat world the hero brings (`StageWorld.wall`); it goes over the
water and past trunks, as a level's pits and props don't stop it. `Town.nav()` is the walkable
grid (`town/nav.ts`, half-metre cells, the hero's 0.35 m radius, built in a few milliseconds):
`route(a, b)`, `reachable(from, points)`. `__RIFTLIGHT__.moveTo` walks it in town. The tests flood
it from the spawn: every interactable, NPC path point, the portal spawn and district are reachable;
on a looser grid (a smaller actor, quarter-metre cells) the water is not, nor is anything behind the
wall; on a finer one every spot the hero fits in is one he can walk to (no pockets) and none of
them moves him when he stands there; and a Blink or a dash from all over the town, in every
direction, never ends where he can't walk back from (he walks back, collide and all) or goes
through a wall. `src/riftlight/game/flow.test.ts` walks the hero to every district and back (headless).

**Lights and motion.** The campfire and the rift's crack borrow lights from the pool with the
lanterns (`activate`); their flicker, embers and smoke come from `this.time`, so the outskirts add
no per-frame state of their own. **Add to it:** a place goes in `TOWN_LAYOUT` (its anchor and, if
visitors walk there, a `districts` spot) and a method of `Outskirts` that places pack models with
`m`/`put`/`trunk` (ids written in full, `kenney-nature/tree-oak`: the single-file build embeds the
pack models the code names, and `outskirts.test.ts` checks every one exists); then capture it in
the game, from its spot and at night (`__RIFTLIGHT__.setTimeOfDay(0.7)`), and run the town's tests.

Townsfolk wear the
hero rig with their own meshes (`npcModel.ts`) and play clips written as data (`npcClips.ts`:
Hammer, HammerRest, Nod, Shuffle, Greet, CountCoins, Meditate, Bless, StaffIdle, Gesture; the
villagers use the hero's Idle and Walk). `npm run anim -- check` measures them with the hero;
`--character brann` (ilsa, oru, vex, villager, villager2) selects one for `sheet` / `curves`.
At runtime (`npcs.ts`) they turn their heads toward the hero, bark when you come near, react
when talked to (Brann rests his hammer and nods, Oru blesses, Vex points at the obelisk;
Ilsa waves as you come near) and open their view: Brann the crafting bench, Ilsa the vendor, Oru the tree respec,
Vex the rift menu, the chest the stash.
