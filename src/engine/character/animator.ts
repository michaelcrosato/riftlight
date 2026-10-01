import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type Object3D, type Quaternion, Vector3 } from 'three/webgpu';
import { FootPlacement, type FootPlacementInput, type FootPlacementTuning, type GroundProbe, type SwingInfo } from '../animation/footPlacement';
import { PoseLayers, type PoseLayerInput, type PoseLayerTuning } from '../animation/poseLayers';
import { RotationBlend } from '../animation/rotationBlend';
import type { RigSpec } from '../animation/types';

/**
 * Clip playback for PlatformerCharacter: blends, the locomotion blend space and the
 * procedural layers, in the order they run every render frame:
 *
 *   fades → gait phase → mixer → RotationBlend → (feet captured) → PoseLayers (lean, look,
 *   landing) → FootPlacement (feet back where the clips put them, on the real ground)
 *
 * **Blends.** Weights are driven here, not by three's crossFadeFrom (which restarts the
 * outgoing clip's fade from full weight, so a clip only partly faded in snapped to 100%
 * whenever states changed faster than the fade). Every outgoing clip fades from the weight
 * it has now.
 *
 * **Locomotion blend space.** Tiptoe, Walk and Run play together as one logical clip (the
 * "gait"): weights come from the ground speed (Walk at its authored speed → Run at its
 * authored speed), with Tiptoe taking the low end on a gentle stick tilt. All three share
 * one normalised phase (they all strike the right heel at 0), which advances at
 * speed / (blended stride length), so the blended planted foot moves exactly with the
 * ground and every clip plays at a rate matched to its own authored speed.
 */
export interface AnimRequest {
  name: string;
  once?: boolean;
  /** Playback rate (negative plays backwards). */
  speed?: number;
  /** Fade-in seconds (default 0.12). */
  fade?: number;
  /** Play the locomotion blend space instead of `name` (`name` is the fallback clip). */
  gait?: GaitRequest;
}

export interface GaitRequest {
  /** Ground speed (m/s). */
  speed: number;
  /** 0..1: the share of the low end that tiptoes (gentle stick tilt) instead of walking. */
  tiptoe: number;
}

/** The clips of the locomotion blend space, by role, and where walking turns into running. */
export interface GaitClips {
  tiptoe: string;
  walk: string;
  run: string;
  /**
   * Ground speeds (m/s) between which Walk cross-fades into Run (default: their authored
   * speeds). Gaits with different stance shares don't blend cleanly (one foot is still
   * planted while the other gait already swings it), so keep the band short.
   */
  blend?: readonly [number, number];
}

export interface AnimatorOptions {
  rig?: RigSpec;
  probe?: GroundProbe;
  feet?: Partial<FootPlacementTuning>;
  layers?: Partial<PoseLayerTuning>;
  gait?: GaitClips;
}

/** Everything the procedural passes need this frame. */
export interface ProceduralInput extends PoseLayerInput {
  feet: FootPlacementInput;
}

interface Fade {
  from: number;
  to: number;
  t: number;
  duration: number;
}

/** A logical clip: one action, or the gait (several actions sharing the weight). */
interface Layer {
  key: string;
  actions: AnimationAction[];
  shares: number[];
  weight: number;
  active: boolean;
  fade: Fade | null;
}

const GAIT = '<gait>';

export class Animator {
  readonly model: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly rotationBlend: RotationBlend;
  private readonly layers = new Map<string, Layer>();
  private readonly byName = new Map<string, AnimationAction>();
  private current: Layer | null = null;
  /** Gait: actions in role order (tiptoe, walk, run), stride per cycle (m), stance shares, phase 0..1. */
  private readonly gait: { layer: Layer; stride: number[]; speed: number[]; stance: number[]; reach: number[]; band: readonly [number, number]; phase: number; tiptoe: number; request: GaitRequest } | null;
  readonly feet: FootPlacement | null;
  readonly pose: PoseLayers | null;
  private readonly footNames: [string, string];
  /**
   * The animated pose of every joint the procedural passes change, saved after the mixer and
   * put back before the next mixer update. three's mixer only writes a joint whose blended
   * value changed, so a held pose would otherwise keep (and stack) last frame's offsets.
   */
  private readonly touched: { o: Object3D; p: Vector3; q: Quaternion; s: Vector3 }[] = [];

