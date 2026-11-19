/**
 * /tree.html: the passive tree on its own page, for browsing and for agents.
 *
 *   ?seed=<s>     another generated tree (default: the game's)
 *   ?points=<n>   point budget (default 123: level 100 plus every bonus)
 *   ?alloc=a,b    start with these node ids allocated (save format)
 *   ?focus=<id>   centre on a node
 *   ?lang=<code>  its words in another language (docs/game/lang.md; en-XA, zh-XC, ar-XB test them)
 *
 * window.__RIFT_TREE__ = { view, tree, state, sounds() } for scripts and the e2e suite.
 * Allocations are kept in localStorage so a refresh keeps your build.
 */
import '../../../style.css';
import { AudioManager } from '../../../engine/audio/AudioManager';
import { Input } from '../../../engine/input';
import { pageLanguage } from '../../lang/index';
import { DEFAULT_TREE_SEED, generateTree } from '../../tree/generate';
import { PassiveTree, pointBudget, TreeState } from '../../tree/tree';
import { TreeView } from './TreeView';

pageLanguage();
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
// no engine here to say which device is in use: a phone's or a tablet's coarse pointer is a finger
// (the bottom bar names taps before the first touch), anything else the mouse and keys; what then
// uses the view itself takes over
const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
const view = new TreeView({
  container,
  tree,
  state,
  audio,
  device: () => (coarse?.matches ? 'touch' : 'keyboard'),
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

// the pad as a game reads it: the engine's input (the pad in use, its sticks after the deadzone),
// polled once a frame and handed to the view (`TreeView.pad`); it hears no keys (the view's own)
const input = new Input(null);
let last = -1;
const frame = (now: number) => {
  requestAnimationFrame(frame);
  const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  input.beginFrame(now / 1000, dt);
  view.pad(input, dt);
  input.endFrame();
};
requestAnimationFrame(frame);

declare global {
  interface Window {
    __RIFT_TREE__?: { view: TreeView; tree: PassiveTree; state: TreeState; sounds: () => Record<string, number> };
  }
}
window.__RIFT_TREE__ = { view, tree, state, sounds: () => ({ ...audio.counts }) };
