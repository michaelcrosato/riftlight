---
paths:
  - "src/engine/animation/**"
  - "src/engine/character/**"
  - "src/game/hero/**"
  - "src/lab/**"
  - "scripts/anim.ts"
  - "scripts/film.ts"
  - "src/riftlight/town/npc*.ts"
---
# Animation (auto-loaded when you open these files)

Must not break:
- Never guess a pose. Clips are data (`src/game/hero/clips/<family>.ts`, listed in `HERO_CLIPS`).
- After every change: `npm run anim -- check` (exit 1 on problems), then look at the contact sheet
  and motion curves (`npm run anim -- sheet <clip> --compare`, `curves <clip> --compare`).
- Anything that plays in the game: also look at a film (`npm run film -- <scenario>`); it shows
  transitions, blends and speed matching that isolated clips can't.
- Cross-fades go through `RotationBlend` (never flips a joint); a new character state is one entry
  in `STATES` (`character/states.ts`) plus its numbers in `TUNING` (`character/tuning.ts`), then film it.
- Moving a combat hit in a clip moves it in `COMBAT_TIMING` too.
- Townsfolk clips: `npm run anim -- check` covers them; `--character <id>` for sheet / curves.

Docs: clips, metrics, tools, runtime layers → docs/ANIMATION.md; the moveset, states, tuning →
docs/engine/character.md; `animation/procedural.ts` → docs/engine/procedural-motion.md;
Riftlight's hero on screen → docs/game/actors.md; monster clips (`src/riftlight/monsters/anim/`) →
docs/game/monster-parts.md.
