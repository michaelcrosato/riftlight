import { describe, expect, it } from 'vitest';
import { Catalog, groupVariants, searchDefs, searchWords, stemWord, variantName, variantsInShort, wordForms, type CatalogEntry } from './catalog';
import { MODEL_LIBRARY } from './model/library';
import { TEXTURE_LIBRARY } from './texture/library';

const def = (id: string, about = '', tags: string[] = []): CatalogEntry => ({ id, about, tags });
const ids = (defs: readonly CatalogEntry[]) => defs.map((d) => d.id);

describe('search', () => {
  const cat = new Catalog([
    def('armchair', 'Upholstered armchair with rolled arms', ['furniture', 'seat']),
    def('chair', 'Wooden chair on four legs', ['furniture', 'wood']),
    def('kit/chair-desk', 'Chair desk (imported)', ['imported', 'kit', 'furniture', 'seat']),
    def('stump', 'An old oak stump', ['nature', 'wood']),
    def('oak-tree', 'A broad oak', ['nature', 'tree']),
    def('bench', 'A long wooden bench', ['furniture', 'seat']),
    def('seat-cushion', 'A cushion', ['cloth']),
  ]);

  it('ranks an id word over a tag, a tag over about, a whole word over part of one', () => {
    expect(ids(cat.search('chair'))).toEqual(['chair', 'kit/chair-desk', 'armchair']);
    expect(ids(cat.search('seat'))).toEqual(['seat-cushion', 'armchair', 'kit/chair-desk', 'bench']);
    expect(ids(cat.search('wooden'))).toEqual(['chair', 'bench']);
  });

  it('every word must match, in any order, plurals and case aside', () => {
    expect(ids(cat.search('Desk CHAIRS'))).toEqual(['kit/chair-desk']);
    expect(ids(cat.search('oak nature'))).toEqual(['oak-tree', 'stump']);
    expect(ids(cat.search('benches'))).toEqual(['bench']);
  });

  it('breaks a tie inside a pack for the name that starts with the word: the rocks before a cliff of rock', () => {
    const kit = new Catalog([def('stone-wall'), def('wall-shelf'), def('kit/cliff-block-rock', 'A cliff'), def('kit/bridge-stone', 'A bridge'), def('kit/rock-large-a', 'A rock'), def('kit/stones', 'Stones'), def('kit/rock-large-b', 'A rock'), def('kit/wall-low')]);
    expect(ids(kit.search('rock'))).toEqual(['kit/rock-large-a', 'kit/rock-large-b', 'kit/cliff-block-rock']);
    expect(ids(kit.search('stone'))).toEqual(['stone-wall', 'kit/stones', 'kit/bridge-stone']);
    // the library's names end with what a thing is: it keeps its place before the packs
    expect(ids(kit.search('wall'))).toEqual(['stone-wall', 'wall-shelf', 'kit/wall-low']);
  });

  it('when no def has every word, those with the most come back', () => {
    expect(ids(cat.search('oak tree stump'))).toEqual(['oak-tree', 'stump']);
    expect(cat.search('zeppelin')).toEqual([]);
  });

  it('filters by tags first, and limits', () => {
    expect(ids(cat.search('chair', { tags: ['imported'] }))).toEqual(['kit/chair-desk']);
    expect(ids(cat.search('', { tags: ['nature'] }))).toEqual(['stump', 'oak-tree']);
    expect(cat.search('chair', { limit: 1 })).toHaveLength(1);
    expect(cat.search('')).toHaveLength(7);
    expect(ids(searchDefs([...cat.all()].reverse(), 'furniture'))).toEqual(['bench', 'kit/chair-desk', 'chair', 'armchair']);
  });

  it('splits words the way names are written', () => {
    expect(searchWords('bookcaseClosed_wide-2')).toEqual(['bookcase', 'closed', 'wide', '2']);
    expect(['trees', 'benches', 'berries', 'glass', 'cactus', 'boxes', 'rocks', 'gas'].map(stemWord)).toEqual(['tree', 'bench', 'berry', 'glass', 'cactus', 'box', 'rock', 'gas']);
    // irregular plurals: a query finds the singular, and regular -ves words keep theirs
    const shop = new Catalog([def('wall-shelf'), def('knife'), def('cookie-jar'), def('stove'), def('leaf-pile'), def('glove')]);
    for (const [q, id] of [['shelves', 'wall-shelf'], ['knives', 'knife'], ['cookies', 'cookie-jar'], ['stoves', 'stove'], ['leaves', 'leaf-pile'], ['gloves', 'glove']]) expect(ids(shop.search(q!))[0], q).toBe(id);
    expect(wordForms('shelves')).toContain('shelf');
  });

  it('groups variants: one def for each variant name, in ranked order, the rest under it', () => {
    expect(['kenney-nature/rock-large-a', 'crate-12', 'tree-oak', 'kit/stool'].map(variantName)).toEqual(['kenney-nature/rock-large', 'crate', 'tree-oak', 'kit/stool']);
    const rocks = new Catalog([def('rock-large-a', 'A rock'), def('rock-large-b', 'A rock'), def('rock-small-a', 'A pebble'), def('rocking-chair', 'A chair'), def('rock-large', 'The plain one'), def('rock-small-b', 'A pebble')]);
    const groups = groupVariants(rocks.search('rock'));
    expect(groups.map((g) => [g.def.id, ...g.variants.map((v) => v.id)])).toEqual([['rock-large-a', 'rock-large-b', 'rock-large'], ['rock-small-a', 'rock-small-b'], ['rocking-chair']]);
    expect(groups.map(variantsInShort)).toEqual(['rock-large-b, rock-large', 'rock-small-b', '']);
    expect(variantsInShort({ def: def('wall-top'), variants: [def('wall-top-b'), def('wall-top-c')] })).toBe('wall-top-b, -c');
    expect(groupVariants([])).toEqual([]);
    // the letter need not be last: a detailed pine's four variants share one entry, apart from the plain pines'
    const pines = ['tree-pine-tall-a', 'tree-pine-tall-a-detailed', 'tree-pine-tall-b', 'tree-pine-tall-b-detailed', 'tree-pine-tall-c-detailed', 'tree-pine-tall-d-detailed', 'kit-a/stool', 'crate-2-tall'];
    expect(pines.map(variantName)).toEqual(['tree-pine-tall', 'tree-pine-tall-detailed', 'tree-pine-tall', 'tree-pine-tall-detailed', 'tree-pine-tall-detailed', 'tree-pine-tall-detailed', 'kit-a/stool', 'crate-tall']);
    const pineGroups = groupVariants(pines.slice(0, 6).map((id) => def(id)));
    expect(pineGroups.map((g) => [g.def.id, ...g.variants.map((v) => v.id)])).toEqual([
      ['tree-pine-tall-a', 'tree-pine-tall-b'],
      ['tree-pine-tall-a-detailed', 'tree-pine-tall-b-detailed', 'tree-pine-tall-c-detailed', 'tree-pine-tall-d-detailed'],
    ]);
    expect(pineGroups.map(variantsInShort)).toEqual(['tree-pine-tall-b', 'tree-pine-tall-b-detailed, -c-detailed, -d-detailed']);
  });

  it('finds what an agent asks the real libraries for', () => {
    expect(ids(MODEL_LIBRARY.search('wooden chair', { limit: 3 }))).toContain('chair');
    expect(ids(MODEL_LIBRARY.search('torch'))[0]).toMatch(/torch/);
    expect(ids(TEXTURE_LIBRARY.search('stone floor', { limit: 5 }))).toContain('floor-tiles');
    expect(TEXTURE_LIBRARY.search('potion').length).toBeGreaterThan(0);
  });
});
