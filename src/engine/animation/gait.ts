import { ankleFor, legIK, placeFeet, type FootGoal, type Side } from './ik';
import { resolveJoint } from './pose';
import type { ClipDef, Euler, JointPose, Key, LegRig, Pose, RigSpec } from './types';

/**
 * Procedural locomotion cycles with planted feet. Instead of posing every frame, describe
 * the gait (speed, cadence, stance, bounce, arm swing...) and the generator plants each
 * foot on the ground, sliding it backwards at exactly `speed` while it is in stance, then
 * swings it forward on an arc — heel strike, roll, toe-off included. Tweak numbers,
 * re-run `npm run anim -- check Walk`, look at the sheet.
 *
 * Phase: the RIGHT heel strikes at frame 0, the left at frames / 2.
 */
export interface GaitSpec {
  name: string;
  /** One full cycle (two steps), frames at 30 fps. */
  frames: number;
  /** Ground speed the cycle is authored for (m/s at playback rate 1). */
  speed: number;
  /** Fraction of the cycle each foot is on the ground. Walk ≈ 0.55–0.6, run ≈ 0.3. */
  stance: number;
  /** Mean pelvis height offset from rest (m); negative bends the knees. */
  hip: number;
  /** Pelvis bounce amplitude (m), twice per cycle. */
  bob?: number;
  /** Cycle fraction at which the pelvis is lowest (default: walk just after contact, run mid-stance). */
  low?: number;
  /** Squash at the lowest point (e.g. 0.05 = 5 % shorter, wider). */
  squash?: number;
  /** How high the lowest point of the swinging foot clears the floor at its peak (m). */
  lift?: number;
  /** Where in the swing (0..1) the foot is highest (default 0.4). */
  liftPeak?: number;
  /** Shift the whole stride forward (m). */
  reach?: number;
  /** Extra forward throw of the swinging foot late in the swing, before it settles (m). */
  swingReach?: number;
  /** Swing timing: 0 = even, + = the foot hangs back then whips forward (running). */
  swingDelay?: number;
  /** Toes-up angle at heel strike (deg). */
  heelStrike?: number;
  /** Heel-raise angle at toe-off (deg). */
  toeOff?: number;
  /** Fraction of stance spent rolling off the heel / onto the toes. */
  roll?: [heel: number, toe: number];
  /** Walk on the balls of the feet: extra pitch through stance (deg), pivoting on the ball. */
  tiptoe?: number;
  /** Extra toes-down droop mid-swing (deg). */
  swingPitch?: number;
  /** How much the swinging foot hangs from the shin mid-swing (0..1, default 0.8). */
  dangle?: number;
  /** Torso lean forward (deg) and twist of the shoulders against the legs (deg). */
  lean?: number;
  twist?: number;
  /** Side-to-side torso roll (deg). */
  sway?: number;
  /** Pelvis pitch (deg): tips the whole body, legs are re-solved. */
  pelvisPitch?: number;
  /** Head pitch (deg) and how much it counters the torso twist (0..1). */
  head?: number;
  headSteady?: number;
  arms?: {
    /** Swing amplitude (deg). */
    swing: number;
    /** Base elbow bend (deg). */
    elbow: number;
    /** Extra elbow bend when the arm is forward (deg). */
    pump?: number;
    /** Arms out from the body (deg). */
    spread?: number;
    /** Arms forward of hanging (deg) — offsets the swing centre. */
    forward?: number;
    /** Follow-through delay behind the legs, as a fraction of the cycle. */
    lag?: number;
  };
  /** Extra joints/overrides mixed into every frame (hands, hat...). */
  pose?: Pose;
  /** Per-frame hook for anything else: receives the cycle phase 0..1. */
  extra?: (u: number, pose: Record<string, Euler | JointPose>) => void;
  /** Key spacing in frames (default 0.5 — IK is non-linear, keep it fine). */
  step?: number;
  notes?: string;
}

const TAU = Math.PI * 2;

export function gaitClip(rig: RigSpec, g: GaitSpec): ClipDef {
  if (!rig.legs) throw new Error('gaitClip: rig has no `legs` spec');
  const step = g.step ?? 0.5;
  const keys: Key[] = [];
  for (let f = 0; f < g.frames - 1e-9; f += step) keys.push([f, gaitPose(rig, g, f / g.frames), 'linear']);
  keys.push([g.frames, keys[0]![1], 'linear']);
  return {
    name: g.name,
    frames: g.frames,
    loop: true,
    keys,
    speed: g.speed,
    grounded: g.stance >= 0.5,
    notes: g.notes,
  };
}

