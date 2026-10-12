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
judge isn't told which arm is which. Its paths mustn't tell it either: copy the two images to
`<brief>-1.png` and `<brief>-2.png` in a folder whose path names neither arm (the first run
gave the judges paths ending `-a-3/` and `-b-2/`; see *Results*).

## Scoring (§12)

- Tokens per run: the `subagent_tokens` figure in its Agent-tool completion notice.
- Per brief and arm, the median of the 3 runs; R = Σ medians(b) ÷ Σ medians(a).
- Pass if R ≤ 0.8 and (b) wins or ties in at least 3 of 4 briefs, or R ≤ 1.0 and (b) wins
  outright in at least 3 of 4. Otherwise fail: stop, record the numbers and escalate.
- Record with the numbers: the arms' "done" differs as §12 sets it. Arm (a) clears
  `inspectObject`'s warnings (asset hygiene); arm (b) clears every `model -- check` warning,
  including readability rules (floating parts, rods, lightness contrast) that arm (a) never sees.

## Results: the Phase 2a run (2026-10-12)

**Failed.** The plan stops. Escalation [#54](https://github.com/michaelcrosato/riftlight/issues/54)
recommends keeping Phases 1–2a and asks a human to choose: stop there, fix what lost and run Gate A
again, or revert.

| Brief | Arm (a) runs | Median (a) | Arm (b) runs | Median (b) | b ÷ a |
| --- | --- | --- | --- | --- | --- |
| hand cart | 80,855 · 86,611 · 81,421 | 81,421 | 85,643 · 91,429 · 92,754 | 91,429 | 1.12 |
| stone archway | 83,710 · 85,729 · 84,031 | 84,031 | 85,772 · 94,467 · 89,968 | 89,968 | 1.07 |
| campfire ring | 151,330 · 156,088 · 150,373 | 151,330 | 113,683 · 95,442 · 113,186 | 113,186 | 0.75 |
| weapon rack | 92,042 · 133,393 · 117,234 | 117,234 | 132,202 · 135,764 · 126,871 | 132,202 | 1.13 |
| **Σ medians** | | **434,016** | | **426,785** | **R = 0.983** |

Most of every run is fixed overhead. The judges, which only read their prompt and open two images,
used 64.5–65.8k, an upper bound on it. Take 60–65.6k off each median and (b) ÷ (a) is 0.96.

**Done differed, as §12 sets it.** Arm (a) cleared `inspectObject`'s hygiene warnings. Arm (b) also
had to clear warnings arm (a) never sees, and did: lightness, the triangle budget and a hidden part
(campfire), z-fighting, and moss too close in lightness to stone (archway). Every run ended at its
arm's "done".

**Judging.** The judged models are the median runs, kept as source: `gate-a/<brief>-a.ts` and
`gate-a/<brief>-b.ts`. `npx tsx scripts/gate-a.ts judge docs/plans/gate-a/<brief>-a.ts` redraws each
judge image byte for byte (`*.judge.png` is build output, ignored by git).
- The coin put arm (a) first in all four briefs, a 1 in 16 chance.
- The first two sets of judges were given the images by paths that named the arm (`…-a-3/`,
  `…-b-2/`). They weren't told what a and b meant, but the label was visible.
- So three sets of fresh judges ran. The protocol set decides the gate. The swapped set (the order
  reversed) and the neutral set (the images copied to `<brief>-1.png` and `-2.png`, in the protocol
  order) are outside the protocol and only test it.

| Brief | Protocol: (a) first, labelled paths | Swapped: (b) first, labelled | Neutral names: (a) first |
| --- | --- | --- | --- |
| hand cart | (a): "slatted golden floor, brown plank sides, wheels … and bright red shafts each show up"; (b) "a flat salmon tray whose wheel is half hidden under the bed" | (a) | (a) |
| stone archway | (a): "separate wedge stones in alternating light and dark tones"; (b) "looks like a bent pipe" | (a) | (a) |
| campfire ring | (a): "jagged multi-tongued flames", "log seats and a firewood bundle"; (b) "a single solid yellow cone that reads more like a tent" | (a) | (a) |
| weapon rack | (b): "bright terracotta rack stands out clearly", each weapon reads | (a): "the weapons crowd together and overlap" in (b) | (b) |

(b) won 1 of 4 outright. With R above 0.8 a pass needs 3 wins, so **the gate fails**. All three sets
give (a) the hand cart, archway and campfire. The weapon rack, (b)'s only win, went to (a) when the
order was swapped.

What lost it for (b) was mostly colour and light, plus some shape and scope:
- **Archway.** Nine slab voussoirs, all one colour, with 2.4° gaps of 4–6 cm (about a pixel at game
  scale), so the ring reads as a tube. The Kit archway set light stones on a dark backing ring that
  reads as mortar.
- **Hand cart.** The bed, sides and wheels are all one salmon; only the thin rails and shafts are
  dark red. One judge also saw a wheel half hidden under the bed.
- **Campfire.**
  - (b)'s flame is a glow part. In the preview a glow part is a flat unlit fill, and this one
    covers most of the logs.
  - The Kit arm drew its flames as lit cones. It also added log seats and a woodpile beyond the
    brief, which two judges credited. That added scope helps explain why the campfire was (a)'s
    most expensive brief.
- **Weapon rack.** The swapped judge found (b)'s weapons crowded and its sword slab-like.

Nothing in `model -- check` flags a large single-colour mass, or a glow part that hides the model.
Its lightness check skips glow parts. Where it did fire (moss on stone, ash and stones against
logs), the agents fixed it.

Cost:

| Item | Tokens |
| --- | --- |
| 24 runs | 2.56M |
| protocol judges | 0.26M |
| swapped judges | 0.26M |
| neutral judges | 0.26M |
| **total** | **3.34M** |

## Second run: what changed, and its rules (fixed before it ran)

A human chose option 2 of [#54](https://github.com/michaelcrosato/riftlight/issues/54): fix what lost
the first run, then run Gate A once more. If it fails again, the plan stops for good.

**What changes before it runs** (one PR, listed in the Status table): `model -- check` warnings for
what lost the first run, and library components that show how to avoid it. The prompts above stay
word for word; arm (b) reads the bigger library because its prompt says to read the library.

**How it runs:**
- Both arms run again, 3 fresh runs per brief, so the two arms are measured at the same time. The
  first run's numbers are not reused.
- Tokens, medians and R as in *Scoring*.
- Each brief's median runs go to **two** fresh judges. The images are copied to `<brief>-1.png` and
  `<brief>-2.png` in a folder whose path names neither arm. One judge sees them in the coin's order,
  the other in the reverse order.
- An arm wins a brief only if it wins both judgements. A split, or any tie, is a tie.
- The pass rule is unchanged: R ≤ 0.8 and (b) wins or ties at least 3 of 4, or R ≤ 1.0 and (b) wins
  outright at least 3 of 4.
