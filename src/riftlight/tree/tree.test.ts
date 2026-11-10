import { describe, expect, it } from 'vitest';
import { strays as straysIn } from '../../../scripts/lang-strays.mjs';
import { flat, inc, more, StatSheet } from '../core/mods';
import { Registry } from '../core/registry';
import {
  CLUSTERS,
  defaultTree,
  generateTree,
  KEYSTONES,
  modsBudget,
  nodeFlavour,
  nodeLines,
  nodeName,
  NOTABLES,
  PassiveTree,
  pointBudget,
  REGIONS,
  respecCost,
  searchTree,
  summarizeMods,
  treeMods,
  TreeState,
  validateTree,
  type TreeNode,
} from '.';
import { Lang } from '../../engine/lang/lang';
import { riftlightLines } from '../lang/index';
import { hasStatName } from '../lang/mods';
import { KEYSTONE_FLAGS } from './data/keystones';
import { describeTreeMod, smallName } from './text';

const n = (id: string, links: string[], kind: TreeNode['kind'] = 'small', extra: Partial<TreeNode> = {}): TreeNode => ({ id, name: id, kind, mods: [], x: 0, y: 0, links, region: 'might', cluster: 'test', ...extra });

/**
 *   S ─ a ─ b ─ c ─ d
 *       │       │
 *       e ─ f ──┘      M (mastery) hangs off d, K (keystone) off c
 */
function toy(): PassiveTree {
  return new PassiveTree([
    n('S', ['a'], 'start'),
    n('a', ['S', 'b', 'e'], 'small', { mods: [flat('life', 10)] }),
    n('b', ['a', 'c'], 'small', { mods: [flat('life', 5)] }),
    n('c', ['b', 'd', 'f', 'K'], 'notable', { mods: [inc('damage', 0.2)] }),
    n('d', ['c', 'M']),
    n('e', ['a', 'f']),
    n('f', ['e', 'c']),
    n('K', ['c'], 'keystone', { mods: [more('damage', 0.3)] }),
    n('M', ['d'], 'mastery', { options: [{ id: 'one', mods: [flat('mana', 1)] }, { id: 'two', mods: [flat('mana', 2)] }] }),
  ]);
}

describe('content', () => {
  it('has PoE-scale hand-made blocks', () => {
    expect(CLUSTERS.size).toBeGreaterThanOrEqual(40);
    expect(NOTABLES.size).toBeGreaterThanOrEqual(140);
    expect(KEYSTONES.size).toBeGreaterThanOrEqual(24);
    for (const r of REGIONS.all()) expect(KEYSTONES.query({ filter: (k) => (k as unknown as { region: string }).region === r.id }).length).toBe(4);
  });

  it('names every stat it uses and documents every keystone flag', () => {
    for (const nb of NOTABLES.all()) for (const m of nb.mods) expect(hasStatName(m.stat), `${nb.id}: ${m.stat}`).toBe(true);
    for (const k of KEYSTONES.all()) for (const m of k.mods) if (m.kind === 'flag' || !hasStatName(m.stat)) expect(KEYSTONE_FLAGS[m.stat], `${k.id}: ${m.stat}`).toBeDefined();
  });

  it('describes percentage stats as percentages', () => {
    expect(describeTreeMod(flat('res.fire', 0.12))).toBe('+12% fire resistance');
    expect(describeTreeMod(inc('mana.cost', -0.08))).toBe('8% reduced mana cost of skills');
  });
});

describe('generator', () => {
  const nodes = generateTree();

  it('is deterministic for a seed and differs between seeds', () => {
    expect(JSON.stringify(generateTree())).toBe(JSON.stringify(nodes));
    expect(JSON.stringify(generateTree({ seed: 2 }))).not.toBe(JSON.stringify(nodes));
  });

  it('builds a valid 1,200–1,600 node tree for several seeds', () => {
    for (const seed of ['riftlight', 1, 2, 'abc']) {
      const report = validateTree(generateTree({ seed }));
      expect(report.problems.filter((p) => p.level === 'error'), `seed ${seed}`).toEqual([]);
    }
    expect(nodes.length).toBeGreaterThanOrEqual(1200);
    expect(nodes.length).toBeLessThanOrEqual(1600);
  });

  it('places every keystone, gate and many notables and masteries', () => {
    const kinds = (k: string) => nodes.filter((x) => x.kind === k).length;
    expect(kinds('keystone')).toBe(KEYSTONES.size);
    expect(kinds('start')).toBe(REGIONS.size);
    expect(kinds('notable')).toBeGreaterThan(120);
    expect(kinds('mastery')).toBeGreaterThanOrEqual(REGIONS.size * 2);
  });

  it('keeps cluster, notable and keystone ids when travel paths and pools change', () => {
    const wider = generateTree({ connectorStep: 75, clearance: 26, sideways: 0.4, smallBudget: 12 });
    const ids = (list: readonly TreeNode[]) => new Set(list.filter((x) => !x.id.startsWith('p:')).map((x) => x.id));
    expect(ids(wider)).toEqual(ids(nodes));
  });

  it('rolls small nodes within their budget, from the region/template pools', () => {
    for (const x of nodes) if (x.kind === 'small' && x.budget) expect(modsBudget(x.mods) / x.budget).toBeGreaterThan(0.6);
  });

  it('lets hand-placed overrides win', () => {
    const moved = generateTree({ overrides: [{ id: 'k:colossus', x: 1, y: 2, name: 'Big' }, { id: 'extra', x: 5, y: 5, name: 'Extra', kind: 'small', region: 'might', link: ['start:might'] }] });
    const k = moved.find((x) => x.id === 'k:colossus')!;
    expect([k.x, k.y, k.name]).toEqual([1, 2, 'Big']);
    expect(moved.find((x) => x.id === 'start:might')!.links).toContain('extra');
    expect(() => generateTree({ overrides: [{ id: 'nope', x: 0, y: 0 }] })).toThrow(/needs/);
  });

  it('only uses the registries it is given', () => {
    const one = new Registry('cluster', [CLUSTERS.get('life')]);
    const tree = generateTree({ clusters: one });
    const templates = new Set(tree.map((x) => x.template).filter(Boolean));
    expect([...templates]).toEqual(['life']);
  });
});

