import { flat, inc } from '../../core/mods';
import type { BodyPlanDef, GaitDef } from '../types';
import { SkeletonBuilder, gene, type Side } from './builder';
import { addWings, both } from './common';

/**
 * Insects and spiders: a low thorax (root) with an abdomen behind and a head in front,
 * three or four pairs of splayed legs whose knees ride high. Tripod gait (alternating
 * triangles) for six legs, alternating tetrapods for eight.
 */
export const hexapod: BodyPlanDef = {
  id: 'hexapod',
  name: 'Hexapod',
  description: 'Spiders and insects: splayed legs with high knees, thorax, abdomen, mandibles.',
  tags: ['legged', 'insect', 'crawler'],
  weight: 1,
  genes: {
    length: { mean: 0.5, spread: 0.2 },
    girth: { mean: 0.5, spread: 0.2 },
    legLength: { mean: 0.5, spread: 0.2 },
    headSize: { mean: 0.45, spread: 0.2 },
    limbThickness: { mean: 0.4, spread: 0.2 },
    legPairs: { mean: 0.45, spread: 0.3 },
    abdomen: { mean: 0.5, spread: 0.2 },
  },
  slots: { head: 1, eyes: 1, jaw: 0.75, horns: 0.35, back: 0.45, wings: 0.25, tail: 0.3, core: 0.3 },
  mods: [inc('move.speed', 0.2), flat('evasion', 40)],
  defaults: { feet: 'foot.tip', jaw: 'jaw.mandibles.small' },
  baseScale: 0.95,
  build(ctx) {
    const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
    const b = new SkeletonBuilder('hexapod');
    const pairs = (ctx.genes.legPairs ?? 0.5) > 0.55 ? 4 : 3;
    const girth = g('girth', 0.8, 1.3);
    const h = g('legLength', 0.24, 0.42);
    const len = g('length', 0.26, 0.44);
    const thick = g('limbThickness', 0.035, 0.065);
    const hs = g('headSize', 0.22, 0.36);
    const ankle = 0.03;

    // thorax under a carapace shield, a waist, a big abdomen with a darker back and a spinneret
    const root = b.joint('Body', null, [0, h, 0.05]);
    b.shape(root, 'sphere', [0.34 * girth, 0.2 * girth, len], [0, 0.02, 0], 'primary');
    b.shape(root, 'sphere', [0.3 * girth, 0.1 * girth, len * 0.86], [0, 0.08 * girth, 0], 'secondary');
    b.shape(root, 'sphere', [0.2 * girth, 0.12, len * 0.6], [0, -0.06 * girth, 0], 'dark');
    const abLen = g('abdomen', 0.35, 0.7) * girth;
    const abdomen = b.joint('Abdomen', root, [0, 0.05, -len / 2]);
    b.shape(abdomen, 'sphere', [0.12 * girth, 0.1 * girth, 0.12 * girth], [0, 0, 0], 'dark');
    b.shape(abdomen, 'sphere', [abLen * 0.85, abLen * 0.72, abLen], [0, abLen * 0.14, -abLen * 0.46], 'primary');
    b.shape(abdomen, 'sphere', [abLen * 0.6, abLen * 0.4, abLen * 0.76], [0, abLen * 0.42, -abLen * 0.44], 'secondary');
    b.shape(abdomen, 'cone', [abLen * 0.18, abLen * 0.2, abLen * 0.18], [0, abLen * 0.02, -abLen * 0.95], 'dark', { rot: [-100, 0, 0] });
    const head = b.joint('Head', root, [0, 0.0, len / 2 - 0.02]);
    const jaw = b.head(head, hs, ctx.head);

    const splays = pairs === 3 ? [42, 90, 138] : [34, 70, 108, 146];
    const reach = h * 1.45 + 0.08;
    const legs: Record<string, number> = {};
    both((side: Side, sx) => {
      splays.forEach((sp, i) => {
        const z = len * 0.38 - (len * 0.76 * i) / (splays.length - 1);
        const hipY = h - 0.03;
        const dist = Math.hypot(reach * 0.92, hipY - ankle);
        b.leg({
          pair: i,
          side,
          parent: root,
          hip: [sx * 0.13 * girth, -0.03, z],
          splay: sx * sp,
          upper: dist * 0.66,
          lower: dist * 0.72,
          ankle,
          bend: 1,
          thick,
          sole: [thick * 1.4, thick * 2],
          reach,
          colors: ['primary', 'secondary', 'dark'],
        });
        // tripod / tetrapod: alternate along each side, opposite between sides
        legs[`${i}${side}`] = ((i + (side === 'R' ? 1 : 0)) % 2) * 0.5;
      });
    });

    b.socket('back', 'back', abdomen, [0, abLen * 0.5, -abLen * 0.4], abLen);
    b.socket('core', 'core', abdomen, [0, abLen * 0.2, -abLen * 0.85], abLen * 0.3);
    b.socket('tail', 'tail', abdomen, [0, abLen * 0.3, -abLen * 0.88], abLen * 0.5, { data: { chain: [abdomen] } });
    const wings = ctx.has('wings') ? addWings(b, root, [0.06 * girth, 0.1 * girth, -0.02], g('wingSpan', 0.7, 1.2)) : null;
    b.stance[abdomen] = [-6, 0, 0];

    const gait = (frames: number, stance: number, stride: number, lift: number, bob: number): GaitDef => ({ frames, stance, phase: legs, stride, lift, bob, bobs: 2, pace: 1.15 });
    return b.done({
      roles: { root, spine: [abdomen], chest: null, neck: [], head, jaw, tail: [], wings },
      locomotion: 'legs',
      gaits: { walk: gait(22, 0.56, 0.38, 0.1, 0.01), run: gait(14, 0.5, 0.48, 0.13, 0.015) },
      height: h + 0.25 * girth,
      radius: reach + 0.1,
      length: len + abLen + hs,
    });
  },
};
