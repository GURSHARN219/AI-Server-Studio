<p align="center">
  <img src="https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Supabase-Backend-3FCF8E?logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue" alt="License" />
</p>

# AI Server Studio

> A modern, feature-rich AI desktop application with local LLM inference, multi-provider support, built-in tools, MCP server integration, model discovery, voice/media studio, and a full settings dashboard — all in one sleek Electron UI.

---

## Features

### Chat Interface
- **Multi-tab conversations** — open, rename, and manage multiple chat sessions simultaneously
- **Session search** — quickly find past conversations from the sidebar
- **Streaming responses** — real-time token streaming with animated typing indicators
- **Markdown rendering** — full markdown support with syntax-highlighted code blocks, copy-to-clipboard, and inline code
- **Thinking blocks** — collapsible AI reasoning/thinking display
- **Image attachments** — attach and send images directly in chat
- **Message actions** — copy, delete, or regenerate any message
- **Tool call display** — collapsible tool call results inline in the conversation

### Multi-Provider Model Support
- **Local Engine** — connect to the built-in llama.cpp engine or any OpenAI-compatible local server (`localhost:1234`)
- **Cloud API Providers** — OpenAI, Anthropic, Google AI, Mistral, Groq, Together AI, OpenRouter, or any custom endpoint
- **Live model fetching** — auto-discover available models from each provider
- **Per-message model badges** — see which model generated each response
- **Model config panel** — adjust temperature, top-p, max tokens, system prompt, and more

### Built-in Tools (Function Calling)
The AI can autonomously invoke these tools during conversations:

| Tool | Description |
|---|---|
| **JS Code Sandbox** | Execute JavaScript in a sandboxed environment |
| **Web Search** | Real-time web search via DuckDuckGo (Supabase Edge Function) |
| **URL Fetcher** | Fetch and extract clean text from any web page |
| **Calculator** | Safe mathematical expression evaluator |
| **JSON Transform** | Parse, format, query, and transform JSON data |
| **Random Generator** | Generate UUIDs, passwords, colors, lorem ipsum, mock data |
| **Base64 Encode/Decode** | Encode or decode Base64 strings |
| **Hash Generator** | SHA-256, SHA-1, SHA-384 hashing |
| **File Reader** | Read, list, and search user-uploaded files (Supabase) |
| **Knowledge Base (RAG)** | Search, add, and list documents with full-text search |
| **Current Time** | Get current date, time, timezone, and UNIX timestamp |

### MCP (Model Context Protocol) Servers
- **Auto-discovery** — automatically discovers tools from enabled MCP servers on startup
- **Local + Remote** — local MCP servers are called directly; remote ones are proxied through Supabase Edge Functions
- **Default servers** — pre-configured Filesystem, Brave Search, GitHub, Puppeteer, and SQLite servers
- **Add / remove / toggle** — manage servers from both the chat toolbar and the Settings page
- **Supabase synced** — server configs are persisted to your Supabase database

### Local LLM Engine
- **Bundled llama.cpp** — pre-built backends for CPU (AVX2), NVIDIA CUDA, and Vulkan
- **OpenAI-compatible API** — exposes `localhost:1234` for any OpenAI-compatible client
- **Model management** — load/unload GGUF models, scan models directory, load by path
- **Hardware detection** — CPU, GPU, RAM info with live usage widget in sidebar
- **Download manager** — download GGUF models from HuggingFace with progress tracking

### Voice & Media Studio
- **Voice Studio** — STT/TTS workflows with provider selection
- **Media Studio** — image and video generation via cloud providers

### Aistclaw Enterprise Backend
- **Teams & agents** — enterprise-grade agent and team management
- **Workflow automation** — agent runs, tasks, and event-driven components
- **Local PostgreSQL** — optional pgvector integration for local RAG
- **Dual-process mode** — engine + Aistclaw run as separate processes in development

