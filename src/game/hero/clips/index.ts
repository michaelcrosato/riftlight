// Every hero clip, as data, in one list (the order the tools and the Lab show them in).
// Edit the clip files next to this one; `npm run anim -- check` measures them all.
import type { ClipDef } from '../../../engine/animation';
import { Idle, IdleLook, Teeter } from './standing';
import { Tiptoe, Walk, Run, Skid, SkidTurn, StepUp, StepDown } from './locomotion';
import { Crouch, CrouchWalk, CrouchSlide, ProneDown, Prone, Crawl, GetUpFront, Sit, SitDown, StandUp, LieDown, LieIdle, Sleep, GetUp } from './crouch';
import { Jump, JumpUp, DoubleJump, TripleJump, Backflip, SideFlip, LongJump, WallKick, WallSlide, Fall, Dive, BellySlide, GroundPoundSpin, GroundPound, GroundPoundLand, Land, HardLand, Slide } from './air';
import { Hang, ShimmyRight, ShimmyLeft, PullUp, ClimbIdle, Climb } from './ledge';
import { Push, PushIdle, Grab, Pull } from './block';
import { Punch, Punch2, Kick, SweepKick, JumpKick } from './attacks';
import { Wave, Victory, Hurt } from './emotes';

export const HERO_CLIPS: readonly ClipDef[] = [
  Idle, IdleLook, Teeter,
  Tiptoe, Walk, Run, Skid, SkidTurn, StepUp, StepDown,
  Crouch, CrouchWalk, CrouchSlide, ProneDown, Prone, Crawl, GetUpFront,
  Sit, SitDown, StandUp, LieDown, LieIdle, Sleep, GetUp,
  Jump, JumpUp, DoubleJump, TripleJump, Backflip, SideFlip, LongJump, WallKick, WallSlide,
  Fall, Dive, BellySlide, GroundPoundSpin, GroundPound, GroundPoundLand, Land, HardLand, Slide,
  Hang, ShimmyRight, ShimmyLeft, PullUp, ClimbIdle, Climb,
  Push, PushIdle, Grab, Pull,
  Punch, Punch2, Kick, SweepKick, JumpKick,
  Wave, Victory, Hurt,
];
