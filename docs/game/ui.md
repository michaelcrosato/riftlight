# UI (`src/riftlight/ui/`, `game/touch.ts`)

Panels, `UiEvent`s and `PanelHost`: docs/game/shell.md *Ports*.

## HUD layout (`ui/layout.ts`)

The fixed HUD (`hudZones`, named by `hudBoxes`: orbs, bar, minimap, gold, the top-left block, boss
bar, a moment's seconds left, banner) reserves its rects each frame; world overlays are placed around them by priority with
`HudLayout.place`: the prompt, a moment's way-out mark (`beacon`), the focused loot label, the
other labels (loud first, then near), then damage numbers (which merge quick hits on one target
and stack per target). Whatever finds no room is skipped for that frame. The centre banner is a
`BannerQueue`: the level card, LEVEL CLEAR and level-ups show one at a time, a second level-up
merges into the one showing, a clear cuts a level-up short. Its plate keeps beside the minimap
on a narrow wide screen, and its line under the title wraps (`bannerSub`: the normal font, else
the mini font, at most four rows) with the plate growing to hold it. A 52in1 moment's seconds
left (`HudModel.timeLeft`) go at the top centre, moved down under whatever they'd touch (the
label, the minimap and gold, a boss's bar, a touch control), and the banner goes under them.
Under 300 art pixels wide the HUD is compact (`hudGeometry`): small orbs over a tight bar, a
small minimap. The top-left block reserves every row it draws (where you are, the clock, the kills,
the tuning: a longer language's are wider). A boss's name and bar go at the top centre between the
minimap and its mirror on the left (`bossPlace`), and where the bar would be shorter than 100 there
(a phone in portrait, a window narrower than about 330) across the screen under the minimap, the
gold and the top-left block; the banner then goes under it. The level's map (`drawMap`, Tab / M / R3 / the touchpad's press, or a click or
tap on the corner minimap) fits what the hero explored into the room between the HUD's top and
bottom (`mapView`, up to 5 art pixels a cell; around the hero when it can't fit), on a
see-through plate under the HUD (ink on two pixel rows of every three, `PLATE_GAP`: it reads
over a bright level at ten feet; the corner minimap hides meanwhile), its title and the control
that closes it on its frame (Esc, or a tap on the map, closes it too).

## At ten feet (`ui/legend.ts`)

A TV at ten feet reads the normal 5×7 font (about 32 px tall at 1080p); the 3×5 mini font is for
digits on icons (costs, cooldowns, stacks, the orbs) and for a phone's compact layouts. The top
framed panel shows a **legend** under its frame for the device in use (`Panel.legend`, else
select and back; the layer keeps its rows free; the shell adds L1 R1 for the character screens):
✕ Select · ○ Back with a pad, Enter Select · Esc Back on the keyboard, none on a touch screen. An
overlay that says so has one too, where it says (`Panel.legendAt`): the item windows' under them,
else over them, slid along its row clear of the HUD (`UiLayer.avoid`: the shell's zones, weighted:
an orb, the bar or the minimap matter more than a passing banner or the top-left text), and where
nothing is clear over as little of it as it can; with L1 R1 Tabs in the stash and the vendor. Legends are the Riftlight shell's (`UiLayer.legends`):
another host of these panels (Engine World) keeps its own hints, and its menus `MENU_BINDINGS`
(L1 / R1 tabs: a reader's headings) where the shell's are `SHELL_MENU_BINDINGS`. The
**character sheet** is pages (Offence, Defence, Resistances: L2 / R2, ← →, Tab or a click), each a
short list with its sources in the normal font; a narrow sheet whose page names don't fit as tabs
turns them with a pager (‹ the page's name whole, a dot per page ›; a tap on either half). Oru's
respec tree is a tree view but no screen of the ring (`Panel.ring: false`): L1 R1 don't page away
from it and its bar names no screens. The **death recap** opens with what matters (who,
where, the killing blow, the damage taken and its biggest type, the tip, the cost); its tables
(damage by type, the worst enemies) are behind Details (△ / Tab, or the button). The HUD's clock,
kills and tuning, the loot window's counts, the codex's headings and the item windows' hints are in
the normal font. The pad's focus in the item windows frames the whole item, slot, socket or orb
under it (`ItemsUi.focusRect`: a two-pixel sand frame with an ink rim).

## On a touch screen (`game/touch.ts`)

On a phone Riftlight draws its art at two CSS pixels per art pixel at least (`touchDensity: 2`;
422×195 on an 844×390 landscape phone at DPR 2 or 3, 130×282 in portrait), so the HUD and the
panels lay out in about 195 rows in landscape. On a page with touch controls every panel gets a
thumb's height for what a finger presses (`UiLayer.tap` = `tapArt(renderer)`: 44 CSS px, 22 art
rows in landscape, 15 in portrait; `Panel.fit`'s third argument): menu rows, the character sheet's
tabs and rows, the codex's list, the loot window's and the death recap's buttons; the pause menu
lays its buttons out as two columns of tiles where one column would scroll (`MenuOptions.grid`: a
landscape phone), and the d-pad moves through the grid. A mouse's or a pad's screen keeps its
layout (`tap` 0). Hints name the device in use, never the screen's width: the tree's bottom bar
(`TreeViewOptions.device`: Drag pan · Pinch zoom · Tap twice: take · Hold refund on a touch
screen, its art at the game's density: `TreeViewOptions.touchDensity`) and the item windows'
(`windowHint` by `engine.controls.device`; the vendor window keeps the size of the taller hint,
so a tap lands where it was aimed whichever device the hint names). The Arena (`?game=arena`)
gets the same cluster (`ARENA_TOUCH_BUTTONS` in `combat/arena.ts`: no ≡ and no F).

The engine's touch buttons are the skill bar, laid out as
an action cluster: a floating joystick (`touchStick: 'floating'`: its base comes under the thumb
anywhere in the lower left; the HUD lays out around where it rests, and keeps what a finger taps,
the corner map, out of its zone); a big attack button in the bottom-right corner,
skills 1-4 on an arc around it, the dodge outside the arc and a contextual interact button
next to it (TALK, OPEN, TAKE, GO: only when F would do something); ≡ (the pause menu, where the
inventory, skills, tree and settings are) top-left. `TouchPad` drives them each frame from
`hero.skills()`: the gem's icon (`skills/icons.ts`), the cooldown shutter and seconds, the
mana cost, dimmed when it can't be paid. The HUD then draws no bar of its own and lays the
rest out around the controls' rects (`TouchPad.zones` → `hudGeometry(W, H, controls)`): each
orb takes the lowest free spot in its corner third, half the width on a landscape phone, never
under the minimap and the gold (beside the joystick and the cluster on the bottom row in landscape,
above them in portrait), the XP bar runs between the orbs or sits over the life
orb, the top-left text starts right of ≡, the prompt drops its key glyph. The controls hide on
the title, under every panel and when the hero is dead, and their rects are world-overlay
zones too. Riftlight ships without the engine's ⓘ P R ◐ ♪ bar (`touchBar: false`); `?debug=1`
brings it back. `__RIFTLIGHT__.ui.hud()` returns the HUD's rects and the controls (the phone
e2e checks that none overlap).

## Gem icons (`skills/icons.ts`)

Every gem has an 8 × 6 pixel icon, generated from its data:
actives draw their delivery's shape in their `look` colours, supports a glyph for what they
change (projectiles, chain, area, speed, crit, leech, minions...) in their element's colour.
The skill bar, the bags, the sockets and the vendor draw the same icon.

## Item icons (`ui/items/icons.ts`)

Every item but a gem (which draws its skill's icon, above) draws its class's icon (`drawIcon(look)`:
sword, axe, bow, staff, shield, helm, body, gloves, boots, ring, amulet, belt, orb...) from a few
rects that fill whatever box it gets: its cells in the bag (a 1 × 3 sword, a 2 × 4 bow, 10 px a
cell), a paper-doll slot, the vendor's shelf, the cursor. The magic part (edge, gem, trim) takes the
item's rarity colour. This is the one way an item is drawn: the engine's texture library has no
icons for Riftlight's item classes (a sprite at least 9 px wide can't fill the 7 px box of a
one-cell-wide item, and the bag, 12 cells in a 128 px window, has no room for bigger cells).

## The look studio (`ui/lookStudio.ts`)

Pause → **Look studio**, Settings → Look studio, or **L**: the engine's looks (docs/engine/looks.md
*Looks: filters per layer*) as menus. The pages dock against the right edge without dimming
the world (`UiLayer.open(…, { dock: 'right', dim: false, solo: true, peek })`), so every change
shows at once while the world is paused. **H** (or *Hide panel* on every page) hides the panel
altogether: the arrows still drive the focused control, a strip at the top names it and its
value ("GAME BOY DITHER 0.85 · H SHOWS"), and H, Esc or a tap brings the panel
back (`UiLayer.togglePeek`, `Panel.focusLine`).

- **Look**: a named look to start from: `default` (pixel art), `no filters` (nothing at all:
  full resolution, no pixel art, no outlines), the retro stacks, and mixes such as
  `pixel heroes`, `sin city`, `comic book`, `pop art`, `heat vision`, `ps1 horror` or `old photo`.
- **Apply to**: whole scene · characters (the hero, monsters, townsfolk, the cat, loot on the
  ground, chests and shrines: tagged with `setLookLayer`) · environment.
- **Pixel art**: on (preset `crisp` / `no lines` / `inked` / `chunky` / `blocky` / `mosaic`;
  pixel size, outline, creases) or off (clean, full resolution). For the whole scene it sets
  both layers.
- **Cel shading, Palettes, Colour grade, Consoles, Screen, Signal, Stylize**: a page per filter
  type, each filter on/off for the chosen part; an active one shows its preset and a slider per
  parameter, strength included. Filters that move pixels (CRT, chromatic, VHS, NTSC) are
  whole-scene only; a layer's page says so instead of offering them.
- **Clear** the part's filters, **Reset to default**.

Every change applies at once and is remembered: a named look as `settings.look`, anything else
as `settings.look = 'custom'` + `settings.customLook` (the Settings menu's Look picker lists
`custom` once there is one). Showcase modes and photo mode save the whole look and put it back.
