import React, { useRef } from 'react';
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
  isRecording: boolean;
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
    state === 'error' || state === 'walking' ? 'idle' : state;
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
  isRecording,
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
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    lastX: number;
    lastY: number;
  }>({ active: false, moved: false, lastX: 0, lastY: 0 });

  const spriteUrl = resolveSpriteUrl(state, customSprites);
  const dynamicBounce = state === 'listening' ? 1 + audioLevel * 0.1 : 1;
  const showOrbs = optionsVisible || panelOpen;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      lastX: e.screenX,
      lastY: e.screenY,
    };
    onDragStateChange(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.screenX - dragRef.current.lastX;
    const dy = e.screenY - dragRef.current.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      dragRef.current.moved = true;
    }
    if (dx !== 0 || dy !== 0) {
      dragRef.current.lastX = e.screenX;
      dragRef.current.lastY = e.screenY;
      window.assistantAPI.moveWindowBy(dx, dy);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const wasDrag = dragRef.current.moved;
    dragRef.current.active = false;
    onDragStateChange(false);
    if (!wasDrag) {
      onToggleOptionsPin();
    }
  };

  return (
    <div
      className="character-dock"
      data-interactive={showOrbs ? 'true' : undefined}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div
        className={`quick-orb-bar ${showOrbs ? 'visible' : ''}`}
        data-interactive={showOrbs ? 'true' : undefined}
        aria-label="Assistant options"
        aria-hidden={!showOrbs}
      >
        <button
          type="button"
          className="orb-btn"
          title={panelOpen ? 'Hide Assistant Panel' : 'Open Chat (Ctrl+Shift+Space)'}
          onClick={onOpenChat}
        >
          <MessageSquare size={13} />
        </button>
        <button
          type="button"
          className="orb-btn"
          title="Capture Full Screen (Ctrl+Shift+S)"
          onClick={onQuickFullScreen}
        >
          <Camera size={13} />
        </button>
        <button
          type="button"
          className="orb-btn"
          title="Snip Screen Region (Ctrl+Shift+R)"
          onClick={onQuickSnip}
        >
          <Crop size={13} />
        </button>
        <button
          type="button"
          className={`orb-btn ${isRecording ? 'recording' : ''}`}
          title={isRecording ? 'Stop Recording & Transcribe' : 'Voice Transcribe'}
          onClick={onQuickMic}
        >
          <Mic size={13} />
        </button>
        <button
          type="button"
          className={`orb-btn ${walkEnabled ? 'active-walk' : ''}`}
          title={walkEnabled ? 'Pause Cat Walking' : 'Resume Cat Walking'}
          onClick={onToggleWalk}
        >
          {walkEnabled ? <Footprints size={13} /> : <Pause size={13} />}
        </button>
        <button
          type="button"
          className="orb-btn"
          title="Open Settings"
          onClick={onOpenSettings}
        >
          <Settings size={13} />
        </button>
      </div>

      <div
        className="character-wrap"
        data-interactive="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Hover or click for options • Drag to move"
      >
        {statusLabel && <div className="status-pill">{statusLabel}</div>}
        <div
          className={`character-visual state-${state}`}
          style={{ transform: `scale(${(scale * dynamicBounce).toFixed(3)})` }}
        >
          {spriteUrl ? (
            <img
              src={spriteUrl}
              alt={name}
              className="custom-sprite-img"
              style={{ transform: facing === 'left' ? 'scaleX(-1)' : undefined }}
              draggable={false}
            />
          ) : (
            <PixelCatSvg state={state} walkFrame={walkFrame} facing={facing} />
          )}
        </div>
      </div>
    </div>
  );
};
