import fs from 'node:fs';
import path from 'node:path';
import type {
  AssistantSettings,
  CustomSprites,
  SettingsView,
  SpriteStateKey,
} from '../../src/types';

export const DEFAULT_SYSTEM_PROMPT =
  'You are Mochi, a friendly, sharp, and concise personal PC AI assistant character. ' +
  'When the user shares a screenshot, identify the key content quickly and give clear, actionable help. ' +
  'Keep responses readable, warm, and well-structured.';

export const DEFAULT_SETTINGS: AssistantSettings = {
  apiKey: '',
  chatModel: 'gemini-3.8-flash',
  characterName: 'Mochi',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  characterScale: 1,
  ttsEnabled: false,
  walkEnabled: true,
  autoSaveScreenshots: true,
  transcriptionMode: 'smart',
  sprites: {},
};

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

export class SettingsStore {
  private readonly configPath: string;
  private readonly spritesDir: string;
  private readonly envApiKeyProvider: () => string;

  constructor(dataDir: string, envApiKeyProvider?: () => string) {
    this.configPath = path.join(dataDir, 'config.json');
    this.spritesDir = path.join(dataDir, 'sprites');
    this.envApiKeyProvider =
      envApiKeyProvider ??
      (() => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim());
  }

  private ensureDirs(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.mkdirSync(this.spritesDir, { recursive: true });
  }

  public readRaw(): AssistantSettings {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { ...DEFAULT_SETTINGS, sprites: {} };
      }
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<AssistantSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        sprites: { ...(parsed.sprites ?? {}) },
      };
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

  public getView(): SettingsView {
    const raw = this.readRaw();
    const envKey = this.envApiKeyProvider();
    const spriteDataUrls: CustomSprites = {};

    for (const [key, filePath] of Object.entries(raw.sprites) as Array<[SpriteStateKey, string]>) {
      if (filePath && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_BY_EXT[ext] ?? 'image/png';
        const base64 = fs.readFileSync(filePath).toString('base64');
        spriteDataUrls[key] = `data:${mime};base64,${base64}`;
      }
    }

    return {
      ...raw,
      hasEnvApiKey: Boolean(envKey),
      effectiveApiKeyConfigured: Boolean(raw.apiKey.trim() || envKey),
      spriteDataUrls,
    };
  }

  public update(patch: Partial<AssistantSettings>): SettingsView {
    this.ensureDirs();
    const current = this.readRaw();
    const next: AssistantSettings = {
      ...current,
      ...patch,
      sprites: patch.sprites ? { ...current.sprites, ...patch.sprites } : current.sprites,
    };

    if (typeof next.characterScale === 'number') {
      next.characterScale = Math.max(0.65, Math.min(1.4, next.characterScale));
    }

    fs.writeFileSync(this.configPath, JSON.stringify(next, null, 2), 'utf-8');
    return this.getView();
  }

  public saveSpriteFile(state: SpriteStateKey, sourcePath: string): SettingsView {
    this.ensureDirs();
    const ext = path.extname(sourcePath).toLowerCase() || '.png';
    const targetPath = path.join(this.spritesDir, `${state}${ext}`);

    // Clean up any previous extension for this state
    for (const existing of fs.readdirSync(this.spritesDir)) {
      if (existing.startsWith(`${state}.`)) {
        try {
          fs.unlinkSync(path.join(this.spritesDir, existing));
        } catch {
          // Ignore cleanup race
        }
      }
    }

    fs.copyFileSync(sourcePath, targetPath);
    const current = this.readRaw();
    return this.update({
      sprites: {
        ...current.sprites,
        [state]: targetPath,
      },
    });
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
    fs.writeFileSync(
      this.configPath,
      JSON.stringify({ ...current, sprites: {} }, null, 2),
      'utf-8',
    );
    return this.getView();
  }
}
