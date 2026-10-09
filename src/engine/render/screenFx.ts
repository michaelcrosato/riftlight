/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are dynamically typed */
import { type Camera, Color, type ColorRepresentation, LinearSRGBColorSpace, Vector3, Vector4 } from 'three/webgpu';
import { Fn, If, abs, clamp, float, floor, fract, hash, length, max, min, mix, screenCoordinate, screenSize, screenUV, select, step, uniform, vec2, vec4 } from 'three/tsl';
import { PALETTE, type PaletteColor } from '../palette';

/**
 * Screen effects every output graph ends with (pixel and raw mode, every look): retro
 * **transitions** that cover the picture in art-pixel patterns, a **flash**, and up to four
 * **shockwave** rings that push the picture outwards. All of it is uniforms, so starting
 * one never rebuilds or recompiles a graph. `engine.screen`:
 *
 *   await engine.screen.cover('iris', { center: hero.position });   // closes on the hero
 *   await engine.loadGame(next);
 *   await engine.screen.reveal('iris');
 *   engine.screen.flash('white', { duration: 0.1 });
 *   engine.screen.shockwave(blastPosition, { radius: 0.4, strength: 1 });
 *
 * Transitions and flashes run on real time (they keep moving while the game is paused and
 * while a level builds; the loop only stops while new shaders precompile); shockwaves too.
 * Patterns are per **art pixel**, so an iris is a pixel circle at any scale. Shockwaves and
 * the mosaic's growing blocks resample the art-resolution picture where it is upscaled
 * (pixel-art layers; a clean, full-resolution look or Raw mode gets the transitions, the
 * mosaic's fade and the flash, but no ripple). Colours are palette names or hex (display
 * colours, as they appear on screen). While nothing runs, the stage costs a uniform test per
 * pixel.
 */

export type TransitionKind = 'fade' | 'iris' | 'diamonds' | 'dissolve' | 'dither' | 'blinds' | 'wipe' | 'curtain' | 'mosaic';

/** Every transition, in the order a picker lists them. */
export const TRANSITIONS: readonly TransitionKind[] = ['fade', 'iris', 'diamonds', 'dissolve', 'dither', 'blinds', 'wipe', 'curtain', 'mosaic'];

const KIND_ID: Readonly<Record<TransitionKind, number>> = { fade: 1, iris: 2, diamonds: 3, dissolve: 4, dither: 5, blinds: 6, wipe: 7, curtain: 8, mosaic: 9 };

/** Art pixels per diamond cell, blind band, dissolve block; the most a mosaic block grows to. */
export const TRANSITION_CELLS = { diamonds: 16, blinds: 12, dissolve: 3, mosaic: 20 } as const;

/** A palette name (`'white'`, `'ink'`…) or any three.js colour (hex: as it shows on screen). */
export type ScreenColor = PaletteColor | ColorRepresentation;

export interface TransitionOptions {
  /** Seconds (real time). Default 0.45. */
  duration?: number;
  /** Colour it covers with. Default ink (palette black). */
  color?: ScreenColor;
  /**
   * Where an iris closes / a shockwave starts: a world point (a Vector3 is followed while it
   * moves), or `[u, v]` on the screen (0..1 from the top-left). Default the middle.
   */
  center?: Vector3 | readonly [number, number];
}

export interface FlashOptions {
  /** Seconds to fade out (real time). Default 0.15. */
  duration?: number;
  /** 0..1 at the start. Default 0.8. */
  strength?: number;
}

export interface ShockwaveOptions {
  /** Final radius in screen heights. Default 0.45. */
  radius?: number;
  /** Seconds (real time). Default 0.6. */
  duration?: number;
  /** Push strength (1 = a strong blast). Default 1. */
  strength?: number;
}

/** What `state()` reports (tests, tools). */
export interface ScreenFxState {
  transition: TransitionKind | null;
  /** 0 clear … 1 covered. */
  progress: number;
  /** A transition is animating. */
  moving: boolean;
  flash: number;
  shockwaves: number;
}

