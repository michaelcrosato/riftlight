/**
 * A flat mirror: before each frame a camera reflected in the mirror's plane draws the scene
 * into a texture at the art resolution, and the glass shows it at each pixel's screen position
 * (mirrored left to right), so the reflection lines up from wherever the camera looks. An
 * oblique near plane (Lengyel) on that camera cuts away everything behind the glass; it works
 * for orthographic cameras (the iso view) as well as perspective ones, on WebGPU and WebGL 2.
 *
 *   const mirror = new Mirror({ size: [8, 3] });
 *   mirror.mesh.position.set(0, 1.8, -6.9);              // the glass faces its local +z
 *   scene.add(mirror.mesh);
 *   const stop = mirror.attach(engine.renderer, scene);  // renders before each frame
 *
 * The glass is on `SCREEN_LAYER`, so neither it nor other screens appear in the reflection.
 */
import {
  type Camera,
  HalfFloatType,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  type OrthographicCamera,
  type PerspectiveCamera,
  Plane,
  PlaneGeometry,
  RenderTarget,
  type Scene,
  Vector3,
  Vector4,
  WebGPUCoordinateSystem,
  type WebGPURenderer,
} from 'three/webgpu';
import { color, mix, screenUV, texture, uniform } from 'three/tsl';
import { SCREEN_LAYER } from './renderView';

export interface MirrorOptions {
  /** Width and height of the glass (m). Default [4, 2]. */
  size?: readonly [number, number];
  /** A colour the reflection leans toward, and how much (0..1). Default a faint blue, 0.15. */
  tint?: number;
  tintAmount?: number;
}

const _normal = new Vector3();
const _point = new Vector3();
const _camPos = new Vector3();
const _target = new Vector3();
const _look = new Vector3();
const _up = new Vector3();
const _plane = new Plane();
const _plane2 = new Plane();
const _inv = new Matrix4();
const _clip = new Vector4();
const _q = new Vector4();

/**
 * Set `virtual` to `camera` reflected in `plane` (world space, its normal toward the side that
 * is seen): the position, the way it looks and its up reflected (a proper rotation: the picture
 * comes out mirrored left to right), and an oblique near plane on the mirror plane, so nothing
 * behind it is drawn. Orthographic or perspective, either depth range. Returns `virtual`.
 */
export function mirrorCamera<T extends Camera>(camera: Camera, virtual: T, plane: Plane): T {
  const v = virtual as unknown as PerspectiveCamera | OrthographicCamera;
  v.copy(camera as never, false); // not its children (a first-person weapon would pile up)
  v.matrixAutoUpdate = v.matrixWorldAutoUpdate = true; // its own matrices, whatever the camera's
  v.layers.set(0);
  camera.updateMatrixWorld();
  const reflect = (p: Vector3) => p.sub(_normal.copy(plane.normal).multiplyScalar(2 * plane.distanceToPoint(p)));
  _camPos.setFromMatrixPosition(camera.matrixWorld);
  _look.set(0, 0, -1).transformDirection(camera.matrixWorld);
  _up.set(0, 1, 0).transformDirection(camera.matrixWorld);
  _target.copy(_camPos).add(_look);
  reflect(_target);
  reflect(_camPos);
  _up.reflect(plane.normal);
  v.position.copy(_camPos);
  v.up.copy(_up);
  v.lookAt(_target);
  v.updateMatrixWorld();

  // oblique near plane (Lengyel): the mirror's plane, in camera space, replaces the near plane
  _plane2.copy(plane).applyMatrix4(v.matrixWorldInverse);
  _clip.set(_plane2.normal.x, _plane2.normal.y, _plane2.normal.z, _plane2.constant);
  const P = v.projectionMatrix;
  // the far corner of the view volume on the clip plane's side, back in camera space
  _q.set(Math.sign(_clip.x), Math.sign(_clip.y), 1, 1).applyMatrix4(_inv.copy(P).invert());
  const e = P.elements;
  if (v.coordinateSystem === WebGPUCoordinateSystem) {
    // depth 0..1: the third row is the plane itself, scaled so that corner stays at depth 1
    _clip.multiplyScalar(1 / _clip.dot(_q));
    e[2] = _clip.x;
    e[6] = _clip.y;
    e[10] = _clip.z;
    e[14] = _clip.w;
  } else {
    // depth -1..1: the third row is twice the scaled plane less the fourth row
    _clip.multiplyScalar(2 / _clip.dot(_q));
    e[2] = _clip.x - e[3]!;
    e[6] = _clip.y - e[7]!;
    e[10] = _clip.z - e[11]!;
    e[14] = _clip.w - e[15]!;
  }
  v.projectionMatrixInverse.copy(P).invert();
  return virtual;
}

export class Mirror {
  readonly mesh: Mesh;
  readonly target: RenderTarget;
  /** False: the glass shows plain glass and nothing is rendered for it. */
  enabled = true;
  /** Times it has rendered. */
  renders = 0;
  private virtual: Camera | null = null;
  private readonly material: MeshBasicNodeMaterial;
  private readonly on = uniform(1);

  constructor(o: MirrorOptions = {}) {
    const [w, h] = o.size ?? [4, 2];
    this.target = new RenderTarget(1, 1, { depthBuffer: true, type: HalfFloatType }); // linear colour: 8 bits would band the darks
    this.target.texture.minFilter = this.target.texture.magFilter = NearestFilter;
    this.material = new MeshBasicNodeMaterial();
    // the reflected camera's picture is mirrored left to right: read it flipped
    const seen = texture(this.target.texture, screenUV.flipX());
    const tinted = mix(seen.rgb, color(o.tint ?? 0x41a6f6), o.tintAmount ?? 0.15);
    this.material.colorNode = mix(color(0x29366f), tinted, this.on);
    this.mesh = new Mesh(new PlaneGeometry(w, h), this.material);
    this.mesh.layers.set(SCREEN_LAYER);
  }

  /**
   * Reflect `camera` in the glass and draw `scene` from there into the texture (sized
   * `width` x `height`, the art resolution). Skipped when the camera is behind the glass.
   */
  render(renderer: WebGPURenderer, scene: Scene, camera: Camera, width: number, height: number): boolean {
    this.on.value = this.enabled ? 1 : 0;
    if (!this.enabled) return false;
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    this.mesh.updateMatrixWorld();
    camera.updateMatrixWorld();
    _point.setFromMatrixPosition(this.mesh.matrixWorld);
    _normal.set(0, 0, 1).transformDirection(this.mesh.matrixWorld);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    if (_camPos.clone().sub(_point).dot(_normal) <= 0) return false; // looking at its back

    // a camera of the same kind, reflected in the glass, its near plane the glass
    if (!this.virtual || this.virtual.type !== camera.type) this.virtual = camera.clone().clear(); // no children: copied without them each frame
    _plane.setFromNormalAndCoplanarPoint(_normal, _point);
    const v = mirrorCamera(camera, this.virtual, _plane);

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    try {
      renderer.render(scene, v);
    } finally {
      renderer.setRenderTarget(previous); // even if it threw: the frame must not draw into the mirror
    }
    this.renders++;
    return true;
  }

  /** Render before every frame of `pixel` (the engine's PixelRenderer), from its camera, at its art size. Returns a stop. */
  attach(pixel: { onBeforeRender(f: () => void): () => void; renderer: WebGPURenderer; activeCamera: Camera; resolution: { width: number; height: number } }, scene: Scene): () => void {
    return pixel.onBeforeRender(() => this.render(pixel.renderer, scene, pixel.activeCamera, pixel.resolution.width, pixel.resolution.height));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
