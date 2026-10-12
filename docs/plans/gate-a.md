# Gate A prompts (docs/plans/asset-system.md §12)

The exact prompts the token benchmark gives its subagents, so Phase 8 can run it again the same
way. `<BRIEF>` is one of the four briefs, `<DIR>` is `.scratch/gate-a/<brief>-<arm>-<run>` and
`<REL>` is the path from `<DIR>` back to the repository root (`../../..`).

Briefs: `hand-cart` "a two-wheeled hand cart"; `archway` "a stone archway"; `campfire` "a campfire
ring with logs and stones"; `weapon-rack` "a weapon rack holding three weapons".

## Arm (a): code on the town Kit

> Build one 3D model for Riftlight, a pixel-art action game drawn at 480×270 through an isometric
> camera, by writing TypeScript for the town construction kit.
>
> Brief: <BRIEF>.
>
> Work only in the folder <DIR> (create it). Read src/riftlight/town/kit.ts (the Kit API), the
> header of scripts/gate-a.ts (the harness) and src/engine/palette.ts (colour names), and no
> other files outside <DIR>. Write <DIR>/model.ts:
>
>     import type { Kit } from '<REL>/src/riftlight/town/kit';
>     export function build(kit: Kit): void { ... }
>
> Build the object at the origin, standing on y = 0, its front facing +Z, in metres (the hero is
> 1.75 m tall), in PALETTE colours. Then run `npx tsx scripts/gate-a.ts kit <DIR>/model.ts`: it
> prints inspect warnings and writes <DIR>/model.png, a turntable and the game-scale previews (how
> it reads in the game, ×4). Open the PNG and look at it. Repeat (edit, run, look) until there are
> no warnings and you judge that the game-scale preview clearly reads as the brief. Don't edit
> files outside <DIR>. When done, reply with one line: the file path and what you built.

## Arm (b): a ModelDef with the seed library

> Build one 3D model for Riftlight, a pixel-art action game drawn at 480×270 through an isometric
> camera, by writing a ModelDef (a model as data).
>
> Brief: <BRIEF>.
>
> Work only in the folder <DIR> (create it). Read src/engine/model/types.ts (the format), the seed
> library in src/engine/model/library/ (examples), src/engine/palette.ts (colour names) and the
> output of `npm run model -- help`, and no other files outside <DIR>. Write <DIR>/model.ts:
>
>     import { model } from '<REL>/src/engine/model'; // also: around, rowOf, gridOf, scatterOf, boxFrame
>     export default model({ id: '<BRIEF>', ... });
>
> Build the object standing on y = 0, its front facing +Z, in metres (the hero is 1.75 m tall).
> Then run `npm run model -- check <DIR>/model.ts` and
> `npm run model -- sheet <DIR>/model.ts --out <DIR>`: the sheet writes <DIR>/<BRIEF>.png
> (turntable, front / side / top on a 0.1 m grid, the game-scale previews, warnings). Open the
> PNG and look at it. Repeat (edit, check, look) until check reports no problems and no warnings
> and you judge that the game-scale preview clearly reads as the brief. Don't edit files outside
> <DIR>. When done, reply with one line: the file path and what you built.

## Judge

The judge images come from `npx tsx scripts/gate-a.ts judge <DIR>/model.ts` for the median run
(by tokens) of each arm: a turntable and the game-scale previews, nothing else.

> Two 3D models were made for the same brief for Riftlight, a pixel-art game drawn at 480×270
> through an isometric camera: "<BRIEF>". Each image shows the model from 8 angles (top row) and as
> it reads in the game (bottom row: the game's own pixels, ×4).
>
> Image 1: <path>. Image 2: <path>.
>
> Open both images. Which better fulfils the brief and reads better at game scale (silhouette,
> recognisable parts, colours that separate, proportions)? Call it a tie if neither is clearly
> better. Reply with one line: "1", "2" or "tie", a dash, and one sentence why.

The order of the two images is decided by a seeded coin per brief:
`new Rng('gate-a:<brief>').next()` below 0.5 shows arm (a) as image 1, otherwise arm (b). The
judge isn't told which arm is which.

## Scoring (§12)

- Tokens per run: the `subagent_tokens` figure in its Agent-tool completion notice.
- Per brief and arm, the median of the 3 runs; R = Σ medians(b) ÷ Σ medians(a).
- Pass if R ≤ 0.8 and (b) wins or ties in at least 3 of 4 briefs, or R ≤ 1.0 and (b) wins
  outright in at least 3 of 4. Otherwise fail: stop, record the numbers and escalate.
- Record with the numbers: the arms' "done" differs as §12 sets it. Arm (a) clears
  `inspectObject`'s warnings (asset hygiene); arm (b) clears every `model -- check` warning,
  including readability rules (floating parts, rods, lightness contrast) that arm (a) never sees.
