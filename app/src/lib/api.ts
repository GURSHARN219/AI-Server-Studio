import type { ApiProvider } from "@/types";
import { engineFetch as fetch, requestJson } from "@/api/client";
import { setAuthToken, authHeaders as backendHeaders } from "@/api/auth";
import { getAccountSetting, setAccountSetting, flushAccountState } from "@/stores/accountState";
import { readSSE } from "@/api/sse";
import { engineBase } from "@/lib/localEngine";

function isBackendExpectedAtRuntime(): boolean {
  return true;
}

export type ChatModel = {
  id: string;
  name: string;
  params: string;
  quant: string;
  source: "local" | "cloud" | "api";
  provider: string;
  providerId?: string;
};

export type McpServerConfig = {
  id: string;
  name: string;
  url: string;
  status: "connected" | "disconnected";
  headers?: Record<string, string>;
  tools?: string[];
  enabled?: boolean;
  description?: string;
};

export type Capability =
  | "local:exec"
  | "local:fs"
  | "local:db"
  | "net:http"
  | "net:api"
  | "cloud:db";

export type ExecutionMode = "offline" | "online";

export type ToolConfig = {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  description?: string;
  inputSchema?: Record<string, unknown>;
  capabilities: Capability[];
  layer: "local" | "edge" | "api" | "hybrid";
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCallResult = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolExecutionResult = {
  toolCallId: string;
  name: string;
  result: string;
  error?: string;
  duration: number;
};

export type BackendAgenticToolCall = {
  id: string;
  name: string;
  args: string;
  status: "done" | "error";
  result?: string;
  error?: string;
  duration?: number;
};

export type BackendProvider = {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  has_key: boolean;
  enabled: boolean;
  created_at?: string;
};

function secretFreeProvider(value: BackendProvider): BackendProvider {
  return { ...value, api_key: "", has_key: Boolean(value.has_key || value.api_key) };
}

export type BackendAuthUser = {
  id: string;
  email: string;
  created_at: string;
  display_name?: string;
};

export type BackendApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  rate_limit_rpm: number;
  allowed_models: string[] | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export type BackendUsageLog = {
  id: string;
  model: string;
  provider: string;
  endpoint: string;
  status_code: number;
  tokens_input: number | null;
  tokens_output: number | null;
  latency_ms: number | null;
  error_message: string | null;
  api_key_id: string | null;
  created_at: string;
};

export type BackendProfile = {
  user_id: string;
  display_name: string;
  avatar_url: string;
};

const STORAGE_KEY_MCP = "ai-server-mcp-servers";
const STORAGE_KEY_TOOLS = "ai-server-tools-config";
const TOOLS_VERSION = 8; // added python-sandbox, split js/py
const STORAGE_KEY_TOOLS_VERSION = "ai-server-tools-version";

export function loadMcpServers(): McpServerConfig[] {
  return [];
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  // MCP servers are loaded and saved through /mcp/servers, never installation storage.
}

export function loadToolConfigs(): ToolConfig[] {
  try {
    const savedVersion = getAccountSetting(STORAGE_KEY_TOOLS_VERSION, "");
    const currentVersion = String(TOOLS_VERSION);
    if (savedVersion !== currentVersion) {
      const defaults = getDefaultTools();
      setAccountSetting(STORAGE_KEY_TOOLS, defaults);
      setAccountSetting(STORAGE_KEY_TOOLS_VERSION, currentVersion);
      return defaults;
    }
    const saved = getAccountSetting<ToolConfig[] | null>(STORAGE_KEY_TOOLS, null);
    if (!saved) return getDefaultTools();
    const existing: ToolConfig[] = saved;
    const defaults = getDefaultTools();
    const existingIds = new Set(existing.map(t => t.id));
    const newDefaults = defaults.filter(d => !existingIds.has(d.id));
    if (newDefaults.length > 0) {
      const merged = [...existing, ...newDefaults];
      setAccountSetting(STORAGE_KEY_TOOLS, merged);
      return merged;
    }
    const defaultMap = new Map(defaults.map(d => [d.id, d]));
    const updated = existing.map(t => {
      const def = defaultMap.get(t.id);
      if (def && t.source === "built-in") {
        return { ...t, description: def.description, inputSchema: def.inputSchema, name: def.name };
      }
      return t;
    });
    setAccountSetting(STORAGE_KEY_TOOLS, updated);
    return updated;
  } catch { return getDefaultTools(); }
}

export function saveToolConfigs(tools: ToolConfig[]): void {
  setAccountSetting(STORAGE_KEY_TOOLS, tools);
}

function getDefaultTools(): ToolConfig[] {
  return [
    {
      id: "js-sandbox",
      name: "Code Sandbox (JS)",
      source: "built-in",
      enabled: true,
      description: "Execute JavaScript code securely via the local sandbox daemon (worker_threads isolation). Use for calculations, data processing, string manipulation. Use console.log() for output.",
      inputSchema: { type: "object", properties: { code: { type: "string", description: "JavaScript code to execute. Use console.log() for output." } }, required: ["code"] },
      capabilities: ["local:exec"],
      layer: "local",
    },
    {
      id: "python-sandbox",
      name: "Code Sandbox (Python)",
      source: "built-in",
      enabled: true,
      description: "Execute Python code securely via the local sandbox daemon (subprocess isolation). Use for data analysis, math, string processing. Use print() for output.",
      inputSchema: { type: "object", properties: { code: { type: "string", description: "Python code to execute. Use print() for output." } }, required: ["code"] },
      capabilities: ["local:exec"],
      layer: "local",
    },
    {
      id: "web-search",
      name: "Web Search",
      source: "built-in",
      enabled: true,
      description: "Search the web for real-time information using DuckDuckGo. Returns titles, URLs, and snippets. Use for current events, facts, and documentation lookups.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "Search query — be specific for better results" } }, required: ["query"] },
      capabilities: ["net:http"],
      layer: "edge",
    },
    {
      id: "url-fetch",
      name: "URL Fetch",
      source: "built-in",
      enabled: true,
      description: "Fetch and extract clean readable text from a public URL. Strips HTML/scripts. Use to read articles, documentation, or any public web page.",
      inputSchema: { type: "object", properties: { url: { type: "string", description: "Full public URL to fetch (must start with https://)" } }, required: ["url"] },
      capabilities: ["net:http"],
      layer: "edge",
    },
    {
      id: "knowledge-base",
      name: "Knowledge Base",
      source: "built-in",
      enabled: true,
      description: "Search, add, or list documents in the user's knowledge base. Use 'search' to retrieve relevant stored knowledge, 'add' to save new information, 'list' to browse stored documents.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "'search', 'add', or 'list'" },
          query: { type: "string", description: "Search query (for 'search' action)" },
          title: { type: "string", description: "Document title (for 'add' action)" },
          content: { type: "string", description: "Document content (for 'add' action)" },
          tags: { type: "array", description: "Optional tags (for 'add' action)", items: { type: "string" } },
        },
        required: ["action"],
      },
      capabilities: ["cloud:db"],
      layer: "edge",
    },
  ];
}

