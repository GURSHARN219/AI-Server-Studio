import type { ApiProvider } from "@/types";
import { getEnginePort } from "@/lib/localEngine";

function isBackendExpectedAtRuntime(): boolean {
  if (typeof window === "undefined") return true;
  return Boolean((window as any).electron);
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
  enabled: boolean;
  created_at?: string;
};

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

const AUTH_TOKEN_STORAGE_KEY = "ai-server-auth-token";

function getAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setAuthToken(token: string): void {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("auth:changed"));
  } catch {
    // ignore
  }
}

function backendHeaders(withJSON = true): Record<string, string> {
  const headers: Record<string, string> = withJSON ? { "Content-Type": "application/json" } : {};
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

const STORAGE_KEY_MCP = "ai-server-mcp-servers";
const STORAGE_KEY_TOOLS = "ai-server-tools-config";
const TOOLS_VERSION = 8; // added python-sandbox, split js/py
const STORAGE_KEY_TOOLS_VERSION = "ai-server-tools-version";

export function loadMcpServers(): McpServerConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MCP);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  localStorage.setItem(STORAGE_KEY_MCP, JSON.stringify(servers));
}

export function loadToolConfigs(): ToolConfig[] {
  try {
    const savedVersion = localStorage.getItem(STORAGE_KEY_TOOLS_VERSION);
    const currentVersion = String(TOOLS_VERSION);
    if (savedVersion !== currentVersion) {
      const defaults = getDefaultTools();
      localStorage.setItem(STORAGE_KEY_TOOLS, JSON.stringify(defaults));
      localStorage.setItem(STORAGE_KEY_TOOLS_VERSION, currentVersion);
      return defaults;
    }
    const saved = localStorage.getItem(STORAGE_KEY_TOOLS);
    if (!saved) return getDefaultTools();
    const existing: ToolConfig[] = JSON.parse(saved);
    const defaults = getDefaultTools();
    const existingIds = new Set(existing.map(t => t.id));
    const newDefaults = defaults.filter(d => !existingIds.has(d.id));
    if (newDefaults.length > 0) {
      const merged = [...existing, ...newDefaults];
      localStorage.setItem(STORAGE_KEY_TOOLS, JSON.stringify(merged));
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
    localStorage.setItem(STORAGE_KEY_TOOLS, JSON.stringify(updated));
    return updated;
  } catch { return getDefaultTools(); }
}

export function saveToolConfigs(tools: ToolConfig[]): void {
  localStorage.setItem(STORAGE_KEY_TOOLS, JSON.stringify(tools));
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

function buildHeaders(provider: ApiProvider): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers["Authorization"] = `Bearer ${provider.apiKey}`;
  if (provider.baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "AI Server Studio";
  }
  return headers;
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
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = buildHeaders(provider);
  const body: Record<string, unknown> = {
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
  const choice = data.choices?.[0];
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
  const url = `http://localhost:${getEnginePort()}/v1/agent/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
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
  if (!isBackendExpectedAtRuntime()) return [];
  const url = `http://localhost:${getEnginePort()}/v1/providers`;
  try {
    const response = await fetch(url, { method: "GET", signal });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []) as BackendProvider[];
  } catch {
    return [];
  }
}

export async function createBackendProvider(payload: {
  name: string;
  provider_type: string;
  base_url: string;
  api_key: string;
  enabled?: boolean;
}): Promise<BackendProvider> {
  const url = `http://localhost:${getEnginePort()}/v1/providers`;
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
  return data.data as BackendProvider;
}

export async function updateBackendProvider(
  id: string,
  payload: Partial<Pick<BackendProvider, "name" | "provider_type" | "base_url" | "api_key" | "enabled">>,
): Promise<BackendProvider> {
  const url = `http://localhost:${getEnginePort()}/v1/providers/${encodeURIComponent(id)}`;
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
  return data.data as BackendProvider;
}

export async function deleteBackendProvider(id: string): Promise<void> {
  const url = `http://localhost:${getEnginePort()}/v1/providers/${encodeURIComponent(id)}`;
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Provider delete failed ${response.status}: ${errorBody || response.statusText}`);
  }
}

export async function fetchBackendProviderModels(providerId: string, signal?: AbortSignal): Promise<FetchedModel[]> {
  const url = `http://localhost:${getEnginePort()}/v1/providers/${encodeURIComponent(providerId)}/models`;
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
  const url = `http://localhost:${getEnginePort()}/v1/providers/chat/completions`;
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
  console.groupCollapsed(`[ProviderChat] ${providerId} :: ${modelName}`);
  console.log("request", {
    providerId,
    modelName,
    messagesCount: messages.length,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    topP: options?.topP,
  });
  console.log("response.raw", data.raw);
  console.log("response.content", data.content);
  console.log("response.thinking", data.thinking);
  console.groupEnd();
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
  const url = `http://localhost:${getEnginePort()}/v1/providers/images/generations`;
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

  const url = `http://localhost:${getEnginePort()}/v1/providers/audio/transcriptions`;
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
  const url = `http://localhost:${getEnginePort()}/v1/providers/audio/speech`;
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Sign in failed (${response.status})`);
  }
  const data = await response.json();
  setAuthToken(String(data.token || ""));
  return data.user as BackendAuthUser;
}

export async function authBackendSignUp(email: string, password: string, displayName?: string): Promise<BackendAuthUser> {
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName || "" }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Sign up failed (${response.status})`);
  }
  const data = await response.json();
  setAuthToken(String(data.token || ""));
  return data.user as BackendAuthUser;
}

