/**
 * Gate B (docs/plans/asset-system.md §5): how dense texels may be before they shimmer, measured
 * in the real renderer. A scene in the Asset Lab (a floor, a wall, two crates and a crate that
 * slides, in three textures) is stepped one frame at a time (`Engine.step`) through a camera
 * sequence while each frame is captured and compared with the one before; `scripts/gate-b.ts`
 * drives it and does the sums. A frame's score is the share of its pixels whose colour changed,
 * after undoing the whole-pixel shift that best lines the two frames up (the iso rig snaps to
 * art pixels, so a pan is a shift, not a change).
 */
import type { Mesh, Vector3 } from 'three/webgpu';
import type { Engine, Framing, GameContext, LightHandle } from '../engine';
import { buildModel, type ModelBuild, type ModelDef, type Part } from '../engine/model';
import { bakeTexture, meanColour, TEXTURE_LIBRARY, TextureCatalog, textureDef } from '../engine/texture';

/** The scene's surfaces and their textures in the library set. */
const SURFACES = { floor: 'cobbles', wall: 'bricks', crate: 'planks' } as const;
type Surface = keyof typeof SURFACES;

/** Calibration: the deliberately bad texture (1-texel checker) and the calm one (two-colour blobs, one per tile). */
export const BAD = textureDef({ id: 'gate-b-bad', about: '1-texel checker (Gate B calibration)', tags: [], size: [16, 16], tile: true, palette: { a: 'night', b: 'mist' }, layers: [{ pattern: 'checker', colors: ['a', 'b'], cell: 1 }] });
export const CALM = textureDef({ id: 'gate-b-calm', about: 'two-colour blobs (Gate B calibration)', tags: [], size: [16, 16], tile: true, palette: { a: 'slate', b: 'mist' }, layers: [{ pattern: 'noise', colors: ['a', 'b'], scale: 2, octaves: 1, seed: 2 }] });

export type GateBSet = 'library' | 'bad' | 'calm' | 'flat';

export interface GateBFrame {
  /** Camera zoom this frame. */
  readonly zoom: number;
  /** The sliding crate's x (metres). */
  readonly crate?: number;
  /** The camera target's x offset (metres): a pan. */
  readonly pan?: number;
}

export interface GateBRun {
  readonly width: number;
  readonly height: number;
  /** Per frame: the share of pixels that changed since the previous frame (the first is 0). */
  readonly changed: number[];
  /** Per frame: the whole-pixel shift undone before comparing. */
  readonly shift: [number, number][];
  /** Frames asked for in `shots`, as RGBA bytes in base64. */
  readonly shots: { frame: number; rgba: string }[];
}

const textureOf = (set: GateBSet, s: Surface): string | null => (set === 'flat' ? null : set === 'bad' ? BAD.id : set === 'calm' ? CALM.id : SURFACES[s]);

/** The flat baseline's colours: each library texture's mean colour. */
const flatColour = (s: Surface) => meanColour(bakeTexture(TEXTURE_LIBRARY.get(SURFACES[s])));

function surface(set: GateBSet, s: Surface, part: Omit<Part, 'c'> & Record<string, unknown>): Part {
  const tex = textureOf(set, s);
  return (tex ? { ...part, tex } : { ...part, c: s }) as Part;
}

function sceneDef(set: GateBSet, texel: number): ModelDef {
  return {
    id: `gate-b-${set}`,
    about: 'Gate B scene',
    tags: [],
    texel,
    floats: true,
    palette: { floor: 'slate', wall: 'slate', crate: 'orange' },
    parts: [
      surface(set, 'floor', { box: [120, 0.2, 120], at: [0, -0.1, 0] }),
      surface(set, 'wall', { box: [6, 2.5, 0.4], at: [0, 1.25, -2.6] }),
      surface(set, 'crate', { box: [0.8, 0.8, 0.8], at: [-1.6, 0.4, -1.6] }),
      surface(set, 'crate', { box: [0.8, 0.8, 0.8], at: [-0.6, 0.4, -1.8], rot: [0, 30, 0] }),
    ],
  };
}

function crateDef(set: GateBSet, texel: number): ModelDef {
  return { id: `gate-b-crate-${set}`, about: 'Gate B sliding crate', tags: [], texel, palette: { crate: 'orange' }, parts: [surface(set, 'crate', { box: [0.8, 0.8, 0.8], at: [0, 0.4, 0] })] };
}

/** The Gate B scene in a lab: build it, then `run` camera sequences over it. */
export class GateB {
  private builds: ModelBuild[] = [];
  private crate: ModelBuild | null = null;
  private light: LightHandle | null = null;
  /** The lab's camera before the first scene (`clear` puts it back). */
  private saved: { zoom: number; target: Vector3 } | null = null;
  private readonly catalog = new TextureCatalog([...TEXTURE_LIBRARY.all(), BAD, CALM]);