export function toolConfigsToDefinitions(tools: ToolConfig[]): ToolDefinition[] {
  return tools
    .filter(t => t.enabled && t.inputSchema)
    .map(t => ({
      type: "function" as const,
      function: {
        name: t.id,
        description: t.description || t.name,
        parameters: t.inputSchema || { type: "object", properties: {}, required: [] },
      },
    }));
}

export function canExecute(tool: Pick<ToolConfig, "capabilities">, mode: ExecutionMode): boolean {
  if (mode === "online") return true;
  if (mode === "offline") return tool.capabilities.every(c => c.startsWith("local:"));
  return false;
}

// ===== Re-exports from split modules (backward compatibility) =====
export { executeBuiltInTool } from "@/lib/builtInTools";
export {
  seedDefaultMcpServers,
  loadMcpServersFromDb,
  saveMcpServerToDb,
  updateMcpServerInDb,
  deleteMcpServerFromDb,
  executeMcpToolCall,
  discoverMcpTools,
} from "@/lib/mcpOperations";

// ===== API communication types =====

export type ApiMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallResult[] }
  | { role: "tool"; tool_call_id: string; content: string };

function buildHeaders(): Record<string, string> {
  return backendHeaders(true);
}

function completionUrl(provider: ApiProvider): string {
  if (!provider.id) throw new Error("Save this provider in API Gateway → API Providers before using it.");
  return `${engineBase()}/${provider.id === "local" ? "chat/completions" : "providers/chat/completions"}`;
}

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 3, baseDelayMs = 1000): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.ok || response.status !== 429) return response;
    lastError = new Error(`API Error 429: Rate limited${attempt < maxRetries ? ", retrying..." : ""}`);
    if (attempt < maxRetries) {
      const retryAfter = response.headers.get("Retry-After");
      const delayMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 30000)
        : baseDelayMs * Math.pow(2, attempt);
      console.warn(`[API] 429 rate limited on attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    }
  }
  throw lastError!;
}

export async function sendChatCompletionWithTools(
  provider: ApiProvider,
  messages: ApiMessage[],
  modelName: string,
  tools?: ToolDefinition[],
  options?: { temperature?: number; maxTokens?: number; topP?: number; parallelToolCalls?: boolean },
  signal?: AbortSignal,
): Promise<{ content: string | null; toolCalls: ToolCallResult[] | null; finishReason: string }> {
  const url = completionUrl(provider);
  const headers = buildHeaders();
  const body: Record<string, unknown> = {
    providerId: provider.id,
    model: modelName,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2048,
    top_p: options?.topP ?? 0.9,
    stream: false,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
    // Force one tool at a time so the agent works step-by-step
    if (options?.parallelToolCalls === false) {
      body.parallel_tool_calls = false;
    }
  }
  const response = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`API Error ${response.status}: ${errorBody || response.statusText}`);
  }
  const data = await response.json();
  const choice = (data.raw || data).choices?.[0];
  // Even if model ignores parallel_tool_calls, only take the first tool call
  const rawToolCalls: ToolCallResult[] | null = choice?.message?.tool_calls || null;
  const toolCalls = rawToolCalls && options?.parallelToolCalls === false
    ? rawToolCalls.slice(0, 1)
    : rawToolCalls;
  return {
    content: choice?.message?.content || null,
    toolCalls,
    finishReason: choice?.finish_reason || "stop",
  };
}

export async function sendBackendAgenticChat(
  provider: ApiProvider,
  messages: ApiMessage[],
  modelName: string,
  tools: ToolDefinition[],
  options?: { maxIterations?: number; executionMode?: ExecutionMode },
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: BackendAgenticToolCall[] }> {
  const url = `${engineBase()}/agent/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: {
        id: provider.id,
      },
      modelName,
      messages,
      tools,
      maxIterations: options?.maxIterations ?? 8,
      executionMode: options?.executionMode ?? "online",
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Backend agentic chat error ${response.status}: ${errorBody || response.statusText}`);
  }

  const data = await response.json();
  return {
    content: String(data.content || ""),
    toolCalls: (data.toolCalls || []) as BackendAgenticToolCall[],
  };
}

export async function listBackendProviders(signal?: AbortSignal): Promise<BackendProvider[]> {
  const result = await requestJson<{ data: BackendProvider[] }>("/providers", { signal });
  return (result.data || []).map(provider => ({ ...provider, api_key: "" }));
}

export async function createBackendProvider(payload: {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  enabled?: boolean;
}): Promise<BackendProvider> {
  const url = `${engineBase()}/providers`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Provider create failed ${response.status}: ${errorBody || response.statusText}`);
  }
  const data = await response.json();
  return secretFreeProvider(data.data as BackendProvider);
}

