# Riftlight: the showcase game

Riftlight is a fast, fluid hack-and-slash ARPG built on this engine. It exists to show other
agents how to build a complete game here, so every system is written as an example. The hero
is our existing hero, with the same rig and clips plus new combat clips. The structure is
run-based: town → level → town → next level, with no story beyond flavour text. The progression
loop takes after Path of Exile 2 and Diablo IV: XP, gold, loot, a deep passive tree and skill
gems with supports. Twelve designed levels each introduce one mechanic, the level is named after
that mechanic, and later levels combine them. After level 12, **Rifts** generate endless levels
by combining mechanics, monster archetypes, themes and palettes, scaling with depth.

Code lives in `src/riftlight/`. The game is the default page (`/`); the movement playground
is `/?game=playground`.

## The design language (read this first)

Everything in Riftlight is **content as data, combined by generators**. The base of every
system is built traditionally: hand-made parts, hand-tuned numbers. Every system is also
**modular and procedural**, so the same parts recombine without end. Spore is the model: a
hand-made library of parts, plus a grammar that combines them.

Five rules, applied to every system:

1. **Registries of tagged parts.** Every kind of content is a `Registry<T>`
   (`core/registry.ts`) of plain-data entries, each with an `id`, `tags` and `weight`. This
   covers affixes, item bases, uniques, skills, supports, passive nodes, monster parts, body
   plans, behaviour archetypes, elite modifiers, bosses, mechanics, themes, room templates,
   props, NPCs and sounds. Generators never name entries; they **query by tags** and pick by
   weight. Adding content means adding an entry; nothing else changes.
2. **One modifier language.** Every bonus anywhere is a `Mod` (`core/mods.ts`): passive
   nodes, item affixes, supports, elite monster modifiers, level mechanics, shrines and the
   difficulty slider. Stats are computed one way:
   `(base + Σflat) × (1 + Σincreased) × Π(1 + more)`, then overrides. A new stat is just a
   new string, and it works everywhere.
3. **Seeds all the way down.** Everything random comes from `Rng` (`core/rng.ts`) forked by
   purpose: `rng.fork('level:7').fork('room:3')`. The same seed gives the same level,
   monsters and loot, which agents, tests and bug reports rely on. Never use `Math.random`.
4. **Generators take a budget.** A generator receives a *power budget* (from depth or tier)
   and spends it on parts: more affixes, bigger bodies, extra mechanics, elite mods. The
   scaling formulas live in one place (`core/scaling.ts`), so the endless game stays
   balanced in one file.
5. **Every system has an inspector.** If an agent can't see it, it can't build it. Each
   system ships a CLI that writes PNG and JSON to `.scratch/<system>/`, plus a browser lab
   page where that's useful. See "Agent tools" below.

## Systems and where they live

| system | folder | what it is |
| --- | --- | --- |
| core | `core/` | rng, registry, mods/stats, scaling, events, save, difficulty |
| combat | `combat/` | damage types, hit pipeline, ailments, hit-stop, knockback, i-frames, projectiles, area effects, damage numbers |
| actors | `actors/` | `Actor` (stats, life, mana, faction, body, brain); hero controller (move, dodge, attack combos, 4 skill slots) |
| skills | `skills/` | skill gems (active skills as data: delivery + effects + tags) and support gems (mods by tags) |
| tree | `tree/` | the passive tree: 1,000+ nodes generated from hand-made clusters, notables and keystones; allocation, respec, UI |
| loot | `loot/` | item bases, rarities, affix tiers by item level, uniques, currency/crafting, drop tables, inventory, stash, vendors |
| monsters | `monsters/` | genome → body (parts on sockets) → rig → procedural animation → archetype brain → elite mods; bosses |
| levels | `levels/` | layout generator (room templates + graph), themes, the 12 mechanics, encounters, the rift generator |
| town | `town/` | the hub: NPCs (smith, merchant, mystic, stash, rift keeper) with idle/talk/react animation |
| ui | `ui/` | pixel HUD, inventory, tree view, tooltips, pause menu with the difficulty sliders, death/clear screens |
| tools | `scripts/riftlight/` | agent CLIs (see below); labs in `src/labs/` |

