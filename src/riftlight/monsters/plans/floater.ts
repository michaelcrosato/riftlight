import { flag, flat, inc } from '../../core/mods';
import type { BodyPlanDef } from '../types';
import { SkeletonBuilder, gene } from './builder';
import { addTail, addTentacles, addWings } from './common';

/**
 * Hovering body: the head part *is* the body (an eye, a wisp, a jelly bell, a floating
 * skull), carried by the root at hover height, with optional hanging tentacles, wings and
 * a trailing wisp tail. Bobs and drifts; leans into its movement.
 */
export const floater: BodyPlanDef = {
  id: 'floater',
  name: 'Floater',
  description: 'Hovering wisps, eyes, jellyfish and skulls with trailing tentacles.',
  tags: ['flying', 'hover'],
  weight: 0.9,
  genes: {
    hover: { mean: 0.5, spread: 0.2 },
    headSize: { mean: 0.5, spread: 0.2 },
    length: { mean: 0.5, spread: 0.2 },
    tentacles: { mean: 0.5, spread: 0.3 },
    tailLength: { mean: 0.4, spread: 0.2 },
  },
  slots: { head: 1, eyes: 0.85, jaw: 0.3, horns: 0.35, helm: 0.15, back: 0.25, wings: 0.25, tail: 0.25, core: 0.55, tentacles: 0.6 },
  mods: [flat('evasion', 50), inc('life', -0.15), flag('flying')],
  baseScale: 0.9,
  build(ctx) {
    const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
    const b = new SkeletonBuilder('floater');
    const hs = g('headSize', 0.42, 0.72);
    const hover = g('hover', 0.75, 1.3) + hs * 0.3;
    const root = b.joint('Body', null, [0, hover, 0]);
    const head = b.joint('Head', root, [0, -hs * 0.5, -hs * 0.05]);
    const jaw = b.head(head, hs, ctx.head);
    let tentacles: string[][] = [];
    if (ctx.has('tentacles')) {
      const count = 3 + Math.round(g('tentacles', 0, 4));
      const room = hover - hs * 0.45 - 0.18;
      const seg = Math.max(0.06, Math.min(room / 3, g('length', 0.12, 0.24)));
      tentacles = addTentacles(b, root, [0, -hs * 0.38, 0], hs * 0.26, count, seg);
    }
    const wings = ctx.has('wings') ? addWings(b, root, [hs * 0.36, hs * 0.05, -hs * 0.08], g('wingSpan', 0.8, 1.4)) : null;
    const tail = ctx.has('tail') ? addTail(b, root, [0, -hs * 0.1, -hs * 0.42], 3, g('tailLength', 0.1, 0.2), hs * 0.18, 'secondary', -20) : [];
    b.socket('back', 'back', root, [0, hs * 0.38, -hs * 0.18], hs * 0.8);
    b.socket('core', 'core', root, [0, -hs * 0.05, hs * 0.38], hs * 0.35);

    const stub = { frames: 60, stance: 0, phase: {}, stride: 0, lift: 0, bob: 0.06 };
    return b.done({
      roles: { root, spine: [], chest: null, neck: [], head, jaw, tail, wings, tentacles, mass: head },
      locomotion: 'float',
      gaits: { walk: stub, run: { ...stub, frames: 40 } },
      height: hover + hs * 0.55,
      radius: hs * 0.6,
      length: hs,
    });
  },
};
