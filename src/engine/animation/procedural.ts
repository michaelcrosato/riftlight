/**
 * Procedural motion: things that move because something else moved, computed every frame
 * instead of keyed.
 *
 *   SpringChain   secondary motion: a tail, antennae, a ponytail, a cape strip. Verlet points
 *                 that keep most of their velocity, are pulled back toward their rest
 *                 direction (`stiffness`), sag under gravity and stay their length apart.
 *   Squash        squash and stretch: a spring on one number, drawn as a volume-preserving
 *                 scale (taller is thinner). Kick it on landings, jumps and hits.
 *   LegStepper    planted feet for creatures with any number of legs: a foot stays where it
 *                 is in the world until it is too far from where it should be, then steps
 *                 there in an arc, never lifting at the same time as its neighbours.
 *
 * All pure (no three.js), deterministic, unit-tested; the Animation wing's rooms draw them.
 */

type Vec3 = [number, number, number];

// ------------------------------------------------------------------ spring chains

export interface SpringChainOptions {
  /** Points after the root (≥ 1). */
  segments: number;
  /** Length of each segment (m). */
  length: number;
  /** Rest direction from the root in the root's own space (normalised; default straight back, −Z). */
  rest?: Vec3;
  /** Pull toward the rest pose per second (0 floppy … 30 stiff). Default 10. */
  stiffness?: number;
  /** Velocity kept per 1/60 s (0..1). Default 0.94. */
  keep?: number;
  /** Gravity on the chain (m/s²). Default 6 (lighter than real: tails hold up a bit). */
  gravity?: number;
}

/** Spring chains step at a fixed 120 Hz, so they swing the same at any frame rate. */
const CHAIN_STEP = 1 / 120;

/**
 * A chain of points hanging off a moving root. Call `update(dt, root, basis)` every frame
 * with the root's world position and its orientation (three columns: right, up, forward),
 * then read `points` (root first).
 */
export class SpringChain {
  readonly points: Vec3[];
  private readonly prev: Vec3[];
  o: Required<SpringChainOptions>;
  private started = false;
  /** Time not yet stepped, and where the root was at the last step. */
  private pending = 0;
  private readonly lastRoot: Vec3 = [0, 0, 0];
  private readonly dir: Vec3 = [0, 0, 0];

  constructor(o: SpringChainOptions) {
    this.o = { rest: [0, 0, -1], stiffness: 10, keep: 0.94, gravity: 6, ...o };
    this.points = Array.from({ length: o.segments + 1 }, () => [0, 0, 0] as Vec3);
    this.prev = Array.from({ length: o.segments + 1 }, () => [0, 0, 0] as Vec3);
  }

