import { sendChatCompletionWithTools } from "@/lib/api";
import type { TaskPlan, TaskStep, AgentRunnerConfig } from "./types";

export class Planner {
  async createPlan(
    goal: string,
    config: AgentRunnerConfig,
    signal: AbortSignal
  ): Promise<TaskPlan> {
    const toolNames = config.tools.map((t) => t.function.name).join(", ");
    const systemPrompt = `You are a planning assistant. Break the user's goal into an ordered list of concrete steps.
Available tools: ${toolNames || "none"}

Respond ONLY with valid JSON matching this schema (no markdown, no explanation):
{
  "steps": [
    { "id": "step-1", "description": "...", "status": "pending" },
    { "id": "step-2", "description": "...", "status": "pending" }
  ]
}`;

    try {
      const result = await sendChatCompletionWithTools(
        config.provider,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: goal },
        ],
        config.modelName,
        undefined, // no tools — pure JSON output
        { temperature: 0.2, maxTokens: 1024 },
        signal
      );

      const text = result.content ?? "";
      // Strip markdown code fences if present
      const json = text.replace(/```(?:json)?\n?/g, "").trim();
      const parsed = JSON.parse(json);

      if (Array.isArray(parsed?.steps) && parsed.steps.length > 0) {
        return { goal, steps: parsed.steps as TaskStep[], createdAt: Date.now() };
      }
    } catch {
      // fall through to fallback
    }

    // Fallback: single-step plan
    return {
      goal,
      steps: [{ id: "step-1", description: goal, status: "pending" }],
      createdAt: Date.now(),
    };
  }
}
