import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: {
    // face-api bundles TensorFlow.js, so the main chunk is inherently ~1.3 MB.
    chunkSizeWarningLimit: 1600,
  },
});
