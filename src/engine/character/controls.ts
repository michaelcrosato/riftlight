import { Vector3 } from 'three/webgpu';
import { FirstPersonRig } from '../camera';
import type { GameContext } from '../Engine';
import type { MoveInput, PlatformerCharacter } from './PlatformerCharacter';

/**
 * Default key map for PlatformerCharacter: keys and pad buttons (`GAMEPAD_BUTTONS`' `Pad*` codes,
 * PlayStation names in brackets) side by side. Movement is camera-relative for every preset
 * (strafing in first person; left/right only on a side-scroller lane, except while climbing or
 * hanging). Call from Game.fixedUpdate. Options / Menu (`PadStart`) is left free for a pause or
 * menu, and Circle / B means back in menus (`MenuInput`) while it crouches in play.
 *
 *   WASD / arrows / left stick / d-pad   move
 *   Space · A (Cross)                    jump
 *   Shift · LT (L2)                      walk / tiptoe
 *   C / Ctrl · B (Circle) / RT (R2)      crouch (air: ground pound)
 *   Z · LB (L1)                          prone toggle
 *   X · RB (R1)                          lie down / get up
 *   F (hold) · Y (Triangle)              grab / pull
 *   J · X (Square)                       attack (punch, punch, kick; air: dive / kick)
 *   V · View (Create)                    wave
 *   B · L3                               sit
 */
export const KEYMAP = {
  jump: ['Space', 'PadA'],
  walk: ['ShiftLeft', 'ShiftRight', 'PadLT'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight', 'PadB', 'PadRT'],
  prone: ['KeyZ', 'PadLB'],
  lie: ['KeyX', 'PadRB'],
  grab: ['KeyF', 'PadY'],
  attack: ['KeyJ', 'PadX'],
  wave: ['KeyV', 'PadBack'],
  sit: ['KeyB', 'PadL3'],
} as const;

/**
 * Read the default key map into a MoveInput. Pass `out` (kept by the game) to reuse it and
 * its `move` vector every step instead of allocating a new one.
 */
export function readMoveInput(ctx: GameContext, character: PlatformerCharacter, out?: MoveInput): MoveInput {
  const { input, camera } = ctx;
  const res = out ?? { move: new Vector3(), jump: false, jumpHeld: false, crouch: false };
  if (!camera.controlsCharacter) {
    // Free camera is flying: the player stands still and presses are swallowed.
    input.clearQueued();
    res.move.set(0, 0, 0);
    res.walk = res.jump = res.jumpHeld = res.crouch = res.crouchPressed = false;
    res.prone = res.lie = res.grab = res.attack = res.wave = res.sit = false;
    res.face = null;
    return res;
  }
  const axis = input.moveAxis();
  const { right, forward } = camera.groundBasis();
  const lane = camera.lockDepth && character.state !== 'climb' && character.state !== 'hang';
  const move = res.move.copy(right).multiplyScalar(axis.x).addScaledVector(forward, lane ? 0 : axis.y);
  if (move.lengthSq() > 1) move.normalize();
  res.walk = input.anyDown(KEYMAP.walk);
  res.jump = input.consumeAny(KEYMAP.jump);
  res.jumpHeld = input.anyDown(KEYMAP.jump);
  res.crouch = input.anyDown(KEYMAP.crouch);
  res.crouchPressed = input.consumeAny(KEYMAP.crouch);
  res.prone = input.consumeAny(KEYMAP.prone);
  res.lie = input.consumeAny(KEYMAP.lie);
  res.grab = input.anyDown(KEYMAP.grab);
  res.attack = input.consumeAny(KEYMAP.attack);
  res.wave = input.consumeAny(KEYMAP.wave);
  res.sit = input.consumeAny(KEYMAP.sit);
  res.face = camera instanceof FirstPersonRig ? forward : null;
  return res;
}
