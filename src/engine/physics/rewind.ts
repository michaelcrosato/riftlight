/**
 * Time rewind (Braid, Prince of Persia: The Sands of Time): every physics step records where
 * each tracked body is, how it moves and whether it sleeps, in a ring buffer a few seconds
 * long; while rewinding, each step instead takes the newest record off and puts every body back
 * there, so the world plays backwards. Let go and the bodies carry on with the velocities they
 * had at that moment. Extra state (the hero's position, a score) rides along through `extra`.
 *
 *   const rewind = new Rewind(physics, { seconds: 6 });
 *   rewind.track(body);                                   // or rewind.trackAll() for every dynamic body
 *   rewind.extra(() => hero.feetInto(feet).toArray(), (v) => hero.teleport([v[0]!, v[1]!, v[2]!]));
 *   rewind.rewinding = input.isDown('KeyR');              // per fixed step (or frame)
 *   // rewind.fill (0..1): how much history is left
 *
 * Putting bodies back runs ahead of every other step listener (`onStep(f, { first: true })`),
 * so instanced bodies, ragdolls and bound meshes all see the rewound pose. A body removed while
 * recorded is skipped from then on, on the way back too.
 */
import type RAPIER_TYPE from '@dimforge/rapier3d';
import type { Physics } from './Physics';

export interface RewindOptions {
  /** History length in seconds of physics (default 5). */
  seconds?: number;
}

/** Floats per body per step: position, rotation (quaternion), linear and angular velocity, asleep (1/0). */
const STRIDE = 14;

export class Rewind {
  /** Steps of history kept. */
  readonly capacity: number;
  /** True: each physics step goes one step back instead of recording. */
  rewinding = false;
  /** Steps recorded now (rewinding uses them up). */
  length = 0;
  private bodies: RAPIER_TYPE.RigidBody[] = [];
  private frames: Float32Array[] = [];
  private head = 0;
  private extras: { get: () => readonly number[]; set: (v: number[]) => void; buffer: number[][] }[] = [];
  /** Put back asleep last step: Rapier wakes a body it was told to move, so they sleep a step later. */
  private drowsy: RAPIER_TYPE.RigidBody[] = [];
  private readonly off: (() => void)[];

  constructor(
    private readonly physics: Physics,
    o: RewindOptions = {},
  ) {
    this.capacity = Math.max(1, Math.round((o.seconds ?? 5) * 60));
    // going back runs first, so every other listener and binding sees where the bodies were put
    this.off = [
      physics.onStep(
        () => {
          this.settle();
          if (this.rewinding) this.back();
        },
        { first: true },
      ),
      physics.onStep(() => this.rewinding || this.record()),
    ];
  }

  /** How much history there is, 0..1. */
  get fill(): number {
    return this.length / this.capacity;
  }

  /** Record `body` from now on (the history so far is dropped: every frame holds the same bodies). */
  track(...bodies: RAPIER_TYPE.RigidBody[]): void {
    for (const b of bodies) if (!this.bodies.includes(b)) this.bodies.push(b);
    this.reset();
  }

  /** Record every dynamic body in the world now. */
  trackAll(): void {
    const all: RAPIER_TYPE.RigidBody[] = [];
    this.physics.world.bodies.forEach((b) => {
      if (b.isDynamic()) all.push(b);
    });
    this.track(...all);
  }

  /** Something else to rewind: `get` returns numbers to keep each step, `set` puts them back. */
  extra(get: () => readonly number[], set: (v: number[]) => void): void {
    this.extras.push({ get, set, buffer: [] });
    this.reset();
  }

  /** Forget the history. */
  reset(): void {
    this.frames = Array.from({ length: this.capacity }, () => new Float32Array(this.bodies.length * STRIDE));
    for (const e of this.extras) e.buffer = Array.from({ length: this.capacity }, () => []);
    this.head = 0;
    this.length = 0;
  }

  dispose(): void {
    for (const off of this.off) off();
    this.bodies = [];
    this.frames = [];
    this.extras = [];
    this.drowsy = [];
  }

  private record(): void {
    const f = this.frames[this.head];
    if (!f) return;
    this.bodies.forEach((b, i) => {
      // isValid, not a handle lookup: a removed body's slot can hold a newer body
      if (!b.isValid()) return;
      const t = b.translation();
      const r = b.rotation();
      const v = b.linvel();
      const w = b.angvel();
      f.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z, b.isSleeping() ? 1 : 0], i * STRIDE);
    });
    for (const e of this.extras) e.buffer[this.head] = [...e.get()];
    this.head = (this.head + 1) % this.capacity;
    this.length = Math.min(this.capacity, this.length + 1);
  }

  /**
   * Rapier wakes a body it was told to move during the next step, whatever `sleep()` said, so
   * one put back asleep is put to sleep again after that step (it has fallen one step's worth,
   * a few millimetres, from rest: on a slope, that is all it moves).
   */
  private settle(): void {
    if (this.drowsy.length === 0) return;
    // one step of falling from rest is gravity × the step; faster than half again that,
    // something hit it, and it carries on
    const g = this.physics.world.gravity;
    const fall = Math.hypot(g.x, g.y, g.z) * this.physics.world.timestep * 1.5;
    for (const b of this.drowsy) {
      if (!b.isValid() || b.isSleeping()) continue;
      const v = b.linvel();
      if (Math.hypot(v.x, v.y, v.z) > fall) continue;
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.sleep();
    }
    this.drowsy.length = 0;
  }

  private back(): void {
    // the newest record is the moment just shown: drop it and show the one before; at the
    // oldest one, hold there
    if (this.length === 0) return;
    if (this.length > 1) {
      this.head = (this.head - 1 + this.capacity) % this.capacity;
      this.length--;
    }
    const at = (this.head - 1 + this.capacity) % this.capacity;
    const f = this.frames[at]!;
    this.bodies.forEach((b, i) => {
      if (!b.isValid()) return;
      const k = i * STRIDE;
      b.setTranslation({ x: f[k]!, y: f[k + 1]!, z: f[k + 2]! }, true);
      b.setRotation({ x: f[k + 3]!, y: f[k + 4]!, z: f[k + 5]!, w: f[k + 6]! }, true);
      b.setLinvel({ x: f[k + 7]!, y: f[k + 8]!, z: f[k + 9]! }, true);
      b.setAngvel({ x: f[k + 10]!, y: f[k + 11]!, z: f[k + 12]! }, true);
      // asleep then, asleep now: a ball that had not been pushed yet stays put when you let go
      if (f[k + 13]) {
        b.sleep();
        this.drowsy.push(b);
      }
    });
    for (const e of this.extras) {
      const v = e.buffer[at];
      if (v && v.length) e.set(v);
    }
  }
}
