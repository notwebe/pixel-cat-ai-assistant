import fs from 'node:fs';
import path from 'node:path';
import type { ScreenshotAttachment } from '../../src/types';

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
 * Writes a PNG screenshot buffer into `targetDir` with a collision-safe timestamped filename
 * and returns the absolute file path.
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

  let candidate = path.join(targetDir, baseName);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDir, `${stem}-${counter}${ext}`);
    counter += 1;
  }

  fs.writeFileSync(candidate, pngBuffer);
  return candidate;
}
