import { Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { color, float, step, uniform, uv } from 'three/tsl';
import { PALETTE } from '../palette';

const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/**
 * Classic hard-edged blob shadow that sits on the ground under a character.
 * Drawn as a TSL disc (step on distance from center) so it quantizes into a crisp
 * pixel ellipse in pixel mode. Position it with `place()` each frame.
 */
export class ContactShadow extends Mesh<PlaneGeometry, MeshBasicNodeMaterial> {
  private readonly strength = uniform(0.4);

  constructor(readonly radius = 0.45) {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    super(geometry, material);
    const dist = uv().sub(0.5).length();
    material.colorNode = color(PALETTE.ink);
    material.opacityNode = float(1).sub(step(0.5, dist)).mul(this.strength);
    this.name = 'ContactShadow';
    this.renderOrder = 1;
    this.castShadow = false;
    this.receiveShadow = false;
  }

  /**
   * @param groundY world height of the surface under the caster
   * @param height caster height above that surface (shadow shrinks and fades with height)
   */
  place(x: number, groundY: number, z: number, height: number): void {
    const t = Math.min(Math.max(height / 4, 0), 1);
    const size = this.radius * 2 * (1 - 0.5 * t);
    this.position.set(x, groundY + 0.02, z);
    this.scale.set(size, 1, size);
    this.strength.value = 0.4 * (1 - 0.6 * t);
    this.visible = height < 8;
  }
}