  /** Put the chain straight out in its rest pose (no swing). */
  reset(root: Vec3, basis: readonly [Vec3, Vec3, Vec3]): void {
    const d = this.restDir(basis);
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i]!;
      const q = this.prev[i]!;
      for (let c = 0; c < 3; c++) q[c] = p[c] = root[c]! + d[c]! * this.o.length * i;
    }
    for (let c = 0; c < 3; c++) this.lastRoot[c] = root[c]!;
    this.pending = 0;
    this.started = true;
  }

  update(dt: number, root: Vec3, basis: readonly [Vec3, Vec3, Vec3]): void {
    if (!this.started) this.reset(root, basis);
    if (dt <= 0) return;
    const o = this.o;
    const keep = Math.pow(o.keep, CHAIN_STEP * 60);
    const pull = 1 - Math.exp(-o.stiffness * CHAIN_STEP);
    const sag = o.gravity * CHAIN_STEP * CHAIN_STEP;
    const d = this.restDir(basis);
    this.pending = Math.min(this.pending + dt, 0.25); // a long hitch doesn't run hundreds of steps
    const n = Math.floor(this.pending / CHAIN_STEP);
    this.pending -= n * CHAIN_STEP;
    const p0 = this.points[0]!;
    for (let s = 1; s <= n; s++) {
      // the root moves evenly from where it was to where it is over this frame's steps
      for (let c = 0; c < 3; c++) p0[c] = this.lastRoot[c]! + (root[c]! - this.lastRoot[c]!) * (s / n);
      for (let i = 1; i < this.points.length; i++) {
        const p = this.points[i]!;
        const q = this.prev[i]!;
        for (let c = 0; c < 3; c++) {
          const v = (p[c]! - q[c]!) * keep;
          q[c] = p[c]!;
          p[c] = p[c]! + v;
        }
        p[1] = p[1]! - sag;
        // toward the rest pose: where this point would be with the chain straight out
        const parent = this.points[i - 1]!;
        for (let c = 0; c < 3; c++) p[c] = p[c]! + (parent[c]! + d[c]! * o.length - p[c]!) * pull;
      }
      this.keepLengths();
    }
    // the root is drawn where it is now; the chain catches up on the next frame with a step
    if (n > 0) for (let c = 0; c < 3; c++) this.lastRoot[c] = root[c]!;
    for (let c = 0; c < 3; c++) p0[c] = root[c]!;
  }

  /** How far the tip is from where the rest pose puts it (m): how much it is swinging. */
  swing(basis: readonly [Vec3, Vec3, Vec3]): number {
    const d = this.restDir(basis);
    const root = this.points[0]!;
    const tip = this.points[this.points.length - 1]!;
    const n = this.points.length - 1;
    return Math.hypot(tip[0] - (root[0] + d[0] * this.o.length * n), tip[1] - (root[1] + d[1] * this.o.length * n), tip[2] - (root[2] + d[2] * this.o.length * n));
  }

  /** Each segment back to its length, from the root out (the root is fixed). */
  private keepLengths(): void {
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1]!;
      const b = this.points[i]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const k = this.o.length / (Math.hypot(dx, dy, dz) || 1e-6);
      b[0] = a[0] + dx * k;
      b[1] = a[1] + dy * k;
      b[2] = a[2] + dz * k;
    }
  }

  /** The rest direction in the world (unit), into a reused array. */
  private restDir(basis: readonly [Vec3, Vec3, Vec3]): Vec3 {
    const [r, u, f] = basis;
    const [x, y, z] = this.o.rest;
    const l = Math.hypot(x, y, z) || 1;
    const d = this.dir;
    for (let c = 0; c < 3; c++) d[c] = (r[c]! * x + u[c]! * y + f[c]! * z) / l;
    return d;
  }
}

// ------------------------------------------------------------------ squash and stretch

/**
 * Squash and stretch as a damped spring on `value` (0 = rest, + stretched, − squashed).
 * `scale()` turns it into a volume-preserving pair: `const [h, v] = squash.scale();
 * mesh.scale.set(h, v, h)`.
 */
export class Squash {
  value = 0;
  velocity = 0;
  /** Spring stiffness and damping (a critically damped spring has damping = 2√stiffness). */
  stiffness = 260;
  damping = 18;
  /** 0 turns it off; 2.5 is rubbery. */
  amount = 1;

  /** Add a kick: negative squashes (a landing), positive stretches (a jump). */
  kick(v: number): void {
    this.velocity += v;
  }

