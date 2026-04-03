# Architecture Overview

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [Diagrams](#4-diagrams)
   - [4.1 High-Level System Architecture](#41-high-level-system-architecture)
   - [4.2 Process Architecture](#42-process-architecture)
   - [4.3 Frontend Page & Component Tree](#43-frontend-page--component-tree)
   - [4.4 Chat Message Flow](#44-chat-message-flow)
   - [4.5 Tool Execution Flow](#45-tool-execution-flow)
   - [4.6 Engine HTTP API](#46-engine-http-api)
   - [4.7 Download Manager Flow](#47-download-manager-flow)
   - [4.8 Supabase Database Schema (ERD)](#48-supabase-database-schema-erd)
   - [4.9 Auth & Session Flow](#49-auth--session-flow)
   - [4.10 Settings Data Flow](#410-settings-data-flow)
   - [4.11 MCP Integration Flow](#411-mcp-integration-flow)
   - [4.12 Backend Selection Flow](#412-backend-selection-flow)
   - [4.13 State Management Map](#413-state-management-map)
   - [4.14 API Gateway Flow](#414-api-gateway-flow)
5. [Application Entry Points](#5-application-entry-points)
6. [Electron Shell](#6-electron-shell)
7. [Local Engine Layer](#7-local-engine-layer)
8. [Backend Extensions](#8-backend-extensions)
9. [Local Daemon & MCP Plugins](#9-local-daemon--mcp-plugins)
10. [Frontend Pages](#10-frontend-pages)
11. [Settings System](#11-settings-system)
12. [Chat System](#12-chat-system)
13. [Server Monitor Page](#13-server-monitor-page)
14. [Models Page](#14-models-page)
15. [Discover Page](#15-discover-page)
16. [API Gateway Page](#16-api-gateway-page)
17. [Tool System](#17-tool-system)
18. [MCP Integration](#18-mcp-integration)
19. [Download Manager](#19-download-manager)
20. [Supabase Integration](#20-supabase-integration)
21. [Auth System](#21-auth-system)
22. [State Management & Data Flow](#22-state-management--data-flow)
23. [Component Inventory](#23-component-inventory)
24. [API Reference (Engine)](#24-api-reference-engine)
25. [Key Data Types](#25-key-data-types)
26. [Current Implementation Addendum (April 2026)](#26-current-implementation-addendum-april-2026)

---

## 1. Project Summary


AI Server is a desktop application built with Electron + React (Vite) that provides a local AI inference environment. It bundles a llama.cpp engine, exposes an OpenAI-compatible HTTP API on `localhost:1234`, and wraps everything in a polished chat UI with cloud provider fallback, tool use, MCP server support, model discovery, and a Supabase-backed API gateway.

The app targets Windows x86_64 and ships multiple pre-built llama.cpp backends covering CPU-only (AVX2), NVIDIA CUDA (CUDA 11 and CUDA 12), and Vulkan GPU acceleration.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron (main + preload) |
| Frontend framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Animations | Framer Motion |
| Routing | React Router v6 |
| Server state | TanStack Query (React Query) |
| Backend DB | Supabase (PostgreSQL + Auth + Edge Functions) |
| Local inference | llama.cpp via Node.js native bindings (.node) |
| Package manager | Bun |
| Linting | ESLint |
| Testing | Vitest |

---

## 4. Diagrams

### 4.1 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ELECTRON DESKTOP APP                                │
│                                                                             │
│  ┌─────────────────┐   spawns   ┌──────────────────────────────────────┐   │
│  │  electron/      │ ─────────► │  ENGINE PROCESS  (Node.js)           │   │
│  │  main.ts        │            │  backendLoader → llamaEngine          │   │
│  │  Main Process   │            │  openaiServer  :1234                  │   │
│  │  IPC handlers   │            │  hardwareInfo                         │   │
│  └────────┬────────┘            └──────────────┬───────────────────────┘   │
│           │ spawns                             │ require(.node)             │
│           │                    ┌───────────────▼───────────────────────┐   │
│           │                    │  BACKENDS  extensions/backends/        │   │
│           │                    │  ├─ llama.cpp AVX2        (CPU only)   │   │
│           │                    │  ├─ llama.cpp CUDA 11     (NVIDIA)     │   │
│           │                    │  ├─ llama.cpp CUDA 12     (NVIDIA)     │   │
│           │                    │  └─ llama.cpp Vulkan      (any GPU)    │   │
│           │                    └───────────────────────────────────────┘   │
│           │ spawns                                                          │
│           │            ┌────────────────────────────────────────────────┐  │
│           │            │  DAEMON PROCESS  (Node.js)  :4000              │  │
│           │            │  daemon.ts  ──► rag/server.js      :4001       │  │
│           │            │               └► sandbox/server.js :4002       │  │
│           │            └────────────────────────────────────────────────┘  │
│           │ loads                                                           │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  CHROMIUM RENDERER  (React + Vite)                                  │   │
│  │  electron/preload.ts  contextBridge → window.electron               │   │
│  │                                                                     │   │
│  │  HTTP :1234 ──► Engine       supabase-js ──► Supabase Cloud         │   │
│  │  HTTP :4000 ──► Daemon       fetch ──────────► HuggingFace          │   │
│  │  HTTP :4001 ──► RAG          OpenAI-compat ──► Cloud Providers      │   │
│  │  HTTP :4002 ──► Sandbox                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐    ┌──────────────────────────────────────────┐
│  SUPABASE CLOUD          │    │  EXTERNAL SERVICES                       │
│  ├─ Auth (email/OAuth)   │    │  ├─ HuggingFace API  (model catalog)     │
│  ├─ PostgreSQL           │    │  ├─ HuggingFace CDN  (GGUF downloads)    │
│  │  api_keys             │    │  ├─ OpenAI                               │
│  │  api_providers        │    │  ├─ Anthropic                            │
│  │  api_usage_logs       │    │  ├─ Google AI                            │
│  │  documents            │    │  ├─ Mistral AI                           │
│  │  mcp_servers          │    │  ├─ Groq                                 │
│  │  profiles             │    │  ├─ Together AI                          │
│  │  user_files           │    │  └─ OpenRouter                           │
│  └─ Edge Functions       │    └──────────────────────────────────────────┘
│     tool-execute         │
│     api-proxy            │
└──────────────────────────┘
```

```mermaid
graph TB
    subgraph ELECTRON["Electron Desktop App"]
        direction TB
        MAIN["electron/main.ts\nMain Process"]
        PRELOAD["electron/preload.ts\nContext Bridge"]
        RENDERER["Chromium Renderer\nReact + Vite"]
    end

    subgraph ENGINE_PROC["Engine Process  (Node.js)"]
        direction TB
        BACKEND_LOADER["backendLoader.ts\nSelects best .node backend"]
        LLAMA["llamaEngine.ts\nLlamaEngine class"]
        OAI_SERVER["openaiServer.ts\nExpress HTTP :1234"]
        HW["hardwareInfo.ts\nCPU / GPU / RAM"]
    end

    subgraph DAEMON_PROC["Daemon Process  (Node.js)  :4000"]
        direction TB
        DAEMON["daemon.ts\nPlugin manager"]
        RAG_SRV["mcp/rag/server.js\n:4001  rag_search / rag_store"]
        SANDBOX_SRV["mcp/sandbox/server.js\n:4002  run_js / run_python"]
    end

    subgraph BACKENDS["extensions/backends/  (.node binaries)"]
        B1["llama.cpp AVX2\nCPU only"]
        B2["llama.cpp CUDA 11\nNVIDIA GPU"]
        B3["llama.cpp CUDA 12\nNVIDIA GPU"]
        B4["llama.cpp Vulkan\nCross-vendor GPU"]
    end

    subgraph SUPABASE["Supabase Cloud"]
        direction TB
        AUTH["Auth\n(email / OAuth)"]
        DB["PostgreSQL\napi_keys · api_providers\napi_usage_logs · documents\nmcp_servers · profiles\nuser_files"]
        EDGE["Edge Functions\ntool-execute\napi-proxy"]
    end

    subgraph HF["HuggingFace"]
        HF_API["HF API\nmodel catalog"]
        HF_CDN["HF CDN\nGGUF downloads"]
    end

    subgraph CLOUD_PROVIDERS["Cloud AI Providers"]
        OAI["OpenAI"]
        ANT["Anthropic"]
        GGL["Google AI"]
        MST["Mistral / Groq\nTogether / OpenRouter"]
    end

    MAIN -->|"spawns"| ENGINE_PROC
    MAIN -->|"spawns"| DAEMON_PROC
    MAIN -->|"loads"| RENDERER
    PRELOAD -->|"contextBridge\nwindow.electron"| RENDERER

    BACKEND_LOADER -->|"require(.node)"| BACKENDS
    BACKEND_LOADER --> LLAMA
    LLAMA --> OAI_SERVER
    HW --> OAI_SERVER

    DAEMON -->|"spawn node"| RAG_SRV
    DAEMON -->|"spawn node"| SANDBOX_SRV

    RENDERER -->|"HTTP poll :1234"| OAI_SERVER
    RENDERER -->|"HTTP"| DAEMON_PROC
    RENDERER -->|"supabase-js"| SUPABASE
    RENDERER -->|"fetch GGUF"| HF_CDN
    RENDERER -->|"fetch catalog"| HF_API
    RENDERER -->|"OpenAI-compat REST"| CLOUD_PROVIDERS

    EDGE -->|"proxies to"| CLOUD_PROVIDERS
```

---

### 4.2 Process Architecture

```
  Windows OS
  ══════════════════════════════════════════════════════════════════════
  │
  ├─► [Electron Main]  (Node.js)
  │     electron/main.ts
  │     BrowserWindow · IPC handlers
  │     │
  │     ├─ spawn ──► [Engine Process]  (Node.js child)
  │     │              openaiServer.ts  Express :1234
  │     │              llamaEngine.ts   LlamaEngine
  │     │              ▲
  │     │              └─ require(.node) ──► llm_engine_[cuda12|cuda|vulkan|].node
  │     │
  │     ├─ spawn ──► [Daemon Process]  (Node.js child)
  │     │              daemon.ts  Express :4000
  │     │              │
  │     │              ├─ spawn ──► [RAG Server]      :4001
  │     │              │              mcp/rag/server.js
  │     │              │              tools: rag_search, rag_store
  │     │              │
  │     │              └─ spawn ──► [Sandbox Server]  :4002
  │     │                             mcp/sandbox/server.js
  │     │                             tools: run_js, run_python
  │     │
  │     └─ IPC ◄──────► [Renderer]  (Chromium)
  │          minimize/maximize        React App  src/
  │          close/open-path          │
  │                                   ├─ HTTP fetch ──► :1234  (engine)
  │                                   ├─ HTTP fetch ──► :4000  (daemon)
  │                                   ├─ HTTP fetch ──► :4001  (rag)
  │                                   └─ HTTP fetch ──► :4002  (sandbox)
  ══════════════════════════════════════════════════════════════════════
```

```mermaid
graph LR
    subgraph OS["Windows Process Tree"]
        direction TB

        subgraph EP["Electron Main  (Node.js)"]
            M["main.ts\nBrowserWindow\nIPC handlers"]
        end

        subgraph RP["Renderer  (Chromium)"]
            R["React App\nsrc/"]
        end

        subgraph ENG["Engine  (Node.js child)"]
            E["openaiServer.ts\nExpress :1234\n+ llamaEngine.ts"]
        end

        subgraph DP["Daemon  (Node.js child)"]
            D["daemon.ts\nExpress :4000"]
            R1["rag/server.js\n:4001"]
            R2["sandbox/server.js\n:4002"]
            D -->|"spawn"| R1
            D -->|"spawn"| R2
        end
    end

    M -->|"spawn ChildProcess"| ENG
    M -->|"spawn ChildProcess"| DP
    M <-->|"IPC\nminimize/maximize\nclose/open-path"| RP
    RP -->|"HTTP fetch\nlocalhost:1234"| ENG
    RP -->|"HTTP fetch\nlocalhost:4000"| DP
    RP -->|"HTTP fetch\nlocalhost:4001"| R1
    RP -->|"HTTP fetch\nlocalhost:4002"| R2
```

---

### 4.3 Frontend Page & Component Tree

```
App.tsx
└── Index.tsx  (shell · auth gate · page router)
    │   useAuth · useLocalEngine · useDownloadManager
    │
    ├── [Layout]
    │   ├── Custom Titlebar  (window.electron: minimize/maximize/close)
    │   ├── IconSidebar      (page nav · download badge)
    │   └── Status Bar       (role switcher · token count · engine status)
    │
    ├── [Overlays]
    │   ├── KeyboardShortcuts   (Ctrl+N / Ctrl+, / Ctrl+1-5)
    │   ├── SettingsPage        (modal)
    │   ├── DownloadManager     (modal)
    │   └── ModelConfigPanel    (slide-in drawer)
    │
    └── [Pages]  — driven by currentPage state
        │
        ├── ChatPage
        │   └── ChatUI
        │       ├── SessionsSidebar
        │       ├── MessageList
        │       │   └── MessageBubble
        │       │       └── CodeBlock
        │       └── Input Toolbar
        │           ├── ModelPicker
        │           ├── ProviderPicker
        │           ├── AgentPicker
        │           ├── ToolConfigPanel
        │           └── McpServersPanel
        │
        ├── DiscoverPage
        │   ├── DiscoverFilters  (search · kind · capability pills)
        │   ├── ModelList        (animated cards · download button)
        │   └── ModelDetail      (HF file fetch · variant picker · README)
        │
        ├── ModelsPage           (local .gguf list · load/unload · manual path)
        │
        ├── ServerPage
        │   ├── ServerHeader     (port · start/stop · URL)
        │   ├── WebSocketPanel   (HTTP poll status · uptime · latency)
        │   ├── LoadedModelsPanel
        │   ├── EndpointsPanel   (test buttons · custom endpoints)
        │   ├── DevLogs          (filter · search · pause · clear)
        │   └── ServerStats      (right sidebar)
        │
        ├── ApiGatewayPage
        │   ├── StatsRow         (requests · tokens · latency · error rate)
        │   ├── ApiKeysTab       (create · toggle · delete)
        │   ├── UsageTab         (by model aggregation)
        │   ├── LogsTab          (request log table)
        │   └── DocsTab          (Python/JS/cURL examples)
        │
        └── SettingsPage  (10 tabs)
            ├── Profile          ├── Basics
            ├── API Providers    ├── MCP Servers
            ├── Tools            ├── Server API
            ├── Paths            ├── Advanced
            ├── Runtime          └── Hardware
```

```mermaid
graph TD
    APP["App.tsx\nQueryClient · Router · Toaster"]
    INDEX["Index.tsx\nShell · Auth gate · Page router\nuseAuth · useLocalEngine\nuseDownloadManager"]

    APP --> INDEX

    INDEX --> SIDEBAR["IconSidebar\nPage navigation\nDownload badge"]
    INDEX --> TITLEBAR["Custom Titlebar\nwindow.electron controls"]
    INDEX --> STATUSBAR["Status Bar\nRole switcher · Token count\nEngine status · Model name"]
    INDEX --> SHORTCUTS["KeyboardShortcuts\nCtrl+N/,/1-5"]

    INDEX --> CHAT["ChatPage"]
    INDEX --> DISCOVER["DiscoverPage"]
    INDEX --> MODELS["ModelsPage"]
    INDEX --> SERVER["ServerPage"]
    INDEX --> API["ApiGatewayPage"]
    INDEX --> SETTINGS["SettingsPage  (modal)"]
    INDEX --> DLMGR["DownloadManager  (modal)"]
    INDEX --> MCFG["ModelConfigPanel  (drawer)"]

    CHAT --> CHATUI["ChatUI"]
    CHATUI --> SESSIONS["SessionsSidebar"]
    CHATUI --> MSGLIST["MessageList"]
    MSGLIST --> BUBBLE["MessageBubble\n+ CodeBlock"]
    CHATUI --> TOOLBAR["Input Toolbar\nModelPicker · ProviderPicker\nAgentPicker · ToolConfigPanel\nMcpServersPanel"]

    SERVER --> SH["ServerHeader"]
    SERVER --> WSP["WebSocketPanel"]
    SERVER --> LMP["LoadedModelsPanel"]
    SERVER --> EP2["EndpointsPanel"]
    SERVER --> LOGS["DevLogs"]
    SERVER --> STATS["ServerStats"]

    DISCOVER --> DF["DiscoverFilters"]
    DISCOVER --> ML["ModelList"]
    DISCOVER --> MD["ModelDetail\nfetchHfGgufFiles"]

    API --> SR["StatsRow"]
    API --> AKT["ApiKeysTab"]
    API --> UT["UsageTab"]
    API --> LT["LogsTab"]
    API --> DT["DocsTab"]

    SETTINGS --> STABS["10 Settings Tabs\nProfile · Basics · Providers\nMCP · Tools · API · Paths\nAdvanced · Runtime · Hardware"]
```

---

### 4.4 Chat Message Flow

```
  User types message + Enter
       │
       ▼
  useChatLogic.sendMessage(text)
       │
       ├─ append { role:"user", content } to session
       ├─ build ApiMessage[]  (full history)
       └─ build ToolDefinition[]  (enabled tools + MCP tools)
              │
              ├─── [Local Engine] ──► POST localhost:1234/v1/chat/completions
              │                           { stream:true, messages, tools }
              │                       ◄── SSE token stream
              │                           onToken() → update UI char-by-char
              │
              └─── [Cloud Provider] ──► POST provider.baseUrl/chat/completions
                                            { stream:true, messages, tools }
                                        ◄── SSE token stream
                                            onToken() → update UI char-by-char
       │
       ▼
  response.finish_reason === "tool_calls"?
       │
       YES ──► for each tool_call in response.tool_calls:
       │           │
       │           ├─ is MCP tool?
       │           │   YES ──► POST mcpServer.url
       │           │               { method:"tools/call",
       │           │                 params:{ name, arguments } }
       │           │           ◄── result string
       │           │
       │           └─ is built-in tool?
       │               YES ──► executeBuiltInTool(name, args, mode)
       │                           mode check → blocked? return error msg
       │                           web-search / url-fetch?
       │                               ──► supabase.functions.invoke("tool-execute")
       │                           else run locally
       │                       ◄── result string
       │
       │       append { role:"tool", tool_call_id, content:result }
       │       re-send full conversation  ◄── loop until no tool_calls
       │
       NO ──► append final { role:"assistant", content } to session
              update tokenCount → propagate to status bar
              persist session to localStorage
```

```mermaid
sequenceDiagram
    actor User
    participant UI as ChatUI
    participant Logic as useChatLogic
    participant API as src/lib/api.ts
    participant Engine as Engine :1234
    participant Cloud as Cloud Provider
    participant Tools as executeToolCall
    participant MCP as MCP Server

    User->>UI: types message + Enter
    UI->>Logic: sendMessage(text)
    Logic->>Logic: append user message to session
    Logic->>Logic: build ApiMessage[] + ToolDefinition[]

    alt Local Engine selected
        Logic->>Engine: POST /v1/chat/completions\n{stream:true, tools:[...]}
        Engine-->>Logic: SSE token stream
        Logic->>UI: onToken → update last message
        Engine-->>Logic: finish_reason
    else Cloud Provider selected
        Logic->>Cloud: POST /v1/chat/completions\n{stream:true, tools:[...]}
        Cloud-->>Logic: SSE token stream
        Logic->>UI: onToken → update last message
    end

    alt response has tool_calls
        loop for each tool_call
            Logic->>Tools: executeToolCall(name, args, mcpDefs, mcpServers, mode)
            alt is MCP tool
                Tools->>MCP: POST {method:"tools/call", params:{name,arguments}}
                MCP-->>Tools: result
            else is built-in tool
                Tools->>Tools: executeBuiltInTool(name, args, mode)
                opt web-search or url-fetch
                    Tools->>Tools: supabase.functions.invoke("tool-execute")
                end
            end
            Tools-->>Logic: result string
            Logic->>Logic: append tool result message
        end
        Logic->>Logic: re-send full conversation (loop)
    end

    Logic->>UI: final assistant message
    Logic->>UI: update token count
```

---

### 4.5 Tool Execution Flow

```
  executeToolCall(name, argsString, mcpToolDefs, mcpServers, executionMode)
       │
       ├─ parse argsString → JSON
       │
       ├─ name in mcpToolDefs?
       │   YES ──► find McpServerConfig by serverId
       │           server found?
       │               YES ──► POST server.url
       │                           { method:"tools/call",
       │                             params:{ name, arguments } }
       │                       ◄── result
       │               NO  ──► Error: server not found
       │
       └─ NO (built-in) ──► executeBuiltInTool(name, args, mode)
               │
               ├─ canExecute(tool.capabilities, mode)?
               │   NO  ──► "Blocked: requires [caps] in [mode] mode"
               │
               └─ YES ──► switch(name)
                           │
                           ├─ js-sandbox       new Function(code)()
                           │                   capture console.log output
                           │
                           ├─ web-search       supabase.functions.invoke
                           │                   "tool-execute" { tool:"web-search" }
                           │
                           ├─ url-fetch        supabase.functions.invoke
                           │                   "tool-execute" { tool:"url-fetch" }
                           │
                           ├─ current-time     new Date() → ISO/local/unix/tz
                           │
                           ├─ calculator       recursive descent parser
                           │                   +  -  *  /  %  ^  ()
                           │                   NO eval / new Function
                           │
                           ├─ json-transform   format | minify | keys
                           │                   count | query (dot-path)
                           │
                           ├─ random-generator uuid | password | number
                           │                   color | lorem | name | email
                           │
                           ├─ base64           btoa() / atob()
                           │
                           ├─ hash             crypto.subtle.digest
                           │                   SHA-256 | SHA-1 | SHA-384
                           │
                           ├─ file-read        supabase.from("user_files")
                           │                   list | read | search
                           │
                           ├─ rag-cloud        supabase.from("documents")
                           │                   textSearch fts | ilike fallback
                           │                   search | add | list
                           │
                           ├─ rag-local        stub → "not available yet"
                           │
                           └─ unknown          Error: Unknown tool
```

```mermaid
flowchart TD
    START(["executeToolCall(name, args, mode)"])
    PARSE["Parse argsString as JSON"]
    CHECK_MCP{"name in\nmcpToolDefs?"}
    FIND_SRV["Find McpServerConfig\nby serverId"]
    SRV_FOUND{"server\nfound?"}
    MCP_CALL["executeMcpToolCall\nPOST tools/call to server URL"]
    BUILTIN["executeBuiltInTool(name, args, mode)"]
    MODE_CHECK{"canExecute\n(capabilities, mode)?"}
    BLOCKED["Return: Blocked message\n(mode restriction)"]

    DISPATCH{"switch name"}
    JS["js-sandbox\nnew Function()"]
    SEARCH["web-search\nsupabase.functions.invoke\ntool-execute"]
    FETCH["url-fetch\nsupabase.functions.invoke\ntool-execute"]
    TIME["current-time\nnew Date()"]
    CALC["calculator\nrecursive descent parser"]
    JSON_T["json-transform\nformat/minify/keys/query"]
    RAND["random-generator\nuuid/password/number/color/lorem"]
    B64["base64\nbtoa / atob"]
    HASH["hash\ncrypto.subtle.digest"]
    FILE["file-read\nsupabase.from(user_files)"]
    RAG_C["rag-cloud\nsupabase.from(documents)\nfull-text search"]
    RAG_L["rag-local\nstub — not implemented"]
    UNKNOWN["Error: Unknown tool"]

    START --> PARSE --> CHECK_MCP
    CHECK_MCP -->|yes| FIND_SRV --> SRV_FOUND
    SRV_FOUND -->|yes| MCP_CALL
    SRV_FOUND -->|no| UNKNOWN
    CHECK_MCP -->|no| BUILTIN --> MODE_CHECK
    MODE_CHECK -->|blocked| BLOCKED
    MODE_CHECK -->|allowed| DISPATCH
    DISPATCH --> JS & SEARCH & FETCH & TIME & CALC & JSON_T & RAND & B64 & HASH & FILE & RAG_C & RAG_L & UNKNOWN
```

---

### 4.6 Engine HTTP API

```
  Frontend (React)                  openaiServer.ts  :1234
  ─────────────────                 ──────────────────────────────────────────
  localEngine.ts    ─── HTTP ──►    GET  /v1/status
  useLocalEngine                         → { loaded, model, modelName, backend }
  useServerState
                                    GET  /v1/models
                                         → { data:[{ id, object, owned_by }] }

                                    GET  /v1/models/available
                                         → scans modelsDir recursively for .gguf
                                         → { data:[{ id, path, size_bytes }] }

                                    GET  /v1/backends
                                         → reads backend-manifest.json
                                         → reads display-data.json (locale "en")
                                         → { data:[{ name, displayName, version,
                                                      gpu, cpu[], active }] }

                                    GET  /v1/config
                                         → { models_dir }

                                    POST /v1/config
                                         ← { models_dir?, custom_endpoints? }
                                         → updates modelsDir
                                         → dynamically registers Express routes

  useHardwareInfo   ─── HTTP ──►    GET  /v1/hardware
                                         → { cpu, memory, gpus[], platform, arch }

                                    GET  /v1/hardware/usage
                                         → { cpuPercent, ramUsed, ramTotal }

  ModelConfigPanel  ─── HTTP ──►    POST /v1/load
  ModelsPage                             ← { model_path, config:{ n_ctx,
                                                n_gpu_layers, n_parallel } }
                                         → unloads current → loads new
                                         → { ok, model }

                                    POST /v1/unload
                                         → { ok }

                                    POST /v1/stop
                                         → aborts generation → { ok }

  useChatLogic      ─── HTTP ──►    POST /v1/chat/completions
  localEngine.ts                         ← { model, messages, stream,
                                              temperature, top_p, max_tokens,
                                              stop, tools? }
                                         streaming  → text/event-stream SSE
                                                       data: {delta.content}
                                                       data: [DONE]
                                         non-stream → ChatCompletionResponse

  useDownloadManager ── HTTP ──►    POST /v1/download
                                         ← { url, dest_dir, filename }
                                    GET  /v1/download/progress?filename=...
                                         → { progress, bytes_received,
                                              total_bytes, speed_bps, done }
  ─────────────────                 ──────────────────────────────────────────
                                         ▼
                                    LlamaEngine  (llamaEngine.ts)
                                         loadModel · predict · predictFull
                                         unload · stopGenerating · countTokens
                                         ▼
                                    llm_engine[_cuda12|_cuda|_vulkan|].node
                                    liblmstudio_bindings[...].node
```

```mermaid
graph LR
    subgraph CLIENT["Frontend  (React)"]
        LC["localEngine.ts\nuseLocalEngine\nuseHardwareInfo\nuseServerState\nModelConfigPanel\nModelsPage"]
    end

    subgraph SERVER["openaiServer.ts  :1234"]
        direction TB
        S1["GET  /v1/status"]
        S2["GET  /v1/models"]
        S3["GET  /v1/models/available\n(scans modelsDir for .gguf)"]
        S4["GET  /v1/backends\n(reads backend-manifest.json\n+ display-data.json)"]
        S5["GET  /v1/config"]
        S6["POST /v1/config\n{models_dir, custom_endpoints}"]
        S7["POST /v1/chat/completions\n(streaming SSE + non-streaming)"]
        S8["POST /v1/load\n{model_path, config}"]
        S9["POST /v1/unload"]
        S10["POST /v1/stop"]
        S11["GET  /v1/hardware"]
        S12["GET  /v1/hardware/usage"]
        S13["POST /v1/download"]
        S14["GET  /v1/download/progress"]
    end

    subgraph ENGINE["LlamaEngine"]
        LE["llamaEngine.ts\nloadModel · predict\npredictFull · unload\ncountTokens · stopGenerating"]
    end

    subgraph BACKENDS["Native Bindings"]
        NB[".node  llm_engine\n+ liblmstudio_bindings"]
    end

    LC -->|"HTTP fetch"| SERVER
    S7 & S8 & S9 & S10 --> ENGINE
    ENGINE --> BACKENDS
    S3 -->|"fs.readdirSync"| FS["File System\nmodelsDir"]
    S4 -->|"scanBackends()"| BDIR["extensions/backends/\n*/backend-manifest.json\n*/display-data.json"]
    S11 & S12 --> HW["hardwareInfo.ts\nsysteminformation"]
```

---

### 4.7 Download Manager Flow

```
  User clicks "Get" on ModelDetail
       │
       ▼
  fetchHfGgufFiles(model.slug)
       GET https://huggingface.co/api/models/{slug}?full=true
       ◄── siblings[] filtered by .gguf extension
       User selects variant from dropdown
       │
       ▼
  onStartDownload({ id, modelId, filename, displayName, url, destDir })
       │
       ▼
  useDownloadManager.startDownload(item)
       ├─ deduplicate (skip if already downloading/done)
       ├─ add { status:"queued" } to state
       └─ persist to localStorage
              │
              ▼
       ┌─ try POST localhost:1234/v1/download
       │       { url, dest_dir, filename }
       │
       │   success (engine handles it)
       │   └─ poll GET /v1/download/progress?filename=...  every 800ms
       │           ◄── { progress, bytes_received, total_bytes, speed_bps, done }
       │           updateItem(progress) → re-render DownloadManager UI
       │
       └─ fail (engine offline)
           └─ browser-side fetch(url) with ReadableStream
                   loop reader.read():
                       bytesReceived += chunk.byteLength
                       every 0.5s: calc speedBps
                       updateItem({ progress, bytesReceived, speedBps })
                   on complete:
                       POST /v1/config { rescan:true }
       │
       ▼
  updateItem({ status:"done", progress:100, finishedAt })
  persist to localStorage
  DownloadManager UI shows ✓ Completed HH:MM:SS
```

```mermaid
sequenceDiagram
    participant User
    participant Detail as ModelDetail
    participant Hook as useDownloadManager
    participant Engine as Engine :1234
    participant HF as HuggingFace CDN

    User->>Detail: clicks Download
    Detail->>Detail: fetchHfGgufFiles(slug)\nGET api/models/{slug}?full=true
    HF-->>Detail: GGUF file list + sizes
    User->>Detail: selects variant
    Detail->>Hook: onStartDownload({id, url, destDir, filename})
    Hook->>Hook: add item {status:"queued"} to state
    Hook->>Hook: persist to localStorage

    Hook->>Engine: POST /v1/download\n{url, dest_dir, filename}
    alt Engine handles download
        Engine-->>Hook: 200 OK
        loop poll every 800ms
            Hook->>Engine: GET /v1/download/progress?filename=...
            Engine-->>Hook: {progress, bytes_received, done}
            Hook->>Hook: updateItem(progress)
        end
    else Engine offline / error
        Hook->>HF: fetch(url) with ReadableStream
        loop read chunks
            HF-->>Hook: Uint8Array chunk
            Hook->>Hook: bytesReceived += chunk.byteLength
            Hook->>Hook: calc speed every 0.5s
            Hook->>Hook: updateItem(progress, speedBps)
        end
        Hook->>Engine: POST /v1/config {rescan:true}
    end

    Hook->>Hook: updateItem({status:"done", finishedAt})
    Hook->>Hook: persist to localStorage
```

---

### 4.8 Supabase Database Schema (ERD)

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  auth.users  (managed by Supabase Auth)                                  │
  │  id (uuid PK)  ·  email                                                  │
  └──────┬───────────────────────────────────────────────────────────────────┘
         │ 1:1                │ 1:N              │ 1:N
         ▼                    ▼                  ▼
  ┌─────────────┐   ┌──────────────────┐   ┌──────────────────────────────┐
  │  profiles   │   │   api_keys       │   │   api_providers              │
  │─────────────│   │──────────────────│   │──────────────────────────────│
  │ id          │   │ id               │   │ id                           │
  │ user_id FK  │   │ user_id FK       │   │ user_id FK                   │
  │ display_name│   │ name             │   │ name                         │
  │ avatar_url  │   │ key_hash  ◄─SHA256   │ base_url                     │
  │ created_at  │   │ key_prefix       │   │ api_key_encrypted  ◄─XOR     │
  │ updated_at  │   │ is_active        │   │ provider_type                │
  └─────────────┘   │ rate_limit_rpm   │   │ enabled                      │
                    │ allowed_models[] │   └──────────────────────────────┘
                    │ last_used_at     │
                    │ expires_at       │
                    └────────┬─────────┘
                             │ 1:N
                             ▼
                    ┌──────────────────────────────────────────────────────┐
                    │  api_usage_logs                                      │
                    │──────────────────────────────────────────────────────│
                    │ id · user_id FK · api_key_id FK                      │
                    │ model · provider · endpoint · status_code            │
                    │ tokens_input · tokens_output · latency_ms            │
                    │ error_message · request_ip · created_at              │
                    └──────────────────────────────────────────────────────┘

  ┌──────────────────────────┐   ┌──────────────────────────────────────────┐
  │  documents  (Cloud RAG)  │   │  mcp_servers                             │
  │──────────────────────────│   │──────────────────────────────────────────│
  │ id · user_id FK          │   │ id · user_id FK                          │
  │ title · content (text)   │   │ name · url · headers (jsonb)             │
  │ tags (text[]) · source   │   │ enabled · status                         │
  │ fts (tsvector)  ◄─index  │   │ created_at · updated_at                  │
  │ created_at · updated_at  │   └──────────────────────────────────────────┘
  └──────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  user_files                                                              │
  │──────────────────────────────────────────────────────────────────────────│
  │ id · user_id FK · filename · content (text) · content_type              │
  │ size_bytes · created_at                                                  │
  └──────────────────────────────────────────────────────────────────────────┘
```

```mermaid
erDiagram
    USERS {
        uuid id PK
        string email
    }

    PROFILES {
        uuid id PK
        uuid user_id FK
        string display_name
        string avatar_url
        timestamptz created_at
        timestamptz updated_at
    }

    API_KEYS {
        uuid id PK
        uuid user_id FK
        string name
        string key_hash
        string key_prefix
        bool is_active
        int rate_limit_rpm
        string[] allowed_models
        timestamptz last_used_at
        timestamptz expires_at
        timestamptz created_at
        timestamptz updated_at
    }

    API_PROVIDERS {
        uuid id PK
        uuid user_id FK
        string name
        string base_url
        string api_key_encrypted
        string provider_type
        bool enabled
        timestamptz created_at
        timestamptz updated_at
    }

    API_USAGE_LOGS {
        uuid id PK
        uuid user_id FK
        uuid api_key_id FK
        string model
        string provider
        string endpoint
        int status_code
        int tokens_input
        int tokens_output
        int latency_ms
        string error_message
        string request_ip
        timestamptz created_at
    }

    DOCUMENTS {
        uuid id PK
        uuid user_id FK
        string title
        text content
        string[] tags
        string source
        tsvector fts
        timestamptz created_at
        timestamptz updated_at
    }

    MCP_SERVERS {
        uuid id PK
        uuid user_id FK
        string name
        string url
        jsonb headers
        bool enabled
        string status
        timestamptz created_at
        timestamptz updated_at
    }

    USER_FILES {
        uuid id PK
        uuid user_id FK
        string filename
        text content
        string content_type
        int size_bytes
        timestamptz created_at
    }

    USERS ||--o{ PROFILES : "has"
    USERS ||--o{ API_KEYS : "owns"
    USERS ||--o{ API_PROVIDERS : "configures"
    USERS ||--o{ API_USAGE_LOGS : "generates"
    USERS ||--o{ DOCUMENTS : "stores"
    USERS ||--o{ MCP_SERVERS : "registers"
    USERS ||--o{ USER_FILES : "uploads"
    API_KEYS ||--o{ API_USAGE_LOGS : "attributed to"
```

---

### 4.9 Auth & Session Flow

```
  App mounts
       │
       ▼
  useAuth()
       ├─ supabase.auth.onAuthStateChange(subscribe)
       └─ supabase.auth.getSession()
              │
              ├─ session exists ──► setUser(session.user)
              │                     setLoading(false)
              │
              └─ no session ──► setUser(null)
                                setLoading(false)
       │
       ▼
  Index.tsx receives { user, loading }
       │
       ├─ loading === true
       │   └─ render spinner
       │
       ├─ user === null
       │   └─ render <AuthPage>
       │           │
       │           ▼
       │       Supabase Auth UI
       │       signInWithPassword / signUp / OAuth
       │           │
       │           ▼
       │       onAuthStateChange fires
       │       setUser(session.user)
       │       Index re-renders → full app
       │
       └─ user present
           ├─ render full app shell
           ├─ fetchDbProviders(user.id)
           │   SELECT api_providers WHERE user_id = ?
           │   decryptApiKey(api_key_encrypted)  ← XOR decode
           │   setProviders(dbProviders)
           │
           └─ on signOut:
               supabase.auth.signOut()
               onAuthStateChange → null
               setUser(null) → AuthPage
```

```mermaid
sequenceDiagram
    participant Browser as React App
    participant Hook as useAuth
    participant Supa as Supabase Auth
    participant DB as Supabase DB
    participant Index as Index.tsx

    Browser->>Hook: mount
    Hook->>Supa: onAuthStateChange (subscribe)
    Hook->>Supa: getSession()
    Supa-->>Hook: session | null
    Hook->>Hook: setUser / setSession / setLoading(false)

    Hook->>Index: { user, loading }

    alt loading
        Index->>Browser: spinner
    else no user
        Index->>Browser: render AuthPage
        Browser->>Supa: signInWithPassword / signUp
        Supa-->>Hook: onAuthStateChange fires
        Hook->>Index: user set
    else user present
        Index->>Browser: render full app
        Index->>DB: fetchDbProviders(user.id)\nSELECT api_providers
        DB-->>Index: providers[]
        Index->>Index: setProviders(decryptApiKey each)
    end

    note over Browser,DB: On signOut
    Browser->>Supa: supabase.auth.signOut()
    Supa-->>Hook: onAuthStateChange → null
    Hook->>Index: user = null → AuthPage
```

---

### 4.10 Settings Data Flow

```
  Settings Tab          Write Target              Engine Sync
  ─────────────────     ──────────────────────    ──────────────────────────
  PathsTab              localStorage              POST /v1/config
    modelsDir           app:settings:paths        { models_dir }
    downloadsDir

  BasicsTab             localStorage
    theme/lang/font     ai-server-providers

  ProvidersTab          localStorage              Supabase
    name/baseUrl        ai-server-providers       api_providers (upsert)
    apiKey (XOR enc)

  McpServersTab         localStorage              Supabase
    name/url/headers    ai-server-mcp-servers     mcp_servers (upsert)
    enabled

  ToolsTab              localStorage
    enabled/disabled    ai-server-tools-config
                        (versioned v6)

  AdvancedTab           localStorage
    executionMode       ai-server-user-role

  RuntimeTab            ─── read only ───         GET /v1/backends
    backends browser                              reads backend-manifest.json
                                                  reads display-data.json

  HardwareTab           ─── read only ───         GET /v1/hardware
    CPU/GPU/RAM                                   GET /v1/hardware/usage
                                                  (poll every 3s)

  ProfileTab            Supabase
    display_name        profiles (upsert)
    avatar_url

  ApiTab                localStorage
    server port/auth    app:settings:api
```

```mermaid
flowchart LR
    subgraph UI["Settings UI"]
        PT["PathsTab\nmodelsDir"]
        BT["BasicsTab\ntheme/lang/font"]
        PRV["ProvidersTab\nAPI keys"]
        MCP_T["McpServersTab\nserver URLs"]
        TT["ToolsTab\nenable/disable"]
        RT["RuntimeTab\nbackends browser"]
        HT["HardwareTab\nCPU/GPU/RAM"]
        ADV["AdvancedTab\nexec mode"]
    end

    subgraph LS["localStorage"]
        LS1["app:settings:paths"]
        LS2["ai-server-providers"]
        LS3["ai-server-mcp-servers"]
        LS4["ai-server-tools-config\n(versioned v6)"]
        LS5["ai-server-user-role"]
        LS6["ai-server-chat-sessions-open"]
    end

    subgraph SB["Supabase DB"]
        SB1["api_providers"]
        SB2["mcp_servers"]
        SB3["profiles"]
    end

    subgraph ENGINE["Engine :1234"]
        E1["POST /v1/config\n{models_dir}"]
        E2["GET /v1/backends"]
        E3["GET /v1/hardware"]
        E4["GET /v1/hardware/usage"]
    end

    PT -->|"write"| LS1
    PT -->|"syncModelsDir()"| E1
    BT -->|"write"| LS2
    PRV -->|"write"| LS2
    PRV -->|"upsert"| SB1
    MCP_T -->|"write"| LS3
    MCP_T -->|"upsert"| SB2
    TT -->|"write"| LS4
    ADV -->|"write"| LS5

    RT -->|"fetch"| E2
    HT -->|"fetch"| E3
    HT -->|"poll 3s"| E4
```

---

### 4.11 MCP Integration Flow

```
  ── SETUP (McpServersTab) ──────────────────────────────────────────────────

  User adds MCP server { name, url, headers }
       │
       ├─ saveMcpServerToDb(server, userId)
       │   INSERT INTO mcp_servers
       │
       └─ saveMcpServers([...])  → localStorage "ai-server-mcp-servers"

  User clicks "Discover Tools"
       │
       └─ discoverMcpTools(server)
               POST server.url
               { jsonrpc:"2.0", method:"tools/list", id:1 }
               ◄── { result:{ tools:[{ name, description, inputSchema }] } }
               store tool list on server config

  ── CHAT SEND ──────────────────────────────────────────────────────────────

  useChatLogic.sendMessage()
       │
       ├─ loadMcpServers() from localStorage
       ├─ for each enabled server:
       │   discoverMcpTools(server) → mcpToolDefs[]
       └─ merge mcpToolDefs + builtInToolDefs → ToolDefinition[]
              send to model as tools:[...]

  ── TOOL CALL RESPONSE ─────────────────────────────────────────────────────

  model returns tool_calls[{ name:"rag_search", arguments:{query:"..."} }]
       │
       └─ executeToolCall("rag_search", args, mcpToolDefs, mcpServers, mode)
               find "rag_search" in mcpToolDefs → serverId = "rag-server"
               find McpServerConfig by id
               │
               └─ executeMcpToolCall(server, "rag_search", { query })
                       POST server.url
                       { jsonrpc:"2.0", method:"tools/call",
                         params:{ name:"rag_search",
                                  arguments:{ query:"..." } },
                         id:1 }
                       ◄── { result: "search result text" }
               return result string → append as tool message → re-send
```

```mermaid
sequenceDiagram
    participant Settings as McpServersTab
    participant Ops as mcpOperations.ts
    participant DB as Supabase mcp_servers
    participant LS as localStorage
    participant MCP as MCP Server (any URL)
    participant Chat as useChatLogic
    participant Exec as executeToolCall

    Settings->>Ops: saveMcpServerToDb(server, userId)
    Ops->>DB: INSERT mcp_servers
    Ops->>LS: saveMcpServers([...])

    Settings->>Ops: discoverMcpTools(server)
    Ops->>MCP: POST {method:"tools/list"}
    MCP-->>Ops: {tools:[{name,description,inputSchema}]}
    Ops-->>Settings: tool definitions

    note over Chat: On chat send
    Chat->>Chat: load mcpServers from localStorage
    Chat->>Chat: build mcpToolDefs from discovered tools
    Chat->>Chat: merge with built-in ToolDefinitions
    Chat->>Chat: send all tools to model

    note over Exec: On tool_call response
    Exec->>Exec: find tool in mcpToolDefs
    Exec->>MCP: POST {method:"tools/call",\nparams:{name, arguments}}
    MCP-->>Exec: result
    Exec-->>Chat: result string
```

---

### 4.12 Backend Selection Flow

```
  Engine process starts
       │
       ▼
  backendLoader.ts  scanBackends()
       scan extensions/backends/*/backend-manifest.json
       build list of { manifest, dir } pairs
       │
       ▼
  Detect hardware capabilities
       │
       ├─ NVIDIA GPU + CUDA 12 driver ≥ 12040?
       │   YES ──► llama.cpp-win-x86_64-nvidia-cuda12-avx2  v2.8.0
       │               llm_engine_cuda12.node
       │               liblmstudio_bindings_cuda12.node
       │               CUDA targets: 7.5 / 8.0 / 8.9 / 9.0 / 10.0 / 12.0
       │
       ├─ NVIDIA GPU + CUDA 11?
       │   YES ──► llama.cpp-win-x86_64-nvidia-cuda-avx2  v2.7.1
       │               llm_engine_cuda.node
       │               liblmstudio_bindings_cuda.node
       │
       ├─ Any GPU + Vulkan support?
       │   YES ──► llama.cpp-win-x86_64-vulkan-avx2  v2.7.1
       │               llm_engine_vulkan.node
       │               liblmstudio_bindings_vulkan.node
       │
       └─ CPU only (AVX2)
           ──► llama.cpp-win-x86_64-avx2  v2.7.1
                   llm_engine.node
                   liblmstudio_bindings.node
       │
       ▼
  require(selected .node binding)
  new LLMEngine(LLM_TYPE=1)
  engine.start()
  engine.setErrorHandler(...)
       │
       ▼
  LlamaEngine ready
  createOpenAIServer(engine, modelName, backendName)
  app.listen(1234)
```

```mermaid
flowchart TD
    START(["Engine process starts"])
    SCAN["backendLoader.ts\nscanBackends()\nread all backend-manifest.json"]
    DETECT["Detect hardware\nCPU extensions · GPU vendor\nCUDA version · Vulkan support"]

    CHECK_CUDA12{"CUDA 12\navailable?"}
    CHECK_CUDA11{"CUDA 11\navailable?"}
    CHECK_VULKAN{"Vulkan\navailable?"}
    USE_CUDA12["llama.cpp-win-x86_64\n-nvidia-cuda12-avx2\nv2.8.0\nllm_engine_cuda12.node"]
    USE_CUDA11["llama.cpp-win-x86_64\n-nvidia-cuda-avx2\nv2.7.1\nllm_engine_cuda.node"]
    USE_VULKAN["llama.cpp-win-x86_64\n-vulkan-avx2\nv2.7.1\nllm_engine_vulkan.node"]
    USE_CPU["llama.cpp-win-x86_64\n-avx2\nv2.7.1\nllm_engine.node"]

    LOAD["require(.node binding)\nnew LLMEngine(LLM_TYPE=1)\nengine.start()"]
    READY["LlamaEngine ready\nopenaiServer starts on :1234"]

    START --> SCAN --> DETECT
    DETECT --> CHECK_CUDA12
    CHECK_CUDA12 -->|yes| USE_CUDA12
    CHECK_CUDA12 -->|no| CHECK_CUDA11
    CHECK_CUDA11 -->|yes| USE_CUDA11
    CHECK_CUDA11 -->|no| CHECK_VULKAN
    CHECK_VULKAN -->|yes| USE_VULKAN
    CHECK_VULKAN -->|no| USE_CPU
    USE_CUDA12 & USE_CUDA11 & USE_VULKAN & USE_CPU --> LOAD --> READY
```

---

### 4.13 State Management Map

```
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  Index.tsx  (top-level React state)                                     │
  │                                                                         │
  │  currentPage: Page          userRole: UserRole                          │
  │  tools: ToolItem[]          providers: ApiProvider[]                    │
  │  selectedModelName: string  tokenCount: number                          │
  │  showSettings / showDownloads / showModelConfig: boolean                │
  │                                                                         │
  │  Persisted to localStorage:                                             │
  │    providers → "ai-server-providers"                                    │
  │    userRole  → "ai-server-user-role"                                    │
  │    chatSessionsOpen → "ai-server-chat-sessions-open"                    │
  │  Synced to Supabase:                                                    │
  │    providers → api_providers table                                      │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 │ passes props down
         ┌───────────────────────┼──────────────────────────┐
         ▼                       ▼                          ▼
  ┌─────────────────┐   ┌────────────────────┐   ┌──────────────────────┐
  │  useChatLogic   │   │  useServerState    │   │  useDownloadManager  │
  │─────────────────│   │────────────────────│   │──────────────────────│
  │ sessions[]      │   │ isRunning          │   │ downloads[]          │
  │ activeSessionId │   │ wsStatus           │   │ abortRefs Map        │
  │ messages[]      │   │ logs[] (max 500)   │   │                      │
  │ isStreaming      │   │ loadedModels[]     │   │ Persisted:           │
  │ executionMode   │   │ uptime / latency   │   │ localStorage         │
  │ abortController │   │                    │   │ "ai-server:downloads"│
  │                 │   │ polls /v1/status   │   └──────────────────────┘
  │ Persisted:      │   │ every 3s           │
  │ localStorage    │   └────────────────────┘
  │ sessions+msgs   │
  └─────────────────┘
         │
         ▼
  ┌─────────────────┐   ┌────────────────────┐   ┌──────────────────────┐
  │  useLocalEngine │   │  useHardwareInfo   │   │  useAuth             │
  │─────────────────│   │────────────────────│   │──────────────────────│
  │ status:         │   │ hardware:          │   │ user: User | null    │
  │  available      │   │  CpuInfo           │   │ session: Session     │
  │  loaded         │   │  MemoryInfo        │   │ loading: boolean     │
  │  model          │   │  GpuInfo[]         │   │                      │
  │                 │   │ usage:             │   │ supabase.auth        │
  │ polls /v1/status│   │  cpuPercent        │   │ onAuthStateChange    │
  │ every 5s        │   │  ramUsed/Total     │   │ getSession()         │
  └─────────────────┘   │                    │   └──────────────────────┘
                        │ polls /v1/hardware │
                        │ /usage every 3s    │
                        └────────────────────┘
```

```mermaid
graph TD
    subgraph GLOBAL["Index.tsx  (top-level state)"]
        G1["currentPage: Page"]
        G2["userRole: UserRole"]
        G3["tools: ToolItem[]"]
        G4["providers: ApiProvider[]"]
        G5["selectedModelName: string"]
        G6["tokenCount: number"]
        G7["showSettings / showDownloads\nshowModelConfig: boolean"]
    end

    subgraph CHAT_STATE["useChatLogic  (chat state)"]
        C1["sessions: ChatSession[]"]
        C2["activeSessionId: string"]
        C3["messages: ApiMessage[]"]
        C4["isStreaming: boolean"]
        C5["executionMode: ExecutionMode"]
        C6["abortController: AbortController"]
    end

    subgraph SERVER_STATE["useServerState  (server state)"]
        S1["isRunning: boolean"]
        S2["wsStatus: ConnectionStatus"]
        S3["logs: LogEntry[]  (max 500)"]
        S4["loadedModels: FetchedModel[]"]
        S5["uptime: number"]
        S6["latency: number"]
    end

    subgraph DL_STATE["useDownloadManager  (download state)"]
        D1["downloads: DownloadItem[]"]
        D2["abortRefs: Map<id, AbortController>"]
    end

    subgraph ENGINE_STATE["useLocalEngine  (engine state)"]
        E1["status: EngineStatus\n{available, loaded, model}"]
    end

    subgraph HW_STATE["useHardwareInfo  (hardware state)"]
        H1["hardware: HardwareInfo"]
        H2["usage: ResourceUsage"]
    end

    subgraph PERSIST["Persistence"]
        LS["localStorage"]
        SB["Supabase DB"]
    end

    CHAT_STATE -->|"sessions + messages"| LS
    DL_STATE -->|"downloads queue"| LS
    GLOBAL -->|"providers, role, tools"| LS
    GLOBAL -->|"providers"| SB

    SERVER_STATE -->|"polls /v1/status\nevery 3s"| ENGINE_STATE
    ENGINE_STATE -->|"polls /v1/status\nevery 5s"| ENGINE_STATE
    HW_STATE -->|"polls /v1/hardware/usage\nevery 3s"| ENGINE_STATE
```

---

### 4.14 API Gateway Flow

```
  External Client (curl / Python SDK / JS SDK)
       │
       │  POST https://{project}.supabase.co/functions/v1/api-proxy/v1/chat/completions
       │  Authorization: Bearer sk-ais-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
       │
       ▼
  Supabase Edge Function: api-proxy
       │
       ├─ extract Bearer token from Authorization header
       ├─ SHA-256 hash the token
       ├─ SELECT * FROM api_keys WHERE key_hash = ?
       │
       ├─ key not found?  ──► 401 Unauthorized
       ├─ is_active = false?  ──► 401 Unauthorized
       │
       ├─ rate_limit_rpm > 0?
       │   count requests in last 60s for this key
       │   exceeded?  ──► 429 Too Many Requests
       │
       ├─ SELECT * FROM api_providers WHERE user_id = key.user_id
       │   decrypt api_key_encrypted  (XOR with static key)
       │
       ├─ forward request to provider.base_url
       │   with real API key in Authorization header
       │   ◄── response (streaming SSE or JSON)
       │
       ├─ forward response to client
       │
       └─ INSERT INTO api_usage_logs {
               user_id, api_key_id, model, provider, endpoint,
               status_code, tokens_input, tokens_output,
               latency_ms, error_message, request_ip
          }
          UPDATE api_keys SET last_used_at = now()

  ─────────────────────────────────────────────────────────────────────
  ApiGatewayPage (frontend) reads:
    api_keys        → ApiKeysTab   (list, create, toggle, delete)
    api_usage_logs  → UsageTab     (by model aggregation)
                    → LogsTab      (request log table)
                    → StatsRow     (totals, avg latency, error rate)
  ─────────────────────────────────────────────────────────────────────
```

```mermaid
sequenceDiagram
    participant ExtClient as External Client\n(curl / SDK)
    participant Proxy as Supabase Edge Fn\napi-proxy
    participant DB as Supabase DB
    participant Provider as Cloud AI Provider

    ExtClient->>Proxy: POST /v1/chat/completions\nAuthorization: Bearer sk-ais-...
    Proxy->>Proxy: extract key from header
    Proxy->>Proxy: SHA-256 hash the key
    Proxy->>DB: SELECT api_keys WHERE key_hash = ?
    DB-->>Proxy: key row (is_active, rate_limit_rpm, allowed_models)

    alt key not found or inactive
        Proxy-->>ExtClient: 401 Unauthorized
    else rate limit exceeded
        Proxy-->>ExtClient: 429 Too Many Requests
    else valid
        Proxy->>DB: SELECT api_providers WHERE user_id = key.user_id
        DB-->>Proxy: provider config (base_url, api_key_encrypted)
        Proxy->>Proxy: decrypt api_key_encrypted (XOR)
        Proxy->>Provider: forward request with real API key
        Provider-->>Proxy: response (streaming or not)
        Proxy-->>ExtClient: forward response
        Proxy->>DB: INSERT api_usage_logs\n{model, endpoint, status_code,\ntokens_in, tokens_out, latency_ms}
        Proxy->>DB: UPDATE api_keys SET last_used_at = now()
    end
```

---

## 3. Repository Structure

```
/
├── electron/
│   ├── main.ts              # Electron main process — window creation, IPC, engine spawn
│   └── preload.ts           # Context bridge: exposes electron.minimize/maximize/close
├── extensions/
│   ├── engine/
│   │   ├── llamaEngine.ts   # LlamaEngine class — wraps llm_engine.node binding
│   │   ├── openaiServer.ts  # Express OpenAI-compatible HTTP server
│   │   ├── backendLoader.ts # Scans extensions/backends/, loads best backend
│   │   ├── hardwareInfo.ts  # CPU/GPU/RAM detection
│   │   └── types.ts         # Shared TypeScript types for engine layer
│   ├── daemon.ts            # Standalone daemon process — auto-starts MCP plugins
│   ├── backends/            # Pre-built llama.cpp backend binaries (4 variants)
│   └── mcp/
│       ├── rag/             # Local RAG MCP server (port 4001)
│       └── sandbox/         # Local code sandbox MCP server (port 4002)
├── src/
│   ├── main.tsx             # React entry point
│   ├── App.tsx              # Root component — router, providers
│   ├── index.css            # Global styles
│   ├── pages/               # Top-level page components
│   ├── components/          # Reusable UI components
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Business logic, API clients
│   └── integrations/
│       └── supabase/        # Supabase client + generated types
├── supabase/
│   └── migrations/          # SQL migration files
├── dist/                    # Vite build output
├── electron-dist/           # Electron packaged output
├── package.json
├── vite.config.ts
└── components.json          # shadcn/ui config
```

---

## 5. Application Entry Points

### `src/main.tsx`
Minimal React entry point. Calls `createRoot` on `#root` and renders `<App />`.

### `src/App.tsx`
Root component. Sets up:
- `QueryClientProvider` (TanStack Query)
- `TooltipProvider`
- `Toaster` + `Sonner` (toast notifications)
- `BrowserRouter` with two routes: `/` → `<Index>`, `*` → `<NotFound>`

### `src/pages/Index.tsx`
The main shell component. Manages all top-level state:
- **Auth gate**: renders `<AuthPage>` if no Supabase user
- **Page routing**: `currentPage` state drives which page renders (`chat | discover | models | server | settings | api`)
- **Role system**: `userRole` (`user | power-user | developer`) controls which pages are accessible
- **Tool state**: `tools: ToolItem[]` — list of enabled/disabled built-in tools
- **Provider state**: `providers: ApiProvider[]` — cloud API providers, synced to Supabase DB
- **Download manager**: `useDownloadManager()` — active downloads, passed to `DiscoverPage`
- **Engine status**: `useLocalEngine(5000)` — polls engine every 5s
- **Model config panel**: slide-in drawer for sampling params, shown when a model is selected in chat
- **Settings modal**: full-screen overlay wrapping `<SettingsPage>`
- **Downloads modal**: overlay wrapping `<DownloadManager>`
- **Titlebar**: custom Electron window controls (minimize/maximize/close via `window.electron`)
- **Status bar**: shows app version, role switcher, token count, engine online/offline, active model name

---

## 6. Electron Shell

### `electron/main.ts`
- Creates a `BrowserWindow` (frameless, 1280×800, dark background)
- Loads `dist/index.html` in production or `http://localhost:5173` in dev
- Registers IPC handlers: `minimize`, `maximize`, `close`, `open-path`
- Spawns the engine process (`extensions/engine/`) as a child process
- Spawns the daemon process (`extensions/daemon.ts`) as a child process

### `electron/preload.ts`
Exposes a safe `window.electron` API to the renderer via `contextBridge`:
```ts
window.electron = {
  minimize: () => ipcRenderer.send("minimize"),
  maximize: () => ipcRenderer.send("maximize"),
  close:    () => ipcRenderer.send("close"),
  openPath: (p) => ipcRenderer.send("open-path", p),
}
```

---

## 7. Local Engine Layer

The engine runs as a separate Node.js process, not inside the Electron renderer. It exposes an HTTP server on `http://localhost:1234`.

### `extensions/engine/llamaEngine.ts` — `LlamaEngine` class

Wraps the raw `llm_engine.node` native binding.

**Constructor**: `new LlamaEngine(backend: LoadedBackend)`
- Creates `new backend.binding.LLMEngine(LLM_TYPE=1)` (1 = LLM, 0 = Embedding)
- Calls `engine.start()` and registers an error handler

**Key methods**:

| Method | Description |
|---|---|
| `loadModel(path, config)` | Loads a GGUF file. Config: `n_ctx`, `n_parallel`, `n_gpu_layers`. Fires progress callbacks (0..1) then resolves on success. |
| `unload()` | Frees model from memory |
| `predict(messages, params, onToken, onDone)` | Streaming inference. Formats messages to ChatML, calls `engine.predict()` |
| `predictFull(messages, params)` | Non-streaming wrapper around `predict()` |
| `stopGenerating()` | Aborts current generation |
| `countTokens(text)` | Returns token count for a string |
| `tokenize(text, addBos)` | Returns token ID array |
| `formatPrompt(messages)` | Converts `ChatMessage[]` to ChatML format |

**Default load config**: `n_ctx=4096`, `n_parallel=1`, `n_gpu_layers=0`

### `extensions/engine/openaiServer.ts` — HTTP Server

Creates an Express app with full OpenAI wire-format compatibility.

**Endpoints**:

| Method | Path | Description |
|---|---|---|
| GET | `/v1/models` | Returns loaded model or empty list |
| GET | `/v1/models/available` | Scans `modelsDir` recursively for `.gguf` files |
| GET | `/v1/status` | `{ loaded, model, modelName, backend }` |
| POST | `/v1/config` | Update `models_dir` and/or register `custom_endpoints` dynamically |
| GET | `/v1/config` | Returns current `models_dir` |
| GET | `/v1/backends` | Lists all scanned backends with display info from `display-data.json` |
| POST | `/v1/chat/completions` | Chat completion — streaming (SSE) and non-streaming |
| POST | `/v1/load` | Load a model by absolute path with optional config |
| POST | `/v1/unload` | Unload current model |
| POST | `/v1/stop` | Abort current generation |
| GET | `/v1/hardware` | CPU/GPU/RAM info |
| GET | `/v1/hardware/usage` | Live CPU%, RAM used/total |

**Streaming**: Uses `text/event-stream` SSE. Sends role delta first, then content chunks, then `[DONE]`.

**Custom endpoints**: `POST /v1/config` with `custom_endpoints` array dynamically registers new Express routes at runtime.

**Models directory**: Defaults to `A:/AI/AI_Models/llm_models/lmstudio-community`. Updated via `POST /v1/config { models_dir }`.

### `extensions/engine/types.ts`

Shared TypeScript interfaces:

- `BackendManifest` — backend-manifest.json schema (name, version, engine, platform, cpu, gpu, domains, target_libraries)
- `LoadModelConfig` — `n_ctx`, `n_parallel`, `n_gpu_layers`, `use_mmap`, `use_mlock`, `seed`
- `PredictParams` — `temperature`, `top_p`, `top_k`, `repeat_penalty`, `max_tokens`, `stop`, `stream`
- `ModelInfo` — `path`, `name`, `loaded`, `backend`, `config`
- `ChatMessage` — `role: "system"|"user"|"assistant"`, `content`
- `ChatCompletionRequest` / `ChatCompletionResponse` / `ChatCompletionChunk` — OpenAI wire format

### `src/lib/localEngine.ts` — Frontend Engine Client

Frontend-side client that talks to the engine HTTP server.

| Function | Description |
|---|---|
| `getEngineStatus()` | GET `/v1/status` → `{ available, loaded, model }` |
| `getEngineModels()` | GET `/v1/models` → string[] |
| `loadModel(path, options)` | POST `/v1/load` |
| `unloadModel()` | POST `/v1/unload` |
| `syncModelsDir(dir)` | POST `/v1/config { models_dir }` |
| `streamChatCompletion(messages, model, options)` | POST `/v1/chat/completions` with `stream:true`, parses SSE |
| `chatCompletion(messages, model, params)` | POST `/v1/chat/completions` with `stream:false` |

### `src/hooks/useLocalEngine.ts`

React hook wrapping `localEngine.ts`. Polls `getEngineStatus()` every `pollInterval` ms (default 5000ms). Exposes `{ status, loading, error, load, unload, refresh }`.

### `src/hooks/useHardwareInfo.ts`

Polls `GET /v1/hardware` once on mount and `GET /v1/hardware/usage` every `usageInterval` ms (default 3000ms). Returns `{ hardware: HardwareInfo, usage: ResourceUsage, loading, error, refresh, formatBytes }`.

Types: `CpuInfo`, `MemoryInfo`, `GpuInfo`, `HardwareInfo`, `ResourceUsage`.

---

## 8. Backend Extensions

Located in `extensions/backends/`. Each backend is a directory containing:
- `backend-manifest.json` — machine-readable metadata
- `display-data.json` — human-readable name/description per locale
- Native `.dll` and `.node` files

### Available Backends (Windows x86_64)

| Backend Name | Version | GPU | CUDA Targets | Notes |
|---|---|---|---|---|
| `llama.cpp-win-x86_64-avx2` | 2.7.1 | CPU only | — | AVX2 instruction set |
| `llama.cpp-win-x86_64-avx2` | 1.101.0 | CPU only | — | Older stable version |
| `llama.cpp-win-x86_64-nvidia-cuda-avx2` | 2.7.1 | NVIDIA CUDA 11 | — | Requires `win-llama-cuda-vendor-v2` |
| `llama.cpp-win-x86_64-nvidia-cuda-avx2` | 1.101.0 | NVIDIA CUDA 11 | — | Older CUDA 11 version |
| `llama.cpp-win-x86_64-nvidia-cuda-avx2` | 1.102.0 | NVIDIA CUDA 11 | — | |
| `llama.cpp-win-x86_64-nvidia-cuda12-avx2` | 2.8.0 | NVIDIA CUDA 12 | 7.5, 8.0, 8.9, 9.0, 10.0, 12.0 | Min driver 12040 |
| `llama.cpp-win-x86_64-vulkan-avx2` | 2.7.1 | Vulkan | — | Cross-vendor GPU |

All backends support `gguf` model format and both `llm` and `embedding` domains.

**Manifest version**: 4. **Minimum LM Studio version**: 0.4.0+15.

**Target libraries per backend**:
- `llm_engine[_cuda|_cuda12|_vulkan].node` — inference engine binding
- `liblmstudio_bindings[_cuda|_cuda12|_vulkan].node` — LM Studio binding layer

### `extensions/engine/backendLoader.ts`

Scans `extensions/backends/` directories, reads `backend-manifest.json` from each, selects the best available backend based on hardware capabilities, and loads the `.node` binding.

---

## 9. Local Daemon & MCP Plugins

### `extensions/daemon.ts`

A standalone Node.js process (separate from the engine) that:
1. Scans `extensions/mcp/` for subdirectories containing `manifest.json`
2. Spawns each MCP plugin as a child process via `node manifest.entry`
3. Handles plugin crashes gracefully
4. Exposes `GET /plugins` on port **4000** — returns list of running plugins (id, name, type, url, capabilities, tools)
5. Kills all child processes on `SIGINT`

**Plugin manifest schema**:
```json
{
  "name": "string",
  "type": "local",
  "entry": "./server.js",
  "port": 4001,
  "capabilities": ["local:rag"],
  "tools": ["tool_name"]
}
```

### `extensions/mcp/rag/` — Local RAG Server (port 4001)

Minimal HTTP MCP server. Implements JSON-RPC 2.0 over HTTP POST.

**Tools**:
- `rag_search` — semantic document search (currently returns simulated result; Qdrant + embeddings integration pending)
- `rag_store` — store document in local vector DB (simulated)

**Manifest capabilities**: `["local:rag", "local:db"]`

### `extensions/mcp/sandbox/` — Local Code Sandbox (port 4002)

HTTP MCP server for code execution.

**Tools**:
- `run_js` — executes JavaScript via `new Function()` (note: unsafe in production, intended for demo)
- `run_python` — simulated Python execution (not yet implemented)

**Manifest capabilities**: `["local:compute", "local:exec"]`

---

## 10. Frontend Pages

### Page Routing

All pages render inside `src/pages/Index.tsx`. Navigation is controlled by `currentPage` state, not URL routing. The `IconSidebar` drives page changes.

**Pages and access by role**:

| Page | Route Key | User | Power User | Developer |
|---|---|---|---|---|
| Chat | `chat` | ✓ | ✓ | ✓ |
| Discover | `discover` | ✓ | ✓ | ✓ |
| Models | `models` | — | ✓ | ✓ |
| Server | `server` | — | ✓ | ✓ |
| API Gateway | `api` | — | ✓ | ✓ |
| Settings | modal | ✓ | ✓ | ✓ |

### `src/pages/ChatPage.tsx`

Main chat interface. Receives props from `Index.tsx`:
- `tools`, `onToggleTool`, `onAddTool` — tool management
- `providers` — cloud API providers
- `newChatTrigger` — incremented to start a new session
- `sessionsPanelOpen` — controls sessions sidebar visibility
- `onModelSelect`, `onOpenModelConfig`, `onEjectModel` — model config panel integration
- `onTokenCountChange` — reports token count to status bar

### `src/pages/ServerPage.tsx`

Server monitoring dashboard. Uses `useServerState(serverPort)` hook. Renders:
- `ServerHeader` — port input, start/stop toggle, server URL display
- `WebSocketPanel` — connection status, uptime, latency, message count
- `LoadedModelsPanel` — currently loaded models from `/v1/status`
- `EndpointsPanel` — endpoint list with test buttons
- `DevLogs` — scrollable log viewer with filter/search/pause/clear
- `ServerStats` — right sidebar with request count, model count, error/warn counts

### `src/pages/SettingsPage.tsx`

Settings modal with sidebar navigation. Two tab groups:

**Settings tabs**: Profile & Security, Basics, API Providers, MCP Servers, Tools, Server API, Paths, Advanced

**System tabs** (keyboard shortcuts shown): Runtime (`Ctrl+Shift+R`), Hardware (`Ctrl+Shift+H`)

### `src/pages/ModelsPage.tsx`

Local model management. Fetches from engine:
1. `GET /v1/models` — currently loaded models
2. `GET /v1/models/available` — all `.gguf` files on disk

Features: kind filter (All/LLMs/Embedding), load/unload buttons, manual path input, open folder button, refresh. Calls `syncModelsDir()` on each refresh to push the configured models path to the engine.

### `src/pages/DiscoverPage.tsx`

Model discovery with live HuggingFace API integration. On mount, fetches:
```
GET https://huggingface.co/api/models?filter=gguf&sort=downloads&limit=30&full=true
```
Maps HF model metadata to `ModelInfo` objects. Falls back to static `MODELS` catalog on error.

Two-column layout: `DiscoverFilters` + `ModelList` on left, `ModelDetail` on right.

### `src/pages/ApiGatewayPage.tsx`

API key management and usage analytics. Fetches from Supabase:
- `api_keys` table — user's API keys
- `api_usage_logs` table — last 100 request logs

Four tabs: API Keys, Usage, Request Logs, Documentation.

Computes stats: total requests, total tokens, avg latency, error rate.

### `src/pages/AuthPage.tsx`

Supabase Auth UI. Shown when `useAuth()` returns no user.

### `src/pages/AccountPage.tsx`

User account management (profile, avatar, display name).

### `src/pages/NotFound.tsx`

404 fallback for unknown routes.

---

## 11. Settings System

### `src/components/settings/BasicsTab.tsx`
Theme selection, language, font size, and general UI preferences. Persisted to `localStorage`.

### `src/components/settings/ProvidersTab.tsx`
Manage cloud API providers (OpenAI, Anthropic, Google, Mistral, Groq, Together AI, OpenRouter). Each provider has: name, base URL, API key (encrypted with XOR before storing in Supabase `api_providers` table), enabled toggle. Syncs to Supabase DB when user is authenticated.

### `src/components/settings/McpServersTab.tsx`
Add/edit/delete MCP server configurations. Each server: name, URL, headers (JSON), enabled toggle. Persisted to `localStorage` and optionally synced to Supabase `mcp_servers` table. Includes tool discovery (calls `tools/list` on the MCP server).

### `src/components/settings/ToolsTab.tsx`
Enable/disable built-in tools and MCP tools. Shows tool capabilities, layer (local/edge/api/hybrid), and execution mode compatibility. Uses `loadToolConfigs()` / `saveToolConfigs()` from `src/lib/api.ts`.

### `src/components/settings/ApiTab.tsx`
Configure the local engine's HTTP server settings (port, CORS, auth token). Displays the server URL and connection status.

### `src/components/settings/PathsTab.tsx`
Configure file system paths: models directory, downloads directory. Persisted to `localStorage` under `app:settings:paths`. The models path is synced to the engine via `POST /v1/config { models_dir }`.

### `src/components/settings/RuntimeTab.tsx`
Backends browser. Fetches `GET /v1/backends` from the engine and displays all available backends with their GPU type, CPU extensions, version, and active status. No config POST — read-only display.

### `src/components/settings/HardwareTab.tsx`
Hardware information display. Uses `useHardwareInfo()` hook. Shows CPU name/cores/speed/extensions, RAM total/used/free, GPU name/VRAM/vendor/CUDA/Vulkan support, platform/arch. Live usage bar updates every 3s.

### `src/components/settings/ProfileTab.tsx`
User profile: display name, avatar URL. Reads/writes Supabase `profiles` table.

### `src/components/settings/AdvancedTab.tsx`
Advanced settings: execution mode (offline/hybrid/full), debug logging, experimental features.

### `src/components/settings/Primitives.tsx`
Shared UI primitives used across settings tabs (labeled inputs, toggles, section headers).

### `src/components/JsonEditorTab.tsx`
JSON editor component used in MCP server config and tool config panels. Provides syntax-highlighted textarea with JSON validation.

---

## 12. Chat System

### `src/components/chat/useChatLogic.tsx`

The core chat hook. Manages:
- **Sessions**: create, switch, delete chat sessions (persisted to `localStorage`)
- **Messages**: `ApiMessage[]` per session
- **Model selection**: local engine or cloud provider + model
- **Tool execution loop**: detects `tool_calls` in assistant response, executes each tool via `executeToolCall()`, appends `tool` role messages, re-sends to model
- **Streaming**: uses `sendChatCompletionStreaming()` for cloud providers, `streamChatCompletion()` for local engine
- **Execution mode**: `offline | hybrid | full` — controls which tools are allowed
- **Token counting**: tracks approximate token usage
- **Abort**: `AbortController` per request

**Tool execution flow**:
1. Send messages + tool definitions to model
2. If response has `tool_calls` → execute each via `executeToolCall()`
3. Append tool results as `{ role: "tool", tool_call_id, content }` messages
4. Re-send full conversation to model
5. Repeat until no more tool calls or max iterations reached

### `src/components/chat/ChatUI.tsx`

Main chat layout component. Renders:
- `SessionsSidebar` (left panel, collapsible)
- Message area with `MessageList`
- Input area with model picker, provider picker, tool config, agent picker
- MCP servers panel (slide-in)

### `src/components/chat/MessageBubble.tsx`

Renders a single message. Handles:
- User messages (right-aligned)
- Assistant messages (left-aligned, with streaming cursor)
- Tool call display (collapsible, shows tool name + args + result)
- System messages
- Markdown rendering via `CodeBlock`

### `src/components/chat/CodeBlock.tsx`

Syntax-highlighted code block with copy button. Detects language from markdown fence.

### `src/components/chat/SessionsSidebar.tsx`

Left panel listing all chat sessions. Each session shows title (auto-generated from first message), timestamp, message count. New chat button at top.

### `src/components/chat/MessageList.tsx`

Virtualized message list. Handles auto-scroll to bottom on new messages.

### `src/components/chat/ModelPicker.tsx`

Dropdown to select the active model. Groups models by provider. Shows local engine models and cloud provider models.

### `src/components/chat/ProviderPicker.tsx`

Dropdown to select the active API provider (local engine or cloud providers).

### `src/components/chat/AgentPicker.tsx`

Dropdown to select an agent preset (system prompt + tool configuration).

### `src/components/chat/ToolConfigPanel.tsx`

Slide-in panel showing enabled tools with toggle switches. Grouped by layer (local/edge/cloud).

### `src/components/chat/McpServersPanel.tsx`

Slide-in panel showing connected MCP servers and their discovered tools.

### `src/components/chat/types.ts`

Chat-specific types: `ChatSession`, `Message`, `ToolCallDisplay`.

---

## 13. Server Monitor Page

### `src/components/server/useServerState.ts`

The central hook for `ServerPage`. Polls `GET /v1/status` every **3 seconds** (HTTP polling — the engine has no WebSocket endpoint).

**State managed**:
- `isRunning` — user toggle (does not actually start/stop the engine process)
- `wsStatus: ConnectionStatus` — `"connected" | "disconnected" | "connecting"` — reflects HTTP poll result
- `logs: LogEntry[]` — capped at 500 entries
- `loadedModels: FetchedModel[]` — from `/v1/status`
- `uptime` — increments every second while `isRunning`
- `latency` — round-trip time of last poll in ms
- `requestCount` — incremented on each endpoint test
- `endpointTestResult` — last test result `{ path, status, time }`

**Key methods**: `testEndpoint(method, path)`, `toggleServer()`, `fetchModels()`, `addLog(level, source, message)`

### `src/components/server/ServerHeader.tsx`

Top bar with: server URL display, port input, start/stop button, connection status badge.

### `src/components/server/WebSocketPanel.tsx`

Displays HTTP polling status (labeled "Connection" not WebSocket). Shows: status badge, server port, uptime (formatted as HH:MM:SS), message count, latency in ms.

### `src/components/server/LoadedModelsPanel.tsx`

Shows currently loaded models from `/v1/status`. Refresh button calls `fetchModels()`.

### `src/components/server/EndpointsPanel.tsx`

Lists all engine endpoints with test buttons. Supports custom endpoints (synced to engine via `POST /v1/config { custom_endpoints }`). Shows last test result with status code and latency.

**Public endpoints** (shown by default): `/v1/models`, `/v1/status`, `/v1/chat/completions`, `/v1/hardware`

**Internal endpoints**: `/v1/load`, `/v1/unload`, `/v1/config`, `/v1/backends`

### `src/components/server/DevLogs.tsx`

Log viewer with: level filter (ALL/INFO/WARN/ERROR/DEBUG), text search, pause/resume, clear, auto-scroll. Renders each `LogEntry` with timestamp, level badge, source, message.

### `src/components/server/ServerStats.tsx`

Right sidebar with stat cards: request count, model count, connection status, message count, latency, log count, uptime, error count, warn count, server URL.

### `src/components/server/types.ts`

```ts
type LogEntryLevel = "INFO" | "WARN" | "ERROR" | "DEBUG"
type LogLevel = "ALL" | LogEntryLevel
type ConnectionStatus = "connected" | "disconnected" | "connecting"
type LogEntry = { id, timestamp, level, source, message }
```

`formatTimestamp(date)` utility function.

---

## 14. Models Page

`src/pages/ModelsPage.tsx` — see [Frontend Pages](#9-frontend-pages).

Key behaviors:
- On load: calls `syncModelsDir()` to push configured path to engine, then fetches loaded + available models
- `isEmbedding(id)` — detects embedding models by id substring (`embed`, `bge`, `e5-`, `minilm`)
- Load by path: manual `.gguf` path input, calls `POST /v1/load`
- Unload: calls `POST /v1/unload`
- Open folder: calls `window.electron.openPath(dir)` or shows toast with path

---

## 15. Discover Page

### Data Layer — `src/pages/discover/discoverData.ts`

Static catalog of 8 models used as fallback when HF API is unavailable:

| Model | Author | Params | Source | Kind |
|---|---|---|---|---|
| Nemotron 3 Nano 4B | NVIDIA | 4B | local | llm |
| Llama 3.3 8B Instruct | Meta | 8B | local | llm |
| Mistral 7B Instruct v0.3 | Mistral AI | 7B | local | llm |
| Phi-4 Mini Instruct | Microsoft | 3.8B | local | llm |
| GPT-4o | OpenAI | — | api | llm |
| Claude 3.5 Sonnet | Anthropic | — | api | llm |
| Gemma 3 4B Instruct | Google | 4B | cloud | llm |
| BGE M3 | BAAI | 568M | local | embedding |

**Filter types**: `CapabilityFilter` (All/Reasoning/Trending/Vision/Code/Tool), `KindFilter` (All/LLMs/Text Embedding)

**Utility functions**: `matchesDiscoverKind()`, `matchesDiscoverCapability()`, `parseSizeInGB()`, `supportsGpuOffloadBySize()`, `sourceIcon()`, `sourceLabel()`, `detailHeaderName()`

### `src/components/discover/DiscoverFilters.tsx`

Search input + kind filter pills + capability filter pills + refresh button.

### `src/components/discover/ModelList.tsx`

Animated list of model cards. Each card shows: name, source badge, description, ability badges, download button (or progress bar if downloading, or "Done" if downloaded). Keyboard accessible.

### `src/components/discover/ModelDetail.tsx`

Right panel detail view. On model select:
1. Calls `fetchHfGgufFiles(model.slug)` — fetches real GGUF file list from HF API
2. Shows file selector dropdown with real filenames and sizes
3. Falls back to static `variants` if HF fetch returns nothing
4. Download button calls `onStartDownload()` with HF direct download URL
5. Shows README preview, capabilities, metadata (params, arch, domain, format, stars, downloads, last updated, staff pick)
6. GPU offload indicator if model fits in 4GB

---

## 16. API Gateway Page

`src/pages/ApiGatewayPage.tsx` — BYOK (Bring Your Own Key) API proxy management.

### `src/components/api-gateway/StatsRow.tsx`

4-card stats row: Total Requests, Total Tokens, Avg Latency, Error Rate. Error rate card turns red if > 10%.

### `src/components/api-gateway/ApiKeysTab.tsx`

Full API key lifecycle management:
- **Create**: generates `sk-ais-` prefixed 48-char random key, SHA-256 hashes it, stores hash + prefix in Supabase `api_keys` table. Raw key shown once with reveal/copy.
- **List**: shows all keys with active/disabled badge, rate limit, last used date
- **Toggle**: enable/disable via `is_active` column
- **Delete**: removes from DB
- **Rate limit**: configurable req/min (0 = unlimited)
- **Password**: optional (UI only, not enforced server-side in current implementation)

### `src/components/api-gateway/UsageTab.tsx`

Aggregates `api_usage_logs` by model. Shows request count and total tokens per model. Filterable by API key.

### `src/components/api-gateway/LogsTab.tsx`

Table of recent requests: status code, model, endpoint, latency, input tokens, output tokens. Filterable by API key. Refresh button.

### `src/components/api-gateway/DocsTab.tsx`

Auto-generated API documentation showing:
- Base URL (from `VITE_SUPABASE_PROJECT_ID` env var)
- Code examples: Python OpenAI SDK, JavaScript/TypeScript OpenAI SDK, cURL
- Supported endpoints table: POST `/v1/chat/completions`, POST `/v1/completions`, POST `/v1/embeddings`, GET `/v1/models`
- Authentication note (Bearer token with `sk-ais-` prefix)

---

## 17. Tool System

### Tool Configuration — `src/lib/api.ts`

**`ToolConfig`** type:
```ts
{
  id: string
  name: string
  source: "built-in" | string  // MCP server id for external tools
  enabled: boolean
  description?: string
  inputSchema?: Record<string, unknown>  // JSON Schema
  capabilities: Capability[]
  layer: "local" | "edge" | "api" | "hybrid"
}
```

**`Capability`** union type:
`"local:compute" | "local:exec" | "local:fs" | "local:db" | "local:rag" | "net:http" | "net:api" | "net:git" | "cloud:storage" | "cloud:db"`

**`ExecutionMode`**: `"offline" | "hybrid" | "full"`
- `offline`: only `local:*` capabilities allowed
- `hybrid`: `local:*` + `net:http` + `cloud:*` allowed
- `full`: all capabilities allowed

**Persistence**: `localStorage` under `ai-server-tools-config`. Versioned (current version: 6) — on version mismatch, resets to defaults and merges new tools.

**`loadToolConfigs()`**: Loads from localStorage, merges new default tools, updates descriptions/schemas from defaults for built-in tools.

**`toolConfigsToDefinitions(tools)`**: Converts enabled tools with schemas to OpenAI `ToolDefinition[]` format for sending to the model.

**`canExecute(tool, mode)`**: Returns whether a tool can run in the given execution mode.

### Built-in Tools — `src/lib/builtInTools.ts`

**`executeBuiltInTool(name, args, mode)`** — dispatches to tool implementations:

| Tool ID | Layer | Capabilities | Description |
|---|---|---|---|
| `js-sandbox` | local | `local:exec` | Executes JS via `new Function()`, captures `console.log` output |
| `web-search` | edge | `net:http` | Calls Supabase Edge Function `tool-execute` with `{ tool: "web-search", args }` |
| `url-fetch` | edge | `net:http` | Calls Supabase Edge Function `tool-execute` with `{ tool: "url-fetch", args }` |
| `current-time` | local | `local:compute` | Returns ISO, local, timezone, unix timestamp |
| `calculator` | local | `local:compute` | Safe math evaluator (recursive descent parser, no `eval`) |
| `json-transform` | local | `local:compute` | format/minify/keys/count/query actions on JSON |
| `random-generator` | local | `local:compute` | uuid/password/number/color/lorem/name/email |
| `base64` | local | `local:compute` | encode/decode |
| `hash` | local | `local:compute` | SHA-256/SHA-1/SHA-384 via `crypto.subtle` |
| `file-read` | hybrid | `local:fs`, `cloud:db` | list/read/search user files in Supabase `user_files` table |
| `rag-cloud` | edge | `cloud:db` | search/add/list documents in Supabase `documents` table (full-text search + fallback ilike) |
| `rag-local` | local | `local:rag` | Stub — returns "not available yet" message |

**Calculator implementation**: Custom recursive descent parser supporting `+`, `-`, `*`, `/`, `%`, `^`, `()`, unary `-`/`+`. No `eval` or `new Function`.

**Execution mode check**: Each tool call checks `_canExecute(tool.capabilities, mode)` before running. Returns a "Blocked" message if not allowed.

### Tool Executor — `src/lib/toolExecutor.ts`

**`executeToolCall(name, argsString, mcpToolDefs, mcpServers, executionMode)`**

Dispatch logic:
1. Parse `argsString` as JSON
2. Check if `name` matches any tool in `mcpToolDefs` (MCP server tools)
3. If MCP: find the server config and call `executeMcpToolCall(server, name, args)`
4. If not MCP: call `executeBuiltInTool(name, args, executionMode)`

---

## 18. MCP Integration

### `src/lib/mcpOperations.ts`

All MCP server operations:

**`seedDefaultMcpServers(userId)`**: Inserts default MCP servers into Supabase `mcp_servers` table if none exist for the user.

**`loadMcpServersFromDb(userId)`**: Fetches all MCP servers from Supabase for the user.

**`saveMcpServerToDb(server, userId)`**: Inserts a new MCP server record.

**`updateMcpServerInDb(server)`**: Updates an existing MCP server record.

**`deleteMcpServerFromDb(id)`**: Deletes an MCP server record.

**`discoverMcpTools(server)`**: Sends `{ method: "tools/list" }` POST to the server URL. Returns `{ tools: ToolDefinition[] }`.

**`executeMcpToolCall(server, toolName, args)`**: Sends `{ method: "tools/call", params: { name: toolName, arguments: args } }` POST to the server URL. Returns result as string.

### MCP Server Config (`McpServerConfig` type)

```ts
{
  id: string
  name: string
  url: string
  status: "connected" | "disconnected"
  headers?: Record<string, string>
  tools?: string[]
  enabled?: boolean
  description?: string
}
```

Persisted to both `localStorage` (`ai-server-mcp-servers`) and Supabase `mcp_servers` table.

### MCP Protocol

Uses JSON-RPC 2.0 over HTTP POST. Two methods:
- `tools/list` → returns `{ tools: [{ name, description, inputSchema }] }`
- `tools/call` → `{ params: { name, arguments } }` → returns result

---

## 19. Download Manager

### `src/hooks/useDownloadManager.ts`

Manages GGUF model downloads from HuggingFace.

**`DownloadItem`** type:
```ts
{
  id: string           // modelId::filename
  modelId: string      // HF repo id
  filename: string     // e.g. "Qwen3-4B-Q4_K_M.gguf"
  displayName: string
  url: string          // HF direct download URL
  destDir: string      // local destination path
  status: "queued" | "downloading" | "paused" | "done" | "error" | "cancelled"
  progress: number     // 0-100
  bytesReceived: number
  totalBytes: number
  speedBps: number
  error?: string
  startedAt?: number
  finishedAt?: number
}
```

**Download flow**:
1. Try `POST /v1/download` on engine — if engine handles it, poll `GET /v1/download/progress?filename=...`
2. Fallback: browser-side `fetch()` with `ReadableStream` — tracks bytes received, calculates speed every 0.5s
3. On completion: `POST /v1/config { rescan: true }` to trigger engine model rescan

**Persistence**: `localStorage` under `ai-server:downloads`. Downloads interrupted by app restart are reset to `error` status.

**`hfDownloadUrl(repoId, filename)`**: Builds `https://huggingface.co/{repoId}/resolve/main/{filename}`

**`fetchHfGgufFiles(repoId)`**: Fetches `https://huggingface.co/api/models/{repoId}?full=true`, filters siblings by `.gguf` extension.

**Exposed methods**: `startDownload`, `cancelDownload`, `removeDownload`, `retryDownload`, `clearCompleted`

### `src/components/DownloadManager.tsx`

Modal UI for the download manager. Shows active, completed, and failed downloads. Each item shows: status icon, display name, filename, progress bar with bytes/speed/%, cancel/retry/remove buttons.

---

## 20. Supabase Integration

### Database Schema

**`api_keys`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK to auth.users |
| name | text | Human label |
| key_hash | text | SHA-256 of raw key |
| key_prefix | text | First 12 chars + "..." |
| is_active | boolean | Default true |
| rate_limit_rpm | int | 0 = unlimited |
| allowed_models | text[] | Nullable |
| last_used_at | timestamptz | Nullable |
| expires_at | timestamptz | Nullable |
| created_at / updated_at | timestamptz | |

**`api_providers`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| name | text | |
| base_url | text | |
| api_key_encrypted | text | XOR-encrypted with static key |
| provider_type | text | |
| enabled | boolean | |

**`api_usage_logs`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| api_key_id | uuid | FK to api_keys |
| model | text | |
| provider | text | |
| endpoint | text | |
| status_code | int | |
| tokens_input / tokens_output | int | Nullable |
| latency_ms | int | Nullable |
| error_message | text | Nullable |
| request_ip | text | Nullable |

**`documents`** (Cloud RAG knowledge base)
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| title | text | |
| content | text | |
| tags | text[] | |
| source | text | |
| fts | tsvector | Full-text search index |

**`mcp_servers`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| name | text | |
| url | text | |
| headers | jsonb | |
| enabled | boolean | |
| status | text | |

**`profiles`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| display_name | text | |
| avatar_url | text | |

**`user_files`**
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | |
| filename | text | |
| content | text | |
| content_type | text | |
| size_bytes | int | |

### Supabase Edge Functions

**`tool-execute`**: Handles `web-search` (DuckDuckGo) and `url-fetch` (HTML → text extraction) tool calls from the frontend. Called by `executeBuiltInTool()` for network-requiring tools.

**`api-proxy`**: The BYOK API proxy. Validates `sk-ais-` bearer tokens against `api_keys.key_hash`, enforces rate limits, proxies requests to the configured provider, logs to `api_usage_logs`.

### `src/integrations/supabase/client.ts`

Exports the Supabase client instance. Configured from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars.

---

## 21. Auth System

### `src/hooks/useAuth.ts`

```ts
function useAuth(): { user: User | null, session: Session | null, loading: boolean, signOut: () => Promise<void> }
```

Sets up `supabase.auth.onAuthStateChange` listener first, then calls `supabase.auth.getSession()` to hydrate initial state. Cleans up subscription on unmount.

Used in `Index.tsx` to gate the entire app — renders `<AuthPage>` if no user.

---

## 22. State Management & Data Flow

### Local State (React)

All state lives in React component state and custom hooks. No global state manager (Redux/Zustand/etc.).

**Key state locations**:
- `Index.tsx` — page routing, tools, providers, role, model config panel, downloads
- `useChatLogic.tsx` — sessions, messages, streaming state, tool execution
- `useServerState.ts` — server logs, connection status, loaded models
- `useDownloadManager.ts` — download queue and progress

### Persistence

| Data | Storage |
|---|---|
| Chat sessions + messages | `localStorage` |
| Tool configs | `localStorage` (`ai-server-tools-config`) |
| MCP servers | `localStorage` + Supabase `mcp_servers` |
| API providers | `localStorage` + Supabase `api_providers` |
| Settings (paths, basics, etc.) | `localStorage` |
| Downloads queue | `localStorage` (`ai-server:downloads`) |
| User role | `localStorage` (`ai-server-user-role`) |
| API keys | Supabase `api_keys` (hash only, never raw) |
| Usage logs | Supabase `api_usage_logs` |
| Documents (RAG) | Supabase `documents` |
| User files | Supabase `user_files` |
| Profile | Supabase `profiles` |

### Data Flow: Chat Message

```
User types message
  → useChatLogic appends user message
  → Builds ApiMessage[] + ToolDefinition[] (enabled tools)
  → Sends to provider (local engine or cloud API)
  → If stream: onToken callbacks update last message content
  → If tool_calls in response:
      → executeToolCall() for each call
      → Appends tool result messages
      → Re-sends to model
  → Final assistant message appended to session
  → Token count updated → propagated to status bar
```

### Data Flow: Model Download

```
User clicks "Get" on DiscoverPage
  → ModelDetail calls onStartDownload(item)
  → Index.tsx passes to useDownloadManager.startDownload()
  → Tries POST /v1/download on engine
  → Falls back to browser fetch with ReadableStream
  → Progress updates every ~0.5s
  → On done: POST /v1/config { rescan: true }
  → DownloadManager UI shows progress
```

---

## 23. Component Inventory

### Layout Components

| Component | File | Description |
|---|---|---|
| `IconSidebar` | `src/components/IconSidebar.tsx` | Left icon navigation bar. Shows page icons, settings button, downloads badge |
| `NavLink` | `src/components/NavLink.tsx` | React Router NavLink wrapper with active/pending class support |
| `KeyboardShortcuts` | `src/components/KeyboardShortcuts.tsx` | Global keyboard shortcut handler. Shortcuts: `Ctrl+N` (new chat), `Ctrl+,` (settings), `Ctrl+1-5` (pages) |

### Chat Components

| Component | File | Description |
|---|---|---|
| `ChatUI` | `src/components/chat/ChatUI.tsx` | Main chat layout |
| `MessageBubble` | `src/components/chat/MessageBubble.tsx` | Single message renderer |
| `MessageList` | `src/components/chat/MessageList.tsx` | Scrollable message container |
| `CodeBlock` | `src/components/chat/CodeBlock.tsx` | Syntax-highlighted code with copy |
| `SessionsSidebar` | `src/components/chat/SessionsSidebar.tsx` | Chat session list |
| `ModelPicker` | `src/components/chat/ModelPicker.tsx` | Model selection dropdown |
| `ProviderPicker` | `src/components/chat/ProviderPicker.tsx` | Provider selection dropdown |
| `AgentPicker` | `src/components/chat/AgentPicker.tsx` | Agent preset selector |
| `ToolConfigPanel` | `src/components/chat/ToolConfigPanel.tsx` | Tool enable/disable panel |
| `McpServersPanel` | `src/components/chat/McpServersPanel.tsx` | MCP server tools panel |

### Server Components

| Component | File | Description |
|---|---|---|
| `ServerHeader` | `src/components/server/ServerHeader.tsx` | Port input, start/stop, URL |
| `WebSocketPanel` | `src/components/server/WebSocketPanel.tsx` | HTTP polling status display |
| `LoadedModelsPanel` | `src/components/server/LoadedModelsPanel.tsx` | Loaded model list |
| `EndpointsPanel` | `src/components/server/EndpointsPanel.tsx` | Endpoint list + test buttons |
| `DevLogs` | `src/components/server/DevLogs.tsx` | Log viewer |
| `ServerStats` | `src/components/server/ServerStats.tsx` | Stats sidebar |

### Settings Components

| Component | File |
|---|---|
| `ProfileTab` | `src/components/settings/ProfileTab.tsx` |
| `BasicsTab` | `src/components/settings/BasicsTab.tsx` |
| `ProvidersTab` | `src/components/settings/ProvidersTab.tsx` |
| `McpServersTab` | `src/components/settings/McpServersTab.tsx` |
| `ToolsTab` | `src/components/settings/ToolsTab.tsx` |
| `ApiTab` | `src/components/settings/ApiTab.tsx` |
| `PathsTab` | `src/components/settings/PathsTab.tsx` |
| `AdvancedTab` | `src/components/settings/AdvancedTab.tsx` |
| `RuntimeTab` | `src/components/settings/RuntimeTab.tsx` |
| `HardwareTab` | `src/components/settings/HardwareTab.tsx` |

### Other Components

| Component | File | Description |
|---|---|---|
| `ModelConfigPanel` | `src/components/ModelConfigPanel.tsx` | Sampling params + engine reload panel |
| `DownloadManager` | `src/components/DownloadManager.tsx` | Download queue UI |
| `JsonEditorTab` | `src/components/JsonEditorTab.tsx` | JSON editor with validation |
| `KeyboardShortcuts` | `src/components/KeyboardShortcuts.tsx` | Global keyboard handler |

---

## 24. API Reference (Engine)

All endpoints on `http://localhost:1234`.

### Status & Info

```
GET  /v1/status              → { loaded, model, modelName, backend }
GET  /v1/models              → { object: "list", data: [{ id, object, created, owned_by }] }
GET  /v1/models/available    → { object: "list", data: [{ id, path, size_bytes, object }] }
GET  /v1/backends            → { object: "list", data: [{ name, displayName, description, version, gpu, gpuMake, cpu, active }] }
GET  /v1/config              → { models_dir }
GET  /v1/hardware            → HardwareInfo
GET  /v1/hardware/usage      → ResourceUsage
```

### Model Management

```
POST /v1/load    { model_path, config?: { n_ctx, n_gpu_layers, n_parallel } }
                 → { ok, model }
POST /v1/unload  → { ok }
POST /v1/stop    → { ok }
```

### Configuration

```
POST /v1/config  { models_dir?, custom_endpoints?: [{ method, path, description }] }
                 → { ok, models_dir }
```

### Inference

```
POST /v1/chat/completions
  Body: { model, messages, temperature?, top_p?, max_tokens?, stream?, stop? }
  Non-streaming: → ChatCompletionResponse
  Streaming:     → text/event-stream SSE chunks → [DONE]
```

### Download (optional engine-side)

```
POST /v1/download  { url, dest_dir, filename }
GET  /v1/download/progress?filename=...  → { progress, bytes_received, total_bytes, speed_bps, done, error }
```

---

## 25. Key Data Types

### `ApiProvider` (`src/pages/Index.tsx`)
```ts
{ id, name, baseUrl, apiKey, enabled }
```

### `ApiMessage` (`src/lib/api.ts`)
```ts
| { role: "user" | "system"; content: string }
| { role: "assistant"; content: string | null; tool_calls?: ToolCallResult[] }
| { role: "tool"; tool_call_id: string; content: string }
```

### `ToolDefinition` (`src/lib/api.ts`)
```ts
{ type: "function"; function: { name, description, parameters } }
```

### `ModelInfo` (`src/pages/discover/discoverData.ts`)
```ts
{
  id, name, author, params, size, quant, downloads, description,
  tags, abilities: ModelAbility[], source: ModelSource,
  isDownloaded?, isDownloading?, downloadProgress?,
  slug?, stars?, lastUpdated?, staffPick?,
  arch?, domain?, format?, readmeTitle?, readmePreview?,
  variants?: DownloadVariant[], gpuOffload?, kind?: "llm" | "embedding"
}
```

### `LocalModel` (`src/pages/models/modelsData.ts`)
```ts
{ id, name, author, params, size, quant, source, isLoaded, abilities, kind, trending? }
```

### `DownloadItem` (`src/hooks/useDownloadManager.ts`)
```ts
{ id, modelId, filename, displayName, url, destDir, status, progress, bytesReceived, totalBytes, speedBps, error?, startedAt?, finishedAt? }
```

### `EngineStatus` (`src/lib/localEngine.ts`)
```ts
{ available: boolean, loaded: boolean, model: string | null }
```

### `HardwareInfo` (`src/hooks/useHardwareInfo.ts`)
```ts
{ cpu: CpuInfo, memory: MemoryInfo, gpus: GpuInfo[], platform, arch }
```

### `McpServerConfig` (`src/lib/api.ts`)
```ts
{ id, name, url, status, headers?, tools?, enabled?, description? }
```

### `ToolConfig` (`src/lib/api.ts`)
```ts
{ id, name, source, enabled, description?, inputSchema?, capabilities: Capability[], layer }
```

### `BackendManifest` (`extensions/engine/types.ts`)
```ts
{
  name, version, engine, platform, extension_type, domains,
  target_libraries: [{ name, type, version }],
  cpu?: { architecture, instruction_set_extensions },
  gpu?: { make, framework, targets?, minimum_driver_version? },
  supported_model_formats
}
```

---

## 26. Current Implementation Addendum (April 2026)

This section captures architecture details that changed after the original diagrams and route notes were authored.

### 26.1 Runtime mode and process defaults

- Desktop development defaults to **dual-process mode** (`AIST_SINGLE_ENGINE=0` unless explicitly set).
- Packaged desktop defaults to **single-engine supervision** (`AIST_SINGLE_ENGINE=1`).
- Electron listens for JSON stdout events from the Go engine process and forwards `engine:port` and `aistclaw:port` to the renderer.

### 26.2 Backend-first desktop data model

Desktop paths are now backend-local first:

- Auth/session and profile data are served by Go routes (`/v1/auth/*`, `/v1/profile*`).
- Provider, MCP, KB, and usage data are stored in local JSON files under `data/`.
- `AI_SERVER_DATA_DIR` can override the default data directory.

Primary files include:

- `data/users.json`
- `data/auth_sessions.json`
- `data/providers.json`
- `data/provider_model_prefs.json`
- `data/mcp_servers.json`
- `data/documents.json`

### 26.3 Execution mode and tools (current)

- Execution mode in current frontend code is `offline | online`.
- Canonical built-in tool IDs are namespaced:
    - `web.search`
    - `web.fetch`
    - `kb.search`
    - `kb.store`
    - `kb.list`
- Legacy IDs are mapped via aliasing for compatibility (`web-search`, `url-fetch`, `knowledge-base`, etc.).
- Sandbox aliases (`js-sandbox`, `python-sandbox`) route to MCP-style names (`sandbox.run_js`, `sandbox.run_python`) and depend on MCP discovery.

### 26.4 Route-group summary from current backend registration

The server registers grouped route modules in this order:

1. models
2. chat
3. providers
4. settings
5. auth/data
6. tools
7. agent runs
8. system
9. config
10. tasks
11. components
12. events

Representative endpoints:

- `GET /v1/system/status`
- `GET /v1/system/backends`
- `POST /v1/models/load`
- `POST /v1/chat/completions`
- `GET /v1/providers/{id}/models`
- `POST /v1/providers/chat/completions`
- `POST /v1/tools/execute`
- `POST /v1/agent/chat`
- `POST /v1/mcp/proxy`

### 26.5 Startup dependencies and failure points

- `npm run dev:electron` predev steps build Go binaries before Electron launch.
- Pgvector auto-management scripts are conditional on DSN targeting `localhost:5433`.
- If Go toolchain is missing, predev build fails before app startup.
- If Docker is unavailable and DSN expects local pgvector, related backend features can fail.

### 26.6 UI architecture updates

- `ChatPage.tsx` is a thin wrapper around `useChatLogic` + `ChatUI`.
- Chat state persistence is centralized in Zustand (`chatStore`) with rehydrate cleanup for interrupted generations.
- `SettingsPage.tsx` is now a shell composing dedicated tab components rather than holding large inlined tab logic.

---

This addendum should be treated as the current source-of-truth layer on top of earlier architecture sections.
