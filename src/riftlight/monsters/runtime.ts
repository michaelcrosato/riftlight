import {
  type AnimationAction,
  AnimationMixer,
  Euler,
  LoopOnce,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { solveLeg, type LegSolverHost, type PoseMap } from './anim/ik';
import { cachedGeometry, unitSphere } from './geometry';
import type { BuiltMonster, LegDef } from './types';

/**
 * A monster at runtime: plays its clips (cross-fades, locomotion speed matching) and adds
 * the live layers on top of the mixer every frame:
 *
 * - **look-at**: head and neck turn towards a target (clamped, smoothed);
 * - **hit flinch**: a decaying recoil away from the hit direction, additive to any clip;
 * - **foot placement** (optional): legs re-solved so soles meet uneven ground, body lowered
 *   to the lowest foot;
 * - **wind-up glow**: an unlit bloom on the attacking end (head or weapon hand);
 * - **events**: `hit` when an attack clip crosses its hit frame (sync damage to it), `end`
 *   when a one-shot clip finishes.
 */
export interface RuntimeEvent {
  readonly type: 'hit' | 'end';
  readonly clip: string;
}

export interface UpdateContext {
  /** Look at this world point (null = look ahead). */
  lookAt?: Vector3 | null;
  /** Ground height at a world (x, z) for foot placement. */
  ground?: (x: number, z: number) => number;
}

const _m = new Matrix4();
const _v = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

export class MonsterRuntime {
  readonly mixer: AnimationMixer;
  readonly object: Object3D;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  private currentName = '';
  private prevTime = 0;
  private flinchV = 0;
  private flinchX = 0;
  private flinchDir = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private glow = 0;
  private glowMesh: Mesh | null = null;
  private readonly joints = new Map<string, Object3D>();
  /** Clip playing now. */
  get clip(): string {
    return this.currentName;
  }

  constructor(readonly monster: BuiltMonster) {
    this.object = monster.object;
    this.mixer = new AnimationMixer(this.object);
    for (const j of monster.rig.joints) this.joints.set(j, this.object.getObjectByName(j)!);
    this.play('Idle', { fade: 0 });
  }

  has(name: string): boolean {
    return this.monster.clipNames.includes(name);
  }

  /** The mixer action for a clip (compiling the clip on first use). */
  action(name: string): AnimationAction | null {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.monster.clip(name);
      if (!clip) return null;
      this.actions.set(name, (a = this.mixer.clipAction(clip)));
    }
    return a;
  }

  /** Cross-fade to a clip. One-shot clips (attacks, hit, death, spawn) hold their last frame. */
  play(name: string, o: { fade?: number; rate?: number; restart?: boolean } = {}): AnimationAction | null {
    const next = this.action(name);
    if (!next) return null;
    const meta = this.monster.clipInfo(name);
    if (next === this.current && !o.restart) {
      if (o.rate !== undefined) next.timeScale = o.rate;
      return next;
    }
    next.reset();
    next.setLoop(meta?.loop ? LoopRepeat : LoopOnce, Infinity);
    next.clampWhenFinished = !meta?.loop;
    next.timeScale = o.rate ?? 1;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    const fade = o.fade ?? 0.12;
    if (this.current && fade > 0) next.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    this.current = next;
    this.currentName = name;
    this.prevTime = 0;
    return next;
  }

  /**
   * Locomotion by world ground speed (m/s): Idle, Walk or Run with playback rate matched
   * to the clip's authored speed (feet stay planted at any speed).
   */
  locomote(speed: number): void {
    const s = this.monster.genome.scale;
    if (speed < 0.05) return void this.play('Idle', { fade: 0.2 });
    const walk = (this.monster.clipInfo('Walk')?.speed ?? 1) * s;
    const run = (this.monster.clipInfo('Run')?.speed ?? walk * 2) * s;
    const useRun = speed > (walk + run) / 2 && this.has('Run');
    const clip = useRun ? 'Run' : 'Walk';
    const base = useRun ? run : walk;
    // up to 3.2× before the feet slide: small bodies chasing at pack speed stay planted
    this.play(clip, { fade: 0.2, rate: Math.min(3.2, Math.max(0.35, speed / base)) });
  }

  /** Recoil from a hit coming from world direction `from` (towards the monster). */
  flinch(from: Vector3 | null = null, amount = 1): void {
    this.flinchV += 140 * amount;
    if (from) {
      const local = _v.copy(from).applyQuaternion(_q.copy(this.object.quaternion).invert());
      this.flinchDir = Math.atan2(local.x, local.z);
    }
  }

  /** Wind-up glow 0..1 (shown on the head or weapon hand). */
  setGlow(t: number): void {
    this.glow = Math.min(1, Math.max(0, t));
  }

  update(dt: number, ctx: UpdateContext = {}): RuntimeEvent[] {
    const events: RuntimeEvent[] = [];
    this.mixer.update(dt);
    const act = this.current;
    if (act) {
      const meta = this.monster.clipInfo(this.currentName);
      const t = act.time;
      if (meta?.hitTime !== null && meta?.hitTime !== undefined && this.prevTime < meta.hitTime && t >= meta.hitTime) events.push({ type: 'hit', clip: this.currentName });
      if (meta && !meta.loop && t >= act.getClip().duration - 1e-4 && this.prevTime < act.getClip().duration - 1e-4) events.push({ type: 'end', clip: this.currentName });
      this.prevTime = t;
    }
    this.lookLayer(dt, ctx.lookAt ?? null);
    this.flinchLayer(dt);
    if (ctx.ground) this.footLayer(ctx.ground);
    this.glowLayer();
    return events;
  }

  private lookLayer(dt: number, target: Vector3 | null): void {
    const sk = this.monster.skeleton;
    const head = sk.roles.head ? this.joints.get(sk.roles.head) : null;
    let yaw = 0;
    let pitch = 0;
    if (head && target && this.monster.clipInfo(this.currentName)?.kind !== 'death') {
      this.object.updateMatrixWorld(true);
      const local = _v.copy(target).applyMatrix4(_m.copy(this.object.matrixWorld).invert());
      const from = head.getWorldPosition(new Vector3()).applyMatrix4(_m);
      const d = local.sub(from);
      yaw = Math.max(-1, Math.min(1, Math.atan2(d.x, d.z)));
      pitch = Math.max(-0.5, Math.min(0.5, -Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.5));
    }
    const k = 1 - Math.exp(-dt * 6);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
    if (!head) return;
    const chain = [...sk.roles.neck, sk.roles.head!].map((n) => this.joints.get(n)!);
    for (const j of chain) {
      j.quaternion.multiply(_q.setFromAxisAngle(Y, this.lookYaw / chain.length));
      j.quaternion.multiply(_q.setFromAxisAngle(X, this.lookPitch / chain.length));
    }
  }

  private flinchLayer(dt: number): void {
    // critically damped-ish spring: velocity kicks, position decays back to 0
    this.flinchX += this.flinchV * dt;
    this.flinchV += (-120 * this.flinchX - 16 * this.flinchV) * dt;
    if (Math.abs(this.flinchX) < 0.01 && Math.abs(this.flinchV) < 0.1) return;
    const sk = this.monster.skeleton;
    const deg = (this.flinchX * Math.PI) / 180;
    const target = this.joints.get(sk.roles.chest ?? sk.roles.spine[0] ?? sk.roles.mass ?? sk.roles.head ?? sk.roles.root)!;
    // recoil away from the hit: pitch back for a frontal hit, roll for a side hit
    target.quaternion.multiply(_q.setFromAxisAngle(X, -deg * Math.cos(this.flinchDir)));
    target.quaternion.multiply(_q.setFromAxisAngle(new Vector3(0, 0, 1), deg * Math.sin(this.flinchDir)));
  }

  private footLayer(ground: (x: number, z: number) => number): void {
    const legs = this.monster.skeleton.legs;
    if (!legs.length) return;
    const obj = this.object;
    obj.updateMatrixWorld(true);
    const base = ground(obj.position.x, obj.position.z);
    const s = this.monster.genome.scale;
    const deltas = legs.map((leg) => {
      const sole = this.solePosition(leg);
      return (ground(sole.x, sole.z) - base) / s;
    });
    const lowest = Math.min(0, ...deltas);
    if (deltas.every((d) => Math.abs(d) < 0.01)) return;
    const root = this.joints.get(this.monster.skeleton.roles.root)!;
    root.position.y += lowest;
    obj.updateMatrixWorld(true);
    const host = this.host();
    const pose: PoseMap = {};
    legs.forEach((leg, i) => {
      const target = this.solePosition(leg);
      if (target.y > 0.03) return; // swinging foot: leave it
      target.y = deltas[i]!;
      solveLeg(host, leg, target, pose);
    });
    for (const [name, p] of Object.entries(pose)) {
      const j = this.joints.get(name)!;
      j.quaternion.setFromEuler(_e.set((p.r[0] * Math.PI) / 180, (p.r[1] * Math.PI) / 180, (p.r[2] * Math.PI) / 180, 'XYZ')).premultiply(this.monster.rest.quaternion[name]!);
    }
  }

  /** Model-space position of a sole bottom. */
  private solePosition(leg: LegDef): Vector3 {
    const foot = this.joints.get(leg.foot)!;
    const inv = _m.copy(this.object.matrixWorld).invert();
    return new Vector3(0, -leg.ankle, 0).applyMatrix4(foot.matrixWorld).applyMatrix4(inv);
  }

  private host(): LegSolverHost {
    const inv = new Matrix4().copy(this.object.matrixWorld).invert();
    return {
      world: (name) => new Matrix4().multiplyMatrices(inv, this.joints.get(name)!.matrixWorld),
      restRotation: (name) => this.monster.rest.quaternion[name] ?? new Quaternion(),
      invalidate: () => this.object.updateMatrixWorld(true),
    };
  }

  private glowLayer(): void {
    if (this.glow <= 0.01) {
      if (this.glowMesh) this.glowMesh.visible = false;
      return;
    }
    if (!this.glowMesh) {
      const sk = this.monster.skeleton;
      const at = this.joints.get(sk.arms.find((a) => a.side === 'R')?.hand ?? sk.roles.jaw ?? sk.roles.head ?? sk.roles.root)!;
      this.glowMesh = new Mesh(cachedGeometry('u:sphere', unitSphere), windupMaterial(this.monster.genome.palette.glow));
      this.glowMesh.name = 'WindupGlow';
      this.glowMesh.renderOrder = 5;
      at.add(this.glowMesh);
    }
    this.glowMesh.visible = true;
    this.glowMesh.scale.setScalar(0.12 + 0.3 * this.glow * Math.min(1, this.monster.skeleton.radius));
  }

  /** Stop playback and free per-monster resources (geometry and toon materials are shared). */
  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
    this.glowMesh?.removeFromParent(); // its material is shared (windupMaterial)
  }
}


/**
 * The wind-up glow's unlit material, one per colour and shared by every monster (palettes are
 * quantised, so this stays a small set): a fresh material per monster would build a new
 * shader mid-fight, the first time each one winds up.
 */
const windupMaterials = new Map<number, MeshBasicNodeMaterial>();
export function windupMaterial(hex: number): MeshBasicNodeMaterial {
  let m = windupMaterials.get(hex);
  if (!m) {
    m = new MeshBasicNodeMaterial({ color: hex, transparent: true, opacity: 0.55, depthWrite: false });
    m.name = `windup-${hex.toString(16)}`;
    m.userData.shared = true;
    windupMaterials.set(hex, m);
  }
  return m;
}
