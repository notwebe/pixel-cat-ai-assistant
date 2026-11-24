import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatScreenshotFilename,
  saveScreenshotBuffer,
} from '../electron/services/screenshotStorage';

describe('screenshotStorage', () => {
  it('formats zero-padded timestamped filenames for fullscreen and region modes', () => {
    const fixedDate = new Date(2026, 10, 24, 9, 5, 7); // 2026-11-24 09:05:07 local
    expect(formatScreenshotFilename('fullscreen', fixedDate)).toBe(
      'screenshot-fullscreen-2026-11-24_09-05-07.png',
    );
    expect(formatScreenshotFilename('region', fixedDate)).toBe(
      'screenshot-region-2026-11-24_09-05-07.png',
    );
  });

  it('writes PNG bytes atomically with wx flag and avoids overwriting on timestamp collisions', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-shots-'));
    const fixedDate = new Date(2026, 10, 24, 9, 5, 7);
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const firstPath = saveScreenshotBuffer(pngBytes, tmpDir, 'fullscreen', fixedDate);
      const secondPath = saveScreenshotBuffer(pngBytes, tmpDir, 'fullscreen', fixedDate);
      const thirdPath = saveScreenshotBuffer(pngBytes, tmpDir, 'fullscreen', fixedDate);

      expect(path.basename(firstPath)).toBe('screenshot-fullscreen-2026-11-24_09-05-07.png');
      expect(path.basename(secondPath)).toBe('screenshot-fullscreen-2026-11-24_09-05-07-2.png');
      expect(path.basename(thirdPath)).toBe('screenshot-fullscreen-2026-11-24_09-05-07-3.png');

      expect(fs.readFileSync(firstPath)).toEqual(pngBytes);
      expect(fs.readFileSync(secondPath)).toEqual(pngBytes);
      expect(fs.readFileSync(thirdPath)).toEqual(pngBytes);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws cleanly after exhausting bounded 999 collision attempts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-shots-limit-'));
    const fixedDate = new Date(2026, 10, 24, 9, 5, 7);
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const baseName = formatScreenshotFilename('region', fixedDate);
      const ext = path.extname(baseName);
      const stem = baseName.slice(0, -ext.length);

      fs.writeFileSync(path.join(tmpDir, baseName), pngBytes);
      for (let i = 2; i <= 999; i += 1) {
        fs.writeFileSync(path.join(tmpDir, `${stem}-${i}${ext}`), pngBytes);
      }

      expect(() => saveScreenshotBuffer(pngBytes, tmpDir, 'region', fixedDate)).toThrow(
        /999 filename collision attempts/i,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
