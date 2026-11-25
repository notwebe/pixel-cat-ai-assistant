import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Mic, Settings, X } from 'lucide-react';
import { CharacterAvatar } from './components/CharacterAvatar';
import { ChatTab } from './components/ChatTab';
import { SettingsTab } from './components/SettingsTab';
import { TranscribeTab } from './components/TranscribeTab';
import {
  DEFAULT_ORCAROUTER_BASE_URL,
  DEFAULT_ORCAROUTER_MODEL,
  type CharacterState,
  type ChatHistoryTurn,
  type ChatMessage,
  type ScreenshotAttachment,
  type SettingsPatch,
  type SettingsView,
  type SpriteStateKey,
  type TranscriptEntry,
  type TranscriptionMode,
} from './types';
import { MicAudioRecorder, type RecordedAudio } from './utils/audioRecorder';
import { computeWalkBounds, pickNextWalkTarget, stepWalkPosition } from './utils/catWalker';

type ActiveTab = 'chat' | 'transcribe' | 'settings';

const MAX_AUDIO_FILE_BYTES = 50 * 1024 * 1024;

function buildChatHistoryTurns(msgs: ChatMessage[]): ChatHistoryTurn[] {
  return msgs
    .filter((m) => !m.isError && m.text.trim().length > 0)
    .slice(-20)
    .map((m) => ({ role: m.role, text: m.text }));
}

const INITIAL_SETTINGS: SettingsView = {
  aiProvider: 'gemini',
  apiKey: '',
  chatModel: 'gemini-3.8-flash',
  orcaRouterApiKey: '',
  orcaRouterModel: DEFAULT_ORCAROUTER_MODEL,
  orcaRouterBaseUrl: DEFAULT_ORCAROUTER_BASE_URL,
  characterName: 'Mochi',
  systemPrompt: '',
  characterScale: 1,
  ttsEnabled: false,
  walkEnabled: true,
  autoSaveScreenshots: true,
  openAtLogin: false,
  transcriptionMode: 'smart',
  sprites: {},
  hasSavedApiKey: false,
  hasEnvApiKey: false,
  hasSavedOrcaRouterApiKey: false,
  hasEnvOrcaRouterApiKey: false,
  orcaRouterApiKeyConfigured: false,
  effectiveApiKeyConfigured: false,
  isPackaged: false,
  spriteDataUrls: {},
};

