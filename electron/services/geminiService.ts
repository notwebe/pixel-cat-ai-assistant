import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { GEMINI_CHAT_MODELS, type GeminiChatModel, type TranscriptionMode } from '../../src/types';

export interface GeminiClientLike {
  interactions: {
    create: (
      params: Record<string, unknown>,
      options?: { signal?: AbortSignal; timeout_ms?: number },
    ) => Promise<unknown>;
  };
  files: {
    upload: (params: {
      file: string;
      config?: { mimeType?: string; abortSignal?: AbortSignal };
    }) => Promise<{ name?: string; uri?: string; mimeType?: string }>;
    delete?: (params: { name: string }) => Promise<unknown>;
  };
}

export type GeminiClientFactory = (apiKey: string, apiVersion?: string) => GeminiClientLike;

const INLINE_AUDIO_LIMIT_BYTES = 15 * 1024 * 1024; // 15 MB threshold -> switch to Files API above this
export const MAX_AUDIO_FILE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

const VALID_MODELS = new Set<string>(GEMINI_CHAT_MODELS);
const TERMINAL_FAILED_STATUSES = new Set(['failed', 'cancelled', 'incomplete', 'budget_exceeded']);

interface InteractionStepLike {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface StreamEventShape {
  event_type?: string;
  delta?: { type?: string; text?: string };
  error?: { code?: string; message?: string };
  interaction_id?: string;
  status?: string;
  interaction?: {
    id?: string;
    status?: string;
    output_text?: string | null;
    steps?: InteractionStepLike[];
  };
}

export interface StreamChatParams {
  apiKey: string;
  model: GeminiChatModel;
  systemPrompt: string;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  previousInteractionId?: string | null;
  signal?: AbortSignal;
}

export interface StreamChatCallbacks {
  onDelta: (chunk: string) => void;
}

export interface StreamChatResult {
  fullText: string;
  interactionId: string | null;
  aborted?: boolean;
}

export interface TranscribeAudioParams {
  apiKey: string;
  audioBase64?: string;
  filePath?: string;
  mimeType: string;
  mode: TranscriptionMode;
}

function defaultClientFactory(apiKey: string, apiVersion?: string): GeminiClientLike {
  const httpOptions = apiVersion
    ? { apiVersion, timeout: DEFAULT_REQUEST_TIMEOUT_MS }
    : { timeout: DEFAULT_REQUEST_TIMEOUT_MS };
  return new GoogleGenAI({ apiKey, httpOptions }) as unknown as GeminiClientLike;
}

function extractTextFromSteps(steps?: InteractionStepLike[]): string {
  if (!Array.isArray(steps)) return '';
  return steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('')
    .trim();
}

export function normalizeGeminiError(err: unknown): string {
  const errObj = err as { name?: string; status?: number; code?: string; message?: string } | null;
  const raw = err instanceof Error ? err.message : String(err);
  const statusPrefix = typeof errObj?.status === 'number' ? `${errObj.status} ` : '';
  const combined = `${statusPrefix}${raw}`;

  if (
    (err instanceof Error && err.name === 'AbortError') ||
    /\b(?:AbortError|Request was cancelled|aborted)\b/i.test(raw)
  ) {
    return 'Request was cancelled.';
  }
  if (
    /\b(?:timeout|timed out|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|ContinuationInterruptedError)\b/i.test(
      combined,
    )
  ) {
    return 'Gemini API request timed out. Please try again.';
  }
  if (
    /API_KEY_INVALID|API key not valid|\b(?:401|403|UNAUTHENTICATED|PERMISSION_DENIED)\b/i.test(
      combined,
    )
  ) {
    return 'Your Gemini API key looks invalid or unauthorized. Please check it in Settings.';
  }
  if (/\b(?:429|RESOURCE_EXHAUSTED)\b|quota|rate limit/i.test(combined)) {
    return 'Gemini API rate limit reached. Wait a moment and try again.';
  }
  if (/\b(?:404|NOT_FOUND)\b/i.test(combined)) {
    return 'Requested Gemini model or conversation session was not found. Try starting a new chat or checking your model in Settings.';
  }
  if (/\b(?:400|INVALID_ARGUMENT|FAILED_PRECONDITION)\b/i.test(combined)) {
    return 'Gemini API rejected the request (invalid argument or unsupported input).';
  }
  if (/\b(?:50[0-4]|INTERNAL|UNAVAILABLE|SERVICE_UNAVAILABLE)\b/i.test(combined)) {
    return 'Gemini API is temporarily unavailable (server error). Please try again shortly.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(combined)) {
    return 'Network error reaching Google Gemini API. Check your internet connection.';
  }
  if (errObj?.code === 'ENOENT' || /\bENOENT\b/.test(raw)) {
    return 'Selected audio file could not be found or read.';
  }
  return raw || 'Unexpected error while calling Gemini API.';
}

export class GeminiService {
  private readonly createClient: GeminiClientFactory;

