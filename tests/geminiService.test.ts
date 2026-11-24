import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GeminiChatModel } from '../src/types';
import { GeminiService, normalizeGeminiError } from '../electron/services/geminiService';

async function* makeAsyncStream<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

describe('GeminiService', () => {
  it('streams multimodal text + screenshot image through Interactions API', async () => {
    const createMock = vi.fn().mockResolvedValue(
      makeAsyncStream([
        { event_type: 'interaction.created', interaction: { id: 'inter-1' } },
        { event_type: 'step.delta', delta: { type: 'text', text: 'Hello ' } },
        { event_type: 'step.delta', delta: { type: 'text', text: 'from Mochi!' } },
        { event_type: 'interaction.completed', interaction: { id: 'inter-1' } },
      ]),
    );

    const service = new GeminiService(() => ({
      interactions: { create: createMock },
      files: { upload: vi.fn() },
    }));

    const chunks: string[] = [];
    const result = await service.streamChat(
      {
        apiKey: 'test-key',
        model: 'gemini-3.8-flash',
        systemPrompt: 'Be helpful.',
        prompt: 'What is on my screen?',
        imageBase64: 'iVBORw0KGgo=',
        imageMimeType: 'image/png',
        previousInteractionId: 'inter-0',
      },
      { onDelta: (c) => chunks.push(c) },
    );

    expect(chunks).toEqual(['Hello ', 'from Mochi!']);
    expect(result).toEqual({ fullText: 'Hello from Mochi!', interactionId: 'inter-1' });
    expect(createMock).toHaveBeenCalledWith({
      model: 'gemini-3.8-flash',
      system_instruction: 'Be helpful.',
      previous_interaction_id: 'inter-0',
      stream: true,
      input: [
        { type: 'text', text: 'What is on my screen?' },
        { type: 'image', data: 'iVBORw0KGgo=', mime_type: 'image/png' },
      ],
    });
  });

  it('rejects cleanly when API key is missing, model is unsupported, or prompt+image are empty', async () => {
    const service = new GeminiService(() => ({
      interactions: { create: vi.fn() },
      files: { upload: vi.fn() },
    }));

    await expect(
      service.streamChat(
        {
          apiKey: '   ',
          model: 'gemini-3.8-flash',
          systemPrompt: 'Be helpful.',
          prompt: 'Hi',
        },
        { onDelta: () => {} },
      ),
    ).rejects.toThrow(/Missing Gemini API key/i);

    await expect(
      service.streamChat(
        {
          apiKey: 'test-key',
          model: 'unknown-model' as GeminiChatModel,
          systemPrompt: 'Be helpful.',
          prompt: 'Hi',
        },
        { onDelta: () => {} },
      ),
    ).rejects.toThrow(/Unsupported Gemini chat model/i);

    await expect(
      service.streamChat(
        {
          apiKey: 'test-key',
          model: 'gemini-3.8-flash',
          systemPrompt: 'Be helpful.',
          prompt: '   ',
        },
        { onDelta: () => {} },
      ),
    ).rejects.toThrow(/enter a message or attach a screenshot/i);
  });

  it('exits cleanly on pre-aborted or mid-stream AbortSignal', async () => {
    const createMock = vi.fn();
    const service = new GeminiService(() => ({
      interactions: { create: createMock },
      files: { upload: vi.fn() },
    }));

    const preAborted = new AbortController();
    preAborted.abort();
    const preResult = await service.streamChat(
      {
        apiKey: 'test-key',
        model: 'gemini-3.8-flash',
        systemPrompt: 'Be helpful.',
        prompt: 'Hi',
        signal: preAborted.signal,
      },
      { onDelta: () => {} },
    );
    expect(preResult).toEqual({ fullText: '', interactionId: null, aborted: true });
    expect(createMock).not.toHaveBeenCalled();

    const midController = new AbortController();
    let returned = false;
    async function* slowStream() {
      try {
        yield { event_type: 'interaction.created', interaction: { id: 'inter-abort' } };
        yield { event_type: 'step.delta', delta: { type: 'text', text: 'Partial ' } };
        await new Promise((resolve) => setTimeout(resolve, 5000));
        yield { event_type: 'step.delta', delta: { type: 'text', text: 'Never' } };
      } finally {
        returned = true;
      }
    }

    createMock.mockResolvedValue(slowStream());
    const chunks: string[] = [];
    const midPromise = service.streamChat(
      {
        apiKey: 'test-key',
        model: 'gemini-3.8-flash',
        systemPrompt: 'Be helpful.',
        prompt: 'Hi',
        signal: midController.signal,
      },
      {
        onDelta: (chunk) => {
          chunks.push(chunk);
          midController.abort();
        },
      },
    );

    const midResult = await midPromise;
    expect(chunks).toEqual(['Partial ']);
    expect(midResult).toEqual({
      fullText: 'Partial ',
      interactionId: 'inter-abort',
      aborted: true,
    });
    expect(returned).toBe(true);
  });

  it('handles SSE errors, non-completed statuses, and interaction.steps fallback', async () => {
    const createMock = vi.fn();
    const service = new GeminiService(() => ({
      interactions: { create: createMock },
      files: { upload: vi.fn() },
    }));

    createMock.mockResolvedValueOnce(
      makeAsyncStream([
        {
          event_type: 'error',
          error: { code: '429', message: '429 RESOURCE_EXHAUSTED' },
        },
      ]),
    );
    await expect(
      service.streamChat(
        {
          apiKey: 'test-key',
          model: 'gemini-3.8-flash',
          systemPrompt: 'Be helpful.',
          prompt: 'Hi',
        },
        { onDelta: () => {} },
      ),
    ).rejects.toThrow(/rate limit/i);

    createMock.mockResolvedValueOnce(
      makeAsyncStream([
        { event_type: 'interaction.completed', interaction: { id: 'i-fail', status: 'failed' } },
      ]),
    );
    await expect(
      service.streamChat(
        {
          apiKey: 'test-key',
          model: 'gemini-3.8-flash',
          systemPrompt: 'Be helpful.',
          prompt: 'Hi',
        },
        { onDelta: () => {} },
      ),
    ).rejects.toThrow(/ended with status: failed/i);

    createMock.mockResolvedValueOnce(
      makeAsyncStream([
        {
          event_type: 'interaction.completed',
          interaction: {
            id: 'i-steps',
            status: 'completed',
            steps: [
              {
                type: 'model_output',
                content: [{ type: 'text', text: 'Fallback from steps!' }],
              },
            ],
          },
        },
      ]),
    );
    const chunks: string[] = [];
    const stepFallbackResult = await service.streamChat(
      {
        apiKey: 'test-key',
        model: 'gemini-3.8-flash',
        systemPrompt: 'Be helpful.',
        prompt: 'Hi',
      },
      { onDelta: (c) => chunks.push(c) },
    );
    expect(chunks).toEqual(['Fallback from steps!']);
    expect(stepFallbackResult).toEqual({
      fullText: 'Fallback from steps!',
      interactionId: 'i-steps',
    });
  });

  it('transcribes inline microphone audio via gemini-3.5-transcribe', async () => {
    const createMock = vi.fn().mockResolvedValue({
      output_text: 'Testing microphone transcription.',
    });
    const factoryMock = vi.fn().mockReturnValue({
      interactions: { create: createMock },
      files: { upload: vi.fn() },
    });

    const service = new GeminiService(factoryMock);
    const result = await service.transcribeAudio({
      apiKey: 'test-key',
      audioBase64: 'UklGRg==',
      mimeType: 'audio/webm',
      mode: 'smart',
    });

    expect(factoryMock).toHaveBeenCalledWith('test-key', 'v1beta');
    expect(result).toEqual({
      text: 'Testing microphone transcription.',
      sourceName: 'Microphone Recording',
    });
    expect(createMock).toHaveBeenCalledWith({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', data: 'UklGRg==', mime_type: 'audio/webm' }],
      generation_config: {
        transcription_config: {
          mode: 'smart',
          language_codes: [],
        },
      },
    });
  });

  it('reads small local audio files inline for transcription', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-audio-'));
    const audioFile = path.join(tmpDir, 'note.wav');
    fs.writeFileSync(audioFile, Buffer.from('RIFFtest'));

    const createMock = vi.fn().mockResolvedValue({
      output_text: 'Meeting notes transcript.',
    });

    try {
      const service = new GeminiService(() => ({
        interactions: { create: createMock },
        files: { upload: vi.fn() },
      }));

      const result = await service.transcribeAudio({
        apiKey: 'test-key',
        filePath: audioFile,
        mimeType: 'audio/wav',
        mode: 'verbatim',
      });

      expect(result.sourceName).toBe('note.wav');
      expect(result.text).toBe('Meeting notes transcript.');
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3.5-transcribe',
          generation_config: {
            transcription_config: { mode: 'verbatim', language_codes: [] },
          },
        }),
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('uploads >15 MB audio via Files API, enforces 50 MB max, and deletes uploaded file in finally', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-large-audio-'));
    const largeFile = path.join(tmpDir, 'podcast.mp3');
    const oversizedFile = path.join(tmpDir, 'too-big.mp3');

    try {
      fs.writeFileSync(largeFile, Buffer.alloc(0));
      fs.truncateSync(largeFile, 16 * 1024 * 1024);

      fs.writeFileSync(oversizedFile, Buffer.alloc(0));
      fs.truncateSync(oversizedFile, 51 * 1024 * 1024);

      const uploadMock = vi.fn().mockResolvedValue({
        name: 'files/uploaded-audio-1',
        uri: 'https://generativelanguage.googleapis.com/v1beta/files/uploaded-audio-1',
        mimeType: 'audio/mp3',
      });
      const deleteMock = vi.fn().mockResolvedValue({});
      const createMock = vi.fn().mockRejectedValueOnce(new Error('503 SERVICE_UNAVAILABLE'));

      const service = new GeminiService(() => ({
        interactions: { create: createMock },
        files: { upload: uploadMock, delete: deleteMock },
      }));

      await expect(
        service.transcribeAudio({
          apiKey: 'test-key',
          filePath: largeFile,
          mimeType: 'audio/mp3',
          mode: 'smart',
        }),
      ).rejects.toThrow(/temporarily unavailable/i);

      expect(uploadMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledWith({ name: 'files/uploaded-audio-1' });

      await expect(
        service.transcribeAudio({
          apiKey: 'test-key',
          filePath: oversizedFile,
          mimeType: 'audio/mp3',
          mode: 'smart',
        }),
      ).rejects.toThrow(/50 MB maximum size/i);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('normalizes common Gemini API errors into user-friendly guidance', () => {
    const abortErr = new Error('The operation was aborted.');
    abortErr.name = 'AbortError';

    expect(normalizeGeminiError(abortErr)).toMatch(/cancelled/i);
    expect(normalizeGeminiError(new Error('Request timed out ETIMEDOUT'))).toMatch(/timed out/i);
    expect(normalizeGeminiError(new Error('401 API_KEY_INVALID'))).toMatch(/invalid/i);
    expect(normalizeGeminiError(new Error('429 RESOURCE_EXHAUSTED'))).toMatch(/rate limit/i);
    expect(normalizeGeminiError(new Error('400 INVALID_ARGUMENT'))).toMatch(/rejected/i);
    expect(normalizeGeminiError(new Error('404 NOT_FOUND'))).toMatch(/not found/i);
    expect(normalizeGeminiError(new Error('503 SERVICE_UNAVAILABLE'))).toMatch(/unavailable/i);
    expect(normalizeGeminiError(new Error('fetch failed ENOTFOUND'))).toMatch(/network/i);
  });
});
