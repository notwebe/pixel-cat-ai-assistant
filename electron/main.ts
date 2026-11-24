import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import type {
  ChatHistoryTurn,
  ChatStreamEvent,
  CropRect,
  PersistedHistory,
  PickedAudioFile,
  SendChatRequest,
  SettingsPatch,
  SnipBackdropPayload,
  TranscribeRequest,
  WindowWorkAreaInfo,
} from '../src/types';
import { GeminiService } from './services/geminiService';
import { HistoryStore } from './services/historyStore';
import { AudioUnsupportedError, OrcaRouterService } from './services/orcaRouterService';
import {
  captureDisplayFrame,
  cropCapturedFrame,
  imageToAttachment,
  type CapturedScreenFrame,
} from './services/screenshotService';
import {
  isValidSpriteStateKey,
  SettingsStore,
  type SecretCipher,
} from './services/settingsStore';

const COMPACT_WIDTH = 176;
const COMPACT_HEIGHT = 152;
const EXPANDED_WIDTH = 460;
const EXPANDED_HEIGHT = 620;
const MAX_PICKED_AUDIO_TOKENS = 20;

let mainWindow: BrowserWindow | null = null;
let snipWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pendingSnipFrame: CapturedScreenFrame | null = null;
let isOpeningSnip = false;
let snipRestoresMainWindow = false;
let settingsStore: SettingsStore;
let historyStore: HistoryStore;
let isPanelExpanded = false;

const geminiService = new GeminiService();
const orcaRouterService = new OrcaRouterService();
const activeChatControllers = new Map<string, AbortController>();
const pickedAudioMap = new Map<string, { filePath: string; mimeType: string }>();
const hotkeyStatus: Record<string, boolean> = {};

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.m4a': 'audio/m4a',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.aiff': 'audio/aiff',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFromMainWindow(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function isFromSnipWindow(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return Boolean(snipWindow && !snipWindow.isDestroyed() && event.sender === snipWindow.webContents);
}

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
  if (!isFromMainWindow(event)) {
    throw new Error('Unauthorized IPC sender.');
  }
}

function assertSnipWindowSender(event: IpcMainInvokeEvent): void {
  if (!isFromSnipWindow(event)) {
    throw new Error('Unauthorized snip IPC sender.');
  }
}

function getTrustedDevServerOrigin(): string | null {
  if (app.isPackaged) {
    return null;
  }
  const raw = process.env.VITE_DEV_SERVER_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return parsed.origin;
    }
  } catch {
    // Ignore invalid dev server URL
  }
  return null;
}

function isAllowedNavigationUrl(targetUrl: string, page: 'index.html' | 'snip.html'): boolean {
  try {
    const parsed = new URL(targetUrl);
    const trustedDevOrigin = getTrustedDevServerOrigin();
    if (trustedDevOrigin) {
      return parsed.origin === trustedDevOrigin;
    }
    if (parsed.protocol === 'file:') {
      const expectedPath = path.resolve(__dirname, '../dist', page);
      const actualPath = path.resolve(fileURLToPath(parsed));
      return process.platform === 'win32'
        ? actualPath.toLowerCase() === expectedPath.toLowerCase()
        : actualPath === expectedPath;
    }
  } catch {
    return false;
  }
  return false;
}

function hardenWindowNavigation(win: BrowserWindow, page: 'index.html' | 'snip.html'): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigationUrl(targetUrl, page)) {
      event.preventDefault();
    }
  });
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function getTargetWindowSize(expanded = isPanelExpanded): { width: number; height: number } {
  return expanded
    ? { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT }
    : { width: COMPACT_WIDTH, height: COMPACT_HEIGHT };
}

function getDefaultWindowPosition(): { x: number; y: number } {
  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.workArea;
  const size = getTargetWindowSize();
  return {
    x: Math.round(x + width - size.width - 24),
    y: Math.round(y + height - size.height - 6),
  };
}

