// HeldPresses: a press something on top took (a menu, a card, a panel) stays its own while held.
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { Input, KEYMAP, type MoveInput } from '../../engine';
import { HeldPresses } from './held';

const input = () => new Input(new EventTarget() as unknown as Window);
const move = (): MoveInput => ({ move: new Vector3(), jump: false, jumpHeld: true, crouch: true, walk: false, grab: false });

describe('HeldPresses', () => {
  it('a press taken while something was on top is not held for the game until it lets go; one from before is', () => {
    const i = input();
    const p = new HeldPresses([...KEYMAP.crouch, ...KEYMAP.jump]);
    i.setKey('PadB', true); // the Circle that closes the menu
    p.take(i);
    expect(i.queuedPresses, 'its press is dropped').toEqual([]);
    expect(p.held(i, ['PadB'])).toBe(false);
    expect(p.mask(i, move(), KEYMAP).crouch, 'no crouch while it is held').toBe(false);
    i.endFrame();
    i.setKey('PadB', false);
    expect(p.size).toBe(1);
    expect(p.held(i, ['PadB'])).toBe(false);
    expect(p.size, 'let go: the game\'s again').toBe(0);
    i.setKey('PadB', true);
    expect(p.held(i, ['PadB']), 'a new press with nothing on top').toBe(true);
    expect(p.mask(i, move(), KEYMAP).crouch).toBe(true);
  });

  it('a key held from before something came on top stays the game\'s', () => {
    const i = input();
    const p = new HeldPresses(KEYMAP.walk);
    i.setKey('ShiftLeft', true);
    i.endFrame(); // pressed a frame before
    p.take(i);
    expect(p.held(i, ['ShiftLeft'])).toBe(true);
  });

  it('watches the codes it is asked about, beyond the ones it was given (a room\'s own held action)', () => {
    const i = input();
    const p = new HeldPresses([]);
    expect(p.held(i, ['KeyK'])).toBe(false);
    i.setKey('KeyK', true); // pressed while a panel is up
    p.take(i);
    expect(p.held(i, ['KeyK']), 'the panel\'s while held').toBe(false);
  });
});
