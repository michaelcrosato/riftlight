/**
 * /tree.html: the passive tree on its own page, for browsing and for agents.
 *
 *   ?seed=<s>     another generated tree (default: the game's)
 *   ?points=<n>   point budget (default 123: level 100 plus every bonus)
 *   ?alloc=a,b    start with these node ids allocated (save format)
 *   ?focus=<id>   centre on a node
 *
 * window.__RIFT_TREE__ = { view, tree, state, sounds() } for scripts and the e2e suite.
 * Allocations are kept in localStorage so a refresh keeps your build.
 */
import '../../../style.css';
import { AudioManager } from '../../../engine/audio/AudioManager';
import { DEFAULT_TREE_SEED, generateTree } from '../../tree/generate';
import { PassiveTree, pointBudget, TreeState } from '../../tree/tree';
import { TreeView } from './TreeView';

const params = new URLSearchParams(location.search);
const seedArg = params.get('seed') ?? DEFAULT_TREE_SEED;
const seed = /^\d+$/.test(seedArg) ? Number(seedArg) : seedArg;
const tree = new PassiveTree(generateTree({ seed }));
const points = Number(params.get('points') ?? pointBudget(100, 30).total);
const storeKey = `riftlight:tree:${seedArg}`;

function saved(): string[] {
  if (params.has('alloc')) return (params.get('alloc') ?? '').split(',').filter(Boolean);
  try {
    return JSON.parse(localStorage.getItem(storeKey) ?? '[]') as string[];
  } catch {
    return [];
  }
}

const state = TreeState.load(tree, saved(), points);
const audio = new AudioManager();
const container = document.getElementById('app')!;
const view = new TreeView({
  container,
  tree,
  state,
  audio,
  closeKeys: [],
  onChange: (_change, s) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(s.serialize()));
    } catch {
      /* private mode: not persisted */
    }
  },
});
view.focus(params.get('focus'), 0.12);
view.open();

declare global {
  interface Window {
    __RIFT_TREE__?: { view: TreeView; tree: PassiveTree; state: TreeState; sounds: () => Record<string, number> };
  }
}
window.__RIFT_TREE__ = { view, tree, state, sounds: () => ({ ...audio.counts }) };
