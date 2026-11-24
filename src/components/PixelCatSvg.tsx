import React from 'react';
import type { CharacterState } from '../types';

interface PixelCatSvgProps {
  state: CharacterState;
  walkFrame: 0 | 1;
  facing: 'left' | 'right';
}

const OUTLINE = '#1e1b4b';
const CREAM = '#fff7ed';
const CREAM_SHADE = '#fed7aa';
const GINGER = '#fb923c';
const GINGER_DARK = '#ea580c';
const PINK = '#f472b6';
const GOLD = '#fbbf24';
const SKY = '#93c5fd';

function HeldDanglingCat({ frame }: { frame: 0 | 1 }) {
  return (
    <>
      {/* Playful surprise mark above ear */}
      {frame === 0 ? (
        <g fill={SKY}>
          <rect x="16" y="2" width="1" height="2" />
          <rect x="17" y="1" width="1" height="1" />
        </g>
      ) : (
        <g fill={GOLD}>
          <rect x="16" y="1" width="1" height="2" />
          <rect x="16" y="4" width="1" height="1" />
        </g>
      )}

      {/* Loose swaying tail behind lower body */}
      {frame === 0 ? (
        <>
          <rect x="14" y="14" width="2" height="2" fill={OUTLINE} />
          <rect x="14" y="14" width="1" height="1" fill={GINGER} />
          <rect x="15" y="13" width="2" height="2" fill={OUTLINE} />
          <rect x="15" y="13" width="1" height="1" fill={CREAM_SHADE} />
        </>
      ) : (
        <>
          <rect x="4" y="14" width="2" height="2" fill={OUTLINE} />
          <rect x="5" y="14" width="1" height="1" fill={GINGER} />
          <rect x="3" y="13" width="2" height="2" fill={OUTLINE} />
          <rect x="4" y="13" width="1" height="1" fill={CREAM_SHADE} />
        </>
      )}

      {/* Perked Ears */}
      <rect x="6" y="2" width="2" height="2" fill={OUTLINE} />
      <rect x="12" y="2" width="2" height="2" fill={OUTLINE} />
      <rect x="7" y="3" width="1" height="2" fill={GINGER} />
      <rect x="12" y="3" width="1" height="2" fill={GINGER_DARK} />
      <rect x="7" y="4" width="1" height="1" fill={PINK} />
      <rect x="12" y="4" width="1" height="1" fill={PINK} />

      {/* Front-Facing Head */}
      <rect x="6" y="4" width="8" height="6" fill={OUTLINE} />
      <rect x="5" y="5" width="10" height="4" fill={OUTLINE} />
      <rect x="6" y="5" width="8" height="4" fill={CREAM} />

      {/* Ginger Forehead Patches */}
      <rect x="7" y="5" width="3" height="2" fill={GINGER} />
      <rect x="12" y="5" width="2" height="1" fill={GINGER} />

      {/* Wide Surprised Eyes + Sparkle */}
      <rect x="7" y="6" width="2" height="2" fill={OUTLINE} />
      <rect x="11" y="6" width="2" height="2" fill={OUTLINE} />
      <rect x="7" y="6" width="1" height="1" fill="#ffffff" />
      <rect x="11" y="6" width="1" height="1" fill="#ffffff" />

      {/* Rosy Cheeks, Tiny Nose & "o" Mouth */}
      <rect x="6" y="8" width="1" height="1" fill={PINK} />
      <rect x="13" y="8" width="1" height="1" fill={PINK} />
      <rect x="9" y="7" width="2" height="1" fill={PINK} />
      <rect x="9" y="8" width="2" height="1" fill={frame === 1 ? '#be185d' : PINK} />

      {/* Dangling Elongated Body */}
      <rect x="6" y="9" width="8" height="7" fill={OUTLINE} />
      <rect x="7" y="10" width="6" height="5" fill={CREAM} />
      <rect x="7" y="10" width="1" height="3" fill={GINGER} />
      <rect x="12" y="10" width="1" height="3" fill={GINGER} />
      <rect x="8" y="13" width="4" height="2" fill={CREAM_SHADE} />

      {/* Wiggling Front Paws */}
      {frame === 0 ? (
        <>
          <rect x="4" y="10" width="2" height="2" fill={OUTLINE} />
          <rect x="5" y="10" width="1" height="1" fill={CREAM} />
          <rect x="14" y="11" width="2" height="2" fill={OUTLINE} />
          <rect x="14" y="12" width="1" height="1" fill={CREAM} />
        </>
      ) : (
        <>
          <rect x="4" y="11" width="2" height="2" fill={OUTLINE} />
          <rect x="5" y="12" width="1" height="1" fill={CREAM} />
          <rect x="14" y="10" width="2" height="2" fill={OUTLINE} />
          <rect x="14" y="10" width="1" height="1" fill={CREAM} />
        </>
      )}

      {/* Kicking Dangling Hind Paws */}
      {frame === 0 ? (
        <>
          <rect x="7" y="16" width="2" height="3" fill={OUTLINE} />
          <rect x="7" y="16" width="1" height="2" fill={CREAM} />
          <rect x="11" y="15" width="2" height="3" fill={OUTLINE} />
          <rect x="12" y="15" width="1" height="2" fill={CREAM_SHADE} />
        </>
      ) : (
        <>
          <rect x="7" y="15" width="2" height="3" fill={OUTLINE} />
          <rect x="7" y="15" width="1" height="2" fill={CREAM_SHADE} />
          <rect x="11" y="16" width="2" height="3" fill={OUTLINE} />
          <rect x="12" y="16" width="1" height="2" fill={CREAM} />
        </>
      )}
    </>
  );
}

