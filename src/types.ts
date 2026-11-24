export type CharacterState =
  | 'idle'
  | 'walking'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'error';

export const SPRITE_STATE_KEYS = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'happy',
] as const;

export type SpriteStateKey = (typeof SPRITE_STATE_KEYS)[number];

export type CustomSprites = Partial<Record<SpriteStateKey, string>>;

export const GEMINI_CHAT_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-4-argon',
] as const;

export type GeminiChatModel = (typeof GEMINI_CHAT_MODELS)[number];

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

export type SettingsPatch = Partial<Omit<AssistantSettings, 'apiKey' | 'sprites'>> & {
  apiKey?: string | null;
};

export interface SettingsView extends AssistantSettings {
  /** Always empty in IPC responses so plaintext keys are never exposed to the renderer. */
  apiKey: string;
  hasSavedApiKey: boolean;
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
  saveWarning?: string;
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
  fileToken?: string;
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

export interface PersistedHistory {
  messages: ChatMessage[];
  transcripts: TranscriptEntry[];
  lastInteractionId: string | null;
}

export interface PickedAudioFile {
  token: string;
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
  saveSettings: (patch: SettingsPatch) => Promise<SettingsView>;
  pickSpriteImage: (state: SpriteStateKey) => Promise<SettingsView | null>;
  clearSpriteImage: (state: SpriteStateKey) => Promise<SettingsView>;
  resetSprites: () => Promise<SettingsView>;

  // Chat & Vision
  sendChat: (req: SendChatRequest) => Promise<void>;
  cancelChat: (requestId: string) => Promise<void>;
  onChatStream: (callback: (event: ChatStreamEvent) => void) => () => void;

  // History persistence
  loadHistory: () => Promise<PersistedHistory>;
  saveHistory: (history: PersistedHistory) => Promise<void>;

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
  getHotkeyStatus: () => Promise<Record<string, boolean>>;
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
