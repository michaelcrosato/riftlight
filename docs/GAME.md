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

## Agent tools (native to the engine)

| command | what it gives an agent |
| --- | --- |
| `npm run monster -- <seed\|plan>` | PNG turntable + rig overlay + animation strips + stats for a generated monster; `/monster-lab.html` has gene sliders |
| `npm run loot -- sim` | drop/affix distributions by item level and rarity, as PNG charts + JSON; tooltip renders |
| `npm run tree -- render\|validate` | the passive tree as a PNG (regions, keystones, path lengths), connectivity and stat-budget checks |
| `npm run level -- <n\|seed>` | top-down map PNG with spawns, mechanic elements and critical path, plus bypass validation (the exit is reachable without using the mechanic) |
| `npm run balance` | headless combat sim, build × depth: time-to-kill and damage taken, plotted to PNG and CSV |
| `npm run playtest -- <level>` | a bot plays the real game frame-exactly and reports clear time, deaths and loot, with a film |
| `npm run inspect -- <glb\|genome\|item>` | any asset as a turntable PNG plus counts: triangles, joints, materials, bounds |

## Difficulty

The pause menu (Esc) has a **Tuning** panel with sliders for player damage, life and speed and
enemy damage, life and speed. Each slider is a `Mod` source on the matching side, so it uses
the same path as every other bonus. The values are saved and shown in the HUD corner whenever
they aren't 1.0.
