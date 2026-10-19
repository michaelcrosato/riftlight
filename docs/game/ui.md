# UI (`src/riftlight/ui/`, `game/touch.ts`)

Panels, `UiEvent`s and `PanelHost`: docs/game/shell.md *Ports*.

## HUD layout (`ui/layout.ts`)

The fixed HUD (`hudZones`: orbs, bar, minimap, boss bar,
banner) reserves its rects each frame; world overlays are placed around them by priority with
`HudLayout.place`: the prompt, the focused loot label, the other labels (loud first, then
near), then damage numbers (which merge quick hits on one target and stack per target).
Whatever finds no room is skipped for that frame. The centre banner is a `BannerQueue`: the
level card, LEVEL CLEAR and level-ups show one at a time, a second level-up merges into the
one showing, a clear cuts a level-up short. Under 300 art pixels wide the HUD is compact
(`hudGeometry`): small orbs over a tight bar, a small minimap.

## On a touch screen (`game/touch.ts`)

The engine's touch buttons are the skill bar, laid out as
an action cluster: the joystick bottom-left; a big attack button in the bottom-right corner,
skills 1-4 on an arc around it, the dodge outside the arc and a contextual interact button
next to it (TALK, OPEN, TAKE, GO: only when F would do something); ≡ (the pause menu, where the
inventory, skills, tree and settings are) top-left. `TouchPad` drives them each frame from
`hero.skills()`: the gem's icon (`skills/icons.ts`), the cooldown shutter and seconds, the
mana cost, dimmed when it can't be paid. The HUD then draws no bar of its own and lays the
rest out around the controls' rects (`TouchPad.zones` → `hudGeometry(W, H, controls)`): each
orb takes the lowest free spot in its corner third (beside the joystick and the cluster on a
wide screen, above them in portrait), the XP bar runs between the orbs or sits over the life
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
