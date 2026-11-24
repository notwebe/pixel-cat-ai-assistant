import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Mic, Settings, X } from 'lucide-react';
import { CharacterAvatar } from './components/CharacterAvatar';
import { ChatTab } from './components/ChatTab';
import { SettingsTab } from './components/SettingsTab';
import { TranscribeTab } from './components/TranscribeTab';
import type {
  AssistantSettings,
  CharacterState,
  ChatMessage,
  ScreenshotAttachment,
  SettingsView,
  SpriteStateKey,
  TranscriptEntry,
  TranscriptionMode,
} from './types';
import { MicAudioRecorder } from './utils/audioRecorder';
import { computeWalkBounds, pickNextWalkTarget, stepWalkPosition } from './utils/catWalker';

type ActiveTab = 'chat' | 'transcribe' | 'settings';

const INITIAL_SETTINGS: SettingsView = {
  apiKey: '',
  chatModel: 'gemini-3.8-flash',
  characterName: 'Mochi',
  systemPrompt: '',
  characterScale: 1,
  ttsEnabled: false,
  walkEnabled: true,
  autoSaveScreenshots: true,
  transcriptionMode: 'smart',
  sprites: {},
  hasEnvApiKey: false,
  effectiveApiKeyConfigured: false,
  spriteDataUrls: {},
};

