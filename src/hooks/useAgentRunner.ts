import { useState, useRef, useCallback } from "react";
import type { AgentEvent, AgentResult, AgentRunnerConfig, TaskPlan, TaskStep } from "@/lib/agent";
import { getEnginePort } from "@/lib/localEngine";

type AgentStatus = "idle" | "planning" | "running" | "done" | "error";

export interface UseAgentRunnerReturn {
  status: AgentStatus;
  events: AgentEvent[];
  result: AgentResult | null;
  error: string | null;
  startAgent: (goal: string, config: Omit<AgentRunnerConfig, "onEvent">) => void;
  abortAgent: () => void;
}

export function useAgentRunner(): UseAgentRunnerReturn {
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const mapEvent = (evt: { type: string; data?: Record<string, unknown> }): AgentEvent | null => {
    switch (evt.type) {
      case "plan_created":
        return { type: "plan_created", plan: (evt.data?.plan as TaskPlan | undefined) || {
          goal: "",
          createdAt: Date.now(),
          steps: [],
        }} as AgentEvent;
      case "step_started":
        return { type: "step_started", step: (evt.data?.step as TaskStep | undefined) || {
          id: "step",
          description: "Running",
          status: "running",
        }} as AgentEvent;
      case "step_observation":
        return {
          type: "step_observation",
          stepId: String(evt.data?.stepId || ""),
          toolName: String(evt.data?.toolName || ""),
          observation: String(evt.data?.observation || ""),
        };
      case "step_done":
        return {
          type: "step_done",
          stepId: String(evt.data?.stepId || ""),
          answer: String(evt.data?.answer || ""),
        };
      case "agent_done":
        return { type: "agent_done", answer: String(evt.data?.answer || "") };
      case "agent_error":
        return { type: "agent_error", reason: String(evt.data?.reason || "Unknown error") };
      default:
        return null;
    }
  };

  const closeEventStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const fetchRunResult = async (runId: string): Promise<void> => {
    try {
      const base = `http://localhost:${getEnginePort()}/v1`;
      const res = await fetch(`${base}/agent/runs/${runId}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return;
      const data = await res.json();

      const plan = data.plan || { goal: data.goal || "", steps: [], createdAt: Date.now() };
      const resultObj: AgentResult = {
        answer: data.result || "",
        plan,
        totalTokensUsed: Number(data.totalTokens || 0),
        iterations: Number(data.iterations || 0),
      };
      setResult(resultObj);
    } catch {
      // best-effort only
    }
  };

  const startAgent = useCallback((goal: string, config: Omit<AgentRunnerConfig, "onEvent">) => {
    void (async () => {
      closeEventStream();
      runIdRef.current = null;

      setEvents([]);
      setResult(null);
      setError(null);
      setStatus("planning");

      const base = `http://localhost:${getEnginePort()}/v1`;

      try {
        const createRes = await fetch(`${base}/agent/runs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal,
            modelName: config.modelName,
            maxSteps: config.maxStepsPerGoal || 10,
            maxIterations: config.maxIterations || 20,
            provider: {
              id: config.provider.id,
              name: config.provider.name,
              baseUrl: config.provider.baseUrl,
              apiKey: config.provider.apiKey,
            },
            tools: config.tools,
            executionMode: config.executionMode,
          }),
        });

        if (!createRes.ok) {
          const errBody = await createRes.text();
          throw new Error(errBody || `Failed to start agent run (${createRes.status})`);
        }

        const created = await createRes.json();
        const runId = String(created.id || "");
        if (!runId) throw new Error("Invalid backend run id");
        runIdRef.current = runId;

        const es = new EventSource(`${base}/agent/runs/${runId}/events`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (!event.data) return;
          try {
            const parsed = JSON.parse(event.data) as { type: string; data?: Record<string, unknown> };
            const mapped = mapEvent(parsed);
            if (!mapped) return;

            setEvents((prev) => [...prev, mapped]);

            if (mapped.type === "plan_created") setStatus("running");

            if (mapped.type === "agent_done") {
              setStatus("done");
              void fetchRunResult(runId);
              closeEventStream();
            }

            if (mapped.type === "agent_error") {
              setStatus("error");
              setError(mapped.reason);
              closeEventStream();
            }
          } catch {
            // ignore malformed event
          }
        };

        es.onerror = () => {
          setStatus((prev) => (prev === "running" || prev === "planning" ? "error" : prev));
          setError((prev) => prev || "Agent event stream disconnected");
          closeEventStream();
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start backend agent run";
        setStatus("error");
        setError(message);
      }
    })();

  }, []);

  const abortAgent = useCallback(() => {
    const runId = runIdRef.current;
    if (runId) {
      const base = `http://localhost:${getEnginePort()}/v1`;
      void fetch(`${base}/agent/runs/${runId}/cancel`, { method: "POST" }).catch(() => {});
    }
    closeEventStream();
    setStatus("idle");
  }, []);

  return { status, events, result, error, startAgent, abortAgent };
}
