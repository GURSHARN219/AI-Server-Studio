# AI Server Studio – Performance Refactor, Bug Fixes & llama.cpp Integration

Overview of three improvement areas: decomposing monolith files for performance, fixing identified bugs, and planning real llama.cpp local inference.

---

## 📊 Current State

| File | Lines | Bytes | Problem |
|---|---|---|---|
| [ChatPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx) | **2,129** | 85 KB | 30+ useState, all logic + UI in one component |
| [SettingsPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/SettingsPage.tsx) | **1,544** | 88 KB | 10 tabs rendered inline, massive state |
| [api.ts](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts) | **888** | 35 KB | Tool execution, MCP, API calls all in one file |
| [ServerPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ServerPage.tsx) | **713** | 34 KB | Moderate – lower priority |

---

## Phase 1: Performance – Decompose Monolith Files

### 1A. Split [ChatPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx) → ~8 files

#### [NEW] [useChatState.ts](file:///a:/Tempestoxprojects/open-studio-main/src/hooks/useChatState.ts)
Extract all 15+ state variables for tabs, messages, and localStorage persistence into a custom hook.

#### [NEW] [useModelSelection.ts](file:///a:/Tempestoxprojects/open-studio-main/src/hooks/useModelSelection.ts)
Extract model fetching, provider selection, model filtering logic (~lines 413–509).

#### [NEW] [useMcpDiscovery.ts](file:///a:/Tempestoxprojects/open-studio-main/src/hooks/useMcpDiscovery.ts)
Extract MCP server discovery, tool resolution (~lines 341–405).