interface Wave {
  center: Vector3 | readonly [number, number];
  t: number;
  duration: number;
  radius: number;
  strength: number;
}

const MAX_WAVES = 4;
/** Thickness of a ring, in screen heights. */
const WAVE_THICKNESS = 0.06;
const PALETTE_INK = PALETTE.ink;

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Put a colour into a uniform as it should look on screen: this stage mixes after the output
 * colour transform (display space), so the uniform holds the sRGB values themselves (hex / 255),
 * not three's linear working colours.
 */
export function displayColor(target: Color, c: ScreenColor): Color {
  const hex = typeof c === 'string' && Object.hasOwn(PALETTE, c) ? PALETTE[c as PaletteColor] : new Color(c).getHex();
  return target.setHex(hex, LinearSRGBColorSpace);
}

/** Ordered-dither threshold in [0, 1) from a 4×4 Bayer matrix (the same table as the filters). */
const bayer2 = (a: any): any => fract(a.x.div(2).add(a.y.mul(a.y).mul(0.75)));
const bayer4 = (a: any): any => bayer2(floor(a.mul(0.5))).mul(0.25).add(bayer2(a));

export class ScreenFx {
  // ---- uniforms (shared by every graph the renderer builds)
  private readonly uKind = uniform(0);
  private readonly uProgress = uniform(0);
  private readonly uCenter = uniform(new Vector4(0.5, 0.5, 0, 0)); // xy: uv
  private readonly uColor = uniform(displayColor(new Color(), PALETTE_INK));
  private readonly uFlash = uniform(0);
  private readonly uFlashColor = uniform(displayColor(new Color(), 'white'));
  private readonly uWaves = Array.from({ length: MAX_WAVES }, () => uniform(new Vector4(0.5, 0.5, 0, 0)));
  /** 1 while a transition or a flash shows (else the colour stage is skipped). */
  private readonly uActive = uniform(0);
  /** 1 while a ring or a mosaic moves pixels (else the upscale is a plain lookup). */
  private readonly uWarp = uniform(0);

  // ---- animation state
  private kind: TransitionKind | null = null;
  private progress = 0;
  private from = 0;
  private to = 0;
  private t = 0;
  private duration = 0;
  private center: Vector3 | readonly [number, number] | null = null;
  private pending: ((completed: boolean) => void) | null = null;
  private flashLeft = 0;
  private flashDuration = 0;
  private flashStrength = 0;
  private readonly waves: Wave[] = [];
  private readonly tmp = new Vector3();

  /**
   * Cover the picture (progress → 1). Resolves when it stops: `true` when it is fully covered,
   * `false` when another transition (or `set`, `clear`) took over first.
   */
  cover(kind: TransitionKind = 'fade', o: TransitionOptions = {}): Promise<boolean> {
    return this.run(kind, 1, o);
  }

  /** Uncover it (progress → 0) with `kind` (default: the one that covered it). Resolves like `cover`. */
  reveal(kind?: TransitionKind, o: TransitionOptions = {}): Promise<boolean> {
    return this.run(kind ?? this.kind ?? 'fade', 0, o);
  }

  /**
   * Cover, run `between` (load a level, teleport), then reveal, also when `between` throws
   * (the error is passed on). Resolves to whether the cover completed.
   */
  async transition(kind: TransitionKind, between: () => unknown, o: TransitionOptions & { revealCenter?: TransitionOptions['center'] } = {}): Promise<boolean> {
    const covered = await this.cover(kind, o);
    if (!covered) this.set(kind, 1);
    try {
      await between();
    } finally {
      await this.reveal(kind, { ...o, center: o.revealCenter ?? o.center });
    }
    return covered;
  }

  /** Jump straight to a progress (0 clear, 1 covered), no animation. */
  set(kind: TransitionKind | null, progress: number): void {
    this.finishPending(false);
    this.kind = kind;
    this.progress = this.from = this.to = kind ? Math.min(1, Math.max(0, progress)) : 0;
    this.duration = 0;
  }

