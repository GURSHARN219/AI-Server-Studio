import type { ApiProvider } from "@/pages/Index";
import type { ToolDefinition, McpServerConfig, ExecutionMode } from "@/lib/api";
import type { McpDiscoveryResult } from "@/components/chat/useChatLogic";
import type { ToolTrace } from "@/lib/toolExecutor";

export type { McpDiscoveryResult, McpServerConfig, ToolTrace };

// ── Plan types ────────────────────────────────────────────────────────────────

export type TaskStepStatus = "pending" | "running" | "done" | "failed";

export type TaskStep = {
  id: string;
  description: string;
  status: TaskStepStatus;
  dependsOn?: string[];
};

export type TaskPlan = {
  goal: string;
  steps: TaskStep[];
  createdAt: number;
};

// ── Memory types ──────────────────────────────────────────────────────────────

export type StepMemoryEntry = {
  stepId: string;
  thought?: string;
  toolName?: string;
  observation?: string;
  conclusion?: string;
  timestamp: number;
};

// ── Execution result ──────────────────────────────────────────────────────────

export type StepResult =
  | { stepId: string; status: "tool_called"; observation: string; traces?: ToolTrace[] }
  | { stepId: string; status: "done"; answer: string }
  | { stepId: string; status: "failed"; error: string };

// ── Event stream ──────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: "plan_created"; plan: TaskPlan }
  | { type: "step_started"; step: TaskStep }
  | { type: "step_observation"; stepId: string; toolName: string; observation: string }
  | { type: "step_done"; stepId: string; answer: string }
  | { type: "agent_done"; answer: string }
  | { type: "agent_error"; reason: string };

// ── Final result ──────────────────────────────────────────────────────────────

export type AgentResult = {
  answer: string;
  plan: TaskPlan;
  totalTokensUsed: number;
  iterations: number;
};

// ── Runner config ─────────────────────────────────────────────────────────────

export type AgentRunnerConfig = {
  provider: ApiProvider;
  modelName: string;
  tools: ToolDefinition[];
  mcpToolDefs: McpDiscoveryResult[];
  mcpServers: McpServerConfig[];
  executionMode: ExecutionMode;
  maxIterations?: number;       // default 20
  maxStepsPerGoal?: number;     // default 10
  budgetTokens?: number;        // default 32000
  onEvent: (event: AgentEvent) => void;
};
