import { describe, expect, it, vi } from 'vitest';
import { loadRiftlightPacks, RIFTLIGHT_PACKS } from './packs';

// a pack that fails to load (here the castle kit's) is left out with a warning; the others load
vi.mock('../engine/assets', () => ({
  loadPack: vi.fn(async (url: string) => {
    if (url.includes('castle')) throw new Error('404 Not Found');
  }),
}));

describe('loadRiftlightPacks', () => {
  it('goes on without a pack that fails to load, saying which', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await loadRiftlightPacks()).toEqual(RIFTLIGHT_PACKS.filter((u) => u.includes('castle')));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('kenney-castle.json did not load');
    } finally {
      warn.mockRestore();
    }
  });
});
