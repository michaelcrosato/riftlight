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

## Combat & skills

Combat is three layers, each usable on its own:

| layer | where | what |
| --- | --- | --- |
| the hit pipeline | `combat/damage.ts`, `combat/ailments.ts`, `combat/stats.ts` | pure functions: `rollHit` (attacker) → `mitigate` (defender) → ailments; `expectedHit` for tools |
| actors | `actors/Actor.ts`, `actors/ActorManager.ts`, `actors/movers.ts` | stats, life/mana/ES with regen, ailments, buffs, conditions, knockback, hit-stop, death; a spatial hash and update order |
| the runtime | `combat/Combat.ts`, `combat/deliveries/` | casts skills through their delivery, resolves hits, plays the juice (numbers, shake, flashes, SFX, particles, lights) |

`skills/` holds the gems as data and `buildSkill`; `actors/HeroController.ts` is the player.
`/?game=arena` (`combat/arena.ts`) puts them together and is the reference for wiring:

```ts
const actors = new ActorManager(events, ctx.scene);              // events: the level's GameEventBus
const combat = new Combat({ actors, scene: ctx.scene, audio: ctx.audio, particles: ctx.particles, wall, hero: () => hero.actor });
const hero = new HeroController({ physics: ctx.physics, combat, model, clips: HERO_CLIPS, at: [0, 0, 0], slots: [{ skill: 'fireball', supports: ['gmp'] }] });
actors.add(hero.actor);
// fixedUpdate: hero.fixedUpdate(ctx, dt); actors.fixedUpdate(dt); combat.fixedUpdate(dt);
// update:      actors.update(dt, ctx.physics.alpha); hero.update(dt); combat.update(dt);
//              combat.shake.apply(ctx.camera, dt); hud.clear(); …; combat.drawNumbers(ctx.hud, ctx.camera.camera);
```

- **A monster** is an `Actor` with `faction: 'monster'`, a `body`, a `GridMover` over the level's
  `WalkableQuery` (`layoutWalkable(layout)`), and a `Brain` whose `think()` sets `velocity` /
  `facing` and calls `combat.cast(actor, skill, target)` at its attack's hit frame. Resolve its
  skills with `buildSkill(id, [], actor.stats)`. `actor.animate` is a per-frame visual hook.
- **Events.** `Actor.takeHit` emits `hit`, then `death` and `kill` (with the killer, `rank`
  and `depth`). Minions die too: check `target.faction === 'monster'` before dropping loot.
- **Lights.** Effects ask for dynamic lights with a `LightRequest` on the bus (`light` event).
  A light pool sets `req.claimed = true` and drives its own light from `position()` until
  `duration` ends or `alive()` is false; unclaimed requests use a small fallback pool.
- **Juice.** Hit-stop is `actor.hitStop` frames (movement and animation freeze); knockback is
  `actor.push(impulse)`; `actor.fx.flash()` is the hit flash; `combat.shake.add(trauma)` and
  `combat.numbers.spawn(...)` are the screen shake and damage numbers.

### The hero's controls

WASD / left stick moves (camera-relative); the mouse aims at the ground under the cursor (else
the right stick, else the nearest enemy ahead). LMB / J is the 3-hit combo (hold to keep
swinging), RMB / K, Q, E, R, F (or 1–4) are the skill bar, Space is the dodge roll. Presses
buffer for 0.2 s, any action cancels into a dodge or the next action after its hit frame,
casting slows movement instead of locking it (the legs keep running under the arms), and
attack clips play at the rate attack / cast speed asks for. W is movement, so the bar is
Q/E/R/F rather than Q/W/E/R. The shell passes `HERO_TOUCH_BUTTONS`, `HERO_GAMEPAD_BUTTONS`
and `HERO_DEBUG_KEYS` (R is a skill, so the resolution hotkey moves to F2) to the engine.
Every timing is in `HERO_TUNING`.

### Stats the pipeline reads

Base values come from the skill, the weapon and the actor's `base` source; everything else is
`Mod`s, scoped by tags. A hit's tags are the skill's effective tags plus every damage type
the damage has been (converted physical → fire scales with both) and `elemental`.

| side | stats |
| --- | --- |
| attacker | `damage`, `<type>.damage`, `elemental.damage` (inc/more) · `added.<type>.min/max` (× effectiveness) · `weapon.<type>.min/max`, `weapon.crit` · `convert.<from>.<to>` · `crit.chance`, `crit.multiplier` (base 1.5) · `accuracy` · `pen.<type>` · `<ailment>.chance`, `ailment.effect`, `ailment.duration` · `knockback` · `leech.life`, `leech.mana` · `cull` |
| skill shape | `attack.speed`, `cast.speed`, `area` (radius × √area), `duration`, `cost`, `cooldown.recovery`, `projectiles`, `chain`, `pierce`, `fork`, `projectile.speed`, `projectile.homing`, `repeats` |
| defender | `life`, `mana`, `es`, `life.regen`, `mana.regen` · `armour` (vs physical: armour / (armour + 5 × hit), ≤ 90%) · `evasion` (vs attack accuracy) · `block.chance`, `spell.block` (≤ 75%) · `res.<type>` capped by `res.max.<type>` (75%) · `damage.taken` · `avoid.<ailment>` · `stun.threshold` · `mass` · `move.speed` |
| conditions | `lowLife`, `fullLife`, `moving`, `recentlyHit`, `recentlyKilled`, `hitRecently`, `notHitRecently`, `inLight`, and one per active ailment (`chill`, `shock`…), usable as `when` on any mod |
| recovery | `life.recovery` (regen, leech, on kill) · `life.regen.pct` · `life.onKill`, `mana.onKill`, `es.onKill` · `es.recharge` · `leech.rate` · `block.recovery` |
| hero | `dodge.recovery`, `dodge.distance` (the roll) · `skill.level` (socketed gem levels) · `xp.gain`, `light.radius`, `item.rarity`, `item.quantity`, `gold.find` (multipliers, base 1) · the keystone flags (`cannotCrit`, `immune.chaos`, `damage.toMana`, `rampage`, `leech.instant`, `skills.costLife`, `es.protectsMana`, `evasion.toArmour`, `convert.toFire`, `nonFireDamage.none`, `auras.selfOnly`, `pointBlank`, `elementalOverload`, `cannotDealDamage.self`, `damage.morePerMechanic`, …) |

**One name per stat.** `src/riftlight/core/stats.ts` is the canonical table: `CANONICAL_STATS`
says what each non-obvious stat does, `STAT_ALIASES` maps the names other systems wrote first
(`crit.multi` → `crit.multiplier`, `energy.shield` → `es`, `life.leech` → `leech.life`,
`mana.cost` → `cost`, `block` → `block.chance`, `evasion.chance` → `dodge.chance`,
`life.regenPct` → `life.regen.pct`, `chance.<x>` → `<x>.chance`…) and `STAT_EXPANSIONS` splits
`res.elemental` into the three elements. Every `StatSheet` renames on the way in and on the way
out, so loot, the tree and the balance sim can keep their data. `npx tsx
scripts/riftlight/stat-names.ts` lists every name loot and the tree emit.

**Every stat loot and the tree emit is read** (`npm run balance` lists none that nothing reads).
The build systems below read the last of them; `dodge.cooldown` (the roll has no cooldown) became
`dodge.recovery` in the tree data instead.

### Build systems: charges, curses, totems, traps, auras

What the deep end of the tree and the build-defining loot plug into. Each is a small module in
`combat/`, and each is visible: pips, runes, totems, traps and the mana globe say what is going on.