/** The pose at cycle phase u (0..1). */
export function gaitPose(rig: RigSpec, g: GaitSpec, u: number): Pose {
  const legs = rig.legs!;
  const T = g.frames / rig.fps;
  const S = g.speed * g.stance * T; // ground covered while one foot is planted
  const low = g.low ?? (g.stance < 0.5 ? g.stance / 2 : 0.08);
  const bobWave = -Math.cos(2 * TAU * (u - low)); // −1 at the low point, twice per cycle
  const bob = (g.bob ?? 0) * bobWave;
  const squash = (g.squash ?? 0) * Math.max(0, -bobWave);
  const pelvis: JointPose = {
    r: [g.pelvisPitch ?? 0, 0, 0],
    p: [0, g.hip + bob, 0],
    s: [1 + squash * 0.5, 1 - squash, 1 + squash * 0.5],
  };

  const pose: Record<string, Euler | JointPose> = {};
  for (const [k, v] of Object.entries(g.pose ?? {})) pose[k] = v;
  pose[rig.root] = pelvis;

  // Torso: lean, counter-twist and sway. Right foot forward at u = 0 → left shoulder forward.
  const c = Math.cos(TAU * u);
  const twist = g.twist ?? 0;
  const sway = (g.sway ?? 0) * Math.cos(TAU * (u - g.stance / 2));
  const base = resolveJoint(pose.Torso);
  pose.Torso = { r: [base.r[0] + (g.lean ?? 0), base.r[1] - twist * c, base.r[2] + sway], p: base.p, s: base.s };
  const head = resolveJoint(pose.Head);
  pose.Head = {
    r: [head.r[0] + (g.head ?? 0) - (g.lean ?? 0) * 0.5, head.r[1] + twist * c * (g.headSteady ?? 0.8), head.r[2] - sway * 0.6],
    p: head.p,
    s: head.s,
  };

  if (g.arms) {
    const a = g.arms;
    for (const side of ['R', 'L'] as const) {
      const ph = u + (side === 'L' ? 0.5 : 0) - (a.lag ?? 0.04);
      const back = Math.cos(TAU * ph); // 1 = arm fully back (its own foot forward)
      const fwd = (1 - back) / 2;
      const sign = side === 'R' ? -1 : 1; // rz that spreads this arm outward
      const arm = resolveJoint(pose[`Arm${side}`]);
      pose[`Arm${side}`] = { r: [arm.r[0] - (a.forward ?? 0) + a.swing * back, arm.r[1], arm.r[2] + sign * (a.spread ?? 0)], p: arm.p, s: arm.s };
      const fore = resolveJoint(pose[`Forearm${side}`]);
      pose[`Forearm${side}`] = { r: [fore.r[0] - a.elbow - (a.pump ?? 0) * fwd, fore.r[1], fore.r[2]], p: fore.p, s: fore.s };
    }
  }

  g.extra?.(u, pose);
  // Solve legs last so hooks that move the pelvis are honoured.
  const goals = { R: footAt(g, legs, u, S), L: footAt(g, legs, u + 0.5, S) };
  for (const side of ['R', 'L'] as const) {
    const s = swingProgress(g, side === 'R' ? u : u + 0.5);
    if (s !== null) clear(goals[side], legs, side, pose[rig.root] as JointPose, (g.lift ?? 0.1) * bump(s, g.liftPeak ?? 0.4), (g.lift ?? 0.1) + 0.08);
  }
  return placeFeet(pose, rig, goals);
}

/** 0..1 through the swing, or null while the foot is planted. */
function swingProgress(g: GaitSpec, phase: number): number | null {
  const v = ((phase % 1) + 1) % 1;
  return v < g.stance ? null : (v - g.stance) / (1 - g.stance);
}

function bump(s: number, peak: number): number {
  return s < peak ? Math.sin((Math.PI / 2) * (s / peak)) : Math.cos((Math.PI / 2) * ((s - peak) / (1 - peak)));
}

/**
 * Raise a swinging foot until its lowest point (heel or toe, as it hangs) clears `height`,
 * lifting the ankle by at most `maxRaise`.
 */
