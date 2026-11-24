import { contextBridge, ipcRenderer } from 'electron';
import type {
  AssistantBridgeAPI,
  AssistantSettings,
  ChatStreamEvent,
  CropRect,
  ScreenshotAttachment,
  SendChatRequest,
  SpriteStateKey,
  TranscribeRequest,
} from '../src/types';

const api: AssistantBridgeAPI = {
  // Settings & sprites
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Partial<AssistantSettings>) =>
    ipcRenderer.invoke('settings:save', patch),
  pickSpriteImage: (state: SpriteStateKey) =>
    ipcRenderer.invoke('sprites:pick', state),
  resetSprites: () => ipcRenderer.invoke('sprites:reset'),

  // Chat & Vision
  sendChat: (req: SendChatRequest) => ipcRenderer.invoke('chat:send', req),
  onChatStream: (callback: (event: ChatStreamEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamEvent) => {
      callback(payload);
    };
    ipcRenderer.on('chat:stream', listener);
    return () => ipcRenderer.removeListener('chat:stream', listener);
  },

  // Screenshots & Clipboard
  captureFullScreen: () => ipcRenderer.invoke('screen:captureFull'),
  startRegionCapture: () => ipcRenderer.invoke('screen:startRegion'),
  onScreenshotCaptured: (callback: (shot: ScreenshotAttachment) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, shot: ScreenshotAttachment) => {
      callback(shot);
    };
    ipcRenderer.on('screen:captured', listener);
    return () => ipcRenderer.removeListener('screen:captured', listener);
  },
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  // Transcription
  transcribeAudio: (req: TranscribeRequest) =>
    ipcRenderer.invoke('audio:transcribe', req),
  pickAudioFile: () => ipcRenderer.invoke('audio:pickFile'),
  saveTranscript: (content: string, defaultName: string) =>
    ipcRenderer.invoke('audio:saveTranscript', content, defaultName),

  // Window & Tray
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.send('window:setIgnoreMouseEvents', ignore),
  moveWindowBy: (dx: number, dy: number) =>
    ipcRenderer.send('window:moveBy', dx, dy),
  setWindowPosition: (x: number, y: number) =>
    ipcRenderer.send('window:setPosition', x, y),
  setPanelMode: (open: boolean) =>
    ipcRenderer.invoke('window:setPanelMode', open),
  getWindowWorkArea: () => ipcRenderer.invoke('window:getWorkArea'),
  resetWindowPosition: () => ipcRenderer.send('window:resetPosition'),
  onTogglePanel: (callback: (tab?: 'chat' | 'transcribe' | 'settings') => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      tab?: 'chat' | 'transcribe' | 'settings',
    ) => {
      callback(tab);
    };
    ipcRenderer.on('panel:toggle', listener);
    return () => ipcRenderer.removeListener('panel:toggle', listener);
  },

  // Snip overlay
  getSnipBackdrop: () => ipcRenderer.invoke('snip:getBackdrop'),
  completeSnip: (rect: CropRect) => ipcRenderer.invoke('snip:complete', rect),
  cancelSnip: () => ipcRenderer.invoke('snip:cancel'),
};

contextBridge.exposeInMainWorld('assistantAPI', api);
