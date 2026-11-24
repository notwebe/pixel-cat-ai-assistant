import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Crop,
  Footprints,
  MessageSquare,
  Mic,
  Pause,
  Settings,
} from 'lucide-react';
import type { CharacterState, CustomSprites, SpriteStateKey } from '../types';
import { computeDragSwingAngle, decayDragSwingAngle } from '../utils/catWalker';
import { PixelCatSvg } from './PixelCatSvg';

interface CharacterAvatarProps {
  name: string;
  state: CharacterState;
  statusLabel: string | null;
  scale: number;
  audioLevel: number;
  customSprites: CustomSprites;
  panelOpen: boolean;
  optionsVisible: boolean;
  optionsPinned: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  walkEnabled: boolean;
  facing: 'left' | 'right';
  walkFrame: 0 | 1;
  onHoverChange: (hovered: boolean) => void;
  onToggleOptionsPin: () => void;
  onOpenChat: () => void;
  onOpenSettings: () => void;
  onQuickFullScreen: () => void;
  onQuickSnip: () => void;
  onQuickMic: () => void;
  onToggleWalk: () => void;
  onDragStateChange: (dragging: boolean) => void;
}

function resolveSpriteUrl(
  state: CharacterState,
  customSprites: CustomSprites,
): string | null {
  const mappedKey: SpriteStateKey =
    state === 'error' || state === 'walking' || state === 'dragging' ? 'idle' : state;
  return customSprites[mappedKey] ?? customSprites.idle ?? null;
}

