import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, ImagePlus, RotateCcw, Save } from 'lucide-react';
import type {
  AssistantSettings,
  GeminiChatModel,
  SettingsView,
  SpriteStateKey,
} from '../types';

interface SettingsTabProps {
  settings: SettingsView;
  onSaveSettings: (patch: Partial<AssistantSettings>) => Promise<void>;
  onPickSprite: (state: SpriteStateKey) => Promise<void>;
  onResetSprites: () => Promise<void>;
}

const SPRITE_SLOTS: Array<{ key: SpriteStateKey; label: string }> = [
  { key: 'idle', label: 'Idle' },
  { key: 'listening', label: 'Listening' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'speaking', label: 'Speaking' },
  { key: 'happy', label: 'Happy' },
];

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onSaveSettings,
  onPickSprite,
  onResetSprites,
}) => {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [chatModel, setChatModel] = useState<GeminiChatModel>(settings.chatModel);
  const [characterName, setCharacterName] = useState(settings.characterName);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [characterScale, setCharacterScale] = useState(settings.characterScale);
  const [walkEnabled, setWalkEnabled] = useState(settings.walkEnabled);
  const [autoSaveScreenshots, setAutoSaveScreenshots] = useState(settings.autoSaveScreenshots);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setApiKey(settings.apiKey);
    setChatModel(settings.chatModel);
    setCharacterName(settings.characterName);
    setSystemPrompt(settings.systemPrompt);
    setCharacterScale(settings.characterScale);
    setWalkEnabled(settings.walkEnabled);
    setAutoSaveScreenshots(settings.autoSaveScreenshots);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings({
      apiKey: apiKey.trim(),
      chatModel,
      characterName: characterName.trim() || 'Mochi',
      systemPrompt: systemPrompt.trim(),
      characterScale,
      walkEnabled,
      autoSaveScreenshots,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  return (
    <form className="scroll-area" onSubmit={handleSave}>
      <div className="card">
        <div className="row-between">
          <span className="section-label">Google Gemini API</span>
          <span className={`status-badge ${settings.effectiveApiKeyConfigured ? '' : 'missing'}`}>
            {settings.effectiveApiKeyConfigured
              ? settings.apiKey
                ? 'Key Saved Locally'
                : 'Using .env Key'
              : 'Key Needed'}
          </span>
        </div>

        <div className="field">
          <label htmlFor="gemini-key">API Key (stored locally on this PC only)</label>
          <div className="input-row">
            <input
              id="gemini-key"
              type={showKey ? 'text' : 'password'}
              className="text-input"
              placeholder={
                settings.hasEnvApiKey
                  ? 'Using GEMINI_API_KEY from .env (paste here to override)'
                  : 'Paste key from aistudio.google.com/apikey'
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowKey((prev) => !prev)}
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="chat-model">Chat &amp; Vision Model</label>
          <select
            id="chat-model"
            className="select-input"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value as GeminiChatModel)}
          >
            <option value="gemini-3.8-flash">gemini-3.8-flash (Recommended — fast &amp; smart)</option>
            <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Ultra-fast, lowest cost)</option>
            <option value="gemini-4-argon">gemini-4-argon (Deeper reasoning)</option>
          </select>
        </div>
      </div>

      <div className="card">
        <span className="section-label">Character Identity</span>

        <div className="field">
          <label htmlFor="char-name">Character Name</label>
          <input
            id="char-name"
            type="text"
            className="text-input"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="char-prompt">Personality / System Prompt</label>
          <textarea
            id="char-prompt"
            className="textarea-input"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="row-between">
            <label htmlFor="char-scale">Character Size</label>
            <span className="muted-meta">{Math.round(characterScale * 100)}%</span>
          </div>
          <input
            id="char-scale"
            type="range"
            min={0.65}
            max={1.35}
            step={0.05}
            value={characterScale}
            onChange={(e) => setCharacterScale(Number(e.target.value))}
          />
        </div>

        <label className="checkbox-row" htmlFor="char-walk">
          <input
            id="char-walk"
            type="checkbox"
            checked={walkEnabled}
            onChange={(e) => setWalkEnabled(e.target.checked)}
          />
          <span>Let pixel cat walk around screen</span>
        </label>

        <label className="checkbox-row" htmlFor="auto-save-shots">
          <input
            id="auto-save-shots"
            type="checkbox"
            checked={autoSaveScreenshots}
            onChange={(e) => setAutoSaveScreenshots(e.target.checked)}
          />
          <span>Auto-save screenshots to Downloads</span>
        </label>

        <button type="submit" className="primary-btn">
          <Save size={14} />
          {savedNotice ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="card">
        <div className="row-between">
          <span className="section-label">Custom PNGTuber Sprites</span>
          <button
            type="button"
            className="mini-link-btn"
            onClick={() => void onResetSprites()}
            title="Restore built-in Mochi mascot"
          >
            <RotateCcw size={12} />
            Reset Default
          </button>
        </div>
        <div className="muted-meta">
          Click any state to pick your own transparent PNG, GIF, or WebP character image.
        </div>

        <div className="sprite-grid">
          {SPRITE_SLOTS.map(({ key, label }) => {
            const thumb = settings.spriteDataUrls[key];
            return (
              <button
                key={key}
                type="button"
                className="sprite-slot"
                onClick={() => void onPickSprite(key)}
              >
                {thumb ? (
                  <img src={thumb} alt={label} className="sprite-thumb" />
                ) : (
                  <div
                    className="sprite-thumb"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <ImagePlus size={18} />
                  </div>
                )}
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </form>
  );
};
