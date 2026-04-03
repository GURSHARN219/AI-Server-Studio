<p align="center">
  <img src="https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Supabase-Backend-3FCF8E?logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</p>

# 🧠 AI Server Studio

> A modern, feature-rich AI chat interface with multi-provider support, built-in tools, MCP server integration, and a full settings dashboard — all in one sleek desktop-style UI.

---

## ✨ Features

### 💬 Chat Interface
- **Multi-tab conversations** — open, rename, and manage multiple chat sessions simultaneously
- **Session search** — quickly find past conversations from the sidebar
- **Streaming responses** — real-time token streaming with animated typing indicators
- **Markdown rendering** — full markdown support with syntax-highlighted code blocks, copy-to-clipboard, and inline code
- **Thinking blocks** — collapsible AI reasoning/thinking display
- **Image attachments** — attach and send images directly in chat
- **Message actions** — copy, delete, or regenerate any message

### 🤖 Multi-Provider Model Support
- **Local Engine** — connect to the built-in llama.cpp engine or any OpenAI-compatible local server (`localhost:1234`)
- **Cloud API Providers** — OpenAI, Anthropic, Google AI, Mistral, Groq, Together AI, OpenRouter, or any custom endpoint
- **Live model fetching** — auto-discover available models from each provider
- **Per-message model badges** — see which model generated each response
- **Model config panel** — adjust temperature, top-p, max tokens, system prompt, and more

### 🔧 Built-in Tools (Function Calling)
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

### 🌐 MCP (Model Context Protocol) Servers
- **Auto-discovery** — automatically discovers tools from enabled MCP servers on startup
- **Local + Remote** — local MCP servers are called directly; remote ones are proxied through Supabase Edge Functions
- **Default servers** — pre-configured Filesystem, Brave Search, GitHub, Puppeteer, and SQLite servers
- **Add / remove / toggle** — manage servers from both the chat toolbar and the Settings page
- **Supabase synced** — server configs are persisted to your Supabase database

### ⚙️ Settings Dashboard
- **Profile & Security** — display name, avatar, password change, active session info
- **API Providers** — add, edit, toggle, and delete API provider configurations (encrypted keys)
- **MCP Servers** — full CRUD with connect/test, import/export JSON
- **Tools** — enable/disable built-in and custom tools, edit schemas
- **Server API** — configure local server port, domain, CORS, and API key
- **Paths** — configure models, logs, and cache directories
- **Basics** — theme, language, auto-update, telemetry, GPU acceleration
- **Advanced** — max concurrent models, default context length, log level
- **Runtime & Hardware** — system monitoring panels

### 🧩 Additional Pages
- **Discover** — browse and explore available AI models and resources
- **Models** — manage and inspect downloaded/available models
- **Server** — local inference server management and monitoring
- **API Gateway** — API key management, endpoint configuration, and usage logs

### ⌨️ Keyboard Shortcuts
- `Ctrl + N` — New chat
- `Ctrl + ,` — Open settings
- `Ctrl + J` — Jump to chat
- `Ctrl + M` — Jump to models
- `Ctrl + Shift + R` — Runtime panel
- `Ctrl + Shift + H` — Hardware panel

---

## 🏗️ Architecture

```
open-studio-main/
├── src/
│   ├── pages/                  # Application pages
│   │   ├── Index.tsx           # Root layout, routing, global state
│   │   ├── ChatPage.tsx        # Main chat interface (87KB)
│   │   ├── SettingsPage.tsx    # Full settings dashboard
│   │   ├── ModelsPage.tsx      # Model browser
│   │   ├── ServerPage.tsx      # Local server management
│   │   ├── DiscoverPage.tsx    # Discover/explore page
│   │   ├── ApiGatewayPage.tsx  # API key & endpoint management
│   │   ├── AuthPage.tsx        # Authentication (Supabase Auth)
│   │   └── AccountPage.tsx     # User account page
│   ├── components/
│   │   ├── IconSidebar.tsx     # Navigation sidebar
│   │   ├── ModelConfigPanel.tsx# Model parameter configuration
│   │   ├── JsonEditorTab.tsx   # JSON editor for tools/MCP
│   │   ├── KeyboardShortcuts.tsx
│   │   └── ui/                 # shadcn/ui primitives
│   ├── hooks/
│   │   ├── useAuth.ts          # Supabase authentication hook
│   │   ├── use-toast.ts        # Toast notification hook
│   │   └── use-mobile.tsx      # Mobile detection hook
│   ├── lib/
│   │   ├── api.ts              # Core API: tools, MCP, model fetching
│   │   └── utils.ts            # Utility functions (cn)
│   └── integrations/
│       └── supabase/           # Supabase client configuration
├── supabase/
│   └── functions/
│       ├── api-proxy/          # OpenAI-compatible API proxy
│       ├── mcp-proxy/          # MCP server proxy for remote servers
│       ├── tool-execute/       # Edge function for web-search & url-fetch
│       └── hello/              # Health check function
├── index.html                  # Entry point
├── tailwind.config.ts          # Custom design tokens
├── vite.config.ts              # Vite bundler config
└── vitest.config.ts            # Test runner config
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 18 + TypeScript 5.8 |
| **Build Tool** | Vite 5.4 (SWC plugin) |
| **Styling** | Tailwind CSS 3.4 + custom HSL design tokens |
| **UI Components** | shadcn/ui (Radix UI primitives) |
| **Animations** | Framer Motion 12 |
| **Routing** | React Router DOM 6 |
| **State** | React `useState` + `localStorage` persistence |
| **Backend** | Supabase (Auth, Database, Edge Functions) |
| **Icons** | Lucide React |
| **Markdown** | react-markdown |
| **Testing** | Vitest + Testing Library |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18 (recommended: use [nvm](https://github.com/nvm-sh/nvm))
- **npm** or **bun** package manager
- **Supabase Project** — for authentication, database, and edge functions

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/open-studio.git
cd open-studio

# 2. Install dependencies
npm install

# 3. Configure environment variables
#    Create a .env file with your Supabase credentials:
cp .env.example .env
```

