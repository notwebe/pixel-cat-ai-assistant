export type CharacterState =
  | 'idle'
  | 'walking'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'error';

export type SpriteStateKey = 'idle' | 'listening' | 'thinking' | 'speaking' | 'happy';

export type CustomSprites = Partial<Record<SpriteStateKey, string>>;

export type GeminiChatModel =
  | 'gemini-3.8-flash'
  | 'gemini-3.5-flash-lite'
  | 'gemini-4-argon';

export type TranscriptionMode = 'smart' | 'verbatim';

export interface AssistantSettings {
  apiKey: string;
  chatModel: GeminiChatModel;
  characterName: string;
  systemPrompt: string;
  characterScale: number;
  ttsEnabled: boolean;
  walkEnabled: boolean;
  autoSaveScreenshots: boolean;
  transcriptionMode: TranscriptionMode;
  sprites: CustomSprites;
}

export interface SettingsView extends AssistantSettings {
  hasEnvApiKey: boolean;
  effectiveApiKeyConfigured: boolean;
  spriteDataUrls: CustomSprites;
}

export interface ScreenshotAttachment {
  id: string;
  base64: string;
  dataUrl: string;
  width: number;
  height: number;
  mode: 'fullscreen' | 'region' | 'clipboard';
  capturedAt: number;
  savedPath?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imageDataUrl?: string;
  timestamp: number;
  isError?: boolean;
}

export interface SendChatRequest {
  requestId: string;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  previousInteractionId?: string | null;
}

export interface ChatStreamEvent {
  requestId: string;
  type: 'delta' | 'done' | 'error';
  text?: string;
  interactionId?: string | null;
  error?: string;
}

export interface TranscribeRequest {
  audioBase64?: string;
  filePath?: string;
  mimeType: string;
  mode: TranscriptionMode;
}

export interface TranscribeResult {
  text: string;
  sourceName: string;
  mode: TranscriptionMode;
}

export interface TranscriptEntry {
  id: string;
  text: string;
  sourceName: string;
  mode: TranscriptionMode;
  createdAt: number;
}

export interface PickedAudioFile {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnipBackdropPayload {
  dataUrl: string;
  displayWidth: number;
  displayHeight: number;
  scaleFactor: number;
}

export interface WindowWorkAreaInfo {
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface AssistantBridgeAPI {
  // Settings & sprites
  getSettings: () => Promise<SettingsView>;
  saveSettings: (patch: Partial<AssistantSettings>) => Promise<SettingsView>;
  pickSpriteImage: (state: SpriteStateKey) => Promise<SettingsView | null>;
  resetSprites: () => Promise<SettingsView>;

  // Chat & Vision
  sendChat: (req: SendChatRequest) => Promise<void>;
  onChatStream: (callback: (event: ChatStreamEvent) => void) => () => void;

  // Screenshots & Clipboard
  captureFullScreen: () => Promise<ScreenshotAttachment>;
  startRegionCapture: () => Promise<void>;
  onScreenshotCaptured: (callback: (shot: ScreenshotAttachment) => void) => () => void;
  readClipboard: () => Promise<{ text: string; image?: ScreenshotAttachment }>;

  // Transcription
  transcribeAudio: (req: TranscribeRequest) => Promise<TranscribeResult>;
  pickAudioFile: () => Promise<PickedAudioFile | null>;
  saveTranscript: (content: string, defaultName: string) => Promise<string | null>;

  // Window & Tray
  setIgnoreMouseEvents: (ignore: boolean) => void;
  moveWindowBy: (dx: number, dy: number) => void;
  setWindowPosition: (x: number, y: number) => void;
  setPanelMode: (open: boolean) => Promise<void>;
  getWindowWorkArea: () => Promise<WindowWorkAreaInfo>;
  resetWindowPosition: () => void;
  onTogglePanel: (callback: (tab?: 'chat' | 'transcribe' | 'settings') => void) => () => void;

  // Snip Overlay (used only in snip.html)
  getSnipBackdrop: () => Promise<SnipBackdropPayload | null>;
  completeSnip: (rect: CropRect) => Promise<void>;
  cancelSnip: () => Promise<void>;
}

declare global {
  interface Window {
    assistantAPI: AssistantBridgeAPI;
  }
}
