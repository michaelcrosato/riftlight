# Cinematic

## Cutscenes: `Timeline` (`src/engine/cinematic/timeline.ts`)

```ts
const scene = new Timeline({
  shots: [{ at: 0, position: [0, 6, 10], target: [0, 1, 0], fov: 50 },
          { at: 4, position: [-1, 2.6, 4], target: [0, 1.2, 0] },                    // glides from the key before
          { at: 4, position: [-3, 1.8, 0], target: [2, 1.3, 0], fov: 40, cut: true }], // a cut
  cues: [{ at: 1, name: 'door', run: openDoor }, { at: 1.2, cosmetic: true, run: () => ctx.audio.play('coin') }],
  lines: [{ at: 0.5, until: 3, who: 'GUIDE', text: 'WELCOME.' }],
  onEnd: () => backToPlay(),
});
scene.play(); scene.update(dt);          // per frame: fires the cues it passes
const shot = scene.camera();             // { position, target, fov }: put a camera there
scene.line(); scene.bars();              // the subtitle now; letterbox 0..1 (in at the start, out at the end)
scene.skip();                            // to the end: every cue up to the end not yet fired runs, except cosmetic ones
```

Pure (no three.js), unit-tested. The camera passes through each key at its time on Hermite
curves with Catmull-Rom tangents (finite differences in time), so its speed has no jolt at a
key; the first and last keys of a shot ease in and out; a `cut` key starts a new shot. `seek(t)`
scrubs without firing (going back re-arms the cues). While playing, a cue that seeks, skips or
pauses decides what fires next (the rest of the frame's cues wait); while skipping, a cue's seek
is ignored, so a looping scene still skips to its end. The game owns the camera: swap a `fixed`
perspective rig in (`engine.setCamera({ preset: 'fixed', projection: 'perspective', ... })`),
set its position, `lookAt` and `fov` from `camera()` each frame, and swap the game's preset back
in `onEnd`. The Cutscene Stage room (`src/world/rooms/cutscene.ts`) is the whole pattern.
