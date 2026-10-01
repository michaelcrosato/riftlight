import { Euler, Matrix4, type Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { twoBoneX } from './ik';
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
  /** Locked feet: re-plant with a step once the animation is this far away (m). */
  maxDrift: number;
  /** The re-plant step: duration (s) and lift (m). */
  stepTime: number;
  stepLift: number;
  /** A released foot returns to the animation at this rate (1/s). */
  releaseRate: number;
  /** Most hip abduction for a sideways offset (degrees). */
  maxSpread: number;
  /**
   * A swinging foot also looks ahead of its toe, to lift over a riser in time: this far (m),
   * plus `lookaheadTime` seconds at the character's speed.
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
  maxDrift: 0.14,
  stepTime: 0.15,
  stepLift: 0.06,
  releaseRate: 16,
  maxSpread: 25,
  lookahead: 0.1,
  lookaheadTime: 0.07,
  liftRate: 0.7,
  maxReach: 0.3,
};

export interface FootPlacementInput {
  /** Terrain IK wanted (grounded standing / locomotion states). */
  ik: boolean;
  /** Foot locking wanted as well (not while the feet are meant to slide). */
  lock: boolean;
  /** Ground speed (m/s): how far ahead a swinging foot looks for risers. */
  speed?: number;
}

/** What it did this frame (tooling, tests). */
export interface FootPlacementState {
  weight: number;
  drop: number;
  feet: { side: 'R' | 'L'; offset: number; pitch: number; locked: boolean; stepping: boolean; correction: number; height: number }[];
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
  /** Re-plant step: progress 0..1 (−1 = not stepping), and the correction it started from. */
  step: number;
  sx: number;
  sz: number;
  /** Last frame: heel and toe (world x, z, with the correction) and whether either was down. */
  readonly last: [Vector3, Vector3];
  wasDown: boolean;
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
  private drop = 0;
  /** Smoothing starts over (fading in from nothing). */
  private fresh = true;
  private readonly lastRoot = new Vector3();
  private started = false;
  private captured = false;

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
        gw: 0, gr: 0, uw: 0, pitch: 0, ref: -1, ax: 0, az: 0, cx: 0, cz: 0, step: -1, sx: 0, sz: 0,
        last: [new Vector3(), new Vector3()], wasDown: false,
        ankle: new Vector3(), pts: [new Vector3(), new Vector3()], h: [0, 0], g: [null, null], used: 0, planted: 0, lift: 0,
      };
    };
    this.feet = [make('R'), make('L')];
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

  /** Forget locks and smoothing (teleports, new clip sets). */
  reset(): void {
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
      this.reset();
      this.started = true;
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
    for (const f of this.feet) {
      f.ankle.copy(f.mAnkle).applyMatrix4(M);
      f.pts[0].copy(f.mPts[0]).applyMatrix4(M);
      f.pts[1].copy(f.mPts[1]).applyMatrix4(M);
      for (let i = 0; i < 2; i++) f.h[i] = f.pts[i]!.y - root.y;
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
        if (g !== null && g !== undefined) floor = Math.max(floor, g - f.h[i]!);
      }
      // the ground under the foot: under the ankle on one surface (a slope), else the higher
      // of the two (a step edge: stand on the edge, don't hang off it)
      const gh = f.g[0] ?? null;
      const gt = f.g[1] ?? null;
      let ground = gh === null ? (gt ?? -Infinity) : gt === null ? gh : same ? gh + ((gt - gh) * L.heel) / (L.heel + L.ball) : Math.max(gh, gt);
      // a swinging foot clears what is just ahead of it, too (a riser it is about to cross)
      const reach = T.lookahead + (input.speed ?? 0) * T.lookaheadTime;
      if (planted < 1 && reach > 0) {
        const fx = f.pts[1].x - f.pts[0].x;
        const fz = f.pts[1].z - f.pts[0].z;
        const len = Math.hypot(fx, fz);
        // halfway and all the way out
        for (const share of [0.5, 1]) {
          if (len > 0.05 && this.ground(f.pts[1].x + f.cx + (fx / len) * reach * share, f.pts[1].z + f.cz + (fz / len) * reach * share, root.y)) {
            const ahead = HIT.y - root.y;
            if (ahead > ground) ground += (ahead - ground) * (1 - planted);
          }
        }
      }
      // a swinging foot is lifted over higher ground but not lowered to lower ground (it
      // would drag along it): it comes down to it as it plants
      if (ground < 0) ground *= planted;
      // keep the clip's height above the ground under it, and never go through it
      const rel = Number.isFinite(floor) ? clamp(Math.max(floor, ground), -T.maxDrop, T.maxRaise) : 0;
      if (this.fresh) {
        f.gw = f.uw = root.y + rel;
        f.gr = rel;
      }
      f.gw += (root.y + rel - f.gw) * k(T.footRate);
      f.gr += (rel - f.gr) * k(T.footRate);
      const smooth = root.y + planted * (f.gw - root.y) + (1 - planted) * f.gr;
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
      this.bodyY = this.fresh ? body : this.bodyY + (body - this.bodyY) * k(T.dropRate);
      this.drop = clamp(this.bodyY - root.y, -T.maxDrop, 0);
      this.fresh = false;
    }
    const drop = this.drop * w;

    // ---- locking
    for (const [i, f] of this.feet.entries()) {
      const other = this.feet[1 - i]!;
      f.lift = 0;
      // heel and toe on the ground: their height above their own ground, after the terrain
      // offset (on a slope the toe's ground is higher than the heel's)
      const e0 = f.g[0] === null ? f.h[0] : f.h[0] + f.used - f.g[0];
      const e1 = f.g[1] === null ? f.h[1] : f.h[1] + f.used - f.g[1];
      const on0 = e0 < T.contact;
      const on1 = e1 < T.contact;
      if (!locking) {
        f.ref = -1;
        f.step = -1;
      } else if (f.step >= 0) {
        // the lift eases in and out; the foot moves once it is clear of the floor
        f.step = Math.min(1, f.step + dt / T.stepTime);
        const e = smoothstep(f.step, 0.25, 0.9);
        f.cx = f.sx * (1 - e);
        f.cz = f.sz * (1 - e);
        f.lift = T.stepLift * Math.sin(Math.PI * f.step) ** 2;
        if (f.step >= 1) f.step = -1;
      } else if (f.ref >= 0) {
        if (!on0 && !on1) f.ref = -1; // lifted off: back to the animation, in the air
        else {
          // the foot pivots on whichever end is lower: a lifting heel rolls onto the toe, a
          // toe coming down after a heel strike onto the heel; the correction is kept
          const lowEnd = e0 < e1 - ROLL ? 0 : e1 < e0 - ROLL ? 1 : f.ref;
          if (lowEnd !== f.ref) {
            const p = f.pts[lowEnd]!;
            f.ref = lowEnd;
            f.ax = p.x + f.cx;
            f.az = p.z + f.cz;
          }
          const p = f.pts[f.ref]!;
          f.cx = f.ax - p.x;
          f.cz = f.az - p.z;
          // out of the leg's reach (the body moved on, or up a step): re-plant now
          f.upper.getWorldPosition(V1);
          V1.y += this.drop;
          const far = V1.distanceTo(V2.set(f.ankle.x + f.cx, f.ankle.y + f.used, f.ankle.z + f.cz)) > (L.upper + L.lower) * 0.97;
          if ((far || f.cx * f.cx + f.cz * f.cz > T.maxDrift * T.maxDrift) && other.step < 0) {
            f.ref = -1;
            f.step = 0;
            f.sx = f.cx;
            f.sz = f.cz;
          }
        }
      } else if (on0 || on1) {
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
      for (let j = 0; j < 2; j++) f.last[j]!.set(f.pts[j]!.x + f.cx, 0, f.pts[j]!.z + f.cz);
    }

    // ---- apply: drop the pelvis, then put each foot where it belongs
    if (drop !== 0) {
      // straight down in the pelvis' parent space
      const parent = this.pelvis.parent;
      if (parent) {
        parent.localToWorld(V1.copy(this.pelvis.position));
        V1.y += drop;
        this.pelvis.position.copy(parent.worldToLocal(V1));
      } else this.pelvis.position.y += drop;
    }
    this.pelvis.updateMatrixWorld(true);
    for (const f of this.feet) {
      // target: where the clip put the ankle, on the ground, with the lock's correction; the
      // current ankle may differ (the pelvis dropped, layers moved the body)
      const c = Math.hypot(f.cx, f.cz);
      const cs = c > T.maxReach ? T.maxReach / c : 1;
      TGT.set(f.ankle.x + f.cx * cs, f.ankle.y + f.used + f.lift, f.ankle.z + f.cz * cs);
      f.foot.getWorldPosition(CUR);
      D.subVectors(TGT, CUR).multiplyScalar(w);
      // sole pitch: back to the clip's, plus the slope's
      const pitch = (f.mPitch - solePitch(f.foot)) * DEG * w + f.pitch * w;
      this.solveLeg(f, CUR, D, pitch);
    }
  }

  /** Ground straight under (x, z), into HIT; false if none (or a wall, or started inside something). */
  private ground(x: number, z: number, rootY: number): boolean {
    const T = this.tuning;
    const top = rootY + T.probeUp;
    return this.probe(x, top, z, T.probeUp + T.probeDown, HIT) && HIT.ny >= T.minNormalY && top - HIT.y > 0.01;
  }

  /** Move the ankle (now at `ankle`, world) by `d` and pitch the foot by `pitch` degrees (+ = toes down). */
  private solveLeg(f: Foot, ankle: Vector3, d: Vector3, pitch: number): void {
    if (d.lengthSq() < 1e-10 && Math.abs(pitch) < 1e-4) return;
    const L = this.legs;
    const a = this.pelvis.worldToLocal(V2.copy(ankle));
    const b = this.pelvis.worldToLocal(V3.copy(ankle).add(d));
    const dl = b.sub(a);
    const eu = eulerOf(f.upper, f.rest[0], EU);
    const el = eulerOf(f.lower, f.rest[1], EL);
    const ef = eulerOf(f.foot, f.rest[2], EF);
    const u = eu.x;
    const kn = el.x;
    // planar ankle, relative to the hip, in the pelvis' (unscaled) space
    const y0 = -L.upper * Math.cos(u) - L.lower * Math.cos(u + kn);
    const z0 = -L.upper * Math.sin(u) - L.lower * Math.sin(u + kn);
    const [u0, k0] = twoBoneX(y0, z0, L.upper, L.lower);
    // never aim (further) above the hip: atan2 would swing the leg round the other way
    const [u1, k1] = twoBoneX(Math.min(y0 + dl.y, Math.max(y0, -0.08)), z0 + dl.z, L.upper, L.lower);
    const du = (u1 - u0) * RAD;
    const dk = (k1 - k0) * RAD;
    const spread = clamp(Math.atan2(dl.x, Math.max(0.2, -y0)), -this.tuning.maxSpread * RAD, this.tuning.maxSpread * RAD);
    eu.x += du;
    eu.z += spread;
    el.x += dk;
    ef.x += -(du + dk) + pitch * RAD;
    setEuler(f.upper, f.rest[0], eu);
    setEuler(f.lower, f.rest[1], el);
    setEuler(f.foot, f.rest[2], ef);
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
