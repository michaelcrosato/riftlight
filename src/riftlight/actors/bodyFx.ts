import { type Material, type Mesh, type Object3D, Vector3 } from 'three/webgpu';
import type { Rng } from '../core/rng';

type Emissive = Material & { emissive?: { setRGB(r: number, g: number, b: number): void }; emissiveIntensity?: number; dissolve?: number };

/**
 * Juice on an actor's body: a white hit flash (an emissive pulse), and for monsters a
 * "ragdoll pop" death: thrown up and away with a tumble, a bounce, then a retro flicker out.
 *
 * Toon materials are shared by colour across the whole scene, so the first flash gives this
 * body its own material copies (only once, and only for bodies that ever get hit); `dispose`
 * frees them.
 */
export class BodyFx {
  private clones: Emissive[] | null = null;
  private flashLeft = 0;
  private flashTime = 0;
  private lit = false;
  /** A standing emissive tint (curses): RGB 0..1 × strength, under the hit flash. */
  private tintRgb: [number, number, number] | null = null;
  // ragdoll
  private ragdoll: { v: Vector3; spin: Vector3; ground: number; t: number; bounces: number } | null = null;
  ragdollDone = false;
  /** Seconds of flicker after the body comes to rest. */
  static readonly FLICKER = 0.45;
  static readonly REST = 0.35;

  constructor(private readonly body: Object3D) {}

  /**
   * Pixel dissolve, 0 (solid) → 1 (gone), on materials made with `dissolve: true` (monster
   * bodies): a per-art-pixel noise eats the body with a glowing front. Returns false when the
   * body has none (the caller hides it another way).
   */
  dissolve(amount: number): boolean {
    this.ensureClones();
    let any = false;
    for (const m of this.clones!) {
      if (m.dissolve === undefined) continue;
      m.dissolve = Math.min(1, Math.max(0, amount));
      any = true;
    }
    return any;
  }

  /** White flash for `seconds`. */
  flash(seconds = 0.08): void {
    this.ensureClones();
    this.flashLeft = this.flashTime = seconds;
  }

  /**
   * A standing tint (a cursed monster glows in the curse's colour): `color` (hex) at strength
   * `k` (emissive 0..1), or null to clear. The hit flash still wins while it runs.
   */
  tint(color: number | null, k = 0.3): void {
    if (color === null) {
      if (!this.tintRgb) return;
      this.tintRgb = null;
      if (!this.flashLeft) this.setEmissive(0);
      return;
    }
    this.ensureClones();
    this.tintRgb = [(((color >> 16) & 255) / 255) * k, (((color >> 8) & 255) / 255) * k, ((color & 255) / 255) * k];
  }

  get tinted(): boolean {
    return this.tintRgb !== null;
  }

  get flashing(): boolean {
    return this.flashLeft > 0;
  }

  /** Throw the body (death): `impulse` is the last knockback, so it flies the way it was hit. */
  pop(impulse: Vector3, rng: Rng): void {
    const v = new Vector3(impulse.x * 0.5, 0, impulse.z * 0.5);
    v.x += rng.range(-1, 1);
    v.z += rng.range(-1, 1);
    v.y = rng.range(4.5, 6);
    const spin = new Vector3(rng.range(-9, 9), rng.range(-6, 6), rng.range(-9, 9));
    this.ragdoll = { v, spin, ground: this.body.position.y, t: 0, bounces: 0 };
    this.flash(0.12);
  }

  update(dt: number): void {
    if (this.flashLeft > 0) {
      this.flashLeft = Math.max(0, this.flashLeft - dt);
      const k = this.flashLeft > 0 ? 0.6 + 0.4 * (this.flashLeft / this.flashTime) : 0;
      this.setEmissive(k);
    } else if (this.tintRgb) this.setEmissiveRgb(...this.tintRgb);
    else if (this.lit) this.setEmissive(0);
    const r = this.ragdoll;
    if (!r || this.ragdollDone) return;
    r.t += dt;
    const p = this.body.position;
    if (r.bounces < 2) {
      r.v.y -= 22 * dt;
      p.addScaledVector(r.v, dt);
      this.body.rotation.x += r.spin.x * dt;
      this.body.rotation.y += r.spin.y * dt;
      this.body.rotation.z += r.spin.z * dt;
      if (p.y <= r.ground && r.v.y < 0) {
        p.y = r.ground;
        r.v.multiplyScalar(0.35);
        r.v.y = -r.v.y;
        r.spin.multiplyScalar(0.4);
        r.bounces++;
        if (r.bounces >= 2) r.t = 0;
      }
      return;
    }
    // at rest: flicker out (every other 2-frame slice hidden), then gone
    if (r.t < BodyFx.REST) return;
    const f = r.t - BodyFx.REST;
    this.body.visible = Math.floor(f * 30) % 2 === 0;
    if (f >= BodyFx.FLICKER) {
      this.body.visible = false;
      this.ragdollDone = true;
    }
  }

  private ensureClones(): void {
    if (this.clones) return;
    this.clones = [];
    const own = new Map<Material, Emissive>();
    this.body.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || o.userData.noFlash) return;
      const copy = (m: Material): Material => {
        let c = own.get(m);
        if (!c) {
          c = m.clone() as Emissive;
          c.userData = { ...m.userData, shared: false };
          // per-material properties a node graph reads by reference (Material.copy skips them)
          if ((m as Emissive).dissolve !== undefined) c.dissolve = 0;
          own.set(m, c);
          this.clones!.push(c);
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
    });
  }

  private setEmissive(k: number): void {
    this.setEmissiveRgb(k, k, k * 0.9);
  }

  private setEmissiveRgb(r: number, g: number, b: number): void {
    if (!this.clones) return;
    for (const m of this.clones) m.emissive?.setRGB(r, g, b);
    this.lit = r > 0 || g > 0 || b > 0;
  }

  dispose(): void {
    for (const m of this.clones ?? []) m.dispose();
    this.clones = null;
  }
}
