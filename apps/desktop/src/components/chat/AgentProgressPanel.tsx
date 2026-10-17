import { useState } from "react";
import { CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import type { AgentEvent, TaskStep } from "@/features/agents";

interface AgentProgressPanelProps {
  events: AgentEvent[];
  status: string;
}

export function AgentProgressPanel({ events, status }: AgentProgressPanelProps) {
  const [expandedObs, setExpandedObs] = useState<Set<number>>(new Set());

  // Derive plan steps from events
  const planEvent = events.find((e) => e.type === "plan_created");
  const steps: TaskStep[] = planEvent?.type === "plan_created" ? planEvent.plan.steps : [];

  // Track which steps are done
  const doneStepIds = new Set(
    events.filter((e) => e.type === "step_done").map((e) => e.type === "step_done" ? e.stepId : "")
  );
  const runningStepId = events.findLast((e) => e.type === "step_started")?.type === "step_started"
    ? (events.findLast((e) => e.type === "step_started") as Extract<AgentEvent, { type: "step_started" }>).step.id
    : null;

  const doneEvent = events.find((e) => e.type === "agent_done");
  const errorEvent = events.find((e) => e.type === "agent_error");

  const observations = events.filter((e) => e.type === "step_observation") as Extract<AgentEvent, { type: "step_observation" }>[];

  const toggleObs = (i: number) => {
    setExpandedObs((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  if (events.length === 0) return null;

  return (
    <div className="mx-4 mb-3 rounded-lg border border-border bg-muted/30 text-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
        {(status === "planning" || status === "running") && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        )}
        {status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
        {status === "error" && <AlertCircle className="w-3.5 h-3.5 text-destructive" />}
        <span className="font-medium text-foreground">
          {status === "planning" && "Researching…"}
          {status === "running" && "Running research…"}
          {status === "done" && "Research complete"}
          {status === "error" && "Research stopped"}
          {status === "idle" && "Research"}
        </span>
      </div>

      {/* Steps checklist */}
      {steps.length > 0 && (
        <div className="px-3 py-2 space-y-1">
          {steps.map((step) => {
            const isDone = doneStepIds.has(step.id);
            const isRunning = runningStepId === step.id && !isDone;
            return (
              <div key={step.id} className="flex items-start gap-2">
                {isDone
                  ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-500 shrink-0" />
                  : isRunning
                  ? <Loader2 className="w-3.5 h-3.5 mt-0.5 animate-spin text-primary shrink-0" />
                  : <Circle className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />}
                <span className={isDone ? "text-muted-foreground line-through" : "text-foreground"}>
                  {step.description}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Observations */}
      {observations.length > 0 && (
        <div className="border-t border-border px-3 py-2 space-y-1">
          {observations.map((obs, i) => (
            <div key={i} className="rounded bg-muted/60">
              <button
                onClick={() => toggleObs(i)}
                className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                {expandedObs.has(i) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span className="font-mono">{obs.toolName || "tool"}</span>
                <span className="ml-auto truncate max-w-[200px]">{obs.observation.slice(0, 60)}…</span>
              </button>
              {expandedObs.has(i) && (
                <pre className="px-3 pb-2 text-xs text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {obs.observation}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Final answer */}
      {doneEvent?.type === "agent_done" && doneEvent.answer && (
        <div className="border-t border-border px-3 py-2">
          <p className="text-xs text-muted-foreground mb-1">Final answer</p>
          <p className="text-foreground whitespace-pre-wrap">{doneEvent.answer}</p>
        </div>
      )}

      {/* Error */}
      {errorEvent?.type === "agent_error" && (
        <div className="border-t border-border px-3 py-2 text-destructive text-xs">
          Stopped: {errorEvent.reason}
        </div>
      )}
    </div>
  );
}
