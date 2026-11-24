import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

  it('rejects cleanly when API key is missing', async () => {
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

  it('normalizes common Gemini API errors into user-friendly guidance', () => {
    expect(normalizeGeminiError(new Error('401 API_KEY_INVALID'))).toMatch(/invalid/i);
    expect(normalizeGeminiError(new Error('429 RESOURCE_EXHAUSTED'))).toMatch(/rate limit/i);
    expect(normalizeGeminiError(new Error('fetch failed ENOTFOUND'))).toMatch(/network/i);
  });
});