## Core contracts (src/riftlight/core/types.ts)

- `Mod`: `{ stat, kind: 'flat'|'inc'|'more'|'override'|'flag', value, tags?, when? }`.
  Stats are strings such as `life`, `damage`, `fire.damage`, `attack.speed`,
  `cast.speed`, `move.speed`, `crit.chance`, `res.fire` and `area`. `tags` scope a mod to
  skills or hits with those tags; for example `{stat:'damage', kind:'inc', value:0.2,
  tags:['melee']}`.
- `StatSheet`: collects mods from sources (tree, items, buffs, mechanics, difficulty) and
  answers `get(stat, tags?)`. Sources come and go by key, so buffs expire and gear swaps
  stay cheap.
- `DamageType`: `physical | fire | cold | lightning | chaos`. A `Hit` carries per-type
  amounts, crit, tags, source and knockback. Ailments: bleed and poison (damage over time),
  ignite, chill, freeze and shock.
- `Actor`: owns a `StatSheet`, life, mana, energy shield, a faction, a body (`Object3D`
  plus rig) and a brain (hero input or monster AI), and receives hits.
- `SkillDef`: `{ id, tags, cost, cooldown, castTime, anim, delivery, effects[] }`.
  - **Delivery:** `strike | slam | projectile | nova | beam | dash | summon | aura | trap`.
  - **Effects:** `damage`, `ailment`, `knockback`, `buff`, `spawn`, `light`, `sound`,
    `particles`.
  - **Supports** are `SupportDef { id, requires: tags, mods, deliveryChanges }`, for example
    "+2 projectiles" or "chain".
- `ItemBase`, `Affix` (tier ranges by item level), `Item` (rolled), `UniqueDef`.
- `Genome`: `{ seed, plan, parts[], palette, scale, archetype, elite[] }` → `buildMonster`.
- `MechanicDef`: `{ id, name, introduces, setup(level), update(dt), bypass, exploit }`.
- `LevelSpec`: `{ index, name, mechanics[], theme, layout, encounters, boss, seed }`.
- `ThemeDef`: palette, materials, props, lights, fog and music.

The full TypeScript lives in `core/types.ts`, which is the contract between systems.

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

## Rifts (endless)

`levels/rift.ts` builds level N > 12 from `seed + N`:
- 2–3 mechanics from the registry, with compatibility tags so incompatible pairs never meet;
- a theme with a palette shift;
- 3–5 behaviour archetypes and an elite-mod budget;
- a layout style;
- a boss genome.

`core/scaling.ts` gives monster life, damage, XP, item level and gold for any depth, with no
cap. A rift's name comes from its mechanics, e.g. *Rift 37: Frostglass Gravewell*.

## Monsters ("Spore" generator)

- **Body plans** are hand-made skeleton grammars: biped, quadruped, hexapod, serpent, floater,
  blob and brute. Each defines spine segments, limb sockets and default proportions.
- **Parts** are hand-made, with tags such as `head`, `horn`, `jaw`, `limb`, `claw`, `wing`,
  `tail`, `plate` and `eye`. They attach to sockets, and each knows how to scale, mirror and
  take a palette.
- **Assembly** turns a genome (seed + plan + parts + proportions + palette) into an `Object3D`
  of joints with toon meshes, plus a `RigSpec` (legs geometry for IK, soles, mirror pairs).
- **Animation is procedural and data-driven.** Locomotion uses `gaitClip` generalised to N
  legs. Attacks, hit reactions, death and spawn come from per-archetype templates compiled with
  `compileClip`. Live layers add breathing, look-at, hit flinch and procedural foot placement.
- **Archetypes** are brains: charger, skirmisher, caster, summoner, bomber, tank, swarm,
  sniper and leaper. Each is a small utility-AI over shared actions.
- **Elite mods** come from the same `Mod` language plus behaviours: hasted, vampiric,
  fire-enchanted, teleporter, shielded, splitter, frenzied and more.
- **Bosses** are genomes at a large scale with a phase script picked from boss modules.

## Passive tree

