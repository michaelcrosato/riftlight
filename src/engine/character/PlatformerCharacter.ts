import { type AnimationClip, MathUtils, type Object3D, type Quaternion, Vector3 } from 'three/webgpu';
import type { FootPlacementState, GroundHit, GroundProbe } from '../animation/footPlacement';
import type { RigSpec } from '../animation/types';
import { type Physics, RAPIER } from '../physics/Physics';
import { type AnimRequest, Animator, type ProceduralInput } from './animator';
import { angleDiff, approach, turnToward } from './motion';
import { feetMode, type MoveState, startEmote, startHurt, startJump, stateDef } from './states';
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
  readonly stats = { jumps: 0, landings: 0, ledgeGrabs: 0, pullUps: 0, pushes: 0, pulls: 0, hurts: 0 };
  /** Seconds left in which hits are ignored (after `hurt`). Games can blink the model meanwhile. */
  invulnerable = 0;
  /**
   * Something worth looking at (world position), set by the game: a coin, an enemy, a sign.
   * Standing and walking, the head turns toward it (within its limits); null = look where
   * the character is going.
   */
  lookAt: Vector3 | null = null;

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
  /** @internal 1 while the stick is gently tilted (tiptoe), 0 when pushed further; kept when let go. */ tiptoe = 0;
  /** @internal Where the stick points (yaw), or the facing when it's let go: the head looks there. */ heading = 0;
  /** @internal How hard the last landing was (0..1, from the fall speed): the landing squash. */ landImpact = 0;
  /** @internal The current skid is a brake (stick let go at a run), not a turn-around. */ braking = false;
  /** @internal Turning round after a skid: from this facing to that one. */ turnFrom = 0;
  /** @internal Leaning on a wall or a stuck crate (PushIdle). */ leaning = false;
  /** @internal The wall being slid down (out of it, horizontal). */ readonly wallNormal = new Vector3();
  /** @internal */ turnTo = 0;
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

  private animator: Animator | null = null;
  /** Ground rays for foot placement (no garbage per frame). */
  private readonly groundProbe: GroundProbe = (x, y, z, maxDown, out: GroundHit) => this.physics.castDown(x, y, z, maxDown, out, IGNORE, this.body);
  /** Procedural layers' inputs, reused every frame, and what they remember between frames. */
  private readonly procedural: ProceduralInput = { lean: { roll: 0, pitch: 0 }, look: 0, impact: 0, feet: { ik: false, lock: false, speed: 0 } };
  /** Foot placement as it was before the last fixed step (see fixedUpdate). */
  private readonly feetBefore = { ik: false, lock: false };
  private lastYaw: number | null = null;
  private lastVisualSpeed = 0;
  private accel = 0;
  private impactTime = Infinity;
  private impactStrength = 0;
  private seenLandings = 0;

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

  /**
   * Get hit: knocked back away from `fromDirection` (where the hit came from, e.g. enemy
   * position minus hero position; only its horizontal part counts) in an arc, playing Hurt,
   * with no control for ~0.4 s, then invulnerable for a moment (`invulnerable`). `strength`
   * scales the knockback. Lets go of ledges, walls and blocks. Returns false (and does
   * nothing) while still invulnerable.
   */
  hurt(fromDirection: Vector3, strength = 1): boolean {
    if (this.invulnerable > 0) return false;
    startHurt(this, fromDirection, strength);
    return true;
  }

  /** Celebrate (games call this, e.g. on level complete). */
  celebrate(): void {
    if (this.grounded && !this.isAirborne()) startEmote(this, 'Victory');
  }

  // ------------------------------------------------------------------ main step

  fixedUpdate(dt: number, input: MoveInput): void {
    // what the feet were doing where this step starts: the model is drawn between there and
    // where it ends (render interpolation), so foot placement follows whichever is closer
    this.feetBefore.ik = this.feetIK();
    this.feetBefore.lock = feetMode(this) === 'lock';
    this.clock += dt;
    this.stateTime += dt;
    this.ledgeCooldown = Math.max(0, this.ledgeCooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.feetInto(this.prevFeet);
    this.heading = this.facing;
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

  /** @internal Ground straight under the middle of the feet (not just under the capsule's rim). */
  supported(): boolean {
    return !!this.ray(this.probe(P.groundUp), DOWN, P.groundUp + P.supportDown);
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

  /**
   * @internal Mario-style: turn facing toward the stick, speed builds along facing. Without
   * `accel` / `turnRate` (walking and running) both depend on the speed (tuning.ts `ground`):
   * quick off the mark, building to full speed over ~0.65 s, turning wider the faster it goes.
   */
  groundMove(dt: number, input: MoveInput, maxSpeed: number, accel?: number, turnRate?: number): void {
    const G = T.ground;
    const mag = Math.min(1, input.move.length());
    if (input.face) {
      const target = this.tmpVec.copy(input.move).setY(0).multiplyScalar(maxSpeed);
      this.hvel.lerp(target, 1 - Math.exp(-G.strafeResponse * dt));
      return;
    }
    let speed = this.speed + this.wallSlip;
    const u = Math.min(1, speed / this.runSpeed);
    if (mag > G.deadzone) {
      const want = Math.atan2(input.move.x, input.move.z);
      this.heading = want;
      let rate = turnRate ?? G.turnRate + (G.turnRateTop - G.turnRate) * u;
      if (speed < G.slowTurnSpeed) rate *= G.slowTurnBoost;
      this.facing = turnToward(this.facing, want, rate * dt);
      // the stick's tilt is squared (Mario 64): a gentle tilt is a slow tiptoe
      const target = maxSpeed * mag ** G.stickCurve;
      const a = accel ?? G.accel + (G.accelTop - G.accel) * u;
      speed = approach(speed, target, (speed > target ? (accel ?? G.brake) : a) * dt);
    } else {
      speed = approach(speed, 0, (accel === undefined ? G.brake : accel * G.brakeFactor) * dt);
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
    // On the ground, snapping keeps the feet down; pushing the capsule into the floor as well
    // made Rapier's KCC stall for a step every ~20 steps (no movement: a hitch). Gravity still
    // pulls when nothing is under the middle of the body (perched on an edge: slide off it).
    if (gravity && !def.airborne) this.vy = this.grounded && this.supported() ? 0 : Math.min(this.vy, 0) + T.gravity * dt;
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

  /**
   * Drive `model` with `clips`. Call again (e.g. on hot reload) to swap the clip set. With
   * the model's `rig`, the procedural layers run too: foot placement on the real ground,
   * leaning into turns, looking ahead, landing squash (docs/ANIMATION.md).
   */
  attachModel(model: Object3D, clips: readonly AnimationClip[], rig?: RigSpec): void {
    this.animator?.dispose();
    this.animator = new Animator(model, clips, restRotations(model), {
      rig,
      probe: this.groundProbe,
      feet: T.feet,
      layers: T.layers,
      gait: T.gait,
    });
    this.lastYaw = null;
    this.animator.play({ name: 'Idle' }, 0);
  }

  /** Tooling: every clip currently contributing to the pose, with its blend weight and time (s). */
  animationMix(): { name: string; weight: number; time: number; rate: number }[] {
    return this.animator?.mix() ?? [];
  }

  /** Tooling: what foot placement did this frame (weight, pelvis drop, per-foot offsets and locks). */
  footPlacement(): FootPlacementState | null {
    return this.animator?.feet?.state() ?? null;
  }

  clipDuration(name: string, fallback: number): number {
    return this.animator?.duration(name) ?? fallback;
  }

  /** @internal Playback rate that makes a locomotion clip's feet match ground speed `s`. */
  rate(name: string, s: number, authored: number, min = 0.3): number {
    const speed = this.animator?.authoredSpeed(name) ?? authored;
    return Math.max(min, s / Math.abs(speed));
  }

  /** Name of the clip the current state wants (the table's `anim`). */
  animationFor(): AnimRequest {
    return stateDef(this.state).anim(this);
  }

  /** Per render frame: orient the model, pick and advance animation, then the procedural layers. */
  updateVisual(model: Object3D, dt: number, alpha: number): void {
    this.interpolatedFeet(alpha, model.position);
    let diff = this.facing - model.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const snap = stateDef(this.state).snapFacing === true;
    model.rotation.y += snap ? diff : diff * Math.min(1, dt * T.visual.turnRate);
    const a = this.animationFor();
    const anim = this.animator;
    if (!anim) {
      this.anim = a.name;
      return;
    }
    anim.play(a, a.fade ?? T.visual.fade);
    this.anim = anim.dominant(a);
    anim.update(dt, this.proceduralInput(model, dt, alpha));
  }

  /** Foot placement on: a state with feet, on the ground (through brief no-ground moments: autosteps, edges). */
  private feetIK(): boolean {
    return !!feetMode(this) && (this.grounded || this.coyote < T.ground.coyote || this.state === 'jump');
  }

  /** The procedural layers' inputs for this frame (numbers in tuning.ts `visual`). */
  private proceduralInput(model: Object3D, dt: number, alpha: number): ProceduralInput {
    const V = T.visual;
    const def = stateDef(this.state);
    const p = this.procedural;
    const k = (rate: number) => (dt > 0 ? 1 - Math.exp(-rate * dt) : 0);
    // turn rate of the model and acceleration of the body, render frame to render frame
    const yaw = model.rotation.y;
    const yawRate = this.lastYaw === null || dt <= 0 ? 0 : angleDiff(yaw, this.lastYaw) / dt;
    this.lastYaw = yaw;
    const speed = this.speed;
    if (dt > 0) this.accel += ((speed - this.lastVisualSpeed) / dt - this.accel) * k(V.accelSmoothing);
    this.lastVisualSpeed = speed;
    // lean into turns (roll toward the inside) and into acceleration
    const lean = def.lean === true && this.grounded;
    const roll = lean ? MathUtils.clamp(-yawRate * speed * V.leanRoll, -V.maxRoll, V.maxRoll) : 0;
    const pitch = lean ? MathUtils.clamp(this.accel * V.leanAccel, -V.maxPitch, V.maxPitch) : 0;
    p.lean.roll += (roll - p.lean.roll) * k(V.leanRate);
    p.lean.pitch += (pitch - p.lean.pitch) * k(V.leanRate);
    // look where it's going (or at what the game points out)
    let look = 0;
    const feet = feetMode(this);
    if (feet && this.stance === 'stand') {
      let want = this.heading;
      if (this.lookAt) want = Math.atan2(this.lookAt.x - model.position.x, this.lookAt.z - model.position.z);
      look = MathUtils.clamp(angleDiff(want, yaw) * MathUtils.RAD2DEG, -V.maxLook, V.maxLook);
    }
    p.look += (look - p.look) * k(V.lookRate);
    // landing on the move: a quick squash, no lock
    if (this.stats.landings !== this.seenLandings) {
      this.seenLandings = this.stats.landings;
      if (this.state === 'walk' || this.state === 'run') {
        this.impactTime = 0;
        this.impactStrength = this.landImpact;
      }
    }
    this.impactTime += dt;
    const t = this.impactTime;
    p.impact = feet && this.grounded ? this.impactStrength * (t < V.impactRise ? smooth(t / V.impactRise) : 1 - smooth((t - V.impactRise) / V.impactFall)) : 0;
    // the model is drawn closer to where the last fixed step started, or where it ended: a
    // landing (or a launch) shows on the frame the drawn feet reach (or leave) the ground
    const before = alpha < 0.5;
    p.feet.ik = before ? this.feetBefore.ik : this.feetIK();
    p.feet.lock = before ? this.feetBefore.lock : feet === 'lock';
    p.feet.speed = speed;
    return p;
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
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
