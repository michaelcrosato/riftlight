/**
 * A water surface you can disturb, drawn in the engine's look: a subdivided plane whose
 * vertices ride the same travelling waves `physics/water.ts` sums on the CPU (so floating
 * things bob exactly with the drawn surface), plus a ripple field (a 2D wave equation on the
 * CPU, uploaded as a small float texture) that a wading hero, a splash or rain dents. Toon
 * shaded from the waves' own normals, lighter on crests, white foam where it is high, sun
 * glints as hard pixels, and optionally see-through by ordered dither (no blending, no sort).
 *
 *   const ripples = new RippleField({ size: [12, 8], cells: [96, 64], center: [0, 2] });
 *   const water = new WaterSurface({ size: [12, 8], at: [0, 0.5, 2], waves: WAVES_CALM, ripples, opacity: 0.75 });
 *   scene.add(water);
 *   // per frame: water.update(physics.time, engine.sunDir)
 *   const y = water.heightAt(x, z);          // the drawn surface's height there
 */
import { DataTexture, FloatType, Mesh, NearestFilter, PlaneGeometry, RedFormat, Vector2, type Vector3 } from 'three/webgpu';
import { color, cos, dot, float, floor, Fn, fract, max, mix, normalize, normalWorld, positionLocal, pow, screenCoordinate, sin, smoothstep, step, texture, transformNormalToView, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import { type RippleField, type Wave, waterHeight } from '../physics/water';
import { toonMaterial } from './toon';

/** Waves the shader sums (more are ignored). */
export const MAX_WAVES = 4;

export interface WaterOptions {
  /** Width (x) and depth (z) of the surface, m. */
  size: readonly [number, number];
  /** Centre of the surface at rest. */
  at: readonly [number, number, number];
  /** Grid quads along x and z (default: one per ripple cell, or 4 per metre without ripples). */
  segments?: readonly [number, number];
  waves?: readonly Wave[];
  /** A ripple field covering the same rectangle (its size and centre must match). */
  ripples?: RippleField | null;
  /** Colours (hex): troughs, crests, foam. */
  deep?: number;
  shallow?: number;
  foam?: number;
  /** Height above rest (m) where foam starts. Default: 75% of the waves' combined height (the tallest crests). */
  foamAt?: number;
  /** 1: opaque; less: see-through by a 4×4 ordered dither per art pixel. */
  opacity?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
export class WaterSurface extends Mesh {
  readonly size: readonly [number, number];
  waves: Wave[];
  readonly ripples: RippleField | null;
  private readonly uTime = uniform(0);
  /** Where the surface is (x, z): waves are in world space, so a moved surface stays in step. */
  private readonly uOrigin = uniform(new Vector2()) as any;
  private shown: Wave[] = [];
  private readonly uWave = Array.from({ length: MAX_WAVES }, () => uniform(vec4(0, 0, 0, 0)) as any);
  private readonly uOmega = Array.from({ length: MAX_WAVES }, () => uniform(0));
  private readonly uSun = uniform(vec3(0.4, 0.8, 0.3)) as any;
  readonly uOpacity = uniform(1);
  readonly uFoamAt = uniform(0.1);
  private readonly rippleTex: DataTexture | null;
  private readonly rippleData: Float32Array | null;
  private time = 0;
  private readonly autoFoam: boolean;

  constructor(o: WaterOptions) {
    const [w, d] = o.size;
    const seg = o.segments ?? (o.ripples ? [o.ripples.cols, o.ripples.rows] : [Math.max(4, Math.round(w * 4)), Math.max(4, Math.round(d * 4))]);
    const geometry = new PlaneGeometry(w, d, seg[0], seg[1]).rotateX(-Math.PI / 2);
    const material = toonMaterial(o.deep ?? 0x3b5dc9).clone();
    material.userData.shared = false;
    super(geometry, material);
    this.size = o.size;
    this.position.set(o.at[0], o.at[1], o.at[2]);
    (this.uOrigin.value as Vector2).set(o.at[0], o.at[2]);
    this.receiveShadow = true;
    this.waves = [...(o.waves ?? [])];
    this.ripples = o.ripples ?? null;
    this.uOpacity.value = o.opacity ?? 1;
    this.autoFoam = o.foamAt === undefined;
    this.uFoamAt.value = o.foamAt ?? 0.1;
    // the ripple heights as a texture (nearest: a cell is a few art pixels anyway)
    if (this.ripples) {
      this.rippleData = new Float32Array(this.ripples.cols * this.ripples.rows);
      this.rippleTex = new DataTexture(this.rippleData, this.ripples.cols, this.ripples.rows, RedFormat, FloatType);
      this.rippleTex.magFilter = this.rippleTex.minFilter = NearestFilter;
      this.rippleTex.generateMipmaps = false;
      this.rippleTex.needsUpdate = true;
    } else {
      this.rippleTex = null;
      this.rippleData = null;
    }
    this.setWaves(this.waves);
    // the ripple texture lives inside the shader graph, where unloading can't find it
    material.addEventListener('dispose', () => this.rippleTex?.dispose());

    // ---- vertex: the waves (and their slopes) at this point, plus the ripples
    const wave = Fn(() => {
      const p = positionLocal.xz.add(this.uOrigin) as any;
      let h: any = float(0);
      let dx: any = float(0);
      let dz: any = float(0);
      for (let i = 0; i < MAX_WAVES; i++) {
        const W = this.uWave[i];
        const phase = W.z.mul(W.x.mul(p.x).add(W.y.mul(p.y))).sub(this.uOmega[i]!.mul(this.uTime));
        h = h.add(W.w.mul(sin(phase)));
        const slope = W.w.mul(W.z).mul(cos(phase));
        dx = dx.add(slope.mul(W.x));
        dz = dz.add(slope.mul(W.y));
      }
      if (this.rippleTex && this.ripples) {
        const tex = this.rippleTex;
        const du = 1 / this.ripples.cols;
        const dv = 1 / this.ripples.rows;
        // plane uv runs +x and −z (rotated): the field's rows run +z
        const at = vec2(uv().x, float(1).sub(uv().y));
        const r = texture(tex, at).r;
        const rx = texture(tex, at.add(vec2(du, 0))).r.sub(texture(tex, at.sub(vec2(du, 0))).r).div((2 * this.ripples.width) / this.ripples.cols);
        const rz = texture(tex, at.add(vec2(0, dv))).r.sub(texture(tex, at.sub(vec2(0, dv))).r).div((2 * this.ripples.depth) / this.ripples.rows);
        h = h.add(r);
        dx = dx.add(rx);
        dz = dz.add(rz);
      }
      return vec4(dx, h, dz, 0);
    });
    const wv = wave() as any;
    const v = varying(wv, 'vWave') as any;
    material.positionNode = positionLocal.add(vec3(0, wv.y, 0));
    const n = normalize(vec3(v.x.negate(), 1, v.z.negate()));
    material.normalNode = transformNormalToView(n);
    // ---- colour: troughs to crests, foam on the highest, hard sun glints
    const deep = color(o.deep ?? 0x3b5dc9);
    const shallow = color(o.shallow ?? 0x41a6f6);
    const foam = color(o.foam ?? 0xf4f4f4);
    const crest = smoothstep(float(-0.6).mul(this.uFoamAt), this.uFoamAt, v.y);
    const base = mix(deep, shallow, floor(crest.mul(3)).div(2).min(1)); // three steps, like the toon bands
    material.colorNode = mix(base, foam, step(this.uFoamAt, v.y));
    const half = normalize(this.uSun.add(vec3(0, 1, 0)));
    const glint = step(0.985, pow(max(dot(normalWorld, half), 0), 2));
    (material as unknown as { emissiveNode: unknown }).emissiveNode = foam.mul(glint.mul(0.8));
    // ---- see-through: keep pixels by a 4×4 Bayer pattern (per art pixel: the pipeline draws at art size)
    const a = floor(screenCoordinate.xy) as any;
    const b2 = (q: any) => fract(q.x.div(2).add(q.y.mul(q.y).mul(0.75)));
    const bayer = b2(floor(a.mul(0.5))).mul(0.25).add(b2(a));
    material.maskNode = bayer.lessThan(this.uOpacity);
  }

  /** Change the waves (up to MAX_WAVES; the CPU height follows too). */
  setWaves(waves: readonly Wave[]): void {
    this.waves = [...waves];
    this.shown = this.waves.slice(0, MAX_WAVES);
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = waves[i];
      const k = w ? (2 * Math.PI) / w.length : 0;
      (this.uWave[i].value as { set(x: number, y: number, z: number, w: number): void }).set(w?.dir[0] ?? 0, w?.dir[1] ?? 0, k, w?.amplitude ?? 0);
      this.uOmega[i]!.value = w ? k * w.speed : 0;
    }
    if (this.autoFoam) this.uFoamAt.value = Math.max(0.02, 0.75 * waves.slice(0, MAX_WAVES).reduce((a, w) => a + w.amplitude, 0));
  }

  /** Per frame: the waves' clock (use physics time: floaters read the same), the ripples, the sun. */
  update(time: number, sun?: Vector3): void {
    this.time = time;
    this.uTime.value = time;
    (this.uOrigin.value as Vector2).set(this.position.x, this.position.z);
    if (sun) (this.uSun.value as Vector3).copy(sun);
    if (this.rippleTex && this.rippleData && this.ripples) {
      this.rippleData.set(this.ripples.h);
      this.rippleTex.needsUpdate = true;
    }
  }

  /** World height of the drawn surface at (x, z) (waves and ripples), at the last `update` time or `t`. */
  heightAt(x: number, z: number, t = this.time): number {
    return this.position.y + waterHeight(this.shown, x, z, t) + (this.ripples?.heightAt(x, z) ?? 0);
  }

  /** Is (x, z) over this water? */
  covers(x: number, z: number): boolean {
    return Math.abs(x - this.position.x) <= this.size[0] / 2 && Math.abs(z - this.position.z) <= this.size[1] / 2;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.material as { dispose(): void }).dispose(); // and the ripple texture with it
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