`src/riftlight/tree/` (logic, data, generator), `src/riftlight/ui/tree/` (the view),
`scripts/riftlight/tree.ts` (the inspector). About 1,430 nodes on a wheel of six regions:
**Might** (top), **Edge**, **Grace**, **Guile** (bottom), **Wit** and **Zeal**, each a 60°
sector with its own colour, cluster themes and small-node pool. A ring of six free start
gates sits around the *Heart of the Rift*; 24 keystones sit on the rim, 40+ points out.

### Using it (shell, combat)

```ts
import { TreeState, defaultTree, pointBudget, respecCost, treeMods } from './riftlight/tree';
import { TreeView } from './riftlight/ui/tree/TreeView';

hero.stats.set('tree', treeMods(save.hero.allocated));            // the StatSheet source 'tree'
const state = TreeState.load(defaultTree(), save.hero.allocated, pointBudget(level, deepest).total);
const view = new TreeView({
  container, state, audio: ctx.audio, closeKeys: ['Escape', 'KeyP'],
  refundCost: (n) => respecCost(n, level), spendGold: (g) => wallet.spend(g), gold: () => wallet.gold,
  onChange: (_change, s) => { save.hero.allocated = s.serialize(); hero.stats.set('tree', s.mods()); },
  onClose: () => (engine.paused = false),
});
view.open();                                   // pause the game while open; view.isOpen(), view.close()
state.points = pointBudget(newLevel, deepest).total; view.refresh();   // on level-up
```

- **Points:** `pointBudget(level, deepest)`: one per level after the first, plus one per
  designed level cleared and one per five rift depths. Start gates are free roots: anything
  allocated must stay connected to one of them.
- **Save format:** `save.hero.allocated` holds allocated node ids plus `<masteryId>=<optionId>`
  per mastery choice. `TreeState.load` drops ids that no longer exist, then anything cut off
  from a gate, then the furthest nodes if over budget, so a changed tree never breaks a save.
- **Respec:** `respecCost(points, level)` is the gold for refunding that many points (pure).
- **Rules combat reads:** keystones are ordinary mods plus flags (`cannotCrit`,
  `skills.costLife`, `immune.chaos`, `pointBlank`, ...). Every flag and special stat is listed
  with its meaning in `KEYSTONE_FLAGS` (`tree/data/keystones.ts`), and the conditions tree
  mods use (`inDark`, `inLight`, `lowLife`, `recentlyKilled`, `hitRecently`, `notHitRecently`)
  in `TREE_CONDITIONS`. Hit damage queries should include the tag `hit` (Perfect Agony).
- **Stat conventions** (`tree/data/stats.ts`): chances, resistances, block and leech are flat
  fractions (`flat('res.fire', 0.12)` = +12%); `<type>.damage` is per damage type,
  `elemental.damage` covers fire/cold/lightning, `res.elemental` adds to all three; skill
  scoping uses tags (`inc('damage', 0.2, ['twohand'])`).

### Adding content

Everything is data; the generator queries it by tags, so adding an entry is the whole job.

- **A cluster** (`tree/data/clusters-*.ts`): a `T({ id, name, tags, shapes, pool, notables })`.
  `tags` are themes: a region picks clusters by summing its `themes` weights over them
  (squared), so tag it with themes the regions you want already weigh. `shapes` are ids from
  `data/shapes.ts`; `pool` is the small-node roll table (`R(stat, kind, weight, tags?, when?)`).
- **A notable:** add `N(id, name, mods, flavour)` to a cluster's `notables`. Ids are global and
  become the node id `n:<id>`. Keep it worth 25–45 budget points (`modsBudget`); the validator
  flags anything over 60. Each notable is placed once per tree; more notables in a theme means
  more instances of that cluster.
- **A keystone** (`data/keystones.ts`): mods plus flags, hand-written `lines` for the tooltip,
  and a `region`. Each region gets its keystones spread along its rim. Document any new flag
  in `KEYSTONE_FLAGS`.
- **A mastery** (`data/masteries.ts`): tags and three options. Shapes with a mastery slot
  (`wheel1`, `wheel2`) take the best-matching mastery not yet used in that region.