| system | where | stats | what it does |
| --- | --- | --- | --- |
| charges | `combat/charges.ts` (`Actor.charges`) | `endurance.max`, `frenzy.max`, `power.max` (+ base 3), `charge.duration` (base 10 s), `charge.onKill` / `onHit` / `onCrit` / `onStun` (chances, scoped by the charge's tag: `flat('charge.onKill', 0.1, ['frenzy'])`) | per charge: endurance 4% physical reduction and +4% elemental resistances; frenzy 4% more damage, 4% attack and cast speed; power 40% increased crit chance, +5% crit multiplier. One timer per kind, refreshed on gain; the `charges` stat source. Pips orbit the hero (orange, lime, cyan; one height per kind) and the HUD buff row shows each kind with its count |
| curses | `combat/curses.ts` (`Actor.curses`), `combat/deliveries/curse.ts` | `curse.count` (+ base 1 per target), `curse.effect`, `curse.duration`, `curse.immune` | a curse gem hexes an area at the aim point; each enemy inside gets the curse as a `curse:<id>` source. The oldest of a caster's curses makes way past its limit. Cursed actors stand on a turning rune circle in the curse's colour, with a shard over the head and a tint. `curse.immune` (Hexproof and Juggernaut elites, a corruption) shrugs them off; a Hexer elite curses the hero (Enfeeble) |
| totems | `combat/totems.ts` | `totem.count` (+ base 1), `totem.life` (60% of yours), `totem.speed` (planting) | a totem support makes the skill plant a carved pole that casts it at the nearest enemy in reach, for 12 s × duration, with a snapshot of your stats; monsters can break it. Its hits carry `totem` (Ancestral Bond's `cannotDealDamage.self` spares them); its kills count for you |
| traps | `combat/deliveries/trap.ts` | `trap.count` (+ base 3 armed), `trap.speed` (throwing), `trap.arm` | trap and mine skills, and any skill with the Trap support: thrown at the aim, armed, sprung by the first enemy that comes near. A supported skill is released from the trap at that enemy (a stand-in caster with your live sheet, `proxyOf`) |
| auras | `combat/deliveries/aura.ts`, `Actor.reserve` | `mana.reservation`, `aura.effect`, `aura.radius`, `auras.selfOnly` | an aura gem's `reserve` (Haste 25%, Wrath 35%, Determination 40%) × the supports' cost multipliers (Enlighten) × `mana.reservation` is held while it is on, instead of a cost per toggle; it won't turn on without room. Blood Magic reserves life. The mana globe seals the reserved share off |

Gems that use them: **Vulnerability**, **Elemental Weakness**, **Enfeeble**, **Temporal Chains**
(curses), **Discharge** (spends every charge: 60% more damage per charge), **Enduring Cry**
(+2 endurance), **Frenzy Strikes** (a frenzy charge on 25% of hits), **Wrath** and
**Determination** (auras); supports **Spell Totem**, **Ballista Totem**, **Trap**, **Power Charge
on Critical**, **Endurance Charge on Melee Stun**, **Frenzy Charge on Hit**. A support's
`placement: 'totem' | 'trap'` turns its skill into one (`ResolvedSkill.placement` and `.inner`).

Smaller stats: `<ailment>.duration` (`stun.duration`: the support above, Might passives) scales
that ailment's duration; attacks carry the equipped weapon's class as a tag (`weapon.axe` →
`axe`, `weapon.twohand` → `twohand`: `WEAPON_CLASS_TAGS`), so class-scoped passives reach them;
`thorns.reflect` deals that share of melee damage taken back to the attacker; `action.speed`
(base 1) slows everything an actor does (Temporal Chains).

`npm run test:e2e -- riftlight-builds` shows each of them in the arena and a mechanic affix in
level 1, with frames in `.scratch/e2e/riftlight-builds-*.png`; `combat/builds.test.ts` and
`levels/affixes.test.ts` pin the numbers.

### Add a skill

Add an entry to `ACTIVE_SKILLS` (`skills/actives.ts`). Tags decide which supports fit and which
mods scale it; the delivery picks the runtime; `anim` / `combo` name hero clips; `look` is its
colour, mesh, sounds, light and shake.

```ts
g({
  id: 'glacial-hammer', name: 'Glacial Hammer', description: 'A cold strike that freezes.',
  tags: ['attack', 'melee', 'strike', 'cold', 'damage'],
  cost: 6, cooldown: 0, castTime: 0.6, anim: 'Slash3',
  delivery: { kind: 'strike', range: 2.4, arc: 80 },
  effects: [
    { kind: 'damage', base: { cold: [4, 8] }, effectiveness: 1.3 },
    { kind: 'ailment', ailment: 'freeze', chance: 0.25 },
  ],
  perLevel: [more('damage', 0.07)],
  look: { color: 'cyan', glow: ['white', 'cyan'], burst: 'frost', sound: { cast: 'swing', hit: 'ice' }, shake: 0.15 },
}),
```

Then `npm run combat -- dps glacial-hammer melee-physical` to see what it does. A new kind of
movement or area goes in the Delivery union (`core/types.ts`) with a runtime in
`combat/deliveries/` registered in `DELIVERIES`; a new clip goes in
`src/game/hero/clips/combat.ts` with its hit frame in `COMBAT_TIMING`.

### Add a support

Add an entry to `SUPPORT_GEMS` (`skills/supports.ts`). `requires` are tags the skill must all
have, `excludes` tags it must not; `mods` apply to the linked skill only; `changes` reshape
the delivery.

```ts
s({
  id: 'volley', name: 'Volley', description: 'Two more projectiles and a little faster.',
  requires: ['projectile'], excludes: ['channel'],
  mods: [more('damage', -0.1), inc('projectile.speed', 0.2)],
  changes: { projectiles: 2 }, costMultiplier: 1.3,
}),
```

### Add a damage type

1. Add it to `DamageType` and `DAMAGE_TYPES` in `core/types.ts` (e.g. `'holy'`).
2. Place it in `CONVERSION_ORDER` (`combat/damage.ts`), add a colour to `DAMAGE_COLORS`
   (`combat/numbers.ts`), and add it to `ELEMENTAL` if it should count as elemental.
3. That's all the pipeline needs: `holy.damage`, `added.holy.min/max`, `res.holy`,
   `res.max.holy`, `pen.holy` and `convert.physical.holy` work at once, because stats are strings.

```ts
export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'chaos' | 'holy';
export const CONVERSION_ORDER: readonly DamageType[] = ['physical', 'lightning', 'cold', 'fire', 'holy', 'chaos'];
export const DAMAGE_COLORS = { ...colours, holy: 'sand' };
```

### Add an ailment

Add it to `AilmentType` (`core/types.ts`) and an entry to `AILMENTS` (`combat/ailments.ts`). Its
`kind` says what it does (`dot` deals damage per second, `slow` slows actions and movement,
`stop` stops them, `amp` raises damage taken); `from` says which landed damage causes it and
sets its strength. The actor status, the conditions (`when: 'sap'`), the DPS tool and the
`<id>.chance` / `avoid.<id>` stats all follow from the entry.

```ts
{
  id: 'sap', name: 'Sap', kind: 'amp', from: ['lightning'], duration: 3,
  magnitude: (damage, maxLife) => Math.min(0.2, 0.4 * (damage / maxLife)), color: 'sand', tags: ['elemental'],
},
```

### Inspect it

- `npm run combat -- dps <skill> [support[@level] …] [--level n] [--stats build.json] [--vs armour=500,res=0.4] [--targets 3] [--json]`:
  resolved skill, hit breakdown per type, crits, ailments and their DoT, hits/s, DPS on one and
  on N targets, mana/s; written to `.scratch/combat/<skill>.json`.
- `npm run combat -- list` / `supports <skill>`: every gem with its tags, and what fits.
- `npm run film -- arena-combo arena-cancel arena-dodge arena-skills arena-run-cast arena-whirlwind`:
  the hero in the real game; `/?game=arena&skills=meteor,arc+chain,blink` for a custom bar.

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

Code: `src/riftlight/monsters/` (public API in `index.ts`). A monster is a **genome** (plain
data), turned into a body by a **plan's skeleton grammar** with **parts** on its sockets,
animated by **procedural clips**, driven by an **archetype brain**, spiced with **elite
mods**. Bosses add a phase script on top.

```
generateGenome(rng, {depth, tags, archetype, rank, budget})        mutate / crossover
        │  plan + genes (0..1) + parts per slot + palette + scale + archetype + elite + rank
        ▼
buildMonster(genome) ── plan.build(genes) ─► Skeleton: joints, body shapes, sockets, legs, roles, gaits
        │                parts on sockets ─► toon meshes (shared unit geometry, cached materials)
        │                rig ─► RigSpec (soles, mirror pairs; 2-leg bodies also get `legs` for placeFeet)
        ▼
{ object, rig, clip(name), clipInfo(name), defs, clips, stats: Mod[], skills, radius, height }
        │  clips are generated on first use (bake → compileClip) and cached per body shape
        ▼
MonsterRuntime (mixer + look-at, flinch, foot placement, wind-up glow, hit events)
MonsterBrain / BossBrain over a MonsterBody (the integration wires it to combat's Actor)
```

```ts
const rng = run.fork(`level:${depth}`).fork(`pack:${i}`);
const genome = generateGenome(rng, { depth, tags: ['fire'], archetype: 'charger', rank: 'magic' });
const m = buildMonster(genome);                 // ~1.5 ms; deterministic
scene.add(m.object);
const rt = new MonsterRuntime(m);              // rt.locomote(speed); rt.play('Bite'); rt.update(dt, { lookAt })
for (const e of rt.update(dt)) if (e.type === 'hit') applyDamage();   // synced to the clip's hit frame
const brain = new MonsterBrain({ body, archetype: genome.archetype, skills: m.skills, elite: genome.elite, home });
const pack = generatePack(rng, { depth, tags: ['insect'] }); // one shared body shape: members share clips
```

### Genomes, budgets and evolution

- **Genome** (`core/types.ts`): `{ seed, plan, parts: {socket: slot, part}[], genes, palette,
  scale, archetype, elite[], rank }`. Genes are 0..1 proportions: `length`, `girth`,
  `legLength`, `neck`, `headSize`, `limbThickness`, `posture`, `tailLength`, plus plan
  genes (`armLength`, `segments`, `legPairs`, `hover`, `tentacles`, `hop`, `wingSpan`...).
- **Budget** (rule 4): `genomeBudget(depth, rank)` = `SCALING.monsterBudget(depth)` × rank
  (normal 1, magic 1.25, rare 1.5, boss 3). Every part has a `cost`; the generator fills
  slots (each plan gives a chance per slot) with parts it can still afford, picked by
  weight × theme match (×4 for a theme tag, ×1.6 for `any`) × archetype preference (×2.5).
  `head` and `eyes` are always filled. Bosses roll more slots and bigger bodies.
- **Palette** (`palette.ts`): the theme tag gives a base hue (`THEME_COLOURS`), a harmony
  (analogous, complementary, triadic, split, mono; bosses analogous) gives the second colour,
  the primary's lightness is pushed away from the floor's, and every colour is quantised
  (24 hues × 5 saturations × 21 lightness steps) so toon materials stay a small shared set.
- **Elites and bosses**: magic rolls 1 elite mod, rare 2–3, boss 1–2, within
  `SCALING.eliteBudget(depth)`; anything above normal gets a glowing aura ring.
- **Evolution**: `mutate(genome, rng, amount)` drifts genes (σ = 0.22 × amount), swaps,
  adds or drops parts, shifts the palette's hue and, rarely, changes the plan (parts that no
  longer fit are dropped, the head re-rolled). `crossover(a, b, rng)` takes one parent's plan,
  each gene from either parent (or their mean), each slot's part from either parent when it
  fits, and mixes the palettes. `sanitize` / `validateGenome` keep the result buildable.

### Body plans (`plans/`)

| plan | skeleton | locomotion |
| --- | --- | --- |
| `biped` | pelvis → spine → chest → neck → head; 2 arms, 2 legs, optional tail | 2-leg walk/run |
| `brute` | biped grammar: hunched, short legs, huge arms, small low head | heavy 2-leg gait |
| `quadruped` | hips (root) → spine, chest; neck chain, tail chain; front knees forward, hind hocks back | lateral walk, trot |
| `hexapod` | thorax, abdomen, head; 3 or 4 pairs of splayed legs (`legPairs`) | tripod / tetrapod |
| `serpent` | front segment (root) + 5–9 tapering segments; 2-joint neck (`posture` = cobra) | slither wave |
| `floater` | the head part *is* the body, at hover height; tentacles, wings, wisp tail | bob, lean, trail |
| `blob` | a squashy mass on a flat base (its sole) | squash-hop |
| `avian` | egg body, long neck, folded wings, fan tail, backward knees | 2-foot hop (or stride) |
| `centipede` | head segment + 4–8 segments, a splayed leg pair on each | wave gait |

A plan is a `BodyPlanDef`: genes (mean, spread), slot chances, mods (serpents evade, brutes
have life), a base scale and `build(ctx)`, which describes the body with `SkeletonBuilder`
(`plans/builder.ts`):

- `joint(name, parent, pos, yaw?)`, `shape(joint, kind, size, at, colour)`, `chain(...)`;
- `leg({ pair, side, parent, hip, splay, upper, lower, ankle, bend, thick, sole })` adds
  Hip (yaw/roll) → Thigh → Shin → Foot plus a `Sole<pair><side>` mesh; `splay` turns the
  leg plane sideways (spiders), `bend` −1 gives a backward knee (birds, hocks);
- `arm(side, parent, at, upper, lower, thick)`, `addWings`, `addTail`, `addTentacles`;
- `head(joint, size, anchors)` places the head socket and the eye, horn, helm and jaw
  sockets from the chosen head part's anchors (a Jaw joint when it has one);
- `stance[joint] = [x, y, z]`: the base pose every clip starts from (lean, neck, folded wings);
- `done({ roles, locomotion, gaits, height, radius, length })`. **Roles** name the joints
  animation templates address: `root`, `spine`, `chest`, `neck`, `head`, `jaw`, `tail`,
  `wings`, `tentacles`, `segments`, `mass`.

Conventions: faces +Z, the monster's right is −X, feet at y = 0, metres at genome scale 1,
joint names ending in R/L are mirror pairs (`Hip0R` ↔ `Hip0L`).

### Parts (`parts/`)

85 hand-made parts: heads (13: snout, lizard, skull, beak, maw, insect, cyclops, horned,
iron visage, wisp orb, floating eye, jelly bell, hooded wraith), jaws, eyes (pair, big,
cluster, stalk, slit), horns/antlers/antennae/spikes, helms and crests, back pieces
(spikes, plates, shells, fins, crystals, armour, ribs, vents, mushrooms, sails), shoulders,
wings (bat, feather, insect, bone), tails (club, stinger, whip, fan, flame, blade), cores
(crystal, ember, void, rune, heart), tentacles, hands (claws, fists, pincers, scythes,
paws), weapons (club, spear, staff, axe, cleaver, orb) and feet (hooves, talons, claws).

Slots: `head`, `jaw`, `eyes`, `horns`, `helm`, `back`, `shoulders`, `wings`, `tail`, `hands`,
`weapon`, `feet`, `core`, `tentacles`. Mirrored sockets share their slot's part.

A part is `part(id, name, fits, tags, cost, mods, build, { anchors?, anims?, plans? })`.
`build(c)` uses the kit (`parts/kit.ts`): `box`, `ball`, `lump`, `cone`, `cyl`, `taper`,
`horn` (curved, tapered), `slab` (extruded outline), `turned` (lathe), each taking a palette
slot (`primary`, `secondary`, `accent`, `dark`, `glow`) and positions/sizes **in socket
units** (multiplied by the socket's size). Author for the character's **left** (+X); right
sockets are mirrored automatically. `{ glow: true }` makes it unlit (eyes, cores, crystals).
Unit geometry is shared by every part and cached; materials are the engine's cached toon
materials. Socket spaces: heads span x ±0.5, y 0..1, z −0.45..0.55 from the neck joint;
back pieces have +Y out of the body and Z along the spine; tails point −Z from the tip;
hands hang down (−Y) with +Z forward; feet sit on the sole (y = 0 is the floor).
Tags are themes (`fire`, `ice`, `undead`, `insect`, `beast`, `construct`, `void`, `storm`,
`poison`, `nature`, `blood`, `earth`, `shadow`, `crystal`, `arcane`, `water`, or `any`)
and part kinds; mods use the one modifier language (horns `knockback`, wings `move.speed`,
shells `armour`, stingers `chance.poison`...). `anims: ['TailWhip']` lets a melee monster
use its tail.

### Animation (`anim/`)

Every clip is a template over the **semantic poser** (`anim/poser.ts`: `root`, `spine`,
`neck`, `head`, `jaw`, `arm(s)`, `tail`, `wings(raise, spread, fold)`, `tentacles`,
`segments`, `mass(squash)`), so one template animates every body. `bake()` samples the
template (`sampleClip`: keys, eases, layers) on top of the stance, solves every foot with
the **N-leg IK** (`anim/ik.ts`, built on the engine's `twoBoneX`; legs may hang from any
joint, the solver reads that joint's animated transform; splayed legs yaw their plane,
upright legs roll it; feet are levelled to the floor; too-close targets slide outwards
instead of through the floor), then a **floor clamp** lifts the root until no mesh is below
the floor. The result is a plain `ClipDef` (one key per frame) → `compileClip`.

| clips | how |
| --- | --- |
| `Idle` | breathing layers, look-around keys; slither sway, float bob, blob wobble |
| `Walk`, `Run`, `Charge` | `gaitClip` generalised to N legs: a phase per leg (biped 0/½; quadruped lateral walk and trot; tripod, tetrapod, wave gaits are phase tables); stance feet slide back at exactly the clip speed, swing feet arc forward; cadence from leg length (`1.3·√reach` m/s walking, `4·√reach` running, × the gait's `pace`). Hoppers (avian, blob) move both feet together; serpents slither (a lateral wave travelling down the chain at the ground speed); floaters bob and lean. |
| attacks | `Bite`, `Claw` (weapon: overhead chop), `Slam`, `ChargeWindup`, `Spit`, `Cast`, `Summon`, `Leap`, `TailWhip`, `Explode`: anticipation against the strike, a **hit frame**, follow-through |
| `Hit`, `Death`, `Spawn` | flinch; collapse (upright bodies pitch forward, beasts fall on their side, serpents go limp, blobs pop); grow up out of the floor |

`MonsterClipDef.hit` (frame) and `windup` ([start, end] frames) are on the def, in
`clipInfo(name)` (`hitFrame`, `hitTime`) and on `clip.userData` (`hit`, `hitFrame`,
`windup`, `kind`). Combat applies the skill at the hit frame; telegraphs and the wind-up
glow cover the wind-up. Monster clips pass the hero's checks (`analyzeClip`: no floor
penetration, no sliding, clean loop seams): `npm run monster -- check` and the unit tests run
them on every plan and boss.

**Runtime layers** (`runtime.ts`, `MonsterRuntime`): `play(name)` (cross-fades; one-shots hold
their last frame), `locomote(speed)` (Idle/Walk/Run with playback matched to the ground
speed), `update(dt, { lookAt, ground })` returns `hit` / `end` events and applies look-at
(neck and head), hit flinch (`flinch(from)`), optional foot placement on uneven ground
(`ground(x, z)`) and the wind-up glow (`setGlow(t)`). `createTelegraph(spec, damageType)`
builds the ground decals (circle, cone, line) that fill up as the wind-up runs out (combat's
pixel telegraphs, see *Wiring*).

**Performance**: `buildMonster` builds meshes, rig and a one-frame standing pose (~1.5 ms,
median). Clips are baked and compiled the first time they're played (a few ms each) and
cached per body shape (plan + genes + parts + anims), so pack mates and respawns share them;
`buildMonster(g, { eager: true })` compiles everything up front (loading screens).

### Archetypes and brains (`brains/`)

| archetype | does | skills |
| --- | --- | --- |
| `charger` | lowers its head, charges across the room, gores | charge, melee |
| `skirmisher` | darts in, bites, darts out; circles between strikes | melee |
| `caster` | keeps 5–8.5 m away, bolts by theme, novas when you close in | bolt, nova |
| `summoner` | hangs back behind minions it keeps calling, flees when hurt | summon, bolt |
| `bomber` | rushes you, swells, bursts (dies on its hit frame) | explode |
| `tank` | slow, armoured, `frontalBlock`, ground slam | slam, melee |
| `swarm` | weak alone, packs of 5–9 | melee |
| `sniper` | long aimed shots, line telegraph | snipe, spit |
| `leaper` | pounces onto a marked circle, then mauls | leap, melee |
| `totem` | rooted turret; bolts and an empowering ward | bolt, ward |

An archetype is data (`MonsterArchetypeDef`): plan weights, skill roles (`melee` resolves to
bite / claw / weapon swing per body, `bolt` to fire / frost / spark / void per theme), mods,
pack size, scale, preferred part tags and brain numbers (`aggro`, `leash`, `range`,
`strafe`, `retreat`, `flee`, `speed`, `rooted`, `think`). Skills are core `SkillDef`s
(`MONSTER_SKILLS`) plus `range`, `role` and a `telegraph`.

`MonsterBrain` is a small utility AI: every `think` seconds it scores `approach`, `strafe`,
`retreat`, `attack` (one per ready skill), `flee`, `leash`, `wander` and `idle` and runs the
best. It only talks to a **`MonsterBody`** (`brains/types.ts`): `actor` (ActorLike),
`moveTo`, `stop`, `face`, `useSkill(id, target)`, `busy`, `cooldown`, and optional
`teleport`, `telegraph`, `setGlow`, `setCondition`, `emit(MonsterEvent)`. A
**`BrainWorld`** answers `enemies(of, r)` and `allies(of, r)`. The integration implements
both over combat's `Actor`; tests use fakes. **Packs** (`Pack`): a leader (the biggest) and
followers; an alert spreads to every member within 14 m; followers get flanking slots fanned
around the leader's line to the target; deaths re-elect the leader and notify the rest.

**Elite mods** (`brains/elite.ts`, 26): `EliteModDef`s with `Mod`s and a `behaviour` hook
(`ELITE_BEHAVIOURS`: `start`, `update`, `onHitTaken`, `onHitDealt`, `onDeath`,
`onAllyDeath`) that act through the body: hasted, vampiric, fire-enchanted, frost-aura,
teleporter, shielded, splitter, frenzied, berserker, juggernaut, vengeful, arcane-beams,
molten-trail, storm-caller, venomous, thorned, regenerating, volatile, necromancer,
mirror-image, ghostly, gravity-well, armoured, empowering, hexproof (`curse.immune`), hexer (curses
you with Enfeeble every 8 s). Conditional mods
(`when: 'shielded' | 'lowLife' | 'frenzy' | 'phased' | 'enraged'`) switch on with
`body.setCondition`.

### Bosses (`bosses/`)

A `BossDef` is a boss-rank genome plus three **phases** (life thresholds 100 / 66 / 33 %, each
with an attack rotation, a cadence, `onEnter` attacks and mods), a **signature** attack, an
**enrage** timer and an arena (radius, hazards the level places). Signature attacks are boss
modules (`BOSS_ATTACKS`, 26): each plays a monster skill's clip and emits a
`{ type: 'hazard', id: pattern, data: params }` event — `slamWave`, `spiral`, `charge`,
`summon`, `hazard`, `gust`, `darkness`, `beam`, `nova`, `pull`, `echo`, `portal`, `quake`,
`meteor`, `leap` — tagged with the mechanics they belong to. `BossBrain` runs the script on top
of the archetype brain (phase roars, signature every `cadence` s, enrage). `bossName(rng,
tags)` → "Vorgath, the Emberhide".

| # | boss | body | signature (mechanic) |
| --- | --- | --- | --- |
| 1 | Vorgath, the Emberhide | brute charger | brazier slam (embers) |
| 2 | Nyx-Hollow, the Lantern Eater | floating eye caster | snuff the lights (gloom) |
| 3 | Skraal, the Gale Mother | avian leaper | gale gust (gale) |
| 4 | Kryssa, the Glass Matriarch | spider caster | glaze the floor (frostglass) |
| 5 | Bramblemaw, the Root Mother | serpent charger | vine eruption (thornweave) |
| 6 | Volthorn, the Pylon King | quadruped charger | pylon surge (stormspire) |
| 7 | Gulgoth, the Bog Sovereign | blob summoner | mud wave (mire + gale) |
| 8 | Aurelion, the Twice-Struck | biped caster | echo slam (echoes) |
| 9 | Xal'Vey, the Gate Warden | centipede charger | gate charge (riftgates + stormspire) |
| 10 | Sanguar, the Bloodmoon Herald | quadruped leaper | blood nova (bloodmoon + embers) |
| 11 | Vexithas, the Hollow Star | floating orb caster | singularity (gravewell + frostglass) |
| 12 | Korrak, the Ruin Titan | brute tank | cave-in (collapse + gloom) |

`designedBoss(level)`, `buildBoss(boss)` (builds every clip its script needs) and
`generateBoss(rng, depth, mechanics)` for rifts: a themed boss genome, attacks drawn from
the modules tagged with those mechanics plus generic ones, three escalating phases.

### Adding content

- **A plan**: write `plans/<name>.ts` (a `BodyPlanDef` whose `build` uses
  `SkeletonBuilder`), add it to `PLANS` in `plans/index.ts`, add it to some archetypes'
  `planWeights`. Check `npm run monster -- sheet 1 --plan <name>` and
  `npm run monster -- check`.
- **A part**: append `part(...)` to the family file in `parts/` (heads, face, body, limbs).
  Give it slot(s), theme tags, a cost and mods; restrict `plans` if it only suits some
  bodies. Look at it in `/monster-lab.html` (the slot dropdowns) or the zoo.
- **An archetype**: add an entry to `ARCHETYPES` (`brains/archetypes.ts`) with plan
  weights, skill roles and brain numbers; new skills go in `MONSTER_SKILLS` with an `anim`
  from `ATTACK_ANIMS` (or a new template in `ACTIONS`, `anim/actions.ts`: keys over the
  poser, a `hit` frame and a `windup`).
- **An elite mod**: add an `EliteModDef` to `ELITE_MODS` (mods, glow, cost, `behaviour`);
  if it acts, add the hook to `ELITE_BEHAVIOURS` (it gets the host brain, the world, a
  scratch state and the behaviour's parameter after `:`).
- **A boss module**: add a `BossAttackDef` to `BOSS_ATTACKS` (the skill whose clip it plays,
  a pattern, params, a telegraph, mechanic tags); designed bosses list it in a phase, rift
  bosses find it by tag. **A boss**: add a `boss(...)` entry to `bosses/designed.ts`.

### Inspectors

`npm run monster -- …` (`scripts/riftlight/monster.ts`), output in `.scratch/monsters/`:

| command | gives |
| --- | --- |
| `gen <seed> [--plan p --archetype a --depth d --rank r --tags t]` | genome, parts, cost vs budget, skills, stats (mods as text), clips with hit frames, as JSON |
| `sheet <seed> [same]` | `<seed>.png`: turntable (4 yaws) with the rig, then a contact-sheet strip per clip with its metrics |
| `zoo <n> [--seed s --cols c]` | `zoo.png`: n monsters across every plan, a visual variety check |
| `check [n]` | every plan × archetype, n random genomes and the 12 bosses: build time, all clips' metrics, NaNs, bounds; exits 1 on problems |
| `boss <level> [--rift --depth d --tags m1,m2]`, `bosses` | a boss's phases + sheet; the 12 bosses side by side |

**Monster Lab** (`/monster-lab.html`): plan / archetype / rank / theme / depth / seed pickers,
gene sliders, a part dropdown per slot, mutate (amount slider), store parent B and
crossover, **evolve** a 3×3 grid of children (click one, or its button, to keep it), clip
player (play, pause, frame step), skeleton, turntable, Pixel / Raw, contact sheet, stats,
mods, budget, genome JSON export / import / download. URL:
`?seed=7&plan=quadruped&archetype=charger&rank=rare&depth=5&tags=fire&clip=Bite`. Agent handle
`window.__MONSTER_LAB__`: `plans()`, `archetypes()`, `generate(opts)`, `genome()`, `show(g)`,
`setGene`, `setPart`, `mutate`, `storeParent`, `crossover`, `evolve`, `select(i)`, `clips()`,
`play`, `pause`, `seek`, `state()`, `stats()`, `exportGenome()`, `sheet(clip)`,
`portrait()`, `capture()`. The `riftlight-monsters` e2e suite drives it on WebGPU and WebGL 2.

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
| `npm run monster -- gen\|sheet\|zoo\|check\|boss` | genome + stats JSON, PNG turntable + rig overlay + animation strips, a zoo grid, clip/build checks for many genomes (see Monsters); `/monster-lab.html` is the Spore editor |
| `npm run loot -- sim` | drop/affix distributions by item level and rarity, as PNG charts + JSON; tooltip renders |
| `npm run tree -- render\|validate\|stats\|path` | the passive tree as a PNG (regions, keystones, path lengths), connectivity and stat-budget checks, counts, shortest paths; `/tree.html` browses it |
| `npm run level -- map <n\|seed>` · `validate 1..60` · `rift <seed> <depth>` · `themes` | top-down map PNG with spawns, mechanic elements and critical path, plus bypass validation (the exit is reachable without using the mechanic); theme swatches |
| `npm run combat -- dps <skill> [supports]` | a skill with its supports resolved: hit breakdown, crits, ailments, DPS, mana per second (text or `--json`) |
| `npm run balance [-- --depths 1-12,20 --builds melee,bow --raw --json]` | headless combat sim over the real code, build × depth: time to kill normal/magic/rare/boss, damage taken, hits and time to die, clear time, the XP curve; PNG charts, CSV, JSON and the worst outliers (see Balance below) |
| `npm run playtest -- <depth> [--runs n] [--film]` | a bot plays the real game frame-exactly and reports clear time, deaths, damage taken and loot, with a film (see Game shell) |
| `npm run inspect -- <hero\|file.glb\|clip:Run\|monster:7\|boss:4\|npc:brann\|prop:brazier\|item:3>` · `diff <a> [b]` | any asset as an 8-angle turntable, a rig overlay with joint names and counts (triangles, draw calls, materials, bounds, joints, clips) with warnings; diffs two assets or two versions (docs/ENGINE.md, *Tooling for agents*) |

### Balance (`npm run balance`)

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
  highest the hero can equip.
- **Real code**: `buildSkill`, `expectedHit` (through `balance/dps.ts`, which `npm run combat`
  uses too), `StatSheet` with `treeMods`-style node mods and `itemMods`, the monsters' genome
  stats and skills (`MONSTER_SKILLS`), boss phases and enrage, `SCALING`/`RANK`, `addXp` /
  `killXp`, `pointBudget`.
- **Assumed** (`balance/assumptions.ts`, printed every run): hero growth per level, monster
  base record (the `Actor` default), monster attack uptime 50% and half a pack engaged, pack
  reach per delivery, walk detour, minions never die, mana as a level-wide budget (the free
  `slash` when it runs out). Elite behaviours, conditional mods and boss hazards are not
  modelled.
- **Contract gaps**: stats some systems write under another name than combat reads
  (`crit.multi`, `block`, `energy.shield`, `crit.chance.base`, `life.leech`, `res.elemental`,
  owner `minion.*` …) are aliased by default and listed; `--raw` turns the aliases off. Stats
  on the sheets the sim never read are listed as *read nowhere by that name* (they do nothing)
  or *read only outside the sim*.

Example (seed 1, default depths): the summary prints
`! geared minion: boss TTK 981× slower than the others (24/24 depths, worst at depth 28)`,
`! depth 12 boss TTK 13× depth 11 (naked, every build)`,
`! 4 geared builds die to the boss (no potions), all but one by depth 24`,
`! 4 geared builds are one-shot by the boss's biggest hit, all but one by depth 36`. Tune
`core/scaling.ts`, rerun, compare the CSVs.

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
| `gems.ts` | every gem that drops or is sold: R1's active skills (but the basic attack and the dodge) and supports | 73 |
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
clone of the hero's StatSheet (`StatSheet.clone()`). In the game shell the windows are hosted
(`new ItemsUi(ctx, store, { hosted: true })`): the shell routes keys and the pad through
`handle(UiEvent)` and closes them (see "Wiring" under Game shell), and they add the crafting
bench and the skill panel as left windows.

**Inspector**: `npm run loot -- sim --depth 20 --kills 5000` (rarity, slot and tier charts,
rarity by depth, gold/hour → `.scratch/loot/`), `roll --seed 3 --ilvl 60 --rarity rare`,
`tooltip <seed> [--alt]` (PNG), `uniques` (list + one PNG of every unique).

## Difficulty

The pause menu (Esc) has a **Tuning** panel with sliders for player damage, life and speed and
enemy damage, life and speed. Each slider is a `Mod` source on the matching side, so it uses
the same path as every other bonus. The values are saved and shown in the HUD corner whenever
they aren't 1.0.

## Levels, mechanics & lighting

Code: `src/riftlight/levels/`. A level is **planned** as pure data, then **built**:

```
LevelSpec ──planLevel──▶ LevelPlan (layout, mechanic elements, props, packs, chests, shrines)
          ──buildLevel(spec, ctx, hooks)──▶ Level (geometry, colliders, lights, mechanic runtimes, encounters)
```

| file | what |
| --- | --- |
| `layout/templates.ts` | room templates: ASCII stencils with tags (`ROOM_TEMPLATES`) |
| `layout/generate.ts` | the graph grammar (`GRAMMAR`), placement, style passes, critical path |
| `layout/geometry.ts` | floors, walls, cliffs, props → a few merged meshes; greedy-merged colliders |
| `themes/themes.ts` · `palette.ts` · `props.ts` | 12 themes, the rift palette shifter, prop builders |
| `mechanics/*.ts` | the 12 mechanics (`MECHANICS` registry, `compatible`, `pickCompatible`) |
| `plan.ts` | `planLevel`: layout + mechanics + packs + chests/shrines (`SHRINES`) + props |
| `Level.ts` · `nav.ts` | `buildLevel`, the runtime, walkability, wall raycasts, the flow field |
| `designed.ts` · `rift.ts` | the 12 designed `LevelSpec`s, `riftSpec(seed, depth)`, `levelSpec(depth)` |
| `validate.ts` | the checks behind `npm run level -- validate` and the unit tests |
| `levelLab.ts` | `/?game=levellab&depth=N` with placeholder capsule actors |

### Using a level from the game

```ts
const level = buildLevel(levelSpec(depth, runSeed), {
  scene: ctx.scene, events, actors: () => [hero, ...monsters],          // required
  physics: ctx.physics, lights: ctx.lights, particles: ctx.particles, audio: ctx.audio,
  world: { scene: ctx.scene, sun: ctx.engine.sun, ambient: ctx.engine.ambient },
}, {
  spawnMonster: (s) => buildMonster(...),  // s: archetype, rank, position, level, depth, pack, room, genome, eliteBudget, power
  applyHit, replaySkill, teleport, dropLoot, onExit, onFall,   // optional, see LevelHooks
});
// fixedUpdate: level.fixedUpdate(dt) (mechanic forces, falls)   update: level.update(dt)
level.nav.direction(x, z, out);   // flow field toward the hero (rebuilt only when the hero changes cell)
level.nav.path(a, b); level.isWalkable(x, z); level.raycastWalls(from, dir, max);
level.targets();                  // braziers, pylons…: neutral ActorLikes combat may hit
level.minimap.explored;           // cells the hero has seen
```

Packs spawn when the hero comes within 16 m or enters their room. The boss's death opens the
exit portal and emits `levelClear { depth, time }`; walking into the open portal calls
`hooks.onExit`. Chests (`dropLoot`) and shrines (a timed `StatSheet` source of `SHRINES` mods)
open on contact. Grid cell (x, z) covers world [x, x+1] × [z, z+1]; floors are at y = 0.
The ARPG camera is the `iso` preset at pitch 42°, yaw 45°, view height 15 (zoom with the
wheel); the lab sets it unless the URL picks a camera.

### Layouts

Six styles: `dungeon` (rooms + corridors), `caves` (cellular-automata blobs), `ruins` (broken
walls, rubble), `arena` (a short approach to a big boss room), `bridges` (islands and 2-wide
bridges over the void), `town` (districts on a street grid, buildings as blocks). The graph
grammar grows start → boss with rules from `GRAMMAR` (extend the critical chain, add a quiet
connector, hang treasure, guarded treasure and shrine branches); placement stamps a
rotated/mirrored stencil per node next to its parent, joined by a straight corridor. The
critical path is a Dijkstra path from the entrance to the exit that prefers room centres.
Every attempt must reach every room and the exit; failures retry with a forked seed (the
error lists why each attempt failed). Back walls are tall, front walls (between the iso
camera and a floor) are cut low, every wall has a trim band and cap, lone wall cells become
pillars, and everything below the floor sinks into the theme's height fog.

**Add a room template:** add an entry to `ROOM_TEMPLATES` (`layout/templates.ts`): the
interior as ASCII (`.` floor, `~` pit, `P` pillar, `S` spawn, `T` treasure, `H` shrine, `M`
mechanic slot, `B` boss, `E` entrance, `X` exit, `o` prop, space = not part of the room) and
tags: its role (`start`, `combat`, `hall`, `treasure`, `shrine`, `boss`) and the styles it
suits. **Add a layout style:** add it to `LayoutStyle` and `STYLE` (corridor length/width) in
`generate.ts`, plus a style pass (like `erodeCaves` or `ruin`) if it needs one.

### Themes and props

A `LevelTheme` (`themes/themes.ts`) is data: palette (floor, wall, accent, fog, sky, light),
`floorAlt`, `trim`, `cliff`, ambient and sun colours and intensities, height-fog distances,
torch intensity/radius/flicker, prop ids and density, wall height, a `song` id and optional
`filters`. Floors stay mid-dark and quiet, walls darker (silhouettes), trim and accent carry
the identity, and in dark themes ambient + sun stay low so the dynamic lights carry the mood.
**Add a theme:** add an entry to `THEMES`; `npm run level -- themes` shows it with three rift
shifts and its floor/wall contrast. **Add a prop:** add a `PropDef` to `PROPS`
(`themes/props.ts`) built from chunky primitives with `toonMaterial`/`glowMaterial`; return a
`glow` to make it request a light. Blocking props only land where all 8 neighbours are open
floor (a single blocked cell can't cut a path) and never on the critical path.

Rifts shift a theme's palette (`shiftTheme`: hue rotation, contrast, saturation) and clamp
it back into readability bounds: floor lightness 0.16–0.5, walls ≥ 0.07 darker than floors,
saturated accents. A shifted theme id (`ember-forge~h40c105s110`) resolves anywhere with
`resolveTheme`, so specs stay plain data.

Lighting: emissive props (torches on back walls, braziers, lanterns, crystals, mushrooms),
mechanic elements, chests, shrines, the portal and effects all request lights from the
engine's `LightPool` (docs/ENGINE.md, *Dynamic lights*); the pool lights the 4/8/16 that
matter most near the camera and fades the rest.

### Mechanics

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
| Bloodmoon | blood altars (solid) | monsters explode on death (`kill`), red tint | explode, chain, pact | chain xp.gain; pact spares + heals the hero |
| Gravewell | wells (radius 2–3) | pulsing pull (hero resists) | pulse, shard | gravity shards: area, xp.gain |
| Collapse | crumbling floor zones (+ loot caches) | floor drops into the void behind the hero | crumble, cache, bonusLoot | caches; bonus loot for clears under par |

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

### The bypass guarantee

Every level must be clearable **without using its mechanics**: the exit is reachable from the
start while treating every mechanic element (solid, hazard or zone) as blocked. It is
enforced while placing: `Placement.add` (`mechanics/common.ts`) refuses any element that
overlaps the critical path corridor (the path ± 1 cell), the entrance/exit/boss/chest/shrine
spots or another element, or that would cut the start from the exit; mechanics simply try
another spot. `validate.ts` re-checks it independently (with reachability, room count,
encounter budget, overlaps and build time) for `npm run level -- validate 1..60` and the
unit tests. Mechanics still place their best spots next to the road (haste pads two cells
away, wisps lighting it, lanes aimed at pits), so exploiting them is always one step aside.

### Encounters

Each room gets packs by area × `SCALING.density(depth)`; each pack has a power budget
`SCALING.monsterBudget(depth)`: a rare or magic leader by chance, normals up to 4–7 members,
and the rest as per-member `power` for the monsters system (bigger bodies, parts, elite
mods), so deep packs get stronger rather than bigger. The boss room holds the boss (the
spec's `boss` genome) plus packs. Validation keeps spending within 80–120% of the budget.

### Rifts

`riftSpec(seed, depth)` (depth > 12) picks `SCALING.riftMechanics(depth)` (2–4) mutually
compatible mechanics, a theme (half the time the first mechanic's home theme) with a palette
shift that swings wider deeper, a weighted layout style, 3–5 archetypes, a boss genome
placeholder, and names it after its mechanics: *Rift 37: Frostglass Embers Gloom*.
`levelSpec(depth, runSeed)` gives designed levels for 1–12 and rifts beyond.

### Tools

- `npm run level -- map 7` → `.scratch/levels/07-mire.png`: floor, walls, pits, rooms (id +
  role), the critical path, mechanic elements (solid framed, hazards hatched, zones filled),
  packs by rank, chests, shrines, torches, start, exit and a legend with the validation.
- `npm run level -- validate 1..60` (exit 1 on problems), `rift <seed> <depth>`, `themes`.
- `/?game=levellab&depth=N` (`&seed=S`, `&god=1`): WASD, J/Space swings (hits braziers and
  pylons too), K casts a firebolt (a moving light). `window.__LEVEL_LAB__` has `autopilot`,
  `killBoss()`, `teleport(x, z)`, `log` (mechanic events) and the level.

### What levels need from actors and combat

`ActorLike` is enough to run, but the real game should provide: multiplier stats with base 1
(`move.speed`, `attack.speed`, `damage`, `damage.taken` (with the hit's tags), `xp.gain`,
`light.radius`, `area`, `item.rarity`) and read them; honour `StatSheet` conditions
(`inDark`, `tailwind`, `onIce`, `inThorns`, `inMud`); treat `push` as a velocity impulse;
emit `skill` for every hero skill use and `kill` for every death (Echoes, Bloodmoon,
Frostglass, Thornweave, Gravewell listen); include `level.targets()` in hit queries; and
implement `hooks.applyHit`, `replaySkill`, `teleport`, `dropLoot`, `onFall`.
they aren't 1.0. Details (presets, steps, the mods each slider sets): Game shell below.

## Game shell (`game/`, `town/`, `ui/`)

`Riftlight` (`src/riftlight/game/Riftlight.ts`) is the one `Game` the page runs at `/`. It owns
the flow, the town, the HUD and menus, saves, the difficulty sliders, the camera, music, the dev
tools and the agent API, and it reaches gameplay only through **ports**. `new Riftlight()` runs
the real systems; every port also has a stub in `game/stubs/` (fast, no assets) for tests and
for building one system against the others:

```ts
new Riftlight();                       // the real hero, levels, monsters, loot and tree
new Riftlight(stubPorts());            // all stubs
new Riftlight({ monsters: myMonsters }); // the real game with one port replaced
```

### Flow

```
title (town at dusk behind the logo) ─ Continue / New Run (slot) / Load·Import / Settings
  └▶ town (Emberfall): talk to Vex at the obelisk ─▶ rift menu (every cleared depth + the next)
       └▶ level: name card "III · GALE" ─▶ fight ─▶ all monsters dead = clear (time, autosave)
            ├▶ portal ─▶ loot window (what's still on the floor: take all / leave) ─▶ town
            └▶ death ─▶ recap (killer, damage by type, worst enemies, tip, penalty) ─▶ town
```

- **Stages swap inside the game**, not through `engine.loadGame`: the town is built once and
  hidden while a level runs; the hero (model, clips, stats), HUD, music and the light pool
  survive; a level is a root object the shell adds and disposes. `loadGame` would rebuild and
  re-upload the town and the hero on every trip home.
- **Lights** are requests to the engine's light pool (`ctx.lights`; `game/lights.ts` adapts
  it for the shell): the hero's lantern, level props, projectiles, loot beams and hit flashes
  all borrow from it by priority, and no system adds a runtime `PointLight`, so toon materials
  never recompile when stages swap or a fight gets busy.
- **Pause**: modal panels (pause, tuning, tree, codex, recap, loot window) freeze the world
  inside the game (`worldPaused`); the vendor, stash and inventory leave the town running.
- **Death penalty** (`progress.ts` `DEATH_PENALTY`): 10% of the XP into the current level and
  15% of carried gold; never a level. **Run progression**: `deepest` cleared depth unlocks the
  next; designed levels 1–12, rifts after.
- **Camera**: the iso preset at 42° pitch (`RIFTLIGHT_OPTIONS`), zoom 1.08 in levels and 1.22
  in town (times the settings zoom; the wheel adjusts it), smooth follow with a lead of 22% of
  the way to the aim point (max 1.6 m), screen shake from `services.shake`.
- **Music** (`game/audio.ts`, the engine's song format): title, town, level, a combat
  arrangement of the level loop that a combat-intensity meter swaps in with hysteresis, and a
  boss song near a boss. UI and game sounds are `rl.*` SFX data.

### Ports (`game/ports.ts`)

| port | real system | what the shell calls |
| --- | --- | --- |
| `HeroFactory` / `HeroPort` | combat/actors | `create(services, save.hero)`; `enter(stage, at, yaw)`, `fixedUpdate(dt, HeroIntent)`, `update`, `vitals()`, `skills()`, `buffs()`, `setLevel`, `setMods(source, mods)`, `setSkills?(save.hero.skills)`, `restore`, `emote` |
| `LevelPort` / `LevelHandle` | levels | `spec(depth, seed)`, `mechanics()`, `build(spec, deps)`; handle: `layout`, `origin`, `start`, `exit`, `exitOpen`, `progress()`, `boss()`, `explored()`, `telegraphs()`, `monsters()`, `spawn(seed, at, rank)` |
| `MonsterPort` / `MonsterHandle` | monsters | `genome(seed, depth, rank)`, `build(genome, {stage, at, depth, mods})`; handle: `actor`, `telegraph()`, `fixedUpdate(dt, {hero, enabled})` |
| `LootPort` | loot (`wire/loot.ts`, the default) | `rollDrops(kill, rng)`, `spawn`, `ground()`, `pickup`, `gearMods()`, `load/write(save)`, `give`, views: inventory, stash, vendor, crafting, skills |
| `TreePort` | tree (`wire/tree.ts`, the default) | `mods(allocated)` (the `tree` source), `points(level, deepest)`, `view(host, {respec})` |

Ports talk to each other through `GameEvents` (`hit`, `kill`, `death`, `gold`, `loot`,
`levelClear`, `mechanic`): the shell turns `hit` into damage numbers, the recap and shake;
`kill` into XP (`SCALING.monsterXp × RANK.xp`), streaks and stats; `mechanic` into codex
unlocks. Views are `Panel`s drawn on the pixel HUD (`ui/kit.ts` `UiCanvas`) that receive
`UiEvent`s (nav, confirm, back, tab, key, pointer, wheel) built from keys, mouse, touch and
pads alike; `PanelHost` gives them the save, gold, sounds and
`changed('tree' | 'gear' | 'gold' | 'stash' | 'skills')`. `ShellServices.hero()` is the hero's
actor (loot and the skill panel read its StatSheet). A panel may implement `fit(w, h)`: the
layer tells it the room there is before reading `size` (a phone in portrait is 124 art pixels
wide) and clamps every panel to the screen; menus then put labels above their controls and the
character sheet moves its explain column under the list.

**HUD layout** (`ui/layout.ts`). The fixed HUD (`hudZones`: orbs, bar, minimap, boss bar,
banner) reserves its rects each frame; world overlays are placed around them by priority with
`HudLayout.place`: the prompt, the focused loot label, the other labels (loud first, then
near), then damage numbers (which merge quick hits on one target and stack per target).
Whatever finds no room is skipped for that frame. The centre banner is a `BannerQueue`: the
level card, LEVEL CLEAR and level-ups show one at a time, a second level-up merges into the
one showing, a clear cuts a level-up short. Under 300 art pixels wide the HUD is compact
(`hudGeometry`): small orbs over a tight bar, a small minimap.

**Gem icons** (`skills/icons.ts`): every gem has an 8 × 6 pixel icon, generated from its data:
actives draw their delivery's shape in their `look` colours, supports a glyph for what they
change (projectiles, chain, area, speed, crit, leech, minions...) in their element's colour.
The skill bar, the bags, the sockets and the vendor draw the same icon.

### Wiring: hero, levels and monsters (`wire/`)

`corePorts()` (`wire/index.ts`) gives the shell the real hero, levels and monsters; they share
one `Worlds` map (stage → `CombatWorld`).

- **One combat world per stage** (`wire/world.ts` `CombatWorld`): R1's `ActorManager` and
  `Combat` on the shell's event bus, the stage's wall query, `light` events turned into
  `ctx.lights` requests, and combat shake sent to `services.shake`. A level builds its own; the
  town's is made by the hero when it walks in. `enter()` moves the hero actor from world to world
  (its buffs, cooldowns and stats travel with it).
- **The hero** (`wire/hero.ts` `RealHero`): R1's `HeroController` with a `StageMover`
  (kinematic: slides along walls, rounds corners, falls into a pit only when shoved). One input
  path: the shell's `HeroIntent` (keys, mouse, pads, touch, the bot) becomes its input. The bar
  comes from the save's sockets (`socketsToSlots`, gear's `skill.level`); a save with nothing
  socketed gets `WIRE_TUNING.defaultSkills`. Stats: `HERO_BASE_STATS` + the `level` source
  (`progression.ts` `levelMods`) + the starter sword until gear brings a weapon + `setMods`
  sources (gear, tree, difficulty). `skills()` / `buffs()` / `vitals()` feed the HUD.
- **Levels** (`wire/levels.ts` `LevelStage`): R5's `buildLevel` with every hook wired
  (`spawnMonster` for packs, designed and generated bosses; `applyHit` for hazards and props;
  `replaySkill` for echoes; `teleport`; `dropLoot`; `onFall`). It owns the combat world, the
  packs and hazards, the theme's filters and song, telegraph decals, the minimap and health
  globes (`globes.ts`: 20% life, 15% mana). Loading builds every pack and preloads every clip
  and material (adds and boss summons too), then renders two warm-up frames: no hitch when a
  pack wakes up.
- **Monsters** (`wire/monsters.ts` `MonsterUnit`): R4's genome → `buildMonster` → an R1 `Actor`
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

### Wiring: loot, skills and the passive tree (`wire/`)

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
socketed. Gems are R1's `SKILLS` / `SUPPORTS` (`loot/data/gems.ts` lists every active but the
basic attack and the dodge, and every support); they drop (~6% of items) and Ilsa's gems tab
sells them. The panel shows each slot's `buildSkill` numbers on the hero's StatSheet (hit,
DPS, cost, cooldown, cast time, area / projectiles, links that don't fit: a pocket
`npm run combat -- dps`). When sockets change the panel writes the save and calls
`changed('skills')`; the shell calls `hero.setSkills(save.hero.skills)`, and
`socketsToSlots(skills, hero.stats)` turns them into `HeroController` slots (`{ skill, level,
supports: [{ gem, level }] }`, null for an empty slot; the level adds gear's `skill.level` mods
that fit the skill's tags, as the panel's numbers do).

**Loot in the world.** Drops are R3's `rollDrops` with the hero's `item.rarity`,
`item.quantity` and `gold.find`, shown by `WorldLoot` (arcs, landing sounds, beams; lights from
the engine's `ctx.lights` pool) under the stage's root. The shell draws the labels (framed for
loud drops, grey for dim ones, stacked so they never overlap) and picks up. `filtered` follows
the loot filter setting (show all / hide normal gear / rares only; currency and gems always
show) on top of R3's rules; Alt shows everything. Gold the vendor takes or pays goes through
`addGold`: the save's gold is the one wallet.

`npx tsx scripts/riftlight/stat-names.ts` lists every stat name loot and the tree put on a
StatSheet, with where each comes from (`.scratch/stats/emitted.json`).

### Saves (`game/save.ts`)

`localStorage` `riftlight:slot:<0..2>` holds `{ format: 'riftlight-save', version, slot,
savedAt, data: SaveData }`; `riftlight:meta` remembers the last slot (Continue). Every access is
in try/catch; blocked storage (or `?save=memory`) keeps saves in memory for the session.
`migrate()` upgrades older shapes step by step (v0 = pre-release saves) and fills missing fields;
a save from a newer build is refused, not mangled. Export / import is the same envelope as a
JSON file (Load / Import menu, or `__RIFTLIGHT__.exportSave()`). Autosave on town entry and
level clear. `SaveData` gained optional `codex` and `stats` (runs, clears, deaths, kills,
playtime, best time per depth); `positions` (grid cells of the bag and the stash) and the skill
sockets survive a load. Device settings (look, quality, zoom, damage numbers, loot
filter, shake, prompt glyphs) live in `riftlight:settings`; volumes in the engine's audio store.

### The difficulty sliders

Pause → **Tuning**: hero damage / life / speed and enemy damage / life / speed, each 0.25×–4× on
a log scale (1.0 in the middle; ←/→ nudge 0.05 below 1×, 0.1 to 2×, 0.25 above), presets Story,
Normal, Hard, Nightmare, and Reset. `difficultyMods(t, side)` turns them into `more` mods
(`damage`; `life` + `es`; `move.speed` + `attack.speed` + `cast.speed`) applied as the
`difficulty` source of the hero and of every monster at spawn; moving a slider re-applies it to
live monsters and keeps their life fraction. Saved per slot and shown in the HUD corner
("E.LIFE 1.50X") whenever a slider isn't 1.0.

### Agent API: `window.__RIFTLIGHT__`

Typed as `RiftlightApi` (`game/api.ts`). Steps go through `Engine.step`, frame-exact.

| call | does |
| --- | --- |
| `state()` | screen, ui stack, depth, level time, cleared/exit/dead, hero (level, xp, gold, pools, position), monsters, loot, boss, difficulty, codex, session counters |
| `newRun({slot, seed})`, `continueRun(slot?)`, `toTown()`, `toTitle()`, `await enterDepth(n)` | flow |
| `step(n, intent?)`, `moveTo(x, z)`, `talkTo('vex')`, `interact()`, `press('Escape')` | drive the hero and the menus |
| `fight({skills})`, `collectGold()`, `pickupAll()`, `killAll()` | level helpers |
| `spawn({seed, x, z, rank})`, `give({xp, gold, items, levels})`, `setDifficulty({...})`, `dev` (god, ai, hitboxes) | dev tools |
| `hero(stat?, tags?)`, `actors()`, `loot()`, `log()` | inspect (`hero('damage')` returns `explain` sources) |
| `ui.stack()`, `ui.open(id)`, `ui.close()`, `ui.widgets()`, `ui.click(id)` | menus as data |
| `save(slot)`, `load(slot)`, `exportSave(slot)`, `importSave(slot, json)`, `slots()` | saves |
| `bot.run({maxFrames})`, `bot.start()`, `bot.advance(n)`, `bot.report()`, `bot.decide()` | the playtest bot |
| `arcade.*`, `bestiary.*`, `photo.*` | the showcase: the arcade cabinet, the Hall of Beasts, photo mode (see *Showcase* below) |

`?seed=123` makes new runs reproducible; `?save=memory` keeps tests out of localStorage. The
pause menu's **Dev** panel has the same tools (teleport to depth, give, god mode, kill all, spawn,
AI off, hitboxes, time of day).

### The playtest bot (`game/bot.ts`, `npm run playtest`)

A scripted player that only uses the ports (it plays the stubs and the real game alike): it
steps out of telegraphs about to land on it by their shape (circles, lines, cones; it trades
blows with a plain swing while its life is good) and rolls, backs off and grabs health globes
when low, fights the nearest monster (the boss first when close) with the basic attack and the
skills that pay off, read from their tags (areas on 2+, novas on 3+, buffs for packs and bosses,
gap closers, ranged skills from a distance), swings only with a clear line (no wall corner in
between), gives up for a while on a monster it can't reach or can't hurt, walks to loot (not
for ever: a full bag or a drop out of reach is left), follows grid BFS routes that go cell by
cell after a corner stopped it, and walks into the portal once the level is clear. `npm run playtest -- 3 --runs 5 --film --gif` plays depth 3
five times and prints clear time, deaths, damage taken, kills, XP, gold, items and stuck events;
JSON, filmstrip PNG (scene + HUD) and GIF land in `.scratch/playtest/`.

### Town (`town/`)

Emberfall is data in `TOWN_LAYOUT` (screen-space metres, `iso()` maps them onto the 45° ground)
built from primitives by `town/kit.ts` and merged to one mesh per material. Townsfolk wear the
hero rig with their own meshes (`npcModel.ts`) and play clips written as data (`npcClips.ts`:
Hammer, HammerRest, Nod, Shuffle, Greet, CountCoins, Meditate, Bless, StaffIdle, Gesture; the
villagers use the hero's Idle and Walk). `npm run anim -- check` measures them with the hero;
`--character brann` (ilsa, oru, vex, villager, villager2) selects one for `sheet` / `curves`.
At runtime (`npcs.ts`) they turn their heads toward the hero, bark when you come near, react
when talked to (Brann rests his hammer and nods, Oru blesses, Vex points at the obelisk;
Ilsa waves as you come near) and open their view: Brann the crafting bench, Ilsa the vendor, Oru the tree respec,
Vex the rift menu, the chest the stash.

## Showcase: other genres inside Riftlight (`showcase/`)

The same engine, hero and town also run a side-scroller, a first-person gallery and a photo
mode. Each piece is small and complete, written to be copied as the start of a new game.

| piece | where in game | camera | code |
| --- | --- | --- | --- |
| **Arcade: Rift Runner** | the cabinet booth south-west of the plaza (F) · `?game=arcade` on its own | `side` | `showcase/arcade/` |
| **Hall of Beasts** | the archway and lectern south-east of the plaza (F) | `first`, `free`, an orbit on `fixed` | `showcase/bestiary/` |
| **Photo mode** | anywhere in town, a level, the arcade or the hall: **O**, or pause → Photo mode | `free` | `showcase/photo/` |

**How it plugs into the shell** (`showcase/Showcase.ts`). Riftlight asks the showcase first in
`fixedUpdate`, `update`, `cameraTarget`, `eyePosition` and `onCameraChange`; while a mode is
active it owns the frame and the town stands still behind it. A mode (`ShowcaseMode`) is
`enter()` (build the stage), `leave()` (remove it), `camera()`, `filters`, `fixedUpdate`,
`update`, `draw` and `cameraTarget`. The host runs the transition: the camera swoops toward the
thing you used and an iris closes (HUD rects), the mode builds behind it, then
`engine.setCamera(mode.camera(), { syncUrl: false })` and `setFilters(mode.filters)` swap the
look and the iris opens. Leaving puts back the filters, the render mode and the game's own iso
preset. No `engine.loadGame`: the town, the hero, the save and the music player survive, and each
stage removes every collider, trigger and controller it added (the e2e suite checks
`physics.counts()` comes back to where it was). The town gets the booth and the archway through
`Town.extend({ root, blockers, interactables, activate, deactivate, update })`
(`showcase/townProps.ts`), lights from the engine's pool only while the town shows.

**The hero as a platformer** (`showcase/visitor.ts`). `Visitor` is the hero model on the engine's
`PlatformerCharacter` (the whole Mario-64 moveset) with the playground's sounds and dust, clips
compiled once and shared by every clone; `spawn(physics, at, { lockDepth })` / `despawn()`.
Both stages walk with it.

### Build a side-scroller (`showcase/arcade/`)

- **The course is data** (`stage.ts`): blocks (x and y spans, a kind for the look, Rapier tags),
  cracked slabs, coins, checkpoints, the flag x, a par time, parallax scenery and the cabinet's
  chiptune (`ARCADE_SONG`). Coordinates are stage-local; the hero's lane is z = 0.
- **The stage** (`ArcadeStage.ts`) builds it at any `origin` (the cabinet builds it 1 km west of
  town): merged meshes, one collider per block, coin and goal **triggers** filtered to the hero's
  collider, READY → GO, a timer, checkpoints and a kill plane, the ground pound that breaks the
  slabs (`hero.state === 'groundPoundLand'` over them → `physics.remove` their colliders),
  parallax layers that follow the camera at a fraction, and its HUD on `ctx.hud`.
- **Input** (`readArcadeInput`): the stick's x runs along the course, down or C crouches (a
  ground pound in the air), Space / pad A / touch B jumps. The character is created with
  `lockDepth: true`, so any camera works, but the game uses `side` (`ARCADE_OPTIONS`:
  `{ preset: 'side', viewHeight: 12 }` and the `16bit` + `crt` look).
- **The template** is `ArcadeGame.ts` (`?game=arcade`): about 60 lines around the stage.
- **Scripted run** (`autoplay.ts`): a reactive pilot in beats (run, jump the pit, double jump
  from the step's edge, wall-kick the chimney, ground-pound the slabs, hop to the flag) that
  reads the hero's state, so the e2e suite proves the course can be finished with the real
  moveset. After changing the course: `npm run film -- arcade-pit arcade-ledge arcade-chimney
  arcade-pound` and `__RIFTLIGHT__.arcade.autoplay()`.
- In Riftlight a finished run pays `ARCADE_REWARD` gold (finish + a coin per coin + a new best)
  and keeps the best time in `save.showcase.arcade` (autosaved).

### Build a first-person gallery / viewer (`showcase/bestiary/`)

- **Records**: every hero kill is counted by species in `save.showcase.bestiary`
  (`showcase/save.ts`: `speciesKey` is plan + archetype + parts, bosses by name; the genome is kept
  so the exhibit can be rebuilt; at most `BESTIARY_LIMIT` species, bosses always stay). The
  monster's genome reaches the kill event through `object.userData.genome`
  (`wire/monsters.ts`).
- **The hall** (`hall.ts`) is primitives from the town's kit, Rapier boxes and cylinders, ten
  pedestals and the Rift Altar. It is dark on purpose: the sun drops to 0.12, a navy ambient,
  and every exhibit, the door lamps and the altar request a light from the engine's pool (8 of
  13 lit at medium quality, the ones near the camera).
- **Walking**: the `first` preset and `readMoveInput` (WASD strafe, the hero faces the camera),
  Tab / pad Y flies with `free`. **Inspecting** switches to `fixed` and moves the camera by hand
  around the exhibit (drag or Q/E, wheel), framing it left of the card; a button per clip
  (`MonsterRuntime.play`), the turntable. **Breeding**: `crossover` + `mutate` of two species,
  the child grows on the vat (`Spawn`), a seed from the save keeps it reproducible.

### Build a photo mode (`showcase/photo/PhotoMode.ts`)

Save what you will change (camera config, filters, render mode, resolution, sun and ambient,
time of day), switch to `free` from the current view, freeze the world (the shell stops
advancing it), and give each setting a row: every `FILTER_PRESETS` look and every single
`FILTER_IDS` filter (`PHOTO_LOOKS`), pixel / raw, 480 / 320, time of day (town), sun and ambient
scale, a fill light that follows the camera (`ctx.lights.request({ follow: camera })`). Tab
switches fly / edit (the rig's `fixed` flag), drag looks (no pointer lock, so the panel stays
clickable). P saves `renderer.capture()` as a PNG through a 2D canvas (the HUD is not in it);
Esc puts everything back.

### Agent API

| call | does |
| --- | --- |
| `await arcade.start({ instant? })`, `arcade.state()`, `arcade.autoplay({ maxFrames })`, `arcade.restart()`, `arcade.leave()` | the cabinet: phase, time, coins, slabs, result, record, camera, filters |
| `await bestiary.open()`, `bestiary.entries()`, `state()`, `inspect(i)`, `play(clip, i?)`, `view('walk' \| 'fly' \| 'inspect' \| 'breed')`, `turntable(on)`, `wing(dir)`, `breed(a, b)`, `mutate()`, `close()` | the Hall of Beasts |
| `photo.open()`, `state()`, `setLook(name \| index)`, `next(dir)`, `setMode('pixel' \| 'raw')`, `setTime(t)`, `setLight(i)`, `await capture({ download })`, `close()` | photo mode (`capture` returns the PNG's data URL) |

The `riftlight-showcase` e2e suite (`scripts/e2e-riftlight-showcase.mjs`, `@cameras`) plays all
three on WebGPU and the WebGL 2 fallback; frames in `.scratch/e2e/showcase-*.png`.
