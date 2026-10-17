---
paths:
  - "src/riftlight/**"
  - "scripts/riftlight/**"
  - "scripts/e2e-riftlight*.mjs"
---
# Riftlight (auto-loaded when you open these files)

Must not break (docs/GAME.md *The design language*):
- Gameplay is data: content is a `Registry` entry (`id`, `tags`, `weight`); generators query by tags.
- Every bonus is a `Mod` through a `StatSheet`; stat names are canonical (`core/stats.ts`).
- Seeds all the way down: `Rng` forked by purpose, never `Math.random`.
- Depth scaling lives in `core/scaling.ts` only.
- The shell reaches gameplay only through ports (`game/ports.ts`), implemented on the real systems in `wire/`.
- Lights are requests to the engine's pool; no runtime `PointLight`.
- Every system keeps a saved state (`save`/`load` beside its code); `Riftlight.snapshot` / `restore`
  carry it (docs/game/save-states.md); `Riftlight.fingerprint` holds what a replay must match.
- Input goes through `ctx.input` (data from the page through `ctx.input.send`) so sessions replay.
- Check with the system's CLI (`npm run monster|loot|tree|level|combat|balance|playtest`), and a
  playtest or film for anything that plays.

Docs for a folder (docs/GAME.md is the index): `core/` → docs/game/core.md · `combat/`, `skills/` →
combat.md · `actors/` → actors.md · `monsters/` → monsters.md, monster-parts.md · `levels/` →
levels.md; `levels/themes/`, `levels/mechanics/` → mechanics.md · `tree/` → tree.md · `loot/`,
`ui/items/` → loot.md · `balance/` → balance.md · `game/` → shell.md (snapshots: save-states.md) ·
`ui/` → ui.md · `wire/` → wire.md · `town/` → town.md · `showcase/` → showcase.md.
