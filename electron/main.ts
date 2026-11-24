import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
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
  screen,
  Tray,
} from 'electron';
import type {
  AssistantSettings,
  ChatStreamEvent,
  CropRect,
  PickedAudioFile,
  SendChatRequest,
  SnipBackdropPayload,
  SpriteStateKey,
  TranscribeRequest,
  WindowWorkAreaInfo,
} from '../src/types';
import { GeminiService } from './services/geminiService';
import {
  captureDisplayFrame,
  cropCapturedFrame,
  imageToAttachment,
  type CapturedScreenFrame,
} from './services/screenshotService';
import { SettingsStore } from './services/settingsStore';

const COMPACT_WIDTH = 176;
const COMPACT_HEIGHT = 152;
const EXPANDED_WIDTH = 460;
const EXPANDED_HEIGHT = 620;

let mainWindow: BrowserWindow | null = null;
let snipWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pendingSnipFrame: CapturedScreenFrame | null = null;
let settingsStore: SettingsStore;
let isPanelExpanded = false;
const geminiService = new GeminiService();

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
        const isEye = (y === 7 && (x === 5 || x === 10));
        const isBlush = (y === 9 && (x === 4 || x === 11));
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
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const target = page === 'index.html' ? devUrl : `${devUrl.replace(/\/$/, '')}/${page}`;
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
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadRendererPage(win, 'index.html');

  win.on('closed', () => {
    mainWindow = null;
    isPanelExpanded = false;
  });

  return win;
}

function getAutoSaveDir(): string | undefined {
  return settingsStore.readRaw().autoSaveScreenshots ? app.getPath('downloads') : undefined;
}

async function performFullScreenCapture(): Promise<ReturnType<typeof imageToAttachment>> {
  const wasVisible = mainWindow?.isVisible() ?? false;
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
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.focus();
    return;
  }

  const wasVisible = mainWindow?.isVisible() ?? false;
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

  const { bounds } = pendingSnipFrame.display;

  snipWindow = new BrowserWindow({
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
      sandbox: false,
    },
  });

  snipWindow.setAlwaysOnTop(true, 'screen-saver');
  loadRendererPage(snipWindow, 'snip.html');

  snipWindow.on('closed', () => {
    snipWindow = null;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });
}

function setupTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Mochi — Desktop AI Assistant');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Toggle Assistant Panel (Ctrl+Shift+Space)',
      click: () => {
        if (!mainWindow) return;
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
          mainWindow?.show();
          mainWindow?.webContents.send('screen:captured', shot);
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
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('panel:toggle', 'transcribe');
      },
    },
    { type: 'separator' },
    {
      label: 'Reset Character Position',
      click: () => {
        if (!mainWindow) return;
        const pos = getDefaultWindowPosition();
        mainWindow.setPosition(pos.x, pos.y);
        mainWindow.show();
      },
    },
    {
      label: 'Hide / Show Character',
      click: () => {
        if (!mainWindow) return;
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
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('panel:toggle');
  });
}

function registerShortcuts(): void {
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    mainWindow.webContents.send('panel:toggle');
  });

  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    try {
      const shot = await performFullScreenCapture();
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send('screen:captured', shot);
    } catch (err) {
      console.error('Shortcut full-screen capture failed:', err);
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    void openRegionSnipOverlay().catch((err) => {
      console.error('Shortcut region capture failed:', err);
    });
  });
}

