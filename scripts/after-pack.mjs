import fs from 'node:fs';
import path from 'node:path';

/**
 * electron-builder afterPack hook that trims unused Chromium locale .pak files
 * down to en-US.pak so packaged binaries stay minimal.
 */
export default async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) {
    console.log(`[afterPack] No locales directory found at ${localesDir}; skipping.`);
    return;
  }

  const entries = fs.readdirSync(localesDir, { withFileTypes: true });
  let keptCount = 0;
  let keptName = 'en-US.pak';
  let keptBytes = 0;
  let removedCount = 0;
  let freedBytes = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.pak')) continue;

    const fullPath = path.join(localesDir, entry.name);
    const size = fs.statSync(fullPath).size;

    if (lower === 'en-us.pak') {
      keptCount += 1;
      keptName = entry.name;
      keptBytes += size;
    } else {
      fs.unlinkSync(fullPath);
      removedCount += 1;
      freedBytes += size;
    }
  }

  console.log(
    `[afterPack] Kept ${keptCount} locale (${keptName}, ${keptBytes} B); removed ${removedCount} unused locale .pak files (freed ${freedBytes} B)`,
  );
}
