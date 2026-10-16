# Effects: particles, HUD, weather, grass, trails, sprites, screen effects, tweens

## Particles (`src/engine/particles/`)

```ts
ctx.particles.burst('dust', hero.feet);                          // landing puff
ctx.particles.burst('skid', feet, { direction: [vx, 0.6, vz] }); // kicked back
ctx.particles.burst('sparkle', coinPos, { count: 20, scale: 2, colors: ['white', 'cyan'] });
ctx.particles.register('confetti', {
  count: [20, 30], life: [0.6, 1.2], speed: [3, 5], direction: [0, 1, 0], spread: 30,
  gravity: 6, drag: 1, size: [2, 2], colors: ['red', 'sand', 'lime', 'sky'],
});
```

Presets are data (`presets.ts`: `dust`, `skid`, `sparkle`, `smoke`, `impact`). Sizes are
whole **art pixels** (converted with the camera's world size of one art pixel at the focus),
colors are `PALETTE` names stepped over each particle's life, never blended. Each preset is
one pooled CPU simulation (`ParticlePool`, unit-tested) drawn as **one instanced
`SpriteNodeMaterial` draw call** from a reused instance buffer. Emitters are keyed by
preset name, or by content for inline preset objects (building the same literal every frame
stays one emitter); `register` under an existing name frees the old emitter. Vary bursts
with the options (`count`, `direction`, `speed`, `scale`, `colors`) rather than new presets.
Particles freeze with `paused`, advance with `step()`, and are cleared when a level unloads.

## Pixel HUD (`src/engine/hud/`)

```ts
update(ctx: GameContext) {
  const { hud } = ctx;
  hud.clear();                                                   // retained: clear + redraw
  hud.sprite(6, 6, ['.oo.', 'oyyo', 'oyyo', '.oo.'], { o: 'orange', y: 'sand' });
  hud.text(14, 6, `${coins}/12`, { color: 'sand' });           // 5×7 font, uppercase
  hud.text(6, 6, 'LIVES 3', { anchor: 'top-right' });
  hud.text(0, 0, 'PAUSED', { anchor: 'center', scale: 2, shadow: 'navy' });
  hud.rect(0, 0, hud.width, 12, 'ink', 'bottom-left');           // a bar along the bottom
}
```

The HUD is a 2D canvas at the internal resolution (480×270 or 320×180), placed exactly over
the game canvas with the framing's integer scale and letterbox offset, so one HUD pixel is
one art pixel at every size and after `R`. It is drawn after (outside) the post filters and
the pixel pass: text stays crisp in Raw 3D mode and under CRT/VHS looks. x/y are art-pixel
offsets from the `anchor` (`top-left` default, `top`, `top-right`, `left`, `center`, `right`,
`bottom-left`, `bottom`, `bottom-right`); `hud.measure(text, scale)` gives the size. It only
repaints when the content or layout changed, and `renderer.capture()` does not include it.

## Weather, sky and fog

```ts
applySky(engine, skyAt(18.5));                   // sun direction, colour, strength, ambient, background
const rain = new Precipitation({ kind: 'rain', count: 3500, area: [26, 14, 26] });
scene.add(rain); rain.intensity = 1; rain.wind.set(3, 1);
// per frame: rain.update(dt, camera.focus); splashes: rain.splashes(dt) drops landed this frame
const mist = groundFog({ top: 1.4 });
(scene as { fogNode: unknown }).fogNode = mist.node;       // loadGame clears it
mist.amount.value = 0.8; mist.color.value.setHex(sky);
```

`skyAt(hour)` (pure, unit-tested) blends keyframes of the day: a sun that rises in the east,
crosses and sets in the west, warm at dawn and dusk, a dim blue moon at night (`night` 0..1
for lamps). `Precipitation` is one instanced draw: each drop's place comes from a hash of its
index and its fall from time, in the vertex shader, in a box of air around a centre that
wraps in world space; `intensity` hides the drops above a share (a uniform: no buffers, no
recompiles). `groundFog` is a `scene.fogNode` with uniforms: mist below `top` plus distance
haze, up to `amount`.

## Grass, wind sway

```ts
const grass = new GrassField({ area: [22, 16], at: [0, 0, 0], count: 6000, mask: (x, z) => clear(x, z) });
scene.add(grass);
// per frame: grass.wind.set(2, 0.5); grass.update(t); grass.push(0, hero.feet, 0.85)
const wind = new WindUniforms();
swayObject(tree, wind, { height: 2.3, base: 0.7, amount: 0.12, phase: 1.3 });   // per frame: wind.update(t, [2, 0.5])
```

`GrassField` is one instanced draw of crossed-triangle blades; the vertex shader leans each
by its height squared (a steady lean, a flutter, gusts that roll across the field along the
wind) and parts and flattens blades near up to four pushers (`push(i, at, radius)`). Blades
are lit as ground (up normal) in three colour steps. `swayObject` gives every mesh under a
model a swaying copy of its material (everything above `base` leans along the wind).

## Trails and decals

```ts
const trail = new Trail({ points: 24, width: 0.35, life: 0.35, color: PALETTE.sand, tail: PALETTE.orange });
scene.add(trail);                                 // per frame: trail.push(tip, t); trail.update(t, camera)
const decals = new Decals(scene, { capacity: 160 });
decals.add('scorch', at, normal, { size: 2, color: PALETTE.night, life: 8 });   // footprint, splat, crack, ring
// per frame: decals.update(dt)
```

A `Trail` is a ribbon through its last points facing the camera, thinning toward the tail and
stepping from its colour to its tail colour as points age. `Decals` lays small quads along a
surface's normal (nudged off it, with a depth offset), their shapes cut out in the shader
(`DECAL_SHAPES`, no textures), one instanced draw per shape, a colour per mark, faded out by
an ordered dither after `life` seconds; when a pool is full the oldest mark is reused.

## Pixel sprites

```ts
const sheet = drawSheet({ frame: [16, 16], frames: 4 }, (g, f) => { g.fillStyle = '#ef7d57'; g.fillRect(4, 4 + (f % 2), 8, 8); });
const critters = new SpriteBatch(sheet, { capacity: 200 });   // one instanced draw for all of them
scene.add(critters);
const i = critters.spawn([0, 0, 0], { size: 0.8 });           // bottom middle at the point, 0.8 m tall
critters.set(i, { at: [1, 0, 0], frame: 2, flip: true });     // move, animate, mirror
```

Flat pixel pictures that always face the camera (Doom's monsters, Paper Mario). The vertex
shader puts each quad's corners along the camera's right and up around its point, then
pushes them toward the camera as far as an upright figure's would be (so sprites sort like
standing figures, and a top-down camera doesn't sink them into the floor). The fragment
shader picks the frame's cell of the sheet (nearest sampling; a mirrored sprite reads it right
to left) and drops transparent pixels (an alpha cut-out: no blending, so the depth buffer sorts
sprites and models together). Position, size, frame and mirror are instance attributes;
`put(i, x, y, z, frame, flip)` changes them without allocating. `drawSheet` paints a sheet in
code with a 2D canvas (no image files); another texture works too (frames left to right, top
to bottom; a `DataTexture` holds its rows top line first). Positions are in the batch's own
space: leave the batch unrotated and unscaled.

## Screen effects: transitions, flashes, shockwaves

```ts
await engine.screen.cover('iris', { center: hero.position, duration: 0.4 }); // closes on the hero
await engine.loadGame(new Level2());
await engine.screen.reveal('iris');
await engine.screen.transition('diamonds', () => teleport());   // cover, run, reveal
engine.screen.flash('white', { duration: 0.12, strength: 0.8 });       // palette names or hex
engine.screen.shockwave(blast, { radius: 0.45, duration: 0.6, strength: 1 });
engine.screen.set('fade', 1);                                     // jump (no animation)
```

Transitions (`TRANSITIONS`): `fade` (five steps), `iris`, `diamonds` (16-pixel cells swept left
to right), `dissolve` (random 3-pixel blocks), `dither` (the 4×4 Bayer pattern), `blinds`,
`wipe`, `curtain`, `mosaic` (pixel blocks grow, then fade). `render/screenFx.ts` keeps their
uniforms (kind, progress, centre, colour; flash colour and amount; four rings) and every output
graph ends with the same TSL function: per **art pixel** it decides whether the pixel is
covered, so a transition is a pixel pattern at any scale and starting one never compiles a
shader. A world centre (a `Vector3`) is projected every frame, so an iris follows a moving hero.
Transitions, flashes and rings run on real time (they keep moving while the game is paused
and while a level builds; the loop stops only while new shaders precompile; the engine keeps
them across `loadGame`). `cover` and `reveal` resolve `true` when they ran to the end and
`false` when another transition took over; `transition` reveals even if its work throws.
Colours are display colours (a palette name or hex, as on screen). Shockwaves and the
mosaic's growing blocks resample the art-resolution picture where it is upscaled (pixel-art
layers); a clean look and Raw mode get the transitions, the mosaic's fade and the flash, but no
ripple. While nothing runs, the stage costs one uniform test per pixel.
`coversPixel(kind, progress, x, y, w, h)` is the same rule on the CPU (unit tests).
`state().screen` reports the transition, its progress, the flash and the rings.

## Tweens

```ts
ctx.tweens.to(door.position, { y: 3 }, { duration: 0.8, ease: 'outBack' });
const t = ctx.tweens.to(lamp, { intensity: 0 }, { duration: 0.3, yoyo: true, repeat: Infinity });
t.cancel();                                                    // or t.cancel(true): jump to the end
if (await ctx.tweens.to(door.position, { y: 0 }, { duration: 0.5 }).done) slam(); // false: cancelled
ctx.tweens.value(0, 1, { duration: 2, ease: 'steps4' }, (v) => (fade = v));
ctx.tweens.call(1.5, () => spawnWave());                       // a timer on game time
```

`ctx.tweens` (`src/engine/tween.ts`, pure, unit-tested) runs on game time: tweens pause, slow
down and freeze with the game, and are cleared when the level unloads (their `done` promises
resolve `false`: completed tweens resolve `true`, so code awaiting one knows whether to carry on). A new tween of the same property takes over from the old one. Eases (`EASES`):
`linear`, quad / cubic / sine / expo in, out and in-out, `inBack` `outBack` `inOutBack`,
`outElastic`, `outBounce`, `smooth`, and `steps2` / `steps4` / `steps8` (motion that holds
poses, like sprite animation), or any `(u) => number`.
