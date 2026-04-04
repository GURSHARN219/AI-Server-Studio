# Project Structure

```
open-studio-main/
├── electron/                        # Electron main process
│   ├── main.ts                      # App entry: spawns engine, daemon, aistclaw; manages BrowserWindow + IPC
│   └── preload.ts                   # Context bridge → window.electron (minimize/maximize/close, port events)
│
├── src/
│   ├── App.tsx                      # Root: QueryClientProvider, Router, Toaster
│   ├── main.tsx                     # React DOM entry point
│   ├── aistclaw-routes.tsx          # Aistclaw sub-router (enterprise pages)
│   │
│   ├── pages/                       # Top-level page components (one per route)
│   │   ├── Index.tsx                # App shell: layout, sidebar, modals, status bar, auth gate
│   │   ├── ChatPage.tsx             # Chat interface wrapper (useChatLogic + ChatUI)
│   │   ├── DiscoverPage.tsx         # HuggingFace model browser + download trigger
│   │   ├── ModelsPage.tsx           # Local + API model management table (load/unload/filter)
│   │   ├── ServerPage.tsx           # Engine monitor (status, logs, endpoints, stats)
│   │   ├── ApiGatewayPage.tsx       # API key management + usage dashboard
│   │   ├── SettingsPage.tsx         # Settings modal shell (10 tab panels)
│   │   ├── VoicePage.tsx            # STT/TTS workflows
│   │   ├── MediaPage.tsx            # Image/video generation
│   │   ├── AuthPage.tsx             # Login / signup (Supabase Auth)
│   │   ├── AccountPage.tsx          # User profile management
│   │   ├── ClawUiPage.tsx           # Aistclaw enterprise UI host
│   │   ├── NotFound.tsx             # 404
│   │   ├── aistclaw/                # Aistclaw-specific pages (agents, teams, workflows, etc.)
│   │   ├── discover/
│   │   │   └── discoverData.ts      # Static model catalog + filter types + HF fetch utilities
│   │   └── models/
│   │       └── modelsData.ts        # LocalModel type + static model data
│   │
│   ├── components/
│   │   ├── IconSidebar.tsx          # Navigation sidebar (vertical/horizontal, role-filtered, resource widget)
│   │   ├── WindowTitleBar.tsx       # Custom Electron titlebar + theme toggle
│   │   ├── ModelConfigPanel.tsx     # Slide-in model config drawer (sampling params, engine reload)
│   │   ├── DownloadManager.tsx      # Download queue UI (progress bars, cancel/retry/remove)
│   │   ├── KeyboardShortcuts.tsx    # Global keyboard shortcut handler (Ctrl+N/,/J/M/Shift+R/H)
│   │   ├── NavLink.tsx              # React Router NavLink wrapper with active/pending class support
│   │   ├── JsonEditorTab.tsx        # JSON editor with syntax highlighting + validation
│   │   ├── chat/                    # Chat UI components
│   │   │   ├── useChatLogic.ts      # Core chat hook: sessions, streaming, tool loop, token count
│   │   │   ├── ChatUI.tsx           # Main chat layout (sessions sidebar + message area + input toolbar)
│   │   │   ├── MessageBubble.tsx    # Single message renderer (user/assistant/tool/system)
│   │   │   ├── MessageList.tsx      # Scrollable message container with auto-scroll
│   │   │   ├── CodeBlock.tsx        # Syntax-highlighted code block with copy button
│   │   │   ├── SessionsSidebar.tsx  # Chat session list (title, timestamp, message count)
│   │   │   ├── ModelPicker.tsx      # Model selection dropdown (local + cloud grouped)
│   │   │   ├── ProviderPicker.tsx   # Provider selection dropdown
│   │   │   ├── AgentPicker.tsx      # Agent preset selector (system prompt + tool config)
│   │   │   ├── ToolConfigPanel.tsx  # Tool enable/disable panel (grouped by layer)
│   │   │   ├── McpServersPanel.tsx  # MCP server tools panel (slide-in)
│   │   │   └── types.ts             # Chat-specific types: ChatTab, Message, ToolCallDisplay
│   │   ├── discover/
│   │   │   ├── DiscoverFilters.tsx  # Search input + kind/capability filter pills + refresh
│   │   │   ├── ModelList.tsx        # Animated model cards with download button/progress
│   │   │   └── ModelDetail.tsx      # Right panel: HF file fetch, variant picker, README preview
│   │   ├── server/
│   │   │   ├── useServerState.ts    # Server hook: polls /v1/status every 3s, manages logs
│   │   │   ├── ServerHeader.tsx     # Port input, start/stop button, connection status badge
│   │   │   ├── WebSocketPanel.tsx   # HTTP polling status (uptime, latency, message count)
│   │   │   ├── LoadedModelsPanel.tsx# Currently loaded models from /v1/status
│   │   │   ├── EndpointsPanel.tsx   # Endpoint list with test buttons + custom endpoints
│   │   │   ├── DevLogs.tsx          # Log viewer (level filter, search, pause, clear, auto-scroll)
│   │   │   ├── ServerStats.tsx      # Stats sidebar (requests, errors, latency, uptime)
│   │   │   └── types.ts             # LogEntry, ConnectionStatus, LogLevel types
│   │   ├── settings/
│   │   │   ├── ProfileTab.tsx       # Display name, avatar (Supabase profiles table)
│   │   │   ├── BasicsTab.tsx        # Theme, language, font size, nav position, chat style
│   │   │   ├── ProvidersTab.tsx     # Cloud API provider CRUD (XOR-encrypted keys)
│   │   │   ├── McpServersTab.tsx    # MCP server CRUD + tool discovery
│   │   │   ├── ToolsTab.tsx         # Enable/disable built-in + MCP tools
│   │   │   ├── ApiTab.tsx           # Local server port, CORS, auth token config
│   │   │   ├── PathsTab.tsx         # Models dir, downloads dir (synced to engine)
│   │   │   ├── AdvancedTab.tsx      # GPU, context, debug, experimental features
│   │   │   ├── RuntimeTab.tsx       # Backend browser (reads backend-manifest.json, read-only)
│   │   │   ├── HardwareTab.tsx      # CPU/GPU/RAM info via useHardwareInfo (live, 3s poll)
│   │   │   └── Primitives.tsx       # Shared settings UI primitives (labeled inputs, toggles)
│   │   ├── api-gateway/
│   │   │   ├── StatsRow.tsx         # 4-card stats: requests, tokens, latency, error rate
│   │   │   ├── ApiKeysTab.tsx       # API key lifecycle (create sk-ais- keys, SHA-256 hash, toggle, delete)
│   │   │   ├── UsageTab.tsx         # Usage aggregated by model, filterable by key
│   │   │   ├── LogsTab.tsx          # Request log table (status, model, latency, tokens)
│   │   │   └── DocsTab.tsx          # Auto-generated API docs (Python/JS/cURL examples)
│   │   ├── gateway/                 # Gateway shared components
│   │   ├── voice/                   # Voice studio components
│   │   ├── ui/                      # shadcn/ui primitives (button, dialog, select, etc.)
│   │   └── aistclaw/                # Aistclaw-specific components
│   │
│   ├── stores/                      # Zustand state stores (persisted to localStorage)
│   │   ├── chatStore.ts             # Chat tabs, messages, active tab, generation state
│   │   ├── settingsStore.ts         # Appearance, chat, advanced, about settings + side-effects
│   │   └── aistclaw/                # Aistclaw-specific stores
│   │
│   ├── hooks/                       # React hooks
│   │   ├── useLocalEngine.ts        # Polls engine status every 5s; exposes load/unload
│   │   ├── useDownloadManager.ts    # GGUF download queue with progress tracking + persistence
│   │   ├── useAuth.ts               # Supabase auth session (onAuthStateChange + getSession)
│   │   ├── useHardwareInfo.ts       # CPU/GPU/RAM polling from /v1/hardware
│   │   ├── useAgentRunner.ts        # Agent execution loop
│   │   ├── use-mobile.tsx           # Responsive breakpoint hook
│   │   ├── use-toast.ts             # Toast notification hook
│   │   └── aistclaw/                # Aistclaw-specific hooks
│   │
│   ├── lib/                         # Utilities and API clients
│   │   ├── api.ts                   # Backend HTTP client (providers, auth, keys, usage, tools, MCP)
│   │   ├── localEngine.ts           # Local engine client (status, load, unload, config, port)
│   │   ├── toolExecutor.ts          # Tool execution: parallel (max 4), retry (max 2), timeout (15s), deps
│   │   ├── builtInTools.ts          # Built-in tool implementations (web-search, url-fetch, kb, sandbox, etc.)
│   │   ├── mcpOperations.ts         # MCP server CRUD (Supabase) + tool discovery + tool execution
│   │   ├── providerModelPrefs.ts    # Model preference persistence per provider (localStorage + backend sync)
│   │   ├── app-routes.ts            # Route constants (STUDIO_PAGE_PATHS) and path helpers
│   │   ├── crypto.ts                # Crypto utilities (XOR encryption for API keys)
│   │   ├── utils.ts                 # General utilities (cn, etc.)
│   │   ├── agent/                   # Agent execution utilities
│   │   └── aistclaw/                # Aistclaw API client + helpers
│   │
│   ├── types/
│   │   ├── index.ts                 # Shared types: Page, UserRole, ToolItem, ApiProvider
│   │   └── aistclaw/                # Aistclaw-specific types
│   │
│   ├── constants/
│   │   └── aistclaw/                # Aistclaw constants (AISTCLAW_BASE_PATH, etc.)
│   │
│   ├── i18n/
│   │   └── aistclaw/                # i18n translations for Aistclaw UI
│   │
│   ├── api/
│   │   └── aistclaw/                # Aistclaw API integration layer
│   │
│   ├── integrations/
│   │   └── supabase/
│   │       └── client.ts            # Supabase client (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
│   │
│   └── backend/                     # Go backend source
│       ├── main.go                  # Engine supervisor entry point
│       ├── engine/                  # llama.cpp wrapper + hardware detection
│       ├── aistclaw/                # Enterprise backend (teams, agents, workflows)
│       ├── server/                  # HTTP route handlers (grouped route modules)
│       ├── migrations/              # PostgreSQL schema migrations
│       └── skills/                  # Document processing (PDF, DOCX, XLSX, PPTX)
│
├── extensions/
│   ├── backend/
│   │   └── aistclaw.exe             # Compiled Aistclaw backend binary
│   └── backends/                    # Pre-built llama.cpp runtime binaries
│       ├── llama.cpp-win-x86_64-avx2-*/              # CPU-only builds
│       └── llama.cpp-win-x86_64-nvidia-cuda-avx2-*/  # NVIDIA CUDA builds
│
├── data/                            # Runtime JSON data files (backend-local persistence)
│   ├── providers.json               # Configured API providers
│   ├── mcp_servers.json             # MCP server configurations
│   ├── users.json                   # Local user accounts
│   ├── auth_sessions.json           # Session tokens
│   └── provider_model_prefs.json    # Model preferences per provider
│
├── supabase/
│   └── functions/
│       ├── api-proxy/               # OpenAI-compatible API proxy (validates sk-ais- tokens, logs usage)
│       ├── mcp-proxy/               # MCP server proxy for remote servers
│       ├── tool-execute/            # web-search (DuckDuckGo) + url-fetch (HTML→text)
│       └── hello/                   # Health check function
│
├── public/                          # Static assets (favicon, icons)
├── dist/                            # Vite production build output
├── electron-dist/                   # Compiled Electron main process
│
├── package.json                     # Dependencies + scripts
├── vite.config.ts                   # Vite config + path aliases (@/* and @aistclaw/*)
├── tsconfig.json                    # TypeScript project references
├── tsconfig.app.json                # App TS config
├── tsconfig.electron.json           # Electron TS config
├── tsconfig.node.json               # Node TS config
├── components.json                  # shadcn/ui config
├── eslint.config.js                 # ESLint rules
├── .env                             # Supabase + API credentials
└── .env.local                       # Local overrides (gitignored)
```

