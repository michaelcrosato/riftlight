/**
 * What the player does to the passive tree, as rules on the `TreeState`: allocate the path to a
 * node (or cycle a mastery), refund one, close. The page's `TreeView` and the shell's tree panel
 * (headless, without a view) both apply them here, so a recorded `rl:'tree'` action does the same
 * to the tree in either; the view only adds its pulses and messages from the outcome.
 */
import type { SoundDef } from '../../../engine/audio/synth';
import type { PassiveTree, TreeChange, TreeState } from '../../tree/tree';
import type { TreeNode } from '../../tree/types';

/** What the view needs from an AudioManager (ctx.audio). */
export interface TreeAudio {
  play(sound: string, options?: { pitch?: number; volume?: number }): unknown;
  register?(name: string, def: SoundDef): void;
}

/** What the player does to the tree: allocate the path to a node (or cycle a mastery), refund one, close the view. */
export type TreeAction = { readonly kind: 'activate' | 'refund'; readonly id: string } | { readonly kind: 'close' };

/** What a game decides about the tree: gold for refunds, who may refund, where changes go. */
export interface TreeRules {
  audio?: TreeAudio | null;
  /** Called after every allocation, refund or mastery choice. */
  onChange?: (change: TreeChange, state: TreeState) => void;
  /** Gold to refund `points` points (respecCost); 0 or absent = free. */
  refundCost?: (points: number) => number;
  /** Take gold for a refund; return false to refuse it (not enough gold). */
  spendGold?: (amount: number) => boolean;
  /** Why refunds are refused here (e.g. only the mystic refunds): a message, or null to allow them. */
  refundBlocked?: () => string | null;
}

/** What an action did: the view shows it (a pulse, a message); headless nothing does. */
export type TreeOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'deny'; readonly text: string }
  | { readonly kind: 'mastery'; readonly ids: readonly string[] }
  | { readonly kind: 'allocate'; readonly ids: readonly string[]; readonly node: TreeNode }
  | { readonly kind: 'refund'; readonly id: string; readonly cost: number };

const SOUNDS: Record<string, SoundDef> = {
  treeAllocate: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 4, 7], arpRate: 0.045, attack: 0.002, sustain: 0.06, decay: 0.16, volume: 0.18 },
  treeNotable: { wave: 'square', duty: 0.25, freq: 523.25, arp: [0, 4, 7, 12], arpRate: 0.05, attack: 0.002, sustain: 0.12, decay: 0.25, volume: 0.2 },
  treeKeystone: {
    wave: 'square',
    duty: 0.5,
    freq: 261.63,
    arp: [0, 7, 12, 19, 24],
    arpRate: 0.06,
    attack: 0.002,
    sustain: 0.25,
    decay: 0.4,
    volume: 0.2,
    layers: [{ wave: 'triangle', freq: 130.81, attack: 0.002, sustain: 0.2, decay: 0.4, volume: 0.35 }],
  },
  treeRefund: { wave: 'triangle', freq: 660, freqEnd: 220, attack: 0.002, decay: 0.18, volume: 0.3 },
  treeDeny: { wave: 'square', duty: 0.5, freq: 110, attack: 0.002, sustain: 0.05, decay: 0.08, volume: 0.14 },
  treeTick: { wave: 'square', duty: 0.125, freq: 1760, attack: 0.001, decay: 0.02, volume: 0.05 },
};

/** The tree's sounds, into the audio that will play them. */
export function registerTreeSounds(audio: TreeAudio | null | undefined): void {
  for (const [name, def] of Object.entries(SOUNDS)) audio?.register?.(name, def);
}

function deny(rules: TreeRules, text: string): TreeOutcome {
  rules.audio?.play('treeDeny');
  return { kind: 'deny', text };
}

/** Allocate the path to `id`, or cycle an allocated mastery's option. */
export function activateNode(tree: PassiveTree, s: TreeState, id: string, rules: TreeRules): TreeOutcome {
  const node = tree.get(id);
  if (!node) return { kind: 'none' };
  if (s.isAllocated(id)) {
    // An allocated mastery: cycle its option.
    const opts = node.options;
    if (!opts?.length || !s.allocated.has(id)) return { kind: 'none' };
    const cur = opts.findIndex((o) => o.id === s.masteries.get(id));
    const next = opts[(cur + 1) % opts.length]!;
    s.choose(id, next.id);
    rules.audio?.play('treeAllocate', { pitch: 5 });
    rules.onChange?.({ kind: 'mastery', ids: [id] }, s);
    return { kind: 'mastery', ids: [id] };
  }
  const path = s.pathTo(id);
  if (!path) return deny(rules, 'UNREACHABLE');
  if (path.length > s.unspent) return deny(rules, s.unspent <= 0 ? 'NO PASSIVE POINTS LEFT' : `NEED ${path.length} POINTS, HAVE ${s.unspent}`);
  const got = s.allocatePath(id);
  if (!got.length) return deny(rules, 'CAN NOT ALLOCATE');
  const kind = node.kind;
  rules.audio?.play(kind === 'keystone' ? 'treeKeystone' : kind === 'notable' ? 'treeNotable' : 'treeAllocate');
  rules.onChange?.({ kind: 'allocate', ids: got }, s);
  return { kind: 'allocate', ids: got, node };
}

/** Refund one node, if nothing depends on it and the rules allow it. */
export function refundNode(tree: PassiveTree, s: TreeState, id: string, rules: TreeRules): TreeOutcome {
  if (!s.allocated.has(id)) return tree.roots.has(id) ? deny(rules, 'THE GATES ARE FREE') : { kind: 'none' };
  const blocked = rules.refundBlocked?.() ?? null;
  if (blocked) return deny(rules, blocked);
  if (!s.canDeallocate(id)) return deny(rules, 'OTHER NODES DEPEND ON IT');
  const cost = rules.refundCost?.(1) ?? 0;
  if (cost > 0 && rules.spendGold && !rules.spendGold(cost)) return deny(rules, `REFUND COSTS ${cost} GOLD`);
  s.deallocate(id);
  rules.audio?.play('treeRefund');
  rules.onChange?.({ kind: 'deallocate', ids: [id] }, s);
  return { kind: 'refund', id, cost };
}
