import { flat, inc } from '../../core/mods';
import type { BodyPlanDef } from '../types';
import { SkeletonBuilder, gene } from './builder';

/**
 * Slimes and oozes: a root on the floor and one squashy mass above it. All motion is
 * squash and stretch: breathing wobble, anticipation squash → hop → splat landing.
 * The flat base under the mass is its "sole" (ground contact for the metrics).
 */
export const blob: BodyPlanDef = {
  id: 'blob',
  name: 'Blob',
  description: 'Squash-and-stretch slimes, oozes and gels that hop.',
  tags: ['amorphous'],
  weight: 0.8,
  genes: {
    girth: { mean: 0.5, spread: 0.25 },
    length: { mean: 0.5, spread: 0.2 },
    headSize: { mean: 0.5, spread: 0.2 },
  },
  slots: { eyes: 1, jaw: 0.45, horns: 0.3, helm: 0.15, back: 0.45, core: 0.6 },
  mods: [inc('life', 0.2), flat('res.chaos', 0.2), inc('move.speed', -0.1)],
  defaults: { jaw: 'jaw.gape' },
  baseScale: 0.9,
  build(ctx) {
    const g = (n: string, lo: number, hi: number) => gene(ctx.genes, n, lo, hi);
    const b = new SkeletonBuilder('blob');
    const w = g('girth', 0.5, 1.0);
    const h = w * g('length', 0.6, 0.95);
    const root = b.joint('Body', null, [0, 0, 0]);
    b.shape(root, 'disc', [w * 0.84, 0.016, w * 0.8], [0, 0.008, 0], 'dark', { name: 'SoleBlob' });
    const mass = b.joint('Mass', root, [0, h * 0.5 + 0.014, 0]);
    b.shape(mass, 'blob', [w, h, w * 0.95], [0, 0, 0], 'primary');
    b.shape(mass, 'sphere', [w * 0.94, h * 0.5, w * 0.9], [0, -h * 0.22, 0], 'primary');
    b.shape(mass, 'blob', [w * 0.5, h * 0.42, w * 0.46], [-w * 0.14, h * 0.2, -w * 0.14], 'secondary');
    // a sheen on top and drips round the base
    b.shape(mass, 'sphere', [w * 0.22, h * 0.1, w * 0.16], [w * 0.16, h * 0.4, w * 0.12], 'bone', { rot: [0, 0, -20] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      b.shape(mass, 'sphere', [w * 0.2, h * 0.24, w * 0.2], [Math.sin(a) * w * 0.44, -h * 0.36, Math.cos(a) * w * 0.42], 'primary');
    }
    const es = h * g('headSize', 0.8, 1.2);
    b.socketPair('eye', 'eyes', () => mass, [w * 0.17, h * 0.16, w * 0.4], es * 0.9);
    b.socketPair('horn', 'horns', () => mass, [w * 0.2, h * 0.38, w * 0.08], es);
    b.socket('helm', 'helm', mass, [0, h * 0.47, 0], es);
    const jaw = b.joint('Jaw', mass, [0, -h * 0.12, w * 0.44]);
    b.socket('jaw', 'jaw', jaw, [0, 0, 0], es * 1.1);
    b.socket('back', 'back', mass, [0, h * 0.44, -w * 0.12], w);
    b.socket('core', 'core', mass, [0, h * 0.05, w * 0.18], w * 0.4);

    const stub = { frames: 30, stance: 0, phase: {}, stride: 0, lift: 0, bob: 0 };
    return b.done({
      roles: { root, spine: [], chest: null, neck: [], head: null, jaw, tail: [], wings: null, mass },
      locomotion: 'blob',
      gaits: { walk: { ...stub, hop: h * 0.45 }, run: { ...stub, frames: 22, hop: h * 0.7 } },
      height: h + 0.02,
      radius: w * 0.5,
      length: w,
    });
  },
};
