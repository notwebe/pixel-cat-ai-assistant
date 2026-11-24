import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Clipboard,
  Copy,
  Crop,
  Send,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ChatMessage, ScreenshotAttachment } from '../types';

interface ChatTabProps {
  characterName: string;
  messages: ChatMessage[];
  pendingShot: ScreenshotAttachment | null;
  isStreaming: boolean;
  ttsEnabled: boolean;
  draftPrompt: string;
  onDraftChange: (text: string) => void;
  onSend: (prompt: string) => void;
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

export const ChatTab: React.FC<ChatTabProps> = ({
  characterName,
  messages,
  pendingShot,
  isStreaming,
  ttsEnabled,
  draftPrompt,
  onDraftChange,
  onSend,
  onCaptureFull,
  onStartSnip,
  onAttachClipboard,
  onClearPendingShot,
  onClearChat,
  onToggleTts,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isStreaming) return;
    if (!draftPrompt.trim() && !pendingShot) return;
    onSend(draftPrompt.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  };

  return (
    <>
      <div className="chat-toolbar">
        <button className="tool-chip" onClick={onCaptureFull} disabled={isStreaming}>
          <Camera size={13} />
          Screen
        </button>
        <button className="tool-chip" onClick={onStartSnip} disabled={isStreaming}>
          <Crop size={13} />
          Snip
        </button>
        <button className="tool-chip" onClick={onAttachClipboard} disabled={isStreaming}>
          <Clipboard size={13} />
          Clipboard
        </button>
        <div className="toolbar-spacer" />
        <button
          className={`icon-btn ${ttsEnabled ? 'active' : ''}`}
          title={ttsEnabled ? 'Voice output ON (browser TTS)' : 'Voice output OFF'}
          onClick={onToggleTts}
        >
          {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          className="icon-btn"
          title="Clear conversation"
          onClick={onClearChat}
          disabled={messages.length === 0 || isStreaming}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <h3>Hi! I&apos;m {characterName}</h3>
            <p>
              Ask me anything, capture your screen so I can help with what you&apos;re looking at,
              or switch to <strong>Transcribe</strong> for voice &amp; audio notes.
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
              <div>{msg.text || (isStreaming && msg.role === 'assistant' ? '...' : '')}</div>
              {msg.role === 'assistant' && msg.text && !msg.isError && (
                <div className="message-actions">
                  <button
                    className="mini-link-btn"
                    onClick={() => void handleCopy(msg.id, msg.text)}
                  >
                    {copiedId === msg.id ? <Check size={11} /> : <Copy size={11} />}
                    {copiedId === msg.id ? 'Copied' : 'Copy'}
                  </button>
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
            </div>
            <button
              className="icon-btn"
              title="Remove screenshot"
              onClick={onClearPendingShot}
            >
              <X size={14} />
            </button>
          </div>
          <div className="quick-prompts">
            {SCREENSHOT_QUICK_PROMPTS.map((chip) => (
              <button
                key={chip}
                className="quick-chip"
                onClick={() => onSend(chip)}
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
              : `Ask ${characterName} anything...`
          }
          value={draftPrompt}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        <button
          type="submit"
          className="send-btn"
          disabled={isStreaming || (!draftPrompt.trim() && !pendingShot)}
          title="Send message"
        >
          <Send size={15} />
        </button>
      </form>
    </>
  );
};
