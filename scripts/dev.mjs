import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function resolvePort(rawPort, fallback = 5173) {
  const parsed = Number(rawPort);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function buildChildEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function runNodeScript(scriptRelPath, args = [], extraEnv = {}) {
  return spawn(process.execPath, [path.join(rootDir, scriptRelPath), ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: buildChildEnv(extraEnv),
  });
}

function waitForServer(url, signal, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let timerId = null;
    let activeReq = null;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (activeReq) {
        activeReq.destroy();
        activeReq = null;
      }
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };

    const onAbort = () => {
      finish(reject, new Error('Aborted waiting for Vite dev server'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const attempt = () => {
      if (settled || signal?.aborted) return;
      const req = http.get(url, (res) => {
        activeReq = null;
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
          finish(resolve);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          finish(reject, new Error(`Timed out waiting for ${url} (HTTP ${res.statusCode ?? 'unknown'})`));
          return;
        }
        timerId = setTimeout(attempt, 250);
      });
      activeReq = req;
      req.on('error', () => {
        if (activeReq === req) activeReq = null;
        if (settled || signal?.aborted) return;
        if (Date.now() - start > timeoutMs) {
          finish(reject, new Error(`Timed out waiting for ${url}`));
          return;
        }
        timerId = setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

const vitePort = resolvePort(process.env.VITE_PORT);
const devServerUrl = `http://localhost:${vitePort}`;

// 1. Build Electron main/preload bundles first
const buildProc = runNodeScript('scripts/build-electron.mjs');
const buildCode = await new Promise((resolve) => buildProc.on('close', resolve));
if (buildCode !== 0) {
  process.exit(buildCode ?? 1);
}

// 2. Start Vite dev server
const viteProc = runNodeScript('node_modules/vite/bin/vite.js', [], {
  VITE_PORT: String(vitePort),
});

let cleaningUp = false;
let electronStarted = false;
const waitAbort = new AbortController();

const cleanup = () => {
  cleaningUp = true;
  waitAbort.abort();
  if (!viteProc.killed) viteProc.kill();
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const viteEarlyExitPromise = new Promise((_, reject) => {
  viteProc.once('exit', (code, signal) => {
    if (!electronStarted && !cleaningUp) {
      waitAbort.abort();
      reject(
        new Error(
          `Vite dev server exited before becoming ready (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        ),
      );
    }
  });
  viteProc.once('error', (err) => {
    if (!electronStarted && !cleaningUp) {
      waitAbort.abort();
      reject(err);
    }
  });
});
viteEarlyExitPromise.catch(() => {});

try {
  await Promise.race([waitForServer(devServerUrl, waitAbort.signal), viteEarlyExitPromise]);
  electronStarted = true;
  const electronProc = runNodeScript('node_modules/electron/cli.js', ['.'], {
    VITE_DEV_SERVER_URL: devServerUrl,
  });
  electronProc.on('error', (err) => {
    console.error(err instanceof Error ? err.message : err);
    cleanup();
    process.exit(1);
  });
  electronProc.on('close', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  cleanup();
  process.exit(1);
}
