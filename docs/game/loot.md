# Loot

Code: `src/riftlight/loot/` (logic and data), `src/riftlight/ui/items/` (windows and
tooltips), `scripts/riftlight/loot.ts` (the inspector). Public API: `src/riftlight/loot/index.ts`.
`/?game=lootlab` is a small arena to try it all (K kill, F pick up, I inventory, T stash,
U vendor, Alt filter).

**Content is data** (`loot/data/`), held in registries (`loot/content.ts`):

| file | what |
| --- | --- |
| `bases.ts` | weapons (sword, axe, mace, dagger, bow, staff, wand, sceptre; one- and two-handed), offhands (shield, quiver, focus), armour (helm, body, gloves, boots × armour/evasion/energy shield), jewellery (amulet, ring, belt), in level tiers |
| `affixes.ts` | prefixes and suffixes, 5–8 tiers each, plus corruption implicits |
| `uniques.ts` | build-defining uniques with flavour; many bend a level mechanic |
| `currency.ts` | crafting orbs (below) |
| `gems.ts` | every gem that drops or is sold: the active skills (but the basic attack and the dodge) and supports |
| `filter.ts` | the default loot filter |
| `names.ts`, `sounds.ts` | rare name words, loot SFX |

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
  (magic 1.25, rare 1.7, boss 2.5). Weights: normal 700, magic 250·B, rare 50·B^1.5,
  unique 3·B². At B = 1 that is 70 / 25 / 5 / 0.3%; `rarityBoost` is 1 + 0.07·depth, so by
  depth 10 about 1 equipment drop in 9 is rare and the campaign bot finds 2–5 rares a level and
  a unique every few levels.
- Affix count: magic 1–2 (at most 1 prefix + 1 suffix), rare 4–6 (50/35/15%; at most 3 + 3).
- Tiers: a tier is open once `itemLevel ≥ tier.level`; weight = `0.85^index × ramp`, with
  `ramp = clamp((itemLevel − tier.level + 4) / 16, 0.25, 1)`, so fresh tiers are rare and
  weaker tiers stay common. Bases more than 30 levels under the item level drop at 0.35×.
- Drops per kill: `0.22 × RANK.drops × (1 + item.quantity)` items at item level
  `SCALING.monsterLevel(depth)`; 22% currency, 6% gems, the rest equipment; bosses always
  drop a rare or better. Gold: 25% of normal kills (every elite), `SCALING.gold(depth) ×
  RANK.gold × 0.6–1.4 × (1 + gold.find)`: a town visit's gold pays for a respec of ~5–10
  points (`respecCost`: eight kills' gold a point) or a handful of gems (priced by the depth
  they are sold at). Find stats are hero multipliers (base 1): drops use the part above 1.
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
×4 to buy), `vendorStock(seed, depth, visit, 'smith' | 'gems' | 'gamble')`, and
`lootToSave`/`lootFromSave`/`writeSave` (grid positions in `SaveData.positions`).

**Gold sinks** (`vendor.ts`), so gold is worth having at any depth. Ilsa's **gems** tab adds
`HONED_GEMS.count` honed gems to its ten level 1 ones: levelled to within 3 of what a hero of the
area can socket (`gemLevelCap(itemLevel)`), priced × their level. Her **gamble** tab sells an
unrevealed base per slot (two weapons) at the area's item level for `GAMBLE.price` normal kills'
gold (`SCALING.gold(depth)`, ×1.5 for weapons and offhands), so the price follows income however
deep the run goes; `buy` reveals it (`revealGamble`: seeded by its uid, rarity boost
`GAMBLE.boost` = 6, about one in four rare or better). An unrevealed item is an `Item` with
`gamble: { price }`; it never reaches a bag unrevealed.

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
clone of the hero's StatSheet (`StatSheet.clone()`). In the game shell the windows are hosted
(`new ItemsUi(ctx, store, { hosted: true })`): the shell routes keys and the pad through
`handle(UiEvent)` and closes them (docs/game/wire.md), and they add the crafting
bench and the skill panel as left windows.

**Inspector**: `npm run loot -- sim --depth 20 --kills 5000` (rarity, slot and tier charts,
rarity by depth, gold/hour → `.scratch/loot/`), `roll --seed 3 --ilvl 60 --rarity rare`,
`tooltip <seed> [--alt]` (PNG), `uniques` (list + one PNG of every unique).
