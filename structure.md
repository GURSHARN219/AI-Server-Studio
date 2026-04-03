# AI Server Studio — Project Structure & Architecture

> **Tech Stack**: React 18 + TypeScript · Vite · Tailwind CSS · Framer Motion · Supabase (Auth, DB, Edge Functions) · Lucide Icons

---

## Directory Tree

```
open-studio-main/
├── index.html                       # SPA entry point
├── package.json                     # deps & scripts (dev / build / preview)
├── vite.config.ts                   # Vite config, path alias @/ → src/
├── tailwind.config.ts               # Design tokens (colors, radii, keyframes)
├── tsconfig.app.json                # TS paths & strict settings
├── vitest.config.ts                 # Unit-test runner config
│
├── public/                          # Static assets (favicon, etc.)
│
├── supabase/
│   ├── config.toml                  # Supabase project config
│   ├── functions/                   # Deno-based Edge Functions
│   │   ├── api-proxy/               # Proxies LLM API calls (adds auth header)
│   │   ├── mcp-proxy/               # Proxies remote MCP server calls
│   │   ├── tool-execute/            # Server-side tool execution
│   │   └── hello/                   # Health-check function
│   └── migrations/                  # 6 SQL migrations (auth, profiles, providers, usage, api_keys, knowledge)
│
├── extensions/                      # Local inference and plugin runtimes
│   ├── backends/                    # Precompiled engine binaries (e.g. llama.cpp for CUDA, AVX2, Vulkan)
│   ├── frameworks/                  # Additional framework runtimes
│   └── plugins/                     # Plugin assets (e.g. bundled MCP servers)
│
├── mcp/                             # MCP server utilities / configs
│
└── src/
    ├── main.tsx                      # ReactDOM.createRoot entry
    ├── App.tsx                       # Router (BrowserRouter → Index | NotFound)
    ├── index.css                     # Global CSS + Tailwind directives
    ├── App.css                       # App-level overrides
    │
    ├── pages/                        # Route-level page components
    │   ├── Index.tsx                 # 🏠 Shell: sidebar + page router + global state
    │   ├── ChatPage.tsx              # 💬 Thin wrapper (22 lines) → useChatLogic + ChatUI
    │   ├── SettingsPage.tsx          # ⚙️  Settings panel (tabs: profile, providers, MCP, tools, etc.)
    │   ├── ModelsPage.tsx            # 🧠 Model browser / download manager
    │   ├── DiscoverPage.tsx          # 🔍 LLM discovery & community
    │   ├── ServerPage.tsx            # 🖥️  Local inference server dashboard
    │   ├── ApiGatewayPage.tsx        # 🔑 API key management & endpoint config
    │   ├── AccountPage.tsx           # 👤 User account page
    │   ├── AuthPage.tsx              # 🔐 Sign-in / sign-up page
    │   └── NotFound.tsx              # 404 fallback
    │
    ├── components/
    │   ├── IconSidebar.tsx           # Main navigation sidebar (icon bar)
    │   ├── NavLink.tsx               # Sidebar link component
    │   ├── ModelConfigPanel.tsx      # Right-side panel for model settings (temp, top-p, etc.)
    │   ├── KeyboardShortcuts.tsx     # Global keyboard shortcut handler
    │   ├── JsonEditorTab.tsx         # JSON editor for raw config editing
    │   │
    │   ├── chat/                     # Extracted chat sub-components
    │   │   ├── types.ts              # Shared types: Message, AgentMode, ChatTab, ModelDef, ModelSource
    │   │   ├── useChatLogic.tsx      # ★ All chat state + logic hook (555 lines)
    │   │   ├── ChatUI.tsx            # ★ Pure render component (380 lines)
    │   │   ├── CodeBlock.tsx         # Syntax-highlighted code block with copy button (memo)
    │   │   ├── MessageBubble.tsx     # Chat message renderer: markdown, tool calls, thinking (memo)
    │   │   └── SessionsSidebar.tsx   # Left sidebar with session list, search, tabs (memo)
    │   │
    │   ├── settings/                 # Extracted settings sub-components
    │   │   ├── Primitives.tsx        # Shared UI: Toggle, InputField, SelectField, ToggleField
    │   │   ├── ProfileTab.tsx        # Profile, password, usage stats, sign-out
    │   │   └── ProvidersTab.tsx      # CRUD for API providers (OpenAI, Anthropic, etc.)
    │   │
    │   └── ui/                       # shadcn/ui component library (~40+ components)
    │       ├── button.tsx, dialog.tsx, toast.tsx, toaster.tsx, sonner.tsx, ...
    │       └── (standard shadcn primitives)
    │
    ├── lib/                          # Core business logic
    │   ├── api.ts                    # 🔧 Central API layer (types, tool configs, built-in tools, MCP, streaming)
    │   ├── toolExecutor.ts           # ★ Tool dispatch: routes to MCP or built-in tool
    │   ├── chatLogic.ts             # ★ Hybrid Memory prompt builder (STM + LTM/RAG)
    │   └── utils.ts                  # Utility (cn() for classnames)
    │
    ├── hooks/                        # Custom React hooks
    │   ├── useAuth.ts                # Supabase auth state (user, session, signOut)
    │   ├── use-toast.ts              # Toast notification system
    │   └── use-mobile.tsx            # Responsive breakpoint hook
    │
    ├── integrations/supabase/
    │   ├── client.ts                 # Supabase client instance (@supabase/supabase-js)
    │   └── types.ts                  # Generated DB types (tables, views, functions)
    │
    └── test/
        ├── setup.ts                  # Vitest setup
        └── example.test.ts           # Example test
```

