import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    rolldownOptions: {
      // Two pages: the game and the Animation Lab (/lab.html).
      input: { main: 'index.html', lab: 'lab.html' },
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /@dimforge[\\/]rapier3d-compat/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
    // The rapier chunk is ~2.9 MB because the -compat build inlines its wasm as base64.
    // That is expected; every other chunk must stay well below this.
    chunkSizeWarningLimit: 3000,
  },
  // FILM=1 (npm run film): no file watching / HMR, so edits made while a film records
  // can't reload the page under it.
  server: process.env.FILM ? { host: true, hmr: false, watch: null } : { host: true },
  // Pre-bundle every dependency up front. Otherwise the dev server discovers some on the
  // first page load, re-optimizes, and reloads the page mid-start (flaky agent tooling).
  optimizeDeps: {
    entries: ['index.html', 'lab.html'],
    include: [
      '@dimforge/rapier3d-compat',
      'three/webgpu',
      'three/tsl',
      'three/addons/loaders/GLTFLoader.js',
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
});