export const App: React.FC = () => {
  const [settings, setSettings] = useState<SettingsView>(INITIAL_SETTINGS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');

  const [characterState, setCharacterState] = useState<CharacterState>('idle');
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Hover, options & pixel cat walking state
  const [isHovered, setIsHovered] = useState(false);
  const [optionsPinned, setOptionsPinned] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isWalking, setIsWalking] = useState(false);
  const [walkFrame, setWalkFrame] = useState<0 | 1>(0);
  const [facing, setFacing] = useState<'left' | 'right'>('right');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [pendingShot, setPendingShot] = useState<ScreenshotAttachment | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastInteractionId, setLastInteractionId] = useState<string | null>(null);

  // Transcription state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const recorderRef = useRef<MicAudioRecorder | null>(null);
  const activeRequestRef = useRef<{ requestId: string; messageId: string; buffer: string } | null>(
    null,
  );
  const draggingRef = useRef(false);
  const lastIgnoredRef = useRef<boolean | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const ttsEnabledRef = useRef(settings.ttsEnabled);

  useEffect(() => {
    ttsEnabledRef.current = settings.ttsEnabled;
  }, [settings.ttsEnabled]);

  const flashStatus = useCallback((label: string, state: CharacterState, durationMs = 2400) => {
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }
    setCharacterState(state);
    setStatusLabel(label);
    statusTimerRef.current = window.setTimeout(() => {
      setCharacterState('idle');
      setStatusLabel(null);
      statusTimerRef.current = null;
    }, durationMs);
  }, []);

  const speakText = useCallback((text: string) => {
    if (!ttsEnabledRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const cleaned = text.replace(/[#*`_~]/g, '').slice(0, 600);
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = 1.05;
      utterance.onstart = () => {
        setCharacterState('speaking');
        setStatusLabel('Speaking...');
      };
      utterance.onend = () => {
        setCharacterState('idle');
        setStatusLabel(null);
      };
      utterance.onerror = () => {
        setCharacterState('idle');
        setStatusLabel(null);
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore TTS runtime errors
    }
  }, []);

  // Load persisted settings on mount
  useEffect(() => {
    void window.assistantAPI.getSettings().then(setSettings);
  }, []);

  // Resize transparent window cleanly between compact cat mode and expanded panel mode
  useEffect(() => {
    void window.assistantAPI.setPanelMode(panelOpen);
  }, [panelOpen]);

  // Cleanup hover grace timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  // Autonomous pixel cat screen walking loop
  useEffect(() => {
    const canWalk =
      settings.walkEnabled &&
      !panelOpen &&
      !isHovered &&
      !optionsPinned &&
      !isDragging &&
      !isRecording &&
      !isStreaming &&
      !isTranscribing &&
      characterState === 'idle';

    if (!canWalk) {
      setIsWalking(false);
      return;
    }

    let cancelled = false;
    let pauseTimer: number | null = null;
    let stepInterval: number | null = null;

    const scheduleNextWalk = () => {
      if (cancelled) return;
      const delayMs = 2500 + Math.random() * 3000;
      pauseTimer = window.setTimeout(() => {
        void startWalkSegment();
      }, delayMs);
    };

    const startWalkSegment = async () => {
      if (cancelled) return;
      try {
        const info = await window.assistantAPI.getWindowWorkArea();
        if (cancelled) return;

        const bounds = computeWalkBounds(
          info.workArea,
          info.windowBounds.width,
          info.windowBounds.height,
        );
        let pos = { x: info.windowBounds.x, y: info.windowBounds.y };
        const target = pickNextWalkTarget(pos, bounds);

        if (Math.hypot(target.x - pos.x, target.y - pos.y) < 12) {
          scheduleNextWalk();
          return;
        }

        let ticks = 0;
        setIsWalking(true);

        stepInterval = window.setInterval(() => {
          if (cancelled) return;
          ticks += 1;
          const step = stepWalkPosition(pos, target, 2.6);
          pos = { x: step.x, y: step.y };
          setFacing(step.facing);
          if (ticks % 5 === 0) {
            setWalkFrame((prev) => (prev === 0 ? 1 : 0));
          }
          window.assistantAPI.setWindowPosition(step.x, step.y);

          if (step.arrived) {
            if (stepInterval !== null) {
              window.clearInterval(stepInterval);
              stepInterval = null;
            }
            setIsWalking(false);
            scheduleNextWalk();
          }
        }, 40);
      } catch {
        setIsWalking(false);
      }
    };

    scheduleNextWalk();

    return () => {
      cancelled = true;
      if (pauseTimer !== null) {
        window.clearTimeout(pauseTimer);
      }
      if (stepInterval !== null) {
        window.clearInterval(stepInterval);
      }
      setIsWalking(false);
    };
  }, [
    settings.walkEnabled,
    panelOpen,
    isHovered,
    optionsPinned,
    isDragging,
    isRecording,
    isStreaming,
    isTranscribing,
    characterState,
  ]);

  // Dynamic click-through on transparent window areas
  useEffect(() => {
    const updateClickThrough = (clientX: number, clientY: number) => {
      if (draggingRef.current) return;
      const el = document.elementFromPoint(clientX, clientY);
      const overInteractive = Boolean(el?.closest('[data-interactive="true"]'));
      const shouldIgnore = !overInteractive;
      if (lastIgnoredRef.current !== shouldIgnore) {
        lastIgnoredRef.current = shouldIgnore;
        window.assistantAPI.setIgnoreMouseEvents(shouldIgnore);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      updateClickThrough(e.clientX, e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Recording duration timer
  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const id = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  // Listen for streaming Gemini chat chunks
  useEffect(() => {
    return window.assistantAPI.onChatStream((event) => {
      const active = activeRequestRef.current;
      if (!active || active.requestId !== event.requestId) return;

      if (event.type === 'delta' && event.text) {
        active.buffer += event.text;
        const latest = active.buffer;
        setCharacterState('speaking');
        setStatusLabel('Responding...');
        setMessages((prev) =>
          prev.map((m) => (m.id === active.messageId ? { ...m, text: latest } : m)),
        );
      } else if (event.type === 'done') {
        const finalText = active.buffer;
        activeRequestRef.current = null;
        setIsStreaming(false);
        if (event.interactionId) {
          setLastInteractionId(event.interactionId);
        }
        if (ttsEnabledRef.current && finalText) {
          speakText(finalText);
        } else {
          flashStatus('Done!', 'happy', 1800);
        }
      } else if (event.type === 'error') {
        const errText = event.error || 'Something went wrong.';
        activeRequestRef.current = null;
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === active.messageId ? { ...m, text: errText, isError: true } : m,
          ),
        );
        flashStatus('Oops!', 'error', 2600);
      }
    });
  }, [flashStatus, speakText]);

  // Listen for global hotkey / tray events
  useEffect(() => {
    const offToggle = window.assistantAPI.onTogglePanel((tab) => {
      if (tab) {
        setActiveTab(tab);
        setPanelOpen(true);
      } else {
        setPanelOpen((prev) => !prev);
      }
      lastIgnoredRef.current = false;
      window.assistantAPI.setIgnoreMouseEvents(false);
    });

    const offShot = window.assistantAPI.onScreenshotCaptured((shot) => {
      setPendingShot(shot);
      setActiveTab('chat');
      setPanelOpen(true);
      lastIgnoredRef.current = false;
      window.assistantAPI.setIgnoreMouseEvents(false);
      flashStatus(shot.savedPath ? 'Saved to Downloads!' : 'Screenshot ready!', 'happy', 2200);
    });

    return () => {
      offToggle();
      offShot();
    };
  }, [flashStatus]);

  const handleSaveSettings = async (patch: Partial<AssistantSettings>) => {
    const updated = await window.assistantAPI.saveSettings(patch);
    setSettings(updated);
  };

  const handlePickSprite = async (state: SpriteStateKey) => {
    const updated = await window.assistantAPI.pickSpriteImage(state);
    if (updated) {
      setSettings(updated);
      flashStatus(`Updated ${state} sprite!`, 'happy', 1800);
    }
  };

  const handleResetSprites = async () => {
    const updated = await window.assistantAPI.resetSprites();
    setSettings(updated);
    flashStatus('Restored default mascot', 'happy', 1800);
  };

  const handleCaptureFullScreen = async () => {
    try {
      setStatusLabel('Capturing screen...');
      const shot = await window.assistantAPI.captureFullScreen();
      setPendingShot(shot);
      setActiveTab('chat');
      setPanelOpen(true);
      flashStatus(shot.savedPath ? 'Saved to Downloads!' : 'Screenshot ready!', 'happy', 2000);
    } catch (err) {
      flashStatus(err instanceof Error ? err.message : 'Capture failed', 'error', 3000);
    }
  };

  const handleStartRegionSnip = async () => {
    try {
      await window.assistantAPI.startRegionCapture();
    } catch (err) {
      flashStatus(err instanceof Error ? err.message : 'Snip failed', 'error', 3000);
    }
  };

  const handleAttachClipboard = async () => {
    const clip = await window.assistantAPI.readClipboard();
    if (clip.image) {
      setPendingShot(clip.image);
      flashStatus('Attached clipboard image', 'happy', 1800);
    } else if (clip.text) {
      setDraftPrompt((prev) =>
        prev ? `${prev}\n\n${clip.text}` : `Help me with this:\n\n${clip.text}`,
      );
      flashStatus('Pasted clipboard text', 'happy', 1500);
    } else {
      flashStatus('Clipboard is empty', 'idle', 1500);
    }
  };

  const handleSendChat = async (promptText: string) => {
    if (isStreaming) return;
    const shotToSend = pendingShot;
    const effectivePrompt =
      promptText || (shotToSend ? 'Please explain what is shown in this screenshot.' : '');
    if (!effectivePrompt) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: effectivePrompt,
      imageDataUrl: shotToSend?.dataUrl,
      timestamp: Date.now(),
    };

    const assistantMsgId = crypto.randomUUID();
    const requestId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantMsgId, role: 'assistant', text: '', timestamp: Date.now() },
    ]);
    setDraftPrompt('');
    setPendingShot(null);
    setIsStreaming(true);
    setCharacterState('thinking');
    setStatusLabel('Thinking...');

    activeRequestRef.current = {
      requestId,
      messageId: assistantMsgId,
      buffer: '',
    };

    await window.assistantAPI.sendChat({
      requestId,
      prompt: effectivePrompt,
      imageBase64: shotToSend?.base64,
      imageMimeType: shotToSend ? 'image/png' : undefined,
      previousInteractionId: lastInteractionId,
    });
  };

  const handleToggleRecording = async () => {
    setTranscribeError(null);
    if (!isRecording) {
      try {
        const recorder = new MicAudioRecorder();
        recorderRef.current = recorder;
        await recorder.start((level) => setAudioLevel(level));
        setIsRecording(true);
        setCharacterState('listening');
        setStatusLabel('Listening...');
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Could not access microphone. Check Windows mic permissions.';
        setTranscribeError(msg);
        flashStatus('Mic unavailable', 'error', 2600);
      }
      return;
    }

    // Stop recording and transcribe
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setIsRecording(false);
    setAudioLevel(0);

    if (!recorder) return;

    try {
      const recorded = await recorder.stop();
      setIsTranscribing(true);
      setCharacterState('thinking');
      setStatusLabel('Transcribing...');

      const result = await window.assistantAPI.transcribeAudio({
        audioBase64: recorded.base64,
        mimeType: recorded.mimeType,
        mode: settings.transcriptionMode,
      });

      const entry: TranscriptEntry = {
        id: crypto.randomUUID(),
        text: result.text,
        sourceName: result.sourceName,
        mode: result.mode,
        createdAt: Date.now(),
      };
      setTranscripts((prev) => [entry, ...prev]);
      setActiveTab('transcribe');
      setPanelOpen(true);
      flashStatus('Transcript ready!', 'happy', 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed.';
      setTranscribeError(msg);
      setActiveTab('transcribe');
      setPanelOpen(true);
      flashStatus('Transcribe failed', 'error', 2800);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleTranscribeFile = async () => {
    setTranscribeError(null);
    const picked = await window.assistantAPI.pickAudioFile();
    if (!picked) return;

    try {
      setIsTranscribing(true);
      setCharacterState('thinking');
      setStatusLabel('Transcribing file...');

      const result = await window.assistantAPI.transcribeAudio({
        filePath: picked.filePath,
        mimeType: picked.mimeType,
        mode: settings.transcriptionMode,
      });

      const entry: TranscriptEntry = {
        id: crypto.randomUUID(),
        text: result.text,
        sourceName: result.sourceName,
        mode: result.mode,
        createdAt: Date.now(),
      };
      setTranscripts((prev) => [entry, ...prev]);
      flashStatus('Transcript ready!', 'happy', 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'File transcription failed.';
      setTranscribeError(msg);
      flashStatus('Transcribe failed', 'error', 2800);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleSendTranscriptToChat = (transcriptText: string) => {
    setDraftPrompt(`Please summarize and highlight action items from this transcript:\n\n${transcriptText}`);
    setActiveTab('chat');
  };

  const handleModeChange = (mode: TranscriptionMode) => {
    void handleSaveSettings({ transcriptionMode: mode });
  };

  const handleClearChat = () => {
    setMessages([]);
    setLastInteractionId(null);
    setPendingShot(null);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleToggleTts = () => {
    const next = !settings.ttsEnabled;
    if (!next && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    void handleSaveSettings({ ttsEnabled: next });
  };

  const handleHoverChange = useCallback((hovered: boolean) => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (hovered) {
      setIsHovered(true);
    } else {
      hoverTimerRef.current = window.setTimeout(() => {
        setIsHovered(false);
        hoverTimerRef.current = null;
      }, 260);
    }
  }, []);

  const handleOpenChatOption = () => {
    setOptionsPinned(false);
    if (panelOpen && activeTab === 'chat') {
      setPanelOpen(false);
    } else {
      setActiveTab('chat');
      setPanelOpen(true);
    }
  };

  const handleOpenSettingsOption = () => {
    setOptionsPinned(false);
    if (panelOpen && activeTab === 'settings') {
      setPanelOpen(false);
    } else {
      setActiveTab('settings');
      setPanelOpen(true);
    }
  };

  const handleToggleWalkOption = () => {
    const next = !settings.walkEnabled;
    void handleSaveSettings({ walkEnabled: next });
    flashStatus(next ? 'Walking ON' : 'Paused', next ? 'happy' : 'idle', 1400);
  };

  const optionsVisible = isHovered || optionsPinned || panelOpen || isRecording;
  const displayedState: CharacterState =
    characterState === 'idle' && isWalking ? 'walking' : characterState;

  return (
    <div className="desktop-stage">
      {panelOpen && (
        <section className="assistant-panel" data-interactive="true">
          <header className="panel-header">
            <div className="panel-brand">
              <span className={`brand-dot ${characterState}`} />
              <span className="panel-title">{settings.characterName}</span>
            </div>

            <nav className="panel-tabs" aria-label="Assistant views">
              <button
                className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                <MessageSquare size={13} />
                Chat
              </button>
              <button
                className={`tab-btn ${activeTab === 'transcribe' ? 'active' : ''}`}
                onClick={() => setActiveTab('transcribe')}
              >
                <Mic size={13} />
                Transcribe
              </button>
              <button
                className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                <Settings size={13} />
                Settings
              </button>
            </nav>

            <button
              className="icon-btn"
              title="Minimize to character"
              onClick={() => setPanelOpen(false)}
            >
              <X size={15} />
            </button>
          </header>

          {!settings.effectiveApiKeyConfigured && activeTab !== 'settings' && (
            <div className="warning-banner">
              <span>Add your free Gemini API key to start chatting &amp; transcribing.</span>
              <button onClick={() => setActiveTab('settings')}>Open Settings</button>
            </div>
          )}

          <div className="panel-body">
            {activeTab === 'chat' && (
              <ChatTab
                characterName={settings.characterName}
                messages={messages}
                pendingShot={pendingShot}
                isStreaming={isStreaming}
                ttsEnabled={settings.ttsEnabled}
                draftPrompt={draftPrompt}
                onDraftChange={setDraftPrompt}
                onSend={(text) => void handleSendChat(text)}
                onCaptureFull={() => void handleCaptureFullScreen()}
                onStartSnip={() => void handleStartRegionSnip()}
                onAttachClipboard={() => void handleAttachClipboard()}
                onClearPendingShot={() => setPendingShot(null)}
                onClearChat={handleClearChat}
                onToggleTts={handleToggleTts}
              />
            )}

            {activeTab === 'transcribe' && (
              <TranscribeTab
                mode={settings.transcriptionMode}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                recordingSeconds={recordingSeconds}
                audioLevel={audioLevel}
                transcripts={transcripts}
                errorMessage={transcribeError}
                onModeChange={handleModeChange}
                onToggleRecord={() => void handleToggleRecording()}
                onTranscribeFile={() => void handleTranscribeFile()}
                onSendToChat={handleSendTranscriptToChat}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsTab
                settings={settings}
                onSaveSettings={handleSaveSettings}
                onPickSprite={handlePickSprite}
                onResetSprites={handleResetSprites}
              />
            )}
          </div>
        </section>
      )}

      <CharacterAvatar
        name={settings.characterName}
        state={displayedState}
        statusLabel={statusLabel}
        scale={settings.characterScale}
        audioLevel={audioLevel}
        customSprites={settings.spriteDataUrls}
        panelOpen={panelOpen}
        optionsVisible={optionsVisible}
        isRecording={isRecording}
        walkEnabled={settings.walkEnabled}
        facing={facing}
        walkFrame={walkFrame}
        onHoverChange={handleHoverChange}
        onToggleOptionsPin={() => setOptionsPinned((prev) => !prev)}
        onOpenChat={handleOpenChatOption}
        onOpenSettings={handleOpenSettingsOption}
        onQuickFullScreen={() => {
          setOptionsPinned(false);
          void handleCaptureFullScreen();
        }}
        onQuickSnip={() => {
          setOptionsPinned(false);
          void handleStartRegionSnip();
        }}
        onQuickMic={() => {
          setOptionsPinned(false);
          void handleToggleRecording();
        }}
        onToggleWalk={handleToggleWalkOption}
        onDragStateChange={(dragging) => {
          draggingRef.current = dragging;
          setIsDragging(dragging);
          if (dragging) {
            lastIgnoredRef.current = false;
            window.assistantAPI.setIgnoreMouseEvents(false);
          }
        }}
      />
    </div>
  );
};
