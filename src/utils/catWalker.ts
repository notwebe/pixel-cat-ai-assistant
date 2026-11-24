export interface Point {
  x: number;
  y: number;
}

export interface WalkBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface WorkAreaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WalkStepResult {
  x: number;
  y: number;
  arrived: boolean;
  facing: 'left' | 'right';
}

const HORIZONTAL_MARGIN = 4;

/**
 * Computes valid top-left window coordinates so the compact assistant window stays
 * comfortably inside the display's workArea.
 */
export function computeWalkBounds(
  workArea: WorkAreaRect,
  winWidth: number,
  winHeight: number,
): WalkBounds {
  const minX = workArea.x + HORIZONTAL_MARGIN;
  const maxX = Math.max(minX, workArea.x + workArea.width - winWidth - HORIZONTAL_MARGIN);
  const minY = workArea.y;
  const maxY = Math.max(minY, workArea.y + workArea.height - winHeight);

  return { minX, maxX, minY, maxY };
}

/**
 * Picks the next roam target for the pixel cat.
 * 65% of walks stay along the bottom taskbar edge; 35% explore higher on the desktop.
 */
export function pickNextWalkTarget(
  current: Point,
  bounds: WalkBounds,
  rng: () => number = Math.random,
): Point {
  const spanX = Math.max(0, bounds.maxX - bounds.minX);
  const spanY = Math.max(0, bounds.maxY - bounds.minY);

  let targetX = bounds.minX + rng() * spanX;
  if (spanX >= 260 && Math.abs(targetX - current.x) < 120) {
    const dir = current.x - bounds.minX > spanX / 2 ? -1 : 1;
    targetX = Math.max(
      bounds.minX,
      Math.min(bounds.maxX, current.x + dir * (120 + rng() * Math.min(240, spanX / 2))),
    );
  }

  const walkAlongBottom = rng() < 0.65;
  let targetY = bounds.maxY;
  if (!walkAlongBottom && spanY > 0) {
    const roamMinY = bounds.minY + spanY * 0.2;
    targetY = roamMinY + rng() * (bounds.maxY - roamMinY);
  }

  return {
    x: Math.round(Math.max(bounds.minX, Math.min(bounds.maxX, targetX))),
    y: Math.round(Math.max(bounds.minY, Math.min(bounds.maxY, targetY))),
  };
}

/**
 * Advances the cat toward `target` by `speedPx` per tick.
 */
export function stepWalkPosition(
  current: Point,
  target: Point,
  speedPx: number,
): WalkStepResult {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dist = Math.hypot(dx, dy);
  const facing: 'left' | 'right' = dx < -0.5 ? 'left' : dx > 0.5 ? 'right' : 'right';

  if (dist <= speedPx || speedPx <= 0) {
    return {
      x: target.x,
      y: target.y,
      arrived: true,
      facing,
    };
  }

  const ratio = speedPx / dist;
  return {
    x: current.x + dx * ratio,
    y: current.y + dy * ratio,
    arrived: false,
    facing,
  };
}
