/**
 * A drivable car on Rapier's ray-cast vehicle controller: a dynamic chassis on four wheels
 * that are rays with springs (suspension), each with grip along and across it. Throttle drives
 * the rear wheels, steering turns the front ones (less at speed), the brake slows all four and
 * the handbrake locks the rear and lets them slide: a drift. Everything is tunable live.
 *
 *   const car = new Vehicle(physics, { at: [0, 1, 0] });
 *   // per fixed step: car.drive({ throttle, steer, brake, handbrake }, dt)
 *   // per frame: car.wheelPose(i, outPosition, outQuaternion) for the wheel meshes
 */
import { Quaternion, Vector3 } from 'three/webgpu';
import { type Physics, RAPIER } from './Physics';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

export interface VehicleOptions {
  at: readonly [number, number, number];
  /** Heading (radians about Y; 0 drives toward +Z). */
  yaw?: number;
  /** Chassis half extents (m). Default [0.9, 0.35, 1.8]. */
  size?: readonly [number, number, number];
  /** Chassis mass in world units. Default 8. */
  mass?: number;
  wheelRadius?: number;
  /** Suspension rest length and stiffness. */
  suspension?: number;
  stiffness?: number;
  /** Forward drive force per driven wheel at full throttle. Default 30. */
  power?: number;
  /** The engine gives out toward this speed (m/s). Default 16. */
  topSpeed?: number;
  /** Most steering angle (radians). Default 0.55. */
  steer?: number;
  /** Grip (friction slip): how much sideways force the tyres hold before sliding. Default 2.2. */
  grip?: number;
  /** Most spin (rad/s) the handbrake's drift push builds up. Default 2.4; 0 turns the assist off. */
  driftYaw?: number;
}

