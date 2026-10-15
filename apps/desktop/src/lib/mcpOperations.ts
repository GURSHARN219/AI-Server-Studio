import {
  type McpServerConfig,
} from "@/lib/api";
import { engineAuthHeaders, getEnginePort } from "@/lib/localEngine";

const MCP_BASE = () => `http://localhost:${getEnginePort()}/v1/mcp`;

const DEFAULT_MCP_SERVERS = [
  {
    name: "Filesystem (Local)",
    url: "http://localhost:3001/mcp",
    headers: {},
    enabled: false,
    description: "Access local filesystem. Requires running npx @modelcontextprotocol/server-filesystem locally.",
  },
  {
    name: "Brave Search",
    url: "https://api.search.brave.com/mcp",
    headers: { "X-Subscription-Token": "" },
    enabled: false,
    description: "Web search via Brave Search API. Requires BRAVE_API_KEY in headers.",
  },
  {
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    headers: { "Authorization": "Bearer YOUR_GITHUB_TOKEN" },
    enabled: false,
    description: "Access GitHub repos, issues, PRs. Requires a GitHub personal access token.",
  },
  {
    name: "Puppeteer",
    url: "http://localhost:3002/mcp",
    headers: {},
    enabled: false,
    description: "Browser automation. Requires running npx @modelcontextprotocol/server-puppeteer locally.",
  },
  {
    name: "SQLite",
    url: "http://localhost:3003/mcp",
    headers: {},
    enabled: false,
    description: "Query SQLite databases. Requires running npx @modelcontextprotocol/server-sqlite locally.",
  },
];

export async function seedDefaultMcpServers(): Promise<void> {
  const existing = await loadMcpServersFromDb();
  if (existing.length > 0) return;

  for (const server of DEFAULT_MCP_SERVERS) {
    await saveMcpServerToDb({
      name: server.name,
      url: server.url,
      headers: server.headers,
      enabled: server.enabled,
      description: server.description,
    });
  }
}

export async function loadMcpServersFromDb(): Promise<McpServerConfig[]> {
  const res = await fetch(`${MCP_BASE()}/servers`, { headers: engineAuthHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
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

export async function saveMcpServerToDb(server: Omit<McpServerConfig, "id" | "status" | "tools">): Promise<McpServerConfig | null> {
  const res = await fetch(`${MCP_BASE()}/servers`, {
    method: "POST",
    headers: engineAuthHeaders(true),
    body: JSON.stringify(server),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    id: data.data.id,
    name: data.data.name,
    url: data.data.url,
    status: data.data.status || "disconnected",
    headers: data.data.headers || {},
    enabled: !!data.data.enabled,
    tools: [],
    description: data.data.description,
  };
}

export async function updateMcpServerInDb(id: string, updates: Partial<McpServerConfig>): Promise<boolean> {
  const res = await fetch(`${MCP_BASE()}/servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: engineAuthHeaders(true),
    body: JSON.stringify(updates),
  });
  return res.ok;
}

export async function deleteMcpServerFromDb(id: string): Promise<boolean> {
  const res = await fetch(`${MCP_BASE()}/servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  headers: engineAuthHeaders(),
  });
  return res.ok;
}

export async function executeMcpToolCall(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (!server.id) return "Save this MCP server in Settings → MCP Servers before running tools.";
  try {
    const res = await fetch(`${MCP_BASE()}/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      server_id: server.id,
      method: "tools/call",
      params: { name: toolName, arguments: args },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`mcp-proxy ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (data?.error) return `MCP Error: ${typeof data.error === "string" ? data.error : data.error.message || JSON.stringify(data.error)}`;
    return JSON.stringify(data?.result ?? data, null, 2);
  } catch (e) {
    return `MCP Proxy Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function discoverMcpTools(server: McpServerConfig): Promise<{ name: string; description: string; inputSchema: Record<string, unknown> }[]> {
  if (!server.id) throw new Error("Save this MCP server in Settings → MCP Servers before discovering tools.");
  try {
    const res = await fetch(`${MCP_BASE()}/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      server_id: server.id,
      method: "tools/list",
      params: {},
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`mcp-proxy ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (data?.error) return [];
    const tools = data?.result?.tools || data?.tools || [];
    return tools.map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {}, required: [] },
    }));
  } catch {
    return [];
  }
}
import { engineFetch as fetch } from "@/api/client";