function registerIpcHandlers(): void {
  // Settings & custom PNGTuber sprites
  ipcMain.handle('settings:get', () => settingsStore.getView());

  ipcMain.handle('settings:save', (_event, patch: Partial<AssistantSettings>) =>
    settingsStore.update(patch),
  );

  ipcMain.handle('sprites:pick', async (_event, state: SpriteStateKey) => {
    const result = await dialog.showOpenDialog({
      title: `Choose custom sprite for "${state}" state`,
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg', 'svg'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return settingsStore.saveSpriteFile(state, result.filePaths[0]);
  });

  ipcMain.handle('sprites:reset', () => settingsStore.resetSprites());

  // Chat & Vision streaming
  ipcMain.handle('chat:send', async (event, req: SendChatRequest) => {
    const settings = settingsStore.readRaw();
    const apiKey = settingsStore.getEffectiveApiKey();

    const emit = (payload: ChatStreamEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:stream', payload);
      }
    };

    try {
      const result = await geminiService.streamChat(
        {
          apiKey,
          model: settings.chatModel,
          systemPrompt: settings.systemPrompt,
          prompt: req.prompt,
          imageBase64: req.imageBase64,
          imageMimeType: req.imageMimeType,
          previousInteractionId: req.previousInteractionId,
        },
        {
          onDelta: (chunk) => {
            emit({ requestId: req.requestId, type: 'delta', text: chunk });
          },
        },
      );

      emit({
        requestId: req.requestId,
        type: 'done',
        interactionId: result.interactionId,
      });
    } catch (err) {
      emit({
        requestId: req.requestId,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Screenshots & Clipboard
  ipcMain.handle('screen:captureFull', () => performFullScreenCapture());

  ipcMain.handle('screen:startRegion', () => openRegionSnipOverlay());

  ipcMain.handle('clipboard:read', () => {
    const text = clipboard.readText().trim();
    const img = clipboard.readImage();
    const image = img.isEmpty() ? undefined : imageToAttachment(img, 'clipboard');
    return { text, image };
  });

  // Audio transcription
  ipcMain.handle('audio:transcribe', async (_event, req: TranscribeRequest) => {
    const apiKey = settingsStore.getEffectiveApiKey();
    const result = await geminiService.transcribeAudio({
      apiKey,
      audioBase64: req.audioBase64,
      filePath: req.filePath,
      mimeType: req.mimeType,
      mode: req.mode,
    });
    return {
      text: result.text,
      sourceName: result.sourceName,
      mode: req.mode,
    };
  });

  ipcMain.handle('audio:pickFile', async (): Promise<PickedAudioFile | null> => {
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
    const stats = fs.statSync(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      mimeType: AUDIO_MIME_BY_EXT[ext] ?? 'audio/mp3',
      sizeBytes: stats.size,
    };
  });

  ipcMain.handle(
    'audio:saveTranscript',
    async (_event, content: string, defaultName: string): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: 'Save Transcript',
        defaultPath: defaultName,
        filters: [
          { name: 'Text File', extensions: ['txt'] },
          { name: 'Markdown File', extensions: ['md'] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      fs.writeFileSync(result.filePath, content, 'utf-8');
      return result.filePath;
    },
  );

  // Window interaction helpers
  ipcMain.on('window:setIgnoreMouseEvents', (_event, ignore: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.on('window:moveBy', (_event, dx: number, dy: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [curX, curY] = mainWindow.getPosition();
    mainWindow.setPosition(Math.round(curX + dx), Math.round(curY + dy));
  });

  ipcMain.on('window:setPosition', (_event, x: number, y: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.handle('window:setPanelMode', (_event, open: boolean) => {
    setPanelWindowMode(Boolean(open));
  });

  ipcMain.handle('window:getWorkArea', (): WindowWorkAreaInfo => {
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

  ipcMain.on('window:resetPosition', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const pos = getDefaultWindowPosition();
    mainWindow.setPosition(pos.x, pos.y);
  });

  // Snip overlay IPC
  ipcMain.handle('snip:getBackdrop', (): SnipBackdropPayload | null => {
    if (!pendingSnipFrame) return null;
    return {
      dataUrl: pendingSnipFrame.dataUrl,
      displayWidth: pendingSnipFrame.display.bounds.width,
      displayHeight: pendingSnipFrame.display.bounds.height,
      scaleFactor: pendingSnipFrame.display.scaleFactor || 1,
    };
  });

  ipcMain.handle('snip:complete', (_event, rect: CropRect) => {
    const frame = pendingSnipFrame;
    pendingSnipFrame = null;

    if (snipWindow && !snipWindow.isDestroyed()) {
      snipWindow.close();
    }

    if (frame) {
      const cropped = cropCapturedFrame(frame, rect, getAutoSaveDir());
      if (cropped && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('screen:captured', cropped);
      }
    }
  });

  ipcMain.handle('snip:cancel', () => {
    pendingSnipFrame = null;
    if (snipWindow && !snipWindow.isDestroyed()) {
      snipWindow.close();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
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
    settingsStore = new SettingsStore(app.getPath('userData'));
    registerIpcHandlers();
    mainWindow = createMainWindow();
    setupTray();
    registerShortcuts();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
