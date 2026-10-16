# Core contracts (`src/riftlight/core/types.ts`)

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
  - **Delivery:** `strike | slam | projectile | nova | beam | dash | summon | aura | trap | curse`.
  - **Effects:** `damage`, `ailment`, `knockback`, `buff`, `spawn`, `light`, `sound`,
    `particles`, `curse` (mods on the enemies a curse reaches), `charges` (gain or spend
    charges on use or on hit).
  - **Supports** are `SupportDef { id, requires: tags, mods, deliveryChanges }`, for example
    "+2 projectiles" or "chain".
- `ItemBase`, `Affix` (tier ranges by item level), `Item` (rolled), `UniqueDef`.
- `Genome`: `{ seed, plan, parts[], palette, scale, archetype, elite[] }` → `buildMonster`.
- `MechanicDef`: `{ id, name, introduces, setup(level), update(dt), bypass, exploit }`.
- `LevelSpec`: `{ index, name, mechanics[], theme, layout, encounters, boss, seed }`.
- `ThemeDef`: palette, materials, props, lights, fog and music.

The full TypeScript lives in `core/types.ts`, which is the contract between systems.

## Difficulty

The difficulty sliders (`game/difficulty.ts`): each is a `Mod` source on its side, so it takes the
same StatSheet path as every other bonus. Pause → **Tuning**: hero damage / life / speed and enemy
damage / life / speed, each 0.25×–4× on a log scale (1.0 in the middle; ←/→ nudge 0.05 below 1×, 0.1 to 2×, 0.25 above), presets Story,
Normal, Hard, Nightmare, and Reset. `difficultyMods(t, side)` turns them into `more` mods
(`damage`; `life` + `es`; `move.speed` + `attack.speed` + `cast.speed`) applied as the
`difficulty` source of the hero and of every monster at spawn; moving a slider re-applies it to
live monsters and keeps their life fraction. Saved per slot and shown in the HUD corner
("E.LIFE 1.50X") whenever a slider isn't 1.0.
