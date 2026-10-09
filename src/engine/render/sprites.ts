/**
 * Pixel sprites in a 3D world (Doom's monsters, Paper Mario, Octopath's characters): flat
 * pictures that always face the camera, drawn with nearest sampling so their pixels stay
 * square, cut out by alpha (no blending), animated by flipping frames of a sheet. Many
 * sprites of one sheet are one instanced draw; each has its own position, size, frame and
 * mirror. Sheets can be drawn in code (`drawSheet`), so a game needs no image files.
 *
 *   const sheet = drawSheet({ frame: [16, 16], frames: 4 }, (g, f) => { g.fillStyle = '#f4f4f4'; g.fillRect(4, 4 + (f % 2), 8, 8); });
 *   const sprites = new SpriteBatch(sheet, { capacity: 64 });
 *   const s = sprites.spawn([0, 1, 0], { size: 1 });
 *   sprites.set(s, { frame: 2, flip: true });       // move, animate and mirror whenever
 *
 * Sprite positions are in the batch's own space: leave the batch itself unrotated and unscaled.
 */
import { CanvasTexture, InstancedBufferAttribute, InstancedMesh, MeshBasicNodeMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace, type Texture } from 'three/webgpu';
import { attribute, cameraWorldMatrix, float, positionGeometry, texture, uv, vec2, vec3, vec4 } from 'three/tsl';

export interface SpriteSheet {
  /**
   * The sheet (nearest-filtered); `drawSheet` makes one from code. Frames run left to right,
   * top to bottom, from the image's top-left; a texture with `flipY` false (a `DataTexture`)
   * holds its rows top line first.
   */
  readonly texture: Texture;
  /** Frame size in pixels and the frames across and down. */
  readonly frame: readonly [number, number];
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
}

/**
 * Draw a sheet in code: `draw(g, frame)` paints one frame into a `frame`-sized box (the
 * context is translated there and clipped). Pixel coordinates; draw with `fillRect`.
 */
export function drawSheet(o: { frame: readonly [number, number]; frames: number; cols?: number }, draw: (g: CanvasRenderingContext2D, frame: number) => void): SpriteSheet {
  const cols = o.cols ?? Math.min(o.frames, 8);
  const rows = Math.ceil(o.frames / cols);
  const canvas = document.createElement('canvas');
  canvas.width = o.frame[0] * cols;
  canvas.height = o.frame[1] * rows;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  for (let f = 0; f < o.frames; f++) {
    g.save();
    g.translate((f % cols) * o.frame[0], Math.floor(f / cols) * o.frame[1]);
    g.beginPath();
    g.rect(0, 0, o.frame[0], o.frame[1]);
    g.clip();
    draw(g, f);
    g.restore();
  }
  const tex = new CanvasTexture(canvas);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  return { texture: tex, frame: o.frame, cols, rows, frames: o.frames };
}

export interface SpriteOptions {
  /** Height in metres (the width follows the frame's aspect). Default 1. */
  size?: number;
  frame?: number;
  /** Mirror left-right (a sprite facing the other way). */
  flip?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
export class SpriteBatch extends InstancedMesh {
  readonly sheet: SpriteSheet;
  /** Per sprite: x, y, z (its bottom middle), size. */
  private readonly place: InstancedBufferAttribute;
  /** Per sprite: frame, flip (±1). */
  private readonly look: InstancedBufferAttribute;