  /** A full-screen flash that fades out. */
  flash(color: ScreenColor = 'white', o: FlashOptions = {}): void {
    displayColor(this.uFlashColor.value, color);
    this.flashDuration = Math.max(0.01, o.duration ?? 0.15);
    this.flashLeft = this.flashDuration;
    this.flashStrength = Math.min(1, Math.max(0, o.strength ?? 0.8));
  }

  /** A ring that pushes the picture outwards from `at` (oldest ring is replaced when 4 run). */
  shockwave(at: Vector3 | readonly [number, number], o: ShockwaveOptions = {}): void {
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.waves.push({
      center: at instanceof Vector3 ? at.clone() : at,
      t: 0,
      duration: Math.max(0.05, o.duration ?? 0.6),
      radius: o.radius ?? 0.45,
      strength: o.strength ?? 1,
    });
  }

  /** Stop everything (a clear picture). */
  clear(): void {
    this.set(null, 0);
    this.flashLeft = 0;
    this.waves.length = 0;
    this.sync(null);
  }

  state(): ScreenFxState {
    return {
      transition: this.kind,
      progress: +this.progress.toFixed(4),
      moving: this.pending !== null,
      flash: +this.flashAmount().toFixed(3),
      shockwaves: this.waves.length,
    };
  }

  /** Engine, every rendered frame (real seconds; `camera` projects world centres). */
  update(dt: number, camera: Camera | null): void {
    if (this.pending) {
      this.t += dt;
      const u = this.duration > 0 ? Math.min(1, this.t / this.duration) : 1;
      this.progress = this.from + (this.to - this.from) * smooth(u);
      if (u >= 1) {
        this.progress = this.to;
        if (this.to === 0) this.kind = null;
        this.finishPending(true);
      }
    }
    if (this.flashLeft > 0) this.flashLeft = Math.max(0, this.flashLeft - dt);
    for (const w of this.waves) w.t += dt;
    for (let i = this.waves.length - 1; i >= 0; i--) if (this.waves[i]!.t >= this.waves[i]!.duration) this.waves.splice(i, 1);
    this.sync(camera);
  }

  // ------------------------------------------------------------------ nodes

  /**
   * Sample an art-resolution picture for the device pass, pushed by the shockwaves and
   * blocked up by a mosaic transition, with the rings' bright edge. `tex` is the art target
   * (a texture node); `scale` is device pixels per art pixel.
   */
  sampleNode(tex: any, scale: any): any {
    return Fn(() => {
      const uv: any = screenUV.toVar();
      const glow: any = float(0).toVar();
      If(this.uWarp.greaterThan(0.5), () => {
        const aspect = screenSize.x.div(screenSize.y);
        const p = vec2(screenUV.x.mul(aspect), screenUV.y);
        let off: any = vec2(0, 0);
        let ring: any = float(0);
        for (const u of this.uWaves) {
          const d = p.sub(vec2(u.x.mul(aspect), u.y));
          const r = length(d);
          const band = max(float(0), float(1).sub(abs(r.sub(u.z)).div(WAVE_THICKNESS)));
          const push = band.mul(band).mul(u.w);
          off = off.add(d.div(max(r, 1e-4)).mul(push.mul(WAVE_THICKNESS * 0.9)));
          ring = ring.add(step(0.6, band).mul(u.w));
        }
        const warped = screenUV.sub(vec2(off.x.div(aspect), off.y));
        // mosaic: art-pixel blocks that grow over the first 60% of the transition
        const art = screenSize.div(scale);
        const mosaic = select(this.uKind.equal(KIND_ID.mosaic), min(this.uProgress.div(0.6), float(1)), float(0));
        const block = floor(mosaic.mul(TRANSITION_CELLS.mosaic - 1)).add(1);
        const cell = floor(warped.mul(art).div(block)).add(0.5).mul(block).div(art);
        uv.assign(select(block.greaterThan(1.5), cell, warped));
        glow.assign(clamp(ring, 0, 1).mul(0.18));
      });
      const c = tex.sample(uv);
      return vec4(c.rgb.add(glow), c.a);
    })();
  }