  constructor(
    private readonly engine: Engine,
    private readonly ctx: GameContext,
    /** Where the lab's camera looks (moved for pans). */
    private readonly target: Vector3,
    /** Hide or show the lab's own floor and models. */
    private readonly hideLab: (hidden: boolean) => void,
  ) {}

  /** Build the scene with a set of textures at `texel` texels per metre (`flat`: their mean colours). */
  scene(set: GateBSet, texel: number): { tris: number; materials: number } {
    this.clear();
    this.saved = { zoom: this.engine.camera.zoom, target: this.target.clone() };
    this.hideLab(true);
    const palette = set === 'flat' ? { floor: flatColour('floor'), wall: flatColour('wall'), crate: flatColour('crate') } : undefined;
    const opts = { textures: this.catalog, ...(palette ? { palette } : {}) };
    const scene = buildModel(sceneDef(set, texel), opts);
    this.crate = buildModel(crateDef(set, texel), palette ? { textures: this.catalog, palette: { crate: palette.crate } } : { textures: this.catalog });
    this.crate.object.position.set(-3, 0, 0.4);
    this.builds = [scene, this.crate];
    for (const b of this.builds) this.ctx.scene.add(b.object);
    this.light = this.ctx.lights.request({ position: [-1, 1.6, -0.8], color: 0xffcd75, intensity: 1.2, radius: 5, flicker: 'none' });
    this.target.set(0, 0.5, -1);
    return { tris: scene.report.tris + this.crate.report.tris, materials: scene.report.materials };
  }

  /** Take the scene down: the lab, its camera and real time (`run` steps the engine by hand) come back. */
  clear(): void {
    this.engine.manual = false;
    for (const b of this.builds) {
      b.object.removeFromParent();
      // each scene builds from a fresh def, so its geometry is this build's alone
      b.object.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    this.builds = [];
    this.crate = null;
    this.light?.release();
    this.light = null;
    if (this.saved) {
      this.engine.camera.setZoom(this.saved.zoom);
      this.target.copy(this.saved.target);
      this.saved = null;
    }
    this.hideLab(false);
  }

  /**
   * Step through `frames` (one `Engine.step` each), capture every frame at art resolution and
   * score it against the one before. `shots` lists frames to hand back whole.
   */
  async run(frames: readonly GateBFrame[], shots: readonly number[] = []): Promise<GateBRun> {
    const e = this.engine;
    const changed: number[] = [];
    const shift: [number, number][] = [];
    const out: GateBRun['shots'] = [];
    let prev: Uint8Array | null = null;
    let W = 0;
    let H = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      e.camera.setZoom(f.zoom);
      this.target.set(f.pan ?? 0, 0.5, -1);
      if (this.crate && f.crate !== undefined) this.crate.object.position.x = f.crate;
      e.step(1);
      const cap = await e.renderer.capture();
      const art = artPixels(cap.width, cap.height, cap.pixels, e.renderer.framing);
      W = art.width;
      H = art.height;
      if (prev) {
        const best = bestShift(prev, art.pixels, W, H);
        changed.push(best.changed);
        shift.push([best.dx, best.dy]);
      } else {
        changed.push(0);
        shift.push([0, 0]);
      }
      prev = art.pixels;
      if (shots.includes(i)) out.push({ frame: i, rgba: toBase64(art.pixels) });
    }
    return { width: W, height: H, changed, shift, shots: out };
  }
}

/** The capture at one sample per art pixel (the canvas is the art scaled up by whole blocks). */
function artPixels(width: number, height: number, pixels: Uint8Array, framing: Framing): { width: number; height: number; pixels: Uint8Array } {
  const s = Math.max(1, Math.round(width / framing.artWidth));
  if (s === 1) return { width, height, pixels };
  const w = framing.artWidth;
  const h = Math.min(framing.artHeight, Math.floor(height / s));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(pixels.subarray((y * s * width + x * s) * 4, (y * s * width + x * s) * 4 + 4), (y * w + x) * 4);
  return { width: w, height: h, pixels: out };
}

/** The share of pixels that differ between `b` and `a` shifted by (dx, dy), at the shift (within ±2) where it is least. */
function bestShift(a: Uint8Array, b: Uint8Array, w: number, h: number): { dx: number; dy: number; changed: number } {
  let best = { dx: 0, dy: 0, changed: Infinity };
  const m = 2;
  for (let dy = -m; dy <= m; dy++) {
    for (let dx = -m; dx <= m; dx++) {
      let diff = 0;
      let n = 0;
      for (let y = m; y < h - m; y++) {
        for (let x = m; x < w - m; x++) {
          const i = (y * w + x) * 4;
          const j = ((y - dy) * w + (x - dx)) * 4;
          n++;
          if (a[j] !== b[i] || a[j + 1] !== b[i + 1] || a[j + 2] !== b[i + 2]) diff++;
        }
      }
      const c = diff / n;
      // ties go to the smaller shift (no shift first)
      if (c < best.changed - 1e-12 || (Math.abs(c - best.changed) <= 1e-12 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, changed: c };
    }
  }
  return best;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
