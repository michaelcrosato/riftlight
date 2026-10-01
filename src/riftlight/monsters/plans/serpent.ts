import { flat, inc } from '../../core/mods';
import type { BodyPlanDef } from '../types';
import { SkeletonBuilder, gene } from './builder';
import { addWings } from './common';

/**
 * Legless and segmented: the root is the front of the body; a chain of tapering segments
 * trails behind, a two-joint neck rises in front (posture = how cobra-like). Locomotion is
 * a slither: a lateral wave travels down the chain at the ground speed, so every segment
 * follows the same path.
 */
export const serpent: BodyPlanDef = {
  id: 'serpent',
  name: 'Serpent',
  description: 'Segmented, slithering: snakes, wyrms, eels, sandworms.',
  tags: ['legless', 'segmented'],
  weight: 0.9,
  genes: {
    length: { mean: 0.5, spread: 0.2 },
    girth: { mean: 0.5, spread: 0.2 },
    neck: { mean: 0.5, spread: 0.2 },
    headSize: { mean: 0.5, spread: 0.2 },
    posture: { mean: 0.5, spread: 0.25 },
    segments: { mean: 0.5, spread: 0.25 },
  },
  slots: { head: 1, eyes: 1, jaw: 0.8, horns: 0.45, helm: 0.1, back: 0.45, shoulders: 0.35, wings: 0.1, tail: 0.5, core: 0.2 },
  mods: [flat('evasion', 60), inc('attack.speed', 0.1)],
  defaults: { jaw: 'jaw.plain' },
  baseScale: 1,
  build(ctx) {
    const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
    const b = new SkeletonBuilder('serpent');
    const r = g('girth', 0.11, 0.2);
    const n = Math.round(g('segments', 5, 9));
    const segLen = r * g('length', 1.4, 2.0);
    const hs = g('headSize', 0.24, 0.4);
    const neckSeg = g('neck', 0.14, 0.26);
    const raise = g('posture', 0.1, 1);

    const root = b.joint('Body', null, [0, r + 0.01, (n * segLen) / 3]);
    b.shape(root, 'sphere', [r * 2.1, r * 2, segLen * 1.5], [0, 0, 0], 'primary');
    b.shape(root, 'sphere', [r * 1.5, r * 0.9, segLen * 1.3], [0, -r * 0.5, 0.02], 'secondary');
    const segs = b.chain('Seg', root, [0, 0, -segLen], [0, 0, -segLen], n);
    segs.forEach((s, i) => {
      const k = 1 - (i + 1) / (n + 2);
      b.shape(s, 'sphere', [r * 2.1 * k + 0.02, r * 2 * k + 0.02, segLen * 1.5], [0, (k - 1) * r, 0], 'primary');
      b.shape(s, 'sphere', [r * 1.5 * k, r * 0.62 * k, segLen * 1.3], [0, (k - 1) * r - r * k * 0.56, 0], 'secondary');
      // a dark scale ridge down the back
      b.shape(s, 'cone', [r * 0.5 * k, r * 0.55 * k, segLen * 0.5], [0, (k - 1) * r + r * k * 1.02, -segLen * 0.1], 'dark', { rot: [-28, 0, 0] });
    });

    const n1 = b.joint('Neck1', root, [0, r * 0.3, segLen * 0.55]);
    const n2 = b.joint('Neck2', n1, [0, 0, neckSeg]);
    b.shape(n1, 'taper', [r * 1.8, neckSeg * 1.25, r * 1.8], [0, 0, neckSeg / 2], 'primary', { rot: [90, 0, 0], taper: 0.85 });
    b.shape(n2, 'taper', [r * 1.55, neckSeg * 1.2, r * 1.55], [0, 0, neckSeg / 2], 'primary', { rot: [90, 0, 0], taper: 0.85 });
    const head = b.joint('Head', n2, [0, 0, neckSeg]);
    const jaw = b.head(head, hs, ctx.head);
    b.stance[n1] = [-38 * raise, 0, 0];
    b.stance[n2] = [-24 * raise, 0, 0];
    b.stance[head] = [62 * raise - 8, 0, 0];

    b.socket('back', 'back', segs[0]!, [0, r * 0.95, 0], r * 2);
    b.socketPair('hood', 'shoulders', () => n1, [r * 0.7, 0, neckSeg * 0.5], r * 2.2, { rot: [0, 0, 0] });
    b.socket('core', 'core', root, [0, r * 0.4, r * 0.5], r * 0.9);
    b.socket('tail', 'tail', segs[n - 1]!, [0, -r * 0.6, -segLen * 0.55], r * 1.6, { data: { chain: segs.slice(-3) } });
    const wings = ctx.has('wings') ? addWings(b, root, [r * 0.8, r * 0.5, 0], g('wingSpan', 1.0, 1.6)) : null;

    const stub = { frames: 40, stance: 0, phase: {}, stride: 0, lift: 0, bob: 0 };
    return b.done({
      roles: { root, spine: [], chest: null, neck: [n1, n2], head, jaw, tail: [], wings, segments: segs },
      locomotion: 'slither',
      gaits: { walk: stub, run: { ...stub, frames: 26 } },
      height: r * 2 + neckSeg * 2 * raise + hs,
      radius: r * 2.5,
      length: segLen * (n + 1.5) + neckSeg * 2,
    });
  },
};
