# Monsters ("Spore" generator)

Code: `src/riftlight/monsters/` (public API in `index.ts`). Body plans, parts and clips:
docs/game/monster-parts.md. A monster is a **genome** (plain
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

## Genomes, budgets and evolution

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

## Archetypes and brains (`brains/`)

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

**Elite mods** (`brains/elite.ts`): `EliteModDef`s with `Mod`s and a `behaviour` hook
(`ELITE_BEHAVIOURS`: `start`, `update`, `onHitTaken`, `onHitDealt`, `onDeath`,
`onAllyDeath`) that act through the body: hasted, vampiric, fire-enchanted, frost-aura,
teleporter, shielded, splitter, frenzied, berserker, juggernaut, vengeful, arcane-beams,
molten-trail, storm-caller, venomous, thorned, regenerating, volatile, necromancer,
mirror-image, ghostly, gravity-well, armoured, empowering, hexproof (`curse.immune`), hexer (curses
you with Enfeeble every 8 s). Conditional mods
(`when: 'shielded' | 'lowLife' | 'frenzy' | 'phased' | 'enraged'`) switch on with
`body.setCondition`.

## Bosses (`bosses/`)

A `BossDef` is a boss-rank genome plus three **phases** (life thresholds 100 / 66 / 33 %, each
with an attack rotation, a cadence, `onEnter` attacks and mods), a **signature** attack, an
**enrage** timer and an arena (radius, hazards the level places). Signature attacks are boss
modules (`BOSS_ATTACKS`): each plays a monster skill's clip and emits a
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

## Adding content

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

## Inspectors

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
`portrait()`, `capture()`, and `lineup(entries, { cols, zoom, clip })`: genomes, generate
options or `'boss:<n>'` in rows at the game's own camera (iso, the level zoom), to judge how
monsters read in play at 480×270 (then `capture()`). The `riftlight-monsters` e2e suite
drives it.
