import type { AgentRunnerConfig } from "./types";

export class AgentSafetyError extends Error {
  constructor(public readonly reason: "max_iterations" | "budget_exceeded" | "loop_detected") {
    super(`Agent halted: ${reason}`);
    this.name = "AgentSafetyError";
  }
}

type ToolCall = { toolName: string; argsString: string };

export class SafetyGuard {
  private recentCalls: ToolCall[] = [];

  check(iterations: number, tokensUsed: number, config: AgentRunnerConfig): void {
    const maxIter = config.maxIterations ?? 20;
    const budget = config.budgetTokens ?? 32000;

    if (iterations >= maxIter) throw new AgentSafetyError("max_iterations");
    if (tokensUsed >= budget) throw new AgentSafetyError("budget_exceeded");
  }

  recordToolCall(toolName: string, argsString: string): void {
    this.recentCalls.push({ toolName, argsString });
    if (this.recentCalls.length > 3) this.recentCalls.shift();

    if (this.recentCalls.length === 3) {
      const [a, b, c] = this.recentCalls;
      if (
        a.toolName === b.toolName && b.toolName === c.toolName &&
        a.argsString === b.argsString && b.argsString === c.argsString
      ) {
        throw new AgentSafetyError("loop_detected");
      }
    }
  }

  reset(): void {
    this.recentCalls = [];
  }
}