---

## Architecture Overview

```
┌───────────────────────────────────────────────────────────────┐
│                       Browser (SPA)                           │
│                                                               │
│  App.tsx → BrowserRouter → Index.tsx (Shell)                  │
│  ┌─────────────┐  ┌────────────────────────────────────┐      │
│  │ IconSidebar  │  │  Active Page                      │      │
│  │ (nav icons)  │  │  ┌── ChatPage ──────────────────┐ │      │
│  │              │  │  │ useChatLogic (hook)           │ │      │
│  │  💬 Chat     │  │  │   ↓                           │ │      │
│  │  🔍 Discover │  │  │ ChatUI (pure render)          │ │      │
│  │  🧠 Models   │  │  │   ├ SessionsSidebar           │ │      │
│  │  🖥️ Server   │  │  │   ├ MessageBubble + CodeBlock │ │      │
│  │  🔑 API      │  │  │   ├ Model/Provider Picker     │ │      │
│  │  ⚙️ Settings │  │  │   └ Tool/MCP Config Panels    │ │      │
│  └─────────────┘  │  └────────────────────────────────┘ │      │
│                    │  ┌── SettingsPage ────────────────┐ │      │
│                    │  │ ProfileTab │ ProvidersTab      │ │      │
│                    │  │ MCP Tab    │ Tools Tab         │ │      │
│                    │  └────────────────────────────────┘ │      │
│                    └────────────────────────────────────┘      │
│                                                               │
│  ┌──────── lib/ ──────────────────────────────────────┐       │
│  │ api.ts         → types, tools, MCP, streaming      │       │
│  │ toolExecutor   → MCP dispatch vs built-in          │       │
│  │ chatLogic      → hybrid memory / RAG injection     │       │
│  └────────────────────────────────────────────────────┘       │
└────────────────────────────┬──────────────────────────────────┘
                             │  HTTPS / WebSocket
                 ┌───────────▼───────────┐
                 │   Supabase Backend    │
                 │  ┌─────────────────┐  │
                 │  │  Auth (JWT)     │  │
                 │  │  PostgreSQL DB  │  │
                 │  │  Edge Functions │  │
                 │  │  ├ api-proxy    │  │
                 │  │  ├ mcp-proxy    │  │
                 │  │  └ tool-execute │  │
                 │  └─────────────────┘  │
                 └───────────────────────┘
```

---

## Detailed Workflows

### 1. Authentication Flow

```
AuthPage.tsx
    ↓ supabase.auth.signInWithPassword / signUp
useAuth.ts (hook)
    ↓ onAuthStateChange listener
    ↓ Returns { user, session, loading, signOut }
Index.tsx
    ↓ if (!user && !loading) → render <AuthPage />
    ↓ if (user) → render shell with pages
```

### 2. Chat Message Flow (Send → Stream → Display)

