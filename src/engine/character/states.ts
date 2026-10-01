import { MathUtils, Vector3 } from 'three/webgpu';
import type { RAPIER } from '../physics/Physics';
import { angleDiff, approach, turnToward } from './motion';
import type { AnimRequest } from './animator';
import type { JumpKind, Ledge, MoveInput, PlatformerCharacter, Stance } from './PlatformerCharacter';
import { TUNING as T } from './tuning';

export type { AnimRequest } from './animator';

/**
 * PlatformerCharacter's state machine as one table: everything a state is, in one entry.
 * Adding a state means adding an entry here (its MoveState name comes from the key).
 *
 *   step        one fixed step: physics and transitions
 *   anim        the clip it plays (per render frame): name, once, playback speed, fade in
 *   stance      collider entering it needs: 'stand' stands up (or crouches without headroom)
 *   airborne    in the air: own vertical motion, fall height keeps measuring
 *   snapToGround false: no snapping down to the ground (rising, climbing)
 *   attached    facing comes from the wall / ledge / block, not from a first-person view
 *   snapFacing  the model turns to the facing at once (no smoothing)
 *   lock        locked for this long (s), decelerating, then idle (or crouch if held)
 *   feet        runtime foot placement while grounded: 'ik' puts the soles on the real ground
 *               (stairs, slopes); 'lock' also keeps planted feet planted through blends and
 *               turns (not for states whose feet are meant to slide)
 *   lean        the body leans into turns and into acceleration
 *
 * Shared physics and probes (move, setStance, rays, ledge detection) live in the core,
 * PlatformerCharacter.ts; numbers live in tuning.ts.
 */
export interface StateDef {
  step(c: PlatformerCharacter, dt: number, input: MoveInput): void;
  anim(c: PlatformerCharacter): AnimRequest;
  stance?: Stance | ((c: PlatformerCharacter) => Stance | undefined);
  airborne?: boolean;
  snapToGround?: false;
  attached?: boolean;
  snapFacing?: boolean;
  lock?(c: PlatformerCharacter): number;
  feet?: FeetMode | ((c: PlatformerCharacter) => FeetMode | undefined);
  lean?: boolean;
}

export type FeetMode = 'ik' | 'lock';

const G = T.ground;
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);

// ------------------------------------------------------------------ the table

