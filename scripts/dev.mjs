import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function runNodeScript(scriptRelPath, args = [], extraEnv = {}) {
  return spawn(process.execPath, [path.join(rootDir, scriptRelPath), ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

// 1. Build Electron main/preload bundles first
const buildProc = runNodeScript('scripts/build-electron.mjs');
const buildCode = await new Promise((resolve) => buildProc.on('close', resolve));
if (buildCode !== 0) {
  process.exit(buildCode ?? 1);
}

// 2. Start Vite dev server
const viteProc = runNodeScript('node_modules/vite/bin/vite.js');

const cleanup = () => {
  if (!viteProc.killed) viteProc.kill();
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

try {
  await waitForServer('http://localhost:5173');
  const electronProc = runNodeScript('node_modules/electron/cli.js', ['.'], {
    VITE_DEV_SERVER_URL: 'http://localhost:5173',
  });
  electronProc.on('close', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}
