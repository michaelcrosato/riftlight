import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { CAMERA_PRESETS, FirstPersonRig, FreeRig, OrthoRig, ThirdPersonRig, createCameraRig } from './camera';
import { RESOLUTIONS } from './framing';

const fakeInput = (over: Partial<Record<string, unknown>> = {}) =>
  ({ wheel: 0, mouseDelta: { x: 0, y: 0 }, isDown: () => false, wasPressed: () => false, moveAxis: () => ({ x: 0, y: 0 }), ...over }) as never;

const update = (rig: ReturnType<typeof createCameraRig>, over: Partial<Record<string, unknown>> = {}) =>
  rig.update({ target: new Vector3(), eye: new Vector3(0, 1.5, 0), dt: 1 / 60, resolution: RESOLUTIONS.default, input: fakeInput(over), world: {} });

describe('camera presets', () => {
  it('creates every preset', () => {
    for (const preset of CAMERA_PRESETS) expect(createCameraRig({ preset }).preset).toBe(preset);
  });

  it('zoom clamps and applies to ortho presets; first person ignores it', () => {
    const iso = createCameraRig({ preset: 'iso' }) as OrthoRig;
    const h = iso.camera.top;
    iso.setZoom(2);
    expect(iso.camera.top).toBeCloseTo(h / 2);
    iso.setZoom(100);
    expect(iso.zoom).toBe(iso.maxZoom);
    const first = createCameraRig({ preset: 'first' });
    first.setZoom(3);
    expect(first.zoom).toBe(1);
    expect(first.zoomable).toBe(false);
  });

  it('follows the art aspect (adaptive framing) for ortho and perspective rigs', () => {
    const iso = createCameraRig({ preset: 'iso' }) as OrthoRig;
    const h = iso.camera.top;
    expect(iso.camera.right / iso.camera.top).toBeCloseTo(16 / 9);
    iso.update({ target: new Vector3(), eye: new Vector3(), dt: 1 / 60, resolution: { width: 124, height: 270 }, input: fakeInput(), world: {} });
    expect(iso.camera.top).toBeCloseTo(h); // view height (and art-pixel size) unchanged
    expect(iso.camera.right / iso.camera.top).toBeCloseTo(124 / 270);
    iso.setZoom(2);
    expect(iso.camera.right / iso.camera.top).toBeCloseTo(124 / 270);
    const third = createCameraRig({ preset: 'third' }) as ThirdPersonRig;
    third.setAspect(584 / 270);
    expect(third.camera.aspect).toBeCloseTo(584 / 270);
  });

  it('mouse wheel zooms', () => {
    const rig = createCameraRig({ preset: 'topdown' });
    update(rig, { wheel: -3 });
    expect(rig.zoom).toBeGreaterThan(1.3);
  });

  it('top-down looks straight down with screen-up = world -Z', () => {
    const rig = createCameraRig({ preset: 'topdown' });
    update(rig);
    const dir = new Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
    expect(dir.y).toBeCloseTo(-1);
    const { forward, right } = rig.groundBasis();
    expect(forward.z).toBeCloseTo(-1);
    expect(right.x).toBeCloseTo(1);
  });

  it('side view looks along -Z and locks the depth lane', () => {
    const rig = createCameraRig({ preset: 'side' });
    update(rig);
    expect(rig.lockDepth).toBe(true);
    expect(rig.groundBasis().right.x).toBeCloseTo(1);
  });

  it('third person keeps its distance divided by zoom and faces the target', () => {
    const rig = createCameraRig({ preset: 'third', distance: 8 }) as ThirdPersonRig;
    rig.teleport(new Vector3());
    for (let i = 0; i < 300; i++) update(rig);
    expect(rig.camera.position.length()).toBeCloseTo(8, 1);
    rig.setZoom(2);
    for (let i = 0; i < 300; i++) update(rig);
    expect(rig.camera.position.length()).toBeCloseTo(4, 1);
  });

  it('first person strafes relative to its yaw', () => {
    const rig = createCameraRig({ preset: 'first', yaw: 90 }) as FirstPersonRig;
    const { forward } = rig.groundBasis();
    expect(forward.x).toBeCloseTo(-1);
    expect(rig.hidesTarget).toBe(true);
  });

  it('free camera fixes into a config that round-trips as a fixed preset', () => {
    const free = createCameraRig({ preset: 'free', position: [3, 5, 9], target: [0, 1, 0] }) as FreeRig;
    expect(free.controlsCharacter).toBe(false);
    let emitted: unknown = null;
    free.onFix = (c) => (emitted = c);
    free.setFixed(true);
    expect(free.controlsCharacter).toBe(true);
    const config = free.fixedConfig();
    expect(emitted).toEqual(config);
    const fixed = createCameraRig(config) as FreeRig;
    expect(fixed.preset).toBe('fixed');
    expect(fixed.camera.position.toArray()).toEqual([3, 5, 9]);
    const a = new Vector3(0, 0, -1).applyEuler(free.camera.rotation);
    const b = new Vector3(0, 0, -1).applyEuler(fixed.camera.rotation);
    expect(a.distanceTo(b)).toBeLessThan(1e-3);
  });
});

describe('screen shake', () => {
  const at = (rig: ReturnType<typeof createCameraRig>, shake: Vector3 | undefined) => {
    rig.update({ target: new Vector3(), eye: new Vector3(0, 1.5, 0), dt: 1 / 60, resolution: RESOLUTIONS.default, input: fakeInput(), world: {}, shake });
    return rig.camera.position.clone();
  };

  it('every preset comes back to its unshaken pose when the shake stops', () => {
    for (const preset of CAMERA_PRESETS) {
      const rig = createCameraRig({ preset, position: [3, 4, 5], target: [0, 0, 0] });
      for (let i = 0; i < 30; i++) at(rig, undefined);
      const rest = at(rig, undefined);
      let moved = 0;
      for (let i = 0; i < 20; i++) moved = Math.max(moved, at(rig, new Vector3(0.3 * Math.sin(i), 0.2, -0.25)).distanceTo(rest));
      const after = at(rig, new Vector3());
      expect(moved, preset).toBeGreaterThan(0.01);
      expect(after.distanceTo(rest), preset).toBeLessThan(1e-9);
    }
  });

  it('ortho presets shake by whole art pixels', () => {
    const rig = createCameraRig({ preset: 'iso' }) as OrthoRig;
    for (let i = 0; i < 30; i++) at(rig, undefined);
    const rest = at(rig, undefined);
    const moved = at(rig, new Vector3(0.123, 0.051, 0.07)).sub(rest);
    const px = rig.viewHeight / RESOLUTIONS.default.height;
    const right = new Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 0);
    const steps = moved.dot(right) / px;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
  });
});
