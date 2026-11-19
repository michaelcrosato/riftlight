# The game API: games, levels, options, input, time

## Making a game

A game implements `Game` (`src/engine/Engine.ts`) and is started with `Engine.start(game, options)`.
docs/GUIDE.md §3 is a complete game and §6 the rules (written against the kit); in this repo import
the engine from `src/engine` and the hero from `src/game/hero` (`HERO_CLIPS`, `HERO_RIG`: clips are
data compiled against the model's joints with `compileClips`). `src/game/playground.ts` is a complete
example of every hook; `src/game/sandbox.ts` a second, smaller level.

- GLBs load with `ctx.loadModel`: materials become toon (base colours, nearest-filtered textures
  and vertex colours kept), clones are skeleton-aware (`SkeletonUtils.clone`).
- `input.anyDown(codes)` / `input.consumeAny(codes)` take an array (no rest-argument garbage).
- Everything else hangs off the `GameContext` passed to every hook (`ctx.audio`, `ctx.particles`,
  `ctx.hud`, `ctx.physics`, `ctx.input`, `ctx.lights`, `ctx.tweens`, `ctx.random`, `ctx.dualsense`:
  docs/engine/hub.md *The player's settings*) or the `Engine`.
- New GLB assets: extend `scripts/generate-assets.mjs` (deterministic) or drop GLBs into `public/assets/`.

## Level lifecycle

```ts
await engine.loadGame(new Level2());                      // same renderer, camera, input, audio
await engine.loadGame(new Level3(), { camera: { preset: 'side' } });
engine.dispose();                                         // stop and free everything

// A level door, from the game's own code: the swap happens after this frame.
physics.trigger({ box: [1, 1.5, 0.3] }, door, { tag: 'character', once: true, onEnter: () => void ctx.engine.loadGame(new Level2()) });
```

`loadGame` can be called from anywhere, including the running game's `update`,
`fixedUpdate` or a trigger callback: it never swaps games in the middle of a frame. Loads
run one at a time and the latest call wins (an older load stops after its `setup()`, and
the newer one unloads what it built); `dispose()` during a load lets that `setup()` finish
on a live world and then frees everything.

Unloading calls the old game's optional `dispose(ctx)` hook, then removes every scene
object that is not engine-owned (`userData.engineOwned`: the lights, the particle group) and
disposes its geometry, materials and textures (also textures used only inside TSL node
graphs, and skinned meshes' bone textures), except resources marked `userData.shared`
(cached toon materials, the toon gradient, GLB geometry and textures that other clones
share). It clears physics, particles, the HUD and music, resets input, gives a DualSense's light
bar back to the hub and lets its triggers go (`ctx.dualsense`), and resets the
scene background, fog and the sun / ambient light colors and intensities to the engine
defaults (the sun's direction too, TSL `fogNode` fog, the game speed, tweens and screen shake).
**Carried over** between levels: filters, render mode, resolution, quality,
volumes / mute, screen transitions (a cover → load → reveal spans the load), the debug panel
and the camera rig (unless `camera` is passed; it is applied
before `setup()`, so `ctx.camera` is already the new preset there). While a level loads the
render loop keeps drawing (paused while its pipelines precompile), but the game does not
advance, engine hotkeys are ignored, and keys pressed meanwhile are dropped, so nothing
fires on the first frame; that frame is a normal 1/60 s step. Use `Game.dispose` for
anything else the game owns (DOM, timers, listeners). Physics on its own:

```ts
physics.remove(body);       // or a collider; a static collider takes its empty fixed body along
physics.clear();            // all bodies, colliders, joints, character controllers, triggers, tags, bindings,
                            // movers, fields, belts; gravity and solver back to defaults
                            // (safe from a fixedUpdate or trigger callback: that step loop stops)
physics.counts();           // { bodies, colliders, joints, tags, bindings, triggers, controllers, movers, fields, belts }
input.dispose();            // removes every window / canvas listener (engine.dispose does it)
```

The page at `/` runs Riftlight (docs/GAME.md); `?game=playground` and
`?game=sandbox` open the engine demos (`?game=arcade` is Riftlight's side-scroller on its own, a
template for that genre), `?game=world` is **Engine World**, the engine's tech demo with a room
per technique (docs/WORLD.md), and `window.__PIXEL_GAMES__` holds every game. The games and their options are one table,
`src/games.ts`: the page starts one from it, and `npm run replay` rebuilds a recording's game from
it (by `Game.name`, with `Game.args`: what a lab or a room was made with).

## Engine options for shipping a game

```ts
Engine.start(game, {
  debugUI: false,                              // default: on in dev (vite) or with ?debug=1
  debugKeys: { resolution: 'F2', mute: null }, // with the debug panel: R on F2, no mute key (true / false: always on / off)
  settings: { button: 'top-left', key: 'my-game', padButton: true }, // the ⚙'s corner (false: none), where they are saved, Options opens them
  touchButtons: [{ label: 'A', code: 'Space', hint: 'jump' }, { label: 'B', code: 'KeyJ' }],
  touchBar: false,                             // no ⓘ P R ◐ ♪ hotkey bar on phones unless ?debug=1
  touchStick: 'floating',                      // the joystick's base comes under the thumb (default 'fixed')
  touchDensity: 2,                             // on a phone with touch controls, ~2 CSS px per art px (default 0: off)
});
```

Touch controls step aside while a pad or the keyboard is in use, can float under the thumb
(`touchStick`), and, for a game that opts in once its HUD fits 170 rows, keep a phone's art at
about 2 CSS pixels a pixel, 170 rows or more (`touchDensity`, default off): docs/engine/character.md
*Touch is an add-on*.

The hotkeys (`DEFAULT_DEBUG_KEYS`): `mode` P · `resolution` R · `debug` \` (creates the panel on
demand) · `nextLook` ] · `prevLook` [ · `mute` M. They are developer tools: on with the debug
panel (dev, `?debug=1`), off in a shipped game; `debugKeys: true` / `false` turns them on / off
always, and an object only moves or drops keys. A game with its own use for one of the keys
moves it at runtime with `rebindDebugKeys(engine.debugKeys, { resolution: 'F7' })`, which leaves
keys that are off off. The touch top bar follows them, and the debug panel lists the ones on.

## Player settings

`engine.settings` holds the player's picture and engine options as plain data (`PlayerSettings`:
look, pixel art, pixel size, quality, frame rate, debug info, the controller's button prompts
`padGlyphs`, `'playstation'` (left out, the default) or `'xbox'` (`PAD_GLYPHS`), and its
`vibration`, 0..1 in steps of 0.05 (left out: 1; `input.rumble` follows it), a voice feature's
`voice` and `voiceSensitivity` (0.5..3, steps of 0.5), motion aim's `motion` and
`motionSensitivity` (0.25..3, steps of 0.25); sound is
`audio`'s), applies them over the game's own choices and saves them per game in localStorage
(`pixel-engine:settings:<key>`; `settings.key`, default the first game's name, `false` for none). A
field left out is the game's: `set({ look: undefined })` gives one back, `reset()` all of them. A
review flag in the URL (`?look=`, `?filters=`, `?mode=`, `?res=`, `?quality=`, `?fps=`, `?debug=`)
wins over a saved value at start (which stays saved), and a chosen look wins over each new level's
own. A look is drawn by the pixel pass, so smooth 3D (pixel art off) shows none. The settings panel
(`SettingsPanel`, DOM, so it stays legible at any art size) is made for a TV at
ten feet and a pad first: one setting per large row (text `clamp(18px, 3.2vmin, 40px)`), its value
stepped ◀ value ▶ (no dropdowns, sliders or boxes), a ringed focus, three pages turned with L1 / R1
(Q / E): **Picture** (look, pixel art, pixel size, quality, frame rate, debug info), **Sound** (on,
volume, music, effects: `audio`'s), and **Controls** (button prompts PlayStation / Xbox, vibration:
a rumble to feel when it changes on a pad), and a legend of the device's buttons (✕ Change · ○ Close
· △ Reset; Enter · Esc · R on the keyboard; Tap · Swipe on a touch screen, where Tap is a hint, not
a button). The d-pad or the left stick (with repeat) and the arrows / WASD move and change, Cross /
Enter changes too, Circle / Esc / Options close, Triangle / R pressed twice within 2 s resets
everything (the legend says *Press again to reset* between; anything else disarms it); the mouse's
hover moves the focus and a click acts (◀ ▶, a row, a
legend button; beside the panel: close), leaving the keyboard focus on the panel, so the next Enter
acts once; on a touch screen a tap acts and a quick swipe down or sideways closes it. Turning a page
never moves the panel (it keeps its tallest page's height). The rows are a listbox whose
`aria-activedescendant` follows the focus, so a screen reader names each row and value. Its rows
and rules are data (`SettingsMenu`,
src/engine/ui/settingsMenu.ts, driven by `MenuInput` / `FocusList` from the engine's input:
headless-testable), its words lines (`SETTINGS_LINES`: a game with a line of the same id in
`engine.controls.names` shows its own). The ⚙ button opens it (`settings.button`: a corner, default
top-right, shown on a mouse only while the pointer moves; `false`: none, so a game opens it from its
own menu with `engine.settings.open()`); `settings.padButton: true` lets Options (and Esc) open it,
for a game with no pause menu of its own (default off; the playground, the sandbox and Rift Runner
turn it on). Open, it pauses the game; a key or pad button held when it
opens or closes reads as up until let go, and a stick held then reads centred until it goes back
inside its deadzone (`input.release()`), so the press that opened it never acts in it, a stick still
leaning from a run never steps its rows, and the Cross that changed a value never jumps the hero.
Esc opens it once its frame has run as recorded (keys still held), Options as it is let go
(`HOST_CHORD`). It stays shut while a replay plays; a replay never saves settings (`persist`) and
puts the player's back when it ends.

A game's extras add rows: `settings.voice: true` (a voice feature) adds **Microphone** under Sound,
on only while 52in1 allows games the microphone, else off with 52in1's line (`engine.voiceOn`), and
**Shout sensitivity** (`input.shoutSensitivity`: docs/engine/hub.md *Shouts*). `settings.motion:
true` (motion aim by a DualSense's motion, `input.motion`) adds **Motion aim** and its
**sensitivity** under Controls, there to change while a DualSense's motion reaches games through
52in1 (else off, with a line saying motion aim needs a DualSense in 52in1); on by default while
52in1's own Motion aim is (`engine.motionOn`); `input.motion` follows both rows (on: the gyro is
read every poll and the sensitivity scales its turns; off: nothing is read, so 52in1's own Motion
aim, if on, has the stick back: docs/engine/hub.md *Motion and the touchpad*). Riftlight has the player
settings in its own Settings menu: look, quality and the volumes on its page, the rest on its Engine
page. Engine World's tweak panel (T) sets the same look, pixel art and quality.

## Picking with the mouse

```ts
const p = engine.input.pointer;                     // NDC (−1..1, y up) over the canvas, and p.over
ctx.camera.rayAt(p.x, p.y, origin, dir);            // the ray through that pixel
const hit = ctx.physics.castRay(origin, dir, 1000); // what the mouse is over (cast long: an ortho rig stands far back)
engine.input.setPointer(x, y, true);                // tests: put the pointer there, pressed
input.isDown('MouseLeft'); input.consumePress('MouseRight'); // buttons are keys: held, and pressed once
engine.input.setButtons(2);                         // tests: hold the right button (bits: 1 left, 2 right, 4 middle)
```

Mouse buttons on the canvas are keys (`MOUSE_BUTTONS`: `MouseLeft`, `MouseRight`, `MouseMiddle`),
held and pressed like any key, so fixed-step code reads a click with `consumePress` (one shorter
than a frame is not lost) and a chord (right while left is held) counts both. A finger is the key
`Touch` (`TOUCH_KEY`), not a click, and `pointer.touch` says whether the pointer is one; a second
finger (a pinch) lets `Touch` go until every finger is up; two in one frame press nothing.
`input.buttonEvents` lists this frame's presses and releases in order, each where the pointer
was, so a UI sees a script's drag between two frames start and end where it did. `input.mouseButtons` is the same keys as bits (1 left or a finger, 2 right, 4 middle); drag a body by giving it a velocity toward where the
pointer's ray meets a plane (the Sandbox's grab: a spring, so it still collides and can be thrown). Under pointer lock (`first`, `free`) `pointer` is the screen's centre, the crosshair;
with `third` a left drag also turns the camera.

## Input: gamepads and press timing

Gamepads with the W3C **standard** mapping (`gamepad.mapping === 'standard'`: DualSense, Xbox,
Switch Pro and most others) need no setup; pads with an unknown layout are ignored. For them: the left stick
feeds `input.moveAxis()` (radial deadzone 0.15, `GAMEPAD_DEADZONE`, `applyDeadzone`), the right
stick turns into pointer movement (camera look, `input.gamepadLookSpeed`; the AI Hub's gyro aim
adds to it) and reads as `input.lookAxis` (y up: twin-stick aim) while the pad is the device in use
or the stick leans past a quarter of its travel (a stick resting just past its deadzone never creeps
a keyboard and mouse player's camera), the analog triggers read 0..1 as
`input.triggers.left` / `.right`, and buttons press their own codes through `input.gamepadButtons`
(`GAMEPAD_BUTTONS`, one scheme for every game): `PadA` Cross · `PadB` Circle · `PadX` Square ·
`PadY` Triangle · `PadLB` / `PadRB` L1 / R1 · `PadLT` / `PadRT` L2 / R2 · `PadBack` Create (View) ·
`PadStart` Options (Menu) · `PadL3` / `PadR3` · `PadTouchpad` (button 17, the DualSense's press in
Chrome) · the d-pad presses the arrows. A game binds them beside its keys (`KEYMAP.jump` is
`['Space', 'PadA']`; `readMoveInput` plays the Playground on a pad), Options is left free for a
pause, and Circle means back in menus. The home button (16, `HOME_BUTTON`) is never read, even when
mapped, and Create + Options together are the host's (the AI Hub's bar: `HOST_CHORD`): each
presses as it is let go, only if the other never went down meanwhile, so a pause on Options never
opens behind the bar, whichever went down first (`isDown` reads it at once). Remap with
`input.gamepadButtons[2] = 'KeyF'`. Triggers, the right stick and the device are recorded. A
movement key held (WASD, the arrows, the d-pad) wins over the left stick in `moveAxis()` unless the
pad is the device in use and its stick leans past a quarter of its travel, so a connected pad's
stick resting just past the deadzone never takes the keyboard's movement away. A trigger the pad
is first seen with part-way reads 0 until it moves.
Headless tests feed pads with `input.setGamepads([...])` (`GamepadLike` objects; `null` for the
browser's again).

**The input used last** is `input.device`: `'keyboard'` (a key, though not one typed into a text
field or by a phone's soft keyboard; the mouse's click, wheel or a move of a few pixels), `'pad'` (a button pressed, a stick pushed past a quarter of its travel, a trigger
past 0.3) or `'touch'` (a finger on the canvas, a touch control: `TouchControls` call
`input.noteTouch()`; prompts name the keys for a touch while the engine shows no touch controls,
`engine.controls.touch`: a tap on a touch-screen laptop). It starts as `'touch'` on a touch-screen device, `'keyboard'` elsewhere; a
pad that is only connected (`gamepadConnected`), a stick resting or jittering near its deadzone
and a trigger resting where the pad was first seen never change it, so a keyboard player with a
pad plugged in keeps key prompts and mouse aim. It is recorded when it changes (none: the
keyboard), a level's recording keeps the one it began with (`Recording.device`) and save-states
keep it, so prompts, menus and touch assists follow it and still replay. `input.noteDevice(d)` sets it (a page's controls,
a test). With the pad in use or the pointer locked (no replay) the OS pointer hides over the
canvas (`PointerCursor`), and over the settings panel while the pad drives it; mouse travel shows it.

**Rumble**: `input.rumble({ strong, weak, ms })` (0..1 each: the heavy low motor and the light
buzz) plays a `dual-rumble` on the pad in use (`input.padIndex`, the one used last) when the frame
ends, the strongest request of the frame, scaled by the player's `settings.vibration` (0..1,
`input.vibration`). The AI Hub scales every rumble by its own vibration setting on top: never
multiply by `AIHubSettings.vibration` yourself. It does nothing headless, during a replay, at
vibration 0, while the device is not the pad, or on a pad without `vibrationActuator` (Firefox);
a refused effect is caught. Output only, never recorded. Short pulses on hits, landings and
explosions say more than long rumbles.

**The DualSense's touchpad and motion** (52in1): `ctx.input.touchpad = true` presses
`PadTouchpadLeft` / `Right` / `Up` / `Down` / `Tap` (`TOUCHPAD_KEYS`), and motion aim
(`input.motion`, `settings: { motion: true }`) adds the controller's turns to the right stick's,
both recorded: docs/engine/hub.md *Motion and the touchpad*.

**Swipes**: a quick one-finger flick on the canvas (under 0.35 s, over 8% of its short side:
`swipeDirection`) presses `SwipeLeft` / `SwipeRight` / `SwipeUp` / `SwipeDown` (`SWIPE_KEYS`) once,
recorded like any press; a slow drag still orbits the camera (two fingers pinch).

Keys whose browser default should not fire (a game's own F1 / F2 / Tab panels) go in
`input.preventKeys` (arrows and Space always are).

`consumePress` keeps a press for at most `input.pressWindow` = **150 ms of game time**, so a
jump pressed during a hitch still lands, but presses never pile up. While `engine.paused` is
true (or a level is loading, including the start-up loading screen) the render loop's game time
(`ctx.time`) stops and queued presses are dropped, so nothing fires on resume. `paused` is the
render loop's: `step()` and `replay()` are manual time, the tool's own clock, and advance a paused
game too (a replay plays every recorded frame).

## Menus on every device

```ts
const menu = new MenuInput();                         // keys, pad, left stick, swipes → menu events
const list = new FocusList(3);                        // a list's focus (index, wrap, columns)
const events = menu.events(ctx.input, dt);            // in update: nav (with repeat), confirm, back, tab, wheel, key, swipe
const r = list.update(events, ctx.input, ctx.hud, rects); // rects: each item's box in HUD pixels
if (r.confirm >= 0) choose(r.confirm);                // Enter / Space / Cross, or a click or tap on the item
if (r.back) close();                                  // Esc / Backspace / Circle, or a sideways swipe
```

`MenuInput` (`src/engine/ui/menu.ts`, `MENU_KEYS`): Enter / Space / Cross confirm, Esc /
Backspace / Circle go back, the arrows / WASD / the d-pad and the left stick move (a press or a
lean steps at once, held repeats after 0.35 s: `MENU_REPEAT`), Q / E and L1 / R1 change tabs; `new MenuInput({
confirm: [...], keys: ['KeyX', 'PadX'] })` changes bindings and passes a menu's own shortcuts on as
`key` events. `FocusList` moves with those events (left / right on a one-column list as `adjust`,
for a slider), and with the pointer: hovering an item focuses it (only when the pointer moves, so a
resting mouse never fights the d-pad, and a menu opened under it keeps its focus), a press and
release on the same item confirms it (not a swipe across it); a shrunk `count` clamps its focus.
Both read only `ctx.input`, so a menu replays; their state is data (`save` / `load`).
Riftlight's menus and Engine World's panels run on `MenuInput`.

## Prompts

```ts
class MyGame implements Game {
  readonly controls = {                               // Game.controls: each action's key, pad button, touch button
    jump: { key: 'Space', pad: 'PadA', touch: 'A' },
    attack: { key: 'MouseLeft', pad: 'PadX', touch: 'TouchTap' },
    pause: { key: 'Escape', pad: 'PadStart', touch: '≡' },
  };
}
t('help.jump');                                       // "{key:jump} to jump" → "Space to jump" / "Cross to jump" / "A to jump"
ctx.hud.prompt(8, 250, 'jump', 'JUMP');               // the glyph, then the label: ✕ JUMP on a DualSense
ctx.hud.glyph(8, 240, 'PadB');                        // a code alone: ○ (or B)
ctx.engine.controls.label('pause');                   // "Esc" / "Options" / "Menu" / "≡"
```

`engine.controls` (`src/engine/controls.ts`) holds the running game's `controls` (a `ControlTable`,
set at each level) and follows `input.device` (the input used last) and the player's
`settings.padGlyphs`: every `Lang`'s `{key:action}` names the control in use by default
(`Lang.controlLabel`; the action's id when the game has no table), and `hud.glyph` / `hud.prompt`
draw it. On a pad that is PlayStation's buttons unless the player chose Xbox's: Cross, Circle,
Square and Triangle as round buttons with their symbol in its colour (blue, red, pink: the palette's
plum, green: its teal) on a light face; Xbox's A B X Y as round buttons in their colours (green, red,
blue, orange) with a white letter; L1 / R1 / L2 / R2 / L3 / R3 / Create / Options / Touchpad (LB RB LT
RT LS RS View Menu) as dark caps named; the sticks (`PadStick`, `PadLStick`, `PadRStick`)
and the d-pad (`DPad`, its arms the arrow codes) drawn. On the keyboard a key is a light key cap
with its short name (`keyCap`: `Space` → Spc), the mouse's buttons and wheel are drawn; on a touch
screen it is the touch button's label or a gesture's name (`TouchTap` → Tap). Glyph sprites are 7×7
(`GLYPH_SIZE`), the height of a line of the 5×7 font, in `hud.sprite`'s row format: a surface of the
game's own draws them from `controlGlyph`, `padGlyph` and `keyGlyph` (Riftlight's UI kit and its
passive tree's canvas do).

**Legends**: `ctx.hud.legend(x, y, [['confirm', 'SELECT'], ['back', 'BACK']], { align: 'center' })`
lays out each button's glyph and words for the device in use, one way for every game (✕ SELECT
○ BACK on a DualSense, ENTER SELECT ESC BACK on the keyboard, TAP SELECT SWIPE BACK on a touch
screen); an item whose control the device has none of (`engine.controls.onDevice(action)` false:
no touch gesture for it) shows its words alone. `hud.legendWidth(items)` measures it.

Names are lines: `CONTROL_LINES` lists every id the engine names a control by, with its English
(`key.space`, `key.esc`, `key.mouse_left`, `pad.ps.cross`, `pad.ps.options`, `pad.lb`,
`pad.xbox.menu`, `pad.stick.left`, `key.touch.tap`...); a game with a line of the same id shows its
own (and its translations), and a game's own code is named by `key.<snake_case>`
(`MouseOrQE` → `key.mouse_or_q_e`), `pad.<snake_case>`, `key.touch.<snake_case>`. Letters and
digits show themselves (`KeyF` → F), Xbox's face buttons their letter. `keyName`, `keyCap`,
`padName(code, style)`, `touchName` and `controlName(control, device, style)` take a language
(`names`, a `Lang`) for a game's own surfaces; `engine.controls.names = lang` names `hud.glyph`'s
caps in it. Prompts are presentation: they read `input.device`,
which is recorded, so a replay draws the same.

## Time: game speed and hitstop

```ts
engine.timeScale = 0.25;     // slow motion; 2 = double speed; 0 = frozen (a menu: presses are dropped)
engine.hitstop(0.08);        // freeze the game for 0.08 s of real time: a hit lands
```

`timeScale` scales game time itself (`ctx.time`, the `dt` hooks get), so physics steps,
animation, particles, tweens and the camera follow all slow down together. A hitstop freezes
game time for real seconds (overlapping ones keep the longest); rendering, screen shake and
transitions keep running. `Engine.step()` applies both, so tests see them frame-exactly.
At speed 0 key presses are dropped, like a pause (a menu's Space must not jump the hero when
it closes); presses made during a hitstop still count afterwards (a buffered jump). Values that
aren't numbers are ignored (`GameClock`, `src/engine/clock.ts`, unit-tested).
`loadGame` resets the speed to 1. `state()` reports `timeScale` and `hitstop`.
