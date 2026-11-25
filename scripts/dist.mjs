import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function buildChildEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function runNodeScript(scriptRelPath, args = [], extraEnv = {}) {
  const scriptPath = path.join(rootDir, scriptRelPath);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
      env: buildChildEnv(extraEnv),
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptRelPath} exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}

const portableOnly = process.argv.includes('--portable');
const keepUnpacked = process.argv.includes('--keep-unpacked');
const extraBuilderArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== '--portable' && arg !== '--keep-unpacked');

const releaseDir = path.join(rootDir, 'release');
const winUnpackedDir = path.join(releaseDir, 'win-unpacked');
const builderDebugPath = path.join(releaseDir, 'builder-debug.yml');

function cleanPreBuildReleaseArtifacts() {
  fs.rmSync(winUnpackedDir, { recursive: true, force: true });
  fs.rmSync(builderDebugPath, { force: true });

  if (portableOnly && fs.existsSync(releaseDir)) {
    for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      const isStaleNsis =
        name === 'latest.yml' ||
        name.endsWith('.blockmap') ||
        (name.startsWith('PixelCatAssistant-Setup-') && name.endsWith('.exe'));
      if (isStaleNsis) {
        fs.rmSync(path.join(releaseDir, name), { force: true });
      }
    }
  }
}

function inspectWinUnpacked() {
  if (!fs.existsSync(winUnpackedDir)) {
    return;
  }

  const asarPath = path.join(winUnpackedDir, 'resources', 'app.asar');
  if (fs.existsSync(asarPath)) {
    const asarSize = fs.statSync(asarPath).size;
    const buf = fs.readFileSync(asarPath);
    const headerSize = buf.readUInt32LE(12);
    const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'));
    const rootFiles = header.files ?? {};
    const topLevelEntries = Object.keys(rootFiles);

    let totalFiles = 0;
    let nodeModulesEntries = 0;
    let mapEntries = 0;

    function walk(filesObj, inNodeModules) {
      for (const [name, node] of Object.entries(filesObj)) {
        const isNodeModules = inNodeModules || name === 'node_modules';
        if (node && typeof node === 'object' && node.files) {
          if (name === 'node_modules' && Object.keys(node.files).length === 0) {
            nodeModulesEntries += 1;
          }
          walk(node.files, isNodeModules);
        } else {
          totalFiles += 1;
          if (isNodeModules) {
            nodeModulesEntries += 1;
          }
          if (name.toLowerCase().endsWith('.map')) {
            mapEntries += 1;
          }
        }
      }
    }

    walk(rootFiles, false);
    console.log(
      `[dist] app.asar size: ${asarSize} B, total files: ${totalFiles}, top-level entries: [${topLevelEntries.join(', ')}], node_modules entries: ${nodeModulesEntries}, .map entries: ${mapEntries}`,
    );
  }

  const localesDir = path.join(winUnpackedDir, 'locales');
  if (fs.existsSync(localesDir)) {
    const localeEntries = fs
      .readdirSync(localesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    const totalLocaleBytes = localeEntries.reduce(
      (sum, name) => sum + fs.statSync(path.join(localesDir, name)).size,
      0,
    );
    console.log(
      `[dist] locales remaining: ${localeEntries.length} file(s) ([${localeEntries.join(', ')}]), total: ${totalLocaleBytes} B`,
    );
  }
}

function logFinalReleaseFiles() {
  if (!fs.existsSync(releaseDir)) {
    console.log('[dist] release/ directory does not exist.');
    return;
  }

  const entries = fs.readdirSync(releaseDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const summary = entries.map((entry) => {
    const fullPath = path.join(releaseDir, entry.name);
    if (entry.isFile()) {
      return `${entry.name} (${fs.statSync(fullPath).size} B)`;
    }
    return `${entry.name}/ (dir)`;
  });
  console.log(`[dist] Final release/ contents: ${summary.length ? summary.join(', ') : '(empty)'}`);
}

const iconPath = path.join(rootDir, 'build', 'icon.ico');
if (!fs.existsSync(iconPath)) {
  console.log('build/icon.ico not found; generating icon...');
  await runNodeScript('scripts/generate-icon.mjs');
}

await runNodeScript('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.app.json', '--noEmit']);
await runNodeScript('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.node.json', '--noEmit']);
await runNodeScript('node_modules/vite/bin/vite.js', ['build']);
await runNodeScript('scripts/build-electron.mjs', [], { NODE_ENV: 'production' });

cleanPreBuildReleaseArtifacts();

const builderArgs = portableOnly
  ? ['--win', 'portable', ...extraBuilderArgs]
  : ['--win', ...extraBuilderArgs];

await runNodeScript('node_modules/electron-builder/cli.js', builderArgs, {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
});

inspectWinUnpacked();

if (!extraBuilderArgs.includes('--dir') && !keepUnpacked) {
  fs.rmSync(winUnpackedDir, { recursive: true, force: true });
  fs.rmSync(builderDebugPath, { force: true });
}

logFinalReleaseFiles();