export const STATES = {
  // ---- on the ground
  idle: {
    step: stepGround,
    anim: (c) => {
      if (c.stepAnim) return { name: c.stepAnim.name, once: true };
      if (c.leaning) return { name: 'PushIdle', fade: 0.2 }; // pushing against a wall
      return { name: c.idleTime > G.lookAfter && c.idleTime % G.lookEvery < G.lookFor ? 'IdleLook' : 'Idle' };
    },
    stance: 'stand',
    feet: 'lock',
  },
  teeter: { step: stepGround, anim: () => ({ name: 'Teeter' }), feet: 'lock' },
  walk: {
    step: stepGround,
    anim: (c) => (c.stepAnim ? { name: c.stepAnim.name, once: true, fade: 0.05 } : gait(c)),
    stance: 'stand',
    feet: 'lock',
    lean: true,
  },
  run: { step: stepGround, anim: gait, stance: 'stand', feet: 'lock', lean: true },
  skid: { step: stepSkid, anim: () => ({ name: 'Skid', once: true }), stance: 'stand', feet: 'ik' },
  skidTurn: { step: stepSkidTurn, anim: () => ({ name: 'SkidTurn', once: true, fade: 0.06 }), stance: 'stand', snapFacing: true, feet: 'lock' },
  bonk: {
    step: stepLocked,
    anim: () => ({ name: 'Hurt', once: true, fade: 0.1 }),
    stance: 'stand',
    lock: (c) => c.clipDuration('Hurt', 0.67),
    feet: 'lock',
  },

  // ---- crouch, prone
  crouch: { step: stepCrouch, anim: () => ({ name: 'Crouch' }), feet: 'lock' },
  crouchWalk: { step: stepCrouch, anim: (c) => ({ name: 'CrouchWalk', speed: c.rate('CrouchWalk', c.speed, 1.4, 0.4) }), feet: 'lock' },
  crouchSlide: { step: stepCrouchSlide, anim: () => ({ name: 'CrouchSlide' }), feet: 'ik' },
  proneDown: { step: stepProneDown, anim: () => ({ name: 'ProneDown', once: true }), feet: 'lock' },
  prone: { step: stepProne, anim: () => ({ name: 'Prone' }) },
  crawl: { step: stepProne, anim: (c) => ({ name: 'Crawl', speed: c.rate('Crawl', c.speed, 0.9, 0.5) }) },
  getUpFront: { step: stepLocked, anim: () => ({ name: 'GetUpFront', once: true }), lock: (c) => c.clipDuration('GetUpFront', 0.7), feet: 'lock' },

  // ---- lying, sitting
  lieDown: { step: stepLieDown, anim: () => ({ name: 'LieDown', once: true }), feet: 'lock' },
  lying: { step: stepLying, anim: (c) => ({ name: c.stateTime > T.rest.sleepAfter ? 'Sleep' : 'LieIdle', fade: 0.6 }) },
  getUp: { step: stepLocked, anim: () => ({ name: 'GetUp', once: true }), lock: (c) => c.clipDuration('GetUp', 0.8), feet: 'lock' },
  // sits down (SitDown), sits, and stands up again (StandUp): the feet step, never slide
  sit: {
    step: stepSit,
    anim: (c) => (c.stateTime < c.clipDuration('SitDown', 0.53) ? { name: 'SitDown', once: true, fade: 0.1 } : { name: 'Sit', fade: 0.1 }),
    feet: 'lock',
  },
  standUp: { step: stepLocked, anim: () => ({ name: 'StandUp', once: true, fade: 0.1 }), lock: (c) => c.clipDuration('StandUp', 0.53), feet: 'lock' },

  // ---- in the air
  jump: {
    step: stepAir,
    anim: (c) => ({ name: c.jumpKind, once: true, fade: c.jumpKind === 'JumpKick' ? 0.05 : 0.08 }),
    stance: 'stand',
    airborne: true,
    snapToGround: false,
    // the launch frame is still on the ground: the feet push off from where they stand
    // (not a wall kick or any other jump that starts in the air)
    feet: (c) => (c.stateTime < T.jump.launchFeet && c.vy > 0 && c.supported() ? 'lock' : undefined),
  },
  fall: { step: stepAir, anim: () => ({ name: 'Fall', fade: 0.25 }), stance: 'stand', airborne: true },
  wallSlide: { step: stepWallSlide, anim: () => ({ name: 'WallSlide', fade: 0.1 }), stance: 'stand', airborne: true, attached: true },
  hurt: {
    step: stepHurt,
    anim: () => ({ name: 'Hurt', once: true, fade: 0.05 }),
    stance: 'stand',
    airborne: true,
    snapToGround: false,
    feet: (c) => (c.grounded && c.vy <= 0 ? 'ik' : undefined),
  },
  dive: { step: stepAir, anim: () => ({ name: 'Dive', once: true }), airborne: true },
  groundPound: {
    step: stepGroundPound,
    anim: (c) => ({ name: c.poundDelay > 0 ? 'GroundPoundSpin' : 'GroundPound', once: true, fade: 0.05 }),
    airborne: true,
  },
  land: {
    step: stepLocked,
    anim: () => ({ name: 'Land', once: true, fade: 0.05 }),
    stance: 'stand',
    lock: () => T.lock.land,
    feet: 'lock',
  },
  hardLand: {
    step: stepLocked,
    anim: () => ({ name: 'HardLand', once: true, fade: 0.05 }),
    stance: 'stand',
    lock: (c) => c.clipDuration('HardLand', 1.3),
    feet: 'lock',
  },
  groundPoundLand: {
    step: stepLocked,
    anim: () => ({ name: 'GroundPoundLand', once: true, fade: 0.03 }),
    lock: (c) => c.clipDuration('GroundPoundLand', 0.5),
    feet: 'lock',
  },
  bellySlide: { step: stepBellySlide, anim: () => ({ name: 'BellySlide' }) },

  // ---- ledges and walls
  hang: {
    step: stepHang,
    anim: (c) => (c.shimmy ? { name: c.shimmy > 0 ? 'ShimmyRight' : 'ShimmyLeft' } : { name: 'Hang' }),
    stance: 'stand',
    attached: true,
    snapFacing: true,
  },
  pullUp: { step: stepPullUp, anim: () => ({ name: 'PullUp', once: true, fade: 0.05 }), attached: true, snapFacing: true },
  climb: {
    step: stepClimb,
    anim: (c) => (Math.abs(c.vy) > T.climb.moving || c.speed > T.climb.moving ? { name: 'Climb', speed: c.vy >= 0 ? 1 : -1 } : { name: 'ClimbIdle' }),
    stance: 'stand',
    snapToGround: false,
    attached: true,
    snapFacing: true,
  },

  // ---- blocks
  // a crate that won't move (against a wall, another crate): lean on it
  push: { step: stepBlock, anim: (c) => ({ name: c.leaning ? 'PushIdle' : 'Push', fade: 0.2 }), stance: 'stand', attached: true, snapFacing: true, feet: 'ik' },
  grab: { step: stepBlock, anim: () => ({ name: 'Grab' }), stance: 'stand', attached: true, snapFacing: true, feet: 'lock' },
  pull: { step: stepBlock, anim: () => ({ name: 'Pull' }), stance: 'stand', attached: true, snapFacing: true, feet: 'ik' },

  // ---- slopes
  slide: { step: stepSlide, anim: () => ({ name: 'Slide' }), stance: 'stand' },

  // ---- attacks, emotes
  attack: {
    step: stepAttack,
    anim: (c) => ({ name: attackClip(c), once: true, fade: 0.04 }),
    stance: (c) => (c.attackStep !== 3 ? 'stand' : undefined), // the sweep kick stays low
    feet: (c) => (c.attackStep !== 3 ? 'lock' : 'ik'), // the sweep kick's foot sweeps the floor
  },
  emote: { step: stepEmote, anim: (c) => ({ name: c.emoteClip, once: true }), stance: 'stand', feet: 'lock' },
} satisfies Record<string, StateDef>;

export type MoveState = keyof typeof STATES;

/** The table entry for `state` (typed as the general StateDef). */
export function stateDef(state: MoveState): StateDef {
  return STATES[state];
}

/** The state's foot placement mode right now (the table's `feet`). */
export function feetMode(c: PlatformerCharacter): FeetMode | undefined {
  const f = stateDef(c.state).feet;
  return typeof f === 'function' ? f(c) : f;
}

/**
 * Walking and running: the locomotion blend space (Tiptoe / Walk / Run by speed, phase
 * synced). A gentle stick tilt tiptoes; once the stick is let go the share stays as it was.
 */
function gait(c: PlatformerCharacter): AnimRequest {
  return { name: c.speed > G.runAbove ? 'Run' : 'Walk', gait: { speed: c.speed, tiptoe: c.tiptoe } };
}

// ------------------------------------------------------------------ ground

