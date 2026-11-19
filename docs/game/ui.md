# UI (`src/riftlight/ui/`, `game/touch.ts`)

Panels, `UiEvent`s and `PanelHost`: docs/game/shell.md *Ports*.

## HUD layout (`ui/layout.ts`)

The fixed HUD (`hudZones`, named by `hudBoxes`: orbs, bar, minimap, gold, the top-left block, boss
bar, a moment's seconds left, banner, couch guests' strips) reserves its rects each frame; world overlays are placed around them by priority with
`HudLayout.place`: the prompt, a moment's way-out mark (`beacon`), the focused loot label, the
other labels (loud first, then near), then damage numbers (which merge quick hits on one target
and stack per target). Whatever finds no room is skipped for that frame. The centre banner is a
`BannerQueue`: the level card, LEVEL CLEAR and level-ups show one at a time, a second level-up
merges into the one showing, a clear cuts a level-up short. Its plate keeps beside the minimap
on a narrow wide screen, and its line under the title wraps (`bannerSub`: the normal font, else
the mini font, at most four rows) with the plate growing to hold it. A 52in1 moment's seconds
left (`HudModel.timeLeft`) go at the top centre, moved down under whatever they'd touch (the
label, the minimap and gold, a boss's bar, a touch control), and the banner goes under them.
Under 300 art pixels wide the HUD is compact (`hudGeometry`): small orbs over a tight bar (each
slot's button glyph where it fits the slot: a pad's always), a small minimap. The top-left block reserves every row it draws (where you are, the clock, the kills,
the tuning: a longer language's are wider). A boss's name and bar go at the top centre between the
minimap and its mirror on the left (`bossPlace`), and where the bar would be shorter than 100 there
(a phone in portrait, a window narrower than about 330) across the screen under the minimap, the
gold and the top-left block; the banner then goes under it. Couch guests' strips (`guestsRect`)
go under the top-left block, under a boss's bar that runs across the screen (it stays put as guests
come and go), and side by side, two or three a row, where a column of them would run into the rest
of the HUD (a landscape phone's 195 rows: the stick and the life orb under them); where none of
that is clear (a short landscape phone, 360 to 412 CSS px tall, with the tuning's rows in the
top-left block) beside the top-left block under a boss's bar at the top, else under the minimap and
gold; with no clear spot at all, the one covering the least of the fixed HUD, never an orb. Of the
clear spots they take the first out of the rows the heroes stood in as they were placed
(`HudModel.heroes`, the same boxes as the banner's: the shell takes them again only when a stage
opens, a guest's hero comes or goes or the screen's size changes, so the strips stay put all level): on a short landscape
phone with the tuning's rows, beside the top-left block at the top, not two side by side under it
across the middle, over the heroes. With no clear spot out of their rows, the one over the least of
the heroes, beside the top-left block ahead of a row of strips across the screen's middle. The
banner never covers the strips, a touch control, the skill bar, an orb, the XP bar, the minimap, a
boss's bar or a moment's seconds left (nor, held sideways, the gold, wherever that leaves it room):
where its plate would, it moves aside in its row (narrower if
it must, never narrower than its title: drawn centred on the plate), else up above what it hit,
under the top-left block or under the strips, the spot covering least of the rest (on a phone held
sideways the action cluster reaches up the right side). It keeps off the heroes as they stood
when it opened (`Banner.heroes`: feet to head, to the seat tags with guests, a quarter of that
around; taken the first frame the camera is on player 1, and it shows from then, so it never jumps
as they move): where its place would cover them or the rows they stand in, it moves aside of them in
its row (the row under the strips first, else the screen's top, under ≡ or just above them), a hero
weighing more than the top-left block it may cover then (`HERO_COVER`, `BAND_COVER`: on a short
landscape phone with three guests and the tuning's rows it covers the block's last rows, not the
heroes); under them only where no place up there is clear. The 'under the minimap' place is for a
phone held upright only (a 568×320 phone's compact HUD keeps it at the top, beside the minimap).
A kill streak goes right of the strips. The level's map (`drawMap`, Tab / M / R3 / the touchpad's press, or a click or
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
nothing is clear over as little of it as it can; with L1 R1 Tabs in the stash and the vendor. The title's
bare menu asks for one (`OpenOptions.legend`: ✕ Select under its tiles). Engine World's layer draws
them too (`UiLayer.legends`), for its `MENU_BINDINGS` (a reader's L1 R1, or Shift+Tab Tab: Headings) where the
shell's are `SHELL_MENU_BINDINGS`. The
**character sheet** is pages (Offence, Defence, Resistances: L2 / R2, ← →, Tab or a click), each a
short list with its sources in the normal font; a narrow sheet whose page names don't fit as tabs
turns them with a pager (‹ the page's name whole, a dot per page ›; a tap on either half). Oru's
respec tree is a tree view but no screen of the ring (`Panel.ring: false`): L1 R1 don't page away
from it and its bar names no screens. The **death recap** opens with what matters (who,
where, the killing blow, the damage taken and its biggest type, the tip, the cost); its tables
(damage by type, the worst enemies) are behind Details (△ / Tab, or the button). The HUD's clock,
kills and tuning, the loot window's counts, the codex's headings and the item windows' hints are in
the normal font, as are the skill panel's rows (names and costs: `ItemsUi.tenFoot`, the panel wider
for them, `SKILLS_WIDE_W`; the mini font only on a narrow screen or a page with touch controls). A menu's footer (or the focused row's hint) longer than the menu wraps whole onto up to three rows, the menu keeping room for its longest (`Menu.footLines`): the normal font on a TV or a desktop, the mini font on a phone's layout (a bare menu's runs wider: `MenuOptions.footWidth`, the title's under the logo). Those rows never make a menu scroll: one whose rows fit over one footer row takes only the room they leave, the footer wrapped into it (the mini font where the normal can't hold it whole) or cut there (the settings at 1280×720); a list that scrolls anyway gives its longest the rows it needs, up to three (the look studio's French hints whole at 1920×1080), in the normal font narrower, clear of the arrow that says there is more below (World's room list). The showcase's hint rows are in the normal font there too, on an ink plate (`hintFont`, `drawHints`). The
pad's focus in the item windows frames the whole item, slot, socket or orb under it
(`ItemsUi.focusRect`: a double white frame, ink between its lines, `FOCUS`; its shape sets it
apart, as no item's frame is double, though a rare's is sand and some skill gems' white), there as
they open with the pad in use; a window that gains focus takes it (`padInto`: it opens, L1 R1 page
to it, Tab or the Gems button shows it, the one it was in closes), so no other window keeps a focus
mark or its tooltip. A tooltip beside a window keeps off the title bar of the other one it lies
over where it fits below it (`tipRect`: a gem's beside the wide skill panel, clear of the bag's
name and Gems button); one taller than the screen (a vendor's rare at 1280×720) shows what fits with
a scroll bar, scrolled by the right stick or the wheel over its item (`cursorTip`, recorded `look`
and `wheel`; from its top each time it shows). Their hints follow the device in use.

## On a touch screen (`game/touch.ts`)

On a phone Riftlight draws its art at two CSS pixels per art pixel at least (`touchDensity: 2`;
422×195 on an 844×390 landscape phone at DPR 2 or 3, 130×282 in portrait), so the HUD and the
panels lay out in about 195 rows in landscape. On a page with touch controls every panel gets a
thumb's height for what a finger presses (`UiLayer.tap` = `tapArt(renderer)`: 44 CSS px, 22 art
rows in landscape, 15 in portrait; `Panel.fit`'s third argument): menu rows, the character sheet's
tabs and rows, the codex's list, the loot window's and the death recap's buttons. A menu never
hides an entry it could show (`Menu.plan`): where its thumb-tall rows would scroll, the title and
pause menus lay their buttons out as two columns of tiles (`MenuOptions.grid`: a landscape phone,
the tiles narrower than the menu on a small one, 284×160, while each holds the widest label; the
d-pad moves through the grid, passing over a disabled tile), and any menu shrinks its rows to
its room when that keeps them all in view (the save slots, the tuning, the rift keeper's depths on
a landscape phone); one that scrolls even so (the settings, the languages) keeps its thumb-tall
rows and shows a scroll bar beside them. On a 360 px phone (120 art columns) nothing is cut: a
narrow menu's button too narrow for its label takes two rows (`UiCanvas.button` wraps a label in a
button two rows tall: the slots, Engine World's room list), and the narrow character sheet wraps a
long stat label and breaks its header between its parts (Level 7 / deepest 12: `wrapParts`, as the
showcase's hint rows). The phone's codex opens an entry as the finger lifts on its row
(never on the press), so a swipe from the list closes the codex. A mouse's or a pad's screen
keeps its layout (`tap` 0), whatever device was used last. Hints name the device in use, never the screen's width: the tree's
bottom bar (`TreeViewOptions.device`: Drag pan · Pinch zoom · Tap twice: take · Hold refund on a
touch screen, its art at the game's density: `TreeViewOptions.touchDensity`; `/tree.html` names a
finger's gestures on a coarse pointer before the first touch) and the item windows' (`windowHint`
by `engine.controls.device`; on a page with touch controls the vendor window keeps the size of
the taller of a finger's and the mouse's hint, so a tap lands where it was aimed whichever device
the hint names, while a desktop's holds the taller of the mouse's and the keys'). The Arena
(`?game=arena`) gets the same cluster (`ARENA_TOUCH_BUTTONS` in `combat/arena.ts`: no ≡ and no F).

The engine's touch buttons are the skill bar, laid out as
an action cluster: a floating joystick (`touchStick: 'floating'`: its base comes under the thumb
anywhere in the lower left; the HUD lays out around where it rests, and keeps what a finger taps,
the corner map, out of its zone); a big attack button in the bottom-right corner,
skills 1-4 on an arc around it, the dodge outside the arc and a contextual interact button
next to it (TALK, OPEN, TAKE, GO: only when F would do something); ≡ (the pause menu, where the
inventory, skills, tree and settings are) top-left. In 52in1 (the page's `window.AIHubSettings`,
which the hub's companion script sets before the game's first script: `RIFTLIGHT_OPTIONS` reads it,
and `TouchPad.buttons` by `TouchPad.hub`, from `engine.hubSettings.present`, recorded) ≡ sits lower, its top on the hub's wake band
(`HUB_WAKE`, 90 CSS px: a touch above it brings the hub's bar over the game), its centre 112 CSS px
down (`RIFTLIGHT_HUB_TOUCH_BUTTONS`); in a 52in1 round it is hidden (`TouchFrame.round`: a round has
no pause menu, the hub's bar is the menu there). The corner map, a tap target, goes below the band
there too (`TouchPad.wakeArt`, `HudModel.wake`) where it and the gold stay clear of the controls (a
phone upright); on its side it stays at the top and only its part below the band takes a tap. `TouchPad` drives them each frame from
`hero.skills()`: the gem's icon (`skills/icons.ts`), the cooldown shutter and seconds, the
mana cost, dimmed when it can't be paid. The HUD then draws no bar of its own and lays the
rest out around the controls' rects (`TouchPad.zones` → `hudGeometry(W, H, controls)`): each
orb takes the lowest free spot in its corner third, half the width on a landscape phone, never
under the minimap and the gold (beside the joystick and the cluster on the bottom row in landscape,
above them in portrait), the XP bar runs between the orbs or sits over the life
orb, the top-left text starts right of ≡ (any control in the top-left third: ≡ lower down in
52in1 too), the prompt drops its key glyph. The controls hide on
the title, under every panel and when the hero is dead, and their rects are world-overlay
zones too. Without a page (headless, a replay of a phone's recording) `TouchPad.zones` gives
where the page's controls would be on a page with touch controls while a finger is the device in
use (`touchLayout` in the recorded viewport, a hidden button keeping its place as on the page,
mapped to art pixels with the page's arithmetic: `TouchPad.dataLayout`, all of it recorded), so a
replay lays the HUD out, and its taps land, as the phone's; the phone e2e holds the two to the same
art pixels, the floating stick's zone too, at DPR 2 and 3. Whether ≡ was in 52in1's place is
recorded too (`TouchPad.hub`: the setup's `{ rl: 'touch', hub }` command, and save-states), so a
52in1 phone's session replays in Node, with no hub behind it, around the controls the player had
(`touchLayout.headless.test.ts`). One gap: a notched phone keeps its
controls inside the safe area (`env(safe-area-inset-*)` past the margins), which a recording does
not keep, so a replay of such a phone's session without its page lays the HUD out around controls
a few pixels off where the player saw them. What the last frame drew that a tap hits (the loot
labels, the prompt, the feed, the talk line) and the controls the HUD laid out around are in a
snapshot (`shell.touchable`, `shell.hudControls`, and a finger's wait to swing, `shell.fingerHeld`),
so a replay from a save-state taps the same.

**Swipes** (recorded presses, where they started: `Pointer.touchDown`, from the recorded touches):
a swipe left, right or down that starts on a panel's frame closes it as back does (`UiLayer.swipe`;
never a sticky one; a list that scrolls keeps up and down for itself and a slider its sideways
swipe, `Panel.swipes`, though its title bar always closes it); one that starts on an NPC's line
ends the talk, and a tap on it puts it away; with no panel, one from the centre banner ends it (`BannerQueue.skip`,
not in a 52in1 round) and one from the loot feed's lines clears them (a finger that lands on either
is no swing for as long as it stays down and wherever it slides: `pressTaken`).
The item windows close on a swipe down, left or right from a window's title bar, as every framed
panel does (`Panel.swipeCloses`: elsewhere a quick drag moves an item; never from a picked item's
tooltip over the bar), the passive tree on a finger pulled down from its top bar (its own
canvas: sent as the × is). A finger acts on a menu as it lets go where it went down, so a swipe
across a button presses nothing. **Taps**: a tap on a loot label picks the item up (walking there,
`goTo`) and a tap on the interact prompt does what F does; neither is a swing, held or not, and
whether or not a fixed step runs in the frame it lands in (a 90 or 120 Hz screen). The prompt keeps out
of the floating stick's zone (`TouchPad.stickZone`: beside it on a wide screen, over it in
portrait). On a landscape phone the loot feed ends over the mana orb's right edge (the cluster is
right of it). **The item windows** show no hidden gestures: a tap picks an item (its tooltip) and,
under it, a row of buttons a thumb can hit for what it can do there (`touchActions`: Equip,
Unequip, Use, Socket, Take out, To bag, To stash, Buy, Sell, Move; in rows on a narrow screen);
the row never covers the tooltip (`pickLayout`: under it, else over it, else at the top of the
screen with the tooltip moved down under it, its name in view) nor a window's title bar (its close
box, the Gems button: the row slides beside it along its line, else goes under it with the tooltip
under the row); a tooltip taller than the screen (a rare's on a 360×800 or a 740×360 phone) shows
what fits with a scroll bar at its edge, and a finger's drag on it scrolls it to its last lines
(the comparison with the gear: `tipScroll`, no tap where the drag ends nor a long-press while it
rests there). A second tap and a long-press still work. A 740×360 phone held sideways has 180
rows, fewer than the inventory's 182: there its gaps close up (`INV_SHORT_H`, 172 rows). **Assists**
(`Riftlight.touchAssist`, a finger on a page with touch controls only: the recorded `input.device`
and density, each a setting shown on such a page, where it applies, and on by default, kept by
recordings as play settings; a touch on a desktop's page, a touchscreen laptop's, gets none): auto attack (`touchAutoAttack`: the basic attack on the
nearest living monster in its reach, `attackReach`, the playtest bot's rule, when no skill or dodge
was pressed, the hero isn't busy or walking somewhere and the stick doesn't point away from it, so
kiting works) and aim assist (`touchAimAssist`: with the stick pushed, the nearest monster within
7 m in a 40° cone of it, else one point-blank within 2.5 m, else along the stick: `TOUCH_AIM`). The
pad, the keyboard and the mouse play as they did. Two fingers on the world pinch the zoom and are
no swing: a finger alone on the world swings once it has stayed down two fixed steps after the one
it landed in (`FINGER_WAIT`, about 33 ms; a tap shorter than that is no swing), and a second
finger landing by then lets go of its press (`Input`; landing in the same frame, its press is taken
back), so fingers a frame or two apart pinch without a swing; the mouse's button swings at once. The
floating stick and the buttons take several fingers at once. A finger that slides sideways off a
menu row is a swipe, not a tap; a mouse's click that drifts sideways still clicks. Riftlight ships without the engine's ⓘ P R ◐ ♪ bar (`touchBar: false`); `?debug=1`
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
