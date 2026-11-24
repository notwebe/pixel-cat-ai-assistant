import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    void window.assistantAPI.getSnipBackdrop().then(setBackdrop);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void window.assistantAPI.cancelSnip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      void window.assistantAPI.cancelSnip();
      return;
    }
    if (e.button !== 0) return;
    setDrag({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag((prev) => (prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null));
  };

  const handleMouseUp = () => {
    if (!drag) return;
    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    setDrag(null);

    if (width < 8 || height < 8) {
      void window.assistantAPI.cancelSnip();
      return;
    }

    const rect: CropRect = { x, y, width, height };
    void window.assistantAPI.completeSnip(rect);
  };

  const boxStyle = drag
    ? {
        left: Math.min(drag.startX, drag.currentX),
        top: Math.min(drag.startY, drag.currentY),
        width: Math.abs(drag.currentX - drag.startX),
        height: Math.abs(drag.currentY - drag.startY),
      }
    : null;

  return (
    <div
      className="snip-root"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => {
        e.preventDefault();
        void window.assistantAPI.cancelSnip();
      }}
    >
      {backdrop && <img src={backdrop.dataUrl} alt="Screen backdrop" className="snip-backdrop" />}
      <div className="snip-veil" />
      <div className="snip-hint">Drag to snip a screen region • Press Esc or Right-Click to cancel</div>

      {boxStyle && boxStyle.width > 2 && boxStyle.height > 2 && (
        <div className="snip-selection" style={boxStyle}>
          <div className="snip-dims">
            {Math.round(boxStyle.width)} × {Math.round(boxStyle.height)}
          </div>
        </div>
      )}
    </div>
  );
};