  constructor(model: Object3D, clips: readonly AnimationClip[], rest: ReadonlyMap<string, Quaternion>, options: AnimatorOptions = {}) {
    this.model = model;
    this.mixer = new AnimationMixer(model);
    for (const clip of clips) this.byName.set(clip.name, this.mixer.clipAction(clip));
    this.rotationBlend = new RotationBlend(model, this.byName.values(), rest);
    const g = options.gait;
    const roles = g ? [g.tiptoe, g.walk, g.run].map((n) => this.byName.get(n)) : [];
    if (g && roles.every((a) => a && typeof a.getClip().userData.speed === 'number')) {
      const actions = roles as AnimationAction[];
      const layer: Layer = { key: GAIT, actions, shares: [0, 1, 0], weight: 0, active: false, fade: null };
      this.layers.set(GAIT, layer);
      const speed = actions.map((a) => Math.abs(a.getClip().userData.speed as number));
      this.gait = {
        layer,
        speed,
        stride: actions.map((a, i) => speed[i]! * a.getClip().duration),
        stance: actions.map((a) => (a.getClip().userData.stance as number | undefined) ?? 0.5),
        reach: actions.map((a) => (a.getClip().userData.reach as number | undefined) ?? 0),
        band: g.blend ?? [speed[1]!, speed[2]!],
        phase: 0,
        tiptoe: 0,
        request: { speed: 0, tiptoe: 0 },
      };
    } else this.gait = null;
    for (const [name, action] of this.byName) {
      if (this.gait?.layer.actions.includes(action)) continue;
      this.layers.set(name, { key: name, actions: [action], shares: [1], weight: 0, active: false, fade: null });
    }
    const rig = options.rig;
    this.footNames = rig?.legs ? [rig.legs.R.foot, rig.legs.L.foot] : ['FootR', 'FootL'];
    this.feet = rig?.legs && options.probe && hasJoints(model, rig) ? new FootPlacement(model, rig, options.probe, options.feet) : null;
    this.feet?.setRest(rest);
    this.pose = rig && hasJoints(model, rig) ? new PoseLayers(model, rig, options.layers) : null;
    this.pose?.setRest(rest);
    if (rig && (this.feet || this.pose)) {
      const names = [rig.root, rig.spine?.torso, rig.spine?.head, ...(rig.legs ? (['R', 'L'] as const).flatMap((sd) => [rig.legs![sd].upper, rig.legs![sd].lower, rig.legs![sd].foot]) : [])];
      for (const n of names) {
        const o = n ? model.getObjectByName(n) : undefined;
        if (o) this.touched.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
      }
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  duration(name: string): number | undefined {
    return this.byName.get(name)?.getClip().duration;
  }

  authoredSpeed(name: string): number | undefined {
    return this.byName.get(name)?.getClip().userData.speed as number | undefined;
  }

  /** The clip a request shows most (the gait's dominant clip). */
  dominant(req: AnimRequest): string {
    if (!req.gait || !this.gait) return req.name;
    const shares = this.gaitShares(req.gait, this.gait.tiptoe);
    let best = 0;
    for (let i = 1; i < shares.length; i++) if (shares[i]! > shares[best]!) best = i;
    return this.gait.layer.actions[best]!.getClip().name;
  }

  /** Tooling: every clip contributing to the pose, with its share of the blend, time (s) and rate. */
  mix(): { name: string; weight: number; time: number; rate: number }[] {
    const active = [...this.byName.values()].filter((a) => a.isScheduled() && a.getEffectiveWeight() > 0.001);
    const total = Math.max(1, active.reduce((sum, a) => sum + a.getEffectiveWeight(), 0));
    return active.map((a) => ({ name: a.getClip().name, weight: a.getEffectiveWeight() / total, time: a.time, rate: a.getEffectiveTimeScale() }));
  }

  /** Switch to (or keep playing) what `req` asks for, fading over `fade` seconds. */
  play(req: AnimRequest, fade: number): void {
    const gait = req.gait && this.gait ? this.gait : null;
    const next = gait ? gait.layer : this.layers.get(req.name);
    if (!next) return;
    const once = !gait && (req.once ?? false);
    if (gait) gait.request = req.gait!;
    else next.actions[0]!.timeScale = req.speed ?? 1;
    if (next === this.current) return;
    const prev = this.current;
    for (const l of this.layers.values()) {
      if (l === next || !l.active) continue;
      if (fade > 0 && l.weight > 0.001) l.fade = { from: l.weight, to: 0, t: 0, duration: fade };
      else this.stop(l);
    }
    // A loop that is still fading out keeps its time (no restart); anything else starts over.
    // (a one-shot re-entered mid fade-out restarts its time but keeps its weight: dropping
    // the weight instead would leave the total under 1, which three fills with the bind pose)
    const w0 = next.active ? next.weight : 0;
    if (once || w0 <= 0.001) {
      for (const a of next.actions) a.reset();
      // Locomotion → locomotion: start in step with the outgoing stride, so the planted foot
      // stays the planted foot. From standing, start with a foot planted under the body.
      const prevPhase = prev ? this.phaseOf(prev) : null;
      if (gait) gait.phase = prevPhase ?? this.startPhase(req.gait!);
      else if (!once && prevPhase !== null && this.isStride(next.actions[0]!)) next.actions[0]!.time = prevPhase * next.actions[0]!.getClip().duration;
    }
    for (const a of next.actions) {
      a.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
      a.clampWhenFinished = once;
      a.enabled = true;
      a.play();
    }
    next.active = true;
    if (fade > 0 && w0 < 1) {
      next.weight = w0;
      next.fade = { from: w0, to: 1, t: 0, duration: fade * (1 - w0) };
    } else {
      next.fade = null;
      next.weight = 1;
    }
    this.current = next;
  }

  /** Advance fades, the gait and the mixer, then the procedural passes. */
  update(dt: number, procedural?: ProceduralInput): void {
    for (const l of this.layers.values()) {
      const f = l.fade;
      if (!f) continue;
      f.t += dt;
      const u = f.duration > 0 ? Math.min(1, f.t / f.duration) : 1;
      // eased: joints start and stop moving gently instead of jumping to the blend's speed
      l.weight = f.from + (f.to - f.from) * u * u * (3 - 2 * u);
      if (u < 1) continue;
      l.fade = null;
      if (f.to === 0) this.stop(l);
    }
    this.stepGait(dt);
    for (const l of this.layers.values()) {
      if (!l.active) continue;
      for (const [i, a] of l.actions.entries()) a.setEffectiveWeight(l.weight * l.shares[i]!);
    }
    for (const t of this.touched) {
      t.o.position.copy(t.p);
      t.o.quaternion.copy(t.q);
      t.o.scale.copy(t.s);
    }
    this.mixer.update(dt);
    this.rotationBlend.apply();
    for (const t of this.touched) {
      t.p.copy(t.o.position);
      t.q.copy(t.o.quaternion);
      t.s.copy(t.o.scale);
    }
    if (procedural) {
      this.feet?.capture(); // where the clips put the feet, before the layers move the body
      this.pose?.apply(dt, procedural);
      procedural.feet.swing = typeof process !== "undefined" && process.env.NOSWING ? null : this.swingOf();
      this.feet?.apply(dt, procedural.feet);
    }
  }

  /** Gait shares and phase: weights from the speed, rates matched to each clip's own speed. */
  private stepGait(dt: number): void {
    const g = this.gait;
    if (!g || !g.layer.active) return;
    const req = g.request;
    // the tiptoe share follows the stick smoothly (no one-frame flashes)
    g.tiptoe += (req.tiptoe - g.tiptoe) * (1 - Math.exp(-12 * dt));
    const shares = this.gaitShares(req, g.tiptoe);
    let stride = 0;
    for (let i = 0; i < 3; i++) {
      g.layer.shares[i] = shares[i]!;
      stride += shares[i]! * g.stride[i]!;
    }
    const rate = stride > 1e-6 ? Math.abs(req.speed) / stride : 0; // cycles per second
    for (const a of g.layer.actions) {
      const d = a.getClip().duration;
      a.time = g.phase * d;
      a.timeScale = rate * d;
    }
    g.phase = (g.phase + rate * dt) % 1;
  }

  /**
   * Which foot the gait swings and where it will land (foot placement blends a swinging
   * foot from the ground it left to the ground it lands on); null when no gait leads.
   */
  private swingOf(): { R: SwingInfo | null; L: SwingInfo | null } | null {
    const g = this.gait;
    if (!g || !g.layer.active || g.layer.weight < 0.5 || g.layer.fade?.to === 0) return null;
    const shares = g.layer.shares;
    let stride = 0;
    let stance = 0;
    let reach = 0;
    for (let i = 0; i < 3; i++) {
      stride += shares[i]! * g.stride[i]!;
      stance += shares[i]! * g.stance[i]!;
      reach += shares[i]! * g.reach[i]!;
    }
    const speed = Math.abs(g.request.speed);
    const rate = stride > 1e-6 ? speed / stride : 0;
    if (rate <= 1e-3 || stance >= 0.999) return null;
    const out = this.swing;
    for (const side of ['R', 'L'] as const) {
      // the right heel strikes at phase 0, the left at 0.5
      const u = (g.phase + (side === 'L' ? 0.5 : 0)) % 1;
      if (u < stance) {
        out[side] = null;
        continue;
      }
      const s = side === 'R' ? this.swingR : this.swingL;
      s.progress = (u - stance) / (1 - stance);
      // the body moves on until touchdown, where the foot lands half a stance ahead of it
      s.land = (speed * (1 - u)) / rate + reach + (stride * stance) / 2;
      out[side] = s;
    }
    return out;
  }

  private readonly swing: { R: SwingInfo | null; L: SwingInfo | null } = { R: null, L: null };
  private readonly swingR: SwingInfo = { progress: 0, land: 0 };
  private readonly swingL: SwingInfo = { progress: 0, land: 0 };

  private gaitShares(req: GaitRequest, tiptoe: number): [number, number, number] {
    const g = this.gait!;
    const vt = g.speed[0]!;
    const v = Math.abs(req.speed);
    const run = smoothstep(v, g.band[0], g.band[1]);
    // tiptoeing fades out well above its own speed (momentum from a run, say)
    const t = tiptoe * (1 - smoothstep(v, vt * 1.4, vt * 2.2));
    return [t, (1 - t) * (1 - run), (1 - t) * run];
  }

  /** Normalised phase of a layer, if it is a stride (a gait clip with an authored speed). */
  private phaseOf(l: Layer): number | null {
    if (l.key === GAIT) return this.gait!.phase;
    const a = l.actions[0]!;
    return this.isStride(a) ? a.time / a.getClip().duration : null;
  }

  private isStride(a: AnimationAction): boolean {
    return a.getClip().userData.speed !== undefined;
  }

  /**
   * Starting the gait from another clip (standing, landing): the foot that is further forward
   * now is the planted one, at the point of its stance where the gait has it that far
   * forward (mid-stance from standing, heel strike landing with a leg out front), and the
   * other one takes the next step.
   */
  private startPhase(req: GaitRequest): number {
    const g = this.gait!;
    const shares = this.gaitShares(req, g.tiptoe);
    let main = 0;
    for (let i = 1; i < 3; i++) if (shares[i]! > shares[main]!) main = i;
    const stance = g.stance[main]!;
    const reach = (g.stride[main]! * stance) / 2; // a planted foot goes from +reach to −reach
    const r = this.model.getObjectByName(this.footNames[0]);
    const l = this.model.getObjectByName(this.footNames[1]);
    let z = 0;
    let rightAhead = true;
    if (r && l) {
      this.model.updateMatrixWorld(true);
      const zr = this.model.worldToLocal(r.getWorldPosition(V0)).z;
      const zl = this.model.worldToLocal(l.getWorldPosition(V0)).z;
      rightAhead = zr >= zl;
      z = Math.max(zr, zl);
    }
    const u = Math.min(1, Math.max(0, (reach - z) / (2 * reach)));
    return (stance * Math.min(u, 0.5) + (rightAhead ? 0 : 0.5)) % 1;
  }

  private stop(l: Layer): void {
    l.fade = null;
    l.weight = 0;
    l.active = false;
    for (const a of l.actions) {
      a.setEffectiveWeight(0);
      a.stop();
    }
  }
}

function hasJoints(model: Object3D, rig: RigSpec): boolean {
  return !!model.getObjectByName(rig.root) && (!rig.legs || ['R', 'L'].every((s) => !!model.getObjectByName(rig.legs![s as 'R' | 'L'].foot)));
}

function smoothstep(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const V0 = new Vector3();
