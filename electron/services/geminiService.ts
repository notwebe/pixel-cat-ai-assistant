import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import type { GeminiChatModel, TranscriptionMode } from '../../src/types';

export interface GeminiClientLike {
  interactions: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
  };
  files: {
    upload: (params: {
      file: string;
      config?: { mimeType?: string };
    }) => Promise<{ uri?: string; mimeType?: string }>;
  };
}

export type GeminiClientFactory = (apiKey: string, apiVersion?: string) => GeminiClientLike;

const INLINE_AUDIO_LIMIT_BYTES = 15 * 1024 * 1024; // 15 MB threshold -> switch to Files API above this

export interface StreamChatParams {
  apiKey: string;
  model: GeminiChatModel;
  systemPrompt: string;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  previousInteractionId?: string | null;
}

export interface StreamChatCallbacks {
  onDelta: (chunk: string) => void;
}

export interface StreamChatResult {
  fullText: string;
  interactionId: string | null;
}

export interface TranscribeAudioParams {
  apiKey: string;
  audioBase64?: string;
  filePath?: string;
  mimeType: string;
  mode: TranscriptionMode;
}

function defaultClientFactory(apiKey: string, apiVersion?: string): GeminiClientLike {
  const options = apiVersion
    ? { apiKey, httpOptions: { apiVersion } }
    : { apiKey };
  return new GoogleGenAI(options) as unknown as GeminiClientLike;
}

export function normalizeGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/API_KEY_INVALID|API key not valid|401|403/i.test(raw)) {
    return 'Your Gemini API key looks invalid or unauthorized. Please check it in Settings.';
  }
  if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(raw)) {
    return 'Gemini API rate limit reached. Wait a moment and try again.';
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(raw)) {
    return 'Network error reaching Google Gemini API. Check your internet connection.';
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
    if (!params.apiKey.trim()) {
      throw new Error(
        'Missing Gemini API key. Add your key in the Settings tab or in a local .env file.',
      );
    }

    const client = this.createClient(params.apiKey.trim());
    const inputParts: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: params.prompt.trim() || 'Please describe and help with this image.',
      },
    ];

    if (params.imageBase64) {
      inputParts.push({
        type: 'image',
        data: params.imageBase64,
        mime_type: params.imageMimeType || 'image/png',
      });
    }

    const requestBody: Record<string, unknown> = {
      model: params.model || 'gemini-3.8-flash',
      system_instruction: params.systemPrompt,
      input: inputParts,
      stream: true,
    };

    if (params.previousInteractionId) {
      requestBody.previous_interaction_id = params.previousInteractionId;
    }

    try {
      const stream = (await client.interactions.create(requestBody)) as AsyncIterable<{
        event_type?: string;
        delta?: { type?: string; text?: string };
        interaction?: { id?: string; output_text?: string | null };
      }>;

      let fullText = '';
      let interactionId: string | null = null;

      for await (const event of stream) {
        if (event.event_type === 'step.delta' && event.delta?.type === 'text' && event.delta.text) {
          fullText += event.delta.text;
          callbacks.onDelta(event.delta.text);
        } else if (event.event_type === 'interaction.created' && event.interaction?.id) {
          interactionId = event.interaction.id;
        } else if (event.event_type === 'interaction.completed') {
          if (event.interaction?.id) {
            interactionId = event.interaction.id;
          }
          if (!fullText && event.interaction?.output_text) {
            fullText = event.interaction.output_text;
            callbacks.onDelta(fullText);
          }
        }
      }

      return { fullText, interactionId };
    } catch (err) {
      throw new Error(normalizeGeminiError(err));
    }
  }

  public async transcribeAudio(params: TranscribeAudioParams): Promise<{
    text: string;
    sourceName: string;
  }> {
    if (!params.apiKey.trim()) {
      throw new Error(
        'Missing Gemini API key. Add your key in the Settings tab or in a local .env file.',
      );
    }

    const client = this.createClient(params.apiKey.trim(), 'v1beta');
    let audioPart: Record<string, unknown>;
    let sourceName = 'Microphone Recording';

    if (params.filePath) {
      sourceName = path.basename(params.filePath);
      const stats = fs.statSync(params.filePath);
      if (stats.size > INLINE_AUDIO_LIMIT_BYTES) {
        const uploaded = await client.files.upload({
          file: params.filePath,
          config: { mimeType: params.mimeType },
        });
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
    } else if (params.audioBase64) {
      audioPart = {
        type: 'audio',
        data: params.audioBase64,
        mime_type: params.mimeType,
      };
    } else {
      throw new Error('No audio data or file provided for transcription.');
    }

    try {
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
        steps?: Array<{
          type?: string;
          content?: Array<{ type?: string; text?: string }>;
        }>;
      };

      let text = (response.output_text ?? '').trim();
      if (!text && Array.isArray(response.steps)) {
        text = response.steps
          .filter((step) => step.type === 'model_output')
          .flatMap((step) => step.content ?? [])
          .filter((part) => part.type === 'text' && part.text)
          .map((part) => part.text)
          .join('')
          .trim();
      }

      return {
        text: text || '(No speech detected in audio.)',
        sourceName,
      };
    } catch (err) {
      throw new Error(normalizeGeminiError(err));
    }
  }
}
