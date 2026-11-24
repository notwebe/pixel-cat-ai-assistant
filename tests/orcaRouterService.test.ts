import { describe, expect, it, vi } from 'vitest';
import {
  AudioUnsupportedError,
  normalizeOrcaRouterError,
  OrcaRouterService,
} from '../electron/services/orcaRouterService';

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OrcaRouterService', () => {
  it('streams SSE chunks across fragmented buffers with auth header, system prompt, and history', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeSseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo "}}]}\n\ndata: {"choices":[{"delta":',
        '{"content":"Orca!"}}]}\ndata: [DONE]\n',
      ]),
    );

    const service = new OrcaRouterService(fetchMock as unknown as typeof fetch);
    const deltas: string[] = [];

    const result = await service.streamChat(
      {
        apiKey: 'sk-orca-test-123',
        model: 'openai/gpt-4o-mini',
        baseUrl: 'https://api.orcarouter.ai/v1/',
        systemPrompt: 'Be concise.',
        prompt: 'What next?',
        history: [
          { role: 'user', text: 'First question' },
          { role: 'assistant', text: 'First answer' },
        ],
      },
      { onDelta: (chunk) => deltas.push(chunk) },
    );

    expect(deltas).toEqual(['Hel', 'lo ', 'Orca!']);
    expect(result).toEqual({ fullText: 'Hello Orca!', interactionId: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.orcarouter.ai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-orca-test-123',
    );
    const body = JSON.parse(String(init.body)) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.model).toBe('openai/gpt-4o-mini');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'What next?' },
    ]);
  });

  it('sends screenshot attachments as OpenAI-compatible image_url data URLs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        makeSseResponse([
          'data: {"choices":[{"delta":{"content":"Screenshot analyzed."}}]}\n',
          'data: [DONE]\n',
        ]),
      );

    const service = new OrcaRouterService(fetchMock as unknown as typeof fetch);
    const deltas: string[] = [];

    await service.streamChat(
      {
        apiKey: 'sk-orca-test-123',
        model: 'orcarouter/auto',
        systemPrompt: '',
        prompt: 'Explain this screen',
        imageBase64: 'iVBORw0KGgo=',
        imageMimeType: 'image/png',
      },
      { onDelta: (c) => deltas.push(c) },
    );

    expect(deltas.join('')).toBe('Screenshot analyzed.');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Explain this screen' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
          },
        ],
      },
    ]);
  });

  it('exits cleanly on AbortSignal cancellation', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Start"}}]}\n'));
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const service = new OrcaRouterService(fetchMock as unknown as typeof fetch);
    const deltas: string[] = [];

    const result = await service.streamChat(
      {
        apiKey: 'sk-orca-test',
        systemPrompt: '',
        prompt: 'Stream until aborted',
        signal: controller.signal,
      },
      {
        onDelta: (chunk) => {
          deltas.push(chunk);
          controller.abort();
        },
      },
    );

    expect(deltas).toEqual(['Start']);
    expect(result).toEqual({ fullText: 'Start', interactionId: null });
  });

  it('normalizes OrcaRouter HTTP and network errors cleanly', () => {
    expect(normalizeOrcaRouterError(401, 'bad key')).toMatch(/invalid or unauthorized/i);
    expect(normalizeOrcaRouterError(402, 'no credits')).toMatch(/insufficient orcarouter credits/i);
    expect(normalizeOrcaRouterError(404, 'missing')).toMatch(/model was not found/i);
    expect(normalizeOrcaRouterError(429, 'too fast')).toMatch(/rate limit/i);
    expect(normalizeOrcaRouterError(503, 'down')).toMatch(/temporarily unavailable/i);
    expect(normalizeOrcaRouterError(null, 'Request timed out')).toMatch(/timed out/i);
    expect(normalizeOrcaRouterError(null, '', new Error('fetch failed ENOTFOUND'))).toMatch(
      /network error/i,
    );
  });

  it('lists and sorts models from GET /models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'openai/gpt-4o', name: 'GPT-4o' },
            { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
            { id: 'orcarouter/auto' },
            { id: 'orcarouter/auto' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const service = new OrcaRouterService(fetchMock as unknown as typeof fetch);
    const models = await service.listModels({
      apiKey: 'sk-orca-key',
      baseUrl: 'https://api.orcarouter.ai/v1/',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.orcarouter.ai/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(models.map((m) => m.id)).toEqual([
      'anthropic/claude-sonnet-4',
      'openai/gpt-4o',
      'orcarouter/auto',
    ]);
  });

  it('transcribes audio and throws AudioUnsupportedError when model rejects audio input', async () => {
    const okFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from OrcaRouter audio.' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const okService = new OrcaRouterService(okFetch as unknown as typeof fetch);
    const transcript = await okService.transcribeAudio({
      apiKey: 'sk-orca-key',
      model: 'google/gemini-2.5-flash',
      audioBase64: 'UklGRg==',
      mimeType: 'audio/wav',
      mode: 'smart',
    });

    expect(transcript).toEqual({
      text: 'Hello from OrcaRouter audio.',
      sourceName: 'Microphone Recording',
    });

    const unsupportedFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'This model does not support input_audio modality.' },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const unsupportedService = new OrcaRouterService(unsupportedFetch as unknown as typeof fetch);
    await expect(
      unsupportedService.transcribeAudio({
        apiKey: 'sk-orca-key',
        model: 'text-only-model',
        audioBase64: 'UklGRg==',
        mimeType: 'audio/webm',
        mode: 'smart',
      }),
    ).rejects.toBeInstanceOf(AudioUnsupportedError);
  });
});
