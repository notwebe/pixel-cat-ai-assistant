import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const mainEntry = path.join(rootDir, 'dist-electron', 'main.cjs');
const rendererEntry = path.join(rootDir, 'dist', 'index.html');

if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
  console.error('App is not built yet. Run "npm run build" first.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
let electronExe;
try {
  electronExe = require('electron');
} catch {
  console.error('Electron is not installed. Run "npm install" first.');
  process.exit(1);
}

if (!electronExe || !fs.existsSync(electronExe)) {
  console.error('Electron binary is missing. Run "node node_modules/electron/install.js" or "npm install" first.');
  process.exit(1);
}

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronExe, ['.'], {
  cwd: rootDir,
  env: childEnv,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});

child.unref();
console.log('Launched assistant in the background. You can close this terminal.');
process.exit(0);
