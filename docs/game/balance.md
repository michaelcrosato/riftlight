# Agent tools and balance

## Agent tools

Each CLI's manual is its header (`scripts/riftlight/<tool>.ts`); output goes to `.scratch/<tool>/`.

| command | docs |
| --- | --- |
| `npm run monster` | docs/game/monsters.md *Inspectors* (`/monster-lab.html`) |
| `npm run loot` | docs/game/loot.md *Inspector* |
| `npm run tree` | docs/game/tree.md *Inspecting it* (`/tree.html`) |
| `npm run level` | docs/game/levels.md *Tools* |
| `npm run combat` | docs/game/combat.md *Inspect it* |
| `npm run balance` | below |
| `npm run playtest` | docs/game/shell.md *The playtest bot* |
| `npm run inspect` | docs/engine/tooling.md |

## Balance (`npm run balance`)

`src/riftlight/balance/` is a pure, seeded sim; `scripts/riftlight/balance.ts` feeds it level
plans (`planLevel(levelSpec(d))`) and monster genomes (`generateGenome` + `buildMonster`,
headless) and writes `.scratch/balance/`: `balance.png` (the dashboard: worst outliers,
then `ttk.png`, `survival.png`, `clear.png`), `balance.csv` (one row per build × variant ×
depth), `xp.csv` and `balance.json` (everything, plus the assumptions). Default: depths 1–12
and every 4th to 60, ~25 s.

- **Builds** (`balance/builds.ts`): melee (cleave + melee physical, multistrike, increased
  area, two-handers), caster (fireball + fire penetration, faster casting, burning damage, wand
  + focus), bow (split arrow + faster attacks, pierce, added cold, bow + quiver), minion
  (summon skeletons + minion damage, speed, life, sceptre + shield). Each runs **naked** (no
  gear, no tree) and **geared**: the best of 12 rares per slot rolled at the depth's item level
  (`rollItem`, equip level respected) and a tree grown greedily (`TreePlanner`: the path to a
  notable or frontier node with the best score gain per point; no respec). Gem level is the
  highest the hero can equip (`SCALING.gemLevelReq`; socketed gems earn the hero's XP, so a gem
  socketed from the start is there). Naked heroes carry the starter sword, as the real hero
  does. Spells grow by gem level (`skills/build.ts` `SPELL_BASE_GROWTH`: their base damage
  compounds 15% a level, ×14 by gem 20, the way a weapon grows by item level); summon gems
  are spells, so minions grow with the gem, plus the hero's own 5% a level and the minion gear
  (`minion-added-physical`, `minion-speed`, `minion-damage`; `combat/minions.ts`).
- **Build systems** as expected values: each archetype keeps a curse on what it fights
  (melee, bow and minion Vulnerability, caster Elemental Weakness; its mods × `curse.effect` ×
  `curseUptime`, none on curse-immune targets), auras (melee Determination, bow and minion Haste:
  the buff on the hero and its minions, the reservation off the mana pool), and a totem
  (caster a Spell Totem fireball, bow a Ballista split arrow: an extra caster, `skillDps`
  reports count × the inner skill every `castRate` × its cast time, up `placedUptime` of the
  fight). Charges come from their gain rate (kills in packs, none at the boss; hits, crits,
  stuns; the skill's own `charges` effects) against their duration: max × min(1, rate ×
  duration / max). The CSV has `charges` and `reserved` columns.
- **Real code**: `buildSkill`, `expectedHit` (through `balance/dps.ts`, which `npm run combat`
  uses too), `StatSheet` with `treeMods`-style node mods and `itemMods`, the monsters' genome
  stats and skills (`MONSTER_SKILLS`), boss phases and enrage, `SCALING`/`RANK`, `addXp` /
  `killXp`, `pointBudget`.
- **Assumed** (`balance/assumptions.ts`, printed every run): hero growth per level, monster
  base record (the `Actor` default), monster attack uptime 50% and half a pack engaged, pack
  reach per delivery, walk detour, minions never die, mana as a level-wide budget (the free
  `slash` when it runs out), curse and totem uptimes, kills per second for on-kill charges.
  Elite behaviours, conditional mods and boss hazards are not modelled.
- **Contract gaps**: stats some systems write under another name than combat reads
  (`crit.multi`, `block`, `energy.shield`, `crit.chance.base`, `life.leech`, `res.elemental`,
  owner `minion.*` …) are aliased by default and listed; `--raw` turns the aliases off. Stats
  on the sheets the sim never read are listed as *read nowhere by that name* (they do nothing)
  or *read only outside the sim*.

The summary prints the geared spread through depth 40 (slowest over fastest build, boss TTK and
clear time) and the worst outliers. Tune `core/scaling.ts`, rerun, compare the CSVs.

**Endless** (`npm run balance -- endless [--max 1000] [--every 50] [--no-levels]`,
`balance/endless.ts`, `endless.test.ts`): proves "scales infinitely" headlessly in ~3 s. Every
depth curve (`SCALING`: life, damage, level, XP, gold, budgets, density, rarity) over every
depth to `--max`: finite, never falling, at most 1.5× a depth in the rifts, and still finite at
depth 1e4, 1e6 and 1e9 (the monster curves go logarithmic past depth 200, `soften`; rarity past
60). At sampled depths: the level plans and passes the reachability / bypass validator in time,
genomes of every rank and the rift boss validate and build in time with finite stats, a level 100
hero's duel stays finite, and items at the area's item level (1000+ deep) roll valid affixes,
tiers and values. Writes `.scratch/balance/endless.json`; exit 1 on any problem.

**The tuned curve** (`npm run playtest -- campaign`, normal): the target is a challenge. Depths 1–4
are onboarding (0–1 deaths), 5–12 cost a few deaths with farming in between, the boss is the
hardest fight of each level, and the bot stops in the rifts around depth 18–25, where better gear
or a better build would go on. Monster life
and damage (`SCALING.monsterLife` / `monsterDamage`) ramp in over depths 1–5, grow 27% / 23% a
depth through the designed levels and 18% (+3%) / 11.5% in the rifts; bosses are 0.37 × / 0.95 ×
`RANK.boss` life / damage (`WIRE_TUNING.monster.bossLife` / `bossDamage`; boss life ramps in from
70% at depth 1 to all of it by depth 5, `bossLifeEarly`); level mechanics hurt on
the gentler `SCALING.hazardDamage` (20% / 11%). Seeds vary a lot (a rift's mechanic mix, the
gems the bot finds): check at least two.
