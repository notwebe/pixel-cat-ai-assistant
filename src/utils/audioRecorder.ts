export interface RecordedAudio {
  base64: string;
  mimeType: string;
  durationMs: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function pickSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'audio/webm';
}

export class MicAudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private rafId: number | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private chosenMime = 'audio/webm';

  public async start(onLevel?: (level: number) => void): Promise<void> {
    if (this.mediaRecorder) {
      throw new Error('Recording is already in progress.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    this.chunks = [];
    this.startedAt = Date.now();
    this.chosenMime = pickSupportedMimeType();

    const recorder = new MediaRecorder(stream, { mimeType: this.chosenMime });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.mediaRecorder = recorder;
    recorder.start(200);

    if (onLevel) {
      const ctx = new AudioContext();
      this.audioContext = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const normalized = (data[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        onLevel(Math.min(1, rms * 3.5));
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }
  }

  public async stop(): Promise<RecordedAudio> {
    const recorder = this.mediaRecorder;
    if (!recorder) {
      throw new Error('No active recording.');
    }

    const durationMs = Date.now() - this.startedAt;

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const cleanMime = this.chosenMime.split(';')[0] || 'audio/webm';
        resolve(new Blob(this.chunks, { type: cleanMime }));
      };
      recorder.onerror = () => reject(new Error('Audio recording failed.'));
      recorder.stop();
    });

    this.cleanup();
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const mimeType = (blob.type || 'audio/webm').split(';')[0];

    return {
      base64,
      mimeType,
      durationMs,
    };
  }

  public cancel(): void {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {
      // Ignore cancel cleanup errors
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.chunks = [];
  }
}
