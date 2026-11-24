import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore } from '../electron/services/settingsStore';

describe('SettingsStore', () => {
  it('returns defaults and falls back to env API key when none is saved', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-settings-'));
    try {
      const store = new SettingsStore(tmpDir, () => 'env-secret-key');
      const view = store.getView();

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

  it('persists updates and clamps characterScale', () => {
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

      expect(updated.characterName).toBe('Nova');
      expect(updated.characterScale).toBe(1.4);
      expect(updated.walkEnabled).toBe(false);
      expect(updated.autoSaveScreenshots).toBe(false);
      expect(store.getEffectiveApiKey()).toBe('saved-user-key');

      // Re-instantiate to confirm disk persistence
      const reloaded = new SettingsStore(tmpDir, () => '');
      expect(reloaded.readRaw().characterName).toBe('Nova');
      expect(reloaded.readRaw().walkEnabled).toBe(false);
      expect(reloaded.readRaw().autoSaveScreenshots).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('copies custom PNGTuber sprite images to local store and resets cleanly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-sprites-'));
    const samplePng = path.join(tmpDir, 'sample.png');
    fs.writeFileSync(samplePng, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    try {
      const store = new SettingsStore(path.join(tmpDir, 'userData'), () => '');
      const withSprite = store.saveSpriteFile('idle', samplePng);
      expect(withSprite.spriteDataUrls.idle).toMatch(/^data:image\/png;base64,/);

      const reset = store.resetSprites();
      expect(reset.spriteDataUrls.idle).toBeUndefined();
      expect(reset.sprites).toEqual({});
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