```
User types message → handleSend() in useChatLogic.tsx
    │
    ├─ 1. Create userMsg object (Message type from types.ts)
    ├─ 2. Append to messagesMap for active tab
    ├─ 3. Build apiMessages[] from history (user + assistant only)
    │
    ├─ 4. 🧠 Hybrid Memory Injection (chatLogic.ts)
    │      ├─ STM: last 6 messages as [CHAT] context
    │      ├─ LTM: (priority) MCP "rag_search" → Qdrant local
    │      └─ LTM: (fallback) built-in "rag-cloud" → Supabase
    │      └─ Inject into last user message via template
    │
    ├─ 5. Collect enabled tools (built-in + MCP)
    ├─ 6. Check selectedModel.supportsTools — if true, use function-calling API
    │
    ├─ 7a. Tool-calling path (sendChatCompletionWithTools):
    │       ├─ Non-streaming POST with tools[]
    │       ├─ If tool_calls → executeToolCall() → append results → loop
    │       └─ If content only → display and break
    │
    ├─ 7b. Streaming path (sendChatCompletionStreaming):
    │       ├─ SSE stream: parse "data:" lines
    │       └─ Accumulate tokens → update assistant message
    │
    └─ 8. Both paths wrapped with fetchWithRetry (429 backoff)
```

### 3. Tool Execution Pipeline

```
executeToolCall(name, args, mcpToolDefs, mcpServers, executionMode)
    │                                    (lib/toolExecutor.ts)
    │
    ├─ Is MCP tool? → find matching server → executeMcpToolCall()
    │   └─ POST to server.url with JSON-RPC (tools/call)
    │       └─ If remote → proxied via supabase edge "mcp-proxy"
    │
    └─ Is Built-in? → executeBuiltInTool(name, parsedArgs, executionMode)
        ├─ canExecute() check (capabilities vs mode)
        ├─ js-sandbox    → safe math evaluator (no eval/Function)
        ├─ web-search    → Brave Search API via supabase edge
        ├─ url-fetch     → HTTP fetch via supabase edge
        ├─ current-time  → Date.now()
        ├─ calculator    → safe recursive-descent parser
        ├─ json-transform → JSON manipulation
        ├─ random-generator → crypto-safe random
        ├─ base64        → btoa/atob
        ├─ hash          → SubtleCrypto SHA-256
        ├─ file-read     → supabase user_files table
        ├─ rag-cloud     → Supabase documents table (full-text search)
        └─ rag-local     → ⚠️ STUB (returns "not available yet")
```

### 4. Execution Mode System

| Mode | Behavior | UI Indicator |
|------|----------|--------------|
| `offline` | Only local tools. Cloud tools return graceful errors. | 🟢 Green dot |
| `hybrid` | Prefer local, fallback to cloud. **Default**. | 🔵 Blue dot |
| `full` | All tools unrestricted. Full cloud access. | 🟣 Purple dot |

- Persisted in `localStorage` key `ai-server-execution-mode`.
- Toggled via button in chat input bar (cycles: offline → hybrid → full).
- Passed to `executeToolCall()` and `buildHybridMemoryPrompt()`.
- Enforcement via `canExecute()` checks tool `capabilities` against mode.

### 5. Hybrid Memory Architecture (chatLogic.ts)

```
buildHybridMemoryPrompt(userInput, recentMessages, executionMode, mcpToolDefs, mcpServers)
    │
    ├─ STM (Short-Term Memory)
    │   └─ Last 6 messages → [CHAT][score: 1.0] ROLE: content
    │
    ├─ LTM (Long-Term Memory)
    │   ├─ Priority 1: MCP RAG server (tool named "rag_search")
    │   │   → Semantic vector search via local Qdrant
    │   └─ Priority 2: Cloud RAG ("rag-cloud" built-in)
    │       → Only if local unavailable AND mode ≠ "offline"
    │
    └─ Result: HYBRID_RAG_TEMPLATE with {chat_context}, {global_context}, {user_input}
```

### 6. Capability-Based Tool System

Each tool has a `capabilities` array and a `layer` field:
```ts
type Capability = "local:compute" | "local:exec" | "local:fs" | "local:db" | "local:rag"
                | "net:http" | "net:api" | "net:git"
                | "cloud:storage" | "cloud:db";

type Layer = "local" | "edge" | "api" | "hybrid";
```

UI renders color-coded badges per capability prefix:
- 🟢 `local:*` → green badge
- 🔵 `net:*` → blue badge
- 🟣 `cloud:*` → purple badge

### 7. Provider Management Flow