function clampWindowToNearestDisplay(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  });
  const { workArea } = display;
  const minX = workArea.x;
  const maxX = Math.max(minX, workArea.x + workArea.width - bounds.width);
  const minY = workArea.y;
  const maxY = Math.max(minY, workArea.y + workArea.height - bounds.height);
  const nextX = Math.max(minX, Math.min(bounds.x, maxX));
  const nextY = Math.max(minY, Math.min(bounds.y, maxY));
  if (nextX !== bounds.x || nextY !== bounds.y) {
    win.setPosition(Math.round(nextX), Math.round(nextY));
  }
}

function setPanelWindowMode(open: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (isPanelExpanded === open) return;

  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  });
  const { workArea } = display;
  const { width: targetW, height: targetH } = getTargetWindowSize(open);

  const rawX = bounds.x + bounds.width - targetW;
  const rawY = bounds.y + bounds.height - targetH;
  const minX = workArea.x;
  const maxX = Math.max(minX, workArea.x + workArea.width - targetW);
  const minY = workArea.y;
  const maxY = Math.max(minY, workArea.y + workArea.height - targetH);

  const nextX = Math.max(minX, Math.min(rawX, maxX));
  const nextY = Math.max(minY, Math.min(rawY, maxY));

  mainWindow.setResizable(true);
  mainWindow.setBounds({
    x: Math.round(nextX),
    y: Math.round(nextY),
    width: targetW,
    height: targetH,
  });
  mainWindow.setResizable(false);
  isPanelExpanded = open;
}

/**
 * Generates a crisp 16x16 RGBA PNG icon in-memory for the Windows System Tray
 * so the app never fails if external binary icon assets are missing.
 */
function createTrayIcon(): Electron.NativeImage {
  const size = 16;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cx = 7.5;
  const cy = 7.5;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 4);
    raw[rowOffset] = 0; // PNG filter type 0
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= 6.8) {
        // Soft indigo/violet Mochi orb
        const isEye = y === 7 && (x === 5 || x === 10);
        const isBlush = y === 9 && (x === 4 || x === 11);
        if (isEye) {
          raw[px] = 30;
          raw[px + 1] = 27;
          raw[px + 2] = 75;
          raw[px + 3] = 255;
        } else if (isBlush) {
          raw[px] = 244;
          raw[px + 1] = 114;
          raw[px + 2] = 182;
          raw[px + 3] = 255;
        } else {
          raw[px] = 165;
          raw[px + 1] = 180;
          raw[px + 2] = 252;
          raw[px + 3] = 255;
        }
      } else {
        raw[px + 3] = 0;
      }
    }
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = zlib.deflateSync(raw);

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(png);
}

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.cjs');
}

function loadRendererPage(win: BrowserWindow, page: 'index.html' | 'snip.html'): void {
  const trustedDevOrigin = getTrustedDevServerOrigin();
  if (trustedDevOrigin) {
    const target = page === 'index.html' ? `${trustedDevOrigin}/` : `${trustedDevOrigin}/${page}`;
    void win.loadURL(target);
  } else {
    void win.loadFile(path.join(__dirname, '../dist', page));
  }
}