export interface DriveInput {
  /** -1 (reverse) … 1 */
  throttle: number;
  /** -1 (left) … 1 (right) */
  steer: number;
  brake?: boolean;
  handbrake?: boolean;
}

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly o: Required<Omit<VehicleOptions, 'at' | 'yaw'>>;
  /** Wheels' chassis-space mount points (front left, front right, rear left, rear right). */
  readonly mounts: [number, number, number][];
  /** Smoothed steering (-1..1). */
  steering = 0;
  /** How fast the car slides sideways (m/s), and the angle between where it points and where it goes (radians): drifting when high. */
  slip = 0;
  slipAngle = 0;
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly v = new Vector3();

  constructor(
    private readonly physics: Physics,
    o: VehicleOptions,
  ) {
    this.o = { size: [0.9, 0.35, 1.8], mass: 8, wheelRadius: 0.38, suspension: 0.35, stiffness: 28, power: 30, topSpeed: 16, steer: 0.55, grip: 2.2, driftYaw: 2.4, ...o };
    const [hx, hy, hz] = this.o.size;
    const yaw = o.yaw ?? 0;
    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...o.at)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.15)
        .setAngularDamping(0.8)
        .setCcdEnabled(true)
        // never asleep: the controller keeps pushing a sleeping chassis up on its springs, and
        // the stored push would launch it when it wakes
        .setCanSleep(false),
    );
    const volume = 8 * hx * hy * hz;
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setDensity(this.o.mass / volume).setFriction(0.5), this.body);
    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const r = this.o.wheelRadius;
    this.mounts = [
      [-hx + 0.05, -hy * 0.3, hz - 0.35],
      [hx - 0.05, -hy * 0.3, hz - 0.35],
      [-hx + 0.05, -hy * 0.3, -hz + 0.35],
      [hx - 0.05, -hy * 0.3, -hz + 0.35],
    ];
    for (const m of this.mounts) {
      this.controller.addWheel({ x: m[0], y: m[1], z: m[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, this.o.suspension, r);
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, this.o.stiffness);
      this.controller.setWheelMaxSuspensionTravel(i, this.o.suspension);
      this.controller.setWheelFrictionSlip(i, this.o.grip);
      this.controller.setWheelSideFrictionStiffness(i, 1);
    }
  }

  /** Spring stiffness of every wheel's suspension (live). */
  setSuspension(stiffness: number): void {
    this.o.stiffness = stiffness;
    for (let i = 0; i < 4; i++) this.controller.setWheelSuspensionStiffness(i, stiffness);
  }

  /**
   * Speed along the car's heading (m/s, negative reversing). Not Rapier's
   * `currentVehicleSpeed`, which counts the up-and-down too (the suspension holding the body up
   * against gravity every step reads as a crawl when parked).
   */
  get speed(): number {
    const lv = this.body.linvel();
    const r = this.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.v.set(0, 0, 1).applyQuaternion(this.q);
    return lv.x * this.v.x + lv.z * this.v.z;
  }

  /** One fixed step of driving. */
  drive(input: DriveInput, dt: number): void {
    const c = this.controller;
    const signed = this.speed;
    const speed = Math.abs(signed);
    // steering eases in and narrows at speed (stable at 20 m/s, nimble at 5)
    const want = Math.max(-1, Math.min(1, input.steer)) * this.o.steer * (1 / (1 + speed * 0.06));
    this.steering += (want - this.steering) * Math.min(1, dt * 8);
    c.setWheelSteering(0, -this.steering);
    c.setWheelSteering(1, -this.steering);
    // the engine gives out toward top speed, but only pushing the way the car already goes
    // (throttle against the motion slows it at full strength)
    const along = input.throttle * signed > 0;
    const force = input.throttle * this.o.power * (along ? Math.max(0, 1 - speed / this.o.topSpeed) : 1);
    // handbrake: the rear wheels lock (no drive, braked) and lose most of their sideways grip,
    // while the front still steers: the tail steps out. (A wheel with engine force is not
    // braked in Rapier's vehicle, and brakes are impulses: they scale with the car's mass.)
    const hb = input.handbrake === true;
    c.setWheelEngineForce(2, hb ? 0 : force);
    c.setWheelEngineForce(3, hb ? 0 : force);
    // an impulse per step: about 7 m/s² with all four; with no throttle, a little rolling
    // resistance, so a car left alone coasts to a stop and stays there
    const brake = input.brake ? this.o.mass * 0.03 : input.throttle === 0 ? this.o.mass * 0.002 : 0;
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      c.setWheelBrake(i, rear && hb ? this.o.mass * 0.02 : brake);
      c.setWheelFrictionSlip(i, rear && hb ? this.o.grip * 0.15 : this.o.grip);
      c.setWheelSideFrictionStiffness(i, rear && hb ? 0.05 : 1);
    }
    // the arcade part of a drift: with the rear loose, a push round toward the steering swings
    // the tail out, up to `driftYaw` (it never adds spin past that, and never takes any away)
    if (hb && speed > 3 && this.o.driftYaw > 0 && input.steer !== 0) {
      const w = this.body.angvel();
      const push = -Math.sign(input.steer) * Math.min(1, Math.abs(input.steer)) * 4 * dt;
      const next = w.y + push;
      if (Math.abs(next) <= this.o.driftYaw || Math.abs(next) < Math.abs(w.y)) this.body.setAngvel({ x: w.x, y: next, z: w.z }, true);
    }
    c.updateVehicle(dt);
    // sideways and forward speed of the chassis: how much it slides
    const lv = this.body.linvel();
    const r = this.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    this.v.set(1, 0, 0).applyQuaternion(this.q);
    this.slip = Math.abs(lv.x * this.v.x + lv.y * this.v.y + lv.z * this.v.z);
    this.v.set(0, 0, 1).applyQuaternion(this.q);
    const ahead = Math.abs(lv.x * this.v.x + lv.y * this.v.y + lv.z * this.v.z);
    this.slipAngle = this.slip + ahead > 0.5 ? Math.atan2(this.slip, ahead) : 0;
  }

  /**
   * Where wheel `i` is drawn: on its suspension, turned by steering and spin. In the world, or
   * with `local` in the chassis' own space (a wheel mesh parented to a chassis mesh that a
   * physics binding draws between steps).
   */
  wheelPose(i: number, pos: Vector3, rot: Quaternion, local = false): void {
    const c = this.controller;
    const m = this.mounts[i]!;
    const len = c.wheelSuspensionLength(i) ?? this.o.suspension;
    pos.set(m[0], m[1] - len, m[2]);
    rot.identity();
    if (!local) {
      const t = this.body.translation();
      const r = this.body.rotation();
      rot.set(r.x, r.y, r.z, r.w);
      pos.applyQuaternion(rot).add(this.v.set(t.x, t.y, t.z));
    }
    const steer = c.wheelSteering(i) ?? 0;
    const spin = c.wheelRotation(i) ?? 0;
    rot.multiply(this.q2.setFromAxisAngle(Y, steer)).multiply(this.q2.setFromAxisAngle(X, spin));
  }

  /** The chassis' heading (radians about Y; 0 drives toward +Z). */
  get yaw(): number {
    const r = this.body.rotation();
    return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.x * r.x + r.y * r.y));
  }

  /** Put it back on its wheels at `at` (a reset after a roll). */
  reset(at: readonly [number, number, number], yaw = 0): void {
    this.body.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steering = this.slip = this.slipAngle = 0;
  }

  dispose(): void {
    this.physics.world.removeVehicleController(this.controller);
    this.physics.remove(this.body);
  }
}
