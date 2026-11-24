import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ORCAROUTER_BASE_URL,
  DEFAULT_ORCAROUTER_MODEL,
  type ChatHistoryTurn,
  type OrcaRouterModelOption,
  type TranscriptionMode,
} from '../../src/types';
import { normalizeOrcaRouterBaseUrl, normalizeOrcaRouterModel } from './settingsStore';

const MAX_AUDIO_FILE_BYTES = 50 * 1024 * 1024;
const MAX_HISTORY_TURNS = 20;

export class AudioUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioUnsupportedError';
  }
}

class NormalizedOrcaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizedOrcaError';
  }
}

export interface OrcaRouterStreamChatParams {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  systemPrompt: string;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  history?: ChatHistoryTurn[];
  signal?: AbortSignal;
}

export interface OrcaRouterStreamCallbacks {
  onDelta: (chunk: string) => void;
}

export interface OrcaRouterStreamResult {
  fullText: string;
  interactionId: null;
}

export interface OrcaRouterTranscribeParams {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  audioBase64?: string;
  filePath?: string;
  mimeType: string;
  mode: TranscriptionMode;
  signal?: AbortSignal;
}

export interface OrcaRouterListModelsParams {
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      err instanceof DOMException &&
      err.name === 'AbortError')
  );
}

export function normalizeOrcaRouterError(
  status: number | null,
  detail: string,
  err?: unknown,
): string {
  if (isAbortError(err)) {
    return 'Request cancelled.';
  }

  const combined = detail || (err instanceof Error ? err.message : err ? String(err) : '');

  if (/timed?\s*out|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(combined)) {
    return 'OrcaRouter request timed out. Please try again.';
  }
  if (status === 401 || status === 403 || /\b(401|403|unauthorized|invalid_api_key)\b/i.test(combined)) {
    return 'Your OrcaRouter API key looks invalid or unauthorized. Please check it in Settings.';
  }
  if (status === 402 || /\b(402|insufficient[_\s-]?(?:credits?|quota|balance)|payment required)\b/i.test(combined)) {
    return 'Insufficient OrcaRouter credits. Please check your OrcaRouter account balance.';
  }
  if (status === 404 || /\bmodel[_\s-]?not[_\s-]?found\b/i.test(combined)) {
    return 'The selected OrcaRouter model was not found. Please check the Model ID in Settings.';
  }
  if (status === 429 || /\b(429|rate[_\s-]?limit|too many requests)\b/i.test(combined)) {
    return 'OrcaRouter rate limit reached. Wait a moment and try again.';
  }
  if ((status !== null && status >= 500) || /\b50[0234]\b/.test(combined)) {
    return 'OrcaRouter service is temporarily unavailable. Please try again shortly.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(combined)) {
    return 'Network error reaching OrcaRouter API. Check your internet connection or Base URL.';
  }

  return combined || 'Unexpected error while calling OrcaRouter API.';
}

function extractTextFromChoiceContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

async function readHttpErrorDetail(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (!raw) return res.statusText || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(raw) as {
        error?: { message?: unknown } | string;
        message?: unknown;
      };
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.error === 'string' && parsed.error.trim()) {
          return parsed.error.trim();
        }
        if (
          parsed.error &&
          typeof parsed.error === 'object' &&
          typeof parsed.error.message === 'string' &&
          parsed.error.message.trim()
        ) {
          return parsed.error.message.trim();
        }
        if (typeof parsed.message === 'string' && parsed.message.trim()) {
          return parsed.message.trim();
        }
      }
    } catch {
      // Fall back to raw text
    }
    return raw.slice(0, 500);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

function mapAudioMimeToFormat(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';')[0].trim();
  switch (lower) {
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/mp3':
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/m4a':
    case 'audio/x-m4a':
    case 'audio/mp4':
      return 'm4a';
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    case 'audio/flac':
      return 'flac';
    case 'audio/aac':
      return 'aac';
    case 'audio/aiff':
      return 'aiff';
    default: {
      const slashIdx = lower.indexOf('/');
      return slashIdx >= 0 ? lower.slice(slashIdx + 1) : 'mp3';
    }
  }
}

function looksLikeAudioUnsupported(status: number, detail: string): boolean {
  if (status !== 400 && status !== 404 && status !== 415 && status !== 422) {
    return false;
  }
  return /audio|input_audio|modalit|unsupported|media|format|content.*type/i.test(detail);
}

