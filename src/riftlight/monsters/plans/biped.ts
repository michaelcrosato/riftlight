import { flat, inc } from '../../core/mods';
import type { BodyPlanDef, PlanContext, Skeleton } from '../types';
import { SkeletonBuilder, gene } from './builder';
import { addTail, addWings, both } from './common';

/**
 * Upright two-legged body: pelvis → spine → chest → neck → head, two arms, two legs, an
 * optional tail. Goblins, skeletons, cultists, lizardfolk. `brute` reuses this grammar with
 * a hunch, short legs and huge arms.
 */
export const biped: BodyPlanDef = {
  id: 'biped',
  name: 'Biped',
  description: 'Upright, two arms and two legs: goblins, skeletons, cultists, lizardfolk.',
  tags: ['legged', 'arms', 'upright'],
  weight: 1.2,
  genes: {
    length: { mean: 0.5, spread: 0.2 },
    girth: { mean: 0.45, spread: 0.2 },
    legLength: { mean: 0.5, spread: 0.2 },
    neck: { mean: 0.35, spread: 0.2 },
    headSize: { mean: 0.5, spread: 0.2 },
    limbThickness: { mean: 0.45, spread: 0.2 },
    posture: { mean: 0.3, spread: 0.2 },
    tailLength: { mean: 0.3, spread: 0.25 },
    armLength: { mean: 0.5, spread: 0.2 },
  },
  slots: { head: 1, eyes: 1, jaw: 0.3, horns: 0.45, helm: 0.3, back: 0.35, shoulders: 0.4, wings: 0.12, tail: 0.25, hands: 0.5, weapon: 0.55, feet: 0.3, core: 0.2 },
  mods: [flat('life', 0), inc('attack.speed', 0.05)],
  baseScale: 1,
  build: (ctx) => humanoid(ctx, 'biped'),
};

export const brute: BodyPlanDef = {
  id: 'brute',
  name: 'Brute',
  description: 'Hunched gorilla/ogre: short legs, huge arms that swing and slam, small head low on the chest.',
  tags: ['legged', 'arms', 'heavy'],
  weight: 0.8,
  genes: {
    length: { mean: 0.5, spread: 0.2 },
    girth: { mean: 0.6, spread: 0.2 },
    legLength: { mean: 0.4, spread: 0.2 },
    neck: { mean: 0.15, spread: 0.1 },
    headSize: { mean: 0.35, spread: 0.2 },
    limbThickness: { mean: 0.6, spread: 0.2 },
    posture: { mean: 0.65, spread: 0.2 },
    tailLength: { mean: 0.15, spread: 0.15 },
    armLength: { mean: 0.6, spread: 0.2 },
  },
  slots: { head: 1, eyes: 1, jaw: 0.5, horns: 0.5, helm: 0.25, back: 0.5, shoulders: 0.6, tail: 0.1, hands: 0.7, weapon: 0.3, feet: 0.3, core: 0.25 },
  mods: [inc('life', 0.35), inc('move.speed', -0.1), flat('knockback', 2)],
  baseScale: 1.25,
  build: (ctx) => humanoid(ctx, 'brute'),
};

