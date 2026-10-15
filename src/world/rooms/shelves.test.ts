import { afterEach, describe, expect, it, vi } from 'vitest';
import { packShelves } from './shelves';

/** A pack file of one box, as the importers write it. */
const pack = (id: string) => ({
  pack: id,
  source: { url: 'https://example.com/kit.zip', licence: 'CC0-1.0' },
  models: [{ id: `${id}/box`, about: 'a box', tags: [], palette: { c: 'red' }, parts: [{ box: [1, 1, 1], at: [0, 0.5, 0], c: 'c' }] }],
});
const entry = (id: string) => ({ id, title: id, about: id, file: `${id}.json`, models: 1, textures: 0, licence: 'CC0-1.0', url: 'https://example.com/kit.zip' });

describe('pack shelves', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('leave out a pack that does not load, with a warning, and keep the others', async () => {
    // packs load once per URL for the page, so these ids are this test's own
    const files: Record<string, unknown> = {
      '/packs/index.json': { packs: [entry('shelves-test-gone'), entry('shelves-test-here')] },
      '/packs/shelves-test-here.json': pack('shelves-test-here'),
    };
    vi.stubGlobal('fetch', async (url: string) => (url in files ? new Response(JSON.stringify(files[url])) : new Response('not found', { status: 404 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shelves = await packShelves();
    expect(shelves.map((s) => [s.id, s.models?.length])).toEqual([['shelves-test-here', 1]]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/shelves-test-gone.*left out/);
  });
});