- **A shape** (`data/shapes.ts`): slots in local units (+y points outwards, entry at -y, about
  ±110 across, ~55 between neighbours) and links. Tag it `n0`–`n3` by notable count.
- **A region** (`data/regions.ts`): an angle, colours, theme weights and a small-node pool. The
  circle is split evenly between regions, so rebalance the angles.
- **A stat:** give it a tooltip name in `STAT_NAMES` and, if small nodes may roll it, a price
  in `MOD_COSTS` (value per budget point).
- **A hand-placed node** (`data/overrides.ts`): `{ id, x, y, name, kind, region, mods, link }`
  adds a node; an override with an existing id patches it (move it, change its mods, `link` /
  `unlink`). Overrides are applied last and always win.

### How the generator works (`tree/generate.ts`)

1. Start ring: a gate per region, two travel nodes between neighbouring gates.
2. Each sector is cut into seven radial bands of cluster *slots* (more slots further out). In a
   seeded shuffled order, each slot picks a template by region theme weight, a shape from the
   template, and notables from the template; band 0 and a few others become stat clusters.
3. Small nodes roll their mods from a **budget** (`smallBudget`, a little more per band) and a
   pool: the template's inside clusters, the region's on travel paths. `MOD_COSTS` turns budget
   points into values, and the validator measures every node with the same table.
4. Every slot links inward to the nearest slot of the band below (or the second nearest if
   that draws cleaner), with optional extra inward and sideways links; highways cross to the
   neighbouring regions at bands 2 and 5; keystones hang off the outer band. Links pick the
   closest ports whose straight line stays clear of other nodes and crosses no other link.
5. Overrides are applied.

**Stable ids.** Saves store ids, so ids come from structure, never from a counter:
`start:<region>`, `n:<notable>`, `k:<keystone>`, `m:<region>:<mastery>`,
`<region><band>.<slot>.<shapeKey>` for cluster smalls, `p:<from>~<to>:<i>` for travel nodes,
`ring:<a>-<b>:<i>`. Every random draw is forked by slot or node id, so changing pools, budgets
or travel spacing keeps every non-travel id, notables and keystones keep their id wherever
they land, and changing one slot's template changes only that cluster's small ids. Changing
band radii can change how many slots a band holds (and so which slots exist).

### Inspecting it

- `npm run tree -- render [--heat] [--crops]` writes `.scratch/tree/tree.png` (regions
  coloured, keystones labelled; `--heat` = points from the nearest gate; `--crops` = a zoomed
  PNG per region with notable names). `--alloc id,id` draws an allocation.
- `npm run tree -- validate` exits 1 on: duplicate ids, broken or one-way links, orphans,
  nodes unreachable from a gate, a keystone closer than 18 points, a node count outside
  1,200–1,600, overlapping nodes, small nodes off their budget, or a region whose total budget
  is more than 30% off the mean. `stats` prints counts per kind and region and the mod
  distribution; `path <from> <to>` and `search <words>` take ids or names. `--json` everywhere.
- `/tree.html` is the tree view on its own page (`?seed=`, `?points=`, `?alloc=`, `?focus=`),
  with `window.__RIFT_TREE__` for scripts; the e2e suite `riftlight-tree` drives it.

## Agent tools (native to the engine)

| command | what it gives an agent |
| --- | --- |
| `npm run monster -- <seed\|plan>` | PNG turntable + rig overlay + animation strips + stats for a generated monster; `/monster-lab.html` has gene sliders |
| `npm run loot -- sim` | drop/affix distributions by item level and rarity, as PNG charts + JSON; tooltip renders |
| `npm run tree -- render\|validate\|stats\|path` | the passive tree as a PNG (regions, keystones, path lengths), connectivity and stat-budget checks, counts, shortest paths; `/tree.html` browses it |
| `npm run level -- <n\|seed>` | top-down map PNG with spawns, mechanic elements and critical path, plus bypass validation (the exit is reachable without using the mechanic) |
| `npm run balance` | headless combat sim, build × depth: time-to-kill and damage taken, plotted to PNG and CSV |
| `npm run playtest -- <level>` | a bot plays the real game frame-exactly and reports clear time, deaths and loot, with a film |
| `npm run inspect -- <glb\|genome\|item>` | any asset as a turntable PNG plus counts: triangles, joints, materials, bounds |

