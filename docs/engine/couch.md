# Couch co-op: a pad each (`input.player`)

Same-screen play for two to four people on one device (52in1's catalogue calls it
`same-screen co-op`): one view everyone shares, player 1 on the keyboard and mouse or a pad, every
other player on a pad of their own. The engine reads each pad on its own and records it; the game
seats players and decides what they do (Riftlight's: docs/game/shell.md *Couch co-op*).

```ts
ctx.input.padPlayers = true;                     // read every pad on its own too (off by default)
const p2 = ctx.input.player(1);                  // the pad in navigator.getGamepads() slot 1
p2.isDown('PadA'); p2.consumePress('PadX');      // the merged input's reading API, its buttons only
p2.moveAxis(); p2.padAxis; p2.lookAxis; p2.triggers; p2.connected;
ctx.input.joined.add(1);                         // pad 1 plays on its own: it no longer drives player 1
ctx.input.joinWith = ['PadA'];                   // or let a pad join by pressing Cross (null: nobody)
for (const slot of ctx.input.joinedNow) seat(slot); // the pads that joined this frame
```

- **The merged input stays player 1's.** `isDown`, `moveAxis`, `lookAxis`, `device`, `rumble`...
  read every pad merged with the keyboard and mouse, as they always have, so a game that never
  turns `padPlayers` on is unchanged. A pad in `joined` never drives it: not its buttons, sticks
  or triggers, not `device` (a guest's stick never turns player 1's prompts to the pad, nor takes
  their mouse aim away) and not `padIndex` (what `rumble` shakes).
- **`input.player(slot)`** (slots 0 to `MAX_PADS` - 1, `PadPlayer`, `KeyReader`) reads one pad:
  its `Pad*` codes and the d-pad's arrows held, pressed this frame (`wasPressed`) and queued for
  fixed-step code (`consumePress`, the same press window), its sticks after the deadzone (`padAxis`
  y forward, `lookAxis` y up), its triggers, `connected`. Create and Options press as they are let
  go, as the merged input's do (`HOST_CHORD`). Nothing is latched by `release()`: a guest's held
  button goes on through player 1's menu.
- **Joining**: while `joinWith` is set (and `padPlayers` on), a pad that has not joined and is not
  player 1's pad in use (`device` is the pad and it is `padIndex`) pressing one of its codes joins
  at once, before its press reaches anything: it is added to `joined`, its slot is in `joinedNow`
  for that frame, and the press reads as up until let go (it presses nothing in a menu nor in
  play). Turn `joinWith` on only where a join is meant (a co-op menu; a hub while player 1 is on a
  pad: player 1 on the keyboard picking a pad up must not join by mistake). One controller the
  browser sees twice (a virtual pad beside the real one: DS4Windows or Steam Input without
  HidHide, every press on both) never joins its own twin: a pad pressing a join code that player
  1's pad in use pressed in the same poll does not join. A game removes a pad that leaves with
  `joined.delete(slot)`; it then drives player 1 again.
- **Recorded**: every joined pad on its own as `InputFrame.pads` (`PadFrame`: slot, held codes,
  sticks, triggers; left out while no joined pad changed), their presses as `padPressed`, and the
  joins as `join`, so a replay reads every player exactly and joins the same pads at the same frames
  (`joinWith` is not needed then). A pad that has not joined is recorded only as part of the merged
  input (player 1's): read one on its own for what a game shows (a line saying how to join), never
  for play. A recording without them (an older one) has one player. A replay starts with no pad on
  its own and nobody joined. `engine.snapshot()` keeps each pad's held buttons and queued
  presses and `joined` (`InputState.pads`, `.joined`; an older snapshot has none).

Headless tests feed pads with `input.setGamepads([...])` (each `GamepadLike` with its `index`):
`src/engine/input.test.ts`, `src/engine/replay.test.ts` *couch co-op*.
