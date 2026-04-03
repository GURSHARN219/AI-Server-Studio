import type { TaskPlan, StepMemoryEntry } from "./types";

const CHARS_PER_TOKEN = 4;
const COMPRESS_KEEP_LAST = 5;

export class AgentMemory {
  goal = "";
  plan: TaskPlan | null = null;
  steps: StepMemoryEntry[] = [];
  scratchPad = "";
  totalTokensUsed = 0;

  init(goal: string): void {
    this.goal = goal;
    this.plan = null;
    this.steps = [];
    this.scratchPad = "";
    this.totalTokensUsed = 0;
  }

  setPlan(plan: TaskPlan): void {
    this.plan = plan;
  }

  appendObservation(stepId: string, toolName: string, result: string): void {
    this.steps.push({ stepId, toolName, observation: result, timestamp: Date.now() });
    this.scratchPad += `\n[Tool: ${toolName}]\nObservation: ${result}\n`;
  }

  appendConclusion(stepId: string, answer: string): void {
    this.steps.push({ stepId, conclusion: answer, timestamp: Date.now() });
    this.scratchPad += `\nConclusion: ${answer}\n`;
  }

  getContext(maxTokens = 4000): string {
    const header = `Goal: ${this.goal}\n\n`;
    const full = header + this.scratchPad;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    const result = full.length > maxChars
      ? full.slice(full.length - maxChars)
      : full;

    this.totalTokensUsed += Math.ceil(result.length / CHARS_PER_TOKEN);
    return result;
  }

  compress(): void {
    if (this.steps.length <= COMPRESS_KEEP_LAST) return;

    const old = this.steps.slice(0, this.steps.length - COMPRESS_KEEP_LAST);
    const kept = this.steps.slice(this.steps.length - COMPRESS_KEEP_LAST);

    const summary = old
      .map((e) => e.observation ? `[${e.toolName}]: ${e.observation.slice(0, 80)}` : `[done]: ${e.conclusion?.slice(0, 80)}`)
      .join(" | ");

    this.steps = [
      { stepId: "compressed", observation: `[compressed summary] ${summary}`, timestamp: Date.now() },
      ...kept,
    ];

    // Rebuild scratchpad from kept entries only
    this.scratchPad = `[compressed summary] ${summary}\n` +
      kept.map((e) =>
        e.observation
          ? `\n[Tool: ${e.toolName}]\nObservation: ${e.observation}\n`
          : `\nConclusion: ${e.conclusion}\n`
      ).join("");
  }
}
