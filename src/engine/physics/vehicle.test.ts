import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three/webgpu';
import { Physics } from './Physics';
import { Vehicle } from './vehicle';

const DT = 1 / 60;
async function yard() {
  const p = await Physics.create();
  p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [100, 0.5, 100] });
  return p;
}
const yaw = (car: Vehicle) => {
  const r = car.body.rotation();
  return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
};

describe('Vehicle', () => {
  it('sits on its springs, then drives forward under throttle', async () => {
    const p = await yard();
    const car = new Vehicle(p, { at: [0, 1, 0] });
    for (let i = 0; i < 60; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: 0, steer: 0, brake: true }, dt));
    const rest = car.body.translation().y;
    expect(rest).toBeGreaterThan(0.3);
    expect(rest).toBeLessThan(1);
    for (let i = 0; i < 180; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: 1, steer: 0 }, dt));

    expect(car.speed).toBeGreaterThan(8);
    expect(car.body.translation().z).toBeGreaterThan(5); // yaw 0 drives toward +Z
    expect(Math.abs(car.body.translation().x)).toBeLessThan(1);
  });

  it('steers, and the handbrake makes the rear slide', async () => {
    const p = await yard();
    const run = async (handbrake: boolean) => {
      const car = new Vehicle(p, { at: [handbrake ? 50 : -50, 1, 0] });
      for (let i = 0; i < 150; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: 1, steer: 0 }, dt));
      let slip = 0;
      const y0 = yaw(car);

      for (let i = 0; i < 60; i++)
        p.update(DT + 1e-9, (dt) => {
          car.drive({ throttle: 0.6, steer: 1, handbrake }, dt);
          slip = Math.max(slip, car.slipAngle);
        });

      return { slip, turned: Math.abs(yaw(car) - y0) };
    };
    const grip = await run(false);
    const drift = await run(true);

    expect(grip.turned).toBeGreaterThan(0.3);
    expect(grip.slip).toBeLessThan(0.25); // gripping: under 15°
    expect(drift.slip).toBeGreaterThan(0.45); // drifting: the tail out past 25°
  });

  it('is freed by physics.clear() (a level unload)', async () => {
    const p = await yard();
    const car = new Vehicle(p, { at: [0, 1, 0] });
    expect(p.world.vehicleControllers.size).toBe(1);
    p.clear();
    expect(p.world.vehicleControllers.size).toBe(0);
    void car;
    p.update(DT + 1e-9); // steps fine afterwards
  });

  it('steer +1 turns right (clockwise seen from above), and its wheels sit on the ground', async () => {
    const p = await yard();
    const car = new Vehicle(p, { at: [0, 1, 0] });
    for (let i = 0; i < 90; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: 1, steer: 0 }, dt));
    const y0 = car.yaw;
    for (let i = 0; i < 30; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: 0.5, steer: 1 }, dt));
    expect(car.yaw - y0).toBeLessThan(-0.1); // heading toward +Z, right is −X: the yaw goes down
    const pos = new Vector3();
    const rot = new Quaternion();
    for (let i = 0; i < 4; i++) {
      car.wheelPose(i, pos, rot);
      expect(pos.y, `wheel ${i}`).toBeCloseTo(car.o.wheelRadius, 1);
    }
  });

  it('parked for a long while, it drives off without a jump', async () => {
    const p = await yard();
    const car = new Vehicle(p, { at: [0, 1, 0] });
    for (let i = 0; i < 600; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: 0, steer: 0 }, dt));
    const rest = car.body.translation().y;
    expect(Math.abs(car.speed)).toBeLessThan(0.05);
    let top = rest;
    for (let i = 0; i < 120; i++) {
      p.update(DT + 1e-9, (dt) => car.drive({ throttle: 1, steer: 0 }, dt));
      top = Math.max(top, car.body.translation().y);
    }
    expect(top).toBeLessThan(rest + 0.1);
  });

  it('tops out at topSpeed; throttle against the motion brakes at full strength; reset clears it', async () => {
    const p = await yard();
    const car = new Vehicle(p, { at: [0, 1, 0], topSpeed: 6 });
    for (let i = 0; i < 300; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: 1, steer: 0.3 }, dt));
    expect(car.speed).toBeLessThan(6.3);
    expect(car.speed).toBeGreaterThan(4);
    const before = car.speed;
    for (let i = 0; i < 30; i++) p.update(DT + 1e-9, (dt) => car.drive({ throttle: -1, steer: 0 }, dt));
    expect(car.speed).toBeLessThan(before - 2); // half a second of reverse throttle sheds over 2 m/s
    car.reset([0, 1, 0]);
    expect([car.steering, car.slip, car.slipAngle]).toEqual([0, 0, 0]);
  });
});