## Loot

Code: `src/riftlight/loot/` (logic and data), `src/riftlight/ui/items/` (windows and
tooltips), `scripts/riftlight/loot.ts` (the inspector). Public API: `src/riftlight/loot/index.ts`.
`/?game=lootlab` is a small arena to try it all (K kill, F pick up, I inventory, T stash,
U vendor, Alt filter).

**Content is data** (`loot/data/`), held in registries (`loot/content.ts`):

| file | what | count |
| --- | --- | --- |
| `bases.ts` | weapons (sword, axe, mace, dagger, bow, staff, wand, sceptre; one- and two-handed), offhands (shield, quiver, focus), armour (helm, body, gloves, boots × armour/evasion/energy shield), jewellery (amulet, ring, belt), in level tiers | 82 |
| `affixes.ts` | prefixes and suffixes, 5–8 tiers each, plus corruption implicits | 101 |
| `uniques.ts` | build-defining uniques with flavour; many bend a level mechanic | 32 |
| `currency.ts` | crafting orbs (below) | 10 |
| `gems.ts` | gem ids that drop or are sold until the skills registry is integrated | 20 |
| `filter.ts` | the default loot filter | 10 rules |
| `names.ts`, `sounds.ts` | rare name words, loot SFX | |

- **Add a base**: one entry in `bases.ts` through a helper (`sword({...})`, `armour('helm', 'ev')({...})`):
  `id`, `name`, `level` (minimum item level), `base` stats (`physical: [min, max]`, `aps`,
  `crit`, `range`; or `armour` / `evasion` / `es`, `block`), optional `implicit` mods. Its tags
  (slot, class, `onehand`/`twohand`, `attack`/`caster`, `ar`/`ev`/`es`, `armour`, `jewellery`)
  decide which affixes roll on it. Size in the inventory comes from the class (`ITEM_SIZES`).
- **Add an affix**: `prefix({...})` or `suffix({...})` in `affixes.ts`: `on` (base tags it rolls
  on), `group` (affixes sharing a group never roll together), `weight` (default 100) and tiers
  in ascending item level (`one('life', 'flat', [[level, min, max], ...])`, `adds(...)` for
  "Adds X to Y", `pct(...)` for whole-percent rows). `local.*` stats improve the item itself
  (weapon damage, armour); anything else goes to the StatSheet as written. A tier may carry a
  `when` condition (`inDark`, `onIce`, ...). Tooltips call the best tier T1.
- **Add a unique**: an entry in `uniques.ts` with `base`, `level`, `mods` (any stat, flags
  for mechanic hooks such as `brazier.selfIgnite`, `well.immune`) and `flavour`.
- **Add a currency**: an entry in `currency.ts` naming a `CraftAction`; a new action is a pure
  function `(rng, item) → CraftResult` in `craft.ts` plus its blocker in `craftBlocker`.
  Kindling Shard (normal → magic), Ember Bead (augment), Shifting Ash (reroll magic), Crown
  Cinder (magic → rare), Rift Ember (reroll rare), Starfall Orb (add an affix), Hollow Orb
  (remove one), Cleansing Salt (back to normal), Sunsoul Orb (reroll values), Abyssal Eye
  (corrupt: nothing / an implicit / an affix up a tier / remade as a rare; no more crafting).
- New stats only need a human name in `loot/stats.ts` (`STAT_NAMES`, `PERCENT_STATS`).

**Rarity math** (`loot/generate.ts`, numbers in one place):

- Boost `B = SCALING.rarityBoost(depth) × (1 + item.rarity)`, times a rank factor for drops
  (magic 1.25, rare 1.7, boss 2.5). Weights: normal 700, magic 250·B, rare 45·B^1.5,
  unique 5·B². At B = 1 that is 70 / 25 / 4.5 / 0.5%.
