# Mochi — Desktop AI Assistant Character

A customizable **2D / PNGTuber floating desktop AI assistant character** for Windows powered by **Electron**, **React + TypeScript**, and the **Google Gemini Interactions API** (`@google/genai`).

## Features

- **Roaming Pixel Cat Companion**: A small, transparent, always-on-top pixel cat that walks around your screen. Options stay hidden until you hover over or click the cat (or summon it from the Windows System Tray).
- **Screenshot & Screen Vision (`gemini-3.8-flash`)**:
  - Capture your **full screen** (`Ctrl+Shift+S`) or **snip any region** (`Ctrl+Shift+R`) with a built-in snipping overlay.
  - Every captured screenshot is automatically saved as a PNG to your PC's **Downloads** folder (toggleable in Settings).
  - Attach clipboard text or images in one click and ask your assistant to explain, debug, summarize, or translate what's on your screen.
- **Voice & Audio Transcription (`gemini-3.5-transcribe`)**:
  - Record directly from your PC microphone with a live audio-reactive character animation.
  - Or pick local audio files (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.webm`, `.flac`, `.aac`).
  - Switch between **Smart** (clean punctuation & filler removal) and **Verbatim** transcription modes, copy or save as `.txt`, or send straight to Chat to summarize.
- **Customizable 2D / PNGTuber Sprites**:
  - Ships with an animated built-in **Mochi** mascot (`idle`, `listening`, `thinking`, `speaking`, `happy`, `error`).
  - Upload your own transparent `.png`, `.gif`, or `.webp` character art per state in **Settings**, rename your character, adjust its size, and customize its personality prompt.
- **Optional Browser Voice Output (TTS)**: Toggle spoken responses using built-in OS voices at zero extra API cost.

## Prerequisites

- **Node.js** 20+
- A free **Google Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey)

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Add your Gemini API key** (choose either method — both stay local and are ignored by Git):
   - **Option A (In-App — Easiest):** Launch the app, open the **Settings** tab, paste your API key, and click **Save Settings**.
   - **Option B (`.env` file):** Copy `.env.example` to `.env` and fill in `GEMINI_API_KEY`:
     ```bash
     cp .env.example .env
     ```

3. **Run in development mode**:
   ```bash
   npm run dev
   ```

4. **Build for production**:
   ```bash
   npm run build
   ```

5. **Run unit tests**:
   ```bash
   npm test
   ```

## Launch Without a Terminal (Background Mode)

After running `npm run build`, you don't need to keep a terminal tab open:

- **Option 1 — Detached terminal command**:
  ```bash
  npm run launch
  ```
  Starts the pixel cat in the background and immediately exits so you can close your terminal.

- **Option 2 — One-click Windows launcher (Zero terminal window)**:
  Double-click **`Start Pixel Cat.vbs`** in the project folder. It launches the pixel cat directly in the background with no terminal window appearing at all.

- **Quitting the assistant**: Right-click the cat's icon in the **Windows System Tray** (bottom-right taskbar area) and choose **Quit**.

### Optional: Auto-Start With Windows

1. Right-click **`Start Pixel Cat.vbs`** and choose **Create shortcut** (or copy it).
2. Press **`Win + R`**, type `shell:startup`, and press **Enter** to open your Windows Startup folder.
3. Move that shortcut into the Startup folder — the pixel cat will now start automatically whenever you sign in to Windows.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + Shift + Space` | Toggle Assistant Panel |
| `Ctrl + Shift + S` | Capture Full Screen & attach to chat |
| `Ctrl + Shift + R` | Open Region Snipping Overlay |
| `Esc` / `Right-Click` | Cancel active Region Snip |

## Customizing Your PNGTuber Character

1. Open the **Settings** tab inside the floating panel.
2. Under **Custom PNGTuber Sprites**, click any state (`Idle`, `Listening`, `Thinking`, `Speaking`, `Happy`) to pick a local transparent `.png`, `.gif`, or `.webp` image.
3. Images are copied locally into your app user-data folder so they persist across restarts without polluting this Git repository.
4. Click **Reset Default** anytime to switch back to the built-in Mochi mascot.

## Security & Privacy

- Your Gemini API key is stored only in your local Electron user-data folder (`config.json`) or your local `.env` file (excluded via `.gitignore`).
- All Gemini API requests run inside Electron's Main Process (`contextIsolation: true`, `nodeIntegration: false`) so your API key is never exposed to the renderer DOM.

## License

MIT — see [LICENSE](./LICENSE).
