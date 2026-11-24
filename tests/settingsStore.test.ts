import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SettingsPatch, SpriteStateKey } from '../src/types';
import {
  DEFAULT_SETTINGS,
  SettingsStore,
  type SecretCipher,
} from '../electron/services/settingsStore';

function makeTestCipher(): SecretCipher {
  return {
    encrypt: (value: string) => `enc:${Buffer.from(value, 'utf-8').toString('base64')}`,
    decrypt: (value: string) => {
      if (!value.startsWith('enc:')) {
        throw new Error('Bad ciphertext');
      }
      return Buffer.from(value.slice(4), 'base64').toString('utf-8');
    },
  };
}

describe('SettingsStore', () => {
  it('returns defaults and falls back to env API key when none is saved', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-settings-'));
    try {
      const store = new SettingsStore(tmpDir, () => 'env-secret-key');
      const view = store.getView();

      expect(view.apiKey).toBe('');
      expect(view.hasSavedApiKey).toBe(false);
      expect(view.characterName).toBe(DEFAULT_SETTINGS.characterName);
      expect(view.walkEnabled).toBe(true);
      expect(view.autoSaveScreenshots).toBe(true);
      expect(view.hasEnvApiKey).toBe(true);
      expect(view.effectiveApiKeyConfigured).toBe(true);
      expect(store.getEffectiveApiKey()).toBe('env-secret-key');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('persists updates, clamps characterScale, and masks apiKey in view', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-settings-'));
    try {
      const store = new SettingsStore(tmpDir, () => '');
      const updated = store.update({
        apiKey: 'saved-user-key',
        characterName: 'Nova',
        characterScale: 5,
        walkEnabled: false,
        autoSaveScreenshots: false,
      });

      expect(updated.apiKey).toBe('');
      expect(updated.hasSavedApiKey).toBe(true);
      expect(updated.effectiveApiKeyConfigured).toBe(true);
      expect(updated.characterName).toBe('Nova');
      expect(updated.characterScale).toBe(1.4);
      expect(updated.walkEnabled).toBe(false);
      expect(updated.autoSaveScreenshots).toBe(false);
      expect(store.getEffectiveApiKey()).toBe('saved-user-key');

      const lowClamped = store.update({ characterScale: 0.1 });
      expect(lowClamped.characterScale).toBe(0.65);

      // Re-instantiate to confirm disk persistence
      const reloaded = new SettingsStore(tmpDir, () => '');
      expect(reloaded.readRaw().characterName).toBe('Nova');
      expect(reloaded.readRaw().walkEnabled).toBe(false);
      expect(reloaded.readRaw().autoSaveScreenshots).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('encrypts API keys via SecretCipher, masks IPC view, and supports null/empty clearing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-cipher-'));
    const cipher = makeTestCipher();

    try {
      const store = new SettingsStore(tmpDir, () => '', cipher);
      const view = store.update({ apiKey: '  AIza-secret-999  ' });

      expect(view.apiKey).toBe('');
      expect(view.hasSavedApiKey).toBe(true);
      expect(view.effectiveApiKeyConfigured).toBe(true);
      expect(store.getEffectiveApiKey()).toBe('AIza-secret-999');

      const configFile = path.join(tmpDir, 'config.json');
      const rawText = fs.readFileSync(configFile, 'utf-8');
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      expect(rawText).not.toContain('AIza-secret-999');
      expect(parsed.apiKey).toBeUndefined();
      expect(typeof parsed.encryptedApiKey).toBe('string');

      // undefined apiKey preserves existing encrypted secret
      const afterNameChange = store.update({ characterName: 'Pixel' });
      expect(afterNameChange.hasSavedApiKey).toBe(true);
      expect(store.getEffectiveApiKey()).toBe('AIza-secret-999');

      // null clears saved secret
      const clearedWithNull = store.update({ apiKey: null });
      expect(clearedWithNull.apiKey).toBe('');
      expect(clearedWithNull.hasSavedApiKey).toBe(false);
      expect(store.getEffectiveApiKey()).toBe('');

      // empty string also clears saved secret
      store.update({ apiKey: 'another-key' });
      expect(store.getEffectiveApiKey()).toBe('another-key');
      const clearedWithEmpty = store.update({ apiKey: '' });
      expect(clearedWithEmpty.hasSavedApiKey).toBe(false);
      expect(store.getEffectiveApiKey()).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('migrates legacy plaintext apiKey to encryptedApiKey on first load', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-migrate-'));
    const cipher = makeTestCipher();
    const configPath = path.join(tmpDir, 'config.json');

    try {
      fs.writeFileSync(
        configPath,
        JSON.stringify({ apiKey: 'legacy-plain-key', chatModel: 'gemini-3.8-flash' }),
        'utf-8',
      );

      const store = new SettingsStore(tmpDir, () => '', cipher);
      const view = store.getView();

      expect(view.apiKey).toBe('');
      expect(view.hasSavedApiKey).toBe(true);
      expect(store.getEffectiveApiKey()).toBe('legacy-plain-key');

      const migratedText = fs.readFileSync(configPath, 'utf-8');
      const migratedJson = JSON.parse(migratedText) as Record<string, unknown>;
      expect(migratedText).not.toContain('legacy-plain-key');
      expect(migratedJson.apiKey).toBeUndefined();
      expect(typeof migratedJson.encryptedApiKey).toBe('string');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('validates SettingsPatch allowlist, ignores sprites patch, and recovers from corrupt JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-validate-'));
    const configPath = path.join(tmpDir, 'config.json');

    try {
      fs.writeFileSync(configPath, '{broken json!!!', 'utf-8');
      const store = new SettingsStore(tmpDir, () => '');
      expect(store.getView().chatModel).toBe(DEFAULT_SETTINGS.chatModel);

      const view = store.update({
        chatModel: 'invalid-model-name',
        characterScale: Number.NaN,
        transcriptionMode: 'invalid-mode',
        sprites: { idle: '/etc/passwd' },
      } as unknown as SettingsPatch);

      expect(view.chatModel).toBe(DEFAULT_SETTINGS.chatModel);
      expect(view.characterScale).toBe(1);
      expect(view.transcriptionMode).toBe('smart');
      expect(view.sprites).toEqual({});
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('copies custom PNGTuber sprite images, clears individual sprites, rejects SVG, and resets cleanly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-sprites-'));
    const samplePng = path.join(tmpDir, 'sample.png');
    const sampleSvg = path.join(tmpDir, 'bad.svg');
    fs.writeFileSync(samplePng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    fs.writeFileSync(sampleSvg, '<svg></svg>', 'utf-8');

    try {
      const store = new SettingsStore(path.join(tmpDir, 'userData'), () => '');
      const withIdle = store.saveSpriteFile('idle', samplePng);
      const withBoth = store.saveSpriteFile('happy', samplePng);

      expect(withIdle.spriteDataUrls.idle).toMatch(/^data:image\/png;base64,/);
      expect(withBoth.spriteDataUrls.happy).toMatch(/^data:image\/png;base64,/);

      expect(() => store.saveSpriteFile('idle', sampleSvg)).toThrow(/Unsupported sprite/i);
      expect(() => store.saveSpriteFile('../bad' as SpriteStateKey, samplePng)).toThrow(
        /Invalid sprite state/i,
      );

      const clearedIdle = store.clearSprite('idle');
      expect(clearedIdle.spriteDataUrls.idle).toBeUndefined();
      expect(clearedIdle.sprites.idle).toBeUndefined();
      expect(clearedIdle.spriteDataUrls.happy).toMatch(/^data:image\/png;base64,/);

      const reset = store.resetSprites();
      expect(reset.spriteDataUrls.happy).toBeUndefined();
      expect(reset.sprites).toEqual({});
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('encrypts OrcaRouter keys, migrates plaintext keys, validates Base URL, and checks provider readiness', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-orca-'));
    const cipher = makeTestCipher();
    const configPath = path.join(tmpDir, 'config.json');

    try {
      // Legacy plaintext OrcaRouter key migration
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          aiProvider: 'orcarouter',
          orcaRouterApiKey: 'sk-orca-legacy-111',
          orcaRouterBaseUrl: 'https://api.orcarouter.ai/v1///',
        }),
        'utf-8',
      );

      const store = new SettingsStore(
        tmpDir,
        () => '',
        cipher,
        () => 'sk-orca-env-fallback',
      );
      const migratedView = store.getView();

      expect(migratedView.aiProvider).toBe('orcarouter');
      expect(migratedView.orcaRouterApiKey).toBe('');
      expect(migratedView.hasSavedOrcaRouterApiKey).toBe(true);
      expect(migratedView.hasEnvOrcaRouterApiKey).toBe(true);
      expect(migratedView.orcaRouterApiKeyConfigured).toBe(true);
      expect(migratedView.effectiveApiKeyConfigured).toBe(true);
      expect(migratedView.orcaRouterBaseUrl).toBe('https://api.orcarouter.ai/v1');
      expect(store.getEffectiveOrcaRouterApiKey()).toBe('sk-orca-legacy-111');

      const rawMigrated = fs.readFileSync(configPath, 'utf-8');
      expect(rawMigrated).not.toContain('sk-orca-legacy-111');
      expect(JSON.parse(rawMigrated).orcaRouterApiKey).toBeUndefined();

      // Rejects invalid Base URL scheme and falls back to default; clears saved key back to env fallback
      const updated = store.update({
        orcaRouterApiKey: null,
        orcaRouterModel: 'openai/gpt-4o-mini',
        orcaRouterBaseUrl: 'javascript:alert(1)',
      });
      expect(updated.hasSavedOrcaRouterApiKey).toBe(false);
      expect(updated.orcaRouterApiKeyConfigured).toBe(true);
      expect(updated.orcaRouterModel).toBe('openai/gpt-4o-mini');
      expect(updated.orcaRouterBaseUrl).toBe('https://api.orcarouter.ai/v1');
      expect(store.getEffectiveOrcaRouterApiKey()).toBe('sk-orca-env-fallback');

      // Switching back to Gemini without Gemini key reports effectiveApiKeyConfigured = false
      const switchedBack = store.update({ aiProvider: 'gemini' });
      expect(switchedBack.effectiveApiKeyConfigured).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
