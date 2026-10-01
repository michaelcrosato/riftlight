import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Rapier (`@dimforge/rapier3d`, wasm-bindgen "bundler" build) imports its `.wasm` as an
 * ES module. Instead of a wasm-ESM plugin (top-level await that would block the whole
 * app until the wasm arrives), that import becomes an empty stub and
 * `src/engine/physics/rapierWasm.ts` instantiates the file itself (`?url`, streamed
 * compile) in parallel with the renderer and asset loading.
 */
function rapierWasm(): Plugin {
  const STUB = '\0rapier-wasm-stub';
  return {
    name: 'rapier-wasm-stub',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id.endsWith('rapier_wasm3d_bg.wasm') && importer && /@dimforge[\\/]rapier3d[\\/]rapier_wasm3d\.js$/.test(importer)) return STUB;
      return null;
    },
    load(id) {
      return id === STUB ? 'export {};' : null;
    },
  };
}

export default defineConfig({
  plugins: [rapierWasm()],
  build: {
    target: 'es2022',
    rolldownOptions: {
      // Two pages: the game and the Animation Lab (/lab.html).
      input: { main: 'index.html', lab: 'lab.html' },
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /@dimforge[\\/]rapier3d/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
    // three is ~1 MB minified (270 kB gzipped). Rapier's wasm is a separate .wasm asset.
    chunkSizeWarningLimit: 1100,
  },
  // FILM=1 (npm run film): no file watching / HMR, so edits made while a film records
  // can't reload the page under it.
  server: process.env.FILM ? { host: true, hmr: false, watch: null } : { host: true },
  // Pre-bundle every dependency up front. Otherwise the dev server discovers some on the
  // first page load, re-optimizes, and reloads the page mid-start (flaky agent tooling).
  // Rapier is excluded: its glue must stay one module instance shared with rapierWasm.ts.
  optimizeDeps: {
    entries: ['index.html', 'lab.html'],
    exclude: ['@dimforge/rapier3d'],
    include: [
      'three/webgpu',
      'three/tsl',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/utils/SkeletonUtils.js',
      'three/addons/tsl/display/BleachBypass.js',
      'three/addons/tsl/display/BloomNode.js',
      'three/addons/tsl/display/CRT.js',
      'three/addons/tsl/display/DotScreenNode.js',
      'three/addons/tsl/display/PixelationPassNode.js',
      'three/addons/tsl/display/Sepia.js',
      'three/addons/tsl/display/SobelOperatorNode.js',
    ],
  },
  // Unit tests (Node) run Rapier through Vite too, so the stub applies there as well.
  // The package only declares "module" (no "main"), which Node-side resolution ignores.
  test: {
    // Unit tests live next to the code. Without this, vitest also picks up throwaway
    // *.test.ts files under .scratch/ and other untracked folders.
    include: ['src/**/*.test.ts'],
    alias: [{ find: /^@dimforge\/rapier3d$/, replacement: '@dimforge/rapier3d/rapier.js' }],
    server: { deps: { inline: [/@dimforge[\\/]rapier3d/] } },
  },
});
