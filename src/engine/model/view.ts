/**
 * The game's view of a model: Riftlight's camera (src/riftlight/index.ts) and a part-id raster
 * through it. The sheets draw with it; the readability checks count its pixels, so a warning
 * measures what the player sees at 480×270.
 */
import { Vector3 } from 'three/webgpu';
import { viewBasis } from '../inspect/render';

/**
 * Riftlight's camera: iso, yaw 45°, pitch 42°, a 15 m tall view on 270 art pixels (18 px/m at
 * zoom 1), at the level and town zooms (src/riftlight/game/Riftlight.ts).
 */
export const GAME_VIEW = { yaw: 45, pitch: 42, viewHeight: 15, rows: 270, zooms: { level: 1.08, town: 1.22 } } as const;

export const gamePxPerMetre = (zoom: number) => (GAME_VIEW.rows / GAME_VIEW.viewHeight) * zoom;

/** The raster's longest side: past it (a model over ~26 m across) the scale drops instead. */
export const MAX_RASTER = 512;

/** Which part (index + 1, 0 = empty) covers each art pixel, at `scale` px/m. */
export interface PartRaster {
  readonly width: number;
  readonly height: number;
  readonly ids: Uint16Array;
  readonly scale: number;
}

/**
 * World-space triangles of each part (flat vertex triples) through the game camera at the level
 * zoom, `yaw` degrees round (the game's own by default; add 180 for the far side). Depth and ids
 * only, and never over `MAX_RASTER` a side, so a draft with a stray part 1 km away stays cheap.
 */
export function rasterParts(parts: readonly (readonly Vector3[])[], yaw: number = GAME_VIEW.yaw): PartRaster {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const ps of parts) {
    for (const p of ps) {
      min.min(p);
      max.max(p);
    }
  }
  if (!Number.isFinite(min.x)) return { width: 0, height: 0, ids: new Uint16Array(0), scale: 0 };
  const diag = max.clone().sub(min).length();
  const scale = Math.min(gamePxPerMetre(GAME_VIEW.zooms.level), (MAX_RASTER - 4) / Math.max(diag, 1e-6));
  const side = Math.min(MAX_RASTER, Math.ceil(diag * scale) + 4);
  const centre = min.clone().add(max).multiplyScalar(0.5);
  const { f, r, u } = viewBasis(yaw, GAME_VIEW.pitch);
  const ids = new Uint16Array(side * side);
  const depth = new Float32Array(side * side).fill(-Infinity);
  const d = new Vector3();
  const proj = (p: Vector3): [number, number, number] => {
    d.subVectors(p, centre);
    return [side / 2 + d.dot(r) * scale, side / 2 - d.dot(u) * scale, -d.dot(f)];
  };
  parts.forEach((ps, i) => {
    for (let k = 0; k + 2 < ps.length; k += 3) fill(proj(ps[k]!), proj(ps[k + 1]!), proj(ps[k + 2]!), i + 1, side, ids, depth);
  });
  return { width: side, height: side, ids, scale };
}

/** One triangle into the id and depth buffers (pixel centres, nearest wins; either winding). */
function fill([ax, ay, az]: readonly [number, number, number], [bx, by, bz]: readonly [number, number, number], [cx, cy, cz]: readonly [number, number, number], id: number, side: number, ids: Uint16Array, depth: Float32Array): void {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const x1 = Math.min(side - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(side - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
      const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * az + w1 * bz + w2 * cz;
      const k = y * side + x;
      if (z <= depth[k]!) continue;
      depth[k] = z;
      ids[k] = id;
    }
  }
}
