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
- **On a controller** (`game/controls.ts`): Options pauses from any screen of play (over an item
  window, the character sheet, the codex or a townsperson's menu it closes them first) and resumes
  from the pause menu, as Circle does; Esc stays back first, then pause. The pause menu reaches
  every screen a pad has no button for (inventory, skills, tree, character, codex); Dev shows only
  with the developer tools on (the dev server, `?debug=1`). Tab / M / R3 / the DualSense's
  touchpad press open the level's map over the play (`drawMap`: the world runs on under it; in a
  session round too).
  Shift+Tab is the tab before in the item windows. The character screens are one ring (`PAGES`:
  inventory, skills, tree, character, codex): L1 / R1 or Q / E page through it in place (a pause
  menu under them stays), and so does a swipe left or right on a DualSense's touchpad through 52in1
  (`input.touchpad`: its gestures are recorded input; the legend, the strip and the tree's bar draw
  the swipes beside L1 / R1 while 52in1 lets the game read the touchpad and the DualSense is not a
  couch guest's, `touchpadSwipes`; outside 52in1, or with its touchpad off, only the press reaches
  the game, as the map), a strip across the
  top names them (each a button for the mouse; the
  tree's view covers the screen, so its own bottom bar names them: the shell passes the TreeView
  `pages`, and it leaves Q / E to the game instead of zooming with them); in the
  stash, the vendor and the bench they (and the swipes, drawn in their legend) are those windows'
  tabs, as are Tab and L2 / R2 everywhere.
- **The mouse in the world** (the ARPG way): a townsperson, the stash, a showcase piece, a loot
  label or the open portal under the mouse shows what a click does there (`thingLabel`, the mouse's
  glyph and the prompt, under the thing near the top of the screen); a click does it in reach, else
  the hero walks there the way `moveTo` does (`game/walk.ts` `HeroWalk`: the town's walkable grid,
  a level's grid route, round whatever is in the way) and does it on arrival by the F rule (the
  townsperson it went to is the one in reach: `Town.nearest`), giving up when the player moves,
  attacks or opens a panel, or when it gets no closer for 4 s (`goTo`, `walkTo`: a snapshot keeps a
  walk in progress); the press is not a swing. A pad keeps the proximity prompts.
