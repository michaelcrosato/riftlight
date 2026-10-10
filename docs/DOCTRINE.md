# Agent-First Game Engine: Doctrine

The direction this repository is built in. [AGENTS.md](../AGENTS.md) is the procedure that
carries it out; where the two disagree today, *Where this repository stands* at the end says why.

## How to read this

Written for a capable, trusted builder. It sets direction, not procedure. When departing from it
is better, do so through *Escalation* and say why. Rules and principles stay flexible; escalation
is the process that keeps them so.

## North star

An engine built from the ground up for AI coding agents to develop, test, inspect and debug
directly. Human-centric tooling, and any way of working agents cannot use well, is left behind.
Humans set direction and review outcomes; agents do the work. The result: games built faster,
more consistently and better than with general-purpose engines retrofitted for agents.

A fully autonomous fighter jet with no cockpit: removing the pilot removes the constraints a pilot
imposes on the design. The ground still gets telemetry: every change leaves something a person
can judge in a minute (a capture or a short film, a playable link, a few lines on what changed and
how it was checked).

Optimize for the best expected overall output, not flawless software. Build what a real need asks
for, when it surfaces, not in anticipation.

## Principles

1. **Gameplay is data.** All gameplay state is plain, serializable data owned by one simulation:
   entities, timers, AI memory, the random generator. Systems advance it in fixed ticks from
   (state, inputs); rendering, audio and UI read it and own nothing gameplay depends on. Time and
   randomness come only from the simulation. On the development platform, the same state, seed
   and input log give the same result tick for tick; any state can be saved, restored and
   replayed, and a recorded bug becomes a test.
   *Why: reproducing, inspecting, testing without a display, saving and replaying all follow from this one rule.*

2. **Headless and verified.** Gameplay runs without a renderer or a browser. Everything can be
   run, inspected and verified with no screen and no one watching: by numbers (state queries,
   metrics) and by looking (captured frames, which agents read as images). A check is shown to
   fail when the thing it checks breaks before it is trusted. Work is verified by someone other
   than its author; another agent counts.

3. **Agent-operable.** Every capability has a machine interface: step N ticks, query state, inject
   input, capture a frame, save, load, replay. A GUI exists only where nothing else can do the job,
   and is never the only way.

4. **Agent-readable.** One obvious way to do each thing. Content is data with a schema; behaviour
   is small named functions; names are unique enough to search for. Docs sit next to the code and
   are tested so they cannot drift. Errors go where agents read them, never swallowed.

5. **Agent-editable assets.** Source assets, in order of preference: (1) procedural, code and data
   that generate the asset; (2) text and data agents edit directly; (3) binary, only with human
   approval (approved: fonts, WOFF2 / TTF / OTF). Files a script generates from source are build
   output, not source.
   *Why: agents work best with code and data, and get better at that faster than legacy asset tools get better for agents.*

6. **WebGPU only; gameplay on the CPU.** One renderer, and one runtime for development: WebGPU in
   headless Chromium on the development platform. GPU work is presentation only; nothing it
   computes feeds gameplay state. Native runtimes are a production concern.

7. **Common ground.** Everything game code touches uses widely used languages, libraries, systems
   and patterns. Favor flexibility, ease of use and established approaches over peak performance
   and capability. Build the Sherman, not the Tiger.
   *Why: lean into what agents already do well rather than trying to change it.*

8. **Quality under the hood.** Engine internals, code whose API game code never sees, use the
   highest-quality approach their builder can execute well, however complex. Reuse what others
   built well; invest heavily in what is ours. The north star decides *what* to build; this
   decides *how well*.
   *Why: the engine is built once and used many times, so better internals raise everything built on it.*

9. **Mastery over novelty.** Use the newest version that is at least 12 months old, so agents know
   it deeply. A newer version that works the same way (backward compatible, or otherwise
   unchanged in use) is adopted at once, since what agents know still applies. Internals may use
   newer versions when that raises quality and the builder can use them well. Upgrade as versions
   qualify.

10. **Discovery first, hardening later.** Build and test against the development platform only.
    Cross-platform support, tuning on real hardware and hardening come when a game goes to
    production. Measure performance; don't guess it.
    *Why: most of the work is finding something worth shipping.*

## Escalation

Two kinds of decision:

- **Reversible** (most of them, departures from this doctrine included): escalate with your
  reasoning. With no response in 15 minutes, commit work in progress to a branch, make the call
  and continue. For the rest of that run, or until a human responds, report further conflicts
  without stopping.
- **Irreversible or outside the project**: spending money, credentials and accounts, licences and
  legal terms, publishing or contacting anyone outside the team, deleting data or shared history.
  Escalate and wait; work on something else meanwhile.

Record every escalation, every later conflict and every call made without a response in one place:
a GitHub issue labelled `escalation`, linked from the PR it concerns, so each can be found and
reviewed.

*Why: progress never stalls on what can be undone, and nothing that cannot be undone happens unseen.*

## Where this repository stands

The doctrine was adopted mid-project (engine 0.14). Known gaps, and what is decided about each:

- **Principle 1 (gameplay is data): in progress.** Done: randomness is seeded (`ctx.random`,
  `?seed=`) and time is game time; the lint refuses `Math.random` and unmarked wall clocks;
  every level's input is recorded and replays to the same state (`engine.recording()`,
  `engine.replay()`, `engine.fingerprint()`), which is also how a moment is saved and restored
  today (replay to frame `n`). Not yet: snapshots of the state itself, which make restoring a
  long session instant. Rapier can snapshot its world exactly, but a restored world replaces the
  body handles games hold, so they wait on gameplay state being data. Gameplay state still
  lives in many places (physics bodies, three.js objects, behaviour-tree nodes, timelines, game
  and room code); new systems keep theirs serializable where they reasonably can.
- **Principle 6 (WebGPU only): not yet, on evidence.** Headless Chromium on the development
  platform loses the WebGPU device as soon as a canvas presents (measured; escalation
  [#46](https://github.com/michaelcrosato/riftlight/issues/46)), so the WebGL 2 fallback is the
  only way to run and verify a game with no display (the kit's `check.mjs` defaults to it), and
  it keeps the published game open to players without WebGPU. It stays, and every rendering
  change keeps both e2e scenarios green (AGENTS.md), until headless WebGPU presents in the
  Chromium we pin or every agent environment has a display (Xvfb).
- **Principle 5 (assets): met.** The only binary files are `public/assets/*.glb`, generated by
  `scripts/generate-assets.mjs` (build output). Sounds and music are synthesised from data; the
  HUD font is data.
- **Principles 2 to 4 (verification, machine interfaces, readability): largely met** through
  `window.__PIXEL_ENGINE__`, `window.__WORLD__`, `Engine.step()`, `renderer.capture()`, the e2e
  suites and tested docs; the gameplay-without-a-browser part waits on principle 1.