function stepGround(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const mag = Math.min(1, input.move.length());
  c.stick = mag;
  if (mag > G.deadzone) c.tiptoe = mag < G.tiptoeBelow ? 1 : 0;
  if (!c.grounded) {
    c.coyote += dt;
    if (c.coyote > G.coyote) return fallNow(c, dt, input);
  } else c.coyote = 0;

  if (c.consumeJump(input)) return groundJump(c, input);
  if (input.attack) return startAttack(c, input);
  if (input.prone) return goProne(c);
  if (input.lie) return c.enter('lieDown');
  if (input.sit) return c.enter('sit');
  if (input.wave) return startEmote(c, 'Wave');
  if (input.crouch) {
    if (c.speed > T.crouch.slideAbove) {
      c.setStance('crouch');
      return c.enter('crouchSlide');
    }
    if (c.setStance('crouch')) return c.enter(mag > G.deadzone ? 'crouchWalk' : 'crouch');
  }

  // Skid-turn when reversing at speed; brake (the same skid) when letting go at a run.
  if (!input.face && mag > T.skid.turnStick && c.speed > T.skid.turnSpeed) {
    const want = Math.atan2(input.move.x, input.move.z);
    if (Math.abs(angleDiff(want, c.facing)) > T.skid.turnAngle) {
      c.braking = false;
      return c.enter('skid');
    }
  }
  // (never toward a drop: letting go near an edge stops short, as before)
  if (!input.face && mag < G.deadzone && c.state === 'run' && c.speed > T.skid.brakeSpeed && c.groundAhead(T.skid.brakeLookahead)) {
    c.braking = true;
    return c.enter('skid');
  }

  const max = input.walk ? G.walkSpeed : c.uphillSpeed();
  c.groundMove(dt, input, max);

  if (checkClimb(c, input)) return;
  if (checkPush(c, input)) return;
  if (input.grab && checkGrab(c)) return;
  if (checkSlope(c)) return;

  const beforeY = c.prevFeet.y;
  c.move(dt);
  if (!c.grounded) return; // handled next step (coyote)
  if (c.wallHeadOn && c.wallHit > T.wall.bonkSpeed && !input.face && !c.wallIsInteractive()) return bonk(c);
  const dy = c.feetY() - beforeY;
  if (c.speed < T.steps.maxSpeed && c.speed > T.steps.minSpeed) {
    if (dy > T.steps.rise) c.stepAnim = { name: 'StepUp', t: T.steps.duration };
    else if (dy < -T.steps.rise) c.stepAnim = { name: 'StepDown', t: T.steps.duration };
  }

  const s = c.speed;
  c.leaning = false;
  if (s < G.stopSpeed && mag >= G.deadzone && c.wallHit > 0) {
    // Walking into a wall: lean on it (PushIdle) instead of walking on the spot.
    if (c.state !== 'idle') c.enter('idle');
    c.leaning = true;
    c.idleTime = 0;
  } else if (s < G.stopSpeed && mag < G.deadzone) {
    if (c.state !== 'idle' && c.state !== 'teeter') c.enter('idle');
    c.idleTime += dt;
    const teeter = !c.groundAhead(G.teeterLookahead);
    if (teeter !== (c.state === 'teeter')) c.state = teeter ? 'teeter' : 'idle';
    if (c.idleTime > G.dozeAfter) c.enter('lieDown'); // dozes off, like Mario
  } else {
    c.idleTime = 0;
    const next = input.walk || s < G.runAbove ? 'walk' : 'run';
    if (c.state !== next) c.state = next;
  }
}

function stepSkid(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const K = T.skid;
  // Skidding off an edge: fall, with the same grace period as walking off one.
  if (!c.grounded) {
    c.coyote += dt;
    if (c.coyote > G.coyote) return fallNow(c, dt, input);
  } else c.coyote = 0;
  c.decel(dt, c.braking ? K.brakeDecel : K.turnDecel);
  if (c.braking && !c.groundAhead(K.edgeLookahead)) c.decel(dt, K.edgeDecel); // don't brake over an edge
  c.move(dt);
  const want = input.move.lengthSq() > K.stickMinSq ? Math.atan2(input.move.x, input.move.z) : null;
  const reversing = want !== null && Math.abs(angleDiff(want, c.facing)) > K.reverseAngle;
  if (c.consumeJump(input)) {
    if (!reversing) return groundJump(c, input);
    c.facing = want;
    return startJump(c, 'SideFlip', input);
  }
  // Braking, then pushing ahead again: run on.
  if (want !== null && !reversing) return c.enter(c.speed > G.runAbove ? 'run' : 'walk');
  if (c.speed < K.endSpeed) {
    if (want === null) return c.enter('idle');
    // stick still reversed: turn round with a hop
    c.turnFrom = c.facing;
    c.turnTo = want;
    c.enter('skidTurn');
  }
}

/**
 * Turning round out of a skid: the SkidTurn clip hops, and the facing turns only while both
 * feet are off the floor (`spinFrom`..`spinTo` s), so they never skate round on it. Then it
 * runs off the other way.
 */
function stepSkidTurn(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const K = T.skid;
  if (!c.grounded) {
    c.coyote += dt;
    if (c.coyote > G.coyote) return fallNow(c, dt, input);
  } else c.coyote = 0;
  if (c.consumeJump(input)) {
    c.facing = c.turnTo;
    return groundJump(c, input);
  }
  const spin = MathUtils.smoothstep(c.stateTime, K.spinFrom, K.spinTo);
  if (spin < 1) {
    c.facing = c.turnFrom + angleDiff(c.turnTo, c.turnFrom) * spin;
    c.decel(dt, K.turnDecel);
  } else c.groundMove(dt, input, input.walk ? G.walkSpeed : c.uphillSpeed());
  c.move(dt);
  if (c.stateTime >= K.turnEnd) {
    if (c.speed > G.stopSpeed || input.move.lengthSq() > T.skid.stickMinSq) c.enter(c.speed > G.runAbove ? 'run' : 'walk');
    else c.enter('idle');
  }
}

/** Landings, get-ups, bonk: decelerate for the state's lock time, then idle (or crouch). */
function stepLocked(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  if (c.state === 'land' && c.consumeJump(input)) return groundJump(c, input);
  c.decel(dt, T.lock.decel);
  c.move(dt);
  if (c.stateTime > c.lockDuration()) c.enter(input.crouch && c.state !== 'hardLand' ? 'crouch' : 'idle');
}

