import { type AnimationAction, AnimationClip, AnimationMixer, type Object3D } from 'three/webgpu';

/** Joints of the lower body (legs and the root): the rest is the upper body. */
const LOWER = new Set(['Pelvis', 'LegR', 'ShinR', 'FootR', 'LegL', 'ShinL', 'FootL']);

export type BodyPart = 'full' | 'upper' | 'lower';

/** One pose source: a full-body clip, or legs from one clip and the upper body from another. */
export interface PoseSource {
  readonly full?: string;
  readonly lower?: string;
  readonly upper?: string;
}

interface Slot {
  key: string;
  parts: { action: AnimationAction; clip: string }[];
  weight: number;
}

/** A clip with only the tracks of one body part. */
export function partClip(clip: AnimationClip, part: Exclude<BodyPart, 'full'>): AnimationClip {
  const keep = (t: { name: string }) => LOWER.has(t.name.split('.')[0]!) === (part === 'lower');
  const c = new AnimationClip(`${clip.name}:${part}`, clip.duration, clip.tracks.filter(keep).map((t) => t.clone()));
  c.userData = { ...clip.userData };
  return c;
}

/**
 * The hero's animation blending, driven entirely by the controller's clocks (no mixer time):
 * hit-stop freezes the pose exactly, attack clips play at the rate attack speed asks for, and
 * films are frame-exact. Pose sources fade as slots whose weights always sum to 1, so every
 * joint is fully posed during a blend. A source can split the body: legs keep running while
 * the arms cast (casting while moving is slowed, not locked).
 */
export class HeroAnimator {
  readonly mixer: AnimationMixer;
  private readonly clips = new Map<string, AnimationClip>();
  private readonly actions = new Map<string, AnimationAction>();
  private readonly clocks = new Map<string, number>();
  private slots: Slot[] = [];
  private target: Slot | null = null;
  private fade = 0.1;

  constructor(readonly model: Object3D, clips: readonly AnimationClip[]) {
    this.mixer = new AnimationMixer(model);
    for (const c of clips) this.clips.set(c.name, c);
  }

  has(name: string): boolean {
    return this.clips.has(name);
  }

  /** Clip length in seconds (at rate 1). */
  duration(name: string): number {
    return this.clips.get(name)?.duration ?? 0;
  }

  /** Whether a clip loops. */
  isLoop(name: string): boolean {
    const c = this.clips.get(name);
    return !!c && isLoop(c);
  }

  /** Ground speed a locomotion clip is authored for. */
  speedOf(name: string): number {
    return (this.clips.get(name)?.userData.speed as number | undefined) ?? 0;
  }

  private action(name: string, part: BodyPart): AnimationAction {
    const key = part === 'full' ? name : `${name}:${part}`;
    let a = this.actions.get(key);
    if (!a) {
      const clip = this.clips.get(name);
      if (!clip) throw new Error(`HeroAnimator: no clip "${name}"`);
      a = this.mixer.clipAction(part === 'full' ? clip : partClip(clip, part));
      a.play();
      a.setEffectiveWeight(0);
      this.actions.set(key, a);
    }
    return a;
  }

  /** Set a clip's clock (seconds of clip time). Locomotion clocks wrap, action clocks clamp. */
  setTime(name: string, t: number): void {
    this.clocks.set(name, t);
  }

  time(name: string): number {
    return this.clocks.get(name) ?? 0;
  }

  /** Advance a looping clip's clock by `dt` × `rate`. */
  advance(name: string, dt: number, rate = 1): void {
    this.clocks.set(name, (this.clocks.get(name) ?? 0) + dt * rate);
  }

  /** Blend to `source` over `fade` seconds (re-asking for the current source is free). */
  play(source: PoseSource, fade = 0.1): void {
    const key = `${source.full ?? ''}|${source.lower ?? ''}|${source.upper ?? ''}`;
    if (this.target?.key === key) return;
    let slot = this.slots.find((s) => s.key === key);
    if (!slot) {
      const parts: Slot['parts'] = [];
      if (source.full) parts.push({ action: this.action(source.full, 'full'), clip: source.full });
      if (source.lower) parts.push({ action: this.action(source.lower, 'lower'), clip: source.lower });
      if (source.upper) parts.push({ action: this.action(source.upper, 'upper'), clip: source.upper });
      slot = { key, parts, weight: this.slots.length ? 0 : 1 };
      this.slots.push(slot);
    }
    this.target = slot;
    this.fade = Math.max(0, fade);
  }

  /** Snap to the target with no blend (teleports, respawn). */
  snap(): void {
    if (!this.target) return;
    for (const s of this.slots) s.weight = s === this.target ? 1 : 0;
  }

  /** Blend weights by `dt`, then pose the model at every clock. `dt` = 0 re-poses only. */
  update(dt: number): void {
    const t = this.target;
    if (t) {
      const step = this.fade > 0 ? dt / this.fade : 1;
      const before = t.weight;
      t.weight = Math.min(1, t.weight + step);
      const othersBefore = 1 - before;
      const othersAfter = 1 - t.weight;
      for (const s of this.slots) if (s !== t) s.weight = othersBefore > 1e-6 ? (s.weight * othersAfter) / othersBefore : 0;
      this.slots = this.slots.filter((s) => s === t || s.weight > 1e-3);
    }
    const used = new Set<AnimationAction>();
    for (const s of this.slots) {
      for (const p of s.parts) {
        const clip = this.clips.get(p.clip)!;
        let time = this.clocks.get(p.clip) ?? 0;
        // loops wrap; one-shots hold their last frame
        time = isLoop(clip) ? ((time % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(0, time), clip.duration - 1e-4);
        p.action.time = time;
        p.action.setEffectiveWeight(s.weight);
        used.add(p.action);
      }
    }
    for (const a of this.actions.values()) if (!used.has(a)) a.setEffectiveWeight(0);
    this.mixer.update(0);
  }

  /** What contributes to the pose now (film / tooling, like PlatformerCharacter.animationMix). */
  mix(): { name: string; weight: number; time: number; rate: number }[] {
    const out: { name: string; weight: number; time: number; rate: number }[] = [];
    for (const s of this.slots) for (const p of s.parts) out.push({ name: p.clip, weight: s.weight, time: p.action.time, rate: 1 });
    return out.sort((a, b) => b.weight - a.weight);
  }

  /** The dominant clip. */
  get current(): string {
    let best: Slot | null = null;
    for (const s of this.slots) if (!best || s.weight > best.weight) best = s;
    // a split pose reports what the arms are doing (the action), not the legs
    const parts = best?.parts ?? [];
    return (parts.length > 1 ? parts[parts.length - 1] : parts[0])?.clip ?? 'Idle';
  }
}

/** Loop clips are marked when compiled from a `loop: true` ClipDef (see HeroController). */
export function isLoop(clip: AnimationClip): boolean {
  return clip.userData.loop === true;
}