describe('allocation', () => {
  it('allocates only next to owned nodes and within the point budget', () => {
    const s = new TreeState(toy(), 2);
    expect(s.canAllocate('b')).toBe(false);
    expect(s.allocate('a')).toBe(true);
    expect(s.allocate('b')).toBe(true);
    expect(s.canAllocate('c')).toBe(false); // out of points
    expect(s.unspent).toBe(0);
  });

  it('finds the shortest path and allocates it in one go', () => {
    const s = new TreeState(toy(), 10);
    expect(s.pathTo('c')).toEqual(['a', 'b', 'c']);
    expect(s.allocatePath('d')).toEqual(['a', 'b', 'c', 'd']);
    expect(s.pathTo('f')).toEqual(['f']);
    const poor = new TreeState(toy(), 2);
    expect(poor.allocatePath('c')).toEqual([]);
    expect(poor.spent).toBe(0);
  });

  it('never paths through masteries or keystones', () => {
    const t = new PassiveTree([n('S', ['M'], 'start'), n('M', ['S', 'x'], 'mastery', { options: [{ id: 'o', mods: [] }] }), n('x', ['M'])]);
    expect(new TreeState(t).pathTo('x')).toBeNull();
    expect(new TreeState(t).pathTo('M')).toEqual(['M']);
  });

  it('refunds a node only if everything stays connected', () => {
    const s = new TreeState(toy());
    s.allocatePath('d');
    expect(s.canDeallocate('b')).toBe(false); // c, d hang off it
    expect(s.canDeallocate('d')).toBe(true);
    s.allocatePath('e'); // c is now reachable through e–f too
    s.allocate('f');
    expect(s.canDeallocate('b')).toBe(true);
    expect(s.deallocate('b')).toBe(true);
    expect(s.deallocate('a')).toBe(false); // everything hangs off a
    expect(s.canDeallocate('S')).toBe(false); // roots are free and permanent
  });

  it('aggregates mods, including the chosen mastery option', () => {
    const s = new TreeState(toy());
    s.allocatePath('M');
    expect(s.masteries.get('M')).toBe('one');
    expect(s.choose('M', 'two')).toBe(true);
    const sheet = new StatSheet({ life: 50, mana: 0 });
    sheet.set('tree', s.mods());
    expect(sheet.get('life')).toBe(65);
    expect(sheet.get('mana')).toBe(2);
    expect(sheet.get('damage')).toBe(0);
  });

  it('round-trips the save format and drops what no longer fits', () => {
    const t = toy();
    const s = new TreeState(t);
    s.allocatePath('M');
    s.choose('M', 'two');
    const saved = s.serialize();
    expect(saved).toContain('M=two');
    expect(TreeState.load(t, saved).serialize()).toEqual(saved);
    // Unknown ids vanish; nodes cut off from the start come back as points.
    const loaded = TreeState.load(t, ['gone', 'c', 'd', 'a']);
    expect([...loaded.allocated]).toEqual(['a']);
    // Over budget: the furthest nodes are refunded.
    expect(TreeState.load(t, saved, 2).spent).toBe(2);
    const key = (mods: readonly object[]) => mods.map((m) => JSON.stringify(m)).sort();
    expect(key(treeMods(saved, t))).toEqual(key(s.mods()));
  });

  it('works on the real tree: path from a gate to a keystone', () => {
    const tree = defaultTree();
    const s = new TreeState(tree, 200);
    const got = s.allocatePath('k:resolute-technique');
    expect(got.length).toBeGreaterThanOrEqual(18);
    expect(got.at(-1)).toBe('k:resolute-technique');
    const sheet = new StatSheet();
    sheet.set('tree', treeMods(s.serialize()));
    expect(sheet.has('cannotCrit')).toBe(true);
    expect(sheet.has('hits.cannotBeEvaded')).toBe(true);
  });
});

