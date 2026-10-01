import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  type Object3D,
  type Quaternion,
  Vector3,
} from 'three/webgpu';
import { RotationBlend } from '../animation/rotationBlend';
import { type Physics, RAPIER } from '../physics/Physics';
import { approach, turnToward } from './motion';
import { type AnimRequest, type MoveState, startEmote, startJump, stateDef } from './states';
import { TUNING as T } from './tuning';

/**
 * Mario-64-style third-person platformer character (and then some), built on Rapier's
 * kinematic character controller. Physics positions are continuous; pixel alignment is
 * presentation-only. Expects the hero rig clips from src/game/hero/clips/.
 *
 * Moves: walk / tiptoe / run / skid-turn / bonk · crouch / crouch-walk / crouch-slide ·
 * prone / crawl / get-up · lie down / sleep / get-up · sit · jump / jump-up / double /
 * triple / backflip / side-flip / long jump / wall kick · dive → belly slide · ground
 * pound · fall / land / hard landing · ledge hang / shimmy / pull-up / drop · climb
 * (tagged 'climbable') and climb over the top · push / grab / pull (tagged 'pushable'
 * or 'grabbable') · slope slide ('slippery' or steep) · teeter at edges · step up /
 * step down · punch-punch-kick combo, sweep kick, jump kick · wave, victory.
 *
 * Layout: this file is the core (body, collider, physics sweep, probes, ledge detection,
 * stance, animation playback); every state's rules live in one table in states.ts, and
 * every tuning number in tuning.ts.
 */

export type { MoveState } from './states';

export type JumpKind = 'Jump' | 'JumpUp' | 'DoubleJump' | 'TripleJump' | 'Backflip' | 'SideFlip' | 'LongJump' | 'WallKick' | 'JumpKick';

export interface MoveInput {
  /** Desired horizontal direction in world space, length 0..1. */
  move: Vector3;
  /** Walk / tiptoe modifier. */
  walk?: boolean;
  jump: boolean;
  jumpHeld: boolean;
  /** Crouch (held). */
  crouch: boolean;
  /** Crouch pressed this step (in the air: ground pound). */
  crouchPressed?: boolean;
  /** Toggle prone (pressed). */
  prone?: boolean;
  /** Toggle lying on the back (pressed). */
  lie?: boolean;
  /** Grab / pull (held). */
  grab?: boolean;
  attack?: boolean;
  wave?: boolean;
  sit?: boolean;
  /** First person: always face this direction and strafe. */
  face?: Vector3 | null;
}

export interface PlatformerOptions {
  position: [number, number, number];
  /** Side-scroller: keep the character on its starting Z lane. */
  lockDepth?: boolean;
  runSpeed?: number;
}

export type Stance = 'stand' | 'crouch' | 'prone';

export interface Ledge {
  y: number;
  normal: Vector3; // horizontal, pointing out of the wall toward the character
  point: Vector3; // wall surface point at chest height
}

const RADIUS = T.body.radius;
const HALF: Record<Stance, number> = T.body.half;
const P = T.probes;
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const IGNORE = ['character'];

export class PlatformerCharacter {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly kcc: RAPIER.KinematicCharacterController;
  state: MoveState = 'idle';
  stateTime = 0;
  jumpKind: JumpKind = 'Jump';
  /** Yaw in radians (0 = facing +Z). */
  facing = 0;
  /** Horizontal velocity (world). */
  readonly hvel = new Vector3();
  vy = 0;
  grounded = true;
  stance: Stance = 'stand';
  /** Last animation clip requested (for tests / debug UI). */
  anim = 'Idle';
  /** Counters for tests/tooling. */
  readonly stats = { jumps: 0, landings: 0, ledgeGrabs: 0, pullUps: 0, pushes: 0, pulls: 0 };

  // ---------------------------------------------------------------- state machine memory
  // Read and written by the state table (states.ts). Internal: games use the fields above.

