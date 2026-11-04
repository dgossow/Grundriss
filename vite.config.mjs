import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'out/renderer',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, strictPort: true },
});
