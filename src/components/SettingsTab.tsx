import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ImagePlus, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react';
import {
  DEFAULT_ORCAROUTER_BASE_URL,
  DEFAULT_ORCAROUTER_MODEL,
  type AIProvider,
  type GeminiChatModel,
  type OrcaRouterModelOption,
  type SettingsPatch,
  type SettingsView,
  type SpriteStateKey,
} from '../types';

interface SettingsTabProps {
  settings: SettingsView;
  onSaveSettings: (patch: SettingsPatch) => Promise<void>;
  onPickSprite: (state: SpriteStateKey) => Promise<void>;
  onClearSprite: (state: SpriteStateKey) => Promise<void>;
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
  onClearSprite,
  onResetSprites,
}) => {
  const [aiProvider, setAiProvider] = useState<AIProvider>(settings.aiProvider);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [chatModel, setChatModel] = useState<GeminiChatModel>(settings.chatModel);

  const [orcaRouterApiKey, setOrcaRouterApiKey] = useState('');
  const [showOrcaKey, setShowOrcaKey] = useState(false);
  const [orcaRouterModel, setOrcaRouterModel] = useState(settings.orcaRouterModel);
  const [orcaRouterBaseUrl, setOrcaRouterBaseUrl] = useState(settings.orcaRouterBaseUrl);
  const [orcaModels, setOrcaModels] = useState<OrcaRouterModelOption[]>([]);
  const [loadingOrcaModels, setLoadingOrcaModels] = useState(false);
  const [orcaModelsNotice, setOrcaModelsNotice] = useState<string | null>(null);

  const [characterName, setCharacterName] = useState(settings.characterName);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [characterScale, setCharacterScale] = useState(settings.characterScale);
  const [walkEnabled, setWalkEnabled] = useState(settings.walkEnabled);
  const [autoSaveScreenshots, setAutoSaveScreenshots] = useState(settings.autoSaveScreenshots);
  const [openAtLogin, setOpenAtLogin] = useState(settings.openAtLogin);
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (dirtyRef.current) return;
    setAiProvider(settings.aiProvider);
    setChatModel(settings.chatModel);
    setOrcaRouterModel(settings.orcaRouterModel);
    setOrcaRouterBaseUrl(settings.orcaRouterBaseUrl);
    setCharacterName(settings.characterName);
    setSystemPrompt(settings.systemPrompt);
    setCharacterScale(settings.characterScale);
    setWalkEnabled(settings.walkEnabled);
    setAutoSaveScreenshots(settings.autoSaveScreenshots);
    setOpenAtLogin(settings.openAtLogin);
  }, [settings]);

  const markDirty = () => {
    dirtyRef.current = true;
    setDirty(true);
    setSaveError(null);
  };

  const showSavedFeedback = () => {
    setSavedNotice(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setSavedNotice(false);
      savedTimerRef.current = null;
    }, 1800);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const trimmedGeminiKey = apiKey.trim();
      const trimmedOrcaKey = orcaRouterApiKey.trim();
      const patch: SettingsPatch = {
        aiProvider,
        chatModel,
        orcaRouterModel: orcaRouterModel.trim() || DEFAULT_ORCAROUTER_MODEL,
        orcaRouterBaseUrl: orcaRouterBaseUrl.trim() || DEFAULT_ORCAROUTER_BASE_URL,
        characterName: characterName.trim() || 'Mochi',
        systemPrompt: systemPrompt.trim(),
        characterScale,
        walkEnabled,
        autoSaveScreenshots,
        openAtLogin,
        ...(trimmedGeminiKey ? { apiKey: trimmedGeminiKey } : {}),
        ...(trimmedOrcaKey ? { orcaRouterApiKey: trimmedOrcaKey } : {}),
      };
      dirtyRef.current = false;
      setDirty(false);
      await onSaveSettings(patch);
      setApiKey('');
      setShowKey(false);
      setOrcaRouterApiKey('');
      setShowOrcaKey(false);
      showSavedFeedback();
    } catch (err) {
      dirtyRef.current = true;
      setDirty(true);
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearSavedGeminiKey = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSaveSettings({ apiKey: null });
      setApiKey('');
      setShowKey(false);
      showSavedFeedback();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to clear saved Gemini key.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearSavedOrcaKey = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSaveSettings({ orcaRouterApiKey: null });
      setOrcaRouterApiKey('');
      setShowOrcaKey(false);
      showSavedFeedback();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to clear saved OrcaRouter key.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadOrcaModels = async () => {
    if (loadingOrcaModels) return;
    setLoadingOrcaModels(true);
    setOrcaModelsNotice(null);
    try {
      const models = await window.assistantAPI.listOrcaRouterModels({
        baseUrl: orcaRouterBaseUrl.trim() || DEFAULT_ORCAROUTER_BASE_URL,
        apiKey: orcaRouterApiKey.trim() || undefined,
      });
      setOrcaModels(models);
      setOrcaModelsNotice(
        models.length > 0
          ? `Loaded ${models.length} model${models.length === 1 ? '' : 's'}.`
          : 'No models returned by endpoint.',
      );
    } catch (err) {
      setOrcaModelsNotice(err instanceof Error ? err.message : 'Failed to load models.');
    } finally {
      setLoadingOrcaModels(false);
    }
  };

  const hasCustomSprites = Object.values(settings.spriteDataUrls).some(Boolean);
  const geminiConfigured = settings.hasSavedApiKey || settings.hasEnvApiKey;
  const activeConfigured =
    aiProvider === 'orcarouter' ? settings.orcaRouterApiKeyConfigured : geminiConfigured;

  return (
    <form className="scroll-area" onSubmit={handleSave}>
      <div className="card">
        <div className="row-between">
          <span className="section-label">AI Provider</span>
          <span className={`status-badge ${activeConfigured ? '' : 'missing'}`}>
            {aiProvider === 'orcarouter'
              ? settings.hasSavedOrcaRouterApiKey
                ? 'Key Saved Locally'
                : settings.hasEnvOrcaRouterApiKey
                  ? 'Using .env Key'
                  : 'Key Needed'
              : settings.hasSavedApiKey
                ? 'Key Saved Locally'
                : settings.hasEnvApiKey
                  ? 'Using .env Key'
                  : 'Key Needed'}
          </span>
        </div>

        <div className="field">
          <label htmlFor="ai-provider">Provider</label>
          <select
            id="ai-provider"
            className="select-input"
            value={aiProvider}
            onChange={(e) => {
              setAiProvider(e.target.value as AIProvider);
              setOrcaModelsNotice(null);
              markDirty();
            }}
          >
            <option value="gemini">Google Gemini (Built-in Vision &amp; Audio)</option>
            <option value="orcarouter">OrcaRouter (OpenAI-compatible API)</option>
          </select>
        </div>

        {aiProvider === 'gemini' ? (
          <>
            <div className="field">
              <label htmlFor="gemini-key">Gemini API Key (encrypted locally on this PC only)</label>
              <div className="input-row">
                <input
                  id="gemini-key"
                  type={showKey ? 'text' : 'password'}
                  className="text-input"
                  autoComplete="off"
                  placeholder={
                    settings.hasSavedApiKey
                      ? 'Saved locally (enter new key to replace)'
                      : settings.hasEnvApiKey
                        ? 'Using GEMINI_API_KEY from .env (paste here to override)'
                        : 'Paste key from aistudio.google.com/apikey'
                  }
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    markDirty();
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowKey((prev) => !prev)}
                  title={showKey ? 'Hide key' : 'Show key'}
                  aria-label={showKey ? 'Hide Gemini API key' : 'Show Gemini API key'}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {settings.hasSavedApiKey && (
                <div className="row-between" style={{ marginTop: 2 }}>
                  <span className="muted-meta">Key is hidden for security.</span>
                  <button
                    type="button"
                    className="mini-link-btn danger-link"
                    onClick={() => void handleClearSavedGeminiKey()}
                    disabled={isSaving}
                  >
                    <Trash2 size={12} />
                    Clear saved key
                  </button>
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="chat-model">Chat &amp; Vision Model</label>
              <select
                id="chat-model"
                className="select-input"
                value={chatModel}
                onChange={(e) => {
                  setChatModel(e.target.value as GeminiChatModel);
                  markDirty();
                }}
              >
                <option value="gemini-3.8-flash">gemini-3.8-flash (Recommended — fast &amp; smart)</option>
                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Ultra-fast, lowest cost)</option>
                <option value="gemini-4-argon">gemini-4-argon (Deeper reasoning)</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="orcarouter-key">
                OrcaRouter API Key (encrypted locally on this PC only)
              </label>
              <div className="input-row">
                <input
                  id="orcarouter-key"
                  type={showOrcaKey ? 'text' : 'password'}
                  className="text-input"
                  autoComplete="off"
                  placeholder={
                    settings.hasSavedOrcaRouterApiKey
                      ? 'Saved locally (enter new sk-orca-... key to replace)'
                      : settings.hasEnvOrcaRouterApiKey
                        ? 'Using ORCAROUTER_API_KEY from .env (paste here to override)'
                        : 'Paste sk-orca-... key'
                  }
                  value={orcaRouterApiKey}
                  onChange={(e) => {
                    setOrcaRouterApiKey(e.target.value);
                    markDirty();
                  }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowOrcaKey((prev) => !prev)}
                  title={showOrcaKey ? 'Hide key' : 'Show key'}
                  aria-label={showOrcaKey ? 'Hide OrcaRouter API key' : 'Show OrcaRouter API key'}
                >
                  {showOrcaKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {settings.hasSavedOrcaRouterApiKey && (
                <div className="row-between" style={{ marginTop: 2 }}>
                  <span className="muted-meta">Key is hidden for security.</span>
                  <button
                    type="button"
                    className="mini-link-btn danger-link"
                    onClick={() => void handleClearSavedOrcaKey()}
                    disabled={isSaving}
                  >
                    <Trash2 size={12} />
                    Clear saved key
                  </button>
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="orcarouter-model">Model ID</label>
              <div className="input-row">
                <input
                  id="orcarouter-model"
                  type="text"
                  list="orcarouter-models"
                  className="text-input"
                  placeholder={DEFAULT_ORCAROUTER_MODEL}
                  value={orcaRouterModel}
                  onChange={(e) => {
                    setOrcaRouterModel(e.target.value);
                    markDirty();
                  }}
                />
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ padding: '6px 10px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                  onClick={() => void handleLoadOrcaModels()}
                  disabled={loadingOrcaModels}
                  title="Fetch available models from OrcaRouter /models"
                >
                  <RefreshCw size={12} />
                  {loadingOrcaModels ? 'Loading...' : 'Load Models'}
                </button>
              </div>
              <datalist id="orcarouter-models">
                {orcaModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </datalist>
              {orcaModelsNotice && <span className="muted-meta">{orcaModelsNotice}</span>}
            </div>

            <div className="field">
              <label htmlFor="orcarouter-baseurl">Base URL (optional)</label>
              <input
                id="orcarouter-baseurl"
                type="url"
                className="text-input"
                placeholder={DEFAULT_ORCAROUTER_BASE_URL}
                value={orcaRouterBaseUrl}
                onChange={(e) => {
                  setOrcaRouterBaseUrl(e.target.value);
                  markDirty();
                }}
              />
            </div>

            <div className="muted-meta">
              {geminiConfigured
                ? 'Audio transcription will use your OrcaRouter model and fall back to your saved Gemini key if needed.'
                : 'Audio transcription works with audio-capable OrcaRouter models, or add a Gemini key as fallback.'}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="row-between">
          <span className="section-label">Character Identity</span>
          {dirty && <span className="unsaved-pill">Unsaved changes</span>}
        </div>

        <div className="field">
          <label htmlFor="char-name">Character Name</label>
          <input
            id="char-name"
            type="text"
            className="text-input"
            value={characterName}
            onChange={(e) => {
              setCharacterName(e.target.value);
              markDirty();
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="char-prompt">Personality / System Prompt</label>
          <textarea
            id="char-prompt"
            className="textarea-input"
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value);
              markDirty();
            }}
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
            onChange={(e) => {
              setCharacterScale(Number(e.target.value));
              markDirty();
            }}
          />
        </div>

        <label className="checkbox-row" htmlFor="char-walk">
          <input
            id="char-walk"
            type="checkbox"
            checked={walkEnabled}
            onChange={(e) => {
              setWalkEnabled(e.target.checked);
              markDirty();
            }}
          />
          <span>Let pixel cat walk around screen</span>
        </label>

        <label className="checkbox-row" htmlFor="auto-save-shots">
          <input
            id="auto-save-shots"
            type="checkbox"
            checked={autoSaveScreenshots}
            onChange={(e) => {
              setAutoSaveScreenshots(e.target.checked);
              markDirty();
            }}
          />
          <span>Auto-save screenshots to Downloads</span>
        </label>

        <label className="checkbox-row" htmlFor="open-at-login">
          <input
            id="open-at-login"
            type="checkbox"
            checked={openAtLogin}
            onChange={(e) => {
              setOpenAtLogin(e.target.checked);
              markDirty();
            }}
          />
          <span>Launch at Windows Startup</span>
        </label>
        {!settings.isPackaged && (
          <div className="muted-meta" style={{ marginTop: -4, paddingLeft: 22 }}>
            Takes effect when running the packaged .exe app.
          </div>
        )}

        {saveError && (
          <div className="message-bubble error" style={{ maxWidth: '100%' }}>
            {saveError}
          </div>
        )}

        <button type="submit" className="primary-btn" disabled={isSaving}>
          <Save size={14} />
          {isSaving ? 'Saving...' : savedNotice ? 'Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="card">
        <div className="row-between">
          <span className="section-label">Custom PNGTuber Sprites</span>
          <button
            type="button"
            className="mini-link-btn"
            onClick={() => void onResetSprites()}
            disabled={!hasCustomSprites}
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
              <div key={key} className="sprite-slot-wrap">
                <button
                  type="button"
                  className="sprite-slot"
                  onClick={() => void onPickSprite(key)}
                  aria-label={`Choose ${label} custom sprite`}
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
                {thumb && (
                  <button
                    type="button"
                    className="sprite-clear-btn"
                    onClick={() => void onClearSprite(key)}
                    title={`Remove ${label} sprite`}
                    aria-label={`Remove ${label} sprite`}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </form>
  );
};