  /** The transition and the flash over a finished colour (device pass). */
  colorNode(color: any, scale: any): any {
    return Fn(() => {
      const out: any = vec4(color).toVar();
      If(this.uActive.greaterThan(0.5), () => {
        const a = floor(screenCoordinate.xy.div(scale));
        const size = screenSize.div(scale);
        const uv = a.add(0.5).div(size);
        const p = this.uProgress;
        const k = this.uKind;
        const covered = (cond: any) => select(cond, float(1), float(0));

        const fade = floor(p.mul(5)).div(5);
        const c = this.uCenter.xy.mul(size);
        const reach = length(max(c, size.sub(c)));
        const iris = covered(length(a.add(0.5).sub(c)).greaterThan(float(1).sub(p).mul(reach)));
        const dc = float(TRANSITION_CELLS.diamonds);
        const local = fract(a.add(0.5).div(dc)).mul(2).sub(1);
        const sweep = floor(a.x.div(dc)).add(0.5).mul(dc).div(size.x);
        const q = clamp(p.mul(2.2).sub(sweep.mul(1.2)), 0, 1);
        const diamonds = covered(abs(local.x).add(abs(local.y)).lessThan(q.mul(2.01)));
        const blockId = floor(a.div(TRANSITION_CELLS.dissolve));
        const dissolve = covered(hash(blockId.x.add(blockId.y.mul(1013))).lessThan(p));
        const dither = covered(bayer4(a).lessThan(p.mul(1.0001)));
        const blinds = covered(fract(a.y.add(0.5).div(TRANSITION_CELLS.blinds)).lessThan(p));
        const wipe = covered(uv.x.lessThan(p));
        const curtain = covered(abs(uv.x.sub(0.5)).mul(2).greaterThan(float(1).sub(p)));
        const mosaic = clamp(p.sub(0.6).div(0.4), 0, 1);
        const pick = (id: number, v: any, rest: any) => select(k.equal(id), v, rest);
        const cover = pick(
          KIND_ID.fade,
          fade,
          pick(KIND_ID.iris, iris, pick(KIND_ID.diamonds, diamonds, pick(KIND_ID.dissolve, dissolve, pick(KIND_ID.dither, dither, pick(KIND_ID.blinds, blinds, pick(KIND_ID.wipe, wipe, pick(KIND_ID.curtain, curtain, pick(KIND_ID.mosaic, mosaic, float(0))))))))),
        );
        const flashColor: any = this.uFlashColor;
        const coverColor: any = this.uColor;
        const flashed = mix(out.rgb, flashColor, this.uFlash);
        out.assign(vec4(mix(flashed, coverColor, cover), out.a));
      });
      return out;
    })();
  }

  // ------------------------------------------------------------------ internals

  private run(kind: TransitionKind, to: 0 | 1, o: TransitionOptions): Promise<boolean> {
    this.finishPending(false);
    if (kind !== this.kind && to === 1) this.progress = 0; // a new kind covers from clear
    this.kind = kind;
    if (o.color !== undefined) displayColor(this.uColor.value, o.color);
    else if (to === 1) displayColor(this.uColor.value, PALETTE_INK);
    if (o.center !== undefined) this.center = o.center;
    else if (to === 1) this.center = null;
    this.from = this.progress;
    this.to = to;
    this.t = 0;
    this.duration = Math.max(0, o.duration ?? 0.45) * Math.abs(to - this.from);
    return new Promise<boolean>((resolve) => {
      this.pending = resolve;
      if (this.duration === 0) this.update(0, null);
    });
  }

