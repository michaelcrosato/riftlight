/**
 * Every number that shapes how PlatformerCharacter moves and feels, in one place.
 * Units: metres, seconds, m/s, m/s², radians (or degrees where the name says `Deg`).
 * The state table (states.ts) and the core (PlatformerCharacter.ts) read these; change a
 * value here and film the move (`npm run film -- <scenario>`) to see the effect.
 */
export const TUNING = {
  /** Capsule and character controller. */
  body: {
    radius: 0.3,
    /** Capsule half height (between the hemispheres) per stance: prone is a ball. */
    half: { stand: 0.5, crouch: 0.2, prone: 0 },
    /** Eye height per stance (first person), and how far ahead of the feet the eye sits. */
    eye: { stand: 1.45, crouch: 0.85, prone: 0.35, ahead: 0.12, aheadProne: 0.5 },
    /** Spawn/teleport this far above the given feet height: starting in exact contact with
     *  the ground can leave Rapier's KCC with a degenerate contact (it stops moving). */
    spawnLift: 0.03,
    kccOffset: 0.02,
    autostepHeight: 0.4,
    autostepMinWidth: 0.15,
    snapToGround: 0.35,
    maxSlopeClimbDeg: 46,
    minSlopeSlideDeg: 40,
  },
  /** Ray probes around the capsule (heights above the feet, lengths). */
  probes: {
    /** Wall / climb / wall-kick rays start this high above the feet. */
    chest: 1.0,
    /** Block rays (push / grab) start at knee height. */
    knee: 0.45,
    /** Ground rays start this high above the feet and reach `groundDown` below that. */
    groundUp: 0.3,
    groundDown: 0.8,
    /** "Ground ahead" rays (teeter, braking) reach this far down. */
    aheadDown: 0.9,
    /** A surface whose normal has |y| below this is a wall; above `floorY` it's a floor. */
    wallY: 0.3,
    floorY: 0.7,
    /** Room to stand: rays this far around the spot (and the stance check's 0.95 r ring). */
    standSpread: 0.25,
    standRing: 0.95,
    standStart: 0.25,
    standMargin: 0.02,
    /** Pull-up / climb top-out: stand this far in from the wall, this high above the top. */
    standIn: 0.25,
    topLift: 0.05,
    pullTopLift: 0.02,
    /** Hang this far out from the wall. */
    hangGap: 0.04,
    /** Ledge probes: past the wall face, and just outside it (overhang check). */
    ledgeIn: 0.15,
    ledgeOut: 0.05,
  },
  /** Presentation: the model turns toward the facing at this rate (1/s; snapFacing states turn at once), default fade-in (s). */
  visual: { turnRate: 16, fade: 0.12 },
  gravity: -32,
  /** Terminal fall speed (m/s, downward). */
  maxFall: -30,

  /** Walking and running (Mario-style: turn toward the stick, speed builds along facing). */
  ground: {
    runSpeed: 6.5,
    /** Top speed with the walk modifier held. */
    walkSpeed: 2.2,
    accel: 45,
    /** Slowing down (stick let go) is this much quicker than speeding up. */
    brakeFactor: 1.3,
    turnRate: 14,
    /** First person (strafing): velocity follows the stick at this rate (1/s). */
    strafeResponse: 12,
    /** Side-scroller lane lock: close this share of the drift off the lane per step. */
    laneGain: 0.5,
    /** Below `slowTurnSpeed` the character turns `slowTurnBoost` times faster. */
    slowTurnSpeed: 2,
    slowTurnBoost: 1.6,
    /** Walk below this speed, run above (also the speed a skid or landing runs on at). */
    runAbove: 3.2,
    /** Below this speed with the stick let go: standing (idle / teeter). */
    stopSpeed: 0.3,
    /** Stick tilt under which the stick counts as let go. */
    deadzone: 0.1,
    /** Stick tilt under which walking is tiptoeing (keyboard is always full tilt). */
    tiptoeBelow: 0.5,
    /** Grace period for jumping after walking off an edge. */
    coyote: 0.1,
    /** Look this far ahead for ground: none = teeter at the edge. */
    teeterLookahead: 0.45,
    /** Idle this long and the character lies down and dozes off. */
    dozeAfter: 16,
    /** After this long idle, glance around (IdleLook) for the first `lookFor` s of every `lookEvery`. */
    lookAfter: 6,
    lookEvery: 10,
    lookFor: 3.4,
  },
  /** Step up / step down animation when the feet change height between steps. */
  steps: { minSpeed: 0.3, maxSpeed: 4.5, rise: 0.08, duration: 0.25 },

  /** Skids: turning around at speed, or braking when the stick is let go at a run. */
  skid: {
    /** Reversing the stick (more than `turnAngle` from facing) above this speed skids. */
    turnSpeed: 4.5,
    turnAngle: 2.3,
    turnStick: 0.2,
    /** Letting go at a run faster than this brakes (with ground `brakeLookahead` ahead). */
    brakeSpeed: 5,
    brakeLookahead: 0.9,
    turnDecel: 18,
    brakeDecel: 28,
    /** Braking toward a drop: stop hard if the ground ends this close. */
    edgeLookahead: 0.35,
    edgeDecel: 60,
    /** In a skid, the stick this far from facing (rad) still counts as reversing. */
    reverseAngle: 1.6,
    /** Stick (squared tilt) that counts as steering during a skid. */
    stickMinSq: 0.04,
    endSpeed: 0.8,
  },

  /** Crouch, crouch walk and crouch slide. */
  crouch: {
    walkSpeed: 1.6,
    accel: 30,
    /** Crouching faster than this slides. */
    slideAbove: 4,
    slideDecel: 7,
    slideEnd: 0.6,
    /** Jumping out of a crouch slide faster than this is a long jump (else a backflip). */
    longJumpAbove: 3,
  },
  prone: { crawlSpeed: 1.0, accel: 8, turnRate: 3, downDecel: 20 },

  /** Jumps: launch speeds (m/s up) and what they need. */
  jump: {
    vy: { Jump: 10.5, JumpUp: 11.5, DoubleJump: 12.5, TripleJump: 15, Backflip: 15.5, SideFlip: 14, LongJump: 7.5, WallKick: 12.5 },
    /** Triple jump: at least this ground speed. */
    tripleMinSpeed: 5,
    /** Backflip: backwards at this speed. Side flip and wall kick: forwards. */
    backflipBack: 2.2,
    sideFlipForward: 2.5,
    wallKickForward: 5,
    /** Long jump: ground speed × this, at most `longJumpMax`. */
    longJumpBoost: 1.5,
    longJumpMax: 11,
    /** Crouch + jump faster than this is a long jump (else a backflip). */
    longJumpAbove: 4,
    /** First person: a jump carries the stick direction at this share of the run speed. */
    firstPersonCarry: 0.8,
    /** Double / triple jump: jump again within this long of landing, moving faster than `chainSpeed`. */
    chainWindow: 0.22,
    chainSpeed: 1.5,
    tripleSpeed: 3,
    /** Stick tilt that counts as moving (Jump instead of JumpUp, chains). */
    movingStick: 0.2,
    /** Faster than this jumps forward (Jump) even with the stick let go. */
    forwardAbove: 0.5,
    /** A jump pressed this long before touchdown still jumps on landing. */
    buffer: 0.12,
  },

  /** In the air. */
  air: {
    /** Air control: steer toward the stick at this rate (1/s), up to `steerSpeed` × run speed. */
    steerRate: 3,
    steerSpeed: 0.7,
    turnRate: 4,
    /** Releasing jump while rising multiplies gravity by this (variable jump height). */
    shortHopGravity: 2.2,
    /** Falling faster than this (m/s down) turns a jump into a fall. */
    fallBelow: -6,
    /** A ground pound can start this long into a jump. */
    poundAfter: 0.1,
    /** Ledges and climbable walls are grabbed once rising slower than this. */
    grabBelowVy: 3,
    /** Falling further than this lands hard (face-plant). */
    hardLandDrop: 5.5,
    /** A soft landing with the stick let go keeps this share of the speed. */
    landKeep: 0.3,
    /** Wall kick: a wall within this reach of the capsule, at chest height. */
    wallKickReach: 0.35,
    touchWallReach: 0.3,
  },
  /** Dive (attack in the air while moving) and belly slide. */
  dive: { minSpeed: 3, minStick: 0.5, boost: 3, baseSpeed: 5, maxSpeed: 10, lift: 3, slideDecel: 5, slideEnd: 0.5 },
  groundPound: { hang: 0.28, speed: -24 },

  /** Landing lag, get-ups and other locked states: decelerate, then idle. */
  lock: { decel: 30, land: 0.16, default: 0.3 },
  /** Lie down, sit, emote: decelerate in place; a stick tilt (squared) over `wakeStickSq` gets up. */
  rest: { decel: 30, wakeStickSq: 0.1, /** Lying this long falls asleep. */ sleepAfter: 6 },

  /** Punch, punch, kick. */
  attack: {
    decel: 20,
    /** Chain the next hit when pressed within this long of the last one ending. */
    chainWindow: 0.35,
    /** A press this far into a hit queues the next one. */
    queueAfter: 0.1,
  },

  /** Running into walls. */
  wall: {
    /** Head-on into a wall faster than this (the part of the velocity into it) bonks. */
    bonkSpeed: 5,
    /** Obstacles reaching this high above the feet are walls; lower ones are steps. */
    checkHeight: 0.45,
    checkReach: 0.15,
    /** cos of the widest angle between velocity and wall normal that is still head-on (~30°). */
    headOnCos: 0.87,
  },

  /** Ledge grab, hang, shimmy, pull up. */
  ledge: {
    /** Feet this far below the ledge top while hanging. */
    hangDrop: 1.72,
    /** Chest height of the wall probe, and its reach beyond the capsule. */
    chest: 1.25,
    reach: 0.4,
    /** Probe for the top from this high above the feet; a grabbable top is within `minTop..maxTop` of the feet. */
    probe: 2.3,
    topReach: 1.3,
    minTop: 1.3,
    maxTop: 2.25,
    /** Hang this long before a pull-up or drop is accepted. */
    settle: 0.2,
    /** Stick toward / away from the wall needed to pull up / drop. */
    pushIn: 0.5,
    /** Dropping off: pushed away at this speed, no re-grab for `cooldown` s. */
    dropPush: 1.2,
    cooldown: 0.4,
    shimmySpeed: 1.5,
    shimmyLookahead: 0.3,
    shimmyStick: 0.2,
    /** A ledge ahead must be within this height of the current one to shimmy onto it. */
    shimmyStep: 0.2,
    /** Pull-up path: rise over the first `rise` of the clip, move in over `inFrom..inTo`. */
    pullRise: 0.55,
    pullInFrom: 0.4,
    pullInTo: 0.85,
  },
  /** Climbing walls tagged 'climbable'. */
  climb: {
    upSpeed: 2.2,
    sideSpeed: 1.6,
    /** Start climbing with the stick at least this much toward the wall. */
    startStick: 0.5,
    reach: 0.3,
    holdReach: 0.5,
    /** Stay glued: close this share of the gap to the wall per step. */
    glue: 0.5,
    /** Top-out: look for a top this far above the chest. */
    topProbe: 1.3,
    topReach: 0.45,
    topDown: 2.2,
    /** Climbing down onto the ground with the stick this far back steps off. */
    downStick: 0.1,
    wallKickCooldown: 0.3,
    dropCooldown: 0.4,
    dropPush: 1,
    /** Climbing faster than this (up or sideways) plays Climb, else ClimbIdle. */
    moving: 0.2,
  },
  /** Push, grab and pull blocks tagged 'pushable' / 'grabbable'. */
  block: {
    pushSpeed: 1.5,
    pullSpeed: 1.3,
    pushReach: 0.12,
    grabReach: 0.4,
    holdReach: 0.5,
    pushHoldReach: 0.2,
    /** Pushing needs the stick this far over and pointing this much along facing (cos). */
    pushStick: 0.3,
    pushAlign: 0.75,
    /** Stick along facing that pushes / pulls. */
    moveStick: 0.3,
    /** Keep this gap to the block, closing `gapGain` of the difference per step. */
    gap: 0.03,
    gapGain: 0.3,
  },
  /** Slope sliding on steep or 'slippery' ground. */
  slope: {
    slideAboveDeg: 38,
    slipperyAboveDeg: 12,
    accel: 22,
    maxSpeed: 9,
    turnRate: 8,
    steer: 4,
    flatDecel: 14,
    /** Ground flatter than this (horizontal part of its downhill vector) doesn't pull. */
    minSteep: 0.05,
    stopBelowDeg: 10,
    stopSpeed: 1.2,
    offEndSpeed: 1,
    vy: -2,
  },
} as const;