function createMainWindow(): BrowserWindow {
  isPanelExpanded = false;
  const pos = getDefaultWindowPosition();

  const win = new BrowserWindow({
    width: COMPACT_WIDTH,
    height: COMPACT_HEIGHT,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = win;
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hardenWindowNavigation(win, 'index.html');
  loadRendererPage(win, 'index.html');

  win.on('closed', () => {
    for (const controller of activeChatControllers.values()) {
      controller.abort();
    }
    activeChatControllers.clear();
    if (mainWindow === win) {
      mainWindow = null;
    }
    isPanelExpanded = false;
  });

  return win;
}

function getAutoSaveDir(): string | undefined {
  return settingsStore.readRaw().autoSaveScreenshots ? app.getPath('downloads') : undefined;
}

async function performFullScreenCapture(): Promise<ReturnType<typeof imageToAttachment>> {
  const wasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  if (wasVisible) {
    mainWindow?.hide();
    await sleep(130);
  }

  try {
    const frame = await captureDisplayFrame();
    return imageToAttachment(frame.image, 'fullscreen', getAutoSaveDir());
  } finally {
    if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
    }
  }
}

async function openRegionSnipOverlay(): Promise<void> {
  if (isOpeningSnip) {
    return;
  }
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.focus();
    return;
  }

  isOpeningSnip = true;
  try {
    const wasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    if (wasVisible) {
      mainWindow?.hide();
      await sleep(130);
    }

    try {
      pendingSnipFrame = await captureDisplayFrame();
    } catch (err) {
      if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
      throw err;
    }

    snipRestoresMainWindow = wasVisible;
    const { bounds } = pendingSnipFrame.display;

    const overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: {
        preload: getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    snipWindow = overlay;
    overlay.setBounds(bounds);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    hardenWindowNavigation(overlay, 'snip.html');
    loadRendererPage(overlay, 'snip.html');
    overlay.focus();

    overlay.on('closed', () => {
      if (snipWindow === overlay) {
        snipWindow = null;
      }
      pendingSnipFrame = null;
      const shouldRestore = snipRestoresMainWindow;
      snipRestoresMainWindow = false;
      if (shouldRestore && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    });
  } finally {
    isOpeningSnip = false;
  }
}

function setupTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Mochi — Desktop AI Assistant');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Toggle Assistant Panel (Ctrl+Shift+Space)',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('panel:toggle', 'chat');
      },
    },
    { type: 'separator' },
    {
      label: 'Capture Full Screen (Ctrl+Shift+S)',
      click: async () => {
        try {
          const shot = await performFullScreenCapture();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('screen:captured', shot);
          }
        } catch (err) {
          console.error('Full screen capture failed:', err);
        }
      },
    },
    {
      label: 'Snip Screen Region (Ctrl+Shift+R)',
      click: () => {
        void openRegionSnipOverlay().catch((err) => {
          console.error('Region capture failed:', err);
        });
      },
    },
    {
      label: 'Open Audio Transcription',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('panel:toggle', 'transcribe');
      },
    },
    { type: 'separator' },
    {
      label: 'Reset Character Position',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const pos = getDefaultWindowPosition();
        mainWindow.setPosition(pos.x, pos.y);
        mainWindow.show();
      },
    },
    {
      label: 'Hide / Show Character',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('panel:toggle');
  });
}

function registerShortcuts(): void {
  hotkeyStatus['CommandOrControl+Shift+Space'] = globalShortcut.register(
    'CommandOrControl+Shift+Space',
    () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      mainWindow.webContents.send('panel:toggle');
    },
  );

  hotkeyStatus['CommandOrControl+Shift+S'] = globalShortcut.register(
    'CommandOrControl+Shift+S',
    async () => {
      try {
        const shot = await performFullScreenCapture();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('screen:captured', shot);
        }
      } catch (err) {
        console.error('Shortcut full-screen capture failed:', err);
      }
    },
  );

  hotkeyStatus['CommandOrControl+Shift+R'] = globalShortcut.register(
    'CommandOrControl+Shift+R',
    () => {
      void openRegionSnipOverlay().catch((err) => {
        console.error('Shortcut region capture failed:', err);
      });
    },
  );

  for (const [accelerator, registered] of Object.entries(hotkeyStatus)) {
    if (!registered) {
      console.warn(`Global hotkey could not be registered (conflict): ${accelerator}`);
    }
  }
}