function humanoid(ctx: PlanContext, plan: 'biped' | 'brute'): Skeleton {
  const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
  const isBrute = plan === 'brute';
  const b = new SkeletonBuilder(plan);
  const girth = isBrute ? g('girth', 1.15, 1.7) : g('girth', 0.75, 1.3);
  const legLen = isBrute ? g('legLength', 0.34, 0.52) : g('legLength', 0.42, 0.78);
  const ankle = 0.07;
  const hipH = legLen * 0.95;
  const torso = isBrute ? g('length', 0.42, 0.62) : g('length', 0.34, 0.58);
  const thick = (isBrute ? g('limbThickness', 0.13, 0.22) : g('limbThickness', 0.08, 0.15)) * Math.sqrt(girth);
  const neckLen = isBrute ? g('neck', 0.0, 0.06) : g('neck', 0.03, 0.18);
  const hs = isBrute ? g('headSize', 0.22, 0.34) : g('headSize', 0.26, 0.44);

  const root = b.joint('Body', null, [0, hipH, 0]);
  b.shape(root, 'box', [0.34 * girth, 0.16, 0.24 * girth], [0, 0.02, 0], 'secondary');
  const spine = b.joint('Spine', root, [0, 0.08, 0]);
  b.shape(spine, 'box', [0.36 * girth, torso * 0.55, 0.26 * girth], [0, torso * 0.25, 0], 'primary');
  const chest = b.joint('Chest', spine, [0, torso * 0.5, 0]);
  const chestW = (isBrute ? 0.58 : 0.46) * girth;
  b.shape(chest, isBrute ? 'sphere' : 'box', [chestW, torso * (isBrute ? 0.75 : 0.55), 0.32 * girth], [0, torso * 0.25, isBrute ? 0.02 : 0], 'primary');
  const neck = b.joint('Neck', chest, isBrute ? [0, torso * 0.42, 0.1 * girth] : [0, torso * 0.5, 0.02]);
  b.shape(neck, 'cyl', [0.13 * girth, neckLen + 0.08, 0.13 * girth], [0, neckLen / 2, 0], 'secondary');
  const head = b.joint('Head', neck, [0, neckLen, 0.0]);
  const jaw = b.head(head, hs, ctx.head);

  const armLen = Math.min(isBrute ? g('armLength', 0.75, 1.1) : g('armLength', 0.44, 0.68), hipH + torso - 0.06 - thick * (isBrute ? 3.4 : 2));
  both((side, sx) => {
    const a = b.arm(side, chest, [sx * (chestW / 2 + thick * 0.5), torso * (isBrute ? 0.5 : 0.42), 0], armLen * 0.5, armLen * 0.45, isBrute ? thick * 1.35 : thick);
    b.shape(a.hand, isBrute ? 'sphere' : 'box', isBrute ? [thick * 2.4, thick * 2.2, thick * 2.4] : [thick * 1.5, thick * 1.6, thick * 1.5], [0, -thick * 0.7, 0], isBrute ? 'secondary' : 'dark');
    b.stance[a.arm] = isBrute ? [-18, 0, -12 * sx] : [-6, 0, -8 * sx];
    b.stance[a.forearm] = isBrute ? [-28, 0, 0] : [-18, 0, 0];
  });
  b.socketPair('hand', 'hands', (s) => `Hand${s}`, [0, -thick * 0.9, 0.02], thick * (isBrute ? 2.4 : 1.6));
  b.socket('weapon', 'weapon', 'HandR', [0, -thick * 0.7, 0], hipH + torso);
  b.socketPair('shoulder', 'shoulders', (s) => `Arm${s}`, [0, thick * 0.4, 0], thick * (isBrute ? 2.4 : 2));
  b.socket('back', 'back', chest, [0, torso * 0.3, -0.16 * girth], chestW, { rot: [-90, 0, 0] });
  b.socket('core', 'core', chest, [0, torso * 0.28, 0.16 * girth], 0.16 * girth);

  both((side, sx) => {
    b.leg({
      pair: 0,
      side,
      parent: root,
      hip: [sx * (isBrute ? 0.15 : 0.1) * girth, -0.03, 0],
      upper: (legLen - ankle) * 0.52,
      lower: (legLen - ankle) * 0.51,
      ankle,
      bend: 1,
      thick: isBrute ? thick * 1.1 : thick,
      sole: [thick * 1.5, thick * 2.6 + 0.04],
      footZ: 0.02,
    });
  });

  const tailLen = g('tailLength', 0.08, 0.2);
  const tail = ctx.has('tail') || ctx.genes.tailLength! > 0.62 ? addTail(b, root, [0, 0.02, -0.12 * girth], 3, tailLen, thick * 0.9) : [];
  const wings = ctx.has('wings') ? addWings(b, chest, [0.12 * girth, torso * 0.4, -0.12 * girth], g('wingSpan', 0.9, 1.6)) : null;

  const posture = g('posture', 0, isBrute ? 38 : 22);
  b.stance[spine] = [posture * 0.6, 0, 0];
  b.stance[chest] = [posture * 0.4, 0, 0];
  b.stance[neck] = [-posture * 0.5, 0, 0];
  b.stance[head] = [-posture * 0.4, 0, 0];

  return b.done({
    roles: { root, spine: [spine], chest, neck: [neck], head, jaw, tail, wings },
    locomotion: 'legs',
    gaits: isBrute
      ? {
          walk: { frames: 30, stance: 0.62, phase: { '0R': 0, '0L': 0.5 }, stride: 0.9, lift: 0.1, bob: 0.04, lean: 5, pace: 0.85 },
          run: { frames: 22, stance: 0.4, phase: { '0R': 0, '0L': 0.5 }, stride: 1.0, lift: 0.18, bob: 0.06, lean: 14, pace: 0.85 },
        }
      : {
          walk: { frames: 26, stance: 0.6, phase: { '0R': 0, '0L': 0.5 }, stride: 0.8, lift: 0.12, bob: 0.025, lean: 4 },
          run: { frames: 18, stance: 0.36, phase: { '0R': 0, '0L': 0.5 }, stride: 1.1, lift: 0.2, bob: 0.04, lean: 14 },
        },
    height: hipH + torso + neckLen + hs,
    radius: Math.max(0.3 * girth, chestW / 2 + thick * 2),
    length: 0.3 * girth,
  });
}