export async function updateBackendProvider(
  id: string,
  payload: Partial<Pick<BackendProvider, "name" | "provider_type" | "base_url" | "api_key" | "enabled">>,
): Promise<BackendProvider> {
  if (payload.api_key === "") {
    const { api_key: ignored, ...metadata } = payload;
    payload = metadata;
  }
  const url = `${engineBase()}/providers/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Provider update failed ${response.status}: ${errorBody || response.statusText}`);
  }
  const data = await response.json();
  return secretFreeProvider(data.data as BackendProvider);
}

export async function deleteBackendProvider(id: string): Promise<void> {
  const url = `${engineBase()}/providers/${encodeURIComponent(id)}`;
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Provider delete failed ${response.status}: ${errorBody || response.statusText}`);
  }
}

export async function fetchBackendProviderModels(providerId: string, signal?: AbortSignal): Promise<FetchedModel[]> {
  const url = `${engineBase()}/providers/${encodeURIComponent(providerId)}/models`;
  const response = await fetch(url, { method: "GET", signal });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Fetch provider models failed ${response.status}: ${errorBody || response.statusText}`);
  }
  const data = await response.json();
  return (data.data || []) as FetchedModel[];
}

export async function sendBackendProviderChatCompletion(
  providerId: string,
  modelName: string,
  messages: ApiMessage[],
  options?: { temperature?: number; maxTokens?: number; topP?: number },
  signal?: AbortSignal,
): Promise<{ content: string; thinking: string }> {
  const url = `${engineBase()}/providers/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId,
      model: modelName,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
    }),
    signal,
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Backend provider chat failed ${response.status}: ${errorBody || response.statusText}`);
  }
  const data = await response.json();
  return {
    content: String(data.content || ""),
    thinking: String(data.thinking || ""),
  };
}

