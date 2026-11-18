# The AI Hub's session harness (vendored)

`harness.html`, `bridge.js` and `round.js` are the AI Hub's own conformance harness for its Session
Protocol v1, copied unmodified from
https://github.com/michaelcrosato/52in1/tree/main/lib/hub, published at
https://52in1.com/lib/hub/ (52in1 runs the same checks when a game joins its library). The e2e
suite `hub` (`scripts/e2e-hub.mjs`) serves them next to the built page and plays it in each session
mode (docs/game/session.md). Refresh them from that folder when the hub's protocol moves on, with
`scripts/hub/session.js` and `scripts/hub/catalogue-check.mjs`; never edit them here.
