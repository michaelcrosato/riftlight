import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  type Object3D,
  Vector3,
} from 'three/webgpu';
import { type Physics, RAPIER } from '../physics/Physics';

/**
 * Mario-64-style third-person platformer character (and then some), built on Rapier's
 * kinematic character controller. Physics positions are continuous; pixel alignment is
 * presentation-only. Expects the hero rig clips from scripts/assets/hero.mjs.
 *
 * Moves: walk / tiptoe / run / skid-turn · crouch / crouch-walk / crouch-slide ·
 * prone / crawl / get-up · lie down / sleep / get-up · sit · jump / jump-up / double /
 * triple / backflip / side-flip / long jump / wall kick · dive → belly slide · ground
 * pound · fall / land / hard landing · ledge hang / shimmy / pull-up / drop · climb
 * (tagged 'climbable') and climb over the top · push / grab / pull (tagged 'pushable'
 * or 'grabbable') · slope slide ('slippery' or steep) · teeter at edges · step up /
 * step down · punch-punch-kick combo, sweep kick, jump kick · wave, victory.
 */

export type MoveState =
  | 'idle' | 'walk' | 'run' | 'skid' | 'teeter'
  | 'crouch' | 'crouchWalk' | 'crouchSlide'
  | 'proneDown' | 'prone' | 'crawl' | 'getUpFront'
  | 'lieDown' | 'lying' | 'getUp' | 'sit'
  | 'jump' | 'fall' | 'land' | 'hardLand'
  | 'dive' | 'bellySlide' | 'groundPound' | 'groundPoundLand'
  | 'hang' | 'pullUp' | 'climb'
  | 'push' | 'grab' | 'pull'
  | 'slide' | 'attack' | 'emote' | 'bonk';

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

type Stance = 'stand' | 'crouch' | 'prone';

const RADIUS = 0.3;
const HALF: Record<Stance, number> = { stand: 0.5, crouch: 0.2, prone: 0 };
const HANG_DROP = 1.72; // feet below the ledge top while hanging
const GRAVITY = -32;
const UP = new Vector3(0, 1, 0);
const IGNORE = ['character'];
/** Spawn/teleport this far above the given feet height: starting in exact contact with the
 *  ground can leave Rapier's KCC with a degenerate contact (it stops moving). */
const SPAWN_LIFT = 0.03;
/** A jump pressed this long (s) before touchdown still jumps on landing (double/triple windows). */
const JUMP_BUFFER = 0.12;
/** Running into a wall faster than this (m/s, the part of the velocity into the wall) bonks. */
const BONK_SPEED = 5;
/** Obstacles that reach this high above the feet are walls; lower ones are steps (autostep 0.4). */
const WALL_CHECK_HEIGHT = 0.45;

interface Ledge {
  y: number;
  normal: Vector3; // horizontal, pointing out of the wall toward the character
  point: Vector3; // wall surface point at chest height
}

export class PlatformerCharacter {
  /** States whose facing is set by the wall/ledge/block, not by a first-person view. */
  private static readonly ATTACHED = new Set<MoveState>(['climb', 'hang', 'pullUp', 'push', 'grab', 'pull']);
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

  private readonly physics: Physics;
  private readonly runSpeed: number;
  private laneZ: number | null;
  private readonly prevFeet = new Vector3();
  private readonly collision = new RAPIER.CharacterCollision();
  private readonly tmpFeet = new Vector3();
  private readonly tmpOrigin = new Vector3();
  private readonly tmpDir = new Vector3();
  private peakY = 0;
  private lastLandTime = -1;
  private lastJump: JumpKind | null = null;
  private clock = 0;
  private idleTime = 0;
  private coyote = 0;
  /** Seconds left on a jump pressed in the air, kept for the landing. */
  private jumpBuffer = 0;
  private ledge: Ledge | null = null;
  private ledgeCooldown = 0;
  private pullFrom = new Vector3();
  private pullTo = new Vector3();
  private attackStep = 0;
  private attackQueued = false;
  private emoteClip = 'Wave';
  private block: RAPIER.RigidBody | null = null;
  private blockCollider: RAPIER.Collider | null = null;
  private stepAnim: { name: string; t: number } | null = null;
  /** Stick tilt (0..1) last ground step: a gentle tilt tiptoes. */
  private stick = 0;
  /** The current skid is a brake (stick let go at a run), not a turn-around. */
  private braking = false;
  private poundDelay = 0;
  private mixer: AnimationMixer | null = null;
  private readonly actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  /**
   * Blend weights we drive ourselves. three's crossFadeFrom restarts the outgoing clip's
   * fade from full weight, so a clip that was only partly faded in snaps to 100% (a pop)
   * whenever states change faster than the fade.
   */
  private readonly fades = new Map<AnimationAction, { from: number; to: number; t: number; duration: number }>();

