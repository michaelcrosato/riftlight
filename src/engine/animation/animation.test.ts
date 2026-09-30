import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Object3D } from 'three/webgpu';
import { beforeAll, describe, expect, it } from 'vitest';
import { HERO_CLIPS } from '../../game/hero/animations';
import { HERO_RIG } from '../../game/hero/rig';
import { analyzeClip, compileClip, gaitClip, legIK, mirror, mirrorClip, placeFeet, renderSheet, restPoseOf, sampleClip, twoBoneX, validateClip, type ClipDef } from '.';

const RAD = Math.PI / 180;
const legs = HERO_RIG.legs!;

/** Planar FK of a leg (hip → ankle) in the root's space, angles in degrees. */
function ankleOf(upper: number, lower: number): [number, number] {
  const a = upper * RAD;
  const b = (upper + lower) * RAD;
  return [-legs.upper * Math.cos(a) - legs.lower * Math.cos(b), -legs.upper * Math.sin(a) - legs.lower * Math.sin(b)];
}

describe('foot IK', () => {
  it('two-bone solve reaches reachable targets with the knee forward', () => {
    for (const [ty, tz] of [[-0.45, 0.1], [-0.3, -0.2], [-0.4, 0.25], [-0.2, 0.05]] as const) {
      const [u, l] = twoBoneX(ty, tz, legs.upper, legs.lower);
      const [y, z] = ankleOf(u, l);
      expect(y).toBeCloseTo(ty, 4);
      expect(z).toBeCloseTo(tz, 4);
      expect(l).toBeGreaterThan(0); // knee bends forward, foot goes back
    }
  });

  it('never folds the knee past its limit', () => {
    const [, l] = twoBoneX(-0.01, 0, legs.upper, legs.lower);
    expect(l).toBeLessThanOrEqual(150 + 1e-6);
  });

  it('plants the ankle exactly where asked, through root offset, pitch and squash', () => {
    const root = { r: [0, 0, 0] as [number, number, number], p: [0, -0.2, 0.05] as [number, number, number], s: [1, 0.9, 1] as [number, number, number] };
    const { upper, lower, foot } = legIK(legs, 'R', root, { z: 0.15 });
    const [y, z] = ankleOf(upper, lower);
    // back to the ground frame: scale, then offset
    expect(legs.rootHeight + root.p[1] + y * root.s[1]).toBeCloseTo(legs.ankle, 4);
    expect(root.p[2] + z * root.s[2]).toBeCloseTo(0.15, 4);
    expect(upper + lower + foot).toBeCloseTo(0, 4); // sole flat
  });

  it('placeFeet keeps authored leg spread and replaces the swing', () => {
    const pose = placeFeet({ LegR: [10, 5, -20] }, HERO_RIG, { R: { z: 0 } });
    const leg = pose.LegR as { r: number[] };
    expect(leg.r[1]).toBe(5);
    expect(leg.r[2]).toBe(-20);
  });
});

