import type { Vec3 } from '../../../engine/animation';
import type { HeadAnchors, PaletteSlot } from '../types';
import { SkeletonBuilder, type Side } from './builder';

/** Anchors used when a plan has a head but no head part decided them. */
export const DEFAULT_HEAD: HeadAnchors = {
  eyes: [[0.2, 0.55, 0.42]],
  horns: [0.28, 0.85, 0.05],
  jaw: [0, 0.22, 0.12],
  crest: [0, 0.95, 0],
  size: [1, 1, 1],
};

/**
 * Folded wing stance (deg): inner sweep back, outer sweep, inner raise, outer raise, outer
 * flip. The outer half folds right back onto the inner one (swept 175°, rolled over 180°),
 * so a folded wing lies along the flank, membrane or feathers trailing the same way as the
 * inner half, instead of crossing over the back.
 */
export const WING_FOLD = [78, 175, 14, -6, 180] as const;

/**
 * Wings: two-joint chains (Wing1 root, Wing2 at half span) on each side, extending along
 * ±X, with sockets for the wing part on both segments. The stance folds them back.
 */
export function addWings(b: SkeletonBuilder, parent: string, at: Vec3, span: number): { R: string[]; L: string[] } {
  const out: { R: string[]; L: string[] } = { R: [], L: [] };
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const w1 = b.joint(`Wing1${side}`, parent, [at[0] * sx, at[1], at[2]]);
    const w2 = b.joint(`Wing2${side}`, w1, [(span / 2) * sx, 0, 0]);
    b.socket(`wing1${side}`, 'wings', w1, [0, 0, 0], span, { mirror: side === 'R', data: { segment: 1 } });
    b.socket(`wing2${side}`, 'wings', w2, [0, 0, 0], span, { mirror: side === 'R', data: { segment: 2 } });
    out[side].push(w1, w2);
    b.stance[w1] = [0, WING_FOLD[0] * sx, WING_FOLD[2] * sx];
    b.stance[w2] = [WING_FOLD[4], WING_FOLD[1] * sx, WING_FOLD[3] * sx];
  }
  return out;
}

/**
 * A tapering tail: `count` joints stepping backwards from `at` on `parent`, body shapes on
 * each and a 'tail' socket at the tip. Returns the chain.
 */
export function addTail(b: SkeletonBuilder, parent: string, at: Vec3, count: number, seg: number, radius: number, color: PaletteSlot = 'primary', droop = -12): string[] {
  const chain = b.chain('Tail', parent, at, [0, 0, -seg], count);
  // a drooping tail never drags: the tip stays above a third of the base's height
  const baseY = b.world(parent)[1] + at[1];
  const total = droop * (1 + 0.4 * (count - 1));
  const most = (Math.asin(Math.max(0, Math.min(1, ((baseY - radius * 1.3) * 0.65) / (seg * count * 1.1)))) * 180) / Math.PI;
  if (total < -most) droop *= most / -total;
  chain.forEach((j, i) => {
    const r0 = radius * (1 - i / (count + 1));
    const r1 = radius * (1 - (i + 1) / (count + 1));
    b.limb(j, seg * 1.25, r0 * 2, Math.max(0.25, r1 / r0), 0, color, { at: [0, 0, -seg / 2], rot: [90, 0, 0] });
    b.stance[j] = [i === 0 ? droop : droop * 0.4, 0, 0];
  });
  b.socket('tail', 'tail', chain[chain.length - 1]!, [0, 0, -seg], radius * 2.2, { data: { chain } });
  return chain;
}

/** Hanging tentacles in a ring under `parent`; one socket per tentacle carrying its chain. */
export function addTentacles(b: SkeletonBuilder, parent: string, centre: Vec3, ring: number, count: number, seg: number, joints = 3): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;
    const chain = b.chain(`Tent${i}_`, parent, [centre[0] + Math.sin(a) * ring, centre[1], centre[2] + Math.cos(a) * ring], [0, -seg, 0], joints);
    b.socket(`tentacle${i}`, 'tentacles', chain[0]!, [0, 0, 0], seg, { data: { chain, index: i } });
    chain.forEach((j, k) => (b.stance[j] = [-Math.cos(a) * (k ? 8 : 16), 0, Math.sin(a) * (k ? 8 : 16)]));
    out.push(chain);
  }
  return out;
}

export const both = (fn: (side: Side, sx: -1 | 1) => void): void => {
  fn('R', -1);
  fn('L', 1);
};