export async function authBackendSignOut(): Promise<void> {
  await fetch(`http://localhost:${getEnginePort()}/v1/auth/signout`, {
    method: "POST",
    headers: backendHeaders(false),
  }).catch(() => undefined);
  setAuthToken("");
}

export async function authBackendSession(): Promise<BackendAuthUser | null> {
  if (!isBackendExpectedAtRuntime()) return null;
  try {
    const response = await fetch(`http://localhost:${getEnginePort()}/v1/auth/session`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/auth/reset-password`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/auth/update-password`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/profile`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/profile`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/profile/stats`, {
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
  if (!isBackendExpectedAtRuntime()) return [];
  try {
    const response = await fetch(`http://localhost:${getEnginePort()}/v1/api-keys`, {
      method: "GET",
      headers: backendHeaders(false),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.data || []) as BackendApiKey[];
  } catch {
    return [];
  }
}

export async function createBackendApiKey(payload: { name: string; key_hash: string; key_prefix: string; rate_limit_rpm: number }): Promise<void> {
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/api-keys`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `API key create failed (${response.status})`);
  }
}

export async function patchBackendApiKey(id: string, payload: { is_active: boolean }): Promise<void> {
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/api-keys/${encodeURIComponent(id)}`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/api-keys/${encodeURIComponent(id)}`, {
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
    const response = await fetch(`http://localhost:${getEnginePort()}/v1/api-usage-logs`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/kb/documents${qs}`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/kb/documents`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/mcp/servers`, {
    method: "GET",
    headers: backendHeaders(false),
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.data || []).map((s: any) => ({
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/mcp/servers`, {
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
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/mcp/servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: backendHeaders(),
    body: JSON.stringify(updates),
  });
  return response.ok;
}

export async function deleteBackendMcpServer(id: string): Promise<boolean> {
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/mcp/servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: backendHeaders(false),
  });
  return response.ok;
}

export async function callBackendMcpProxy(body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`http://localhost:${getEnginePort()}/v1/mcp/proxy`, {
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

export async function sendChatCompletionStreaming(
  provider: ApiProvider,
  messages: ApiMessage[],
  modelName: string,
  options?: { temperature?: number; maxTokens?: number; topP?: number },
  onToken?: (token: string, stats?: Record<string, any>) => void,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = buildHeaders(provider);

  // Detect thinking/reasoning models — word-boundary pattern to avoid false positives
  // e.g. "rethink-7b" or "unthinkable" should NOT match
  const isThinkingModel = /\bthink(ing)?\b|qwq|deepseek-r[0-9]|qwen.*reason/i.test(modelName);

  const body: Record<string, any> = {
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

  console.log("[Chat] Sending context to model:", modelName, JSON.stringify(body, null, 2));

  const response = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`API Error ${response.status}: ${errorBody || response.statusText}`);
  }
  if (!response.body) {
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        
        let stats: Record<string, any> | undefined;
        // Check for usage/timings in openai/llama.cpp format
        if (parsed.usage) stats = { usage: parsed.usage };
        if (parsed.timings) stats = { ...(stats || {}), timings: parsed.timings };
        if (parsed.x_timings) stats = { ...(stats || {}), timings: parsed.x_timings };

        if (delta || stats) { 
            if (delta) fullContent += delta; 
            onToken?.(delta || "", stats); 
        }
      } catch { /* skip */ }
    }
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
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  try {
    const response = await fetch(url, { method: "GET", headers, signal });
    if (!response.ok) return [];
    const data = await response.json().catch(() => null);
    if (!data) return [];
    return (data.data || data || []) as FetchedModel[];
  } catch { return []; }
}

export function getLocalProvider(): ApiProvider {
  return { id: "local", name: "Local Server", baseUrl: `http://localhost:${getEnginePort()}/v1`, apiKey: "", enabled: true };
}