```
ProvidersTab.tsx (extracted component)
    ├─ fetchProviders() → supabase.from("api_providers").select("*")
    ├─ handleAddProvider() → insert with XOR-encrypted API key
    ├─ handleToggleProvider() → update enabled field
    ├─ saveEdit() → update name, url, key
    └─ handleDeleteProvider() → delete by ID

Index.tsx (shell)
    ├─ Fetches providers from DB on mount
    ├─ Decrypts API keys (XOR + base64)
    ├─ Merges with INITIAL_PROVIDERS defaults
    └─ Passes decrypted providers to ChatPage
```

### 8. Model Selection & Streaming

```
useChatLogic: models state
    ├─ Local models: fetched from localhost:1234/v1/models (llama.cpp)
    ├─ Cloud models: fetched from provider.baseUrl/models per enabled provider
    └─ Provider picker + model picker in ChatUI input bar

streamChat / sendChatCompletionWithTools
    ├─ POST to provider.baseUrl/chat/completions
    │   └─ Headers: Authorization Bearer <decrypted-key>
    ├─ fetchWithRetry: handles 429 with exponential backoff (max 3 retries)
    └─ SSE parser accumulates content + tool_calls + thinking tokens
```

### 9. Chat Component Architecture

```
ChatPage.tsx (22 lines — thin wrapper)
    ├─ useChatLogic(props) → returns all state + handlers (555 lines)
    └─ <ChatUI {...logic} /> → pure render (380 lines)

ChatUI renders:
    ├─ SessionsSidebar (memo) — session list, search, tabs
    ├─ Message area — maps messages → MessageBubble (memo)
    │   └─ MessageBubble → CodeBlock (memo) for code blocks
    ├─ Input bar:
    │   ├─ Agent mode picker (chat, create-image, canvas, etc.)
    │   ├─ Image attach (paste / file)
    │   ├─ Tool config panel (toggle built-in tools)
    │   ├─ MCP server panel (toggle MCP servers)
    │   ├─ Provider picker
    │   ├─ Execution mode toggle (offline/hybrid/full)
    │   └─ Model picker (search, capabilities badges)
    └─ JsonEditorTab — raw JSON editing for tools/MCP configs
```

---

## Database Schema (Supabase)

| Table | Purpose |
|-------|---------|
| `profiles` | User display_name, avatar_url (RLS: own row) |
| `api_providers` | Saved providers: name, type, base_url, encrypted key, enabled |
| `api_keys` | User API keys for the gateway endpoint |
| `api_usage_logs` | Per-request logging: model, tokens_in/out, latency_ms |
| `mcp_servers` | Saved MCP server configs (name, url, headers, enabled, status) |
| `documents` | RAG knowledge base: content, metadata, full-text search (fts) |
| `chat_sessions` | Persisted chat sessions (title, messages JSON) |

---

## Edge Functions

| Function | Route | Purpose |
|----------|-------|---------|
| `api-proxy` | `/functions/v1/api-proxy` | Proxies LLM API calls, injects auth keys server-side |
| `mcp-proxy` | `/functions/v1/mcp-proxy` | Proxies remote MCP servers (avoids CORS, hides keys) |
| `tool-execute` | `/functions/v1/tool-execute` | Executes tools server-side (web-search, url-fetch) |
| `hello` | `/functions/v1/hello` | Health check |

---

## Key Techniques

| Technique | Where | Description |
|-----------|-------|-------------|
| `React.memo()` | CodeBlock, MessageBubble, SessionsSidebar | Prevents re-renders on parent state changes |
| Custom hook extraction | `useChatLogic` | Separates state/logic from render (555 vs 380 lines) |
| `useRef` for stale closure | `messagesMapRef` in useChatLogic | Avoids reading stale state in async `handleSend` |
| Safe math parser | `safeEvalMath()` in api.ts | Recursive-descent (no `eval`/`new Function`) |
| XOR key obfuscation | `encryptApiKey()` / `decryptApiKey()` | Base64-wrapped XOR with fixed key |
| `fetchWithRetry` | api.ts streaming/tool calls | Exponential backoff on 429 (respects Retry-After header) |
| `canExecute()` | api.ts → executeBuiltInTool | Checks tool capabilities against execution mode |
| Hybrid Memory | chatLogic.ts | STM (last 6 msgs) + LTM (MCP RAG → Cloud RAG fallback) |
| localStorage persistence | useChatLogic | Tabs, messages, active tab, execution mode |
| Tool version bumping | `TOOLS_VERSION` in api.ts | Force-refreshes cached tool configs on capability schema changes |