/** Ran into a wall at speed: stop dead and reel back (Mario's bonk). */
function bonk(c: PlatformerCharacter): void {
  c.hvel.set(0, 0, 0);
  c.enter('bonk');
}

/**
 * Knocked back (PlatformerCharacter.hurt): an arc away from the hit, no control for
 * `hurt.stun` seconds, sliding to a stop once down; then back to standing (or falling).
 */
function stepHurt(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const H = T.hurt;
  if (c.grounded && c.vy <= 0) c.decel(dt, H.groundDecel);
  else c.vy = Math.max(c.vy + T.gravity * dt, T.maxFall);
  c.move(dt);
  if (c.grounded && c.vy < 0) c.vy = 0;
  if (c.stateTime < H.stun) return;
  if (!c.grounded) return startFall(c);
  c.peakY = c.feetY();
  c.enter(input.move.lengthSq() > G.deadzone * G.deadzone ? 'walk' : 'idle');
}

/** @internal Start a knockback: see PlatformerCharacter.hurt. */
export function startHurt(c: PlatformerCharacter, from: Vector3, strength: number): void {
  const H = T.hurt;
  // let go of whatever it holds or hangs on
  if (c.block) {
    const v = c.block.linvel();
    c.block.setLinvel({ x: 0, y: v.y, z: 0 }, true);
  }
  c.block = null;
  c.blockCollider = null;
  c.grabbing = false;
  c.ledge = null;
  c.setStance('stand');
  const away = c.tmpVec.set(-from.x, 0, -from.z);
  if (away.lengthSq() < 1e-6) away.copy(c.fwd()).negate();
  away.normalize();
  c.facing = Math.atan2(-away.x, -away.z); // face the hit
  c.hvel.copy(away).multiplyScalar(H.knockback * strength);
  c.vy = H.lift * strength;
  c.grounded = false;
  c.jumpBuffer = 0;
  c.ledgeCooldown = H.stun;
  c.invulnerable = H.invulnerable;
  c.stats.hurts++;
  c.enter('hurt');
}

// ------------------------------------------------------------------ crouch, prone, lying

function stepCrouch(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  if (c.stance === 'stand') c.setStance('crouch');
  if (!c.grounded) return startFall(c);
  if (c.consumeJump(input)) return startJump(c, 'Backflip', input);
  if (input.attack) return startAttack(c, input);
  if (input.prone) return goProne(c);
  if (!input.crouch && c.setStance('stand')) return c.enter('idle');
  const mag = input.move.length();
  c.groundMove(dt, input, T.crouch.walkSpeed, T.crouch.accel);
  c.move(dt);
  c.state = mag > G.deadzone ? 'crouchWalk' : 'crouch';
}

function stepCrouchSlide(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  c.decel(dt, T.crouch.slideDecel);
  c.move(dt);
  if (c.consumeJump(input)) startJump(c, c.speed > T.crouch.longJumpAbove ? 'LongJump' : 'Backflip', input);
  else if (c.speed < T.crouch.slideEnd) c.enter(input.crouch ? 'crouch' : 'idle');
}

function goProne(c: PlatformerCharacter): void {
  if (!c.setStance('prone')) return;
  c.enter('proneDown');
}

function stepProneDown(c: PlatformerCharacter, dt: number): void {
  c.decel(dt, T.prone.downDecel);
  c.move(dt);
  if (c.stateTime > c.clipDuration('ProneDown', 0.6)) c.enter('prone');
}

function stepProne(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  if (!c.grounded) return startFall(c);
  if (input.prone || input.jump) return getUpFrom(c, 'front');
  if (input.lie) return; // already down
  c.groundMove(dt, input, T.prone.crawlSpeed, T.prone.accel, T.prone.turnRate);
  c.move(dt);
  c.state = input.move.length() > G.deadzone ? 'crawl' : 'prone';
}

function getUpFrom(c: PlatformerCharacter, side: 'front' | 'back'): void {
  if (!c.setStance('stand')) {
    // No headroom: crouch instead if possible, otherwise stay down.
    if (c.setStance('crouch')) c.enter('crouch');
    return;
  }
  c.enter(side === 'front' ? 'getUpFront' : 'getUp');
}

function stepLieDown(c: PlatformerCharacter, dt: number): void {
  if (c.stance !== 'prone') c.setStance('prone');
  c.decel(dt, T.rest.decel);
  c.move(dt);
  if (c.stateTime > c.clipDuration('LieDown', 1.0)) c.enter('lying');
}

function stepLying(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  c.decel(dt, T.rest.decel);
  c.move(dt);
  if (input.lie || input.jump || input.move.lengthSq() > T.rest.wakeStickSq) getUpFrom(c, 'back');
}

function stepSit(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  c.decel(dt, T.rest.decel);
  c.move(dt);
  if (input.sit || input.jump || input.move.lengthSq() > T.rest.wakeStickSq) c.enter('standUp');
  else if (input.lie) c.enter('lieDown');
}

// ------------------------------------------------------------------ attacks, emotes

export function startEmote(c: PlatformerCharacter, clip: string): void {
  c.emoteClip = clip;
  c.enter('emote');
}

function stepEmote(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  c.decel(dt, T.rest.decel);
  c.move(dt);
  if (c.stateTime > c.clipDuration(c.emoteClip, 1.2) || input.move.lengthSq() > T.rest.wakeStickSq || input.jump) c.enter('idle');
}

function startAttack(c: PlatformerCharacter, input: MoveInput): void {
  // Chain punch → punch → kick when the next press comes within the window after the last hit.
  const chain = !input.crouch && c.clock - c.lastAttackEnd < T.attack.chainWindow && c.lastAttackStep >= 0 && c.lastAttackStep < 2;
  c.attackStep = input.crouch ? 3 : chain ? c.lastAttackStep + 1 : 0;
  c.attackQueued = false;
  c.enter('attack');
}

