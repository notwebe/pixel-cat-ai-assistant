import { describe, expect, it } from 'vitest';
import {
  computeDragSwingAngle,
  computeWalkBounds,
  decayDragSwingAngle,
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

  it('preserves prevFacing during vertical or minimal horizontal movement', () => {
    const verticalLeft = stepWalkPosition(
      { x: 500, y: 800 },
      { x: 500, y: 700 },
      2.6,
      'left',
    );
    expect(verticalLeft.facing).toBe('left');
    expect(verticalLeft.arrived).toBe(false);

    const smallDxLeft = stepWalkPosition(
      { x: 500, y: 800 },
      { x: 500.4, y: 720 },
      2.6,
      'left',
    );
    expect(smallDxLeft.facing).toBe('left');

    const smallDxRight = stepWalkPosition(
      { x: 500, y: 800 },
      { x: 499.6, y: 720 },
      2.6,
      'right',
    );
    expect(smallDxRight.facing).toBe('right');

    const defaultFacing = stepWalkPosition({ x: 500, y: 800 }, { x: 500, y: 700 }, 2.6);
    expect(defaultFacing.facing).toBe('right');
  });

  it('biases walk targets 80% toward the bottom taskbar edge', () => {
    const bounds = computeWalkBounds(
      { x: 0, y: 0, width: 1920, height: 1032 },
      176,
      152,
    );

    const bottomTarget = pickNextWalkTarget({ x: 500, y: bounds.maxY }, bounds, () => 0.79);
    expect(bottomTarget.y).toBe(bounds.maxY);

    const midAirTarget = pickNextWalkTarget({ x: 500, y: bounds.maxY }, bounds, () => 0.85);
    expect(midAirTarget.y).toBeLessThan(bounds.maxY);
  });

  it('computes clamped drag swing angles and decays smoothly to zero', () => {
    // Dragging right produces positive clockwise angle (bottom trails left)
    expect(computeDragSwingAngle(0, 10)).toBeCloseTo(9);
    expect(computeDragSwingAngle(0, 100)).toBe(22);
    expect(computeDragSwingAngle(0, -100)).toBe(-22);

    // Decays smoothly and snaps to 0 once tiny
    const decayed = decayDragSwingAngle(10, 0.8);
    expect(decayed).toBeCloseTo(8);
    expect(decayDragSwingAngle(0.1)).toBe(0);
    expect(decayDragSwingAngle(-0.1)).toBe(0);
  });
});
