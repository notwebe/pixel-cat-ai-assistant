# Mochi — Desktop AI Assistant Character

A customizable **2D / PNGTuber floating desktop AI assistant character** for Windows powered by **Electron 35**, **React 19 + TypeScript**, **Vite**, and the **Google Gemini Interactions API** (`@google/genai`).

## Features

- **Roaming Pixel Cat Companion**:
  - Crisp 4× integer-scaled (`80×80`) pixel cat rendered on a transparent, always-on-top frameless window that walks along your screen (biased toward the bottom taskbar edge).
  - Click-through transparent stage keeps apps behind Mochi clickable; quick action orbs stay tucked away until you hover over or click/pin the cat (or summon it from the **Windows System Tray** or `Ctrl+Shift+Space`).
  - Built-in character states (`idle`, `walking`, `listening`, `thinking`, `speaking`, `happy`, `error`), adjustable character size, walking toggle, and position reset.
- **Markdown Chat, Persistence & Screen Vision (`gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-4-argon`)**:
  - Streaming replies with **Stop** cancellation and one-click **Retry** on errors.
  - Sanitized **Markdown rendering** supporting fenced code blocks with language labels and per-block **Copy** buttons, inline code, headings, bold/italic text, and lists.
  - **Persistent local history**: conversations and transcripts persist across app restarts (`history.json` in your Electron user-data folder, retaining up to 50 chat messages and 30 transcripts).
  - Capture your **full screen** (`Ctrl+Shift+S`), **snip any region** (`Ctrl+Shift+R`), attach clipboard text/images, or paste screenshots directly into the composer with `Ctrl+V`.
  - Captured screenshots are automatically saved (best-effort) as PNGs to your Windows **Downloads** folder (toggleable in Settings).