  /** Set the shape directly (a held squash). */
  set(v: number): void {
    this.value = v;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    // semi-implicit Euler in small steps: stable for stiff springs
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.velocity += (-this.stiffness * this.value - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
  }

  /** [horizontal, vertical] scale: y = 1 + s, xz = 1 / √(1 + s), so the volume stays put. */
  scale(out: [number, number] = [1, 1]): [number, number] {
    const s = Math.max(-0.7, this.value * this.amount);
    out[1] = 1 + s;
    out[0] = 1 / Math.sqrt(1 + s);
    return out;
  }
}

// ------------------------------------------------------------------ planted feet

export interface LegDef {
  /** Where the foot rests, in the body's space (x right, z forward; y ignored). */
  rest: readonly [number, number];
  /** Legs that must not be lifting when this one starts a step (its neighbours; mutual, so listing a pair once is enough). */
  partners?: readonly number[];
}

export interface LegStepperOptions {
  legs: readonly LegDef[];
  /** Step when the foot is this far from its target (m). Default 0.3. */
  threshold?: number;
  /** Seconds a step takes. Default 0.18. */
  stepTime?: number;
  /** How high a step lifts the foot (m). Default 0.15. */
  lift?: number;
  /** Aim ahead of the body's motion by this many seconds (feet land where it is going). Default 0.25. */
  lead?: number;
}

export interface Foot {
  /** World position of the foot now. */
  readonly at: Vec3;
  /** Stepping: 0 → 1 through the step; -1 planted. */
  t: number;
  readonly from: Vec3;
  readonly to: Vec3;
}

/**
 * Feet for a body with any number of legs. `update(dt, body, yaw, velocity, ground)`:
 * the body's world position and heading, how fast it moves, and the ground height at a point.
 */
export class LegStepper {
  readonly feet: Foot[];
  o: Required<Omit<LegStepperOptions, 'legs'>> & { legs: readonly LegDef[] };
  /** Steps started (tests). */
  steps = 0;
  private started = false;
  /** Each leg's partners, both ways round (a leg waits for its partners, and they for it). */
  private readonly partners: number[][];
  /** Scratch for `update`: each foot's distance from its target, and the feet by that distance. */
  private readonly behind: Float64Array;
  private readonly order: number[];
  private readonly t: Vec3 = [0, 0, 0];
  private static readonly STILL: Vec3 = [0, 0, 0];

  constructor(o: LegStepperOptions) {
    this.o = { threshold: 0.3, stepTime: 0.18, lift: 0.15, lead: 0.25, ...o };
    this.feet = o.legs.map(() => ({ at: [0, 0, 0] as Vec3, t: -1, from: [0, 0, 0] as Vec3, to: [0, 0, 0] as Vec3 }));
    const sets = o.legs.map(() => new Set<number>());
    o.legs.forEach((l, i) =>
      (l.partners ?? []).forEach((p) => {
        if (p === i || p < 0 || p >= o.legs.length) return;
        sets[i]!.add(p);
        sets[p]!.add(i);
      }),
    );
    this.partners = sets.map((set) => [...set]);
    this.behind = new Float64Array(o.legs.length);
    this.order = o.legs.map((_, i) => i);
  }

  /** Where leg `i` wants to be: its rest spot around the body, ahead by the lead, on the ground. */
  target(i: number, body: Vec3, yaw: number, velocity: Vec3, ground: (x: number, z: number) => number, out: Vec3 = [0, 0, 0]): Vec3 {
    const [rx, rz] = this.o.legs[i]!.rest;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    out[0] = body[0] + rx * c + rz * s + velocity[0] * this.o.lead;
    out[2] = body[2] - rx * s + rz * c + velocity[2] * this.o.lead;
    out[1] = ground(out[0], out[2]);
    return out;
  }

  /** Every foot planted on its rest spot around `body` (a spawn or a teleport). The first `update` does this itself. */
  reset(body: Vec3, yaw: number, ground: (x: number, z: number) => number): void {
    this.started = true;
    const t = this.t;
    this.feet.forEach((f, i) => {
      this.target(i, body, yaw, LegStepper.STILL, ground, t);
      f.at[0] = t[0];
      f.at[1] = t[1];
      f.at[2] = t[2];
      f.t = -1;
    });
  }

