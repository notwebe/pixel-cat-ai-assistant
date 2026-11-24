import crypto from 'node:crypto';
import {
  desktopCapturer,
  screen,
  type DesktopCapturerSource,
  type Display,
  type NativeImage,
} from 'electron';
import type { CropRect, ScreenshotAttachment } from '../../src/types';
import { normalizeCropRect } from './screenshotCrop';
import { saveScreenshotBuffer } from './screenshotStorage';

export interface CapturedScreenFrame {
  image: NativeImage;
  display: Display;
  dataUrl: string;
}

function findMatchingScreenSource(
  sources: DesktopCapturerSource[],
  display: Display,
  physicalWidth: number,
  physicalHeight: number,
): DesktopCapturerSource {
  const targetId = String(display.id);
  const byDisplayId = sources.find((src) => src.display_id && src.display_id === targetId);
  if (byDisplayId) {
    return byDisplayId;
  }

  const allDisplays = screen.getAllDisplays();
  const targetAspect = physicalWidth / Math.max(1, physicalHeight);

  // Exclude sources explicitly stamped with another display's ID when multiple displays exist
  const candidates = sources.filter((src) => {
    if (src.thumbnail.isEmpty()) return false;
    if (!src.display_id) return true;
    return allDisplays.length === 1 && sources.length === 1;
  });

  const exactSizeMatch = candidates.find((src) => {
    const size = src.thumbnail.getSize();
    return (
      Math.abs(size.width - physicalWidth) <= 2 && Math.abs(size.height - physicalHeight) <= 2
    );
  });
  if (exactSizeMatch) {
    return exactSizeMatch;
  }

  const aspectMatches = candidates.filter((src) => {
    const size = src.thumbnail.getSize();
    if (size.width <= 0 || size.height <= 0) return false;
    const aspect = size.width / size.height;
    return Math.abs(aspect - targetAspect) / Math.max(0.01, targetAspect) <= 0.03;
  });
  if (aspectMatches.length === 1) {
    return aspectMatches[0];
  }

  throw new Error(
    `Could not match captured screen source to display ${display.id} (${physicalWidth}x${physicalHeight}).`,
  );
}

export async function captureDisplayFrame(targetDisplay?: Display): Promise<CapturedScreenFrame> {
  const display = targetDisplay ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scaleFactor = display.scaleFactor || 1;
  const physicalWidth = Math.max(1, Math.round(display.bounds.width * scaleFactor));
  const physicalHeight = Math.max(1, Math.round(display.bounds.height * scaleFactor));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: physicalWidth, height: physicalHeight },
  });

  if (sources.length === 0) {
    throw new Error('No screen sources available for capture.');
  }

  const matched = findMatchingScreenSource(sources, display, physicalWidth, physicalHeight);
  const image = matched.thumbnail;
  if (image.isEmpty()) {
    throw new Error('Captured screenshot was empty. Check screen recording permissions.');
  }

  return {
    image,
    display,
    dataUrl: image.toDataURL(),
  };
}

export function imageToAttachment(
  image: NativeImage,
  mode: ScreenshotAttachment['mode'],
  saveDir?: string,
): ScreenshotAttachment {
  const pngBuffer = image.toPNG();
  const base64 = pngBuffer.toString('base64');
  const size = image.getSize();

  let savedPath: string | undefined;
  let saveWarning: string | undefined;
  if (saveDir) {
    try {
      savedPath = saveScreenshotBuffer(pngBuffer, saveDir, mode);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      saveWarning = `Auto-save to Downloads failed (${reason}). Screenshot is still attached.`;
    }
  }

  return {
    id: crypto.randomUUID(),
    base64,
    dataUrl: `data:image/png;base64,${base64}`,
    width: size.width,
    height: size.height,
    mode,
    capturedAt: Date.now(),
    savedPath,
    saveWarning,
  };
}

export function cropCapturedFrame(
  frame: CapturedScreenFrame,
  rect: CropRect,
  saveDir?: string,
): ScreenshotAttachment | null {
  const size = frame.image.getSize();
  if (size.width <= 0 || size.height <= 0) {
    return null;
  }
  if (Math.abs(rect.width) < 4 || Math.abs(rect.height) < 4) {
    return null;
  }

  const scaleX = size.width / Math.max(1, frame.display.bounds.width);
  const scaleY = size.height / Math.max(1, frame.display.bounds.height);

  const xNorm = normalizeCropRect(
    { x: rect.x, y: 0, width: rect.width, height: 10 },
    scaleX,
    size.width,
    size.height,
  );
  const yNorm = normalizeCropRect(
    { x: 0, y: rect.y, width: 10, height: rect.height },
    scaleY,
    size.width,
    size.height,
  );

  if (!xNorm || !yNorm) {
    return null;
  }

  const cropped = frame.image.crop({
    x: xNorm.x,
    y: yNorm.y,
    width: xNorm.width,
    height: yNorm.height,
  });
  return imageToAttachment(cropped, 'region', saveDir);
}
