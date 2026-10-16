# Passive tree

`src/riftlight/tree/` (logic, data, generator), `src/riftlight/ui/tree/` (the view),
`scripts/riftlight/tree.ts` (the inspector). 1,200–1,600 nodes (the validator's range) on a wheel of six regions:
**Might** (top), **Edge**, **Grace**, **Guile** (bottom), **Wit** and **Zeal**, each a 60°
sector with its own colour, cluster themes and small-node pool. A ring of six free start
gates sits around the *Heart of the Rift*; 24 keystones sit on the rim, 40+ points out.

## Using it (shell, combat)

```ts
import { TreeState, defaultTree, pointBudget, respecCost, treeMods } from './riftlight/tree';
import { TreeView } from './riftlight/ui/tree/TreeView';

hero.stats.set('tree', treeMods(save.hero.allocated));            // the StatSheet source 'tree'
const state = TreeState.load(defaultTree(), save.hero.allocated, pointBudget(level, deepest).total);
const view = new TreeView({
  container, state, audio: ctx.audio, closeKeys: ['Escape', 'KeyP'],
  refundCost: (n) => respecCost(n, level), spendGold: (g) => wallet.spend(g), gold: () => wallet.gold,
  onChange: (_change, s) => { save.hero.allocated = s.serialize(); hero.stats.set('tree', s.mods()); },
  onClose: () => (engine.paused = false),
});
view.open();                                   // pause the game while open; view.isOpen(), view.close()
state.points = pointBudget(newLevel, deepest).total; view.refresh();   // on level-up
```

- **Points:** `pointBudget(level, deepest)`: one per level after the first, plus one per
  designed level cleared and one per five rift depths. Start gates are free roots: anything
  allocated must stay connected to one of them.
- **Save format:** `save.hero.allocated` holds allocated node ids plus `<masteryId>=<optionId>`
  per mastery choice. `TreeState.load` drops ids that no longer exist, then anything cut off
  from a gate, then the furthest nodes if over budget, so a changed tree never breaks a save.
- **Respec:** `respecCost(points, level)` is the gold for refunding that many points (pure).
- **Rules combat reads:** keystones are ordinary mods plus flags (`cannotCrit`,
  `skills.costLife`, `immune.chaos`, `pointBlank`, ...). Every flag and special stat is listed
  with its meaning in `KEYSTONE_FLAGS` (`tree/data/keystones.ts`), and the conditions tree
  mods use (`inDark`, `inLight`, `lowLife`, `recentlyKilled`, `hitRecently`, `notHitRecently`)
  in `TREE_CONDITIONS`. Hit damage queries should include the tag `hit` (Perfect Agony).
- **Stat conventions** (`tree/data/stats.ts`): chances, resistances, block and leech are flat
  fractions (`flat('res.fire', 0.12)` = +12%); `<type>.damage` is per damage type,
  `elemental.damage` covers fire/cold/lightning, `res.elemental` adds to all three; skill
  scoping uses tags (`inc('damage', 0.2, ['twohand'])`).

## Adding content

Everything is data; the generator queries it by tags, so adding an entry is the whole job.

- **A cluster** (`tree/data/clusters-*.ts`): a `T({ id, name, tags, shapes, pool, notables })`.
  `tags` are themes: a region picks clusters by summing its `themes` weights over them
  (squared), so tag it with themes the regions you want already weigh. `shapes` are ids from
  `data/shapes.ts`; `pool` is the small-node roll table (`R(stat, kind, weight, tags?, when?)`).
- **A notable:** add `N(id, name, mods, flavour)` to a cluster's `notables`. Ids are global and
  become the node id `n:<id>`. Keep it worth 25–45 budget points (`modsBudget`); the validator
  flags anything over 60. Each notable is placed once per tree; more notables in a theme means
  more instances of that cluster.
- **A keystone** (`data/keystones.ts`): mods plus flags, hand-written `lines` for the tooltip,
  and a `region`. Each region gets its keystones spread along its rim. Document any new flag
  in `KEYSTONE_FLAGS`.
- **A mastery** (`data/masteries.ts`): tags and three options. Shapes with a mastery slot
  (`wheel1`, `wheel2`) take the best-matching mastery not yet used in that region.
- **A shape** (`data/shapes.ts`): slots in local units (+y points outwards, entry at -y, about
  ±110 across, ~55 between neighbours) and links. Tag it `n0`–`n3` by notable count.
- **A region** (`data/regions.ts`): an angle, colours, theme weights and a small-node pool. The
  circle is split evenly between regions, so rebalance the angles.
- **A stat:** give it a tooltip name in `STAT_NAMES` and, if small nodes may roll it, a price
  in `MOD_COSTS` (value per budget point).
- **A hand-placed node** (`data/overrides.ts`): `{ id, x, y, name, kind, region, mods, link }`
  adds a node; an override with an existing id patches it (move it, change its mods, `link` /
  `unlink`). Overrides are applied last and always win.

## How the generator works (`tree/generate.ts`)

1. Start ring: a gate per region, two travel nodes between neighbouring gates.
2. Each sector is cut into seven radial bands of cluster *slots* (more slots further out). In a
   seeded shuffled order, each slot picks a template by region theme weight, a shape from the
   template, and notables from the template; band 0 and a few others become stat clusters.
3. Small nodes roll their mods from a **budget** (`smallBudget`, a little more per band) and a
   pool: the template's inside clusters, the region's on travel paths. `MOD_COSTS` turns budget
   points into values, and the validator measures every node with the same table.
4. Every slot links inward to the nearest slot of the band below (or the second nearest if
   that draws cleaner), with optional extra inward and sideways links; highways cross to the
   neighbouring regions at bands 2 and 5; keystones hang off the outer band. Links pick the
   closest ports whose straight line stays clear of other nodes and crosses no other link.
5. Overrides are applied.

**Stable ids.** Saves store ids, so ids come from structure, never from a counter:
`start:<region>`, `n:<notable>`, `k:<keystone>`, `m:<region>:<mastery>`,
`<region><band>.<slot>.<shapeKey>` for cluster smalls, `p:<from>~<to>:<i>` for travel nodes,
`ring:<a>-<b>:<i>`. Every random draw is forked by slot or node id, so changing pools, budgets
or travel spacing keeps every non-travel id, notables and keystones keep their id wherever
they land, and changing one slot's template changes only that cluster's small ids. Changing
band radii can change how many slots a band holds (and so which slots exist).

## Inspecting it

- `npm run tree -- render [--heat] [--crops]` writes `.scratch/tree/tree.png` (regions
  coloured, keystones labelled; `--heat` = points from the nearest gate; `--crops` = a zoomed
  PNG per region with notable names). `--alloc id,id` draws an allocation.
- `npm run tree -- validate` exits 1 on: duplicate ids, broken or one-way links, orphans,
  nodes unreachable from a gate, a keystone closer than 18 points, a node count outside
  1,200–1,600, overlapping nodes, small nodes off their budget, or a region whose total budget
  is more than 30% off the mean. `stats` prints counts per kind and region and the mod
  distribution; `path <from> <to>` and `search <words>` take ids or names. `--json` everywhere.
- `/tree.html` is the tree view on its own page (`?seed=`, `?points=`, `?alloc=`, `?focus=`),
  with `window.__RIFT_TREE__` for scripts; the e2e suite `riftlight-tree` drives it.