export async function sendBackendProviderImageGeneration(
  providerId: string,
  modelName: string,
  prompt: string,
  size = "1024x1024",
  signal?: AbortSignal,
): Promise<string> {
  const url = `${engineBase()}/providers/images/generations`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, model: modelName, prompt, size }),
    signal,
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Backend image generation failed ${response.status}: ${errorBody || response.statusText}`);
  }
  const data = await response.json();
  const urlFromProvider: string = data?.data?.[0]?.url ?? data?.data?.[0]?.b64_json ?? "";
  if (!urlFromProvider) return "";
  return urlFromProvider.startsWith("http") ? urlFromProvider : `data:image/png;base64,${urlFromProvider}`;
}

export async function sendBackendProviderTranscription(
  providerId: string,
  model: string,
  file: File,
  options?: { language?: string; translate?: boolean },
): Promise<string> {
  const formData = new FormData();
  formData.append("providerId", providerId);
  formData.append("model", model);
  formData.append("file", file);
  if (options?.language) formData.append("language", options.language);
  if (options?.translate) formData.append("translate", "true");

  const url = `${engineBase()}/providers/audio/transcriptions`;
  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Backend transcription failed ${response.status}: ${errorBody || response.statusText}`);
  }
  const data = await response.json();
  return String(data.text || data.transcript || "").trim();
}

export async function sendBackendProviderSpeech(
  providerId: string,
  model: string,
  voice: string,
  input: string,
  format = "mp3",
): Promise<Blob> {
  const url = `${engineBase()}/providers/audio/speech`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, model, voice, input, format }),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Backend speech failed ${response.status}: ${errorBody || response.statusText}`);
  }
  return await response.blob();
}

export async function authBackendSignIn(email: string, password: string): Promise<BackendAuthUser> {
  const data = await requestJson<{ token: string; user: BackendAuthUser }>("/auth/signin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  setAuthToken(String(data.token || ""));
  return data.user as BackendAuthUser;
}

export async function authBackendSignUp(email: string, password: string, displayName?: string): Promise<BackendAuthUser> {
  const data = await requestJson<{ token: string; user: BackendAuthUser }>("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName || "" }),
  });
  setAuthToken(String(data.token || ""));
  return data.user as BackendAuthUser;
}

export async function authBackendSignOut(): Promise<void> {
  await flushAccountState();
  await fetch(`${engineBase()}/auth/signout`, {
    method: "POST",
    headers: backendHeaders(false),
  }).catch(() => undefined);
  setAuthToken("");
}

export async function authBackendSession(): Promise<BackendAuthUser | null> {
  if (!isBackendExpectedAtRuntime()) return null;
  try {
    const response = await fetch(`${engineBase()}/auth/session`, {
      method: "GET",
      headers: backendHeaders(false),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return (data.user || null) as BackendAuthUser | null;
  } catch {
    return null;
  }
}

export async function authBackendResetPassword(email: string): Promise<void> {
  const response = await fetch(`${engineBase()}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Reset failed (${response.status})`);
  }
}

export async function authBackendUpdatePassword(password: string): Promise<void> {
  const response = await fetch(`${engineBase()}/auth/update-password`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Update password failed (${response.status})`);
  }
}

