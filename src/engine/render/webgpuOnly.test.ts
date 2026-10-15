import { describe, expect, it, vi } from 'vitest';
import { NO_WEBGPU, PixelRenderer } from './PixelRenderer';

// WebGPU only (docs/DOCTRINE.md, principle 6): without it the renderer refuses, saying why,
// before it builds anything. The e2e `no-webgpu` suite shows the page saying so.

describe('PixelRenderer without WebGPU', () => {
  it('refuses when the browser has no navigator.gpu', async () => {
    vi.stubGlobal('navigator', {});
    try {
      await expect(PixelRenderer.create({} as never)).rejects.toThrow(NO_WEBGPU);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('asks for an adapter at the compatibility feature level, as three does', async () => {
    // a device that only offers compatibility mode: past the check (it fails later, building a
    // renderer with no DOM here, which is not the refusal)
    const requestAdapter = vi.fn(async (o?: GPURequestAdapterOptions) => ((o as { featureLevel?: string } | undefined)?.featureLevel === 'compatibility' ? {} : null));
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    try {
      const made = PixelRenderer.create({} as never);
      await expect(made).rejects.not.toThrow(NO_WEBGPU);
      expect(requestAdapter).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses when no adapter is given (and when asking for one fails)', async () => {
    for (const requestAdapter of [async () => null, async () => Promise.reject(new Error('no'))]) {
      vi.stubGlobal('navigator', { gpu: { requestAdapter } });
      try {
        await expect(PixelRenderer.create({} as never)).rejects.toThrow(/^WebGPU unavailable: this browser has no WebGPU/);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});
