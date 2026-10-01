import { describe, expect, it } from 'vitest';
import { Hud, hudPlace } from './Hud';

const R480 = { width: 480, height: 270 };
const R320 = { width: 320, height: 180 };

describe('hudPlace', () => {
  it('anchors elements to corners, edges and the centre in whole art pixels', () => {
    expect(hudPlace(4, 4, 30, 7, 'top-left', R480)).toEqual([4, 4]);
    expect(hudPlace(4, 4, 30, 7, 'top-right', R480)).toEqual([446, 4]);
    expect(hudPlace(4, 4, 30, 7, 'bottom-right', R480)).toEqual([446, 259]);
    expect(hudPlace(0, 0, 31, 7, 'center', R480)).toEqual([224, 131]);
    expect(hudPlace(0, 2, 30, 7, 'top', R320)).toEqual([145, 2]);
    expect(hudPlace(3, 0, 10, 10, 'left', R320)).toEqual([3, 85]);
    expect(hudPlace(3, 0, 10, 10, 'right', R320)).toEqual([307, 85]);
  });

  it('measures the 5×7 font (6 px advance, no trailing gap)', () => {
    const hud = new Hud(null);
    expect(hud.measure('A')).toEqual({ width: 5, height: 7 });
    expect(hud.measure('COINS', 2)).toEqual({ width: 58, height: 14 });
  });

  it('is headless-safe without a container', () => {
    const hud = new Hud(null);
    hud.text(1, 1, 'HI');
    hud.sync(R480, { scale: 2, integer: true, artWidth: 480, artHeight: 270, canvasWidth: 960, canvasHeight: 540, cssWidth: 960, cssHeight: 540, offsetX: 0, offsetY: 0 });
    expect(hud.canvas).toBeNull();
  });
});
