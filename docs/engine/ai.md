# AI (`src/engine/ai/`)

## Navigation and flocking (`src/engine/ai/`)

```ts
const nav = NavGrid.fromRows(MAP, { blocked: '#c' });     // the same ASCII map that builds the level
const path = nav.path([x, 0, z], [hx, 0, hz]);            // world points, corners only (null: no way)
nav.lineOfSight(gx, gz, hx, hz);                          // a wall or a crate in between?
nav.castWall(gx, gz, dirX, dirZ, 7);                      // distance to the first wall (vision cones)
nav.flowTo(hx, hz); nav.flowDirection(x, z, out);         // one fill, then every agent reads its way
const flock = new Boids(120, { bounds: { min: [-10, 1, -10], max: [10, 6, 10] } });
flock.flee = { at: heroPos, radius: 4 }; flock.step(dt); // then flock.pos / flock.vel (xyz each)
```

`NavGrid` (pure, unit-tested) is the level as walkable cells (one per metre by default,
centred on the origin like `kit.map`; `fromRows` closes '#' and ' ' unless told otherwise).
`path` is A* with diagonal moves that never cut a corner (octile distance as the heuristic),
smoothed so it turns only where a wall is in the way; a target inside a wall goes to the
nearest open cell that can be reached. `lineOfSight` walks the cells under a segment (a DDA;
`radius` tests a body that wide), and `castWall` is the same walk, so a vision cone drawn with
it shows exactly what `lineOfSight` would see.
`flowTo` fills the grid with walking distances to one target (Dijkstra, rebuilt only when the
target changes cell or `setOpen` changes the grid), and `flowDirection` is then a lookup per
agent. `Boids` is Reynolds' flocking on typed arrays: separation, alignment and cohesion from
the neighbours in a spatial hash, plus `seek`, `flee`, `obstacles` (spheres) and `bounds` (pushed back in from `margin` inside them);
`flat` keeps a herd or a school on its plane; seeded, so runs repeat.

## Behaviour trees (`src/engine/ai/behavior.ts`)

```ts
const tree = new BehaviorTree<Bot>(
  bt.selector('robot',                                                       // priorities, top first
    bt.sequence('flee', bt.condition('hero close?', (b) => b.near), bt.action('run away', runAway, stop)),
    bt.sequence('work', bt.action('go to crystal', goTo, letGo), bt.action('pick it up', pickUp)),
    bt.steps('wander', bt.action('pick a spot', pick), bt.action('stroll', stroll), bt.wait('look about', 1.5))),
  bot);                                                                      // the blackboard: any object
tree.tick(dt);                                                               // per step: 'success' | 'failure' | 'running'
tree.trace(); tree.activePath();                                             // every node with this tick's answer; the branch that decided
```

Each node answers success, failure or running. `selector` and `sequence` are reactive: every
tick starts from the first child, so a higher priority takes over at once, and the child that
was running is halted (`action`'s third argument runs then: let go of a claim, stop walking).
`steps` is a sequence with memory (finished children are not run again until it ends);
`parallel(name, 'all' | 'one', ...)` runs children together (each until it finishes);
`inverter`, `succeeder`, `repeat(child, n)` and `cooldown(child, seconds)` (in tree time, kept
across halts) change one child's answer; `wait(name, seconds)`. `tree.halt()` stops everything
(a cutscene, a stun). A node keeps its own state, so it can be in one tree only (a second tree
throws): build one per agent. Pure, unit-tested.

Reactive means children before the running one are run again every tick, and the old branch
is halted after the new one's first tick. That is what interrupts cleanly, but a child that is
not a quick test (a `wait`, an action that does something each time) would restart and halt
the one after it every tick: put such steps in `steps`, which runs each once. Conditions with
an edge (scared within 3 m) want a margin to leave by (calm past 4.5 m), or an agent at the
edge flips every tick.