export async function getBackendProfile(): Promise<BackendProfile> {
  const response = await fetch(`${engineBase()}/profile`, {
    method: "GET",
    headers: backendHeaders(false),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Profile fetch failed (${response.status})`);
  }
  return await response.json();
}

export async function updateBackendProfile(payload: Partial<Pick<BackendProfile, "display_name" | "avatar_url">>): Promise<BackendProfile> {
  const response = await fetch(`${engineBase()}/profile`, {
    method: "PATCH",
    headers: backendHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Profile update failed (${response.status})`);
  }
  return await response.json();
}

export async function getBackendProfileStats(): Promise<{ totalRequests: number; totalTokens: number; avgLatency: number; modelsUsed: string[]; apiKeyCount: number }> {
  const response = await fetch(`${engineBase()}/profile/stats`, {
    method: "GET",
    headers: backendHeaders(false),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Profile stats failed (${response.status})`);
  }
  return await response.json();
}

export async function listBackendApiKeys(): Promise<BackendApiKey[]> {
  return (await requestJson<{ data: BackendApiKey[] }>("/api-keys")).data || [];
}

export async function createBackendApiKey(payload: { name: string; rate_limit_rpm: number }): Promise<{ raw_key: string; data: BackendApiKey }> {
  return requestJson("/api-keys", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function patchBackendApiKey(id: string, payload: { is_active: boolean }): Promise<void> {
    const response = await fetch(`${engineBase()}/api-keys/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: backendHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `API key update failed (${response.status})`);
  }
}

export async function deleteBackendApiKey(id: string): Promise<void> {
    const response = await fetch(`${engineBase()}/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: backendHeaders(false),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `API key delete failed (${response.status})`);
  }
}

export async function listBackendUsageLogs(): Promise<BackendUsageLog[]> {
  if (!isBackendExpectedAtRuntime()) return [];
  try {
  const response = await fetch(`${engineBase()}/api-usage-logs`, {
      method: "GET",
      headers: backendHeaders(false),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []) as BackendUsageLog[];
  } catch {
    return [];
  }
}

export async function listBackendDocuments(query?: string): Promise<Array<{ id: string; title: string; content: string; tags: string[]; source: string; created_at: string }>> {
  const qs = query ? `?query=${encodeURIComponent(query)}` : "";
  const response = await fetch(`${engineBase()}/kb/documents${qs}`, {
    method: "GET",
    headers: backendHeaders(false),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Documents fetch failed (${response.status})`);
  }
  const data = await response.json();
  return data.data || [];
}

export async function createBackendDocument(payload: { title: string; content: string; tags?: string[]; source?: string }): Promise<void> {
  const response = await fetch(`${engineBase()}/kb/documents`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Document create failed (${response.status})`);
  }
}

export async function listBackendMcpServers(): Promise<McpServerConfig[]> {
  const response = await fetch(`${engineBase()}/mcp/servers`, {
    method: "GET",
    headers: backendHeaders(false),
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.data || []).map((s: McpServerConfig) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    status: s.status || "disconnected",
    headers: s.headers || {},
    enabled: !!s.enabled,
    tools: [],
    description: s.description,
  }));
}

export async function createBackendMcpServer(server: Omit<McpServerConfig, "id" | "status" | "tools">): Promise<McpServerConfig | null> {
  const response = await fetch(`${engineBase()}/mcp/servers`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify(server),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const s = data.data;
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    status: s.status || "disconnected",
    headers: s.headers || {},
    enabled: !!s.enabled,
    tools: [],
  };
}

export async function patchBackendMcpServer(id: string, updates: Partial<McpServerConfig>): Promise<boolean> {
  const response = await fetch(`${engineBase()}/mcp/servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: backendHeaders(),
    body: JSON.stringify(updates),
  });
  return response.ok;
}

export async function deleteBackendMcpServer(id: string): Promise<boolean> {
  const response = await fetch(`${engineBase()}/mcp/servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: backendHeaders(false),
  });
  return response.ok;
}

export async function callBackendMcpProxy(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${engineBase()}/mcp/proxy`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `MCP proxy failed (${response.status})`);
  }
  return response.json();
}

