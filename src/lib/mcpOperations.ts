import {
  type McpServerConfig,
} from "@/lib/api";
import { getEnginePort } from "@/lib/localEngine";

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
  const res = await fetch(`${MCP_BASE()}/servers`);
  if (!res.ok) return [];
  const data = await res.json();
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

export async function saveMcpServerToDb(server: Omit<McpServerConfig, "id" | "status" | "tools">): Promise<McpServerConfig | null> {
  const res = await fetch(`${MCP_BASE()}/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  return res.ok;
}

export async function deleteMcpServerFromDb(id: string): Promise<boolean> {
  const res = await fetch(`${MCP_BASE()}/servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok;
}

export async function executeMcpToolCall(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const isLocal = server.url.includes("localhost") || server.url.includes("127.0.0.1");

  if (isLocal) {
    try {
      const resp = await fetch(server.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          ...(server.headers || {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: toolName, arguments: args },
        }),
      });
      if (!resp.ok) return `MCP Error: HTTP ${resp.status}`;
      const data = await resp.json();
      if (data.error) return `MCP Error: ${data.error.message || JSON.stringify(data.error)}`;
      return JSON.stringify(data.result ?? data, null, 2);
    } catch (e) {
      return `MCP Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  try {
    const res = await fetch(`${MCP_BASE()}/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      server_id: server.id,
      server_url: server.url,
      method: "tools/call",
      params: { name: toolName, arguments: args },
      headers: server.headers,
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
  const isLocal = server.url.includes("localhost") || server.url.includes("127.0.0.1");

  if (isLocal) {
    try {
      const resp = await fetch(server.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          ...(server.headers || {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/list", params: {} }),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      const tools = data?.result?.tools || data?.tools || [];
      return tools.map((t: any) => ({
        name: t.name,
        description: t.description || "",
        inputSchema: t.inputSchema || { type: "object", properties: {}, required: [] },
      }));
    } catch {
      return [];
    }
  }

  try {
    const res = await fetch(`${MCP_BASE()}/proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
      server_id: server.id,
      server_url: server.url,
      method: "tools/list",
      params: {},
      headers: server.headers,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`mcp-proxy ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (data?.error) return [];
    const tools = data?.result?.tools || data?.tools || [];
    return tools.map((t: any) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {}, required: [] },
    }));
  } catch {
    return [];
  }
}