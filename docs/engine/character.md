# Characters: the moveset

`PlatformerCharacter` (`src/engine/character/`) is a Mario-64-style controller (and then
some) on Rapier's kinematic character controller. The hero model and rig (`scripts/assets/hero.mjs`:
geometry and joints only: elbows/knees, a pelvis root, a springy cap) is animated by clips written as
data (`HERO_CLIPS`, `src/game/hero/clips/`, docs/ANIMATION.md).
`readMoveInput(ctx, hero, out?)` maps the default keys and pad buttons (`KEYMAP`: the engine's `Pad*`
codes beside each key, PlayStation names first), camera-relative for every preset; pass a
`MoveInput` you keep as `out` and it is filled in place (no garbage per step). Options / Menu is left
free for the game's pause, and R2 / RT, R3 and the touchpad for the game's own (an interact, a fire).

| Key · pad | Action |
| --- | --- |
| WASD / arrows · left stick / d-pad | tiptoe → walk → run (speed follows the stick's tilt; Mario-style turning; reverse at speed = **skid**, then a hop round = **skid turn**) |
| Shift · L2 (LT) | walk / tiptoe |
| Space · Cross (A) | jump · again on landing = **double**, then **triple** (front flip; a press up to 0.12 s before touchdown counts) · while skidding = **side flip** · **wall kick** off walls (also from a **wall slide**) |
| C / Ctrl (hold) · Circle (B) | **crouch**, crouch-walk · while running = **crouch slide** · + Space = **backflip** · running + C + Space = **long jump** · in the air (press) = **ground pound** |
| Z · L1 (LB) | **prone** / crawl (fits 0.75-high gaps); again to **get up** (only with headroom) |
| X · R1 (RB) | **lie down** on the back (dozes off: **sleep**); again to **get up**. Idle 16 s = lies down by itself |
| F (hold) · Triangle (Y) | **grab** a block, then pull (move away) or push (move toward) |
| J · Square (X) | **punch → punch → kick** combo · + C = **sweep kick** · in the air: **dive** (moving) or **jump kick** |
| V / B · Create (View) / L3 | **wave** / **sit** (sits down; B, Space or the stick stands up again) |

**Touch (phones/tablets):** shown automatically on coarse pointers (or `?touch=1`):
joystick bottom-left, buttons **A** jump · **B** attack · **C** crouch · **G** grab · **Z** prone ·
**X** lie down; drag on the game to orbit/look, pinch to zoom; ⚙ the settings; with the hotkeys
on (`?debug=1`) a top bar: ⓘ debug panel, **P** Pixel/Raw, **R** resolution, **◐** cycle looks,
**♪** mute (`TouchControls`, `input.analog`; the buttons are `EngineOptions.touchButtons`).
Landscape works best.

A game lays out and drives its own buttons (Riftlight's action cluster, `src/riftlight/game/touch.ts`):

- **Placement**: a `TouchButton` with `at: { x, y, size, corner }` is placed by its centre, in CSS
  pixels from a screen corner (default bottom-right, inside the safe area), instead of in the
  grid; tap targets keep their size whatever the art scale is. The first button is the accent one.
- **State** each frame: `engine.touch.set(code, { icon, label, hint, cooldown, timer, badge,
  disabled, hidden })`: an icon canvas (drawn pixelated) instead of the label, a cooldown shutter
  (0..1) with its seconds, a corner badge (a cost), dimmed when it can't be used, hidden (its
  place is kept). Only what changed touches the DOM.
- `engine.touch.show(false)` hides the stick and the buttons while a menu owns the screen (held
  keys and the stick are released); `engine.touch.rects()` gives their client rects (with
  `hidden` flags) so a HUD can lay itself out around them.
- The top bar is for development: `touchBar: false` keeps it off a shipped game, and it then
  shows only with the debug UI (`?debug=1`, dev builds).

**Touch is an add-on.** The touch controls (`engine.touch`, `TouchControls`) step aside when the
player picks up a pad or a keyboard (`input.device` turns `pad` or `keyboard`: the engine calls
`touch.follow` every frame, and `touch.deviceHidden` says so), so the game looks like the pad or
keyboard game, and the next touch brings them back; only a change of device moves them (a page that
starts on the keyboard keeps the controls `?touch=1` asked for). The device is recorded, so a
replay shows and hides them as the player saw. A HUD laid out around the controls
(`touch.rects()`) takes the pad or keyboard layout while `touch.deviceHidden` (its own skill bar,
not the touch buttons' places), and the touch layout again when they come back; typing on a
phone's soft keyboard (a text field) is not picking up a keyboard, so they stay.

`touchStick: 'floating'`: a thumb anywhere in the lower left (`.stick-zone`, about 45% of the
width, the lower 60% in portrait and 75% in landscape; the placed buttons stay on top of it) brings
the joystick's base under it, still writing `input.analog` (`touch.rects().zone`). The zone takes
every touch that lands in it: a camera drag, a swipe or a tap on the canvas there moves the stick
instead. Keep the game's tappable HUD and its swipe areas out of `rects().zone` (lay them out
around it, as around the buttons), or keep the stick `fixed`. `rects().stick` is where a floating
stick rests, also while a thumb holds it elsewhere, so a HUD laid out around it stays put.

`touchDensity` (default 0, `DEFAULT_TOUCH_DENSITY`: the art size the viewport gives): a game opts
in, `touchDensity: 2`, once its HUD fits a landscape phone's 181 to 195 rows. Then on a phone (the
viewport's short side under 500 CSS px, `PHONE_SHORT_SIDE`) on a page with touch controls the art
has at least that many CSS pixels per art pixel, in both orientations and again at every rotation
(`touchScale`, `computeFraming`'s `minScale`, under `fill`): a landscape phone (844×390) at DPR 2 or 3
draws 422×195 instead of 563×260 at DPR 2 (633×293 at DPR 3), so text and targets are thumb-sized; the world in view (the camera's
view height, the field of view) is the same. It holds while the controls step aside for a pad or
the keyboard too: the art size never changes with the device in use. Headless it follows
`touch: true`, as a page with touch controls; a recording keeps it (`Recording.density`).

Automatic moves: **step up / step down** (autostep 0.4; Rapier's autostep alone misses a
riser met at speed, so `riseAhead` lifts the body onto a flat step found just ahead and holds
it there while it crosses the edge, `TUNING.body.stepAssist`), **teeter** at edges, **fall**, soft
**land** or **hard landing** (drops > 5.5, face-plant + get-up), **ledge grab** → hang →
**shimmy** (A/D) → **pull up** (toward wall / Space) or **drop** (C / away), **climb**
colliders tagged `climbable` in any direction and **climb over the top**, **push** colliders
tagged `pushable` by walking into them, **slope slide** on steep or `slippery` ground,
**dive → belly slide → get up**, **victory** via `hero.celebrate()`. Walls take away the speed that
runs into them (at a glancing angle the hero slides along at the real speed); running head-on
into a wall at full speed **bonks** (stops dead and reels back), walking into one **leans on it**
(PushIdle; so does pushing a crate that's stuck). Falling while pushing into a wall
**wall-slides** down it (Space kicks off, letting go of the stick drops away).

**Weight (Mario 64).** Speed builds over about 0.65 s to the top (fast from a standstill,
slow for the last metres per second). Turns are tight at walking pace and wide at full speed
(a ~1.3 m arc). The stick's tilt is squared, so a gentle tilt tiptoes. In the air the hero
keeps their momentum and can only nudge it. **Uphill slows the run**: the grade 0.9 m
ahead (stairs count by their average climb) lowers the top speed by up to 60% between
grades 0.2 and 0.33 (the 15° ramp runs at ~4.8 m/s, the playground stairs at ~3.3);
downhill and gentle slopes keep full speed, and ground too steep to stand on slides you
back (`TUNING.ground.uphill`). A jump takes off on the physics step it is pressed (the
jump's own step runs right away, not one step later). Every number is in `TUNING.ground` and
`TUNING.air`, with the reasoning next to it.

`hero.teleport(position)` starts over: idle, no momentum, no jump chain, and the animator
restarts (no blends, no locked feet, no procedural memory), so what happens after a
teleport doesn't depend on what came before it (films and e2e rely on that).

**Getting hurt.** `hero.hurt(fromDirection, strength = 1)` knocks the hero back, away from
`fromDirection` (e.g. enemy position − hero position; only the horizontal part counts), in
an arc. It plays Hurt, takes control away for `TUNING.hurt.stun` s and lets go of ledges,
walls and blocks. Then `hero.invulnerable` counts down (`TUNING.hurt.invulnerable` s);
while it is above 0, `hurt()` returns false and does nothing. `hero.stats.hurts` counts
hits. The playground's spike pad uses it and blinks the hero while invulnerable.

**Presentation.** `hero.lookAt = vector | null` turns the head (and a little of the torso)
toward a point of interest; otherwise it looks where it's going. Pass the rig to
`attachModel(model, clips, HERO_RIG)` to get runtime foot placement on stairs and slopes,
foot locking, leaning into turns and landing squash (docs/ANIMATION.md *At runtime*).

How it's built (`src/engine/character/`):

| file | what |
| --- | --- |
| `PlatformerCharacter.ts` | the core and the public API: body and KCC sweep (walls take speed away), probes, ledge detection, stance, `hurt()` |
| `animator.ts` | animation playback: cross-fades, the Tiptoe/Walk/Run blend space, pose layers and foot placement |
| `states.ts` | `STATES`: one entry per state, `{ step, anim, stance, airborne, snapToGround, attached, snapFacing, lock, feet, lean }`; `MoveState` is its keys. `feet` picks foot placement (`'ik'` on the real ground, `'lock'` planted in the world), `lean` turns on leaning into turns |
| `tuning.ts` | `TUNING`: every speed, acceleration, jump velocity, timing and threshold, documented |
| `controls.ts` | default key map, `readMoveInput` |

To add a state, add one entry to `STATES` (and its step function next to it) and any numbers to
`TUNING`; then film it. Cross-fades between clips go through `RotationBlend`
(`src/engine/animation/rotationBlend.ts`): a blend never flips a joint to the other side, however
far apart the two poses hold it.

Tag colliders with `physics.tag(collider, ...)`: `climbable`, `pushable`, `grabbable`,
`slippery`, `noLedge`, `noCamera`. `hero.state`, `hero.anim` and `hero.stats` expose what
the character is doing. The simpler `CharacterController` remains for games that only need
walk + jump.
