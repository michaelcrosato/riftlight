import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    rolldownOptions: {
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
  server: { host: true },
});
