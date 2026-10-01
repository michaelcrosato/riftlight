import { MathUtils } from 'three/webgpu';

/** Signed smallest angle from b to a (radians, −π..π). */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Turn the angle `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(to, from);
  return from + MathUtils.clamp(d, -maxStep, maxStep);
}

/** Move `value` toward `target` by at most `delta`. */
export function approach(value: number, target: number, delta: number): number {
  return value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);
}
