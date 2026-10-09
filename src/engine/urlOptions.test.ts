import { describe, expect, it } from 'vitest';
import { optionsFromUrl, withUrlOptions } from './Engine';
import { LOOK_PRESETS } from './render/look';

describe('URL options', () => {
  const game = { camera: { preset: 'side' as const, zoom: 1.2 }, look: LOOK_PRESETS.noir, background: 0x123456 };

  it('with no flags, a game keeps its own options', () => {
    expect(withUrlOptions(game, '')).toEqual(game);
    expect(withUrlOptions({}, '')).toEqual({});
  });

  it('merges the camera key by key: ?zoom= keeps the game preset', () => {
    expect(withUrlOptions(game, '?zoom=1.5').camera).toEqual({ preset: 'side', zoom: 1.5 });
    expect(withUrlOptions(game, '?camera=third').camera).toEqual({ preset: 'third', zoom: 1.2 });
    expect(withUrlOptions({}, '?camera=topdown').camera).toEqual({ preset: 'topdown' });
  });

  it('?look= replaces the look; ?filters= replaces it too (a look wins over filters)', () => {
    expect(withUrlOptions(game, '?look=handheld').look).toBe(LOOK_PRESETS.handheld);
    const filtered = withUrlOptions(game, '?filters=crt,nope,scanlines');
    expect(filtered.filters).toEqual(['crt', 'scanlines']);
    expect(filtered.look).toBeUndefined();
    expect(filtered.background).toBe(0x123456);
  });

  it('reads the review flags', () => {
    expect(optionsFromUrl('?backend=webgl&debug=1&mode=raw')).toEqual({ forceWebGL: true, debugUI: true, mode: 'raw' });
    expect(optionsFromUrl('?look=hd_clean').look).toBe(LOOK_PRESETS.no_filters); // old names still work
  });

  it('reads the seed (?seed=, a whole number from 0)', () => {
    expect(optionsFromUrl('?seed=42').seed).toBe(42);
    expect(optionsFromUrl('?seed=0').seed).toBe(0);
    expect(optionsFromUrl('?seed=-3').seed).toBeUndefined();
    expect(optionsFromUrl('?seed=abc').seed).toBeUndefined();
    expect(optionsFromUrl('').seed).toBeUndefined();
    expect(optionsFromUrl('?seed=').seed).toBeUndefined();
    expect(optionsFromUrl('?seed=1.5').seed).toBeUndefined();
  });
});
