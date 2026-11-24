import React, { useEffect, useRef, useState } from 'react';
import type { CropRect, SnipBackdropPayload } from '../types';

interface DragBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export const SnipOverlay: React.FC = () => {
  const [backdrop, setBackdrop] = useState<SnipBackdropPayload | null>(null);
  const [drag, setDrag] = useState<DragBox | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  const cancelOverlay = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    activePointerIdRef.current = null;
    setDrag(null);
    void window.assistantAPI.cancelSnip();
  };

  useEffect(() => {
    void window.assistantAPI.getSnipBackdrop().then(setBackdrop);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelOverlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const clampX = (x: number) => Math.max(0, Math.min(window.innerWidth, x));
  const clampY = (y: number) => Math.max(0, Math.min(window.innerHeight, y));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || finishedRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture failures
    }
    activePointerIdRef.current = e.pointerId;
    const x = clampX(e.clientX);
    const y = clampY(e.clientY);
    setDrag({
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || activePointerIdRef.current !== e.pointerId) return;
    const x = clampX(e.clientX);
    const y = clampY(e.clientY);
    setDrag((prev) => (prev ? { ...prev, currentX: x, currentY: y } : null));
  };

  const releaseCapture = (target: HTMLDivElement, pointerId: number) => {
    try {
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore release errors
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    releaseCapture(e.currentTarget, e.pointerId);

    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    setDrag(null);

    if (width < 8 || height < 8) {
      cancelOverlay();
      return;
    }

    finishedRef.current = true;
    const rect: CropRect = { x, y, width, height };
    void window.assistantAPI.completeSnip(rect);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    releaseCapture(e.currentTarget, e.pointerId);
    setDrag(null);
  };

  const handleLostPointerCapture = () => {
    if (activePointerIdRef.current !== null && !finishedRef.current) {
      activePointerIdRef.current = null;
      setDrag(null);
    }
  };

  const boxStyle = drag
    ? {
        left: Math.min(drag.startX, drag.currentX),
        top: Math.min(drag.startY, drag.currentY),
        width: Math.abs(drag.currentX - drag.startX),
        height: Math.abs(drag.currentY - drag.startY),
      }
    : null;

  const dimsNearBottom =
    boxStyle !== null &&
    typeof window !== 'undefined' &&
    boxStyle.top + boxStyle.height > window.innerHeight - 34;

  const dimsNearLeft = boxStyle !== null && boxStyle.left + boxStyle.width < 84;

  return (
    <div
      className="snip-root"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onContextMenu={(e) => {
        e.preventDefault();
        cancelOverlay();
      }}
    >
      {backdrop && <img src={backdrop.dataUrl} alt="Screen backdrop" className="snip-backdrop" />}
      <div className="snip-veil" />
      <div className="snip-hint">Drag to snip a screen region • Press Esc or Right-Click to cancel</div>

      {boxStyle && boxStyle.width > 2 && boxStyle.height > 2 && (
        <div className="snip-selection" style={boxStyle}>
          <div
            className={`snip-dims ${dimsNearBottom ? 'inside' : ''} ${dimsNearLeft ? 'left-align' : ''}`}
          >
            {Math.round(boxStyle.width)} × {Math.round(boxStyle.height)}
          </div>
        </div>
      )}
    </div>
  );
};
