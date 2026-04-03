import { executeBuiltInTool } from "@/lib/builtInTools";
import { executeMcpToolCall } from "@/lib/mcpOperations";
import type { McpServerConfig, ExecutionMode } from "@/lib/api";
import type { McpDiscoveryResult } from "@/components/chat/useChatLogic";

// ── Config ───────────────────────────────────────────────────────────────────
const MAX_PARALLEL   = 4;
const TOOL_TIMEOUT_MS = 15_000;
const MAX_RETRIES    = 2;
const RETRY_DELAY_MS = 500;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolTrace {
  tool: string;
  startedAt: number;   // epoch ms
  durationMs: number;
  attempt: number;
  retried: boolean;
}

export interface ToolCallResult {
  tool: string;
  success: boolean;
  result: string;
  durationMs: number;
  retryable: boolean;
  trace: ToolTrace;
}

export interface ToolCallRequest {
  name: string;
  args: string;
  /** IDs of other calls in the same batch that must complete first */
  dependsOn?: string[];
  /** Caller-assigned id for dependency tracking */
  id?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool "${label}" timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** True for transient errors worth retrying (network, timeout, 5xx) */
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|network|ECONNREFUSED|fetch|5\d\d/i.test(msg);
}

// ── Tool Router ───────────────────────────────────────────────────────────────
// Resolves a tool name to its MCP server, or null → falls back to built-in.

export function routeTool(
  name: string,
  mcpToolDefs: McpDiscoveryResult[],
  mcpServers: McpServerConfig[]
): McpServerConfig | null {
  const source = mcpToolDefs.find(s => s.tools.some(t => t.name === name));
  if (!source) return null;
  return mcpServers.find(s => s.id === source.serverId) ?? null;
}

// ── Single tool execution with retry ─────────────────────────────────────────

async function executeSingleTool(
  name: string,
  argsString: string,
  mcpToolDefs: McpDiscoveryResult[],
  mcpServers: McpServerConfig[],
  executionMode: ExecutionMode
): Promise<ToolCallResult> {
  let parsedArgs: Record<string, unknown> = {};
  try { parsedArgs = JSON.parse(argsString); } catch { /* empty */ }

  const mcpServer = routeTool(name, mcpToolDefs, mcpServers);

  // Offline guard for remote MCP servers
  if (mcpServer) {
    const isLocal = mcpServer.url.includes("localhost") || mcpServer.url.includes("127.0.0.1");
    if (!isLocal && executionMode === "offline") {
      const now = Date.now();
      return {
        tool: name, success: false, retryable: false,
        result: `Blocked: MCP server "${mcpServer.name}" is remote and cannot be used in offline mode.`,
        durationMs: 0,
        trace: { tool: name, startedAt: now, durationMs: 0, attempt: 1, retried: false },
      };
    }
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const startedAt = Date.now();
    try {
      const raw = mcpServer
        ? executeMcpToolCall(mcpServer, name, parsedArgs)
        : executeBuiltInTool(name, parsedArgs, executionMode);

      const result = await withTimeout(raw, TOOL_TIMEOUT_MS, name);
      const durationMs = Date.now() - startedAt;

      return {
        tool: name, success: true, result, retryable: false,
        durationMs,
        trace: { tool: name, startedAt, durationMs, attempt, retried: attempt > 1 },
      };
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt > MAX_RETRIES) break;
      await sleep(RETRY_DELAY_MS * attempt); // exponential-ish backoff
    }
  }

  const durationMs = 0;
  const now = Date.now();
  return {
    tool: name, success: false,
    result: `Error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    retryable: isRetryable(lastErr),
    durationMs,
    trace: { tool: name, startedAt: now, durationMs, attempt: MAX_RETRIES + 1, retried: MAX_RETRIES > 0 },
  };
}

// ── Dependency-aware parallel gateway ────────────────────────────────────────
//
// Independent calls run in parallel (up to MAX_PARALLEL).
// Calls with `dependsOn` wait for their dependencies to resolve first.

export async function executeToolCalls(
  toolCalls: ToolCallRequest[],
  mcpToolDefs: McpDiscoveryResult[],
  mcpServers: McpServerConfig[],
  executionMode: ExecutionMode
): Promise<ToolCallResult[]> {
  // Assign stable ids if not provided
  const calls = toolCalls.map((tc, i) => ({ ...tc, id: tc.id ?? String(i) }));

  const resultMap = new Map<string, ToolCallResult>();
  const pending = new Set(calls.map(c => c.id!));

  // Iteratively resolve waves of independent calls
  while (pending.size > 0) {
    // Find calls whose dependencies are all resolved
    const wave = calls.filter(c => {
      if (!pending.has(c.id!)) return false;
      return (c.dependsOn ?? []).every(dep => resultMap.has(dep));
    });

    if (wave.length === 0) {
      // Circular or unresolvable dependency — run remaining sequentially to avoid deadlock
      const stuck = calls.filter(c => pending.has(c.id!));
      for (const tc of stuck) {
        const res = await executeSingleTool(tc.name, tc.args, mcpToolDefs, mcpServers, executionMode);
        resultMap.set(tc.id!, res);
        pending.delete(tc.id!);
      }
      break;
    }

    // Execute wave in parallel chunks
    for (let i = 0; i < wave.length; i += MAX_PARALLEL) {
      const chunk = wave.slice(i, i + MAX_PARALLEL);
      const chunkResults = await Promise.all(
        chunk.map(tc => executeSingleTool(tc.name, tc.args, mcpToolDefs, mcpServers, executionMode))
      );
      chunkResults.forEach((res, j) => {
        resultMap.set(chunk[j].id!, res);
        pending.delete(chunk[j].id!);
      });
    }
  }

  // Return in original order
  return calls.map(c => resultMap.get(c.id!)!);
}

// ── Single-call shim (backwards compat) ──────────────────────────────────────

export async function executeToolCall(
  name: string,
  argsString: string,
  mcpToolDefs: McpDiscoveryResult[],
  mcpServers: McpServerConfig[],
  executionMode: ExecutionMode
): Promise<string> {
  const [res] = await executeToolCalls(
    [{ name, args: argsString }],
    mcpToolDefs,
    mcpServers,
    executionMode
  );
  return res.result;
}
