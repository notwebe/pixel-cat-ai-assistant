import type { CropRect } from '../../src/types';

export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts a logical-pixel selection rectangle into clamped physical-pixel coordinates
 * suitable for Electron NativeImage.crop().
 */
export function normalizeCropRect(
  rect: CropRect,
  scaleFactor: number,
  imageWidth: number,
  imageHeight: number,
): NormalizedCropRect | null {
  if (imageWidth <= 0 || imageHeight <= 0 || scaleFactor <= 0) {
    return null;
  }

  const rawX = Math.min(rect.x, rect.x + rect.width);
  const rawY = Math.min(rect.y, rect.y + rect.height);
  const rawW = Math.abs(rect.width);
  const rawH = Math.abs(rect.height);

  if (rawW < 4 || rawH < 4) {
    return null;
  }

  const scaledX = Math.round(rawX * scaleFactor);
  const scaledY = Math.round(rawY * scaleFactor);
  const scaledW = Math.round(rawW * scaleFactor);
  const scaledH = Math.round(rawH * scaleFactor);

  const clampedX = Math.max(0, Math.min(scaledX, imageWidth - 1));
  const clampedY = Math.max(0, Math.min(scaledY, imageHeight - 1));
  const clampedW = Math.max(1, Math.min(scaledW, imageWidth - clampedX));
  const clampedH = Math.max(1, Math.min(scaledH, imageHeight - clampedY));

  return {
    x: clampedX,
    y: clampedY,
    width: clampedW,
    height: clampedH,
  };
}