#### [NEW] [useChatEngine.ts](file:///a:/Tempestoxprojects/open-studio-main/src/hooks/useChatEngine.ts)
Extract [handleSend](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#632-922), the tool-call loop, streaming, abort logic (~lines 632–921).

#### [NEW] [SessionsSidebar.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/chat/SessionsSidebar.tsx)
Extract the chat sessions sidebar panel (~lines 1031–1088).

#### [NEW] [ChatInput.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/chat/ChatInput.tsx)
Extract the entire input area with agent picker, model picker, tool/MCP popups (~lines 1153–1767). This alone is **600+ lines**.

#### [NEW] [MessageBubble.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/chat/MessageBubble.tsx)
Move the existing [MessageBubble](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#1830-2129) function component to its own file. Wrap with `React.memo`.

#### [NEW] [CodeBlock.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/chat/CodeBlock.tsx)
Move the existing [CodeBlock](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#1773-1829) function component to its own file.

#### [MODIFY] [ChatPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx)
Compose the page from the above extracted hooks and components. Target: **~150 lines**.

---

### 1B. Split [SettingsPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/SettingsPage.tsx) → tab components

#### [NEW] [ProfileTab.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/settings/ProfileTab.tsx)
Profile & Security section (~lines 525–712).

#### [NEW] [ProvidersTab.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/settings/ProvidersTab.tsx)
API Providers section with add/edit/delete (~lines 739–900+).

#### [NEW] [McpTab.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/settings/McpTab.tsx)
MCP Servers management tab.

#### [NEW] [ToolsTab.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/settings/ToolsTab.tsx)
Tools configuration tab.

#### [NEW] [BasicsTab.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/components/settings/BasicsTab.tsx)
General + Performance settings.

#### [MODIFY] [SettingsPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/SettingsPage.tsx)
Import and render tab components. Target: **~200 lines**.

---

### 1C. Split [api.ts](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts) → domain modules

#### [NEW] [tools.ts](file:///a:/Tempestoxprojects/open-studio-main/src/lib/tools.ts)
Built-in tool definitions ([getDefaultTools](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts#241-364)) and [executeBuiltInTool](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts#379-637) (~250 lines).

#### [NEW] [mcp.ts](file:///a:/Tempestoxprojects/open-studio-main/src/lib/mcp.ts)
MCP server CRUD, discovery, tool execution, seeding (~200 lines).

#### [NEW] [chat.ts](file:///a:/Tempestoxprojects/open-studio-main/src/lib/chat.ts)
[sendChatCompletionWithTools](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts#758-802), [sendChatCompletionStreaming](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts#803-861), [fetchAvailableModels](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts#870-883) (~150 lines).

#### [MODIFY] [api.ts](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts)
Re-export everything from the new modules for backward compatibility. Target: **~30 lines**.

---

### 1D. React Performance

- Wrap [MessageBubble](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#1830-2129) with `React.memo`
- Wrap [CodeBlock](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#1773-1829) with `React.memo`
- Use `useCallback` for all event handlers passed to children
- Memoize filtered model lists with `useMemo`

---

## Phase 2: Bug Fixes

### 🐛 Bug 1 — Stale Closure in [handleSend](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#632-922) (Critical)
**File**: [ChatPage.tsx:694](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L694)
```typescript
// BUG: `messages` is captured from render scope, not the latest state
const apiMessages: ApiMessage[] = [...messages, userMsg]
```
`messages` is a stale reference. If two rapid sends happen, the second send won't include the first assistant response. **Fix**: Use a ref or functional update pattern.

### 🐛 Bug 2 — Missing `useEffect` Dependencies (Multiple)
**File**: [ChatPage.tsx:507](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L507)
```typescript
// BUG: allModels and selectedModel are not in deps
useEffect(() => { ... }, [selectedProviderId, allModels]);
// selectedModel referenced but not in deps
```
**File**: [ChatPage.tsx:541](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L541)
```typescript
// BUG: addNewTab is not in deps, will use stale function
useEffect(() => {
  if (newChatTrigger && newChatTrigger > 0) addNewTab();
}, [newChatTrigger]);
```

### 🐛 Bug 3 — `selectedModel` Used Before Initialization
**File**: [ChatPage.tsx:503-509](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L503-L509)
```typescript
// useEffect at line 496 references selectedModel
// But selectedModel is declared at line 509 — after the effect!
const [selectedModel, setSelectedModel] = useState<ModelDef>(models[0]);
```
This can crash if `models` is empty (e.g., no provider connected). `models[0]` will be `undefined`.

### 🐛 Bug 4 — XOR "Encryption" is Reversible (Security)
**File**: [SettingsPage.tsx:36-44](file:///a:/Tempestoxprojects/open-studio-main/src/pages/SettingsPage.tsx#L36-L44)
```typescript
function encryptApiKey(key: string): string {
  const encKey = "lovable-encrypt-key"; // Hardcoded XOR key
  // ... XOR + btoa
}
```
This is trivially reversible. Anyone with the frontend JS can decode all stored API keys. **Fix**: Use Supabase Edge Function for encryption, or store keys server-side only.

### 🐛 Bug 5 — `new Function()` Code Execution (Security)
**File**: [api.ts:390](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts#L390)
```typescript
const fn = new Function("return (async () => { " + code + " })()");
```
The `js-sandbox` tool executes arbitrary code with full access to the page context (`document`, `window`, `localStorage`, cookies). A malicious LLM response could exfiltrate data. **Fix**: Use a Web Worker or iframe sandbox.

### 🐛 Bug 6 — `new Function()` in Calculator (Injection)
**File**: [api.ts:449](file:///a:/Tempestoxprojects/open-studio-main/src/lib/api.ts#L449)
```typescript
const result = new Function(`return (${expr})`)();
```
The regex check at line 446 can be bypassed (e.g., `1+1)+(alert(1),` works because `(` and `)` are allowed). **Fix**: Use a proper math expression parser.

### 🐛 Bug 7 — MCP Server `enabled` Not Set in [handleAddMcp](file:///a:/Tempestoxprojects/open-studio-main/src/pages/SettingsPage.tsx#169-184)
**File**: [ChatPage.tsx:985-999](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L985-L999)
```typescript
// BUG: Missing `enabled` field — defaults to undefined (falsy)
setMcpServers(prev => [...prev, {
  id: `mcp-${Date.now()}`,
  name: newMcpName,
  url: newMcpUrl || "http://localhost:3001",
  status: "disconnected",
  // no `enabled` field!
}]);
```
New MCP servers won't be discovered because the discovery filter checks `s.enabled`.

### 🐛 Bug 8 — [toggleMcpStatus](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#1003-1014) Toggles Wrong Field
**File**: [ChatPage.tsx:1003-1013](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L1003-L1013)
```typescript
// Toggles `status` string between "connected"/"disconnected"
// But this is supposed to be a connection status, not an enable/disable toggle
```
The button that calls this looks like an enable/disable toggle (green/gray dot) but it changes [status](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ServerPage.tsx#284-291) instead of `enabled`. The MCP discovery filter checks `s.enabled`, not `s.status`.

### 🐛 Bug 9 — Fake System Stats in [Index.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/Index.tsx)
**File**: [Index.tsx:126-134](file:///a:/Tempestoxprojects/open-studio-main/src/pages/Index.tsx#L126-L134)
```typescript
setInterval(() => {
  setFps(Math.floor(58 + Math.random() * 4));
  setGpu(Math.floor(Math.random() * 8));
  // ... all values are random noise
}, 2000);
```
Status bar shows fake GPU/CPU/RAM/FPS values. This is misleading.

### 🐛 Bug 10 — Regenerate Button Does Nothing
**File**: [ChatPage.tsx:2100-2104](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L2100-L2104)
```typescript
<button title="Regenerate">
  <RotateCcw className="w-3.5 h-3.5" />
</button>
// No onClick handler!
```

### 🐛 Bug 11 — Chat Search Input Does Nothing
**File**: [ChatPage.tsx:1046-1051](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L1046-L1051)
The sessions sidebar search input has no [value](file:///a:/Tempestoxprojects/open-studio-main/src/test/setup.ts#5-15) or `onChange` — it's a dead input.

### 🐛 Bug 12 — localStorage Grows Unbounded
**File**: [ChatPage.tsx:522-527](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx#L522-L527)
All messages (including base64 image data) are serialized to localStorage on every change. With images, this quickly exceeds the ~5MB localStorage quota and silently fails.

---

## Phase 3: llama.cpp Local Integration

The app uses a native llama.cpp engine at `http://localhost:1234/v1` via the `.node` bindings in `extensions/backends/`. Run with `npm run dev:engine`.

### Architecture Options

#### Option A: Bundled llama.cpp Server (Recommended)
Ship a **llama-server** binary (or `llama.cpp`'s `server` example) with the app. On startup:
1. App spawns `llama-server --port 1234 --model <path>` as a child process
2. Frontend continues to use the existing OpenAI-compatible API layer
3. User picks model files from local disk (GGUF format)

> [!IMPORTANT]
> This requires the app to be an **Electron/Tauri** desktop app (not just a web app). Currently it's a pure Vite web app with no native capabilities.

**New files needed:**
- `src/lib/llamaCpp.ts` — Process management (start/stop/monitor the llama-server)
- `src/hooks/useLlamaServer.ts` — React hook for server lifecycle
- `src/components/settings/LocalModelManager.tsx` — UI for picking GGUF files, starting server

**Changes to existing files:**
- [ServerPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ServerPage.tsx) — Add llama.cpp server status panel
- [ChatPage.tsx](file:///a:/Tempestoxprojects/open-studio-main/src/pages/ChatPage.tsx) / `useChatEngine.ts` — Auto-detect when local server is llama.cpp

#### Option B: WebAssembly (Experimental)
Use `llama.cpp` compiled to WASM (e.g., via [whisper.cpp WASM pattern](https://github.com/nichochar/llamero)):
- Runs entirely in browser, no backend needed
- Very slow (no GPU, limited to small models)
- Would require new `src/lib/llamaWasm.ts` wrapper

#### Option C: Node.js Bindings (if using Electron)
Use `node-llama-cpp` package:
- `npm install node-llama-cpp`
- Native bindings with GPU support via Electron's Node process
- New `src/lib/llamaNode.ts` — Direct inference API

### Recommended Path: Option A (Bundled Server)

This is the simplest and most portable approach:

```
┌──────────────┐     HTTP (OpenAI API)     ┌──────────────────┐
│  React App   │ ◄────────────────────────► │  llama-server    │
│  (Renderer)  │     localhost:1234         │  (Child Process) │
└──────────────┘                           └──────────────────┘
                                                  │
                                           ┌──────┴──────┐
                                           │  GGUF Model │
                                           │  (~4-8 GB)  │
                                           └─────────────┘
```

> [!WARNING]
> To spawn child processes and access the file system, the app must be wrapped in **Electron** or **Tauri**. This is a significant architectural change. The current pure web app can only connect to an already-running llama-server started externally.

### Interim Steps (No Electron Required)
1. Add UI to configure the local server URL (currently hardcoded to `localhost:1234`)
2. Add a "Start llama-server" instructions panel showing the exact command
3. Add health-check polling to detect when the local server is running
4. Add model file browser (eventually via File System Access API)

---

## Verification Plan

### Automated Tests
The project uses **Vitest**. Current tests are minimal (only [example.test.ts](file:///a:/Tempestoxprojects/open-studio-main/src/test/example.test.ts)).

```powershell
# Run existing tests
cd a:\Tempestoxprojects\open-studio-main
npm run test
```

After refactoring, verify:
- `npm run build` succeeds with no TypeScript errors
- `npm run test` passes
- No new lint errors from `npm run lint`

### Manual Verification
1. **After Phase 1**: Open the app in browser, verify all pages still render correctly. Chat, settings, server page should all work identically.
2. **After Phase 2**: Test each bug fix individually:
   - Send two rapid messages → both should be in context
   - Add an MCP server → it should be enabled by default
   - Check that regenerate button works
3. **After Phase 3**: Start a local llama-server manually, verify the app connects and streams responses.

> [!NOTE]
> I recommend we **start with Phase 2 (bug fixes)** first since they're quick wins, then tackle Phase 1 (decomposition) as the larger effort. Phase 3 depends on the Electron/Tauri decision.
