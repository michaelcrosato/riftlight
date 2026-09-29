import { OrthographicCamera, Vector3 } from 'three/webgpu';
import { type Resolution, snapToGrid, worldUnitsPerPixel } from './framing';

export interface FollowCameraOptions {
  /** Visible world height in units. Fixed, so framing is identical at every resolution. */
  viewHeight?: number;
  /** Degrees below the horizon (classic 3/4 view ≈ 30–35). */
  pitch?: number;
  /** Degrees around Y (45 = isometric-style diagonal). */
  yaw?: number;
  /** Distance from the target along the view direction. */
  distance?: number;
  /** Follow smoothing; higher is snappier. */
  stiffness?: number;
}

/**
 * Orthographic follow camera for 16:9 pixel-art framing.
 *
 * With `snap` on, the camera position is quantized to whole art pixels in its own view
 * plane so static geometry doesn't crawl/shimmer as the camera moves. This is
 * presentation-only: the target (and all physics) stay continuous. The same snapped
 * camera is used in Raw 3D mode, so switching modes never moves the view.
 */
export class FollowCamera {
  readonly camera: OrthographicCamera;
  readonly viewHeight: number;
  readonly focus = new Vector3();
  snap = true;
  private readonly offset: Vector3;
  private readonly stiffness: number;
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly forward = new Vector3();
  private readonly tmp = new Vector3();

  constructor(options: FollowCameraOptions = {}) {
    const { viewHeight = 13.5, pitch = 32, yaw = 45, distance = 30, stiffness = 6 } = options;
    this.viewHeight = viewHeight;
    this.stiffness = stiffness;
    const aspect = 16 / 9;
    const h = viewHeight / 2;
    this.camera = new OrthographicCamera(-h * aspect, h * aspect, h, -h, 1, distance * 2);
    const p = (pitch * Math.PI) / 180;
    const y = (yaw * Math.PI) / 180;
    this.offset = new Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(distance);
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.forward.setFromMatrixColumn(this.camera.matrixWorld, 2);
  }

  /** Jump straight to a target (no smoothing). */
  teleport(target: Vector3): void {
    this.focus.copy(target);
  }

  /** Screen-relative movement basis on the ground plane: [right, forward]. */
  groundBasis(): { right: Vector3; forward: Vector3 } {
    const right = new Vector3(this.right.x, 0, this.right.z).normalize();
    const forward = new Vector3(-this.forward.x, 0, -this.forward.z).normalize();
    return { right, forward };
  }

  update(target: Vector3, dt: number, resolution: Resolution): void {
    const k = 1 - Math.exp(-this.stiffness * dt);
    this.focus.lerp(target, k);

    const pos = this.tmp.copy(this.focus);
    if (this.snap) {
      // Express focus in camera axes, round the in-plane components to art pixels.
      const px = worldUnitsPerPixel(this.viewHeight, resolution);
      const r = snapToGrid(pos.dot(this.right), px);
      const u = snapToGrid(pos.dot(this.up), px);
      const f = pos.dot(this.forward);
      pos.copy(this.right).multiplyScalar(r).addScaledVector(this.up, u).addScaledVector(this.forward, f);
    }
    this.camera.position.copy(pos).add(this.offset);
    this.camera.updateMatrixWorld();
  }
}