  update(dt: number, body: Vec3, yaw: number, velocity: Vec3, ground: (x: number, z: number) => number): void {
    const t = this.t;
    if (!this.started) this.reset(body, yaw, ground);
    // advance steps under way
    for (const f of this.feet) {
      if (f.t < 0) continue;
      f.t = Math.min(1, f.t + dt / this.o.stepTime);
      const k = f.t * f.t * (3 - 2 * f.t);
      for (let c = 0; c < 3; c++) f.at[c] = f.from[c]! + (f.to[c]! - f.from[c]!) * k;
      f.at[1] += Math.sin(f.t * Math.PI) * this.o.lift;
      if (f.t >= 1) f.t = -1;
    }
    // start new steps: the farthest-behind foot first, if its partners are planted
    const behind = this.behind;
    this.feet.forEach((f, i) => {
      this.target(i, body, yaw, velocity, ground, t);
      behind[i] = Math.hypot(f.at[0] - t[0], f.at[2] - t[2]);
    });
    const order = this.order;
    order.sort((a, b) => behind[b]! - behind[a]!);
    for (const i of order) {
      const f = this.feet[i]!;
      if (f.t >= 0 || behind[i]! < this.o.threshold) continue;
      if (this.partners[i]!.some((p) => this.feet[p]!.t >= 0)) continue;
      this.target(i, body, yaw, velocity, ground, t);
      f.from[0] = f.at[0];
      f.from[1] = f.at[1];
      f.from[2] = f.at[2];
      f.to[0] = t[0];
      f.to[1] = t[1];
      f.to[2] = t[2];
      f.t = 0;
      this.steps++;
    }
  }

  /** Feet on the ground now. */
  planted(): number {
    let n = 0;
    for (const f of this.feet) if (f.t < 0) n++;
    return n;
  }
}

/** Partners for `n` legs in two rows (left 0, 2, 4…, right 1, 3, 5…): a leg waits for the legs beside and opposite it. */
export function gaitPartners(n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p = new Set<number>();
    const opposite = i % 2 === 0 ? i + 1 : i - 1;
    if (opposite >= 0 && opposite < n) p.add(opposite);
    if (i - 2 >= 0) p.add(i - 2);
    if (i + 2 < n) p.add(i + 2);
    out.push([...p]);
  }
  return out;
}

// ------------------------------------------------------------------ two-bone IK

/**
 * Where the middle joint of a two-bone limb goes (a knee, an elbow) so the end reaches
 * `target` from `root` with bones `a` and `b` long, bending toward `pole` (a point the knee
 * points at). Analytic (the law of cosines), no iterations; a target out of reach straightens
 * the limb toward it, one too close folds it as far as it goes. Returns the joint, into `out`.
 */
export function twoBoneIK(root: Vec3, target: Vec3, a: number, b: number, pole: Vec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const dx = target[0] - root[0];
  const dy = target[1] - root[1];
  const dz = target[2] - root[2];
  // in reach: no farther than both bones straight, no nearer than they fold
  const dist = Math.max(Math.abs(a - b) + 1e-4, Math.min(Math.hypot(dx, dy, dz), a + b - 1e-4));
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const uz = dz / len;
  // how far along the root→target line the knee sits, and how far off it
  const along = (a * a - b * b + dist * dist) / (2 * dist);
  const off = Math.sqrt(Math.max(0, a * a - along * along));
  // the bend direction: toward the pole, made perpendicular to the line
  let px = pole[0] - root[0];
  let py = pole[1] - root[1];
  let pz = pole[2] - root[2];
  const d = px * ux + py * uy + pz * uz;
  px -= ux * d;
  py -= uy * d;
  pz -= uz * d;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) {
    // pole on the line: any perpendicular will do
    const ax = Math.abs(uy) < 0.9 ? 0 : 1;
    const ay = Math.abs(uy) < 0.9 ? 1 : 0;
    px = ay * uz - 0 * uy;
    py = 0 * ux - ax * uz;
    pz = ax * uy - ay * ux;
  }
  const pn = Math.hypot(px, py, pz) || 1;
  out[0] = root[0] + ux * along + (px / pn) * off;
  out[1] = root[1] + uy * along + (py / pn) * off;
  out[2] = root[2] + uz * along + (pz / pn) * off;
  return out;
}
