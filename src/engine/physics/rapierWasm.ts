/**
 * Loads Rapier's WebAssembly as a separate `.wasm` file, compiled while it downloads
 * (`instantiateStreaming`). `@dimforge/rapier3d` is wasm-bindgen's "bundler" build: its
 * JS imports the `.wasm` as an ES module. The `rapierWasm()` Vite plugin
 * (vite.config.ts) turns that import into an empty stub, and `initRapier()` hands the
 * real instance to the bindings — explicitly, so the download runs in parallel with the
 * renderer and asset loading instead of blocking the whole module graph (top-level await).
 *
 * Single-file builds inline the `.wasm` as a data: URL; Node (vitest) reads it from disk.
 */
import * as bindings from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import wasmUrl from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm?url';

let ready: Promise<void> | null = null;

/** Download, compile and attach Rapier's wasm once; later calls share the promise. */
export function initRapier(): Promise<void> {
  ready ??= instantiate().then((instance) => bindings.__wbg_set_wasm(instance.exports));
  return ready;
}

async function instantiate(): Promise<WebAssembly.Instance> {
  const imports = { './rapier_wasm3d_bg.js': bindings as unknown as WebAssembly.ModuleImports };
  const node = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
  if (typeof window === 'undefined' && node) {
    return (await WebAssembly.instantiate(await readFromDisk(), imports)).instance;
  }
  const response = fetch(wasmUrl);
  try {
    return (await WebAssembly.instantiateStreaming(response, imports)).instance;
  } catch {
    // Wrong MIME type (some static hosts, data: URLs in old browsers): compile from bytes.
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    return (await WebAssembly.instantiate(bytes, imports)).instance;
  }
}

/** Node only (unit tests): the file next to the package's JS. */
async function readFromDisk(): Promise<ArrayBuffer> {
  // Variable specifiers so the browser bundle never tries to include Node built-ins.
  const fsName = 'node:fs/promises';
  const moduleName = 'node:module';
  const { readFile } = (await import(/* @vite-ignore */ fsName)) as { readFile(p: string): Promise<Uint8Array> };
  const { createRequire } = (await import(/* @vite-ignore */ moduleName)) as {
    createRequire(url: string): { resolve(id: string): string };
  };
  const file = createRequire(import.meta.url).resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const bytes = await readFile(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
