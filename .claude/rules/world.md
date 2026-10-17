---
paths:
  - "src/world/**"
  - "scripts/e2e-world.mjs"
---
# Engine World (auto-loaded when you open these files)

Must not break (docs/WORLD.md):
- Every room is its own `Game`, loaded with `engine.loadGame`; a room never leaks into the next
  (`src/world/rooms.headless.test.ts` checks the Atrium's physics and scene counts after every room), and any
  room opens on its own from the URL (`?game=world&room=<id>`).
- Rooms are mostly data: a `RoomDef` (card, guide, camera, look, spawn, `build`) built with
  `room.kit`; title ≤ 24 characters.
- A guide is whole: what is on screen, how the engine does it in 4-6 steps, real games, phrases to
  ask for it, the cost, the engine's real code; new words go in `glossary.ts` (`npm test` checks).
- A new room is listed in `rooms/index.ts`; check it headless (`npx vitest run src/world`, helpers in
  `src/world/testWorld.ts`), then its frame: `npm run build && npm run test:e2e -- world`.

Docs: rooms, the shell, the kit, `window.__WORLD__` → docs/WORLD.md. Each technique's engine doc is in
docs/ENGINE.md's index (e.g. physics rooms → docs/engine/physics.md). The Asset Gallery and
Workshop (`rooms/gallery.ts`, `workshop.ts`) → docs/ASSETS.md *Finding assets*.