describe('points, gold, search and summary', () => {
  it('counts points per level plus designed-level and rift bonuses', () => {
    expect(pointBudget(1).total).toBe(0);
    expect(pointBudget(10, 3)).toEqual({ level: 9, bonus: 3, total: 12 });
    expect(pointBudget(60, 22).bonus).toBe(14);
  });

  it('prices respecs by points and level, purely', () => {
    expect(respecCost(0, 50)).toBe(0);
    expect(respecCost(5, 10)).toBe(respecCost(5, 10));
    expect(respecCost(10, 10)).toBeGreaterThan(respecCost(5, 10));
    expect(respecCost(5, 60)).toBeGreaterThan(respecCost(5, 10));
  });

  it('searches by name, mod text and stat', () => {
    const tree = defaultTree();
    expect(searchTree(tree, 'resolute')).toEqual(['k:resolute-technique']);
    const fire = searchTree(tree, 'fire resistance');
    expect(fire.length).toBeGreaterThan(5);
    expect(fire.every((id) => tree.node(id).mods.some((m) => m.stat === 'res.fire' || m.stat === 'res.elemental') || tree.node(id).options?.length || /fire resistance/i.test(nodeLines(tree.node(id)).join()))).toBe(true);
    expect(searchTree(tree, 'stat:minion.count').length).toBeGreaterThan(0);
    expect(searchTree(tree, '')).toEqual([]);
  });

  it('summarises aggregated mods in groups', () => {
    const groups = summarizeMods([inc('damage', 0.1), inc('damage', 0.15), flat('life', 10), flat('life', 5), more('damage', 0.1), more('damage', 0.1), flat('res.fire', 0.1)]);
    const lines = Object.fromEntries(groups.map((g) => [g.id, g.lines]));
    expect(lines.offence).toContain('25% increased damage');
    expect(lines.offence).toContain('21% more damage');
    expect(lines.life).toEqual(['+15 maximum life']);
    expect(lines.defence).toEqual(['+10% fire resistance']);
    expect(groups.map((g) => g.title)).toEqual(['Offence', 'Defence', 'Life, mana and shield']);
  });
});

describe('words', () => {
  const tree = defaultTree();
  const fake = new Lang(riftlightLines(), {}, { code: 'en-XA' });
  /** Words not from a line (scripts/lang-strays.mjs: the audit's test); proper names aside. */
  const strays = (text: string) => straysIn(text, riftlightLines().names);

  it('names nodes from their lines: notables, keystones, gates, masteries, small nodes from their mods', () => {
    expect(nodeName(tree.node('k:resolute-technique'))).toBe('Resolute Technique');
    expect(nodeName(tree.node('start:might'))).toBe('Might Gate');
    expect(nodeName(tree.node('core:heart'))).toBe('Heart of the Rift');
    expect(nodeFlavour(tree.node('core:heart'))).toBe('Every road out of the rift starts here.');
    const mastery = tree.nodes.find((x) => x.kind === 'mastery')!;
    expect(nodeFlavour(mastery)).toBe('Allocate, then choose one.');
    // every word comes from a line: under a test language nothing is left unbracketed
    for (const x of tree.nodes) {
      for (const text of [nodeName(x, fake), nodeFlavour(x, fake) ?? '[]', ...nodeLines(x, undefined, fake)]) expect(strays(text), `${x.id}: ${text}`).toEqual([]);
    }
  });

  it('builds small names from parts, in the order a language gives', () => {
    expect(smallName([inc('damage', 0.1, ['melee'])])).toBe('Melee Damage');
    expect(smallName([flat('life', 10), inc('armour', 0.1)])).toBe('Life and Armour');
    expect(smallName([inc('damage', 0.1, undefined, 'inDark')])).toBe('Damage in Dark');
    expect(smallName([inc('attack.speed', 0.05, ['twohand'])])).toBe('Two-Handed Attack Speed');
  });

  it('keystone rules read with their numbers filled in', () => {
    expect(nodeLines(tree.node('k:rampage'))).toEqual(['Kills grant Rampage for 4 s, up to 25 stacks', 'Each stack: 2% more damage, 1% more movement speed', '10% less damage']);
    expect(nodeLines(tree.node('k:ancestral-bond'))[0]).toBe('+1 totem you can summon');
    expect(nodeLines(tree.node('k:blood-magic'))).toEqual(['Skills cost life instead of mana', 'You have no mana', '10% increased maximum life']);
    expect(nodeLines(tree.node('k:gloomwalker'))[0]).toBe('30% more damage while in the dark');
  });

  it('searches the words as shown', () => {
    expect(searchTree(tree, 'gloomwalker')).toEqual(['k:gloomwalker']);
    expect(searchTree(tree, 'rampage stacks')).toEqual(['k:rampage']);
  });
});

