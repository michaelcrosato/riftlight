# The AI Hub's session harness (vendored)

`harness.html`, `bridge.js` and `round.js` are the AI Hub's own conformance harness for its Session
Protocol v1, copied unmodified from
https://github.com/michaelcrosato/ai-hub/tree/main/lib/hub (the hub runs the same checks when a
game joins its library). The e2e suite `hub` (`scripts/e2e-hub.mjs`) serves them next to the built
page and plays it in each session mode (docs/game/session.md). Refresh them from that folder when
the hub's protocol moves on; never edit them here.
