import { describe, expect, it } from 'vitest';
import { FILTERS, FILTER_IDS, FILTER_PRESETS, PALETTES, getFilter } from './filters';
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
});