export class OrcaRouterService {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = globalThis.fetch) {
    this.fetchFn = fetchFn;
  }

  public async listModels(params: OrcaRouterListModelsParams): Promise<OrcaRouterModelOption[]> {
    const baseUrl = normalizeOrcaRouterBaseUrl(params.baseUrl || DEFAULT_ORCAROUTER_BASE_URL);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const trimmedKey = (params.apiKey || '').trim();
    if (trimmedKey) {
      headers.Authorization = `Bearer ${trimmedKey}`;
    }

    try {
      const res = await this.fetchFn(`${baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: params.signal,
      });

      if (!res.ok) {
        const detail = await readHttpErrorDetail(res);
        throw new NormalizedOrcaError(normalizeOrcaRouterError(res.status, detail));
      }

      const payload = (await res.json()) as {
        data?: Array<{ id?: unknown; name?: unknown }>;
      };
      const rawList = Array.isArray(payload?.data) ? payload.data : [];
      const seen = new Set<string>();
      const models: OrcaRouterModelOption[] = [];

      for (const item of rawList) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
        const id = item.id.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        models.push({
          id,
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
        });
      }

      models.sort((a, b) => a.id.localeCompare(b.id));
      return models;
    } catch (err) {
      if (err instanceof NormalizedOrcaError) {
        throw new Error(err.message);
      }
      throw new Error(normalizeOrcaRouterError(null, '', err));
    }
  }

  public async streamChat(
    params: OrcaRouterStreamChatParams,
    callbacks: OrcaRouterStreamCallbacks,
  ): Promise<OrcaRouterStreamResult> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new Error(
        'Missing OrcaRouter API key. Add your key in the Settings tab or in a local .env file.',
      );
    }

    const trimmedPrompt = params.prompt.trim();
    if (!trimmedPrompt && !params.imageBase64) {
      throw new Error('Cannot send an empty message without text or a screenshot.');
    }

    if (params.signal?.aborted) {
      return { fullText: '', interactionId: null };
    }

    const baseUrl = normalizeOrcaRouterBaseUrl(params.baseUrl || DEFAULT_ORCAROUTER_BASE_URL);
    const model = normalizeOrcaRouterModel(params.model || DEFAULT_ORCAROUTER_MODEL);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }> = [];
    if (params.systemPrompt.trim()) {
      messages.push({ role: 'system', content: params.systemPrompt.trim() });
    }

    if (Array.isArray(params.history) && params.history.length > 0) {
      const recent = params.history.slice(-MAX_HISTORY_TURNS);
      for (const turn of recent) {
        if (
          (turn.role === 'user' || turn.role === 'assistant') &&
          typeof turn.text === 'string' &&
          turn.text.trim()
        ) {
          messages.push({ role: turn.role, content: turn.text });
        }
      }
    }

    const effectiveText = trimmedPrompt || 'Please describe and help with this image.';
    if (params.imageBase64) {
      const mime = params.imageMimeType || 'image/png';
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: effectiveText },
          {
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${params.imageBase64}` },
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: effectiveText });
    }

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const res = await this.fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
        }),
        signal: params.signal,
      });

      if (!res.ok) {
        const detail = await readHttpErrorDetail(res);
        throw new NormalizedOrcaError(normalizeOrcaRouterError(res.status, detail));
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
        const json = (await res.json()) as {
          error?: { message?: unknown };
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        if (json?.error?.message) {
          throw new NormalizedOrcaError(normalizeOrcaRouterError(null, String(json.error.message)));
        }
        const text = extractTextFromChoiceContent(json?.choices?.[0]?.message?.content);
        if (text) {
          callbacks.onDelta(text);
        }
        return { fullText: text, interactionId: null };
      }

      if (!res.body) {
        throw new Error('OrcaRouter returned an empty response body.');
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let lineBuffer = '';
      let fullText = '';

      const processLine = (rawLine: string): boolean => {
        const line = rawLine.replace(/\r$/, '');
        if (!line || line.startsWith(':')) {
          return false;
        }
        if (!line.startsWith('data:')) {
          return false;
        }

        const dataStr = line.slice(5).trim();
        if (!dataStr) return false;
        if (dataStr === '[DONE]') {
          return true;
        }

        const parsed = JSON.parse(dataStr) as {
          error?: { message?: unknown; code?: unknown } | string;
          choices?: Array<{
            delta?: { content?: unknown };
            message?: { content?: unknown };
          }>;
        };

        if (parsed.error) {
          const errMsg =
            typeof parsed.error === 'string'
              ? parsed.error
              : typeof parsed.error.message === 'string'
                ? parsed.error.message
                : 'OrcaRouter streaming error.';
          throw new NormalizedOrcaError(normalizeOrcaRouterError(null, errMsg));
        }

        const choice = parsed.choices?.[0];
        const deltaText =
          extractTextFromChoiceContent(choice?.delta?.content) ||
          extractTextFromChoiceContent(choice?.message?.content);

        if (deltaText) {
          fullText += deltaText;
          callbacks.onDelta(deltaText);
        }

        return false;
      };

      while (true) {
        if (params.signal?.aborted) {
          try {
            await reader.cancel();
          } catch {
            // Ignore reader cancel cleanup errors
          }
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          lineBuffer += decoder.decode();
          break;
        }

        lineBuffer += decoder.decode(value, { stream: true });
        let newlineIdx = lineBuffer.indexOf('\n');
        let finished = false;
        while (newlineIdx !== -1) {
          const line = lineBuffer.slice(0, newlineIdx);
          lineBuffer = lineBuffer.slice(newlineIdx + 1);
          if (processLine(line)) {
            finished = true;
            break;
          }
          newlineIdx = lineBuffer.indexOf('\n');
        }

        if (finished) {
          try {
            await reader.cancel();
          } catch {
            // Ignore reader cancel cleanup errors
          }
          break;
        }
      }

      if (lineBuffer.trim() && !params.signal?.aborted) {
        processLine(lineBuffer);
      }

      return { fullText, interactionId: null };
    } catch (err) {
      if (params.signal?.aborted || isAbortError(err)) {
        if (reader) {
          try {
            await reader.cancel();
          } catch {
            // Ignore reader cancel cleanup errors
          }
        }
        return { fullText: '', interactionId: null };
      }

      if (err instanceof NormalizedOrcaError) {
        throw new Error(err.message);
      }

      throw new Error(normalizeOrcaRouterError(null, '', err));
    }
  }

  public async transcribeAudio(
    params: OrcaRouterTranscribeParams,
  ): Promise<{ text: string; sourceName: string }> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new Error(
        'Missing OrcaRouter API key. Add your key in the Settings tab or in a local .env file.',
      );
    }

    const baseUrl = normalizeOrcaRouterBaseUrl(params.baseUrl || DEFAULT_ORCAROUTER_BASE_URL);
    const model = normalizeOrcaRouterModel(params.model || DEFAULT_ORCAROUTER_MODEL);
    let sourceName = 'Microphone Recording';
    let base64Audio: string;

    try {
      if (params.filePath) {
        sourceName = path.basename(params.filePath);
        const stats = fs.statSync(params.filePath);
        if (stats.size > MAX_AUDIO_FILE_BYTES) {
          throw new Error('Audio file exceeds the 50 MB transcription limit.');
        }
        base64Audio = fs.readFileSync(params.filePath).toString('base64');
      } else if (params.audioBase64) {
        const estimatedBytes = Math.ceil((params.audioBase64.length * 3) / 4);
        if (estimatedBytes > MAX_AUDIO_FILE_BYTES) {
          throw new Error('Recorded audio exceeds the 50 MB transcription limit.');
        }
        base64Audio = params.audioBase64;
      } else {
        throw new Error('No audio data or file provided for transcription.');
      }

      const format = mapAudioMimeToFormat(params.mimeType);
      const instruction =
        params.mode === 'verbatim'
          ? 'Transcribe this audio verbatim word-for-word, keeping exact phrasing and punctuation. Output only the transcript text.'
          : 'Transcribe this audio accurately with clean punctuation and capitalization, removing filler words like "um" or "uh". Output only the transcript text.';

      const res = await this.fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                {
                  type: 'input_audio',
                  input_audio: {
                    data: base64Audio,
                    format,
                  },
                },
              ],
            },
          ],
        }),
        signal: params.signal,
      });

      if (!res.ok) {
        const detail = await readHttpErrorDetail(res);
        if (looksLikeAudioUnsupported(res.status, detail)) {
          throw new AudioUnsupportedError(
            `Model "${model}" on OrcaRouter does not support audio input (${detail}). Switch to an audio-capable OrcaRouter model or add a Gemini API key in Settings as transcription fallback.`,
          );
        }
        throw new NormalizedOrcaError(normalizeOrcaRouterError(res.status, detail));
      }

      const json = (await res.json()) as {
        error?: { message?: unknown };
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      if (json?.error?.message) {
        const errMsg = String(json.error.message);
        if (/audio|input_audio|modalit|unsupported/i.test(errMsg)) {
          throw new AudioUnsupportedError(
            `Model "${model}" on OrcaRouter does not support audio input (${errMsg}).`,
          );
        }
        throw new NormalizedOrcaError(normalizeOrcaRouterError(null, errMsg));
      }

      const text = extractTextFromChoiceContent(json?.choices?.[0]?.message?.content).trim();
      return {
        text: text || '(No speech detected in audio.)',
        sourceName,
      };
    } catch (err) {
      if (err instanceof AudioUnsupportedError) {
        throw err;
      }
      if (err instanceof NormalizedOrcaError) {
        throw new Error(err.message);
      }
      if (
        err instanceof Error &&
        (err.message.includes('50 MB') || err.message.startsWith('No audio'))
      ) {
        throw err;
      }
      throw new Error(normalizeOrcaRouterError(null, '', err));
    }
  }
}
