import { Vector3 } from 'three/webgpu';
import { FirstPersonRig } from '../camera';
import type { GameContext } from '../Engine';
import type { MoveInput, PlatformerCharacter } from './PlatformerCharacter';

/**
 * Default key map for PlatformerCharacter. Movement is camera-relative for every preset
 * (strafing in first person; left/right only on a side-scroller lane, except while
 * climbing or hanging). Call from Game.fixedUpdate.
 *
 *   WASD / arrows  move          Shift   walk / tiptoe
 *   Space          jump          C / Ctrl crouch (air: ground pound)
 *   Z              prone toggle  X        lie down / get up
 *   F (hold)       grab / pull   J        attack (punch, punch, kick; air: dive / kick)
 *   V              wave          B        sit
 */
export const KEYMAP = {
  jump: ['Space'],
  walk: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
  prone: ['KeyZ'],
  lie: ['KeyX'],
  grab: ['KeyF'],
  attack: ['KeyJ'],
  wave: ['KeyV'],
  sit: ['KeyB'],
} as const;

export function readMoveInput(ctx: GameContext, character: PlatformerCharacter): MoveInput {
  const { input, camera } = ctx;
  if (!camera.controlsCharacter) {
    // Free camera is flying: the player stands still and presses are swallowed.
    input.clearQueued();
    return { move: new Vector3(), jump: false, jumpHeld: false, crouch: false };
  }
  const axis = input.moveAxis();
  const { right, forward } = camera.groundBasis();
  const lane = camera.lockDepth && character.state !== 'climb' && character.state !== 'hang';
  const move = right.multiplyScalar(axis.x).addScaledVector(forward, lane ? 0 : axis.y);
  if (move.lengthSq() > 1) move.normalize();
  const first = camera instanceof FirstPersonRig;
  return {
    move,
    walk: input.isDown(...KEYMAP.walk),
    jump: input.consumePress(...KEYMAP.jump),
    jumpHeld: input.isDown(...KEYMAP.jump),
    crouch: input.isDown(...KEYMAP.crouch),
    crouchPressed: input.consumePress(...KEYMAP.crouch),
    prone: input.consumePress(...KEYMAP.prone),
    lie: input.consumePress(...KEYMAP.lie),
    grab: input.isDown(...KEYMAP.grab),
    attack: input.consumePress(...KEYMAP.attack),
    wave: input.consumePress(...KEYMAP.wave),
    sit: input.consumePress(...KEYMAP.sit),
    face: first ? camera.groundBasis().forward : null,
  };
}
