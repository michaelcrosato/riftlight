// The OS pointer over the canvas (`PointerCursor`): hidden while the pad is in use or the pointer
// is locked, given back as it was once the mouse travels; a cursor the game set is never lost.
import { describe, expect, it } from 'vitest';
import { hidesPointer, PointerCursor } from './cursor';

const canvas = (cursor = '') => ({ style: { cursor } });

describe('the OS pointer over the canvas', () => {
  it('hides while the pad is in use (or the pointer is locked) and comes back as it was', () => {
    const c = new PointerCursor();
    const el = canvas('crosshair'); // a game's own
    c.follow(el, false);
    expect([el.style.cursor, c.isHidden], 'the mouse in use: as the game set it').toEqual(['crosshair', false]);
    c.follow(el, true);
    expect([el.style.cursor, c.isHidden], 'the pad in use: hidden').toEqual(['none', true]);
    c.follow(el, true);
    expect(el.style.cursor).toBe('none');
    c.follow(el, false);
    expect([el.style.cursor, c.isHidden], 'the mouse travelled: the game’s again').toEqual(['crosshair', false]);
  });

  it('keeps a cursor the game set while it was hidden, and follows a new canvas', () => {
    const c = new PointerCursor();
    const el = canvas();
    c.follow(el, true);
    el.style.cursor = 'grab'; // the game's, meanwhile
    c.follow(el, false);
    expect(el.style.cursor, 'not undone').toBe('grab');
    // a lost GPU device's recovery: another canvas; the old one gets its pointer back
    c.follow(el, true);
    const next = canvas();
    c.follow(next, true);
    expect([el.style.cursor, next.style.cursor]).toEqual(['grab', 'none']);
    // headless (no canvas), or the engine disposed: shown
    c.follow(null, false);
    expect([next.style.cursor, c.isHidden]).toEqual(['', false]);
  });

  it('hides on the pad or a locked pointer, never in a replay (its device is the recording’s; the mouse could not bring it back)', () => {
    expect(hidesPointer({ device: 'keyboard', locked: false, playing: false })).toBe(false);
    expect(hidesPointer({ device: 'touch', locked: false, playing: false })).toBe(false);
    expect(hidesPointer({ device: 'pad', locked: false, playing: false })).toBe(true);
    expect(hidesPointer({ device: 'keyboard', locked: true, playing: false })).toBe(true);
    expect(hidesPointer({ device: 'pad', locked: false, playing: true }), 'a pad recording replayed').toBe(false);
    expect(hidesPointer({ device: 'keyboard', locked: true, playing: true })).toBe(false);
  });

  it('a game that hides the pointer itself keeps it hidden', () => {
    const c = new PointerCursor();
    const el = canvas('none');
    c.follow(el, true);
    c.follow(el, false);
    expect(el.style.cursor).toBe('none');
  });
});
