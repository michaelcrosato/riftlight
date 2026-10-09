/**
 * Motion trails: a ribbon through the last points something passed (a sword's tip, a dash, a
 * comet), facing the camera, tapering and fading from its colour to its tail colour as the
 * points age. One mesh, its vertices rebuilt each frame (a few dozen points), unlit, drawn in
 * stepped colour bands so it stays pixel art.
 *
 *   const trail = new Trail({ points: 24, width: 0.35, life: 0.35, color: PALETTE.sand, tail: PALETTE.orange });
 *   scene.add(trail);
 *   // per frame: trail.push(tip, t); trail.update(t, camera)
 */
import { BufferAttribute, BufferGeometry, type Camera, Color, Mesh, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { attribute, floor, mix, uniform } from 'three/tsl';

export interface TrailOptions {
  /** Most points kept. Default 24. */
  points?: number;
  /** Width at the head (m). */
  width?: number;
  /** Seconds a point lasts. Default 0.35. */
  life?: number;
  /** Head and tail colours (hex). */
  color?: number;
  tail?: number;
  /** A new point only after moving this far (m). Default 0.05. */
  minStep?: number;
}

export class Trail extends Mesh<BufferGeometry, MeshBasicNodeMaterial> {
  readonly capacity: number;
  width: number;
  life: number;
  private readonly minStep: number;
  private readonly pts: { p: Vector3; t: number }[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  /** Head and tail colours (live: `trail.head.setHex(...)`). */
  readonly head: Color;
  readonly tail: Color;
  private readonly view = new Vector3();
  private readonly tan = new Vector3();
  private readonly side = new Vector3();

  constructor(o: TrailOptions = {}) {
    const n = o.points ?? 24;
    const geometry = new BufferGeometry();
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2); // per vertex: 0 the tail colour … 1 the head colour
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('trailMix', new BufferAttribute(col, 1));
    const index: number[] = [];
    for (let i = 0; i + 1 < n; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    const material = new MeshBasicNodeMaterial();
    material.side = 2; // DoubleSide
    // tail to head in four steps of the blend (a pixel-art gradient, never off-palette black)
    const f = attribute('trailMix', 'float');
    const head = uniform(new Color(o.color ?? 0xffcd75));
    const tail = uniform(new Color(o.tail ?? o.color ?? 0xef7d57));
    material.colorNode = mix(tail, head, floor(f.mul(4)).div(3).min(1));
    super(geometry, material);
    this.capacity = n;
    this.width = o.width ?? 0.3;
    this.life = o.life ?? 0.35;
    this.minStep = o.minStep ?? 0.05;
    this.head = head.value as Color;
    this.tail = tail.value as Color;
    this.pos = pos;
    this.col = col;
    this.frustumCulled = false;
    this.visible = false; // nothing to draw until it has two points
  }

  /** The trail's newest point (call every frame while it moves). */
  push(p: Vector3, time: number): void {
    const last = this.pts[this.pts.length - 1];
    if (last && last.p.distanceTo(p) < this.minStep) {
      last.t = time;
      return;
    }
    this.pts.push({ p: p.clone(), t: time });
    if (this.pts.length > this.capacity) this.pts.shift();
  }

  /** Drop every point. */
  reset(): void {
    this.pts.length = 0;
    this.geometry.setDrawRange(0, 0);
    this.visible = false;
  }

  /** Points alive now. */
  get length(): number {
    return this.pts.length;
  }

  /** Per frame: forget old points, rebuild the ribbon facing `camera`. */
  update(time: number, camera: Camera): void {
    while (this.pts.length && time - this.pts[0]!.t > this.life) this.pts.shift();
    const n = this.pts.length;
    if (n < 2) {
      this.geometry.setDrawRange(0, 0);
      this.visible = false; // an empty draw is an error on some GPUs
      return;
    }
    this.visible = true;
    camera.getWorldDirection(this.view);
    for (let i = 0; i < n; i++) {
      const a = this.pts[Math.max(0, i - 1)]!.p;
      const b = this.pts[Math.min(n - 1, i + 1)]!.p;
      this.tan.subVectors(b, a);
      this.side.crossVectors(this.tan, this.view);
      if (this.side.lengthSq() < 1e-10) this.side.set(0, 1, 0);
      this.side.normalize();
      const pt = this.pts[i]!;
      const age = Math.min(1, (time - pt.t) / this.life);
      const along = i / (n - 1); // 0 tail end, 1 head
      const w = (this.width / 2) * along * (1 - age * 0.6);
      const k = i * 6;
      this.pos[k] = pt.p.x + this.side.x * w;
      this.pos[k + 1] = pt.p.y + this.side.y * w;
      this.pos[k + 2] = pt.p.z + this.side.z * w;
      this.pos[k + 3] = pt.p.x - this.side.x * w;
      this.pos[k + 4] = pt.p.y - this.side.y * w;
      this.pos[k + 5] = pt.p.z - this.side.z * w;
      const mixK = along * (1 - age);
      this.col[i * 2] = mixK;
      this.col[i * 2 + 1] = mixK;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('trailMix').needsUpdate = true;
    this.geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
