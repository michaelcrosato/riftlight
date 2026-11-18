/**
 * Aiming without a mouse, one rule for the hero controller (the Arena) and the game shell
 * (Riftlight's pad, keyboard and touch aim): a target counts when it lies within a cone around
 * the way the player means (the right stick, the left stick, the facing), the nearest such wins.
 * The right stick aims along itself with a narrow cone (aim assist), and so does motion aim along
 * the direction the controller's turns keep; the left stick and the facing use a wide one
 * (auto-aim). Plain maths on positions: nothing here is state.
 */
import type { Vector3 } from 'three/webgpu';

export const AIM = {
  /** Auto-aim along the move direction or the facing: targets this far (m) within this half-angle (deg). */
  range: 9,
  cone: 70,
  /** Right-stick aim assist: a hostile within this half-angle (deg) of the stick and `range` is aimed at. */
  assist: 18,
  /** The right stick aims once it leans this far (after the engine's deadzone, 0..1). */
  stick: 0.3,
  /** Where the right stick aims with nobody to snap to: this far (m) along it. */
  reach: 5,
  /**
   * Motion aim (a DualSense's turns, `input.motionTurn`): the pad's aim turns this many degrees for
   * each degree the controller turns (at sensitivity 1), so a quarter turn of the wrists aims behind.
   */
  gyro: 2,
  /** Motion aim keeps its direction this long (s) after the controller last turned it or the hero last acted along it, as the mouse's aim does. */
  hold: 6,
} as const;

/** True when `at` lies within `cos` (the cosine of the half-angle) of the ground direction (`dx`, `dz`, unit) from `from`; a target on top of `from` counts. */
export function inCone(from: Vector3, dx: number, dz: number, cos: number, at: Vector3): boolean {
  const x = at.x - from.x;
  const z = at.z - from.z;
  const d = Math.hypot(x, z);
  return d < 0.01 || (x * dx + z * dz) / d >= cos;
}

/** The cosine of a half-angle in degrees (`inCone`'s `cos`). */
export const coneCos = (deg: number): number => Math.cos((deg * Math.PI) / 180);

/**
 * The nearest of `targets` (living, `ok`) within `range` m of `from` and inside the cone of
 * `deg` degrees around the ground direction (`dx`, `dz`), or null. Ties keep the earlier target.
 */
export function coneTarget<T extends { readonly position: Vector3; readonly alive: boolean }>(from: Vector3, dx: number, dz: number, deg: number, range: number, targets: Iterable<T>, ok: (t: T) => boolean = () => true): T | null {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uz = dz / len;
  const cos = coneCos(deg);
  let best: T | null = null;
  let bd = range;
  for (const t of targets) {
    if (!t.alive || !ok(t)) continue;
    const d = Math.hypot(t.position.x - from.x, t.position.z - from.z);
    if (d < bd && inCone(from, ux, uz, cos, t.position)) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/**
 * Where the right stick aims from `from` along its ground direction (`dx`, `dz`): at the nearest
 * hostile (`ok`) within `AIM.assist` degrees of it and `AIM.range` m (aim assist), else `AIM.reach`
 * m along it, into `out`. Returns the target snapped to, or null.
 */
export function stickAim<T extends { readonly position: Vector3; readonly alive: boolean }>(from: Vector3, dx: number, dz: number, targets: Iterable<T>, ok: (t: T) => boolean, out: Vector3): T | null {
  const target = coneTarget(from, dx, dz, AIM.assist, AIM.range, targets, ok);
  if (target) out.copy(target.position);
  else {
    const len = Math.hypot(dx, dz) || 1;
    out.set(from.x + (dx / len) * AIM.reach, from.y, from.z + (dz / len) * AIM.reach);
  }
  return target;
}

/**
 * Aim without a mouse or the right stick (keys, the left stick, a finger, a couch guest's pad at
 * rest): the nearest target in the `AIM.cone` ahead along `move` (standing, along where it aimed
 * last, `aim`), else the nearest within `around` m whichever way, else on along the move (3 m) or
 * where it aimed, into `out`.
 */
export function autoAim<T extends { readonly position: Vector3; readonly alive: boolean }>(from: Vector3, move: { readonly x: number; readonly z: number }, aim: Vector3, around: number, targets: readonly T[], ok: (t: T) => boolean, out: Vector3): void {
  const moving = Math.hypot(move.x, move.z) > 0.1;
  const dx = moving ? move.x : aim.x - from.x;
  const dz = moving ? move.z : aim.z - from.z;
  const target = coneTarget(from, dx, dz, AIM.cone, AIM.range, targets, ok) ?? coneTarget(from, 1, 0, 180, around, targets, ok);
  if (target) out.copy(target.position);
  else if (moving) out.set(from.x + move.x * 3, from.y, from.z + move.z * 3);
  else out.copy(aim);
}

/**
 * The ground direction (`dx`, `dz`) turned `deg` degrees as the screen shows it (+: clockwise, the
 * way a controller turned right turns the aim), on the camera's ground basis (`right`, `forward`:
 * unit, at right angles: `cameraBasis`).
 */
export function turnOnScreen(dx: number, dz: number, deg: number, right: Vector3, forward: Vector3): { x: number; z: number } {
  const sx = dx * right.x + dz * right.z;
  const sy = dx * forward.x + dz * forward.z;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rx = sx * c + sy * s;
  const ry = sy * c - sx * s;
  return { x: right.x * rx + forward.x * ry, z: right.z * rx + forward.z * ry };
}
