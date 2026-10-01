/**
 * Pure camera and picking math for the tree view (unit-tested): tree units ↔ art pixels,
 * zoom about a point, a spatial index for "which node is under / nearest to the cursor",
 * and the controller's d-pad step to the next node in a direction.
 */
export interface TreeCam {
  /** Tree-space point at the centre of the screen. */
  x: number;
  y: number;
  /** Art pixels per tree unit. */
  zoom: number;
}

export const ZOOM_LIMITS = { min: 0.035, max: 0.6 } as const;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function toScreen(cam: TreeCam, w: number, h: number, x: number, y: number): [number, number] {
  return [Math.round((x - cam.x) * cam.zoom + w / 2), Math.round((y - cam.y) * cam.zoom + h / 2)];
}

export function toTree(cam: TreeCam, w: number, h: number, sx: number, sy: number): [number, number] {
  return [(sx - w / 2) / cam.zoom + cam.x, (sy - h / 2) / cam.zoom + cam.y];
}

export function clampZoom(z: number, min: number = ZOOM_LIMITS.min, max: number = ZOOM_LIMITS.max): number {
  return Math.min(max, Math.max(min, z));
}

/** Zoom by `factor` keeping the tree point under screen (sx, sy) where it is. */
export function zoomAt(cam: TreeCam, w: number, h: number, sx: number, sy: number, factor: number, min?: number, max?: number): TreeCam {
  const [tx, ty] = toTree(cam, w, h, sx, sy);
  const zoom = clampZoom(cam.zoom * factor, min, max);
  return { zoom, x: tx - (sx - w / 2) / zoom, y: ty - (sy - h / 2) / zoom };
}

/** Keep the camera centre inside the tree's bounds (plus a margin). */
export function clampCam(cam: TreeCam, b: { x0: number; y0: number; x1: number; y1: number }): TreeCam {
  return { ...cam, x: Math.min(b.x1, Math.max(b.x0, cam.x)), y: Math.min(b.y1, Math.max(b.y0, cam.y)) };
}

/** Grid spatial index over points (nodes), for picking and snapping. */
export class PointIndex<T extends Point> {
  private readonly cells = new Map<string, T[]>();
  readonly bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

  constructor(
    readonly items: readonly T[],
    private readonly cell = 120,
  ) {
    for (const p of items) {
      const k = this.key(Math.floor(p.x / cell), Math.floor(p.y / cell));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(p);
      this.bounds.x0 = Math.min(this.bounds.x0, p.x);
      this.bounds.y0 = Math.min(this.bounds.y0, p.y);
      this.bounds.x1 = Math.max(this.bounds.x1, p.x);
      this.bounds.y1 = Math.max(this.bounds.y1, p.y);
    }
  }

  private key(i: number, j: number): string {
    return `${i},${j}`;
  }

  /** Nearest item within `maxDist` of (x, y), or null. */
  nearest(x: number, y: number, maxDist: number, accept: (p: T) => boolean = () => true): T | null {
    const span = Math.ceil(maxDist / this.cell);
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(y / this.cell);
    let best: T | null = null;
    let bestD = maxDist;
    for (let i = ci - span; i <= ci + span; i++)
      for (let j = cj - span; j <= cj + span; j++)
        for (const p of this.cells.get(this.key(i, j)) ?? []) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d <= bestD && accept(p)) [best, bestD] = [p, d];
        }
    return best;
  }

  /** Items inside a rectangle. */
  inRect(x0: number, y0: number, x1: number, y1: number): T[] {
    const out: T[] = [];
    for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++)
      for (let j = Math.floor(y0 / this.cell); j <= Math.floor(y1 / this.cell); j++)
        for (const p of this.cells.get(this.key(i, j)) ?? []) if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(p);
    return out;
  }
}

/**
 * The best item to step to from `from` in direction (dx, dy): within a 60° cone, scored by
 * distance with a penalty for angle off the direction. `candidates` are usually its links
 * first, falling back to anything nearby.
 */
export function stepToward<T extends Point>(from: Point, dx: number, dy: number, candidates: readonly T[]): T | null {
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  const ux = dx / len;
  const uy = dy / len;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const vx = c.x - from.x;
    const vy = c.y - from.y;
    const d = Math.hypot(vx, vy);
    if (d < 1e-6) continue;
    const cos = (vx * ux + vy * uy) / d;
    if (cos < 0.5) continue;
    const score = d * (1 + 2 * (1 - cos));
    if (score < bestScore) [best, bestScore] = [c, score];
  }
  return best;
}
