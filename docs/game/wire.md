# Wiring (`src/riftlight/wire/`)

## Wiring: hero, levels and monsters

`corePorts()` (`wire/index.ts`) gives the shell the real hero, levels and monsters; they share
one `Worlds` map (stage → `CombatWorld`).

- **One combat world per stage** (`wire/world.ts` `CombatWorld`): combat's `ActorManager` and
  `Combat` on the shell's event bus, the stage's wall query, `light` events turned into
  `ctx.lights` requests, and combat shake sent to `services.shake`. A level builds its own; the
  town's is made by the hero when it walks in. `enter()` moves the hero actor from world to world
  (its buffs, cooldowns and stats travel with it).
- **The hero** (`wire/hero.ts` `RealHero`): the actors' `HeroController` with a `StageMover`
  (kinematic: slides along walls, rounds corners, falls into a pit only when shoved). One input
  path: the shell's `HeroIntent` (keys, mouse, pads, touch, the bot) becomes its input. The bar
  comes from the save's sockets (`socketsToSlots`, gear's `skill.level`); a save with nothing
  socketed gets `WIRE_TUNING.defaultSkills`. Stats: `HERO_BASE_STATS` + the `level` source
  (`progression.ts` `levelMods`) + the starter sword until gear brings a weapon + `setMods`
  sources (gear, tree, difficulty). `skills()` / `buffs()` / `vitals()` feed the HUD.
- **Levels** (`wire/levels.ts` `LevelStage`): the levels system's `buildLevel` with every hook wired
  (`spawnMonster` for packs, designed and generated bosses; `applyHit` for hazards and props;
  `replaySkill` for echoes; `teleport`; `dropLoot`; `onFall`). It owns the combat world, the
  packs and hazards, the theme's filters and song, telegraph decals, the minimap and health
  globes (`globes.ts`: 20% life, 15% mana). Loading builds every pack and preloads every clip
  and material (adds and boss summons too), then renders two warm-up frames: no hitch when a
  pack wakes up.
- **Monsters** (`wire/monsters.ts` `MonsterUnit`): the monsters system's genome → `buildMonster` → a combat `Actor`
  (`MonsterBody`) with a grid mover, driven by `MonsterBrain` / `BossBrain` with its pack. Life,
  damage, armour and accuracy follow depth (`progression.ts`, `WIRE_TUNING.monster`); a boss's
  life and damage land on a fixed budget whatever its parts (`bossBudget`). Wind-ups show a
  telegraph that stays until the attack lands (projectiles and charges too), so every big hit
  can be dodged; plain swings show a soft one. Boss patterns and level hazards are
  `wire/hazards.ts`.
- **Kills, XP and loot.** An actor dying emits `kill` `{ target, killer, rank, depth }` on the
  bus. The shell gives XP (× `xp.gain`); the level rolls drops through
  `LootPort.rollDrops(KillInfo)` (`KillInfo` carries the hero's `item.rarity`, `item.quantity`
  and `gold.find` as fractions above 1) and `spawn`s them at the corpse, and may drop a health
  globe. `levelClear` fires once when the last monster dies.
- **Feel.** Hit-stop and screen shake from the hit size (`Combat`; a killing blow holds two
  frames longer), damage numbers from `hit` (the shell), flinch and hit clips, corpses that
  pixel-dissolve (`BodyFx.dissolve`, the toon `dissolve` option), a boss bar with phase ticks.
  Crits, kills and level-ups flash a pooled light; hits throw a burst of their element.
- **Presence.** Monster bodies use the toon `rim` option (a hard rim light in their glow
  colour), a shared contact shadow, elites and bosses a pooled glow light and a TSL aura on
  the floor (`auraMaterial`: turning dashes, a crisp rim). Big circle telegraphs (bosses, ≥ 2 m)
  light the floor they cover, brighter as the hit nears.
- **Telegraphs** (`combat/telegraph.ts`, `createTelegraph(shape, colour)`): a 2 px rim and a
  stippled sweep whose front meets the rim on the hit frame, blinking hot in the last 20%;
  coloured by damage type (`TELEGRAPH_COLORS`: rim + sweep per element), pixel-crisp at any
  size (`fwidth`), transparent and drawn under actors. `{ zone: true }` is the calm look for
  lasting hazards; `tint(type)` recolours one once its attack is known.

## Wiring: loot, skills and the passive tree

`new Riftlight()` runs the real `LootPort` and `TreePort` next to the core ports (`{
...stubPorts(), ...corePorts(), loot: realLootPort(), tree: realTreePort(), ...ports }`).