- **What the controller says back** (`game/padFeel.ts`, outputs only: nothing headless, in a
  replay or off the pad): `RUMBLE` pulses on a hit taken (by its share of life), a crit dealt, a
  level-up (two pulses), a rare or loud item landing in view, the portal opening and the hero's
  death, never in menus (`input.rumble`, scaled by the player's vibration and the hub's). The
  DualSense's light bar (`lightFor`, sent only when it changes) is the town's orange, the hero's life
  in a level (green, amber, then red pulsing under a quarter), steady red in a boss fight, plum when
  dead, and the hub's own on the title and in a showcase mode. The portal and a loud drop's chime
  play on the `speaker` bus (the controller's speaker while the player allows it). The adaptive
  triggers are left alone: no skill sits on L2 or R2 (R2 interacts).
- **Music** (`game/audio.ts`, the engine's song format): title, town, level, a combat
  arrangement of the level loop that a combat-intensity meter swaps in with hysteresis, and a
  boss song near a boss. UI and game sounds are `rl.*` SFX data.

## Couch co-op (`game/coop.ts`)

Same-screen co-op for two to four players on one device (`LocalCoop`, on the engine's per-pad
input: docs/engine/couch.md). Player 1 plays as always, on the keyboard and mouse or a pad; every
other player has a pad of their own (`input.player(slot)`, which never drives player 1).

- **Joining**: Cross on another pad (`KEYS.join`, `input.joinWith`, decided each frame by
  `joinPolicy`): in the pause menu's **Couch co-op** (`coopMenu`: the seats, a Leave button per
  guest, *Press ✕ on another controller to join*), any pad but player 1's in use; in town, while
  player 1 plays on a pad, any other pad, and the town says so (`joinHint`, `joinLine`: at the top
  centre while that is clear of the HUD, else above the bottom HUD and any prompt, a phone held
  upright; wrapped and placed through the HUD's layout, over no other text). Player 1 on the
  keyboard picking a pad up in town joins nobody (the menu is the way then). Couch co-op is not
  offered in a 52in1 round (its players are the hub's) nor in the showcase (`couchOffered`: no
  pause entry, no town line, nobody joins). A guest takes the first free seat, 2 to 4, in 52in1's
  seat colours (`HUB_COLORS`): a ring at its feet, its tag (`hud.coop.seat`, P2) over its head and
  a compact strip under the top-left block (`GuestStrip`: its life, its four skills' readiness, the
  seconds until it rises; beside a phone's minimap it narrows to the gap, or goes under the minimap
  and gold; under a boss's bar across the screen; two or three a row where a column would run into
  the HUD below, a landscape phone's; out of the heroes' rows where the HUD leaves room: docs/game/ui.md *HUD layout*). While guests play, player 1 has seat 1's ring and a P1 tag too. **Leave** in the same
  menu sends it home; its pad plays player 1 again. The title sends every guest home.
- **A guest is a teammate**, as a shared world's host makes one (`teammate`): player 1's level,
  skills, tree, gear (and difficulty), refitted at every stage entry (`fitGuest`), a fighter in the
  level's combat world (monsters chase the nearest hero), with no save, inventory or loot of its
  own: what it kills is player 1's XP, gold and loot. It reads its pad by player 1's rules
  (`guestIntent`: `readActions` for the attack, skills and dodge; the right stick's aim with
  `AIM.assist`, else `autoAim` along the move), enters each stage beside player 1 (`besideSpot`:
  seat 2 to the right, 3 to the left, 4 `COOP.below` (3.2 m) below, so that no hero's body or tag
  covers another's on screen),
  is put beside player 1 when it strays past `COOP.leash` (12 m) or past `COOP.edge` (0.95) of the
  screen as the camera shows it, its feet or its head (a phone held upright shows less across than
  the leash: there a guest walking sideways comes back at about 9 m, never off screen), and rises
  beside player 1 `COOP.rise` (5) s after it falls. Player 1's death is the run's, as always (the
  recap, then town with everyone). Monsters stay as they are for one player: balance is not part of this.
- **The camera** follows the group's centre (`coop.centre`, no aim lead) and zooms out as it
  spreads, down to `COOP.zoomOut` of its zoom (`coop.zoom`): every hero standing projected into the
  view (`CoopHost.view`: the camera's screen axes, the picture's aspect), the zoom that keeps them
  within `COOP.spread` (0.7) of the way to its edge, so it zooms out by how far across the screen they
  are, sooner on a phone held upright (`game/coop.view.test.ts` walks a guest away at 390×844).
- **Replays and save-states**: the guests' pads and their joins are recorded input, so a couch
  session replays to the same fingerprint (which holds the guests: `coop.view`); a save-state is
  refused while a guest plays (it holds player 1's hero alone; a restore sends guests home): replay
  the recording instead. Where a guest about to leave the screen is put depends on the viewport
  (`COOP.edge`, the camera's zoom: a phone held upright shows less across), as the HUD's layout and
  pointer aim do: a recording keeps the viewport the level began with (`Recording.view`) and a
  headless replay frames for it, but a page resized or turned mid-level is not followed, so from
  there a replay can put a guest elsewhere (docs/engine/headless.md). `rl.state().coop` lists the guests. Tested headless in
  `game/coop.test.ts` (a two-pad clear of depth 1 and its replay) and in a page at 1920×1080 by
  the riftlight e2e suite (`runRiftlightCouch`).

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
JSON file (Load / Import menu with the keyboard and mouse outside 52in1, `slotFiles`; or
`__RIFTLIGHT__.exportSave()`). Autosave on town entry and
level clear. `SaveData` gained optional `codex` and `stats` (runs, clears, deaths, kills,
playtime, best time per depth); `positions` (grid cells of the bag and the stash) and the skill
sockets survive a load. Device settings (look, the look studio's custom look, quality, zoom,
damage numbers, loot filter, shake) live in `riftlight:settings`; volumes in the engine's audio
store (`pixel-engine:audio:riftlight`: every key has the game's name in it, as 52in1's shared
storage asks), and the engine's own settings (the controller's button prompts and vibration, and motion aim
and its sensitivity while 52in1 lets games read a DualSense's motion: Settings → Controller, so the
Settings list fits a 1920×1080 screen with them; pixel art, pixel size, frame rate, debug info:
Settings → Engine) in
`pixel-engine:settings:riftlight`. Prompts follow the input used last (`engine.controls.device`: a
touch names the keys while no touch controls show) by themselves, the HUD's glyphs as the lines'
`{key:action}`: there is no setting for which device they show. The menus never read storage: they read `Riftlight.saves` (`SavesView`),
read from storage once at setup (and recorded: docs/game/actors.md *The hero's controls*) and kept by the game's own
saves, deletes and imports, so a replay shows the slots the recorded run saw.

## Agent API: `window.__RIFTLIGHT__`

Typed as `RiftlightApi` (`game/api.ts`), installed in `Riftlight.ready` (it exists once
`window.__PIXEL_READY__` resolves). Steps go through `Engine.step`, frame-exact. What `step(n,
intent)`, `moveTo`, `fight` and the bot hold reaches the game as recorded input, never a write to
it: the intent as `{ rl: 'intent' }`, for the frame it arrives in only, and what the bot does
besides (a panel closed, home after a death or through the portal) as `{ rl: 'bot' }`
(`Riftlight.agentInput`, taken once a frame before its first fixed step: `frameInput`). So a bot run is in the
recording: restore a snapshot to start one (`engine.restore(await engine.snapshot())`) and it
replays, `npm run replay` included, to the same fingerprint, then plays on as the live game would
(`game/botReplay.test.ts`). Calls that change the game between frames are not input, so a replay
can't redo them, such as `newRun`, `continueRun`, `enterDepth`, `toTown`, `toTitle`, `talkTo`,
`interact`, `pickupAll`, `ui.open` / `close` / `click`, `bot.town` (it works on the save), the
saves, `give`, `spawn`, `killAll`, `setDifficulty`, `dev.*` and the showcase's. Record from after them, or use `step(1, { interact: true })` and `press(key)`,
which are input.

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
Shake and zoom still move the camera, and so what the mouse points at (`playSettings`). With the
developer tools on (`?debug=1` or the dev server: `Riftlight.devTools`) the pause menu's **Dev**
panel has the same tools (teleport to depth, give, god mode, kill all, spawn, AI off, hitboxes,
time of day); otherwise it is not on the menu, and `rl.ui.open('dev')` or the calls above reach them.

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

`headlessMoment(moment, { seed?, store? })` is a 52in1 moment's one copy against the hub in memory
(engine `LocalHub`), loaded and ready; `playMoment(r, 'decent' | 'idle')` starts it and plays it
until the hub has the result (docs/game/session.md, *Moments*).

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
