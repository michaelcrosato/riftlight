import { describe, expect, it } from 'vitest';
import { type Camera, Object3D, OrthographicCamera, PerspectiveCamera, Plane, RenderTarget, Scene, Vector3, Vector4, WebGLCoordinateSystem, WebGPUCoordinateSystem, type WebGPURenderer } from 'three/webgpu';
import { Mirror, mirrorCamera } from './mirror';
import { RenderView } from './renderView';

/** A mirror on the plane z = -5, facing +z (the room is at z > -5). */
const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 0, 1), new Vector3(0, 0, -5));

const cameras = (): [string, Camera][] => {
  const out: [string, Camera][] = [];
  for (const [label, system] of [
    ['WebGL', WebGLCoordinateSystem],
    ['WebGPU', WebGPUCoordinateSystem],
  ] as const) {
    const persp = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    persp.position.set(3, 4, 6);
    persp.lookAt(0, 1, -5);
    const ortho = new OrthographicCamera(-8, 8, 4.5, -4.5, 1, 200);
    ortho.position.set(20, 20, 20);
    ortho.lookAt(0, 0, -2);
    for (const c of [persp, ortho]) {
      c.coordinateSystem = system;
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
    }
    out.push([`perspective, ${label}`, persp], [`orthographic, ${label}`, ortho]);
  }
  return out;
};

/** Clip-space position of world point `p` through `cam`. */
const clip = (cam: Camera, p: Vector3) => new Vector4(p.x, p.y, p.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
const inDepth = (cam: Camera, c: Vector4) => (cam.coordinateSystem === WebGPUCoordinateSystem ? c.z >= -1e-6 && c.z <= c.w + 1e-6 : c.z >= -c.w - 1e-6 && c.z <= c.w + 1e-6);

describe('mirrorCamera', () => {
  it('puts the camera at its reflection in the glass', () => {
    for (const [name, cam] of cameras()) {
      const v = mirrorCamera(cam, cam.clone(), plane);
      const at = new Vector3().setFromMatrixPosition(v.matrixWorld);
      const want = new Vector3().setFromMatrixPosition(cam.matrixWorld);
      want.z = -10 - want.z;
      expect(at.distanceTo(want), name).toBeLessThan(1e-6);
    }
  });

  it('draws what is in front of the glass and cuts away what is behind it', () => {
    for (const [name, cam] of cameras()) {
      const v = mirrorCamera(cam, cam.clone(), plane);
      for (const p of [new Vector3(1, 1, -2), new Vector3(-2, 0.5, -4.5), new Vector3(0, 2, 0)]) expect(inDepth(v, clip(v, p)), `${name}: in front ${p.toArray()}`).toBe(true);
      for (const p of [new Vector3(1, 1, -5.5), new Vector3(-1, 0.5, -8)]) expect(inDepth(v, clip(v, p)), `${name}: behind ${p.toArray()}`).toBe(false);
    }
  });

  it('sees a point where the main camera sees its reflection in the glass, mirrored left to right', () => {
    for (const [name, cam] of cameras()) {
      const v = mirrorCamera(cam, cam.clone(), plane);
      for (const p of [new Vector3(1, 1, -2), new Vector3(-2, 2, -3)]) {
        const a = clip(v, p);
        const reflected = p.clone();
        reflected.z = -10 - reflected.z;
        const b = clip(cam, reflected);
        expect(a.x / a.w, name).toBeCloseTo(-(b.x / b.w), 5); // so the glass reads it at screenUV.flipX()
        expect(a.y / a.w, name).toBeCloseTo(b.y / b.w, 5);
      }
    }
  });

  it('copies the camera without its children and keeps its own matrices up to date', () => {
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    cam.position.set(3, 4, 6);
    cam.lookAt(0, 1, -5);
    cam.updateMatrixWorld();
    cam.add(new Object3D()); // a first-person weapon
    cam.matrixAutoUpdate = cam.matrixWorldAutoUpdate = false;
    const v = cam.clone().clear();
    for (let i = 0; i < 3; i++) mirrorCamera(cam, v, plane);
    expect(v.children).toHaveLength(0);
    expect(v.matrixAutoUpdate && v.matrixWorldAutoUpdate).toBe(true);
    expect(new Vector3().setFromMatrixPosition(v.matrixWorld).distanceTo(new Vector3(3, 4, -16))).toBeLessThan(1e-6);
  });
});

/** A renderer stand-in whose render throws, to see the target put back. */
const throwing = () => {
  const previous = new RenderTarget(4, 4);
  let current: RenderTarget | null = previous;
  const r = {
    getRenderTarget: () => current,
    setRenderTarget: (t: RenderTarget | null) => (current = t),
    render: () => {
      throw new Error('lost');
    },
  };
  return { renderer: r as unknown as WebGPURenderer, previous, current: () => current };
};

describe('views that throw', () => {
  it('put the render target back, so the frame does not draw into them', () => {
    const view = throwing();
    expect(() => new RenderView().render(view.renderer, new Scene())).toThrow('lost');
    expect(view.current()).toBe(view.previous);
    const glass = throwing();
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    cam.position.set(0, 1, 5); // in front of the glass (it faces +z at the origin)
    expect(() => new Mirror().render(glass.renderer, new Scene(), cam, 32, 18)).toThrow('lost');
    expect(glass.current()).toBe(glass.previous);
  });
});