  constructor(sheet: SpriteSheet, o: { capacity: number }) {
    const geometry = new PlaneGeometry(1, 1).translate(0, 0.5, 0); // bottom middle at the origin
    const place = new InstancedBufferAttribute(new Float32Array(o.capacity * 4), 4);
    const look = new InstancedBufferAttribute(new Float32Array(o.capacity * 2), 2);
    geometry.setAttribute('aPlace', place);
    geometry.setAttribute('aLook', look);
    const material = new MeshBasicNodeMaterial();
    super(geometry, material, o.capacity);
    this.sheet = sheet;
    this.place = place;
    this.look = look;
    this.count = 0;
    this.frustumCulled = false;
    const P = attribute('aPlace', 'vec4') as any;
    const L = attribute('aLook', 'vec2') as any;
    const aspect = sheet.frame[0] / sheet.frame[1];
    // billboard: the corners go along the camera's right and up, so the quad always faces it;
    // each is then pushed toward the camera as far as an upright figure's corner would be, so
    // sprites sort like standing figures (and a top-down camera doesn't sink them into the floor)
    const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz as any;
    const up = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz as any;
    const back = cameraWorldMatrix.mul(vec4(0, 0, 1, 0)).xyz as any;
    const g = positionGeometry as any;
    const h = g.y.mul(P.w);
    material.positionNode = P.xyz.add(right.mul(g.x.mul(P.w).mul(aspect))).add(up.mul(h)).add(back.mul(back.y.mul(h)));
    material.normalNode = vec3(0, 0, 1); // facing the camera (view space): no creases inside a sprite
    // the frame's cell of the sheet; a mirrored sprite reads its cell right to left (mirroring
    // the corners instead would turn the quad's back to the camera, and backs are culled)
    const f = L.x as any;
    const row = f.add(0.5).div(sheet.cols).floor();
    const col = f.sub(row.mul(sheet.cols));
    const u = uv().x.sub(0.5).mul(L.y).add(0.5);
    const v = sheet.texture.flipY ? float(sheet.rows - 1).sub(row).add(uv().y) : row.add(uv().y.oneMinus());
    const tex = texture(sheet.texture, vec2(col.add(u), v).mul(vec2(1 / sheet.cols, 1 / sheet.rows)));
    material.colorNode = tex.rgb;
    material.maskNode = tex.a.greaterThan(0.5);
  }

  /** A new sprite (its index), or -1 when full. */
  spawn(at: readonly [number, number, number], o: SpriteOptions = {}): number {
    if (this.count >= this.place.count) return -1;
    const i = this.count++;
    this.place.setXYZW(i, at[0], at[1], at[2], o.size ?? 1);
    this.look.setXY(i, this.wrap(o.frame ?? 0), o.flip ? -1 : 1);
    this.place.needsUpdate = this.look.needsUpdate = true;
    return i;
  }

  /** Move or change sprite `i`. */
  set(i: number, o: SpriteOptions & { at?: readonly [number, number, number] }): void {
    if (o.at) this.place.setXYZ(i, o.at[0], o.at[1], o.at[2]);
    if (o.size !== undefined) this.place.setW(i, o.size);
    if (o.frame !== undefined) this.look.setX(i, this.wrap(o.frame));
    if (o.flip !== undefined) this.look.setY(i, o.flip ? -1 : 1);
    this.place.needsUpdate = this.look.needsUpdate = true;
  }

  /** `set` without the options object, for many sprites every frame: position, then frame and mirror. */
  put(i: number, x: number, y: number, z: number, frame?: number, flip?: boolean): void {
    this.place.setXYZ(i, x, y, z);
    if (frame !== undefined) this.look.setX(i, this.wrap(frame));
    if (flip !== undefined) this.look.setY(i, flip ? -1 : 1);
    this.place.needsUpdate = this.look.needsUpdate = true;
  }

  /** Where sprite `i` stands. */
  at(i: number): [number, number, number] {
    return [this.place.getX(i), this.place.getY(i), this.place.getZ(i)];
  }

  /** A whole frame number on the sheet (negative and past-the-end frames wrap round). */
  private wrap(frame: number): number {
    const n = this.sheet.frames;
    return ((Math.floor(frame) % n) + n) % n;
  }

  /** The frame sprite `i` shows. */
  frameOf(i: number): number {
    return this.look.getX(i);
  }

  dispose(): this {
    this.geometry.dispose();
    (this.material as MeshBasicNodeMaterial).dispose();
    this.sheet.texture.dispose();
    return this;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
