/**
 * Texture coordinates for textured parts (`tex`), at the def's `texel` density so a texel is the
 * same size on every part of a model. Flat kinds are box-projected: each face on the part's own
 * axis it looks along, measured from the model's origin, so texels line up across parts that
 * share a rotation (a wall of boxes, a floor of slabs) and run along a part that is turned (a
 * brace's grain follows the brace). Round kinds (`cyl`, `cone`, `ball`, `torus`, `lathe`) wrap
 * round their own Y axis in a whole number of repeats, so a tiling texture meets itself; their
 * caps are projected from above. v runs up the part; u runs left to right across a face seen
 * from outside. UVs are in texture repeats (a tiling texture's map wraps).
 */
import { Matrix3, Vector3 } from 'three/webgpu';
import type { CompiledPart } from './compile';

/**
 * Texels per metre for `tex` parts when the def doesn't set `texel`: the densest Gate B passed for
 * surfaces the camera zooms over (docs/assets/textures.md *Texel density*). A model that moves may set
 * up to `MOVING_TEXEL`.
 */
export const DEFAULT_TEXEL = 8;
/** The densest a moving model passed Gate B at (its sliding crate); denser wasn't measured. */
export const MOVING_TEXEL = 20;

const ROUND = new Set(['cyl', 'cone', 'ball', 'torus', 'lathe']);
/** A face whose own normal is this close to ±Y is a cap: projected from above. */
const CAP = 0.7;

/**
 * UVs (2 per vertex, in the part's own vertex order) at `texel` texels per metre over a `w × h`
 * texture.
 */
export function partUVs(p: CompiledPart, texel: number, [w, h]: readonly [number, number]): Float32Array {
  const verts = p.tris.length / 3;
  const out = new Float32Array(verts * 2);
  const su = texel / w;
  const sv = texel / h;
  // the part's own axes (unit length, so group scales stay in metres) and its placement on them
  const e = p.matrix.elements;
  const ax = [new Vector3(e[0], e[1], e[2]), new Vector3(e[4], e[5], e[6]), new Vector3(e[8], e[9], e[10])];
  const scale = ax.map((a) => a.length() || 1);
  ax.forEach((a, i) => a.divideScalar(scale[i]!));
  const toAxes = new Matrix3().set(ax[0]!.x, ax[0]!.y, ax[0]!.z, ax[1]!.x, ax[1]!.y, ax[1]!.z, ax[2]!.x, ax[2]!.y, ax[2]!.z);
  const origin = new Vector3(e[12], e[13], e[14]).applyMatrix3(toAxes);
  const local = (x: number, y: number, z: number, o: Vector3) => o.set(x * scale[0]!, y * scale[1]!, z * scale[2]!).add(origin);
  const round = ROUND.has(p.kind);
  // round kinds: a whole number of repeats round the circumference (the radius averaged over x and z)
  const radius = ((p.extent[0] * scale[0]! + p.extent[2] * scale[2]!) / 4) || 0.5;
  const turns = Math.max(1, Math.round((2 * Math.PI * radius * texel) / w));
  const pts = [new Vector3(), new Vector3(), new Vector3()];
  const ab = new Vector3();
  const ac = new Vector3();
  const n = new Vector3();
  for (let t = 0; t < verts; t += 3) {
    for (let k = 0; k < 3; k++) local(p.tris[(t + k) * 3]!, p.tris[(t + k) * 3 + 1]!, p.tris[(t + k) * 3 + 2]!, pts[k]!);
    // local coordinates are the part's own (scaled and offset, never mirrored): wound outward
    n.crossVectors(ab.subVectors(pts[1]!, pts[0]!), ac.subVectors(pts[2]!, pts[0]!)).normalize();
    if (round && Math.abs(n.y) < CAP) {
      // the angle round the own Y axis; a vertex on the axis (a cone's tip) takes its neighbours'
      const ang: (number | null)[] = [0, 1, 2].map((k) => {
        const x = p.tris[(t + k) * 3]!;
        const z = p.tris[(t + k) * 3 + 2]!;
        return Math.hypot(x, z) < 1e-6 ? null : Math.atan2(z, x);
      });
      const known = ang.filter((a): a is number => a !== null);
      // keep the triangle on one side of the seam at −X
      if (known.length > 1 && Math.max(...known) - Math.min(...known) > Math.PI) {
        for (let k = 0; k < 3; k++) if (ang[k] !== null && ang[k]! < 0) ang[k] = ang[k]! + 2 * Math.PI;
      }
      const placed = ang.filter((a): a is number => a !== null);
      const mean = placed.length ? placed.reduce((s, a) => s + a, 0) / placed.length : 0;
      // a face looking in at the axis (a torus's inner ring) runs the other way, so it reads left to right too
      const cx = p.tris[t * 3]! + p.tris[(t + 1) * 3]! + p.tris[(t + 2) * 3]!;
      const cz = p.tris[t * 3 + 2]! + p.tris[(t + 1) * 3 + 2]! + p.tris[(t + 2) * 3 + 2]!;
      const way = cx * n.x + cz * n.z < 0 ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        out[(t + k) * 2] = ((way * (ang[k] ?? mean)) / (2 * Math.PI)) * turns;
        out[(t + k) * 2 + 1] = pts[k]!.y * sv;
      }
      continue;
    }
    const axis = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 0 : Math.abs(n.y) >= Math.abs(n.z) ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const v = pts[k]!;
      const u = axis === 0 ? (n.x > 0 ? -v.z : v.z) : axis === 1 ? v.x : n.z > 0 ? v.x : -v.x;
      const vv = axis === 1 ? (n.y > 0 ? -v.z : v.z) : v.y;
      out[(t + k) * 2] = u * su;
      out[(t + k) * 2 + 1] = vv * sv;
    }
  }
  return out;
}