function stepAttack(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  c.decel(dt, T.attack.decel);
  c.move(dt);
  const clip = attackClip(c);
  if (input.attack && c.stateTime > T.attack.queueAfter) c.attackQueued = true;
  if (c.stateTime >= c.clipDuration(clip, 0.3)) {
    if (c.attackQueued && c.attackStep < 2) {
      c.attackStep++;
      c.attackQueued = false;
      c.stateTime = 0;
    } else {
      c.lastAttackEnd = c.clock;
      c.lastAttackStep = c.attackStep;
      c.enter(c.stance === 'crouch' ? 'crouch' : 'idle');
    }
  }
}

function attackClip(c: PlatformerCharacter): string {
  return ['Punch', 'Punch2', 'Kick', 'SweepKick'][c.attackStep] ?? 'Punch';
}

// ------------------------------------------------------------------ jumping

function groundJump(c: PlatformerCharacter, input: MoveInput): void {
  const J = T.jump;
  const sinceLand = c.clock - c.lastLandTime;
  const moving = input.move.length() > J.movingStick;
  if (input.crouch && c.speed > J.longJumpAbove) return startJump(c, 'LongJump', input);
  if (input.crouch) return startJump(c, 'Backflip', input);
  if (sinceLand < J.chainWindow && moving && c.speed > J.chainSpeed) {
    if (c.lastJump === 'Jump' || c.lastJump === 'JumpUp') return startJump(c, 'DoubleJump', input);
    if (c.lastJump === 'DoubleJump' && c.speed > J.tripleSpeed) return startJump(c, 'TripleJump', input);
  }
  startJump(c, moving || c.speed > J.forwardAbove ? 'Jump' : 'JumpUp', input);
}

export function startJump(c: PlatformerCharacter, kind: JumpKind, input?: MoveInput): void {
  const J = T.jump;
  if (!c.setStance('stand')) return; // no headroom: stay down
  const f = c.fwd();
  switch (kind) {
    case 'Jump': c.vy = J.vy.Jump; break;
    case 'JumpUp': c.vy = J.vy.JumpUp; break;
    case 'DoubleJump': c.vy = J.vy.DoubleJump; break;
    case 'TripleJump': c.vy = J.vy.TripleJump; c.hvel.setLength(Math.max(c.speed, J.tripleMinSpeed)); break;
    case 'Backflip': c.vy = J.vy.Backflip; c.hvel.copy(f).multiplyScalar(-J.backflipBack); break;
    case 'SideFlip': c.vy = J.vy.SideFlip; c.hvel.copy(f).multiplyScalar(J.sideFlipForward); break;
    case 'LongJump': c.vy = J.vy.LongJump; c.hvel.copy(f).multiplyScalar(Math.min(c.speed * J.longJumpBoost, J.longJumpMax)); break;
    case 'WallKick': c.vy = J.vy.WallKick; c.hvel.copy(f).multiplyScalar(J.wallKickForward); break;
    case 'JumpKick': break;
  }
  if (input?.face && (kind === 'Jump' || kind === 'JumpUp')) c.hvel.copy(input.move).multiplyScalar(c.runSpeed * J.firstPersonCarry).setY(0);
  c.jumpKind = kind;
  c.lastJump = kind;
  c.jumpBuffer = 0;
  c.grounded = false;
  c.peakY = c.feetY();
  c.stats.jumps++;
  c.enter('jump');
}

function startFall(c: PlatformerCharacter): void {
  c.setStance('stand'); // keep a smaller stance if there's no headroom
  c.peakY = c.feetY();
  c.enter('fall');
}

/** Walked (or skidded) off an edge: fall, moving on this step (a step standing still is a hitch). */
function fallNow(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  startFall(c);
  stepAir(c, dt, input);
}

function stepAir(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const A = T.air;
  // Air control (Mario 64): momentum is kept. The stick bends the path a little, adds speed
  // only up to a modest cap, and pulling back against the motion slows it gently; it can't
  // turn a jump round. Facing follows slowly.
  const mag = Math.min(1, input.move.length());
  const noSteer = c.state === 'dive' || c.jumpKind === 'Backflip' || c.jumpKind === 'LongJump';
  if (mag > G.deadzone && !noSteer) {
    const want = Math.atan2(input.move.x, input.move.z);
    if (input.face) {
      // first person: strafe in the air, but no faster than the same cap
      const target = c.tmpVec.copy(input.move).setY(0).normalize().multiplyScalar(Math.max(c.speed, c.runSpeed * A.maxSteerSpeed * mag));
      c.hvel.lerp(target, 1 - Math.exp(-A.strafeRate * dt));
    } else airSteer(c, dt, want, mag);
    if (!input.face) c.facing = turnToward(c.facing, want, A.turnRate * dt);
  }

  // Variable jump height: releasing jump while rising cuts the arc (not for flips).
  const fixedArc = c.jumpKind === 'Backflip' || c.jumpKind === 'TripleJump' || c.jumpKind === 'SideFlip' || c.jumpKind === 'LongJump';
  const g = c.state === 'jump' && c.vy > 0 && !input.jumpHeld && !fixedArc ? T.gravity * A.shortHopGravity : T.gravity;
  c.vy = Math.max(c.vy + g * dt, T.maxFall);
  // Remember a press for the landing (a wall kick below uses it up instead).
  if (input.jump) c.jumpBuffer = T.jump.buffer;

  if (c.state !== 'dive') {
    if (input.crouchPressed && c.stateTime > A.poundAfter) return startGroundPound(c);
    if (input.attack) {
      const D = T.dive;
      if (c.speed > D.minSpeed || mag > D.minStick) {
        c.enter('dive');
        c.hvel.copy(c.fwd()).multiplyScalar(Math.min(Math.max(c.speed, D.baseSpeed) + D.boost, D.maxSpeed));
        c.vy = Math.max(c.vy, D.lift);
      } else {
        c.jumpKind = 'JumpKick';
        c.stateTime = 0;
      }
    }
    if (input.jump && c.touchingWall()) return wallKick(c);
  }

  c.peakY = Math.max(c.peakY, c.feetY());
  const wasRising = c.vy > 0;
  c.move(dt);
  if (wasRising && c.lastBonk) c.vy = 0;
  if (c.state === 'jump' && c.vy < A.fallBelow && c.jumpKind !== 'LongJump') c.state = 'fall';

  if (c.grounded && c.vy <= 0) return land(c, input);
  if (c.vy < A.grabBelowVy && c.state !== 'dive' && c.ledgeCooldown === 0) {
    if (checkClimb(c, input, true)) return;
    const ledge = c.findLedge(c.feetInto(c.tmpFeet), c.fwd());
    if (ledge) return grabLedge(c, ledge);
  }
  if (c.vy < 0 && c.state !== 'dive' && c.ledgeCooldown === 0) checkWallSlide(c, input);
}

