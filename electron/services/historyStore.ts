import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, PersistedHistory, TranscriptEntry } from '../../src/types';

export const MAX_PERSISTED_MESSAGES = 50;
export const MAX_PERSISTED_TRANSCRIPTS = 30;

function createEmptyHistory(): PersistedHistory {
  return {
    messages: [],
    transcripts: [],
    lastInteractionId: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!isPlainObject(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    !raw.id ||
    (raw.role !== 'user' && raw.role !== 'assistant') ||
    typeof raw.text !== 'string' ||
    typeof raw.timestamp !== 'number' ||
    !Number.isFinite(raw.timestamp)
  ) {
    return null;
  }

  const msg: ChatMessage = {
    id: raw.id,
    role: raw.role,
    text: raw.text,
    timestamp: raw.timestamp,
  };
  if (typeof raw.imageDataUrl === 'string' && raw.imageDataUrl.startsWith('data:image/')) {
    msg.imageDataUrl = raw.imageDataUrl;
  }
  if (typeof raw.isError === 'boolean') {
    msg.isError = raw.isError;
  }
  return msg;
}

function sanitizeTranscript(raw: unknown): TranscriptEntry | null {
  if (!isPlainObject(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    !raw.id ||
    typeof raw.text !== 'string' ||
    typeof raw.sourceName !== 'string' ||
    (raw.mode !== 'smart' && raw.mode !== 'verbatim') ||
    typeof raw.createdAt !== 'number' ||
    !Number.isFinite(raw.createdAt)
  ) {
    return null;
  }

  return {
    id: raw.id,
    text: raw.text,
    sourceName: raw.sourceName,
    mode: raw.mode,
    createdAt: raw.createdAt,
  };
}

function sanitizeHistory(raw: unknown): PersistedHistory {
  if (!isPlainObject(raw)) {
    return createEmptyHistory();
  }

  const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
  const messages = rawMessages
    .map(sanitizeMessage)
    .filter((item): item is ChatMessage => item !== null)
    .slice(-MAX_PERSISTED_MESSAGES);

  const rawTranscripts = Array.isArray(raw.transcripts) ? raw.transcripts : [];
  const transcripts = rawTranscripts
    .map(sanitizeTranscript)
    .filter((item): item is TranscriptEntry => item !== null)
    .slice(0, MAX_PERSISTED_TRANSCRIPTS);

  const lastInteractionId =
    typeof raw.lastInteractionId === 'string' && raw.lastInteractionId.trim()
      ? raw.lastInteractionId.trim()
      : null;

  return {
    messages,
    transcripts,
    lastInteractionId,
  };
}

export class HistoryStore {
  private readonly historyPath: string;

  constructor(dataDir: string) {
    this.historyPath = path.join(dataDir, 'history.json');
  }

  public load(): PersistedHistory {
    try {
      if (!fs.existsSync(this.historyPath)) {
        return createEmptyHistory();
      }
      const parsed = JSON.parse(fs.readFileSync(this.historyPath, 'utf-8')) as unknown;
      return sanitizeHistory(parsed);
    } catch {
      return createEmptyHistory();
    }
  }

  public save(history: PersistedHistory): void {
    const sanitized = sanitizeHistory(history);
    fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
    fs.writeFileSync(this.historyPath, JSON.stringify(sanitized, null, 2), 'utf-8');
  }
}
