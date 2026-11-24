import { describe, expect, it } from 'vitest';
import { normalizeCropRect } from '../electron/services/screenshotCrop';

describe('normalizeCropRect', () => {
  it('scales logical pixels by DPI factor accurately', () => {
    const result = normalizeCropRect(
      { x: 100, y: 50, width: 200, height: 150 },
      1.5,
      2880,
      1620,
    );

    expect(result).toEqual({
      x: 150,
      y: 75,
      width: 300,
      height: 225,
    });
  });

  it('handles reverse drag rectangles with negative width/height', () => {
    const result = normalizeCropRect(
      { x: 300, y: 200, width: -120, height: -80 },
      1,
      1920,
      1080,
    );

    expect(result).toEqual({
      x: 180,
      y: 120,
      width: 120,
      height: 80,
    });
  });

  it('clamps selection strictly inside image bounds', () => {
    const result = normalizeCropRect(
      { x: 1800, y: 1000, width: 400, height: 300 },
      1,
      1920,
      1080,
    );

    expect(result).toEqual({
      x: 1800,
      y: 1000,
      width: 120,
      height: 80,
    });
  });

  it('returns null for tiny accidental clicks', () => {
    expect(normalizeCropRect({ x: 10, y: 10, width: 2, height: 2 }, 1, 1920, 1080)).toBeNull();
  });
});