// ------------------------------------------------------------------ walls (slide, kick)

/** Falling while pushing into a wall: slide down it, facing it (a jump kicks off). */
function checkWallSlide(c: PlatformerCharacter, input: MoveInput): boolean {
  const W = T.wallSlide;
  const mag = input.move.length();
  if (input.face || mag < W.minStick) return false;
  const dir = c.tmpVec.copy(input.move).setY(0).normalize();
  const hit = c.ray(c.probe(T.probes.chest), dir, T.body.radius + W.reach);
  if (!hit || Math.abs(hit.normal.y) > T.probes.wallY || c.physics.hasTag(hit.collider, 'climbable')) return false;
  const n = hit.normal.setY(0).normalize();
  if (-dir.dot(n) < W.pushIn) return false;
  c.wallNormal.copy(n);
  c.facing = Math.atan2(-n.x, -n.z);
  c.hvel.set(0, 0, 0);
  c.vy = Math.max(c.vy, -W.speed);
  c.enter('wallSlide');
  return true;
}

function stepWallSlide(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const W = T.wallSlide;
  if (input.jump) return wallKick(c);
  const n = c.wallNormal;
  const into = -(input.move.x * n.x + input.move.z * n.z);
  const hit = c.ray(c.probe(T.probes.chest), c.tmpVec.copy(n).negate(), T.body.radius + W.holdReach);
  if (input.crouchPressed || into < W.letGo || !hit || Math.abs(hit.normal.y) > T.probes.wallY) {
    // let go (or ran out of wall): fall away from it
    c.hvel.copy(n).multiplyScalar(W.pushOff);
    c.ledgeCooldown = W.cooldown;
    return startFall(c);
  }
  n.copy(hit.normal).setY(0).normalize();
  c.facing = Math.atan2(-n.x, -n.z);
  // a ledge within reach (the top of the wall) is grabbed
  if (c.ledgeCooldown === 0) {
    const ledge = c.findLedge(c.feetInto(c.tmpFeet), c.fwd());
    if (ledge) return grabLedge(c, ledge);
  }
  // friction: a slow slide whatever the speed it started at
  c.vy = c.vy > -W.speed ? Math.max(c.vy + T.gravity * dt, -W.speed) : approach(c.vy, -W.speed, W.friction * dt);
  c.hvel.copy(n).multiplyScalar(-W.press); // stay against the wall
  c.peakY = c.feetY(); // sliding down a wall is not a fall: no hard landing at the bottom
  c.move(dt);
  if (c.grounded && c.vy <= 0) land(c, input);
}

/** Bend the air velocity toward `want` (yaw), speed up toward the cap, or brake against it. */
function airSteer(c: PlatformerCharacter, dt: number, want: number, mag: number): void {
  const A = T.air;
  const speed = c.speed;
  const cap = c.runSpeed * A.maxSteerSpeed * mag;
  if (speed < 0.1) {
    // from (nearly) standing still: drift the way the stick points
    const s = Math.min(cap, speed + A.accel * mag * dt);
    c.hvel.set(Math.sin(want) * s, 0, Math.cos(want) * s);
    return;
  }
  const dir = Math.atan2(c.hvel.x, c.hvel.z);
  const off = angleDiff(want, dir);
  let s = speed;
  let heading = dir;
  if (Math.abs(off) < A.brakeAngle) {
    heading = turnToward(dir, want, A.steerRate * mag * dt);
    if (s < cap) s = Math.min(cap, s + A.accel * mag * dt);
  } else s = approach(s, 0, A.brake * mag * dt);
  c.hvel.set(Math.sin(heading) * s, 0, Math.cos(heading) * s);
}

function wallKick(c: PlatformerCharacter): void {
  const hit = c.ray(c.probe(T.probes.chest), c.fwd(), T.body.radius + T.air.wallKickReach);
  if (!hit) return;
  const n = hit.normal.setY(0).normalize();
  c.facing = Math.atan2(n.x, n.z);
  startJump(c, 'WallKick');
}

function startGroundPound(c: PlatformerCharacter): void {
  c.enter('groundPound');
  c.poundDelay = T.groundPound.hang;
  c.hvel.set(0, 0, 0);
  c.vy = 0;
}

function stepGroundPound(c: PlatformerCharacter, dt: number): void {
  if (c.poundDelay > 0) {
    c.poundDelay -= dt; // hang in the air for the spin
    c.vy = 0;
  } else {
    c.vy = T.groundPound.speed;
  }
  c.move(dt);
  if (c.grounded && c.poundDelay <= 0) {
    c.stats.landings++;
    c.lastLandTime = c.clock;
    c.peakY = c.feetY();
    c.enter('groundPoundLand');
  }
}