export const CharacterAvatar: React.FC<CharacterAvatarProps> = ({
  name,
  state,
  statusLabel,
  scale,
  audioLevel,
  customSprites,
  panelOpen,
  optionsVisible,
  optionsPinned,
  isRecording,
  isTranscribing,
  walkEnabled,
  facing,
  walkFrame,
  onHoverChange,
  onToggleOptionsPin,
  onOpenChat,
  onOpenSettings,
  onQuickFullScreen,
  onQuickSnip,
  onQuickMic,
  onToggleWalk,
  onDragStateChange,
}) => {
  const [isHeld, setIsHeld] = useState(false);
  const [dangleFrame, setDangleFrame] = useState<0 | 1>(0);
  const [swingDeg, setSwingDeg] = useState(0);
  const [justDropped, setJustDropped] = useState(false);

  const isHeldRef = useRef(false);
  const swingDegRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  const dropTimerRef = useRef<number | null>(null);

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>({
    active: false,
    moved: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    isHeldRef.current = isHeld;
  }, [isHeld]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
      }
      if (dropTimerRef.current !== null) {
        window.clearTimeout(dropTimerRef.current);
      }
    };
  }, []);

  // Animate paw kicking & smooth pendulum damping while held by cursor
  useEffect(() => {
    if (!isHeld) return;

    const kickTimer = window.setInterval(() => {
      setDangleFrame((prev) => (prev === 0 ? 1 : 0));
    }, 140);

    let rafId = 0;
    const tickDecay = () => {
      if (swingDegRef.current !== 0) {
        const next = decayDragSwingAngle(swingDegRef.current);
        swingDegRef.current = next;
        setSwingDeg(next);
      }
      rafId = window.requestAnimationFrame(tickDecay);
    };
    rafId = window.requestAnimationFrame(tickDecay);

    return () => {
      window.clearInterval(kickTimer);
      window.cancelAnimationFrame(rafId);
    };
  }, [isHeld]);

  const effectiveState: CharacterState = isHeld ? 'dragging' : state;
  const effectiveFrame: 0 | 1 = isHeld ? dangleFrame : walkFrame;
  const spriteUrl = resolveSpriteUrl(effectiveState, customSprites);
  const dynamicBounce = effectiveState === 'listening' ? 1 + audioLevel * 0.1 : 1;
  const totalScale = scale * dynamicBounce;
  const showOrbs = !isHeld && (optionsVisible || panelOpen);

  const resetDrag = (target?: HTMLDivElement, pointerId?: number) => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (!dragRef.current.active) return;
    const wasHeld = isHeldRef.current || dragRef.current.moved;
    dragRef.current.active = false;
    const activePointerId = pointerId ?? dragRef.current.pointerId;
    dragRef.current.pointerId = null;
    if (target && activePointerId !== null) {
      try {
        if (target.hasPointerCapture(activePointerId)) {
          target.releasePointerCapture(activePointerId);
        }
      } catch {
        // Ignore release errors when capture was already lost
      }
    }
    swingDegRef.current = 0;
    setSwingDeg(0);
    setIsHeld(false);

    if (wasHeld) {
      setJustDropped(true);
      if (dropTimerRef.current !== null) {
        window.clearTimeout(dropTimerRef.current);
      }
      dropTimerRef.current = window.setTimeout(() => {
        setJustDropped(false);
        dropTimerRef.current = null;
      }, 260);
    }

    onDragStateChange(false);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (dropTimerRef.current !== null) {
      window.clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    setJustDropped(false);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Continue even if pointer capture is unavailable
    }
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
    };

    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      if (dragRef.current.active) {
        setIsHeld(true);
      }
    }, 110);

    onDragStateChange(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const totalDist = Math.hypot(
      e.screenX - dragRef.current.startX,
      e.screenY - dragRef.current.startY,
    );
    if (totalDist > 4) {
      dragRef.current.moved = true;
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (!isHeldRef.current) {
        setIsHeld(true);
      }
    }
    const dx = e.screenX - dragRef.current.lastX;
    const dy = e.screenY - dragRef.current.lastY;
    if (dx !== 0 || dy !== 0) {
      dragRef.current.lastX = e.screenX;
      dragRef.current.lastY = e.screenY;
      if (dx !== 0) {
        const nextSwing = computeDragSwingAngle(swingDegRef.current, dx);
        swingDegRef.current = nextSwing;
        setSwingDeg(nextSwing);
      }
      window.assistantAPI.moveWindowBy(dx, dy);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const wasDrag = dragRef.current.moved;
    resetDrag(e.currentTarget, e.pointerId);
    if (!wasDrag) {
      onToggleOptionsPin();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    resetDrag(e.currentTarget, e.pointerId);
  };

  const handleLostPointerCapture = () => {
    resetDrag();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleOptionsPin();
    }
  };

  return (
    <div
      className="character-dock"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div
        className={`quick-orb-bar ${showOrbs ? 'visible' : ''} ${optionsPinned && !panelOpen ? 'pinned' : ''}`}
        data-interactive={showOrbs ? 'true' : undefined}
        aria-label="Assistant options"
        aria-hidden={!showOrbs}
      >
        {optionsPinned && !panelOpen && (
          <span
            className="orb-pin-dot"
            title="Menu pinned — click character to unpin"
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          className="orb-btn"
          tabIndex={showOrbs ? 0 : -1}
          aria-label={panelOpen ? 'Hide Assistant Panel' : 'Open Chat (Ctrl+Shift+Space)'}
          title={panelOpen ? 'Hide Assistant Panel' : 'Open Chat (Ctrl+Shift+Space)'}
          onClick={onOpenChat}
        >
          <MessageSquare size={13} />
        </button>
        <button
          type="button"
          className="orb-btn"
          tabIndex={showOrbs ? 0 : -1}
          aria-label="Capture Full Screen (Ctrl+Shift+S)"
          title="Capture Full Screen (Ctrl+Shift+S)"
          onClick={onQuickFullScreen}
        >
          <Camera size={13} />
        </button>
        <button
          type="button"
          className="orb-btn"
          tabIndex={showOrbs ? 0 : -1}
          aria-label="Snip Screen Region (Ctrl+Shift+R)"
          title="Snip Screen Region (Ctrl+Shift+R)"
          onClick={onQuickSnip}
        >
          <Crop size={13} />
        </button>
        <button
          type="button"
          className={`orb-btn ${isRecording ? 'recording' : ''}`}
          tabIndex={showOrbs ? 0 : -1}
          disabled={isTranscribing}
          aria-label={
            isRecording
              ? 'Stop Recording & Transcribe'
              : isTranscribing
                ? 'Transcribing audio...'
                : 'Voice Transcribe'
          }
          title={
            isRecording
              ? 'Stop Recording & Transcribe'
              : isTranscribing
                ? 'Transcribing audio...'
                : 'Voice Transcribe'
          }
          onClick={onQuickMic}
        >
          <Mic size={13} />
        </button>
        <button
          type="button"
          className={`orb-btn ${walkEnabled ? 'active-walk' : ''}`}
          tabIndex={showOrbs ? 0 : -1}
          aria-label={walkEnabled ? 'Pause Cat Walking' : 'Resume Cat Walking'}
          title={walkEnabled ? 'Pause Cat Walking' : 'Resume Cat Walking'}
          onClick={onToggleWalk}
        >
          {walkEnabled ? <Footprints size={13} /> : <Pause size={13} />}
        </button>
        <button
          type="button"
          className="orb-btn"
          tabIndex={showOrbs ? 0 : -1}
          aria-label="Open Settings"
          title="Open Settings"
          onClick={onOpenSettings}
        >
          <Settings size={13} />
        </button>
      </div>

      <div
        className={`character-wrap ${optionsPinned && !panelOpen ? 'pinned' : ''} ${isHeld ? 'is-held' : ''}`}
        data-interactive="true"
        role="button"
        tabIndex={0}
        aria-label={`${name} desktop assistant. Click to toggle options or drag to move.`}
        style={{ marginRight: totalScale > 1 ? Math.round((totalScale - 1) * 20) : 0 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        onKeyDown={handleKeyDown}
        title={
          optionsPinned && !panelOpen
            ? 'Options pinned • Click to unpin • Drag to move'
            : 'Hover or click for options • Drag to move'
        }
      >
        {statusLabel && !isHeld && (
          <div className="status-pill" style={{ bottom: `${Math.round(80 * totalScale) + 4}px` }}>
            {statusLabel}
          </div>
        )}
        <div
          className="character-scale-wrap"
          style={{ transform: `scale(${totalScale.toFixed(3)})` }}
        >
          <div
            className="character-swing-wrap"
            style={
              isHeld
                ? { transform: `rotate(${swingDeg.toFixed(1)}deg) scaleX(0.95) scaleY(1.06)` }
                : undefined
            }
          >
            <div
              className={`character-visual state-${effectiveState} ${!isHeld && justDropped ? 'state-dropped' : ''}`}
            >
              {spriteUrl ? (
                <img
                  src={spriteUrl}
                  alt={name}
                  className="custom-sprite-img"
                  style={{ transform: !isHeld && facing === 'left' ? 'scaleX(-1)' : undefined }}
                  draggable={false}
                />
              ) : (
                <PixelCatSvg state={effectiveState} walkFrame={effectiveFrame} facing={facing} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