export const App: React.FC = () => {
  const [settings, setSettings] = useState<SettingsView>(INITIAL_SETTINGS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
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
  const [failedRecording, setFailedRecording] = useState<RecordedAudio | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const recorderRef = useRef<MicAudioRecorder | null>(null);
  const activeRequestRef = useRef<{ requestId: string; messageId: string; buffer: string } | null>(
    null,
  );
  const draggingRef = useRef(false);
  const panelOpenRef = useRef(panelOpen);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastIgnoredRef = useRef<boolean | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const ttsEnabledRef = useRef(settings.ttsEnabled);
  const facingRef = useRef<'left' | 'right'>(facing);
  const skipNextHistorySaveRef = useRef(true);

  useEffect(() => {
    ttsEnabledRef.current = settings.ttsEnabled;
  }, [settings.ttsEnabled]);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  const applyIgnoreMouseEvents = useCallback((ignore: boolean) => {
    if (lastIgnoredRef.current !== ignore) {
      lastIgnoredRef.current = ignore;
      window.assistantAPI.setIgnoreMouseEvents(ignore);
    }
  }, []);

  const syncClickThrough = useCallback(() => {
    if (draggingRef.current) {
      applyIgnoreMouseEvents(false);
      return;
    }
    const pt = lastPointerPosRef.current;
    if (pt) {
      const el = document.elementFromPoint(pt.x, pt.y);
      const overInteractive = Boolean(el?.closest('[data-interactive="true"]'));
      applyIgnoreMouseEvents(!overInteractive);
      return;
    }
    const hoveredInteractive = Boolean(document.querySelector('[data-interactive="true"]:hover'));
    applyIgnoreMouseEvents(!hoveredInteractive);
  }, [applyIgnoreMouseEvents]);

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
        setCharacterState((prev) => (prev === 'speaking' ? 'idle' : prev));
        setStatusLabel((prev) => (prev === 'Speaking...' ? null : prev));
      };
      utterance.onerror = () => {
        setCharacterState((prev) => (prev === 'speaking' ? 'idle' : prev));
        setStatusLabel((prev) => (prev === 'Speaking...' ? null : prev));
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore TTS runtime errors
    }
  }, []);

  // Load persisted settings and chat/transcript history on mount
  useEffect(() => {
    let active = true;
    void window.assistantAPI
      .getSettings()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch(() => {
        // Keep defaults on settings load failure
      });

    void window.assistantAPI
      .loadHistory()
      .then((history) => {
        if (!active) return;
        skipNextHistorySaveRef.current = true;
        setMessages((prev) =>
          prev.length === 0 && Array.isArray(history.messages) ? history.messages : prev,
        );
        setTranscripts((prev) =>
          prev.length === 0 && Array.isArray(history.transcripts) ? history.transcripts : prev,
        );
        setLastInteractionId((prev) => prev ?? history.lastInteractionId ?? null);
      })
      .catch(() => {
        // Ignore corrupt/missing persisted history
      })
      .finally(() => {
        if (active) setHistoryLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // Persist history whenever chat/transcripts update outside active streaming
  useEffect(() => {
    if (!historyLoaded || isStreaming) return;
    if (skipNextHistorySaveRef.current) {
      skipNextHistorySaveRef.current = false;
      return;
    }
    void window.assistantAPI
      .saveHistory({
        messages,
        transcripts,
        lastInteractionId,
      })
      .catch(() => {
        // Ignore transient disk persistence errors
      });
  }, [historyLoaded, isStreaming, messages, transcripts, lastInteractionId]);

  // Expand window before mounting panel contents (opening), unmount contents before collapsing (closing)
  useEffect(() => {
    let cancelled = false;
    if (panelOpen) {
      applyIgnoreMouseEvents(false);
      void window.assistantAPI
        .setPanelMode(true)
        .catch(() => {})
        .finally(() => {
          if (!cancelled) {
            setPanelMounted(true);
          }
        });
    } else {
      setPanelMounted(false);
    }
    return () => {
      cancelled = true;
    };
  }, [panelOpen, applyIgnoreMouseEvents]);

  useEffect(() => {
    if (panelOpen || panelMounted) return;
    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      void window.assistantAPI
        .setPanelMode(false)
        .catch(() => {})
        .finally(() => {
          if (!cancelled) {
            window.requestAnimationFrame(() => {
              if (!cancelled) {
                syncClickThrough();
              }
            });
          }
        });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, [panelOpen, panelMounted, syncClickThrough]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
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
          const step = stepWalkPosition(pos, target, 2.6, facingRef.current);
          pos = { x: step.x, y: step.y };
          facingRef.current = step.facing;
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
    applyIgnoreMouseEvents(true);

    const handleMouseMove = (e: MouseEvent) => {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      syncClickThrough();
    };

    const handleDocumentMouseLeave = () => {
      lastPointerPosRef.current = null;
      if (!draggingRef.current && !panelOpenRef.current) {
        applyIgnoreMouseEvents(true);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.documentElement.addEventListener('mouseleave', handleDocumentMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.documentElement.removeEventListener('mouseleave', handleDocumentMouseLeave);
    };
  }, [applyIgnoreMouseEvents, syncClickThrough]);

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
        const messageId = active.messageId;
        activeRequestRef.current = null;
        setIsStreaming(false);
        if (event.interactionId) {
          setLastInteractionId(event.interactionId);
        }
        if (!finalText.trim()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, text: 'No response was returned by the model.', isError: true }
                : m,
            ),
          );
          flashStatus('Empty response', 'error', 2200);
        } else if (ttsEnabledRef.current) {
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
    });

    const offShot = window.assistantAPI.onScreenshotCaptured((shot) => {
      setPendingShot(shot);
      setActiveTab('chat');
      setPanelOpen(true);
      flashStatus(
        shot.savedPath
          ? 'Saved to Downloads!'
          : shot.saveWarning
            ? 'Screenshot ready (auto-save skipped)'
            : 'Screenshot ready!',
        'happy',
        2200,
      );
    });

    return () => {
      offToggle();
      offShot();
    };
  }, [flashStatus]);

  const handleSaveSettings = async (patch: SettingsPatch) => {
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

  const handleClearSprite = async (state: SpriteStateKey) => {
    const updated = await window.assistantAPI.clearSpriteImage(state);
    setSettings(updated);
    flashStatus(`Cleared ${state} sprite`, 'idle', 1600);
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
      flashStatus(
        shot.savedPath
          ? 'Saved to Downloads!'
          : shot.saveWarning
            ? 'Screenshot ready (auto-save skipped)'
            : 'Screenshot ready!',
        'happy',
        2000,
      );
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

  const handleAttachPastedImage = (shot: ScreenshotAttachment) => {
    setPendingShot(shot);
    flashStatus('Attached pasted image', 'happy', 1600);
  };

  const startChatRequest = async (
    assistantMsgId: string,
    prompt: string,
    imageBase64?: string,
    imageMimeType?: string,
    history?: ChatHistoryTurn[],
  ) => {
    const requestId = crypto.randomUUID();
    setIsStreaming(true);
    setCharacterState('thinking');
    setStatusLabel('Thinking...');

    activeRequestRef.current = {
      requestId,
      messageId: assistantMsgId,
      buffer: '',
    };

    try {
      await window.assistantAPI.sendChat({
        requestId,
        prompt,
        imageBase64,
        imageMimeType,
        previousInteractionId: lastInteractionId,
        history,
      });
    } catch (err) {
      if (activeRequestRef.current?.requestId !== requestId) return;
      activeRequestRef.current = null;
      setIsStreaming(false);
      const errText = err instanceof Error ? err.message : 'Failed to start chat request.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, text: errText, isError: true } : m,
        ),
      );
      flashStatus('Oops!', 'error', 2600);
    }
  };

  const handleSendChat = async (promptText: string) => {
    if (isStreaming) return;
    const shotToSend = pendingShot;
    const effectivePrompt =
      promptText || (shotToSend ? 'Please explain what is shown in this screenshot.' : '');
    if (!effectivePrompt) return;

    const history = buildChatHistoryTurns(messages);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: effectivePrompt,
      imageDataUrl: shotToSend?.dataUrl,
      timestamp: Date.now(),
    };

    const assistantMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantMsgId, role: 'assistant', text: '', timestamp: Date.now() },
    ]);
    setDraftPrompt('');
    setPendingShot(null);

    await startChatRequest(
      assistantMsgId,
      effectivePrompt,
      shotToSend?.base64,
      shotToSend ? 'image/png' : undefined,
      history,
    );
  };

  const handleCancelStream = async () => {
    const active = activeRequestRef.current;
    if (!active) return;
    activeRequestRef.current = null;
    setIsStreaming(false);
    try {
      await window.assistantAPI.cancelChat(active.requestId);
    } catch {
      // Ignore cancellation errors
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === active.messageId
          ? m.text
            ? m
            : { ...m, text: 'Generation stopped.', isError: false }
          : m,
      ),
    );
    flashStatus('Stopped', 'idle', 1400);
  };

  const handleRetryMessage = async (errorMsgId: string) => {
    if (isStreaming) return;
    const errorIndex = messages.findIndex((m) => m.id === errorMsgId);
    if (errorIndex === -1) return;

    let prevUserIndex = -1;
    for (let i = errorIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        prevUserIndex = i;
        break;
      }
    }
    if (prevUserIndex === -1) return;
    const prevUser = messages[prevUserIndex];
    const history = buildChatHistoryTurns(messages.slice(0, prevUserIndex));

    let imageBase64: string | undefined;
    let imageMimeType: string | undefined;
    if (prevUser.imageDataUrl) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(prevUser.imageDataUrl);
      if (match) {
        imageMimeType = match[1];
        imageBase64 = match[2];
      }
    }

    const newAssistantId = crypto.randomUUID();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === errorMsgId
          ? { id: newAssistantId, role: 'assistant', text: '', timestamp: Date.now(), isError: false }
          : m,
      ),
    );

    await startChatRequest(newAssistantId, prevUser.text, imageBase64, imageMimeType, history);
  };

  const handleToggleRecording = async () => {
    if (isTranscribing) return;
    setTranscribeError(null);

    if (!isRecording) {
      setFailedRecording(null);
      try {
        const recorder = new MicAudioRecorder();
        recorderRef.current = recorder;
        await recorder.start((level) => setAudioLevel(level));
        setIsRecording(true);
        setCharacterState('listening');
        setStatusLabel('Listening...');
      } catch (err) {
        recorderRef.current = null;
        const msg =
          err instanceof Error
            ? err.message
            : 'Could not access microphone. Check Windows mic permissions.';
        setTranscribeError(msg);
        setActiveTab('transcribe');
        setPanelOpen(true);
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

    let recorded: RecordedAudio | null = null;
    try {
      recorded = await recorder.stop();
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
      setFailedRecording(null);
      setTranscripts((prev) => [entry, ...prev]);
      setActiveTab('transcribe');
      setPanelOpen(true);
      flashStatus('Transcript ready!', 'happy', 2200);
    } catch (err) {
      if (recorded) {
        setFailedRecording(recorded);
      }
      const msg = err instanceof Error ? err.message : 'Transcription failed.';
      setTranscribeError(msg);
      setActiveTab('transcribe');
      setPanelOpen(true);
      flashStatus('Transcribe failed', 'error', 2800);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCancelRecording = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setIsRecording(false);
    setAudioLevel(0);
    setTranscribeError(null);
    if (recorder) {
      recorder.cancel();
    }
    flashStatus('Recording discarded', 'idle', 1400);
  };

  const handleRetryTranscribe = async () => {
    if (!failedRecording || isTranscribing || isRecording) return;
    setTranscribeError(null);
    try {
      setIsTranscribing(true);
      setCharacterState('thinking');
      setStatusLabel('Retrying transcription...');

      const result = await window.assistantAPI.transcribeAudio({
        audioBase64: failedRecording.base64,
        mimeType: failedRecording.mimeType,
        mode: settings.transcriptionMode,
      });

      const entry: TranscriptEntry = {
        id: crypto.randomUUID(),
        text: result.text,
        sourceName: result.sourceName,
        mode: result.mode,
        createdAt: Date.now(),
      };
      setFailedRecording(null);
      setTranscripts((prev) => [entry, ...prev]);
      flashStatus('Transcript ready!', 'happy', 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed.';
      setTranscribeError(msg);
      flashStatus('Transcribe failed', 'error', 2800);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleTranscribeFile = async () => {
    if (isTranscribing || isRecording) return;
    setTranscribeError(null);
    setFailedRecording(null);
    const picked = await window.assistantAPI.pickAudioFile();
    if (!picked) return;

    if (picked.sizeBytes > MAX_AUDIO_FILE_BYTES) {
      const sizeMb = (picked.sizeBytes / (1024 * 1024)).toFixed(1);
      setTranscribeError(`Audio file is too large (${sizeMb} MB). Maximum supported size is 50 MB.`);
      flashStatus('File too large', 'error', 2600);
      return;
    }

    try {
      setIsTranscribing(true);
      setCharacterState('thinking');
      setStatusLabel('Transcribing file...');

      const result = await window.assistantAPI.transcribeAudio({
        fileToken: picked.token,
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

  const handleDeleteTranscript = (id: string) => {
    setTranscripts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleSendTranscriptToChat = (transcriptText: string) => {
    setDraftPrompt(
      `Please summarize and highlight action items from this transcript:\n\n${transcriptText}`,
    );
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

  const handleHoverChange = useCallback(
    (hovered: boolean) => {
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
          window.requestAnimationFrame(() => {
            if (!draggingRef.current && !panelOpenRef.current) {
              syncClickThrough();
            }
          });
        }, 260);
      }
    },
    [syncClickThrough],
  );

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
      {panelMounted && (
        <section className="assistant-panel" data-interactive="true">
          <header className="panel-header">
            <div className="panel-brand">
              <span className={`brand-dot ${characterState}`} />
              <span className="panel-title">{settings.characterName}</span>
            </div>

            <nav className="panel-tabs" aria-label="Assistant views">
              <button
                type="button"
                className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                <MessageSquare size={13} />
                Chat
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'transcribe' ? 'active' : ''}`}
                onClick={() => setActiveTab('transcribe')}
              >
                <Mic size={13} />
                Transcribe
                {isRecording && <span className="tab-rec-dot" aria-label="Recording active" />}
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                <Settings size={13} />
                Settings
              </button>
            </nav>

            <button
              type="button"
              className="icon-btn"
              title="Minimize to character"
              aria-label="Minimize to character"
              onClick={() => setPanelOpen(false)}
            >
              <X size={15} />
            </button>
          </header>

          {!settings.effectiveApiKeyConfigured && activeTab !== 'settings' && (
            <div className="warning-banner">
              <span>
                Add your {settings.aiProvider === 'orcarouter' ? 'OrcaRouter' : 'free Gemini'} API
                key to start chatting &amp; transcribing.
              </span>
              <button type="button" onClick={() => setActiveTab('settings')}>
                Open Settings
              </button>
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
                onCancelStream={() => void handleCancelStream()}
                onRetryMessage={(id) => void handleRetryMessage(id)}
                onAttachImage={handleAttachPastedImage}
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
                canRetry={Boolean(failedRecording)}
                onModeChange={handleModeChange}
                onToggleRecord={() => void handleToggleRecording()}
                onCancelRecord={handleCancelRecording}
                onTranscribeFile={() => void handleTranscribeFile()}
                onRetryTranscribe={() => void handleRetryTranscribe()}
                onSendToChat={handleSendTranscriptToChat}
                onDeleteTranscript={handleDeleteTranscript}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsTab
                settings={settings}
                onSaveSettings={handleSaveSettings}
                onPickSprite={handlePickSprite}
                onClearSprite={handleClearSprite}
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
        optionsPinned={optionsPinned}
        isRecording={isRecording}
        isTranscribing={isTranscribing}
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
            applyIgnoreMouseEvents(false);
          } else {
            syncClickThrough();
          }
        }}
      />
    </div>
  );
};
