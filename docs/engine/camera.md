# Camera (`src/engine/camera.ts`, `shake.ts`)

## Camera presets

A game picks **one** preset (`EngineOptions.camera`, or `?camera=` / `?cam=` in the URL).
For reviewing, `engine.setCamera(config)` (and the debug UI's picker) hot-swaps the
preset **without touching the world**: the player stays where they are, and so do coins,
physics and the renderer. Switching back to the game's own preset restores its configured
zoom and angles. Switching to `free`/`fixed` starts from the current view and keeps its
field of view. The game's `onCameraChange(ctx)` hook re-applies anything preset-specific,
such as the side lane lock or hiding the model in first person.

The URL is kept in sync. Normal presets use `?camera=`. `free`/`fixed` write their full
config to `?cam=`, so a reload brings back the same shot.

| Preset | Projection | Controls | Zoom |
| --- | --- | --- | --- |
| `iso` (default) | ortho, 32° pitch / 45° yaw (both configurable) | follows player | wheel / `+` `-` |
| `topdown` | ortho, straight down, screen-up = −Z | follows player | wheel / `+` `-` |
| `side` | ortho, straight side-on; **locks the player to their Z lane** | follows player | wheel / `+` `-` |
| `third` | perspective orbit; pulls in when walls block the view | drag or Q/E to orbit | wheel / `+` `-` (distance) |
| `first` | perspective at the eyes; hides the player model; player strafes | click to lock mouse, Q/E turn | **none** |
| `free` | authoring fly-cam | WASD, Q/E down/up, drag or click to look, Shift fast, Enter = fix | wheel (FOV) |
| `fixed` | a frozen view (what `free` produces) | none | wheel |

A game may also swap presets as part of play (Riftlight's arcade cabinet goes `side`, its
Hall of Beasts `first`, its photo mode `free`): pass `engine.setCamera(config, { syncUrl: false })`
so a reload still starts with the game's own camera (docs/game/showcase.md).

Free-camera workflow: start with `?camera=free`, fly to the shot you want, press **Enter**.
The view freezes, the player gets control, and the config (e.g.
`{"preset":"fixed","projection":"perspective","position":[3,6,9],"target":[0,1,0],"fov":55,"zoom":1}`)
is printed to the console, copied to the clipboard and shown in the debug UI. Paste it into
`EngineOptions.camera`, or pass it as `?cam=<json>`. Press Enter again to unfix.

Config keys (`CameraConfig`): `preset`, `zoom`, `minZoom`, `maxZoom`, `viewHeight` (ortho),
`pitch`/`yaw` (iso, third, first), `fov`, `distance` (third), `position`/`target`/`projection`
(fixed/free), `stiffness` (follow smoothing). Movement is always camera-relative through
`camera.groundBasis()`.

## Screen shake

```ts
engine.shake.add(0.4);       // trauma 0..1: a ground pound, a blast
engine.shake.strength = 0;   // a settings toggle
```

`engine.shake` is a `CameraShake` (`src/engine/shake.ts`): hits add trauma, which drains
(`decay` per second); the offset is `maxOffset × trauma² × smooth noise` (sums of sines,
deterministic). The engine adds it to the camera after the rig placed it, on real time, so it
keeps shaking through a hitstop; ortho presets move by whole art pixels. A game can also keep
its own and nudge a rig's focus with `shake.apply(ctx.camera, dt)` (Riftlight's combat does).
