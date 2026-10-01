import { Euler, Matrix4, type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { twoBoneX } from './ik';
import { PopGuard } from './popGuard';
import type { LegRig, RigSpec } from './types';

/**
 * Runtime foot placement: the clips assume flat ground at the character's feet; this puts
 * the soles on the real ground and keeps planted feet planted. Every render frame, after
 * the mixer (and RotationBlend):
 *
 *   capture()  where the clips put the feet (before any procedural layer moves the body)
 *   ...        procedural layers (lean, landing squash) move the body
 *   apply()    put the feet back where the clips had them, on the real ground
 *
 * Per foot, a ray under the heel and one under the toe find the ground (the `probe`):
 *
 * - **Terrain**: the foot keeps the clip's height above the ground under it (on a step edge,
 *   the higher side), and never goes through it (a sinking blend is lifted out). A planted
 *   foot is pitched to the slope it stands on. A swinging foot also looks a little ahead, so
 *   it lifts over a riser before it gets there.
 * - **Pelvis**: the body is lowered by the deeper planted foot's offset (smoothed), so the
 *   foot on the lower step reaches it; the other leg bends.
 * - **Locking** (optional): a foot that touches down stays where it touched down (on its
 *   heel or toe, whichever is lower) until the animation lifts it. Blends, turns and
 *   playback-rate mismatches would otherwise slide it. If the animation drifts more than
 *   `maxDrift` away, the foot re-plants with a quick step (lift, move, set down), one foot
 *   at a time. A foot that lifts off returns to the animation in the air.
 *
 * Legs are re-solved with the planar two-bone IK (`twoBoneX`) as a change from the current
 * angles (no change = exactly the current pose, so fading in never pops), plus a little hip
 * abduction for sideways offsets. Everything fades in and out.
 */
export interface GroundHit {
  /** Height of the hit (world). */
  y: number;
  /** Surface normal. */
  nx: number;
  ny: number;
  nz: number;
  /** Which surface (collider id): heel and toe on the same surface may be pitched to it. */
  id: number;
}

/** Ray straight down from (x, y, z), at most `maxDown`; fills `out`, returns whether it hit. */
export type GroundProbe = (x: number, y: number, z: number, maxDown: number, out: GroundHit) => boolean;

export interface FootPlacementTuning {
  /** Ground probes start this far above the character's feet and reach `probeDown` below them. */
  probeUp: number;
  probeDown: number;
  /** Ground whose normal has a smaller y is a wall, not something to stand on. */
  minNormalY: number;
  /** The body drops at most this far (m); a foot moves at most `maxRaise` up for the terrain. */
  maxDrop: number;
  maxRaise: number;
  /** Fade in / out (s). */
  fadeIn: number;
  fadeOut: number;

  /** Smoothing rates (1/s): a foot's terrain offset, the pelvis drop, the slope pitch. */
  footRate: number;
  dropRate: number;
  pitchRate: number;
  /** Largest slope pitch for a foot (degrees). */
  maxPitch: number;
  /** A heel or toe this close to the floor (m, as animated) is on it. */
  contact: number;
  /** A locked foot lets go once its lower end is `release` × `contact` up. */
  release: number;
  /** Locked feet: re-plant with a step once the animation is this far away (m). */
  maxDrift: number;
  /** The re-plant step: shortest duration (s), top speed (m/s: a longer way takes longer), and lift (m). */
  stepTime: number;
  stepSpeed: number;
  stepLift: number;
  /** A released foot returns to the animation at this rate (1/s). */
  releaseRate: number;
  /** Most hip abduction for a sideways offset (degrees). */
  maxSpread: number;
  /**
   * A swinging foot also looks ahead of its toe, to lift over a riser in time: this far (m),
   * plus `lookaheadTime` seconds of the foot's own forward speed. A foot counts as swinging
   * (for this) while it is off the floor, or moving forward faster than the body (a foot
   * about to touch down is still on its way to where it lands).
   */
  lookahead: number;
  lookaheadTime: number;
  /**
   * A planted foot that the animation pushes into the ground (a blend between two poses) is
   * lifted out at most this fast (m/s): on a straight leg a few centimetres is a big knee bend.
   */
  liftRate: number;
  /** Largest sideways correction (m) the legs are asked to reach. */
  maxReach: number;
  /**
   * A foot moving forward faster than `swingShare` × the body's speed + `swingSpeed` (m/s)
   * is swinging, even when it passes low: it doesn't lock.
   */
  swingShare: number;
  swingSpeed: number;
  /** A foot swinging forward at speed keeps this clear of the ground (m). */
  swingClear: number;
  /**
   * A gait's swinging foot goes from the ground it left to the ground it lands on between
   * these points of its swing (0..1): going up, and going down.
   */
  swingUp: readonly [number, number];
  swingDown: readonly [number, number];
  /**
   * Pop guard (popGuard.ts): each foot's correction (where its ankle goes, relative to where
   * the clip has it: the terrain offset, the lock's, and the slope's pitch) follows its
   * target at up to `guardMove` m/s and `guardPitch` deg/s; anything faster (a correction
   * switching on, a re-target, a constraint) eases over at `guardRate` (rad/s, critically
   * damped) instead. A locked foot's hold and a re-planting step are never held back.
   */
  guardRate: number;
  guardMove: number;
  guardPitch: number;
  /**
   * A re-planting step under way finishes even if locking stops meanwhile (cut short, the
   * lifted foot drops and snaps back to the clip in a frame), and the foot locks again on the
   * frame it comes down (no frame unlocked in between for a blend to drag it). Off by default
   * (the platformer's tuning predates it); Riftlight's hero turns it on.
   */
  settleSteps: boolean;
}

export const FOOT_PLACEMENT_DEFAULTS: FootPlacementTuning = {
  probeUp: 0.5,
  probeDown: 1.0,
  minNormalY: 0.55,
  maxDrop: 0.36,
  maxRaise: 0.45,
  fadeIn: 0,
  fadeOut: 0.1,
  footRate: 22,
  dropRate: 30,
  pitchRate: 18,
  maxPitch: 30,
  contact: 0.025,
  release: 2,
  maxDrift: 0.14,
  stepTime: 0.15,
  stepSpeed: 1.2,
  stepLift: 0.06,
  releaseRate: 16,
  maxSpread: 25,
  lookahead: 0.1,
  lookaheadTime: 0.045,
  liftRate: 0.7,
  maxReach: 0.3,
  swingShare: 0.75,
  swingSpeed: 4.5,
  swingClear: 0.04,
  swingUp: [0, 0.55],
  swingDown: [0, 0.7],
  guardRate: 30,
  guardMove: 2.5,
  guardPitch: 400,
  settleSteps: false,
};

/** Where a swinging foot is in its swing (from the gait): progress 0..1 and where it lands. */
export interface SwingInfo {
  progress: number;
  /** How far ahead of the body's current position (m, along its facing) the foot touches down. */
  land: number;
}

export interface FootPlacementInput {
  /** Terrain IK wanted (grounded standing / locomotion states). */
  ik: boolean;
  /** Foot locking wanted as well (not while the feet are meant to slide). */
  lock: boolean;
  /**
   * Per foot, while a gait swings it (null: planted, or not a gait): its swing is blended in
   * world space from the ground it took off from to the ground where it will land, early
   * in the swing going up (it is over the riser in time), late going down.
   */
  swing?: { R: SwingInfo | null; L: SwingInfo | null } | null;
  /** Ground speed (m/s): how far ahead a swinging foot looks for risers. */
  speed?: number;
}

/** What it did this frame (tooling, tests). */
export interface FootPlacementState {
  weight: number;
  drop: number;
  feet: { side: 'R' | 'L'; offset: number; pitch: number; locked: boolean; stepping: boolean; correction: number; height: number; easing: number; miss: number }[];
}

type Side = 'R' | 'L';
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** Heel and toe heights differing by more than this (m): the foot is rolling onto the lower one. */
const ROLL = 0.003;

interface Foot {
  side: Side;
  upper: Object3D;
  lower: Object3D;
  foot: Object3D;
  rest: [Quaternion, Quaternion, Quaternion];
  /** As the clips posed it (model space): ankle, heel and toe sole points, sole pitch (rad). */
  readonly mAnkle: Vector3;
  readonly mPts: [Vector3, Vector3];
  mPitch: number;
  /**
   * Smoothed terrain target: for a planted foot as a world height (the character's own up and
   * down movement never drags it: only the ground under the foot changing is smoothed), for
   * a swinging one relative to the body (it moves with the body). `uw`: last offset in use,
   * world. And the slope pitch (deg).
   */
  gw: number;
  gr: number;
  uw: number;
  pitch: number;
  /** Locked: which sole point is on the ground (0 heel, 1 toe, −1 none), and where (world x, z). */
  ref: number;
  ax: number;
  az: number;
  /** Horizontal correction (world) currently applied. */
  cx: number;
  cz: number;
  /** Re-plant step: progress 0..1 (−1 = not stepping), where (world x, z) the sole point it stood on started, and which point. */
  step: number;
  sx: number;
  sz: number;
  sref: number;
  /** How long this re-plant step takes (s). */
  stepTime: number;
  /** Last frame: how high its lower end was, as the clip has it (over flat ground). */
  lastLow: number;
  /** Last frame: heel and toe (world x, z, with the correction) and whether either was down. */
  readonly last: [Vector3, Vector3];
  wasDown: boolean;
  /** Last frame: the sole's middle as the clips placed it (world), and whether that is set. */
  readonly lastAnim: Vector3;
  hasLastAnim: boolean;
  /** Moving forward (along the body's facing) faster than the body: still swinging. */
  swinging: boolean;
  /** Forward speed (world, m/s) as the clips move it, and how much it is in swing (0..1). */
  fwd: number;
  swing: number;
  /** World height of the ground it last stood on (where a swing takes off from). */
  takeoff: number;
  /** Where the ankle is meant to be (world y; tooling). */
  target: number;
  /** The ground under it this frame (relative to the character's feet; heel/toe heights are measured from it). */
  ground: number;
  // per-frame scratch
  readonly ankle: Vector3;
  readonly pts: [Vector3, Vector3];
  readonly h: [number, number];
  readonly g: [number | null, number | null];
  used: number;
  planted: number;
  lift: number;
}

export class FootPlacement {
  readonly tuning: FootPlacementTuning;
  private readonly legs: LegRig;
  private readonly pelvis: Object3D;
  private readonly feet: [Foot, Foot];
  private weight = 0;
  /** Smoothed body height (world) and the pelvis drop it means this frame (m). */
  private bodyY = 0;
  private bodyV = 0;
  private drop = 0;
  /** Smoothing starts over (fading in from nothing). */
  private fresh = true;
  private readonly lastRoot = new Vector3();
  private started = false;
  private captured = false;
  private readonly legGuard: PopGuard;
  /** Per foot: the correction (x, y, z, world; slope pitch, deg) this frame, guarded. */
  private readonly task8: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** Per foot: what the layers and the pelvis drop moved the ankle by (to undo), and the pitch to undo. */
  private readonly undo8: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** Per leg: hip swing, hip spread, knee, ankle (radians), as solved this frame. */
  private readonly legs8: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  constructor(
    private readonly model: Object3D,
    rig: RigSpec,
    private readonly probe: GroundProbe,
    tuning: Partial<FootPlacementTuning> = {},
  ) {
    if (!rig.legs) throw new Error('FootPlacement: rig has no `legs` spec');
    this.legs = rig.legs;
    this.tuning = { ...FOOT_PLACEMENT_DEFAULTS, ...tuning };
    const get = (n: string) => {
      const o = model.getObjectByName(n);
      if (!o) throw new Error(`FootPlacement: joint "${n}" not found`);
      return o;
    };
    this.pelvis = get(rig.root);
    const make = (side: Side): Foot => {
      const j = this.legs[side];
      const upper = get(j.upper);
      const lower = get(j.lower);
      const foot = get(j.foot);
      return {
        side, upper, lower, foot,
        rest: [upper.quaternion.clone(), lower.quaternion.clone(), foot.quaternion.clone()],
        mAnkle: new Vector3(), mPts: [new Vector3(), new Vector3()], mPitch: 0,
        gw: 0, gr: 0, uw: 0, pitch: 0, ref: -1, ax: 0, az: 0, cx: 0, cz: 0, step: -1, sx: 0, sz: 0, sref: 0, stepTime: 0.15, lastLow: 0,
        last: [new Vector3(), new Vector3()], wasDown: false, lastAnim: new Vector3(), hasLastAnim: false, swinging: false, fwd: 0, swing: 0, takeoff: 0, ground: 0, target: 0,
        ankle: new Vector3(), pts: [new Vector3(), new Vector3()], h: [0, 0], g: [null, null], used: 0, planted: 0, lift: 0,
      };
    };
    this.feet = [make('R'), make('L')];
    const T = this.tuning;
    this.legGuard = new PopGuard(8, T.guardRate, [T.guardMove, T.guardMove, T.guardMove, T.guardPitch, T.guardMove, T.guardMove, T.guardMove, T.guardPitch]);
  }

  /** Rest rotations of the leg joints (the clips' reference), if the model was already posed. */
  setRest(rest: ReadonlyMap<string, Quaternion>): void {
    for (const f of this.feet) {
      for (const [k, o] of [f.upper, f.lower, f.foot].entries()) {
        const q = rest.get(o.name);
        if (q) f.rest[k]!.copy(q);
      }
    }
  }

  /** Forget locks and smoothing (teleports, new clip sets), and any jump still easing out. */
  reset(): void {
    this.forget();
    this.legGuard.reset();
  }

  /** Forget locks and smoothing (placement switched off). */
  private forget(): void {
    this.weight = 0;
    this.drop = 0;
    this.fresh = true;
    this.started = false;
    for (const f of this.feet) {
      f.pitch = 0;
      f.ref = -1;
      f.cx = f.cz = 0;
      f.step = -1;
      f.wasDown = false;
      f.hasLastAnim = false;
    }
  }

  state(): FootPlacementState {
    return {
      weight: this.weight,
      drop: this.drop * this.weight,
      feet: this.feet.map((f) => ({
        side: f.side,
        offset: f.used,
        pitch: f.pitch,
        locked: f.ref >= 0,
        stepping: f.step >= 0,
        correction: Math.hypot(f.cx, f.cz),
        height: Math.min(f.h[0], f.h[1]),
        miss: f.foot.getWorldPosition(V0).y - f.target,
        easing: (f.side === 'R' ? [0, 1, 2] : [4, 5, 6]).reduce((m, i) => Math.max(m, Math.abs(this.legGuard.error(i))), 0),
      })),
    };
  }

  /** Remember where the clips put the feet. Call after the mixer, before procedural layers. */
  capture(): void {
    const L = this.legs;
    this.model.updateMatrixWorld(true);
    INV.copy(this.model.matrixWorld).invert();
    for (const f of this.feet) {
      f.foot.getWorldPosition(f.mAnkle).applyMatrix4(INV);
      f.mPts[0].set(0, -L.ankle, -L.heel).applyMatrix4(f.foot.matrixWorld).applyMatrix4(INV);
      f.mPts[1].set(0, -L.ankle, L.ball).applyMatrix4(f.foot.matrixWorld).applyMatrix4(INV);
      f.mPitch = solePitch(f.foot);
    }
    this.captured = true;
  }

  apply(dt: number, input: FootPlacementInput): void {
    const T = this.tuning;
    if (!this.captured) this.capture();
    this.captured = false;
    const root = this.model.getWorldPosition(V0);
    if (!this.started || root.distanceToSquared(this.lastRoot) > 1) {
      this.reset();
      this.started = true;
    }
    this.lastRoot.copy(root);
    const ik = input.ik;
    const fade = ik ? T.fadeIn : T.fadeOut;
    this.weight = fade > 0 ? approach(this.weight, ik ? 1 : 0, dt / fade) : ik ? 1 : 0;
    if (this.weight <= 0) {
      this.forget();
      this.started = true;
      // corrections that just switched off still ease out
      const easing = this.legGuard.active();
      this.legGuard.apply(this.task8.fill(0), dt);
      this.undo8.fill(0);
      if (easing) {
        this.model.updateMatrixWorld(true);
        for (const [i, f] of this.feet.entries()) this.placeLeg(f, i * 4);
      }
      return;
    }
    // eased, so joints start and stop following the corrections gently
    const w = this.weight * this.weight * (3 - 2 * this.weight);
    const locking = input.lock && ik && this.weight >= 0.999;
    this.model.updateMatrixWorld(true);
    const M = this.model.matrixWorld;
    const L = this.legs;
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // ---- terrain under each foot (where the clips put it); fading out (in the air, say) the
    // last offsets just fade with the weight
    FWD.set(0, 0, 1).transformDirection(M).setY(0).normalize();
    for (const f of this.feet) {
      f.ankle.copy(f.mAnkle).applyMatrix4(M);
      f.pts[0].copy(f.mPts[0]).applyMatrix4(M);
      f.pts[1].copy(f.mPts[1]).applyMatrix4(M);
      for (let i = 0; i < 2; i++) f.h[i] = f.pts[i]!.y - root.y;
      // a foot the clips move forward clearly faster than the body is swinging, however low
      V1.addVectors(f.pts[0], f.pts[1]).multiplyScalar(0.5);
      const fwd = f.hasLastAnim && dt > 0 ? ((V1.x - f.lastAnim.x) * FWD.x + (V1.z - f.lastAnim.z) * FWD.z) / dt : 0;
      f.swinging = fwd > (input.speed ?? 0) * T.swingShare + T.swingSpeed;
      f.fwd = fwd;
      const sp = input.speed ?? 0;
      // (relative to the body: a planted foot goes back as fast as it goes forward, a swinging
      // one forward, one sliding along with it (a skid) not at all)
      f.swing = sp > 0.3 ? smoothstep(fwd - sp, sp * 0.2, sp * 0.8) : 0;
      f.lastAnim.copy(V1);
      f.hasLastAnim = true;
      if (!ik) continue;
      let same = true;
      let id = -1;
      let ny = 1;
      for (let i = 0; i < 2; i++) {
        const p = f.pts[i]!;
        f.h[i] = p.y - root.y;
        // where the foot really is: the animation plus the correction it had last frame
        const ok = this.ground(p.x + f.cx, p.z + f.cz, root.y);
        f.g[i] = ok ? HIT.y - root.y : null;
        if (!ok) same = false;
        else if (i === 0) {
          id = HIT.id;
          ny = HIT.ny;
          N0.set(HIT.nx, HIT.ny, HIT.nz);
        } else if (HIT.id !== id || N0.dot(N1.set(HIT.nx, HIT.ny, HIT.nz)) < 0.995) same = false;
      }
      // across a step's edge (heel and toe on different heights): it stands on the edge only
      // if its middle is over the higher step; otherwise it is on the lower one (its tip just
      // touching the riser), not standing on its toe tip with the rest of it in the air
      const g0 = f.g[0];
      const g1 = f.g[1];
      if (g0 !== null && g1 !== null && g0 !== undefined && g1 !== undefined && Math.abs(g1 - g0) > 0.05 && Math.min(f.h[0], f.h[1]) < T.contact && !f.swinging) {
        V1.addVectors(f.pts[0], f.pts[1]).multiplyScalar(0.5);
        const hi = g1 > g0 ? 1 : 0;
        const lo = Math.min(g0, g1);
        if (this.ground(V1.x + f.cx, V1.z + f.cz, root.y) && Math.abs(HIT.y - root.y - lo) < 0.02) f.g[hi] = lo;
      }
      // planted (as animated): its lowest sole point is near the floor; a re-planting step is
      // a swing, whatever the animation says
      const low = Math.min(f.h[0], f.h[1]);
      const planted = f.step >= 0 ? 0 : 1 - smoothstep(low, T.contact, 0.1);
      f.planted = planted;
      // pitch to the slope: only on one surface, and only for a planted foot
      let want = 0;
      if (same && ny < 0.9995) {
        const dist = Math.hypot(f.pts[1].x - f.pts[0].x, f.pts[1].z - f.pts[0].z);
        if (dist > 0.05) want = clamp(-Math.atan2(f.g[1]! - f.g[0]!, dist) * DEG, -T.maxPitch, T.maxPitch) * planted;
      }
      f.pitch += (want - f.pitch) * k(T.pitchRate);
      // heel and toe after pitching about the ankle: the lowest the foot may go
      AXIS.set(1, 0, 0).applyMatrix4(ROT.extractRotation(f.foot.matrixWorld)).normalize();
      let floor = -Infinity;
      for (let i = 0; i < 2; i++) {
        const p = f.pts[i]!;
        OFF.subVectors(p, f.ankle).applyAxisAngle(AXIS, f.pitch * RAD);
        p.addVectors(f.ankle, OFF);
        f.h[i] = p.y - root.y;
        const g = f.g[i];
        // (a foot swinging past at speed clears it a little: it doesn't scuff the floor)
        if (g !== null && g !== undefined) floor = Math.max(floor, g + T.swingClear * f.swing - f.h[i]!);
      }
      // the ground under the foot: under the ankle on one surface (a slope), else the higher
      // of the two (a step edge: stand on the edge, don't hang off it)
      const gh = f.g[0] ?? null;
      const gt = f.g[1] ?? null;
      let ground = gh === null ? (gt ?? -Infinity) : gt === null ? gh : same ? gh + ((gt - gh) * L.heel) / (L.heel + L.ball) : Math.max(gh, gt);
      // a swinging foot clears what is just ahead of it, too (a riser it is about to cross);
      // a gait's swing knows where it lands instead (looking ahead, it sees the step after)
      const si = input.swing?.[f.side] ?? null;
      const reach = T.lookahead + Math.max(0, f.fwd) * T.lookaheadTime;
      const look = si ? 0 : Math.max(1 - planted, f.swing);
      if (look > 0 && reach > 0) {
        const fx = f.pts[1].x - f.pts[0].x;
        const fz = f.pts[1].z - f.pts[0].z;
        const len = Math.hypot(fx, fz);
        // halfway and all the way out
        for (const share of [0.5, 1]) {
          if (len > 0.05 && this.ground(f.pts[1].x + f.cx + (fx / len) * reach * share, f.pts[1].z + f.cz + (fz / len) * reach * share, root.y)) {
            const ahead = HIT.y - root.y;
            if (ahead > ground) ground += (ahead - ground) * look;
          }
        }
      }
      f.ground = ground;
      // a gait's swinging foot: from the ground it took off from to where it will land
      if (!si && planted > 0.5 && Number.isFinite(ground)) f.takeoff = root.y + ground;
      if (si && this.landing(f, si, root)) {
        const land = HIT.y;
        const [a, b] = land > f.takeoff ? T.swingUp : T.swingDown;
        const e = smoothstep(si.progress, a, b);
        ground = Math.max(ground, f.takeoff + (land - f.takeoff) * e - root.y);
      } else if (ground < 0) {
        // a swinging foot is lifted over higher ground but not lowered to lower ground (it
        // would drag along it): it comes down to it as it plants
        ground *= planted;
      }
      // keep the clip's height above the ground under it, and never go through it
      const rel = Number.isFinite(floor) ? clamp(Math.max(floor, ground), -T.maxDrop, T.maxRaise) : 0;
      if (this.fresh) {
        f.gw = f.uw = f.takeoff = root.y + rel;
        f.gr = rel;
      }
      // (a gait's swing is already a smooth path: followed as it is, in world space)
      f.gw = si ? root.y + rel : f.gw + (root.y + rel - f.gw) * k(T.footRate);
      f.gr += (rel - f.gr) * k(T.footRate);
      // (a gait's swing is followed in world space too: the body stepping up doesn't move it)
      const smooth = si ? f.gw : root.y + planted * (f.gw - root.y) + (1 - planted) * f.gr;
      // out of the ground: at once for a swinging foot or a step edge under it, gently for a
      // planted one a blend pushed in a little
      const edge = gh !== null && gt !== null && Math.abs(gt - gh) > 0.05 && !same;
      const out = Number.isFinite(floor) ? Math.max(smooth, Math.min(root.y + floor, f.uw + (planted > 0.5 && !edge ? T.liftRate * dt : Infinity))) : smooth;
      f.used = clamp(out - root.y, -T.maxDrop, T.maxRaise);
      f.uw = root.y + f.used;
    }

    // ---- pelvis: down to the deeper planted foot (a swinging foot neither holds the body up
    // nor pulls it down; it is lifted over the terrain instead)
    let dropTarget = 0;
    for (const f of this.feet) dropTarget = Math.min(dropTarget, f.used * f.planted);
    if (ik) {
      const body = root.y + clamp(dropTarget, -T.maxDrop, 0);
      // in world space (the character's own steps up and down don't move it), critically
      // damped (no sudden change of speed either)
      // starting over (a landing): from the drop that leaves the legs as the clip has them,
      // the one the least lowered foot needs (a foot still in the air would otherwise have
      // its leg straightened or folded at once), then on to the target
      if (this.fresh) {
        let least = -Infinity;
        for (const f of this.feet) least = Math.max(least, f.used);
        this.bodyY = root.y + clamp(least, -T.maxDrop, 0);
        this.bodyV = 0;
      }
      {
        const e = Math.exp(-T.dropRate * dt);
        const x = this.bodyY - body;
        const j0 = this.bodyV + T.dropRate * x;
        this.bodyY = body + (x + j0 * dt) * e;
        this.bodyV = (this.bodyV - T.dropRate * j0 * dt) * e;
      }
      this.drop = clamp(this.bodyY - root.y, -T.maxDrop, 0);
      this.fresh = false;
    }
    const drop = this.drop * w;

    // ---- locking
    for (const [i, f] of this.feet.entries()) {
      const other = this.feet[1 - i]!;
      f.lift = 0;
      // heel and toe on the ground, as the clip has them: their height above their own
      // ground, relative to the ground the foot is placed on (on a slope the toe's ground is
      // higher than the heel's); not after the terrain offset, which eases and would keep a
      // lifting foot "on the ground" a little longer
      const gr0 = Number.isFinite(f.ground) ? f.ground : 0;
      const e0 = f.g[0] === null ? f.h[0] : f.h[0] + gr0 - f.g[0];
      const e1 = f.g[1] === null ? f.h[1] : f.h[1] + gr0 - f.g[1];
      const on0 = e0 < T.contact;
      const on1 = e1 < T.contact;
      if (!locking && (f.step < 0 || !ik || !T.settleSteps)) {
        f.ref = -1;
        f.step = -1;
      } else if (f.step >= 0) {
        // the lift eases in and out; the foot moves once it is clear of the floor
        f.step = Math.min(1, f.step + dt / f.stepTime);
        const e = smoothstep(f.step, 0.2, 0.8); // (moving only while clear of the floor)
        // from where it stood (in the world) to where the clip has it now
        const p = f.pts[f.sref]!;
        f.cx = (f.sx - p.x) * (1 - e);
        f.cz = (f.sz - p.z) * (1 - e);
        f.lift = T.stepLift * Math.sin(Math.PI * f.step) ** 2;
        if (f.step >= 1) {
          f.step = -1;
          // it comes down where the clip has it, and is planted from this frame on (`settleSteps`)
          if (T.settleSteps && locking && (on0 || on1)) {
            f.ref = on0 && (!on1 || e0 <= e1) ? 0 : 1;
            const p = f.pts[f.ref]!;
            f.ax = p.x + f.cx;
            f.az = p.z + f.cz;
          }
        }
      } else if (f.ref >= 0) {
        // lifted off: back to the animation, in the air. Clearly lifted, or on its way up (a
        // blend that lifts it a hair for a frame and puts it back doesn't count)
        // (rising as the clip has it: not the terrain under it changing; a gait's lift-off
        // is its own business)
        const low = Math.min(e0, e1);
        const rising = !input.swing && low > T.contact && Math.min(f.h[0], f.h[1]) > f.lastLow + 0.002;
        if (low > T.contact * T.release || rising) f.ref = -1;
        else {
          // the foot pivots on whichever end is lower: a lifting heel rolls onto the toe, a
          // toe coming down after a heel strike onto the heel. The end it stood on holds this
          // frame too; the other end takes over from where that puts it.
          const held = f.pts[f.ref]!;
          f.cx = f.ax - held.x;
          f.cz = f.az - held.z;
          const lowEnd = e0 < e1 - ROLL ? 0 : e1 < e0 - ROLL ? 1 : f.ref;
          if (lowEnd !== f.ref) {
            const p = f.pts[lowEnd]!;
            f.ref = lowEnd;
            f.ax = p.x + f.cx;
            f.az = p.z + f.cz;
          }
          // out of the leg's reach (the body moved on, or up a step): re-plant now
          f.upper.getWorldPosition(V1);
          V1.y += this.drop;
          const far = V1.distanceTo(V2.set(f.ankle.x + f.cx, f.ankle.y + f.used, f.ankle.z + f.cz)) > (L.upper + L.lower) * 0.97;
          const drifted = far || f.cx * f.cx + f.cz * f.cz > T.maxDrift * T.maxDrift;
          // the clip is already lifting it (a hop, a kick): let it go where the clip takes it
          if (drifted && Math.min(e0, e1) > T.contact) f.ref = -1;
          // (one foot at a time, though the next may lift as the last one comes down)
          else if (drifted && (other.step < 0 || other.step > 0.6)) {
            f.sref = f.ref;
            f.ref = -1;
            f.step = 0;
            // (a longer way takes longer: no faster than `stepSpeed`)
            f.stepTime = Math.max(T.stepTime, Math.hypot(f.cx, f.cz) / T.stepSpeed);
            f.sx = f.ax;
            f.sz = f.az;
          }
        }
      } else if ((on0 || on1) && !f.swinging) {
        // touches down: lock where it is now (with whatever correction it still has); a foot
        // that was already on the floor last frame stays where it was then
        f.ref = on0 && (!on1 || e0 <= e1) ? 0 : 1;
        const p = f.pts[f.ref]!;
        f.ax = p.x + f.cx;
        f.az = p.z + f.cz;
        const was = f.last[f.ref]!;
        if (f.wasDown && (was.x - f.ax) ** 2 + (was.z - f.az) ** 2 < T.maxDrift * T.maxDrift) {
          f.ax = was.x;
          f.az = was.z;
          f.cx = f.ax - p.x;
          f.cz = f.az - p.z;
        }
      }
      if (f.ref < 0 && f.step < 0) {
        const r = 1 - k(T.releaseRate);
        f.cx *= r;
        f.cz *= r;
      }
      f.wasDown = on0 || on1;
      f.lastLow = Math.min(f.h[0], f.h[1]);
      for (let j = 0; j < 2; j++) f.last[j]!.set(f.pts[j]!.x + f.cx, 0, f.pts[j]!.z + f.cz);
    }

    // ---- apply: drop the pelvis, then put each foot where it belongs
    this.applyDrop(drop);
    const task = this.task8;
    for (const [i, f] of this.feet.entries()) {
      // target: where the clip put the ankle, on the ground, with the lock's correction; the
      // current ankle may differ (the pelvis dropped, layers moved the body)
      const c = Math.hypot(f.cx, f.cz);
      const cs = c > T.maxReach ? T.maxReach / c : 1;
      f.target = f.ankle.y + f.used + f.lift;
      const at = i * 4;
      task[at] = f.cx * cs * w;
      // (height relative to the hips, which stay put in the world when the character steps
      // up or down: the offset under a planted foot jumps then, its height under the hips doesn't)
      task[at + 1] = (f.used + f.lift - this.drop) * w;
      task[at + 2] = f.cz * cs * w;
      task[at + 3] = f.pitch * w;
      // and undo what the layers and the drop did to the clip's ankle and sole pitch
      f.foot.getWorldPosition(CUR);
      const undo = this.undo8;
      undo[at] = (f.ankle.x - CUR.x) * w;
      undo[at + 1] = (f.ankle.y - CUR.y) * w;
      undo[at + 2] = (f.ankle.z - CUR.z) * w;
      undo[at + 3] = (f.mPitch - solePitch(f.foot)) * DEG * w;
      // (a locked foot's hold and a re-planting step: never held back)
      const free = f.ref >= 0 ? 1e3 : f.step >= 0 ? T.guardMove * 2 : T.guardMove;
      this.legGuard.setMaxSpeed(at, free);
      this.legGuard.setMaxSpeed(at + 2, free);
    }
    this.legGuard.apply(task, dt);
    for (const [i, f] of this.feet.entries()) {
      task[i * 4 + 1] = task[i * 4 + 1]! + this.drop * w;
      this.placeLeg(f, i * 4);
    }
  }

  /**
   * Move the leg so its ankle moves by `task8[at..at+2]` (world) and its sole pitches by
   * `task8[at+3]` degrees: the planar solve is a linearisation, so it is applied, what is
   * left measured, and solved again.
   */
  private placeLeg(f: Foot, at: number): void {
    const task = this.task8;
    const undo = this.undo8;
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += Math.abs(task[at + k]!) + Math.abs(undo[at + k]!);
    if (sum < 1e-7) return;
    f.foot.getWorldPosition(CUR);
    D.set(task[at]! + undo[at]!, task[at + 1]! + undo[at + 1]!, task[at + 2]! + undo[at + 2]!);
    TGT.addVectors(CUR, D);
    const before = solePitch(f.foot);
    const pitch = task[at + 3]! + undo[at + 3]!;
    this.solveLeg(f, CUR, D, pitch, at);
    this.setLeg(f, at);
    f.upper.updateMatrixWorld(true);
    f.foot.getWorldPosition(CUR);
    D.subVectors(TGT, CUR);
    this.solveLeg(f, CUR, D, (before + pitch * RAD - solePitch(f.foot)) * DEG, at);
    this.setLeg(f, at);
  }

  /** Lower the pelvis by `drop` (m, ≤ 0), straight down in its parent's space. */
  private applyDrop(drop: number): void {
    if (drop !== 0) {
      const parent = this.pelvis.parent;
      if (parent) {
        parent.localToWorld(V1.copy(this.pelvis.position));
        V1.y += drop;
        this.pelvis.position.copy(parent.worldToLocal(V1));
      } else this.pelvis.position.y += drop;
    }
    this.pelvis.updateMatrixWorld(true);
  }

  /** Add the (guarded) leg corrections at `legs8[at..at+3]` to the leg's joints. */
  private setLeg(f: Foot, at: number): void {
    const c = this.legs8;
    if (Math.abs(c[at]!) + Math.abs(c[at + 1]!) + Math.abs(c[at + 2]!) + Math.abs(c[at + 3]!) < 1e-7) return;
    const eu = eulerOf(f.upper, f.rest[0], EU);
    const el = eulerOf(f.lower, f.rest[1], EL);
    const ef = eulerOf(f.foot, f.rest[2], EF);
    eu.x += c[at]!;
    eu.z += c[at + 1]!;
    el.x += c[at + 2]!;
    ef.x += c[at + 3]!;
    setEuler(f.upper, f.rest[0], eu);
    setEuler(f.lower, f.rest[1], el);
    setEuler(f.foot, f.rest[2], ef);
  }

  /** The ground (into HIT) where a swinging foot will land: ahead of the body, as far out to the side as the foot is now. */
  private landing(f: Foot, si: SwingInfo, root: Vector3): boolean {
    const T = this.tuning;
    const lat = (f.ankle.x - root.x) * FWD.z - (f.ankle.z - root.z) * FWD.x;
    const x = root.x + FWD.x * si.land + FWD.z * lat;
    const z = root.z + FWD.z * si.land - FWD.x * lat;
    const top = root.y + T.maxRaise + 0.3;
    return this.probe(x, top, z, T.maxRaise + 0.3 + T.maxDrop + 0.5, HIT) && HIT.ny >= T.minNormalY && top - HIT.y > 0.01;
  }

  /** Ground straight under (x, z), into HIT; false if none (or a wall, or started inside something). */
  private ground(x: number, z: number, rootY: number): boolean {
    const T = this.tuning;
    const top = rootY + T.probeUp;
    return this.probe(x, top, z, T.probeUp + T.probeDown, HIT) && HIT.ny >= T.minNormalY && top - HIT.y > 0.01;
  }

  /**
   * The joint changes (into `legs8[at..at+3]`: hip swing, hip spread, knee, ankle) that move
   * the ankle (now at `ankle`, world) by `d` and pitch the foot by `pitch` degrees (+ = toes down).
   */
  private solveLeg(f: Foot, ankle: Vector3, d: Vector3, pitch: number, at: number): void {
    const out = this.legs8;
    out[at] = out[at + 1] = out[at + 2] = out[at + 3] = 0;
    if (d.lengthSq() < 1e-10 && Math.abs(pitch) < 1e-4) return;
    const L = this.legs;
    const a = this.pelvis.worldToLocal(V2.copy(ankle));
    const b = this.pelvis.worldToLocal(V3.copy(ankle).add(d));
    const dl = b.sub(a);
    const eu = eulerOf(f.upper, f.rest[0], EU);
    const el = eulerOf(f.lower, f.rest[1], EL);
    const u = eu.x;
    const kn = el.x;
    // planar ankle, relative to the hip, in the pelvis' (unscaled) space
    const y0 = -L.upper * Math.cos(u) - L.lower * Math.cos(u + kn);
    const z0 = -L.upper * Math.sin(u) - L.lower * Math.sin(u + kn);
    // Both through the same soft limits (so no correction is exactly no change): an ankle
    // aimed out of reach (too far, too close, above the hip) is eased toward the edge of
    // what the leg can do instead of clamped, so the knee never snaps there.
    soften(y0, z0, L.upper, L.lower, SOFT0);
    soften(y0 + dl.y, z0 + dl.z, L.upper, L.lower, SOFT1);
    const [u0, k0] = twoBoneX(SOFT0[0]!, SOFT0[1]!, L.upper, L.lower);
    const [u1, k1] = twoBoneX(SOFT1[0]!, SOFT1[1]!, L.upper, L.lower);
    const du = (u1 - u0) * RAD;
    const dk = (k1 - k0) * RAD;
    const spread = clamp(Math.atan2(dl.x, Math.max(0.2, -y0)), -this.tuning.maxSpread * RAD, this.tuning.maxSpread * RAD);
    out[at] = du;
    out[at + 1] = spread;
    out[at + 2] = dk;
    out[at + 3] = -(du + dk) + pitch * RAD;
  }
}

const HIT: GroundHit = { y: 0, nx: 0, ny: 1, nz: 0, id: -1 };
const V0 = new Vector3();
const V1 = new Vector3();
const V2 = new Vector3();
const V3 = new Vector3();
const D = new Vector3();
const TGT = new Vector3();
const CUR = new Vector3();
const N0 = new Vector3();
const N1 = new Vector3();
const AXIS = new Vector3();
const OFF = new Vector3();
const FWD = new Vector3();
const EU = new Euler();
const EL = new Euler();
const EF = new Euler();
const Q = new Quaternion();
const INV = new Matrix4();
const ROT = new Matrix4();

const SOFT0 = [0, 0];
const SOFT1 = [0, 0];

/**
 * A planar ankle target (y down from the hip, z forward) eased into what a two-bone leg can
 * reach: no higher than a little below the hip, no further than nearly straight, no closer
 * than the knee folds. Smooth (tanh) near each edge, the identity well inside.
 */
function soften(y: number, z: number, upper: number, lower: number, out: number[]): void {
  // height: at most `top` below the hip, eased in over `band`
  const top = -0.08;
  const band = 0.12;
  if (y > top - band) y = top - band + band * Math.tanh((y - (top - band)) / band);
  // reach: between the folded and the straight leg, eased in over 10% at either end
  const max = (upper + lower) * 0.98;
  const min = Math.sqrt(upper * upper + lower * lower - 2 * upper * lower * Math.cos((30 * Math.PI) / 180)) * 1.02;
  let d = Math.hypot(y, z);
  const r = d;
  const soft = 0.1 * max;
  if (d > max - soft) d = max - soft + soft * Math.tanh((d - (max - soft)) / soft);
  if (d < min + soft) d = min + soft - soft * Math.tanh((min + soft - d) / soft);
  const k = r > 1e-6 ? d / r : 1;
  out[0] = y * k;
  out[1] = z * k;
}

/** World pitch of a foot (radians, + = toes down), from its forward axis. */
function solePitch(foot: Object3D): number {
  FWD.set(0, 0, 1).applyMatrix4(ROT.extractRotation(foot.matrixWorld));
  return Math.atan2(-FWD.y, Math.hypot(FWD.x, FWD.z));
}

/** Rotation relative to rest, as Euler XYZ (radians), into `out`. */
function eulerOf(o: Object3D, rest: Quaternion, out: Euler): Euler {
  Q.copy(rest).invert().multiply(o.quaternion);
  return out.setFromQuaternion(Q, 'XYZ');
}

function setEuler(o: Object3D, rest: Quaternion, e: Euler): void {
  o.quaternion.copy(rest).multiply(Q.setFromEuler(e));
}

function approach(v: number, t: number, d: number): number {
  return v < t ? Math.min(v + d, t) : Math.max(v - d, t);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function smoothstep(x: number, a: number, b: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