export type CompletionStats = {
  timings?: { predicted_per_second?: number; completion_tokens_per_second?: number };
  usage?: { completion_tokens?: number; total_time?: number };
};

export async function sendChatCompletionStreaming(
  provider: ApiProvider,
  messages: ApiMessage[],
  modelName: string,
  options?: { temperature?: number; maxTokens?: number; topP?: number },
  onToken?: (token: string, stats?: CompletionStats) => void,
  signal?: AbortSignal,
): Promise<string> {
  const url = completionUrl(provider);
  const headers = buildHeaders();

  // Detect thinking/reasoning models — word-boundary pattern to avoid false positives
  // e.g. "rethink-7b" or "unthinkable" should NOT match
  const isThinkingModel = /\bthink(ing)?\b|qwq|deepseek-r[0-9]|qwen.*reason/i.test(modelName);

  const body: Record<string, unknown> = {
    providerId: provider.id,
    model: modelName,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2048,
    top_p: options?.topP ?? 0.9,
    stream: true,
    stream_options: { include_usage: true },
  };

  // Enable thinking mode for Qwen3-Thinking / QwQ / DeepSeek-R models
  // llama-server uses chat_template_kwargs; OpenAI-compat APIs use enable_thinking
  if (isThinkingModel) {
    body.chat_template_kwargs = { enable_thinking: true };
  }


  const response = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`API Error ${response.status}: ${errorBody || response.statusText}`);
  }
  if (!response.body || response.headers.get("Content-Type")?.includes("application/json")) {
    const data = await response.json();
    const content = (data.raw || data).choices?.[0]?.message?.content || data.content || "";
    onToken?.(content);
    return content;
  }
  let fullContent = "";
  let inReasoning = false;
  await readSSE(response, ({ data }) => {
      if (data === "[DONE]") return;
      let parsed: {
        choices?: { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; thinking?: string | null } }[];
        usage?: CompletionStats["usage"];
        timings?: CompletionStats["timings"];
        x_timings?: CompletionStats["timings"];
        error?: { message?: string } | string;
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }

      if (parsed.error) {
        const errMsg = typeof parsed.error === "string" ? parsed.error : parsed.error.message || JSON.stringify(parsed.error);
        throw new Error(errMsg);
      }

      const deltaObj = parsed.choices?.[0]?.delta;
      const deltaContent = deltaObj?.content ?? "";
      const deltaReasoning = deltaObj?.reasoning_content ?? deltaObj?.reasoning ?? deltaObj?.thinking ?? "";

      let stats: CompletionStats | undefined;
      if (parsed.usage) stats = { usage: parsed.usage };
      if (parsed.timings) stats = { ...(stats || {}), timings: parsed.timings };
      if (parsed.x_timings) stats = { ...(stats || {}), timings: parsed.x_timings };

      if (deltaReasoning) {
        if (!inReasoning) {
          inReasoning = true;
          onToken?.("<think>");
        }
        onToken?.(deltaReasoning, stats);
      }

      if (deltaContent) {
        if (inReasoning) {
          inReasoning = false;
          onToken?.("</think>");
        }
        fullContent += deltaContent;
        onToken?.(deltaContent, stats);
      } else if (!deltaReasoning && stats) {
        onToken?.("", stats);
      }
  }, signal);
  if (inReasoning) {
    onToken?.("</think>");
  }
  return fullContent;
}

export type FetchedModel = {
  id: string;
  object?: string;
  owned_by?: string;
  supported_parameters?: string[];
};

export async function fetchAvailableModels(baseUrl: string, apiKey?: string, signal?: AbortSignal): Promise<FetchedModel[]> {
  const localBase = engineBase();
  if (baseUrl.replace(/\/$/, "") !== localBase) throw new Error("Save this provider in API Gateway → API Providers and fetch models using its saved ID.");
  const url = `${localBase}/models`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const response = await fetch(url, { method: "GET", headers, signal });
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    if (!data) return [];
    return (data.data || data || []) as FetchedModel[];
  } catch { return []; }
}

export function getLocalProvider(): ApiProvider {
  return { id: "local", name: "Local Server", baseUrl: engineBase(), apiKey: "", enabled: true };
}
