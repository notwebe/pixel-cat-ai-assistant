import fs from 'node:fs';
import path from 'node:path';
import {
  AI_PROVIDERS,
  DEFAULT_ORCAROUTER_BASE_URL,
  DEFAULT_ORCAROUTER_MODEL,
  GEMINI_CHAT_MODELS,
  SPRITE_STATE_KEYS,
  type AIProvider,
  type AssistantSettings,
  type CustomSprites,
  type GeminiChatModel,
  type SettingsPatch,
  type SettingsView,
  type SpriteStateKey,
  type TranscriptionMode,
} from '../../src/types';

export const DEFAULT_SYSTEM_PROMPT =
  'You are Mochi, a friendly, sharp, and concise personal PC AI assistant character. ' +
  'When the user shares a screenshot, identify the key content quickly and give clear, actionable help. ' +
  'Keep responses readable, warm, and well-structured.';

export const DEFAULT_SETTINGS: AssistantSettings = {
  aiProvider: 'gemini',
  apiKey: '',
  chatModel: 'gemini-3.8-flash',
  orcaRouterApiKey: '',
  orcaRouterModel: DEFAULT_ORCAROUTER_MODEL,
  orcaRouterBaseUrl: DEFAULT_ORCAROUTER_BASE_URL,
  characterName: 'Mochi',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  characterScale: 1,
  ttsEnabled: false,
  walkEnabled: true,
  autoSaveScreenshots: true,
  openAtLogin: false,
  transcriptionMode: 'smart',
  sprites: {},
};

export interface SecretCipher {
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export const ALLOWED_SPRITE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const VALID_PROVIDERS = new Set<string>(AI_PROVIDERS);
const VALID_MODELS = new Set<string>(GEMINI_CHAT_MODELS);
const VALID_SPRITE_STATES = new Set<string>(SPRITE_STATE_KEYS);
const VALID_SPRITE_EXTENSIONS = new Set<string>(ALLOWED_SPRITE_EXTENSIONS);

interface StoredConfig {
  aiProvider?: unknown;
  apiKey?: unknown;
  encryptedApiKey?: unknown;
  chatModel?: unknown;
  orcaRouterApiKey?: unknown;
  encryptedOrcaRouterApiKey?: unknown;
  orcaRouterModel?: unknown;
  orcaRouterBaseUrl?: unknown;
  characterName?: unknown;
  systemPrompt?: unknown;
  characterScale?: unknown;
  ttsEnabled?: unknown;
  walkEnabled?: unknown;
  autoSaveScreenshots?: unknown;
  openAtLogin?: unknown;
  transcriptionMode?: unknown;
  sprites?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidAIProvider(provider: unknown): provider is AIProvider {
  return typeof provider === 'string' && VALID_PROVIDERS.has(provider);
}

export function isValidSpriteStateKey(state: unknown): state is SpriteStateKey {
  return typeof state === 'string' && VALID_SPRITE_STATES.has(state);
}

export function isValidChatModel(model: unknown): model is GeminiChatModel {
  return typeof model === 'string' && VALID_MODELS.has(model);
}

export function normalizeOrcaRouterBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_ORCAROUTER_BASE_URL;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_ORCAROUTER_BASE_URL;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return DEFAULT_ORCAROUTER_BASE_URL;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_ORCAROUTER_BASE_URL;
  }
}

export function normalizeOrcaRouterModel(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_ORCAROUTER_MODEL;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 160) : DEFAULT_ORCAROUTER_MODEL;
}

function clampScale(scale: number): number {
  return Math.max(0.65, Math.min(1.4, scale));
}

function normalizeTranscriptionMode(mode: unknown): TranscriptionMode {
  return mode === 'verbatim' ? 'verbatim' : 'smart';
}

export class SettingsStore {
  private readonly configPath: string;
  private readonly spritesDir: string;
  private readonly envApiKeyProvider: () => string;
  private readonly envOrcaRouterKeyProvider: () => string;
  private readonly secretCipher?: SecretCipher;
  private readonly isPackagedProvider: () => boolean;

  constructor(
    dataDir: string,
    envApiKeyProvider?: () => string,
    secretCipher?: SecretCipher,
    envOrcaRouterKeyProvider?: () => string,
    isPackagedProvider?: () => boolean,
  ) {
    this.configPath = path.join(dataDir, 'config.json');
    this.spritesDir = path.join(dataDir, 'sprites');
    this.envApiKeyProvider =
      envApiKeyProvider ??
      (() => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim());
    this.envOrcaRouterKeyProvider =
      envOrcaRouterKeyProvider ??
      (() => (process.env.ORCAROUTER_API_KEY || '').trim());
    this.secretCipher = secretCipher;
    this.isPackagedProvider = isPackagedProvider ?? (() => false);
  }