---

## Path Aliases

Configured in both `vite.config.ts` and `tsconfig.json`:

| Alias | Resolves to |
|---|---|
| `@/*` | `src/*` |
| `@aistclaw/api/*` | `src/api/aistclaw/*` |
| `@aistclaw/components/*` | `src/components/aistclaw/*` |
| `@aistclaw/constants/*` | `src/constants/aistclaw/*` |
| `@aistclaw/hooks/*` | `src/hooks/aistclaw/*` |
| `@aistclaw/i18n` | `src/i18n/aistclaw/index.ts` |
| `@aistclaw/lib/*` | `src/lib/aistclaw/*` |
| `@aistclaw/pages/*` | `src/pages/aistclaw/*` |
| `@aistclaw/routes` | `src/aistclaw-routes.tsx` |
| `@aistclaw/stores/*` | `src/stores/aistclaw/*` |
| `@aistclaw/types/*` | `src/types/aistclaw/*` |

---

## Key Data Files

| File | Purpose |
|---|---|
| `data/providers.json` | API provider configs (name, baseUrl, apiKey, enabled) |
| `data/mcp_servers.json` | MCP server list (id, name, url, enabled) |
| `data/users.json` | Local user accounts |
| `data/auth_sessions.json` | Active session tokens |
| `data/provider_model_prefs.json` | Saved model selections per provider |