/**
 * 20x20 crisp pixel-art desktop cat facing right by default.
 * Only the character body group is mirrored when facing left so status glyphs stay upright.
 */
export const PixelCatSvg: React.FC<PixelCatSvgProps> = ({ state, walkFrame, facing }) => {
  const isDragging = state === 'dragging';
  const isWalking = state === 'walking';
  const isHappy = state === 'happy';
  const isListening = state === 'listening';
  const isThinking = state === 'thinking';
  const isSpeaking = state === 'speaking';
  const isError = state === 'error';

  const tailTipY = isWalking && walkFrame === 1 ? 7 : 8;
  const tailMidY = isWalking && walkFrame === 1 ? 9 : 10;

  return (
    <svg
      viewBox="0 0 20 20"
      width="80"
      height="80"
      shapeRendering="crispEdges"
      aria-label="Pixel Cat Assistant"
    >
      {isDragging ? (
        <HeldDanglingCat frame={walkFrame} />
      ) : (
        <>
          {/* State Pixel Indicators (above head, never mirrored) */}
          {isHappy && (
            <g fill={PINK}>
              <rect x="9" y="0" width="1" height="1" />
              <rect x="11" y="0" width="1" height="1" />
              <rect x="8" y="1" width="5" height="1" />
              <rect x="9" y="2" width="3" height="1" />
              <rect x="10" y="3" width="1" height="1" />
            </g>
          )}

          {isThinking && (
            <g fill={GOLD}>
              <rect x="9" y="0" width="2" height="1" />
              <rect x="11" y="1" width="1" height="1" />
              <rect x="10" y="2" width="1" height="1" />
              <rect x="10" y="4" width="1" height="1" />
            </g>
          )}

          {isListening && (
            <g fill={PINK}>
              <rect x="7" y="1" width="1" height="2" />
              <rect x="10" y="0" width="1" height="3" />
              <rect x="13" y="1" width="1" height="2" />
            </g>
          )}

          <g transform={facing === 'left' ? 'translate(20, 0) scale(-1, 1)' : undefined}>
            {/* Tail (left side, wagging gently during walk) */}
            <rect x="1" y={tailTipY} width="2" height="2" fill={OUTLINE} />
            <rect x="1" y={tailTipY + 1} width="1" height="1" fill={GINGER} />
            <rect x="2" y={tailMidY} width="2" height="3" fill={OUTLINE} />
            <rect x="2" y={tailMidY + 1} width="2" height="2" fill={CREAM_SHADE} />
            <rect x="3" y="12" width="2" height="2" fill={OUTLINE} />
            <rect x="4" y="12" width="1" height="2" fill={GINGER} />

            {/* Body outline */}
            <rect x="4" y="10" width="10" height="6" fill={OUTLINE} />
            {/* Body fill */}
            <rect x="5" y="11" width="8" height="4" fill={CREAM} />
            {/* Ginger back saddle & belly shade */}
            <rect x="5" y="11" width="4" height="2" fill={GINGER} />
            <rect x="6" y="14" width="6" height="1" fill={CREAM_SHADE} />

            {/* Ears outline */}
            <rect x="7" y="3" width="2" height="2" fill={OUTLINE} />
            <rect x="14" y="3" width="2" height="2" fill={OUTLINE} />
            {/* Ear inner ginger + pink */}
            <rect x="8" y="4" width="1" height="2" fill={GINGER} />
            <rect x="14" y="4" width="1" height="2" fill={GINGER_DARK} />
            <rect x="8" y="5" width="1" height="1" fill={PINK} />
            <rect x="14" y="5" width="1" height="1" fill={PINK} />

            {/* Head outline */}
            <rect x="7" y="5" width="9" height="6" fill={OUTLINE} />
            <rect x="6" y="6" width="11" height="4" fill={OUTLINE} />
            {/* Head fill */}
            <rect x="8" y="6" width="7" height="4" fill={CREAM} />
            <rect x="7" y="7" width="9" height="3" fill={CREAM} />
            {/* Cute ginger forehead patch */}
            <rect x="8" y="6" width="3" height="2" fill={GINGER} />
            <rect x="13" y="6" width="2" height="1" fill={GINGER} />

            {/* Rosy cheek pixels */}
            <rect x="8" y="9" width="1" height="1" fill={PINK} />
            <rect x="15" y="9" width="1" height="1" fill={PINK} />

            {/* Eyes */}
            {isHappy ? (
              <g fill={OUTLINE}>
                <rect x="9" y="8" width="2" height="1" />
                <rect x="13" y="8" width="2" height="1" />
              </g>
            ) : isError ? (
              <g fill={OUTLINE}>
                <rect x="9" y="7" width="1" height="1" />
                <rect x="10" y="8" width="1" height="1" />
                <rect x="9" y="9" width="1" height="1" />
                <rect x="14" y="7" width="1" height="1" />
                <rect x="13" y="8" width="1" height="1" />
                <rect x="14" y="9" width="1" height="1" />
              </g>
            ) : (
              <g className={isWalking ? undefined : 'mochi-eye'}>
                <rect x="9" y="7" width="1" height="2" fill={OUTLINE} />
                <rect x="14" y="7" width="1" height="2" fill={OUTLINE} />
                <rect x="9" y="7" width="1" height="1" fill="#312e81" />
                <rect x="14" y="7" width="1" height="1" fill="#312e81" />
              </g>
            )}

            {/* Nose & Mouth */}
            <rect x="12" y="9" width="1" height="1" fill={PINK} />
            {isSpeaking && <rect x="12" y="10" width="1" height="1" fill="#be185d" />}

            {/* Legs / Paws (2-frame stride when walking, seated tidy paws when idle) */}
            {isWalking ? (
              walkFrame === 0 ? (
                <>
                  {/* Back left paw forward, front right paw forward */}
                  <rect x="4" y="16" width="2" height="2" fill={OUTLINE} />
                  <rect x="5" y="16" width="1" height="1" fill={CREAM} />
                  <rect x="7" y="15" width="2" height="2" fill={OUTLINE} />
                  <rect x="7" y="15" width="1" height="1" fill={CREAM_SHADE} />
                  <rect x="10" y="16" width="2" height="2" fill={OUTLINE} />
                  <rect x="10" y="16" width="1" height="1" fill={CREAM} />
                  <rect x="13" y="15" width="2" height="2" fill={OUTLINE} />
                  <rect x="13" y="15" width="1" height="1" fill={CREAM_SHADE} />
                </>
              ) : (
                <>
                  {/* Opposite stride */}
                  <rect x="5" y="15" width="2" height="2" fill={OUTLINE} />
                  <rect x="5" y="15" width="1" height="1" fill={CREAM_SHADE} />
                  <rect x="7" y="16" width="2" height="2" fill={OUTLINE} />
                  <rect x="8" y="16" width="1" height="1" fill={CREAM} />
                  <rect x="10" y="15" width="2" height="2" fill={OUTLINE} />
                  <rect x="10" y="15" width="1" height="1" fill={CREAM_SHADE} />
                  <rect x="12" y="16" width="2" height="2" fill={OUTLINE} />
                  <rect x="13" y="16" width="1" height="1" fill={CREAM} />
                </>
              )
            ) : (
              <>
                {/* Standing/resting neat paws */}
                <rect x="5" y="16" width="2" height="2" fill={OUTLINE} />
                <rect x="6" y="16" width="1" height="1" fill={CREAM} />
                <rect x="8" y="16" width="2" height="2" fill={OUTLINE} />
                <rect x="8" y="16" width="1" height="1" fill={CREAM_SHADE} />
                <rect x="11" y="16" width="2" height="2" fill={OUTLINE} />
                <rect x="11" y="16" width="1" height="1" fill={CREAM} />
              </>
            )}
          </g>
        </>
      )}
    </svg>
  );
};