function registerIpcHandlers(): void {
  // Settings & custom PNGTuber sprites
  ipcMain.handle('settings:get', (event) => {
    assertMainWindowSender(event);
    return settingsStore.getView();
  });

  ipcMain.handle('settings:save', (event, patch: unknown) => {
    assertMainWindowSender(event);
    if (!isPlainObject(patch)) {
      throw new Error('Invalid settings payload.');
    }
    return settingsStore.update(patch as SettingsPatch);
  });

  ipcMain.handle('sprites:pick', async (event, state: unknown) => {
    assertMainWindowSender(event);
    if (!isValidSpriteStateKey(state)) {
      throw new Error('Invalid sprite state.');
    }
    const result = await dialog.showOpenDialog({
      title: `Choose custom sprite for "${state}" state`,
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return settingsStore.saveSpriteFile(state, result.filePaths[0]);
  });

  ipcMain.handle('sprites:clear', (event, state: unknown) => {
    assertMainWindowSender(event);
    if (!isValidSpriteStateKey(state)) {
      throw new Error('Invalid sprite state.');
    }
    return settingsStore.clearSprite(state);
  });

  ipcMain.handle('sprites:reset', (event) => {
    assertMainWindowSender(event);
    return settingsStore.resetSprites();
  });

  ipcMain.handle('orcarouter:listModels', async (event, rawOverride: unknown) => {
    assertMainWindowSender(event);
    if (rawOverride !== undefined && !isPlainObject(rawOverride)) {
      throw new Error('Invalid OrcaRouter model query.');
    }
    const override = (rawOverride ?? {}) as { baseUrl?: unknown; apiKey?: unknown };
    const apiKeyOverride =
      typeof override.apiKey === 'string' ? override.apiKey.trim() : '';
    const baseUrlOverride =
      typeof override.baseUrl === 'string' ? override.baseUrl.trim() : '';

    const apiKey = apiKeyOverride || settingsStore.getEffectiveOrcaRouterApiKey();
    const baseUrl = baseUrlOverride || settingsStore.readRaw().orcaRouterBaseUrl;
    return orcaRouterService.listModels({ apiKey, baseUrl });
  });

  // Chat & Vision streaming
  ipcMain.handle('chat:send', async (event, rawReq: unknown) => {
    assertMainWindowSender(event);
    if (!isPlainObject(rawReq)) {
      throw new Error('Invalid chat request payload.');
    }

    const req = rawReq as Partial<SendChatRequest>;
    const requestId = typeof req.requestId === 'string' ? req.requestId.trim() : '';
    if (!requestId) {
      throw new Error('Chat requestId must be a non-empty string.');
    }
    if (typeof req.prompt !== 'string') {
      throw new Error('Chat prompt must be a string.');
    }
    if (req.imageBase64 !== undefined && typeof req.imageBase64 !== 'string') {
      throw new Error('Chat imageBase64 must be a string.');
    }
    if (req.imageMimeType !== undefined && typeof req.imageMimeType !== 'string') {
      throw new Error('Chat imageMimeType must be a string.');
    }
    if (
      req.previousInteractionId !== undefined &&
      req.previousInteractionId !== null &&
      typeof req.previousInteractionId !== 'string'
    ) {
      throw new Error('Chat previousInteractionId must be a string or null.');
    }
    if (req.history !== undefined && !Array.isArray(req.history)) {
      throw new Error('Chat history must be an array.');
    }

    const sanitizedHistory: ChatHistoryTurn[] = Array.isArray(req.history)
      ? req.history
          .filter(
            (turn): turn is ChatHistoryTurn =>
              isPlainObject(turn) &&
              (turn.role === 'user' || turn.role === 'assistant') &&
              typeof turn.text === 'string' &&
              turn.text.trim().length > 0,
          )
          .slice(-20)
      : [];

    activeChatControllers.get(requestId)?.abort();
    const controller = new AbortController();
    activeChatControllers.set(requestId, controller);

    const onSenderDestroyed = () => {
      controller.abort();
    };
    event.sender.once('destroyed', onSenderDestroyed);

    const settings = settingsStore.readRaw();

    const emit = (payload: ChatStreamEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:stream', payload);
      }
    };

    const onDelta = (chunk: string) => {
      if (event.sender.isDestroyed()) {
        controller.abort();
        return;
      }
      emit({ requestId, type: 'delta', text: chunk });
    };

    try {
      const result =
        settings.aiProvider === 'orcarouter'
          ? await orcaRouterService.streamChat(
              {
                apiKey: settingsStore.getEffectiveOrcaRouterApiKey(),
                model: settings.orcaRouterModel,
                baseUrl: settings.orcaRouterBaseUrl,
                systemPrompt: settings.systemPrompt,
                prompt: req.prompt,
                imageBase64: req.imageBase64,
                imageMimeType: req.imageMimeType,
                history: sanitizedHistory,
                signal: controller.signal,
              },
              { onDelta },
            )
          : await geminiService.streamChat(
              {
                apiKey: settingsStore.getEffectiveApiKey(),
                model: settings.chatModel,
                systemPrompt: settings.systemPrompt,
                prompt: req.prompt,
                imageBase64: req.imageBase64,
                imageMimeType: req.imageMimeType,
                previousInteractionId: req.previousInteractionId,
                signal: controller.signal,
              },
              { onDelta },
            );

      emit({
        requestId,
        type: 'done',
        interactionId: result.interactionId,
      });
    } catch (err) {
      if (!controller.signal.aborted && !event.sender.isDestroyed()) {
        emit({
          requestId,
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      if (!event.sender.isDestroyed()) {
        event.sender.removeListener('destroyed', onSenderDestroyed);
      }
      if (activeChatControllers.get(requestId) === controller) {
        activeChatControllers.delete(requestId);
      }
    }
  });

  ipcMain.handle('chat:cancel', (event, requestId: unknown) => {
    assertMainWindowSender(event);
    if (typeof requestId !== 'string' || !requestId.trim()) {
      throw new Error('Chat requestId must be a non-empty string.');
    }
    activeChatControllers.get(requestId.trim())?.abort();
  });

  // History persistence
  ipcMain.handle('history:load', (event) => {
    assertMainWindowSender(event);
    return historyStore.load();
  });

  ipcMain.handle('history:save', (event, history: unknown) => {
    assertMainWindowSender(event);
    if (!isPlainObject(history)) {
      throw new Error('Invalid history payload.');
    }
    historyStore.save(history as unknown as PersistedHistory);
  });

  // Screenshots & Clipboard
  ipcMain.handle('screen:captureFull', (event) => {
    assertMainWindowSender(event);
    return performFullScreenCapture();
  });

  ipcMain.handle('screen:startRegion', (event) => {
    assertMainWindowSender(event);
    return openRegionSnipOverlay();
  });

  ipcMain.handle('clipboard:read', (event) => {
    assertMainWindowSender(event);
    const text = clipboard.readText().trim();
    const img = clipboard.readImage();
    const image = img.isEmpty() ? undefined : imageToAttachment(img, 'clipboard');
    return { text, image };
  });

  // Audio transcription
  ipcMain.handle('audio:transcribe', async (event, rawReq: unknown) => {
    assertMainWindowSender(event);
    if (!isPlainObject(rawReq)) {
      throw new Error('Invalid transcription request.');
    }
    const req = rawReq as Partial<TranscribeRequest>;

    if (req.filePath !== undefined && req.filePath !== '') {
      throw new Error('Direct file paths are not allowed over IPC; pick an audio file first.');
    }
    if (req.mode !== 'smart' && req.mode !== 'verbatim') {
      throw new Error('Invalid transcription mode.');
    }
    if (typeof req.mimeType !== 'string' || !req.mimeType.trim()) {
      throw new Error('Audio mimeType must be a non-empty string.');
    }

    let resolvedFilePath: string | undefined;
    let resolvedMimeType = req.mimeType.trim();

    if (req.fileToken !== undefined) {
      if (typeof req.fileToken !== 'string' || !req.fileToken.trim()) {
        throw new Error('Invalid audio file token.');
      }
      const picked = pickedAudioMap.get(req.fileToken.trim());
      if (!picked) {
        throw new Error('Audio file token is invalid or expired. Please pick the file again.');
      }
      resolvedFilePath = picked.filePath;
      resolvedMimeType = picked.mimeType;
    } else if (typeof req.audioBase64 !== 'string' || !req.audioBase64) {
      throw new Error('No audio data or file token provided for transcription.');
    }

    const settings = settingsStore.readRaw();
    const geminiApiKey = settingsStore.getEffectiveApiKey();
    const audioInput = {
      audioBase64: resolvedFilePath ? undefined : req.audioBase64,
      filePath: resolvedFilePath,
      mimeType: resolvedMimeType,
      mode: req.mode,
    };

    let result: { text: string; sourceName: string };
    if (settings.aiProvider === 'orcarouter') {
      const orcaApiKey = settingsStore.getEffectiveOrcaRouterApiKey();
      if (!orcaApiKey && geminiApiKey) {
        result = await geminiService.transcribeAudio({
          apiKey: geminiApiKey,
          ...audioInput,
        });
      } else {
        try {
          result = await orcaRouterService.transcribeAudio({
            apiKey: orcaApiKey,
            model: settings.orcaRouterModel,
            baseUrl: settings.orcaRouterBaseUrl,
            ...audioInput,
          });
        } catch (err) {
          if (err instanceof AudioUnsupportedError && geminiApiKey) {
            result = await geminiService.transcribeAudio({
              apiKey: geminiApiKey,
              ...audioInput,
            });
          } else {
            throw err;
          }
        }
      }
    } else {
      result = await geminiService.transcribeAudio({
        apiKey: geminiApiKey,
        ...audioInput,
      });
    }

    return {
      text: result.text,
      sourceName: result.sourceName,
      mode: req.mode,
    };
  });

  ipcMain.handle('audio:pickFile', async (event): Promise<PickedAudioFile | null> => {
    assertMainWindowSender(event);
    const result = await dialog.showOpenDialog({
      title: 'Select an audio file to transcribe',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio Files',
          extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac', 'aac', 'aiff'],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const mimeType = AUDIO_MIME_BY_EXT[ext] ?? 'audio/mp3';
    const stats = await fs.promises.stat(filePath);

    if (pickedAudioMap.size >= MAX_PICKED_AUDIO_TOKENS) {
      const oldestToken = pickedAudioMap.keys().next().value;
      if (oldestToken) {
        pickedAudioMap.delete(oldestToken);
      }
    }

    const token = crypto.randomUUID();
    pickedAudioMap.set(token, { filePath, mimeType });

    return {
      token,
      filePath: fileName,
      fileName,
      mimeType,
      sizeBytes: stats.size,
    };
  });

  ipcMain.handle(
    'audio:saveTranscript',
    async (event, content: unknown, defaultName: unknown): Promise<string | null> => {
      assertMainWindowSender(event);
      if (typeof content !== 'string' || typeof defaultName !== 'string') {
        throw new Error('Invalid transcript save payload.');
      }
      const safeDefaultName = path.basename(defaultName.trim()) || 'transcript.txt';
      const result = await dialog.showSaveDialog({
        title: 'Save Transcript',
        defaultPath: safeDefaultName,
        filters: [
          { name: 'Text File', extensions: ['txt'] },
          { name: 'Markdown File', extensions: ['md'] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      await fs.promises.writeFile(result.filePath, content, 'utf-8');
      return result.filePath;
    },
  );

  // Window interaction helpers
  ipcMain.on('window:setIgnoreMouseEvents', (event, ignore: unknown) => {
    if (!isFromMainWindow(event) || typeof ignore !== 'boolean') return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.on('window:moveBy', (event, dx: unknown, dy: unknown) => {
    if (!isFromMainWindow(event)) return;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) {
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [curX, curY] = mainWindow.getPosition();
    mainWindow.setPosition(Math.round(curX + dx), Math.round(curY + dy));
  });

  ipcMain.on('window:setPosition', (event, x: unknown, y: unknown) => {
    if (!isFromMainWindow(event)) return;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.handle('window:setPanelMode', (event, open: unknown) => {
    assertMainWindowSender(event);
    setPanelWindowMode(Boolean(open));
  });

  ipcMain.handle('window:getWorkArea', (event): WindowWorkAreaInfo => {
    assertMainWindowSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) {
      const primary = screen.getPrimaryDisplay();
      return {
        workArea: primary.workArea,
        windowBounds: {
          x: primary.workArea.x,
          y: primary.workArea.y,
          width: COMPACT_WIDTH,
          height: COMPACT_HEIGHT,
        },
      };
    }
    const windowBounds = mainWindow.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: Math.round(windowBounds.x + windowBounds.width / 2),
      y: Math.round(windowBounds.y + windowBounds.height / 2),
    });
    return {
      workArea: display.workArea,
      windowBounds,
    };
  });

  ipcMain.handle('hotkeys:status', (event) => {
    assertMainWindowSender(event);
    return { ...hotkeyStatus };
  });

  ipcMain.on('window:resetPosition', (event) => {
    if (!isFromMainWindow(event)) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const pos = getDefaultWindowPosition();
    mainWindow.setPosition(pos.x, pos.y);
  });

  // Snip overlay IPC
  ipcMain.handle('snip:getBackdrop', (event): SnipBackdropPayload | null => {
    assertSnipWindowSender(event);
    if (!pendingSnipFrame) return null;
    return {
      dataUrl: pendingSnipFrame.dataUrl,
      displayWidth: pendingSnipFrame.display.bounds.width,
      displayHeight: pendingSnipFrame.display.bounds.height,
      scaleFactor: pendingSnipFrame.display.scaleFactor || 1,
    };
  });

  ipcMain.handle('snip:complete', (event, rawRect: unknown) => {
    assertSnipWindowSender(event);
    if (!isPlainObject(rawRect)) {
      throw new Error('Invalid crop rectangle.');
    }
    const { x, y, width, height } = rawRect as Partial<CropRect>;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      throw new Error('Crop rectangle coordinates must be finite numbers.');
    }

    const frame = pendingSnipFrame;
    pendingSnipFrame = null;

    const cropped = frame
      ? cropCapturedFrame(frame, { x, y, width, height }, getAutoSaveDir())
      : null;

    if (cropped) {
      snipRestoresMainWindow = false;
    }

    if (snipWindow && !snipWindow.isDestroyed()) {
      snipWindow.close();
    }

    if (cropped && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('screen:captured', cropped);
    }
  });

  ipcMain.handle('snip:cancel', (event) => {
    assertSnipWindowSender(event);
    pendingSnipFrame = null;
    if (snipWindow && !snipWindow.isDestroyed()) {
      snipWindow.close();
    } else if (snipRestoresMainWindow && mainWindow && !mainWindow.isDestroyed()) {
      snipRestoresMainWindow = false;
      mainWindow.show();
    }
  });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const userDataDir = app.getPath('userData');
    const secretCipher: SecretCipher | undefined = safeStorage.isEncryptionAvailable()
      ? {
          encrypt: (value: string) => safeStorage.encryptString(value).toString('base64'),
          decrypt: (value: string) => safeStorage.decryptString(Buffer.from(value, 'base64')),
        }
      : undefined;

    settingsStore = new SettingsStore(userDataDir, undefined, secretCipher);
    historyStore = new HistoryStore(userDataDir);

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const isMain = Boolean(
        mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents,
      );
      callback(isMain && permission === 'media');
    });

    registerIpcHandlers();
    mainWindow = createMainWindow();
    setupTray();
    registerShortcuts();

    screen.on('display-removed', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        clampWindowToNearestDisplay(mainWindow);
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });
}

app.on('will-quit', () => {
  for (const controller of activeChatControllers.values()) {
    controller.abort();
  }
  activeChatControllers.clear();
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
