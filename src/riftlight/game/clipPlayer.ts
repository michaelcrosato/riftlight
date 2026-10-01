/**
 * A small AnimationMixer wrapper for characters that play compiled ClipDefs without the
 * platformer state machine (townsfolk, the stub hero): `play(name)` cross-fades from
 * whatever is playing, one-shots clamp on their last frame, and `crossed(frame)` tells
 * when the clip passed an authored frame this update (hammer impacts, coin clinks).
 */
import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type Object3D } from 'three/webgpu';

export interface PlayOptions {
  /** Cross-fade seconds (default 0.18). */
  fade?: number;
  /** Play once and hold the last frame (default: loop). */
  once?: boolean;
  /** Playback rate (default 1). */
  rate?: number;
  /** Start from frame 0 even if already playing. */
  restart?: boolean;
}

export class ClipPlayer {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  name = '';
  private prevTime = 0;
  private wrapped = false;

  constructor(root: Object3D, clips: readonly AnimationClip[]) {
    this.mixer = new AnimationMixer(root);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  play(name: string, o: PlayOptions = {}): void {
    const next = this.actions.get(name);
    if (!next) return;
    const fade = o.fade ?? 0.18;
    if (next === this.current && !o.restart) {
      if (o.rate !== undefined) next.timeScale = o.rate;
      return;
    }
    next.reset();
    next.setLoop(o.once ? LoopOnce : LoopRepeat, Infinity);
    next.clampWhenFinished = !!o.once;
    next.timeScale = o.rate ?? 1;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next && fade > 0) {
      next.play();
      this.current.crossFadeTo(next, fade, false);
    } else {
      if (this.current && this.current !== next) this.current.stop();
      next.play();
    }
    this.current = next;
    this.name = name;
    this.prevTime = 0;
    this.wrapped = false;
  }

  setRate(rate: number): void {
    if (this.current) this.current.timeScale = rate;
  }

  update(dt: number): void {
    const before = this.current?.time ?? 0;
    this.mixer.update(dt);
    const after = this.current?.time ?? 0;
    this.prevTime = before;
    this.wrapped = after < before;
  }

  /** Seconds into the current clip. */
  get time(): number {
    return this.current?.time ?? 0;
  }

  get duration(): number {
    return this.current?.getClip().duration ?? 0;
  }

  /** True when a one-shot reached its end. */
  get finished(): boolean {
    const a = this.current;
    return !!a && a.loop === LoopOnce && a.time >= a.getClip().duration - 1e-3;
  }

  /** Did the current clip pass `frame` (30 fps authoring frames) during the last update? */
  crossed(frame: number, fps = 30): boolean {
    const t = frame / fps;
    const now = this.time;
    if (this.wrapped) return t > this.prevTime || t <= now;
    return t > this.prevTime && t <= now;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