### Settings Dashboard
- **Profile & Security** — display name, avatar, password change, active session info
- **API Providers** — add, edit, toggle, and delete API provider configurations (encrypted keys)
- **MCP Servers** — full CRUD with connect/test, import/export JSON
- **Tools** — enable/disable built-in and custom tools, edit schemas
- **Server API** — configure local server port, domain, CORS, and API key
- **Paths** — configure models, logs, and cache directories
- **Basics** — theme, language, font size, nav bar position, chat style
- **Advanced** — GPU acceleration, context length, debug logging, experimental features
- **Runtime & Hardware** — system monitoring panels, backend browser

### Keyboard Shortcuts
- `Ctrl + N` — New chat
- `Ctrl + ,` — Open settings
- `Ctrl + J` — Jump to chat
- `Ctrl + M` — Jump to models
- `Ctrl + Shift + R` — Runtime panel
- `Ctrl + Shift + H` — Hardware panel

---

## Architecture

```
open-studio-main/
├── electron/                   # Electron main process + preload
├── src/
│   ├── pages/                  # Application pages (one per route)
│   │   ├── Index.tsx           # Root layout, routing, global state
│   │   ├── ChatPage.tsx        # Main chat interface
│   │   ├── SettingsPage.tsx    # Full settings dashboard
│   │   ├── ModelsPage.tsx      # Local + API model management
│   │   ├── ServerPage.tsx      # Local server management
│   │   ├── DiscoverPage.tsx    # HuggingFace model browser
│   │   ├── ApiGatewayPage.tsx  # API key & endpoint management
│   │   ├── VoicePage.tsx       # Voice studio (STT/TTS)
│   │   ├── MediaPage.tsx       # Media generation
│   │   ├── AuthPage.tsx        # Authentication (Supabase Auth)
│   │   ├── AccountPage.tsx     # User account page
│   │   └── ClawUiPage.tsx      # Aistclaw enterprise UI host
│   ├── components/
│   │   ├── IconSidebar.tsx     # Navigation sidebar (vertical/horizontal, role-filtered)
│   │   ├── WindowTitleBar.tsx  # Custom Electron titlebar + theme toggle
│   │   ├── ModelConfigPanel.tsx# Model parameter configuration drawer
│   │   ├── DownloadManager.tsx # Download queue UI
│   │   ├── KeyboardShortcuts.tsx
│   │   ├── chat/               # Chat UI components
│   │   ├── server/             # Server monitor components
│   │   ├── settings/           # Settings tab panels
│   │   ├── discover/           # Model discovery components
│   │   ├── api-gateway/        # API gateway components
│   │   ├── voice/              # Voice studio components
│   │   └── ui/                 # shadcn/ui primitives
│   ├── stores/
│   │   ├── chatStore.ts        # Zustand: chat tabs, messages → localStorage
│   │   └── settingsStore.ts    # Zustand: all app settings → localStorage
│   ├── hooks/
│   │   ├── useLocalEngine.ts   # Engine status polling + load/unload
│   │   ├── useDownloadManager.ts # GGUF download queue
│   │   ├── useAuth.ts          # Auth session management
│   │   └── useHardwareInfo.ts  # CPU/GPU/RAM polling
│   ├── lib/
│   │   ├── api.ts              # Backend HTTP client
│   │   ├── localEngine.ts      # Local engine HTTP client
│   │   ├── toolExecutor.ts     # Tool execution (parallel, retry, timeout)
│   │   ├── builtInTools.ts     # Built-in tool implementations
│   │   └── mcpOperations.ts    # MCP server discovery + tool execution
│   └── backend/                # Go backend source
│       ├── engine/             # llama.cpp wrapper + hardware detection
│       ├── aistclaw/           # Enterprise backend (teams, agents, workflows)
│       └── server/             # HTTP route handlers
├── extensions/
│   └── backends/               # Pre-built llama.cpp binaries (CPU, CUDA, Vulkan)
├── data/                       # Runtime JSON data files
├── supabase/
│   └── functions/
│       ├── api-proxy/          # OpenAI-compatible API proxy
│       ├── mcp-proxy/          # MCP server proxy for remote servers
│       └── tool-execute/       # Edge function for web-search & url-fetch
├── index.html
├── tailwind.config.ts
├── vite.config.ts
└── vitest.config.ts
```