- **Voice & Audio Transcription (`gemini-3.5-transcribe`)**:
  - Record directly from your PC microphone with a live audio-reactive animation, **Cancel/Discard** while recording, and **Retry** if a transcription fails.
  - Pick local audio files (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.webm`, `.flac`, `.aac`, `.aiff`, up to 50 MB; files larger than 15 MB automatically use the Gemini Files API and are deleted afterward).
  - Switch between **Smart** (clean punctuation & filler removal) and **Verbatim** modes, copy or save transcripts as `.txt`, delete old entries, or send straight to Chat.
- **Customizable 2D / PNGTuber Sprites**:
  - Upload your own `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` artwork for `Idle`, `Listening`, `Thinking`, `Speaking`, and `Happy` in **Settings**, clear individual slots, or click **Reset Default** anytime.
  - Rename your character and customize its personality/system prompt.
- **Optional Browser Voice Output (TTS)**: Toggle spoken replies using built-in OS voices at zero extra API cost.

## Prerequisites

- **Windows 10 / 11**
- **Node.js 20+** (Node 22 LTS recommended — Electron 35 bundles Node 22)
- A **Google Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)

## Quick Start

1. **Install dependencies**:
   ```bat
   npm install
   ```

2. **Configure your Gemini API key** (choose either method — both stay local and are ignored by Git):
   - **Option A (In-App — Recommended):** Launch the app, open the **Settings** tab, paste your API key, and click **Save Settings**. The key is encrypted locally via Electron's OS-backed `safeStorage`.
   - **Option B (`.env` file):** Copy `.env.example` to `.env` and uncomment `GEMINI_API_KEY` (or `GOOGLE_API_KEY`):
     - **Command Prompt (`cmd.exe`)**:
       ```bat
       copy .env.example .env
       ```
     - **PowerShell**:
       ```powershell
       Copy-Item .env.example .env
       ```

3. **Run in development mode**:
   ```bat
   npm run dev
   ```
   *(Optional: set `VITE_PORT` if port `5173` is already in use, e.g. `$env:VITE_PORT=5174; npm run dev` in PowerShell.)*

4. **Typecheck & run unit tests**:
   ```bat
   npm run typecheck
   npm test
   ```

5. **Build production bundles** (required before `npm run launch` or `Start Pixel Cat.vbs`):
   ```bat
   npm run build
   ```

## Launch Without a Terminal (Background Mode)

After running `npm run build`, you can launch Mochi without keeping a terminal window open:

- **Option 1 — Detached terminal command**:
  ```bat
  npm run launch
  ```
  Starts Electron detached in the background (stripping `ELECTRON_RUN_AS_NODE` so it works cleanly inside VS Code or Cursor terminals) and exits immediately.

- **Option 2 — One-click Windows VBScript launcher (Zero terminal window)**:
  Double-click **`Start Pixel Cat.vbs`** in the project folder. It verifies that Electron (`node_modules\electron\dist\electron.exe`) and both build outputs (`dist-electron\main.cjs` and `dist\index.html`) exist, then starts Mochi with no console window.

- **Quitting the assistant**: Right-click Mochi's icon in the **Windows System Tray** (bottom-right taskbar area) and choose **Quit**.

### Optional: Auto-Start With Windows

1. Right-click **`Start Pixel Cat.vbs`** and choose **Create shortcut** (any `*.lnk` files left in the repo folder are ignored by `.gitignore`).
2. Press **`Win + R`**, type `shell:startup`, and press **Enter** to open your Windows Startup folder.
3. Move the shortcut into the Startup folder — Mochi will now start automatically when you sign in to Windows.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + Shift + Space` | Toggle Assistant Panel |
| `Ctrl + Shift + S` | Capture Full Screen & attach to chat |
| `Ctrl + Shift + R` | Open Region Snipping Overlay |
| `Esc` / `Right-Click` | Cancel active Region Snip |

## Customizing Your PNGTuber Character

1. Open the **Settings** tab inside the floating panel.
2. Under **Custom PNGTuber Sprites**, click any state (`Idle`, `Listening`, `Thinking`, `Speaking`, `Happy`) to pick a local `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` image.
3. Images are copied locally into your Electron user-data folder so they persist across restarts without modifying this Git repository.
4. Click a slot's clear button (`×`) to remove a single sprite or **Reset Default** to restore the built-in Mochi mascot.

## Security & Privacy

- **Encrypted API Key Storage**: Keys saved in **Settings** are encrypted on disk using Electron's OS-backed `safeStorage` (`encryptedApiKey` in `config.json` inside your Electron user-data folder) and are never returned in plaintext to the renderer UI over IPC. Environment variables (`GEMINI_API_KEY` or `GOOGLE_API_KEY` in `.env`) are also supported and excluded via `.gitignore`.
- **Process Isolation & Sandboxing**: Both Electron windows run with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a strict Content Security Policy (CSP), and navigation/popup blocking. All Gemini API calls execute strictly inside Electron's Main Process.
- **Scoped File Handling**: Local audio files chosen in the **Transcribe** tab are tracked in the Main Process via opaque tokens rather than arbitrary renderer-supplied file paths, and files over 15 MB uploaded to the Gemini Files API are deleted in a `finally` block after transcription.

## Troubleshooting

### Microphone permissions not working
- Open **Windows Settings → Privacy & security → Microphone** and confirm both **Microphone access** and **Let desktop apps access your microphone** are enabled.
- Electron's permission handler allows `'media'` requests only from the main assistant window. If you toggled Windows microphone permissions while the app was open, quit from the System Tray and relaunch Mochi.

### Global hotkeys (`Ctrl+Shift+S`, `Ctrl+Shift+R`, `Ctrl+Shift+Space`) conflict with other apps
- Windows only allows one application to register a global hotkey at a time. Common conflicts include **Microsoft Edge Web Capture** (`Ctrl+Shift+S`), GPU/overlay tools (`Ctrl+Shift+R`), and clipboard/IME launchers (`Ctrl+Shift+Space`).
- If a hotkey fails to register, Mochi records the registration status and remains fully usable via the cat's **Quick Action Orbs** and the **Windows System Tray** menu.

### `electron.exe` missing after `npm install` (npm 11 / `extract-zip` friction)
- Under npm 11, `--ignore-scripts`, corporate proxies, or Windows Defender scanning `node_modules\electron` during extraction, Electron's `postinstall` script can fail or be skipped, leaving `node_modules\electron\dist\electron.exe` missing.
- Recover without reinstalling everything by running Electron's installer directly:
  ```bat
  node node_modules/electron/install.js
  ```
- If you are behind a proxy or firewall, set `ELECTRON_MIRROR` first before running the command above.

### Windows blocks `Start Pixel Cat.vbs` (VBScript policy / deprecation)
- Microsoft is deprecating VBScript on Windows 11 (moving it to an optional Feature on Demand), and some enterprise Group Policy, AppLocker, or Windows Defender / SmartScreen settings block `.vbs` (`wscript.exe`) scripts from spawning hidden background processes or flag downloaded archives with Mark-of-the-Web.
- **Workarounds**:
  - Run `npm run launch` from a terminal (it detaches immediately and strips `ELECTRON_RUN_AS_NODE`).
  - Or create a standard Windows Shortcut (`.lnk`) pointing to `node_modules\electron\dist\electron.exe` with argument `.` and **Start in** set to this project directory (or register a Windows Task Scheduler entry).

## License

MIT — see [LICENSE](./LICENSE).
