import { flat, inc } from '../../core/mods';
import type { BodyPlanDef } from '../types';
import { SkeletonBuilder, gene } from './builder';
import { addTail, addWings, both } from './common';

/**
 * Birds and harpies: an egg-shaped body on two backward-kneed legs, a long neck, wings
 * that fold back, a fan tail. Small ones hop with both feet together (wings flick on
 * every hop); big ones (low `hop` gene) stride.
 */
export const avian: BodyPlanDef = {
  id: 'avian',
  name: 'Avian',
  description: 'Two backward-kneed legs and wings; hops: crows, harpies, cockatrices, terror birds.',
  tags: ['legged', 'winged', 'beast'],
  weight: 0.8,
  genes: {
    length: { mean: 0.5, spread: 0.2 },
    girth: { mean: 0.5, spread: 0.2 },
    legLength: { mean: 0.45, spread: 0.2 },
    neck: { mean: 0.5, spread: 0.2 },
    headSize: { mean: 0.45, spread: 0.2 },
    limbThickness: { mean: 0.4, spread: 0.2 },
    hop: { mean: 0.65, spread: 0.3 },
    wingSpan: { mean: 0.5, spread: 0.2 },
  },
  slots: { head: 1, eyes: 1, wings: 1, horns: 0.35, helm: 0.15, back: 0.25, tail: 0.6, feet: 0.6, core: 0.15 },
  mods: [inc('move.speed', 0.1), flat('evasion', 30)],
  baseScale: 0.9,
  build(ctx) {
    const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
    const b = new SkeletonBuilder('avian');
    const girth = g('girth', 0.8, 1.3);
    const legLen = g('legLength', 0.3, 0.62);
    const hipH = legLen * 0.92;
    const bodyLen = g('length', 0.4, 0.62) * girth;
    const thick = g('limbThickness', 0.04, 0.07);
    const hs = g('headSize', 0.2, 0.34);
    const neckSeg = g('neck', 0.08, 0.2);
    const ankle = 0.04;

    const root = b.joint('Body', null, [0, hipH, 0]);
    b.shape(root, 'sphere', [0.32 * girth, 0.3 * girth, bodyLen], [0, 0.1 * girth, 0.02], 'primary', { rot: [-14, 0, 0] });
    b.shape(root, 'sphere', [0.24 * girth, 0.2 * girth, bodyLen * 0.7], [0, 0.02 * girth, 0.07], 'secondary', { rot: [-14, 0, 0] });
    const n1 = b.joint('Neck1', root, [0, 0.16 * girth, bodyLen * 0.38]);
    const n2 = b.joint('Neck2', n1, [0, neckSeg, 0]);
    b.shape(n1, 'taper', [0.13 * girth, neckSeg * 1.3, 0.13 * girth], [0, neckSeg / 2, 0], 'primary', { taper: 0.8 });
    b.shape(n2, 'taper', [0.1 * girth, neckSeg * 1.2, 0.1 * girth], [0, neckSeg / 2, 0], 'secondary', { taper: 0.9 });
    const head = b.joint('Head', n2, [0, neckSeg, 0]);
    const jaw = b.head(head, hs, ctx.head);
    b.stance[n1] = [20, 0, 0];
    b.stance[n2] = [-12, 0, 0];
    b.stance[head] = [-8, 0, 0];

    both((side, sx) => {
      b.leg({
        pair: 0,
        side,
        parent: root,
        hip: [sx * 0.08 * girth, -0.02, 0.02],
        upper: (legLen - ankle) * 0.5,
        lower: (legLen - ankle) * 0.54,
        ankle,
        bend: -1,
        thick,
        sole: [thick * 2.2, thick * 3.2],
        footZ: 0.05,
        colors: ['secondary', 'accent', 'accent'],
      });
    });
    const wings = addWings(b, root, [0.13 * girth, 0.17 * girth, 0.02], g('wingSpan', 0.7, 1.3) * girth);
    const tail = addTail(b, root, [0, 0.13 * girth, -bodyLen * 0.42], 1, 0.08, 0.05 * girth, 'secondary', 12);
    b.socket('back', 'back', root, [0, 0.24 * girth, -0.02], bodyLen * 0.8);
    b.socket('core', 'core', root, [0, 0.1 * girth, bodyLen * 0.45], 0.1 * girth);

    const hop = (ctx.genes.hop ?? 0.6) > 0.45;
    const both0 = { '0R': 0, '0L': hop ? 0 : 0.5 };
    return b.done({
      roles: { root, spine: [], chest: null, neck: [n1, n2], head, jaw, tail, wings },
      locomotion: hop ? 'hop' : 'legs',
      gaits: hop
        ? {
            walk: { frames: 16, stance: 0.5, phase: both0, stride: 0.55, lift: 0.08, bob: 0.01, hop: 0.12 * legLen + 0.04 },
            run: { frames: 13, stance: 0.4, phase: both0, stride: 0.85, lift: 0.1, bob: 0.01, hop: 0.2 * legLen + 0.06, lean: 6 },
          }
        : {
            walk: { frames: 24, stance: 0.6, phase: both0, stride: 0.8, lift: 0.14, bob: 0.02, lean: 4 },
            run: { frames: 16, stance: 0.38, phase: both0, stride: 1.1, lift: 0.2, bob: 0.03, lean: 12 },
          },
      height: hipH + 0.3 * girth + neckSeg * 2 + hs,
      radius: 0.3 * girth,
      length: bodyLen + hs,
    });
  },
};
