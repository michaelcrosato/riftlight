# Determinism: randomness, replay, save-states, rewind

## Randomness and determinism

```ts
ctx.random.range(-7, 7); ctx.random.int(1, 6); ctx.random.chance(0.3); ctx.random.pick(list);
const loot = ctx.random.fork('loot');   // its own stream: unaffected by how many numbers others drew
```

Everything random in a game comes from `ctx.random`, an `Rng` (`src/engine/random.ts`,
mulberry32, `fork` by purpose) the engine reseeds before each level's `setup` from its seed and
the game's name: the same seed (`EngineOptions.seed`, `?seed=`, default 1; `state().seed`) and
inputs give the same game. Particle bursts draw from a fork of it too. Game time is `ctx.time`.
Draw from `ctx.random` in `setup`, `fixedUpdate` and event handlers (triggers, input); randomness
drawn per rendered frame in `update` (cosmetic) comes from a fork made in `setup`, so the frame
rate never changes what gameplay draws.
`npm run lint` refuses `Math.random` and refuses `Date.now()` / `performance.now()` unless the
line says why it needs real time (`// real time: <why>`: measurements, UI clocks, timestamps);
interactive tools in `src/labs/` are exempt (docs/DOCTRINE.md, principle 1).

**Recording and replay** (`src/engine/replay.ts`). The engine records every level it runs, from
its start: the seed, the game's name, the game time it began at and each frame's input (held keys,
with gamepad and mouse buttons as keys, presses, sticks, pointer, wheel, gamepad connected, touch,
button presses and releases with where the pointer was, commands, `dt`), only what changed, and
whether promise callbacks ran before the frame.

```ts
const rec = engine.recording();                                   // plain JSON: save it, attach it to a bug
await engine.replay(rec, () => engine.loadGame(new Level1()));    // seed and time restored, every frame replayed
engine.fingerprint();                                             // hash of game time, physics (bodies, colliders), ctx.random, Game.fingerprint
ctx.input.send({ kind: 'load', data: store.load(slot) });         // data from the page: delivered (and recorded) next frame
for (const c of ctx.input.commands) apply(c);                     // in update (they last one frame): live or replayed
```

**Data from outside the canvas** (a save read from storage, a text field's value, a file the
player picked, a setting from `localStorage`) enters through `ctx.input.send(data)`: it arrives
in `ctx.input.commands` at the next frame the game runs, the recording keeps it with that frame,
and a replay delivers the recorded data there (what is sent live during a replay is ignored).
Commands last one rendered frame, so read them in `update` (`fixedUpdate` runs zero or more
times a frame); a game may change what it got without changing the recording.
It goes through JSON first, so live play reads exactly what a replay will. A game that takes
such data straight from the page instead does not replay: the page may hold something else by
then. **`Game.fingerprint(ctx)`** adds the game's own state (what lives outside physics and
`ctx.random`: positions, life, counters, its own random streams) to `engine.fingerprint()`.

`replay(rec, start, { frames })` loads the level with `start` (without a transition: nothing
advances during a replay, so a `start` that waits on frames never finishes, and a warning says
so after 10 s), plays the frames in manual time (`step()`) and leaves the level there, still
manual, its recording carried on by whatever is stepped next. Promise callbacks (`await
tween.done`) run between the same frames as in the recorded run; live input is ignored while it
plays and nothing it held stays held after; a recorded menu's volume changes play but are not
written (`ctx.audio.persist` is off), and the player's volumes come back when it ends; a game
hook's exception is reported and the replay goes on, as in live play. That is also how a moment is saved and restored: keep the recording,
replay it to frame `n`, then play on differently from there (a replay runs without rendering, so
it is as fast as the simulation). A replay that ends with the run's `fingerprint()` shows the
level is deterministic. A script that steps a level and awaits between steps should yield a
task (a separate `page.evaluate`, `setTimeout`), not just a promise: a replay waits a whole task
wherever promise callbacks ran, so a game's longer promise chains would get further than they did.
The World suite checks a scripted run, a run replayed to a frame and
played on, and live play at the browser's own pace with a pause and a tween's promise
(`scripts/e2e-world.mjs`); an edited recording shows the check can fail. Each level gets a fresh
physics world (Rapier keeps internal state a cleared world would carry), so a level plays the
same whatever ran before.

