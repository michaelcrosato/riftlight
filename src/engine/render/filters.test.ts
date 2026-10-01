import { describe, expect, it } from 'vitest';
import { FILTERS, FILTER_IDS, FILTER_PRESETS, PALETTES, getFilter, splitFilters } from './filters';
import { vertexSnap } from './toon';

describe('filter registry', () => {
  it('has unique ids and at least 30 filters', () => {
    expect(new Set(FILTER_IDS).size).toBe(FILTER_IDS.length);
    expect(FILTERS.length).toBeGreaterThanOrEqual(30);
  });

  it('presets only reference known filters', () => {
    for (const [name, ids] of Object.entries(FILTER_PRESETS)) {
      for (const id of ids) expect(getFilter(id), `${name}: ${id}`).toBeDefined();
    }
  });

  it('palettes are valid 24-bit colors', () => {
    for (const colors of Object.values(PALETTES)) {
      for (const c of colors) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('ships 8-bit, 16-bit and PS1 era filters; PS1 toggles vertex snapping', () => {
    for (const id of ['8bit', '16bit', 'ps1']) expect(getFilter(id)).toBeDefined();
    const ps1 = getFilter('ps1')!;
    ps1.setActive?.(true);
    expect(vertexSnap.enabled.value).toBe(1);
    ps1.setActive?.(false);
    expect(vertexSnap.enabled.value).toBe(0);
  });

  it('classifies every filter as art-resolution or display-resolution', () => {
    for (const f of FILTERS) expect(['art', 'display'], f.id).toContain(f.space);
    // Per-art-pixel looks run before the upscale; sub-pixel display effects after it.
    for (const id of ['nes', '8bit', 'ps1', 'gameboy', 'dither', 'posterize', 'grayscale', 'grain']) expect(getFilter(id)!.space).toBe('art');
    for (const id of ['scanlines', 'lcd', 'crt', 'vhs', 'chromatic', 'bloom']) expect(getFilter(id)!.space).toBe('display');
  });

  it('splits a stack at its first display filter, keeping order', () => {
    expect(splitFilters(['gameboy', 'lcd', 'vignette'])).toEqual({ art: ['gameboy'], display: ['lcd', 'vignette'] });
    expect(splitFilters(['moonlight', 'grain', 'vignette'])).toEqual({ art: ['moonlight', 'grain', 'vignette'], display: [] });
    expect(splitFilters(['crt', 'nes'])).toEqual({ art: [], display: ['crt', 'nes'] });
    expect(splitFilters(['nope', 'nes'])).toEqual({ art: ['nes'], display: [] });
  });
});