- Affix count: magic 1–2 (at most 1 prefix + 1 suffix), rare 4–6 (50/35/15%; at most 3 + 3).
- Tiers: a tier is open once `itemLevel ≥ tier.level`; weight = `0.85^index × ramp`, with
  `ramp = clamp((itemLevel − tier.level + 4) / 16, 0.25, 1)`, so fresh tiers are rare and
  weaker tiers stay common. Bases more than 30 levels under the item level drop at 0.35×.
- Drops per kill: `0.22 × RANK.drops × (1 + item.quantity)` items at item level
  `SCALING.monsterLevel(depth)`; 22% currency, 6% gems, the rest equipment; bosses always
  drop a rare or better. Gold: 45% of normal kills (every elite), `SCALING.gold(depth) ×
  RANK.gold × 0.6–1.4 × (1 + gold.find)`.
- Everything is a pure function of an `Rng`: `rollItem(rng, { itemLevel, base?, rarity?,
  rarityBoost })`, `rollDrops(rng, { depth, rank, itemRarity, itemQuantity })`.

**Items → stats.** `itemMods(item)` folds local mods into the item and returns StatSheet mods:
weapons give `weapon.<type>.min/max`, `attack.speed.base`, `crit.chance.base`, `weapon.range`
and a `weapon.<class>` flag; armour gives flat `armour`, `evasion`, `energy.shield`,
`block.chance`. `applyEquipment(sheet, equipment)` keeps one source per slot (`item:weapon`,
`item:ring1`, ...). Resistances, leech, block and crit multiplier are fractions.

**Inventory, stash, vendors** (`inventory.ts`, `vendor.ts`) are immutable and pure:
`pickUp`, `equip` (level check; a two-hander and an offhand push each other out, except bow
+ quiver), `unequip`, `transfer` (stash tabs), `sell`/`buy` (sell price by rarity and level,
×4 to buy), `vendorStock(seed, depth, visit, 'smith' | 'gems')`, and
`lootToSave`/`lootFromSave`/`writeSave` (grid positions in `SaveData.positions`).

**In the world** (`world.ts`): `new WorldLoot(ctx, { events, rng, depth, hero, onPickup,
onGold, ... })` turns `kill` events into `loot` and `gold` events and spawns whatever is
emitted on the bus. Call `update(dt)` after `ctx.hud.clear()` each frame. Rares and uniques
get a light beam and a light from a `LightPool` (the levels system may pass its own; the
fallback is a fixed pool of three PointLights, so materials never recompile mid-run).

**The loot filter** is data (`data/filter.ts`): rules checked top to bottom, first match wins,
`when` matches rarity, slot, base tags, depth range and item level, and the tier is `loud`
(border, beam, louder sound), `show`, `dim` or `hide`. The default hides normal items from
depth 6 and dims magic ones from depth 16; uniques and valuable orbs are loud. Alt toggles the
filter off and on.

**UI** (`ui/items/`): `new ItemsUi(ctx, new ItemsStore({ sheet, heroLevel, rng }))`, then
`InventoryView`, `StashView` and `VendorView` (`open`/`close`/`isOpen`); call `ui.update(dt)`
every frame and don't feed hero movement while `ui.isOpen`. Click or drag to move items,
right-click to equip or start applying an orb, Ctrl-click to stash, sell or buy, Alt shows
affix tiers; touch long-press is right-click; the gamepad stick moves a cursor (A click,
X right-click, Y Ctrl-click, B close). Tooltips compare against the equipped item on a
clone of the hero's StatSheet.

**Inspector**: `npm run loot -- sim --depth 20 --kills 5000` (rarity, slot and tier charts,
rarity by depth, gold/hour → `.scratch/loot/`), `roll --seed 3 --ilvl 60 --rarity rare`,
`tooltip <seed> [--alt]` (PNG), `uniques` (list + one PNG of every unique).

## Difficulty

The pause menu (Esc) has a **Tuning** panel with sliders for player damage, life and speed and
enemy damage, life and speed. Each slider is a `Mod` source on the matching side, so it uses
the same path as every other bonus. The values are saved and shown in the HUD corner whenever
they aren't 1.0.