  /** @internal */ readonly physics: Physics;
  /** @internal */ readonly runSpeed: number;
  /** @internal Feet at the start of the current fixed step. */ readonly prevFeet = new Vector3();
  /** @internal Highest feet height since last standing (fall height). */ peakY = 0;
  /** @internal */ clock = 0;
  /** @internal */ lastLandTime = -1;
  /** @internal */ lastJump: JumpKind | null = null;
  /** @internal */ idleTime = 0;
  /** @internal */ coyote = 0;
  /** @internal Seconds left on a jump pressed in the air, kept for the landing. */ jumpBuffer = 0;
  /** @internal Stick tilt (0..1) last ground step: a gentle tilt tiptoes. */ stick = 0;
  /** @internal The current skid is a brake (stick let go at a run), not a turn-around. */ braking = false;
  /** @internal */ stepAnim: { name: string; t: number } | null = null;
  /** @internal */ ledge: Ledge | null = null;
  /** @internal */ ledgeCooldown = 0;
  /** @internal */ shimmy = 0;
  /** @internal */ readonly pullFrom = new Vector3();
  /** @internal */ readonly pullTo = new Vector3();
  /** @internal */ attackStep = 0;
  /** @internal */ attackQueued = false;
  /** @internal */ lastAttackEnd = -10;
  /** @internal */ lastAttackStep = -1;
  /** @internal */ emoteClip = 'Wave';
  /** @internal */ poundDelay = 0;
  /** @internal */ block: RAPIER.RigidBody | null = null;
  /** @internal */ blockCollider: RAPIER.Collider | null = null;
  /** @internal */ grabbing = false;
  /** @internal The last move rose less than half as far as it wanted (head hit something). */ lastBonk = false;
  /** @internal Speed (m/s) the last move lost against a wall: the part of the velocity into it. */ wallHit = 0;
  /** @internal */ wallCollider: RAPIER.Collider | null = null;
  /** @internal The last wall hit was head-on (within ~30°). */ wallHeadOn = false;
  /** @internal Scratch vector for the states (read it right after filling it). */ readonly tmpVec = new Vector3();
  /** @internal Scratch vector for the states' feet probes. */ readonly tmpFeet = new Vector3();

  private laneZ: number | null;
  /**
   * Speed the last move lost sliding along a wall at a glancing angle. groundMove builds on
   * it again, so steering along a wall doesn't bleed the run away step after step; the
   * realised `speed` is still the slower slide.
   */
  private wallSlip = 0;
  private readonly collision = new RAPIER.CharacterCollision();
  // Scratch vectors for the per-step paths (see probe(), fwd()): no garbage per step.
  private readonly tmpOrigin = new Vector3();
  private readonly tmpDir = new Vector3();
  private readonly tmpProbe = new Vector3();
  private readonly tmpFwd = new Vector3();
  private readonly tmpChest = new Vector3();
  private readonly tmpWallFeet = new Vector3();
  private readonly desired = { x: 0, y: 0, z: 0 };
  private readonly nextPos = { x: 0, y: 0, z: 0 };

  private mixer: AnimationMixer | null = null;
  /** Re-blends joint rotations after the mixer, so cross-fades never flip (see RotationBlend). */
  private rotationBlend: RotationBlend | null = null;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  /**
   * Blend weights we drive ourselves. three's crossFadeFrom restarts the outgoing clip's
   * fade from full weight, so a clip that was only partly faded in snaps to 100% (a pop)
   * whenever states change faster than the fade.
   */
  private readonly fades = new Map<AnimationAction, { from: number; to: number; t: number; duration: number }>();

