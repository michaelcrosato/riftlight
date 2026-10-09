/**
 * Tweens: numbers that glide to a value over time, for doors, lifts, pickups, menus and
 * pads. Game time (they pause, slow down and freeze with `engine.timeScale` and hitstops)
 * and cleared when a level unloads. `ctx.tweens`:
 *
 *   ctx.tweens.to(door.position, { y: 3 }, { duration: 0.8, ease: 'outBack' });
 *   const t = ctx.tweens.to(lamp, { intensity: 0 }, { duration: 0.3, yoyo: true, repeat: Infinity });
 *   t.cancel();
 *   if (await ctx.tweens.to(door.position, { y: 0 }, { duration: 0.5 }).done) slam(); // false: cancelled / level gone
 *   ctx.tweens.call(0.5, () => spawn());                            // a timer on game time
 *   ctx.tweens.value(0, 1, { duration: 2, ease: 'steps4' }, (v) => (fog.density = v));
 *
 * Pure (no three.js): `Tweens.update(dt)` is all it needs, so it is unit-tested.
 */

export type EaseName =
  | 'linear'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'
  | 'inSine'
  | 'outSine'
  | 'inOutSine'
  | 'inExpo'
  | 'outExpo'
  | 'inOutExpo'
  | 'inBack'
  | 'outBack'
  | 'inOutBack'
  | 'outElastic'
  | 'outBounce'
  | 'smooth'
  | 'steps2'
  | 'steps4'
  | 'steps8';

export type Ease = EaseName | ((u: number) => number);

const back = 1.70158;

function bounce(u: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
  return n * (u -= 2.625 / d) * u + 0.984375;
}

/** Every named ease: u in 0..1 → progress (back and elastic overshoot past 1). */
export const EASES: Readonly<Record<EaseName, (u: number) => number>> = {
  linear: (u) => u,
  inQuad: (u) => u * u,
  outQuad: (u) => 1 - (1 - u) * (1 - u),
  inOutQuad: (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2),
  inCubic: (u) => u * u * u,
  outCubic: (u) => 1 - (1 - u) ** 3,
  inOutCubic: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  inSine: (u) => 1 - Math.cos((u * Math.PI) / 2),
  outSine: (u) => Math.sin((u * Math.PI) / 2),
  inOutSine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  inExpo: (u) => (u <= 0 ? 0 : 2 ** (10 * u - 10)),
  outExpo: (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u)),
  inOutExpo: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2),
  inBack: (u) => (back + 1) * u * u * u - back * u * u,
  outBack: (u) => 1 + (back + 1) * (u - 1) ** 3 + back * (u - 1) ** 2,
  inOutBack: (u) => {
    const c = back * 1.525;
    return u < 0.5 ? ((2 * u) ** 2 * ((c + 1) * 2 * u - c)) / 2 : ((2 * u - 2) ** 2 * ((c + 1) * (u * 2 - 2) + c) + 2) / 2;
  },
  outElastic: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 2 ** (-10 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: bounce,
  smooth: (u) => u * u * (3 - 2 * u),
  // Stepped: motion "on twos / fours", like sprite animation that holds poses.
  steps2: (u) => (u >= 1 ? 1 : Math.floor(u * 2) / 2),
  steps4: (u) => (u >= 1 ? 1 : Math.floor(u * 4) / 4),
  steps8: (u) => (u >= 1 ? 1 : Math.floor(u * 8) / 8),
};

export const EASE_NAMES = Object.keys(EASES) as EaseName[];

export function ease(e: Ease, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return typeof e === 'function' ? e(t) : EASES[e](t);
}

export interface TweenOptions {
  /** Seconds (game time). Default 0.3. */
  duration?: number;
  /** Seconds before it starts. */
  delay?: number;
  ease?: Ease;
  /** Extra plays after the first (Infinity loops). With `yoyo`, each way counts as one. */
  repeat?: number;
  /** Play back the other way on every repeat. */
  yoyo?: boolean;
  onUpdate?: (progress: number) => void;
  onComplete?: () => void;
}

export interface Tween {
  /**
   * Resolves when it stops: `true` when it played to the end, `false` when it was cancelled,
   * taken over or cleared (the level unloaded: don't carry on with dead objects).
   */
  readonly done: Promise<boolean>;
  readonly active: boolean;
  /** Stop where it is (`finish`: jump to the target values first). */
  cancel(finish?: boolean): void;
}

type Props = Record<string, number>;

interface Running {
  target: Record<string, unknown> | null;
  keys: string[];
  from: number[];
  to: number[];
  apply: ((v: number) => void) | null;
  duration: number;
  delay: number;
  ease: Ease;
  repeat: number;
  yoyo: boolean;
  t: number;
  forward: boolean;
  /** `from` is read when the tween starts (after its delay), not when it is made. */
  started: boolean;
  active: boolean;
  onUpdate?: (p: number) => void;
  onComplete?: () => void;
  resolve: (completed: boolean) => void;
  handle: Tween;
}

