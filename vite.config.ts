import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function resolvePort(rawPort: string | undefined, fallback = 5173): number {
  const parsed = Number(rawPort);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
}

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: resolvePort(process.env.VITE_PORT),
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        snip: resolve(__dirname, 'snip.html'),
      },
    },
  },
});
