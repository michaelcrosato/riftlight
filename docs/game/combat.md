# Combat & skills (`src/riftlight/combat/`, `skills/`, `actors/`)

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

## Stats the pipeline reads

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

## Build systems: charges, curses, totems, traps, auras

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

## Add a skill

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

## Add a support

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

## Add a damage type

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

## Add an ailment

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

## Inspect it

- `npm run combat -- dps <skill> [support[@level] …] [--level n] [--stats build.json] [--vs armour=500,res=0.4] [--targets 3] [--json]`:
  resolved skill, hit breakdown per type, crits, ailments and their DoT, hits/s, DPS on one and
  on N targets, mana/s; written to `.scratch/combat/<skill>.json`.
- `npm run combat -- list` / `supports <skill>`: every gem with its tags, and what fits.
- `npm run film -- arena-combo arena-cancel arena-dodge arena-skills arena-run-cast arena-whirlwind`:
  the hero in the real game; `/?game=arena&skills=meteor,arc+chain,blink` for a custom bar.