---

## Scripts

| Command | Action |
|---------|--------|
| `npm run dev` | Start Vite dev server (HMR) |
| `npm run build` | Production build via `tsc && vite build` |
| `npm run preview` | Preview production build locally |
| `npx tsc --noEmit` | Type-check only |
| `npx vitest run` | Run unit tests |

---

## File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| `SettingsPage.tsx` | ~1142 | Settings tabs (partially decomposed) |
| `api.ts` | ~1068 | Types, tool defs, built-in tools, streaming, MCP |
| `ServerPage.tsx` | ~850 | Local server dashboard |
| `ApiGatewayPage.tsx` | ~700 | API key management |
| `DiscoverPage.tsx` | ~700 | Model discovery |
| `useChatLogic.tsx` | ~555 | Chat state + logic (extracted from ChatPage) |
| `Index.tsx` | ~420 | App shell + global state |
| `ChatUI.tsx` | ~380 | Chat render component |
| `ModelsPage.tsx` | ~300 | Model browser |
| `chatLogic.ts` | ~93 | Hybrid memory builder |
| `toolExecutor.ts` | ~39 | Tool dispatch router |
| `ChatPage.tsx` | ~22 | Thin wrapper |

---

## Known Bugs & Incomplete Functions

### 🔴 Critical

1. **Orphaned provider functions in SettingsPage.tsx (lines 231-303)** — `fetchProviders`, `handleAddProvider`, `handleDeleteProvider`, `handleToggleProvider`, `startEdit`, `saveEdit` all reference `supabase`, `setDbProviders`, `setLoadingProviders`, `encryptApiKey`, `setVisibleKeys`, `setEditingProvider`, `setEditValues`, `setShowAddProvider`, `setNewProviderName/Url/Key/Type`, `DbProvider` — none of which are defined or imported. Will crash at runtime. **Fix**: delete lines 220-303 entirely (already extracted to `ProvidersTab.tsx`).

2. **Duplicate Toggle/InputField in SettingsPage.tsx (lines 305-340+)** — Local `Toggle`, `InputField`, `SelectField`, `ToggleField` shadow the imported versions from `Primitives.tsx` (line 5). The local definitions will be used instead of the extracted primitives, defeating the Primitives extraction. **Fix**: delete the local definitions.

### 🟡 Medium

3. **`rag-local` tool is a stub** (api.ts line 772) — Returns a hardcoded string: *"not indexed or available yet"*. Enabled by default (`enabled: true` in `loadToolConfigs`), which means the LLM will try to call it and get a useless response. **Fix**: set `enabled: false` by default, or implement local RAG.

4. **`user_files` table missing from migrations** — `file-read` tool (api.ts line 700) queries `supabase.from("user_files")`, but no migration creates this table. Will return DB errors at runtime. **Fix**: add migration or disable by default.

5. **`documents` table `fts` column may not exist** — `rag-cloud` tool (line 738) uses `.textSearch("fts", ...)` which requires a generated tsvector column named `fts`. If migrations don't create this, the primary search path fails (falls back to `ilike`). **Verify**: check migration SQL for `fts` column.

6. **`PROVIDER_PRESETS` orphaned** (SettingsPage.tsx line 220) — Used only in orphaned `handleAddProvider` (line 257). Dead code after ProvidersTab extraction.

### 🟢 Low

7. **`fetchWithRetry` retries with consumed body** — On 429 retry, the `RequestInit` object with `body: JSON.stringify(...)` is reused. The `body` is a string (not a ReadableStream), so it can be re-read. This is fine, but if `signal.aborted` between retries, the DOMException may not propagate correctly in all browsers — consider checking abort before each retry attempt (partially done at line 929).

8. **System prompt references `rag` instead of `rag-cloud`/`rag-local`** — In useChatLogic.tsx line 391, the system prompt says *"When the user asks about stored knowledge/notes → call rag"* but the actual tool IDs are `rag-cloud` and `rag-local`. The LLM may try to call `rag` which will hit the `default` case and error.

9. **`handleRegenerate` clears message but sets input** — It removes the assistant message and puts the previous user message back in the input box, but doesn't auto-send. The user has to manually press Enter. This is UX, not a bug, but worth noting.
