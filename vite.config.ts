import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const built = new Date().toISOString().slice(0, 10);

// En desarrollo (npm run dev) las llamadas a /api y /proxy se reenvían al servidor Node (puerto 3000).
export default defineConfig({
  // Versión visible arriba a la derecha (sale de package.json).
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILT__: JSON.stringify(built) },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/proxy': 'http://127.0.0.1:3000',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