/** A set of running tweens (the engine keeps one per game: `ctx.tweens`). */
export class Tweens {
  private items: Running[] = [];

  /** Tweens still running. */
  get count(): number {
    return this.items.length;
  }

  /**
   * Glide `target`'s numeric properties to `to`. A new tween on the same target and
   * property takes over (the old one stops where it is).
   */
  to<T extends object>(target: T, to: Partial<Record<keyof T, number>>, options: TweenOptions = {}): Tween {
    const keys = Object.keys(to).filter((k) => typeof (to as Props)[k] === 'number');
    for (const r of this.items) {
      if (r.target !== target || !r.active || r.keys.length === 0) continue;
      for (let i = r.keys.length - 1; i >= 0; i--) {
        if (!keys.includes(r.keys[i]!)) continue;
        r.keys.splice(i, 1);
        r.to.splice(i, 1);
        if (r.started) r.from.splice(i, 1);
      }
      if (r.keys.length === 0) this.finish(r, false); // nothing left to move
    }
    return this.add({ target: target as Record<string, unknown>, keys, to: keys.map((k) => (to as Props)[k]!), apply: null }, options);
  }

  /** Tween a plain number from `from` to `to`, calling `apply(v)` every frame. */
  value(from: number, to: number, options: TweenOptions, apply: (v: number) => void): Tween {
    return this.add({ target: null, keys: ['v'], to: [to], apply, from: [from] }, options);
  }

  /** Call `fn` after `seconds` of game time. */
  call(seconds: number, fn: () => void): Tween {
    return this.add({ target: null, keys: [], to: [], apply: null }, { duration: 0, delay: seconds, onComplete: fn });
  }

  /** Stop every tween on `target` (or everything). */
  cancel(target?: object): void {
    for (const r of [...this.items]) if (!target || r.target === target) r.handle.cancel();
  }

  /** Stop everything (level unload). Pending `done` promises resolve. */
  clear(): void {
    for (const r of this.items) this.finish(r, false);
    this.items = [];
  }

  update(dt: number): void {
    if (this.items.length === 0) return;
    for (const r of [...this.items]) {
      if (!r.active) continue;
      let step = dt;
      if (r.delay > 0) {
        r.delay -= dt;
        if (r.delay > 0) continue;
        step = -r.delay; // the part of this frame after the delay
        r.delay = 0;
      }
      if (!r.started) this.start(r);
      r.t += step;
      let u = r.duration > 0 ? r.t / r.duration : 1;
      while (u >= 1 && r.repeat > 0) {
        r.repeat--;
        r.t -= r.duration;
        if (r.yoyo) r.forward = !r.forward;
        u = r.duration > 0 ? r.t / r.duration : 1;
        if (r.duration <= 0) break;
      }
      this.write(r, Math.min(1, u));
      if (u >= 1 && r.repeat <= 0) this.finish(r, true);
    }
    this.items = this.items.filter((r) => r.active);
  }

  private add(spec: Pick<Running, 'target' | 'keys' | 'to' | 'apply'> & { from?: number[] }, o: TweenOptions): Tween {
    let resolve!: (completed: boolean) => void;
    const done = new Promise<boolean>((res) => (resolve = res));
    const r: Running = {
      ...spec,
      from: spec.from ?? [],
      duration: Math.max(0, o.duration ?? 0.3),
      delay: Math.max(0, o.delay ?? 0),
      ease: o.ease ?? 'outQuad',
      repeat: Math.max(0, o.repeat ?? 0),
      yoyo: o.yoyo === true,
      t: 0,
      forward: true,
      started: spec.from !== undefined,
      active: true,
      onUpdate: o.onUpdate,
      onComplete: o.onComplete,
      resolve,
      handle: null!,
    };
    r.handle = {
      done,
      get active() {
        return r.active;
      },
      cancel: (finish = false) => {
        if (!r.active) return;
        if (finish) {
          if (!r.started) this.start(r);
          this.write(r, 1, true);
        }
        this.finish(r, false);
      },
    };
    this.items.push(r);
    return r.handle;
  }

  private start(r: Running): void {
    r.started = true;
    if (r.target) r.from = r.keys.map((k) => Number(r.target![k]) || 0);
  }

  private write(r: Running, u: number, forward = r.forward): void {
    const k = ease(r.ease, forward ? u : 1 - u);
    for (let i = 0; i < r.keys.length; i++) {
      const v = r.from[i]! + (r.to[i]! - r.from[i]!) * k;
      if (r.apply) r.apply(v);
      else if (r.target) r.target[r.keys[i]!] = v;
    }
    r.onUpdate?.(u);
  }

  private finish(r: Running, completed: boolean): void {
    if (!r.active) return;
    r.active = false;
    if (completed) r.onComplete?.();
    r.resolve(completed);
  }
}