function clear(goal: FootGoal, legs: LegRig, side: Side, root: JointPose, height: number, maxRaise: number): void {
  const rootPitch = root.r?.[0] ?? 0;
  const start = goal.y ?? 0;
  for (let i = 0; i < 4; i++) {
    const k = legIK(legs, side, root, goal);
    const psi = ((rootPitch + k.upper + k.lower + k.foot) * Math.PI) / 180;
    const c = Math.cos(psi);
    const sn = Math.sin(psi);
    const ankleY = ankleFor(goal, legs).y;
    // lowest corner of the shoe profile (sole heel/toe, top heel/toe) at world pitch psi
    let lowest = Infinity;
    for (const y of [-legs.ankle, legs.top ?? 0]) for (const z of [-legs.heel, legs.ball]) lowest = Math.min(lowest, ankleY + y * c - z * sn);
    if (lowest >= height - 1e-4) return;
    goal.y = Math.min(start + maxRaise, (goal.y ?? 0) + (height - lowest), highestAnkle(goal, legs, root) - legs.ankle);
  }
}

/**
 * Highest the ankle may go at the goal's z while staying out of the knee's fold limit
 * (with a little margin), so the leg never whips through the IK clamp.
 */
function highestAnkle(goal: FootGoal, legs: LegRig, root: JointPose): number {
  const bend = (180 - 140) * (Math.PI / 180); // keep the knee under ~140° (IK allows 150°)
  const minD = Math.sqrt(legs.upper ** 2 + legs.lower ** 2 - 2 * legs.upper * legs.lower * Math.cos(bend));
  const hipY = legs.rootHeight + (root.p?.[1] ?? 0);
  const dz = goal.z - (root.p?.[2] ?? 0);
  return hipY - Math.sqrt(Math.max(0, minD * minD - dz * dz));
}

/** Where a foot is at its own phase (0 = heel strike). */
export function footAt(g: GaitSpec, legs: LegRig, phase: number, S: number): FootGoal {
  const v = ((phase % 1) + 1) % 1;
  const reach = g.reach ?? 0;
  const hs = g.heelStrike ?? 0;
  const to = g.toeOff ?? 0;
  const tip = g.tiptoe ?? 0;
  const [rollHeel, rollToe] = g.roll ?? [0.15, 0.3];
  if (v < g.stance) {
    const s = v / g.stance;
    const z = reach + S / 2 - S * s;
    if (tip) return { z, pitch: tip + to * smooth((s - (1 - rollToe)) / rollToe), pivot: 'ball' };
    if (s < rollHeel && hs) return { z, pitch: -hs * (1 - smooth(s / rollHeel)), pivot: 'heel' };
    if (s > 1 - rollToe && to) return { z, pitch: to * smooth((s - (1 - rollToe)) / rollToe), pivot: 'ball' };
    return { z };
  }
  // Swing: carry the ankle from where toe-off left it to where heel strike needs it, on an
  // arc, so the foot leaves and lands exactly where stance has it.
  const s = (v - g.stance) / (1 - g.stance);
  const startPitch = tip + to;
  const endPitch = tip ? tip : -hs;
  const a0 = ankleFor({ z: reach - S / 2, pitch: startPitch, pivot: 'ball' }, legs);
  const a1 = ankleFor({ z: reach + S / 2, pitch: endPitch, pivot: tip ? 'ball' : 'heel' }, legs);
  const d = g.swingDelay ?? 0;
  const e = smooth(d > 0 ? Math.max(0, (s - d) / (1 - d)) ** (1 - d * 0.5) : s);
  const throwFwd = (g.swingReach ?? 0) * Math.sin(Math.PI * Math.min(1, Math.max(0, (s - 0.35) / 0.65)));
  const pitch = startPitch + (endPitch - startPitch) * smooth((s - 0.2) / 0.75) + (g.swingPitch ?? 0) * Math.sin(Math.PI * s);
  return {
    z: a0.z + (a1.z - a0.z) * e + throwFwd,
    y: a0.y + (a1.y - a0.y) * s - legs.ankle, // lifted clear of the floor by clear()
    pitch,
    pivot: 'ankle',
    follow: (g.dangle ?? 0.8) * Math.sin(Math.PI * Math.min(1, s / 0.85)),
  };
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