  constructor(clientFactory: GeminiClientFactory = defaultClientFactory) {
    this.createClient = clientFactory;
  }

  public async streamChat(
    params: StreamChatParams,
    callbacks: StreamChatCallbacks,
  ): Promise<StreamChatResult> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new Error(
        'Missing Gemini API key. Add your key in the Settings tab or in a local .env file.',
      );
    }

    const model = params.model || 'gemini-3.8-flash';
    if (!VALID_MODELS.has(model)) {
      throw new Error(`Unsupported Gemini chat model: ${model}`);
    }

    const trimmedPrompt = (params.prompt ?? '').trim();
    const hasImage = Boolean(params.imageBase64 && params.imageBase64.trim());
    if (!trimmedPrompt && !hasImage) {
      throw new Error('Please enter a message or attach a screenshot before sending.');
    }

    if (params.signal?.aborted) {
      return { fullText: '', interactionId: null, aborted: true };
    }

    const client = this.createClient(apiKey);
    const inputParts: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: trimmedPrompt || 'Please describe and help with this image.',
      },
    ];

    if (hasImage && params.imageBase64) {
      inputParts.push({
        type: 'image',
        data: params.imageBase64,
        mime_type: params.imageMimeType || 'image/png',
      });
    }

    const requestBody: Record<string, unknown> = {
      model,
      system_instruction: params.systemPrompt,
      input: inputParts,
      stream: true,
    };

    if (params.previousInteractionId) {
      requestBody.previous_interaction_id = params.previousInteractionId;
    }

    let fullText = '';
    let interactionId: string | null = null;

    try {
      const stream = (
        params.signal
          ? await client.interactions.create(requestBody, { signal: params.signal })
          : await client.interactions.create(requestBody)
      ) as AsyncIterable<StreamEventShape>;

      const iterator = stream[Symbol.asyncIterator]();
      let abortListener: (() => void) | undefined;
      const abortPromise = params.signal
        ? new Promise<{ done: true; value: undefined }>((resolve) => {
            if (params.signal!.aborted) {
              void iterator.return?.().catch(() => {});
              resolve({ done: true, value: undefined });
              return;
            }
            abortListener = () => {
              void iterator.return?.().catch(() => {});
              resolve({ done: true, value: undefined });
            };
            params.signal!.addEventListener('abort', abortListener, { once: true });
          })
        : null;

      try {
        while (true) {
          if (params.signal?.aborted) {
            return { fullText, interactionId, aborted: true };
          }

          const nextPromise = iterator.next();
          if (params.signal) {
            nextPromise.catch(() => {});
          }
          const step = abortPromise
            ? await Promise.race([nextPromise, abortPromise])
            : await nextPromise;

          if (params.signal?.aborted) {
            return { fullText, interactionId, aborted: true };
          }
          if (step.done) {
            break;
          }

          const event = step.value;
          if (
            event.event_type === 'step.delta' &&
            event.delta?.type === 'text' &&
            event.delta.text
          ) {
            fullText += event.delta.text;
            callbacks.onDelta(event.delta.text);
          } else if (event.event_type === 'interaction.created' && event.interaction?.id) {
            interactionId = event.interaction.id;
          } else if (event.event_type === 'error') {
            const msg =
              event.error?.message || event.error?.code || 'Gemini interaction stream failed.';
            throw new Error(msg);
          } else if (event.event_type === 'interaction.status_update') {
            if (event.interaction_id && !interactionId) {
              interactionId = event.interaction_id;
            }
            if (event.status && TERMINAL_FAILED_STATUSES.has(event.status)) {
              throw new Error(`Gemini interaction ended with status: ${event.status}.`);
            }
          } else if (event.event_type === 'interaction.completed') {
            if (event.interaction?.id) {
              interactionId = event.interaction.id;
            }
            if (
              event.interaction?.status &&
              TERMINAL_FAILED_STATUSES.has(event.interaction.status)
            ) {
              throw new Error(
                `Gemini interaction ended with status: ${event.interaction.status}.`,
              );
            }
            if (!fullText) {
              const fallbackText =
                (event.interaction?.output_text ?? '').trim() ||
                extractTextFromSteps(event.interaction?.steps);
              if (fallbackText) {
                fullText = fallbackText;
                callbacks.onDelta(fullText);
              }
            }
          }
        }
      } finally {
        if (params.signal && abortListener) {
          params.signal.removeEventListener('abort', abortListener);
        }
      }

      return { fullText, interactionId };
    } catch (err) {
      if (params.signal?.aborted) {
        return { fullText, interactionId, aborted: true };
      }
      throw new Error(normalizeGeminiError(err));
    }
  }

  public async transcribeAudio(params: TranscribeAudioParams): Promise<{
    text: string;
    sourceName: string;
  }> {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
      throw new Error(
        'Missing Gemini API key. Add your key in the Settings tab or in a local .env file.',
      );
    }

    if (!params.filePath && !params.audioBase64) {
      throw new Error('No audio data or file provided for transcription.');
    }

    const client = this.createClient(apiKey, 'v1beta');
    let sourceName = 'Microphone Recording';
    let uploadedFileName: string | undefined;

    try {
      let audioPart: Record<string, unknown>;

      if (params.filePath) {
        sourceName = path.basename(params.filePath);
        const stats = fs.statSync(params.filePath);
        if (stats.size > MAX_AUDIO_FILE_BYTES) {
          throw new Error('Audio file exceeds the 50 MB maximum size limit.');
        }

        if (stats.size > INLINE_AUDIO_LIMIT_BYTES) {
          const uploaded = await client.files.upload({
            file: params.filePath,
            config: { mimeType: params.mimeType },
          });
          uploadedFileName = uploaded.name;
          if (!uploaded.uri) {
            throw new Error('Failed to upload audio file to Gemini Files API.');
          }
          audioPart = {
            type: 'audio',
            uri: uploaded.uri,
            mime_type: uploaded.mimeType || params.mimeType,
          };
        } else {
          const base64 = fs.readFileSync(params.filePath).toString('base64');
          audioPart = {
            type: 'audio',
            data: base64,
            mime_type: params.mimeType,
          };
        }
      } else {
        const inlineBytes = Buffer.byteLength(params.audioBase64!, 'base64');
        if (inlineBytes > MAX_AUDIO_FILE_BYTES) {
          throw new Error('Recorded audio exceeds the 50 MB maximum size limit.');
        }
        audioPart = {
          type: 'audio',
          data: params.audioBase64,
          mime_type: params.mimeType,
        };
      }

      const response = (await client.interactions.create({
        model: 'gemini-3.5-transcribe',
        input: [audioPart],
        generation_config: {
          transcription_config: {
            mode: params.mode,
            language_codes: [],
          },
        },
      })) as {
        output_text?: string | null;
        steps?: InteractionStepLike[];
      };

      const text = (response.output_text ?? '').trim() || extractTextFromSteps(response.steps);

      return {
        text: text || '(No speech detected in audio.)',
        sourceName,
      };
    } catch (err) {
      throw new Error(normalizeGeminiError(err));
    } finally {
      if (uploadedFileName) {
        try {
          await client.files.delete?.({ name: uploadedFileName });
        } catch {
          // Best-effort Files API cleanup
        }
      }
    }
  }
}
