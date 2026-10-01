/**
 * The scripted run through Rift Runner: a tiny reactive pilot that reads the hero's state and
 * position and presses what a player would (run, jump at the pit, double jump onto the ledge,
 * wall kicks up the chimney, ground pound through the cracked floor, hop to the flag). It is
 * how the e2e suite and `__RIFTLIGHT__.arcade.autoplay()` prove the course can be finished
 * with the real moveset, frame-exactly under `Engine.step`.
 *
 * Each beat is `{ name, act(view) }`: `act` fills the input and returns the next beat's name
 * (or its own to stay). A beat that never moves on is a stuck run: `stage.time` keeps growing
 * and the caller's frame budget runs out. Edit the stage → rerun `__RIFTLIGHT__.arcade.autoplay()`.
 */
import type { MoveInput } from '../../../engine';
import type { ArcadeStage } from './ArcadeStage';
import { ARCADE_STAGE } from './stage';

interface View {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  state: string;
  out: MoveInput;
  /** Frames in this beat. */
  t: number;
  memo: Record<string, number>;
}

type Beat = (v: View) => string | null;

const S = ARCADE_STAGE;

const run = (v: View, dir = 1) => v.out.move.set(dir, 0, 0);
/** Press jump this step and keep it held (full height) for a few frames. */
const jump = (v: View, hold = 10) => {
  if (v.memo.jumpHold === undefined || v.memo.jumpHold <= 0) {
    v.out.jump = true;
    v.memo.jumpHold = hold;
  }
};

/** Beats in course order; each returns the next beat (or null to stay). */
const BEATS: Record<string, Beat> = {
  // run at the pit and jump from its lip
  start: (v) => {
    run(v);
    if (v.grounded && v.x >= 10.9 && v.x < 12) jump(v, 14);
    return v.x > 15.2 && v.grounded ? 'step' : null;
  },
  // onto the brick step...
  step: (v) => {
    run(v);
    if (v.grounded && v.x >= 19.4 && v.y < 0.5) jump(v, 12);
    return v.grounded && v.y > 1.1 ? 'ledge' : null;
  },
  // ...and jump again from its far edge, inside the chain window: a double jump up onto the ledge
  ledge: (v) => {
    run(v);
    if (v.grounded && v.y > 1.1 && v.y < 1.4 && (v.x >= 22.6 || v.t >= 10)) jump(v, 16);
    if (v.state === 'hang') v.out.jump = v.t % 8 === 0; // caught the edge: pull up
    if (v.grounded && v.y < 0.5 && v.x > 23) return 'back'; // fell short: around again
    return v.grounded && v.y > 3.0 ? 'chimney-walk' : null;
  },
  // back over the step (hop onto it from the right), then try again
  back: (v) => {
    run(v, -1);
    if (v.grounded && v.y < 0.5 && v.x > 22.9 && v.x < 24.2) jump(v, 12);
    return v.x < 19 && v.grounded ? 'step' : null;
  },
  // off the ledge and under the hanging wall into the chimney
  'chimney-walk': (v) => {
    run(v, v.x < 37.3 ? 1 : 0);
    return v.x >= 37.1 && v.grounded && v.y < 0.5 ? 'kick' : null;
  },
  // wall kicks: jump at the right wall, kick off it to the left wall and back, until on top
  kick: (v) => {
    const dir = v.memo.dir ?? 1;
    v.memo.dir = dir;
    run(v, dir);
    if (v.state === 'hang') {
      run(v, 1);
      v.out.jump = v.t % 8 === 0;
    } else if (v.grounded && v.y < 0.5) {
      v.memo.dir = 1;
      jump(v, 14);
    } else if (v.state === 'wallSlide' || (v.memo.kickWait !== undefined && v.memo.kickWait <= 0 && !v.grounded && touching(v, dir))) {
      v.out.jump = true;
      v.memo.dir = -dir;
      v.memo.kickWait = 6;
    }
    v.memo.kickWait = (v.memo.kickWait ?? 0) - 1;
    return v.grounded && v.y > 5.2 ? 'slabs' : null;
  },
  // along the top to the middle of the cracked slabs, jump, ground pound
  slabs: (v) => {
    const goal = (S.breakable[0]!.x[0] + S.breakable[S.breakable.length - 1]!.x[1]) / 2;
    if (v.grounded && v.y > 5) {
      run(v, v.x < goal - 0.2 ? 1 : 0);
      if (Math.abs(v.x - goal) < 0.6) jump(v, 6);
    } else if (!v.grounded && v.vy < 1 && v.y > 5.6) v.out.crouchPressed = v.out.crouch = true;
    return v.y < 3 ? 'flag' : null;
  },
  // run to the flag; hop the little brick
  flag: (v) => {
    run(v);
    if (v.grounded && v.x > 50.6 && v.x < 52 && v.y < 0.4) jump(v, 8);
    return null;
  },
};

/** Within reach of the chimney wall on side `dir`. */
function touching(v: View, dir: number): boolean {
  return dir > 0 ? v.x > 38.4 - 0.55 : v.x < 36.6 + 0.55;
}

/** A fresh pilot (beats and memory), for `stage.autopilot`. */
export function arcadeAutopilot(): (stage: ArcadeStage, out: MoveInput) => MoveInput {
  let beat = 'start';
  let t = 0;
  let memo: Record<string, number> = {};
  return (stage, out) => {
    const h = stage.hero?.hero;
    out.move.set(0, 0, 0);
    out.jump = out.crouch = out.crouchPressed = out.attack = out.walk = false;
    out.jumpHeld = (memo.jumpHold ?? 0) > 0;
    if (!h) return out;
    const p = stage.heroLocal();
    const v: View = { x: p.x, y: p.y, vy: h.vy, grounded: h.grounded, state: h.state, out, t, memo };
    const next = BEATS[beat]!(v);
    out.jumpHeld ||= out.jump;
    memo.jumpHold = (memo.jumpHold ?? 0) - 1;
    t++;
    if (next && next !== beat) {
      beat = next;
      t = 0;
      memo = { jumpHold: memo.jumpHold ?? 0 };
    }
    return out;
  };
}
