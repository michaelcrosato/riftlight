import { flat, inc } from '../../core/mods';
import type { BodyPlanDef, GaitDef } from '../types';
import { SkeletonBuilder, gene } from './builder';
import { both } from './common';

/**
 * Many segments, many legs: a head segment (root) with mandibles and a chain of body
 * segments, each carrying a pair of short splayed legs. Legs hang from their own segment,
 * so the body can sway while the feet stay planted. Wave gait: a ripple runs from head to
 * tail, the two sides half a cycle apart.
 */
export const centipede: BodyPlanDef = {
  id: 'centipede',
  name: 'Centipede',
  description: 'Segmented crawler with a leg pair per segment and a ripple gait.',
  tags: ['legged', 'insect', 'crawler', 'segmented'],
  weight: 0.7,
  genes: {
    length: { mean: 0.5, spread: 0.2 },
    girth: { mean: 0.5, spread: 0.2 },
    legLength: { mean: 0.45, spread: 0.2 },
    headSize: { mean: 0.5, spread: 0.2 },
    segments: { mean: 0.5, spread: 0.3 },
    limbThickness: { mean: 0.4, spread: 0.2 },
  },
  slots: { head: 1, eyes: 1, jaw: 0.9, horns: 0.5, back: 0.5, tail: 0.5, core: 0.15 },
  mods: [inc('move.speed', 0.1), flat('armour', 15)],
  defaults: { feet: 'foot.tip', jaw: 'jaw.mandibles.small' },
  baseScale: 1,
  build(ctx) {
    const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
    const b = new SkeletonBuilder('centipede');
    const r = g('girth', 0.1, 0.16);
    const h = g('legLength', 0.18, 0.3);
    const n = Math.round(g('segments', 4, 8));
    const segLen = r * g('length', 1.7, 2.3);
    const thick = g('limbThickness', 0.025, 0.045);
    const hs = g('headSize', 0.18, 0.3);
    const ankle = 0.025;

    const root = b.joint('Body', null, [0, h, (segLen * n) / 2]);
    b.shape(root, 'sphere', [r * 2.3, r * 1.6, segLen * 1.1], [0, 0, 0], 'primary');
    const head = b.joint('Head', root, [0, 0.01, segLen * 0.45]);
    const jaw = b.head(head, hs, ctx.head);
    const segs = b.chain('Seg', root, [0, 0, -segLen], [0, 0, -segLen], n);
    segs.forEach((s, i) => {
      const k = 1 - (i / n) * 0.35;
      b.shape(s, 'sphere', [r * 2.4 * k, r * 1.6 * k, segLen * 1.18], [0, 0, 0], 'primary');
      // an overlapping armour plate with side points over every segment
      b.shape(s, 'sphere', [r * 2.7 * k, r * 0.7 * k, segLen * 0.9], [0, r * 0.55 * k, -segLen * 0.08], 'dark');
      both((_side, sx) => b.shape(s, 'cone', [r * 0.4 * k, r * 0.8 * k, r * 0.4 * k], [sx * r * 1.35 * k, r * 0.5 * k, -segLen * 0.1], 'secondary', { rot: [0, 0, -sx * 70] }));
    });

    const reach = h * 1.3 + 0.06;
    const dist = Math.hypot(reach * 0.92, h - ankle);
    const phase: Record<string, number> = {};
    const carriers = [root, ...segs];
    both((side, sx) => {
      carriers.forEach((parent, i) => {
        const k = 1 - (i / carriers.length) * 0.3;
        b.leg({
          pair: i,
          side,
          parent,
          hip: [sx * r * 0.95 * k, -r * 0.35, 0],
          splay: sx * (i === 0 ? 62 : i === carriers.length - 1 ? 118 : 88),
          upper: dist * 0.62,
          lower: dist * 0.68,
          ankle,
          bend: 1,
          thick,
          sole: [thick * 1.5, thick * 2],
          reach,
          colors: ['secondary', 'dark', 'dark'],
        });
        phase[`${i}${side}`] = (((carriers.length - i) * 0.17 + (side === 'R' ? 0.5 : 0)) % 1 + 1) % 1;
      });
    });

    b.socket('back', 'back', segs[0]!, [0, r * 0.8, 0], r * 2.2);
    for (let i = 2; i < segs.length; i += 2) b.socket(`back${i}`, 'back', segs[i]!, [0, r * 0.75, 0], r * 2);
    b.socket('tail', 'tail', segs[segs.length - 1]!, [0, 0.02, -segLen * 0.5], r * 2, { data: { chain: segs.slice(-2) } });
    b.socket('core', 'core', root, [0, r * 0.7, 0], r);

    const gait = (frames: number, stance: number, stride: number): GaitDef => ({ frames, stance, phase, stride, lift: 0.1, bob: 0.006, bobs: 2, pace: 1.1 });
    return b.done({
      roles: { root, spine: [], chest: null, neck: [], head, jaw, tail: [], wings: null, segments: segs },
      locomotion: 'legs',
      gaits: { walk: gait(24, 0.62, 0.42), run: gait(16, 0.55, 0.5) },
      height: h + r * 1.4,
      radius: reach + r,
      length: segLen * (n + 1) + hs,
    });
  },
};
