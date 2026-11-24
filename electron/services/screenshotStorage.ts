import fs from 'node:fs';
import path from 'node:path';
import type { ScreenshotAttachment } from '../../src/types';

const MAX_COLLISION_ATTEMPTS = 999;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatScreenshotFilename(
  mode: ScreenshotAttachment['mode'],
  now: Date = new Date(),
): string {
  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const min = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());

  return `screenshot-${mode}-${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}.png`;
}

/**
 * Writes a PNG screenshot buffer into `targetDir` with an atomic collision-safe
 * timestamped filename (`{ flag: 'wx' }`) and returns the absolute file path.
 */
export function saveScreenshotBuffer(
  pngBuffer: Buffer,
  targetDir: string,
  mode: ScreenshotAttachment['mode'],
  now: Date = new Date(),
): string {
  fs.mkdirSync(targetDir, { recursive: true });

  const baseName = formatScreenshotFilename(mode, now);
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, -ext.length);

  for (let attempt = 1; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
    const fileName = attempt === 1 ? baseName : `${stem}-${attempt}${ext}`;
    const candidate = path.join(targetDir, fileName);
    try {
      fs.writeFileSync(candidate, pngBuffer, { flag: 'wx' });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Could not save screenshot after ${MAX_COLLISION_ATTEMPTS} filename collision attempts.`,
  );
}