### Environment Variables

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
# Required for Aistclaw backend features in Electron mode
AISTCLAW_POSTGRES_DSN=postgres://postgres:postgres@localhost:5432/aistclaw?sslmode=disable
```

### Development

```bash
# Start the dev server (Vite default, usually http://localhost:5173)
npm run dev

# Start desktop app with Electron (dev default is dual-process mode)
npm run dev:electron

# Optional: force single-engine mode in development
npx cross-env AIST_SINGLE_ENGINE=1 npm run dev:electron

# Optional: force dual-process mode explicitly
npx cross-env AIST_SINGLE_ENGINE=0 npm run dev:electron

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint the codebase
npm run lint

# Build for production
npm run build

# Preview the production build
npm run preview
```

---

## 🧭 Current Runtime Notes (April 2026)

### Runtime topology

| Mode | Command | What runs |
|---|---|---|
| **Web UI only** | `npm run dev` | Vite + React UI only (no local engine process) |
| **Desktop dev** | `npm run dev:electron` | Vite + Electron main process + Go engine backend |
| **Desktop packaged** | `npm run build:electron` | Production Electron app with bundled backend binaries |

### Execution behavior in desktop mode

- The frontend talks to the local Go backend at `http://localhost:{enginePort}/v1`.
- In development, Electron defaults to **dual-process** (`AIST_SINGLE_ENGINE=0`): engine process + standalone Aistclaw process.
- In packaged builds, Electron defaults to **single-engine supervision** (`AIST_SINGLE_ENGINE=1`).
- Backend chooses a free port starting from `1234`, then emits it to Electron via stdout (`engine:port`).

### Local data persistence (desktop)

Desktop mode persists app data in local JSON files under `data/` (or `AI_SERVER_DATA_DIR` if set), including:

- `users.json`
- `auth_sessions.json`
- `providers.json`
- `provider_model_prefs.json`
- `mcp_servers.json`
- `documents.json`

### Local API surface (desktop)

Major route groups exposed by the Go backend:

- `GET /v1/system/*` for status/hardware/backends
- `GET|POST /v1/models/*` for model lifecycle
- `POST /v1/chat/completions` for local OpenAI-compatible chat
- `GET|POST|PATCH|DELETE /v1/providers*` for cloud-provider management
- `POST /v1/providers/*` for provider chat/image/audio proxying
- `POST /v1/tools/execute` for built-in tools
- `GET|POST /v1/mcp/*` for MCP server storage and proxy
- `POST /v1/agent/*` for backend agent runs

### Built-in tool IDs (current)

Canonical tool namespaces used by the runtime:

- `web.search`
- `web.fetch`
- `kb.search`
- `kb.store`
- `kb.list`

Legacy IDs like `web-search`, `url-fetch`, and `knowledge-base` are still accepted through alias mapping.

### Dev prerequisites for `npm run dev:electron`

- **Go toolchain** must be available (predev builds backend binaries).
- If `AISTCLAW_POSTGRES_DSN` points to `localhost:5433`, Docker Desktop is used to auto-start/stop the `aistclaw-pgvector` container.
- If Docker is unavailable, pgvector auto-start is skipped and startup depends on your DSN configuration.

---

## 🗄️ Supabase Setup

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

## 🔒 Security Notes

- **Desktop mode stores provider keys in local backend data files** (`data/providers.json`) and serves them through local authenticated APIs
- **Supabase RLS** (Row Level Security) should be enabled on all tables to ensure users can only access their own data
- **Local tool execution** (JS Sandbox, Calculator) runs in the browser — treat with appropriate caution
- **Edge Functions** handle external network calls (web search, URL fetch, MCP proxy) to avoid CORS issues

---

## 🤝 Contributing

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/my-feature`
3. **Commit** your changes: `git commit -m "feat: add my feature"`
4. **Push** to the branch: `git push origin feature/my-feature`
5. Open a **Pull Request**

### Code Style

- TypeScript strict mode
- ESLint with React Hooks and React Refresh plugins
- Tailwind CSS for all styling (no inline styles)
- Components follow the shadcn/ui pattern

---

## 📄 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ using React, Supabase, and the power of open AI models.
</p>
