import { inc } from '../../core/mods';
import type { BodyPlanDef } from '../types';
import { SkeletonBuilder, gene } from './builder';
import { addTail, addWings, both } from './common';

/**
 * Four legs: hips (root) → spine → chest, neck chain → head, tail chain. Front legs hang
 * from the chest with knees forward; hind legs from the hips with the hock back. Wolves,
 * boars, lizards, hounds, big cats. `posture` raises the front (hyena) or the back (bull).
 */
export const quadruped: BodyPlanDef = {
  id: 'quadruped',
  name: 'Quadruped',
  description: 'Four legs, a neck and a tail: wolves, boars, hounds, lizards, bulls.',
  tags: ['legged', 'beast'],
  weight: 1.2,
  genes: {
    length: { mean: 0.5, spread: 0.2 },
    girth: { mean: 0.5, spread: 0.2 },
    legLength: { mean: 0.45, spread: 0.2 },
    neck: { mean: 0.4, spread: 0.2 },
    headSize: { mean: 0.5, spread: 0.2 },
    limbThickness: { mean: 0.5, spread: 0.2 },
    posture: { mean: 0.5, spread: 0.2 },
    tailLength: { mean: 0.5, spread: 0.25 },
    /** Running gait: < 0.4 trot (diagonal pairs), < 0.7 pace (lateral pairs, camels), else bound (front pair, then hind). */
    gaitStyle: { mean: 0.35, spread: 0.3 },
  },
  slots: { head: 1, eyes: 1, jaw: 0.6, horns: 0.5, helm: 0.15, back: 0.5, shoulders: 0.3, wings: 0.1, tail: 0.45, feet: 0.45, core: 0.15 },
  mods: [inc('move.speed', 0.15)],
  defaults: { feet: 'foot.paw', jaw: 'jaw.plain' },
  baseScale: 1,
  build(ctx) {
    const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
    const b = new SkeletonBuilder('quadruped');
    const girth = g('girth', 0.75, 1.35);
    const legH = g('legLength', 0.32, 0.66);
    const slope = g('posture', -0.1, 0.16);
    const bodyLen = g('length', 0.5, 0.95);
    const thick = g('limbThickness', 0.07, 0.13) * Math.sqrt(girth);
    const ankle = 0.05;
    const hs = g('headSize', 0.28, 0.46);

    // hips with haunches, a tucked waist, a deep chest with shoulder blades: a beast, not a sausage
    const root = b.joint('Body', null, [0, legH, -bodyLen / 2]);
    b.shape(root, 'sphere', [0.36 * girth, 0.3 * girth, 0.4 * girth], [0, 0.04, 0.02], 'primary');
    both((_s, sx) => b.shape(root, 'sphere', [0.18 * girth, 0.3 * girth, 0.3 * girth], [sx * 0.11 * girth, -0.02, -0.02], 'primary'));
    const spine = b.joint('Spine', root, [0, 0.03 + slope / 2, bodyLen * 0.48]);
    b.shape(spine, 'sphere', [0.34 * girth, 0.27 * girth, bodyLen * 0.86], [0, 0.02 * girth, 0], 'primary');
    const chest = b.joint('Chest', root, [0, slope, bodyLen]);
    b.shape(chest, 'sphere', [0.42 * girth, 0.42 * girth, 0.4 * girth], [0, 0.0, 0], 'primary');
    both((_s, sx) => b.shape(chest, 'sphere', [0.14 * girth, 0.26 * girth, 0.24 * girth], [sx * 0.14 * girth, 0.06 * girth, -0.02], 'primary'));

    const seg = g('neck', 0.1, 0.26);
    const n1 = b.joint('Neck1', chest, [0, 0.1 * girth, 0.14 * girth]);
    const n2 = b.joint('Neck2', n1, [0, seg, 0]);
    b.limb(n1, seg * 1.35, 0.24 * girth, 1.15, 0, 'primary', { at: [0, seg / 2, 0], depth: 1.1 });
    b.limb(n2, seg * 1.25, 0.19 * girth, 1.15, 0, 'primary', { at: [0, seg / 2, 0] });
    const head = b.joint('Head', n2, [0, seg, 0]);
    const jaw = b.head(head, hs, ctx.head);
    b.stance[n1] = [66, 0, 0];
    b.stance[n2] = [-8, 0, 0];
    b.stance[head] = [-58, 0, 0];

    const hip = (side: 'R' | 'L', sx: number, front: boolean) => {
      const parent = front ? chest : root;
      const hp: [number, number, number] = [sx * 0.13 * girth, front ? -0.08 : -0.05, front ? 0.02 : 0];
      const hipY = b.world(parent)[1] + hp[1];
      const len = (hipY - ankle) / 0.95;
      b.leg({
        pair: front ? 0 : 1,
        side,
        parent,
        hip: hp,
        upper: len * 0.5,
        lower: len * 0.52,
        ankle,
        bend: front ? 1 : -1,
        thick: front ? thick : thick * 1.15,
        sole: [thick * 1.3, thick * 1.9],
        footZ: front ? 0.04 : -0.02,
      });
    };
    both((side, sx) => hip(side, sx, true));
    both((side, sx) => hip(side, sx, false));

    const tailN = 3;
    const tail = ctx.has('tail') || (ctx.genes.tailLength ?? 0) > 0.3 ? addTail(b, root, [0, 0.06, -0.18 * girth], tailN, g('tailLength', 0.1, 0.22), thick, 'primary', 18) : [];
    b.socket('back', 'back', spine, [0, 0.15 * girth, 0], bodyLen);
    b.socketPair('shoulder', 'shoulders', () => chest, [0.2 * girth, 0.08 * girth, 0], 0.2 * girth);
    b.socket('core', 'core', chest, [0, 0, 0.19 * girth], 0.14 * girth);
    const wings = ctx.has('wings') ? addWings(b, chest, [0.1 * girth, 0.16 * girth, -0.04], g('wingSpan', 1.0, 1.8)) : null;

    const phase = { '1L': 0, '0L': 0.25, '1R': 0.5, '0R': 0.75 };
    return b.done({
      roles: { root, spine: [spine], chest, neck: [n1, n2], head, jaw, tail, wings },
      locomotion: 'legs',
      gaits: {
        walk: { frames: 32, stance: 0.66, phase, stride: 0.9, lift: 0.12, bob: 0.015, bobs: 2 },
        run: { frames: 16, stance: 0.4, phase: runPhase(ctx.genes.gaitStyle ?? 0.35), stride: 1.05, lift: 0.2, bob: 0.035, bobs: 2, lean: 3 },
      },
      height: legH + 0.2 * girth + seg * 1.6 + hs,
      radius: 0.25 * girth + bodyLen * 0.3,
      length: bodyLen + 0.4 * girth + hs,
    });
  },
};

/** Leg phases for the run: trot, pace or bound (front pair then hind pair, slightly split). */
function runPhase(style: number): Record<string, number> {
  if (style < 0.4) return { '0L': 0, '1R': 0.05, '0R': 0.5, '1L': 0.55 };
  if (style < 0.7) return { '0L': 0, '1L': 0.05, '0R': 0.5, '1R': 0.55 };
  return { '0L': 0, '0R': 0.08, '1L': 0.5, '1R': 0.58 };
}
