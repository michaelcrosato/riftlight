import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, type Object3D, Vector3 } from 'three/webgpu';
import { type Physics, RAPIER } from './Physics';

export interface CharacterOptions {
  position: [number, number, number];
  radius?: number;
  /** Height of the cylindrical part of the capsule. */
  halfHeight?: number;
  speed?: number;
  jumpSpeed?: number;
  gravity?: number;
}

export type CharacterAnim = 'Idle' | 'Walk' | 'Jump';

/**
 * Kinematic capsule driven by Rapier's KinematicCharacterController, with classic
 * platformer affordances (coyote time, jump buffering, variable jump height).
 *
 * The body moves in continuous world space; the visual model is interpolated by
 * Physics.bind and only *looks* pixel-aligned through the render pipeline.
 */
export class CharacterController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly velocity = new Vector3();
  grounded = false;
  facing = 0;

  private readonly speed: number;
  private readonly jumpSpeed: number;
  private readonly gravity: number;
  private readonly footOffset: number;
  private readonly prevFeet = new Vector3();
  private coyote = 0;
  private jumpBuffer = 0;
  private wish = new Vector3();
  private jumpHeld = false;
  private mixer: AnimationMixer | null = null;
  private actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;

  constructor(
    physics: Physics,
    options: CharacterOptions,
  ) {
    const { radius = 0.3, halfHeight = 0.5, speed = 5, jumpSpeed = 10, gravity = -30 } = options;
    this.speed = speed;
    this.jumpSpeed = jumpSpeed;
    this.gravity = gravity;
    this.footOffset = halfHeight + radius;

    const [x, y, z] = options.position;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + this.footOffset, z),
    );
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), this.body);

    this.controller = physics.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.35, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(2);
    this.prevFeet.set(x, y, z);
  }

  /** Feet position (bottom of the capsule), continuous world space. */
  get feet(): Vector3 {
    const t = this.body.translation();
    return new Vector3(t.x, t.y - this.footOffset, t.z);
  }

  /** Feet position blended between the previous and current physics step (render use). */
  interpolatedFeet(alpha: number): Vector3 {
    return this.prevFeet.clone().lerp(this.feet, alpha);
  }

  /** Set desired horizontal move direction (world space, length ≤ 1) and jump input. */
  setInput(move: Vector3, jumpPressed: boolean, jumpHeld: boolean): void {
    this.wish.copy(move);
    if (jumpPressed) this.jumpBuffer = 0.12;
    this.jumpHeld = jumpHeld;
  }

  teleport(position: [number, number, number]): void {
    const [x, y, z] = position;
    this.body.setTranslation({ x, y: y + this.footOffset, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + this.footOffset, z });
    this.velocity.set(0, 0, 0);
    this.prevFeet.set(x, y, z);
  }

  /** Call from Physics.update's fixedUpdate callback. */
  fixedUpdate(dt: number): void {
    this.prevFeet.copy(this.feet);
    const accel = this.grounded ? 60 : 25;
    const targetX = this.wish.x * this.speed;
    const targetZ = this.wish.z * this.speed;
    this.velocity.x = approach(this.velocity.x, targetX, accel * dt);
    this.velocity.z = approach(this.velocity.z, targetZ, accel * dt);

    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = this.jumpSpeed;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
    }

    const rising = this.velocity.y > 0;
    const g = rising && !this.jumpHeld ? this.gravity * 2.2 : this.gravity; // short hop on release
    this.velocity.y = Math.max(this.velocity.y + g * dt, -30);

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (!this.grounded && moved.y < desired.y * 0.5 && this.velocity.y > 0) this.velocity.y = 0; // bonk

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z });

    if (Math.hypot(this.velocity.x, this.velocity.z) > 0.2) {
      this.facing = Math.atan2(this.velocity.x, this.velocity.z);
    }
  }

  /** Attach a model's animation clips (expects Idle / Walk / Jump). */
  attachAnimations(model: Object3D, clips: readonly AnimationClip[]): void {
    this.mixer = new AnimationMixer(model);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      if (clip.name === 'Jump') {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name, action);
    }
    this.play('Idle');
  }

  get animation(): CharacterAnim {
    return (this.current?.getClip().name as CharacterAnim | undefined) ?? 'Idle';
  }

  /** Per render frame: pick animation state and advance the mixer. */
  updateVisual(model: Object3D, dt: number): void {
    const target = this.facing;
    let diff = target - model.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    model.rotation.y += diff * Math.min(1, dt * 14);

    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.5;
    this.play(!this.grounded ? 'Jump' : moving ? 'Walk' : 'Idle');
    this.mixer?.update(dt);
  }

  private play(name: CharacterAnim): void {
    const next = this.actions.get(name);
    if (!next || next === this.current) return;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.current, 0.12, false);
    this.current = next;
  }
}

function approach(value: number, target: number, delta: number): number {
  return value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);
}