See [STRUCTURE.md](./STRUCTURE.md) for the full directory breakdown and [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed diagrams and data flow.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 34 (main + preload) |
| Frontend framework | React 18 + TypeScript 5.8 |
| Build tool | Vite 5.4 (SWC plugin) |
| Styling | Tailwind CSS 3.4 + custom HSL design tokens |
| UI Components | shadcn/ui (Radix UI primitives) |
| Animations | Framer Motion 12 |
| Routing | React Router DOM v6 |
| Client state | Zustand + localStorage persistence |
| Server state | TanStack Query (React Query) |
| Backend DB | Supabase (Auth, PostgreSQL, Edge Functions) |
| Local inference | llama.cpp via Go wrapper + pre-built .dll binaries |
| Enterprise backend | Go (Aistclaw — agents, teams, workflows) |
| Package manager | Bun |
| Linting | ESLint |
| Testing | Vitest |

---

## Getting Started

### Prerequisites

- **Bun** >= 1.0 (recommended) or **Node.js** >= 18
- **Go** >= 1.21 (required for building the engine and Aistclaw backend)
- **Windows x86_64** (pre-built backends are Windows-only; other platforms require building from source)
- **Supabase Project** — for authentication, database, and edge functions (optional for local-only mode)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/open-studio.git
cd open-studio

# 2. Install dependencies
bun install
```

### Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Required for Aistclaw backend features in Electron mode
AISTCLAW_POSTGRES_DSN=postgres://postgres:postgres@localhost:5432/aistclaw?sslmode=disable
```

`.env.local` overrides `.env` and is gitignored.

### Development

```bash
# Start the dev server (web UI only, no engine)
bun run dev

# Start desktop app with Electron (builds Go engine first)
bun run dev:electron

# Force single-engine mode in development
npx cross-env AIST_SINGLE_ENGINE=1 bun run dev:electron

# Force dual-process mode explicitly
npx cross-env AIST_SINGLE_ENGINE=0 bun run dev:electron

# Run engine standalone
bun run dev:engine

# Run engine with CUDA GPU layers
bun run dev:engine:cuda

# Run tests (single run)
bun run test

# Run tests in watch mode
bun run test:watch

# Lint the codebase
bun run lint

# Build for production
bun run build

# Build full Electron app
bun run build:electron
```

---

## Available Scripts

| Script | Description |
|---|---|
| `bun run dev` | Vite dev server (web only) |
| `bun run dev:electron` | Full Electron dev (builds Go engine first) |
| `bun run dev:engine` | Run Go engine standalone |
| `bun run dev:engine:cuda` | Run engine with CUDA GPU layers |
| `bun run build` | Vite production build |
| `bun run build:electron` | Full Electron production build |
| `bun run build:engine:dev` | Compile Go engine to `engine.exe` |
| `bun run build:aistclaw:dev` | Compile Aistclaw backend to `aistclaw.exe` |
| `bun run lint` | ESLint |
| `bun run test` | Vitest (single run) |

---

## Runtime Notes (April 2026)

### Runtime topology

| Mode | Command | What runs |
|---|---|---|
| **Web UI only** | `bun run dev` | Vite + React UI only (no local engine process) |
| **Desktop dev** | `bun run dev:electron` | Vite + Electron main process + Go engine backend |
| **Desktop packaged** | `bun run build:electron` | Production Electron app with bundled backend binaries |

### Execution behavior in desktop mode

- The frontend talks to the local Go backend at `http://localhost:{enginePort}/v1`.
- In development, Electron defaults to **dual-process** (`AIST_SINGLE_ENGINE=0`): engine process + standalone Aistclaw process.
- In packaged builds, Electron defaults to **single-engine supervision** (`AIST_SINGLE_ENGINE=1`).
- Backend chooses a free port starting from `1234`, then emits it to Electron via stdout (`engine:port`).

### Local data persistence (desktop)

Desktop mode persists app data in local JSON files under `data/` (or `AI_SERVER_DATA_DIR` if set):

- `data/users.json`
- `data/auth_sessions.json`
- `data/providers.json`
- `data/provider_model_prefs.json`
- `data/mcp_servers.json`
- `data/documents.json`

### Dev prerequisites for `bun run dev:electron`

- **Go toolchain** must be available (predev builds backend binaries).
- If `AISTCLAW_POSTGRES_DSN` points to `localhost:5433`, Docker Desktop is used to auto-start/stop the `aistclaw-pgvector` container.
- If Docker is unavailable, pgvector auto-start is skipped and startup depends on your DSN configuration.

---

## Navigation Pages

| Page | Route | Role Required | Description |
|---|---|---|---|
| Chat | `/chat` | user | Multi-session chat with tool calling |
| AistClaw | `/aistclaw/*` | power-user | Enterprise agents, teams, workflows |
| Voice Studio | `/voice` | power-user | STT/TTS workflows |
| Media Studio | `/media` | power-user | Image/video generation |
| My Models | `/models` | power-user | Local + API model management |
| Discover | `/discover` | power-user | HuggingFace model browser + downloader |
| API Gateway | `/api` | power-user | Key management, usage logs |
| Server | `/server` | power-user | Engine monitor, logs, endpoints |
| Settings | (modal) | user | Appearance, chat, advanced, about |

---

## Supabase Setup

Supabase is supported for cloud workflows and edge-function integrations, but desktop mode can run with local backend storage only.

For Supabase-enabled deployments, configure the following resources:

### Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User display name, avatar |
| `api_providers` | Encrypted API provider configurations |
| `mcp_servers` | MCP server configurations |
| `api_keys` | User-generated API keys |
| `api_usage_logs` | Request/token usage tracking |
| `user_files` | Uploaded file storage |
| `documents` | Knowledge base documents (RAG) |

### Edge Functions

| Function | Purpose |
|---|---|
| `api-proxy` | Proxies chat completions to external API providers |
| `mcp-proxy` | Proxies JSON-RPC calls to remote MCP servers |
| `tool-execute` | Executes web-search and url-fetch tools server-side |

### Deploy Edge Functions

```bash
supabase functions deploy api-proxy
supabase functions deploy mcp-proxy
supabase functions deploy tool-execute
```

---

## Security Notes

- **Desktop mode stores provider keys in local backend data files** (`data/providers.json`) and serves them through local authenticated APIs
- **Supabase RLS** (Row Level Security) should be enabled on all tables to ensure users can only access their own data
- **Local tool execution** (JS Sandbox, Calculator) runs in the browser — treat with appropriate caution
- **Edge Functions** handle external network calls (web search, URL fetch, MCP proxy) to avoid CORS issues
- **SSRF protection** in `url-fetch` built-in tool blocks private IP ranges
- **Remote MCP servers** are blocked in offline execution mode

---

## Contributing

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/my-feature`
3. **Commit** your changes: `git commit -m "feat: add my feature"`
4. **Push** to the branch: `git push origin feature/my-feature`
5. Open a **Pull Request**

### Code Style

- TypeScript with relaxed strict mode (`noImplicitAny: false`)
- ESLint with React Hooks and React Refresh plugins
- Tailwind CSS for all styling (no inline styles)
- Components follow the shadcn/ui pattern
- Path aliases: `@/*` for `src/*`, `@aistclaw/*` for Aistclaw modules

---

## License

This project is licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ using React, Electron, Go, llama.cpp, and the power of open AI models.
</p>