  private ensureDirs(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.mkdirSync(this.spritesDir, { recursive: true });
  }

  private isSafeSpritePath(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (!VALID_SPRITE_EXTENSIONS.has(ext)) {
      return false;
    }
    const resolvedSpritesDir = path.resolve(this.spritesDir);
    const resolvedTarget = path.resolve(filePath);
    const rel = path.relative(resolvedSpritesDir, resolvedTarget);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  private sanitizeStoredSprites(rawSprites: unknown): CustomSprites {
    const sanitized: CustomSprites = {};
    if (!isPlainObject(rawSprites)) {
      return sanitized;
    }

    for (const [key, value] of Object.entries(rawSprites)) {
      if (isValidSpriteStateKey(key) && typeof value === 'string' && this.isSafeSpritePath(value)) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private resolveSecretFromConfig(
    parsed: Record<string, unknown>,
    plainField: string,
    encryptedField: string,
  ): { value: string; needsMigration: boolean } {
    const encryptedRaw = parsed[encryptedField];
    const plainRaw = parsed[plainField];

    if (this.secretCipher) {
      if (typeof encryptedRaw === 'string' && encryptedRaw.trim()) {
        let value = '';
        try {
          value = this.secretCipher.decrypt(encryptedRaw).trim();
        } catch {
          value = '';
        }
        return { value, needsMigration: plainField in parsed };
      }
      if (typeof plainRaw === 'string') {
        return { value: plainRaw.trim(), needsMigration: true };
      }
      return { value: '', needsMigration: false };
    }

    if (typeof plainRaw === 'string') {
      return { value: plainRaw.trim(), needsMigration: false };
    }
    return { value: '', needsMigration: false };
  }

  private writeConfig(settings: AssistantSettings): void {
    this.ensureDirs();
    const payload: Record<string, unknown> = {
      aiProvider: isValidAIProvider(settings.aiProvider)
        ? settings.aiProvider
        : DEFAULT_SETTINGS.aiProvider,
      chatModel: isValidChatModel(settings.chatModel)
        ? settings.chatModel
        : DEFAULT_SETTINGS.chatModel,
      orcaRouterModel: normalizeOrcaRouterModel(settings.orcaRouterModel),
      orcaRouterBaseUrl: normalizeOrcaRouterBaseUrl(settings.orcaRouterBaseUrl),
      characterName: settings.characterName,
      systemPrompt: settings.systemPrompt,
      characterScale: clampScale(settings.characterScale),
      ttsEnabled: settings.ttsEnabled,
      walkEnabled: settings.walkEnabled,
      autoSaveScreenshots: settings.autoSaveScreenshots,
      openAtLogin: settings.openAtLogin,
      transcriptionMode: normalizeTranscriptionMode(settings.transcriptionMode),
      sprites: this.sanitizeStoredSprites(settings.sprites),
    };

    const trimmedGeminiKey = settings.apiKey.trim();
    const trimmedOrcaKey = settings.orcaRouterApiKey.trim();
    if (this.secretCipher) {
      if (trimmedGeminiKey) {
        payload.encryptedApiKey = this.secretCipher.encrypt(trimmedGeminiKey);
      }
      if (trimmedOrcaKey) {
        payload.encryptedOrcaRouterApiKey = this.secretCipher.encrypt(trimmedOrcaKey);
      }
      // Never persist plaintext API keys when a cipher is active.
    } else {
      if (trimmedGeminiKey) {
        payload.apiKey = trimmedGeminiKey;
      }
      if (trimmedOrcaKey) {
        payload.orcaRouterApiKey = trimmedOrcaKey;
      }
    }

    fs.writeFileSync(this.configPath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private removeExistingSpriteFiles(state: SpriteStateKey): void {
    if (!fs.existsSync(this.spritesDir)) return;
    for (const existing of fs.readdirSync(this.spritesDir)) {
      if (existing.startsWith(`${state}.`)) {
        try {
          fs.unlinkSync(path.join(this.spritesDir, existing));
        } catch {
          // Ignore cleanup race
        }
      }
    }
  }

  public readRaw(): AssistantSettings {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { ...DEFAULT_SETTINGS, sprites: {} };
      }

      const parsedRaw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as unknown;
      if (!isPlainObject(parsedRaw)) {
        return { ...DEFAULT_SETTINGS, sprites: {} };
      }
      const parsed = parsedRaw as StoredConfig;

      const geminiSecret = this.resolveSecretFromConfig(
        parsedRaw,
        'apiKey',
        'encryptedApiKey',
      );
      const orcaSecret = this.resolveSecretFromConfig(
        parsedRaw,
        'orcaRouterApiKey',
        'encryptedOrcaRouterApiKey',
      );
      const needsMigration = geminiSecret.needsMigration || orcaSecret.needsMigration;

      const settings: AssistantSettings = {
        aiProvider: isValidAIProvider(parsed.aiProvider)
          ? parsed.aiProvider
          : DEFAULT_SETTINGS.aiProvider,
        apiKey: geminiSecret.value,
        chatModel: isValidChatModel(parsed.chatModel)
          ? parsed.chatModel
          : DEFAULT_SETTINGS.chatModel,
        orcaRouterApiKey: orcaSecret.value,
        orcaRouterModel: normalizeOrcaRouterModel(parsed.orcaRouterModel),
        orcaRouterBaseUrl: normalizeOrcaRouterBaseUrl(parsed.orcaRouterBaseUrl),
        characterName:
          typeof parsed.characterName === 'string' && parsed.characterName.trim()
            ? parsed.characterName.trim().slice(0, 80)
            : DEFAULT_SETTINGS.characterName,
        systemPrompt:
          typeof parsed.systemPrompt === 'string'
            ? parsed.systemPrompt
            : DEFAULT_SETTINGS.systemPrompt,
        characterScale:
          typeof parsed.characterScale === 'number' && Number.isFinite(parsed.characterScale)
            ? clampScale(parsed.characterScale)
            : DEFAULT_SETTINGS.characterScale,
        ttsEnabled:
          typeof parsed.ttsEnabled === 'boolean'
            ? parsed.ttsEnabled
            : DEFAULT_SETTINGS.ttsEnabled,
        walkEnabled:
          typeof parsed.walkEnabled === 'boolean'
            ? parsed.walkEnabled
            : DEFAULT_SETTINGS.walkEnabled,
        autoSaveScreenshots:
          typeof parsed.autoSaveScreenshots === 'boolean'
            ? parsed.autoSaveScreenshots
            : DEFAULT_SETTINGS.autoSaveScreenshots,
        openAtLogin:
          typeof parsed.openAtLogin === 'boolean'
            ? parsed.openAtLogin
            : DEFAULT_SETTINGS.openAtLogin,
        transcriptionMode: normalizeTranscriptionMode(parsed.transcriptionMode),
        sprites: this.sanitizeStoredSprites(parsed.sprites),
      };

      if (needsMigration && this.secretCipher) {
        try {
          this.writeConfig(settings);
        } catch {
          // Non-fatal if migration write fails on read-only filesystem
        }
      }

      return settings;
    } catch {
      return { ...DEFAULT_SETTINGS, sprites: {} };
    }
  }

  public getEffectiveApiKey(): string {
    const raw = this.readRaw();
    const stored = raw.apiKey.trim();
    if (stored) {
      return stored;
    }
    return this.envApiKeyProvider();
  }

  public getEffectiveOrcaRouterApiKey(): string {
    const raw = this.readRaw();
    const stored = raw.orcaRouterApiKey.trim();
    if (stored) {
      return stored;
    }
    return this.envOrcaRouterKeyProvider();
  }

  public getView(): SettingsView {
    const raw = this.readRaw();
    const envKey = this.envApiKeyProvider();
    const hasSavedApiKey = Boolean(raw.apiKey.trim());
    const hasEnvApiKey = Boolean(envKey);
    const geminiConfigured = hasSavedApiKey || hasEnvApiKey;

    const envOrcaKey = this.envOrcaRouterKeyProvider();
    const hasSavedOrcaRouterApiKey = Boolean(raw.orcaRouterApiKey.trim());
    const hasEnvOrcaRouterApiKey = Boolean(envOrcaKey);
    const orcaRouterApiKeyConfigured = hasSavedOrcaRouterApiKey || hasEnvOrcaRouterApiKey;

    const spriteDataUrls: CustomSprites = {};

    for (const [key, filePath] of Object.entries(raw.sprites) as Array<[SpriteStateKey, string]>) {
      if (filePath && this.isSafeSpritePath(filePath) && fs.existsSync(filePath)) {
        try {
          const ext = path.extname(filePath).toLowerCase();
          const mime = MIME_BY_EXT[ext] ?? 'image/png';
          const base64 = fs.readFileSync(filePath).toString('base64');
          spriteDataUrls[key] = `data:${mime};base64,${base64}`;
        } catch {
          // Ignore unreadable sprite file
        }
      }
    }

    return {
      ...raw,
      apiKey: '',
      orcaRouterApiKey: '',
      hasSavedApiKey,
      hasEnvApiKey,
      hasSavedOrcaRouterApiKey,
      hasEnvOrcaRouterApiKey,
      orcaRouterApiKeyConfigured,
      effectiveApiKeyConfigured:
        raw.aiProvider === 'orcarouter' ? orcaRouterApiKeyConfigured : geminiConfigured,
      isPackaged: this.isPackagedProvider(),
      spriteDataUrls,
    };
  }

  public update(patch: SettingsPatch): SettingsView {
    if (!isPlainObject(patch)) {
      throw new TypeError('Settings update payload must be an object.');
    }

    const current = this.readRaw();
    const next: AssistantSettings = {
      ...current,
      sprites: { ...current.sprites },
    };

    if (isValidAIProvider(patch.aiProvider)) {
      next.aiProvider = patch.aiProvider;
    }

    if (patch.apiKey === null) {
      next.apiKey = '';
    } else if (typeof patch.apiKey === 'string') {
      next.apiKey = patch.apiKey.trim();
    }

    if (patch.orcaRouterApiKey === null) {
      next.orcaRouterApiKey = '';
    } else if (typeof patch.orcaRouterApiKey === 'string') {
      next.orcaRouterApiKey = patch.orcaRouterApiKey.trim();
    }

    if (isValidChatModel(patch.chatModel)) {
      next.chatModel = patch.chatModel;
    }

    if (typeof patch.orcaRouterModel === 'string') {
      next.orcaRouterModel = normalizeOrcaRouterModel(patch.orcaRouterModel);
    }

    if (typeof patch.orcaRouterBaseUrl === 'string') {
      next.orcaRouterBaseUrl = normalizeOrcaRouterBaseUrl(patch.orcaRouterBaseUrl);
    }

    if (typeof patch.characterName === 'string') {
      const trimmedName = patch.characterName.trim();
      next.characterName = trimmedName ? trimmedName.slice(0, 80) : DEFAULT_SETTINGS.characterName;
    }

    if (typeof patch.systemPrompt === 'string') {
      next.systemPrompt = patch.systemPrompt.trim().slice(0, 8000);
    }

    if (typeof patch.characterScale === 'number' && Number.isFinite(patch.characterScale)) {
      next.characterScale = clampScale(patch.characterScale);
    }

    if (typeof patch.ttsEnabled === 'boolean') {
      next.ttsEnabled = patch.ttsEnabled;
    }

    if (typeof patch.walkEnabled === 'boolean') {
      next.walkEnabled = patch.walkEnabled;
    }

    if (typeof patch.autoSaveScreenshots === 'boolean') {
      next.autoSaveScreenshots = patch.autoSaveScreenshots;
    }

    if (typeof patch.openAtLogin === 'boolean') {
      next.openAtLogin = patch.openAtLogin;
    }

    if (patch.transcriptionMode === 'smart' || patch.transcriptionMode === 'verbatim') {
      next.transcriptionMode = patch.transcriptionMode;
    }

    this.writeConfig(next);
    return this.getView();
  }

  public saveSpriteFile(state: SpriteStateKey, sourcePath: string): SettingsView {
    if (!isValidSpriteStateKey(state)) {
      throw new Error(`Invalid sprite state: ${String(state)}`);
    }

    const ext = path.extname(sourcePath).toLowerCase();
    if (!VALID_SPRITE_EXTENSIONS.has(ext)) {
      throw new Error(
        'Unsupported sprite image format. Please choose PNG, JPG, JPEG, WebP, or GIF.',
      );
    }

    this.ensureDirs();
    const targetPath = path.join(this.spritesDir, `${state}${ext}`);
    this.removeExistingSpriteFiles(state);

    fs.copyFileSync(sourcePath, targetPath);
    const current = this.readRaw();
    const next: AssistantSettings = {
      ...current,
      sprites: {
        ...current.sprites,
        [state]: targetPath,
      },
    };
    this.writeConfig(next);
    return this.getView();
  }

  public clearSprite(state: SpriteStateKey): SettingsView {
    if (!isValidSpriteStateKey(state)) {
      throw new Error(`Invalid sprite state: ${String(state)}`);
    }

    this.ensureDirs();
    this.removeExistingSpriteFiles(state);

    const current = this.readRaw();
    const nextSprites: CustomSprites = { ...current.sprites };
    delete nextSprites[state];
    this.writeConfig({ ...current, sprites: nextSprites });
    return this.getView();
  }

  public resetSprites(): SettingsView {
    this.ensureDirs();
    for (const existing of fs.readdirSync(this.spritesDir)) {
      try {
        fs.unlinkSync(path.join(this.spritesDir, existing));
      } catch {
        // Ignore cleanup race
      }
    }
    const current = this.readRaw();
    this.writeConfig({ ...current, sprites: {} });
    return this.getView();
  }
}
