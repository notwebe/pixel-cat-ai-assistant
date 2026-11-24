import { describe, expect, it } from 'vitest';
import {
  computeWalkBounds,
  pickNextWalkTarget,
  stepWalkPosition,
} from '../src/utils/catWalker';

describe('catWalker', () => {
  it('clamps walk bounds cleanly within display workArea with margin', () => {
    const bounds = computeWalkBounds(
      { x: 0, y: 0, width: 1920, height: 1032 },
      176,
      152,
    );

    expect(bounds).toEqual({
      minX: 4,
      maxX: 1740,
      minY: 0,
      maxY: 880,
    });
  });

  it('always picks targets inside walk bounds', () => {
    const bounds = computeWalkBounds(
      { x: 100, y: 20, width: 1280, height: 720 },
      176,
      152,
    );

    for (let i = 0; i < 40; i++) {
      const target = pickNextWalkTarget({ x: 500, y: bounds.maxY }, bounds);
      expect(target.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(target.x).toBeLessThanOrEqual(bounds.maxX);
      expect(target.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(target.y).toBeLessThanOrEqual(bounds.maxY);
    }
  });

  it('steps smoothly toward target, reports facing direction, and snaps on arrival', () => {
    const stepLeft = stepWalkPosition({ x: 500, y: 800 }, { x: 400, y: 800 }, 2.5);
    expect(stepLeft.arrived).toBe(false);
    expect(stepLeft.facing).toBe('left');
    expect(stepLeft.x).toBeCloseTo(497.5);
    expect(stepLeft.y).toBe(800);

    const stepRight = stepWalkPosition({ x: 100, y: 800 }, { x: 150, y: 800 }, 5);
    expect(stepRight.arrived).toBe(false);
    expect(stepRight.facing).toBe('right');
    expect(stepRight.x).toBeCloseTo(105);

    const arrived = stepWalkPosition({ x: 148, y: 800 }, { x: 150, y: 800 }, 3);
    expect(arrived.arrived).toBe(true);
    expect(arrived.x).toBe(150);
    expect(arrived.y).toBe(800);
  });
});
