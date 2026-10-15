import { engineApiBase, requestJson } from "@/api/client";
import type { AgentRunEvent } from "@/lib/agent";
import type { ApiMessage, ExecutionMode, ToolDefinition } from "@/lib/api";
import type { ApiProvider } from "@/types";

export type AgentRunResponse = { id: string; status: string };

export type AgentRunSnapshot = {
  id: string;
  goal?: string;
  modelName?: string;
  status: string;
  result?: string;
  plan?: unknown;
  totalTokens?: number;
  iterations?: number;
};

export async function createAgentRun(payload: {
  goal: string;
  modelName: string;
  provider: Pick<ApiProvider, "id">;
  tools: ToolDefinition[];
  executionMode: ExecutionMode;
  maxSteps: number;
  maxIterations: number;
}): Promise<AgentRunResponse> {
  return requestJson<AgentRunResponse>("/agent/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getAgentRun(id: string, signal?: AbortSignal): Promise<AgentRunSnapshot> {
  return requestJson<AgentRunSnapshot>(`/agent/runs/${encodeURIComponent(id)}`, { signal });
}

export async function cancelAgentRun(id: string, token?: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/agent/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
}

export function agentRunEventsUrl(id: string, cursor = 0): string {
  const suffix = cursor > 0 ? `?cursor=${encodeURIComponent(String(cursor))}` : "";
  return `${engineApiBase()}/agent/runs/${encodeURIComponent(id)}/events${suffix}`;
}

export type { AgentRunEvent, ApiMessage };
