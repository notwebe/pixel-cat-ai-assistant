import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileAudio,
  MessageSquarePlus,
  Mic,
  RotateCcw,
  Save,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { TranscriptEntry, TranscriptionMode } from '../types';

interface TranscribeTabProps {
  mode: TranscriptionMode;
  isRecording: boolean;
  isTranscribing: boolean;
  recordingSeconds: number;
  audioLevel: number;
  transcripts: TranscriptEntry[];
  errorMessage: string | null;
  canRetry: boolean;
  onModeChange: (mode: TranscriptionMode) => void;
  onToggleRecord: () => void;
  onCancelRecord: () => void;
  onTranscribeFile: () => void;
  onRetryTranscribe: () => void;
  onSendToChat: (transcriptText: string) => void;
  onDeleteTranscript: (id: string) => void;
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const TranscribeTab: React.FC<TranscribeTabProps> = ({
  mode,
  isRecording,
  isTranscribing,
  recordingSeconds,
  audioLevel,
  transcripts,
  errorMessage,
  canRetry,
  onModeChange,
  onToggleRecord,
  onCancelRecord,
  onTranscribeFile,
  onRetryTranscribe,
  onSendToChat,
  onDeleteTranscript,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleCopy = async (entry: TranscriptEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedId((prev) => (prev === entry.id ? null : prev));
        copyTimerRef.current = null;
      }, 1500);
    } catch {
      // Ignore clipboard write errors
    }
  };

  const handleSave = async (entry: TranscriptEntry) => {
    const safeName = `transcript-${new Date(entry.createdAt).toISOString().slice(0, 10)}.txt`;
    const savedPath = await window.assistantAPI.saveTranscript(entry.text, safeName);
    if (savedPath) {
      setSavedId(entry.id);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        setSavedId((prev) => (prev === entry.id ? null : prev));
        saveTimerRef.current = null;
      }, 2000);
    }
  };

  return (
    <div className="scroll-area">
      <div className="card">
        <div className="row-between">
          <span className="section-label">Speech-to-Text (Gemini 3.5)</span>
          <div className="mode-pills" role="group" aria-label="Transcription Mode">
            <button
              type="button"
              className={`mode-pill ${mode === 'smart' ? 'active' : ''}`}
              onClick={() => onModeChange('smart')}
              disabled={isRecording || isTranscribing}
              title="Clean punctuation and filler removal"
            >
              Smart
            </button>
            <button
              type="button"
              className={`mode-pill ${mode === 'verbatim' ? 'active' : ''}`}
              onClick={() => onModeChange('verbatim')}
              disabled={isRecording || isTranscribing}
              title="Exact word-for-word transcription"
            >
              Verbatim
            </button>
          </div>
        </div>

        <div className="record-controls">
          <button
            type="button"
            className={`primary-btn ${isRecording ? 'recording' : ''}`}
            onClick={onToggleRecord}
            disabled={isTranscribing}
          >
            {isRecording ? (
              <>
                <Square size={14} />
                Stop ({formatDuration(recordingSeconds)})
              </>
            ) : (
              <>
                <Mic size={15} />
                Record Mic
              </>
            )}
          </button>

          {isRecording ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={onCancelRecord}
              title="Discard current recording"
            >
              <X size={15} />
              Discard
            </button>
          ) : (
            <button
              type="button"
              className="secondary-btn"
              onClick={onTranscribeFile}
              disabled={isTranscribing}
            >
              <FileAudio size={15} />
              Audio File
            </button>
          )}
        </div>

        {isRecording && (
          <div className="level-meter" aria-label="Microphone audio level">
            <div
              className="level-fill"
              style={{ width: `${Math.max(8, Math.round(audioLevel * 100))}%` }}
            />
          </div>
        )}

        {isTranscribing && (
          <div className="muted-meta">Transcribing audio with Gemini 3.5 Transcribe...</div>
        )}

        {errorMessage && (
          <div className="message-bubble error transcribe-error" style={{ maxWidth: '100%' }}>
            <div>{errorMessage}</div>
            {canRetry && (
              <div className="message-actions" style={{ justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  className="mini-link-btn retry-btn"
                  onClick={onRetryTranscribe}
                  disabled={isTranscribing || isRecording}
                >
                  <RotateCcw size={12} />
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {transcripts.length === 0 ? (
        <div className="empty-state">
          <h3>No transcripts yet</h3>
          <p>
            Record directly from your microphone or pick an audio file (MP3, WAV, M4A, OGG, WebM,
            FLAC, AAC, AIFF). Automatic language detection is enabled.
          </p>
        </div>
      ) : (
        transcripts.map((entry) => (
          <div key={entry.id} className="transcript-card">
            <div className="row-between">
              <strong style={{ fontSize: 12 }}>{entry.sourceName}</strong>
              <span className="muted-meta">
                {entry.mode} • {new Date(entry.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="transcript-text">{entry.text}</div>
            <div className="transcript-footer">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="mini-link-btn"
                  onClick={() => void handleCopy(entry)}
                >
                  {copiedId === entry.id ? <Check size={12} /> : <Copy size={12} />}
                  {copiedId === entry.id ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  className="mini-link-btn"
                  onClick={() => void handleSave(entry)}
                >
                  {savedId === entry.id ? <Check size={12} /> : <Save size={12} />}
                  {savedId === entry.id ? 'Saved' : 'Save .txt'}
                </button>
                <button
                  type="button"
                  className="mini-link-btn danger-link"
                  onClick={() => onDeleteTranscript(entry.id)}
                  title="Delete transcript"
                  aria-label="Delete transcript"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>
              <button
                type="button"
                className="quick-chip"
                onClick={() => onSendToChat(entry.text)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <MessageSquarePlus size={12} />
                Ask Character
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
