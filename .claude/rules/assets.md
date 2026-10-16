---
paths:
  - "src/engine/model/**"
  - "src/engine/texture/**"
  - "src/engine/catalog.ts"
  - "src/engine/assets.ts"
  - "scripts/model.ts"
  - "scripts/tex.ts"
  - "scripts/packs.ts"
  - "scripts/trace/**"
  - "public/packs/**"
---
# Models and textures (auto-loaded when you open these files)

Must not break:
- Models and textures are data (`ModelDef`, `TextureDef`), never binaries written by hand.
- Search before you write (`npm run model -- find <words>`, `npm run tex -- find <words>`); compose
  library models with `use` before creating; vary with `use` + `scale` / `palette`, never a copy.
- After every change look at the sheet (`npm run model -- sheet <id> --compare`,
  `npm run tex -- sheet <id>`) and keep `npm run model -- check` and `npm run tex -- check` clean.
- Style: PALETTE slots only, hero 1.6 m, rods ≥ 0.06 m, touching parts take different colours,
  glow only for small hot spots, flames face the camera (never turn `flame` about Y), low poly.
- Textures at `DEFAULT_TEXEL` 8 for surfaces the camera zooms over; few texel edges.
- Third-party content only from an approved `PACK_SOURCES` entry (#49); an agent never writes or
  links an approval itself. Every import carries `source` (url, licence).
- docs/GUIDE-ASSETS.md (the kit's ASSETS.md) changes with the format and rules too.

Docs: the loop, format, checks, style rules, in a game → docs/ASSETS.md; textures and texel density →
docs/assets/textures.md; glTF/GLB, packs, licences, PNG sheets → docs/assets/importing.md;
`trace.ts`, `scripts/trace/` → docs/assets/tracing.md.
