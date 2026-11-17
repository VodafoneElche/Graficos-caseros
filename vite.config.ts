import { defineConfig } from 'vite';

// En desarrollo (npm run dev) las llamadas a /api y /proxy se reenvían al servidor Node (puerto 3000).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/proxy': 'http://127.0.0.1:3000',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
