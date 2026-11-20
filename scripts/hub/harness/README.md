# The AI Hub's session harness (vendored)

`harness.html`, `bridge.js` and `round.js` are the AI Hub's own conformance harness for its Session
Protocol v1, copied unmodified from
https://github.com/michaelcrosato/52in1/tree/main/lib/hub, published at
https://52in1.com/lib/hub/ (52in1 runs the same checks when a game joins its library). The e2e
suite `hub` (`scripts/e2e-hub.mjs`) serves them next to the built page and plays it in each session
mode (docs/game/session.md); the suite `bundle` plays the engine kit's Gem Rush page in one round. Refresh them from that folder when the hub's protocol moves on, with
`scripts/hub/session.js`, `scripts/hub/companion.js` and `scripts/hub/catalogue-check.mjs`; never edit them here.

`scripts/hub/companion.js` is the script 52in1's Worker puts first in every game page it serves (its
`cloudflare/worker.js`): the hub's side inside the game's frame (the hush under the hub's cards, the
wake band, the pads, the player's settings as `window.AIHubSettings`, the DualSense). The `hub`
suite serves the built page with it, as the Worker does (`scripts/e2e-hub-companion.mjs`, which also
plays the hub page's side, 52in1's `assets/js/ui/frames.js`, at the same commit; docs/game/hub.md
*In 52in1's frame*).

`scripts/hub/LICENSE` is `lib/hub/LICENSE` (MIT, blob `3b9c8c68416f194a1a1a6aa3327a4bd952b96145`, added in 52in1 `b59a5fcd`): the
licence of every file here.

All six are 52in1's `lib/hub/` at commit `a411757e2f5e6be6081acdebe41743bd7398b460` (`main`,
2026-11-20; session client 1.4.0), byte for byte: `git hash-object` on each gives that commit's blob
(companion.js: `f9fb30ed90e4da3f245420c4b26d3cfd9c3711c4`, with the fixes from #196: it wraps a
buffer source's own `start`, gives back a context whose suspend was still on its way when the hush
lifted, and wakes on a touch at `clientY` 0).