What a replay can't reproduce: anything a game takes from outside `ctx.input` and its frames (DOM
events it listens to itself, a model that finishes loading mid-play, the wall clock, camera state
left by the level before, engine hotkeys pressed while recording, calls a test makes between
frames). The pointer is recorded where it was on the canvas, so what it pointed at in the world
replays only with the same camera: the same view size (`renderer.resolution`) and the game's
own camera settings. A game that swaps stages inside one `Game` has one recording for all of
them, from its `setup`. Without `Game.fingerprint`, `fingerprint()` leaves out the game's own
state outside physics and forks of `ctx.random`. `EngineOptions.record` sets how
many frames a level keeps (default `MAX_FRAMES`, an hour at 60 fps; 0 records nothing);
`recordingProblem(v)` says why a value is not a recording.

## Save-states

```ts
const snap = await engine.snapshot();    // the running level as JSON, between frames
engine.step(600);                        // ...play on
await engine.restore(snap);              // back to that moment at once, nothing replayed
engine.recording().from === snap;        // the recording starts again from it: replay() restores it first
```

A snapshot (`src/engine/snapshot.ts`) is the engine's part of a running level (game time, the
clock's speed and hitstop, `ctx.random`, the fixed step's accumulator, the whole Rapier world as
Rapier's own snapshot with the collider tags, conveyor belts and force fields' `enabled` beside
it, the camera rig, the shake, held keys, presses still queued with their age, the pointer, data
sent and not yet delivered) and the game's own, from `Game.snapshot(ctx)`: plain data, which
the game returns as it is (never through JSON). Numbers JSON can't hold exactly (`-0`,
`Infinity`, `NaN`) are marked as strings (and a game's own string starting with `@` gets one
more), so a snapshot survives `JSON.stringify` bit for bit (`encodeState` / `decodeState`).

`restore(snap)` needs the same game already loaded (by name). It holds the frame loop, calls
`Game.beforeRestore(ctx)` (leave a mode with a camera of its own, close dialogs), lets the
running timeline's tweens finish there (their continuations run on the state about to be
replaced, never on the restored one), checks the camera preset, builds the saved physics world,
puts the engine's part back (the camera keeps this screen's aspect; in live play held keys are
let go, the keyboard's own come back) and calls `Game.restore(ctx, state)`, which may be async.
All or nothing: if anything throws, the engine's own part goes back as it was (the game's
restore keeps its own whole, e.g. by checking before it changes anything). Bodies keep their
handles, so a game finds its own again with `ctx.physics.world.getRigidBody(h)`; a mesh bound
to a body the snapshot doesn't have (a newer body in an old one's slot included) is let go. Playing on from a restored snapshot plays the
same as playing on from the moment it was taken: every state a later frame reads (the World
suite checks it, and that a snapshot with another moment's physics ends elsewhere, a tween at
restore time, a body bound after the snapshot, a restore that fails). Particles and light
flicker are pictures, not state: they are not kept. `snapshot()` waits a task first, so the
last frame's promise callbacks have run, and refuses with the reason while a tween runs (its
callbacks are code), for a game without the hooks, or with physics that lives outside the
Rapier world (character or vehicle controllers, movers, triggers, step listeners). A recording
made after a restore carries it (`from`), so a bug caught after a save-state is a snapshot and
its frames: `replay(rec, start)` loads the game, restores the snapshot, plays the frames.

## Time rewind

```ts
const rewind = new Rewind(physics, { seconds: 6 });
rewind.trackAll();                                   // or track(body, …)
rewind.extra(() => hero.feetInto(feet).toArray(), (v) => hero.teleport([v[0]!, v[1]!, v[2]!])); // anything else
// (teleport lifts the feet by TUNING.body.spawnLift, 3 cm, character/tuning.ts: the Time Lab takes it off)
rewind.rewinding = input.isDown('KeyR');             // per step or frame; rewind.fill is the history left
```

`physics/rewind.ts` records every tracked body's position, rotation, velocities and sleep after
each physics step in a ring buffer; while `rewinding`, each step shows the record one step
older instead (holding at the oldest), and letting go carries on with that moment's velocities
(a body that slept then sleeps again). With the hotkeys on (`?debug=1`) R is the engine's
resolution key: move it (`engine.debugKeys = rebindDebugKeys(engine.debugKeys, { resolution: 'F7' })`,
as the Time Lab does).

Step listeners (`physics.onStep(f)`) run after each step in the order they were added, and all
of them before bound meshes (`bind`) read their bodies, so a body a listener moves is drawn
where it put it. `onStep(f, { first: true })` runs ahead of the others: `Rewind` puts bodies
back there, so instanced bodies and ragdolls (listeners themselves) see the rewound pose too.
