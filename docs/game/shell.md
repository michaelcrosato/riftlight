# Game shell (`src/riftlight/game/`)

The HUD, touch layout, gem icons and the look studio: docs/game/ui.md. The real ports' wiring:
docs/game/wire.md. The town: docs/game/town.md.

`Riftlight` (`src/riftlight/game/Riftlight.ts`) is the one `Game` the page runs at `/`. It owns
the flow, the town, the HUD and menus, saves, the difficulty sliders, the camera, music, the dev
tools and the agent API, and it reaches gameplay only through **ports** (`game/ports.ts`).
`new Riftlight()` runs the real systems (`src/riftlight/wire`, docs/game/wire.md); pass a port to
replace one:

```ts
new Riftlight();                         // the real hero, levels, monsters, loot and tree
new Riftlight({ monsters: myMonsters }); // the real game with one port replaced
```

## Flow

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
  the way to the aim point (max 1.6 m), screen shake from `services.shake`. A screen taller
  than wide zooms out (`CAMERA.portrait`, 0.8×) so the fight around the hero fits 124 art
  pixels, and with touch controls on screen the target slides toward the camera so the hero
  stands in the middle of the room left above them.
- **Music** (`game/audio.ts`, the engine's song format): title, town, level, a combat
  arrangement of the level loop that a combat-intensity meter swaps in with hysteresis, and a
  boss song near a boss. UI and game sounds are `rl.*` SFX data.

## Ports (`game/ports.ts`)

| port | real system | what the shell calls |
| --- | --- | --- |
| `HeroFactory` / `HeroPort` | combat/actors | `create(services, save.hero)`; `enter(stage, at, yaw)`, `fixedUpdate(dt, HeroIntent)`, `update`, `vitals()`, `skills()`, `buffs()`, `setLevel`, `setMods(source, mods)`, `setSkills?(save.hero.skills)`, `restore`, `emote` |
| `LevelPort` / `LevelHandle` | levels | `spec(depth, seed)`, `mechanics()`, `build(spec, deps)`; handle: `layout`, `origin`, `start`, `exit`, `exitOpen`, `progress()`, `boss()`, `explored()`, `telegraphs()`, `monsters()`, `spawn(seed, at, rank)` |
| `MonsterPort` / `MonsterHandle` | monsters | `genome(seed, depth, rank)`, `build(genome, {stage, at, depth, mods})`; handle: `actor`, `telegraph()`, `fixedUpdate(dt, {hero, enabled})` |
| `LootPort` | loot (`wire/loot.ts`, the default) | `rollDrops(kill, rng)`, `spawn`, `ground()`, `pickup`, `gearMods()`, `load/write(save)`, `give`, views: inventory, stash, vendor, crafting, skills |
| `TreePort` | tree (`wire/tree.ts`, the default) | `mods(allocated)` (the `tree` source), `points(level, deepest)`, `view(host, {respec})` |

Ports talk to each other through `GameEvents` (`hit`, `kill`, `death`, `gold`, `loot`,
`levelClear`, `mechanic`): the shell turns `hit` into damage numbers, the recap and shake;
`kill` into XP (`SCALING.monsterXp × RANK.xp × SCALING.xpPenalty`, less for a hero who has
outlevelled the area) and gem XP, streaks and stats; `mechanic` into codex
unlocks. Views are `Panel`s drawn on the pixel HUD (`ui/kit.ts` `UiCanvas`) that receive
`UiEvent`s (nav, confirm, back, tab, key, pointer, wheel) built from keys, mouse, touch and
pads alike; `PanelHost` gives them the save, gold, sounds and
`changed('tree' | 'gear' | 'gold' | 'stash' | 'skills')`. `ShellServices.hero()` is the hero's
actor (loot and the skill panel read its StatSheet). A panel may implement `fit(w, h)`: the
layer tells it the room there is before reading `size` (a phone in portrait is 124 art pixels
wide) and clamps every panel to the screen; menus then put labels above their controls and the
character sheet moves its explain column under the list. On a phone the codex is a list of
tall rows that opens one entry at a time (with a back row), the death recap stacks its columns
over a full-width button, and the loot window breaks its summary between parts, with tall rows
and stacked buttons: every tap target is at least 14 art pixels (42 CSS pixels at 3×). A panel's
close box takes presses around it too; the passive tree has one in its top bar.

## Saves (`game/save.ts`)

`localStorage` `riftlight:slot:<0..2>` holds `{ format: 'riftlight-save', version, slot,
savedAt, data: SaveData }`; `riftlight:meta` remembers the last slot (Continue). Every access is
in try/catch; blocked storage (or `?save=memory`) keeps saves in memory for the session.
`migrate()` upgrades older shapes step by step (v0 = pre-release saves) and fills missing fields;
a save from a newer build is refused, not mangled. Export / import is the same envelope as a
JSON file (Load / Import menu, or `__RIFTLIGHT__.exportSave()`). Autosave on town entry and
level clear. `SaveData` gained optional `codex` and `stats` (runs, clears, deaths, kills,
playtime, best time per depth); `positions` (grid cells of the bag and the stash) and the skill
sockets survive a load. Device settings (look, the look studio's custom look, quality, zoom,
damage numbers, loot filter, shake, prompt glyphs) live in `riftlight:settings`; volumes in the
engine's audio store, and the engine's own settings (pixel art, pixel size, frame rate, debug info:
Settings → Engine) in `pixel-engine:settings:riftlight`. The menus never read storage: they read `Riftlight.saves` (`SavesView`),
read from storage once at setup (and recorded: docs/game/actors.md *The hero's controls*) and kept by the game's own
saves, deletes and imports, so a replay shows the slots the recorded run saw.

## Agent API: `window.__RIFTLIGHT__`

Typed as `RiftlightApi` (`game/api.ts`), installed in `Riftlight.ready` (it exists once
`window.__PIXEL_READY__` resolves). Steps go through `Engine.step`, frame-exact.

| call | does |
| --- | --- |
| `state()` | screen, ui stack, depth, level time, cleared/exit/dead, hero (level, xp, gold, pools, position), monsters, loot, boss, difficulty, codex, session counters |
| `newRun({slot, seed})`, `continueRun(slot?)`, `toTown()`, `toTitle()`, `await enterDepth(n)` | flow |
| `step(n, intent?)`, `moveTo(x, z)`, `talkTo('vex')`, `interact()`, `press('Escape')` | drive the hero and the menus |
| `fight({skills})`, `collectGold()`, `pickupAll()`, `killAll()` | level helpers |
| `spawn({seed, x, z, rank})`, `give({xp, gold, items, levels})`, `setDifficulty({...})`, `dev` (god, ai, hitboxes) | dev tools |
| `hero(stat?, tags?)`, `actors()`, `loot()`, `log()` | inspect (`hero('damage')` returns `explain` sources) |
| `ui.stack()`, `ui.open(id)`, `ui.close()`, `ui.widgets()`, `ui.click(id)`, `ui.hud()` | menus as data; the fixed HUD's rects and the touch controls |
| `save(slot)`, `load(slot)`, `exportSave(slot)`, `importSave(slot, json)`, `slots()` | saves |
| `bot.run({maxFrames})`, `bot.start()`, `bot.advance(n)`, `bot.report()`, `bot.decide()`, `bot.town()` | the playtest bot (`town()`: its town visit) |
| `gems()`, `gearScore()` | socketed gems with level and XP; item power of what the hero wears |
| `arcade.*`, `bestiary.*`, `photo.*` | the showcase: the arcade cabinet, the Hall of Beasts, photo mode (docs/game/showcase.md *Agent API*) |

`?seed=123` makes new runs reproducible; `?save=memory` keeps tests out of localStorage. A run's
random stream (`services.rng`, forked again per level) is play's alone: screen shake,
damage-number drift and sound pitch draw from the shell's presentation stream (`fx`, forked from
the run's wherever that one starts, kept in a snapshot), so turning shake or damage numbers off
no longer moves play's stream: the same inputs roll the same drops (`game/presentation.test.ts`).
Shake and zoom still move the camera, and so what the mouse points at (`playSettings`). The
pause menu's **Dev** panel has the same tools (teleport to depth, give, god mode, kill all, spawn,
AI off, hitboxes, time of day).

## Headless (`riftlight/headless.ts`)

`headlessRiftlight({ seed?, viewport? })` boots the real game in Node with `Engine.headless`
(docs/engine/headless.md): the same options, the same `rl` as `window.__RIFTLIGHT__`, saves in
memory (`new SaveStore(null)`), models and packs from `public/`. It is the one way tests and
tools boot Riftlight in Node (`npm run replay` uses it for Riftlight's recordings).

```ts
const { engine, game, rl } = await headlessRiftlight({ seed: 4242 });
rl.newRun({ seed: 1 }); await rl.enterDepth(1); rl.bot.start(); rl.bot.advance(10800);
engine.input.send({ rl: 'tree', action: { kind: 'activate', id } }); engine.step(2); // as the tree's view sends it
```

Without a page the passive tree opens with no view and applies the actions it is sent
(`ui/tree/actions.ts`, shared with `TreeView`); the item windows keep their state and layout and
paint nothing; save export / import, photo captures and pointer lock do nothing. The labs take
their URL choices as options (`new LevelLab({ depth: 3 })`, `new Arena({ skills })`), kept in
`Game.args` so their recordings replay.

## The playtest bot (`game/bot.ts`, `npm run playtest`)

A scripted player that only uses the ports (it plays whatever implements them): it
steps out of telegraphs about to land on it by their shape (circles, lines, cones; it trades
blows with a plain swing while its life is good) and rolls, backs off and grabs health globes
when low, fights the nearest monster (the boss first when close) with the basic attack and the
skills that pay off, read from their tags (areas on 2+, novas on 3+, buffs for packs and bosses,
gap closers, ranged skills from a distance), swings only with a clear line (no wall corner in
between), gives up for a while on a monster it can't reach or can't hurt, walks to loot (not
for ever: a full bag or a drop out of reach is left), follows grid BFS routes that go cell by
cell after a corner stopped it, and walks into the portal once the level is clear. `npm run playtest -- 3 --runs 5 --film --gif` plays depth 3
five times and prints clear time, deaths, damage taken, kills, XP, gold, items and stuck events;
JSON, filmstrip PNG (scene + HUD) and GIF land in `.scratch/playtest/`. It plays headless
(`headlessRiftlight`: no server, no browser; with `--runs` each seed is a fresh game in its own
forked process, `--jobs` at once, one per core by default) unless `--film`, `--gif` or `--browser`
asks for Chromium, where the runs share one page (a new run starts from what setup left: the hero, the loot, the town, the id counters and the shell's run fields, so a seed plays there as it does alone; `Riftlight.startRun`, `game/runs.test.ts`); the campaign is one game, as a player's is. The e2e `tools` suite checks that depth 1 gives the same report both ways. Summoners (and
Necromancer elites) are fought before the adds they keep calling.

**In town** (`game/botTown.ts`, `bot.town()` in the agent API) the bot plays like a player:
`townVisit(save, { sheet, points, depth, visit })` works on the save through the loot, socket and
tree functions the windows use, judging every choice on a clone of the hero's StatSheet
(`evaluate`: log DPS of the bar, weighted by slot, with pack reach and mana sustain, plus log
effective life against the depth's hits). It sockets better skill gems of the same role and the
best fitting supports, equips upgrades slot by slot (level requirements, two hands, a melee main
skill keeps a melee weapon), sells everything left in the bag, buys gems (honed ones too) and gear
the vendors have that beat what it wears, gambles surplus gold on its weakest slots (`GAMBLING`:
at most 6 a visit, never below two gambles' worth of gold; it wears what beats its gear and sells
the rest), and spends its passive points with the greedy `TreePlanner` (`tree/planner.ts`,
shared with the balance sim). The campaign line shows the gold it spent and how many gambles.

**The campaign** (`npm run playtest -- campaign [--to 24] [--tries 3] [--difficulty hard]
[--film] [--resume save.json]`): one bot plays a fresh run from depth 1 through the designed
levels into the rifts, carrying its save: a town visit before every level, the level, and on a
death (the game's penalty) a farming run of the depth before, then another try; it stops at
`--to` or at a depth that beats it `--tries` times. Per depth it reports the clear time,
deaths (and who killed it), hero level, gem levels, gear score, DPS and effective life, gold and
the items found by rarity, as `.scratch/playtest/campaign.json` and `campaign.png`, and writes the
save after every depth (`campaign-save-NN.json`, for `--resume`). `--difficulty` takes a preset
or `enemyLife=1.5,playerDamage=0.8` and is applied like the Tuning panel (both modes). A
campaign to the wall (~depth 21) takes about 12 minutes; exit 1 when it does not clear the 12
designed levels.