  constructor(physics: Physics, options: PlatformerOptions) {
    const B = T.body;
    this.physics = physics;
    this.runSpeed = options.runSpeed ?? T.ground.runSpeed;
    const [x, y0, z] = options.position;
    const y = y0 + B.spawnLift;
    this.laneZ = options.lockDepth ? z : null;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HALF.stand + RADIUS, z),
    );
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(HALF.stand, RADIUS), this.body);
    physics.tag(this.collider, 'character', 'noCamera');
    this.kcc = physics.world.createCharacterController(B.kccOffset);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(B.autostepHeight, B.autostepMinWidth, false);
    this.kcc.enableSnapToGround(B.snapToGround);
    this.kcc.setMaxSlopeClimbAngle(MathUtils.degToRad(B.maxSlopeClimbDeg));
    this.kcc.setMinSlopeSlideAngle(MathUtils.degToRad(B.minSlopeSlideDeg));
    this.kcc.setApplyImpulsesToDynamicBodies(false); // pushing is an explicit state
    this.prevFeet.set(x, y, z);
    this.peakY = y;
  }

  // ------------------------------------------------------------------ queries

  /** Feet position (bottom of the capsule). Allocates: hot paths use `feetInto`. */
  get feet(): Vector3 {
    return this.feetInto(new Vector3());
  }

  /** `feet` without allocating: writes the feet position into `target`. */
  feetInto(target: Vector3): Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y - HALF[this.stance] - RADIUS, t.z);
  }

  /** Feet between the last two fixed steps (render interpolation), into `target`. */
  interpolatedFeet(alpha: number, target = new Vector3()): Vector3 {
    return this.feetInto(target).lerpVectors(this.prevFeet, target, alpha);
  }

  /** Facing direction (horizontal, unit). Allocates: hot paths use `forwardInto`. */
  get forward(): Vector3 {
    return this.forwardInto(new Vector3());
  }

  /** `forward` without allocating. */
  forwardInto(target: Vector3): Vector3 {
    return target.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  get speed(): number {
    return Math.hypot(this.hvel.x, this.hvel.z);
  }

  /** Eye position for first-person cameras. */
  eye(alpha = 1): Vector3 {
    const E = T.body.eye;
    const eyeHeight = this.stance === 'stand' ? E.stand : this.stance === 'crouch' ? E.crouch : E.prone;
    return this.interpolatedFeet(alpha).add(new Vector3(0, eyeHeight, 0)).addScaledVector(this.forward, this.stance === 'prone' ? E.aheadProne : E.ahead);
  }

  /** Side-scroller lane lock on/off (locks to the current Z). */
  setLockDepth(on: boolean): void {
    this.laneZ = on ? this.body.translation().z : null;
  }

  teleport(position: [number, number, number]): void {
    const [x, y0, z] = position;
    const y = y0 + T.body.spawnLift;
    this.setStance('stand', true);
    this.setFeet(new Vector3(x, y, z), true);
    this.hvel.set(0, 0, 0);
    this.vy = 0;
    this.prevFeet.set(x, y, z);
    this.peakY = y;
    this.enter('idle');
  }

  /** Jump right now (no headroom: nothing happens). Normally the state machine decides. */
  jump(kind: JumpKind, input?: MoveInput): void {
    startJump(this, kind, input);
  }

  /** Celebrate (games call this, e.g. on level complete). */
  celebrate(): void {
    if (this.grounded && !this.isAirborne()) startEmote(this, 'Victory');
  }

  // ------------------------------------------------------------------ main step

  fixedUpdate(dt: number, input: MoveInput): void {
    this.clock += dt;
    this.stateTime += dt;
    this.ledgeCooldown = Math.max(0, this.ledgeCooldown - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.feetInto(this.prevFeet);
    if (this.stepAnim) {
      this.stepAnim.t -= dt;
      if (this.stepAnim.t <= 0) this.stepAnim = null;
    }
    if (input.face && input.face.lengthSq() > 0 && !stateDef(this.state).attached) {
      // First person: body always faces the view direction.
      this.facing = Math.atan2(input.face.x, input.face.z);
    }
    stateDef(this.state).step(this, dt, input);
    // Fall height is measured from the last place we stood (or the jump apex).
    if (this.grounded && !this.isAirborne()) this.peakY = this.feetY();
  }

  /** @internal Switch state (stateTime restarts on a change), with the stance it needs. */
  enter(state: MoveState): void {
    if (state !== this.state) this.stateTime = 0;
    if (state !== 'idle' && state !== 'teeter') this.idleTime = 0;
    this.state = state;
    const def = stateDef(state);
    const stance = typeof def.stance === 'function' ? def.stance(this) : def.stance;
    if (stance === 'stand' && this.stance !== 'stand') {
      if (!this.setStance('stand')) this.setStance('crouch');
    }
  }

  /** @internal In the air (the table's `airborne`): fall height keeps measuring. */
  isAirborne(): boolean {
    return stateDef(this.state).airborne === true;
  }

  /** @internal How long the current locked state lasts (the table's `lock`). */
  lockDuration(): number {
    return stateDef(this.state).lock?.(this) ?? T.lock.default;
  }

  /**
   * @internal A jump press this step, or one buffered from the last moments in the air.
   * Used by the states that jump off the ground, so a press just before touchdown still
   * chains a double or triple jump.
   */
  consumeJump(input: MoveInput): boolean {
    const pressed = input.jump || this.jumpBuffer > 0;
    this.jumpBuffer = 0;
    return pressed;
  }

  // ------------------------------------------------------------------ probes

  /** @internal */
  feetY(): number {
    return this.body.translation().y - HALF[this.stance] - RADIUS;
  }

  /** @internal Scratch: the feet raised by `dy` (a ray origin). Valid until the next probe() call. */
  probe(dy: number): Vector3 {
    this.feetInto(this.tmpProbe).y += dy;
    return this.tmpProbe;
  }

  /** @internal Scratch: the facing direction. Read-only; valid until the next fwd() call. */
  fwd(): Vector3 {
    return this.forwardInto(this.tmpFwd);
  }

  /** @internal Ray cast that ignores the character itself. */
  ray(from: Vector3, dir: Vector3, length: number): ReturnType<Physics['castRay']> {
    return this.physics.castRay(from, dir, length, IGNORE, this.body);
  }

  /** @internal Is there ground `dist` ahead of the feet? */
  groundAhead(dist: number): boolean {
    const origin = this.probe(P.groundUp).addScaledVector(this.fwd(), dist);
    return !!this.ray(origin, DOWN, P.aheadDown);
  }

  /** @internal A wall within wall-kick reach at chest height. */
  touchingWall(): boolean {
    const hit = this.ray(this.probe(P.chest), this.fwd(), RADIUS + T.air.touchWallReach);
    return !!hit && Math.abs(hit.normal.y) < P.wallY;
  }

  /** @internal Normal of the ground under the feet, if any. */
  groundNormal(): Vector3 | null {
    const hit = this.ray(this.probe(P.groundUp), DOWN, P.groundDown);
    return hit ? hit.normal : null;
  }

  /** @internal The ground under the feet is tagged 'slippery'. */
  slipperyBelow(): boolean {
    const hit = this.ray(this.probe(P.groundUp), DOWN, P.groundDown);
    return !!hit && this.physics.hasTag(hit.collider, 'slippery');
  }

  /** @internal A pushable or grabbable block within `reach` of the capsule, at knee height. */
  blockAhead(reach: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider; normal: Vector3; distance: number } | null {
    const hit = this.ray(this.probe(P.knee), this.fwd(), RADIUS + reach);
    if (!hit || Math.abs(hit.normal.y) > P.wallY) return null;
    if (!this.physics.hasTag(hit.collider, 'pushable') && !this.physics.hasTag(hit.collider, 'grabbable')) return null;
    const body = hit.collider.parent();
    return body ? { body, collider: hit.collider, normal: hit.normal.setY(0).normalize(), distance: hit.distance } : null;
  }

  /** @internal The wall hit by the last move is something to push, grab or climb (not a bonk). */
  wallIsInteractive(): boolean {
    const c = this.wallCollider;
    return !!c && ['pushable', 'grabbable', 'climbable'].some((t) => this.physics.hasTag(c, t));
  }

  /** Find a grabbable ledge in front of `feet` (facing `dir`). */
  findLedge(feet: Vector3, dir: Vector3): Ledge | null {
    const L = T.ledge;
    const chest = this.tmpChest.copy(feet);
    chest.y += L.chest;
    const wall = this.ray(chest, dir, RADIUS + L.reach);
    if (!wall || Math.abs(wall.normal.y) > P.wallY) return null;
    if (['noLedge', 'climbable', 'pushable', 'grabbable'].some((t) => this.physics.hasTag(wall.collider, t))) return null;
    const probe = wall.point.clone().addScaledVector(dir, P.ledgeIn).setY(feet.y + L.probe);
    // Nothing may overhang the wall between chest height and the probe (slabs, ceilings).
    const outside = wall.point.clone().addScaledVector(dir, -P.ledgeOut);
    if (this.ray(outside, UP, probe.y - outside.y)) return null;
    const top = this.ray(probe, DOWN, L.topReach);
    if (!top || top.normal.y < P.floorY) return null;
    const y = probe.y - top.distance;
    if (y < feet.y + L.minTop || y > feet.y + L.maxTop) return null;
    const normal = wall.normal.setY(0).normalize();
    if (!this.roomToStandOn(wall.point, normal, y)) return null;
    return { y, normal, point: wall.point };
  }

  /** @internal Crouch-height clearance where a pull-up / climb top-out would put the character. */
  roomToStandOn(wallPoint: Vector3, normal: Vector3, y: number): boolean {
    const spot = wallPoint.clone().addScaledVector(normal, -(RADIUS + P.standIn)).setY(y + P.topLift);
    const need = 2 * (HALF.crouch + RADIUS);
    const d = P.standSpread;
    for (const [dx, dz] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]] as const) {
      if (this.ray(spot.clone().add(new Vector3(dx, 0, dz)), UP, need)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ movement

  /** @internal Mario-style: turn facing toward the stick, speed builds along facing. */
  groundMove(dt: number, input: MoveInput, maxSpeed: number, accel: number, turnRate: number = T.ground.turnRate): void {
    const G = T.ground;
    const mag = Math.min(1, input.move.length());
    if (input.face) {
      const target = this.tmpVec.copy(input.move).setY(0).multiplyScalar(maxSpeed);
      this.hvel.lerp(target, 1 - Math.exp(-G.strafeResponse * dt));
      return;
    }
    let speed = this.speed + this.wallSlip;
    if (mag > G.deadzone) {
      const want = Math.atan2(input.move.x, input.move.z);
      const rate = speed < G.slowTurnSpeed ? turnRate * G.slowTurnBoost : turnRate;
      this.facing = turnToward(this.facing, want, rate * dt);
      speed = approach(speed, maxSpeed * mag, accel * dt);
    } else {
      speed = approach(speed, 0, accel * G.brakeFactor * dt);
    }
    this.hvel.copy(this.fwd()).multiplyScalar(speed);
  }

  /** @internal Slow the horizontal velocity by `rate` m/s². */
  decel(dt: number, rate: number): void {
    const s = approach(this.speed, 0, rate * dt);
    if (this.speed > 1e-4) this.hvel.setLength(s);
    else this.hvel.set(0, 0, 0);
  }

  /**
   * @internal Sweep the capsule by the current velocity with Rapier's KCC. Walls the KCC
   * slid along take away the part of the velocity that points into them, so `speed` (and
   * every decision built on it: run, skid, long and triple jumps, playback rates) is the
   * speed the character really moves at. Steps and slopes don't count as walls.
   * `gravity`: ground states pull the character down (airborne states own their vy).
   */
  move(dt: number, exclude?: RAPIER.Collider, gravity = true): void {
    const def = stateDef(this.state);
    if (gravity && !def.airborne) this.vy = Math.min(this.vy, 0) + T.gravity * dt;
    const desired = this.desired;
    desired.x = this.hvel.x * dt;
    desired.y = this.vy * dt;
    desired.z = this.hvel.z * dt;
    if (this.laneZ !== null) desired.z = (this.laneZ - this.body.translation().z) * T.ground.laneGain;
    if (def.snapToGround === false) this.kcc.disableSnapToGround();
    else this.kcc.enableSnapToGround(T.body.snapToGround);
    const predicate = exclude ? (c: RAPIER.Collider) => c.handle !== exclude.handle : undefined;
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, predicate);
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    this.lastBonk = desired.y > 0 && m.y < desired.y * 0.5;
    if (this.grounded && this.vy < 0 && !def.airborne) this.vy = 0;
    this.loseSpeedToWalls();
    const t = this.body.translation();
    const next = this.nextPos;
    next.x = t.x + m.x;
    next.y = t.y + m.y;
    next.z = t.z + m.z;
    this.body.setNextKinematicTranslation(next);
  }

  private loseSpeedToWalls(): void {
    const W = T.wall;
    this.wallHit = 0;
    this.wallCollider = null;
    this.wallSlip = 0;
    const before = this.speed;
    for (let i = 0, n = this.kcc.numComputedCollisions(); i < n; i++) {
      const c = this.kcc.computedCollision(i, this.collision);
      if (!c?.collider || Math.abs(c.normal1.y) > P.wallY) continue; // floor, ceiling or slope
      const len = Math.hypot(c.normal1.x, c.normal1.z);
      const nx = c.normal1.x / len; // out of the wall, toward the character
      const nz = c.normal1.z / len;
      const into = -(this.hvel.x * nx + this.hvel.z * nz);
      if (into <= 1e-4) continue;
      // A riser the autostep climbs is not a wall: walls still stand above step height.
      const feet = this.feetInto(this.tmpWallFeet);
      this.tmpOrigin.set(feet.x, feet.y + W.checkHeight, feet.z);
      this.tmpDir.set(-nx, 0, -nz);
      const wall = this.ray(this.tmpOrigin, this.tmpDir, RADIUS + W.checkReach);
      if (!wall || Math.abs(wall.normal.y) > P.wallY) continue;
      this.hvel.x += nx * into;
      this.hvel.z += nz * into;
      if (into > this.wallHit) {
        this.wallHit = into;
        this.wallCollider = c.collider;
      }
    }
    // Head-on (within ~30°) the wall stops you; at a glancing angle you slide along it.
    this.wallHeadOn = this.wallHit > 0 && this.wallHit >= before * W.headOnCos;
    if (this.wallHit > 0 && !this.wallHeadOn) this.wallSlip = before - this.speed;
  }

  /** @internal Put the feet at `feet` (immediately, or as the next kinematic target). */
  setFeet(feet: Vector3, immediate = false): void {
    const c = this.nextPos;
    c.x = feet.x;
    c.y = feet.y + HALF[this.stance] + RADIUS;
    c.z = feet.z;
    if (immediate) {
      this.body.setTranslation(c, true);
      this.physics.world.propagateModifiedBodyPositionsToColliders();
    }
    this.body.setNextKinematicTranslation(c);
  }

  /** Change collider height, keeping the feet planted. Growing needs headroom unless forced. */
  setStance(stance: Stance, force = false): boolean {
    if (stance === this.stance) return true;
    const feet = this.feet;
    const grow = HALF[stance] > HALF[this.stance];
    if (grow && !force) {
      const need = 2 * (HALF[stance] + RADIUS) + P.standMargin;
      const r = RADIUS * P.standRing;
      const d = r * Math.SQRT1_2;
      for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [d, d], [d, -d], [-d, d], [-d, -d]] as const) {
        const origin = feet.clone().add(new Vector3(dx, P.standStart, dz));
        if (this.ray(origin, UP, need - P.standStart)) return false;
      }
    }
    this.stance = stance;
    this.collider.setHalfHeight(HALF[stance]);
    this.setFeet(feet, true);
    return true;
  }

  // ------------------------------------------------------------------ animation

  /** Drive `model` with `clips`. Call again (e.g. on hot reload) to swap the clip set. */
  attachModel(model: Object3D, clips: readonly AnimationClip[]): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.actions.clear();
    this.fades.clear();
    this.current = null;
    this.mixer = new AnimationMixer(model);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.rotationBlend = new RotationBlend(model, this.actions.values(), restRotations(model));
    this.play('Idle', 0);
  }

  /** Tooling: every clip currently contributing to the pose, with its blend weight and time (s). */
  animationMix(): { name: string; weight: number; time: number; rate: number }[] {
    const active = [...this.actions.values()].filter((a) => a.isScheduled() && a.getEffectiveWeight() > 0.001);
    // three normalises weights that sum past 1, so report the shares it actually uses
    const total = Math.max(1, active.reduce((sum, a) => sum + a.getEffectiveWeight(), 0));
    return active.map((a) => ({ name: a.getClip().name, weight: a.getEffectiveWeight() / total, time: a.time, rate: a.getEffectiveTimeScale() }));
  }

  clipDuration(name: string, fallback: number): number {
    return this.actions.get(name)?.getClip().duration ?? fallback;
  }

  /** @internal Playback rate that makes a locomotion clip's feet match ground speed `s`. */
  rate(name: string, s: number, authored: number, min = 0.3): number {
    const speed = (this.actions.get(name)?.getClip().userData.speed as number | undefined) ?? authored;
    return Math.max(min, s / Math.abs(speed));
  }

  /** Name of the clip the current state wants (the table's `anim`). */
  animationFor(): AnimRequest {
    return stateDef(this.state).anim(this);
  }

  /** Per render frame: orient the model, pick and advance animation. */
  updateVisual(model: Object3D, dt: number, alpha: number): void {
    this.interpolatedFeet(alpha, model.position);
    let diff = this.facing - model.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const snap = stateDef(this.state).snapFacing === true;
    model.rotation.y += snap ? diff : diff * Math.min(1, dt * T.visual.turnRate);
    const a = this.animationFor();
    this.play(a.name, a.fade ?? T.visual.fade, a.speed ?? 1, a.once ?? false);
    for (const [action, f] of this.fades) {
      f.t += dt;
      const u = f.duration > 0 ? Math.min(1, f.t / f.duration) : 1;
      action.setEffectiveWeight(f.from + (f.to - f.from) * u);
      if (u < 1) continue;
      this.fades.delete(action);
      if (f.to === 0) action.stop();
    }
    this.mixer?.update(dt);
    this.rotationBlend?.apply();
  }

  private play(name: string, fade: number, speed = 1, once = false): void {
    const next = this.actions.get(name);
    this.anim = name;
    if (!next) return;
    next.timeScale = speed;
    if (next === this.current) return;
    const prev = this.current;
    // Everything else still contributing fades out from the weight it has now.
    for (const a of this.actions.values()) {
      if (a === next || !a.isScheduled()) continue;
      const w = a.getEffectiveWeight();
      if (fade > 0 && w > 0.001) this.fades.set(a, { from: w, to: 0, t: 0, duration: fade });
      else {
        this.fades.delete(a);
        a.stop();
      }
    }
    // A loop that is still fading out keeps its time (no restart); anything else starts over.
    // (a one-shot re-entered mid fade-out restarts its time but keeps its weight: dropping
    // the weight instead would leave the total under 1, which three fills with the bind pose)
    const w0 = next.isScheduled() ? next.getEffectiveWeight() : 0;
    if (once || w0 <= 0.001) {
      next.reset();
      // Locomotion → locomotion (Walk, Run, Tiptoe…): start in step with the outgoing
      // stride, so the planted foot stays the planted foot.
      const stride = (c: AnimationAction | null) => c?.getClip().userData.speed !== undefined;
      if (!once && prev && stride(prev) && stride(next)) next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
    }
    next.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.play();
    if (fade > 0 && w0 < 1) {
      next.setEffectiveWeight(w0);
      this.fades.set(next, { from: w0, to: 1, t: 0, duration: fade * (1 - w0) });
    } else {
      this.fades.delete(next);
      next.setEffectiveWeight(1);
    }
    this.current = next;
  }
}

/** Every named node's rotation the first time a model is attached: its rest pose. */
const REST_ROTATIONS = new WeakMap<Object3D, Map<string, Quaternion>>();
function restRotations(model: Object3D): Map<string, Quaternion> {
  let rest = REST_ROTATIONS.get(model);
  if (!rest) {
    rest = new Map();
    const map = rest;
    model.traverse((o) => {
      if (o.name && !map.has(o.name)) map.set(o.name, o.quaternion.clone());
    });
    REST_ROTATIONS.set(model, rest);
  }
  return rest;
}
