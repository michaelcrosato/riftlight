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
  `ctx.hud`, `ctx.physics`, `ctx.input`, `ctx.lights`, `ctx.tweens`, `ctx.random`) or the `Engine`.
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
share). It clears physics, particles, the HUD and music, resets input, and resets the
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
  settings: { button: 'top-left', key: 'my-game' }, // the ⚙'s corner (false: none) and where the settings are saved
  touchButtons: [{ label: 'A', code: 'Space', hint: 'jump' }, { label: 'B', code: 'KeyJ' }],
  touchBar: false,                             // no ⓘ P R ◐ ♪ hotkey bar on phones unless ?debug=1
});
```

The hotkeys (`DEFAULT_DEBUG_KEYS`): `mode` P · `resolution` R · `debug` \` (creates the panel on
demand) · `nextLook` ] · `prevLook` [ · `mute` M. They are developer tools: on with the debug
panel (dev, `?debug=1`), off in a shipped game; `debugKeys: true` / `false` turns them on / off
always, and an object only moves or drops keys. A game with its own use for one of the keys
moves it at runtime with `rebindDebugKeys(engine.debugKeys, { resolution: 'F7' })`, which leaves
keys that are off off. The touch top bar follows them, and the debug panel lists the ones on.

## Player settings

`engine.settings` holds the player's picture and engine options as plain data (`PlayerSettings`:
look, pixel art, pixel size, quality, frame rate, debug info; sound is `audio`'s), applies them
over the game's own choices and saves them per game in localStorage
(`pixel-engine:settings:<key>`; `settings.key`, default the first game's name, `false` for none).
A field left out is the game's: `set({ look: undefined })` gives one back, `reset()` all of them.
A review flag in the URL (`?look=`, `?filters=`, `?mode=`, `?res=`, `?quality=`, `?fps=`,
`?debug=`) wins over a saved value at start (which stays saved), and a chosen look wins over each
new level's own. A look is drawn by the pixel pass, so smooth 3D (pixel art off) shows none.
The settings panel (`SettingsPanel`, DOM like the debug panel) shows them with the volumes; the
⚙ button opens it (`settings.button`: a corner, default top-right, shown on a mouse only while
the pointer moves; `false`: none, so a game opens it from its own menu with
`engine.settings.open()`). Open, it pauses the game, and keys pressed in it never reach the game;
Escape or Done closes it. It stays shut while a replay plays; a replay never saves settings
(`persist`) and puts the player's back when it ends. Riftlight has them in its own Settings menu:
look, quality and the volumes on its page, the rest on its Engine page. Engine World's tweak
panel (T) sets the same look, pixel art and quality.

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
`Touch` (`TOUCH_KEY`), not a click, and `pointer.touch` says whether the pointer is one.
`input.buttonEvents` lists this frame's presses and releases in order, each where the pointer
was, so a UI reading clicks sees a drag a script makes between two frames start and end where it
did. `input.mouseButtons` is the same keys as bits (1 left or a finger, 2 right, 4 middle); drag a body by giving it a velocity toward where the
mouse ray meets a plane (the Sandbox room's grab: a spring, so it still collides and can be
thrown; a level plane when the camera looks down, an upright one facing it when it looks
across). Under pointer lock (`first`, `free`) `pointer` is the screen's centre, the crosshair;
with `third` a left drag also turns the camera.

## Input: gamepads and press timing

Gamepads with the W3C **standard** mapping (`gamepad.mapping === 'standard'`, what Chrome,
Firefox and Safari report for Xbox / PlayStation / Switch Pro and most others) need no
setup; pads with an unknown layout are ignored rather than guessed at. For them: the left stick feeds `input.moveAxis()` (radial
deadzone 0.2, `applyDeadzone`), the right stick turns into pointer movement (camera look,
`input.gamepadLookSpeed`), and buttons press key codes through `input.gamepadButtons`
(`GAMEPAD_BUTTONS`: A Space · B C · X J · Y F · LB Z · RB X · LT Shift · RT C · Back V ·
Start B · d-pad arrows), so `KEYMAP` / `readMoveInput` work unchanged. Remap with
`input.gamepadButtons[2] = 'KeyF'`.

Keys whose browser default should not fire (a game's own F1 / F2 / Tab panels) go in
`input.preventKeys` (arrows and Space always are).

`consumePress` keeps a press for at most `input.pressWindow` = **150 ms of game time**, so a
jump pressed during a hitch still lands, but presses never pile up. While `engine.paused` is
true (or a level is loading, including the start-up loading screen) game time (`ctx.time`)
stops and queued presses are dropped, so nothing fires on resume.

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
