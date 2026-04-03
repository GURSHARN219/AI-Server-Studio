import { sendChatCompletionWithTools } from "@/lib/api";
import { executeToolCalls } from "@/lib/toolExecutor";
import type { TaskStep, StepResult, AgentRunnerConfig } from "./types";
import type { AgentMemory } from "./memory";
import { SafetyGuard } from "./safetyGuard";

export class StepExecutor {
  constructor(private readonly guard: SafetyGuard) {}

  async executeStep(
    step: TaskStep,
    memory: AgentMemory,
    config: AgentRunnerConfig,
    signal: AbortSignal
  ): Promise<StepResult> {
    const context = memory.getContext();
    const systemPrompt = `You are an autonomous agent executing a single task step.

Step: ${step.description}

Working memory:
${context}

Instructions:
- If you need to use a tool, call it now.
- If the step is complete or requires no tool, respond with: FINISH: <your answer>
- Be concise.`;

    try {
      const result = await sendChatCompletionWithTools(
        config.provider,
        [{ role: "system", content: systemPrompt }],
        config.modelName,
        config.tools,
        { temperature: 0.3, maxTokens: 2048 },
        signal
      );

      // ── Tool call path (batch + parallel via gateway) ─────────────────────
      if (result.toolCalls && result.toolCalls.length > 0) {
        result.toolCalls.forEach(tc =>
          this.guard.recordToolCall(tc.function.name, tc.function.arguments)
        );

        const toolResults = await executeToolCalls(
          result.toolCalls.map(tc => ({ name: tc.function.name, args: tc.function.arguments })),
          config.mcpToolDefs,
          config.mcpServers,
          config.executionMode
        );

        // Merge all observations into memory; build a combined observation string
        const observations = toolResults.map(r => {
          memory.appendObservation(step.id, r.tool, r.result);
          return `[${r.tool}${r.trace.retried ? " (retried)" : ""}] ${r.result}`;
        }).join("\n\n");

        return { stepId: step.id, status: "tool_called", observation: observations };
      }

      // ── FINISH path ───────────────────────────────────────────────────────
      const text = result.content ?? "";
      const finishMatch = text.match(/FINISH:\s*([\s\S]*)/i);
      const answer = finishMatch ? finishMatch[1].trim() : text.trim();

      memory.appendConclusion(step.id, answer);
      return { stepId: step.id, status: "done", answer };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { stepId: step.id, status: "failed", error };
    }
  }
}
