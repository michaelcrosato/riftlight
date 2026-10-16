# Riftlight: index

Riftlight is the showcase hack-and-slash ARPG at `/` (`src/riftlight/`), built to show agents how to
make a complete game on this engine: town → level → town, twelve designed levels (each introduces
one mechanic and is named after it), then endless generated **Rifts**. Progression after Path of
Exile 2 and Diablo IV: XP, gold, loot, a deep passive tree, skill gems with supports.

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
   page where that's useful (docs/game/balance.md *Agent tools*).

## Systems: where they live, where they are documented

Folders are under `src/riftlight/`. Read only the topic file you need.

| folder | what it is | doc |
| --- | --- | --- |
| `core/` | rng, registry, mods, stat names, scaling, events, saved-state helpers; the contracts in `types.ts` | docs/game/core.md |
| `combat/`, `skills/` | damage types, hit pipeline, ailments, deliveries, build systems; skill and support gems as data | docs/game/combat.md |
| `actors/` | `Actor`; the hero controller (controls, combos, dodge, skill slots) and how the hero is drawn | docs/game/actors.md |
| `monsters/` | genome → body → rig → procedural clips → archetype brain → elite mods; bosses | docs/game/monsters.md, docs/game/monster-parts.md |
| `levels/` | layout generator, the 12 designed levels, rifts, encounters, the bypass guarantee | docs/game/levels.md |
| `levels/themes/`, `levels/mechanics/` | themes, props and surfaces; the 12 mechanics | docs/game/mechanics.md |
| `tree/`, `ui/tree/` | the passive tree: generator, allocation, respec, view | docs/game/tree.md |
| `loot/`, `ui/items/` | item bases, affixes, uniques, currency, drops, inventory, stash, vendors, filter | docs/game/loot.md |
| `balance/` | the headless combat sim; the agent CLIs (`scripts/riftlight/`) | docs/game/balance.md |
| `game/` | the `Riftlight` shell: flow, ports and stubs, saves, difficulty, camera, music, `window.__RIFTLIGHT__`, the playtest bot | docs/game/shell.md |
| `game/` (snapshot) | save-states: `Riftlight.snapshot` / `restore` and every part's saved state | docs/game/save-states.md |
| `ui/` | pixel HUD layout, touch controls, gem icons, menus and panels, the look studio | docs/game/ui.md |
| `wire/` | the real ports: combat worlds, hero, levels, monsters, loot, sockets, tree | docs/game/wire.md |
| `town/` | Emberfall: layout, kit, outskirts, walking, townsfolk and their clips | docs/game/town.md |
| `showcase/` | a side-scroller, a first-person gallery and photo mode inside Riftlight, as templates | docs/game/showcase.md |
| labs | `/monster-lab.html` (`src/labs/monster-lab/`), `/tree.html`, `?game=arena`, `?game=lootlab`, `?game=levellab` | the system's doc |
| `packs.ts` | the imported Kenney packs Riftlight loads before building the town and levels | docs/assets/importing.md |
