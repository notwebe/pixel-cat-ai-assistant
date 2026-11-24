import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist-electron', { recursive: true });

const isProduction = process.env.NODE_ENV === 'production';

const commonConfig = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  sourcemap: !isProduction,
};

await Promise.all([
  build({
    ...commonConfig,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
  }),
  build({
    ...commonConfig,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
  }),
]);

console.log('Built Electron main and preload bundles.');
