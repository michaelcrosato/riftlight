/**
 * WebGPU browser-compat shims, installed once before the renderer initializes.
 *
 * three r186 sets `swizzle: 'rgba'` on every GPUTextureViewDescriptor. Chromium ≤ 141
 * shipped an older IDL for that member and throws a TypeError on the string, which
 * aborts rendering (black canvas). 'rgba' is the identity swizzle, i.e. the default,
 * so dropping it is behavior-preserving everywhere.
 */
let installed = false;

export function installWebGPUCompat(): void {
  if (installed) return;
  installed = true;
  const proto = (globalThis as { GPUTexture?: { prototype: GPUTexture } }).GPUTexture?.prototype;
  if (!proto) return;
  const createView = proto.createView;
  proto.createView = function (this: GPUTexture, descriptor?: GPUTextureViewDescriptor) {
    if (descriptor && (descriptor as { swizzle?: unknown }).swizzle === 'rgba') {
      const { swizzle: _identity, ...rest } = descriptor as GPUTextureViewDescriptor & { swizzle?: unknown };
      void _identity;
      return createView.call(this, rest);
    }
    return createView.call(this, descriptor);
  };
}
