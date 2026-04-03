# AGENTS.md — AI Coding Guidelines for PocketLlama

## Project Overview

PocketLlama is a two-component system for chatting with Ollama from your phone:
1. **Server** (`server/`) — Python FastAPI proxy that authenticates, streams, and tunnels requests to a local Ollama instance via DevTunnels. Optional STT via faster-whisper.
2. **Mobile App** (`mobile/`) — React Native / Expo app with QR-code connection, streaming chat, vision model support, conversation branching, and local SQLite storage.

## Project Structure

```
PocketLlama/
├── server/                     # Python FastAPI server
│   ├── start.py                # Entry point — Ollama check, devtunnel, QR, uvicorn
│   ├── app.py                  # FastAPI app — proxy, auth, /health, /stt
│   ├── config.py               # Loads .env settings
│   ├── .env.example            # Config template
│   ├── requirements.txt        # Python dependencies
│   └── Start-PocketLlama.ps1   # Legacy PowerShell server (reference)
│
├── mobile/                     # React Native / Expo Go app
│   ├── app/                    # expo-router file-based routing
│   │   ├── _layout.tsx         # Root layout — DB init, AppProvider, Stack nav
│   │   ├── index.tsx           # Connection screen — QR scan / manual entry
│   │   ├── models.tsx          # Model selection screen
│   │   └── (chat)/             # Drawer-wrapped chat screens
│   │       ├── _layout.tsx     # Drawer layout with chat history sidebar
│   │       └── [id].tsx        # Chat screen — messages, streaming, branching
│   ├── components/             # Reusable UI components
│   │   ├── ChatBubble.tsx      # Message bubble — markdown, images, think tags, branch nav
│   │   ├── ChatInput.tsx       # Input bar — text, images, mic (STT), send/stop
│   │   ├── DrawerContent.tsx   # Sidebar — chat list, rename, delete, disconnect
│   │   ├── QRScanner.tsx       # Camera-based QR code scanner
│   │   ├── PromptModal.tsx     # Cross-platform text prompt modal
│   │   ├── BranchNavigator.tsx # < 1/2 > branch switching arrows
│   │   └── ImageViewer.tsx     # Full-screen image viewer modal
│   ├── services/               # Business logic
│   │   ├── ollama.ts           # Ollama API client — streaming (XHR), models, vision, STT
│   │   ├── database.ts         # SQLite CRUD — connections, chats, messages, branching
│   │   └── connection.ts       # QR parsing, connection test+save
│   ├── contexts/AppContext.tsx  # Global state — connection, DB ready
│   ├── types/index.ts          # TypeScript interfaces
│   ├── constants/theme.ts      # B&W design tokens
│   └── assets/                 # Logo, icons, splash
│
├── README.md
├── AGENTS.md                   # This file
├── LICENSE                     # MIT
└── .gitignore
```

## Key Conventions

### General
- **No files over 500 lines.** Split into separate modules if approaching limit.
- **Extensive inline docs.** Every function needs a docstring/comment explaining what, why, params, returns.
- **No extra .md files.** Only README.md and AGENTS.md. Keep summaries in chat.

### TypeScript (Mobile)
- **Strict mode** enabled in tsconfig.
- **expo-router** for file-based navigation.
- **expo-crypto** for UUIDs (not `uuid` package — crypto.getRandomValues unsupported in Expo Go).
- **XMLHttpRequest** for streaming (not fetch — ReadableStream unsupported in Hermes/Expo Go). See `services/ollama.ts` `sendMessage()`.
- **expo-audio** for recording (not expo-av — deprecated in SDK 54).
- **expo-clipboard** for copy to clipboard.
- B&W theme: background `#000`, surface `#111`, text `#FFF`. See `constants/theme.ts`.

### Python (Server)
- **FastAPI** with async handlers.
- **httpx** for streaming proxy (not requests).
- **StreamingResponse** — client and response must NOT be in `async with` context managers. Close in the generator's `finally` block. See `app.py` proxy handler.
- Config via **python-dotenv** from `.env`.

## Key Patterns

### Streaming Chat
- Mobile sends `POST /api/chat` with `stream: true` through the proxy.
- Server proxies to Ollama with `httpx.stream()`, yields 4096-byte chunks.
- Mobile uses `XMLHttpRequest.onprogress` to read incremental `responseText`, parses NDJSON lines, calls `onToken()` per token.
- `<think>...</think>` tags are parsed from the raw stream to separate reasoning from content.

### Message Branching (Tree Structure)
- Each `Message` has `parentId` (which message it follows) and `branchIndex` (sibling position).
- Edit creates a new branch (same parent, incremented branchIndex) — original messages preserved.
- Retry creates a new assistant branch under the same user message.
- `buildConversationThread()` walks the tree following `activeBranches` map to produce a linear thread.
- `BranchNavigator` component shows `< 1/2 >` arrows at fork points.

### Auth
- Server generates a random 32-char hex key on each startup.
- Every request must include `X-Auth-Key` header.
- QR code encodes `{"url":"...","key":"..."}` JSON.

### Vision Detection
- Primary: `POST /api/show` → check `projector_info`, `families.includes('clip')`, architecture.
- Fallback: name-based keywords (`vl`, `llava`, `vision`, etc.).
- Known overrides: `vaultbox/qwen3.5-uncensored`.
- Results cached per model name.

## Build & Run Commands

### Server
```bash
cd server
python -m venv .venv
.venv/Scripts/activate        # Windows
source .venv/bin/activate     # Linux/Mac
pip install -r requirements.txt
# Optional STT: pip install faster-whisper
cp .env.example .env          # Edit as needed
python start.py
```

### Mobile (Development)
```bash
cd mobile
npm install
npx expo start
```

### Mobile (Build APK)
```bash
cd mobile
eas build --platform android --profile preview
```

## Testing Checklist
1. Server starts → Ollama auto-starts → DevTunnel URL + QR displayed
2. `curl -H "X-Auth-Key: <key>" <url>/api/tags` returns model list
3. `curl -H "X-Auth-Key: <key>" <url>/health` returns `{"ollama":true,"stt":true/false}`
4. App scans QR → connects → lists models
5. Chat streams token-by-token (not all at once)
6. Think tags show collapsible "Thought Process" section
7. Edit message → new branch created → `< 1/2 >` nav appears
8. Retry → new assistant branch → can switch between responses
9. Image attachment works on vision models
10. STT mic button records → transcribes → appends text
11. Chat history persists across app restarts
12. Long-press chat in drawer → Rename / Delete