  private finishPending(completed: boolean): void {
    const p = this.pending;
    this.pending = null;
    p?.(completed);
  }

  private flashAmount(): number {
    if (this.flashLeft <= 0) return 0;
    // stepped like old hardware fades: 4 levels
    return Math.ceil((this.flashLeft / this.flashDuration) * this.flashStrength * 4) / 4;
  }

  private sync(camera: Camera | null): void {
    this.uKind.value = this.kind ? KIND_ID[this.kind] : 0;
    this.uProgress.value = this.kind ? this.progress : 0;
    const c = this.center ? this.toUv(this.center, camera) : null;
    this.uCenter.value.set(c ? c[0] : 0.5, c ? c[1] : 0.5, 0, 0);
    this.uFlash.value = this.flashAmount();
    this.uActive.value = this.uKind.value > 0 || this.uFlash.value > 0 ? 1 : 0;
    this.uWarp.value = this.waves.length > 0 || this.kind === 'mosaic' ? 1 : 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[i];
      const u = this.uWaves[i]!.value;
      if (!w) {
        u.set(0.5, 0.5, 0, 0);
        continue;
      }
      const k = Math.min(1, w.t / w.duration);
      const at = this.toUv(w.center, camera) ?? [0.5, 0.5];
      // grows fast and slows (ease out), fades as it grows
      u.set(at[0], at[1], w.radius * (1 - (1 - k) * (1 - k)), w.strength * (1 - k) * (1 - k));
    }
  }

  /** A centre as screen uv (0..1 from the top-left); null when a world point is behind the camera. */
  private toUv(c: Vector3 | readonly [number, number], camera: Camera | null): [number, number] | null {
    if (!(c instanceof Vector3)) return [c[0], c[1]];
    if (!camera) return null;
    const v = this.tmp.copy(c).project(camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2, (1 - v.y) / 2];
  }
}

/**
 * Whether an art pixel is covered by a transition: the same rules as the shader, on the CPU
 * (unit tests, tools). `x, y` art pixel, `w, h` art size, `center` uv.
 */
export function coversPixel(kind: TransitionKind, progress: number, x: number, y: number, w: number, h: number, center: readonly [number, number] = [0.5, 0.5]): number {
  const p = progress;
  const u = (x + 0.5) / w;
  switch (kind) {
    case 'fade':
      return Math.floor(p * 5) / 5;
    case 'iris': {
      const cx = center[0] * w;
      const cy = center[1] * h;
      const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
      return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > (1 - p) * reach ? 1 : 0;
    }
    case 'diamonds': {
      const d = TRANSITION_CELLS.diamonds;
      const lx = (((x + 0.5) / d) % 1) * 2 - 1;
      const ly = (((y + 0.5) / d) % 1) * 2 - 1;
      const sweep = ((Math.floor(x / d) + 0.5) * d) / w;
      const q = Math.min(1, Math.max(0, p * 2.2 - sweep * 1.2));
      return Math.abs(lx) + Math.abs(ly) < q * 2.01 ? 1 : 0;
    }
    case 'blinds':
      return ((y + 0.5) / TRANSITION_CELLS.blinds) % 1 < p ? 1 : 0;
    case 'wipe':
      return u < p ? 1 : 0;
    case 'curtain':
      return Math.abs(u - 0.5) * 2 > 1 - p ? 1 : 0;
    case 'mosaic':
      return Math.min(1, Math.max(0, (p - 0.6) / 0.4));
    case 'dither': {
      const b2 = (ax: number, ay: number) => (((ax / 2 + ay * ay * 0.75) % 1) + 1) % 1;
      const t = b2(Math.floor(x / 2), Math.floor(y / 2)) * 0.25 + b2(x, y);
      return t < p * 1.0001 ? 1 : 0;
    }
    case 'dissolve':
      // the shader's hash isn't reproduced here: covered pixels grow with p on average
      return p >= 1 ? 1 : p <= 0 ? 0 : p;
  }
}
