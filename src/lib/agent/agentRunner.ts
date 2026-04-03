import { sendChatCompletionWithTools } from "@/lib/api";
import { AgentMemory } from "./memory";
import { Planner } from "./planner";
import { StepExecutor } from "./stepExecutor";
import { SafetyGuard, AgentSafetyError } from "./safetyGuard";
import type { AgentRunnerConfig, AgentResult, TaskStep } from "./types";

export class AgentRunner {
  private abortController = new AbortController();
  private memory = new AgentMemory();
  private planner = new Planner();
  private guard = new SafetyGuard();
  private executor = new StepExecutor(this.guard);

  abort(): void {
    this.abortController.abort();
  }

  async run(goal: string, config: AgentRunnerConfig): Promise<AgentResult> {
    // Reset for fresh run
    this.abortController = new AbortController();
    this.guard.reset();
    this.memory.init(goal);

    const signal = this.abortController.signal;
    const emit = config.onEvent;
    let iterations = 0;

    try {
      // ── Planning phase ────────────────────────────────────────────────────
      const plan = await this.planner.createPlan(goal, config, signal);
      this.memory.setPlan(plan);
      emit({ type: "plan_created", plan });

      const maxSteps = config.maxStepsPerGoal ?? 10;
      const steps = plan.steps.slice(0, maxSteps);

      // ── Execution phase ───────────────────────────────────────────────────
      for (const rawStep of steps) {
        if (signal.aborted) break;

        const step: TaskStep = { ...rawStep, status: "running" };
        emit({ type: "step_started", step });

        // Inner ReAct loop for this step
        let stepDone = false;
        while (!stepDone) {
          iterations++;
          this.guard.check(iterations, this.memory.totalTokensUsed, config);

          const result = await this.executor.executeStep(step, this.memory, config, signal);

          if (result.status === "tool_called") {
            emit({ type: "step_observation", stepId: step.id, toolName: "", observation: result.observation });
            // Compress memory periodically
            if (iterations % 5 === 0) this.memory.compress();
          } else if (result.status === "done") {
            emit({ type: "step_done", stepId: step.id, answer: result.answer });
            stepDone = true;
          } else {
            // failed — move on
            emit({ type: "step_done", stepId: step.id, answer: `[failed] ${result.error}` });
            stepDone = true;
          }
        }
      }

      // ── Synthesis phase ───────────────────────────────────────────────────
      const context = this.memory.getContext();
      let finalAnswer = "";

      try {
        const synthesis = await sendChatCompletionWithTools(
          config.provider,
          [
            { role: "system", content: "Synthesise a final, concise answer to the original goal based on the working memory below." },
            { role: "user", content: `Goal: ${goal}\n\nWorking memory:\n${context}` },
          ],
          config.modelName,
          undefined,
          { temperature: 0.3, maxTokens: 1024 },
          signal
        );
        finalAnswer = synthesis.content ?? context;
      } catch {
        finalAnswer = context;
      }

      emit({ type: "agent_done", answer: finalAnswer });

      return {
        answer: finalAnswer,
        plan,
        totalTokensUsed: this.memory.totalTokensUsed,
        iterations,
      };
    } catch (err) {
      if (err instanceof AgentSafetyError) {
        emit({ type: "agent_error", reason: err.reason });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "AbortError" && !(err instanceof Error && err.name === "AbortError")) {
          emit({ type: "agent_error", reason: msg });
        }
      }

      return {
        answer: "",
        plan: this.memory.plan ?? { goal, steps: [], createdAt: Date.now() },
        totalTokensUsed: this.memory.totalTokensUsed,
        iterations,
      };
    }
  }
}
