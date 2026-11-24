import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Clipboard,
  Copy,
  Crop,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ChatMessage, ScreenshotAttachment } from '../types';
import { MarkdownMessage } from './MarkdownMessage';

interface ChatTabProps {
  characterName: string;
  messages: ChatMessage[];
  pendingShot: ScreenshotAttachment | null;
  isStreaming: boolean;
  ttsEnabled: boolean;
  draftPrompt: string;
  onDraftChange: (text: string) => void;
  onSend: (prompt: string) => void;
  onCancelStream: () => void;
  onRetryMessage: (messageId: string) => void;
  onAttachImage: (shot: ScreenshotAttachment) => void;
  onCaptureFull: () => void;
  onStartSnip: () => void;
  onAttachClipboard: () => void;
  onClearPendingShot: () => void;
  onClearChat: () => void;
  onToggleTts: () => void;
}

const SCREENSHOT_QUICK_PROMPTS = [
  'Explain what is on this screen',
  'Help fix any error shown here',
  'Summarize the key points',
  'Translate visible text to English',
];

async function imageFileToAttachment(file: File): Promise<ScreenshotAttachment> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read pasted image.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read pasted image.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid pasted image.'));
    el.src = rawDataUrl;
  });

  const width = img.naturalWidth || 1;
  const height = img.naturalHeight || 1;

  let pngDataUrl = rawDataUrl;
  if (file.type !== 'image/png') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      pngDataUrl = canvas.toDataURL('image/png');
    }
  }

  const base64 = pngDataUrl.replace(/^data:image\/[^;]+;base64,/, '');
  return {
    id: crypto.randomUUID(),
    base64,
    dataUrl: pngDataUrl,
    width,
    height,
    mode: 'clipboard',
    capturedAt: Date.now(),
  };
}

export const ChatTab: React.FC<ChatTabProps> = ({
  characterName,
  messages,
  pendingShot,
  isStreaming,
  ttsEnabled,
  draftPrompt,
  onDraftChange,
  onSend,
  onCancelStream,
  onRetryMessage,
  onAttachImage,
  onCaptureFull,
  onStartSnip,
  onAttachClipboard,
  onClearPendingShot,
  onClearChat,
  onToggleTts,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);
  const copyTimerRef = useRef<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= 48;
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isStreaming) return;
    if (!draftPrompt.trim() && !pendingShot) return;
    isNearBottomRef.current = true;
    onSend(draftPrompt.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isStreaming) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        try {
          const shot = await imageFileToAttachment(file);
          onAttachImage(shot);
        } catch {
          // Ignore malformed clipboard image data
        }
        return;
      }
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
        copyTimerRef.current = null;
      }, 1500);
    } catch {
      // Ignore clipboard write errors
    }
  };

  return (
    <>
      <div className="chat-toolbar">
        <button type="button" className="tool-chip" onClick={onCaptureFull} disabled={isStreaming}>
          <Camera size={13} />
          Screen
        </button>
        <button type="button" className="tool-chip" onClick={onStartSnip} disabled={isStreaming}>
          <Crop size={13} />
          Snip
        </button>
        <button
          type="button"
          className="tool-chip"
          onClick={onAttachClipboard}
          disabled={isStreaming}
        >
          <Clipboard size={13} />
          Clipboard
        </button>
        <div className="toolbar-spacer" />
        <button
          type="button"
          className={`icon-btn ${ttsEnabled ? 'active' : ''}`}
          title={ttsEnabled ? 'Voice output ON (browser TTS)' : 'Voice output OFF'}
          aria-label={ttsEnabled ? 'Turn voice output off' : 'Turn voice output on'}
          onClick={onToggleTts}
        >
          {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Clear conversation"
          aria-label="Clear conversation"
          onClick={onClearChat}
          disabled={messages.length === 0 || isStreaming}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef} onScroll={handleMessagesScroll}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <h3>Hi! I&apos;m {characterName}</h3>
            <p>
              Ask me anything, capture or paste a screenshot so I can help with what you&apos;re
              looking at, or switch to <strong>Transcribe</strong> for voice &amp; audio notes.
            </p>
            <div className="shortcut-hints">
              <span className="kbd-pill">Ctrl+Shift+Space Toggle</span>
              <span className="kbd-pill">Ctrl+Shift+S Full Screen</span>
              <span className="kbd-pill">Ctrl+Shift+R Snip Region</span>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}
            >
              {msg.imageDataUrl && (
                <img src={msg.imageDataUrl} alt="Captured screen" className="message-thumb" />
              )}
              {msg.role === 'assistant' && !msg.isError ? (
                msg.text ? (
                  <MarkdownMessage content={msg.text} />
                ) : (
                  <div>{isStreaming ? '...' : ''}</div>
                )
              ) : (
                <div>{msg.text}</div>
              )}
              {msg.role === 'assistant' && (msg.text || msg.isError) && (
                <div className="message-actions">
                  {msg.isError && !isStreaming && (
                    <button
                      type="button"
                      className="mini-link-btn retry-btn"
                      onClick={() => {
                        isNearBottomRef.current = true;
                        onRetryMessage(msg.id);
                      }}
                    >
                      <RotateCcw size={11} />
                      Retry
                    </button>
                  )}
                  {msg.text && !msg.isError && (
                    <button
                      type="button"
                      className="mini-link-btn"
                      onClick={() => void handleCopy(msg.id, msg.text)}
                    >
                      {copiedId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                      {copiedId === msg.id ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {pendingShot && (
        <div className="attachment-bar">
          <div className="attachment-row">
            <img src={pendingShot.dataUrl} alt="Preview" className="attachment-preview" />
            <div className="attachment-meta">
              <div>
                <strong>
                  {pendingShot.mode === 'region'
                    ? 'Region Snip'
                    : pendingShot.mode === 'clipboard'
                      ? 'Clipboard Image'
                      : 'Full Screen'}
                </strong>{' '}
                ({pendingShot.width}×{pendingShot.height})
              </div>
              {pendingShot.savedPath && (
                <div
                  className="muted-meta"
                  title={pendingShot.savedPath}
                  style={{ fontSize: 10.5 }}
                >
                  Saved to Downloads
                </div>
              )}
              {pendingShot.saveWarning && (
                <div
                  className="warning-meta"
                  title={pendingShot.saveWarning}
                  style={{ fontSize: 10.5 }}
                >
                  {pendingShot.saveWarning}
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-btn"
              title="Remove screenshot"
              aria-label="Remove screenshot"
              onClick={onClearPendingShot}
            >
              <X size={14} />
            </button>
          </div>
          <div className="quick-prompts">
            {SCREENSHOT_QUICK_PROMPTS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="quick-chip"
                onClick={() => {
                  isNearBottomRef.current = true;
                  onSend(chip);
                }}
                disabled={isStreaming}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          className="chat-input"
          rows={1}
          placeholder={
            pendingShot
              ? `Ask ${characterName} about this screenshot...`
              : `Ask ${characterName} anything (or Ctrl+V image)...`
          }
          value={draftPrompt}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => void handlePaste(e)}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            type="button"
            className="send-btn stop-btn"
            onClick={onCancelStream}
            title="Stop generating"
            aria-label="Stop generating"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="submit"
            className="send-btn"
            disabled={!draftPrompt.trim() && !pendingShot}
            title="Send message"
            aria-label="Send message"
          >
            <Send size={15} />
          </button>
        )}
      </form>
    </>
  );
};
