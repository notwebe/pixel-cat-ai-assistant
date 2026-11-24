import crypto from 'node:crypto';
import { desktopCapturer, screen, type NativeImage, type Display } from 'electron';
import type { CropRect, ScreenshotAttachment } from '../../src/types';
import { normalizeCropRect } from './screenshotCrop';
import { saveScreenshotBuffer } from './screenshotStorage';

export interface CapturedScreenFrame {
  image: NativeImage;
  display: Display;
  dataUrl: string;
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

  const matched =
    sources.find((src) => src.display_id === String(display.id)) ?? sources[0];

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
  const savedPath = saveDir ? saveScreenshotBuffer(pngBuffer, saveDir, mode) : undefined;

  return {
    id: crypto.randomUUID(),
    base64,
    dataUrl: `data:image/png;base64,${base64}`,
    width: size.width,
    height: size.height,
    mode,
    capturedAt: Date.now(),
    savedPath,
  };
}

export function cropCapturedFrame(
  frame: CapturedScreenFrame,
  rect: CropRect,
  saveDir?: string,
): ScreenshotAttachment | null {
  const size = frame.image.getSize();
  const scaleX = size.width / Math.max(1, frame.display.bounds.width);
  const scaleY = size.height / Math.max(1, frame.display.bounds.height);
  const scaleFactor = (scaleX + scaleY) / 2;

  const normalized = normalizeCropRect(rect, scaleFactor, size.width, size.height);
  if (!normalized) {
    return null;
  }

  const cropped = frame.image.crop(normalized);
  return imageToAttachment(cropped, 'region', saveDir);
}