function land(c: PlatformerCharacter, input: MoveInput): void {
  const drop = c.peakY - c.feetY();
  c.landImpact = MathUtils.clamp(-c.vy / T.visual.impactFullVy, T.visual.impactMin, 1);
  c.stats.landings++;
  c.lastLandTime = c.clock;
  c.vy = 0;
  c.peakY = c.feetY();
  if (c.state === 'dive') return c.enter('bellySlide');
  if (drop > T.air.hardLandDrop) {
    c.hvel.set(0, 0, 0);
    return c.enter('hardLand');
  }
  if (input.move.length() > T.jump.movingStick) c.enter(c.speed > G.runAbove ? 'run' : 'walk');
  else {
    c.hvel.multiplyScalar(T.air.landKeep);
    c.enter('land');
  }
}

function stepBellySlide(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  c.decel(dt, T.dive.slideDecel);
  c.move(dt);
  if (!c.grounded) c.enter('fall');
  else if (input.jump || input.attack || c.speed < T.dive.slideEnd) c.enter('getUpFront');
}

// ------------------------------------------------------------------ ledges

function grabLedge(c: PlatformerCharacter, ledge: Ledge): void {
  c.ledge = ledge;
  c.hvel.set(0, 0, 0);
  c.vy = 0;
  c.facing = Math.atan2(-ledge.normal.x, -ledge.normal.z);
  const feet = ledge.point.clone().addScaledVector(ledge.normal, T.body.radius + T.probes.hangGap).setY(ledge.y - T.ledge.hangDrop);
  c.setFeet(feet, true);
  c.stats.ledgeGrabs++;
  c.enter('hang');
}

function stepHang(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const L = T.ledge;
  const ledge = c.ledge!;
  const toWall = ledge.normal.clone().negate();
  const along = new Vector3().crossVectors(UP, ledge.normal).normalize();
  const pushIn = input.move.dot(toWall);
  const side = input.move.dot(along);
  if ((input.jump || pushIn > L.pushIn) && c.stateTime > L.settle) return startPullUp(c, ledge);
  if ((input.crouch || pushIn < -L.pushIn) && c.stateTime > L.settle) {
    c.ledge = null;
    c.ledgeCooldown = L.cooldown;
    c.hvel.copy(ledge.normal).multiplyScalar(L.dropPush);
    return startFall(c);
  }
  c.shimmy = 0;
  if (Math.abs(side) > L.shimmyStick) {
    const step = along.clone().multiplyScalar(Math.sign(side) * L.shimmySpeed * dt);
    const next = c.feet.add(step);
    const ahead = c.findLedge(next.clone().add(along.clone().multiplyScalar(Math.sign(side) * L.shimmyLookahead)), toWall);
    if (ahead && Math.abs(ahead.y - ledge.y) < L.shimmyStep) {
      c.setFeet(next);
      c.ledge = { ...ledge, point: ledge.point.clone().add(step) };
      c.shimmy = Math.sign(side);
    }
  }
}

function startPullUp(c: PlatformerCharacter, ledge: Ledge): void {
  c.pullFrom.copy(c.feet);
  c.pullTo.copy(ledge.point).addScaledVector(ledge.normal, -(T.body.radius + T.probes.standIn)).setY(ledge.y + T.probes.pullTopLift);
  c.setStance('crouch', true);
  c.ledge = null;
  c.stats.pullUps++;
  c.enter('pullUp');
}

function stepPullUp(c: PlatformerCharacter): void {
  const L = T.ledge;
  const dur = c.clipDuration('PullUp', 0.9);
  const t = Math.min(1, c.stateTime / dur);
  const up = MathUtils.smoothstep(t, 0, L.pullRise);
  const over = MathUtils.smoothstep(t, L.pullInFrom, L.pullInTo);
  const p = new Vector3(
    MathUtils.lerp(c.pullFrom.x, c.pullTo.x, over),
    MathUtils.lerp(c.pullFrom.y, c.pullTo.y, up),
    MathUtils.lerp(c.pullFrom.z, c.pullTo.z, over),
  );
  c.setFeet(p);
  if (t >= 1) {
    c.grounded = true;
    c.peakY = c.feetY();
    c.enter(c.setStance('stand') ? 'idle' : 'crouch');
  }
}

// ------------------------------------------------------------------ climbing

function checkClimb(c: PlatformerCharacter, input: MoveInput, inAir = false): boolean {
  const f = c.fwd();
  if (!inAir && input.move.dot(f) < T.climb.startStick) return false;
  const hit = c.ray(c.probe(T.probes.chest), f, T.body.radius + T.climb.reach);
  if (!hit || !c.physics.hasTag(hit.collider, 'climbable')) return false;
  const n = hit.normal.setY(0).normalize();
  c.facing = Math.atan2(-n.x, -n.z);
  c.hvel.set(0, 0, 0);
  c.vy = 0;
  c.setStance('stand', true);
  c.enter('climb');
  return true;
}

function stepClimb(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const C = T.climb;
  const R = T.body.radius;
  const f = c.forward;
  const chest = c.feet.add(new Vector3(0, T.probes.chest, 0));
  const hit = c.ray(chest, f, R + C.holdReach);
  if (!hit || !c.physics.hasTag(hit.collider, 'climbable')) {
    // Ran out of wall at chest height: climb over the top if there's a ledge.
    const top = c.ray(chest.clone().addScaledVector(f, R + C.topReach).setY(chest.y + C.topProbe), DOWN, C.topDown);
    if (top && top.normal.y > T.probes.floorY) {
      const n = f.clone().negate();
      const point = chest.clone().addScaledVector(f, R + T.probes.topLift);
      const y = chest.y + C.topProbe - top.distance;
      if (c.roomToStandOn(point, n, y)) return startPullUp(c, { y, normal: n, point });
      c.vy = 0; // blocked above: hang on at the top of the wall
      return;
    }
    return startFall(c);
  }
  const n = hit.normal.setY(0).normalize();
  c.facing = Math.atan2(-n.x, -n.z);
  const along = new Vector3().crossVectors(UP, n).normalize();
  const upIn = input.move.dot(f.clone().setY(0).normalize());
  const side = input.move.dot(along);
  if (input.jump) {
    c.facing = Math.atan2(n.x, n.z);
    c.ledgeCooldown = C.wallKickCooldown;
    return startJump(c, 'WallKick');
  }
  if (input.crouch) {
    c.ledgeCooldown = C.dropCooldown;
    c.hvel.copy(n).multiplyScalar(C.dropPush);
    return startFall(c);
  }
  // Stay glued to the wall.
  const gap = hit.distance - (R + T.probes.hangGap);
  const vel = along.multiplyScalar(side * C.sideSpeed).addScaledVector(f, gap / dt * C.glue);
  c.hvel.set(vel.x, 0, vel.z);
  c.vy = upIn * C.upSpeed;
  c.move(dt, undefined, false);
  if (c.grounded && upIn < -C.downStick) c.enter('idle');
}