describe('pose helpers', () => {
  it('mirror swaps sides and flips Y/Z rotations and X offsets', () => {
    const m = mirror({ ArmR: [-90, 10, -30], Pelvis: { r: [0, 20, 5], p: [0.1, 0, 0] } }, HERO_RIG);
    expect(m.ArmL).toEqual({ r: [-90, -10, 30], p: [-0, 0, 0], s: [1, 1, 1] });
    expect((m.Pelvis as { r: number[]; p: number[] }).r).toEqual([0, -20, -5]);
    expect((m.Pelvis as { p: number[] }).p[0]).toBeCloseTo(-0.1);
  });

  it('mirrorClip renames and mirrors every key', () => {
    const clip: ClipDef = { name: 'A', frames: 10, keys: [[0, { ArmR: [0, 0, -40] }]] };
    const m = mirrorClip(clip, 'B', HERO_RIG);
    expect(m.name).toBe('B');
    expect(m.keys[0]![1].ArmL).toEqual({ r: [0, -0, 40], p: [-0, 0, 0], s: [1, 1, 1] });
  });

  it('samples loops seamlessly and eases between keys', () => {
    const clip: ClipDef = { name: 'L', frames: 20, loop: true, keys: [[0, { Head: [0, 0, 0] }, 'linear'], [10, { Head: [20, 0, 0] }, 'linear'], [20, { Head: [0, 0, 0] }]] };
    expect(sampleClip(clip, 5, HERO_RIG).Head!.r[0]).toBeCloseTo(10);
    expect(sampleClip(clip, 25, HERO_RIG).Head!.r[0]).toBeCloseTo(10);
    expect(sampleClip({ ...clip, keys: clip.keys.map(([f, p]) => [f, p]) }, 2.5, HERO_RIG).Head!.r[0]).toBeLessThan(5); // default inOut eases in
  });

  it('validation catches unknown joints and bad key order', () => {
    const errors = validateClip({ name: 'X', frames: 10, keys: [[0, { Tail: [0, 0, 0] }], [12, {}], [5, {}]] }, HERO_RIG);
    expect(errors.join('\n')).toMatch(/unknown joint "Tail"/);
    expect(errors.join('\n')).toMatch(/out of order/);
    expect(errors.join('\n')).toMatch(/outside 0..10/);
  });
});

describe('hero clips (compiled against hero.glb)', () => {
  let model: Object3D;
  beforeAll(async () => {
    const buf = readFileSync(new URL('../../../public/assets/hero.glb', import.meta.url));
    model = (await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene;
  });

  it('includes every clip the PlatformerCharacter asks for', () => {
    const src = readFileSync(new URL('../character/PlatformerCharacter.ts', import.meta.url), 'utf8');
    const wanted = new Set([...src.matchAll(/name: '([A-Z][A-Za-z0-9]+)'/g)].map((m) => m[1]!));
    for (const extra of ['Jump', 'JumpUp', 'DoubleJump', 'TripleJump', 'Backflip', 'SideFlip', 'LongJump', 'WallKick', 'JumpKick', 'Punch', 'Punch2', 'Kick', 'SweepKick', 'Wave', 'Victory', 'ShimmyLeft', 'ShimmyRight', 'StepUp', 'StepDown', 'Sleep', 'LieIdle', 'GroundPoundSpin']) wanted.add(extra);
    const have = new Set(HERO_CLIPS.map((c) => c.name));
    expect([...wanted].filter((n) => !have.has(n))).toEqual([]);
  });

  it('every clip is valid and passes its metrics (no floor penetration, planted feet, seamless loops)', () => {
    const rest = restPoseOf(model, HERO_RIG);
    const failures: string[] = [];
    for (const def of HERO_CLIPS) {
      failures.push(...validateClip(def, HERO_RIG));
      const report = analyzeClip(model, HERO_RIG, def, compileClip(def, HERO_RIG, rest));
      failures.push(...report.problems.map((p) => `${def.name}: ${p}`));
    }
    expect(failures).toEqual([]);
  });

  it('gait clips keep planted feet still at their authored speed', () => {
    const rest = restPoseOf(model, HERO_RIG);
    const walk = gaitClip(HERO_RIG, { name: 'T', frames: 16, speed: 1.8, stance: 0.6, hip: -0.07, heelStrike: 15, toeOff: 25 });
    const r = analyzeClip(model, HERO_RIG, walk, compileClip(walk, HERO_RIG, rest));
    expect(r.footSlide).toBeLessThan(0.1);
    expect(r.minSoleY).toBeGreaterThan(-0.01);
    expect(r.loopSeam).toBeLessThan(0.5);
  });

  it('renders a contact sheet with the character in it', () => {
    const def = HERO_CLIPS.find((c) => c.name === 'Walk')!;
    const img = renderSheet(model, HERO_RIG, def, compileClip(def, HERO_RIG, restPoseOf(model, HERO_RIG)), { views: ['side'], trails: false });
    expect(img.width).toBeGreaterThan(300);
    expect(img.data.length).toBe(img.width * img.height * 4);
    let blue = 0; // overalls
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 2]! > 150 && img.data[i]! < 90) blue++;
    expect(blue).toBeGreaterThan(200);
  });
});