  constructor(physics: Physics, options: PlatformerOptions) {
    this.physics = physics;
    this.runSpeed = options.runSpeed ?? 6.5;
    const [x, y0, z] = options.position;
    const y = y0 + SPAWN_LIFT;
    this.laneZ = options.lockDepth ? z : null;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HALF.stand + RADIUS, z),
    );
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(HALF.stand, RADIUS), this.body);
    physics.tag(this.collider, 'character', 'noCamera');
    this.kcc = physics.world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.4, 0.15, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle(MathUtils.degToRad(46));
    this.kcc.setMinSlopeSlideAngle(MathUtils.degToRad(40));
    this.kcc.setApplyImpulsesToDynamicBodies(false); // pushing is an explicit state
    this.prevFeet.set(x, y, z);
    this.peakY = y;
  }

  // ------------------------------------------------------------------ queries

  get feet(): Vector3 {
    return this.feetInto(new Vector3());
  }

  /** `feet` without allocating: writes the feet position into `target`. */
  feetInto(target: Vector3): Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y - HALF[this.stance] - RADIUS, t.z);
  }

  interpolatedFeet(alpha: number): Vector3 {
    return this.prevFeet.clone().lerp(this.feet, alpha);
  }

  get forward(): Vector3 {
    return new Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  get speed(): number {
    return Math.hypot(this.hvel.x, this.hvel.z);
  }

  /** Eye position for first-person cameras. */
  eye(alpha = 1): Vector3 {
    const eyeHeight = this.stance === 'stand' ? 1.45 : this.stance === 'crouch' ? 0.85 : 0.35;
    return this.interpolatedFeet(alpha).add(new Vector3(0, eyeHeight, 0)).addScaledVector(this.forward, this.stance === 'prone' ? 0.5 : 0.12);
  }

  /** Side-scroller lane lock on/off (locks to the current Z). */
  setLockDepth(on: boolean): void {
    this.laneZ = on ? this.body.translation().z : null;
  }

  teleport(position: [number, number, number]): void {
    const [x, y0, z] = position;
    const y = y0 + SPAWN_LIFT;
    this.setStance('stand', true);
    this.setFeet(new Vector3(x, y, z), true);
    this.hvel.set(0, 0, 0);
    this.vy = 0;
    this.prevFeet.set(x, y, z);
    this.peakY = y;
    this.enter('idle');
  }

  // ------------------------------------------------------------------ main step

  fixedUpdate(dt: number, input: MoveInput): void {
    this.clock += dt;
    this.stateTime += dt;
    this.ledgeCooldown = Math.max(0, this.ledgeCooldown - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.prevFeet.copy(this.feet);
    if (this.stepAnim) {
      this.stepAnim.t -= dt;
      if (this.stepAnim.t <= 0) this.stepAnim = null;
    }
    if (input.face && input.face.lengthSq() > 0 && !PlatformerCharacter.ATTACHED.has(this.state)) {
      // First person: body always faces the view direction.
      this.facing = Math.atan2(input.face.x, input.face.z);
    }

    switch (this.state) {
      case 'idle':
      case 'walk':
      case 'run':
      case 'teeter':
        this.stepGround(dt, input);
        break;
      case 'skid':
        this.stepSkid(dt, input);
        break;
      case 'crouch':
      case 'crouchWalk':
        this.stepCrouch(dt, input);
        break;
      case 'crouchSlide':
        this.decel(dt, 7);
        this.move(dt);
        if (this.consumeJump(input)) this.jump(this.speed > 3 ? 'LongJump' : 'Backflip', input);
        else if (this.speed < 0.6) this.enter(input.crouch ? 'crouch' : 'idle');
        break;
      case 'proneDown':
        this.decel(dt, 20);
        this.move(dt);
        if (this.stateTime > 0.6) this.enter('prone');
        break;
      case 'prone':
      case 'crawl':
        this.stepProne(dt, input);
        break;
      case 'getUpFront':
      case 'getUp':
      case 'land':
      case 'groundPoundLand':
      case 'hardLand':
      case 'bonk':
        if (this.state === 'land' && this.consumeJump(input)) return this.groundJump(input);
        this.decel(dt, 30);
        this.move(dt);
        if (this.stateTime > this.lockDuration()) this.enter(input.crouch && this.state !== 'hardLand' ? 'crouch' : 'idle');
        break;
      case 'lieDown':
        if (this.stance !== 'prone') this.setStance('prone');
        this.decel(dt, 30);
        this.move(dt);
        if (this.stateTime > 1.0) this.enter('lying');
        break;
      case 'lying':
        this.decel(dt, 30);
        this.move(dt);
        if (input.lie || input.jump || input.move.lengthSq() > 0.1) this.getUpFrom('back');
        break;
      case 'sit':
        this.decel(dt, 30);
        this.move(dt);
        if (input.sit || input.jump || input.move.lengthSq() > 0.1) this.enter('idle');
        else if (input.lie) this.enter('lieDown');
        break;
      case 'emote':
        this.decel(dt, 30);
        this.move(dt);
        if (this.stateTime > this.clipDuration(this.emoteClip, 1.2) || input.move.lengthSq() > 0.1 || input.jump) this.enter('idle');
        break;
      case 'attack':
        this.stepAttack(dt, input);
        break;
      case 'jump':
      case 'fall':
      case 'dive':
        this.stepAir(dt, input);
        break;
      case 'groundPound':
        this.stepGroundPound(dt);
        break;
      case 'bellySlide':
        this.decel(dt, 5);
        this.move(dt);
        if (!this.grounded) this.enter('fall');
        else if (input.jump || input.attack || this.speed < 0.5) this.enter('getUpFront');
        break;
      case 'hang':
        this.stepHang(dt, input);
        break;
      case 'pullUp':
        this.stepPullUp();
        break;
      case 'climb':
        this.stepClimb(dt, input);
        break;
      case 'push':
      case 'grab':
      case 'pull':
        this.stepBlock(dt, input);
        break;
      case 'slide':
        this.stepSlide(dt, input);
        break;
    }
    // Fall height is measured from the last place we stood (or the jump apex).
    if (this.grounded && !this.isAirborne()) this.peakY = this.feet.y;
  }

  // ------------------------------------------------------------------ ground

  private stepGround(dt: number, input: MoveInput): void {
    const mag = Math.min(1, input.move.length());
    this.stick = mag;
    if (!this.grounded) {
      this.coyote += dt;
      if (this.coyote > 0.1) return this.startFall();
    } else this.coyote = 0;

    if (this.consumeJump(input)) return this.groundJump(input);
    if (input.attack) return this.startAttack(input);
    if (input.prone) return this.goProne();
    if (input.lie) return this.enter('lieDown');
    if (input.sit) return this.enter('sit');
    if (input.wave) return this.startEmote('Wave');
    if (input.crouch) {
      if (this.speed > 4) {
        this.setStance('crouch');
        return this.enter('crouchSlide');
      }
      if (this.setStance('crouch')) return this.enter(mag > 0.1 ? 'crouchWalk' : 'crouch');
    }

    // Skid-turn when reversing at speed; brake (the same skid) when letting go at a run.
    if (!input.face && mag > 0.2 && this.speed > 4.5) {
      const want = Math.atan2(input.move.x, input.move.z);
      if (Math.abs(angleDiff(want, this.facing)) > 2.3) {
        this.braking = false;
        return this.enter('skid');
      }
    }
    // (never toward a drop: letting go near an edge stops short, as before)
    if (!input.face && mag < 0.1 && this.state === 'run' && this.speed > 5 && this.groundAhead(0.9)) {
      this.braking = true;
      return this.enter('skid');
    }

    const max = input.walk ? 2.2 : this.runSpeed;
    this.groundMove(dt, input, max, 45);

    if (this.checkClimb(input)) return;
    if (this.checkPush(input)) return;
    if (input.grab && this.checkGrab()) return;
    if (this.checkSlope()) return;

    const beforeY = this.prevFeet.y;
    this.move(dt);
    if (!this.grounded) return; // handled next step (coyote)
    if (this.wallHeadOn && this.wallHit > BONK_SPEED && !input.face && !this.wallIsInteractive()) return this.bonk();
    const dy = this.feet.y - beforeY;
    if (this.speed < 4.5 && this.speed > 0.3) {
      if (dy > 0.08) this.stepAnim = { name: 'StepUp', t: 0.25 };
      else if (dy < -0.08) this.stepAnim = { name: 'StepDown', t: 0.25 };
    }

    const s = this.speed;
    if (s < 0.3 && mag >= 0.1 && this.wallHit > 0) {
      // Walking into a wall: stand against it instead of walking on the spot.
      if (this.state !== 'idle') this.enter('idle');
      this.idleTime = 0;
    } else if (s < 0.3 && mag < 0.1) {
      if (this.state !== 'idle' && this.state !== 'teeter') this.enter('idle');
      this.idleTime += dt;
      const teeter = !this.groundAhead(0.45);
      if (teeter !== (this.state === 'teeter')) this.state = teeter ? 'teeter' : 'idle';
      if (this.idleTime > 16) this.enter('lieDown'); // dozes off, like Mario
    } else {
      this.idleTime = 0;
      const next = input.walk || s < 3.2 ? 'walk' : 'run';
      if (this.state !== next) this.state = next;
    }
  }

  private stepSkid(dt: number, input: MoveInput): void {
    // Skidding off an edge: fall, with the same grace period as walking off one.
    if (!this.grounded) {
      this.coyote += dt;
      if (this.coyote > 0.1) return this.startFall();
    } else this.coyote = 0;
    this.decel(dt, this.braking ? 28 : 18);
    if (this.braking && !this.groundAhead(0.35)) this.decel(dt, 60); // don't brake over an edge
    this.move(dt);
    const want = input.move.lengthSq() > 0.04 ? Math.atan2(input.move.x, input.move.z) : null;
    const reversing = want !== null && Math.abs(angleDiff(want, this.facing)) > 1.6;
    if (this.consumeJump(input)) {
      if (!reversing) return this.groundJump(input);
      this.facing = want;
      return this.jump('SideFlip', input);
    }
    // Braking, then pushing ahead again: run on.
    if (want !== null && !reversing) return this.enter(this.speed > 3.2 ? 'run' : 'walk');
    if (this.speed < 0.8) {
      if (want !== null) this.facing = want;
      this.enter(want !== null ? 'walk' : 'idle');
    }
  }



  private stepCrouch(dt: number, input: MoveInput): void {
    if (this.stance === 'stand') this.setStance('crouch');
    if (!this.grounded) return this.startFall();
    if (this.consumeJump(input)) return this.jump('Backflip', input);
    if (input.attack) return this.startAttack(input);
    if (input.prone) return this.goProne();
    if (!input.crouch && this.setStance('stand')) return this.enter('idle');
    const mag = input.move.length();
    this.groundMove(dt, input, 1.6, 30);
    this.move(dt);
    this.state = mag > 0.1 ? 'crouchWalk' : 'crouch';
  }

  private goProne(): void {
    if (!this.setStance('prone')) return;
    this.enter('proneDown');
  }

  private stepProne(dt: number, input: MoveInput): void {
    if (!this.grounded) return this.startFall();
    if (input.prone || input.jump) return this.getUpFrom('front');
    if (input.lie) return; // already down
    this.groundMove(dt, input, 1.0, 8, 3);
    this.move(dt);
    this.state = input.move.length() > 0.1 ? 'crawl' : 'prone';
  }

  private getUpFrom(side: 'front' | 'back'): void {
    if (!this.setStance('stand')) {
      // No headroom: crouch instead if possible, otherwise stay down.
      if (this.setStance('crouch')) this.enter('crouch');
      return;
    }
    this.enter(side === 'front' ? 'getUpFront' : 'getUp');
  }

  /** Ran into a wall at speed: stop dead and reel back (Mario's bonk). */
  private bonk(): void {
    this.hvel.set(0, 0, 0);
    this.enter('bonk');
  }

  /** The wall hit by the last move is something to push, grab or climb (not a bonk). */
  private wallIsInteractive(): boolean {
    const c = this.wallCollider;
    return !!c && ['pushable', 'grabbable', 'climbable'].some((t) => this.physics.hasTag(c, t));
  }

  private startEmote(clip: string): void {
    this.emoteClip = clip;
    this.enter('emote');
  }

  /** Celebrate (games call this, e.g. on level complete). */
  celebrate(): void {
    if (this.grounded && !this.isAirborne()) this.startEmote('Victory');
  }

  // ------------------------------------------------------------------ attacks

  private lastAttackEnd = -10;
  private lastAttackStep = -1;

  private startAttack(input: MoveInput): void {
    // Chain punch → punch → kick when the next press comes within 0.35 s of the last hit.
    const chain = !input.crouch && this.clock - this.lastAttackEnd < 0.35 && this.lastAttackStep >= 0 && this.lastAttackStep < 2;
    this.attackStep = input.crouch ? 3 : chain ? this.lastAttackStep + 1 : 0;
    this.attackQueued = false;
    this.enter('attack');
  }

  private stepAttack(dt: number, input: MoveInput): void {
    this.decel(dt, 20);
    this.move(dt);
    const clip = this.attackClip();
    if (input.attack && this.stateTime > 0.1) this.attackQueued = true;
    if (this.stateTime >= this.clipDuration(clip, 0.3)) {
      if (this.attackQueued && this.attackStep < 2) {
        this.attackStep++;
        this.attackQueued = false;
        this.stateTime = 0;
      } else {
        this.lastAttackEnd = this.clock;
        this.lastAttackStep = this.attackStep;
        this.enter(this.stance === 'crouch' ? 'crouch' : 'idle');
      }
    }
  }

  private attackClip(): string {
    return ['Punch', 'Punch2', 'Kick', 'SweepKick'][this.attackStep] ?? 'Punch';
  }

  // ------------------------------------------------------------------ jumping

  /**
   * A jump press this step, or one buffered from the last moments in the air. Used by the
   * states that jump off the ground, so a press just before touchdown still chains a
   * double or triple jump.
   */
  private consumeJump(input: MoveInput): boolean {
    const pressed = input.jump || this.jumpBuffer > 0;
    this.jumpBuffer = 0;
    return pressed;
  }

  private groundJump(input: MoveInput): void {
    const sinceLand = this.clock - this.lastLandTime;
    const moving = input.move.length() > 0.2;
    if (input.crouch && this.speed > 4) return this.jump('LongJump', input);
    if (input.crouch) return this.jump('Backflip', input);
    if (sinceLand < 0.22 && moving && this.speed > 1.5) {
      if (this.lastJump === 'Jump' || this.lastJump === 'JumpUp') return this.jump('DoubleJump', input);
      if (this.lastJump === 'DoubleJump' && this.speed > 3) return this.jump('TripleJump', input);
    }
    this.jump(moving || this.speed > 0.5 ? 'Jump' : 'JumpUp', input);
  }

  jump(kind: JumpKind, input?: MoveInput): void {
    if (!this.setStance('stand')) return; // no headroom: stay down
    const f = this.forward;
    switch (kind) {
      case 'Jump': this.vy = 10.5; break;
      case 'JumpUp': this.vy = 11.5; break;
      case 'DoubleJump': this.vy = 12.5; break;
      case 'TripleJump': this.vy = 15; this.hvel.setLength(Math.max(this.speed, 5)); break;
      case 'Backflip': this.vy = 15.5; this.hvel.copy(f).multiplyScalar(-2.2); break;
      case 'SideFlip': this.vy = 14; this.hvel.copy(f).multiplyScalar(2.5); break;
      case 'LongJump': this.vy = 7.5; this.hvel.copy(f).multiplyScalar(Math.min(this.speed * 1.5, 11)); break;
      case 'WallKick': this.vy = 12.5; this.hvel.copy(f).multiplyScalar(5); break;
      case 'JumpKick': break;
    }
    if (input?.face && (kind === 'Jump' || kind === 'JumpUp')) this.hvel.copy(input.move).multiplyScalar(this.runSpeed * 0.8).setY(0);
    this.jumpKind = kind;
    this.lastJump = kind;
    this.jumpBuffer = 0;
    this.grounded = false;
    this.peakY = this.feet.y;
    this.stats.jumps++;
    this.enter('jump');
  }

  private startFall(): void {
    this.setStance('stand'); // keep a smaller stance if there's no headroom
    this.peakY = this.feet.y;
    this.enter('fall');
  }

  private isAirborne(): boolean {
    return this.state === 'jump' || this.state === 'fall' || this.state === 'dive' || this.state === 'groundPound';
  }

  private stepAir(dt: number, input: MoveInput): void {
    // Air control: steer velocity toward input; facing follows slowly.
    const mag = Math.min(1, input.move.length());
    const noSteer = this.state === 'dive' || this.jumpKind === 'Backflip' || this.jumpKind === 'LongJump';
    if (mag > 0.1 && !noSteer) {
      const want = input.move.clone().setY(0).normalize().multiplyScalar(Math.max(this.speed, this.runSpeed * 0.7 * mag));
      this.hvel.lerp(want, 1 - Math.exp(-3 * dt));
      if (!input.face) this.facing = turnToward(this.facing, Math.atan2(input.move.x, input.move.z), 4 * dt);
    }

    // Variable jump height: releasing jump while rising cuts the arc (not for flips).
    const fixedArc = this.jumpKind === 'Backflip' || this.jumpKind === 'TripleJump' || this.jumpKind === 'SideFlip' || this.jumpKind === 'LongJump';
    const g = this.state === 'jump' && this.vy > 0 && !input.jumpHeld && !fixedArc ? GRAVITY * 2.2 : GRAVITY;
    this.vy = Math.max(this.vy + g * dt, -30);
    // Remember a press for the landing (a wall kick below uses it up instead).
    if (input.jump) this.jumpBuffer = JUMP_BUFFER;

    if (this.state !== 'dive') {
      if (input.crouchPressed && this.stateTime > 0.1) return this.startGroundPound();
      if (input.attack) {
        if (this.speed > 3 || mag > 0.5) {
          this.enter('dive');
          this.hvel.copy(this.forward).multiplyScalar(Math.min(Math.max(this.speed, 5) + 3, 10));
          this.vy = Math.max(this.vy, 3);
        } else {
          this.jumpKind = 'JumpKick';
          this.stateTime = 0;
        }
      }
      if (input.jump && this.touchingWall()) return this.wallKick();
    }

    this.peakY = Math.max(this.peakY, this.feet.y);
    const wasRising = this.vy > 0;
    this.move(dt);
    if (wasRising && this.lastBonk) this.vy = 0;
    if (this.state === 'jump' && this.vy < -6 && this.jumpKind !== 'LongJump') this.state = 'fall';

    if (this.grounded && this.vy <= 0) return this.land(input);
    if (this.vy < 3 && this.state !== 'dive' && this.ledgeCooldown === 0) {
      if (this.checkClimb(input, true)) return;
      const ledge = this.findLedge(this.feet, this.forward);
      if (ledge) this.grabLedge(ledge);
    }
  }

  private wallKick(): void {
    const hit = this.physics.castRay(this.feet.add(new Vector3(0, 1.0, 0)), this.forward, RADIUS + 0.35, IGNORE, this.body);
    if (!hit) return;
    const n = hit.normal.setY(0).normalize();
    this.facing = Math.atan2(n.x, n.z);
    this.jump('WallKick');
  }

  private touchingWall(): boolean {
    const hit = this.physics.castRay(this.feet.add(new Vector3(0, 1.0, 0)), this.forward, RADIUS + 0.3, IGNORE, this.body);
    return !!hit && Math.abs(hit.normal.y) < 0.3;
  }

  private startGroundPound(): void {
    this.enter('groundPound');
    this.poundDelay = 0.28;
    this.hvel.set(0, 0, 0);
    this.vy = 0;
  }

  private stepGroundPound(dt: number): void {
    if (this.poundDelay > 0) {
      this.poundDelay -= dt; // hang in the air for the spin
      this.vy = 0;
    } else {
      this.vy = -24;
    }
    this.move(dt);
    if (this.grounded && this.poundDelay <= 0) {
      this.stats.landings++;
      this.lastLandTime = this.clock;
      this.peakY = this.feet.y;
      this.enter('groundPoundLand');
    }
  }

  private land(input: MoveInput): void {
    const drop = this.peakY - this.feet.y;
    this.stats.landings++;
    this.lastLandTime = this.clock;
    this.vy = 0;
    this.peakY = this.feet.y;
    if (this.state === 'dive') return this.enter('bellySlide');
    if (drop > 5.5) {
      this.hvel.set(0, 0, 0);
      return this.enter('hardLand');
    }
    if (input.move.length() > 0.2) this.enter(this.speed > 3.2 ? 'run' : 'walk');
    else {
      this.hvel.multiplyScalar(0.3);
      this.enter('land');
    }
  }

  // ------------------------------------------------------------------ ledges

  /** Find a grabbable ledge in front of `feet` (facing `dir`). */
  findLedge(feet: Vector3, dir: Vector3): Ledge | null {
    const chest = feet.clone().add(new Vector3(0, 1.25, 0));
    const wall = this.physics.castRay(chest, dir, RADIUS + 0.4, IGNORE, this.body);
    if (!wall || Math.abs(wall.normal.y) > 0.3) return null;
    if (['noLedge', 'climbable', 'pushable', 'grabbable'].some((t) => this.physics.hasTag(wall.collider, t))) return null;
    const probe = wall.point.clone().addScaledVector(dir, 0.15).setY(feet.y + 2.3);
    // Nothing may overhang the wall between chest height and the probe (slabs, ceilings).
    const outside = wall.point.clone().addScaledVector(dir, -0.05);
    if (this.physics.castRay(outside, UP, probe.y - outside.y, IGNORE, this.body)) return null;
    const top = this.physics.castRay(probe, new Vector3(0, -1, 0), 1.3, IGNORE, this.body);
    if (!top || top.normal.y < 0.7) return null;
    const y = probe.y - top.distance;
    if (y < feet.y + 1.3 || y > feet.y + 2.25) return null;
    const normal = wall.normal.setY(0).normalize();
    if (!this.roomToStandOn(wall.point, normal, y)) return null;
    return { y, normal, point: wall.point };
  }

  /** Crouch-height clearance where a pull-up / climb top-out would put the character. */
  private roomToStandOn(wallPoint: Vector3, normal: Vector3, y: number): boolean {
    const spot = wallPoint.clone().addScaledVector(normal, -(RADIUS + 0.25)).setY(y + 0.05);
    const need = 2 * (HALF.crouch + RADIUS);
    for (const [dx, dz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]] as const) {
      if (this.physics.castRay(spot.clone().add(new Vector3(dx, 0, dz)), UP, need, IGNORE, this.body)) return false;
    }
    return true;
  }

  private grabLedge(ledge: Ledge): void {
    this.ledge = ledge;
    this.hvel.set(0, 0, 0);
    this.vy = 0;
    this.facing = Math.atan2(-ledge.normal.x, -ledge.normal.z);
    const feet = ledge.point.clone().addScaledVector(ledge.normal, RADIUS + 0.04).setY(ledge.y - HANG_DROP);
    this.setFeet(feet, true);
    this.stats.ledgeGrabs++;
    this.enter('hang');
  }

  private stepHang(dt: number, input: MoveInput): void {
    const ledge = this.ledge!;
    const toWall = ledge.normal.clone().negate();
    const along = new Vector3().crossVectors(UP, ledge.normal).normalize();
    const pushIn = input.move.dot(toWall);
    const side = input.move.dot(along);
    if ((input.jump || pushIn > 0.5) && this.stateTime > 0.2) return this.startPullUp(ledge);
    if ((input.crouch || pushIn < -0.5) && this.stateTime > 0.2) {
      this.ledge = null;
      this.ledgeCooldown = 0.4;
      this.hvel.copy(ledge.normal).multiplyScalar(1.2);
      return this.startFall();
    }
    this.shimmy = 0;
    if (Math.abs(side) > 0.2) {
      const step = along.clone().multiplyScalar(Math.sign(side) * 1.5 * dt);
      const next = this.feet.add(step);
      const ahead = this.findLedge(next.clone().add(along.clone().multiplyScalar(Math.sign(side) * 0.3)), toWall);
      if (ahead && Math.abs(ahead.y - ledge.y) < 0.2) {
        this.setFeet(next);
        this.ledge = { ...ledge, point: ledge.point.clone().add(step) };
        this.shimmy = Math.sign(side);
      }
    }
  }

  private shimmy = 0;

  private startPullUp(ledge: Ledge): void {
    this.pullFrom.copy(this.feet);
    this.pullTo.copy(ledge.point).addScaledVector(ledge.normal, -(RADIUS + 0.25)).setY(ledge.y + 0.02);
    this.setStance('crouch', true);
    this.ledge = null;
    this.stats.pullUps++;
    this.enter('pullUp');
  }

  private stepPullUp(): void {
    const dur = 0.9;
    const t = Math.min(1, this.stateTime / dur);
    const up = MathUtils.smoothstep(t, 0, 0.55);
    const over = MathUtils.smoothstep(t, 0.4, 0.85);
    const p = new Vector3(
      MathUtils.lerp(this.pullFrom.x, this.pullTo.x, over),
      MathUtils.lerp(this.pullFrom.y, this.pullTo.y, up),
      MathUtils.lerp(this.pullFrom.z, this.pullTo.z, over),
    );
    this.setFeet(p);
    if (t >= 1) {
      this.grounded = true;
      this.peakY = this.feet.y;
      this.enter(this.setStance('stand') ? 'idle' : 'crouch');
    }
  }

  // ------------------------------------------------------------------ climbing

  private checkClimb(input: MoveInput, inAir = false): boolean {
    if (!inAir && input.move.dot(this.forward) < 0.5) return false;
    const hit = this.physics.castRay(this.feet.add(new Vector3(0, 1.0, 0)), this.forward, RADIUS + 0.3, IGNORE, this.body);
    if (!hit || !this.physics.hasTag(hit.collider, 'climbable')) return false;
    const n = hit.normal.setY(0).normalize();
    this.facing = Math.atan2(-n.x, -n.z);
    this.hvel.set(0, 0, 0);
    this.vy = 0;
    this.setStance('stand', true);
    this.enter('climb');
    return true;
  }

  private stepClimb(dt: number, input: MoveInput): void {
    const f = this.forward;
    const chest = this.feet.add(new Vector3(0, 1.0, 0));
    const hit = this.physics.castRay(chest, f, RADIUS + 0.5, IGNORE, this.body);
    if (!hit || !this.physics.hasTag(hit.collider, 'climbable')) {
      // Ran out of wall at chest height: climb over the top if there's a ledge.
      const top = this.physics.castRay(chest.clone().addScaledVector(f, RADIUS + 0.45).setY(chest.y + 1.3), new Vector3(0, -1, 0), 2.2, IGNORE, this.body);
      if (top && top.normal.y > 0.7) {
        const n = f.clone().negate();
        const point = chest.clone().addScaledVector(f, RADIUS + 0.05);
        const y = chest.y + 1.3 - top.distance;
        if (this.roomToStandOn(point, n, y)) return this.startPullUp({ y, normal: n, point });
        this.vy = 0; // blocked above: hang on at the top of the wall
        return;
      }
      return this.startFall();
    }
    const n = hit.normal.setY(0).normalize();
    this.facing = Math.atan2(-n.x, -n.z);
    const along = new Vector3().crossVectors(UP, n).normalize();
    const upIn = input.move.dot(f.clone().setY(0).normalize());
    const side = input.move.dot(along);
    if (input.jump) {
      this.facing = Math.atan2(n.x, n.z);
      this.ledgeCooldown = 0.3;
      return this.jump('WallKick');
    }
    if (input.crouch) {
      this.ledgeCooldown = 0.4;
      this.hvel.copy(n).multiplyScalar(1);
      return this.startFall();
    }
    // Stay glued to the wall.
    const gap = hit.distance - (RADIUS + 0.04);
    const vel = along.multiplyScalar(side * 1.6).addScaledVector(f, gap / dt * 0.5);
    this.hvel.set(vel.x, 0, vel.z);
    this.vy = upIn * 2.2;
    this.move(dt, undefined, false);
    if (this.grounded && upIn < -0.1) this.enter('idle');
  }

  // ------------------------------------------------------------------ push / pull

  private blockAhead(reach: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider; normal: Vector3; distance: number } | null {
    const hit = this.physics.castRay(this.feet.add(new Vector3(0, 0.45, 0)), this.forward, RADIUS + reach, IGNORE, this.body);
    if (!hit || Math.abs(hit.normal.y) > 0.3) return null;
    if (!this.physics.hasTag(hit.collider, 'pushable') && !this.physics.hasTag(hit.collider, 'grabbable')) return null;
    const body = hit.collider.parent();
    return body ? { body, collider: hit.collider, normal: hit.normal.setY(0).normalize(), distance: hit.distance } : null;
  }

  private checkPush(input: MoveInput): boolean {
    if (input.move.length() < 0.3 || input.move.clone().normalize().dot(this.forward) < 0.75) return false;
    const b = this.blockAhead(0.12);
    if (!b || !this.physics.hasTag(b.collider, 'pushable')) return false;
    this.block = b.body;
    this.blockCollider = b.collider;
    this.facing = Math.atan2(-b.normal.x, -b.normal.z);
    this.hvel.set(0, 0, 0);
    this.enter('push');
    return true;
  }

  private checkGrab(): boolean {
    const b = this.blockAhead(0.4);
    if (!b) return false;
    this.block = b.body;
    this.blockCollider = b.collider;
    this.facing = Math.atan2(-b.normal.x, -b.normal.z);
    this.hvel.set(0, 0, 0);
    this.grabbing = true;
    this.enter('grab');
    return true;
  }

  private stepBlock(dt: number, input: MoveInput): void {
    const release = (next: MoveState = 'idle') => {
      if (this.block) {
        const v = this.block.linvel();
        this.block.setLinvel({ x: 0, y: v.y, z: 0 }, true);
      }
      this.block = null;
      this.blockCollider = null;
      this.grabbing = false;
      this.enter(next);
    };
    if (!this.grounded) {
      release('fall');
      return this.startFall();
    }
    if (input.jump) {
      release();
      return this.groundJump(input);
    }
    if (!this.grabbing && input.grab) this.grabbing = true; // push → grab
    if (this.grabbing && !input.grab) return release();
    const f = this.forward;
    const along = input.move.dot(f);
    const b = this.blockAhead(this.grabbing ? 0.5 : 0.2);
    if (!b || b.body !== this.block) return release();

    let v = 0;
    if (along > 0.3) v = 1.5;
    else if (this.grabbing && along < -0.3) v = -1.3;
    if (!this.grabbing && v === 0) return release(); // stopped pushing
    this.state = v > 0 ? 'push' : v < 0 ? 'pull' : 'grab';
    if (v > 0) this.stats.pushes++;
    if (v < 0) this.stats.pulls++;

    const blockVel = this.block!.linvel();
    const push = f.clone().multiplyScalar(v);
    this.block!.setLinvel({ x: push.x, y: Math.min(blockVel.y, 0), z: push.z }, true);
    // Keep a steady gap to the block and move with it (the block is excluded from the sweep).
    const gap = b.distance - (RADIUS + 0.03);
    this.hvel.copy(push).addScaledVector(f, (gap / dt) * 0.3);
    this.move(dt, this.blockCollider ?? undefined);
  }

  private grabbing = false;

  // ------------------------------------------------------------------ slopes

  private groundNormal(): Vector3 | null {
    const hit = this.physics.castRay(this.feet.add(new Vector3(0, 0.3, 0)), new Vector3(0, -1, 0), 0.8, IGNORE, this.body);
    return hit ? hit.normal : null;
  }

  private slipperyBelow(): boolean {
    const hit = this.physics.castRay(this.feet.add(new Vector3(0, 0.3, 0)), new Vector3(0, -1, 0), 0.8, IGNORE, this.body);
    return !!hit && this.physics.hasTag(hit.collider, 'slippery');
  }

  private checkSlope(): boolean {
    const n = this.groundNormal();
    if (!n) return false;
    const angle = Math.acos(MathUtils.clamp(n.y, -1, 1));
    if (angle > MathUtils.degToRad(38) || (this.slipperyBelow() && angle > MathUtils.degToRad(12))) {
      this.enter('slide');
      return true;
    }
    return false;
  }

  private stepSlide(dt: number, input: MoveInput): void {
    const n = this.groundNormal();
    if (input.jump) return this.jump('Jump', input);
    if (!n) {
      if (!this.grounded) return this.startFall();
      this.decel(dt, 14);
      this.move(dt);
      if (this.speed < 1) this.enter('land');
      return;
    }
    const downhill = new Vector3(0, -1, 0).projectOnPlane(n).setY(0);
    const steep = downhill.length();
    if (steep > 0.05) {
      downhill.normalize();
      this.hvel.addScaledVector(downhill, 22 * steep * dt);
      if (this.hvel.length() > 9) this.hvel.setLength(9);
      this.facing = turnToward(this.facing, Math.atan2(downhill.x, downhill.z), 8 * dt);
      // light steering
      this.hvel.addScaledVector(input.move, 4 * dt);
    } else {
      this.decel(dt, 14);
    }
    this.vy = -2;
    this.move(dt);
    const angle = Math.acos(MathUtils.clamp(n.y, -1, 1));
    if (angle < MathUtils.degToRad(10) && this.speed < 1.2) this.enter('land');
  }

  // ------------------------------------------------------------------ helpers

  private groundAhead(dist: number): boolean {
    const origin = this.feet.addScaledVector(this.forward, dist).add(new Vector3(0, 0.3, 0));
    return !!this.physics.castRay(origin, new Vector3(0, -1, 0), 0.9, IGNORE, this.body);
  }

  /** Mario-style: turn facing toward the stick, speed builds along facing. */
  private groundMove(dt: number, input: MoveInput, maxSpeed: number, accel: number, turnRate = 14): void {
    const mag = Math.min(1, input.move.length());
    if (input.face) {
      const target = input.move.clone().setY(0).multiplyScalar(maxSpeed);
      this.hvel.lerp(target, 1 - Math.exp(-12 * dt));
      return;
    }
    let speed = this.speed + this.wallSlip;
    if (mag > 0.1) {
      const want = Math.atan2(input.move.x, input.move.z);
      const rate = speed < 2 ? turnRate * 1.6 : turnRate;
      this.facing = turnToward(this.facing, want, rate * dt);
      speed = approach(speed, maxSpeed * mag, accel * dt);
    } else {
      speed = approach(speed, 0, accel * 1.3 * dt);
    }
    this.hvel.copy(this.forward).multiplyScalar(speed);
  }

  private decel(dt: number, rate: number): void {
    const s = approach(this.speed, 0, rate * dt);
    if (this.speed > 1e-4) this.hvel.setLength(s);
    else this.hvel.set(0, 0, 0);
  }

  private lastBonk = false;
  /** Speed (m/s) the last move lost against a wall: the part of the velocity into it. */
  private wallHit = 0;
  private wallCollider: RAPIER.Collider | null = null;
  /**
   * Speed the last move lost sliding along a wall at a glancing angle. groundMove builds on
   * it again, so steering along a wall doesn't bleed the run away step after step; the
   * realised `speed` is still the slower slide.
   */
  private wallSlip = 0;
  private wallHeadOn = false;

  /**
   * Sweep the capsule by the current velocity with Rapier's KCC. Walls the KCC slid along
   * take away the part of the velocity that points into them, so `speed` (and every
   * decision built on it: run, skid, long and triple jumps, playback rates) is the speed
   * the character really moves at. Steps and slopes don't count as walls.
   */
  private move(dt: number, exclude?: RAPIER.Collider, gravity = true): void {
    if (gravity && !this.isAirborne() && this.state !== 'climb') this.vy = Math.min(this.vy, 0) + GRAVITY * dt;
    const desired = { x: this.hvel.x * dt, y: this.vy * dt, z: this.hvel.z * dt };
    if (this.laneZ !== null) desired.z = (this.laneZ - this.body.translation().z) * 0.5;
    if (this.state === 'jump' || this.state === 'climb') this.kcc.disableSnapToGround();
    else this.kcc.enableSnapToGround(0.35);
    const predicate = exclude ? (c: RAPIER.Collider) => c.handle !== exclude.handle : undefined;
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, predicate);
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    this.lastBonk = desired.y > 0 && m.y < desired.y * 0.5;
    if (this.grounded && this.vy < 0 && !this.isAirborne()) this.vy = 0;
    this.loseSpeedToWalls();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  }

  private loseSpeedToWalls(): void {
    this.wallHit = 0;
    this.wallCollider = null;
    this.wallSlip = 0;
    const before = this.speed;
    for (let i = 0, n = this.kcc.numComputedCollisions(); i < n; i++) {
      const c = this.kcc.computedCollision(i, this.collision);
      if (!c?.collider || Math.abs(c.normal1.y) > 0.3) continue; // floor, ceiling or slope
      const len = Math.hypot(c.normal1.x, c.normal1.z);
      const nx = c.normal1.x / len; // out of the wall, toward the character
      const nz = c.normal1.z / len;
      const into = -(this.hvel.x * nx + this.hvel.z * nz);
      if (into <= 1e-4) continue;
      // A riser the autostep climbs is not a wall: walls still stand above step height.
      const feet = this.feetInto(this.tmpFeet);
      this.tmpOrigin.set(feet.x, feet.y + WALL_CHECK_HEIGHT, feet.z);
      this.tmpDir.set(-nx, 0, -nz);
      const wall = this.physics.castRay(this.tmpOrigin, this.tmpDir, RADIUS + 0.15, IGNORE, this.body);
      if (!wall || Math.abs(wall.normal.y) > 0.3) continue;
      this.hvel.x += nx * into;
      this.hvel.z += nz * into;
      if (into > this.wallHit) {
        this.wallHit = into;
        this.wallCollider = c.collider;
      }
    }
    // Head-on (within ~30°) the wall stops you; at a glancing angle you slide along it.
    this.wallHeadOn = this.wallHit > 0 && this.wallHit >= before * 0.87;
    if (this.wallHit > 0 && !this.wallHeadOn) this.wallSlip = before - this.speed;
  }

  private setFeet(feet: Vector3, immediate = false): void {
    const c = { x: feet.x, y: feet.y + HALF[this.stance] + RADIUS, z: feet.z };
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
      const need = 2 * (HALF[stance] + RADIUS) + 0.02;
      const r = RADIUS * 0.95;
      const d = r * Math.SQRT1_2;
      for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [d, d], [d, -d], [-d, d], [-d, -d]] as const) {
        const origin = feet.clone().add(new Vector3(dx, 0.25, dz));
        if (this.physics.castRay(origin, UP, need - 0.25, IGNORE, this.body)) return false;
      }
    }
    this.stance = stance;
    this.collider.setHalfHeight(HALF[stance]);
    this.setFeet(feet, true);
    return true;
  }

  private enter(state: MoveState): void {
    if (state !== this.state) this.stateTime = 0;
    if (state !== 'idle' && state !== 'teeter') this.idleTime = 0;
    this.state = state;
    const standing = ['idle', 'walk', 'run', 'skid', 'jump', 'fall', 'hang', 'climb', 'push', 'grab', 'pull', 'emote', 'land', 'hardLand', 'slide', 'bonk'];
    if ((standing.includes(state) || (state === 'attack' && this.attackStep !== 3)) && this.stance !== 'stand') {
      if (!this.setStance('stand')) this.setStance('crouch');
    }
  }

  private lockDuration(): number {
    switch (this.state) {
      case 'land': return 0.16;
      case 'hardLand': return this.clipDuration('HardLand', 1.3);
      case 'groundPoundLand': return this.clipDuration('GroundPoundLand', 0.5);
      case 'getUp': return this.clipDuration('GetUp', 0.8);
      case 'getUpFront': return this.clipDuration('GetUpFront', 0.7);
      case 'bonk': return this.clipDuration('Hurt', 0.67);
      default: return 0.3;
    }
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

  /** Playback rate that makes a locomotion clip's feet match ground speed `s`. */
  private rate(name: string, s: number, authored: number, min = 0.3): number {
    const speed = (this.actions.get(name)?.getClip().userData.speed as number | undefined) ?? authored;
    return Math.max(min, s / Math.abs(speed));
  }

  /** Name of the clip the current state wants. */
  animationFor(): { name: string; once?: boolean; speed?: number; fade?: number } {
    const s = this.speed;
    switch (this.state) {
      case 'idle':
        if (this.stepAnim) return { name: this.stepAnim.name, once: true };
        return { name: this.idleTime > 6 && this.idleTime % 10 < 3.4 ? 'IdleLook' : 'Idle' };
      case 'teeter': return { name: 'Teeter' };
      case 'walk':
        if (this.stepAnim) return { name: this.stepAnim.name, once: true, fade: 0.05 };
        // Tiptoe on a gentle tilt (not just while speeding up or slowing down, which would
        // flash it for a frame at every start and stop); keep the current gait once let go.
        return (this.stick > 0.1 ? this.stick < 0.5 : this.anim === 'Tiptoe')
          ? { name: 'Tiptoe', speed: this.rate('Tiptoe', s, 1.2, 0.5) }
          : { name: 'Walk', speed: this.rate('Walk', s, 2) };
      case 'run': return { name: 'Run', speed: this.rate('Run', s, 6) };
      case 'skid': return { name: 'Skid', once: true };
      case 'crouch': return { name: 'Crouch' };
      case 'crouchWalk': return { name: 'CrouchWalk', speed: this.rate('CrouchWalk', s, 1.4, 0.4) };
      case 'crouchSlide': return { name: 'CrouchSlide' };
      case 'proneDown': return { name: 'ProneDown', once: true };
      case 'prone': return { name: 'Prone' };
      case 'crawl': return { name: 'Crawl', speed: this.rate('Crawl', s, 0.9, 0.5) };
      case 'getUpFront': return { name: 'GetUpFront', once: true };
      case 'lieDown': return { name: 'LieDown', once: true };
      case 'lying': return { name: this.stateTime > 6 ? 'Sleep' : 'LieIdle', fade: 0.6 };
      case 'getUp': return { name: 'GetUp', once: true };
      case 'sit': return { name: 'Sit', fade: 0.3 };
      case 'jump': return { name: this.jumpKind, once: true, fade: this.jumpKind === 'JumpKick' ? 0.05 : 0.08 };
      case 'fall': return { name: 'Fall', fade: 0.25 };
      case 'land': return { name: 'Land', once: true, fade: 0.05 };
      case 'hardLand': return { name: 'HardLand', once: true, fade: 0.05 };
      case 'dive': return { name: 'Dive', once: true };
      case 'bellySlide': return { name: 'BellySlide' };
      case 'groundPound': return { name: this.poundDelay > 0 ? 'GroundPoundSpin' : 'GroundPound', once: true, fade: 0.05 };
      case 'groundPoundLand': return { name: 'GroundPoundLand', once: true, fade: 0.03 };
      case 'hang': return this.shimmy ? { name: this.shimmy > 0 ? 'ShimmyRight' : 'ShimmyLeft' } : { name: 'Hang' };
      case 'pullUp': return { name: 'PullUp', once: true, fade: 0.05 };
      case 'climb': return Math.abs(this.vy) > 0.2 || s > 0.2 ? { name: 'Climb', speed: this.vy >= 0 ? 1 : -1 } : { name: 'ClimbIdle' };
      case 'push': return { name: 'Push' };
      case 'grab': return { name: 'Grab' };
      case 'pull': return { name: 'Pull' };
      case 'slide': return { name: 'Slide' };
      case 'attack': return { name: this.attackClip(), once: true, fade: 0.04 };
      case 'emote': return { name: this.emoteClip, once: true };
      case 'bonk': return { name: 'Hurt', once: true, fade: 0.1 };
    }
  }

  /** Per render frame: orient the model, pick and advance animation. */
  updateVisual(model: Object3D, dt: number, alpha: number): void {
    model.position.copy(this.interpolatedFeet(alpha));
    let diff = this.facing - model.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const snap = this.state === 'hang' || this.state === 'climb' || this.state === 'pullUp' || this.state === 'push' || this.state === 'pull' || this.state === 'grab';
    model.rotation.y += snap ? diff : diff * Math.min(1, dt * 16);
    const a = this.animationFor();
    this.play(a.name, a.fade ?? 0.12, a.speed ?? 1, a.once ?? false);
    for (const [action, f] of this.fades) {
      f.t += dt;
      const u = f.duration > 0 ? Math.min(1, f.t / f.duration) : 1;
      action.setEffectiveWeight(f.from + (f.to - f.from) * u);
      if (u < 1) continue;
      this.fades.delete(action);
      if (f.to === 0) action.stop();
    }
    this.mixer?.update(dt);
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

function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function turnToward(from: number, to: number, maxStep: number): number {
  const d = angleDiff(to, from);
  return from + MathUtils.clamp(d, -maxStep, maxStep);
}

function approach(value: number, target: number, delta: number): number {
  return value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);
}