---

## localStorage Keys

| Key | Store | Contents |
|---|---|---|
| `chat-store` | chatStore | Tabs, messages, active tab |
| `settings-store` | settingsStore | All app settings |
| `ai-server:downloads` | useDownloadManager | Download queue state |
| `ai-server-providers` | Index.tsx | Provider list fallback |
| `ai-server-theme` | Index.tsx | `dark` / `light` |
| `ai-server-chat-sessions-open` | Index.tsx | Sessions panel visibility |
| `ai-server-force-offline` | Index.tsx | Force offline mode flag |
| `ai-server-tools-config` | api.ts | Tool configs (versioned, v6) |
| `ai-server-mcp-servers` | mcpOperations.ts | MCP server list |
| `app:settings:paths` | ModelsPage / PathsTab | Models directory path |

---

## Backend Route Groups

The Go server registers route modules in this order:

1. `models` — model lifecycle (load, unload, list, available)
2. `chat` — `/v1/chat/completions` (streaming SSE)
3. `providers` — cloud provider CRUD + proxy (chat, image, audio)
4. `settings` — app settings
5. `auth/data` — auth routes + local data file access
6. `tools` — `/v1/tools/execute`
7. `agent runs` — `/v1/agent/chat`
8. `system` — `/v1/system/status`, `/v1/system/backends`, `/v1/system/usage`
9. `config` — `/v1/config`
10. `tasks` — task management
11. `components` — component registry
12. `events` — event streaming