**Overlay panels.** The item windows (`ui/items`) and the passive tree (`ui/tree`) paint their
own canvas, so they are `Panel`s with `overlay: true`: the shell opens them (`open()`), keeps
them on the stack (modal or not), routes every `UiEvent` to `input()` first, calls `draw()` each
frame (time to paint) and closes them (`close()`); it draws no frame, and a pointer press is
the UI's when `covers(x, y)`. Panels in one `group` share an overlay (the item windows are
group `items`): opening one closes the others, and I closes any of them. The passive tree owns
the keyboard while open (Escape / P close it and never reach the pause menu), its pointer and
the pad's sticks and A / X / Y; pad B and the agent API's `back` come through the shell.

| view | from | keys |
| --- | --- | --- |
| inventory + paper doll | I, pad Back, pause → Inventory | click / drag, right-click (X) equips, Ctrl-click (V / pad Y) moves, Alt shows tiers |
| skill panel (gems in 4 slots, 3 links each) | G, the inventory's GEMS tab, pause → Skills | right-click (X) a gem in the bag sockets it in the selected slot; on a socket it takes it out |
| stash (4 tabs) | the chest | Ctrl-click stores / takes, Tab / pad LB RB switch tabs |
| vendor (wares and gems tabs) | Ilsa | click buys, Ctrl-click sells, drop an item on her grid to sell it |
| crafting bench | Brann | click an item, then an orb (the orb row greys orbs that can't apply) |
| passive tree / respec | P, pause → Passive tree / Oru | click takes the path; only Oru refunds (`respecCost` gold a point) |

Keys and pads step a cursor between cells, slots and sockets (arrows / d-pad / stick), confirm
is a click, X a right-click, V / pad Y a Ctrl-click, back puts a held item back then closes.
Touch: a tap shows the tooltip, a second tap acts, a long press is a right-click. A narrow
screen (a phone in portrait, 124 art pixels) stacks the left window over a compact bag.

**Skill sockets.** `save.hero.skills[slot] = { slot, gem, supports: [gem, gem, gem] }` with gem
*items* (`loot/sockets.ts`); a new run starts with Cleave, Frost Nova, Dash and War Cry
socketed. Gems are the skills system's `SKILLS` / `SUPPORTS` (`loot/data/gems.ts` lists every active but the
basic attack and the dodge, and every support); they drop (~6% of items) and Ilsa's gems tab
sells them. The panel shows each slot's `buildSkill` numbers on the hero's StatSheet (hit,
DPS, cost, cooldown, cast time, area / projectiles, links that don't fit: a pocket
`npm run combat -- dps`). When sockets change the panel writes the save and calls
`changed('skills')`; the shell calls `hero.setSkills(save.hero.skills)`, and
`socketsToSlots(skills, hero.stats)` turns them into `HeroController` slots (`{ skill, level,
supports: [{ gem, level }] }`, null for an empty slot; the level adds gear's `skill.level` mods
that fit the skill's tags, as the panel's numbers do).

**Gem levels.** Socketed gems (skills and supports) earn the XP the hero earns (PoE-style), kept
on the item as `gem.xp` (an optional field: older saves load at 0). A gem of level *g* needs hero
level `SCALING.gemLevelReq(g)` (2, 4, 6, 9, 12 … 25 at gem 10, 70 at gem 20), and
`gemXpToNext(g)` is the hero XP between two requirements, so a gem socketed from the start is
ready for each level as the hero reaches it; a gem that is ready early holds a full bar ("levels
up at hero level N") until then. On a kill the shell runs `addGemXp(save.hero.skills, xp,
level)`, hands the sockets to the loot port (`LootPort.setSockets`), re-slots the bar and shows
a "CLEAVE REACHED LEVEL 4" toast. The skill panel draws an XP bar under every socketed gem and
the title line shows the main gem's XP; the gem tooltip shows `Experience x/y (z%)`.

**Loot in the world.** Drops are loot's `rollDrops` with the hero's `item.rarity`,
`item.quantity` and `gold.find`, shown by `WorldLoot` (arcs, landing sounds, beams; lights from
the engine's `ctx.lights` pool) under the stage's root. The shell draws the labels (framed for
loud drops, grey for dim ones, stacked so they never overlap) and picks up. `filtered` follows
the loot filter setting (show all / hide normal gear / rares only; currency and gems always
show) on top of loot's filter rules; Alt shows everything. Gold the vendor takes or pays goes through
`addGold`: the save's gold is the one wallet.

`npx tsx scripts/riftlight/stat-names.ts` lists every stat name loot and the tree put on a
StatSheet, with where each comes from (`.scratch/stats/emitted.json`).
