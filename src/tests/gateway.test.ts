/**
 * MCP Gateway — unit tests
 *
 * Tests cover:
 *  - routeTool: MCP resolution, built-in fallback
 *  - executeToolCalls: parallel execution, dependency ordering,
 *    timeout, retry, offline guard, structured results
 *  - builtInTools: legacy alias resolution, SSRF guard, unknown tool
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Minimal stubs so imports don't blow up in jsdom ─────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      textSearch: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "1" }, error: null }),
      order: vi.fn().mockReturnThis(),
    })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
  },
}));

vi.mock("@/lib/mcpOperations", () => ({
  executeMcpToolCall: vi.fn(),
}));

vi.mock("@/lib/localEngine", () => ({
  getEnginePort: vi.fn(() => 1234),
}));

// ── Imports after mocks ──────────────────────────────────────────────────────

import { routeTool, executeToolCalls, executeToolCall } from "@/lib/toolExecutor";
import { executeBuiltInTool } from "@/lib/builtInTools";
import { executeMcpToolCall } from "@/lib/mcpOperations";
import type { McpServerConfig } from "@/lib/api";
import type { McpDiscoveryResult } from "@/components/chat/useChatLogic";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const localServer: McpServerConfig = {
  id: "srv-local",
  name: "Local Sandbox",
  url: "http://localhost:4002",
  status: "connected",
  enabled: true,
};

const remoteServer: McpServerConfig = {
  id: "srv-remote",
  name: "Remote KB",
  url: "https://kb.example.com/mcp",
  status: "connected",
  enabled: true,
};

const mcpDefs: McpDiscoveryResult[] = [
  {
    serverId: "srv-local",
    serverName: "Local Sandbox",
    tools: [
      { name: "sandbox.run_js",     description: "Run JS",     inputSchema: {} },
      { name: "sandbox.run_python", description: "Run Python", inputSchema: {} },
    ],
  },
  {
    serverId: "srv-remote",
    serverName: "Remote KB",
    tools: [
      { name: "kb.search", description: "Search KB", inputSchema: {} },
    ],
  },
];

const mcpServers = [localServer, remoteServer];

// ── routeTool ────────────────────────────────────────────────────────────────

describe("routeTool", () => {
  it("resolves a known MCP tool to its server", () => {
    const server = routeTool("sandbox.run_js", mcpDefs, mcpServers);
    expect(server?.id).toBe("srv-local");
  });

  it("resolves a remote MCP tool", () => {
    const server = routeTool("kb.search", mcpDefs, mcpServers);
    expect(server?.id).toBe("srv-remote");
  });

  it("returns null for a built-in tool (no MCP match)", () => {
    const server = routeTool("web.search", mcpDefs, mcpServers);
    expect(server).toBeNull();
  });

  it("returns null for an unknown tool", () => {
    const server = routeTool("does.not.exist", mcpDefs, mcpServers);
    expect(server).toBeNull();
  });
});

// ── executeToolCalls — structured result shape ────────────────────────────────

describe("executeToolCalls — result shape", () => {
  beforeEach(() => {
    vi.mocked(executeMcpToolCall).mockResolvedValue("42");
  });

  it("returns ToolCallResult with all required fields", async () => {
    const results = await executeToolCalls(
      [{ name: "sandbox.run_js", args: '{"code":"1+1"}' }],
      mcpDefs, mcpServers, "online"
    );

    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.tool).toBe("sandbox.run_js");
    expect(r.success).toBe(true);
    expect(r.result).toBe("42");
    expect(typeof r.durationMs).toBe("number");
    expect(r.retryable).toBe(false);
    expect(r.trace).toMatchObject({
      tool: "sandbox.run_js",
      attempt: 1,
      retried: false,
    });
  });
});

// ── executeToolCalls — parallel execution ────────────────────────────────────

describe("executeToolCalls — parallel execution", () => {
  it("runs independent calls concurrently (all resolve in ~same tick)", async () => {
    const order: string[] = [];

    vi.mocked(executeMcpToolCall).mockImplementation(async (server, name) => {
      order.push(`start:${name}`);
      await new Promise(r => setTimeout(r, 10));
      order.push(`end:${name}`);
      return `result:${name}`;
    });

    const results = await executeToolCalls(
      [
        { name: "sandbox.run_js",     args: "{}", id: "a" },
        { name: "sandbox.run_python", args: "{}", id: "b" },
      ],
      mcpDefs, mcpServers, "online"
    );

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);

    // Both starts should appear before either end (parallel, not sequential)
    expect(order.indexOf("start:sandbox.run_js")).toBeLessThan(order.indexOf("end:sandbox.run_python"));
    expect(order.indexOf("start:sandbox.run_python")).toBeLessThan(order.indexOf("end:sandbox.run_js"));
  });
});

// ── executeToolCalls — dependency ordering ───────────────────────────────────

describe("executeToolCalls — dependency ordering", () => {
  it("runs dependent call only after its dependency resolves", async () => {
    const order: string[] = [];

    vi.mocked(executeMcpToolCall).mockImplementation(async (server, name) => {
      order.push(name);
      return `ok:${name}`;
    });

    await executeToolCalls(
      [
        { name: "sandbox.run_js",     args: "{}", id: "step1" },
        { name: "sandbox.run_python", args: "{}", id: "step2", dependsOn: ["step1"] },
      ],
      mcpDefs, mcpServers, "online"
    );

    expect(order[0]).toBe("sandbox.run_js");
    expect(order[1]).toBe("sandbox.run_python");
  });

  it("preserves original result order regardless of execution order", async () => {
    vi.mocked(executeMcpToolCall).mockImplementation(async (server, name) => `r:${name}`);

    const results = await executeToolCalls(
      [
        { name: "sandbox.run_js",     args: "{}", id: "a" },
        { name: "sandbox.run_python", args: "{}", id: "b", dependsOn: ["a"] },
      ],
      mcpDefs, mcpServers, "online"
    );

    expect(results[0].tool).toBe("sandbox.run_js");
    expect(results[1].tool).toBe("sandbox.run_python");
  });
});

// ── executeToolCalls — offline guard ─────────────────────────────────────────

describe("executeToolCalls — offline guard", () => {
  it("blocks remote MCP server in offline mode", async () => {
    const results = await executeToolCalls(
      [{ name: "kb.search", args: '{"query":"test"}' }],
      mcpDefs, mcpServers, "offline"
    );

    expect(results[0].success).toBe(false);
    expect(results[0].result).toMatch(/Blocked.*remote.*offline/i);
    expect(results[0].retryable).toBe(false);
  });

  it("allows local MCP server in offline mode", async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValue("js result");

    const results = await executeToolCalls(
      [{ name: "sandbox.run_js", args: '{"code":"1"}' }],
      mcpDefs, mcpServers, "offline"
    );

    expect(results[0].success).toBe(true);
  });
});

// ── executeToolCalls — timeout ────────────────────────────────────────────────

describe("executeToolCalls — timeout", () => {
  it("marks result as failed when tool exceeds timeout", async () => {
    // Simulate the timeout error the gateway produces — reject immediately
    // with the same message format withTimeout() generates.
    vi.mocked(executeMcpToolCall).mockRejectedValue(
      new Error('Tool "sandbox.run_js" timed out after 15000ms')
    );

    const results = await executeToolCalls(
      [{ name: "sandbox.run_js", args: "{}" }],
      mcpDefs, mcpServers, "online"
    );

    expect(results[0].success).toBe(false);
    expect(results[0].result).toMatch(/timed out/i);
    expect(results[0].retryable).toBe(true); // timeout is retryable
  });
});

// ── executeToolCalls — retry ──────────────────────────────────────────────────

describe("executeToolCalls — retry", () => {
  it("retries on transient network error and succeeds on second attempt", async () => {
    let calls = 0;
    vi.mocked(executeMcpToolCall).mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error("fetch failed: network error");
      return "recovered";
    });

    const results = await executeToolCalls(
      [{ name: "sandbox.run_js", args: "{}" }],
      mcpDefs, mcpServers, "online"
    );

    expect(results[0].success).toBe(true);
    expect(results[0].result).toBe("recovered");
    expect(results[0].trace.retried).toBe(true);
    expect(results[0].trace.attempt).toBe(2);
    expect(calls).toBe(2);
  });

  it("marks non-retryable errors as retryable=false", async () => {
    vi.mocked(executeMcpToolCall).mockRejectedValue(new Error("Invalid arguments"));

    const results = await executeToolCalls(
      [{ name: "sandbox.run_js", args: "{}" }],
      mcpDefs, mcpServers, "online"
    );

    expect(results[0].success).toBe(false);
    expect(results[0].retryable).toBe(false);
  });
});

// ── executeToolCall shim ──────────────────────────────────────────────────────

describe("executeToolCall (shim)", () => {
  it("returns result string directly", async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValue("shim result");

    const result = await executeToolCall(
      "sandbox.run_js", '{"code":"1"}', mcpDefs, mcpServers, "online"
    );

    expect(result).toBe("shim result");
  });
});

// ── builtInTools — legacy alias resolution ────────────────────────────────────

describe("executeBuiltInTool — legacy aliases", () => {
  it("web-search resolves to web.search handler (calls supabase)", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { results: [] }, error: null
    } as any);

    const result = await executeBuiltInTool("web-search", { query: "test" }, "online");
    expect(supabase.functions.invoke).toHaveBeenCalledWith("tool-execute", expect.objectContaining({
      body: expect.objectContaining({ tool: "web-search" }),
    }));
    expect(typeof result).toBe("string");
  });

  it("url-fetch resolves to web.fetch handler", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { content: "page" }, error: null
    } as any);

    const result = await executeBuiltInTool("url-fetch", { url: "https://example.com" }, "online");
    expect(supabase.functions.invoke).toHaveBeenCalledWith("tool-execute", expect.objectContaining({
      body: expect.objectContaining({ tool: "url-fetch" }),
    }));
    expect(typeof result).toBe("string");
  });

  it("knowledge-base resolves to kb.search handler", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    // kb.search uses supabase.from(), not functions.invoke
    const result = await executeBuiltInTool("knowledge-base", { action: "search", query: "hello" }, "online");
    expect(typeof result).toBe("string");
  });
});

// ── builtInTools — SSRF guard ─────────────────────────────────────────────────

describe("executeBuiltInTool — SSRF guard", () => {
  it("blocks http:// URLs", async () => {
    const result = await executeBuiltInTool("url-fetch", { url: "http://example.com" }, "online");
    expect(result).toMatch(/Only HTTPS/i);
  });

  it("blocks localhost URLs", async () => {
    const result = await executeBuiltInTool("url-fetch", { url: "https://localhost/secret" }, "online");
    expect(result).toMatch(/private\/internal/i);
  });

  it("blocks 192.168.x.x", async () => {
    const result = await executeBuiltInTool("url-fetch", { url: "https://192.168.1.1/admin" }, "online");
    expect(result).toMatch(/private\/internal/i);
  });
});

// ── builtInTools — unknown tool ───────────────────────────────────────────────

describe("executeBuiltInTool — unknown tool", () => {
  it("returns helpful error for completely unknown tool name", async () => {
    const result = await executeBuiltInTool("does.not.exist", {}, "online");
    expect(result).toMatch(/Unknown tool/i);
    expect(result).toMatch(/web\.search/);
  });

  it("sandbox legacy names return clear MCP-redirect message", async () => {
    // js-sandbox and python-sandbox are aliased to sandbox.run_js/run_python
    // which are MCP-only — builtInTools has no handler for them, so falls to default
    const result = await executeBuiltInTool("js-sandbox", { code: "1+1" }, "online");
    // Should hit the default case since sandbox.run_js has no built-in handler
    expect(result).toMatch(/Unknown tool/i);
  });
});