// ------------------------------------------------------------------ push / pull

function checkPush(c: PlatformerCharacter, input: MoveInput): boolean {
  const B = T.block;
  const len = input.move.length();
  if (len < B.pushStick || input.move.dot(c.fwd()) / len < B.pushAlign) return false;
  const b = c.blockAhead(B.pushReach);
  if (!b || !c.physics.hasTag(b.collider, 'pushable')) return false;
  c.block = b.body;
  c.blockCollider = b.collider;
  c.facing = Math.atan2(-b.normal.x, -b.normal.z);
  c.hvel.set(0, 0, 0);
  c.enter('push');
  return true;
}

function checkGrab(c: PlatformerCharacter): boolean {
  const b = c.blockAhead(T.block.grabReach);
  if (!b) return false;
  c.block = b.body;
  c.blockCollider = b.collider;
  c.facing = Math.atan2(-b.normal.x, -b.normal.z);
  c.hvel.set(0, 0, 0);
  c.grabbing = true;
  c.enter('grab');
  return true;
}

function stepBlock(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const B = T.block;
  const release = (next: MoveState = 'idle') => {
    if (c.block) {
      const v = c.block.linvel();
      c.block.setLinvel({ x: 0, y: v.y, z: 0 }, true);
    }
    c.block = null;
    c.blockCollider = null;
    c.grabbing = false;
    c.enter(next);
  };
  if (!c.grounded) {
    release('fall');
    return startFall(c);
  }
  if (input.jump) {
    release();
    return groundJump(c, input);
  }
  if (!c.grabbing && input.grab) c.grabbing = true; // push → grab
  if (c.grabbing && !input.grab) return release();
  const f = c.forward;
  const along = input.move.dot(f);
  const b = c.blockAhead(c.grabbing ? B.holdReach : B.pushHoldReach);
  if (!b || b.body !== c.block) return release();

  let v = 0;
  if (along > B.moveStick) v = B.pushSpeed;
  else if (c.grabbing && along < -B.moveStick) v = -B.pullSpeed;
  if (!c.grabbing && v === 0) return release(); // stopped pushing
  c.state = v > 0 ? 'push' : v < 0 ? 'pull' : 'grab';
  if (v > 0) c.stats.pushes++;
  if (v < 0) c.stats.pulls++;

  const block: RAPIER.RigidBody = c.block!;
  const blockVel = block.linvel();
  // pushing a crate that doesn't move (blocked): lean on it
  c.leaning = v > 0 && c.stateTime > T.block.stuckAfter && Math.hypot(blockVel.x, blockVel.z) < T.block.stuckSpeed;
  const push = f.clone().multiplyScalar(v);
  block.setLinvel({ x: push.x, y: Math.min(blockVel.y, 0), z: push.z }, true);
  // Keep a steady gap to the block and move with it (the block is excluded from the sweep).
  const gap = b.distance - (T.body.radius + B.gap);
  c.hvel.copy(push).addScaledVector(f, (gap / dt) * B.gapGain);
  c.move(dt, c.blockCollider ?? undefined);
}

// ------------------------------------------------------------------ slopes

function checkSlope(c: PlatformerCharacter): boolean {
  const S = T.slope;
  const n = c.groundNormal();
  if (!n) return false;
  const angle = Math.acos(MathUtils.clamp(n.y, -1, 1));
  if (angle > MathUtils.degToRad(S.slideAboveDeg) || (c.slipperyBelow() && angle > MathUtils.degToRad(S.slipperyAboveDeg))) {
    c.enter('slide');
    return true;
  }
  return false;
}

function stepSlide(c: PlatformerCharacter, dt: number, input: MoveInput): void {
  const S = T.slope;
  const n = c.groundNormal();
  if (input.jump) return startJump(c, 'Jump', input);
  if (!n) {
    if (!c.grounded) return startFall(c);
    c.decel(dt, S.flatDecel);
    c.move(dt);
    if (c.speed < S.offEndSpeed) c.enter('land');
    return;
  }
  const downhill = new Vector3(0, -1, 0).projectOnPlane(n).setY(0);
  const steep = downhill.length();
  if (steep > S.minSteep) {
    downhill.normalize();
    c.hvel.addScaledVector(downhill, S.accel * steep * dt);
    if (c.hvel.length() > S.maxSpeed) c.hvel.setLength(S.maxSpeed);
    c.facing = turnToward(c.facing, Math.atan2(downhill.x, downhill.z), S.turnRate * dt);
    // light steering
    c.hvel.addScaledVector(input.move, S.steer * dt);
  } else {
    c.decel(dt, S.flatDecel);
  }
  c.vy = S.vy;
  c.move(dt);
  const angle = Math.acos(MathUtils.clamp(n.y, -1, 1));
  if (angle < MathUtils.degToRad(S.stopBelowDeg) && c.speed < S.stopSpeed) c.enter('land');
}
