# Audio (`src/engine/audio/`)

## Sound effects and music

`ctx.audio` is an `AudioManager`. Sounds are **data**: a `SoundDef` is rendered once to a
buffer by pure, seeded synthesis (`synth.ts`, unit-tested), so it sounds the same everywhere.

```ts
ctx.audio.play('jump');                          // built-in SFX (sfx.ts)
ctx.audio.play('coin', { pitch: 2, volume: 0.5, pan: -0.3 }); // semitones, 0..1, -1..1
ctx.audio.register('laser', {
  wave: 'square', duty: 0.125,                   // square | triangle | saw | sine | noise
  freq: 1400, freqEnd: 300,                      // exponential pitch sweep (Hz)
  attack: 0.002, sustain: 0.04, decay: 0.12,     // envelope, seconds
  volume: 0.3, arp: [0, 7], arpRate: 0.05,       // optional arpeggio (semitones)
  layers: [{ wave: 'noise', freq: 4000, decay: 0.05, volume: 0.1 }],
});
ctx.audio.playMusic(MY_SONG, 'level1');          // loops; playMusic(null) stops
await ctx.audio.load('door', 'assets/door.ogg'); // optional audio files, then play('door')
ctx.audio.setVolume('music', 0.4);               // 'master' | 'sfx' | 'music', persisted (not during a replay)
ctx.audio.toggleMute();                          // also the settings' Sound box (and, with ?debug=1, M)
```

Built-in SFX: `jump`, `doubleJump`, `land`, `coin`, `step`, `skid`, `punch`, `groundPound`,
`whoosh`, `hurt`, `fanfare`. A song is patterns of note strings per track:

```ts
const MY_SONG: Song = {
  bpm: 140,                                      // stepsPerBeat defaults to 4 (16ths)
  tracks: {
    lead: { wave: 'square', duty: 0.25, decay: 0.08, volume: 0.13 },
    bass: { wave: 'triangle', decay: 0.06, volume: 0.3 },
    drums: { wave: 'noise', decay: 0.05, volume: 0.1 }, // noise: pitch = hiss (C6 snare, C8 hat)
  },
  patterns: {
    a: { lead: 'C5 . E5 . G5 - - .', bass: 'C3 . . . G2 . . .', drums: 'C6 . C8 . C6 . C8 .' },
  },
  order: ['a', 'a'],                             // '.' rest, '-' hold the previous note
};
```

`parseSong` throws on a typo (bad note, uneven pattern), so `npm test` catches it. Browsers
allow sound only after a user gesture: the AudioContext is created on the first key /
pointer / touch input (`touchend` / `click` on iOS), and the engine keeps listening until it
is actually running; it resumes again after the tab comes back or iOS interrupts audio
(at the next input if the browser insists on one). Before that, and without Web Audio (headless), every call is a
silent no-op that still counts plays in `audio.counts` / `audio.log`, so tests can assert on
sounds. Volumes and mute live in `localStorage` per game, beside its settings
(`pixel-engine:audio:<settings key>`, `audioStorageKey`; no key, as in the labs: this session
only), with try/catch. 52in1's games share one origin, so no key is shared: a game with no volumes
of its own yet takes those of the key every game once shared (`pixel-engine:audio`) once, saves them
as its own, and never writes that key.

Hero sounds without touching the character: compare `hero.stats`, `hero.state`,
`hero.jumpKind` and `hero.anim` with last step's values in `fixedUpdate`, as
`Playground.heroEvents` does.

## Sound in space: `spatialize`, looping voices

```ts
const hum = ctx.audio.loop('hum', { volume: 0 });            // a looping voice (a name or a SoundDef)
const s = spatialize({ position: ears, right: cameraRight }, source, { ref: 1.5, max: 20, rolloff: 1 });
const blocked = ctx.physics.raycast(ears, dirToSource, s.distance - 1, NOT_HERO) !== null; // const NOT_HERO = ['character']
hum.set({ volume: s.gain * (blocked ? 0.5 : 1), pan: s.pan, muffle: blocked ? 0.85 : 0 });
hum.stop();                                                  // when the level goes (unloading stops loops too)
```

`spatialize` (pure) gives the gain (full inside `ref`, then inverse distance with `rolloff`,
faded to silence over the last fifth before `max`) and the pan (the sideways share of the
direction, eased to the middle inside `ref` so a sound on top of you never flips ears).
`AudioManager.loop` plays a buffer on repeat through a low-pass filter (`muffle` 0..1 closes it
from 20 kHz to 400 Hz), a gain and a stereo panner; `set` glides (a 30 ms time constant, no
clicks) and `stop` fades out before it lets go of the chain. Before the first input, or
headless, a voice keeps its settings silently (`voice.settings`, `audio.loops`) and starts once
audio unlocks (or its sound is registered: an unknown name is warned about once). A looped
`SoundDef` wants `attack: 0, decay: 0` (a fade would dip at every repeat).

## Buses and the player's 52in1 volumes

Every sound plays on one of three buses under the game's master gain: `sfx` (the default:
every sound but music, looping voices included), `music` (songs, and music from audio files:
`play('theme', { bus: 'music' })`, `loop('theme', { bus: 'music' })`) and `speaker` (the
controller's speaker, below). Nothing else makes sound: `npm run lint` refuses an
`AudioContext`, `new Audio()`, `createElement('audio' | 'video')` or `speechSynthesis` outside
`AudioManager.ts`.

In 52in1 (`window.AIHubSettings`, docs/engine/hub.md *The player's settings*) the engine sets
`audio.setHubVolumes({ music, effects })` at start and on every `change`: the music bus plays at
the game's own music volume × the hub's `music`, the sfx and speaker buses at its sfx volume ×
`effects`. The game's own volumes and mute stay and multiply; the hub's are never stored, never
recorded, and never a master volume (the hub applies its master itself, in front of the
speakers). `audio.levels` is what the gains are (`{ master, sfx, music }`, headless too) and
`audio.hubVolumes` the hub's part (1 and 1 outside the hub).

52in1's companion script, first in every game page the hub serves, holds a game's AudioContext
while the hub's cards are up (a game night's round loads under them) and gives it back as the round
starts. It knows the context by a source started in it (any source's `start`, an
AudioBufferSourceNode's own too, since 52in1 `a6139e95`); as `unlock` makes the context it also
starts and stops a silent ConstantSourceNode, connected to nothing, so the companion knows it at once
(`src/engine/hub/companion.test.ts` runs the real one). A resume the hush holds back waits; a hush
lifted while the companion's suspend is on its way gives the context back once that settles; a
context suspended otherwise re-arms the unlock listeners, so the next input brings the sound back.

The `speaker` bus plays from a DualSense's speaker while the player allows it
(`dualsense.speaker`): the engine hands `audio.useSpeaker` the hub's `openSpeaker`, which gives a
node in the game's AudioContext once audio unlocks. Until then, and without one (an opener that
throws or gives no node too: audio still unlocks), the bus plays with the other sounds at the same
volume (`audio.speakerRouted` says which). Use it for what
belongs in the player's hands: a radio call, a reload, a ringing phone. `audio.speakerPlaying(tail)`
says a sound plays from the controller's speaker (routed there), or ended less than `tail` seconds
ago: the engine's microphone, beside it on a DualSense, counts no shout then (docs/engine/hub.md
*Shouts*).
